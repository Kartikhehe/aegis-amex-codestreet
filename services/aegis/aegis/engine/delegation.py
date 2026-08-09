"""Delegation: who may grant what to whom.

The single invariant: **a child mandate can never exceed its parent on any
dimension.** Authority only ever narrows as it flows down the tree. This is
checked at ISSUANCE (can_issue), not at spend time, so an over-broad sub-agent
can never come into existence in the first place.

`can_issue` returns per-dimension violations rather than a bare boolean,
because the console has to show the operator exactly which dimension they
over-reached on -- "you asked for a ₹8,000 ceiling under a ₹5,000 parent" is
actionable; "rejected" is not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Iterable, Mapping, Optional

from .types import Agent, AgentStatus, Mandate


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Normalise to timezone-aware UTC before comparing.

    Some backends (SQLite in particular) hand back naive datetimes even for
    columns declared with a timezone. Comparing a naive value with an aware one
    raises, so an expiry check would crash rather than decide -- normalise
    here, at the one place expiries are compared.
    """
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


@dataclass(frozen=True)
class DimensionViolation:
    dimension: str
    parent_value: str
    requested_value: str
    message: str


@dataclass(frozen=True)
class IssuanceCheck:
    allowed: bool
    violations: tuple[DimensionViolation, ...] = ()

    def __bool__(self) -> bool:
        return self.allowed


def _fmt(value: object) -> str:
    if isinstance(value, (set, frozenset)):
        return "{" + ", ".join(sorted(str(v) for v in value)) + "}" if value else "{}"
    if value is None:
        return "unrestricted"
    return str(value)


def can_issue(parent: Mandate, requested: Mandate) -> IssuanceCheck:
    """May `parent` grant `requested` to a sub-agent?

    Strict subset on every dimension. Every failing dimension is reported --
    not just the first -- so the operator can fix them all in one pass.
    """
    v: list[DimensionViolation] = []

    # --- categories: requested must be a subset -----------------------------
    extra_categories = set(requested.permitted_categories) - set(parent.permitted_categories)
    if extra_categories:
        v.append(
            DimensionViolation(
                dimension="permitted_categories",
                parent_value=_fmt(parent.permitted_categories),
                requested_value=_fmt(requested.permitted_categories),
                message=(
                    "Sub-agent requests merchant categories the parent does not hold: "
                    + ", ".join(sorted(extra_categories))
                ),
            )
        )

    # --- prohibitions: requested must be a SUPERSET -------------------------
    # Prohibitions are negative authority: a child may add new "never"s, but may
    # never drop one it inherited.
    dropped = set(parent.prohibited_attributes) - set(requested.prohibited_attributes)
    if dropped:
        v.append(
            DimensionViolation(
                dimension="prohibited_attributes",
                parent_value=_fmt(parent.prohibited_attributes),
                requested_value=_fmt(requested.prohibited_attributes),
                message=(
                    "Sub-agent drops prohibitions inherited from the parent: "
                    + ", ".join(sorted(dropped))
                ),
            )
        )

    # --- merchants: None = unrestricted, so a None child under a set parent
    #     is a widening.
    if parent.permitted_merchants is not None:
        if requested.permitted_merchants is None:
            v.append(
                DimensionViolation(
                    dimension="permitted_merchants",
                    parent_value=_fmt(parent.permitted_merchants),
                    requested_value="unrestricted",
                    message=(
                        "Sub-agent requests unrestricted merchants under a parent "
                        "limited to a specific list"
                    ),
                )
            )
        else:
            extra = set(requested.permitted_merchants) - set(parent.permitted_merchants)
            if extra:
                v.append(
                    DimensionViolation(
                        dimension="permitted_merchants",
                        parent_value=_fmt(parent.permitted_merchants),
                        requested_value=_fmt(requested.permitted_merchants),
                        message=(
                            "Sub-agent requests merchants outside the parent list: "
                            + ", ".join(sorted(extra))
                        ),
                    )
                )

    # --- numeric ceilings: child <= parent ----------------------------------
    for dim, p_val, r_val, label in (
        (
            "per_transaction_ceiling",
            parent.per_transaction_ceiling,
            requested.per_transaction_ceiling,
            "per-transaction ceiling",
        ),
        ("daily_ceiling", parent.daily_ceiling, requested.daily_ceiling, "daily ceiling"),
        (
            "max_transactions_per_day",
            parent.max_transactions_per_day,
            requested.max_transactions_per_day,
            "daily transaction count",
        ),
    ):
        if r_val > p_val:
            v.append(
                DimensionViolation(
                    dimension=dim,
                    parent_value=_fmt(p_val),
                    requested_value=_fmt(r_val),
                    message=f"Sub-agent requests a higher {label} than the parent holds",
                )
            )

    # --- delegation depth: child must have strictly less than parent --------
    # A parent with depth budget N can create a child with at most N-1, so the
    # tree is guaranteed to terminate.
    if requested.max_delegation_depth > max(parent.max_delegation_depth - 1, 0):
        v.append(
            DimensionViolation(
                dimension="max_delegation_depth",
                parent_value=_fmt(parent.max_delegation_depth),
                requested_value=_fmt(requested.max_delegation_depth),
                message=(
                    "Sub-agent requests a delegation depth that would let the tree grow "
                    "deeper than the parent permits"
                ),
            )
        )
    if parent.max_delegation_depth <= 0:
        v.append(
            DimensionViolation(
                dimension="max_delegation_depth",
                parent_value="0",
                requested_value=_fmt(requested.max_delegation_depth),
                message="Parent mandate does not permit delegation at all",
            )
        )

    # --- expiry: child must not outlive parent ------------------------------
    parent_expiry = _as_utc(parent.expires_at)
    requested_expiry = _as_utc(requested.expires_at)
    if parent_expiry is not None:
        if requested_expiry is None or requested_expiry > parent_expiry:
            v.append(
                DimensionViolation(
                    dimension="expires_at",
                    parent_value=_fmt(parent.expires_at),
                    requested_value=_fmt(requested.expires_at),
                    message="Sub-agent mandate would outlive the parent mandate",
                )
            )

    return IssuanceCheck(allowed=not v, violations=tuple(v))


