"""Core value types for the AEGIS governance engine.

Everything in this module is a pure data structure. No I/O, no database, no
model calls. The engine's determinism rests on the fact that a Decision is a
pure function of (ActionRequest, Mandate chain, EngineState, ConformanceResult)
-- and every one of those is defined here.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Canonical JSON -- the single serialisation used for every hash in the system.
# ---------------------------------------------------------------------------

def canonical_json(payload: Any) -> str:
    """Deterministic JSON: sorted keys, no insignificant whitespace, UTF-8.

    This function is the root of trust for the ledger. Two structurally equal
    payloads MUST produce byte-identical output on any machine, any Python
    build, any day. That means: sorted keys, fixed separators, no NaN/Infinity
    (which are not valid JSON and would round-trip differently), and explicit
    handling of the non-JSON-native types we actually store.
    """
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
        default=_canonical_default,
    )


def _canonical_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        # Money. Normalise to a fixed-scale string so 5000 and 5000.00 hash
        # identically -- otherwise the same amount could break a chain.
        return format(value.quantize(Decimal("0.01")), "f")
    if isinstance(value, datetime):
        # Always UTC, always microsecond precision, always with offset.
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat(timespec="microseconds")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (set, frozenset)):
        return sorted(value)
    if hasattr(value, "to_canonical"):
        return value.to_canonical()
    raise TypeError(f"canonical_json cannot serialise {type(value)!r}")


def to_json_primitives(payload: Any) -> Any:
    """Convert a structure into plain JSON primitives, canonically.

    canonical_json() can serialise Decimal/datetime/Enum on the fly, but a
    structure still *holding* those objects is not JSON -- it cannot be
    round-tripped through json.loads() and rehashed to the same digest. The
    ledger stores payloads that an external auditor must be able to re-hash
    with nothing but a JSON parser and SHA-256, so payloads are normalised
    through this function before they are hashed or persisted.

    Implemented as a round-trip through canonical_json so there is exactly ONE
    definition of how a value becomes JSON, and normalisation can never drift
    from hashing.
    """
    return json.loads(canonical_json(payload))


def sha256_hex(*parts: str) -> str:
    """SHA-256 over the concatenation of parts, hex-encoded."""
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8"))
    return digest.hexdigest()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Verdicts and reason codes
# ---------------------------------------------------------------------------

class Verdict(str, Enum):
    ALLOW = "ALLOW"
    DENY = "DENY"
    STEP_UP = "STEP_UP"
    HOLD = "HOLD"


class ReasonCode(str, Enum):
    """Machine-readable reason. Every decision carries exactly one.

    Named for the *cause*, not the outcome, so the same code can appear under
    different verdicts as policy thresholds move.
    """

    # Identity -- is this a registered agent at all?
    AGENT_NOT_REGISTERED = "agent_not_registered"
    IDENTITY_UNVERIFIABLE = "identity_unverifiable"

    # Halt / lifecycle
    FLEET_EMERGENCY_STOP = "fleet_emergency_stop"
    AGENT_BREAKER_TRIPPED = "agent_breaker_tripped"
    OPERATOR_REVOKED = "operator_revoked"
    AGENT_INACTIVE = "agent_inactive"
    MANDATE_EXPIRED = "mandate_expired"
    DELEGATION_DEPTH_EXCEEDED = "delegation_depth_exceeded"

    # Legality. Ranked ABOVE the mandate: a card member cannot authorise a
    # purchase that is unlawful or network-prohibited, so no mandate, ceiling
    # or approval can clear one.
    PROHIBITED_GOODS = "prohibited_goods"

    # Mandate conformance
    PROHIBITED_ATTRIBUTE_VETO = "prohibited_attribute_veto"
    SHIP_TO_MISMATCH = "ship_to_mismatch"
    SUSPECTED_INJECTION = "suspected_injection"
    CONFORMANCE_BELOW_DENY_FLOOR = "conformance_below_deny_floor"
    CONFORMANCE_BELOW_REVIEW_FLOOR = "conformance_below_review_floor"
    CONFORMANCE_MARGINAL = "conformance_marginal"

    # Limits
    AMOUNT_ABOVE_CEILING = "amount_above_ceiling"
    VELOCITY_LIMIT = "velocity_limit"
    NOVEL_MERCHANT = "novel_merchant"

    # Diligence -- was this a COMPETENT purchase, not merely an authorised one.
    # Advisory by design: it never denies on judgement, it flags or asks.
    DILIGENCE_FLAG = "diligence_flag"
    DILIGENCE_BELOW_BAR = "diligence_below_bar"

    # Degraded operation
    SCORER_UNAVAILABLE_FAIL_CLOSED = "scorer_unavailable_fail_closed"

    # Clean pass
    WITHIN_MANDATE = "within_mandate"


class LiabilityParty(str, Enum):
    CARD_MEMBER = "card_member"
    OPERATOR = "operator"
    PLATFORM = "platform"
    MERCHANT = "merchant"
    SHARED_OPERATOR_PLATFORM = "shared_operator_platform"


class AgentStatus(str, Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REVOKED = "revoked"


class PolicyStage(str, Enum):
    DRAFT = "draft"
    SHADOW = "shadow"
    ENFORCING = "enforcing"


# ---------------------------------------------------------------------------
# Mandate -- what an agent is permitted to do
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Mandate:
    """The authority granted to an agent.

    A mandate is a *subset* structure: a child mandate is valid only if every
    dimension is a subset of its parent's (see delegation.can_issue). Keep the
    dimensions closed over set-inclusion / numeric ordering so that check stays
    total and unambiguous.
    """

    purpose: str
    """Plain-language authorised purpose, shown verbatim to the card member."""

    permitted_categories: frozenset[str] = frozenset()
    """Merchant category codes (MCC) this agent may transact in."""

    prohibited_attributes: frozenset[str] = frozenset()
    """Hard vetoes. Deterministic, evaluated before any model call.

    These are product/merchant attributes, e.g. "gift_card", "cash_equivalent",
    "crypto", "firearms". A single match is an unconditional DENY -- this is
    what catches the trap merchant that shares an MCC with a legitimate one.
    """

    per_transaction_ceiling: Decimal = Decimal("0")
    daily_ceiling: Decimal = Decimal("0")
    max_transactions_per_day: int = 0
    max_delegation_depth: int = 0
    """How many further levels of sub-agent this mandate may spawn."""

    permitted_merchants: Optional[frozenset[str]] = None
    """None means "no explicit allow-list" (broader). A set narrows it."""

    purpose_keywords: frozenset[str] = frozenset()
    """Scorable form of `purpose`, derived once when the mandate is signed.

    The prose purpose is what the card member reads; these are what the
    deterministic scorer matches against a cart. Deriving them at signing time
    (rather than per-decision) means the scoring basis is fixed for the life of
    the mandate and recorded in the mandate hash.
    """

    ship_to: Optional[str] = None
    """Where goods under this mandate may be delivered.

    A mandate for office supplies that suddenly ships to a residential address
    is the classic exfiltration signature, so a mismatch is a hard veto rather
    than a score input.
    """

    cadence: str = "weekly"
    """weekly | monthly | once | per_trip -- the period `daily_ceiling` covers."""

    expires_at: Optional[datetime] = None

    def to_canonical(self) -> dict[str, Any]:
        return {
            "purpose": self.purpose,
            "permitted_categories": sorted(self.permitted_categories),
            "prohibited_attributes": sorted(self.prohibited_attributes),
            "per_transaction_ceiling": self.per_transaction_ceiling,
            "daily_ceiling": self.daily_ceiling,
            "max_transactions_per_day": self.max_transactions_per_day,
            "max_delegation_depth": self.max_delegation_depth,
            "permitted_merchants": (
                None if self.permitted_merchants is None else sorted(self.permitted_merchants)
            ),
            "purpose_keywords": sorted(self.purpose_keywords),
            "ship_to": self.ship_to,
            "cadence": self.cadence,
            "expires_at": self.expires_at,
        }

    @property
    def mandate_hash(self) -> str:
        """Stable identity of this authority. Used as a conformance cache key."""
        return sha256_hex(canonical_json(self.to_canonical()))

    def is_expired(self, now: Optional[datetime] = None) -> bool:
        if self.expires_at is None:
            return False
        # Normalise both sides: some backends return naive datetimes even for
        # timezone-aware columns, and comparing naive with aware raises. An
        # expiry check that throws would take down the whole decision path.
        expires = self.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        current = now or utcnow()
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        return current >= expires


@dataclass(frozen=True)
class Agent:
    agent_id: str
    operator_id: str
    name: str
    mandate: Mandate
    parent_agent_id: Optional[str] = None
    depth: int = 0
    status: AgentStatus = AgentStatus.ACTIVE
    breaker_tripped: bool = False

    principal_id: str = ""
    """The human who signed the mandate. Attribution is meaningless without
    it -- 'whose money was this?' must be answerable from the record alone.

    Declared last, and keyword-only in practice, so that adding it did not
    renumber the positional arguments every existing caller already uses."""
    created_at: datetime = field(default_factory=utcnow)

    def to_canonical(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "operator_id": self.operator_id,
            "principal_id": self.principal_id,
            "name": self.name,
            "parent_agent_id": self.parent_agent_id,
            "depth": self.depth,
            "status": self.status,
            "mandate_hash": self.mandate.mandate_hash,
        }


# ---------------------------------------------------------------------------
# Action -- what the agent is trying to do right now
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CartItem:
    """One line of what is actually being bought.

    The merchant category says what kind of shop this is; the cart says what is
    in the basket. Governing on the basket is the entire point -- a grocery-coded
    merchant selling a gift card is caught here and nowhere else.
    """

    label: str
    attributes: frozenset[str] = frozenset()
    quantity: int = 1
    unit_amount: Decimal = Decimal("0")

    # Merchant-supplied reference price, mirroring ACP's `list_price` on a line
    # item. Optional because AP2 carries no such field and many merchants will
    # not send one. Asserted by the merchant, so it is a diligence SIGNAL and
    # never an independent benchmark -- the UI says so wherever it is used.
    list_price: Optional[Decimal] = None

    def to_canonical(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "attributes": sorted(self.attributes),
            "list_price": self.list_price,
            "quantity": self.quantity,
            "unit_amount": self.unit_amount,
        }


@dataclass(frozen=True)
class ActionRequest:
    action_id: str
    agent_id: str
    merchant_id: str
    merchant_name: str
    merchant_category: str
    amount: Decimal
    currency: str = "INR"
    description: str = ""
    merchant_attributes: frozenset[str] = frozenset()
    """Ground-truth attributes of what the MERCHANT sells.

    This is the field the trap merchant pair turns on: two merchants share
    merchant_category, but one carries "gift_card" here.
    """

    cart_items: tuple[CartItem, ...] = ()
    """The basket. Attributes here are unioned with the merchant's for veto."""

    ship_to: Optional[str] = None
    """Delivery destination, checked against the mandate's `ship_to`."""

    injected_instruction: Optional[str] = None
    """Text an agent received from an untrusted source (tool output, merchant
    page, an email it read).

    Recorded as EVIDENCE, never executed. Its presence is scored and, when it
    contains manipulation phrasing, vetoed -- this is how a prompt-injection
    attempt becomes a governable event rather than an invisible one.
    """

    idempotency_key: Optional[str] = None
    """Client-supplied. A repeat of the same key returns the original decision
    rather than writing a second ledger record."""

    requested_at: datetime = field(default_factory=utcnow)

    @property
    def cart_attributes(self) -> frozenset[str]:
        """Every attribute present in the basket."""
        out: set[str] = set()
        for item in self.cart_items:
            out |= set(item.attributes)
        return frozenset(out)

    @property
    def all_attributes(self) -> frozenset[str]:
        """Merchant attributes UNION cart attributes.

        Vetoes run against this union: a merchant that sells gift cards is
        dangerous even when the cart is vague, and a gift card in the cart is
        dangerous even at a merchant that mostly sells groceries.
        """
        return frozenset(set(self.merchant_attributes) | set(self.cart_attributes))

    @property
    def cart_digest(self) -> str:
        """Content address of the basket. Two identical baskets hash alike."""
        return sha256_hex(canonical_json([item.to_canonical() for item in self.cart_items]))

    def to_canonical(self) -> dict[str, Any]:
        return {
            "action_id": self.action_id,
            "agent_id": self.agent_id,
            "merchant_id": self.merchant_id,
            "merchant_name": self.merchant_name,
            "merchant_category": self.merchant_category,
            "amount": self.amount,
            "currency": self.currency,
            "description": self.description,
            "merchant_attributes": sorted(self.merchant_attributes),
            "cart_items": [item.to_canonical() for item in self.cart_items],
            "cart_digest": self.cart_digest,
            "ship_to": self.ship_to,
            "injected_instruction": self.injected_instruction,
            "requested_at": self.requested_at,
        }

    @property
    def action_signature(self) -> str:
        """Cache key for conformance scoring.

        Deliberately EXCLUDES action_id and requested_at: two structurally
        identical purchases should hit the same cache entry. It includes
        everything the scorer is actually shown -- including the cart, since a
        different basket is a different question.
        """
        return sha256_hex(
            canonical_json(
                {
                    "merchant_name": self.merchant_name,
                    "merchant_category": self.merchant_category,
                    "amount": self.amount,
                    "currency": self.currency,
                    "description": self.description,
                    "merchant_attributes": sorted(self.merchant_attributes),
                    "cart_digest": self.cart_digest,
                    "ship_to": self.ship_to,
                    "injected_instruction": self.injected_instruction,
                }
            )
        )


