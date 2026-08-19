"""DEMO-ONLY endpoints. Not mounted unless AEGIS_ENABLE_DEMO=true.

This module exists so the ledger's tamper-evidence can be *demonstrated*
rather than asserted. It deliberately corrupts a stored record so that
/verify fails and names the row.

It lives here, behind a configuration flag and its own router, so that:
  * production images that leave AEGIS_ENABLE_DEMO unset cannot reach it
  * the ability to write to the ledger out-of-band is confined to one file
  * a reviewer can see exactly what "the demo cheats" would look like, and
    confirm that nothing else in the codebase does it

The tamper uses a raw UPDATE that deliberately bypasses the ORM guard. Against
Postgres, the trigger from migration 0001 will refuse it -- which is itself the
correct demonstration: the database will not permit the edit at all. Against
SQLite the triggers are dropped for the duration of the write, so the demo can
show a corrupted chain and a failing verification.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, text

from ..auth.security import DbSession, RequireOperator
from ..config import get_settings
from ..db.models import DecisionRow, LedgerEntry
from ..engine.types import utcnow
from ..firestore import get_mirror
from ..service import verify_ledger

logger = logging.getLogger(__name__)

router = APIRouter(tags=["demo"])


@router.post("/demo/tamper", summary="DEMO ONLY: corrupt a ledger record")
def tamper(
    db: DbSession,
    principal: RequireOperator,
    sequence: int | None = None,
) -> dict[str, Any]:
    """Alter a stored payload in place, leaving its self_hash untouched.

    This is precisely the attack the chain exists to detect: an edit that
    looks fine in isolation but no longer hashes to its recorded digest.
    """
    settings = get_settings()
    if not settings.enable_demo_endpoints:
        raise HTTPException(status_code=404, detail="Not found")

    target = (
        db.get(LedgerEntry, sequence)
        if sequence is not None
        else db.scalars(select(LedgerEntry).order_by(LedgerEntry.sequence).offset(2).limit(1)).first()
    )
    if target is None:
        raise HTTPException(status_code=404, detail="No ledger record to tamper with")

    logger.warning(
        "DEMO TAMPER: corrupting ledger record %s (sequence %s) at the request of %s",
        target.record_id,
        target.sequence,
        principal.email,
    )

    forged = dict(target.payload)
    original_verdict = forged.get("verdict")

    # Forge a verdict that is GUARANTEED to differ from the original. Writing a
    # fixed "ALLOW" silently no-ops on a record that already says ALLOW, and a
    # tamper demo that changes nothing "proves" the chain is broken when it is
    # not -- the most misleading possible outcome for this endpoint.
    if original_verdict == "ALLOW":
        forged["verdict"] = "DENY"
        forged["reason_code"] = "prohibited_attribute_veto"
        forged["human_readable_reason"] = "This purchase was blocked."
    else:
        forged["verdict"] = "ALLOW"
        forged["reason_code"] = "within_mandate"
        forged["human_readable_reason"] = "This purchase matched what you authorised."

    if forged == target.payload:  # nothing would change -- refuse rather than mislead
        raise HTTPException(
            status_code=409,
            detail="Tamper would not alter this record; pick a different sequence.",
        )

    dialect = db.bind.dialect.name if db.bind is not None else ""
    import json

    if dialect == "sqlite":
        # Drop the guards, write, restore. Confined to the demo path.
        db.execute(text("DROP TRIGGER IF EXISTS trg_ledger_no_update"))
        try:
            db.execute(
                text("UPDATE ledger SET payload = :p WHERE sequence = :s"),
                {"p": json.dumps(forged), "s": target.sequence},
            )
            db.commit()
        finally:
            db.execute(
                text(
                    """
                    CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update
                    BEFORE UPDATE ON ledger
                    BEGIN
                        SELECT RAISE(ABORT, 'ledger is append-only: UPDATE is not permitted');
                    END;
                    """
                )
            )
            db.commit()
    else:
        # Postgres will refuse. That refusal IS the demonstration.
        try:
            db.execute(
                text("UPDATE ledger SET payload = CAST(:p AS JSON) WHERE sequence = :s"),
                {"p": json.dumps(forged), "s": target.sequence},
            )
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            return {
                "tampered": False,
                "database_refused": True,
                "message": (
                    "The database refused the edit. The ledger table is append-only at "
                    "the storage layer, so history cannot be rewritten through SQL."
                ),
                "error": str(exc).splitlines()[0],
                "sequence": target.sequence,
            }

    # Same stale-read hazard as restore: the payload was rewritten via raw SQL,
    # so expire the identity map before recomputing the chain.
    db.expire_all()
    result = verify_ledger(db)
    return {
        "tampered": True,
        "database_refused": False,
        "sequence": target.sequence,
        "record_id": target.record_id,
        "original_verdict": original_verdict,
        "forged_verdict": forged["verdict"],
        "verification": result.to_dict(),
    }


@router.post("/demo/restore", summary="DEMO ONLY: rebuild the chain after a tamper")
def restore(db: DbSession, principal: RequireOperator) -> dict[str, Any]:
    """Recompute every self_hash so the chain verifies again.

    Only meaningful after /demo/tamper. In production this operation does not
    and must not exist -- a ledger you can 'repair' is not a ledger.
    """
    settings = get_settings()
    if not settings.enable_demo_endpoints:
        raise HTTPException(status_code=404, detail="Not found")

    from ..engine.ledger import GENESIS_HASH, compute_self_hash

    dialect = db.bind.dialect.name if db.bind is not None else ""
    if dialect != "sqlite":
        raise HTTPException(
            status_code=409,
            detail="Restore is only available on the SQLite demo database.",
        )

    db.execute(text("DROP TRIGGER IF EXISTS trg_ledger_no_update"))
    try:
        prev = GENESIS_HASH
        for row in db.scalars(select(LedgerEntry).order_by(LedgerEntry.sequence)):
            new_hash = compute_self_hash(prev, row.payload)
            db.execute(
                text("UPDATE ledger SET prev_hash = :p, self_hash = :h WHERE sequence = :s"),
                {"p": prev, "h": new_hash, "s": row.sequence},
            )
            prev = new_hash
        db.commit()
    finally:
        db.execute(
            text(
                """
                CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update
                BEFORE UPDATE ON ledger
                BEGIN
                    SELECT RAISE(ABORT, 'ledger is append-only: UPDATE is not permitted');
                END;
                """
            )
        )
        db.commit()

    # The rows were rewritten through raw SQL, so the session's identity map
    # still holds the pre-restore hashes. Without expiring it, verification
    # re-reads the stale objects and reports a break that is no longer there.
    db.expire_all()
    return {"restored": True, "verification": verify_ledger(db).to_dict()}


@router.post("/demo/warm-window", summary="DEMO ONLY: make recent activity recent")
def warm_window(
    db: DbSession,
    principal: RequireOperator,
    hours: int = Query(6, ge=1, le=72, description="Spread activity over this many hours."),
    count: int = Query(220, ge=10, le=2000, description="How many decisions to bring forward."),
) -> dict[str, Any]:
    """Shift the newest seeded decisions into the last few hours.

    WHY THIS EXISTS. The fleet tiles measure a rolling 24-hour window, which is
    the right window for an operations screen. But a seeded corpus ages: a demo
    given two days after seeding shows four zeros, which is arithmetically
    correct and completely useless on a projector.

    The alternative -- reseeding before every demo -- takes minutes and destroys
    any manual transactions the presenter has staged. This moves timestamps
    instead, so the SAME decisions the engine already produced now fall inside
    the window.

    WHAT IT DOES NOT DO. It does not invent decisions, and it does not change
    verdicts, amounts, reasons or scores. Every row was produced by the real
    engine; only the PROJECTION's `decided_at` moves.

    THE LEDGER IS NOT TOUCHED, and this is the important part. `decided_at` is
    inside the hashed ledger payload, but the ledger keeps its own immutable
    copy -- the `decisions` table is a queryable projection the console reads.
    So the chain still verifies afterwards, and the ledger continues to hold the
    true original timestamp. The two deliberately disagree, and the response
    says so: an audit would find the ledger, not the projection.

    This is honest to demonstrate. If asked, the answer is that the evidence
    chain was never altered -- only the display window was moved so a
    24-hour operations screen has something to show.
    """
    from sqlalchemy import text

    rows = list(
        db.scalars(
            select(DecisionRow).order_by(DecisionRow.decided_at.desc()).limit(count)
        )
    )
    if not rows:
        raise HTTPException(status_code=409, detail="No decisions to bring forward.")

    now = utcnow().replace(tzinfo=None)
    window = timedelta(hours=hours)
    # Spread them across the window newest-last, so the live stream reads as a
    # plausible trickle of activity rather than a single burst.
    step = window / max(len(rows) - 1, 1)
    for index, row in enumerate(reversed(rows)):
        row.decided_at = now - window + (step * index)
        if row.step_up_resolved_at is not None:
            row.step_up_resolved_at = row.decided_at + timedelta(minutes=3)
    db.commit()

    mirror = get_mirror()
    for row in rows:
        mirror.mirror_decision(row)

    return {
        "moved": len(rows),
        "window_hours": hours,
        "oldest": (now - window).isoformat() + "Z",
        "newest": now.isoformat() + "Z",
        "ledger_note": (
            "The ledger was NOT modified and still verifies: it keeps its own "
            "immutable copy of decided_at. Only the queryable projection moved, "
            "so the console's 24-hour window has activity to show. The ledger "
            "retains the true original timestamps."
        ),
    }
