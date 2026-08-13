"""Mandate-conformance scoring.

Answers one question: *does this specific purchase match the purpose the card
member actually authorised?* Returns {score, rationale, vetoes[]}.

Three properties matter more than the score itself:

1. **Vetoes are deterministic and precede the model.** A prohibited attribute
   is decided by set intersection, before any network call. The model is never
   given the opportunity to talk us out of a hard prohibition, and a model
   outage cannot disable one. This is what catches the trap merchant that
   shares an MCC with a legitimate one.

2. **Failure is closed.** Timeout, bad JSON, network error, missing key --
   every path returns ConformanceResult.unavailable(...), which policy.py
   turns into STEP_UP, never ALLOW.

3. **Provenance is recorded.** model_version and prompt_hash are persisted on
   every decision, so a decision made in March can be explained after the
   prompt or model has changed.

The scorer is defined as a Protocol so the vendor is swappable; OpenAIScorer
is the default. Strict JSON is enforced by the provider's structured-output
mode rather than by asking nicely in the prompt.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Optional, Protocol

from .types import (
    ActionRequest,
    ConformanceResult,
    Mandate,
    canonical_json,
    sha256_hex,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gpt-4.1-mini"
DEFAULT_TIMEOUT_SECONDS = 4.0
CACHE_TTL_SECONDS = 60 * 60 * 24 * 7

# ---------------------------------------------------------------------------
# The prompt. Frozen, versioned, hashed.
#
# Changing this string changes prompt_hash, which is written to every decision
# -- that is intentional. A score is only interpretable alongside the prompt
# that produced it.
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a mandate-conformance scorer for a payment authorisation system.

A card member has authorised an autonomous agent to spend on their card for ONE
specific stated purpose. You are shown that purpose and one attempted purchase.
Score how well the purchase matches the authorised purpose.

Scoring guide:
  0.90 - 1.00  Squarely within the stated purpose; an obvious, routine instance.
  0.70 - 0.89  Consistent with the purpose, though not a central example.
  0.45 - 0.69  Ambiguous. Could plausibly serve the purpose or could not.
  0.15 - 0.44  Poor match. Hard to justify under the stated purpose.
  0.00 - 0.14  Clearly outside the purpose, or a stored-value/cash-equivalent
               instrument (gift cards, prepaid cards, vouchers, crypto, wire
               transfers). These convert a restricted mandate into unrestricted
               spending power and must always score at the bottom of the range,
               EVEN IF the merchant category looks legitimate.

Judge the PURCHASE, not the merchant's overall reputation. Two merchants can
share a category while selling entirely different things.

Report any of these attributes the purchase exhibits, in `vetoes`:
gift_card, cash_equivalent, crypto, prepaid_instrument, wire_transfer,
subscription_trap, adult, gambling, firearms, alcohol, tobacco.
Only list an attribute you have positive evidence for from the purchase details.

Be concise in `rationale`: one sentence, addressed to a compliance reviewer,
explaining the score.
"""

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["score", "rationale", "vetoes"],
    "properties": {
        "score": {
            "type": "number",
            "description": "Conformance score between 0 and 1 inclusive.",
        },
        "rationale": {
            "type": "string",
            "description": "One sentence explaining the score.",
        },
        "vetoes": {
            "type": "array",
            "description": "Prohibited attributes positively evidenced by this purchase.",
            "items": {"type": "string"},
        },
    },
}

PROMPT_HASH = sha256_hex(SYSTEM_PROMPT, canonical_json(RESPONSE_SCHEMA))


def build_user_prompt(mandate: Mandate, action: ActionRequest) -> str:
    """Render the scoring input. Deterministic: same inputs -> same string."""
    return canonical_json(
        {
            "authorised_purpose": mandate.purpose,
            "permitted_merchant_categories": sorted(mandate.permitted_categories),
            "attributes_the_member_prohibited": sorted(mandate.prohibited_attributes),
            "authorised_delivery_destination": mandate.ship_to,
            "purchase": {
                "merchant_name": action.merchant_name,
                "merchant_category_code": action.merchant_category,
                "description": action.description,
                "amount": str(action.amount),
                "currency": action.currency,
                # The basket is the question. A merchant category describes the
                # shop; these lines describe what is actually being bought.
                "cart_items": [
                    {"label": i.label, "attributes": sorted(i.attributes)}
                    for i in action.cart_items
                ],
                "delivery_destination": action.ship_to,
            },
        }
    )


