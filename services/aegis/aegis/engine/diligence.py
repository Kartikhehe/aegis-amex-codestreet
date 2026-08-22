"""Diligence: was this a COMPETENT purchase, not merely an authorised one?

Conformance asks "is this what you authorised?" -- it catches the gift-card
case. Diligence asks "is this a careful purchase?" -- it catches the case where
an agent buys a bag that matches every stated requirement and is still junk.

This is governance, not shopping advice, and the distinction is load-bearing.
The card member sets a diligence bar in their mandate, exactly as they set a
spend cap; AEGIS enforces the bar they set. A corporate procurement policy
saying "three quotes above ₹50,000" is not taste-making, and neither is this.
Diligence therefore never denies on judgement: it passes, flags, or asks a
human. Only law and mandate deny.

WHAT WE CAN ACTUALLY CHECK, AND WHY
-----------------------------------
This is the part that must survive questioning, so it is stated plainly.

Available, and implemented here:

  price_sanity          ACP line items carry a merchant-supplied `list_price`
                        ("reference or pre-discount price"). We compare paid
                        against it. NOTE, and we say this on screen: the list
                        price is asserted by the merchant -- the same party the
                        control is watching. It catches honest overpayment and
                        careless agents; it cannot catch a merchant who inflates
                        their own reference price. Treated as a signal, never as
                        an independent benchmark.

  substitution_distance We hold both sides: what the member asked for in words,
                        and the line items the agent actually put in the basket.
                        Comparing the two needs no external data at all. This is
                        the strongest diligence signal available to an issuer,
                        precisely because it is derived from artefacts we
                        already hold and sign.

  seller_disclosure     ACP exposes `marketplace_seller_details.name`. We can
                        check that a marketplace purchase names its seller at
                        all -- an unnamed seller on a marketplace order is a
                        real and checkable defect.

Designed and NOT implemented, because the data does not exist:

  quality_floor         Ratings and review counts appear in NO agentic-commerce
                        protocol -- not ACP, not AP2, not the Amex ACE kit.
                        Amazon's Product Advertising API is deprecated and now
                        returns HTTP 403; its successor is restricted to
                        affiliate publishers, which an issuer is not. Google's
                        review API manages a merchant's OWN catalogue and cannot
                        be queried for an arbitrary GTIN.

  seller_standing       Account age, fulfilment record and return policy are
                        absent from every protocol. ACP carries the seller's
                        NAME and nothing more.

  review_integrity      Requires the review corpus, which is unavailable per
                        quality_floor.

  alternatives_foregone The dominated-purchase check -- "a strictly better
                        option existed and was skipped" -- is the most
                        compelling idea here, and it needs a competitor
                        catalogue keyed by GTIN. Google's price-benchmark view
                        returns data only for products in your own Merchant
                        Center account; an issuer is not the merchant of record
                        and has no products to submit. There is no public
                        Shopping API. Scraping is not a defensible basis for an
                        issuer control.

We implement the first three and declare the rest, with the specific obstacle
named. A governance product that invented ratings to look complete would be
refuted by its own thesis.

LATENCY
-------
Even where such feeds existed, an external product lookup does not belong
inline in an authorisation. Auth budgets are in the low hundreds of
milliseconds. Everything here is computed from the request itself, so diligence
adds no network hop.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

# ---------------------------------------------------------------------------
# What the mandate can ask for
# ---------------------------------------------------------------------------

# How far above the merchant's own reference price we tolerate before flagging.
DEFAULT_PRICE_TOLERANCE = Decimal("0.25")  # +25%

# The default bar, applied when a card member has not set their own.
#
# Chosen to sit BELOW ordinary retail quality so it does not interrupt normal
# spending: most catalogue items sit at 4.0-4.6 stars with hundreds of reviews,
# so 3.5 flags the genuinely poor rather than the merely unexceptional. A bar
# that fires on routine purchases teaches everyone to ignore it.
DEFAULT_MIN_RATING = Decimal("3.5")
DEFAULT_MIN_REVIEWS = 20

# Words that carry no distinguishing meaning when comparing a request to a
# basket. Without this, "buy me a black bag" matches almost anything.
_STOPWORDS = frozenset(
    {
        "a", "an", "the", "some", "any", "me", "my", "for", "of", "and", "or",
        "with", "under", "below", "over", "above", "buy", "get", "order",
        "please", "need", "want", "book", "purchase", "at", "in", "to", "from",
        "rs", "inr", "rupees", "about", "around", "each", "per", "pack",
    }
)


# Concrete, checkable nouns. If the shopper names one of these and the basket
# does not contain it, that is a substitution worth flagging -- as distinct from
# a category request ("vehicle parts") whose basket legitimately differs.
_SUBSTITUTABLE_NOUNS = frozenset(
    {
        "bag", "laptop", "monitor", "keyboard", "chair", "desk", "phone",
        "headset", "printer", "camera", "watch", "shoes", "jacket",
        "rice", "milk", "coffee", "tea", "bread", "eggs", "oil",
        "flight", "hotel", "room", "ticket",
    }
)


@dataclass(frozen=True)
class DiligenceCheck:
    """One component of the diligence score."""

    key: str
    label: str
    status: str
    """'pass' | 'flag' | 'unavailable'"""
    detail: str = ""
    basis: str = ""
    """Where the data came from, or why it is unavailable. Always shown."""


@dataclass(frozen=True)
class DiligenceResult:
    checks: tuple[DiligenceCheck, ...] = ()
    flags: tuple[str, ...] = ()

    @property
    def below_bar(self) -> bool:
        return bool(self.flags)

    def to_canonical(self) -> dict:
        return {
            "checks": [
                {
                    "key": c.key,
                    "status": c.status,
                    "detail": c.detail,
                    "basis": c.basis,
                }
                for c in self.checks
            ],
            "flags": list(self.flags),
        }


# ---------------------------------------------------------------------------
# Components
# ---------------------------------------------------------------------------


def _tokens(text: str) -> set[str]:
    words = "".join(c.lower() if c.isalnum() else " " for c in text or "").split()
    return {w for w in words if len(w) > 2 and w not in _STOPWORDS and not w.isdigit()}


def _price_sanity(action, tolerance: Decimal) -> DiligenceCheck:
    """Paid versus the merchant's own reference price."""
    basis = (
        "merchant-asserted list price (ACP line item). Not an independent "
        "benchmark -- no public per-SKU price feed is available to an issuer."
    )

    lines = [
        item
        for item in (getattr(action, "cart_items", ()) or ())
        if getattr(item, "list_price", None)
    ]
    if not lines:
        return DiligenceCheck(
            key="price_sanity",
            label="Price sanity",
            status="unavailable",
            detail="This merchant did not supply a reference price.",
            basis=basis,
        )

    worst_ratio = Decimal("0")
    worst_line = None
    for item in lines:
        reference = Decimal(str(item.list_price))
        if reference <= 0:
            continue
        paid = Decimal(str(item.unit_amount))
        ratio = (paid - reference) / reference
        if ratio > worst_ratio:
            worst_ratio, worst_line = ratio, item

    if worst_line is None:
        return DiligenceCheck(
            key="price_sanity",
            label="Price sanity",
            status="pass",
            detail="Every line at or below the merchant's reference price.",
            basis=basis,
        )

    percent = int(worst_ratio * 100)
    detail = (
        f"“{worst_line.label}” paid ₹{worst_line.unit_amount} against a "
        f"reference of ₹{worst_line.list_price} (+{percent}%)"
    )
    status = "flag" if worst_ratio > tolerance else "pass"
    return DiligenceCheck(
        key="price_sanity", label="Price sanity", status=status, detail=detail, basis=basis
    )


