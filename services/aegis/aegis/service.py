"""Application services: the seam between the pure engine and the database.

The engine modules are deliberately pure -- they take values and return values.
This module is where those values are loaded from and written to Postgres, and
where the ordering guarantees live:

  * a decision is written to the ledger in the SAME transaction that writes the
    queryable projection, so the two can never disagree
  * the chain head is read FOR UPDATE, so two concurrent decisions cannot both
    link to the same prev_hash and fork the chain
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional, Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .db.models import (
    AgentRow,
    ComplianceEventRow,
    DecisionRow,
    FleetState,
    LedgerEntry,
    MerchantRow,
    MerkleCheckpoint,
    Operator,
    PolicyVersion,
)
from .engine import breakers as breaker_mod
from .engine.conformance import ConformanceEngine
from .engine.delegation import build_chain, descendants_of
from .engine.ledger import (
    GENESIS_HASH,
    LedgerRecord,
    compute_self_hash,
    merkle_root,
    verify_records,
)
from .engine.policy import DEFAULT_RULESET, PolicyThresholds, Ruleset, evaluate
from .engine.types import (
    ActionRequest,
    Agent,
    AgentStatus,
    ConformanceResult,
    Decision,
    EvaluationContext,
    Mandate,
    VelocityWindow,
    Verdict,
    to_json_primitives,
    utcnow,
)


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Row <-> value-object mapping
# ---------------------------------------------------------------------------


def _diligence_bar(session: Session, card_member_id: Optional[str]) -> Optional[dict]:
    """The card member's purchase standards, or None for the defaults.

    One indexed read by primary key. Absent row means the member never opened
    the panel, and the documented defaults apply -- so the check works for
    everyone without requiring anyone to configure it first.
    """
    if not card_member_id:
        return None
    from .db.models import CardMemberPreferences

    row = session.get(CardMemberPreferences, card_member_id)
    if row is None:
        return None
    return {
        "min_rating": Decimal(str(row.min_rating)),
        "min_reviews": int(row.min_reviews),
        "price_tolerance": Decimal(str(row.price_tolerance)),
        "require_diligence": bool(row.require_diligence),
    }


def mandate_from_row(row: AgentRow) -> Mandate:
    return Mandate(
        purpose=row.purpose,
        permitted_categories=frozenset(row.permitted_categories or ()),
        prohibited_attributes=frozenset(row.prohibited_attributes or ()),
        per_transaction_ceiling=Decimal(str(row.per_transaction_ceiling or 0)),
        daily_ceiling=Decimal(str(row.daily_ceiling or 0)),
        max_transactions_per_day=int(row.max_transactions_per_day or 0),
        max_delegation_depth=int(row.max_delegation_depth or 0),
        permitted_merchants=(
            None if row.permitted_merchants is None else frozenset(row.permitted_merchants)
        ),
        purpose_keywords=frozenset(row.purpose_keywords or ()),
        ship_to=row.ship_to,
        cadence=row.cadence or "weekly",
        expires_at=_as_utc(row.mandate_expires_at),
    )


def agent_from_row(row: AgentRow) -> Agent:
    return Agent(
        agent_id=row.agent_id,
        operator_id=row.operator_id,
        name=row.name,
        mandate=mandate_from_row(row),
        parent_agent_id=row.parent_agent_id,
        depth=int(row.depth or 0),
        status=AgentStatus(row.status),
        breaker_tripped=bool(row.breaker_tripped),
        principal_id=row.principal_id or row.card_member_id or "",
        created_at=_as_utc(row.created_at) or utcnow(),
    )


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """SQLite drops tzinfo; normalise so comparisons never raise."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def load_agent_map(session: Session, operator_id: Optional[str] = None) -> dict[str, Agent]:
    stmt = select(AgentRow)
    if operator_id:
        stmt = stmt.where(AgentRow.operator_id == operator_id)
    return {row.agent_id: agent_from_row(row) for row in session.scalars(stmt)}


# ---------------------------------------------------------------------------
# Fleet state
# ---------------------------------------------------------------------------


def get_fleet_state(session: Session) -> FleetState:
    state = session.get(FleetState, 1)
    if state is None:
        state = FleetState(id=1, stopped=False, rearm_approvals=[])
        session.add(state)
        session.flush()
    return state