# ---------------------------------------------------------------------------
# Tree navigation
# ---------------------------------------------------------------------------


def build_chain(agent_id: str, agents: Mapping[str, Agent]) -> tuple[Agent, ...]:
    """Root-first chain ending at `agent_id`.

    Cycle-safe: a malformed parent pointer cannot hang the evaluator.
    """
    chain: list[Agent] = []
    seen: set[str] = set()
    cursor: Optional[str] = agent_id
    while cursor is not None and cursor in agents and cursor not in seen:
        seen.add(cursor)
        agent = agents[cursor]
        chain.append(agent)
        cursor = agent.parent_agent_id
    chain.reverse()
    return tuple(chain)


def descendants_of(agent_id: str, agents: Mapping[str, Agent]) -> tuple[Agent, ...]:
    """Every agent below `agent_id`, breadth-first. Excludes the agent itself."""
    children: dict[str, list[Agent]] = {}
    for agent in agents.values():
        if agent.parent_agent_id:
            children.setdefault(agent.parent_agent_id, []).append(agent)

    out: list[Agent] = []
    seen: set[str] = {agent_id}
    queue: list[str] = [agent_id]
    while queue:
        current = queue.pop(0)
        for child in sorted(children.get(current, []), key=lambda a: a.agent_id):
            if child.agent_id in seen:
                continue
            seen.add(child.agent_id)
            out.append(child)
            queue.append(child.agent_id)
    return tuple(out)


def revoke_cascade(agent_id: str, agents: Mapping[str, Agent]) -> tuple[str, ...]:
    """IDs to revoke when `agent_id` is revoked: itself plus all descendants.

    Revocation cascades because authority is derived: a sub-agent's permission
    exists only as a narrowing of its parent's. Remove the parent and the
    child's authority has no source.
    """
    return (agent_id,) + tuple(a.agent_id for a in descendants_of(agent_id, agents))


def apply_revocation(agent_id: str, agents: Mapping[str, Agent]) -> dict[str, Agent]:
    """Return a new agent map with the cascade applied."""
    ids = set(revoke_cascade(agent_id, agents))
    updated: dict[str, Agent] = {}
    for key, agent in agents.items():
        if key in ids:
            updated[key] = Agent(
                agent_id=agent.agent_id,
                operator_id=agent.operator_id,
                name=agent.name,
                mandate=agent.mandate,
                parent_agent_id=agent.parent_agent_id,
                depth=agent.depth,
                status=AgentStatus.REVOKED,
                breaker_tripped=agent.breaker_tripped,
                created_at=agent.created_at,
            )
        else:
            updated[key] = agent
    return updated


def effective_prohibitions(chain: Iterable[Agent]) -> frozenset[str]:
    """Union of prohibitions down the chain -- a parent's 'never' always wins."""
    out: set[str] = set()
    for agent in chain:
        out |= set(agent.mandate.prohibited_attributes)
    return frozenset(out)