def _substitution_distance(action) -> DiligenceCheck:
    """Did the agent buy what was actually asked for?

    Both sides are ours: the request in words, and the basket. No external data
    is involved, which is what makes this the most defensible check here.
    """
    basis = "the member's own request text against the basket AEGIS was sent."

    asked = _tokens(getattr(action, "description", ""))
    if not asked:
        return DiligenceCheck(
            key="substitution_distance",
            label="Bought what was asked for",
            status="unavailable",
            detail="No request text accompanied this purchase.",
            basis=basis,
        )

    bought = set()
    for item in getattr(action, "cart_items", ()) or ():
        bought |= _tokens(getattr(item, "label", ""))

    if not bought:
        return DiligenceCheck(
            key="substitution_distance",
            label="Bought what was asked for",
            status="unavailable",
            detail="No itemised basket accompanied this purchase.",
            basis=basis,
        )

    matched = asked & bought
    if matched:
        return DiligenceCheck(
            key="substitution_distance",
            label="Bought what was asked for",
            status="pass",
            detail=f"Basket matches the request on {', '.join(sorted(matched)[:4])}.",
            basis=basis,
        )

    # NO lexical overlap. That is NOT enough on its own to flag.
    #
    # "Fleet vehicle parts" legitimately yields "Filters, Drive belts", and
    # "Prescription refill" yields "First-aid kit". The relationship is
    # semantic, and demanding shared words flagged a quarter of an entire
    # corpus of correct purchases -- noise that would have buried the real
    # signal and trained every operator to ignore the flag.
    #
    # A bare vocabulary miss is therefore reported as UNAVAILABLE: we genuinely
    # cannot tell from words alone. We flag only when the request named a
    # SPECIFIC thing -- a concrete noun the basket then fails to contain --
    # which is the substitution case this check is actually for.
    concrete = asked & _SUBSTITUTABLE_NOUNS
    if concrete:
        return DiligenceCheck(
            key="substitution_distance",
            label="Bought what was asked for",
            status="flag",
            detail=(
                f"The request named {', '.join(sorted(concrete)[:3])}, "
                f"which the basket does not contain."
            ),
            basis=basis,
        )

    return DiligenceCheck(
        key="substitution_distance",
        label="Bought what was asked for",
        status="unavailable",
        detail=(
            "The request and the basket share no vocabulary, but the "
            "relationship may be legitimate (a request for “vehicle parts” "
            "yields “filters”). Not judged from words alone."
        ),
        basis=basis,
    )

    return DiligenceCheck(
        key="substitution_distance",
        label="Bought what was asked for",
        status="pass",
        detail=f"Basket matches the request on {', '.join(sorted(matched)[:4])}.",
        basis=basis,
    )


