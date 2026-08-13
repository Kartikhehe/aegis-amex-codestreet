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
from decimal import Decimal

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

    def to_json(self) -> dict:
        return {
            "sku": self.sku,
            "label": self.label,
            "unit_amount": str(self.unit_amount),
            "attributes": list(self.attributes),
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
        products=(
            Product("6e-dom", "Domestic economy fare", _d("4800"), ("flight", "fare", "ticket")),
            Product("6e-dom-flex", "Domestic flexi fare", _d("7200"), ("flexi", "refundable")),
            Product("6e-intl", "International economy fare", _d("21500"), ("international",)),
            Product("6e-seat", "Seat selection", _d("600"), ("seat",)),
            Product("6e-bag", "Extra baggage 10kg", _d("1800"), ("baggage", "bag", "luggage")),
        ),
        ship_to_options=("home",),
    ),
    Storefront(
        merchant_id="mch_tajhotels",
        name="Taj Hotels",
        category="7011",
        kind="travel",
        tagline="Rooms and stays across India.",
        requires_login=True,
        requires_card_tap=True,
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
        ship_to_options=("home",),
    ),
    # --- fuel, MCC 5541 ---------------------------------------------------
    Storefront(
        merchant_id="mch_indianoil",
        name="IndianOil Fuel Station",
        category="5541",
        kind="fuel",
        tagline="Fuel and on-the-road essentials.",
        requires_card_tap=True,
        products=(
            Product("io-petrol", "Petrol, per litre", _d("106"), ("petrol", "fuel", "gas")),
            Product("io-diesel", "Diesel, per litre", _d("94"), ("diesel",)),
            Product("io-wash", "Car wash", _d("350"), ("wash", "car wash")),
        ),
        ship_to_options=("home",),
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
_INJECTION_HINTS = (
    "ignore your",
    "ignore all",
    "ignore previous",
    "disregard",
    "override",
    "bypass",
    "you are now",
    "new instructions",
    "admin says",
    "developer mode",
    "do not check",
    "skip the",
    "without approval",
    "don't tell",
    "do not tell",
    "pretend",
)

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
        }

    cart.items = list(chosen.values())

    # A bare amount with no recognisable product still deserves a cart -- the
    # member said what they wanted to spend, and the engine can rule on that.
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
            default = shop.products[0]
            cart.items = [
                {
                    "label": default.label,
                    "quantity": 1,
                    "unit_amount": str(default.unit_amount),
                    "attributes": list(default.attributes),
                }
            ]
            cart.note = "Nothing in the prompt matched the catalogue; assumed one default item."

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
                    "sku": {"type": "string"},
                    "quantity": {"type": "integer"},
                },
                "required": ["sku", "quantity"],
            },
        },
        "ship_to": {"type": "string"},
    },
    "required": ["items", "ship_to"],
}


def parse_with_llm(prompt: str, shop: Storefront) -> ParsedCart | None:
    """Extract a cart with OpenAI. Returns None so the caller can fall back.

    The model only ever picks SKUs and quantities from the catalogue: prices
    and risk attributes come from our own product table. A model that could
    set the amount or drop an attribute could talk its way past the rules,
    which would make the whole demonstration meaningless.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        from openai import OpenAI  # imported lazily; optional dependency

        catalogue = "\n".join(
            f"  {p.sku}: {p.label} (₹{p.unit_amount})" for p in shop.products
        )
        client = OpenAI(api_key=api_key)
        completion = client.chat.completions.create(
            model=os.getenv("AEGIS_SIM_MODEL", "gpt-4.1-mini"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You convert a shopper's sentence into a basket at one shop. "
                        "Choose only from the catalogue SKUs given. Quantities are "
                        "whole numbers >= 1. ship_to must be one of: "
                        + ", ".join(shop.ship_to_options)
                        + ". If nothing matches, return the single closest item."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Shop: {shop.name}\nCatalogue:\n{catalogue}\n\nSentence: {prompt}",
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

    by_sku = {p.sku: p for p in shop.products}
    items = []
    for entry in data.get("items", []):
        product = by_sku.get(entry.get("sku", ""))
        if product is None:
            continue
        items.append(
            {
                "label": product.label,
                "quantity": max(1, min(int(entry.get("quantity", 1) or 1), 99)),
                "unit_amount": str(product.unit_amount),
                "attributes": list(product.attributes),
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
