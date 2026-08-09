"""Idempotency and rate limiting for the decision endpoint.

Both are storage-backed and both must behave sanely when that storage is gone.
Their failure modes are deliberately opposite, because the risk is opposite:

  * **Idempotency** fails OPEN. If we cannot look up a previous decision, we
    make a new one. Worst case is a duplicate ledger record -- untidy, but the
    ledger is append-only and a duplicate is visible and explainable.

  * **Rate limiting** fails CLOSED-ish. If we cannot count, we cannot prove an
    agent is inside its limit... but refusing all traffic on a cache outage
    turns a Redis blip into an outage of the payment system. So it degrades to
    an in-process counter: still bounded, no longer shared across workers, and
    it says so in the logs.

Redis is optional throughout. Without it, both fall back to process-local
state, which is correct for a single-worker demo and clearly documented as
insufficient for a multi-worker deployment.
"""

from __future__ import annotations

import json
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


class IdempotencyStore:
    """Remembers the decision produced for a client-supplied key.

    A retried request must return the ORIGINAL decision rather than making a
    second one. Without this, a network retry writes a second ledger record for
    a single real-world event -- which corrupts every count derived from the
    ledger and makes the audit trail claim something happened twice.
    """

    def __init__(self, redis_client: Any = None) -> None:
        self._redis = redis_client
        self._local: dict[str, tuple[float, dict[str, Any]]] = {}

    @staticmethod
    def _key(agent_id: str, idempotency_key: str) -> str:
        # Scoped per agent: two agents may legitimately choose the same key.
        return f"aegis:idem:{agent_id}:{idempotency_key}"

    def get(self, agent_id: str, idempotency_key: str) -> Optional[dict[str, Any]]:
        key = self._key(agent_id, idempotency_key)
        if self._redis is not None:
            try:
                raw = self._redis.get(key)
                return json.loads(raw) if raw else None
            except Exception:
                logger.warning("idempotency read failed; treating as a miss", exc_info=True)
                return None

        entry = self._local.get(key)
        if entry is None:
            return None
        stored_at, payload = entry
        if time.time() - stored_at > IDEMPOTENCY_TTL_SECONDS:
            self._local.pop(key, None)
            return None
        return payload

    def put(self, agent_id: str, idempotency_key: str, payload: dict[str, Any]) -> None:
        key = self._key(agent_id, idempotency_key)
        if self._redis is not None:
            try:
                self._redis.setex(key, IDEMPOTENCY_TTL_SECONDS, json.dumps(payload))
                return
            except Exception:
                logger.warning("idempotency write failed", exc_info=True)
        self._local[key] = (time.time(), payload)


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


@dataclass
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after_seconds: int = 0


class RateLimiter:
    """Fixed-window per-agent limiter.

    A sliding window would be more precise, but a fixed window is trivially
    explainable to an operator asking "why was my agent throttled?", and
    precision is not what this control is for -- it exists to stop a runaway
    loop, not to meter billing.
    """

    def __init__(self, redis_client: Any = None, limit_per_minute: int = 120) -> None:
        self._redis = redis_client
        self.limit = limit_per_minute
        self._local: dict[str, deque[float]] = {}

    def check(self, agent_id: str) -> RateLimitResult:
        if self.limit <= 0:  # 0 disables the limiter entirely
            return RateLimitResult(allowed=True, remaining=0)

        window = int(time.time() // 60)
        key = f"aegis:rate:{agent_id}:{window}"

        if self._redis is not None:
            try:
                count = self._redis.incr(key)
                if count == 1:
                    self._redis.expire(key, 120)
                if count > self.limit:
                    return RateLimitResult(
                        allowed=False, remaining=0, retry_after_seconds=60 - int(time.time() % 60)
                    )
                return RateLimitResult(allowed=True, remaining=self.limit - count)
            except Exception:
                logger.warning(
                    "rate limiter degraded to process-local counting (redis unavailable)",
                    exc_info=True,
                )

        # Process-local fallback. Bounded, but not shared between workers.
        now = time.time()
        bucket = self._local.setdefault(agent_id, deque())
        while bucket and now - bucket[0] > 60:
            bucket.popleft()
        if len(bucket) >= self.limit:
            return RateLimitResult(
                allowed=False, remaining=0, retry_after_seconds=int(60 - (now - bucket[0])) or 1
            )
        bucket.append(now)
        return RateLimitResult(allowed=True, remaining=self.limit - len(bucket))
