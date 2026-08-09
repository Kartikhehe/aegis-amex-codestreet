"""attribution.py -- liability derived from ledger fields only."""

from __future__ import annotations

import pytest

from aegis.engine.attribution import (
    AttributionInput,
    attribute,
    attribution_from_decision,
)
from aegis.engine.types import LiabilityParty, ReasonCode, Verdict


def _input(**kwargs):
    base = dict(
        verdict=Verdict.ALLOW,
        reason_code=ReasonCode.WITHIN_MANDATE,
        conformance_score=0.93,
        conformance_available=True,
        mandate_present=True,
        mandate_expired=False,
        prohibited_veto_hit=False,
        suspected_injection=False,
        merchant_matched_authorised=True,
    )
    base.update(kwargs)
    return AttributionInput(**base)


# ---------------------------------------------------------------------------
# The five mappings named in the brief
# ---------------------------------------------------------------------------


def test_valid_and_conformant_is_the_card_members():
    result = attribute(_input())
    assert result.party is LiabilityParty.CARD_MEMBER
    assert "authorised" in result.rationale


def test_exceeded_purpose_is_the_operators():
    result = attribute(_input(conformance_score=0.35))
    assert result.party is LiabilityParty.OPERATOR
    assert "outside the purpose" in result.rationale


def test_no_mandate_is_the_operators_with_the_platform():
    result = attribute(_input(mandate_present=False))
    assert result.party is LiabilityParty.OPERATOR
    assert "without any grant of authority" in result.rationale


def test_merchant_mismatch_is_the_merchants():
    result = attribute(_input(merchant_matched_authorised=False))
    assert result.party is LiabilityParty.MERCHANT


def test_injection_is_shared_operator_and_platform():
    result = attribute(_input(suspected_injection=True, conformance_score=0.1))
    assert result.party is LiabilityParty.SHARED_OPERATOR_PLATFORM
    assert "operator" in result.rationale and "platform" in result.rationale


# ---------------------------------------------------------------------------
# Precedence
# ---------------------------------------------------------------------------


def test_injection_outranks_everything():
    """A subverted agent is never the card member's fault, however the
    transaction otherwise scored."""
    result = attribute(
        _input(
            suspected_injection=True,
            conformance_score=0.99,
            merchant_matched_authorised=False,
            mandate_present=False,
        )
    )
    assert result.party is LiabilityParty.SHARED_OPERATOR_PLATFORM


def test_missing_mandate_outranks_merchant_mismatch():
    result = attribute(_input(mandate_present=False, merchant_matched_authorised=False))
    assert result.party is LiabilityParty.OPERATOR


def test_expired_mandate_is_the_operators():
    result = attribute(_input(mandate_expired=True, reason_code=ReasonCode.MANDATE_EXPIRED))
    assert result.party is LiabilityParty.OPERATOR
    assert "expired" in result.rationale


def test_prohibited_veto_is_the_operators():
    result = attribute(
        _input(prohibited_veto_hit=True, reason_code=ReasonCode.PROHIBITED_ATTRIBUTE_VETO,
               conformance_score=0.0)
    )
    assert result.party is LiabilityParty.OPERATOR
    assert "prohibited" in result.rationale


def test_settled_without_a_conformance_check_is_the_platforms():
    result = attribute(_input(conformance_available=False, conformance_score=None))
    assert result.party is LiabilityParty.PLATFORM
    assert "without the checks" in result.rationale


def test_delegation_depth_exceeded_is_the_operators():
    result = attribute(
        _input(
            delegation_depth_exceeded=True,
            reason_code=ReasonCode.DELEGATION_DEPTH_EXCEEDED,
        )
    )
    assert result.party is LiabilityParty.OPERATOR


# ---------------------------------------------------------------------------
# Derivation must be reproducible from the record
# ---------------------------------------------------------------------------


def test_every_result_shows_its_derivation():
    for kwargs in (
        {},
        {"conformance_score": 0.2},
        {"mandate_present": False},
        {"merchant_matched_authorised": False},
        {"suspected_injection": True},
        {"conformance_available": False, "conformance_score": None},
    ):
        result = attribute(_input(**kwargs))
        assert result.derivation, "a determination must show its working"
        assert result.derivation[-1].startswith("-> liability")
        assert result.evidence  # the exact field values relied upon


def test_derivation_cites_only_ledger_fields():
    result = attribute(_input())
    for step in result.derivation:
        if step.startswith("->"):
            continue
        assert step.startswith("ledger."), f"derivation cites a non-ledger source: {step}"


def test_attribution_reads_a_real_decision_payload(context, good_score, legit_grocery_action):
    from aegis.engine.ledger import GENESIS_HASH, build_record
    from aegis.engine.policy import evaluate

    decision = evaluate(legit_grocery_action, context, good_score)
    record = build_record(1, "rec_1", decision, GENESIS_HASH)

    result = attribution_from_decision(record.payload)
    assert result.party is LiabilityParty.CARD_MEMBER
    assert result.evidence["conformance_score"] == pytest.approx(0.94)


def test_attribution_of_a_denied_giftcard_lands_on_the_operator(
    context, pantry_mandate, replay_engine, trap_giftcard_action
):
    from aegis.engine.ledger import GENESIS_HASH, build_record
    from aegis.engine.policy import evaluate

    conformance = replay_engine.evaluate(pantry_mandate, trap_giftcard_action)
    decision = evaluate(trap_giftcard_action, context, conformance)
    record = build_record(1, "rec_1", decision, GENESIS_HASH)

    result = attribution_from_decision(record.payload)
    assert result.party is LiabilityParty.OPERATOR
    assert result.evidence["prohibited_veto_hit"] is True


def test_result_is_serialisable():
    data = attribute(_input()).to_dict()
    assert data["party"] == "card_member"
    assert isinstance(data["derivation"], list)
