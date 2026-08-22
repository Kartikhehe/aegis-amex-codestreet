"""The deterministic policy evaluator.

Rules run in STRICT ORDER. The first rule that matches wins, its name is
recorded, and evaluation stops. Rules after the winner are not evaluated
(and are recorded as such) -- this is what makes a decision explainable:
there is exactly one reason, and it is the first thing that was wrong.

Order (highest authority first):

    1.  fleet_stop                    -- the big red button
    2.  agent_breaker                 -- this agent is tripped
    3.  operator_revoked              -- the operator lost authority
    4.  agent_inactive                -- suspended/revoked agent
    5.  mandate_expired
    6.  delegation_depth              -- deeper than the mandate allows
    6b. suspected_injection           -- deterministic, pre-model
    6c. ship_to_mismatch              -- deterministic, pre-model
    7.  prohibited_attribute_veto     -- deterministic, pre-model (merchant+cart)
    8.  conformance < 0.45            -> DENY
    9.  conformance < 0.70            -> STEP_UP
    10. amount > ceiling              -> STEP_UP
    11. velocity                      -> STEP_UP
    12. novel_merchant                -> STEP_UP
    13. conformance < 0.85            -> ALLOW + flag
    14. allow

FAIL CLOSED. If the scorer errored or timed out, the scoring rules (8, 9, 13)
are SKIPPED -- not defaulted, not guessed -- and the evaluator returns STEP_UP
with reason scorer_unavailable_fail_closed. It NEVER returns ALLOW on scorer
failure. Note that rules 1-7 still run first: a fleet stop or a prohibited
attribute is a DENY regardless of whether the scorer was reachable, because
those are decidable without it.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Callable, Optional

from .compliance import screen as compliance_screen
from .diligence import assess as assess_diligence
from .conformance import ship_to_mismatch
from .injection import detect_action as detect_injection_verdict
from .types import (
    ActionRequest,
    ConformanceResult,
    Decision,
    EvaluationContext,
    ReasonCode,
    RuleOutcome,
    Verdict,
    canonical_json,
    sha256_hex,
)

# ---------------------------------------------------------------------------
# Thresholds -- the tunable surface. Everything else about the evaluator is
# structural. Policy Studio edits these (and the rule enable flags) and the
# ruleset_hash changes, which is what makes blast-radius replay meaningful.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PolicyThresholds:
    conformance_deny_floor: float = 0.45
    conformance_review_floor: float = 0.70
    conformance_marginal_floor: float = 0.85
    novel_merchant_check_enabled: bool = True
    velocity_check_enabled: bool = True

    def to_canonical(self) -> dict[str, Any]:
        return {
            "conformance_deny_floor": self.conformance_deny_floor,
            "conformance_review_floor": self.conformance_review_floor,
            "conformance_marginal_floor": self.conformance_marginal_floor,
            "novel_merchant_check_enabled": self.novel_merchant_check_enabled,
            "velocity_check_enabled": self.velocity_check_enabled,
        }


# Rule identifiers, in evaluation order. Also the wire format for the editor.
RULE_ORDER: tuple[str, ...] = (
    # Order within the identity stage, from broadest to narrowest:
    #   the whole fleet -> is this agent real -> its operator -> the agent
    #   itself -> its behaviour -> its authority -> its delegation.
    # Each step presupposes the one before it. Asking whether an agent has
    # tripped a breaker before establishing that it is a registered agent at
    # all is the wrong way round.
    "fleet_stop",
    "agent_registered",
    "operator_revoked",
    "agent_inactive",
    "agent_breaker",
    "mandate_expired",
    "delegation_depth",
    "suspected_injection",
    "ship_to_mismatch",
    "prohibited_goods",
    "prohibited_attribute_veto",
    "conformance_deny_floor",
    "conformance_review_floor",
    "amount_above_ceiling",
    "velocity_limit",
    "novel_merchant",
    "conformance_marginal",
    "diligence_below_bar",
    "allow",
)

SCORING_RULES: frozenset[str] = frozenset(
    {"conformance_deny_floor", "conformance_review_floor", "conformance_marginal"}
)


class Ruleset:
    """An immutable, hashed policy configuration.

    ruleset_hash is computed at load and written to EVERY decision, so any
    decision can be traced back to the exact policy that produced it.
    """

    def __init__(
        self,
        thresholds: Optional[PolicyThresholds] = None,
        name: str = "default",
        version: int = 1,
    ) -> None:
        self.thresholds = thresholds or PolicyThresholds()
        self.name = name
        self.version = version
        self._hash = sha256_hex(
            canonical_json(
                {
                    "name": name,
                    "version": version,
                    "rule_order": list(RULE_ORDER),
                    "thresholds": self.thresholds.to_canonical(),
                }
            )
        )

    @property
    def ruleset_hash(self) -> str:
        return self._hash

    def to_canonical(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "ruleset_hash": self._hash,
            "rule_order": list(RULE_ORDER),
            "thresholds": self.thresholds.to_canonical(),
        }


DEFAULT_RULESET = Ruleset()


# ---------------------------------------------------------------------------
# Member-readable reasons.
#
# These are written for a card member reading a phone notification, not for an
# engineer reading a log. No rule names, no scores, no jargon. Each one says
# what happened and -- where there is one -- what the member can do about it.
# ---------------------------------------------------------------------------


def _member_reason(
    code: ReasonCode,
    action: ActionRequest,
    ctx: EvaluationContext,
    detail: str,
) -> str:
    purpose = ctx.agent.mandate.purpose
    agent_name = ctx.agent.name
    amount = _format_inr(action.amount)
    merchant = action.merchant_name

    if code is ReasonCode.FLEET_EMERGENCY_STOP:
        return (
            f"All automated spending is paused right now, so {agent_name} could not "
            f"complete this {amount} purchase at {merchant}. Nothing was charged. "
            "Your card is not affected -- you can still use it yourself as normal."
        )
    if code is ReasonCode.AGENT_BREAKER_TRIPPED:
        return (
            f"{agent_name} has been paused automatically because its recent activity "
            f"looked unusual, so this {amount} purchase at {merchant} was not made. "
            "Nothing was charged. You can review the agent and switch it back on."
        )
    if code is ReasonCode.OPERATOR_REVOKED:
        return (
            f"The service that runs {agent_name} no longer has permission to spend on "
            f"your card, so this {amount} purchase at {merchant} was declined. "
            "Nothing was charged."
        )
    if code is ReasonCode.AGENT_INACTIVE:
        return (
            f"{agent_name} is currently switched off, so it could not make this "
            f"{amount} purchase at {merchant}. Nothing was charged."
        )
    if code is ReasonCode.MANDATE_EXPIRED:
        return (
            f"The permission you gave {agent_name} has expired, so this {amount} "
            f"purchase at {merchant} was declined. Nothing was charged. "
            "You can renew its permission at any time."
        )
    if code is ReasonCode.DELEGATION_DEPTH_EXCEEDED:
        return (
            f"{agent_name} tried to hand this {amount} purchase to another helper "
            "further down the line than you allowed, so it was declined. "
            "Nothing was charged."
        )
    if code is ReasonCode.SUSPECTED_INJECTION:
        return (
            f"{agent_name} was sent a message trying to talk it out of the limits you "
            f"set, so this {amount} purchase at {merchant} was blocked and the agent "
            "was paused. Nothing was charged. This was not something you asked for."
        )
    if code is ReasonCode.SHIP_TO_MISMATCH:
        return (
            f"{agent_name} tried to have this {amount} order from {merchant} delivered "
            "somewhere other than the address you approved, so it was blocked. "
            "Nothing was charged."
        )
    if code is ReasonCode.PROHIBITED_ATTRIBUTE_VETO:
        return (
            f"You told {agent_name} it may never buy {detail}. This {amount} purchase "
            f"at {merchant} was for exactly that, so it was blocked. Nothing was charged."
        )
    if code is ReasonCode.CONFORMANCE_BELOW_DENY_FLOOR:
        return (
            f"This {amount} purchase at {merchant} does not match what you authorised "
            f'{agent_name} to do -- you approved it for "{purpose}". It was blocked '
            "and nothing was charged."
        )
    if code is ReasonCode.CONFORMANCE_BELOW_REVIEW_FLOOR:
        return (
            f"{agent_name} wants to spend {amount} at {merchant}, but this does not "
            f'clearly match what you authorised it to do ("{purpose}"). '
            "Nothing has been charged yet -- it needs your approval first."
        )
    if code is ReasonCode.AMOUNT_ABOVE_CEILING:
        ceiling = _format_inr(ctx.agent.mandate.per_transaction_ceiling)
        return (
            f"{agent_name} wants to spend {amount} at {merchant} -- above the "
            f"{ceiling} limit you set, but it matches your authorised purpose. "
            "Nothing has been charged yet."
        )
    if code is ReasonCode.VELOCITY_LIMIT:
        return (
            f"{agent_name} has already spent more today than you normally allow, so "
            f"this {amount} purchase at {merchant} needs your approval first. "
            "Nothing has been charged yet."
        )
    if code is ReasonCode.NOVEL_MERCHANT:
        return (
            f"{agent_name} has never bought from {merchant} before, so this {amount} "
            "purchase needs your approval first. Nothing has been charged yet."
        )
    if code is ReasonCode.SCORER_UNAVAILABLE_FAIL_CLOSED:
        return (
            f"We could not fully check this {amount} purchase at {merchant} against "
            "what you authorised, so we have not let it through automatically. "
            "Nothing has been charged yet -- it needs your approval."
        )
    if code is ReasonCode.CONFORMANCE_MARGINAL:
        return (
            f"{agent_name} bought {amount} at {merchant}. This matches what you "
            "authorised, though less closely than usual, so we have noted it for you."
        )
    return (
        f"{agent_name} bought {amount} at {merchant}, which matches what you "
        f'authorised it to do ("{purpose}").'
    )


def _format_inr(amount: Decimal) -> str:
    """Indian digit grouping: 4980 -> Rs 4,980; 1234567 -> Rs 12,34,567."""
    quant = amount.quantize(Decimal("0.01"))
    whole = int(quant)
    frac = quant - whole
    s = str(abs(whole))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups + [tail])
    out = f"₹{s}"
    if frac:
        out += f"{frac:.2f}"[1:]
    return f"-{out}" if whole < 0 else out


# ---------------------------------------------------------------------------
# The evaluator
# ---------------------------------------------------------------------------


def evaluate(
    action: ActionRequest,
    ctx: EvaluationContext,
    conformance: Optional[ConformanceResult] = None,
    ruleset: Optional[Ruleset] = None,
) -> Decision:
    """Evaluate one action against the ruleset. Pure and deterministic.

    `conformance` may be None (never scored) or a result with available=False
    (scorer failed). Both cause the scoring rules to be skipped and, if no
    higher-priority rule matched, a fail-closed STEP_UP.
    """
    started = time.perf_counter()
    rs = ruleset or DEFAULT_RULESET
    t = rs.thresholds
    mandate = ctx.agent.mandate

    fired: list[RuleOutcome] = []
    scorer_ok = conformance is not None and conformance.available

    def miss(name: str) -> None:
        fired.append(RuleOutcome(rule_name=name, matched=False))

    def skip(name: str, why: str) -> None:
        fired.append(RuleOutcome(rule_name=name, matched=False, skipped=True, detail=why))

    def win(
        name: str,
        verdict: Verdict,
        code: ReasonCode,
        detail: str = "",
        flagged: bool = False,
    ) -> Decision:
        fired.append(
            RuleOutcome(
                rule_name=name, matched=True, verdict=verdict, reason_code=code, detail=detail
            )
        )
        return _build(
            action, ctx, rs, verdict, code, name, tuple(fired), conformance, detail, flagged, started
        )

    # -- 1. fleet stop -------------------------------------------------------
    if ctx.fleet_stopped:
        return win(
            "fleet_stop",
            Verdict.DENY,
            ReasonCode.FLEET_EMERGENCY_STOP,
            "Fleet-wide emergency stop is engaged",
        )
    miss("fleet_stop")

    # -- 2. agent registered -------------------------------------------------
    #
    # Is this a registered agent at all? Every later check presupposes it: a
    # breaker, a status or a mandate only means something for an agent that
    # exists in the registry.
    #
    # This was previously verified in the API layer, before the engine ran --
    # correct behaviour, but invisible in the decision record, so the flow began
    # by asking about breakers on an agent whose existence had never been shown.
    # `ctx.identity_verified` carries the ACE Agent Registration result, and an
    # identity we cannot verify is a denial rather than a pass.
    if ctx.identity_verified is False:
        return win(
            "agent_registered",
            Verdict.DENY,
            ReasonCode.AGENT_NOT_REGISTERED,
            f"{ctx.agent.agent_id} is not a registered agent",
        )
    if ctx.identity_verified is None:
        return win(
            "agent_registered",
            Verdict.DENY,
            ReasonCode.IDENTITY_UNVERIFIABLE,
            "Agent registration could not be verified — failing closed",
        )
    miss("agent_registered")

    # -- 3. operator revoked -------------------------------------------------
    if ctx.operator_revoked:
        return win(
            "operator_revoked",
            Verdict.DENY,
            ReasonCode.OPERATOR_REVOKED,
            f"Operator {ctx.agent.operator_id} is revoked",
        )
    miss("operator_revoked")

    # -- 4. agent inactive ---------------------------------------------------
    if ctx.agent.status.value != "active":
        return win(
            "agent_inactive",
            Verdict.DENY,
            ReasonCode.AGENT_INACTIVE,
            f"Agent status is {ctx.agent.status.value}",
        )
    miss("agent_inactive")

    # -- 4b. agent breaker ---------------------------------------------------
    # After status, not before: a breaker is a statement about how a live agent
    # has been BEHAVING, which only makes sense once it is established that the
    # agent is registered, its operator is good, and it is active.
    if ctx.agent.breaker_tripped:
        return win(
            "agent_breaker",
            Verdict.DENY,
            ReasonCode.AGENT_BREAKER_TRIPPED,
            "Circuit breaker tripped for this agent",
        )
    miss("agent_breaker")

    # -- 5. mandate expired --------------------------------------------------
    if mandate.is_expired(ctx.now):
        return win(
            "mandate_expired",
            Verdict.DENY,
            ReasonCode.MANDATE_EXPIRED,
            f"Mandate expired at {mandate.expires_at}",
        )
    miss("mandate_expired")

    # -- 6. delegation depth -------------------------------------------------
    # The agent's own depth must be within the depth its ROOT mandate allowed.
    root = ctx.chain[0] if ctx.chain else ctx.agent
    if ctx.agent.depth > root.mandate.max_delegation_depth:
        return win(
            "delegation_depth",
            Verdict.DENY,
            ReasonCode.DELEGATION_DEPTH_EXCEEDED,
            f"Depth {ctx.agent.depth} exceeds permitted {root.mandate.max_delegation_depth}",
        )
    miss("delegation_depth")

    # -- 6b. suspected injection (two detectors, pre-conformance) ------------
    #
    # Ranked above the attribute veto: a subverted agent is a graver finding
    # than one bad purchase, and the record should say which it was.
    #
    # TWO detectors, merged asymmetrically (see engine/injection.py): the phrase
    # list is deterministic and auditable, the classifier catches paraphrase the
    # list cannot. The classifier may only ESCALATE -- it can never clear a
    # phrase hit, and its absence degrades coverage rather than creating a
    # bypass. The record names which detector fired.
    injection = detect_injection_verdict(action)
    if injection.detected:
        return win(
            "suspected_injection",
            Verdict.DENY,
            ReasonCode.SUSPECTED_INJECTION,
            injection.detail,
        )
    miss("suspected_injection")

    # -- 6c. ship-to mismatch (deterministic, pre-model) ---------------------
    if ship_to_mismatch(mandate, action):
        return win(
            "ship_to_mismatch",
            Verdict.DENY,
            ReasonCode.SHIP_TO_MISMATCH,
            f"{action.ship_to} is not the authorised destination",
        )
    miss("ship_to_mismatch")

    # -- 6d. prohibited goods (legality, deterministic, pre-model) ----------
    # Ranked above the mandate on purpose. A card member can permit gift cards;
    # nobody can permit a controlled substance, so no mandate, ceiling or
    # member approval may clear this.
    compliance_hit = compliance_screen(action)
    if compliance_hit is not None:
        return win(
            "prohibited_goods",
            Verdict.DENY,
            ReasonCode.PROHIBITED_GOODS,
            compliance_hit.detail,
        )
    miss("prohibited_goods")

    # -- 7. prohibited attribute veto (deterministic, pre-model) -------------
    # Union the prohibitions down the whole chain: a parent's "never" can never
    # be undone by a child, even if the child mandate omits it. Checked against
    # merchant AND cart attributes -- the basket is what is actually bought.
    prohibited: set[str] = set(mandate.prohibited_attributes)
    for link in ctx.chain:
        prohibited |= set(link.mandate.prohibited_attributes)
    hits = sorted(prohibited & set(action.all_attributes))
    if hits:
        return win(
            "prohibited_attribute_veto",
            Verdict.DENY,
            ReasonCode.PROHIBITED_ATTRIBUTE_VETO,
            ", ".join(h.replace("_", " ") for h in hits),
        )
    miss("prohibited_attribute_veto")

    # -- 8/9. conformance floors (skipped when the scorer is down) -----------
    if scorer_ok:
        score = conformance.score
        if score < t.conformance_deny_floor:
            return win(
                "conformance_deny_floor",
                Verdict.DENY,
                ReasonCode.CONFORMANCE_BELOW_DENY_FLOOR,
                f"Conformance {score:.2f} below deny floor {t.conformance_deny_floor:.2f}",
            )
        miss("conformance_deny_floor")

        if score < t.conformance_review_floor:
            return win(
                "conformance_review_floor",
                Verdict.STEP_UP,
                ReasonCode.CONFORMANCE_BELOW_REVIEW_FLOOR,
                f"Conformance {score:.2f} below review floor {t.conformance_review_floor:.2f}",
            )
        miss("conformance_review_floor")
    else:
        why = (conformance.error if conformance else "scorer not invoked") or "scorer unavailable"
        skip("conformance_deny_floor", why)
        skip("conformance_review_floor", why)

    # -- 10. amount ceiling --------------------------------------------------
    if action.amount > mandate.per_transaction_ceiling:
        return win(
            "amount_above_ceiling",
            Verdict.STEP_UP,
            ReasonCode.AMOUNT_ABOVE_CEILING,
            f"{action.amount} exceeds per-transaction ceiling "
            f"{mandate.per_transaction_ceiling}",
        )
    miss("amount_above_ceiling")

    # -- 11. velocity --------------------------------------------------------
    if t.velocity_check_enabled:
        v = ctx.velocity
        over_count = (
            mandate.max_transactions_per_day > 0
            and v.transactions_today >= mandate.max_transactions_per_day
        )
        over_amount = (
            mandate.daily_ceiling > 0
            and (v.amount_today + action.amount) > mandate.daily_ceiling
        )
        if over_count or over_amount:
            detail = (
                f"{v.transactions_today} txns today (limit "
                f"{mandate.max_transactions_per_day})"
                if over_count
                else f"{v.amount_today + action.amount} would exceed daily ceiling "
                f"{mandate.daily_ceiling}"
            )
            return win("velocity_limit", Verdict.STEP_UP, ReasonCode.VELOCITY_LIMIT, detail)
        miss("velocity_limit")
    else:
        skip("velocity_limit", "disabled by ruleset")

    # -- 12. novel merchant --------------------------------------------------
    if t.novel_merchant_check_enabled:
        if action.merchant_id not in ctx.known_merchants:
            return win(
                "novel_merchant",
                Verdict.STEP_UP,
                ReasonCode.NOVEL_MERCHANT,
                f"First transaction with {action.merchant_name}",
            )
        miss("novel_merchant")
    else:
        skip("novel_merchant", "disabled by ruleset")

    # -- FAIL CLOSED ---------------------------------------------------------
    # We are past every rule decidable without a score. If the scorer was not
    # available we must NOT fall through to allow.
    if not scorer_ok:
        why = (conformance.error if conformance else "scorer not invoked") or "scorer unavailable"
        skip("conformance_marginal", why)
        return win(
            "scorer_unavailable_fail_closed",
            Verdict.STEP_UP,
            ReasonCode.SCORER_UNAVAILABLE_FAIL_CLOSED,
            why,
        )

    # -- 13. marginal conformance -> allow but flag --------------------------
    if conformance.score < t.conformance_marginal_floor:
        return win(
            "conformance_marginal",
            Verdict.ALLOW,
            ReasonCode.CONFORMANCE_MARGINAL,
            f"Conformance {conformance.score:.2f} below "
            f"{t.conformance_marginal_floor:.2f} -- allowed and flagged",
            flagged=True,
        )
    miss("conformance_marginal")

    # -- 14. diligence: was this a COMPETENT purchase? -----------------------
    #
    # Last, and deliberately so. Diligence is about quality of judgement, not
    # authority, so it must never pre-empt a rule about whether the agent was
    # allowed to act at all. It also never DENIES: the card member set a bar,
    # and falling below a bar someone chose is a reason to tell them or ask
    # them, not a reason for AEGIS to substitute its own taste for theirs.
    #
    # `require_diligence` on the mandate decides which: absent, a shortfall is
    # allowed-and-flagged; set, it becomes a step-up the member answers.
    diligence = assess_diligence(action, mandate)
    if diligence.below_bar:
        detail = ", ".join(diligence.flags)
        if getattr(mandate, "require_diligence", False):
            return win(
                "diligence_below_bar",
                Verdict.STEP_UP,
                ReasonCode.DILIGENCE_BELOW_BAR,
                detail,
                flagged=True,
            )
        return win(
            "diligence_below_bar",
            Verdict.ALLOW,
            ReasonCode.DILIGENCE_FLAG,
            detail,
            flagged=True,
        )
    miss("diligence_below_bar")

    # -- 15. allow -----------------------------------------------------------
    return win("allow", Verdict.ALLOW, ReasonCode.WITHIN_MANDATE, "Within mandate")


def _build(
    action: ActionRequest,
    ctx: EvaluationContext,
    rs: Ruleset,
    verdict: Verdict,
    code: ReasonCode,
    winning_rule: str,
    fired: tuple[RuleOutcome, ...],
    conformance: Optional[ConformanceResult],
    detail: str,
    flagged: bool,
    started: float,
) -> Decision:
    mandate = ctx.agent.mandate
    features = {
        "amount": action.amount,
        "per_transaction_ceiling": mandate.per_transaction_ceiling,
        "daily_ceiling": mandate.daily_ceiling,
        "amount_today": ctx.velocity.amount_today,
        "transactions_today": ctx.velocity.transactions_today,
        "max_transactions_per_day": mandate.max_transactions_per_day,
        "merchant_category": action.merchant_category,
        "merchant_known": action.merchant_id in ctx.known_merchants,
        "merchant_attributes": sorted(action.merchant_attributes),
        "delegation_depth": ctx.agent.depth,
        "conformance_score": (
            None if conformance is None or not conformance.available else round(conformance.score, 4)
        ),
        "scorer_available": bool(conformance and conformance.available),
    }
    return Decision(
        action_id=action.action_id,
        agent_id=action.agent_id,
        verdict=verdict,
        reason_code=code,
        human_readable_reason=_member_reason(code, action, ctx, detail),
        winning_rule=winning_rule,
        rules_fired=fired,
        ruleset_hash=rs.ruleset_hash,
        conformance=conformance,
        delegation_chain=tuple(a.agent_id for a in ctx.chain) or (ctx.agent.agent_id,),
        features=features,
        flagged=flagged,
        decided_at=ctx.now,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
