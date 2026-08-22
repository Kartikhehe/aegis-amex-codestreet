"""The migrations must describe the same schema as the ORM models.

Day-to-day development runs on SQLite through ``create_all``, which builds
whatever the models declare and never consults the migrations. So a column can
be added to a model, work perfectly for weeks, and then fail the first time
anyone points the app at Postgres -- which is exactly how ``seed_corpus`` and
the three block-report columns went missing from ``0001_initial``.

This test closes that gap by building a schema from the migrations alone and
diffing it against the models. It runs on SQLite, so it needs no server.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from aegis.config import get_settings

from aegis.db.models import Base

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def migrated_engine(tmp_path, monkeypatch):
    """A database built only by running the migrations.

    ``alembic/env.py`` reads the URL from settings rather than from the config
    object, so pointing this at a scratch file means setting the environment and
    clearing the settings cache -- otherwise the upgrade runs against the shared
    development database and fails on tables that already exist.
    """
    url = f"sqlite:///{tmp_path / 'migrated.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()

    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    command.upgrade(cfg, "head")

    engine = create_engine(url)
    yield engine
    engine.dispose()
    get_settings.cache_clear()


def test_migrations_create_every_model_table(migrated_engine):
    live = set(inspect(migrated_engine).get_table_names())
    missing = sorted(set(Base.metadata.tables) - live)
    assert not missing, f"tables declared on models but never migrated: {missing}"


def test_migrations_create_every_model_column(migrated_engine):
    """Every column on every model must exist in the migrated schema.

    Extra columns in the database are tolerated -- those are columns a model
    dropped without a migration to remove them, which is not a crash. A column
    the model expects and the database lacks IS a crash, on first write.
    """
    inspector = inspect(migrated_engine)
    live_tables = set(inspector.get_table_names())

    drift: dict[str, list[str]] = {}
    for name, table in Base.metadata.tables.items():
        if name not in live_tables:
            continue  # covered by the table test above
        live = {c["name"] for c in inspector.get_columns(name)}
        missing = [c.name for c in table.columns if c.name not in live]
        if missing:
            drift[name] = missing

    assert not drift, f"columns on models but not in any migration: {drift}"
