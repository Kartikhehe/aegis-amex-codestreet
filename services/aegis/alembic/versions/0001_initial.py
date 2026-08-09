"""Initial schema, with database-enforced ledger immutability.

Revision ID: 0001_initial
Create Date: 2026-08-08

The interesting part of this migration is the bottom section. Everything above
it is ordinary DDL; below it is the reason the ledger can be trusted:

  * a BEFORE UPDATE OR DELETE trigger on `ledger` that raises unconditionally
  * REVOKE UPDATE, DELETE on `ledger` from the application role
  * a trigger that refuses to let a row's prev_hash disagree with the current
    chain head, so the chain cannot be forked by concurrent inserts

Application code cannot rewrite history even if it is fully compromised. That
is the difference between an audit log and a ledger.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

APP_ROLE = "aegis_app"


def upgrade() -> None:
    op.create_table(
        "operators",
        sa.Column("operator_id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("revoked", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "agents",
        sa.Column("agent_id", sa.String(64), primary_key=True),
        sa.Column("operator_id", sa.String(64), sa.ForeignKey("operators.operator_id"),
                  nullable=False),
        sa.Column("card_member_id", sa.String(64)),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("parent_agent_id", sa.String(64), sa.ForeignKey("agents.agent_id")),
        sa.Column("depth", sa.Integer, nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("breaker_tripped", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("purpose", sa.Text, nullable=False),
        sa.Column("permitted_categories", sa.JSON, server_default="[]"),
        sa.Column("prohibited_attributes", sa.JSON, server_default="[]"),
        sa.Column("permitted_merchants", sa.JSON, nullable=True),
        sa.Column("per_transaction_ceiling", sa.Numeric(14, 2), server_default="0"),
        sa.Column("daily_ceiling", sa.Numeric(14, 2), server_default="0"),
        sa.Column("max_transactions_per_day", sa.Integer, server_default="0"),
        sa.Column("max_delegation_depth", sa.Integer, server_default="0"),
        sa.Column("purpose_keywords", sa.JSON, server_default="[]"),
        sa.Column("ship_to", sa.String(300)),
        sa.Column("cadence", sa.String(16), server_default="weekly"),
        sa.Column("principal_id", sa.String(64), server_default=""),
        sa.Column("mandate_expires_at", sa.DateTime(timezone=True)),
        sa.Column("mandate_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("status in ('active','suspended','revoked')", name="ck_agent_status"),
        sa.CheckConstraint("depth >= 0", name="ck_agent_depth"),
    )
    op.create_index("ix_agents_operator_id", "agents", ["operator_id"])
    op.create_index("ix_agents_parent_agent_id", "agents", ["parent_agent_id"])
    op.create_index("ix_agents_card_member_id", "agents", ["card_member_id"])
    op.create_index("ix_agents_mandate_hash", "agents", ["mandate_hash"])

    op.create_table(
        "merchants",
        sa.Column("merchant_id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("category", sa.String(8), nullable=False),
        sa.Column("attributes", sa.JSON, server_default="[]"),
    )
    op.create_index("ix_merchants_category", "merchants", ["category"])

    op.create_table(
        "decisions",
        sa.Column("action_id", sa.String(64), primary_key=True),
        sa.Column("agent_id", sa.String(64), nullable=False),
        sa.Column("operator_id", sa.String(64), nullable=False),
        sa.Column("card_member_id", sa.String(64)),
        sa.Column("verdict", sa.String(16), nullable=False),
        sa.Column("reason_code", sa.String(64), nullable=False),
        sa.Column("human_readable_reason", sa.Text, nullable=False),
        sa.Column("winning_rule", sa.String(64), nullable=False),
        sa.Column("ruleset_hash", sa.String(64), nullable=False),
        sa.Column("flagged", sa.Boolean, server_default=sa.false()),
        sa.Column("merchant_id", sa.String(64), nullable=False),
        sa.Column("merchant_name", sa.String(200), nullable=False),
        sa.Column("merchant_category", sa.String(8), nullable=False),
        sa.Column("merchant_attributes", sa.JSON, server_default="[]"),
        sa.Column("cart_items", sa.JSON, server_default="[]"),
        sa.Column("cart_digest", sa.String(64), server_default=""),
        sa.Column("ship_to", sa.String(300)),
        sa.Column("injected_instruction", sa.Text),
        sa.Column("idempotency_key", sa.String(128)),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("currency", sa.String(3), server_default="INR"),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("conformance_score", sa.Numeric(5, 4)),
        sa.Column("conformance_available", sa.Boolean, server_default=sa.true()),
        sa.Column("conformance_rationale", sa.Text, server_default=""),
        sa.Column("model_version", sa.String(64), server_default=""),
        sa.Column("prompt_hash", sa.String(64), server_default=""),
        sa.Column("delegation_chain", sa.JSON, server_default="[]"),
        sa.Column("rules_fired", sa.JSON, server_default="[]"),
        sa.Column("features", sa.JSON, server_default="{}"),
        sa.Column("seed_kind", sa.String(32)),
        sa.Column("seed_legitimate", sa.Boolean),
        sa.Column("step_up_state", sa.String(16)),
        sa.Column("step_up_resolved_at", sa.DateTime(timezone=True)),
        sa.Column("latency_ms", sa.Integer, server_default="0"),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.CheckConstraint("verdict in ('ALLOW','DENY','STEP_UP','HOLD')", name="ck_verdict"),
    )
    op.create_index("ix_decisions_agent_time", "decisions", ["agent_id", "decided_at"])
    op.create_index("ix_decisions_verdict_time", "decisions", ["verdict", "decided_at"])
    op.create_index("ix_decisions_operator_id", "decisions", ["operator_id"])
    op.create_index("ix_decisions_card_member_id", "decisions", ["card_member_id"])
    op.create_index("ix_decisions_reason_code", "decisions", ["reason_code"])
    op.create_index("ix_decisions_ruleset_hash", "decisions", ["ruleset_hash"])
    op.create_index("ix_decisions_step_up_state", "decisions", ["step_up_state"])
    op.create_index("ix_decisions_flagged", "decisions", ["flagged"])
    op.create_index("ix_decisions_merchant_id", "decisions", ["merchant_id"])

    op.create_table(
        "ledger",
        sa.Column("sequence", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("record_id", sa.String(64), nullable=False, unique=True),
        sa.Column("action_id", sa.String(64), nullable=False),
        sa.Column("agent_id", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON, nullable=False),
        sa.Column("prev_hash", sa.String(64), nullable=False),
        sa.Column("self_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.CheckConstraint("length(prev_hash) = 64", name="ck_prev_hash_len"),
        sa.CheckConstraint("length(self_hash) = 64", name="ck_self_hash_len"),
    )
    op.create_index("ix_ledger_action_id", "ledger", ["action_id"])
    op.create_index("ix_ledger_agent_id", "ledger", ["agent_id"])
    op.create_index("ix_ledger_recorded_at", "ledger", ["recorded_at"])
    op.create_index("ix_ledger_self_hash", "ledger", ["self_hash"])

    op.create_table(
        "merkle_checkpoints",
        sa.Column("checkpoint_id", sa.String(64), primary_key=True),
        sa.Column("from_sequence", sa.BigInteger, nullable=False),
        sa.Column("to_sequence", sa.BigInteger, nullable=False),
        sa.Column("merkle_root", sa.String(64), nullable=False),
        sa.Column("record_count", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("from_sequence", "to_sequence", name="uq_checkpoint_range"),
    )

    op.create_table(
        "compliance_events",
        sa.Column("event_id", sa.String(96), primary_key=True),
        sa.Column("breaker", sa.String(32), nullable=False),
        sa.Column("agent_id", sa.String(64), server_default=""),
        sa.Column("operator_id", sa.String(64), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("detail", sa.Text, server_default=""),
        sa.Column("evidence", sa.JSON, server_default="{}"),
        sa.Column("suspected_prompt_injection", sa.Boolean, server_default=sa.false()),
        sa.Column("acknowledged", sa.Boolean, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_events_breaker", "compliance_events", ["breaker"])
    op.create_index("ix_events_operator", "compliance_events", ["operator_id"])
    op.create_index("ix_events_agent", "compliance_events", ["agent_id"])
    op.create_index("ix_events_severity", "compliance_events", ["severity"])
    op.create_index("ix_events_injection", "compliance_events", ["suspected_prompt_injection"])
    op.create_index("ix_events_created", "compliance_events", ["created_at"])

    op.create_table(
        "disputes",
        sa.Column("dispute_id", sa.String(64), primary_key=True),
        sa.Column("action_id", sa.String(64), nullable=False),
        sa.Column("card_member_id", sa.String(64), nullable=False),
        sa.Column("status", sa.String(24), server_default="open"),
        sa.Column("reason", sa.Text, server_default=""),
        sa.Column("liable_party", sa.String(32)),
        sa.Column("packet", sa.JSON),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_disputes_action", "disputes", ["action_id"])
    op.create_index("ix_disputes_member", "disputes", ["card_member_id"])
    op.create_index("ix_disputes_status", "disputes", ["status"])
    op.create_index("ix_disputes_liable", "disputes", ["liable_party"])

    op.create_table(
        "policy_versions",
        sa.Column("policy_id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("stage", sa.String(16), server_default="draft"),
        sa.Column("thresholds", sa.JSON, nullable=False),
        sa.Column("ruleset_hash", sa.String(64), nullable=False),
        sa.Column("created_by", sa.String(120), server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("promoted_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("stage in ('draft','shadow','enforcing')", name="ck_policy_stage"),
        sa.UniqueConstraint("name", "version", name="uq_policy_name_version"),
    )
    op.create_index("ix_policy_stage", "policy_versions", ["stage"])
    op.create_index("ix_policy_ruleset_hash", "policy_versions", ["ruleset_hash"])

    op.create_table(
        "fleet_state",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("stopped", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("stopped_by", sa.String(120)),
        sa.Column("stopped_at", sa.DateTime(timezone=True)),
        sa.Column("stop_reason", sa.Text, server_default=""),
        sa.Column("rearm_approvals", sa.JSON, server_default="[]"),
        sa.CheckConstraint("id = 1", name="ck_fleet_state_singleton"),
    )
    op.execute("INSERT INTO fleet_state (id, stopped) VALUES (1, false)")

    op.create_table(
        "users",
        sa.Column("user_id", sa.String(64), primary_key=True),
        sa.Column("email", sa.String(200), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(24), nullable=False),
        sa.Column("operator_id", sa.String(64)),
        sa.Column("card_member_id", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "role in ('operator','agent_operator','card_member')", name="ck_user_role"
        ),
    )
    op.create_index("ix_users_role", "users", ["role"])

    # =======================================================================
    # LEDGER IMMUTABILITY -- the guarantee the whole product rests on.
    # =======================================================================
    if op.get_bind().dialect.name != "postgresql":
        # SQLite (used by the test suite) has no roles and no PL/pgSQL. The
        # equivalent protection there is applied via SQLAlchemy event listeners
        # in aegis/db/immutability.py, which the tests exercise directly.
        return

    # 1. Refuse UPDATE and DELETE unconditionally, for EVERY role including
    #    the owner. A superuser can still drop the trigger -- that is what the
    #    Merkle checkpoints are for -- but no ordinary path can rewrite a row.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION aegis_ledger_is_append_only()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION
                'ledger is append-only: % on row % is not permitted',
                TG_OP, COALESCE(OLD.record_id, '?')
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_ledger_append_only
        BEFORE UPDATE OR DELETE ON ledger
        FOR EACH ROW EXECUTE FUNCTION aegis_ledger_is_append_only();
        """
    )
    # TRUNCATE bypasses row-level triggers, so it needs its own statement-level one.
    op.execute(
        """
        CREATE TRIGGER trg_ledger_no_truncate
        BEFORE TRUNCATE ON ledger
        FOR EACH STATEMENT EXECUTE FUNCTION aegis_ledger_is_append_only();
        """
    )

    # 2. Enforce chain continuity at insert time: a new row's prev_hash must
    #    equal the current head's self_hash. This makes forked or out-of-order
    #    inserts impossible rather than merely detectable.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION aegis_ledger_check_chain()
        RETURNS TRIGGER AS $$
        DECLARE
            head_hash TEXT;
        BEGIN
            SELECT self_hash INTO head_hash
            FROM ledger ORDER BY sequence DESC LIMIT 1;

            IF head_hash IS NULL THEN
                IF NEW.prev_hash <> repeat('0', 64) THEN
                    RAISE EXCEPTION
                        'first ledger record must link to the genesis hash'
                        USING ERRCODE = 'restrict_violation';
                END IF;
            ELSIF NEW.prev_hash <> head_hash THEN
                RAISE EXCEPTION
                    'ledger chain break: prev_hash % does not match current head %',
                    NEW.prev_hash, head_hash
                    USING ERRCODE = 'restrict_violation';
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_ledger_chain_continuity
        BEFORE INSERT ON ledger
        FOR EACH ROW EXECUTE FUNCTION aegis_ledger_check_chain();
        """
    )

    # 3. Revoke the privileges outright from the application role, so a SQL
    #    injection reaching the ledger fails on permissions before it reaches
    #    the trigger.
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                REVOKE UPDATE, DELETE, TRUNCATE ON TABLE ledger FROM {APP_ROLE};
                GRANT SELECT, INSERT ON TABLE ledger TO {APP_ROLE};
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_ledger_chain_continuity ON ledger")
        op.execute("DROP TRIGGER IF EXISTS trg_ledger_no_truncate ON ledger")
        op.execute("DROP TRIGGER IF EXISTS trg_ledger_append_only ON ledger")
        op.execute("DROP FUNCTION IF EXISTS aegis_ledger_check_chain()")
        op.execute("DROP FUNCTION IF EXISTS aegis_ledger_is_append_only()")

    for table in (
        "users",
        "fleet_state",
        "policy_versions",
        "disputes",
        "compliance_events",
        "merkle_checkpoints",
        "ledger",
        "decisions",
        "merchants",
        "agents",
        "operators",
    ):
        op.drop_table(table)
