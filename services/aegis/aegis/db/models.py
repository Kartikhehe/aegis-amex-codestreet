"""SQLAlchemy models.

The ledger table is the one that matters. Its immutability is enforced by the
database (see alembic/versions/0001_initial.py): UPDATE and DELETE are revoked
from the application role and a trigger raises on either. Application code
CANNOT rewrite history even if it is compromised or buggy.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


# SQLite only auto-increments a PRIMARY KEY declared exactly as INTEGER, so a
# BIGINT sequence column would refuse to autogenerate there. Postgres keeps the
# 64-bit width it needs for a ledger that is expected to grow without bound.
BigIntPk = BigInteger().with_variant(Integer, "sqlite")


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Operator(Base):
    __tablename__ = "operators"

    operator_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    agents: Mapped[list["AgentRow"]] = relationship(back_populates="operator")


class AgentRow(Base):
    __tablename__ = "agents"

    agent_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    operator_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("operators.operator_id"), nullable=False, index=True
    )
    card_member_id: Mapped[str | None] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_agent_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("agents.agent_id"), index=True
    )
    depth: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    breaker_tripped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Mandate, denormalised: a mandate is meaningless apart from its agent, and
    # keeping it here means one read serves an authorisation decision.
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    permitted_categories: Mapped[list] = mapped_column(JSON, default=list)
    prohibited_attributes: Mapped[list] = mapped_column(JSON, default=list)
    permitted_merchants: Mapped[list | None] = mapped_column(JSON, nullable=True)
    per_transaction_ceiling: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    daily_ceiling: Mapped[float] = mapped_column(Numeric(14, 2), default=0)
    max_transactions_per_day: Mapped[int] = mapped_column(Integer, default=0)
    max_delegation_depth: Mapped[int] = mapped_column(Integer, default=0)
    purpose_keywords: Mapped[list] = mapped_column(JSON, default=list)
    ship_to: Mapped[str | None] = mapped_column(String(300))
    cadence: Mapped[str] = mapped_column(String(16), default="weekly")
    principal_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    mandate_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mandate_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    operator: Mapped["Operator"] = relationship(back_populates="agents")

    __table_args__ = (
        CheckConstraint("status in ('active','suspended','revoked')", name="ck_agent_status"),
        CheckConstraint("depth >= 0", name="ck_agent_depth"),
    )


class DecisionRow(Base):
    """Queryable projection of a decision.

    The ledger is the record of truth; this table exists so the console can
    filter and aggregate without recomputing hashes. It is derived data.
    """

    __tablename__ = "decisions"

    action_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    operator_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    card_member_id: Mapped[str | None] = mapped_column(String(64), index=True)

    verdict: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    human_readable_reason: Mapped[str] = mapped_column(Text, nullable=False)
    winning_rule: Mapped[str] = mapped_column(String(64), nullable=False)
    ruleset_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    merchant_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    merchant_name: Mapped[str] = mapped_column(String(200), nullable=False)
    merchant_category: Mapped[str] = mapped_column(String(8), index=True, nullable=False)
    merchant_attributes: Mapped[list] = mapped_column(JSON, default=list)
    cart_items: Mapped[list] = mapped_column(JSON, default=list)
    cart_digest: Mapped[str] = mapped_column(String(64), default="")
    ship_to: Mapped[str | None] = mapped_column(String(300))
    injected_instruction: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), index=True)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    description: Mapped[str] = mapped_column(Text, default="")

    conformance_score: Mapped[float | None] = mapped_column(Numeric(5, 4))
    conformance_available: Mapped[bool] = mapped_column(Boolean, default=True)
    conformance_rationale: Mapped[str] = mapped_column(Text, default="")
    model_version: Mapped[str] = mapped_column(String(64), default="")
    prompt_hash: Mapped[str] = mapped_column(String(64), default="")

    delegation_chain: Mapped[list] = mapped_column(JSON, default=list)
    rules_fired: Mapped[list] = mapped_column(JSON, default=list)
    features: Mapped[dict] = mapped_column(JSON, default=dict)

    # GROUND TRUTH from the seed generator. Null for real traffic, where no
    # such label can exist. This is what makes the false-block rate honest:
    # the generator knows which actions were legitimate, so a DENY on one is a
    # measured mistake rather than an assumption.
    seed_kind: Mapped[str | None] = mapped_column(String(32), index=True)
    seed_legitimate: Mapped[bool | None] = mapped_column(Boolean, index=True)

    # STEP_UP resolution, written when the card member responds.
    step_up_state: Mapped[str | None] = mapped_column(String(16), index=True)
    step_up_resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # WRONGLY-BLOCKED REPORT, from the only person who can actually know.
    #
    # seed_legitimate above is ground truth the generator happens to have; real
    # traffic has none, so without this the false-block rate could only ever be
    # measured over synthetic data. A card member saying "I did want that" is
    # the real-world signal, and an operator confirming it is what makes it
    # countable. Stored on the decision, never in the hashed ledger payload:
    # the verdict is immutable, and this is a later judgement ABOUT it.
    block_report: Mapped[str | None] = mapped_column(String(16), index=True)
    """'wrong' (member wanted it), 'correct' (member agrees), or null."""
    block_report_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    block_report_confirmed: Mapped[bool | None] = mapped_column(Boolean, index=True)
    """Set by an operator reviewing the member's report. Only confirmed
    reports count toward the measured false-block rate."""

    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    decided_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True, nullable=False
    )

    __table_args__ = (
        CheckConstraint("verdict in ('ALLOW','DENY','STEP_UP','HOLD')", name="ck_verdict"),
        Index("ix_decisions_agent_time", "agent_id", "decided_at"),
        Index("ix_decisions_verdict_time", "verdict", "decided_at"),
    )


class LedgerEntry(Base):
    """APPEND ONLY. Enforced at the database level -- see the migration.

    Nothing in the application may UPDATE or DELETE a row here. The chain is
    only worth as much as that guarantee.
    """

    __tablename__ = "ledger"

    sequence: Mapped[int] = mapped_column(BigIntPk, primary_key=True, autoincrement=True)
    record_id: Mapped[str] = mapped_column(String(64), default=_uuid, unique=True, nullable=False)
    action_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    agent_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)

    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    self_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False, index=True
    )

    __table_args__ = (
        CheckConstraint("length(prev_hash) = 64", name="ck_prev_hash_len"),
        CheckConstraint("length(self_hash) = 64", name="ck_self_hash_len"),
    )


class MerkleCheckpoint(Base):
    """Nightly anchor. Pins the chain to a point in time."""

    __tablename__ = "merkle_checkpoints"

    checkpoint_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    from_sequence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    to_sequence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    merkle_root: Mapped[str] = mapped_column(String(64), nullable=False)
    record_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (UniqueConstraint("from_sequence", "to_sequence", name="uq_checkpoint_range"),)


class ComplianceEventRow(Base):
    __tablename__ = "compliance_events"

    event_id: Mapped[str] = mapped_column(String(96), primary_key=True)
    breaker: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(String(64), index=True, default="")
    operator_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    suspected_prompt_injection: Mapped[bool] = mapped_column(
        Boolean, default=False, index=True
    )
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )


class Dispute(Base):
    __tablename__ = "disputes"

    dispute_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    action_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    card_member_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="open", index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    liable_party: Mapped[str | None] = mapped_column(String(32), index=True)
    packet: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PolicyVersion(Base):
    __tablename__ = "policy_versions"

    policy_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    stage: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    thresholds: Mapped[dict] = mapped_column(JSON, nullable=False)
    ruleset_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("stage in ('draft','shadow','enforcing')", name="ck_policy_stage"),
        UniqueConstraint("name", "version", name="uq_policy_name_version"),
    )


class FleetState(Base):
    """Single-row table holding the emergency stop.

    Re-arming requires two distinct approvals, recorded here, because a control
    that one person can switch off is not a control.
    """

    __tablename__ = "fleet_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    stopped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    stopped_by: Mapped[str | None] = mapped_column(String(120))
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stop_reason: Mapped[str] = mapped_column(Text, default="")
    rearm_approvals: Mapped[list] = mapped_column(JSON, default=list)

    __table_args__ = (CheckConstraint("id = 1", name="ck_fleet_state_singleton"),)


class User(Base):
    __tablename__ = "users"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    operator_id: Mapped[str | None] = mapped_column(String(64), index=True)
    card_member_id: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        CheckConstraint(
            "role in ('operator','agent_operator','card_member')", name="ck_user_role"
        ),
    )


class MerchantRow(Base):
    __tablename__ = "merchants"

    merchant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(8), index=True, nullable=False)
    attributes: Mapped[list] = mapped_column(JSON, default=list)