def _quality_floor(action, min_rating: Decimal, min_reviews: int) -> DiligenceCheck:
    """Rating and review count against the bar the card member set.

    The data is a MERCHANT ASSERTION from its product feed, exactly like
    `list_price` -- and labelled that way, because it is not independent
    verification. Amex can require it at acquiring, being the acquirer as well
    as the issuer; nothing in ACP, AP2 or the ACE kit carries it today.

    A rating with too few reviews is treated as no rating at all rather than a
    failure. Three glowing reviews are not evidence, but they are also not
    grounds to block a purchase.
    """
    basis = (
        "merchant-supplied product feed. A merchant assertion, not independent "
        "verification -- the same standing as the reference price."
    )

    rated = [
        item
        for item in (getattr(action, "cart_items", ()) or ())
        if getattr(item, "rating", None) is not None
    ]
    if not rated:
        return DiligenceCheck(
            key="quality_floor",
            label="Rating and reviews",
            status="unavailable",
            detail="This merchant did not supply ratings for these items.",
            basis=basis,
        )

    worst = min(rated, key=lambda i: float(i.rating))
    rating = Decimal(str(worst.rating))
    reviews = int(getattr(worst, "review_count", 0) or 0)

    # Too few reviews: the rating is not yet meaningful either way.
    if reviews < min_reviews:
        return DiligenceCheck(
            key="quality_floor",
            label="Rating and reviews",
            status="unavailable",
            detail=(
                f"“{worst.label}” has only {reviews} review"
                f"{'' if reviews == 1 else 's'} — too few to judge against "
                f"your {min_reviews}-review floor."
            ),
            basis=basis,
        )

    if rating < min_rating:
        return DiligenceCheck(
            key="quality_floor",
            label="Rating and reviews",
            status="flag",
            detail=(
                f"“{worst.label}” is rated {rating}★ from {reviews:,} reviews, "
                f"below the {min_rating}★ you asked for."
            ),
            basis=basis,
        )

    return DiligenceCheck(
        key="quality_floor",
        label="Rating and reviews",
        status="pass",
        detail=f"{rating}★ from {reviews:,} reviews.",
        basis=basis,
    )


