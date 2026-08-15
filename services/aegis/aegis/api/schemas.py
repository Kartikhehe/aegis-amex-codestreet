"""Pydantic request/response models.

These define the OpenAPI surface the frontend client is generated from, so the
two cannot drift. Field descriptions here become the client's documentation.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class LoginRequest(ApiModel):
    email: str = Field(..., examples=["operator@aegis.test"])
    password: str = Field(..., examples=["password123"])


class UserOut(ApiModel):
    id: str = Field(..., alias="user_id")
    email: str
    name: str
    role: Literal["operator", "agent_operator", "card_member"]
    operator_id: Optional[str] = None
    card_member_id: Optional[str] = None
    avatar: Optional[str] = None


class LoginResponse(ApiModel):
    token: str
    user: UserOut
    firebase_token: Optional[str] = Field(
        None,
        description=(
            "Firebase custom token carrying the same role claims. Present only "
            "when Firestore is configured; the console falls back to REST when "
            "it is absent."
        ),
    )


# ---------------------------------------------------------------------------
# Decide
# ---------------------------------------------------------------------------


class CartItemIn(ApiModel):
    label: str
    attributes: list[str] = Field(default_factory=list)
    quantity: int = 1
    unit_amount: Decimal = Decimal("0")


class DecideRequest(ApiModel):
    agent_id: str
    merchant_id: str
    merchant_name: str
    merchant_category: str = Field(..., description="Merchant category code (MCC)")
    amount: Decimal = Field(..., gt=0)
    currency: str = "INR"
    description: str = ""
    merchant_attributes: list[str] = Field(
        default_factory=list,
        description=(
            "Ground-truth attributes of what is being sold, e.g. ['gift_card']. "
            "Prohibited attributes are vetoed deterministically before scoring."
        ),
    )
    action_id: Optional[str] = None

    cart_items: list[CartItemIn] = Field(
        default_factory=list,
        description=(
            "What is actually in the basket. Prohibited attributes are vetoed from "
            "here as well as from the merchant -- a grocery-coded shop selling a gift "
            "card is caught by the cart, not the category."
        ),
    )
    ship_to: Optional[str] = Field(
        None, description="Delivery destination, checked against the mandate's."
    )
    injected_instruction: Optional[str] = Field(
        None,
        description=(
            "Untrusted text the agent was fed (tool output, merchant page). Recorded "
            "as evidence and scored; never executed."
        ),
    )
    idempotency_key: Optional[str] = Field(
        None,
        description=(
            "Supply on retries. The same key returns the original decision instead "
            "of writing a second ledger record."
        ),
    )


class RuleOutcomeOut(ApiModel):
    rule_name: str
    matched: bool
    verdict: Optional[str] = None
    reason_code: Optional[str] = None
    detail: str = ""
    skipped: bool = False


class ConformanceOut(ApiModel):
    score: Optional[float]
    rationale: str
    vetoes: list[str] = Field(default_factory=list)
    model_version: str = ""
    prompt_hash: str = ""
    available: bool = True
    cached: bool = False


class LedgerRefOut(ApiModel):
    sequence: int
    record_id: str
    prev_hash: str
    self_hash: str


class ShadowOut(ApiModel):
    ruleset_hash: str
    policy_name: str
    verdict: str
    reason_code: str
    winning_rule: str
    differs: bool


class DecisionOut(ApiModel):
    action_id: str
    agent_id: str
    agent_name: str = ""
    operator_id: str = ""
    verdict: Literal["ALLOW", "DENY", "STEP_UP", "HOLD"]
    reason_code: str
    human_readable_reason: str
    winning_rule: str
    ruleset_hash: str
    flagged: bool = False
    merchant_id: str = ""
    merchant_name: str = ""
    merchant_category: str = ""
    merchant_attributes: list[str] = Field(default_factory=list)
    cart_items: list[dict[str, Any]] = Field(default_factory=list)
    cart_digest: str = ""
    ship_to: Optional[str] = None
    injected_instruction: Optional[str] = None
    amount: Decimal
    currency: str = "INR"
    description: str = ""
    conformance: Optional[ConformanceOut] = None
    delegation_chain: list[str] = Field(default_factory=list)
    rules_fired: list[RuleOutcomeOut] = Field(default_factory=list)
    features: dict[str, Any] = Field(default_factory=dict)
    step_up_state: Optional[str] = None

    # A later judgement ABOUT this decision, never part of it. The verdict is
    # immutable and hashed; these say what people concluded afterwards.
    block_report: Optional[str] = None
    block_report_confirmed: Optional[bool] = None
    latency_ms: int = 0
    decided_at: datetime
    ledger: Optional[LedgerRefOut] = None
    shadow: Optional[ShadowOut] = None


class DecisionPage(ApiModel):
    items: list[DecisionOut]
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------


class MandateOut(ApiModel):
    purpose: str
    permitted_categories: list[str] = Field(default_factory=list)
    prohibited_attributes: list[str] = Field(default_factory=list)
    permitted_merchants: Optional[list[str]] = None
    per_transaction_ceiling: Decimal
    daily_ceiling: Decimal
    max_transactions_per_day: int
    max_delegation_depth: int
    expires_at: Optional[datetime] = None
    mandate_hash: str


class AgentOut(ApiModel):
    agent_id: str
    operator_id: str
    operator_name: str = ""
    card_member_id: Optional[str] = None
    name: str
    parent_agent_id: Optional[str] = None
    depth: int
    status: Literal["active", "suspended", "revoked"]
    breaker_tripped: bool
    mandate: MandateOut
    created_at: datetime


class AgentTreeNode(ApiModel):
    agent_id: str
    name: str
    status: str
    depth: int
    breaker_tripped: bool = False
    per_transaction_ceiling: Decimal
    purpose: str
    children: list["AgentTreeNode"] = Field(default_factory=list)


class AgentStats(ApiModel):
    total_decisions: int = 0
    allowed: int = 0
    denied: int = 0
    stepped_up: int = 0
    spend_today: Decimal = Decimal("0")
    mean_conformance: Optional[float] = None
    conformance_series: list[dict[str, Any]] = Field(default_factory=list)


class AgentDetail(ApiModel):
    agent: AgentOut
    chain: list[AgentOut] = Field(default_factory=list)
    tree: Optional[AgentTreeNode] = None
    descendants: list[AgentOut] = Field(default_factory=list)
    stats: AgentStats = Field(default_factory=AgentStats)
    recent_decisions: list[DecisionOut] = Field(default_factory=list)


class MandateIn(ApiModel):
    purpose: str = Field(..., min_length=8)
    permitted_categories: list[str] = Field(default_factory=list)
    prohibited_attributes: list[str] = Field(default_factory=list)
    permitted_merchants: Optional[list[str]] = None
    per_transaction_ceiling: Decimal = Field(..., ge=0)
    daily_ceiling: Decimal = Field(..., ge=0)
    max_transactions_per_day: int = Field(..., ge=0)
    max_delegation_depth: int = Field(0, ge=0)
    expires_at: Optional[datetime] = None


class CreateAgentRequest(ApiModel):
    name: str = Field(..., min_length=2)
    operator_id: Optional[str] = None
    card_member_id: Optional[str] = None
    parent_agent_id: Optional[str] = Field(
        None, description="When set, the mandate is checked against the parent's via can_issue."
    )
    mandate: MandateIn


class DimensionViolationOut(ApiModel):
    dimension: str
    parent_value: str
    requested_value: str
    message: str


class IssuanceRejection(ApiModel):
    detail: str = "Sub-agent mandate exceeds the parent mandate"
    violations: list[DimensionViolationOut]


class RevokeResponse(ApiModel):
    revoked_agent_ids: list[str]
    count: int


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


class BrokenLinkOut(ApiModel):
    sequence: int
    record_id: str
    action_id: str
    expected_hash: str
    actual_hash: str
    failure: str


class VerifyResponse(ApiModel):
    ok: bool
    records_checked: int
    duration_ms: int
    from_sequence: Optional[int] = None
    to_sequence: Optional[int] = None
    head_hash: str
    first_broken_link: Optional[BrokenLinkOut] = None


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------


class ThresholdsIn(ApiModel):
    conformance_deny_floor: float = Field(0.45, ge=0, le=1)
    conformance_review_floor: float = Field(0.70, ge=0, le=1)
    conformance_marginal_floor: float = Field(0.85, ge=0, le=1)
    novel_merchant_check_enabled: bool = True
    velocity_check_enabled: bool = True


class PolicyOut(ApiModel):
    policy_id: str
    name: str
    version: int
    stage: Literal["draft", "shadow", "enforcing"]
    thresholds: dict[str, Any]
    ruleset_hash: str
    created_by: str = ""
    created_at: datetime
    promoted_at: Optional[datetime] = None


class SimulateRequest(ApiModel):
    thresholds: ThresholdsIn
    name: str = "candidate"
    limit: int = Field(5000, ge=1, le=25000)


class SimulateResponse(ApiModel):
    candidate_ruleset_hash: str
    deployed_ruleset_hash: str
    replayed_count: int
    counts: dict[str, dict[str, int]]
    exposure_before: str
    exposure_after: str
    exposure_delta: str
    newly_blocked_count: int
    newly_allowed_count: int
    newly_blocked: list[dict[str, Any]]
    newly_allowed: list[dict[str, Any]]


class PromoteRequest(ApiModel):
    policy_id: str
    stage: Literal["draft", "shadow", "enforcing"]


# ---------------------------------------------------------------------------
# Incidents / disputes
# ---------------------------------------------------------------------------


class IncidentOut(ApiModel):
    event_id: str
    breaker: str
    agent_id: str = ""
    agent_name: str = ""
    operator_id: str
    severity: str
    title: str
    detail: str = ""
    evidence: dict[str, Any] = Field(default_factory=dict)
    suspected_prompt_injection: bool = False
    acknowledged: bool = False
    created_at: datetime


class DisputeOut(ApiModel):
    dispute_id: str
    action_id: str
    card_member_id: str
    status: str
    reason: str = ""
    liable_party: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None


class CreateDisputeRequest(ApiModel):
    action_id: str
    reason: str = ""


class DisputePacket(ApiModel):
    """The numbered, self-contained evidence document."""

    packet_id: str
    generated_at: datetime
    dispute_id: str
    sections: list[dict[str, Any]]
    liability: dict[str, Any]
    chain_of_custody: dict[str, Any]
    verification: VerifyResponse


# ---------------------------------------------------------------------------
# Fleet
# ---------------------------------------------------------------------------


class FleetStopRequest(ApiModel):
    reason: str = Field(..., min_length=3)


class FleetStateOut(ApiModel):
    stopped: bool
    stopped_by: Optional[str] = None
    stopped_at: Optional[datetime] = None
    stop_reason: str = ""
    rearm_approvals: list[str] = Field(default_factory=list)
    approvals_required: int = 2


class RearmResponse(ApiModel):
    state: FleetStateOut
    rearmed: bool
    message: str


# ---------------------------------------------------------------------------
# Fleet overview metrics
# ---------------------------------------------------------------------------


class MetricTile(ApiModel):
    key: str
    label: str
    value: float
    unit: str = ""
    delta: Optional[float] = None
    tooltip: str = ""


class OverviewResponse(ApiModel):
    tiles: list[MetricTile]
    block_rate_series: list[dict[str, Any]]
    exposure_by_operator: list[dict[str, Any]]
    armed_breakers: list[IncidentOut]
    p99_latency_ms: int = 0
    block_rate: float = 0.0
    false_block_rate: float = 0.0
    false_block_sample_size: int

    # The same measurement over real traffic: confirmed member reports over
    # blocks in the window. Distinct from the seeded rate above, which is
    # exact but only exists for generated data.
    reported_false_block_rate: float = 0.0
    reported_false_blocks: int = 0
    block_reports_awaiting_review: int = 0
    blocks_in_window: int = 0
    """How many labelled-legitimate actions the rate was measured over. A rate
    without its denominator is a number nobody can challenge."""
    step_up_approval_rate: float = 0.0
    policy_stage: str = "enforcing"
    ruleset_hash: str = ""


# ---------------------------------------------------------------------------
# Step-up resolution (card member)
# ---------------------------------------------------------------------------


class StepUpResolveRequest(ApiModel):
    decision: Literal["approve_once", "decline", "always_allow"]


class StepUpResolveResponse(ApiModel):
    action_id: str
    step_up_state: str
    verdict: str
    message: str


AgentTreeNode.model_rebuild()


# --------------------------------------------------------------------------
# Agent simulator
# --------------------------------------------------------------------------


class SimulateCheckoutRequest(ApiModel):
    """A shopper's sentence at one storefront, on behalf of one agent.

    Deliberately small: the caller says WHO is buying, WHERE, and WHAT they
    asked for in words. Everything the engine rules on -- amount, cart lines,
    attributes -- is derived server-side from the catalogue, never accepted
    from the client. A simulator that could post its own amounts and
    attributes would be able to manufacture any verdict it liked, which would
    make it a puppet show rather than a demonstration.
    """

    agent_id: str
    merchant_id: str
    prompt: str = Field(..., min_length=1, max_length=2000)
    ship_to: Optional[str] = None
    idempotency_key: Optional[str] = None


class SimulatedCartLine(ApiModel):
    label: str
    quantity: int
    unit_amount: Decimal
    attributes: list[str] = Field(default_factory=list)


class SimulateCheckoutResponse(ApiModel):
    """What the storefront shows back: the cart it built, and the verdict."""

    action_id: str
    merchant_id: str
    merchant_name: str
    merchant_category: str
    cart: list[SimulatedCartLine]
    amount: Decimal
    currency: str = "INR"
    ship_to: Optional[str] = None
    injected_instruction: Optional[str] = None
    parse_source: str = Field(
        "rules", description="How the sentence was read: 'rules' or 'openai'."
    )
    parse_note: str = ""
    decision: DecisionOut


class BlockReportRequest(ApiModel):
    """A card member's verdict on a block that affected them."""

    report: Literal["wrong", "correct"] = Field(
        ...,
        description=(
            "'wrong' = the member did want this purchase; 'correct' = the block "
            "was right. Only 'wrong', once an operator confirms it, counts as a "
            "measured false block."
        ),
    )
    note: str = Field("", max_length=500)


class BlockReportResponse(ApiModel):
    action_id: str
    block_report: str
    confirmed: Optional[bool] = None
    message: str


class BlockReportConfirmRequest(ApiModel):
    """An operator's ruling on a member's report."""

    confirmed: bool = Field(
        ...,
        description=(
            "True if the operator agrees the block was wrong. This is what "
            "enters the false-block rate -- a member's report alone does not, "
            "or the metric could be moved by anyone who dislikes a decision."
        ),
    )
