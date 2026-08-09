"""JWT authentication and role-based authorisation.

Extends the JWT scheme Aurora's frontend already speaks (Bearer token in the
Authorization header, `/auth/login` returning a token and a user object) with
three roles:

    operator        -- full console: fleet, policy, incidents, disputes
    agent_operator  -- their OWN agents only; may not touch policy or the fleet
    card_member     -- their own decisions and step-ups, in plain language

Scoping is enforced server-side. A card_member calling /decisions gets their
own rows because the query is filtered by their identity from the token, not
because the client asked nicely.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db.models import User
from ..db.session import get_db

# bcrypt directly rather than through passlib: passlib 1.7's backend probe is
# incompatible with bcrypt >= 4.1, and this is a small enough surface that the
# abstraction was not earning its keep.
BCRYPT_ROUNDS = 12
BCRYPT_MAX_BYTES = 72
"""bcrypt truncates at 72 bytes. We reject longer inputs rather than silently
truncating, so two different long passwords can never authenticate each other."""

bearer = HTTPBearer(auto_error=False)


class Role:
    OPERATOR = "operator"
    AGENT_OPERATOR = "agent_operator"
    CARD_MEMBER = "card_member"


class Principal(BaseModel):
    """The authenticated caller, as the API sees them."""

    user_id: str
    email: str
    name: str
    role: str
    operator_id: Optional[str] = None
    card_member_id: Optional[str] = None

    @property
    def is_operator(self) -> bool:
        return self.role == Role.OPERATOR


def hash_password(raw: str) -> str:
    encoded = raw.encode("utf-8")
    if len(encoded) > BCRYPT_MAX_BYTES:
        raise ValueError(
            f"Password must be at most {BCRYPT_MAX_BYTES} bytes when UTF-8 encoded."
        )
    return bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(raw: str, hashed: str) -> bool:
    encoded = raw.encode("utf-8")
    if len(encoded) > BCRYPT_MAX_BYTES:
        return False
    try:
        return bcrypt.checkpw(encoded, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(user: User) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.user_id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "operator_id": user.operator_id,
        "card_member_id": user.card_member_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.jwt_ttl_seconds)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )


def authenticate(session: Session, email: str, password: str) -> Optional[User]:
    user = session.scalars(select(User).where(User.email == email.lower().strip())).first()
    if user is None:
        # Do the work anyway so a missing account and a wrong password take
        # comparable time -- otherwise the endpoint enumerates valid emails.
        bcrypt.hashpw(b"timing-equalisation", bcrypt.gensalt(rounds=BCRYPT_ROUNDS))
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def current_principal(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer)],
) -> Principal:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    claims = decode_token(credentials.credentials)
    return Principal(
        user_id=claims.get("sub", ""),
        email=claims.get("email", ""),
        name=claims.get("name", ""),
        role=claims.get("role", ""),
        operator_id=claims.get("operator_id"),
        card_member_id=claims.get("card_member_id"),
    )


CurrentUser = Annotated[Principal, Depends(current_principal)]
DbSession = Annotated[Session, Depends(get_db)]


def require_roles(*roles: str):
    """Dependency factory: restrict an endpoint to the given roles."""

    def guard(principal: CurrentUser) -> Principal:
        if principal.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"This action requires one of: {', '.join(roles)}. "
                    f"You are signed in as {principal.role or 'unknown'}."
                ),
            )
        return principal

    return guard


RequireOperator = Annotated[Principal, Depends(require_roles(Role.OPERATOR))]
RequireConsole = Annotated[
    Principal, Depends(require_roles(Role.OPERATOR, Role.AGENT_OPERATOR))
]
RequireMember = Annotated[Principal, Depends(require_roles(Role.CARD_MEMBER))]


def assert_can_see_agent(principal: Principal, agent_operator_id: str) -> None:
    """An agent_operator may only reach their own operator's agents."""
    if principal.role == Role.OPERATOR:
        return
    if principal.role == Role.AGENT_OPERATOR and principal.operator_id == agent_operator_id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to this agent.",
    )
