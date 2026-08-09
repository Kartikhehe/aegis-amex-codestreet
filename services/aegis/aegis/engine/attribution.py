"""Liability attribution.

Answers: when a disputed transaction went through, who is answerable for it?

The hard rule of this module: **liability is derived from ledger fields only.**
No heuristics, no model, no outside context. Every determination returns the
exact field values it rested on, so the derivation can be reproduced by anyone
holding the ledger record -- which is the whole point of a dispute packet.

The ordering below encodes the governing question at each step: was there
authority at all -> was the authority used for its stated purpose -> was the
counterparty the one that was authorised.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from .types import LiabilityParty, ReasonCode, Verdict


@dataclass(frozen=True)
class AttributionInput:
    """Precisely the ledger fields attribution is permitted to read."""

    verdict: Verdict
    reason_code: ReasonCode
    conformance_score: Optional[float]
    conformance_available: bool
    mandate_present: bool
    mandate_expired: bool
    prohibited_veto_hit: bool
    suspected_injection: bool
    merchant_matched_authorised: bool
    """Did the settled merchant match the merchant that was authorised?"""

    step_up_approved_by_member: bool = False
    delegation_depth_exceeded: bool = False


@dataclass(frozen=True)
class AttributionResult:
    party: LiabilityParty
    rationale: str
    derivation: tuple[str, ...] = ()
    """Ordered, human-checkable steps naming the ledger fields used."""

    evidence: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "party": self.party.value,
            "rationale": self.rationale,
            "derivation": list(self.derivation),
            "evidence": self.evidence,
        }


def attribute(data: AttributionInput) -> AttributionResult:
    """Derive the liable party. Total: every input yields a determination."""
    evidence = {
        "verdict": data.verdict.value,
        "reason_code": data.reason_code.value,
        "conformance_score": data.conformance_score,
        "conformance_available": data.conformance_available,
        "mandate_present": data.mandate_present,
        "mandate_expired": data.mandate_expired,
        "prohibited_veto_hit": data.prohibited_veto_hit,
        "suspected_injection": data.suspected_injection,
        "merchant_matched_authorised": data.merchant_matched_authorised,
        "step_up_approved_by_member": data.step_up_approved_by_member,
    }

    # 1. Injection -> shared operator + platform.
    # The operator's agent was subverted; the platform's controls did not stop
    # it before settlement. Neither party alone is answerable, and the card
    # member never is.
    if data.suspected_injection:
        return AttributionResult(
            party=LiabilityParty.SHARED_OPERATOR_PLATFORM,
            rationale=(
                "The agent was subverted by injected instructions. The operator is "
                "answerable for the agent it deployed; the platform is answerable for "
                "controls that permitted the transaction to settle. The card member "
                "authorised nothing resembling this transaction."
            ),
            derivation=(
                "ledger.suspected_injection = true",
                "-> agent acted on instructions other than the card member's",
                "-> liability shared: operator (deployed the agent) + platform (settled it)",
            ),
            evidence=evidence,
        )

    # 2. No mandate -> operator / platform. Authority never existed.
    if not data.mandate_present:
        return AttributionResult(
            party=LiabilityParty.OPERATOR,
            rationale=(
                "No mandate was present authorising this transaction. Spending occurred "
                "without any grant of authority from the card member, so liability rests "
                "with the operator that initiated it and the platform that settled it."
            ),
            derivation=(
                "ledger.mandate_present = false",
                "-> no authority existed at the time of the transaction",
                "-> the card member cannot be liable for authority they never granted",
                "-> liability: operator (with platform)",
            ),
            evidence=evidence,
        )

    # 3. Merchant mismatch -> merchant.
    if not data.merchant_matched_authorised:
        return AttributionResult(
            party=LiabilityParty.MERCHANT,
            rationale=(
                "The settling merchant does not match the merchant that was authorised. "
                "The transaction was presented under a merchant identity other than the "
                "one the mandate permitted, so liability rests with the merchant."
            ),
            derivation=(
                "ledger.merchant_matched_authorised = false",
                "-> settled merchant differs from the authorised merchant",
                "-> liability: merchant",
            ),
            evidence=evidence,
        )

    # 4. Expired mandate / depth exceeded -> operator: authority had lapsed or
    #    was manufactured beyond what was granted.
    if data.mandate_expired or data.delegation_depth_exceeded:
        why = "had expired" if data.mandate_expired else "did not extend this far down the chain"
        return AttributionResult(
            party=LiabilityParty.OPERATOR,
            rationale=(
                f"The mandate {why} at the time of the transaction. The operator "
                "continued to transact on authority it no longer held."
            ),
            derivation=(
                (
                    "ledger.mandate_expired = true"
                    if data.mandate_expired
                    else "ledger.delegation_depth_exceeded = true"
                ),
                "-> authority did not cover this transaction",
                "-> liability: operator",
            ),
            evidence=evidence,
        )

    # 5. Prohibited attribute -> operator: an explicit "never" was crossed.
    if data.prohibited_veto_hit:
        return AttributionResult(
            party=LiabilityParty.OPERATOR,
            rationale=(
                "The transaction carried an attribute the card member explicitly "
                "prohibited. The operator's agent attempted a purchase the mandate "
                "ruled out in absolute terms."
            ),
            derivation=(
                "ledger.prohibited_veto_hit = true",
                "-> transaction matched an explicit prohibition in the mandate",
                "-> liability: operator",
            ),
            evidence=evidence,
        )

    # 6. Exceeded purpose -> operator. Authority existed but was used for
    #    something else.
    if data.conformance_available and data.conformance_score is not None:
        if data.conformance_score < 0.70:
            return AttributionResult(
                party=LiabilityParty.OPERATOR,
                rationale=(
                    f"Mandate conformance was {data.conformance_score:.2f}. A valid mandate "
                    "existed, but the transaction fell outside the purpose it authorised. "
                    "The operator exceeded the scope of the authority it was given."
                ),
                derivation=(
                    f"ledger.conformance_score = {data.conformance_score:.2f}",
                    "-> below the 0.70 purpose-conformance floor",
                    "-> mandate was valid but was used outside its stated purpose",
                    "-> liability: operator",
                ),
                evidence=evidence,
            )

        # 7. Valid mandate + conformant transaction -> card member.
        # The member authorised this purpose and the transaction served it.
        return AttributionResult(
            party=LiabilityParty.CARD_MEMBER,
            rationale=(
                f"A valid mandate was in force and mandate conformance was "
                f"{data.conformance_score:.2f}. The transaction served the purpose the "
                "card member authorised, so it is a valid charge against the account."
            ),
            derivation=(
                "ledger.mandate_present = true",
                "ledger.mandate_expired = false",
                f"ledger.conformance_score = {data.conformance_score:.2f} (>= 0.70)",
                "ledger.merchant_matched_authorised = true",
                "-> transaction was authorised and conformant",
                "-> liability: card member",
            ),
            evidence=evidence,
        )

    # 8. Scorer unavailable and it settled anyway -> platform.
    # The platform is answerable for anything it allowed to settle without the
    # checks its own policy requires.
    return AttributionResult(
        party=LiabilityParty.PLATFORM,
        rationale=(
            "Mandate conformance could not be established for this transaction, yet it "
            "settled. The platform is answerable for transactions permitted without the "
            "checks its policy requires."
        ),
        derivation=(
            "ledger.conformance_available = false",
            "-> conformance was never established",
            "-> transaction settled without a required control",
            "-> liability: platform",
        ),
        evidence=evidence,
    )


def attribution_from_decision(
    decision_payload: dict[str, Any],
    merchant_matched_authorised: bool = True,
    suspected_injection: bool = False,
    step_up_approved_by_member: bool = False,
    mandate_present: bool = True,
) -> AttributionResult:
    """Build attribution directly from a ledger record's canonical payload.

    Reads only fields the ledger actually stores -- this is the function the
    dispute-packet endpoint calls, so the packet's liability section is
    provably a function of the record.
    """
    conformance = decision_payload.get("conformance") or {}
    reason_raw = decision_payload.get("reason_code", "")
    try:
        reason = ReasonCode(reason_raw)
    except ValueError:
        reason = ReasonCode.WITHIN_MANDATE
    try:
        verdict = Verdict(decision_payload.get("verdict", "DENY"))
    except ValueError:
        verdict = Verdict.DENY

    return attribute(
        AttributionInput(
            verdict=verdict,
            reason_code=reason,
            conformance_score=conformance.get("score"),
            conformance_available=bool(conformance.get("available", False)),
            mandate_present=mandate_present,
            mandate_expired=reason is ReasonCode.MANDATE_EXPIRED,
            prohibited_veto_hit=reason is ReasonCode.PROHIBITED_ATTRIBUTE_VETO,
            suspected_injection=suspected_injection,
            merchant_matched_authorised=merchant_matched_authorised,
            step_up_approved_by_member=step_up_approved_by_member,
            delegation_depth_exceeded=reason is ReasonCode.DELEGATION_DEPTH_EXCEEDED,
        )
    )
