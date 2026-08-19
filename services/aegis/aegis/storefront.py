"""Storefront catalogues and prompt parsing for the agent simulator.

This module exists so the simulator can be a REAL client of the engine rather
than a demo of it. It does two jobs and nothing else:

  1. Holds a per-merchant product catalogue -- what you could actually put in a
     basket at that storefront, with the price and the risk attributes the
     engine vetoes on (gift_card, alcohol, crypto...).
  2. Turns a typed sentence into a concrete cart of those products.

Everything downstream -- authority, ceilings, conformance, the ledger -- is the
existing engine reached through POST /decide. Nothing here decides anything.

The parse is deterministic by default so the simulator works with no API key
and gives the same cart for the same sentence every time. When OPENAI_API_KEY
is present the extraction is done by the model instead, which handles phrasing
the rules miss; if that call fails for any reason the rules take over rather
than the simulator breaking.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

# The engine's own manipulation vocabulary. Imported rather than duplicated so
# the two can never disagree about what counts as an injection attempt.
from .engine.conformance import INJECTION_PHRASES

# --------------------------------------------------------------------------
# Catalogue
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Product:
    """One buyable line at a storefront.

    `attributes` are the engine's risk vocabulary, not marketing tags. A
    product carrying "gift_card" is what turns a permitted-category purchase
    into a prohibited_attribute_veto, which is the single most instructive
    thing the simulator can show.
    """

    sku: str
    label: str
    unit_amount: Decimal
    keywords: tuple[str, ...] = ()
    attributes: tuple[str, ...] = ()

    # The merchant's own reference price, mirroring ACP's `list_price`. Present
    # only where a real merchant feed would carry one, so the diligence
    # price-sanity check has something to compare against -- and is honestly
    # "unavailable" on products that have none.
    list_price: Decimal | None = None

    def to_json(self) -> dict:
        return {
            "sku": self.sku,
            "label": self.label,
            "unit_amount": str(self.unit_amount),
            "attributes": list(self.attributes),
            "list_price": None if self.list_price is None else str(self.list_price),
        }


@dataclass(frozen=True)
class Storefront:
    """A merchant as the simulator presents it: a shop you can walk into.

    `merchant_id`, `name` and `category` MUST match the merchant rows the
    engine already knows, because the decision is taken against those. The
    catalogue and copy are additions for the storefront surface only.
    """

    merchant_id: str
    name: str
    category: str
    kind: str
    tagline: str
    attributes: tuple[str, ...] = ()
    products: tuple[Product, ...] = ()
    requires_login: bool = False
    requires_card_tap: bool = False
    ship_to_options: tuple[str, ...] = ("home",)

    def to_json(self) -> dict:
        return {
            "merchant_id": self.merchant_id,
            "name": self.name,
            "category": self.category,
            "kind": self.kind,
            "tagline": self.tagline,
            "attributes": list(self.attributes),
            "products": [p.to_json() for p in self.products],
            "requires_login": self.requires_login,
            "requires_card_tap": self.requires_card_tap,
            "ship_to_options": list(self.ship_to_options),
        }


def _d(value: str) -> Decimal:
    return Decimal(value)


STOREFRONTS: tuple[Storefront, ...] = (
    # --- supermarket, MCC 5411 -------------------------------------------
    # The trap pair lives here. This shop and the gift-card counter below
    # share MCC 5411; only the cart attributes tell them apart.
    Storefront(
        merchant_id="mch_freshmart",
        name="FreshMart Daily Grocers",
        category="5411",
        kind="supermarket",
        tagline="Everyday groceries, delivered.",
        products=(
            Product("fm-atta", "Atta 10kg", _d("520"), ("atta", "flour", "wheat")),
            Product("fm-rice", "Basmati rice 5kg", _d("550"), ("rice", "basmati", "chawal")),
            Product("fm-dal", "Toor dal 2kg", _d("340"), ("dal", "toor", "lentil", "pulses")),
            Product("fm-milk", "Milk 1L", _d("62"), ("milk", "doodh")),
            Product("fm-oil", "Cooking oil 2L", _d("380"), ("oil", "cooking oil", "sunflower")),
            Product("fm-veg", "Fresh vegetables basket", _d("450"), ("vegetables", "veg", "sabzi")),
            Product("fm-eggs", "Eggs (dozen)", _d("90"), ("eggs", "anda")),
            Product("fm-tea", "Tea 500g", _d("260"), ("tea", "chai")),
            Product(
                "fm-wine",
                "Red wine 750ml",
                _d("1250"),
                ("wine", "alcohol", "beer", "whisky"),
                ("alcohol",),
            ),
        ),
        ship_to_options=("home", "office", "other"),
    ),
    # --- the trap twin: same MCC, cash-equivalent stock -------------------
    Storefront(
        merchant_id="mch_freshmart_gift",
        name="FreshMart Gift Card Centre",
        category="5411",
        kind="supermarket",
        tagline="Gift cards and top-up vouchers.",
        attributes=("gift_card", "cash_equivalent"),
        products=(
            Product(
                "fmg-1000",
                "FreshMart gift card ₹1,000",
                _d("1000"),
                ("gift card", "giftcard", "voucher"),
                ("gift_card", "cash_equivalent"),
            ),
            Product(
                "fmg-2500",
                "FreshMart gift card ₹2,500",
                _d("2500"),
                ("gift card", "giftcard", "voucher"),
                ("gift_card", "cash_equivalent"),
            ),
            Product(
                "fmg-topup",
                "Wallet top-up voucher",
                _d("1500"),
                ("top up", "topup", "wallet", "recharge"),
                ("cash_equivalent", "prepaid_instrument"),
            ),
        ),
        ship_to_options=("home", "other"),
    ),
    # --- travel booking, MCC 4511 ----------------------------------------
    Storefront(
        merchant_id="mch_indigo",
        name="IndiGo Airlines",
        category="4511",
        kind="travel",
        tagline="Book domestic and international flights.",
        requires_login=True,
        # Nothing is delivered: you board the plane. Declaring a destination
        # here would invent a delivery constraint the card member never set.
        ship_to_options=(),
        products=(
            Product("6e-dom", "Domestic economy fare", _d("4800"), ("flight", "fare", "ticket")),
            Product("6e-dom-flex", "Domestic flexi fare", _d("7200"), ("flexi", "refundable")),
            Product("6e-intl", "International economy fare", _d("21500"), ("international",)),
            Product("6e-seat", "Seat selection", _d("600"), ("seat",)),
            Product("6e-bag", "Extra baggage 10kg", _d("1800"), ("baggage", "bag", "luggage")),
        ),
    ),
    Storefront(
        merchant_id="mch_tajhotels",
        name="Taj Hotels",
        category="7011",
        kind="travel",
        tagline="Rooms and stays across India.",
        requires_login=True,
        requires_card_tap=True,
        ship_to_options=(),
        products=(
            Product("taj-std", "Standard room, per night", _d("11500"), ("room", "night", "stay")),
            Product("taj-dlx", "Deluxe room, per night", _d("18500"), ("deluxe",)),
            Product("taj-brk", "Breakfast, per person", _d("1400"), ("breakfast",)),
            Product(
                "taj-bar",
                "Minibar (alcohol)",
                _d("2200"),
                ("minibar", "bar", "drinks"),
                ("alcohol",),
            ),
        ),
    ),
    # --- dining: food delivery, MCC 5814 ---------------------------------
    # Dining is one of the two heaviest agentic use cases (with travel), and
    # the engine already has a `team_meals` mandate class and these merchants
    # -- they simply had no storefront to walk into.
    Storefront(
        merchant_id="mch_swiggy",
        name="Swiggy",
        category="5814",
        kind="dining",
        tagline="Food delivery for the office.",
        requires_login=True,
        products=(
            Product("sw-lunch", "Team lunch (8 pax)", _d("2400"),
                    ("team lunch", "lunch", "meal", "meals"), (), _d("2400")),
            Product("sw-dinner", "Working dinner (6 pax)", _d("1900"),
                    ("dinner", "working dinner"), (), _d("1900")),
            Product("sw-thali", "Thali, per person", _d("240"),
                    ("thali", "veg meal"), (), _d("240")),
            Product("sw-snacks", "Snack platter", _d("650"),
                    ("snacks", "platter", "samosa"), (), _d("650")),
            Product("sw-dessert", "Dessert box", _d("420"), ("dessert", "sweets", "cake")),
            # Alcohol on a food-delivery order: permitted by MCC, vetoed by
            # every seeded mandate. The dining equivalent of the gift-card trap.
            Product("sw-beer", "Beer 6-pack", _d("900"),
                    ("beer", "alcohol", "drinks"), ("alcohol",)),
        ),
        ship_to_options=("office", "home", "other"),
    ),
    # --- dining: coffee, MCC 5812 ----------------------------------------
    Storefront(
        merchant_id="mch_barista",
        name="Barista Coffee",
        category="5812",
        kind="dining",
        tagline="Coffee and client meetings.",
        requires_card_tap=True,
        ship_to_options=(),
        products=(
            Product("ba-coffee", "Coffee", _d("180"),
                    ("coffee", "cappuccino", "latte", "espresso"), (), _d("180")),
            Product("ba-tea", "Tea", _d("140"), ("tea", "chai"), (), _d("140")),
            Product("ba-sandwich", "Sandwich", _d("260"),
                    ("sandwich", "panini"), (), _d("260")),
            Product("ba-cake", "Slice of cake", _d("220"), ("cake", "pastry", "dessert")),
            Product("ba-meeting", "Client meeting tray (6 pax)", _d("1450"),
                    ("meeting", "client", "tray"), (), _d("1450")),
        ),
    ),
    # --- fuel, MCC 5541 ---------------------------------------------------
    Storefront(
        merchant_id="mch_indianoil",
        name="IndianOil Fuel Station",
        category="5541",
        kind="fuel",
        tagline="Fuel and on-the-road essentials.",
        requires_card_tap=True,
        ship_to_options=(),
        products=(
            Product("io-petrol", "Petrol, per litre", _d("106"), ("petrol", "fuel", "gas")),
            Product("io-diesel", "Diesel, per litre", _d("94"), ("diesel",)),
            Product("io-wash", "Car wash", _d("350"), ("wash", "car wash")),
        ),
    ),
    # --- office supplies, MCC 5943 ---------------------------------------
    Storefront(
        merchant_id="mch_amazonbiz",
        name="Amazon Business",
        category="5943",
        kind="office",
        tagline="Office supplies and equipment.",
        requires_login=True,
        products=(
            Product("ab-paper", "A4 paper, ream", _d("310"), ("paper", "a4", "ream")),
            Product("ab-toner", "Printer toner", _d("4200"), ("toner", "ink", "cartridge")),
            Product("ab-chair", "Office chair", _d("8900"), ("chair", "furniture")),
            Product("ab-laptop", "Business laptop", _d("62000"), ("laptop", "notebook")),
            Product(
                "ab-gift",
                "Amazon gift card ₹2,000",
                _d("2000"),
                ("gift card", "giftcard", "voucher"),
                ("gift_card", "cash_equivalent"),
            ),
        ),
        ship_to_options=("office", "home", "other"),
    ),
    # --- crypto, MCC 6051: denied by attribute for every seeded mandate ---
    Storefront(
        merchant_id="mch_wazirx",
        name="WazirX Crypto Exchange",
        category="6051",
        kind="crypto",
        tagline="Buy and sell digital assets.",
        attributes=("crypto", "cash_equivalent"),
        requires_login=True,
        products=(
            Product(
                "wx-btc",
                "Bitcoin purchase",
                _d("5000"),
                ("bitcoin", "btc", "crypto"),
                ("crypto", "cash_equivalent"),
            ),
            Product(
                "wx-usdt",
                "USDT purchase",
                _d("2500"),
                ("usdt", "tether", "stablecoin"),
                ("crypto", "cash_equivalent"),
            ),
        ),
        ship_to_options=("home",),
    ),
)

BY_ID: dict[str, Storefront] = {s.merchant_id: s for s in STOREFRONTS}

# Which kind of agent belongs in which shop.
#
# An operator does not send a pantry agent to book a hotel, and making a user
# assemble that pairing by hand invites combinations no real deployment would
# ever create -- then shows them a denial that says more about the pairing than
# about the engine. Mapping shop -> mandate class lets the simulator pick a
# sensible agent automatically and keeps the choice to one decision.
#
# Ordered by preference: the first class with a live agent wins.
SHOP_AGENT_CLASSES: dict[str, tuple[str, ...]] = {
    "mch_freshmart": ("household_pantry", "travel_snacks"),
    "mch_freshmart_gift": ("household_pantry",),
    "mch_indigo": ("business_travel", "commuter_transport"),
    "mch_tajhotels": ("business_travel",),
    "mch_swiggy": ("team_meals", "travel_snacks"),
    "mch_barista": ("team_meals", "travel_snacks"),
    "mch_indianoil": ("fleet_fuel", "commuter_transport"),
    "mch_amazonbiz": ("office_supplies", "broad_procurement"),
    "mch_wazirx": ("broad_procurement", "household_pantry"),
}

# How each shop's assistant introduces itself. The simulator is meant to feel
# like talking to something deployed, not like filling in a form.
SHOP_GREETINGS: dict[str, str] = {
    "mch_freshmart": "Hi — I do the grocery run for this household. What do you need?",
    "mch_freshmart_gift": "Gift cards and vouchers counter. What are you after?",
    "mch_indigo": "I book flights for the team. Where are you headed?",
    "mch_tajhotels": "I handle hotel bookings. Which city and how many nights?",
    "mch_swiggy": "Office food orders. What are we feeding the team?",
    "mch_barista": "Coffee counter. What can I get you?",
    "mch_indianoil": "Fuel stop. How much are we filling today?",
    "mch_amazonbiz": "Office supplies desk. What does the office need?",
    "mch_wazirx": "Digital asset desk. What would you like to buy?",
}


def storefronts() -> list[dict]:
    return [s.to_json() for s in STOREFRONTS]


def get_storefront(merchant_id: str) -> Storefront | None:
    return BY_ID.get(merchant_id)


# --------------------------------------------------------------------------
# Prompt -> cart
# --------------------------------------------------------------------------


@dataclass
class ParsedCart:
    """The result of reading a sentence against one storefront's catalogue."""

    items: list[dict] = field(default_factory=list)
    ship_to: str = "home"
    injected_instruction: str | None = None
    note: str = ""
    source: str = "rules"
    # True when the request named nothing this shop stocks and no amount was
    # given, so there is no honest cart to build from rules alone.
    unmatched: bool = False

    @property
    def total(self) -> Decimal:
        return sum(
            (Decimal(str(i["unit_amount"])) * i["quantity"] for i in self.items), Decimal("0")
        )