# ---------------------------------------------------------------------------
# Deterministic veto -- always runs, never depends on the model
# ---------------------------------------------------------------------------


def deterministic_vetoes(mandate: Mandate, action: ActionRequest) -> frozenset[str]:
    """Prohibited attributes the purchase provably exhibits.

    Pure set intersection over ground-truth attributes -- merchant AND cart. No
    inference, no model, no network. If this returns non-empty, policy.py denies
    regardless of anything the scorer would have said.
    """
    return frozenset(set(mandate.prohibited_attributes) & set(action.all_attributes))


# Phrases that only appear when someone is trying to talk an agent out of its
# instructions. Matched case-insensitively against `injected_instruction`.
#
# This list is deliberately about MANIPULATION GRAMMAR, not about topics. An
# agent legitimately reads text mentioning "gift card"; no agent legitimately
# reads text telling it to ignore its own limits. Keying on the grammar of
# override is what makes this specific enough to be a hard veto.
INJECTION_PHRASES: tuple[str, ...] = (
    "ignore previous",
    "ignore prior",
    "ignore all previous",
    # "ignore your ..." was missing while "forget your instructions" was
    # present, so "ignore your instructions" -- among the most obvious
    # phrasings there is -- went undetected. Match the shape of the attempt,
    # not one exact sentence.
    "ignore your",
    "ignore the",
    "ignore all",
    "disregard previous",
    "disregard your",
    "disregard the",
    "override the",
    "override your",
    "bypass the",
    "bypass your",
    "you are now",
    "new instructions",
    "system prompt",
    "developer mode",
    "admin says",
    "do not check",
    "skip the",
    "without approval",
    "do not tell",
    "don't tell the",
    "without telling",
    "keep this secret",
    "urgent: transfer",
    "send the balance",
    "forget your instructions",
    "forget your",
    "your real task",
    "actually, instead",
    "mark everything as approved",
    "pretend",
)


def detect_injection(action: ActionRequest) -> tuple[str, ...]:
    """Manipulation phrases found in untrusted text the agent was fed.

    The text is treated strictly as EVIDENCE -- it is matched, recorded and
    scored, never interpreted as an instruction. That distinction is the whole
    defence: an injected string can influence the audit trail, but it can never
    reach the decision logic.
    """
    if not action.injected_instruction:
        return ()
    haystack = action.injected_instruction.lower()
    return tuple(phrase for phrase in INJECTION_PHRASES if phrase in haystack)


def _normalise_destination(value: Optional[str]) -> str:
    """Loose comparison for addresses: case, punctuation and spacing vary."""
    if not value:
        return ""
    return " ".join("".join(c.lower() if c.isalnum() else " " for c in value).split())


def ship_to_mismatch(mandate: Mandate, action: ActionRequest) -> bool:
    """True when goods would go somewhere the mandate did not authorise.

    Only checked when BOTH sides declare a destination -- a mandate without a
    ship_to has not constrained delivery, and inventing a constraint the card
    member never set would block legitimate spending.
    """
    if not mandate.ship_to or not action.ship_to:
        return False
    expected = _normalise_destination(mandate.ship_to)
    actual = _normalise_destination(action.ship_to)
    if not expected or not actual:
        return False
    # Substring either way: "Office" authorises "Office - Level 4, Tech Park".
    return expected not in actual and actual not in expected


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


def cache_key(mandate: Mandate, action: ActionRequest) -> str:
    """Keyed on (mandate_hash, action_signature) as specified.

    prompt_hash and model are folded in so that changing either invalidates the
    cache rather than serving scores attributed to the wrong provenance.
    """
    return "aegis:conf:" + sha256_hex(
        mandate.mandate_hash, action.action_signature, PROMPT_HASH, DEFAULT_MODEL
    )


class ConformanceCache(Protocol):
    def get(self, key: str) -> Optional[dict[str, Any]]: ...
    def set(self, key: str, value: dict[str, Any], ttl: int = CACHE_TTL_SECONDS) -> None: ...


