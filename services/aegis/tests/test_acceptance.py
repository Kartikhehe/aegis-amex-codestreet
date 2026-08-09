"""The acceptance criteria from the brief.

Each test here maps 1:1 to a line in the "NOT DONE until" list. These are the
tests that decide whether the platform works, so they assert on behaviour a
reviewer would check by hand, not on internals.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from decimal import Decimal

import pytest

from aegis.engine.conformance import ConformanceEngine, InMemoryCache, UnavailableScorer
from aegis.engine.delegation import apply_revocation, can_issue, revoke_cascade
from aegis.engine.ledger import (
    GENESIS_HASH,
    LedgerRecord,
    build_record,
    verify_records,
)
from aegis.engine.policy import DEFAULT_RULESET, Ruleset, evaluate
from aegis.engine.types import (
    ActionRequest,
    Agent,
    AgentStatus,
    ConformanceResult,
    EvaluationContext,
    Mandate,
    ReasonCode,
    Verdict,
)


# ---------------------------------------------------------------------------
# 1. gift-card -> DENY, score < 0.15, with a member-readable reason
# ---------------------------------------------------------------------------


def test_giftcard_trap_denied_with_low_score_and_member_readable_reason(
    pantry_mandate, context, replay_engine, trap_giftcard_action, legit_grocery_action
):
    conformance = replay_engine.evaluate(pantry_mandate, trap_giftcard_action)
    decision = evaluate(trap_giftcard_action, context, conformance)

    assert decision.verdict is Verdict.DENY
    assert conformance.score < 0.15

    reason = decision.human_readable_reason
    # Written for a card member: no jargon, no rule names, no raw scores.
    assert "gift card" in reason.lower()
    assert "₹4,980" in reason
    assert "Nothing was charged" in reason
    for jargon in ("conformance", "mandate_hash", "ruleset", "veto", "0.04", "MCC", "5411"):
        assert jargon not in reason, f"member reason leaks jargon: {jargon!r}"

    # And the legitimate merchant at the SAME MCC is allowed -- proving the
    # control keys on what is sold, not on the category code.
    legit_conf = replay_engine.evaluate(pantry_mandate, legit_grocery_action)
    legit = evaluate(legit_grocery_action, context, legit_conf)
    assert legit_grocery_action.merchant_category == trap_giftcard_action.merchant_category
    assert legit.verdict is Verdict.ALLOW


def test_prohibited_veto_is_decided_without_the_model(pantry_mandate, context, trap_giftcard_action):
    """The veto must hold even with the scorer completely down."""
    engine = ConformanceEngine(scorer=UnavailableScorer(), cache=InMemoryCache())
    conformance = engine.evaluate(pantry_mandate, trap_giftcard_action)

    assert conformance.available is True
    assert conformance.model_version == "deterministic"
    assert "gift_card" in conformance.vetoes

    decision = evaluate(trap_giftcard_action, context, conformance)
    assert decision.verdict is Verdict.DENY
    assert decision.reason_code is ReasonCode.PROHIBITED_ATTRIBUTE_VETO


# ---------------------------------------------------------------------------
# 2. sub-agent above parent ceiling rejected AT ISSUANCE
# ---------------------------------------------------------------------------


def test_subagent_above_parent_ceiling_rejected_at_issuance(pantry_mandate):
    requested = Mandate(
        purpose="fresh produce top-ups",
        permitted_categories=frozenset({"5411"}),
        prohibited_attributes=frozenset({"gift_card", "cash_equivalent", "crypto"}),
        per_transaction_ceiling=Decimal("8000"),  # parent is 5000
        daily_ceiling=Decimal("9000"),
        max_transactions_per_day=3,
        max_delegation_depth=1,
        expires_at=pantry_mandate.expires_at,
    )

    check = can_issue(pantry_mandate, requested)

    assert check.allowed is False
    assert not check
    dims = {v.dimension for v in check.violations}
    assert "per_transaction_ceiling" in dims

    violation = next(v for v in check.violations if v.dimension == "per_transaction_ceiling")
    assert violation.parent_value == "5000"
    assert violation.requested_value == "8000"


def test_valid_narrowing_is_accepted(pantry_mandate):
    requested = Mandate(
        purpose="fresh produce top-ups",
        permitted_categories=frozenset({"5411"}),
        prohibited_attributes=frozenset({"gift_card", "cash_equivalent", "crypto"}),
        per_transaction_ceiling=Decimal("1500"),
        daily_ceiling=Decimal("3000"),
        max_transactions_per_day=2,
        max_delegation_depth=1,
        expires_at=pantry_mandate.expires_at,
    )
    assert can_issue(pantry_mandate, requested).allowed is True


def test_child_may_not_drop_an_inherited_prohibition(pantry_mandate):
    """Negative authority only ever accumulates."""
    requested = Mandate(
        purpose="fresh produce top-ups",
        permitted_categories=frozenset({"5411"}),
        prohibited_attributes=frozenset({"gift_card"}),  # dropped two
        per_transaction_ceiling=Decimal("1000"),
        daily_ceiling=Decimal("2000"),
        max_transactions_per_day=2,
        max_delegation_depth=1,
        expires_at=pantry_mandate.expires_at,
    )
    check = can_issue(pantry_mandate, requested)
    assert check.allowed is False
    assert "prohibited_attributes" in {v.dimension for v in check.violations}


# ---------------------------------------------------------------------------
# 3. /verify passes clean, fails and NAMES THE ROW after tamper
# ---------------------------------------------------------------------------


def _chain(context, good_score, count=12):
    records = []
    prev = GENESIS_HASH
    for i in range(count):
        action = ActionRequest(
            action_id=f"act_{i:04d}",
            agent_id="ag_pantry",
            merchant_id="mch_freshmart",
            merchant_name="FreshMart Daily Grocers",
            merchant_category="5411",
            amount=Decimal("900"),
            requested_at=context.now,
        )
        decision = evaluate(action, context, good_score)
        record = build_record(i + 1, f"rec_{i:04d}", decision, prev)
        records.append(record)
        prev = record.self_hash
    return records


def test_verify_passes_on_a_clean_chain(context, good_score):
    result = verify_records(_chain(context, good_score))
    assert result.ok is True
    assert result.records_checked == 12
    assert result.first_broken_link is None


def test_verify_fails_and_names_the_row_after_tamper(context, good_score):
    records = _chain(context, good_score)

    # Flip a DENY to an ALLOW in place -- the classic cover-up.
    target = records[6]
    forged = dict(target.payload)
    forged["verdict"] = "ALLOW"
    forged["human_readable_reason"] = "Everything was fine."
    records[6] = replace(target, payload=forged)

    result = verify_records(records)

    assert result.ok is False
    link = result.first_broken_link
    assert link is not None
    assert link.sequence == 7
    assert link.record_id == "rec_0006"
    assert link.failure == "self_hash_mismatch"
    assert link.expected_hash != link.actual_hash
    # Verification stops AT the break, not after scanning everything.
    assert result.records_checked == 7


def test_verify_detects_a_deleted_record(context, good_score):
    records = _chain(context, good_score)
    del records[4]
    result = verify_records(records)
    assert result.ok is False
    assert result.first_broken_link.failure == "prev_hash_mismatch"


# ---------------------------------------------------------------------------
# 4. revoke parent cascades to every descendant
# ---------------------------------------------------------------------------


def _tree(pantry_mandate):
    child_mandate = Mandate(
        purpose="produce top-ups",
        permitted_categories=frozenset({"5411"}),
        prohibited_attributes=pantry_mandate.prohibited_attributes,
        per_transaction_ceiling=Decimal("1200"),
        daily_ceiling=Decimal("2400"),
        max_transactions_per_day=2,
        max_delegation_depth=1,
        expires_at=pantry_mandate.expires_at,
    )
    root = Agent("ag_root", "op_homerun", "Household agent", pantry_mandate, None, 0)
    child = Agent("ag_child", "op_homerun", "Produce agent", child_mandate, "ag_root", 1)
    grandchild = Agent("ag_grand", "op_homerun", "Herbs agent", child_mandate, "ag_child", 2)
    sibling = Agent("ag_sibling", "op_homerun", "Dairy agent", child_mandate, "ag_root", 1)
    unrelated = Agent("ag_other", "op_other", "Fuel agent", pantry_mandate, None, 0)
    return {a.agent_id: a for a in (root, child, grandchild, sibling, unrelated)}


def test_revoking_a_parent_cascades_to_all_descendants(pantry_mandate):
    agents = _tree(pantry_mandate)

    cascade = revoke_cascade("ag_root", agents)
    assert set(cascade) == {"ag_root", "ag_child", "ag_grand", "ag_sibling"}
    assert "ag_other" not in cascade

    updated = apply_revocation("ag_root", agents)
    for agent_id in cascade:
        assert updated[agent_id].status is AgentStatus.REVOKED
    assert updated["ag_other"].status is AgentStatus.ACTIVE


def test_a_revoked_agent_is_denied_at_spend_time(pantry_mandate, now):
    agents = apply_revocation("ag_root", _tree(pantry_mandate))
    grandchild = agents["ag_grand"]
    ctx = EvaluationContext(
        agent=grandchild,
        chain=(agents["ag_root"], agents["ag_child"], grandchild),
        known_merchants=frozenset({"mch_freshmart"}),
        now=now,
    )
    action = ActionRequest(
        action_id="act_after_revoke",
        agent_id="ag_grand",
        merchant_id="mch_freshmart",
        merchant_name="FreshMart Daily Grocers",
        merchant_category="5411",
        amount=Decimal("300"),
        requested_at=now,
    )
    decision = evaluate(action, ctx, ConformanceResult(score=0.95, rationale="fine"))
    assert decision.verdict is Verdict.DENY
    assert decision.reason_code is ReasonCode.AGENT_INACTIVE


# ---------------------------------------------------------------------------
# 5. scorer timeout -> STEP_UP, NEVER ALLOW
# ---------------------------------------------------------------------------


def test_scorer_timeout_yields_step_up_never_allow(pantry_mandate, context, legit_grocery_action):
    engine = ConformanceEngine(
        scorer=UnavailableScorer(reason="Timeout: no response in 4000ms"),
        cache=InMemoryCache(),
    )
    conformance = engine.evaluate(pantry_mandate, legit_grocery_action)
    assert conformance.available is False

    decision = evaluate(legit_grocery_action, context, conformance)

    assert decision.verdict is Verdict.STEP_UP
    assert decision.reason_code is ReasonCode.SCORER_UNAVAILABLE_FAIL_CLOSED
    assert decision.verdict is not Verdict.ALLOW

    # The scoring rules were skipped, not silently passed.
    skipped = {r.rule_name for r in decision.rules_fired if r.skipped}
    assert {"conformance_deny_floor", "conformance_review_floor"} <= skipped


def test_scorer_failure_never_allows_under_any_input(pantry_mandate, context):
    """Property check: sweep the inputs, assert ALLOW is unreachable."""
    engine = ConformanceEngine(scorer=UnavailableScorer(), cache=InMemoryCache())
    for amount in ("1", "100", "4999", "5000"):
        for merchant_id in ("mch_freshmart", "mch_unknown"):
            action = ActionRequest(
                action_id=f"act_{amount}_{merchant_id}",
                agent_id="ag_pantry",
                merchant_id=merchant_id,
                merchant_name="FreshMart Daily Grocers",
                merchant_category="5411",
                amount=Decimal(amount),
                requested_at=context.now,
            )
            decision = evaluate(action, context, engine.evaluate(pantry_mandate, action))
            assert decision.verdict is not Verdict.ALLOW, (
                f"FAIL-CLOSED VIOLATED for {amount} at {merchant_id}"
            )


def test_no_conformance_at_all_also_fails_closed(context, legit_grocery_action):
    decision = evaluate(legit_grocery_action, context, None)
    assert decision.verdict is Verdict.STEP_UP
    assert decision.reason_code is ReasonCode.SCORER_UNAVAILABLE_FAIL_CLOSED


# ---------------------------------------------------------------------------
# 6. fleet stop -> everything DENY / fleet_emergency_stop
# ---------------------------------------------------------------------------


def test_fleet_stop_denies_everything(pantry_agent, good_score, now):
    stopped = EvaluationContext(
        agent=pantry_agent,
        chain=(pantry_agent,),
        known_merchants=frozenset({"mch_freshmart"}),
        fleet_stopped=True,
        now=now,
    )
    for amount in ("1", "500", "4999"):
        action = ActionRequest(
            action_id=f"act_{amount}",
            agent_id="ag_pantry",
            merchant_id="mch_freshmart",
            merchant_name="FreshMart Daily Grocers",
            merchant_category="5411",
            amount=Decimal(amount),
            requested_at=now,
        )
        decision = evaluate(action, stopped, good_score)
        assert decision.verdict is Verdict.DENY
        assert decision.reason_code is ReasonCode.FLEET_EMERGENCY_STOP
        assert decision.winning_rule == "fleet_stop"


def test_fleet_stop_outranks_every_other_rule(pantry_agent, now):
    """Even a perfectly conformant purchase stops. The button means stop."""
    ctx = EvaluationContext(
        agent=pantry_agent,
        chain=(pantry_agent,),
        known_merchants=frozenset({"mch_freshmart"}),
        fleet_stopped=True,
        now=now,
    )
    action = ActionRequest(
        action_id="act_perfect",
        agent_id="ag_pantry",
        merchant_id="mch_freshmart",
        merchant_name="FreshMart Daily Grocers",
        merchant_category="5411",
        amount=Decimal("100"),
        requested_at=now,
    )
    decision = evaluate(action, ctx, ConformanceResult(score=1.0, rationale="perfect"))
    assert decision.verdict is Verdict.DENY
    assert decision.reason_code is ReasonCode.FLEET_EMERGENCY_STOP


# ---------------------------------------------------------------------------
# 7. a policy edit changes blast-radius numbers computed from REAL history
# ---------------------------------------------------------------------------


def test_policy_edit_changes_blast_radius_over_real_history(context, pantry_mandate):
    """Replay a real decision history under two rulesets and compare.

    This is the mechanism behind Policy Studio: the numbers come from replaying
    actual recorded actions, not from an estimate.
    """
    from aegis.engine.policy import PolicyThresholds

    # A spread of real conformance scores across the thresholds.
    scores = [0.98, 0.91, 0.88, 0.83, 0.79, 0.72, 0.68, 0.61, 0.52, 0.44, 0.31, 0.12]
    history = []
    for i, score in enumerate(scores):
        action = ActionRequest(
            action_id=f"hist_{i:03d}",
            agent_id="ag_pantry",
            merchant_id="mch_freshmart",
            merchant_name="FreshMart Daily Grocers",
            merchant_category="5411",
            amount=Decimal("1200"),
            requested_at=context.now,
        )
        history.append((action, ConformanceResult(score=score, rationale="replayed")))

    deployed = DEFAULT_RULESET
    candidate = Ruleset(
        thresholds=PolicyThresholds(
            conformance_deny_floor=0.45,
            conformance_review_floor=0.85,  # tightened from 0.70
        ),
        name="tightened",
        version=2,
    )
    assert candidate.ruleset_hash != deployed.ruleset_hash

    def replay(ruleset):
        out = {"ALLOW": 0, "STEP_UP": 0, "DENY": 0, "exposure": Decimal("0")}
        for action, conformance in history:
            d = evaluate(action, context, conformance, ruleset)
            out[d.verdict.value] += 1
            if d.verdict is Verdict.ALLOW:
                out["exposure"] += action.amount
        return out

    before = replay(deployed)
    after = replay(candidate)

    # Tightening the review floor moves real transactions from ALLOW to STEP_UP.
    assert after["ALLOW"] < before["ALLOW"]
    assert after["STEP_UP"] > before["STEP_UP"]
    assert after["exposure"] < before["exposure"]

    # Raising the review floor 0.70 -> 0.85 moves exactly the rows scoring in
    # [0.70, 0.85): 0.83, 0.79 and 0.72. The row at 0.68 was already STEP_UP
    # under the deployed floor, so it does not move.
    newly_blocked = before["ALLOW"] - after["ALLOW"]
    assert newly_blocked == 3
    assert before["ALLOW"] == 6 and after["ALLOW"] == 3
    assert after["exposure"] == before["exposure"] - Decimal("3600")  # 3 x ₹1,200

    # The specific rows must be identifiable, not just counted -- Policy Studio
    # shows the operator which transactions its change would have caught.
    changed = [
        action.action_id
        for action, conformance in history
        if evaluate(action, context, conformance, deployed).verdict
        is not evaluate(action, context, conformance, candidate).verdict
    ]
    assert len(changed) == newly_blocked
    assert changed == ["hist_003", "hist_004", "hist_005"]