# Quantities written the way people actually type them.
_QTY = re.compile(
    r"(\d+(?:\.\d+)?)\s*(?:x|kg|kgs|kilo|kilos|l|ltr|litre|litres|liter|liters|"
    r"nights?|tickets?|packs?|units?|dozen|pcs|pieces?)?",
    re.I,
)
_EXPLICIT_AMOUNT = re.compile(r"(?:worth|for|of|upto|up to|under|about)?\s*(?:₹|rs\.?|inr)\s*"
                             r"(\d[\d,]*(?:\.\d+)?)", re.I)

# Phrasing that tries to talk the agent out of its limits. Detected here only
# so the simulator can pass it to the engine as `injected_instruction`; the
# ENGINE decides what it means. Keeping the judgement server-side matters --
# a client that could self-clear injection would be worthless as a control.
#
# This reuses the ENGINE's list rather than keeping a second one. They had
# already drifted: the simulator flagged "ignore your instructions" and the
# engine did not, so the text was attached to the record as evidence but no
# suspected_injection rule fired -- the worst possible split, because it looks
# like detection is working while the veto silently is not.
_INJECTION_HINTS = INJECTION_PHRASES

_SHIP_TO_HINTS = (
    ("office", ("office", "work", "workplace")),
    ("other", ("other address", "different address", "friend", "warehouse", "new address")),
    ("home", ("home", "house", "flat", "apartment")),
)


