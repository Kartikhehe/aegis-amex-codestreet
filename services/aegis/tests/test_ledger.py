"""ledger.py -- chain construction, canonicalisation, tamper detection, Merkle."""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from aegis.engine.ledger import (
    GENESIS_HASH,
    build_record,
    compute_self_hash,
    merkle_root,
    verify_records,
)
from aegis.engine.policy import evaluate
from aegis.engine.types import ActionRequest, ConformanceResult, canonical_json, sha256_hex


def _records(context, good_score, count=10):
    out = []
    prev = GENESIS_HASH
    for i in range(count):
        action = ActionRequest(
            action_id=f"act_{i:04d}",
            agent_id="ag_pantry",
            merchant_id="mch_freshmart",
            merchant_name="FreshMart Daily Grocers",
            merchant_category="5411",
            amount=Decimal("750"),
            requested_at=context.now,
        )
        record = build_record(i + 1, f"rec_{i:04d}", evaluate(action, context, good_score), prev)
        out.append(record)
        prev = record.self_hash
    return out


# ---------------------------------------------------------------------------
# Canonical JSON -- the root of trust
# ---------------------------------------------------------------------------


def test_canonical_json_is_key_order_independent():
    assert canonical_json({"b": 1, "a": 2}) == canonical_json({"a": 2, "b": 1})


def test_canonical_json_normalises_decimal_scale():
    """₹5000 and ₹5000.00 are the same money and must hash the same."""
    assert canonical_json({"amt": Decimal("5000")}) == canonical_json({"amt": Decimal("5000.00")})


def test_canonical_json_normalises_timezone():
    naive = datetime(2026, 3, 1, 12, 0, 0)
    aware = datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc)
    assert canonical_json({"t": naive}) == canonical_json({"t": aware})


def test_canonical_json_rejects_nan():
    with pytest.raises(ValueError):
        canonical_json({"x": float("nan")})


def test_canonical_json_is_sorted_and_compact():
    out = canonical_json({"b": [3, 1], "a": "x"})
    assert out == '{"a":"x","b":[3,1]}'


# ---------------------------------------------------------------------------
# Chain construction
# ---------------------------------------------------------------------------


def test_genesis_record_links_to_zero_hash(context, good_score):
    records = _records(context, good_score, 1)
    assert records[0].prev_hash == GENESIS_HASH
    assert records[0].self_hash == compute_self_hash(GENESIS_HASH, records[0].payload)


def test_each_record_links_to_its_predecessor(context, good_score):
    records = _records(context, good_score)
    for previous, current in zip(records, records[1:]):
        assert current.prev_hash == previous.self_hash


def test_self_hash_is_reproducible_by_an_independent_implementation(context, good_score):
    """An auditor with the payload and prev_hash must get the same digest."""
    record = _records(context, good_score, 1)[0]
    independent = sha256_hex(
        record.prev_hash,
        json.dumps(
            json.loads(json.dumps(record.payload, sort_keys=True, separators=(",", ":"))),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ),
    )
    assert independent == record.self_hash


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


def test_empty_chain_verifies(context):
    result = verify_records([])
    assert result.ok is True
    assert result.records_checked == 0


def test_verify_reports_head_hash(context, good_score):
    records = _records(context, good_score)
    result = verify_records(records)
    assert result.head_hash == records[-1].self_hash


@pytest.mark.parametrize("index", [0, 4, 9])
def test_tamper_at_any_position_is_caught_at_that_position(context, good_score, index):
    records = _records(context, good_score)
    target = records[index]
    forged = dict(target.payload)
    forged["human_readable_reason"] = "Nothing untoward happened here."
    records[index] = replace(target, payload=forged)

    result = verify_records(records)
    assert result.ok is False
    assert result.first_broken_link.sequence == index + 1
    assert result.first_broken_link.record_id == f"rec_{index:04d}"
    assert result.first_broken_link.failure == "self_hash_mismatch"


def test_a_reordered_chain_is_caught(context, good_score):
    records = _records(context, good_score)
    records[3], records[4] = records[4], records[3]
    result = verify_records(records)
    assert result.ok is False
    assert result.first_broken_link.failure == "prev_hash_mismatch"


def test_recomputing_the_forged_hash_still_fails(context, good_score):
    """The sophisticated attack: edit the payload AND recompute self_hash.

    It fails at the NEXT record, whose prev_hash still points at the original
    digest. That is the property that makes the chain worth having.
    """
    records = _records(context, good_score)
    target = records[3]
    forged_payload = dict(target.payload)
    forged_payload["human_readable_reason"] = "Nothing untoward happened here."
    records[3] = replace(
        target,
        payload=forged_payload,
        self_hash=compute_self_hash(target.prev_hash, forged_payload),
    )

    result = verify_records(records)
    assert result.ok is False
    assert result.first_broken_link.sequence == 5  # the following record
    assert result.first_broken_link.failure == "prev_hash_mismatch"


def test_rewriting_the_entire_tail_is_caught_by_a_checkpoint(context, good_score):
    """If an attacker rewrites a record and every record after it, the chain is
    internally consistent again -- which is exactly why we publish Merkle
    checkpoints. The recomputed root no longer matches the published one."""
    records = _records(context, good_score)
    published_root = merkle_root([r.self_hash for r in records])

    forged = []
    prev = GENESIS_HASH
    for i, record in enumerate(records):
        payload = dict(record.payload)
        if i == 3:
            payload["human_readable_reason"] = "Nothing untoward happened here."
        rebuilt = replace(record, payload=payload, prev_hash=prev,
                          self_hash=compute_self_hash(prev, payload))
        forged.append(rebuilt)
        prev = rebuilt.self_hash

    assert verify_records(forged).ok is True  # internally consistent...
    assert merkle_root([r.self_hash for r in forged]) != published_root  # ...but detected


# ---------------------------------------------------------------------------
# Merkle
# ---------------------------------------------------------------------------


def test_merkle_root_is_stable_and_sensitive():
    leaves = [sha256_hex(str(i)) for i in range(7)]
    assert merkle_root(leaves) == merkle_root(list(leaves))

    changed = list(leaves)
    changed[3] = sha256_hex("tampered")
    assert merkle_root(changed) != merkle_root(leaves)


def test_merkle_root_of_empty_is_genesis():
    assert merkle_root([]) == GENESIS_HASH


def test_merkle_root_handles_odd_counts():
    for n in (1, 2, 3, 5, 8, 13):
        assert len(merkle_root([sha256_hex(str(i)) for i in range(n)])) == 64
