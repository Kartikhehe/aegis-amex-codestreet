"""Signed verdicts.

A signature is only worth anything if it fails when it should. These tests are
mostly about the failing cases: every field in the payload must be covered, and
a signature must survive the wire without becoming unverifiable.
"""

import copy
import json
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from aegis.signing import (
    SIGNATURE_ALG,
    get_signer,
    sign_decision,
    verify_signature,
)


class _Conformance:
    score = 0.94


class _Decision:
    action_id = "act_test01"
    agent_id = "ag_travel_1"
    verdict = "ALLOW"
    reason_code = "within_mandate"
    ruleset_hash = "7bfacd8b061e08f4"
    cart_digest = "debccf137eef3e20"
    amount = Decimal("4800.00")
    currency = "INR"
    conformance = _Conformance()
    decided_at = datetime(2026, 8, 19, 16, 0, tzinfo=timezone.utc)


@pytest.fixture
def block():
    return sign_decision(_Decision())


class TestGenuineSignatures:
    def test_a_freshly_signed_verdict_verifies(self, block):
        ok, reason = verify_signature(block)
        assert ok, reason

    def test_it_survives_the_wire(self, block):
        """The payload must be JSON-native.

        A datetime or Decimal in the payload serialises differently on the far
        side, so a genuine signature would fail to verify after an HTTP round
        trip -- which is exactly the case a verifier actually runs.
        """
        assert verify_signature(json.loads(json.dumps(block)))[0]

    def test_signing_is_deterministic(self):
        """Ed25519 is deterministic; the same decision yields the same bytes."""
        assert sign_decision(_Decision())["signature"] == sign_decision(_Decision())["signature"]

    def test_it_states_its_algorithm_and_key(self, block):
        assert block["alg"] == SIGNATURE_ALG
        assert block["kid"] == get_signer().kid


class TestTamperIsCaught:
    """Every field that could change the meaning of the verdict."""

    @pytest.mark.parametrize(
        "field,value",
        [
            ("verdict", "DENY"),
            ("reason_code", "prohibited_attribute_veto"),
            ("amount", "480000.00"),
            ("currency", "USD"),
            ("action_id", "act_somethingelse"),
            ("agent_id", "ag_other"),
            ("score", 0.01),
        ],
    )
    def test_changing_a_field_invalidates(self, block, field, value):
        forged = copy.deepcopy(block)
        forged["payload"][field] = value
        assert verify_signature(forged)[0] is False

    def test_replay_under_a_different_policy_is_caught(self, block):
        """ruleset_hash binds the verdict to the policy that produced it."""
        forged = copy.deepcopy(block)
        forged["payload"]["ruleset_hash"] = "0000000000000000"
        assert verify_signature(forged)[0] is False

    def test_moving_it_to_another_basket_is_caught(self, block):
        """cart_digest binds the verdict to what was actually being bought."""
        forged = copy.deepcopy(block)
        forged["payload"]["cart_digest"] = "aaaaaaaaaaaaaaaa"
        assert verify_signature(forged)[0] is False

    def test_backdating_is_caught(self, block):
        forged = copy.deepcopy(block)
        forged["payload"]["decided_at"] = "2020-01-01T00:00:00Z"
        assert verify_signature(forged)[0] is False

    def test_a_random_signature_is_rejected(self, block):
        forged = copy.deepcopy(block)
        forged["signature"] = "A" * 86
        assert verify_signature(forged)[0] is False

    def test_a_different_key_cannot_verify(self, block):
        """Only the holder of the matching public key can confirm a verdict."""
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

        from aegis.signing import _b64

        other = Ed25519PrivateKey.generate().public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        assert verify_signature(block, _b64(other))[0] is False


class TestMalformedInput:
    def test_missing_signature_is_refused(self, block):
        broken = {k: v for k, v in block.items() if k != "signature"}
        assert verify_signature(broken)[0] is False

    def test_missing_payload_is_refused(self, block):
        broken = {k: v for k, v in block.items() if k != "payload"}
        assert verify_signature(broken)[0] is False

    def test_an_unexpected_algorithm_is_refused(self, block):
        """A downgrade to a weaker or absent algorithm must not be accepted."""
        forged = copy.deepcopy(block)
        forged["alg"] = "none"
        assert verify_signature(forged)[0] is False

    def test_verification_never_raises(self, block):
        """A verifier sits in the payment path; it must fail closed, not crash."""
        for junk in ({}, {"payload": {}, "signature": "!!!", "alg": "Ed25519"}):
            ok, reason = verify_signature(junk)
            assert ok is False and reason
