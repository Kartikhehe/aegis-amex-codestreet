"""conformance.py -- determinism of vetoes, caching, and fail-closed behaviour."""

from __future__ import annotations

from decimal import Decimal

import pytest

from aegis.engine.conformance import (
    PROMPT_HASH,
    ConformanceEngine,
    InMemoryCache,
    OpenAIScorer,
    ReplayScorer,
    UnavailableScorer,
    build_user_prompt,
    cache_key,
    deterministic_vetoes,
)
from aegis.engine.types import ActionRequest, ConformanceResult, Mandate


# ---------------------------------------------------------------------------
# Deterministic vetoes run before, and independently of, any model call
# ---------------------------------------------------------------------------


def test_veto_is_pure_set_intersection(pantry_mandate, trap_giftcard_action, legit_grocery_action):
    assert deterministic_vetoes(pantry_mandate, trap_giftcard_action) == frozenset(
        {"gift_card", "cash_equivalent"}
    )
    assert deterministic_vetoes(pantry_mandate, legit_grocery_action) == frozenset()


def test_veto_short_circuits_before_the_scorer(pantry_mandate, trap_giftcard_action):
    class ExplodingScorer:
        model_version = "should-never-run"

        def score(self, mandate, action):
            raise AssertionError("scorer must not be called when a veto applies")

    engine = ConformanceEngine(scorer=ExplodingScorer(), cache=InMemoryCache())
    result = engine.evaluate(pantry_mandate, trap_giftcard_action)

    assert result.available is True
    assert result.score == 0.0
    assert result.model_version == "deterministic"
    assert set(result.vetoes) == {"gift_card", "cash_equivalent"}


def test_veto_result_is_not_cached_as_a_model_score(pantry_mandate, trap_giftcard_action):
    cache = InMemoryCache()
    engine = ConformanceEngine(scorer=UnavailableScorer(), cache=cache)
    engine.evaluate(pantry_mandate, trap_giftcard_action)
    assert len(cache) == 0


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


def test_cache_key_is_keyed_on_mandate_and_action_signature(
    pantry_mandate, legit_grocery_action
):
    same_shape = ActionRequest(
        action_id="DIFFERENT_ID",
        agent_id="DIFFERENT_AGENT",
        merchant_id=legit_grocery_action.merchant_id,
        merchant_name=legit_grocery_action.merchant_name,
        merchant_category=legit_grocery_action.merchant_category,
        amount=legit_grocery_action.amount,
        description=legit_grocery_action.description,
        merchant_attributes=legit_grocery_action.merchant_attributes,
    )
    # action_id and timestamp must NOT affect the key...
    assert cache_key(pantry_mandate, legit_grocery_action) == cache_key(
        pantry_mandate, same_shape
    )

    # ...but the amount must.
    different = ActionRequest(
        action_id=legit_grocery_action.action_id,
        agent_id=legit_grocery_action.agent_id,
        merchant_id=legit_grocery_action.merchant_id,
        merchant_name=legit_grocery_action.merchant_name,
        merchant_category=legit_grocery_action.merchant_category,
        amount=Decimal("9999"),
        description=legit_grocery_action.description,
    )
    assert cache_key(pantry_mandate, legit_grocery_action) != cache_key(pantry_mandate, different)


def test_cache_prevents_a_second_call(pantry_mandate, legit_grocery_action):
    calls = {"n": 0}

    class CountingScorer:
        model_version = "counting"

        def score(self, mandate, action):
            calls["n"] += 1
            return ConformanceResult(score=0.9, rationale="ok", model_version="counting")

    engine = ConformanceEngine(scorer=CountingScorer(), cache=InMemoryCache())
    first = engine.evaluate(pantry_mandate, legit_grocery_action)
    second = engine.evaluate(pantry_mandate, legit_grocery_action)

    assert calls["n"] == 1
    assert first.cached is False
    assert second.cached is True
    assert second.score == first.score


