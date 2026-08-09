"""Shared fixtures.

The trap merchant pair is defined here because it is the single most important
piece of test data in the system: two merchants that are indistinguishable on
the fields a naive control would look at (same MCC, same category name,
similar names), differing only in what they actually sell.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from aegis.engine.conformance import ConformanceEngine, InMemoryCache, ReplayScorer, cache_key
from aegis.engine.types import (
    ActionRequest,
    Agent,
    AgentStatus,
    ConformanceResult,
    EvaluationContext,
    Mandate,
    utcnow,
)

GROCERY_MCC = "5411"


@pytest.fixture
def now():
    return utcnow()


@pytest.fixture
def pantry_mandate(now):
    """A typical card-member grant: weekly groceries, ₹5,000 a go, no gift cards."""
    return Mandate(
        purpose="weekly grocery and household pantry restocking for the family",
        permitted_categories=frozenset({GROCERY_MCC, "5499"}),
        prohibited_attributes=frozenset({"gift_card", "cash_equivalent", "crypto"}),
        per_transaction_ceiling=Decimal("5000"),
        daily_ceiling=Decimal("12000"),
        max_transactions_per_day=6,
        max_delegation_depth=2,
        expires_at=now + timedelta(days=90),
    )


@pytest.fixture
def pantry_agent(pantry_mandate):
    return Agent(
        agent_id="ag_pantry",
        operator_id="op_homerun",
        name="Pantry agent",
        mandate=pantry_mandate,
        depth=0,
        status=AgentStatus.ACTIVE,
    )


@pytest.fixture
def context(pantry_agent, now):
    return EvaluationContext(
        agent=pantry_agent,
        chain=(pantry_agent,),
        known_merchants=frozenset({"mch_freshmart"}),
        now=now,
    )


# ---------------------------------------------------------------------------
# The trap merchant pair.
#
# Same MCC (5411, grocery). One sells groceries. One sells gift cards from a
# rack by the till and settles under the same category. Any control that reads
# only the MCC treats these as identical.
# ---------------------------------------------------------------------------


@pytest.fixture
def legit_grocery_action(now):
    return ActionRequest(
        action_id="act_legit",
        agent_id="ag_pantry",
        merchant_id="mch_freshmart",
        merchant_name="FreshMart Daily Grocers",
        merchant_category=GROCERY_MCC,
        amount=Decimal("1840"),
        description="Atta 10kg, toor dal 2kg, milk 6L, cooking oil 2L, vegetables",
        merchant_attributes=frozenset(),
        requested_at=now,
    )


@pytest.fixture
def trap_giftcard_action(now):
    """Same MCC as the legitimate grocer. Sells stored value."""
    return ActionRequest(
        action_id="act_trap",
        agent_id="ag_pantry",
        merchant_id="mch_freshmart_cards",
        merchant_name="FreshMart Gift Card Centre",
        merchant_category=GROCERY_MCC,
        amount=Decimal("4980"),
        description="Prepaid open-loop gift card, ₹4,980 stored value, reloadable",
        merchant_attributes=frozenset({"gift_card", "cash_equivalent"}),
        requested_at=now,
    )


# ---------------------------------------------------------------------------
# Scoring in tests.
#
# Tests must be deterministic and offline, so they run against ReplayScorer
# over recorded scores rather than the live API. The values below are the
# shape a real gpt-4.1-mini response takes for these inputs.
# ---------------------------------------------------------------------------


@pytest.fixture
def replay_engine(pantry_mandate, legit_grocery_action, trap_giftcard_action):
    fixture = {
        cache_key(pantry_mandate, legit_grocery_action): {
            "score": 0.96,
            "rationale": "Staple groceries and household consumables squarely within a "
            "weekly pantry-restocking mandate.",
            "vetoes": [],
            "model_version": "gpt-4.1-mini-2025-04-14",
            "prompt_hash": "",
        },
        cache_key(pantry_mandate, trap_giftcard_action): {
            "score": 0.04,
            "rationale": "Open-loop prepaid gift card is a stored-value instrument that "
            "converts a restricted grocery mandate into unrestricted spending power.",
            "vetoes": ["gift_card", "cash_equivalent"],
            "model_version": "gpt-4.1-mini-2025-04-14",
            "prompt_hash": "",
        },
    }
    return ConformanceEngine(scorer=ReplayScorer(fixture=fixture), cache=InMemoryCache())


@pytest.fixture
def good_score():
    return ConformanceResult(
        score=0.94,
        rationale="Within the authorised grocery purpose.",
        model_version="gpt-4.1-mini-2025-04-14",
        prompt_hash="test",
    )
