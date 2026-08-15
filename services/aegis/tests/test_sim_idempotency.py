"""The simulator's derived idempotency key.

A client that forgets to send a key must not be able to create two decisions
for one intent: that would mean two ledger records, two approval prompts, and a
card member answering the same purchase twice.
"""

from decimal import Decimal

from aegis.api.routes import _derived_idempotency_key


BASKET = [{"label": "Milk 1L", "quantity": 2, "unit_amount": "62.00"}]


def key(**overrides):
    args = {
        "agent_id": "ag_household_pantry_1",
        "merchant_id": "mch_freshmart",
        "amount": Decimal("124.00"),
        "ship_to": "Home - 42 Brigade Road",
        "items": BASKET,
    }
    args.update(overrides)
    return _derived_idempotency_key(**args)


class TestCollapsesRetries:
    def test_identical_requests_share_a_key(self):
        assert key() == key()

    def test_item_order_does_not_matter(self):
        """A reordered basket is the same basket."""
        two = [
            {"label": "Bread", "quantity": 1, "unit_amount": "40.00"},
            {"label": "Milk 1L", "quantity": 2, "unit_amount": "62.00"},
        ]
        assert key(items=two) == key(items=list(reversed(two)))


class TestKeepsDistinctPurchasesDistinct:
    """Over-blocking is the worse failure: it silently drops real purchases."""

    def test_different_amount(self):
        assert key() != key(amount=Decimal("125.00"))

    def test_different_agent(self):
        assert key() != key(agent_id="ag_household_pantry_2")

    def test_different_merchant(self):
        assert key() != key(merchant_id="mch_freshmart_gift")

    def test_different_destination(self):
        assert key() != key(ship_to="Unrecognised delivery address")

    def test_different_quantity(self):
        assert key() != key(items=[{**BASKET[0], "quantity": 3}])

    def test_different_item(self):
        assert key() != key(items=[{"label": "Bread", "quantity": 1, "unit_amount": "40.00"}])

    def test_missing_destination_is_not_a_destination(self):
        assert key(ship_to=None) != key(ship_to="Home - 42 Brigade Road")


class TestShape:
    def test_key_is_short_and_stable(self):
        value = key()
        assert len(value) == 32
        assert value == key()