# ---------------------------------------------------------------------------
# Runtime context the evaluator reads
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class VelocityWindow:
    """Observed spend/count for the agent in the current rolling day."""

    transactions_today: int = 0
    amount_today: Decimal = Decimal("0")


@dataclass(frozen=True)
class EvaluationContext:
    """Everything outside the request itself that the rules may read."""

    agent: Agent
    chain: tuple[Agent, ...] = ()
    """Root-first delegation chain, ending with `agent`."""

    fleet_stopped: bool = False
    operator_revoked: bool = False
    velocity: VelocityWindow = field(default_factory=VelocityWindow)
    known_merchants: frozenset[str] = frozenset()

    identity_verified: Optional[bool] = True
    """Did ACE Agent Registration confirm this agent is registered?

    True  -- confirmed.
    False -- the registry answered, and this agent is not registered.
    None  -- the registry could not be reached. Fails CLOSED: an identity we
             cannot verify is a denial, never a pass.

    Defaults to True so replay, tests and shadow evaluation behave as before;
    the live decision path sets it explicitly from the provider.
    """
    """Merchants this agent has previously transacted with successfully."""

    now: datetime = field(default_factory=utcnow)


@dataclass(frozen=True)
class ConformanceResult:
    """Output of the scorer. `available=False` means fail-closed."""

    score: float
    rationale: str
    vetoes: tuple[str, ...] = ()
    model_version: str = ""
    prompt_hash: str = ""
    available: bool = True
    cached: bool = False
    latency_ms: int = 0
    error: Optional[str] = None

    @staticmethod
    def unavailable(error: str, model_version: str = "", prompt_hash: str = "") -> "ConformanceResult":
        return ConformanceResult(
            score=0.0,
            rationale="",
            vetoes=(),
            model_version=model_version,
            prompt_hash=prompt_hash,
            available=False,
            error=error,
        )

    def to_canonical(self) -> dict[str, Any]:
        return {
            "score": None if not self.available else round(self.score, 4),
            "rationale": self.rationale,
            "vetoes": sorted(self.vetoes),
            "model_version": self.model_version,
            "prompt_hash": self.prompt_hash,
            "available": self.available,
        }