def stop_fleet(session: Session, actor: str, reason: str) -> FleetState:
    state = get_fleet_state(session)
    state.stopped = True
    state.stopped_by = actor
    state.stopped_at = utcnow()
    state.stop_reason = reason
    state.rearm_approvals = []
    session.flush()
    return state


def rearm_fleet(session: Session, actor: str) -> tuple[FleetState, bool]:
    """Two-person rule: two DISTINCT approvers are required to re-arm.

    A control that a single operator can switch back on is not a control -- the
    same person who panicked (or was compromised) could undo the stop alone.
    """
    state = get_fleet_state(session)
    if not state.stopped:
        return state, True

    approvals = list(state.rearm_approvals or [])
    if actor not in approvals:
        approvals.append(actor)
    state.rearm_approvals = approvals

    if len(approvals) >= 2:
        state.stopped = False
        state.stopped_by = None
        state.stopped_at = None
        state.stop_reason = ""
        state.rearm_approvals = []
        session.flush()
        return state, True

    session.flush()
    return state, False


# ---------------------------------------------------------------------------
# Active policy
# ---------------------------------------------------------------------------


def active_ruleset(session: Session) -> Ruleset:
    row = session.scalars(
        select(PolicyVersion)
        .where(PolicyVersion.stage == "enforcing")
        .order_by(PolicyVersion.version.desc())
    ).first()
    if row is None:
        return DEFAULT_RULESET
    return Ruleset(
        thresholds=PolicyThresholds(**row.thresholds),
        name=row.name,
        version=row.version,
    )


def shadow_ruleset(session: Session) -> Optional[Ruleset]:
    row = session.scalars(
        select(PolicyVersion)
        .where(PolicyVersion.stage == "shadow")
        .order_by(PolicyVersion.version.desc())
    ).first()
    if row is None:
        return None
    return Ruleset(
        thresholds=PolicyThresholds(**row.thresholds), name=row.name, version=row.version
    )


# ---------------------------------------------------------------------------
# Evaluation context
# ---------------------------------------------------------------------------


def build_context(
    session: Session,
    agent_row: AgentRow,
    now: Optional[datetime] = None,
) -> EvaluationContext:
    at = now or utcnow()

    # ACE Agent Registration, through the provider seam. Resolved HERE rather
    # than in the API layer so the answer lands on the decision record and
    # appears in the flow -- previously the check ran before the engine and was
    # invisible in the evidence.
    #
    # Three states, and the third is the important one: a registry we cannot
    # reach yields None, which the engine treats as a denial. An identity we
    # cannot verify is never a pass.
    identity_verified: Optional[bool] = True
    try:
        from .providers import ProviderUnavailable, get_providers

        identity_verified = get_providers(session).identity.verify(agent_row.agent_id) is not None
    except ProviderUnavailable:
        identity_verified = None
    except Exception:  # noqa: BLE001
        identity_verified = None

    agents = load_agent_map(session)
    chain = build_chain(agent_row.agent_id, agents)
    operator = session.get(Operator, agent_row.operator_id)

    day_start = at - timedelta(days=1)
    velocity_row = session.execute(
        select(
            func.count(DecisionRow.action_id),
            func.coalesce(func.sum(DecisionRow.amount), 0),
        ).where(
            DecisionRow.agent_id == agent_row.agent_id,
            DecisionRow.verdict == "ALLOW",
            DecisionRow.decided_at >= day_start,
        )
    ).one()

    # A merchant becomes "known" to an agent once a transaction there has
    # actually been settled OR the card member approved a step-up for it.
    # Counting only ALLOWs would deadlock: the first visit always step-ups on
    # the novel-merchant rule, so without the approval branch no merchant could
    # ever graduate and every purchase would be treated as novel forever.
    known = set(
        session.scalars(
            select(DecisionRow.merchant_id)
            .where(
                DecisionRow.agent_id == agent_row.agent_id,
                or_(
                    DecisionRow.verdict == "ALLOW",
                    DecisionRow.step_up_state.in_(("approved", "always_allowed")),
                ),
            )
            .distinct()
        )
    )

    return EvaluationContext(
        agent=agent_from_row(agent_row),
        chain=chain or (agent_from_row(agent_row),),
        fleet_stopped=bool(get_fleet_state(session).stopped),
        operator_revoked=bool(operator and operator.revoked),
        velocity=VelocityWindow(
            transactions_today=int(velocity_row[0] or 0),
            amount_today=Decimal(str(velocity_row[1] or 0)),
        ),
        known_merchants=frozenset(known),
        identity_verified=identity_verified,
        diligence_bar=_diligence_bar(session, agent_row.card_member_id),
        now=at,
    )


