"""Provider seams for Amex ACE.

AEGIS governs agent spending; it does not want to *own* agent identity, intent
capture, cart retrieval or payment credentials. Amex's Agentic Commerce
Experiences (ACE) kit provides those as five services. Two of its specs are not
yet public and access is gated, so the MVP cannot call ACE for real.

The answer is not to pretend, and not to hard-code either. Each ACE service gets
a narrow Protocol here with two implementations:

    Sim*   -- reads the local database. What the MVP runs on.
    Ace*   -- calls the real service. Stubbed, and honest about being stubbed.

`get_providers()` picks between them from configuration. Swapping to real ACE is
changing one environment variable, not a rewrite -- which is the difference
between "we could integrate" and "we designed for it".

The Protocols are deliberately thin. Every method returns data AEGIS already
models, so a future ACE response is adapted at the boundary and the engine never
learns that ACE exists.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Optional, Protocol, runtime_checkable

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .engine.types import ActionRequest, Agent, CartItem, Mandate

logger = logging.getLogger(__name__)


class ProviderUnavailable(RuntimeError):
    """A provider could not answer.

    Callers must treat this as a fail-closed condition. An identity we cannot
    verify or a mandate we cannot read is not a reason to proceed.
    """


# ---------------------------------------------------------------------------
# Protocols -- one per ACE service
# ---------------------------------------------------------------------------


@runtime_checkable
class IdentityProvider(Protocol):
    """ACE Agent Registration. Answers: is this a real, registered agent?"""

    name: str

    def verify(self, agent_id: str) -> Optional[Agent]: ...


@runtime_checkable
class MandateProvider(Protocol):
    """ACE Intent Intelligence. Answers: what did the human actually authorise?"""

    name: str

    def get(self, agent_id: str) -> Optional[Mandate]: ...


@runtime_checkable
class CartProvider(Protocol):
    """ACE Cart Context. Answers: what is actually in the basket?"""

    name: str

    def get(self, action_id: str) -> tuple[CartItem, ...]: ...


@runtime_checkable
class PaymentProvider(Protocol):
    """ACE Payment Credentials. Answers: what token settles this?"""

    name: str

    def token(self, agent_id: str, amount: Decimal, currency: str = "INR") -> str: ...


@dataclass(frozen=True)
class Providers:
    identity: IdentityProvider
    mandate: MandateProvider
    cart: CartProvider
    payment: PaymentProvider

    def describe(self) -> dict[str, str]:
        return {
            "identity": self.identity.name,
            "mandate": self.mandate.name,
            "cart": self.cart.name,
            "payment": self.payment.name,
        }


# ---------------------------------------------------------------------------
# Simulated implementations -- what the MVP runs on
# ---------------------------------------------------------------------------


@dataclass
class SimIdentityProvider:
    """Reads the local agent registry.

    In production ACE would attest the agent's identity and key. Here the
    registry IS the source of truth, which is honest for a system whose own
    database mints the agents.
    """

    session: Session
    name: str = "sim:local-registry"

    def verify(self, agent_id: str) -> Optional[Agent]:
        from .db.models import AgentRow
        from .service import agent_from_row

        row = self.session.get(AgentRow, agent_id)
        return agent_from_row(row) if row is not None else None


@dataclass
class SimMandateProvider:
    """Reads the mandate stored alongside the agent."""

    session: Session
    name: str = "sim:seeded-mandates"

    def get(self, agent_id: str) -> Optional[Mandate]:
        from .db.models import AgentRow
        from .service import mandate_from_row

        row = self.session.get(AgentRow, agent_id)
        return mandate_from_row(row) if row is not None else None


@dataclass
class SimCartProvider:
    """Returns the cart carried on the request itself.

    ACE Cart Context would fetch the basket from the merchant. In the MVP the
    caller supplies it, so this provider exists to hold the seam open rather
    than to do work.
    """

    session: Optional[Session] = None
    name: str = "sim:inline-cart"

    def get(self, action_id: str) -> tuple[CartItem, ...]:
        return ()


@dataclass
class SimPaymentProvider:
    """Issues a clearly-fake token. No money moves in the MVP."""

    name: str = "sim:fake-token"

    def token(self, agent_id: str, amount: Decimal, currency: str = "INR") -> str:
        from .engine.types import sha256_hex

        return "sim_tok_" + sha256_hex(agent_id, str(amount), currency)[:24]


# ---------------------------------------------------------------------------
# ACE implementations -- stubs that refuse rather than fake
# ---------------------------------------------------------------------------


@dataclass
class AceIdentityProvider:
    """Calls ACE Agent Registration.

    Deliberately raises rather than returning a plausible-looking answer. A
    governance control that silently invents an identity when its source is
    unreachable is worse than one that stops -- so this fails closed, loudly,
    and `decide()` turns that into a denial.
    """

    base_url: str
    api_key: str
    name: str = "ace:agent-registration"

    def verify(self, agent_id: str) -> Optional[Agent]:
        raise ProviderUnavailable(
            "ACE Agent Registration is not wired up: the specification is not "
            "public and access is gated. Set AEGIS_PROVIDERS=sim to use the "
            "local registry."
        )


@dataclass
class AceMandateProvider:
    """Calls ACE Intent Intelligence (spec public, access gated)."""

    base_url: str
    api_key: str
    name: str = "ace:intent-intelligence"

    def get(self, agent_id: str) -> Optional[Mandate]:
        raise ProviderUnavailable(
            "ACE Intent Intelligence is not wired up: access is gated. "
            "Set AEGIS_PROVIDERS=sim to use seeded mandates."
        )


@dataclass
class AceCartProvider:
    base_url: str
    api_key: str
    name: str = "ace:cart-context"

    def get(self, action_id: str) -> tuple[CartItem, ...]:
        raise ProviderUnavailable(
            "ACE Cart Context is not wired up: the specification is not public."
        )


@dataclass
class AcePaymentProvider:
    base_url: str
    api_key: str
    name: str = "ace:payment-credentials"

    def token(self, agent_id: str, amount: Decimal, currency: str = "INR") -> str:
        raise ProviderUnavailable(
            "ACE Payment Credentials is not wired up: access is gated."
        )


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------


def get_providers(session: Session) -> Providers:
    """Pick the provider set from configuration.

    AEGIS_PROVIDERS=sim (default) or ace. This one function is the entire
    integration switch.
    """
    settings = get_settings()
    if settings.providers == "ace":
        base = settings.ace_base_url
        key = settings.ace_api_key
        logger.info("providers: ACE (%s)", base)
        return Providers(
            identity=AceIdentityProvider(base, key),
            mandate=AceMandateProvider(base, key),
            cart=AceCartProvider(base, key),
            payment=AcePaymentProvider(base, key),
        )

    return Providers(
        identity=SimIdentityProvider(session),
        mandate=SimMandateProvider(session),
        cart=SimCartProvider(session),
        payment=SimPaymentProvider(),
    )