@dataclass(frozen=True)
class RuleOutcome:
    """One rule's verdict on one action. Recorded whether or not it won."""

    rule_name: str
    matched: bool
    verdict: Optional[Verdict] = None
    reason_code: Optional[ReasonCode] = None
    detail: str = ""
    skipped: bool = False
    """True when the rule could not run (e.g. scorer unavailable)."""

    def to_canonical(self) -> dict[str, Any]:
        return {
            "rule_name": self.rule_name,
            "matched": self.matched,
            "verdict": self.verdict,
            "reason_code": self.reason_code,
            "detail": self.detail,
            "skipped": self.skipped,
        }


@dataclass(frozen=True)
class Decision:
    """The complete, auditable result. This is what gets written to the ledger."""

    action_id: str
    agent_id: str
    verdict: Verdict
    reason_code: ReasonCode
    human_readable_reason: str
    """Written FOR A CARD MEMBER. Plain language, no jargon, no rule names."""

    winning_rule: str
    rules_fired: tuple[RuleOutcome, ...]
    ruleset_hash: str
    conformance: Optional[ConformanceResult] = None
    delegation_chain: tuple[str, ...] = ()
    features: dict[str, Any] = field(default_factory=dict)
    flagged: bool = False
    """ALLOW-but-watch: conformance in the marginal band."""

    decided_at: datetime = field(default_factory=utcnow)
    latency_ms: int = 0

    def to_canonical(self) -> dict[str, Any]:
        return {
            "action_id": self.action_id,
            "agent_id": self.agent_id,
            "verdict": self.verdict,
            "reason_code": self.reason_code,
            "human_readable_reason": self.human_readable_reason,
            "winning_rule": self.winning_rule,
            "rules_fired": [r.to_canonical() for r in self.rules_fired],
            "ruleset_hash": self.ruleset_hash,
            "conformance": None if self.conformance is None else self.conformance.to_canonical(),
            "delegation_chain": list(self.delegation_chain),
            "features": self.features,
            "flagged": self.flagged,
            "decided_at": self.decided_at,
        }