# ---------------------------------------------------------------------------
# The decision path
# ---------------------------------------------------------------------------


def decide(
    session: Session,
    action: ActionRequest,
    conformance_engine: ConformanceEngine,
    ruleset: Optional[Ruleset] = None,
    now: Optional[datetime] = None,
    card_member_id: Optional[str] = None,
    seed_kind: Optional[str] = None,
    seed_corpus: Optional[str] = None,
) -> tuple[Decision, LedgerEntry, Optional[dict[str, Any]]]:
    """Evaluate, persist and chain one action.

    Returns (decision, ledger_row, shadow_result). The shadow result is the
    verdict the SHADOW policy would have produced, so the console can show both
    without running policy twice on the client.

    FAIL CLOSED ON STORAGE. If the ledger write fails, the whole transaction is
    rolled back and the exception propagates -- the caller must NOT return a
    verdict. A decision that cannot be recorded is a decision that cannot be
    defended later, so producing one would be worse than refusing: it would
    authorise spending with no evidence that it was ever authorised.
    """
    agent_row = session.get(AgentRow, action.agent_id)
    if agent_row is None:
        raise LookupError(f"unknown agent {action.agent_id}")

    ctx = build_context(session, agent_row, now=now)
    rs = ruleset or active_ruleset(session)

    # Score only when a rule could actually consume the score. Rules 1-7 are
    # decidable without it, so a stopped fleet must not burn an API call.
    conformance: Optional[ConformanceResult] = None
    if _scoring_could_matter(ctx, action):
        conformance = conformance_engine.evaluate(ctx.agent.mandate, action)

    decision = evaluate(action, ctx, conformance, rs)

    shadow_payload: Optional[dict[str, Any]] = None
    shadow = shadow_ruleset(session)
    if shadow is not None:
        shadow_decision = evaluate(action, ctx, conformance, shadow)
        shadow_payload = {
            "ruleset_hash": shadow.ruleset_hash,
            "policy_name": shadow.name,
            "verdict": shadow_decision.verdict.value,
            "reason_code": shadow_decision.reason_code.value,
            "winning_rule": shadow_decision.winning_rule,
            "differs": shadow_decision.verdict is not decision.verdict,
        }

    # The ledger write and the queryable projection go in ONE transaction, so
    # the two can never disagree about what was decided. If either fails, both
    # roll back and no verdict is returned.
    try:
        ledger_row = append_to_ledger(session, decision)
        session.add(
            _projection(decision, action, agent_row, card_member_id, seed_kind, seed_corpus)
        )
        session.flush()
    except Exception:
        session.rollback()
        logger.exception(
            "refusing to return a verdict for %s: the decision could not be recorded",
            action.action_id,
        )
        raise

    return decision, ledger_row, shadow_payload


def _scoring_could_matter(ctx: EvaluationContext, action: ActionRequest) -> bool:
    """False when a pre-scoring rule will certainly decide the outcome."""
    if ctx.fleet_stopped or ctx.agent.breaker_tripped or ctx.operator_revoked:
        return False
    if ctx.agent.status is not AgentStatus.ACTIVE:
        return False
    if ctx.agent.mandate.is_expired(ctx.now):
        return False
    root = ctx.chain[0] if ctx.chain else ctx.agent
    if ctx.agent.depth > root.mandate.max_delegation_depth:
        return False
    return True