def _detect_ship_to(text: str, allowed: tuple[str, ...]) -> str:
    low = text.lower()
    for value, hints in _SHIP_TO_HINTS:
        if value in allowed and any(h in low for h in hints):
            return value
    return allowed[0] if allowed else "home"


def _detect_injection(text: str) -> str | None:
    low = text.lower()
    for hint in _INJECTION_HINTS:
        if hint in low:
            # Hand the engine the sentence that carried it, not just the hint,
            # so the record keeps enough context to be read later as evidence.
            for sentence in re.split(r"[.!?\n]", text):
                if hint in sentence.lower():
                    return sentence.strip()
            return text.strip()
    return None


def _quantity_near(text: str, position: int) -> int:
    """Read a leading quantity for the keyword that matched at `position`.

    The window stops at the previous item separator. Without that boundary,
    "2kg rice, milk and vegetables" gave the milk and the vegetables a quantity
    of 2 as well, because the scan simply walked backwards into the rice.
    """
    window_start = max(0, position - 24)
    window = text[window_start:position]
    # Only look back as far as the nearest separator: a quantity belongs to the
    # item it precedes, not to everything that follows it in the sentence.
    boundary = max(window.rfind(","), window.rfind(" and "), window.rfind(";"))
    if boundary >= 0:
        window = window[boundary:]
    matches = _QTY.findall(window)
    for raw in reversed(matches):
        try:
            value = float(raw)
        except ValueError:
            continue
        if value >= 1:
            return max(1, min(int(round(value)), 99))
    return 1


