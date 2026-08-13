"""Conformance engine construction from configuration.

One place decides which scorer the service runs with, so the mode is visible
in logs at boot rather than inferred from behaviour later.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from .config import get_settings
from .engine.conformance import (
    ConformanceEngine,
    DeterministicScorer,
    FallbackScorer,
    InMemoryCache,
    OpenAIScorer,
    RedisCache,
    ReplayScorer,
    UnavailableScorer,
)

logger = logging.getLogger(__name__)


def load_fixture(path: str) -> dict[str, Any]:
    candidates = [Path(path), Path(__file__).resolve().parent.parent / path]
    for candidate in candidates:
        if candidate.exists():
            try:
                return json.loads(candidate.read_text())
            except (ValueError, OSError):
                logger.warning("could not read conformance fixture at %s", candidate)
                return {}
    return {}


def _build_cache():
    settings = get_settings()
    try:
        import redis

        client = redis.Redis.from_url(settings.redis_url, socket_timeout=1)
        client.ping()
        logger.info("conformance cache: redis at %s", settings.redis_url)
        return RedisCache(client)
    except Exception:
        # A missing Redis must not stop the service: the cache is an
        # optimisation, and every miss simply becomes a live call.
        logger.warning("redis unavailable, using in-memory conformance cache")
        return InMemoryCache()


@lru_cache(maxsize=1)
def get_conformance_engine() -> ConformanceEngine:
    settings = get_settings()
    mode = settings.resolved_scorer_mode

    if mode == "off":
        scorer = UnavailableScorer(reason="scorer disabled by configuration")
    elif mode == "replay":
        fixture = load_fixture(settings.scorer_fixture_path)
        logger.info("conformance scorer: REPLAY (%d recorded scores)", len(fixture))
        scorer = ReplayScorer(fixture=fixture, model_version=settings.scorer_model)
    else:
        logger.info("conformance scorer: LIVE (%s)", settings.scorer_model)
        scorer = OpenAIScorer(
            api_key=settings.openai_api_key or None,
            model=settings.scorer_model,
            timeout=settings.scorer_timeout_seconds,
        )

    # Wrap everything except a deliberately-disabled scorer in the
    # deterministic fallback.
    #
    # Fail-closed is about NEVER inventing an ALLOW; it is not a reason to send
    # every unscoreable action to the card member. Replay only holds the seeded
    # corpus, so any novel action -- every simulator checkout, every live
    # integration call -- missed the fixture and stepped up with
    # scorer_unavailable_fail_closed, which is indistinguishable from a real
    # policy hesitation and buries the member in noise.
    #
    # The deterministic scorer is weighted, auditable and offline, and it is
    # recorded in model_version, so a fallback score can never be mistaken for
    # a model score. "off" stays unwrapped because exercising the true
    # fail-closed path is exactly what it is for.
    if mode != "off":
        scorer = FallbackScorer(primary=scorer, fallback=DeterministicScorer())

    return ConformanceEngine(scorer=scorer, cache=_build_cache())


# ---------------------------------------------------------------------------
# Limits share the same Redis client as the conformance cache: one connection,
# one failure mode, one place that decides what happens when it is missing.
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _redis_client():
    settings = get_settings()
    try:
        import redis

        client = redis.Redis.from_url(settings.redis_url, socket_timeout=1)
        client.ping()
        return client
    except Exception:
        logger.warning("redis unavailable: limits degrade to process-local state")
        return None


@lru_cache(maxsize=1)
def get_idempotency_store():
    from .limits import IdempotencyStore

    return IdempotencyStore(_redis_client())


@lru_cache(maxsize=1)
def get_rate_limiter():
    from .limits import RateLimiter

    settings = get_settings()
    return RateLimiter(_redis_client(), settings.decide_rate_limit_per_minute)
