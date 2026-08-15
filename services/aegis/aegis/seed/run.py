"""Seed the database by running synthetic actions through the REAL engine.

Nothing here decides a verdict. The seeder generates plausible actions from
the documented distribution, then calls the same `decide()` path the API uses,
so every stored decision was produced by the actual policy engine and every
ledger record is genuinely chained.

Conformance scoring follows the configured mode:
  live    -- call OpenAI, caching by (mandate_hash, action_signature). Because
             the cache key ignores action_id and timestamp, 25,000 actions
             collapse to a few hundred distinct scorer inputs.
  replay  -- serve the frozen fixture recorded from a previous live run.

Usage:
    python -m aegis.seed.run                    # full 25k seed
    python -m aegis.seed.run --actions 2000     # quick seed
    python -m aegis.seed.run --freeze           # write the fixture after seeding
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..auth.security import hash_password
from ..config import get_settings
from ..db.models import (
    AgentRow,
    Base,
    ComplianceEventRow,
    DecisionRow,
    Dispute,
    FleetState,
    LedgerEntry,
    MerchantRow,
    MerkleCheckpoint,
    Operator,
    PolicyVersion,
    User,
)
from ..db.session import create_all, get_engine, get_session_factory
from ..engine.conformance import (
    ConformanceEngine,
    InMemoryCache,
    OpenAIScorer,
    ReplayScorer,
    cache_key,
)
from ..engine.types import ActionRequest, CartItem, Mandate, utcnow
from ..scoring import load_fixture
from ..firestore import get_mirror
from ..service import create_checkpoint, decide, get_fleet_state, run_breakers
from . import distribution as dist

logger = logging.getLogger("aegis.seed")

FIXTURE_PATH = Path(__file__).resolve().parent / "conformance_fixture.json"


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------


def _reset(session: Session) -> None:
    """Clear seeded data. The ledger needs raw SQL because it is append-only."""
    from sqlalchemy import text

    for model in (
        Dispute,
        ComplianceEventRow,
        MerkleCheckpoint,
        DecisionRow,
        AgentRow,
        Operator,
        MerchantRow,
        PolicyVersion,
        User,
    ):
        session.execute(delete(model))

    dialect = session.bind.dialect.name if session.bind is not None else ""
    if dialect == "sqlite":
        session.execute(text("DROP TRIGGER IF EXISTS trg_ledger_no_delete"))
        session.execute(text("DELETE FROM ledger"))
        session.execute(
            text(
                """
                CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete
                BEFORE DELETE ON ledger
                BEGIN
                    SELECT RAISE(ABORT, 'ledger is append-only: DELETE is not permitted');
                END;
                """
            )
        )
    else:
        # Postgres: ALTER the trigger off, truncate, put it back. Seeding is the
        # one legitimate reason to reset a ledger, and it happens before any
        # real record exists.
        session.execute(text("ALTER TABLE ledger DISABLE TRIGGER trg_ledger_append_only"))
        session.execute(text("ALTER TABLE ledger DISABLE TRIGGER trg_ledger_no_truncate"))
        session.execute(text("TRUNCATE TABLE ledger RESTART IDENTITY"))
        session.execute(text("ALTER TABLE ledger ENABLE TRIGGER trg_ledger_append_only"))
        session.execute(text("ALTER TABLE ledger ENABLE TRIGGER trg_ledger_no_truncate"))

    state = session.get(FleetState, 1)
    if state is None:
        session.add(FleetState(id=1, stopped=False, rearm_approvals=[]))
    else:
        state.stopped = False
        state.rearm_approvals = []
    session.commit()


def _seed_reference(session: Session) -> None:
    for merchant in dist.MERCHANTS:
        session.add(
            MerchantRow(
                merchant_id=merchant.merchant_id,
                name=merchant.name,
                category=merchant.category,
                attributes=list(merchant.attributes),
            )
        )
    for operator_id, name in dist.OPERATORS.items():
        session.add(Operator(operator_id=operator_id, name=name, revoked=False))
    session.commit()


def _seed_users(session: Session) -> list[dict[str, str]]:
    """Demo accounts, one per role. Passwords are bcrypt-hashed."""
    accounts = [
        {
            "email": "operator@aegis.test",
            "name": "Priya Raman",
            "role": "operator",
            "password": "password123",
            "operator_id": None,
            "card_member_id": None,
        },
        {
            "email": "operator2@aegis.test",
            "name": "Devan Shah",
            "role": "operator",
            "password": "password123",
            "operator_id": None,
            "card_member_id": None,
        },
        {
            "email": "agentops@aegis.test",
            "name": "NorthStar Operations",
            "role": "agent_operator",
            "password": "password123",
            "operator_id": "op_northstar",
            "card_member_id": None,
        },
        {
            "email": "member@aegis.test",
            "name": "Anita Desai",
            "role": "card_member",
            "password": "password123",
            "operator_id": None,
            "card_member_id": "cm_anita",
        },
    ]
    for account in accounts:
        session.add(
            User(
                user_id=f"usr_{account['email'].split('@')[0]}",
                email=account["email"],
                name=account["name"],
                password_hash=hash_password(account["password"]),
                role=account["role"],
                operator_id=account["operator_id"],
                card_member_id=account["card_member_id"],
            )
        )
    session.commit()
    return accounts


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------


STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "this", "that", "into", "over", "under",
    "approved", "routine", "small", "while", "during", "their", "team", "per",
    "on", "of", "in", "to", "a", "an", "at", "by", "or",
})


def _derive_keywords(klass: dist.MandateClass) -> frozenset[str]:
    """The scorable form of a purpose, derived once at signing.

    Explicit keywords win; otherwise take the meaningful words from the prose.
    Deriving at signing (not per decision) fixes the scoring basis for the life
    of the mandate and folds it into the mandate hash.
    """
    if klass.keywords:
        return frozenset(klass.keywords)
    words = "".join(c.lower() if c.isalnum() else " " for c in klass.purpose).split()
    return frozenset(w for w in words if len(w) > 3 and w not in STOPWORDS)


def _mandate_for(klass: dist.MandateClass, now: datetime) -> Mandate:
    return Mandate(
        purpose=klass.purpose,
        purpose_keywords=_derive_keywords(klass),
        ship_to=dist.SHIP_TO_BY_OPERATOR.get(klass.operator),
        permitted_categories=frozenset(klass.categories),
        prohibited_attributes=frozenset(klass.prohibitions),
        per_transaction_ceiling=klass.per_transaction_ceiling,
        daily_ceiling=klass.daily_ceiling,
        max_transactions_per_day=klass.max_transactions_per_day,
        max_delegation_depth=klass.max_delegation_depth,
        expires_at=now + timedelta(days=180),
    )


def _seed_agents(
    session: Session, now: datetime, rng: random.Random, scale: int = 1
) -> list[AgentRow]:
    """Create agents, including real sub-agents whose mandates narrow properly.

    `scale` replicates each class's base agent count so the fleet is large
    enough that a normal day sits inside each mandate's daily transaction
    limit. Under-provisioning here makes every agent saturate its velocity rule
    and drowns every other reason code -- see distribution.agent_scale().
    """
    rows: list[AgentRow] = []

    for klass in dist.MANDATE_CLASSES:
        mandate = _mandate_for(klass, now)
        for index in range(klass.agent_count * scale):
            agent_id = f"ag_{klass.key}_{index + 1}"
            row = AgentRow(
                agent_id=agent_id,
                operator_id=klass.operator,
                card_member_id="cm_anita" if klass.key in {
                    "household_pantry", "travel_snacks", "team_meals"
                } else f"cm_{klass.operator[3:]}",
                name=dist.agent_display_name(klass.key, klass.label, index),
                parent_agent_id=None,
                depth=0,
                status="active",
                purpose=mandate.purpose,
                permitted_categories=sorted(mandate.permitted_categories),
                prohibited_attributes=sorted(mandate.prohibited_attributes),
                permitted_merchants=None,
                per_transaction_ceiling=mandate.per_transaction_ceiling,
                daily_ceiling=mandate.daily_ceiling,
                max_transactions_per_day=mandate.max_transactions_per_day,
                max_delegation_depth=mandate.max_delegation_depth,
                purpose_keywords=sorted(mandate.purpose_keywords),
                ship_to=mandate.ship_to,
                cadence=mandate.cadence,
                principal_id="cm_anita" if klass.key in {
                    "household_pantry", "travel_snacks", "team_meals"
                } else f"cm_{klass.operator[3:]}",
                mandate_expires_at=mandate.expires_at,
                mandate_hash=mandate.mandate_hash,
                created_at=now - timedelta(days=dist.SEED_DAYS + 5),
            )
            session.add(row)
            rows.append(row)

            # Give delegating classes a genuine sub-agent: a strict narrowing,
            # so the console's delegation tree has real depth to show.
            if mandate.max_delegation_depth > 0 and index == 0:
                child = Mandate(
                    purpose=f"{klass.purpose} (delegated: routine items only)",
                    purpose_keywords=mandate.purpose_keywords,
                    ship_to=mandate.ship_to,
                    cadence=mandate.cadence,
                    permitted_categories=frozenset(list(mandate.permitted_categories)[:1]),
                    prohibited_attributes=mandate.prohibited_attributes,
                    per_transaction_ceiling=(mandate.per_transaction_ceiling / 2).quantize(
                        Decimal("0.01")
                    ),
                    daily_ceiling=(mandate.daily_ceiling / 2).quantize(Decimal("0.01")),
                    max_transactions_per_day=max(mandate.max_transactions_per_day // 2, 1),
                    max_delegation_depth=mandate.max_delegation_depth - 1,
                    expires_at=mandate.expires_at,
                )
                child_row = AgentRow(
                    agent_id=f"{agent_id}_sub",
                    operator_id=klass.operator,
                    card_member_id=row.card_member_id,
                    name=f"{row.name} · Delegate",
                    parent_agent_id=agent_id,
                    depth=1,
                    status="active",
                    purpose=child.purpose,
                    permitted_categories=sorted(child.permitted_categories),
                    prohibited_attributes=sorted(child.prohibited_attributes),
                    permitted_merchants=None,
                    per_transaction_ceiling=child.per_transaction_ceiling,
                    daily_ceiling=child.daily_ceiling,
                    max_transactions_per_day=child.max_transactions_per_day,
                    max_delegation_depth=child.max_delegation_depth,
                    purpose_keywords=sorted(child.purpose_keywords),
                    ship_to=child.ship_to,
                    cadence=child.cadence,
                    principal_id=row.principal_id,
                    mandate_expires_at=child.expires_at,
                    mandate_hash=child.mandate_hash,
                    created_at=now - timedelta(days=dist.SEED_DAYS),
                )
                session.add(child_row)
                rows.append(child_row)

    # The compromised agent used for the injection scenario.
    travel = next(c for c in dist.MANDATE_CLASSES if c.key == "business_travel")
    rogue_mandate = _mandate_for(travel, now)
    session.add(
        AgentRow(
            agent_id="ag_travel_rogue",
            operator_id="op_voyagr",
            card_member_id="cm_voyagr",
            name="Travel concierge agent",
            parent_agent_id=None,
            depth=0,
            status="active",
            purpose=rogue_mandate.purpose,
            permitted_categories=sorted(rogue_mandate.permitted_categories),
            prohibited_attributes=sorted(rogue_mandate.prohibited_attributes),
            permitted_merchants=None,
            per_transaction_ceiling=rogue_mandate.per_transaction_ceiling,
            daily_ceiling=rogue_mandate.daily_ceiling,
            max_transactions_per_day=rogue_mandate.max_transactions_per_day,
            max_delegation_depth=rogue_mandate.max_delegation_depth,
            purpose_keywords=sorted(rogue_mandate.purpose_keywords),
            ship_to=rogue_mandate.ship_to,
            cadence=rogue_mandate.cadence,
            principal_id="cm_voyagr",
            mandate_expires_at=rogue_mandate.expires_at,
            mandate_hash=rogue_mandate.mandate_hash,
            created_at=now - timedelta(days=dist.SEED_DAYS + 5),
        )
    )
    session.commit()
    return rows


# ---------------------------------------------------------------------------
# Action generation
# ---------------------------------------------------------------------------


def _pick(rng: random.Random, options: dict[str, float]) -> str:
    total = sum(options.values())
    roll = rng.random() * total
    cumulative = 0.0
    for key, weight in options.items():
        cumulative += weight
        if roll <= cumulative:
            return key
    return next(iter(options))


def _timestamp(rng: random.Random, now: datetime) -> datetime:
    """Pick a decision time inside the seeded window, diurnally weighted.

    The window ENDS at `now` rather than at the end of today. Two bugs came
    from getting this wrong, and both made the dashboard look broken:

      1. Replacing the hour on `now - day_offset` moves a timestamp FORWARD
         when the drawn hour is later than the current hour, so day_offset=0
         produced actions in the future -- and, more visibly, most of "today's"
         traffic landed at hours already past, leaving the last 24h nearly
         empty.
      2. Anchoring to the seed date means the corpus ages. Two days after
         seeding, a 24-hour dashboard window contains nothing at all and every
         tile reads zero.

    Sampling an offset backwards from `now` fixes both: the newest actions are
    always minutes old, whenever the seed happens to be run.
    """
    day_offset = rng.randint(0, dist.SEED_DAYS - 1)
    hour = rng.choices(range(24), weights=dist.HOUR_WEIGHTS, k=1)[0]
    candidate = (now - timedelta(days=day_offset)).replace(
        hour=hour,
        minute=rng.randint(0, 59),
        second=rng.randint(0, 59),
        microsecond=rng.randint(0, 999999),
    )
    # Never emit a decision in the future; fold it back a day instead of
    # clamping, which would pile timestamps up on a single instant.
    if candidate > now:
        candidate -= timedelta(days=1)
    return candidate


def _amount(rng: random.Random, merchant: dist.SeedMerchant, ceiling: Decimal, kind: str) -> Decimal:
    low, high = merchant.typical_amount
    if kind == "in_purpose_over_ceiling":
        base = int(ceiling) + rng.randint(200, max(int(ceiling // 2), 400))
        return Decimal(base)
    amount = rng.randint(low, high)
    # Keep normal traffic under the ceiling so the over-ceiling case stays
    # distinct rather than firing accidentally.
    if Decimal(amount) > ceiling:
        amount = int(ceiling * Decimal("0.8"))
    return Decimal(max(amount, 50))


def _build_action(
    rng: random.Random,
    klass: dist.MandateClass,
    agent: AgentRow,
    kind: str,
    when: datetime,
    index: int,
) -> ActionRequest:
    if kind in {"out_of_purpose", "prohibited_attribute"}:
        pool = klass.out_of_purpose_merchants
        if kind == "prohibited_attribute":
            prohibited_pool = [
                m for m in pool if set(dist.MERCHANTS_BY_ID[m].attributes) & set(klass.prohibitions)
            ]
            pool = tuple(prohibited_pool) or pool
        merchant_id = rng.choice(pool)
    else:
        merchant_id = rng.choice(klass.in_purpose_merchants)

    merchant = dist.MERCHANTS_BY_ID[merchant_id]
    description = rng.choice(merchant.descriptions) if merchant.descriptions else ""

    # --- basket ---------------------------------------------------------
    lines = dist.CART_LINES.get(merchant_id, ())
    cart: tuple[CartItem, ...] = ()
    if lines:
        picked = rng.sample(list(lines), k=min(len(lines), rng.randint(1, 3)))
        cart = tuple(
            CartItem(label=label, attributes=frozenset(attrs), quantity=rng.randint(1, 3))
            for label, attrs in picked
        )

    # --- delivery destination --------------------------------------------
    authorised = dist.SHIP_TO_BY_OPERATOR.get(agent.operator_id)
    ship_to = authorised
    if kind == "exfiltration_ship_to":
        # The goods are ordinary; the address is not. This is the signature of
        # an agent being used to move value out, and no amount or category
        # check would notice it.
        ship_to = rng.choice(dist.EXFIL_DESTINATIONS)

    # --- untrusted text ---------------------------------------------------
    injected = None
    if kind == "prompt_injection":
        injected = rng.choice(dist.INJECTION_TEXTS)
    elif rng.random() < 0.06:
        # Benign merchant chatter on a fraction of ordinary traffic, so the
        # detector is exercised against text that must NOT trip it.
        injected = rng.choice(dist.BENIGN_TEXTS)

    return ActionRequest(
        action_id=f"act_{index:07d}",
        agent_id=agent.agent_id,
        merchant_id=merchant_id,
        merchant_name=merchant.name,
        merchant_category=merchant.category,
        amount=_amount(rng, merchant, Decimal(str(agent.per_transaction_ceiling)), kind),
        currency="INR",
        description=description,
        merchant_attributes=frozenset(merchant.attributes),
        cart_items=cart,
        ship_to=ship_to,
        injected_instruction=injected,
        requested_at=when,
    )


# ---------------------------------------------------------------------------
# Deterministic offline scorer
# ---------------------------------------------------------------------------


class HeuristicScorer:
    """Used ONLY when no key and no fixture are available.

    It is deliberately crude and clearly labelled in `model_version`, so a
    reviewer can never mistake a heuristic score for a model score. It exists
    so that `docker-compose up` produces a populated console offline.
    """

    model_version = "heuristic-offline-v1"

    def __init__(self, rng: random.Random) -> None:
        self._rng = rng

    def score(self, mandate: Mandate, action: ActionRequest):
        from ..engine.conformance import PROMPT_HASH
        from ..engine.types import ConformanceResult

        in_category = action.merchant_category in mandate.permitted_categories
        if not in_category:
            score = self._rng.uniform(0.05, 0.35)
            rationale = (
                f"Merchant category {action.merchant_category} falls outside the "
                "categories this mandate authorises."
            )
        else:
            score = self._rng.uniform(0.86, 0.99)
            rationale = "Purchase is consistent with the authorised purpose."
        return ConformanceResult(
            score=round(score, 4),
            rationale=rationale,
            vetoes=(),
            model_version=self.model_version,
            prompt_hash=PROMPT_HASH,
            available=True,
        )


class MarginalWrapper:
    """Nudges a chosen subset into the marginal band so the ALLOW+flag path is
    represented. Applied only to actions the generator intended as marginal."""

    def __init__(self, inner, rng: random.Random, marginal_keys: set[str]) -> None:
        self._inner = inner
        self._rng = rng
        self._marginal = marginal_keys
        self.model_version = getattr(inner, "model_version", "wrapped")

    def score(self, mandate: Mandate, action: ActionRequest):
        result = self._inner.score(mandate, action)
        if action.action_id in self._marginal and result.available and result.score >= 0.85:
            from dataclasses import replace

            return replace(result, score=round(self._rng.uniform(0.71, 0.84), 4))
        return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def seed(
    total_actions: int = dist.TOTAL_ACTIONS,
    freeze: bool = False,
    quiet: bool = False,
) -> dict[str, Any]:
    settings = get_settings()
    rng = random.Random(dist.RANDOM_SEED)
    now = utcnow()

    create_all()
    session = get_session_factory()()

    try:
        if not quiet:
            logger.info("resetting database")
        _reset(session)
        _seed_reference(session)
        accounts = _seed_users(session)
        scale = dist.agent_scale(total_actions)
        if not quiet:
            logger.info(
                "fleet: %d agents (base %d x%d) -> ~%.1f actions/agent/day",
                dist.base_agent_count() * scale,
                dist.base_agent_count(),
                scale,
                total_actions / dist.SEED_DAYS / max(dist.base_agent_count() * scale, 1),
            )
        agent_rows = _seed_agents(session, now, rng, scale=scale)
        agents_by_class: dict[str, list[AgentRow]] = {}
        for klass in dist.MANDATE_CLASSES:
            agents_by_class[klass.key] = [
                r
                for r in agent_rows
                if r.agent_id.startswith(f"ag_{klass.key}_") and not r.agent_id.endswith("_sub")
            ]

        # ---- scorer -------------------------------------------------------
        cache = InMemoryCache()
        mode = settings.resolved_scorer_mode
        fixture = load_fixture(str(FIXTURE_PATH)) if FIXTURE_PATH.exists() else {}

        if mode == "live" and settings.openai_api_key:
            base_scorer = OpenAIScorer(
                api_key=settings.openai_api_key,
                model=settings.scorer_model,
                timeout=settings.scorer_timeout_seconds,
            )
            cache.load(fixture)  # reuse anything already recorded
            scorer_label = f"LIVE ({settings.scorer_model})"
        elif fixture:
            base_scorer = ReplayScorer(fixture=fixture, model_version=settings.scorer_model)
            scorer_label = f"REPLAY ({len(fixture)} recorded scores)"
        else:
            base_scorer = HeuristicScorer(random.Random(dist.RANDOM_SEED + 1))
            scorer_label = "HEURISTIC (offline: no API key, no fixture)"

        if not quiet:
            logger.info("conformance scorer: %s", scorer_label)

        # ---- plan the actions --------------------------------------------
        planned: list[tuple[dist.MandateClass, AgentRow, str, datetime]] = []
        class_weights = {c.key: c.weight for c in dist.MANDATE_CLASSES}
        classes_by_key = {c.key: c for c in dist.MANDATE_CLASSES}

        for index in range(total_actions):
            key = _pick(rng, class_weights)
            klass = classes_by_key[key]
            pool = agents_by_class.get(key) or agent_rows
            agent = rng.choice(pool)
            kind = _pick(rng, dist.ACTION_MIX)
            planned.append((klass, agent, kind, _timestamp(rng, now)))

        planned.sort(key=lambda p: p[3])

        actions: list[tuple[ActionRequest, str]] = []
        marginal_ids: set[str] = set()
        for index, (klass, agent, kind, when) in enumerate(planned):
            action = _build_action(rng, klass, agent, kind, when, index)
            if kind == "in_purpose_marginal":
                marginal_ids.add(action.action_id)
            actions.append((action, kind))

        scorer = MarginalWrapper(base_scorer, random.Random(dist.RANDOM_SEED + 2), marginal_ids)
        engine = ConformanceEngine(scorer=scorer, cache=cache)

        # ---- run them through the REAL engine ----------------------------
        started = time.perf_counter()
        counts = {"ALLOW": 0, "DENY": 0, "STEP_UP": 0, "HOLD": 0}
        reason_counts: dict[str, int] = {}
        written = 0

        member_rng = random.Random(dist.RANDOM_SEED + 3)
        step_ups_resolved = 0

        for position, (action, kind) in enumerate(actions):
            try:
                decision, _, _ = decide(
                    session, action, engine, now=action.requested_at, seed_kind=kind
                )
            except LookupError:
                continue
            counts[decision.verdict.value] += 1
            reason_counts[decision.reason_code.value] = (
                reason_counts.get(decision.reason_code.value, 0) + 1
            )
            written += 1

            # Card members actually answer step-ups. Without modelling this the
            # corpus would be unrealistic AND self-defeating: a merchant only
            # becomes known once a purchase there is approved, so nothing would
            # ever stop being novel. Approval rates differ by WHY we asked --
            # people wave through a first visit to a legitimate shop far more
            # readily than a purchase that missed its stated purpose.
            if decision.verdict.value == "STEP_UP":
                approve_rate = dist.STEP_UP_APPROVAL_RATES.get(
                    decision.reason_code.value, 0.5
                )
                row = session.get(DecisionRow, action.action_id)
                if row is not None:
                    if member_rng.random() < approve_rate:
                        row.step_up_state = (
                            "always_allowed" if member_rng.random() < 0.35 else "approved"
                        )
                    else:
                        row.step_up_state = "declined"
                    row.step_up_resolved_at = action.requested_at + timedelta(
                        minutes=member_rng.randint(1, 45)
                    )
                    step_ups_resolved += 1
                    # Flush so the NEXT decision's context sees this resolution
                    # -- that is what lets a merchant graduate from novel.
                    session.flush()

            if written % 500 == 0:
                session.commit()
                if not quiet:
                    elapsed = time.perf_counter() - started
                    rate = written / elapsed if elapsed else 0
                    logger.info(
                        "  %6d / %d decisions  (%.0f/s, cache %d)",
                        written,
                        len(actions),
                        rate,
                        len(cache),
                    )

        session.commit()

        # ---- the injection scenario --------------------------------------
        _seed_injection_scenario(session, engine, now, rng)
        session.commit()

        # ---- breakers over the real history -------------------------------
        for agent in session.scalars(select(AgentRow)):
            run_breakers(session, agent.agent_id, trip=(agent.agent_id == "ag_travel_rogue"))
        session.commit()

        # ---- policy versions ---------------------------------------------
        _seed_policies(session)
        session.commit()

        # ---- checkpoint ---------------------------------------------------
        create_checkpoint(session)
        session.commit()

        # ---- mirror to Firestore -------------------------------------------
        # Bulk, batched, and entirely optional: the SQL corpus above is the
        # source of truth and is complete whether or not this succeeds.
        mirror = get_mirror()
        mirrored = {"decisions": 0, "agents": 0}
        if mirror.enabled:
            if not quiet:
                logger.info("mirroring to Firestore...")
            mirrored["agents"] = mirror.mirror_many(
                "agents", session.scalars(select(AgentRow)), "agent_id"
            )
            mirrored["decisions"] = mirror.mirror_many(
                "decisions", session.scalars(select(DecisionRow)), "action_id"
            )
            for merchant in session.scalars(select(MerchantRow)):
                mirror.mirror_merchant(merchant)
            for operator in session.scalars(select(Operator)):
                mirror.mirror_operator(operator)
            for incident in session.scalars(select(ComplianceEventRow)):
                mirror.mirror_incident(incident)
            mirror.mirror_fleet_state(get_fleet_state(session))
            if not quiet:
                logger.info(
                    "  mirrored %d agents, %d decisions",
                    mirrored["agents"],
                    mirrored["decisions"],
                )

        # ---- freeze the fixture -------------------------------------------
        if freeze:
            snapshot = cache.snapshot()
            FIXTURE_PATH.write_text(json.dumps(snapshot, indent=2, sort_keys=True))
            if not quiet:
                logger.info("froze %d conformance scores -> %s", len(snapshot), FIXTURE_PATH)

        elapsed = time.perf_counter() - started
        report = {
            "actions_planned": len(actions),
            "decisions_written": written,
            "step_ups_resolved": step_ups_resolved,
            "verdicts": counts,
            "reason_codes": dict(sorted(reason_counts.items(), key=lambda kv: -kv[1])),
            "distinct_scorer_inputs": len(cache),
            "scorer": scorer_label,
            "elapsed_seconds": round(elapsed, 1),
            "ledger_records": session.scalar(select(func.count(LedgerEntry.sequence))) or 0,
            "agents": session.scalar(select(func.count(AgentRow.agent_id))) or 0,
            "incidents": session.scalar(select(func.count(ComplianceEventRow.event_id))) or 0,
            "accounts": [{"email": a["email"], "role": a["role"]} for a in accounts],
            "firestore_mirrored": mirrored,
            "distribution": dist.summary(),
        }
        return report
    finally:
        session.close()


def _seed_injection_scenario(
    session: Session, engine: ConformanceEngine, now: datetime, rng: random.Random
) -> None:
    """A scripted conformance collapse, so the breaker fires on real data."""
    agent = session.get(AgentRow, "ag_travel_rogue")
    if agent is None:
        return

    # Healthy history first.
    for i in range(14):
        when = now - timedelta(hours=72 + i * 3)
        merchant = dist.MERCHANTS_BY_ID[rng.choice(("mch_indigo", "mch_taj", "mch_uber"))]
        decide(
            session,
            ActionRequest(
                action_id=f"act_rogue_ok_{i:03d}",
                agent_id=agent.agent_id,
                merchant_id=merchant.merchant_id,
                merchant_name=merchant.name,
                merchant_category=merchant.category,
                amount=Decimal(rng.randint(*merchant.typical_amount)),
                description=rng.choice(merchant.descriptions or ("",)),
                merchant_attributes=frozenset(merchant.attributes),
                requested_at=when,
            ),
            engine,
            now=when,
        )

    # Then the collapse: repeated attempts at stored value and unrelated goods.
    for i in range(16):
        when = now - timedelta(minutes=90 - i * 5)
        merchant = dist.MERCHANTS_BY_ID[
            rng.choice(("mch_paytm_wallet", "mch_wazirx", "mch_luxewatch", "mch_freshmart_cards"))
        ]
        decide(
            session,
            ActionRequest(
                action_id=f"act_rogue_bad_{i:03d}",
                agent_id=agent.agent_id,
                merchant_id=merchant.merchant_id,
                merchant_name=merchant.name,
                merchant_category=merchant.category,
                amount=Decimal(rng.randint(*merchant.typical_amount)),
                description=rng.choice(merchant.descriptions or ("",)),
                merchant_attributes=frozenset(merchant.attributes),
                requested_at=when,
            ),
            engine,
            now=when,
        )


def _seed_policies(session: Session) -> None:
    from ..engine.policy import DEFAULT_RULESET, PolicyThresholds, Ruleset

    session.add(
        PolicyVersion(
            policy_id="pol_baseline",
            name="baseline",
            version=1,
            stage="enforcing",
            thresholds=DEFAULT_RULESET.thresholds.to_canonical(),
            ruleset_hash=DEFAULT_RULESET.ruleset_hash,
            created_by="system",
            promoted_at=utcnow(),
        )
    )
    tightened = Ruleset(
        thresholds=PolicyThresholds(conformance_review_floor=0.78),
        name="tightened-review-floor",
        version=2,
    )
    session.add(
        PolicyVersion(
            policy_id="pol_tightened",
            name=tightened.name,
            version=2,
            stage="draft",
            thresholds=tightened.thresholds.to_canonical(),
            ruleset_hash=tightened.ruleset_hash,
            created_by="operator@aegis.test",
        )
    )


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Seed AEGIS with synthetic history.")
    parser.add_argument("--actions", type=int, default=dist.TOTAL_ACTIONS)
    parser.add_argument(
        "--freeze",
        action="store_true",
        help="Write the conformance cache to the fixture after seeding.",
    )
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    report = seed(total_actions=args.actions, freeze=args.freeze, quiet=args.quiet)

    print()
    print("=" * 68)
    print("AEGIS seed complete")
    print("=" * 68)
    print(f"  scorer              : {report['scorer']}")
    print(f"  decisions written   : {report['decisions_written']:,}")
    print(f"  ledger records      : {report['ledger_records']:,}")
    print(f"  distinct scorer i/p : {report['distinct_scorer_inputs']:,}")
    print(f"  agents              : {report['agents']}")
    print(f"  incidents           : {report['incidents']}")
    print(f"  elapsed             : {report['elapsed_seconds']}s")
    print()
    total = max(report["decisions_written"], 1)
    print("  verdict mix:")
    for verdict, count in report["verdicts"].items():
        if count:
            print(f"    {verdict:9} {count:7,}  {count / total:6.1%}")
    print()
    print("  top reasons:")
    for reason, count in list(report["reason_codes"].items())[:8]:
        print(f"    {reason:38} {count:7,}")
    print()
    print("  sign in with:")
    for account in report["accounts"]:
        print(f"    {account['email']:26} {account['role']:16} password123")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
