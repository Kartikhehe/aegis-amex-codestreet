"""Persistence: chaining through the DB, and enforced ledger immutability.

The immutability tests here are the important ones. They attack the ledger the
way an attacker would -- through the ORM, and then through raw SQL when the ORM
refuses -- and assert that both are stopped by the database rather than by
application politeness.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import sessionmaker

from aegis.db.immutability import (
    LedgerImmutabilityError,
    install_orm_guards,
    install_sqlite_triggers,
)
from aegis.db.models import AgentRow, Base, DecisionRow, FleetState, LedgerEntry, Operator
from aegis.engine.conformance import ConformanceEngine, InMemoryCache, ReplayScorer, cache_key
from aegis.engine.policy import PolicyThresholds, Ruleset
from aegis.engine.types import ActionRequest, utcnow
from aegis.service import (
    create_checkpoint,
    decide,
    revoke_agent,
    simulate_policy,
    stop_fleet,
    rearm_fleet,
    verify_ledger,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    install_orm_guards()
    install_sqlite_triggers(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    session = factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def seeded(db, pantry_mandate):
    db.add(Operator(operator_id="op_homerun", name="HomeRun Logistics", revoked=False))
    db.add(
        AgentRow(
            agent_id="ag_pantry",
            operator_id="op_homerun",
            card_member_id="cm_1",
            name="Pantry agent",
            parent_agent_id=None,
            depth=0,
            status="active",
            purpose=pantry_mandate.purpose,
            permitted_categories=sorted(pantry_mandate.permitted_categories),
            prohibited_attributes=sorted(pantry_mandate.prohibited_attributes),
            permitted_merchants=None,
            per_transaction_ceiling=Decimal("5000"),
            daily_ceiling=Decimal("12000"),
            max_transactions_per_day=6,
            max_delegation_depth=2,
            mandate_expires_at=pantry_mandate.expires_at,
            mandate_hash=pantry_mandate.mandate_hash,
        )
    )
    db.commit()
    return db


@pytest.fixture
def engine_for(pantry_mandate, legit_grocery_action, trap_giftcard_action):
    return ConformanceEngine(
        scorer=ReplayScorer(
            fixture={
                cache_key(pantry_mandate, legit_grocery_action): {
                    "score": 0.96,
                    "rationale": "Staple groceries.",
                    "vetoes": [],
                    "model_version": "gpt-4.1-mini-2025-04-14",
                },
                cache_key(pantry_mandate, trap_giftcard_action): {
                    "score": 0.04,
                    "rationale": "Stored-value instrument.",
                    "vetoes": ["gift_card"],
                    "model_version": "gpt-4.1-mini-2025-04-14",
                },
            }
        ),
        cache=InMemoryCache(),
    )


# ---------------------------------------------------------------------------
# The decision path writes both the ledger and the projection
# ---------------------------------------------------------------------------


def test_decide_writes_ledger_and_projection(seeded, engine_for, legit_grocery_action):
    decision, entry, shadow = decide(seeded, legit_grocery_action, engine_for)
    seeded.commit()

    assert entry.prev_hash == "0" * 64
    assert entry.self_hash and len(entry.self_hash) == 64
    assert shadow is None  # no shadow policy configured

    row = seeded.get(DecisionRow, legit_grocery_action.action_id)
    assert row is not None
    assert row.verdict == decision.verdict.value
    assert row.operator_id == "op_homerun"
    assert row.card_member_id == "cm_1"


def test_consecutive_decisions_form_a_verifiable_chain(seeded, engine_for, legit_grocery_action):
    for i in range(6):
        action = ActionRequest(
            action_id=f"act_{i}",
            agent_id="ag_pantry",
            merchant_id=legit_grocery_action.merchant_id,
            merchant_name=legit_grocery_action.merchant_name,
            merchant_category=legit_grocery_action.merchant_category,
            amount=legit_grocery_action.amount,
            description=legit_grocery_action.description,
        )
        decide(seeded, action, engine_for)
    seeded.commit()

    result = verify_ledger(seeded)
    assert result.ok is True
    assert result.records_checked == 6


def test_ledger_payload_is_plain_json(seeded, engine_for, legit_grocery_action):
    """An auditor must be able to re-hash the stored row with a JSON parser."""
    import json

    _, entry, _ = decide(seeded, legit_grocery_action, engine_for)
    seeded.commit()
    round_tripped = json.loads(json.dumps(entry.payload))
    assert round_tripped == entry.payload


def test_scoring_is_skipped_when_a_pre_scoring_rule_decides(seeded, engine_for,
                                                            legit_grocery_action):
    """A stopped fleet must not burn an API call."""
    stop_fleet(seeded, "operator@aegis.test", "drill")
    seeded.commit()

    calls = {"n": 0}
    original = engine_for.evaluate

    def counting(mandate, action):
        calls["n"] += 1
        return original(mandate, action)

    engine_for.evaluate = counting
    decision, _, _ = decide(seeded, legit_grocery_action, engine_for)
    seeded.commit()

    assert decision.verdict.value == "DENY"
    assert decision.reason_code.value == "fleet_emergency_stop"
    assert calls["n"] == 0


# ---------------------------------------------------------------------------
# LEDGER IMMUTABILITY -- enforced, not requested
# ---------------------------------------------------------------------------


def test_orm_refuses_to_update_a_ledger_row(seeded, engine_for, legit_grocery_action):
    _, entry, _ = decide(seeded, legit_grocery_action, engine_for)
    seeded.commit()

    entry.payload = {"verdict": "ALLOW", "tampered": True}
    with pytest.raises(LedgerImmutabilityError):
        seeded.commit()
    seeded.rollback()


def test_orm_refuses_to_delete_a_ledger_row(seeded, engine_for, legit_grocery_action):
    _, entry, _ = decide(seeded, legit_grocery_action, engine_for)
    seeded.commit()

    seeded.delete(entry)
    with pytest.raises(LedgerImmutabilityError):
        seeded.commit()
    seeded.rollback()


def test_raw_sql_update_is_refused_by_the_database(seeded, engine_for, legit_grocery_action):
    """Bypassing the ORM must not bypass the guarantee."""
    _, entry, _ = decide(seeded, legit_grocery_action, engine_for)
    seeded.commit()

    with pytest.raises(DatabaseError):
        seeded.execute(
            text("UPDATE ledger SET payload = :p WHERE record_id = :r"),
            {"p": '{"verdict":"ALLOW"}', "r": entry.record_id},
        )
    seeded.rollback()


def test_raw_sql_delete_is_refused_by_the_database(seeded, engine_for, legit_grocery_action):
    _, entry, _ = decide(seeded, legit_grocery_action, engine_for)
    seeded.commit()

    with pytest.raises(DatabaseError):
        seeded.execute(
            text("DELETE FROM ledger WHERE record_id = :r"), {"r": entry.record_id}
        )
    seeded.rollback()


def test_a_forked_chain_insert_is_refused(seeded, engine_for, legit_grocery_action):
    """Two records claiming the same predecessor would fork history."""
    _, entry, _ = decide(seeded, legit_grocery_action, engine_for)
    seeded.commit()

    with pytest.raises(DatabaseError):
        seeded.execute(
            text(
                "INSERT INTO ledger (record_id, action_id, agent_id, payload, "
                "prev_hash, self_hash, recorded_at) VALUES "
                "(:rid, :aid, :agid, :p, :prev, :self, :ts)"
            ),
            {
                "rid": "forged",
                "aid": "act_forged",
                "agid": "ag_pantry",
                "p": "{}",
                "prev": entry.prev_hash,  # links to the SAME predecessor
                "self": "f" * 64,
                "ts": utcnow(),
            },
        )
    seeded.rollback()


# ---------------------------------------------------------------------------
# Revocation, fleet state, checkpoints
# ---------------------------------------------------------------------------


def test_revoke_cascades_through_the_database(seeded, pantry_mandate):
    seeded.add(
        AgentRow(
            agent_id="ag_child",
            operator_id="op_homerun",
            name="Produce agent",
            parent_agent_id="ag_pantry",
            depth=1,
            status="active",
            purpose="produce",
            permitted_categories=["5411"],
            prohibited_attributes=sorted(pantry_mandate.prohibited_attributes),
            per_transaction_ceiling=Decimal("1000"),
            daily_ceiling=Decimal("2000"),
            max_transactions_per_day=2,
            max_delegation_depth=1,
            mandate_hash="x" * 64,
        )
    )
    seeded.commit()

    affected = revoke_agent(seeded, "ag_pantry")
    seeded.commit()

    assert set(affected) == {"ag_pantry", "ag_child"}
    assert seeded.get(AgentRow, "ag_child").status == "revoked"


def test_rearm_requires_two_distinct_approvals(seeded):
    stop_fleet(seeded, "alice@aegis.test", "incident")
    seeded.commit()
    assert seeded.get(FleetState, 1).stopped is True

    state, done = rearm_fleet(seeded, "alice@aegis.test")
    assert done is False and state.stopped is True

    # The same person approving twice must not count twice.
    state, done = rearm_fleet(seeded, "alice@aegis.test")
    assert done is False and state.stopped is True

    state, done = rearm_fleet(seeded, "bob@aegis.test")
    assert done is True and state.stopped is False


def test_checkpoint_covers_new_records_only(seeded, engine_for, legit_grocery_action):
    for i in range(4):
        decide(
            seeded,
            ActionRequest(
                action_id=f"a_{i}",
                agent_id="ag_pantry",
                merchant_id="mch_freshmart",
                merchant_name="FreshMart Daily Grocers",
                merchant_category="5411",
                amount=Decimal("500"),
            ),
            engine_for,
        )
    seeded.commit()

    first = create_checkpoint(seeded)
    seeded.commit()
    assert first.record_count == 4
    assert first.from_sequence == 1 and first.to_sequence == 4

    assert create_checkpoint(seeded) is None  # nothing new

    decide(
        seeded,
        ActionRequest(
            action_id="a_5",
            agent_id="ag_pantry",
            merchant_id="mch_freshmart",
            merchant_name="FreshMart Daily Grocers",
            merchant_category="5411",
            amount=Decimal("500"),
        ),
        engine_for,
    )
    seeded.commit()
    second = create_checkpoint(seeded)
    assert second.from_sequence == 5 and second.record_count == 1


# ---------------------------------------------------------------------------
# Blast radius over real stored history
# ---------------------------------------------------------------------------


def test_simulate_policy_uses_real_stored_history(seeded, engine_for):
    """Write real decisions, then replay them under a tightened policy."""
    scores = [0.98, 0.90, 0.84, 0.78, 0.73, 0.66, 0.50, 0.30]
    now = utcnow()
    for i, score in enumerate(scores):
        seeded.add(
            DecisionRow(
                action_id=f"hist_{i}",
                agent_id="ag_pantry",
                operator_id="op_homerun",
                card_member_id="cm_1",
                verdict="ALLOW" if score >= 0.70 else ("STEP_UP" if score >= 0.45 else "DENY"),
                reason_code="within_mandate",
                human_readable_reason="x",
                winning_rule="allow",
                ruleset_hash="0" * 64,
                merchant_id="mch_freshmart",
                merchant_name="FreshMart Daily Grocers",
                merchant_category="5411",
                merchant_attributes=[],
                amount=Decimal("1000"),
                conformance_score=score,
                conformance_available=True,
                features={"merchant_known": True, "transactions_today": 0, "amount_today": 0},
                decided_at=now - timedelta(minutes=i),
            )
        )
    seeded.commit()

    candidate = Ruleset(PolicyThresholds(conformance_review_floor=0.85), "tightened", 2)
    result = simulate_policy(seeded, candidate)

    assert result["replayed_count"] == 8
    assert result["newly_blocked_count"] == 3  # 0.84, 0.78, 0.73
    assert Decimal(result["exposure_after"]) < Decimal(result["exposure_before"])
    assert {r["action_id"] for r in result["newly_blocked"]} == {"hist_2", "hist_3", "hist_4"}
    for row in result["newly_blocked"]:
        assert row["before_verdict"] == "ALLOW"
        assert row["after_verdict"] == "STEP_UP"


# ---------------------------------------------------------------------------
# Fail closed on storage (reference spec §12)
#
# "Database unreachable -> refuse to decide (a decision you can't record is a
# decision you can't defend)."
# ---------------------------------------------------------------------------


def test_a_decision_that_cannot_be_recorded_is_not_returned(seeded, engine_for,
                                                            legit_grocery_action):
    """If the ledger write fails, no verdict may be returned.

    Returning one would authorise spending with no evidence it was ever
    authorised -- strictly worse than refusing, because the failure would be
    invisible afterwards.
    """
    from unittest.mock import patch

    before_ledger = seeded.scalar(select(func.count(LedgerEntry.sequence)))
    before_decisions = seeded.scalar(select(func.count(DecisionRow.action_id)))

    with patch("aegis.service.append_to_ledger", side_effect=RuntimeError("disk full")):
        with pytest.raises(RuntimeError):
            decide(seeded, legit_grocery_action, engine_for)

    # Nothing was written, and nothing was half-written.
    assert seeded.scalar(select(func.count(LedgerEntry.sequence))) == before_ledger
    assert seeded.scalar(select(func.count(DecisionRow.action_id))) == before_decisions


def test_the_ledger_and_the_projection_are_written_atomically(seeded, engine_for,
                                                              legit_grocery_action):
    """The two must never disagree about what was decided."""
    from unittest.mock import patch

    before_ledger = seeded.scalar(select(func.count(LedgerEntry.sequence)))

    # Fail AFTER the ledger append, while writing the queryable projection.
    with patch("aegis.service._projection", side_effect=RuntimeError("projection failed")):
        with pytest.raises(RuntimeError):
            decide(seeded, legit_grocery_action, engine_for)

    seeded.rollback()
    assert seeded.scalar(select(func.count(LedgerEntry.sequence))) == before_ledger
