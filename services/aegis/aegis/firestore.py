"""Firestore as the live data layer.

AEGIS keeps two stores, and the split is deliberate rather than incidental:

  **SQL owns the ledger.** Tamper-evidence rests on the database itself
  refusing UPDATE and DELETE -- Postgres triggers plus REVOKE, verified by
  tests that attack the table through raw SQL. Firestore has no equivalent:
  security rules govern *client* writes, but the Admin SDK bypasses rules
  entirely and there are no triggers. Moving the ledger there would quietly
  downgrade the one guarantee the product is built on, so it stays put.

  **Firestore owns everything the console reads.** Agents, mandates, merchants,
  decisions, incidents and disputes are mirrored here, where the frontend can
  subscribe to them directly and get real-time updates without polling.

MIRRORING IS BEST-EFFORT, ALWAYS. Every write is wrapped. A Firestore outage
degrades the console to REST polling; it must never be able to fail a payment
authorisation. The SQL write happens first and is the source of truth; the
mirror is a courtesy afterwards.

Configuration:

    FIREBASE_ENABLED=true
    GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
    FIREBASE_PROJECT_ID=aegis-6f60f          # optional, read from the key
    FIRESTORE_EMULATOR_HOST=localhost:8080   # optional, for local dev

With FIREBASE_ENABLED unset the whole module is inert and the system behaves
exactly as it did before -- which is what keeps the tests hermetic.
"""

from __future__ import annotations

import logging
import os
from decimal import Decimal
from functools import lru_cache
from typing import Any, Iterable, Optional

from .config import get_settings

logger = logging.getLogger(__name__)

# Collection names. Kept here so the frontend security rules and the backend
# cannot drift on a typo.
COLLECTIONS = {
    "agents": "agents",
    "decisions": "decisions",
    "merchants": "merchants",
    "operators": "operators",
    "incidents": "incidents",
    "disputes": "disputes",
    "fleet": "fleet_state",
    "policies": "policies",
}


