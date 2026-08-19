"""Signed verdicts: making an AEGIS decision cryptographically checkable.

WHY THIS EXISTS
---------------
Without a signature, an AEGIS verdict is only advice. Anything downstream can
ignore it, and nothing downstream can prove it was ever consulted. A governance
layer that can be skipped silently is not a control -- it is a suggestion.

So every decision is signed. The signature travels with the authorisation, and
the party that settles the payment can verify it before moving money. That turns
"AEGIS said no" from a log line into a condition of payment.

WHAT IS SIGNED
--------------
Not the whole record -- a compact, canonical assertion:

    action_id      which purchase this is about
    verdict        ALLOW / DENY / STEP_UP
    reason_code    why, machine-readable
    ruleset_hash   WHICH POLICY produced it (this is the important one)
    cart_digest    binds the verdict to a specific basket
    amount+currency
    agent_id
    decided_at
    kid            which key signed it

The `ruleset_hash` matters most: it means a verdict cannot be replayed under a
different policy and still verify. The `cart_digest` means it cannot be moved to
a different basket. Together they make the signature specific to one purchase
under one policy at one time.

ALGORITHM
---------
Ed25519 (RFC 8032). Chosen deliberately:

  * 64-byte signatures and ~50us verification -- an authorisation path has a
    latency budget measured in low hundreds of milliseconds, and a verifier
    sitting inline cannot afford RSA.
  * No parameter choices to get wrong, unlike ECDSA nonce handling.
  * Deterministic: the same payload and key always yield the same signature,
    which makes the demo reproducible and the tests exact.

KEY MANAGEMENT -- STATED HONESTLY
---------------------------------
In this MVP the private key is generated on boot (or loaded from
AEGIS_SIGNING_KEY) and held in process memory. That is NOT how this would run in
production: the signing key belongs in an HSM or a KMS, with rotation, and the
public key published at a well-known JWKS endpoint. What is real here is the
signature itself, the payload construction and the verification path -- the key
custody is the part that is simulated, and it is documented as such rather than
glossed.
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Optional

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.exceptions import InvalidSignature

from .engine.types import canonical_json, sha256_hex

# Version tag on every signature, so a future scheme change is unambiguous
# rather than silently incompatible.
SIGNATURE_ALG = "Ed25519"
SIGNATURE_VERSION = "aegis-verdict-v1"


def _as_utc_iso(value: Any) -> str:
    """A datetime as an unambiguous UTC string, stable across serialisers."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if getattr(value, "tzinfo", None) is None:
        from datetime import timezone as _tz

        value = value.replace(tzinfo=_tz.utc)
    else:
        from datetime import timezone as _tz

        value = value.astimezone(_tz.utc)
    return value.isoformat().replace("+00:00", "Z")


def _b64(raw: bytes) -> str:
    """URL-safe base64 without padding, as used by JWS."""
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


@dataclass(frozen=True)
class Signer:
    """Holds the signing key and produces verdict signatures."""

    private_key: Ed25519PrivateKey
    kid: str

    @property
    def public_key_b64(self) -> str:
        raw = self.private_key.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        return _b64(raw)

    def sign(self, payload: dict[str, Any]) -> str:
        return _b64(self.private_key.sign(canonical_json(payload).encode()))


@lru_cache(maxsize=1)
def get_signer() -> Signer:
    """The process signing key.

    AEGIS_SIGNING_KEY (base64 raw Ed25519 seed) pins the key so signatures are
    stable across restarts -- without it a fresh key is generated each boot and
    previously-issued signatures stop verifying. That is acceptable for a demo
    and unacceptable in production, which is exactly why the variable exists.
    """
    seed = os.environ.get("AEGIS_SIGNING_KEY", "").strip()
    if seed:
        key = Ed25519PrivateKey.from_private_bytes(_unb64(seed)[:32])
    else:
        key = Ed25519PrivateKey.generate()

    public_raw = key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    # kid is derived from the public key, so it changes when the key changes and
    # a verifier can tell which key to fetch.
    return Signer(private_key=key, kid="aegis-" + sha256_hex(_b64(public_raw))[:16])


def verdict_payload(decision: Any, *, kid: str) -> dict[str, Any]:
    """The exact assertion that gets signed. Small, canonical, unambiguous.

    Every value is a JSON-NATIVE type -- string, number, null. This matters: the
    payload crosses the wire and is verified on the far side, so if it held a
    datetime or a Decimal the serialiser would render it differently there and
    a genuine signature would fail to verify. Normalising at construction means
    the bytes signed here are the bytes checked anywhere.
    """
    conformance = getattr(decision, "conformance", None)
    decided = getattr(decision, "decided_at", None)
    return {
        "v": SIGNATURE_VERSION,
        "action_id": decision.action_id,
        "agent_id": decision.agent_id,
        "verdict": getattr(decision.verdict, "value", decision.verdict),
        "reason_code": getattr(decision.reason_code, "value", decision.reason_code),
        "ruleset_hash": decision.ruleset_hash,
        "cart_digest": getattr(decision, "cart_digest", "") or "",
        "amount": str(getattr(decision, "amount", "")),
        "currency": getattr(decision, "currency", "INR"),
        "score": None if conformance is None else float(conformance.score),
        "decided_at": _as_utc_iso(decided),
        "kid": kid,
    }


def sign_decision(decision: Any) -> dict[str, Any]:
    """Sign one decision. Returns the block that travels with the payment."""
    signer = get_signer()
    payload = verdict_payload(decision, kid=signer.kid)
    return {
        "alg": SIGNATURE_ALG,
        "kid": signer.kid,
        "signature": signer.sign(payload),
        "payload": payload,
    }


def verify_signature(block: dict[str, Any], public_key_b64: Optional[str] = None) -> tuple[bool, str]:
    """Verify a signed verdict. Returns (ok, reason).

    This is the function a Credential Provider would run before releasing a
    payment credential. It is deliberately exposed and deliberately simple:
    anyone holding the public key can check any verdict AEGIS ever issued,
    without access to AEGIS itself.
    """
    try:
        raw = _unb64(public_key_b64) if public_key_b64 else _unb64(get_signer().public_key_b64)
        key = Ed25519PublicKey.from_public_bytes(raw)
    except Exception as exc:  # noqa: BLE001
        return False, f"unusable public key: {exc}"

    payload = block.get("payload")
    signature = block.get("signature")
    if not payload or not signature:
        return False, "signature block is incomplete"
    if block.get("alg") != SIGNATURE_ALG:
        return False, f"unexpected algorithm {block.get('alg')!r}"

    try:
        key.verify(_unb64(signature), canonical_json(payload).encode())
    except InvalidSignature:
        return False, "signature does not match the payload — it was altered or forged"
    except Exception as exc:  # noqa: BLE001
        return False, f"verification error: {exc}"
    return True, "signature valid"