def _projection(
    decision: Decision,
    action: ActionRequest,
    agent_row: AgentRow,
    card_member_id: Optional[str],
    seed_kind: Optional[str] = None,
    seed_corpus: Optional[str] = None,
) -> DecisionRow:
    from .seed.distribution import LEGITIMATE_KINDS
    conf = decision.conformance
    return DecisionRow(
        action_id=decision.action_id,
        agent_id=decision.agent_id,
        operator_id=agent_row.operator_id,
        card_member_id=card_member_id or agent_row.card_member_id,
        verdict=decision.verdict.value,
        reason_code=decision.reason_code.value,
        human_readable_reason=decision.human_readable_reason,
        winning_rule=decision.winning_rule,
        ruleset_hash=decision.ruleset_hash,
        flagged=decision.flagged,
        merchant_id=action.merchant_id,
        merchant_name=action.merchant_name,
        merchant_category=action.merchant_category,
        merchant_attributes=sorted(action.merchant_attributes),
        cart_items=to_json_primitives([i.to_canonical() for i in action.cart_items]),
        cart_digest=action.cart_digest,
        ship_to=action.ship_to,
        injected_instruction=action.injected_instruction,
        idempotency_key=action.idempotency_key,
        amount=action.amount,
        currency=action.currency,
        description=action.description,
        conformance_score=(
            None if conf is None or not conf.available else round(conf.score, 4)
        ),
        conformance_available=bool(conf and conf.available),
        conformance_rationale=(conf.rationale if conf else ""),
        model_version=(conf.model_version if conf else ""),
        prompt_hash=(conf.prompt_hash if conf else ""),
        delegation_chain=list(decision.delegation_chain),
        rules_fired=to_json_primitives([r.to_canonical() for r in decision.rules_fired]),
        features=to_json_primitives(decision.features),
        seed_kind=seed_kind,
        seed_legitimate=(None if seed_kind is None else seed_kind in LEGITIMATE_KINDS),
        seed_corpus=seed_corpus,
        step_up_state=("pending" if decision.verdict.value == "STEP_UP" else None),
        latency_ms=decision.latency_ms,
        decided_at=decision.decided_at,
    )


def append_to_ledger(session: Session, decision: Decision) -> LedgerEntry:
    """Append one decision, linked to the current head.

    The head is selected with a row lock so two concurrent decisions cannot
    read the same head and fork the chain. The Postgres trigger is a second
    line of defence; this is the first.
    """
    head = _lock_head(session)
    prev_hash = head.self_hash if head else GENESIS_HASH
    payload = to_json_primitives(decision.to_canonical())

    entry = LedgerEntry(
        record_id=str(uuid.uuid4()),
        action_id=decision.action_id,
        agent_id=decision.agent_id,
        payload=payload,
        prev_hash=prev_hash,
        self_hash=compute_self_hash(prev_hash, payload),
        recorded_at=utcnow(),
    )
    session.add(entry)
    session.flush()
    return entry


def _lock_head(session: Session) -> Optional[LedgerEntry]:
    stmt = select(LedgerEntry).order_by(LedgerEntry.sequence.desc()).limit(1)
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update()
    return session.scalars(stmt).first()


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


def _to_record(row: LedgerEntry) -> LedgerRecord:
    return LedgerRecord(
        sequence=row.sequence,
        record_id=row.record_id,
        action_id=row.action_id,
        agent_id=row.agent_id,
        payload=row.payload,
        prev_hash=row.prev_hash,
        self_hash=row.self_hash,
        recorded_at=_as_utc(row.recorded_at) or utcnow(),
    )


def verify_ledger(
    session: Session,
    from_sequence: Optional[int] = None,
    to_sequence: Optional[int] = None,
):
    stmt = select(LedgerEntry).order_by(LedgerEntry.sequence.asc())
    if from_sequence is not None:
        stmt = stmt.where(LedgerEntry.sequence >= from_sequence)
    if to_sequence is not None:
        stmt = stmt.where(LedgerEntry.sequence <= to_sequence)

    rows = list(session.scalars(stmt))
    records = [_to_record(r) for r in rows]

    # A partial range must chain onto whatever preceded it, not onto genesis.
    expected_start = GENESIS_HASH
    if records and records[0].sequence > 1:
        previous = session.scalars(
            select(LedgerEntry)
            .where(LedgerEntry.sequence < records[0].sequence)
            .order_by(LedgerEntry.sequence.desc())
            .limit(1)
        ).first()
        if previous is not None:
            expected_start = previous.self_hash

    return verify_records(records, expected_start_prev_hash=expected_start)