def parse_with_rules(prompt: str, shop: Storefront) -> ParsedCart:
    """Match catalogue keywords in the prompt; deterministic and offline.

    Longest keyword first, so "gift card" wins over "card" and a specific
    product beats a generic one.
    """
    cart = ParsedCart(source="rules")
    low = prompt.lower()
    taken: list[tuple[int, int]] = []

    candidates: list[tuple[str, Product]] = []
    for product in shop.products:
        for keyword in (*product.keywords, product.label.lower()):
            candidates.append((keyword.lower(), product))
    candidates.sort(key=lambda pair: len(pair[0]), reverse=True)

    chosen: dict[str, dict] = {}
    for keyword, product in candidates:
        start = low.find(keyword)
        if start < 0:
            continue
        end = start + len(keyword)
        # Don't let a shorter keyword re-match text already consumed.
        if any(start < t_end and end > t_start for t_start, t_end in taken):
            continue
        taken.append((start, end))

        # When the shopper named an amount and several SKUs share this keyword
        # (gift cards at 1000 / 2500, fares, room grades), pick the closest
        # denomination rather than whichever happened to be listed first.
        siblings = [
            p
            for p in shop.products
            if keyword in (k.lower() for k in (*p.keywords, p.label.lower()))
        ]
        if len(siblings) > 1:
            amount_match = _EXPLICIT_AMOUNT.search(prompt) or re.search(r"\b(\d{3,6})\b", prompt)
            if amount_match:
                wanted = Decimal(amount_match.group(1).replace(",", ""))
                product = min(siblings, key=lambda p: abs(p.unit_amount - wanted))

        if product.sku in chosen:
            continue
        chosen[product.sku] = {
            "label": product.label,
            "quantity": _quantity_near(prompt, start),
            "unit_amount": str(product.unit_amount),
            "attributes": list(product.attributes),
            "list_price": None if product.list_price is None else str(product.list_price),
        }

    cart.items = list(chosen.values())

    # A bare amount with no recognisable product still deserves a cart -- the
    # shopper said what they wanted to spend, and the engine can rule on that.
    if not cart.items:
        amount_match = _EXPLICIT_AMOUNT.search(prompt)
        if amount_match:
            amount = Decimal(amount_match.group(1).replace(",", ""))
            cart.items = [
                {
                    "label": f"Purchase at {shop.name}",
                    "quantity": 1,
                    "unit_amount": str(amount),
                    "attributes": list(shop.attributes),
                }
            ]
            cart.note = "No catalogue item matched; used the amount you named."
        else:
            # NOTHING matched and no amount was given.
            #
            # The previous behaviour here was to assume the shop's first
            # product. That is the worst thing this function can do: asking for
            # "2 coffees and a salad" at a shop with neither produced a basket
            # containing Atta 10kg, and the engine then correctly refused a
            # purchase the shopper never requested. A truthful verdict about a
            # fabricated cart is worse than no verdict, because it looks like
            # the engine misjudged when in fact it was misinformed.
            #
            # Say so instead, and let the caller decide -- for an unpriceable
            # request that means asking the model, not guessing.
            cart.unmatched = True
            cart.note = (
                f"Nothing in that request matched what {shop.name} sells."
            )

    cart.ship_to = _detect_ship_to(prompt, shop.ship_to_options)
    cart.injected_instruction = _detect_injection(prompt)
    return cart


