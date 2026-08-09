"""The Firestore mirror.

Two things are tested, and the second matters more than the first:

  1. The payloads are shaped correctly and money survives the trip.
  2. **A Firestore outage cannot fail a decision.** The mirror is a courtesy
     that runs after the SQL commit; every write is wrapped, and the whole
     module is inert when Firebase is not configured.

These run against a fake client rather than the emulator, deliberately: the
thing worth testing is AEGIS's behaviour, not Google's SDK, and a test suite
that needs a JVM to pass is a test suite that stops being run.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from aegis.firestore import COLLECTIONS, FirestoreMirror, _to_firestore


# ---------------------------------------------------------------------------
# A minimal in-memory stand-in for the Firestore client
# ---------------------------------------------------------------------------


class FakeDoc:
    def __init__(self, store, collection, doc_id):
        self._store = store
        self._collection = collection
        self._id = doc_id

    def set(self, payload, merge=False):
        self._store.setdefault(self._collection, {})[self._id] = payload


class FakeCollection:
    def __init__(self, store, name):
        self._store = store
        self._name = name

    def document(self, doc_id):
        return FakeDoc(self._store, self._name, doc_id)


class FakeBatch:
    def __init__(self, store):
        self._store = store
        self._pending = []
        self.commits = 0

    def set(self, doc, payload, merge=False):
        self._pending.append((doc, payload))

    def commit(self):
        for doc, payload in self._pending:
            doc.set(payload)
        self._pending = []
        self.commits += 1


class FakeFirestore:
    def __init__(self):
        self.store: dict[str, dict] = {}
        self.batches: list[FakeBatch] = []

    def collection(self, name):
        return FakeCollection(self.store, name)

    def batch(self):
        batch = FakeBatch(self.store)
        self.batches.append(batch)
        return batch


class ExplodingFirestore(FakeFirestore):
    """Every operation fails. Stands in for an outage or a bad credential."""

    def collection(self, name):
        raise RuntimeError("firestore unreachable")

    def batch(self):
        raise RuntimeError("firestore unreachable")


class FakeRow:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


def decision_row(**overrides):
    base = dict(
        action_id="act_1",
        agent_id="ag_1",
        operator_id="op_1",
        card_member_id="cm_1",
        verdict="DENY",
        reason_code="prohibited_attribute_veto",
        human_readable_reason="Blocked: gift cards aren't covered.",
        winning_rule="prohibited_attribute_veto",
        ruleset_hash="r" * 64,
        flagged=False,
        merchant_id="m_1",
        merchant_name="DailyMart Digital",
        merchant_category="5411",
        merchant_attributes=[],
        cart_items=[{"label": "Amazon gift card", "attributes": ["gift_card"]}],
        cart_digest="c" * 64,
        ship_to="Office",
        injected_instruction=None,
        amount=Decimal("4980.00"),
        currency="INR",
        description="",
        conformance_score=Decimal("0.0400"),
        conformance_available=True,
        conformance_rationale="Stored-value instrument.",
        model_version="deterministic-v1",
        delegation_chain=["ag_1"],
        step_up_state=None,
        latency_ms=12,
        decided_at=datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc),
        seed_kind="prohibited_attribute",
        seed_legitimate=False,
    )
    base.update(overrides)
    return FakeRow(**base)


# ---------------------------------------------------------------------------
# Inert when not configured
# ---------------------------------------------------------------------------


def test_mirror_is_inert_without_a_client():
    mirror = FirestoreMirror(enabled=False)
    assert mirror.enabled is False
    assert mirror.mirror_decision(decision_row()) is False


def test_enabled_flag_requires_an_actual_client():
    """enabled=True with no client must not claim to be enabled."""
    assert FirestoreMirror(client=None, enabled=True).enabled is False


# ---------------------------------------------------------------------------
# An outage cannot fail a decision
# ---------------------------------------------------------------------------


def test_a_firestore_outage_never_raises():
    """This is the property the whole design depends on: mirroring is a
    courtesy, and a courtesy must not be able to break an authorisation."""
    mirror = FirestoreMirror(client=ExplodingFirestore(), enabled=True)
    assert mirror.mirror_decision(decision_row()) is False  # reported, not raised


def test_bulk_mirroring_survives_an_outage_midway():
    mirror = FirestoreMirror(client=ExplodingFirestore(), enabled=True)
    written = mirror.mirror_many("decisions", [decision_row()], "action_id")
    assert written == 0


# ---------------------------------------------------------------------------
# Payload shape
# ---------------------------------------------------------------------------


def test_a_decision_is_mirrored_with_the_fields_the_console_needs():
    client = FakeFirestore()
    mirror = FirestoreMirror(client=client, enabled=True)
    assert mirror.mirror_decision(decision_row()) is True

    stored = client.store[COLLECTIONS["decisions"]]["act_1"]
    for field in [
        "verdict",
        "reason_code",
        "human_readable_reason",
        "cart_items",
        "ship_to",
        "conformance_score",
        "delegation_chain",
        "decided_at",
    ]:
        assert field in stored, f"{field} missing from the mirrored decision"


def test_money_is_stored_as_a_string_not_a_float():
    """Firestore has no decimal type. Storing money as a float would silently
    introduce rounding into the amount an audit later depends on."""
    client = FakeFirestore()
    FirestoreMirror(client=client, enabled=True).mirror_decision(
        decision_row(amount=Decimal("4980.55"))
    )
    stored = client.store[COLLECTIONS["decisions"]]["act_1"]

    assert stored["amount"] == "4980.55"
    assert isinstance(stored["amount"], str)
    # The numeric twin exists only so the console can sort.
    assert stored["amount_numeric"] == pytest.approx(4980.55)


def test_decimal_conversion_is_recursive():
    converted = _to_firestore(
        {"a": Decimal("1.50"), "b": [Decimal("2.25")], "c": {"d": Decimal("3.75")}}
    )
    assert converted == {"a": "1.50", "b": ["2.25"], "c": {"d": "3.75"}}


def test_the_cart_survives_the_trip():
    """The cart is the evidence that makes a gift-card denial explicable."""
    client = FakeFirestore()
    FirestoreMirror(client=client, enabled=True).mirror_decision(decision_row())
    stored = client.store[COLLECTIONS["decisions"]]["act_1"]

    assert stored["cart_items"][0]["label"] == "Amazon gift card"
    assert "gift_card" in stored["cart_items"][0]["attributes"]


def test_ground_truth_labels_are_mirrored():
    """The console computes the false-block rate from these."""
    client = FakeFirestore()
    FirestoreMirror(client=client, enabled=True).mirror_decision(decision_row())
    stored = client.store[COLLECTIONS["decisions"]]["act_1"]

    assert stored["seed_kind"] == "prohibited_attribute"
    assert stored["seed_legitimate"] is False


# ---------------------------------------------------------------------------
# Bulk
# ---------------------------------------------------------------------------


def test_bulk_writes_are_batched_under_the_firestore_cap():
    """Firestore rejects a batch over 500 writes, so 1,000 rows must split."""
    client = FakeFirestore()
    mirror = FirestoreMirror(client=client, enabled=True)

    rows = [decision_row(action_id=f"act_{i}") for i in range(1000)]
    written = mirror.mirror_many("decisions", rows, "action_id")

    assert written == 1000
    assert len(client.store[COLLECTIONS["decisions"]]) == 1000
    assert all(b.commits <= 1 for b in client.batches)
    assert len(client.batches) >= 3  # 1000 / 450, rounded up


def test_an_unknown_collection_is_a_programming_error():
    """Better to fail loudly here than to silently mirror nothing."""
    mirror = FirestoreMirror(client=FakeFirestore(), enabled=True)
    with pytest.raises(ValueError):
        mirror.mirror_many("nonexistent", [], "id")
