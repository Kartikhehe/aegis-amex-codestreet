"""Diligence: competence of the purchase, not authority to make it.

The tests that matter most here are the honesty ones. Diligence must never
deny, and it must never claim to have data it does not have -- a governance
product that overstated its own evidence would refute its own thesis.
"""

from decimal import Decimal

import pytest

from aegis.engine.diligence import (
    DEFAULT_PRICE_TOLERANCE,
    UNAVAILABLE_CHECKS,
    assess,
)


class _Item:
    def __init__(self, label, unit_amount="0", list_price=None):
        self.label = label
        self.unit_amount = Decimal(str(unit_amount))
        self.list_price = Decimal(str(list_price)) if list_price is not None else None


class _Action:
    def __init__(self, items=(), description="", seller_name=None):
        self.cart_items = list(items)
        self.description = description
        self.seller_name = seller_name


class _Mandate:
    def __init__(self, require_diligence=False, price_tolerance=None):
        self.require_diligence = require_diligence
        self.price_tolerance = price_tolerance


def check(result, key):
    return next(c for c in result.checks if c.key == key)


class TestPriceSanity:
    def test_paying_far_above_the_reference_is_flagged(self):
        action = _Action([_Item("Trolley bag", unit_amount=4200, list_price=1700)])
        result = assess(action, _Mandate())
        assert check(result, "price_sanity").status == "flag"
        assert "price_sanity" in result.flags

    def test_paying_at_the_reference_passes(self):
        action = _Action([_Item("Trolley bag", unit_amount=1700, list_price=1700)])
        result = assess(action, _Mandate())
        assert check(result, "price_sanity").status == "pass"

    def test_a_small_markup_is_tolerated(self):
        action = _Action([_Item("Trolley bag", unit_amount=1800, list_price=1700)])
        result = assess(action, _Mandate())
        assert check(result, "price_sanity").status == "pass"

    def test_no_reference_price_is_unavailable_not_a_pass(self):
        """Absent data must never be reported as a clean result."""
        action = _Action([_Item("Trolley bag", unit_amount=1800)])
        result = assess(action, _Mandate())
        assert check(result, "price_sanity").status == "unavailable"
        assert "price_sanity" not in result.flags

    def test_the_mandate_can_set_its_own_tolerance(self):
        action = _Action([_Item("Bag", unit_amount=1900, list_price=1700)])  # +11%
        assert check(assess(action, _Mandate()), "price_sanity").status == "pass"
        strict = _Mandate(price_tolerance=Decimal("0.05"))
        assert check(assess(action, strict), "price_sanity").status == "flag"

    def test_reference_price_is_labelled_merchant_asserted(self):
        """The provenance caveat is not optional -- it is the whole caveat."""
        action = _Action([_Item("Bag", unit_amount=1800, list_price=1700)])
        basis = check(assess(action, _Mandate()), "price_sanity").basis
        assert "merchant-asserted" in basis.lower()


class TestSubstitutionDistance:
    def test_buying_what_was_asked_for_passes(self):
        action = _Action([_Item("Black trolley bag", 1850)], "buy a black bag under 2000")
        assert check(assess(action, _Mandate()), "substitution_distance").status == "pass"

    def test_buying_something_unrelated_is_flagged(self):
        action = _Action([_Item("Table lamp", 1850)], "buy a black trolley bag")
        result = assess(action, _Mandate())
        assert check(result, "substitution_distance").status == "flag"
        assert "substitution_distance" in result.flags

    def test_filler_words_do_not_count_as_a_match(self):
        """"buy me a" must not match everything ever sold."""
        action = _Action([_Item("Table lamp", 500)], "buy me a bag")
        assert check(assess(action, _Mandate()), "substitution_distance").status == "flag"

    def test_no_request_text_is_unavailable(self):
        action = _Action([_Item("Bag", 1850)], "")
        assert check(assess(action, _Mandate()), "substitution_distance").status == "unavailable"


