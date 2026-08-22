"""Add the eval-corpus tag and the block-report triage columns to decisions.

These four columns arrived on the ORM model but never got a migration, because
day-to-day development runs on SQLite via ``create_all`` -- which silently
creates whatever the model declares. Postgres has no such escape hatch, so the
drift only surfaced the first time the seed ran against it.

All four are nullable, so this is purely additive: existing rows keep NULL and
no backfill is needed.

Revision ID: 0002_decision_triage_columns
Revises: 0001_initial
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_decision_triage_columns"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

# (column, type) -- every one of these is indexed except the timestamp, which is
# only ever read alongside its own row.
_COLUMNS = (
    ("seed_corpus", sa.String(16), True),
    ("block_report", sa.String(16), True),
    ("block_report_at", sa.DateTime(timezone=True), False),
    ("block_report_confirmed", sa.Boolean(), True),
)


def upgrade() -> None:
    for name, type_, indexed in _COLUMNS:
        op.add_column("decisions", sa.Column(name, type_, nullable=True))
        if indexed:
            op.create_index(f"ix_decisions_{name}", "decisions", [name])


def downgrade() -> None:
    for name, _type, indexed in reversed(_COLUMNS):
        if indexed:
            op.drop_index(f"ix_decisions_{name}", table_name="decisions")
        op.drop_column("decisions", name)
