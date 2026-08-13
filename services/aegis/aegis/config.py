"""Runtime configuration.

Every value has a working default so `docker-compose up` needs no manual
setup. The two that matter in production -- JWT_SECRET and OPENAI_API_KEY --
are validated at startup rather than at first use, so a misconfiguration
surfaces as a boot failure instead of a mid-flight fail-closed STEP_UP storm.
"""

from __future__ import annotations

import os
from pathlib import Path
from dataclasses import dataclass, field
from functools import lru_cache


# A development-only default. It is >= 32 bytes so HS256 is used correctly even
# locally; `validate()` still warns loudly that it must be replaced in any
# deployed environment.
DEV_JWT_SECRET = "aegis-development-secret-do-not-use-in-production-0000"


def _default_database_url() -> str:
    """Where to look when DATABASE_URL is not set.

    Defaults to the local SQLite demo database, NOT Postgres. A Postgres
    default meant that forgetting the env var pointed the service at a server
    that may not exist -- or worse, at an unrelated Postgres already running on
    5432, which fails with an authentication error that says nothing about the
    real mistake. The file the developer actually has is the safer default.

    Docker Compose and every deployment set DATABASE_URL explicitly, so this
    only ever applies to someone running uvicorn by hand.
    """
    here = Path(__file__).resolve().parent.parent  # services/aegis
    return f"sqlite:///{here / 'dev.db'}"


def _bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: os.environ.get("DATABASE_URL", _default_database_url())
    )
    redis_url: str = field(
        default_factory=lambda: os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    )

    # --- auth -------------------------------------------------------------
    jwt_secret: str = field(
        default_factory=lambda: os.environ.get("JWT_SECRET", DEV_JWT_SECRET)
    )
    jwt_algorithm: str = "HS256"
    jwt_ttl_seconds: int = field(
        default_factory=lambda: int(os.environ.get("JWT_TTL_SECONDS", 60 * 60 * 12))
    )

    # --- scorer -----------------------------------------------------------
    openai_api_key: str = field(default_factory=lambda: os.environ.get("OPENAI_API_KEY", ""))
    scorer_model: str = field(
        default_factory=lambda: os.environ.get("AEGIS_SCORER_MODEL", "gpt-4.1-mini")
    )
    scorer_timeout_seconds: float = field(
        default_factory=lambda: float(os.environ.get("AEGIS_SCORER_TIMEOUT", "4.0"))
    )
    scorer_mode: str = field(
        default_factory=lambda: os.environ.get("AEGIS_SCORER_MODE", "auto")
    )
    """auto | live | replay | off.

    auto   -- live when OPENAI_API_KEY is present, replay otherwise
    live   -- always call the API (fails closed if unreachable)
    replay -- serve recorded real scores from the frozen fixture
    off    -- scorer permanently unavailable; exercises the fail-closed path
    """

    scorer_fixture_path: str = field(
        default_factory=lambda: os.environ.get(
            "AEGIS_SCORER_FIXTURE", "aegis/seed/conformance_fixture.json"
        )
    )

    # --- Firebase / Firestore (see firestore.py) --------------------------
    firebase_enabled: bool = field(default_factory=lambda: _bool("FIREBASE_ENABLED", False))
    """Off by default. The system is fully functional without Firestore; the
    mirror only changes how the console receives data."""

    firebase_project_id: str = field(
        default_factory=lambda: os.environ.get("FIREBASE_PROJECT_ID", "")
    )
    google_application_credentials: str = field(
        default_factory=lambda: os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    )

    # --- ACE provider seams (see providers.py) ----------------------------
    providers: str = field(default_factory=lambda: os.environ.get("AEGIS_PROVIDERS", "sim"))
    """sim | ace. `sim` reads the local registry; `ace` calls Amex's services."""

    ace_base_url: str = field(
        default_factory=lambda: os.environ.get(
            "ACE_BASE_URL", "https://api.americanexpress.com/ace/v1"
        )
    )
    ace_api_key: str = field(default_factory=lambda: os.environ.get("ACE_API_KEY", ""))

    # --- limits -----------------------------------------------------------
    decide_rate_limit_per_minute: int = field(
        default_factory=lambda: int(os.environ.get("AEGIS_DECIDE_RATE_LIMIT", "120"))
    )
    """Per-agent ceiling on /decide. A runaway agent must not be able to flood
    the gate; the limit is per agent so one bad actor cannot starve the rest."""

    # --- demo -------------------------------------------------------------
    enable_demo_endpoints: bool = field(default_factory=lambda: _bool("AEGIS_ENABLE_DEMO", False))
    """Gates the ledger tamper endpoint. MUST stay false outside a demo."""

    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.environ.get(
                "AEGIS_CORS_ORIGINS",
                # 5002 console · 5003 card member · 5004 agent simulator
                "http://localhost:5002,http://localhost:5003,"
                "http://localhost:5004,http://localhost:5173",
            ).split(",")
            if o.strip()
        )
    )

    @property
    def resolved_scorer_mode(self) -> str:
        if self.scorer_mode != "auto":
            return self.scorer_mode
        return "live" if self.openai_api_key else "replay"

    def validate(self) -> list[str]:
        """Return warnings a human should see at boot. Never raises."""
        warnings: list[str] = []
        if self.jwt_secret == DEV_JWT_SECRET:
            warnings.append(
                "JWT_SECRET is the development default. Set a real secret before deploying."
            )
        if self.resolved_scorer_mode == "live" and not self.openai_api_key:
            warnings.append(
                "scorer_mode=live but OPENAI_API_KEY is empty: every scored decision "
                "will fail closed to STEP_UP."
            )
        if self.resolved_scorer_mode == "replay":
            warnings.append(
                "Conformance scorer is in REPLAY mode: serving recorded scores from "
                f"{self.scorer_fixture_path}. Set OPENAI_API_KEY for live scoring."
            )
        if self.providers == "ace" and not self.ace_api_key:
            warnings.append(
                "AEGIS_PROVIDERS=ace but ACE_API_KEY is empty: every identity and "
                "mandate lookup will fail closed."
            )
        if self.firebase_enabled and not (
            self.google_application_credentials or os.environ.get("FIRESTORE_EMULATOR_HOST")
        ):
            warnings.append(
                "FIREBASE_ENABLED=true but no GOOGLE_APPLICATION_CREDENTIALS and no "
                "emulator host: the Firestore mirror will stay disabled and the "
                "console will fall back to REST polling."
            )
        if self.enable_demo_endpoints:
            warnings.append(
                "DEMO ENDPOINTS ARE ENABLED. /demo/tamper can corrupt the ledger. "
                "Never enable this in production."
            )
        return warnings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
