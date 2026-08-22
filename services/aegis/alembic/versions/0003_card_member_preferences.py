"""Add the card_member_preferences table -- a member's diligence bar.

Like the columns in 0002, this table reached the ORM model without a migration,
because SQLite development runs on ``create_all``. Adding it here means a fresh
Postgres deployment gets the table instead of failing on first read.

Absent rows are meaningful: a member who has never opened the standards panel
has no row, and the engine applies the documented defaults. So there is no
backfill -- an empty table is the correct initial state.

Revision ID: 0003_card_member_preferences
Revises: 0002_decision_triage_columns
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_card_member_preferences"
down_revision = "0002_decision_triage_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "card_member_preferences",
        sa.Column("card_member_id", sa.String(64), primary_key=True),
        sa.Column("min_rating", sa.Numeric(3, 2), nullable=False, server_default="3.5"),
        sa.Column("min_reviews", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("price_tolerance", sa.Numeric(4, 3), nullable=False, server_default="0.25"),
        sa.Column(
            "require_diligence", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("card_member_preferences")
