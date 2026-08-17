"""Prohibited-goods screening, and its false-positive discipline.

Two failure modes, and they are not equally bad. Missing a prohibited term lets
one purchase through; a false positive blocks lawful spending for everyone whose
basket happens to contain an ordinary word. The second is the failure this
product exists to avoid, so the false-positive cases here are the ones that
matter most.
"""

import pytest

from aegis.engine.compliance import PROHIBITED_CATEGORIES, categories_summary, screen


class _Item:
    def __init__(self, label):
        self.label = label


class _Action:
    def __init__(self, items=(), description="", merchant_name="A Shop"):
        self.cart_items = [_Item(i) for i in items]
        self.description = description
        self.merchant_name = merchant_name


class TestBlocksProhibitedGoods:
    @pytest.mark.parametrize(
        "label,expected",
        [
            ("Cannabis 10g", "controlled_substances"),
            ("Cocaine", "controlled_substances"),
            ("Anabolic steroid course", "controlled_substances"),
            ("Handgun 9mm", "weapons"),
            ("Assault rifle", "weapons"),
            ("Ammunition 50 rounds", "weapons"),
            ("Replica watch", "counterfeit"),
            ("Cloned card", "counterfeit"),
            ("Credit card numbers", "illicit_services"),
            ("Ransomware kit", "illicit_services"),
            ("Ivory carving", "human_harm"),
            ("Human organ", "human_harm"),
        ],
    )
    def test_basket_line_is_screened(self, label, expected):
        hit = screen(_Action([label]))
        assert hit is not None, f"{label} was not caught"
        assert hit.category.key == expected

    def test_description_is_screened_too(self):
        """The basket can look innocent while the request does not."""
        hit = screen(_Action(["Tablets"], "buy antibiotics online, no prescription needed"))
        assert hit is not None
        assert hit.category.key == "prescription_evasion"

    def test_hit_names_where_it_matched(self):
        """A denial has to be defensible, so it says what and where."""
        hit = screen(_Action(["Cannabis 10g"]))
        assert "cannabis" in hit.detail.lower()
        assert "Cannabis 10g" in hit.detail


class TestDoesNotBlockLawfulBaskets:
    """Every one of these was a real false positive during development."""

    @pytest.mark.parametrize(
        "items,description",
        [
            # "gun" as a whole word inside a place name.
            (["Rice 5kg"], "deliver groceries to Gun Hill Road"),
            # "meth" inside a chemical name.
            (["Methylated spirits 500ml"], "cleaning supplies"),
            # "weed" inside a garden product.
            (["Weedkiller 1L"], "garden supplies"),
            # "dumps" as ordinary database vocabulary.
            (["Backup software licence"], "nightly database dumps"),
            # "gun" inside a colour.
            (["Burgundy paint 1L"], "paint for the office"),
            (["Milk 1L", "Atta 10kg"], "weekly grocery restock"),
            (["Domestic economy fare"], "book a flight to Mumbai"),
        ],
    )
    def test_lawful_basket_is_clean(self, items, description):
        assert screen(_Action(items, description)) is None

    def test_merchant_name_is_not_screened(self):
        """A pharmacy is not a prohibited purchase.

        Screening the seller's name rather than the goods is how a system ends
        up blocking every order from "Gun Hill Road Grocers".
        """
        action = _Action(["Bandages"], "first aid supplies", merchant_name="Gun Hill Pharmacy")
        assert screen(action) is None


class TestScreenShape:
    def test_severity_order_is_stable(self):
        """A basket tripping several categories reports the gravest."""
        hit = screen(_Action(["Cannabis 10g", "Replica watch"]))
        assert hit.category.key == "controlled_substances"

    def test_every_category_states_its_basis(self):
        """A denial that cannot say WHY is not defensible."""
        for category in PROHIBITED_CATEGORIES:
            assert category.basis, category.key
            assert category.terms

    def test_summary_publishes_categories_without_terms(self):
        """The categories are public; the term list stays server-side."""
        summary = categories_summary()
        assert len(summary) == len(PROHIBITED_CATEGORIES)
        for row in summary:
            assert row["label"] and row["basis"]
            assert "terms" not in row

    def test_empty_action_is_clean(self):
        assert screen(_Action()) is None