def _to_firestore(value: Any) -> Any:
    """Convert engine values into types Firestore accepts.

    Decimal is the one that matters: Firestore has no decimal type, and
    float(Decimal) would silently introduce rounding into money. Amounts are
    stored as STRINGS to preserve exactness, with a parallel `*_numeric` field
    where the console needs to sort or aggregate.
    """
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {k: _to_firestore(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_to_firestore(v) for v in value]
    return value


class FirestoreMirror:
    """Writes the queryable projection to Firestore. Never raises."""

    def __init__(self, client: Any = None, enabled: bool = False) -> None:
        self._client = client
        self.enabled = enabled and client is not None

    # -- writes ------------------------------------------------------------

    def _set(self, collection: str, doc_id: str, payload: dict[str, Any]) -> bool:
        if not self.enabled:
            return False
        try:
            self._client.collection(COLLECTIONS[collection]).document(doc_id).set(
                _to_firestore(payload), merge=True
            )
            return True
        except Exception:  # noqa: BLE001
            # Best-effort by design. The console falls back to REST; nothing
            # about the decision itself is affected.
            logger.warning("firestore mirror failed for %s/%s", collection, doc_id, exc_info=True)
            return False

    @staticmethod
    def decision_payload(row: Any) -> dict[str, Any]:
        """One decision, as the console needs to render it."""
        return {
            "action_id": row.action_id,
            "agent_id": row.agent_id,
            "operator_id": row.operator_id,
            "card_member_id": row.card_member_id,
            "verdict": row.verdict,
            "reason_code": row.reason_code,
            "human_readable_reason": row.human_readable_reason,
            "winning_rule": row.winning_rule,
            "ruleset_hash": row.ruleset_hash,
            "flagged": bool(row.flagged),
            "merchant_id": row.merchant_id,
            "merchant_name": row.merchant_name,
            "merchant_category": row.merchant_category,
            "merchant_attributes": row.merchant_attributes or [],
            "cart_items": row.cart_items or [],
            "cart_digest": row.cart_digest or "",
            "ship_to": row.ship_to,
            "injected_instruction": row.injected_instruction,
            "amount": str(row.amount),
            "amount_numeric": float(row.amount),  # for ordering only
            "currency": row.currency,
            "description": row.description or "",
            "conformance_score": (
                float(row.conformance_score) if row.conformance_score is not None else None
            ),
            "conformance_available": bool(row.conformance_available),
            "conformance_rationale": row.conformance_rationale or "",
            "model_version": row.model_version or "",
            "delegation_chain": row.delegation_chain or [],
            "step_up_state": row.step_up_state,
            "latency_ms": row.latency_ms or 0,
            "decided_at": row.decided_at,
            "seed_kind": row.seed_kind,
            "seed_legitimate": row.seed_legitimate,
        }

    def mirror_decision(self, row: Any) -> bool:
        return self._set("decisions", row.action_id, self.decision_payload(row))

    @staticmethod
    def agent_payload(row: Any) -> dict[str, Any]:
        return {
            "agent_id": row.agent_id,
            "operator_id": row.operator_id,
            "card_member_id": row.card_member_id,
            "principal_id": row.principal_id or "",
            "name": row.name,
            "parent_agent_id": row.parent_agent_id,
            "depth": row.depth,
            "status": row.status,
            "breaker_tripped": bool(row.breaker_tripped),
            "mandate": {
                "purpose": row.purpose,
                "permitted_categories": row.permitted_categories or [],
                "prohibited_attributes": row.prohibited_attributes or [],
                "purpose_keywords": row.purpose_keywords or [],
                "ship_to": row.ship_to,
                "cadence": row.cadence,
                "per_transaction_ceiling": str(row.per_transaction_ceiling),
                "daily_ceiling": str(row.daily_ceiling),
                "max_transactions_per_day": row.max_transactions_per_day,
                "max_delegation_depth": row.max_delegation_depth,
                "expires_at": row.mandate_expires_at,
                "mandate_hash": row.mandate_hash,
            },
            "created_at": row.created_at,
        }

    def mirror_agent(self, row: Any) -> bool:
        return self._set("agents", row.agent_id, self.agent_payload(row))

    def mirror_merchant(self, row: Any) -> bool:
        return self._set(
            "merchants",
            row.merchant_id,
            {
                "merchant_id": row.merchant_id,
                "name": row.name,
                "category": row.category,
                "attributes": row.attributes or [],
            },
        )

    def mirror_operator(self, row: Any) -> bool:
        return self._set(
            "operators",
            row.operator_id,
            {"operator_id": row.operator_id, "name": row.name, "revoked": bool(row.revoked)},
        )

    def mirror_incident(self, row: Any) -> bool:
        return self._set(
            "incidents",
            row.event_id,
            {
                "event_id": row.event_id,
                "breaker": row.breaker,
                "agent_id": row.agent_id,
                "operator_id": row.operator_id,
                "severity": row.severity,
                "title": row.title,
                "detail": row.detail or "",
                "evidence": row.evidence or {},
                "suspected_prompt_injection": bool(row.suspected_prompt_injection),
                "acknowledged": bool(row.acknowledged),
                "created_at": row.created_at,
            },
        )

    def mirror_fleet_state(self, row: Any) -> bool:
        return self._set(
            "fleet",
            "current",
            {
                "stopped": bool(row.stopped),
                "stopped_by": row.stopped_by,
                "stopped_at": row.stopped_at,
                "stop_reason": row.stop_reason or "",
                "rearm_approvals": row.rearm_approvals or [],
            },
        )

    # -- bulk --------------------------------------------------------------

    def mirror_many(self, kind: str, rows: Iterable[Any], id_attr: str) -> int:
        """Batched write, for seeding. Firestore caps a batch at 500 writes."""
        if not self.enabled:
            return 0

        builder = {
            "decisions": self.decision_payload,
            "agents": self.agent_payload,
        }.get(kind)
        if builder is None:
            raise ValueError(f"no bulk payload builder for {kind!r}")

        written = 0
        try:
            batch = self._client.batch()
            pending = 0
            for row in rows:
                doc = self._client.collection(COLLECTIONS[kind]).document(getattr(row, id_attr))
                batch.set(doc, _to_firestore(builder(row)), merge=True)
                pending += 1
                written += 1
                if pending >= 450:  # headroom under the 500 cap
                    batch.commit()
                    batch = self._client.batch()
                    pending = 0
            if pending:
                batch.commit()
        except Exception:  # noqa: BLE001
            logger.warning("firestore bulk mirror failed after %d rows", written, exc_info=True)
        return written


# ---------------------------------------------------------------------------
# Client construction
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def get_mirror() -> FirestoreMirror:
    """Build the mirror once. Returns an inert mirror if Firebase is not set up.

    Failing to reach Firebase is a WARNING, never an error: the system is fully
    functional without it, and a demo that cannot start because a cloud service
    is unreachable is a worse demo.
    """
    settings = get_settings()
    if not settings.firebase_enabled:
        logger.info("firestore mirror: disabled (FIREBASE_ENABLED is not set)")
        return FirestoreMirror(enabled=False)

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            key_path = settings.google_application_credentials
            if key_path and os.path.exists(key_path):
                cred = credentials.Certificate(key_path)
                firebase_admin.initialize_app(cred)
                logger.info("firestore mirror: service account %s", key_path)
            else:
                # Application Default Credentials, or the emulator.
                firebase_admin.initialize_app()
                logger.info("firestore mirror: application default credentials")

        client = firestore.client()
        logger.info("firestore mirror: ENABLED (project %s)", settings.firebase_project_id or "?")
        return FirestoreMirror(client=client, enabled=True)

    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "firestore mirror unavailable (%s). The system runs normally; the "
            "console will fall back to REST polling.",
            exc,
        )
        return FirestoreMirror(enabled=False)


# ---------------------------------------------------------------------------
# Custom tokens
# ---------------------------------------------------------------------------


def mint_custom_token(user_id: str, role: str, operator_id: Optional[str],
                      card_member_id: Optional[str]) -> Optional[str]:
    """Mint a Firebase token carrying the SAME claims as the AEGIS JWT.

    This is what makes the Firestore security rules meaningful. The rules read
    `request.auth.token.role` / `.operator_id` / `.card_member_id`, so those
    claims must be set by something the client cannot influence -- the backend,
    at sign-in, from the user record it just authenticated.

    Returns None when Firebase is not configured, and the console then simply
    uses REST. A missing live feed is a degraded console; a forged claim would
    be a broken access-control boundary, so this never guesses.
    """
    settings = get_settings()
    if not settings.firebase_enabled:
        return None

    try:
        import firebase_admin
        from firebase_admin import auth as fb_auth

        if not firebase_admin._apps:
            get_mirror()  # initialises the default app as a side effect
        if not firebase_admin._apps:
            return None

        claims = {"role": role}
        if operator_id:
            claims["operator_id"] = operator_id
        if card_member_id:
            claims["card_member_id"] = card_member_id

        return fb_auth.create_custom_token(user_id, claims).decode("utf-8")
    except Exception:  # noqa: BLE001
        logger.warning("could not mint a Firebase custom token", exc_info=True)
        return None