def create_checkpoint(session: Session) -> Optional[MerkleCheckpoint]:
    """Nightly anchor over everything since the last checkpoint."""
    last = session.scalars(
        select(MerkleCheckpoint).order_by(MerkleCheckpoint.to_sequence.desc()).limit(1)
    ).first()
    start = (last.to_sequence + 1) if last else 1

    rows = list(
        session.scalars(
            select(LedgerEntry)
            .where(LedgerEntry.sequence >= start)
            .order_by(LedgerEntry.sequence.asc())
        )
    )
    if not rows:
        return None

    checkpoint = MerkleCheckpoint(
        checkpoint_id=str(uuid.uuid4()),
        from_sequence=rows[0].sequence,
        to_sequence=rows[-1].sequence,
        merkle_root=merkle_root([r.self_hash for r in rows]),
        record_count=len(rows),
    )
    session.add(checkpoint)
    session.flush()
    return checkpoint


# ---------------------------------------------------------------------------
# Breakers
# ---------------------------------------------------------------------------


def observations_for(
    session: Session, agent_ids: Optional[Sequence[str]] = None, hours: int = 6
) -> list[breaker_mod.ObservedDecision]:
    since = utcnow() - timedelta(hours=hours)
    stmt = select(DecisionRow).where(DecisionRow.decided_at >= since)
    if agent_ids:
        stmt = stmt.where(DecisionRow.agent_id.in_(list(agent_ids)))

    out = []
    for row in session.scalars(stmt):
        out.append(
            breaker_mod.ObservedDecision(
                action_id=row.action_id,
                agent_id=row.agent_id,
                operator_id=row.operator_id,
                verdict=Verdict(row.verdict),
                conformance_score=(
                    float(row.conformance_score) if row.conformance_score is not None else None
                ),
                merchant_id=row.merchant_id,
                merchant_known=bool((row.features or {}).get("merchant_known", False)),
                amount=Decimal(str(row.amount)),
                decided_at=_as_utc(row.decided_at) or utcnow(),
            )
        )
    return out


def run_breakers(session: Session, agent_id: str, trip: bool = True) -> list[ComplianceEventRow]:
    """Evaluate breakers for one agent and persist any new events."""
    agent_row = session.get(AgentRow, agent_id)
    if agent_row is None:
        return []

    observations = observations_for(session, [agent_id])
    events = breaker_mod.evaluate_breakers(
        agent_id, agent_row.operator_id, observations, now=utcnow()
    )

    stored: list[ComplianceEventRow] = []
    for event in events:
        if session.get(ComplianceEventRow, event.event_id):
            continue
        row = ComplianceEventRow(
            event_id=event.event_id,
            breaker=event.breaker.value,
            agent_id=event.agent_id,
            operator_id=event.operator_id,
            severity=event.severity.value,
            title=event.title,
            detail=event.detail,
            evidence=to_json_primitives(event.evidence),
            suspected_prompt_injection=event.suspected_prompt_injection,
            created_at=event.created_at,
        )
        session.add(row)
        stored.append(row)

    if trip and events:
        agent_row.breaker_tripped = True

    session.flush()
    return stored


# ---------------------------------------------------------------------------
# Revocation
# ---------------------------------------------------------------------------


def revoke_agent(session: Session, agent_id: str) -> list[str]:
    """Revoke an agent and every descendant. Returns the affected IDs."""
    agents = load_agent_map(session)
    if agent_id not in agents:
        raise LookupError(f"unknown agent {agent_id}")

    affected = [agent_id] + [a.agent_id for a in descendants_of(agent_id, agents)]
    for aid in affected:
        row = session.get(AgentRow, aid)
        if row is not None:
            row.status = "revoked"
    session.flush()
    return affected


# ---------------------------------------------------------------------------
# Policy simulation over REAL history
# ---------------------------------------------------------------------------


# How restrictive each verdict is, for comparing a candidate against what is
# deployed. ALLOW lets the purchase through; STEP_UP asks a person, which is
# friction but not a refusal; DENY and HOLD stop it outright.
#
# Ordering these lets the simulator report movement in both directions. A
# change from DENY to STEP_UP is a genuine loosening -- the member now gets
# asked rather than refused -- and it is invisible to any comparison that only
# looks for ALLOW.
_VERDICT_SEVERITY = {"ALLOW": 0, "STEP_UP": 1, "HOLD": 2, "DENY": 3}


