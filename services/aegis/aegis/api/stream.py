"""The live decision feed (WS /stream).

The Fleet Overview is meant to show decisions as they happen. Polling gets
close, but it either wastes requests or lags behind; a websocket makes "live"
literally true.

Two properties matter:

  * **Broadcasting can never affect a decision.** Every push is best-effort and
    wrapped -- a dashboard that disconnected mid-write must not be able to fail
    a payment authorisation. The ledger write happens first; the notification is
    a courtesy afterwards.

  * **Subscribers are scoped by role.** An agent operator watching the stream
    sees only their own agents' decisions. The filter is applied here, on the
    server, for the same reason it is applied to every REST query: the client
    asking nicely is not access control.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass(eq=False)
class Subscriber:
    queue: "asyncio.Queue[dict[str, Any]]"
    role: str
    operator_id: Optional[str] = None
    card_member_id: Optional[str] = None

    def may_see(self, event: dict[str, Any]) -> bool:
        if self.role == "operator":
            return True
        if self.role == "agent_operator":
            return event.get("operator_id") == self.operator_id
        if self.role == "card_member":
            return event.get("card_member_id") == self.card_member_id
        return False


class DecisionHub:
    """Fan-out to connected dashboards.

    Each subscriber gets a bounded queue. A slow client fills its queue and then
    starts dropping ITS OWN events rather than applying backpressure to the
    decision path -- the alternative would let one stalled browser tab slow down
    payment authorisation for everybody.
    """

    MAX_QUEUE = 200

    def __init__(self) -> None:
        self._subscribers: set[Subscriber] = set()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(
        self, role: str, operator_id: Optional[str], card_member_id: Optional[str]
    ) -> Subscriber:
        sub = Subscriber(
            queue=asyncio.Queue(maxsize=self.MAX_QUEUE),
            role=role,
            operator_id=operator_id,
            card_member_id=card_member_id,
        )
        self._subscribers.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        self._subscribers.discard(sub)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def publish(self, event: dict[str, Any]) -> None:
        """Push an event. Safe to call from a synchronous request handler."""
        if not self._subscribers:
            return
        for sub in list(self._subscribers):
            if not sub.may_see(event):
                continue
            try:
                sub.queue.put_nowait(event)
            except asyncio.QueueFull:
                # Drop for this subscriber only. Their next reconnect resyncs
                # from the REST endpoint, which is the source of truth anyway.
                logger.debug("stream subscriber is slow; dropping one event")
            except Exception:
                logger.debug("stream publish failed for one subscriber", exc_info=True)


hub = DecisionHub()


def broadcast_decision(event: dict[str, Any]) -> None:
    """Best-effort notification. Never raises into the decision path."""
    try:
        hub.publish(event)
    except Exception:  # noqa: BLE001
        logger.debug("broadcast failed", exc_info=True)