class TestSellerDisclosure:
    def test_a_named_seller_passes(self):
        action = _Action([_Item("Bag", 1850)], "a bag", seller_name="Acme Luggage")
        assert check(assess(action, _Mandate()), "seller_disclosure").status == "pass"

    def test_no_seller_is_unavailable_not_a_failure(self):
        """Most merchants are not marketplaces; that is not a defect."""
        action = _Action([_Item("Bag", 1850)], "a bag")
        assert check(assess(action, _Mandate()), "seller_disclosure").status == "unavailable"


class TestHonestyAboutMissingData:
    """The claims we deliberately do NOT make."""

    def test_unavailable_checks_are_always_reported(self):
        result = assess(_Action([_Item("Bag", 1850)], "a bag"), _Mandate())
        keys = {c.key for c in result.checks}
        for designed in UNAVAILABLE_CHECKS:
            assert designed.key in keys, f"{designed.key} silently disappeared"

    def test_unavailable_checks_never_produce_a_flag(self):
        """A check we cannot run must not influence the verdict."""
        result = assess(_Action([_Item("Bag", 1850)], "a bag"), _Mandate())
        for c in result.checks:
            if c.status == "unavailable":
                assert c.key not in result.flags

    def test_each_unavailable_check_names_its_obstacle(self):
        """"Not implemented" is not an answer; WHY is."""
        for designed in UNAVAILABLE_CHECKS:
            assert len(designed.basis) > 40, designed.key

    def test_ratings_are_never_claimed(self):
        quality = next(c for c in UNAVAILABLE_CHECKS if c.key == "quality_floor")
        assert quality.status == "unavailable"
        assert "deprecated" in quality.basis.lower() or "no " in quality.basis.lower()

    def test_dominated_purchase_is_declared_not_faked(self):
        dominated = next(c for c in UNAVAILABLE_CHECKS if c.key == "alternatives_foregone")
        assert dominated.status == "unavailable"
        assert "gtin" in dominated.basis.lower() or "catalogue" in dominated.basis.lower()


class TestResultShape:
    def test_a_clean_purchase_is_not_below_bar(self):
        action = _Action(
            [_Item("Black trolley bag", 1700, list_price=1700)],
            "buy a black trolley bag",
        )
        assert assess(action, _Mandate()).below_bar is False

    def test_canonical_form_round_trips(self):
        result = assess(_Action([_Item("Bag", 1850)], "a bag"), _Mandate())
        payload = result.to_canonical()
        assert "checks" in payload and "flags" in payload
        assert all("basis" in c for c in payload["checks"])

    def test_default_tolerance_is_a_stated_number(self):
        assert DEFAULT_PRICE_TOLERANCE == Decimal("0.25")


class TestSubstitutionDoesNotCryWolf:
    """A vocabulary miss is not, on its own, evidence of a bad purchase.

    The first version flagged any basket sharing no words with the request. On
    a real corpus that fired on 24% of rows -- "Fleet vehicle parts" yielding
    "Filters, Drive belts", "Prescription refill" yielding "First-aid kit" --
    all correct purchases. Noise at that rate buries the real signal and trains
    every operator to ignore the flag, which is worse than not having it.
    """

    @pytest.mark.parametrize(
        "request_text,items",
        [
            ("Fleet vehicle parts", ["Filters", "Drive belts"]),
            ("Prescription refill", ["First-aid kit"]),
            ("Monthly cloud spend", ["Compute credits"]),
            ("Site consumables", ["Cleaning supplies"]),
        ],
    )
    def test_category_requests_are_not_flagged(self, request_text, items):
        action = _Action([_Item(i, 500) for i in items], request_text)
        result = assess(action, _Mandate())
        assert "substitution_distance" not in result.flags
        assert check(result, "substitution_distance").status == "unavailable"

    def test_a_named_concrete_item_missing_IS_flagged(self):
        """This is the case the check exists for."""
        action = _Action([_Item("Table lamp", 1800)], "buy a black bag under 2000")
        result = assess(action, _Mandate())
        assert "substitution_distance" in result.flags
        assert "bag" in check(result, "substitution_distance").detail

    def test_a_named_item_present_passes(self):
        action = _Action([_Item("Black trolley bag", 1800)], "buy a black bag")
        assert check(assess(action, _Mandate()), "substitution_distance").status == "pass"
