"""FastAPI application.

Mounted at /api so Aurora's existing VITE_API_URL (http://localhost:8000/api)
works with no frontend change.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.demo import router as demo_router
from .api.routes import router
from .config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("aegis")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("AEGIS starting")
    logger.info("  scorer mode : %s (%s)", settings.resolved_scorer_mode, settings.scorer_model)
    logger.info("  database    : %s", settings.database_url.split("@")[-1])
    for warning in settings.validate():
        logger.warning("  ! %s", warning)

    # Fail loudly at boot, not on the first request. A database the service
    # cannot reach produces a 500 on /auth/login whose traceback is 200 lines
    # of SQLAlchemy internals and never names the actual cause.
    try:
        from sqlalchemy import text
        from .db.session import get_engine

        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
        logger.info("  database    : reachable")
    except Exception as exc:  # noqa: BLE001
        logger.error("  DATABASE UNREACHABLE: %s", str(exc).splitlines()[0])
        logger.error("  url: %s", settings.database_url)
        logger.error(
            "  If you meant to use the local demo database, either unset "
            "DATABASE_URL or set it to sqlite:///<abs path>/dev.db"
        )
        raise

    yield
    logger.info("AEGIS shutting down")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="AEGIS",
        version="1.0.0",
        summary="Agent governance: authorisation, delegation, and a provable audit trail.",
        description=(
            "AEGIS decides whether an autonomous agent may spend on a card member's "
            "account, and records every decision in an append-only hash-chained "
            "ledger.\n\n"
            "**Verdicts** are ALLOW, DENY, STEP_UP (needs the card member) and HOLD. "
            "Rules are evaluated in a fixed order and the first match wins, so every "
            "decision has exactly one reason.\n\n"
            "**Fail-closed:** if mandate conformance cannot be established, the engine "
            "returns STEP_UP. It never returns ALLOW on a scorer failure."
        ),
        lifespan=lifespan,
        openapi_tags=[
            {"name": "auth", "description": "Login and session."},
            {"name": "decide", "description": "Authorisation decisions and step-up resolution."},
            {"name": "agents", "description": "Agents, mandates and delegation."},
            {"name": "ledger", "description": "Hash-chain verification."},
            {"name": "policy", "description": "Policy versions, simulation and promotion."},
            {"name": "incidents", "description": "Circuit-breaker compliance events."},
            {"name": "disputes", "description": "Disputes and evidence packets."},
            {"name": "fleet", "description": "Emergency stop and fleet metrics."},
            {"name": "reference", "description": "Reference data."},
            {"name": "demo", "description": "DEMO ONLY. Disabled unless AEGIS_ENABLE_DEMO=true."},
        ],
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router, prefix="/api")
    if settings.enable_demo_endpoints:
        app.include_router(demo_router, prefix="/api")

    @app.get("/health", tags=["reference"])
    def health() -> dict[str, str]:
        return {"status": "ok", "scorer_mode": settings.resolved_scorer_mode}

    return app


app = create_app()