class InMemoryCache:
    """Used by tests and by the seeder's frozen-fixture mode."""

    def __init__(self) -> None:
        self._data: dict[str, dict[str, Any]] = {}

    def get(self, key: str) -> Optional[dict[str, Any]]:
        return self._data.get(key)

    def set(self, key: str, value: dict[str, Any], ttl: int = CACHE_TTL_SECONDS) -> None:
        self._data[key] = value

    def __len__(self) -> int:
        return len(self._data)

    def snapshot(self) -> dict[str, dict[str, Any]]:
        return dict(self._data)

    def load(self, data: dict[str, dict[str, Any]]) -> None:
        self._data.update(data)


class RedisCache:
    """Redis-backed cache. Never raises into the caller: a cache outage must
    degrade to a live call, not to a failed decision."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def get(self, key: str) -> Optional[dict[str, Any]]:
        try:
            raw = self._client.get(key)
        except Exception:
            logger.warning("conformance cache read failed", exc_info=True)
            return None
        if not raw:
            return None
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return None

    def set(self, key: str, value: dict[str, Any], ttl: int = CACHE_TTL_SECONDS) -> None:
        try:
            self._client.setex(key, ttl, json.dumps(value))
        except Exception:
            logger.warning("conformance cache write failed", exc_info=True)


# ---------------------------------------------------------------------------
# Scorers
# ---------------------------------------------------------------------------


class Scorer(Protocol):
    model_version: str

    def score(self, mandate: Mandate, action: ActionRequest) -> ConformanceResult: ...


@dataclass
class OpenAIScorer:
    """Live scorer using OpenAI structured outputs (strict JSON schema)."""

    api_key: Optional[str] = None
    model: str = DEFAULT_MODEL
    timeout: float = DEFAULT_TIMEOUT_SECONDS

    def __post_init__(self) -> None:
        self.model_version = self.model
        self._client = None

    def _get_client(self) -> Any:
        if self._client is None:
            from openai import OpenAI  # imported lazily so tests need no SDK

            key = self.api_key or os.environ.get("OPENAI_API_KEY")
            if not key:
                raise RuntimeError("OPENAI_API_KEY is not set")
            self._client = OpenAI(api_key=key, timeout=self.timeout, max_retries=1)
        return self._client

    def score(self, mandate: Mandate, action: ActionRequest) -> ConformanceResult:
        started = time.perf_counter()
        try:
            client = self._get_client()
            response = client.chat.completions.create(
                model=self.model,
                temperature=0,
                seed=7,
                timeout=self.timeout,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": build_user_prompt(mandate, action)},
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "conformance",
                        "strict": True,
                        "schema": RESPONSE_SCHEMA,
                    },
                },
            )
            content = response.choices[0].message.content or ""
            parsed = json.loads(content)
            score = float(parsed["score"])
            if not 0.0 <= score <= 1.0:
                raise ValueError(f"score {score} out of range")
            vetoes = tuple(sorted({str(v) for v in parsed.get("vetoes", [])}))
            return ConformanceResult(
                score=score,
                rationale=str(parsed.get("rationale", "")).strip(),
                vetoes=vetoes,
                model_version=getattr(response, "model", self.model),
                prompt_hash=PROMPT_HASH,
                available=True,
                latency_ms=_ms(started),
            )
        except Exception as exc:  # noqa: BLE001 -- every failure is fail-closed
            logger.warning("conformance scoring failed: %s", exc)
            return ConformanceResult.unavailable(
                error=f"{type(exc).__name__}: {exc}",
                model_version=self.model,
                prompt_hash=PROMPT_HASH,
            )


@dataclass
class DeterministicScorer:
    """A weighted, reproducible conformance score. No network, no model.

    This is the recommended primary scorer: it is fully explainable, cannot
    time out, and returns the same score for the same input forever -- which is
    what lets a decision be re-derived months later. The model scorer is an
    upgrade that adds nuance on ambiguous cases, not a dependency.

    The weights come from the reference specification. They are stated here
    rather than tuned, because a control whose weights drift is a control whose
    past decisions cannot be explained.
    """

    model_version: str = "deterministic-v1"

    BASE = 0.50
    CATEGORY_MATCH = 0.30
    CATEGORY_MISS = -0.35
    KEYWORD_MATCH = 0.15
    KEYWORD_MISS = -0.10
    NOVEL_MERCHANT = -0.12
    ODD_HOUR = -0.10
    AMOUNT_SWING = 0.08

    def score(self, mandate: Mandate, action: ActionRequest) -> ConformanceResult:
        started = time.perf_counter()
        value = self.BASE
        notes: list[str] = []

        # --- merchant category vs permitted categories ----------------------
        if mandate.permitted_categories:
            if action.merchant_category in mandate.permitted_categories:
                value += self.CATEGORY_MATCH
                notes.append(f"category {action.merchant_category} is permitted")
            else:
                value += self.CATEGORY_MISS
                notes.append(
                    f"category {action.merchant_category} is outside the permitted set"
                )

        # --- purpose keywords vs the merchant name, description and cart ----
        haystack = " ".join(
            [action.merchant_name, action.description]
            + [item.label for item in action.cart_items]
        ).lower()
        if mandate.purpose_keywords:
            hits = sorted(k for k in mandate.purpose_keywords if k.lower() in haystack)
            if hits:
                value += self.KEYWORD_MATCH
                notes.append("matches authorised purpose (" + ", ".join(hits) + ")")
            else:
                value += self.KEYWORD_MISS
                notes.append("nothing in the basket matches the authorised purpose")

        # --- amount relative to the ceiling ---------------------------------
        # Well under the ceiling is mildly reassuring; pressed right against it
        # is mildly suspicious. Neither is decisive on its own.
        if mandate.per_transaction_ceiling > 0:
            ratio = float(action.amount) / float(mandate.per_transaction_ceiling)
            if ratio <= 0.5:
                value += self.AMOUNT_SWING
            elif ratio >= 0.95:
                value -= self.AMOUNT_SWING
                notes.append("amount sits at the top of the authorised limit")

        score = max(0.0, min(1.0, value))
        return ConformanceResult(
            score=round(score, 4),
            rationale=(
                "; ".join(notes).capitalize() if notes else "No distinguishing signals."
            ),
            vetoes=(),
            model_version=self.model_version,
            prompt_hash=PROMPT_HASH,
            available=True,
            latency_ms=_ms(started),
        )


@dataclass
class FallbackScorer:
    """Try the primary scorer; fall back to a deterministic one on failure.

    This is what makes a live model safe to depend on for nuance without
    depending on it for availability. A timeout degrades the *quality* of the
    score, never the ability to produce one -- and the fallback is recorded in
    `model_version`, so nobody can mistake a fallback score for a model score.
    """

    primary: "Scorer"
    fallback: "Scorer" = field(default_factory=DeterministicScorer)

    def __post_init__(self) -> None:
        self.model_version = getattr(self.primary, "model_version", "fallback")

    def score(self, mandate: Mandate, action: ActionRequest) -> ConformanceResult:
        result = self.primary.score(mandate, action)
        if result.available:
            return result
        logger.warning("primary scorer unavailable (%s), using deterministic", result.error)
        degraded = self.fallback.score(mandate, action)
        return ConformanceResult(
            score=degraded.score,
            rationale=degraded.rationale,
            vetoes=degraded.vetoes,
            model_version=f"{degraded.model_version} (fallback: {result.error})",
            prompt_hash=degraded.prompt_hash,
            available=True,
            latency_ms=degraded.latency_ms,
        )


@dataclass
class ReplayScorer:
    """Serves previously-recorded REAL scores from a frozen fixture.

    This is not a fake: every entry was produced by a live call and is keyed by
    the same (mandate_hash, action_signature) as the live path. It makes the
    seeded history reproducible and the demo runnable offline. A key that was
    never recorded is treated as scorer-unavailable -- fail closed -- rather
    than invented.
    """

    fixture: dict[str, dict[str, Any]]
    model_version: str = DEFAULT_MODEL

    def score(self, mandate: Mandate, action: ActionRequest) -> ConformanceResult:
        entry = self.fixture.get(cache_key(mandate, action))
        if entry is None:
            return ConformanceResult.unavailable(
                error="no recorded score for this action (replay mode)",
                model_version=self.model_version,
                prompt_hash=PROMPT_HASH,
            )
        return _from_payload(entry, cached=True)


@dataclass
class UnavailableScorer:
    """Explicitly-down scorer, for exercising the fail-closed path."""

    reason: str = "scorer disabled"
    model_version: str = "unavailable"

    def score(self, mandate: Mandate, action: ActionRequest) -> ConformanceResult:
        return ConformanceResult.unavailable(error=self.reason, prompt_hash=PROMPT_HASH)


# ---------------------------------------------------------------------------
# The public entry point
# ---------------------------------------------------------------------------


class ConformanceEngine:
    """Deterministic vetoes + cached scoring, with fail-closed guarantees."""

    def __init__(
        self,
        scorer: Optional[Scorer] = None,
        cache: Optional[ConformanceCache] = None,
    ) -> None:
        self.scorer = scorer or OpenAIScorer()
        self.cache = cache if cache is not None else InMemoryCache()

    def evaluate(self, mandate: Mandate, action: ActionRequest) -> ConformanceResult:
        # 1. HARD VETOES FIRST -- before any model call, always. Each of these
        #    is decidable from stored facts, so none of them can be disabled by
        #    an outage, a timeout, or a persuasive model.

        # 1a. Injected instructions. Checked before the prohibited-attribute
        #     veto because a subverted agent is a graver finding than a single
        #     bad purchase, and the incident label must say so.
        injection = detect_injection(action)
        if injection:
            return ConformanceResult(
                score=0.02,
                rationale=(
                    "Untrusted text supplied to this agent contains instruction-override "
                    "phrasing: " + ", ".join(f'"{p}"' for p in injection)
                ),
                vetoes=("suspected_injection",) + tuple(sorted(set(injection))),
                model_version="deterministic",
                prompt_hash=PROMPT_HASH,
                available=True,
            )

        # 1b. Delivery destination outside the mandate.
        if ship_to_mismatch(mandate, action):
            return ConformanceResult(
                score=0.05,
                rationale=(
                    f"Delivery to {action.ship_to!r} is outside the destination the card "
                    f"member authorised ({mandate.ship_to!r})."
                ),
                vetoes=("ship_to_mismatch",),
                model_version="deterministic",
                prompt_hash=PROMPT_HASH,
                available=True,
            )

        # 1c. Prohibited attributes in the merchant or the cart.
        vetoes = deterministic_vetoes(mandate, action)
        if vetoes:
            # A hard prohibition is decided here. We still score 0.0 and record
            # the veto, but policy.py will deny at rule 7 on the veto alone --
            # so this result never needs the network to be correct.
            return ConformanceResult(
                score=0.0,
                rationale=(
                    "Purchase exhibits attributes the card member explicitly prohibited: "
                    + ", ".join(sorted(vetoes))
                ),
                vetoes=tuple(sorted(vetoes)),
                model_version="deterministic",
                prompt_hash=PROMPT_HASH,
                available=True,
                cached=False,
            )

        # 2. Cache.
        key = cache_key(mandate, action)
        hit = self.cache.get(key)
        if hit is not None:
            return _from_payload(hit, cached=True)

        # 3. Live scoring. Never raises -- returns unavailable on any failure.
        result = self.scorer.score(mandate, action)

        # 4. Only cache successes. Caching a timeout would make an outage sticky.
        if result.available:
            self.cache.set(key, _to_payload(result))
        return result


def _to_payload(result: ConformanceResult) -> dict[str, Any]:
    return {
        "score": result.score,
        "rationale": result.rationale,
        "vetoes": list(result.vetoes),
        "model_version": result.model_version,
        "prompt_hash": result.prompt_hash,
    }


def _from_payload(payload: dict[str, Any], cached: bool = False) -> ConformanceResult:
    return ConformanceResult(
        score=float(payload.get("score", 0.0)),
        rationale=str(payload.get("rationale", "")),
        vetoes=tuple(payload.get("vetoes", ())),
        model_version=str(payload.get("model_version", "")),
        prompt_hash=str(payload.get("prompt_hash", PROMPT_HASH)),
        available=True,
        cached=cached,
    )


def _ms(started: float) -> int:
    return max(int((time.perf_counter() - started) * 1000), 0)
