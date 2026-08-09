"""policy.py -- rule ordering, precedence, determinism, member language."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from aegis.engine.policy import (
    DEFAULT_RULESET,
    RULE_ORDER,
    PolicyThresholds,
    Ruleset,
    _format_inr,
    evaluate,
)
from aegis.engine.types import (
    ActionRequest,
    Agent,
    AgentStatus,
    ConformanceResult,
    EvaluationContext,
    Mandate,
    ReasonCode,
    Verdict,
    VelocityWindow,
)


def _action(context, **kwargs):
    defaults = dict(
        action_id="act_x",
        agent_id="ag_pantry",
        merchant_id="mch_freshmart",
        merchant_name="FreshMart Daily Grocers",
        merchant_category="5411",
        amount=Decimal("900"),
        requested_at=context.now,
    )
    defaults.update(kwargs)
    return ActionRequest(**defaults)


# ---------------------------------------------------------------------------
# Ordering and precedence
# ---------------------------------------------------------------------------


def test_rules_are_evaluated_in_the_specified_order(context, good_score, legit_grocery_action):
    decision = evaluate(legit_grocery_action, context, good_score)
    fired = [r.rule_name for r in decision.rules_fired]
    # Every rule that ran must appear in RULE_ORDER, in order.
    positions = [RULE_ORDER.index(name) for name in fired if name in RULE_ORDER]
    assert positions == sorted(positions)


def test_first_match_wins_and_stops_evaluation(pantry_agent, now):
    """A stopped fleet AND a tripped breaker: fleet_stop must win, and the
    breaker rule must never even be reached."""
    tripped = Agent(
        agent_id=pantry_agent.agent_id,
        operator_id=pantry_agent.operator_id,
        name=pantry_agent.name,
        mandate=pantry_agent.mandate,
        status=AgentStatus.ACTIVE,
        breaker_tripped=True,
    )
    ctx = EvaluationContext(agent=tripped, chain=(tripped,), fleet_stopped=True, now=now)
    decision = evaluate(_action(ctx), ctx, ConformanceResult(score=0.99, rationale="x"))

    assert decision.winning_rule == "fleet_stop"
    assert [r.rule_name for r in decision.rules_fired] == ["fleet_stop"]


@pytest.mark.parametrize(
    "field,value,expected_rule,expected_code",
    [
        ("fleet_stopped", True, "fleet_stop", ReasonCode.FLEET_EMERGENCY_STOP),
        ("operator_revoked", True, "operator_revoked", ReasonCode.OPERATOR_REVOKED),
    ],
)
def test_context_flags_deny(pantry_agent, now, field, value, expected_rule, expected_code):
    ctx = EvaluationContext(
        agent=pantry_agent, chain=(pantry_agent,), now=now, **{field: value}
    )
    decision = evaluate(_action(ctx), ctx, ConformanceResult(score=0.99, rationale="x"))
    assert decision.winning_rule == expected_rule
    assert decision.reason_code is expected_code
    assert decision.verdict is Verdict.DENY


def test_expired_mandate_denies(pantry_mandate, now):
    expired = Mandate(
        purpose=pantry_mandate.purpose,
        permitted_categories=pantry_mandate.permitted_categories,
        prohibited_attributes=pantry_mandate.prohibited_attributes,
        per_transaction_ceiling=pantry_mandate.per_transaction_ceiling,
        daily_ceiling=pantry_mandate.daily_ceiling,
        max_transactions_per_day=pantry_mandate.max_transactions_per_day,
        max_delegation_depth=pantry_mandate.max_delegation_depth,
        expires_at=now - timedelta(days=1),
    )
    agent = Agent("ag_pantry", "op", "Pantry agent", expired)
    ctx = EvaluationContext(agent=agent, chain=(agent,), now=now)
    decision = evaluate(_action(ctx), ctx, ConformanceResult(score=0.99, rationale="x"))
    assert decision.reason_code is ReasonCode.MANDATE_EXPIRED
    assert decision.verdict is Verdict.DENY


def test_delegation_depth_exceeded_denies(pantry_mandate, now):
    root = Agent("ag_root", "op", "Root", pantry_mandate, None, 0)
    # depth 3 under a mandate permitting 2
    deep = Agent("ag_deep", "op", "Deep", pantry_mandate, "ag_root", 3)
    ctx = EvaluationContext(agent=deep, chain=(root, deep), now=now)
    decision = evaluate(_action(ctx, agent_id="ag_deep"), ctx, ConformanceResult(0.99, "x"))
    assert decision.reason_code is ReasonCode.DELEGATION_DEPTH_EXCEEDED


def test_parent_prohibition_binds_the_child(pantry_mandate, now):
    """A child that omits a parent's prohibition is still bound by it."""
    permissive_child = Mandate(
        purpose="snacks",
        permitted_categories=frozenset({"5411"}),
        prohibited_attributes=frozenset(),  # omits gift_card
        per_transaction_ceiling=Decimal("1000"),
        daily_ceiling=Decimal("2000"),
        max_transactions_per_day=2,
        max_delegation_depth=0,
    )
    root = Agent("ag_root", "op", "Root", pantry_mandate, None, 0)
    child = Agent("ag_child", "op", "Child", permissive_child, "ag_root", 1)
    ctx = EvaluationContext(
        agent=child, chain=(root, child), known_merchants=frozenset({"mch_x"}), now=now
    )
    action = _action(
        ctx,
        agent_id="ag_child",
        merchant_id="mch_x",
        amount=Decimal("500"),
        merchant_attributes=frozenset({"gift_card"}),
    )
    decision = evaluate(action, ctx, ConformanceResult(score=0.9, rationale="x"))
    assert decision.reason_code is ReasonCode.PROHIBITED_ATTRIBUTE_VETO


# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "score,verdict,code,flagged",
    [
        (0.99, Verdict.ALLOW, ReasonCode.WITHIN_MANDATE, False),
        (0.86, Verdict.ALLOW, ReasonCode.WITHIN_MANDATE, False),
        (0.84, Verdict.ALLOW, ReasonCode.CONFORMANCE_MARGINAL, True),
        (0.71, Verdict.ALLOW, ReasonCode.CONFORMANCE_MARGINAL, True),
        (0.69, Verdict.STEP_UP, ReasonCode.CONFORMANCE_BELOW_REVIEW_FLOOR, False),
        (0.46, Verdict.STEP_UP, ReasonCode.CONFORMANCE_BELOW_REVIEW_FLOOR, False),
        (0.44, Verdict.DENY, ReasonCode.CONFORMANCE_BELOW_DENY_FLOOR, False),
        (0.01, Verdict.DENY, ReasonCode.CONFORMANCE_BELOW_DENY_FLOOR, False),
    ],
)
def test_conformance_bands(context, score, verdict, code, flagged):
    decision = evaluate(
        _action(context), context, ConformanceResult(score=score, rationale="r")
    )
    assert decision.verdict is verdict
    assert decision.reason_code is code
    assert decision.flagged is flagged


def test_amount_above_ceiling_steps_up(context, good_score):
    decision = evaluate(_action(context, amount=Decimal("5600")), context, good_score)
    assert decision.verdict is Verdict.STEP_UP
    assert decision.reason_code is ReasonCode.AMOUNT_ABOVE_CEILING
    assert "₹5,600" in decision.human_readable_reason
    assert "₹5,000" in decision.human_readable_reason


def test_velocity_count_and_amount_step_up(pantry_agent, now, good_score):
    ctx = EvaluationContext(
        agent=pantry_agent,
        chain=(pantry_agent,),
        known_merchants=frozenset({"mch_freshmart"}),
        velocity=VelocityWindow(transactions_today=6, amount_today=Decimal("1000")),
        now=now,
    )
    assert evaluate(_action(ctx), ctx, good_score).reason_code is ReasonCode.VELOCITY_LIMIT

    ctx2 = EvaluationContext(
        agent=pantry_agent,
        chain=(pantry_agent,),
        known_merchants=frozenset({"mch_freshmart"}),
        velocity=VelocityWindow(transactions_today=1, amount_today=Decimal("11500")),
        now=now,
    )
    assert evaluate(_action(ctx2), ctx2, good_score).reason_code is ReasonCode.VELOCITY_LIMIT


def test_novel_merchant_steps_up(context, good_score):
    decision = evaluate(_action(context, merchant_id="mch_never_seen"), context, good_score)
    assert decision.verdict is Verdict.STEP_UP
    assert decision.reason_code is ReasonCode.NOVEL_MERCHANT


def test_disabled_checks_are_skipped_not_silently_passed(context, good_score):
    relaxed = Ruleset(
        thresholds=PolicyThresholds(
            novel_merchant_check_enabled=False, velocity_check_enabled=False
        ),
        name="relaxed",
        version=2,
    )
    decision = evaluate(_action(context, merchant_id="mch_new"), context, good_score, relaxed)
    assert decision.verdict is Verdict.ALLOW
    skipped = {r.rule_name for r in decision.rules_fired if r.skipped}
    assert {"novel_merchant", "velocity_limit"} <= skipped


# ---------------------------------------------------------------------------
# Ruleset hashing and determinism
# ---------------------------------------------------------------------------


def test_ruleset_hash_is_stable_and_threshold_sensitive():
    a = Ruleset(PolicyThresholds(), "default", 1)
    b = Ruleset(PolicyThresholds(), "default", 1)
    c = Ruleset(PolicyThresholds(conformance_deny_floor=0.50), "default", 1)
    assert a.ruleset_hash == b.ruleset_hash
    assert a.ruleset_hash != c.ruleset_hash
    assert len(a.ruleset_hash) == 64


def test_every_decision_records_the_ruleset_hash(context, good_score):
    decision = evaluate(_action(context), context, good_score)
    assert decision.ruleset_hash == DEFAULT_RULESET.ruleset_hash


def test_evaluation_is_deterministic(context, good_score):
    first = evaluate(_action(context), context, good_score)
    second = evaluate(_action(context), context, good_score)
    assert first.verdict is second.verdict
    assert first.reason_code is second.reason_code
    assert first.winning_rule == second.winning_rule
    assert first.human_readable_reason == second.human_readable_reason


# ---------------------------------------------------------------------------
# Member-facing language
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("score", [0.99, 0.80, 0.60, 0.30])
def test_member_reason_never_leaks_internals(context, score):
    decision = evaluate(_action(context), context, ConformanceResult(score, "r"))
    text = decision.human_readable_reason
    for token in ("conformance", "ruleset_hash", "reason_code", "STEP_UP", "MCC", "sha256"):
        assert token not in text
    assert len(text) > 40  # a real sentence, not a code


def test_step_up_reasons_reassure_that_nothing_was_charged(context, good_score):
    decision = evaluate(_action(context, amount=Decimal("5600")), context, good_score)
    assert "Nothing has been charged" in decision.human_readable_reason


@pytest.mark.parametrize(
    "amount,expected",
    [
        ("4980", "₹4,980"),
        ("5600", "₹5,600"),
        ("100000", "₹1,00,000"),
        ("1234567", "₹12,34,567"),
        ("999", "₹999"),
        ("1500.50", "₹1,500.50"),
    ],
)
def test_indian_currency_grouping(amount, expected):
    assert _format_inr(Decimal(amount)) == expected