def test_failures_are_never_cached(pantry_mandate, legit_grocery_action):
    """A cached timeout would make a transient outage permanent."""
    cache = InMemoryCache()
    engine = ConformanceEngine(scorer=UnavailableScorer(reason="timeout"), cache=cache)
    engine.evaluate(pantry_mandate, legit_grocery_action)
    assert len(cache) == 0


def test_a_broken_cache_degrades_to_a_live_call(pantry_mandate, legit_grocery_action):
    class BrokenCache:
        def get(self, key):
            raise RuntimeError("redis down")

        def set(self, key, value, ttl=0):
            raise RuntimeError("redis down")

    class OkScorer:
        model_version = "ok"

        def score(self, mandate, action):
            return ConformanceResult(score=0.88, rationale="ok", model_version="ok")

    from aegis.engine.conformance import RedisCache

    class FakeClient:
        def get(self, key):
            raise RuntimeError("redis down")

        def setex(self, key, ttl, value):
            raise RuntimeError("redis down")

    engine = ConformanceEngine(scorer=OkScorer(), cache=RedisCache(FakeClient()))
    result = engine.evaluate(pantry_mandate, legit_grocery_action)
    assert result.available is True
    assert result.score == 0.88


# ---------------------------------------------------------------------------
# Fail-closed
# ---------------------------------------------------------------------------


def test_any_scorer_exception_becomes_unavailable(pantry_mandate, legit_grocery_action):
    class ThrowingScorer:
        model_version = "throwing"

        def score(self, mandate, action):
            raise TimeoutError("upstream timed out")

    engine = ConformanceEngine(scorer=ThrowingScorer(), cache=InMemoryCache())
    with pytest.raises(TimeoutError):
        # The ENGINE does not swallow scorer bugs; OpenAIScorer converts its own
        # failures. This documents the boundary deliberately.
        engine.evaluate(pantry_mandate, legit_grocery_action)


def test_openai_scorer_converts_failures_to_unavailable(pantry_mandate, legit_grocery_action):
    """No API key configured is a failure like any other: fail closed."""
    scorer = OpenAIScorer(api_key="")
    scorer._client = None
    import os

    saved = os.environ.pop("OPENAI_API_KEY", None)
    try:
        result = scorer.score(pantry_mandate, legit_grocery_action)
    finally:
        if saved is not None:
            os.environ["OPENAI_API_KEY"] = saved

    assert result.available is False
    assert result.score == 0.0
    assert result.error


def test_replay_scorer_fails_closed_on_an_unrecorded_action(
    pantry_mandate, legit_grocery_action
):
    engine = ConformanceEngine(scorer=ReplayScorer(fixture={}), cache=InMemoryCache())
    result = engine.evaluate(pantry_mandate, legit_grocery_action)
    assert result.available is False
    assert "no recorded score" in result.error


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


def test_prompt_hash_is_stable_and_recorded(pantry_mandate, replay_engine, trap_giftcard_action):
    assert len(PROMPT_HASH) == 64
    result = replay_engine.evaluate(pantry_mandate, trap_giftcard_action)
    assert result.prompt_hash == PROMPT_HASH


def test_user_prompt_is_deterministic(pantry_mandate, legit_grocery_action):
    a = build_user_prompt(pantry_mandate, legit_grocery_action)
    b = build_user_prompt(pantry_mandate, legit_grocery_action)
    assert a == b
    assert pantry_mandate.purpose in a
    assert "FreshMart" in a


def test_mandate_hash_changes_with_any_dimension(pantry_mandate):
    widened = Mandate(
        purpose=pantry_mandate.purpose,
        permitted_categories=pantry_mandate.permitted_categories,
        prohibited_attributes=pantry_mandate.prohibited_attributes,
        per_transaction_ceiling=Decimal("9999"),
        daily_ceiling=pantry_mandate.daily_ceiling,
        max_transactions_per_day=pantry_mandate.max_transactions_per_day,
        max_delegation_depth=pantry_mandate.max_delegation_depth,
        expires_at=pantry_mandate.expires_at,
    )
    assert widened.mandate_hash != pantry_mandate.mandate_hash
