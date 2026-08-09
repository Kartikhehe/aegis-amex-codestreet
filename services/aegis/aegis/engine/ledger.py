"""Append-only, hash-chained decision ledger.

Every record stores:

    payload    -- the canonical JSON of the decision
    prev_hash  -- self_hash of the record before it (genesis: 64 zeros)
    self_hash  -- sha256(prev_hash + canonical_payload)

Because self_hash covers prev_hash, changing any historical record invalidates
every record after it. `verify()` recomputes the whole chain and reports the
FIRST broken link -- the row where expected and actual diverge -- which is the
tamper point.

Immutability is enforced at the DATABASE level, not in application code: the
migration revokes UPDATE and DELETE on the table and installs a trigger that
raises on either. An attacker with the app's DB credentials still cannot
rewrite history through normal SQL.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable, Optional, Sequence

from .types import Decision, canonical_json, sha256_hex, to_json_primitives, utcnow

GENESIS_HASH = "0" * 64


def compute_self_hash(prev_hash: str, payload: Any) -> str:
    """The chain rule. Deliberately trivial so it can be reimplemented by an
    auditor in any language and produce identical results."""
    return sha256_hex(prev_hash, canonical_json(payload))


@dataclass(frozen=True)
class LedgerRecord:
    sequence: int
    record_id: str
    action_id: str
    agent_id: str
    payload: dict[str, Any]
    prev_hash: str
    self_hash: str
    recorded_at: datetime

    def recompute(self) -> str:
        return compute_self_hash(self.prev_hash, self.payload)


@dataclass(frozen=True)
class BrokenLink:
    """The first place the chain stops verifying."""

    sequence: int
    record_id: str
    action_id: str
    expected_hash: str
    actual_hash: str
    failure: str
    """Either 'self_hash_mismatch' (payload was altered) or
    'prev_hash_mismatch' (a record was removed or reordered)."""


@dataclass(frozen=True)
class VerificationResult:
    ok: bool
    records_checked: int
    duration_ms: int
    first_broken_link: Optional[BrokenLink] = None
    from_sequence: Optional[int] = None
    to_sequence: Optional[int] = None
    head_hash: str = GENESIS_HASH

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "records_checked": self.records_checked,
            "duration_ms": self.duration_ms,
            "from_sequence": self.from_sequence,
            "to_sequence": self.to_sequence,
            "head_hash": self.head_hash,
            "first_broken_link": (
                None
                if self.first_broken_link is None
                else {
                    "sequence": self.first_broken_link.sequence,
                    "record_id": self.first_broken_link.record_id,
                    "action_id": self.first_broken_link.action_id,
                    "expected_hash": self.first_broken_link.expected_hash,
                    "actual_hash": self.first_broken_link.actual_hash,
                    "failure": self.first_broken_link.failure,
                }
            ),
        }


def verify_records(
    records: Sequence[LedgerRecord],
    expected_start_prev_hash: str = GENESIS_HASH,
) -> VerificationResult:
    """Recompute the chain over `records` (ascending sequence).

    Two distinct failures are detected:
      * self_hash_mismatch -- the stored payload no longer hashes to its
        stored self_hash. Someone edited a record in place.
      * prev_hash_mismatch -- this record's prev_hash does not equal the
        previous record's self_hash. A record was deleted, reordered, or
        inserted.
    """
    started = time.perf_counter()
    prev = expected_start_prev_hash
    checked = 0

    for record in records:
        checked += 1

        if record.prev_hash != prev:
            return VerificationResult(
                ok=False,
                records_checked=checked,
                duration_ms=_ms(started),
                from_sequence=records[0].sequence if records else None,
                to_sequence=records[-1].sequence if records else None,
                head_hash=prev,
                first_broken_link=BrokenLink(
                    sequence=record.sequence,
                    record_id=record.record_id,
                    action_id=record.action_id,
                    expected_hash=prev,
                    actual_hash=record.prev_hash,
                    failure="prev_hash_mismatch",
                ),
            )

        recomputed = record.recompute()
        if recomputed != record.self_hash:
            return VerificationResult(
                ok=False,
                records_checked=checked,
                duration_ms=_ms(started),
                from_sequence=records[0].sequence if records else None,
                to_sequence=records[-1].sequence if records else None,
                head_hash=prev,
                first_broken_link=BrokenLink(
                    sequence=record.sequence,
                    record_id=record.record_id,
                    action_id=record.action_id,
                    expected_hash=record.self_hash,
                    actual_hash=recomputed,
                    failure="self_hash_mismatch",
                ),
            )

        prev = record.self_hash

    return VerificationResult(
        ok=True,
        records_checked=checked,
        duration_ms=_ms(started),
        from_sequence=records[0].sequence if records else None,
        to_sequence=records[-1].sequence if records else None,
        head_hash=prev,
    )


def _ms(started: float) -> int:
    return max(int((time.perf_counter() - started) * 1000), 0)


def build_record(
    sequence: int,
    record_id: str,
    decision: Decision,
    prev_hash: str,
    recorded_at: Optional[datetime] = None,
) -> LedgerRecord:
    # Normalise to plain JSON primitives before hashing: the digest must be
    # reproducible from the persisted row alone, by any JSON parser.
    payload = to_json_primitives(decision.to_canonical())
    return LedgerRecord(
        sequence=sequence,
        record_id=record_id,
        action_id=decision.action_id,
        agent_id=decision.agent_id,
        payload=payload,
        prev_hash=prev_hash,
        self_hash=compute_self_hash(prev_hash, payload),
        recorded_at=recorded_at or utcnow(),
    )


# ---------------------------------------------------------------------------
# Merkle checkpointing
#
# The chain proves internal consistency, but a checkpoint published nightly
# (to a separate store, or externally) pins the chain to a point in time: an
# attacker who rewrites history must also match every published root.
# ---------------------------------------------------------------------------


def merkle_root(leaf_hashes: Iterable[str]) -> str:
    """Standard binary Merkle root over the leaves' self_hashes.

    Odd nodes at a level are promoted (duplicated-last is a known malleability
    footgun, so we promote instead).
    """
    level = list(leaf_hashes)
    if not level:
        return GENESIS_HASH
    while len(level) > 1:
        nxt: list[str] = []
        for i in range(0, len(level) - 1, 2):
            nxt.append(sha256_hex(level[i], level[i + 1]))
        if len(level) % 2 == 1:
            nxt.append(level[-1])
        level = nxt
    return level[0]