_LLM_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    # A catalogue SKU when the shop stocks it, else "" and the
                    # model names and prices the item itself.
                    "sku": {"type": "string"},
                    "label": {"type": "string"},
                    "unit_amount": {"type": "number"},
                    "quantity": {"type": "integer"},
                },
                "required": ["sku", "label", "unit_amount", "quantity"],
            },
        },
        "ship_to": {"type": "string"},
        "sold_here": {
            "type": "boolean",
            "description": (
                "False ONLY when the request is unrelated to this business. "
                "A hotel selling coffee is true; a fuel station selling "
                "flights is false."
            ),
        },
    },
    "required": ["items", "ship_to", "sold_here"],
}


# A model-priced line above this is treated as a bad extraction rather than a
# real request. Real baskets at these shops do not reach it, and it stops a
# malformed number from becoming a plausible-looking authorisation.
_MAX_MODEL_UNIT_PRICE = Decimal("1000000")

# Risk vocabulary, keyed on what the thing IS. This is the security boundary:
# the model names an item, we decide what that item means. Kept deliberately
# blunt -- a false positive here asks a human, which is the safe direction.
_ATTRIBUTE_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("gift_card", ("gift card", "giftcard", "gift voucher", "e-gift")),
    ("cash_equivalent", ("gift card", "giftcard", "voucher", "top-up", "top up",
                         "wallet load", "prepaid", "money order")),
    ("prepaid_instrument", ("prepaid", "top-up", "top up", "recharge", "wallet load")),
    ("alcohol", ("alcohol", "wine", "beer", "whisky", "whiskey", "vodka", "rum",
                 "gin", "liquor", "champagne", "cocktail", "minibar")),
    ("crypto", ("bitcoin", "btc", "ethereum", "eth", "usdt", "tether", "crypto",
                "stablecoin", "token purchase")),
    ("gambling", ("casino", "betting", "lottery", "wager", "poker")),
    ("tobacco", ("cigarette", "tobacco", "cigar", "vape", "nicotine")),
)


