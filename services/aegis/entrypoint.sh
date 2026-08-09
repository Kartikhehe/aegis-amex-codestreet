#!/usr/bin/env bash
# Bring the service up: migrate, seed if the database is empty, then serve.
set -euo pipefail

echo "[aegis] running migrations"
alembic upgrade head

if [ "${AEGIS_SEED_ON_BOOT:-true}" = "true" ]; then
  # Seed only when there is nothing there. Re-seeding a populated database
  # would destroy a ledger someone may be mid-demo on.
  if python -c "
import sys
from sqlalchemy import func, select
from aegis.db.models import DecisionRow
from aegis.db.session import get_session_factory
session = get_session_factory()()
count = session.scalar(select(func.count(DecisionRow.action_id))) or 0
session.close()
sys.exit(0 if count == 0 else 1)
"; then
    echo "[aegis] empty database -- seeding ${AEGIS_SEED_ACTIONS:-25000} actions through the real engine"
    python -m aegis.seed.run --actions "${AEGIS_SEED_ACTIONS:-25000}"
  else
    echo "[aegis] database already populated -- skipping seed"
  fi
fi

echo "[aegis] starting API on :8000"
exec uvicorn aegis.main:app --host 0.0.0.0 --port 8000 --workers "${AEGIS_WORKERS:-2}"
