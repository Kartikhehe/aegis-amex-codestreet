"""Legality screening: goods no card member can authorise.

This is NOT the mandate check. A mandate says what a particular card member
permitted a particular agent to buy; this says what nobody may buy on the card
at all, whatever their mandate says. The two are different questions and the
distinction matters for both correctness and liability:

    prohibited_attribute_veto   "YOU said this agent may never buy gift cards."
                                Card-member policy. Another member may permit it.
    prohibited_goods            "This cannot be bought on this card by anyone."
                                Law and network rules. No mandate can clear it.

Because of that, this rule sits ABOVE the mandate in evaluation order. Ranking
it below would produce the absurd result that a sufficiently permissive mandate
could authorise a controlled substance.

WHERE THE LIST COMES FROM
-------------------------
Card networks publish prohibited and restricted business categories, and
acquirers enforce them at onboarding. The categories below follow that shape:
controlled substances, weapons, counterfeits, and the adjacent categories that
are network-restricted rather than strictly unlawful.

WHAT THIS IS NOT
----------------
It is not a legal determination, and it does not attempt jurisdiction-specific
licensing (alcohol delivery rules differ by Indian state; pharmacy rules differ
by prescription status). Those need a licensing feed we do not have, and are
documented as such rather than faked. What runs here is a deterministic screen
over the terms in the basket -- honest about being a screen, not an opinion.

The screen is deliberately deterministic. A model must never be the thing that
decides whether a purchase is lawful: it is not auditable, it is not stable
across runs, and "the model said it was fine" is not a defence anyone can take
to a regulator.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# The screen
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProhibitedCategory:
    """One class of goods that may not be bought, and why."""

    key: str
    label: str
    basis: str
    """Why it is prohibited, in words a card member would accept."""
    terms: tuple[str, ...]


# Ordered most-severe first, so a basket that trips several is reported by its
# gravest category rather than whichever happened to match first.
PROHIBITED_CATEGORIES: tuple[ProhibitedCategory, ...] = (
    ProhibitedCategory(
        key="controlled_substances",
        label="Controlled substances",
        basis="Unlawful to purchase; prohibited by card network rules.",
        terms=(
            # Every term must be unambiguous ON ITS OWN. Bare "meth" and
            # "weed" are not: they appear in "methylated spirits" and
            # "weedkiller", and blocking a lawful basket is a worse failure
            # than missing a term a determined buyer would obfuscate anyway.
            "cocaine", "heroin", "mdma", "methamphetamine",
            "lsd", "ketamine", "fentanyl", "opioid", "opium",
            "cannabis", "marijuana", "hashish", "charas",
            "narcotic", "narcotics", "psilocybin", "magic mushroom",
            "anabolic steroid", "illegal drug", "recreational drug",
        ),
    ),
    ProhibitedCategory(
        key="weapons",
        label="Weapons and ammunition",
        basis="Restricted purchase requiring licensing AEGIS cannot verify.",
        terms=(
            # NOT bare "gun": "Gun Hill Road" is a real address and blocking
            # a grocery order delivered there would be indefensible.
            "firearm", "firearms", "handgun", "pistol", "rifle", "shotgun",
            "ammunition", "silencer", "suppressor",
            "grenade", "explosives", "detonator",
            "assault weapon", "assault rifle", "machine gun",
        ),
    ),
    ProhibitedCategory(
        key="counterfeit",
        label="Counterfeit or stolen goods",
        basis="Unlawful; prohibited by card network rules.",
        terms=(
            "counterfeit", "replica watch", "fake designer", "knockoff",
            "first copy", "stolen goods", "cloned card",
            "pirated", "cracked software",
        ),
    ),
    ProhibitedCategory(
        key="illicit_services",
        label="Illicit services and stolen data",
        basis="Unlawful; prohibited by card network rules.",
        terms=(
            # Not bare "dumps" -- a legitimate word in database tooling.
            "hacking service", "ddos attack", "botnet", "malware", "ransomware",
            "stolen credentials", "card dumps", "fullz", "credit card numbers",
            "hitman", "forged passport", "fake passport", "fake degree",
        ),
    ),
    ProhibitedCategory(
        key="human_harm",
        label="Prohibited human and wildlife trade",
        basis="Unlawful; prohibited by card network rules.",
        terms=(
            "human organ", "kidney for sale", "ivory", "rhino horn",
            "pangolin", "endangered species", "tiger skin",
        ),
    ),
    ProhibitedCategory(
        key="prescription_evasion",
        label="Prescription medicines without a prescription",
        basis=(
            "Requires a verified prescription, which AEGIS cannot check at "
            "authorisation time."
        ),
        terms=(
            "without prescription", "no prescription needed", "no rx",
            "prescription free", "buy antibiotics online",
        ),
    ),
)


@dataclass(frozen=True)
class ComplianceHit:
    """A prohibited term found in the basket, and where."""

    category: ProhibitedCategory
    matched_term: str
    where: str
    """The cart line or description the term was found in."""

    @property
    def detail(self) -> str:
        return f"{self.category.label}: matched “{self.matched_term.strip()}” in {self.where}"


def _haystacks(action) -> list[tuple[str, str]]:
    """Every piece of text describing WHAT is being bought, with its source.

    Deliberately excludes the merchant NAME. A pharmacy legitimately has
    "prescription" in its name, and a shop called "Gun Hill Road Grocers" sells
    groceries. Screening the seller's name rather than the goods produces false
    positives that block lawful spending -- the failure mode this system exists
    to avoid.
    """
    spots: list[tuple[str, str]] = []
    for item in getattr(action, "cart_items", ()) or ():
        label = getattr(item, "label", "") or ""
        if label:
            spots.append((label.lower(), f"basket line “{label}”"))
    description = getattr(action, "description", "") or ""
    if description:
        spots.append((description.lower(), "the purchase description"))
    return spots


# Terms are matched on WORD BOUNDARIES, not as bare substrings.
#
# Substring matching looked fine until "gun " matched "Gun Hill Road Grocers"
# and blocked a grocery order. Over-blocking lawful spending is the failure this
# system exists to prevent, so a term must match a whole word (or phrase) --
# "gun" no longer fires inside "Gun Hill", while "gun" as a word still does.
#
# Compiled once at import: the screen runs on every decision and the auth path
# has a latency budget.
_COMPILED: tuple[tuple[ProhibitedCategory, tuple[tuple[str, "re.Pattern[str]"], ...]], ...] = tuple(
    (
        category,
        tuple(
            (term, re.compile(rf"\b{re.escape(term.strip())}\b", re.I))
            for term in category.terms
        ),
    )
    for category in PROHIBITED_CATEGORIES
)


def screen(action) -> ComplianceHit | None:
    """Return the gravest prohibited-goods hit in this basket, or None.

    Pure and deterministic: the same basket always yields the same answer, and
    the answer can be re-derived from the stored record years later.
    """
    spots = _haystacks(action)
    for category, patterns in _COMPILED:
        for haystack, where in spots:
            for term, pattern in patterns:
                if pattern.search(haystack):
                    return ComplianceHit(
                        category=category, matched_term=term.strip(), where=where
                    )
    return None


def categories_summary() -> list[dict[str, str]]:
    """The screen, for the console and the docs. No secrets here by design.

    Publishing the categories is deliberate: a governance control that only
    works while nobody knows what it checks is not a control, it is an
    obscurity. The terms themselves stay server-side.
    """
    return [
        {"key": c.key, "label": c.label, "basis": c.basis, "term_count": str(len(c.terms))}
        for c in PROHIBITED_CATEGORIES
    ]