def _seller_disclosure(action) -> DiligenceCheck:
    """A marketplace order should name its seller."""
    basis = (
        "ACP marketplace_seller_details.name. Seller REPUTATION -- account age, "
        "fulfilment record, returns -- exists in no protocol and is not checked."
    )
    seller = getattr(action, "seller_name", None)
    if seller:
        return DiligenceCheck(
            key="seller_disclosure",
            label="Seller disclosed",
            status="pass",
            detail=f"Sold by {seller}.",
            basis=basis,
        )
    return DiligenceCheck(
        key="seller_disclosure",
        label="Seller disclosed",
        status="unavailable",
        detail="This merchant is not a marketplace, or named no seller.",
        basis=basis,
    )


# Components we have designed but cannot run, each with the specific obstacle.
# Surfaced in the UI so the gap is stated by us rather than discovered by
# someone else.
UNAVAILABLE_CHECKS: tuple[DiligenceCheck, ...] = (
    DiligenceCheck(
        key="seller_standing",
        label="Seller standing",
        status="unavailable",
        detail="Would catch fly-by-night sellers.",
        basis="Account age, fulfilment record and return policy appear in no protocol.",
    ),
    DiligenceCheck(
        key="alternatives_foregone",
        label="Dominated purchase",
        status="unavailable",
        detail="Would catch a strictly better, cheaper option being skipped.",
        basis=(
            "Requires a competitor catalogue keyed by GTIN. Google's price "
            "benchmark returns only products in your own Merchant Center "
            "account, and there is no public Shopping API."
        ),
    ),
)


def assess(action, mandate) -> DiligenceResult:
    """Run every diligence component that has data, and declare those that do not.

    The bar comes from the card member's own preferences, carried on the mandate
    by the decision path. Absent preferences fall back to the documented
    defaults, so a member who never opens the panel still gets a sensible bar.
    """
    tolerance = getattr(mandate, "price_tolerance", None) or DEFAULT_PRICE_TOLERANCE
    min_rating = getattr(mandate, "min_rating", None) or DEFAULT_MIN_RATING
    min_reviews = getattr(mandate, "min_reviews", None) or DEFAULT_MIN_REVIEWS

    checks = [
        _substitution_distance(action),
        _quality_floor(action, Decimal(str(min_rating)), int(min_reviews)),
        _price_sanity(action, Decimal(str(tolerance))),
        _seller_disclosure(action),
        *UNAVAILABLE_CHECKS,
    ]
    flags = tuple(c.key for c in checks if c.status == "flag")
    return DiligenceResult(checks=tuple(checks), flags=flags)


def shortfall_detail(result: DiligenceResult) -> str:
    """Why the bar was missed, in words.

    The rule's detail lands on the ledger and in front of a card member, so a
    bare key like "quality_floor" is not good enough -- it names the check
    rather than the finding.
    """
    reasons = [c.detail for c in result.checks if c.status == "flag" and c.detail]
    return " ".join(reasons) if reasons else ", ".join(result.flags)
