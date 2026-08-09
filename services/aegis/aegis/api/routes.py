"""HTTP API.

Endpoint list follows the brief. Every route is thin: it validates input,
delegates to the engine or service layer, and shapes the response. No policy
logic lives here -- that would put an unversioned, untested copy of the rules
in the transport layer.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

import asyncio

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy import func, select

from ..config import get_settings
from ..auth.security import (
    CurrentUser,
    DbSession,
    Principal,
    Role,
    assert_can_see_agent,
    authenticate,
    create_access_token,
    decode_token,
    require_roles,
)
from ..db.models import (
    AgentRow,
    ComplianceEventRow,
    DecisionRow,
    Dispute,
    LedgerEntry,
    MerchantRow,
    Operator,
    PolicyVersion,
)
from ..engine.attribution import attribution_from_decision
from ..engine.delegation import build_chain, can_issue, descendants_of
from ..engine.policy import PolicyThresholds, Ruleset
from ..engine.types import ActionRequest, CartItem, Mandate, utcnow
from ..firestore import get_mirror, mint_custom_token
from ..providers import ProviderUnavailable, get_providers
from ..scoring import get_conformance_engine, get_idempotency_store, get_rate_limiter
from ..service import (
    active_ruleset,
    agent_from_row,
    decide as decide_action,
    get_fleet_state,
    load_agent_map,
    mandate_from_row,
    rearm_fleet,
    revoke_agent,
    simulate_policy,
    stop_fleet,
    verify_ledger,
)
from . import schemas as s
from .stream import broadcast_decision, hub
from fastapi import Depends

router = APIRouter()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@router.post("/auth/login", response_model=s.LoginResponse, tags=["auth"])
def login(payload: s.LoginRequest, db: DbSession) -> s.LoginResponse:
    user = authenticate(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email or password is incorrect.",
        )
    return s.LoginResponse(
        token=create_access_token(user),
        user=s.UserOut.model_validate(user),
        firebase_token=mint_custom_token(
            user.user_id, user.role, user.operator_id, user.card_member_id
        ),
    )


@router.get("/auth/profile", response_model=s.UserOut, tags=["auth"])
def profile(principal: CurrentUser) -> s.UserOut:
    return s.UserOut(
        user_id=principal.user_id,
        email=principal.email,
        name=principal.name,
        role=principal.role,
        operator_id=principal.operator_id,
        card_member_id=principal.card_member_id,
    )


@router.post("/auth/logout", tags=["auth"])
def logout() -> dict[str, bool]:
    # Stateless JWT: the client discards the token. Present so Aurora's
    # existing auth flow works unmodified.
    return {"ok": True}


# ---------------------------------------------------------------------------
# Decide
# ---------------------------------------------------------------------------


@router.post("/decide", response_model=s.DecisionOut, tags=["decide"])
def decide(
    payload: s.DecideRequest,
    db: DbSession,
    principal: CurrentUser,
    response: Response,
) -> s.DecisionOut:
    # --- identity, through the ACE seam ------------------------------------
    # Routed via the provider so that swapping to real ACE Agent Registration
    # changes configuration, not this endpoint. A provider that cannot answer
    # raises, and an identity we cannot verify is a denial, never a pass.
    providers = get_providers(db)
    try:
        if providers.identity.verify(payload.agent_id) is None:
            raise HTTPException(status_code=404, detail=f"Unknown agent {payload.agent_id}")
    except ProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Identity unavailable: {exc}")

    agent_row = db.get(AgentRow, payload.agent_id)
    if agent_row is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent {payload.agent_id}")
    if principal.role != Role.CARD_MEMBER:
        assert_can_see_agent(principal, agent_row.operator_id)

    # --- rate limit, per agent ---------------------------------------------
    verdict_limit = get_rate_limiter().check(payload.agent_id)
    if not verdict_limit.allowed:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Agent {payload.agent_id} exceeded its decision rate limit. "
                f"Retry in {verdict_limit.retry_after_seconds}s."
            ),
            headers={"Retry-After": str(verdict_limit.retry_after_seconds)},
        )
    response.headers["X-RateLimit-Remaining"] = str(verdict_limit.remaining)

    # --- idempotency --------------------------------------------------------
    # A retry must return the ORIGINAL decision. Writing a second ledger record
    # for one real-world event would corrupt every count derived from the
    # ledger and claim, permanently, that it happened twice.
    store = get_idempotency_store()
    if payload.idempotency_key:
        previous = store.get(payload.agent_id, payload.idempotency_key)
        if previous is not None:
            existing = db.get(DecisionRow, previous["action_id"])
            if existing is not None:
                response.headers["X-Idempotent-Replay"] = "true"
                return _decision_out(existing, agent_row)

    action = ActionRequest(
        action_id=payload.action_id or f"act_{uuid.uuid4().hex[:16]}",
        agent_id=payload.agent_id,
        merchant_id=payload.merchant_id,
        merchant_name=payload.merchant_name,
        merchant_category=payload.merchant_category,
        amount=Decimal(str(payload.amount)),
        currency=payload.currency,
        description=payload.description,
        merchant_attributes=frozenset(payload.merchant_attributes),
        cart_items=tuple(
            CartItem(
                label=item.label,
                attributes=frozenset(item.attributes),
                quantity=item.quantity,
                unit_amount=Decimal(str(item.unit_amount)),
            )
            for item in payload.cart_items
        ),
        ship_to=payload.ship_to,
        injected_instruction=payload.injected_instruction,
        idempotency_key=payload.idempotency_key,
        requested_at=utcnow(),
    )

    decision, entry, shadow = decide_action(db, action, get_conformance_engine())
    db.commit()

    if payload.idempotency_key:
        store.put(payload.agent_id, payload.idempotency_key, {"action_id": decision.action_id})

    # Push to any live /stream subscribers. Best-effort: a dashboard that is
    # not listening must never affect whether a decision is recorded.
    broadcast_decision(
        {
            "action_id": decision.action_id,
            "agent_id": decision.agent_id,
            "agent_name": agent_row.name,
            "verdict": decision.verdict.value,
            "reason_code": decision.reason_code.value,
            "merchant_name": action.merchant_name,
            "amount": str(action.amount),
            "decided_at": decision.decided_at.isoformat(),
        }
    )

    row = db.get(DecisionRow, decision.action_id)

    # Mirror to Firestore AFTER the SQL commit. The commit is the source of
    # truth; this is a courtesy for the console's live subscriptions and is
    # wrapped so it can never fail an authorisation.
    get_mirror().mirror_decision(row)

    out = _decision_out(row, agent_row)
    out.ledger = s.LedgerRefOut(
        sequence=entry.sequence,
        record_id=entry.record_id,
        prev_hash=entry.prev_hash,
        self_hash=entry.self_hash,
    )
    if shadow:
        out.shadow = s.ShadowOut(**shadow)
    return out


@router.get("/decisions", response_model=s.DecisionPage, tags=["decide"])
def list_decisions(
    db: DbSession,
    principal: CurrentUser,
    verdict: Optional[str] = Query(None, pattern="^(ALLOW|DENY|STEP_UP|HOLD)$"),
    agent_id: Optional[str] = None,
    flagged: Optional[bool] = None,
    step_up_state: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> s.DecisionPage:
    stmt = select(DecisionRow)
    count_stmt = select(func.count(DecisionRow.action_id))

    filters = []
    # Scope by identity from the TOKEN -- never from a client-supplied field.
    if principal.role == Role.CARD_MEMBER:
        filters.append(DecisionRow.card_member_id == principal.card_member_id)
    elif principal.role == Role.AGENT_OPERATOR:
        filters.append(DecisionRow.operator_id == principal.operator_id)

    if verdict:
        filters.append(DecisionRow.verdict == verdict)
    if agent_id:
        filters.append(DecisionRow.agent_id == agent_id)
    if flagged is not None:
        filters.append(DecisionRow.flagged == flagged)
    if step_up_state:
        filters.append(DecisionRow.step_up_state == step_up_state)

    for f in filters:
        stmt = stmt.where(f)
        count_stmt = count_stmt.where(f)

    total = db.scalar(count_stmt) or 0
    rows = list(
        db.scalars(stmt.order_by(DecisionRow.decided_at.desc()).limit(limit).offset(offset))
    )
    agents = {r.agent_id: r for r in db.scalars(select(AgentRow))}
    return s.DecisionPage(
        items=[_decision_out(r, agents.get(r.agent_id)) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/decisions/{action_id}", response_model=s.DecisionOut, tags=["decide"])
def get_decision(action_id: str, db: DbSession, principal: CurrentUser) -> s.DecisionOut:
    row = db.get(DecisionRow, action_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    _assert_can_see_decision(principal, row)

    out = _decision_out(row, db.get(AgentRow, row.agent_id))
    entry = db.scalars(
        select(LedgerEntry).where(LedgerEntry.action_id == action_id)
    ).first()
    if entry:
        out.ledger = s.LedgerRefOut(
            sequence=entry.sequence,
            record_id=entry.record_id,
            prev_hash=entry.prev_hash,
            self_hash=entry.self_hash,
        )
    return out


@router.post(
    "/decisions/{action_id}/resolve",
    response_model=s.StepUpResolveResponse,
    tags=["decide"],
)
def resolve_step_up(
    action_id: str,
    payload: s.StepUpResolveRequest,
    db: DbSession,
    principal: CurrentUser,
) -> s.StepUpResolveResponse:
    """The card member answers a step-up. This is a real state transition."""
    row = db.get(DecisionRow, action_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    _assert_can_see_decision(principal, row)

    if row.verdict != "STEP_UP":
        raise HTTPException(
            status_code=409, detail="This purchase is not waiting for your approval."
        )
    if row.step_up_state and row.step_up_state != "pending":
        raise HTTPException(status_code=409, detail="This request was already answered.")

    mapping = {
        "approve_once": ("approved", "Approved. The purchase will go through."),
        "always_allow": ("always_allowed", "Approved, and we won't ask again for this."),
        "decline": ("declined", "Declined. Nothing was charged."),
    }
    state, message = mapping[payload.decision]
    row.step_up_state = state
    row.step_up_resolved_at = utcnow()
    db.commit()

    return s.StepUpResolveResponse(
        action_id=action_id, step_up_state=state, verdict=row.verdict, message=message
    )


# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------


@router.get("/verify", response_model=s.VerifyResponse, tags=["ledger"])
def verify(
    db: DbSession,
    principal: CurrentUser,
    from_sequence: Optional[int] = Query(None, ge=1),
    to_sequence: Optional[int] = Query(None, ge=1),
) -> s.VerifyResponse:
    result = verify_ledger(db, from_sequence, to_sequence)
    return s.VerifyResponse(**result.to_dict())


@router.get("/ledger", tags=["ledger"])
def list_ledger(
    db: DbSession,
    principal: CurrentUser,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    total = db.scalar(select(func.count(LedgerEntry.sequence))) or 0
    rows = list(
        db.scalars(
            select(LedgerEntry)
            .order_by(LedgerEntry.sequence.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    return {
        "total": total,
        "items": [
            {
                "sequence": r.sequence,
                "record_id": r.record_id,
                "action_id": r.action_id,
                "agent_id": r.agent_id,
                "prev_hash": r.prev_hash,
                "self_hash": r.self_hash,
                "recorded_at": r.recorded_at,
            }
            for r in rows
        ],
    }


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------


@router.get("/agents", response_model=list[s.AgentOut], tags=["agents"])
def list_agents(
    db: DbSession,
    principal: CurrentUser,
    operator_id: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
) -> list[s.AgentOut]:
    stmt = select(AgentRow)
    if principal.role == Role.AGENT_OPERATOR:
        stmt = stmt.where(AgentRow.operator_id == principal.operator_id)
    elif principal.role == Role.CARD_MEMBER:
        stmt = stmt.where(AgentRow.card_member_id == principal.card_member_id)
    elif operator_id:
        stmt = stmt.where(AgentRow.operator_id == operator_id)

    if status_filter:
        stmt = stmt.where(AgentRow.status == status_filter)

    operators = {o.operator_id: o.name for o in db.scalars(select(Operator))}
    return [
        _agent_out(row, operators.get(row.operator_id, ""))
        for row in db.scalars(stmt.order_by(AgentRow.created_at.asc()))
    ]


@router.get("/agents/{agent_id}", response_model=s.AgentDetail, tags=["agents"])
def get_agent(agent_id: str, db: DbSession, principal: CurrentUser) -> s.AgentDetail:
    row = db.get(AgentRow, agent_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    if principal.role != Role.CARD_MEMBER:
        assert_can_see_agent(principal, row.operator_id)

    operators = {o.operator_id: o.name for o in db.scalars(select(Operator))}
    agents = load_agent_map(db)
    rows_by_id = {r.agent_id: r for r in db.scalars(select(AgentRow))}

    chain = build_chain(agent_id, agents)
    descendants = descendants_of(agent_id, agents)

    # Stats from real decisions.
    decisions = list(
        db.scalars(
            select(DecisionRow)
            .where(DecisionRow.agent_id == agent_id)
            .order_by(DecisionRow.decided_at.desc())
            .limit(200)
        )
    )
    scored = [float(d.conformance_score) for d in decisions if d.conformance_score is not None]
    day_ago = utcnow() - timedelta(days=1)
    stats = s.AgentStats(
        total_decisions=db.scalar(
            select(func.count(DecisionRow.action_id)).where(DecisionRow.agent_id == agent_id)
        )
        or 0,
        allowed=sum(1 for d in decisions if d.verdict == "ALLOW"),
        denied=sum(1 for d in decisions if d.verdict == "DENY"),
        stepped_up=sum(1 for d in decisions if d.verdict == "STEP_UP"),
        spend_today=Decimal(
            str(
                db.scalar(
                    select(func.coalesce(func.sum(DecisionRow.amount), 0)).where(
                        DecisionRow.agent_id == agent_id,
                        DecisionRow.verdict == "ALLOW",
                        DecisionRow.decided_at >= day_ago,
                    )
                )
                or 0
            )
        ),
        mean_conformance=(round(sum(scored) / len(scored), 4) if scored else None),
        conformance_series=[
            {
                "t": d.decided_at.isoformat(),
                "score": float(d.conformance_score),
                "action_id": d.action_id,
            }
            for d in reversed(decisions)
            if d.conformance_score is not None
        ][-60:],
    )

    return s.AgentDetail(
        agent=_agent_out(row, operators.get(row.operator_id, "")),
        chain=[
            _agent_out(rows_by_id[a.agent_id], operators.get(a.operator_id, ""))
            for a in chain
            if a.agent_id in rows_by_id
        ],
        tree=_build_tree(agent_id, rows_by_id),
        descendants=[
            _agent_out(rows_by_id[a.agent_id], operators.get(a.operator_id, ""))
            for a in descendants
            if a.agent_id in rows_by_id
        ],
        stats=stats,
        recent_decisions=[_decision_out(d, row) for d in decisions[:25]],
    )


@router.post(
    "/agents",
    response_model=s.AgentOut,
    status_code=status.HTTP_201_CREATED,
    tags=["agents"],
    responses={422: {"model": s.IssuanceRejection}},
)
def create_agent(
    payload: s.CreateAgentRequest,
    db: DbSession,
    principal: CurrentUser,
) -> s.AgentOut:
    """Issue an agent or sub-agent.

    When parent_agent_id is set, can_issue() runs first. If the requested
    mandate exceeds the parent on ANY dimension, nothing is created and every
    violating dimension is returned.
    """
    if principal.role == Role.CARD_MEMBER:
        raise HTTPException(status_code=403, detail="Card members cannot issue agents.")

    # A sub-agent always belongs to its parent's operator, so resolve the
    # parent FIRST. Demanding operator_id up front would reject a full-
    # privilege operator (who has no operator_id of their own) from creating a
    # sub-agent whose operator is unambiguous from the parent.
    parent_row = None
    if payload.parent_agent_id:
        parent_row = db.get(AgentRow, payload.parent_agent_id)
        if parent_row is None:
            raise HTTPException(status_code=404, detail="Parent agent not found")
        assert_can_see_agent(principal, parent_row.operator_id)
        if parent_row.status != "active":
            raise HTTPException(
                status_code=409,
                detail=f"Parent agent is {parent_row.status} and cannot issue sub-agents.",
            )

    operator_id = (
        parent_row.operator_id if parent_row else (payload.operator_id or principal.operator_id)
    )
    if not operator_id:
        raise HTTPException(
            status_code=422,
            detail="operator_id is required when creating a root agent.",
        )
    assert_can_see_agent(principal, operator_id)

    requested = Mandate(
        purpose=payload.mandate.purpose,
        permitted_categories=frozenset(payload.mandate.permitted_categories),
        prohibited_attributes=frozenset(payload.mandate.prohibited_attributes),
        per_transaction_ceiling=Decimal(str(payload.mandate.per_transaction_ceiling)),
        daily_ceiling=Decimal(str(payload.mandate.daily_ceiling)),
        max_transactions_per_day=payload.mandate.max_transactions_per_day,
        max_delegation_depth=payload.mandate.max_delegation_depth,
        permitted_merchants=(
            None
            if payload.mandate.permitted_merchants is None
            else frozenset(payload.mandate.permitted_merchants)
        ),
        expires_at=payload.mandate.expires_at,
    )

    depth = 0
    if parent_row is not None:
        check = can_issue(mandate_from_row(parent_row), requested)
        if not check.allowed:
            # Nothing is created. Every failing dimension is reported.
            raise HTTPException(
                status_code=422,
                detail={
                    "detail": "Sub-agent mandate exceeds the parent mandate",
                    "violations": [
                        {
                            "dimension": v.dimension,
                            "parent_value": v.parent_value,
                            "requested_value": v.requested_value,
                            "message": v.message,
                        }
                        for v in check.violations
                    ],
                },
            )
        depth = int(parent_row.depth or 0) + 1
        operator_id = parent_row.operator_id

    if db.get(Operator, operator_id) is None:
        db.add(Operator(operator_id=operator_id, name=operator_id))

    row = AgentRow(
        agent_id=f"ag_{uuid.uuid4().hex[:12]}",
        operator_id=operator_id,
        card_member_id=payload.card_member_id
        or (parent_row.card_member_id if parent_row else None),
        name=payload.name,
        parent_agent_id=payload.parent_agent_id,
        depth=depth,
        status="active",
        purpose=requested.purpose,
        permitted_categories=sorted(requested.permitted_categories),
        prohibited_attributes=sorted(requested.prohibited_attributes),
        permitted_merchants=(
            None if requested.permitted_merchants is None else sorted(requested.permitted_merchants)
        ),
        per_transaction_ceiling=requested.per_transaction_ceiling,
        daily_ceiling=requested.daily_ceiling,
        max_transactions_per_day=requested.max_transactions_per_day,
        max_delegation_depth=requested.max_delegation_depth,
        mandate_expires_at=requested.expires_at,
        mandate_hash=requested.mandate_hash,
    )
    db.add(row)
    db.commit()

    operators = {o.operator_id: o.name for o in db.scalars(select(Operator))}
    return _agent_out(row, operators.get(row.operator_id, ""))


@router.post("/agents/{agent_id}/revoke", response_model=s.RevokeResponse, tags=["agents"])
def revoke(agent_id: str, db: DbSession, principal: CurrentUser) -> s.RevokeResponse:
    row = db.get(AgentRow, agent_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    assert_can_see_agent(principal, row.operator_id)

    affected = revoke_agent(db, agent_id)
    db.commit()
    return s.RevokeResponse(revoked_agent_ids=affected, count=len(affected))


@router.post("/agents/{agent_id}/suspend", response_model=s.AgentOut, tags=["agents"])
def suspend(agent_id: str, db: DbSession, principal: CurrentUser) -> s.AgentOut:
    row = db.get(AgentRow, agent_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    assert_can_see_agent(principal, row.operator_id)
    row.status = "suspended" if row.status == "active" else "active"
    db.commit()
    operators = {o.operator_id: o.name for o in db.scalars(select(Operator))}
    return _agent_out(row, operators.get(row.operator_id, ""))


@router.get(
    "/agents/{agent_id}/can-issue",
    tags=["agents"],
    summary="Dry-run a sub-agent mandate against its parent",
)
def check_issuance(
    agent_id: str,
    db: DbSession,
    principal: CurrentUser,
    per_transaction_ceiling: Decimal = Query(...),
    daily_ceiling: Decimal = Query(...),
    max_transactions_per_day: int = Query(...),
    max_delegation_depth: int = Query(0),
    purpose: str = Query("sub-agent"),
) -> dict[str, Any]:
    parent = db.get(AgentRow, agent_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    assert_can_see_agent(principal, parent.operator_id)

    parent_mandate = mandate_from_row(parent)
    requested = Mandate(
        purpose=purpose,
        permitted_categories=parent_mandate.permitted_categories,
        prohibited_attributes=parent_mandate.prohibited_attributes,
        per_transaction_ceiling=Decimal(str(per_transaction_ceiling)),
        daily_ceiling=Decimal(str(daily_ceiling)),
        max_transactions_per_day=max_transactions_per_day,
        max_delegation_depth=max_delegation_depth,
        permitted_merchants=parent_mandate.permitted_merchants,
        expires_at=parent_mandate.expires_at,
    )
    check = can_issue(parent_mandate, requested)
    return {
        "allowed": check.allowed,
        "violations": [
            {
                "dimension": v.dimension,
                "parent_value": v.parent_value,
                "requested_value": v.requested_value,
                "message": v.message,
            }
            for v in check.violations
        ],
    }


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------


@router.get("/policies", response_model=list[s.PolicyOut], tags=["policy"])
def list_policies(db: DbSession, principal: CurrentUser) -> list[s.PolicyOut]:
    rows = list(db.scalars(select(PolicyVersion).order_by(PolicyVersion.version.desc())))
    if not rows:
        # Surface the built-in default so the studio is never empty.
        rs = active_ruleset(db)
        return [
            s.PolicyOut(
                policy_id="builtin-default",
                name=rs.name,
                version=rs.version,
                stage="enforcing",
                thresholds=rs.thresholds.to_canonical(),
                ruleset_hash=rs.ruleset_hash,
                created_by="system",
                created_at=utcnow(),
            )
        ]
    return [s.PolicyOut.model_validate(r) for r in rows]


@router.post(
    "/policy/simulate",
    response_model=s.SimulateResponse,
    tags=["policy"],
    dependencies=[Depends(require_roles(Role.OPERATOR))],
)
def simulate(payload: s.SimulateRequest, db: DbSession) -> s.SimulateResponse:
    """Replay REAL recorded history under a candidate ruleset."""
    candidate = Ruleset(
        thresholds=PolicyThresholds(**payload.thresholds.model_dump()),
        name=payload.name,
        version=_next_version(db),
    )
    return s.SimulateResponse(**simulate_policy(db, candidate, limit=payload.limit))


@router.post(
    "/policy",
    response_model=s.PolicyOut,
    status_code=201,
    tags=["policy"],
    dependencies=[Depends(require_roles(Role.OPERATOR))],
)
def create_policy(
    payload: s.SimulateRequest, db: DbSession, principal: CurrentUser
) -> s.PolicyOut:
    thresholds = PolicyThresholds(**payload.thresholds.model_dump())
    version = _next_version(db)
    ruleset = Ruleset(thresholds=thresholds, name=payload.name, version=version)
    row = PolicyVersion(
        policy_id=str(uuid.uuid4()),
        name=payload.name,
        version=version,
        stage="draft",
        thresholds=thresholds.to_canonical(),
        ruleset_hash=ruleset.ruleset_hash,
        created_by=principal.email,
    )
    db.add(row)
    db.commit()
    return s.PolicyOut.model_validate(row)


@router.post(
    "/policy/promote",
    response_model=s.PolicyOut,
    tags=["policy"],
    dependencies=[Depends(require_roles(Role.OPERATOR))],
)
def promote(payload: s.PromoteRequest, db: DbSession) -> s.PolicyOut:
    """draft -> shadow -> enforcing, one step at a time.

    Skipping shadow is refused: a policy must be observed against live traffic
    before it decides anything.
    """
    row = db.get(PolicyVersion, payload.policy_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Policy not found")

    allowed = {"draft": {"shadow"}, "shadow": {"enforcing", "draft"}, "enforcing": {"shadow"}}
    if payload.stage not in allowed.get(row.stage, set()):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot move a policy from {row.stage} to {payload.stage}. "
                "A policy must run in shadow before it can enforce."
            ),
        )

    if payload.stage == "enforcing":
        for other in db.scalars(select(PolicyVersion).where(PolicyVersion.stage == "enforcing")):
            other.stage = "draft"
    if payload.stage == "shadow":
        for other in db.scalars(select(PolicyVersion).where(PolicyVersion.stage == "shadow")):
            other.stage = "draft"

    row.stage = payload.stage
    row.promoted_at = utcnow()
    db.commit()
    return s.PolicyOut.model_validate(row)


def _next_version(db) -> int:
    return int(db.scalar(select(func.coalesce(func.max(PolicyVersion.version), 0))) or 0) + 1


# ---------------------------------------------------------------------------
# Incidents and disputes
# ---------------------------------------------------------------------------


@router.get("/incidents", response_model=list[s.IncidentOut], tags=["incidents"])
def list_incidents(
    db: DbSession,
    principal: CurrentUser,
    severity: Optional[str] = None,
    injection_only: bool = False,
    limit: int = Query(100, ge=1, le=500),
) -> list[s.IncidentOut]:
    stmt = select(ComplianceEventRow)
    if principal.role == Role.AGENT_OPERATOR:
        stmt = stmt.where(ComplianceEventRow.operator_id == principal.operator_id)
    if severity:
        stmt = stmt.where(ComplianceEventRow.severity == severity)
    if injection_only:
        stmt = stmt.where(ComplianceEventRow.suspected_prompt_injection.is_(True))

    rows = list(db.scalars(stmt.order_by(ComplianceEventRow.created_at.desc()).limit(limit)))
    names = {a.agent_id: a.name for a in db.scalars(select(AgentRow))}
    return [
        s.IncidentOut(
            **{
                **{c.name: getattr(r, c.name) for c in r.__table__.columns},
                "agent_name": names.get(r.agent_id, ""),
            }
        )
        for r in rows
    ]


@router.get("/disputes", response_model=list[s.DisputeOut], tags=["disputes"])
def list_disputes(db: DbSession, principal: CurrentUser) -> list[s.DisputeOut]:
    stmt = select(Dispute)
    if principal.role == Role.CARD_MEMBER:
        stmt = stmt.where(Dispute.card_member_id == principal.card_member_id)
    return [
        s.DisputeOut.model_validate(r)
        for r in db.scalars(stmt.order_by(Dispute.created_at.desc()))
    ]


@router.post("/disputes", response_model=s.DisputeOut, status_code=201, tags=["disputes"])
def open_dispute(
    payload: s.CreateDisputeRequest, db: DbSession, principal: CurrentUser
) -> s.DisputeOut:
    row = db.get(DecisionRow, payload.action_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    _assert_can_see_decision(principal, row)

    dispute = Dispute(
        dispute_id=str(uuid.uuid4()),
        action_id=payload.action_id,
        card_member_id=row.card_member_id or principal.card_member_id or "",
        status="open",
        reason=payload.reason,
    )
    db.add(dispute)
    db.commit()
    return s.DisputeOut.model_validate(dispute)


@router.post(
    "/disputes/{dispute_id}/packet", response_model=s.DisputePacket, tags=["disputes"]
)
def build_packet(dispute_id: str, db: DbSession, principal: CurrentUser) -> s.DisputePacket:
    """Assemble the numbered evidence document.

    Every section is derived from stored records. The liability section shows
    its derivation so a reviewer can check the reasoning rather than trust it.
    """
    dispute = db.get(Dispute, dispute_id)
    if dispute is None:
        raise HTTPException(status_code=404, detail="Dispute not found")

    decision = db.get(DecisionRow, dispute.action_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Underlying decision not found")
    _assert_can_see_decision(principal, decision)

    entry = db.scalars(
        select(LedgerEntry).where(LedgerEntry.action_id == dispute.action_id)
    ).first()
    agent = db.get(AgentRow, decision.agent_id)
    agents = load_agent_map(db)
    chain = build_chain(decision.agent_id, agents)

    injection = (
        db.scalar(
            select(func.count(ComplianceEventRow.event_id)).where(
                ComplianceEventRow.agent_id == decision.agent_id,
                ComplianceEventRow.suspected_prompt_injection.is_(True),
            )
        )
        or 0
    ) > 0

    liability = attribution_from_decision(
        entry.payload if entry else {},
        merchant_matched_authorised=True,
        suspected_injection=injection,
        mandate_present=agent is not None,
    )

    verification = verify_ledger(db)

    sections = [
        {
            "number": 1,
            "title": "Transaction",
            "fields": {
                "Action ID": decision.action_id,
                "Merchant": decision.merchant_name,
                "Merchant category": decision.merchant_category,
                "Amount": f"{decision.currency} {decision.amount}",
                "Date": decision.decided_at.isoformat(),
                "Description": decision.description or "-",
            },
        },
        {
            "number": 2,
            "title": "Authorisation",
            "fields": {
                "Agent": f"{agent.name} ({decision.agent_id})" if agent else decision.agent_id,
                "Operator": decision.operator_id,
                "Authorised purpose": agent.purpose if agent else "-",
                "Per-transaction ceiling": str(agent.per_transaction_ceiling) if agent else "-",
                "Mandate hash": agent.mandate_hash if agent else "-",
                "Verdict": decision.verdict,
                "Reason": decision.reason_code,
                "Reason (plain language)": decision.human_readable_reason,
            },
        },
        {
            "number": 3,
            "title": "Mandate conformance",
            "fields": {
                "Score": (
                    f"{float(decision.conformance_score):.2f}"
                    if decision.conformance_score is not None
                    else "not established"
                ),
                "Rationale": decision.conformance_rationale or "-",
                "Model version": decision.model_version or "-",
                "Prompt hash": decision.prompt_hash or "-",
                "Scorer available": str(decision.conformance_available),
            },
        },
        {
            "number": 4,
            "title": "Policy",
            "fields": {
                "Ruleset hash": decision.ruleset_hash,
                "Winning rule": decision.winning_rule,
                "Rules evaluated": str(len(decision.rules_fired or [])),
            },
        },
        {
            "number": 5,
            "title": "Delegation",
            "fields": {
                "Chain": " -> ".join(a.agent_id for a in chain) or decision.agent_id,
                "Depth": str(agent.depth if agent else 0),
                "Parent": (agent.parent_agent_id or "none") if agent else "-",
            },
        },
        {
            "number": 6,
            "title": "Chain of custody",
            "fields": {
                "Ledger sequence": str(entry.sequence) if entry else "-",
                "Record ID": entry.record_id if entry else "-",
                "Previous hash": entry.prev_hash if entry else "-",
                "Record hash": entry.self_hash if entry else "-",
                "Recorded at": entry.recorded_at.isoformat() if entry else "-",
            },
        },
        {
            "number": 7,
            "title": "Liability",
            "fields": {
                "Liable party": liability.party.value,
                "Rationale": liability.rationale,
                "Derivation": " | ".join(liability.derivation),
            },
        },
    ]

    dispute.liable_party = liability.party.value
    packet = s.DisputePacket(
        packet_id=str(uuid.uuid4()),
        generated_at=utcnow(),
        dispute_id=dispute_id,
        sections=sections,
        liability=liability.to_dict(),
        chain_of_custody={
            "ledger_sequence": entry.sequence if entry else None,
            "record_id": entry.record_id if entry else None,
            "self_hash": entry.self_hash if entry else None,
            "prev_hash": entry.prev_hash if entry else None,
        },
        verification=s.VerifyResponse(**verification.to_dict()),
    )
    dispute.packet = packet.model_dump(mode="json")
    db.commit()
    return packet


# ---------------------------------------------------------------------------
# Fleet
# ---------------------------------------------------------------------------


@router.get("/fleet/state", response_model=s.FleetStateOut, tags=["fleet"])
def fleet_state(db: DbSession, principal: CurrentUser) -> s.FleetStateOut:
    return _fleet_out(get_fleet_state(db))


@router.post(
    "/fleet/stop",
    response_model=s.FleetStateOut,
    tags=["fleet"],
    dependencies=[Depends(require_roles(Role.OPERATOR))],
)
def fleet_stop(
    payload: s.FleetStopRequest, db: DbSession, principal: CurrentUser
) -> s.FleetStateOut:
    state = stop_fleet(db, principal.email, payload.reason)
    db.commit()
    return _fleet_out(state)


@router.post(
    "/fleet/rearm",
    response_model=s.RearmResponse,
    tags=["fleet"],
    dependencies=[Depends(require_roles(Role.OPERATOR))],
)
def fleet_rearm(db: DbSession, principal: CurrentUser) -> s.RearmResponse:
    state, done = rearm_fleet(db, principal.email)
    db.commit()
    remaining = max(2 - len(state.rearm_approvals or []), 0)
    return s.RearmResponse(
        state=_fleet_out(state),
        rearmed=done,
        message=(
            "Fleet re-armed. Agents may transact again."
            if done
            else f"Approval recorded. {remaining} more approval(s) required from a "
            "different operator."
        ),
    )


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------


@router.get("/overview", response_model=s.OverviewResponse, tags=["fleet"])
def overview(db: DbSession, principal: CurrentUser, hours: int = Query(24, ge=1, le=720)):
    since = utcnow() - timedelta(hours=hours)
    base = select(DecisionRow).where(DecisionRow.decided_at >= since)
    if principal.role == Role.AGENT_OPERATOR:
        base = base.where(DecisionRow.operator_id == principal.operator_id)

    rows = list(db.scalars(base))
    total = len(rows)
    denied = sum(1 for r in rows if r.verdict == "DENY")
    stepped = sum(1 for r in rows if r.verdict == "STEP_UP")
    allowed = sum(1 for r in rows if r.verdict == "ALLOW")
    flagged = sum(1 for r in rows if r.flagged)

    latencies = sorted(r.latency_ms or 0 for r in rows)
    p99 = latencies[int(len(latencies) * 0.99)] if latencies else 0

    block_rate = (denied / total) if total else 0.0
    # A "false block" proxy: a step-up the member approved -- i.e. friction we
    # created for a purchase that turned out to be wanted.
    # FALSE-BLOCK RATE, measured -- not assumed.
    #
    # A false block is a DENY on an action that was actually legitimate. The
    # only honest source for "actually legitimate" is a ground-truth label, and
    # the seed generator records one on every action it creates. Denominator is
    # the legitimate actions we saw, not all traffic: "of the purchases the card
    # member genuinely wanted, what share did we wrongly stop?"
    #
    # Rows without a label (real traffic) are excluded rather than guessed at.
    labelled = [r for r in rows if r.seed_legitimate is not None]
    legitimate = [r for r in labelled if r.seed_legitimate]
    wrongly_denied = [r for r in legitimate if r.verdict == "DENY"]
    false_block_rate = (len(wrongly_denied) / len(legitimate)) if legitimate else 0.0

    # Secondary, always available: friction the member cleared themselves.
    approved_step_ups = sum(1 for r in rows if r.step_up_state in {"approved", "always_allowed"})
    step_up_approval_rate = (approved_step_ups / total) if total else 0.0

    exposure = Decimal("0")
    for r in rows:
        if r.verdict == "ALLOW":
            exposure += Decimal(str(r.amount))

    # Hourly series.
    buckets: dict[str, dict[str, Any]] = {}
    for r in rows:
        key = r.decided_at.replace(minute=0, second=0, microsecond=0).isoformat()
        b = buckets.setdefault(
            key, {"t": key, "total": 0, "blocked": 0, "false_blocked": 0, "legitimate": 0}
        )
        b["total"] += 1
        if r.verdict == "DENY":
            b["blocked"] += 1
        if r.seed_legitimate:
            b["legitimate"] += 1
            if r.verdict == "DENY":
                b["false_blocked"] += 1
    series = sorted(buckets.values(), key=lambda b: b["t"])
    for b in series:
        b["block_rate"] = round(b["blocked"] / b["total"], 4) if b["total"] else 0
        b["false_block_rate"] = (
            round(b["false_blocked"] / b["legitimate"], 4) if b["legitimate"] else 0
        )

    by_operator: dict[str, Decimal] = {}
    for r in rows:
        if r.verdict == "ALLOW":
            by_operator[r.operator_id] = by_operator.get(r.operator_id, Decimal("0")) + Decimal(
                str(r.amount)
            )
    names = {o.operator_id: o.name for o in db.scalars(select(Operator))}

    events = list(
        db.scalars(
            select(ComplianceEventRow)
            .where(ComplianceEventRow.acknowledged.is_(False))
            .order_by(ComplianceEventRow.created_at.desc())
            .limit(20)
        )
    )
    agent_names = {a.agent_id: a.name for a in db.scalars(select(AgentRow))}
    rs = active_ruleset(db)
    stage = "enforcing"
    if db.scalar(select(func.count(PolicyVersion.policy_id)).where(PolicyVersion.stage == "shadow")):
        stage = "shadow"

    return s.OverviewResponse(
        tiles=[
            s.MetricTile(
                key="decisions",
                label="Decisions",
                value=float(total),
                tooltip=f"Authorisation decisions made in the last {hours} hours.",
            ),
            s.MetricTile(
                key="blocked",
                label="Blocked",
                value=float(denied),
                tooltip="Transactions denied outright by policy.",
            ),
            s.MetricTile(
                key="step_up",
                label="Sent for approval",
                value=float(stepped),
                tooltip="Transactions held pending the card member's approval.",
            ),
            s.MetricTile(
                key="exposure",
                label="Approved exposure",
                value=float(exposure),
                unit="INR",
                tooltip="Total value of transactions allowed in the window.",
            ),
        ],
        block_rate_series=series,
        exposure_by_operator=[
            {"operator_id": k, "operator_name": names.get(k, k), "exposure": float(v)}
            for k, v in sorted(by_operator.items(), key=lambda kv: kv[1], reverse=True)
        ],
        armed_breakers=[
            s.IncidentOut(
                **{
                    **{c.name: getattr(e, c.name) for c in e.__table__.columns},
                    "agent_name": agent_names.get(e.agent_id, ""),
                }
            )
            for e in events
        ],
        p99_latency_ms=int(p99),
        block_rate=round(block_rate, 4),
        false_block_rate=round(false_block_rate, 4),
        false_block_sample_size=len(legitimate),
        step_up_approval_rate=round(step_up_approval_rate, 4),
        policy_stage=stage,
        ruleset_hash=rs.ruleset_hash,
    )


@router.websocket("/stream")
async def stream(websocket: WebSocket, token: str = Query(...)) -> None:
    """Live decision feed.

    The token arrives as a query parameter because browsers cannot set headers
    on a WebSocket handshake. It is the SAME JWT the REST API uses and is
    verified the same way -- and the subscription is scoped by the role inside
    it, so an agent operator watching the stream sees only their own agents.
    """
    try:
        claims = decode_token(token)
    except HTTPException:
        await websocket.close(code=4401, reason="Invalid or expired token")
        return

    await websocket.accept()
    subscriber = hub.subscribe(
        role=claims.get("role", ""),
        operator_id=claims.get("operator_id"),
        card_member_id=claims.get("card_member_id"),
    )
    try:
        await websocket.send_json({"type": "connected", "role": claims.get("role")})
        while True:
            try:
                event = await asyncio.wait_for(subscriber.queue.get(), timeout=25)
                await websocket.send_json({"type": "decision", "data": event})
            except asyncio.TimeoutError:
                # Keep-alive. Idle proxies drop silent connections, and a feed
                # that dies quietly is worse than one that never connected.
                await websocket.send_json({"type": "heartbeat"})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        hub.unsubscribe(subscriber)


@router.get("/merchants", tags=["reference"])
def list_merchants(db: DbSession, principal: CurrentUser) -> list[dict[str, Any]]:
    return [
        {
            "merchant_id": m.merchant_id,
            "name": m.name,
            "category": m.category,
            "attributes": m.attributes or [],
        }
        for m in db.scalars(select(MerchantRow).order_by(MerchantRow.name))
    ]


@router.get("/operators", tags=["reference"])
def list_operators(db: DbSession, principal: CurrentUser) -> list[dict[str, Any]]:
    counts = dict(
        db.execute(
            select(AgentRow.operator_id, func.count(AgentRow.agent_id)).group_by(
                AgentRow.operator_id
            )
        ).all()
    )
    return [
        {
            "operator_id": o.operator_id,
            "name": o.name,
            "revoked": o.revoked,
            "agent_count": counts.get(o.operator_id, 0),
        }
        for o in db.scalars(select(Operator).order_by(Operator.name))
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _assert_can_see_decision(principal: Principal, row: DecisionRow) -> None:
    if principal.role == Role.OPERATOR:
        return
    if principal.role == Role.AGENT_OPERATOR and row.operator_id == principal.operator_id:
        return
    if principal.role == Role.CARD_MEMBER and row.card_member_id == principal.card_member_id:
        return
    raise HTTPException(status_code=403, detail="You do not have access to this record.")


def _decision_out(row: DecisionRow, agent: Optional[AgentRow]) -> s.DecisionOut:
    return s.DecisionOut(
        action_id=row.action_id,
        agent_id=row.agent_id,
        agent_name=agent.name if agent else "",
        operator_id=row.operator_id,
        verdict=row.verdict,
        reason_code=row.reason_code,
        human_readable_reason=row.human_readable_reason,
        winning_rule=row.winning_rule,
        ruleset_hash=row.ruleset_hash,
        flagged=bool(row.flagged),
        merchant_id=row.merchant_id,
        merchant_name=row.merchant_name,
        merchant_category=row.merchant_category,
        merchant_attributes=row.merchant_attributes or [],
        cart_items=row.cart_items or [],
        cart_digest=row.cart_digest or "",
        ship_to=row.ship_to,
        injected_instruction=row.injected_instruction,
        amount=row.amount,
        currency=row.currency,
        description=row.description or "",
        conformance=s.ConformanceOut(
            score=float(row.conformance_score) if row.conformance_score is not None else None,
            rationale=row.conformance_rationale or "",
            vetoes=[],
            model_version=row.model_version or "",
            prompt_hash=row.prompt_hash or "",
            available=bool(row.conformance_available),
        ),
        delegation_chain=row.delegation_chain or [],
        rules_fired=[s.RuleOutcomeOut(**r) for r in (row.rules_fired or [])],
        features=row.features or {},
        step_up_state=row.step_up_state,
        latency_ms=row.latency_ms or 0,
        decided_at=row.decided_at,
    )


def _agent_out(row: AgentRow, operator_name: str) -> s.AgentOut:
    return s.AgentOut(
        agent_id=row.agent_id,
        operator_id=row.operator_id,
        operator_name=operator_name,
        card_member_id=row.card_member_id,
        name=row.name,
        parent_agent_id=row.parent_agent_id,
        depth=int(row.depth or 0),
        status=row.status,
        breaker_tripped=bool(row.breaker_tripped),
        mandate=s.MandateOut(
            purpose=row.purpose,
            permitted_categories=row.permitted_categories or [],
            prohibited_attributes=row.prohibited_attributes or [],
            permitted_merchants=row.permitted_merchants,
            per_transaction_ceiling=row.per_transaction_ceiling,
            daily_ceiling=row.daily_ceiling,
            max_transactions_per_day=row.max_transactions_per_day,
            max_delegation_depth=row.max_delegation_depth,
            expires_at=row.mandate_expires_at,
            mandate_hash=row.mandate_hash,
        ),
        created_at=row.created_at,
    )


def _build_tree(agent_id: str, rows: dict[str, AgentRow]) -> Optional[s.AgentTreeNode]:
    row = rows.get(agent_id)
    if row is None:
        return None
    children = [
        r for r in rows.values() if r.parent_agent_id == agent_id and r.agent_id != agent_id
    ]
    return s.AgentTreeNode(
        agent_id=row.agent_id,
        name=row.name,
        status=row.status,
        depth=int(row.depth or 0),
        breaker_tripped=bool(row.breaker_tripped),
        per_transaction_ceiling=row.per_transaction_ceiling,
        purpose=row.purpose,
        children=[
            node
            for node in (_build_tree(c.agent_id, rows) for c in sorted(children, key=lambda a: a.agent_id))
            if node is not None
        ],
    )


def _fleet_out(state) -> s.FleetStateOut:
    return s.FleetStateOut(
        stopped=bool(state.stopped),
        stopped_by=state.stopped_by,
        stopped_at=state.stopped_at,
        stop_reason=state.stop_reason or "",
        rearm_approvals=list(state.rearm_approvals or []),
        approvals_required=2,
    )