def simulate_policy(
    session: Session,
    candidate: Ruleset,
    limit: int = 5000,
) -> dict[str, Any]:
    """Replay recorded history under a candidate ruleset.

    Every number returned comes from re-evaluating decisions that actually
    happened, using their recorded conformance scores -- not from a model or an
    estimate. Rows whose score was never established are replayed as
    scorer-unavailable, so the fail-closed path is represented honestly.
    """
    rows = list(
        session.scalars(
            select(DecisionRow).order_by(DecisionRow.decided_at.desc()).limit(limit)
        )
    )
    agents = load_agent_map(session)
    deployed = active_ruleset(session)

    counts = {"before": {"ALLOW": 0, "DENY": 0, "STEP_UP": 0, "HOLD": 0},
              "after": {"ALLOW": 0, "DENY": 0, "STEP_UP": 0, "HOLD": 0}}
    exposure_before = Decimal("0")
    exposure_after = Decimal("0")
    newly_blocked: list[dict[str, Any]] = []
    newly_allowed: list[dict[str, Any]] = []

    for row in rows:
        agent = agents.get(row.agent_id)
        if agent is None:
            continue

        action = ActionRequest(
            action_id=row.action_id,
            agent_id=row.agent_id,
            merchant_id=row.merchant_id,
            merchant_name=row.merchant_name,
            merchant_category=row.merchant_category,
            amount=Decimal(str(row.amount)),
            currency=row.currency,
            description=row.description or "",
            merchant_attributes=frozenset(row.merchant_attributes or ()),
            requested_at=_as_utc(row.decided_at) or utcnow(),
        )

        features = row.features or {}
        ctx = EvaluationContext(
            agent=agent,
            chain=build_chain(row.agent_id, agents) or (agent,),
            fleet_stopped=False,
            operator_revoked=False,
            velocity=VelocityWindow(
                transactions_today=int(features.get("transactions_today", 0) or 0),
                amount_today=Decimal(str(features.get("amount_today", 0) or 0)),
            ),
            known_merchants=(
                frozenset({row.merchant_id}) if features.get("merchant_known") else frozenset()
            ),
            now=_as_utc(row.decided_at) or utcnow(),
        )

        conformance = (
            ConformanceResult(
                score=float(row.conformance_score),
                rationale=row.conformance_rationale or "",
                model_version=row.model_version or "",
                prompt_hash=row.prompt_hash or "",
            )
            if row.conformance_available and row.conformance_score is not None
            else ConformanceResult.unavailable("not scored at decision time")
        )

        before = evaluate(action, ctx, conformance, deployed)
        after = evaluate(action, ctx, conformance, candidate)

        counts["before"][before.verdict.value] += 1
        counts["after"][after.verdict.value] += 1
        if before.verdict.value == "ALLOW":
            exposure_before += action.amount
        if after.verdict.value == "ALLOW":
            exposure_after += action.amount

        # Classify by whether the outcome got HARDER or SOFTER, not by whether
        # it became exactly ALLOW.
        #
        # Comparing against ALLOW alone missed the most common useful change a
        # policy makes. Relaxing the deny floor turns a flat refusal into a
        # step-up -- the member is asked instead of refused -- and the old
        # comparison recorded that as no change whatsoever, so a candidate that
        # cleared four confirmed false blocks reported a blast radius of zero.
        # Ranking the verdicts makes both directions visible.
        before_rank = _VERDICT_SEVERITY.get(before.verdict.value, 0)
        after_rank = _VERDICT_SEVERITY.get(after.verdict.value, 0)
        if after_rank > before_rank:
            newly_blocked.append(_delta_row(row, before, after))
        elif after_rank < before_rank:
            newly_allowed.append(_delta_row(row, before, after))

    return {
        "candidate_ruleset_hash": candidate.ruleset_hash,
        "deployed_ruleset_hash": deployed.ruleset_hash,
        "replayed_count": len(rows),
        "counts": counts,
        "exposure_before": str(exposure_before),
        "exposure_after": str(exposure_after),
        "exposure_delta": str(exposure_after - exposure_before),
        "newly_blocked_count": len(newly_blocked),
        "newly_allowed_count": len(newly_allowed),
        "newly_blocked": newly_blocked[:100],
        "newly_allowed": newly_allowed[:100],
        "impact": _impact_summary(newly_blocked, newly_allowed),
    }