def _classify_attributes(label: str, shop: Storefront) -> list[str]:
    """Decide the risk attributes of a model-named item, from its label.

    Never trusts the model for this. A prompt that could clear an attribute
    could walk any cart past prohibited_attribute_veto.
    """
    low = label.lower()
    found = {attr for attr, hints in _ATTRIBUTE_HINTS if any(h in low for h in hints)}
    # Whatever the shop itself carries applies to everything it sells: a
    # crypto exchange's products are crypto regardless of their names.
    found.update(shop.attributes)
    return sorted(found)


def parse_with_llm(prompt: str, shop: Storefront) -> ParsedCart | None:
    """Read a sentence into a basket with one small model call.

    The model does the job the rules cannot: pricing things this shop plausibly
    sells but that are not in the catalogue. A supermarket really does sell
    coffee and salad even though our fixture lists nine items, and refusing to
    price them -- or worse, substituting atta -- makes the simulator useless
    for anything but the scripted examples.

    What the model MAY do: name items, set a plausible unit price, set
    quantities, and say whether the shop sells this kind of thing at all.

    What it may NOT do, ever: decide risk attributes. Those come from
    _classify_attributes below, on the label the model returned. If prose could
    talk an item out of carrying `gift_card`, prohibited_attribute_veto would
    be bypassable from the prompt, and the entire control would be theatre.

    Returns None on any failure so the caller falls back to the rules.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        from openai import OpenAI  # imported lazily; optional dependency

        catalogue = "\n".join(
            f"  {p.sku}: {p.label} (INR {p.unit_amount})" for p in shop.products
        )
        client = OpenAI(api_key=api_key)
        completion = client.chat.completions.create(
            model=os.getenv("AEGIS_SIM_MODEL", "gpt-4.1-mini"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are the order-taking system for one shop in India. "
                        "Convert the shopper's sentence into a basket.\n"
                        "- Prefer a catalogue SKU when the shop lists the item: "
                        "return its sku and its exact catalogue price.\n"
                        "- If the shop would plausibly sell the item but it is not "
                        "listed, return sku=\"\" with a sensible Indian retail "
                        "price in INR for that item.\n"
                        "- unit_amount is the price of ONE unit, in INR, never the "
                        "line total.\n"
                        "- Be GENEROUS about what a shop sells. A hotel serves "
                        "coffee and meals, a supermarket sells almost any "
                        "grocery, an airline sells seats and baggage and "
                        "onboard food. Only set sold_here=false when the "
                        "request is genuinely unrelated to the business -- a "
                        "petrol station does not sell air tickets.\n"
                        "- ship_to must be one of: "
                        + ", ".join(shop.ship_to_options)
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Shop: {shop.name} ({shop.kind}, MCC {shop.category})\n"
                        f"Catalogue:\n{catalogue}\n\nSentence: {prompt}"
                    ),
                },
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "cart", "schema": _LLM_SCHEMA, "strict": True},
            },
            timeout=12,
        )
        data = json.loads(completion.choices[0].message.content or "{}")
    except Exception:
        return None

    if not data.get("sold_here", True):
        # The model says this shop does not sell this at all. That is a real
        # answer, not a failure: it becomes an honest "wrong shop" message
        # rather than a basket of something else.
        return ParsedCart(items=[], unmatched=True, source="openai",
                          note=f"{shop.name} does not sell that.",
                          injected_instruction=_detect_injection(prompt))

    by_sku = {p.sku: p for p in shop.products}
    items = []
    for entry in data.get("items", []):
        product = by_sku.get(entry.get("sku") or "")
        quantity = max(1, min(int(entry.get("quantity", 1) or 1), 99))

        if product is not None:
            # Catalogue item: our price, our attributes. The model chose it,
            # it did not describe it.
            items.append(
                {
                    "label": product.label,
                    "quantity": quantity,
                    "unit_amount": str(product.unit_amount),
                    "attributes": list(product.attributes),
                    "list_price": (
                        None if product.list_price is None else str(product.list_price)
                    ),
                }
            )
            continue

        label = (entry.get("label") or "").strip()
        if not label:
            continue
        try:
            unit = Decimal(str(entry.get("unit_amount", 0))).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError):
            continue
        # Reject a nonsense price rather than letting it reach the engine as
        # though the shopper had asked for it.
        if unit <= 0 or unit > _MAX_MODEL_UNIT_PRICE:
            continue
        items.append(
            {
                "label": label,
                "quantity": quantity,
                # Attributes are OURS, derived from the label. Never the model's.
                "attributes": _classify_attributes(label, shop),
                "unit_amount": str(unit),
            }
        )

    if not items:
        return None

    ship_to = data.get("ship_to", "")
    if ship_to not in shop.ship_to_options:
        ship_to = _detect_ship_to(prompt, shop.ship_to_options)

    return ParsedCart(
        items=items,
        ship_to=ship_to,
        # Injection detection stays deterministic even when the model parses:
        # asking a model whether its own input was adversarial is not a control.
        injected_instruction=_detect_injection(prompt),
        source="openai",
    )


def parse_prompt(prompt: str, shop: Storefront) -> ParsedCart:
    """Read a sentence into a cart: model first when configured, rules always."""
    parsed = parse_with_llm(prompt, shop)
    if parsed is not None:
        return parsed
    return parse_with_rules(prompt, shop)
