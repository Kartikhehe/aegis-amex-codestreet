"""delegation.py -- subset enforcement, tree navigation, revocation cascade."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from aegis.engine.delegation import (
    build_chain,
    can_issue,
    descendants_of,
    effective_prohibitions,
    revoke_cascade,
)
from aegis.engine.types import Agent, Mandate


def _mandate(**kwargs):
    base = dict(
        purpose="groceries",
        permitted_categories=frozenset({"5411", "5499"}),
        prohibited_attributes=frozenset({"gift_card", "crypto"}),
        per_transaction_ceiling=Decimal("5000"),
        daily_ceiling=Decimal("12000"),
        max_transactions_per_day=6,
        max_delegation_depth=2,
    )
    base.update(kwargs)
    return Mandate(**base)


PARENT = _mandate()


# ---------------------------------------------------------------------------
# can_issue: strict subset on every dimension
# ---------------------------------------------------------------------------


def test_identical_mandate_is_rejected_on_depth_only():
    """A child may not hold the parent's full depth budget -- otherwise the
    tree could grow without bound."""
    check = can_issue(PARENT, _mandate())
    assert check.allowed is False
    assert {v.dimension for v in check.violations} == {"max_delegation_depth"}


@pytest.mark.parametrize(
    "override,dimension",
    [
        ({"permitted_categories": frozenset({"5411", "5812"})}, "permitted_categories"),
        ({"per_transaction_ceiling": Decimal("6000")}, "per_transaction_ceiling"),
        ({"daily_ceiling": Decimal("20000")}, "daily_ceiling"),
        ({"max_transactions_per_day": 10}, "max_transactions_per_day"),
        ({"prohibited_attributes": frozenset({"gift_card"})}, "prohibited_attributes"),
        ({"permitted_merchants": frozenset({"m_any"})}, "permitted_merchants"),
    ],
)
def test_each_widening_dimension_is_caught(override, dimension):
    parent = _mandate(permitted_merchants=frozenset({"m_a", "m_b"}))
    requested = _mandate(max_delegation_depth=1, permitted_merchants=frozenset({"m_a"}))
    requested = Mandate(
        purpose=requested.purpose,
        permitted_categories=override.get("permitted_categories", requested.permitted_categories),
        prohibited_attributes=override.get(
            "prohibited_attributes", requested.prohibited_attributes
        ),
        per_transaction_ceiling=override.get(
            "per_transaction_ceiling", requested.per_transaction_ceiling
        ),
        daily_ceiling=override.get("daily_ceiling", requested.daily_ceiling),
        max_transactions_per_day=override.get(
            "max_transactions_per_day", requested.max_transactions_per_day
        ),
        max_delegation_depth=requested.max_delegation_depth,
        permitted_merchants=override.get("permitted_merchants", requested.permitted_merchants),
    )
    check = can_issue(parent, requested)
    assert check.allowed is False
    assert dimension in {v.dimension for v in check.violations}


def test_all_violations_are_reported_not_just_the_first():
    requested = _mandate(
        permitted_categories=frozenset({"5812"}),
        per_transaction_ceiling=Decimal("9000"),
        daily_ceiling=Decimal("99000"),
        max_transactions_per_day=99,
        max_delegation_depth=1,
    )
    check = can_issue(PARENT, requested)
    dims = {v.dimension for v in check.violations}
    assert dims >= {
        "permitted_categories",
        "per_transaction_ceiling",
        "daily_ceiling",
        "max_transactions_per_day",
    }


def test_violations_carry_both_values_for_the_operator():
    check = can_issue(PARENT, _mandate(per_transaction_ceiling=Decimal("8000"),
                                       max_delegation_depth=1))
    v = next(v for v in check.violations if v.dimension == "per_transaction_ceiling")
    assert v.parent_value == "5000"
    assert v.requested_value == "8000"
    assert "higher" in v.message


def test_unrestricted_merchants_under_a_restricted_parent_is_a_widening():
    parent = _mandate(permitted_merchants=frozenset({"m_a"}))
    requested = _mandate(permitted_merchants=None, max_delegation_depth=1)
    check = can_issue(parent, requested)
    assert "permitted_merchants" in {v.dimension for v in check.violations}


def test_a_narrowing_from_unrestricted_is_allowed():
    parent = _mandate(permitted_merchants=None)
    requested = _mandate(permitted_merchants=frozenset({"m_a"}), max_delegation_depth=1)
    assert can_issue(parent, requested).allowed is True


def test_child_may_not_outlive_parent(now):
    parent = _mandate(expires_at=now + timedelta(days=30))
    later = _mandate(expires_at=now + timedelta(days=60), max_delegation_depth=1)
    never = _mandate(expires_at=None, max_delegation_depth=1)
    assert can_issue(parent, later).allowed is False
    assert can_issue(parent, never).allowed is False
    earlier = _mandate(expires_at=now + timedelta(days=10), max_delegation_depth=1)
    assert can_issue(parent, earlier).allowed is True


def test_a_mandate_with_no_depth_budget_cannot_delegate():
    parent = _mandate(max_delegation_depth=0)
    check = can_issue(parent, _mandate(max_delegation_depth=0))
    assert check.allowed is False
    assert "max_delegation_depth" in {v.dimension for v in check.violations}


def test_issuance_check_is_falsy_when_rejected():
    assert not can_issue(PARENT, _mandate(per_transaction_ceiling=Decimal("9999")))
    assert can_issue(PARENT, _mandate(max_delegation_depth=1))


# ---------------------------------------------------------------------------
# Tree navigation
# ---------------------------------------------------------------------------


def _tree():
    root = Agent("root", "op", "Root", PARENT, None, 0)
    a = Agent("a", "op", "A", _mandate(max_delegation_depth=1), "root", 1)
    b = Agent("b", "op", "B", _mandate(max_delegation_depth=1), "root", 1)
    a1 = Agent("a1", "op", "A1", _mandate(max_delegation_depth=0), "a", 2)
    other = Agent("other", "op2", "Other", PARENT, None, 0)
    return {x.agent_id: x for x in (root, a, b, a1, other)}


def test_build_chain_is_root_first():
    assert [x.agent_id for x in build_chain("a1", _tree())] == ["root", "a", "a1"]


def test_build_chain_of_a_root_is_itself():
    assert [x.agent_id for x in build_chain("root", _tree())] == ["root"]


def test_build_chain_survives_a_cycle():
    """A malformed parent pointer must not hang the evaluator."""
    x = Agent("x", "op", "X", PARENT, "y", 1)
    y = Agent("y", "op", "Y", PARENT, "x", 1)
    chain = build_chain("x", {"x": x, "y": y})
    assert len(chain) == 2


def test_descendants_excludes_self_and_unrelated():
    ids = {a.agent_id for a in descendants_of("root", _tree())}
    assert ids == {"a", "b", "a1"}


def test_descendants_of_a_leaf_is_empty():
    assert descendants_of("a1", _tree()) == ()


def test_revoke_cascade_includes_self_and_all_descendants():
    assert set(revoke_cascade("root", _tree())) == {"root", "a", "b", "a1"}
    assert set(revoke_cascade("a", _tree())) == {"a", "a1"}
    assert set(revoke_cascade("b", _tree())) == {"b"}


def test_effective_prohibitions_unions_the_chain():
    root = Agent("root", "op", "Root", _mandate(prohibited_attributes=frozenset({"gift_card"})))
    child = Agent(
        "c", "op", "C", _mandate(prohibited_attributes=frozenset({"alcohol"})), "root", 1
    )
    assert effective_prohibitions([root, child]) == frozenset({"gift_card", "alcohol"})


# ---------------------------------------------------------------------------
# Timezone robustness
#
# Regression: SQLite returns NAIVE datetimes even for timezone-aware columns.
# Comparing a naive expiry against an aware one raises TypeError, which took
# down the whole sub-agent issuance path rather than returning a verdict. An
# authorisation check must never crash on a storage detail.
# ---------------------------------------------------------------------------


def test_can_issue_handles_naive_parent_expiry(now):
    naive_parent = _mandate(expires_at=now.replace(tzinfo=None))
    aware_child = _mandate(expires_at=now - timedelta(days=1), max_delegation_depth=1)
    check = can_issue(naive_parent, aware_child)  # must not raise
    assert check.allowed is True


def test_can_issue_handles_naive_child_expiry(now):
    aware_parent = _mandate(expires_at=now)
    naive_child = _mandate(
        expires_at=(now + timedelta(days=10)).replace(tzinfo=None), max_delegation_depth=1
    )
    check = can_issue(aware_parent, naive_child)  # must not raise
    assert check.allowed is False
    assert "expires_at" in {v.dimension for v in check.violations}


def test_mandate_is_expired_handles_naive_values(now):
    naive_expiry = _mandate(expires_at=(now - timedelta(days=1)).replace(tzinfo=None))
    assert naive_expiry.is_expired(now) is True

    future = _mandate(expires_at=(now + timedelta(days=1)).replace(tzinfo=None))
    assert future.is_expired(now) is False
    assert future.is_expired(now.replace(tzinfo=None)) is False