def _impact_summary(
    newly_blocked: list[dict[str, Any]], newly_allowed: list[dict[str, Any]]
) -> dict[str, Any]:
    """Whether a candidate policy trades in the right direction.

    Two counts -- how many more get blocked, how many more get through -- do
    not say whether a change is an improvement. The question is which KIND of
    traffic moves: blocking fraud is the point, blocking a member's real
    groceries is the cost, and letting known-bad traffic through is a
    regression however good the totals look.

    Computed over the full lists rather than the truncated preview, so the
    summary describes the whole replay even when the tables show the first 100.
    """

    def tally(rows: list[dict[str, Any]]) -> dict[str, int]:
        out = {
            "catches_bad_traffic": 0,
            "harms_good_traffic": 0,
            "disputed_unreviewed": 0,
            "unknown": 0,
        }
        for row in rows:
            out[row["judgement"]] = out.get(row["judgement"], 0) + 1
        return out

    blocked = tally(newly_blocked)
    allowed = tally(newly_allowed)

    # Blocks the member already disputed AND an operator upheld. A candidate
    # that clears these is fixing known mistakes, which is the strongest
    # argument any policy change can have.
    false_blocks_resolved = sum(
        1
        for row in newly_allowed
        if row["block_report"] == "wrong" and row["block_report_confirmed"] is True
    )
    disputes_resolved = sum(1 for row in newly_allowed if row["block_report"] == "wrong")

    return {
        "newly_blocked_by_judgement": blocked,
        "newly_allowed_by_judgement": allowed,
        # The trade, stated plainly.
        "bad_traffic_newly_caught": blocked["catches_bad_traffic"],
        "good_traffic_newly_harmed": blocked["harms_good_traffic"],
        "bad_traffic_newly_released": allowed["catches_bad_traffic"],
        "good_traffic_newly_released": allowed["harms_good_traffic"],
        "false_blocks_resolved": false_blocks_resolved,
        "disputes_resolved": disputes_resolved,
        "unlabelled": blocked["unknown"] + allowed["unknown"],
    }


def _delta_row(row: DecisionRow, before: Decision, after: Decision) -> dict[str, Any]:
    """One changed decision, with enough context to judge whether the change is good.

    A count of what a policy would newly block is not reviewable on its own:
    blocking fraud and blocking a card member's legitimate groceries both
    increment the same number. So every changed row carries whatever evidence
    exists about whether the purchase was actually wanted:

      * `legitimate` -- the seed's ground-truth label, exact but only present
        for generated traffic.
      * `block_report` / `block_report_confirmed` -- what a member said about
        the original block and whether an operator upheld it. The only honest
        signal for real traffic, and it deliberately takes two people.

    `judgement` folds those into the single question a reviewer is actually
    asking: would this change stop something that should be stopped, or stop
    something a person already told us they wanted? Rows with no evidence are
    "unknown" rather than assumed good -- that distinction is the difference
    between a review and a rubber stamp.
    """
    legitimate = row.seed_legitimate
    reported = row.block_report == "wrong"
    confirmed = row.block_report_confirmed

    if legitimate is True:
        judgement = "harms_good_traffic"
    elif legitimate is False:
        judgement = "catches_bad_traffic"
    elif reported and confirmed is True:
        judgement = "harms_good_traffic"
    elif reported and confirmed is None:
        judgement = "disputed_unreviewed"
    else:
        judgement = "unknown"

    return {
        "action_id": row.action_id,
        "agent_id": row.agent_id,
        "merchant_name": row.merchant_name,
        "merchant_category": row.merchant_category,
        "amount": str(row.amount),
        "conformance_score": (
            float(row.conformance_score) if row.conformance_score is not None else None
        ),
        "decided_at": (_as_utc(row.decided_at) or utcnow()).isoformat(),
        "before_verdict": before.verdict.value,
        "after_verdict": after.verdict.value,
        "after_reason_code": after.reason_code.value,
        "after_rule": after.winning_rule,
        # Why the original decision went the way it did, so a reviewer can see
        # which rule they are about to override.
        "before_reason_code": before.reason_code.value,
        "before_rule": before.winning_rule,
        "description": row.description or "",
        # Evidence about whether this purchase was actually wanted.
        "legitimate": legitimate,
        "block_report": row.block_report,
        "block_report_confirmed": confirmed,
        "judgement": judgement,
    }
