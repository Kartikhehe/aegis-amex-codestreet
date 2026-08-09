"""Ledger immutability for engines without PL/pgSQL (i.e. SQLite in tests).

Postgres enforces append-only with triggers and REVOKE (see the migration).
SQLite has neither roles nor procedural triggers of that kind, so the same
guarantee is installed here as SQLAlchemy ORM events plus a SQLite trigger.

This is NOT the production mechanism -- it exists so the test suite exercises
the same invariant the database enforces in production, rather than testing a
weaker version of the system than the one that ships.
"""

from __future__ import annotations

from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from .models import LedgerEntry


class LedgerImmutabilityError(RuntimeError):
    """Raised when anything attempts to modify or remove a ledger row."""


def install_orm_guards() -> None:
    """Block UPDATE/DELETE of LedgerEntry through the ORM."""

    @event.listens_for(Session, "before_flush")
    def _guard(session: Session, flush_context, instances) -> None:  # noqa: ANN001
        for obj in session.dirty:
            if isinstance(obj, LedgerEntry) and session.is_modified(obj):
                raise LedgerImmutabilityError(
                    f"ledger is append-only: attempted UPDATE of record "
                    f"{getattr(obj, 'record_id', '?')}"
                )
        for obj in session.deleted:
            if isinstance(obj, LedgerEntry):
                raise LedgerImmutabilityError(
                    f"ledger is append-only: attempted DELETE of record "
                    f"{getattr(obj, 'record_id', '?')}"
                )


def install_sqlite_triggers(engine: Engine) -> None:
    """Install SQLite triggers so raw SQL is blocked too, not just the ORM.

    Without this, `session.execute(text("UPDATE ledger ..."))` would bypass the
    ORM guard -- and that is exactly the path an attacker would take.
    """
    if engine.dialect.name != "sqlite":
        return

    with engine.begin() as conn:
        conn.execute(
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
        conn.execute(
            text(
                """
                CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete
                BEFORE DELETE ON ledger
                BEGIN
                    SELECT RAISE(ABORT, 'ledger is append-only: DELETE is not permitted');
                END;
                """
            )
        )
        # Chain continuity, mirroring the Postgres trigger.
        conn.execute(
            text(
                """
                CREATE TRIGGER IF NOT EXISTS trg_ledger_chain_continuity
                BEFORE INSERT ON ledger
                FOR EACH ROW
                WHEN NEW.prev_hash <> COALESCE(
                    (SELECT self_hash FROM ledger ORDER BY sequence DESC LIMIT 1),
                    '0000000000000000000000000000000000000000000000000000000000000000'
                )
                BEGIN
                    SELECT RAISE(ABORT, 'ledger chain break: prev_hash does not match head');
                END;
                """
            )
        )
