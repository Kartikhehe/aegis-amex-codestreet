"""The fleet overview must not change on its own.

The user reported three separate times that the dashboard numbers moved by
themselves, and three times I checked the seed, saw a fixed dataset, and told
them the data was static. Both halves of that were true and the conclusion was
still wrong: the window was anchored to `utcnow()`, so a fixed dataset queried
through a sliding window is not a fixed result.

Measured before the fix, on a corpus whose newest decision was 28 hours old:
the 24-hour window held 39 of 8,332 rows -- almost none of them seeded traffic
-- and reported a 28% block rate against a true corpus rate of 2.9%, moving by
whole points every few hours as individual rows fell out of range.

These tests exist because nothing here compared two responses taken at
different wall-clock times. That is the only check that would have caught it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from aegis.auth.security import hash_password
from aegis.db.immutability import install_orm_guards, install_sqlite_triggers
from aegis.db.models import AgentRow, Base, DecisionRow, Operator, User

# A fixed instant to anchor the fixture data to, so nothing here depends on
# when the suite runs.
SEEDED_NOW = datetime(2026, 8, 23, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def client(monkeypatch, tmp_path):
    """An app whose decisions all sit in the past, like a real seeded corpus."""
    db_path = tmp_path / "overview.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("AEGIS_SCORER_MODE", "off")

    import aegis.config as config
    import aegis.db.session as session_mod
    import aegis.scoring as scoring

    config.get_settings.cache_clear()
    scoring.get_conformance_engine.cache_clear()
    scoring.get_idempotency_store.cache_clear()
    scoring.get_rate_limiter.cache_clear()
    scoring._redis_client.cache_clear()
    session_mod._engine = None
    session_mod._SessionLocal = None

    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    install_orm_guards()
    install_sqlite_triggers(engine)

    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    with factory() as db:
        db.add(Operator(operator_id="op_test", name="Test Operator"))
        db.add(
            User(
                user_id="usr_op",
                email="operator@aegis.test",
                name="Operator",
                password_hash=hash_password("password123"),
                role="operator",
            )
        )
        db.add(
            AgentRow(
                agent_id="ag_test",
                operator_id="op_test",
                card_member_id="cm_test",
                name="Test agent",
                depth=0,
                status="active",
                purpose="groceries",
                permitted_categories=["5411"],
                prohibited_attributes=["gift_card"],
                per_transaction_ceiling=Decimal("5000"),
                daily_ceiling=Decimal("50000"),
                max_transactions_per_day=500,
                max_delegation_depth=2,
                mandate_hash="a" * 64,
            )
        )

        # 200 decisions over 20 hours, ending 2 hours before SEEDED_NOW: a
        # 5% block rate, spread so a 24-hour window contains all of them.
        for i in range(200):
            when = SEEDED_NOW - timedelta(hours=2) - timedelta(minutes=6 * i)
            deny = i % 20 == 0  # exactly 10 of 200
            db.add(
                DecisionRow(
                    action_id=f"act_{i:04d}",
                    agent_id="ag_test",
                    operator_id="op_test",
                    card_member_id="cm_test",
                    verdict="DENY" if deny else "ALLOW",
                    reason_code="ship_to_mismatch" if deny else "within_mandate",
                    human_readable_reason="fixture",
                    winning_rule="fixture",
                    ruleset_hash="r" * 64,
                    flagged=False,
                    merchant_id="m_fresh",
                    merchant_name="Fresh",
                    merchant_category="5411",
                    amount=Decimal("100"),
                    currency="INR",
                    cart_digest="c" * 64,
                    prompt_hash="p" * 64,
                    seed_legitimate=True,
                    seed_kind="in_purpose_normal",
                    latency_ms=10,
                    decided_at=when.replace(tzinfo=None),
                )
            )
        db.commit()

    from aegis.main import create_app

    test_client = TestClient(create_app())
    token = test_client.post(
        "/api/auth/login",
        json={"email": "operator@aegis.test", "password": "password123"},
    ).json()["token"]
    test_client.headers.update({"Authorization": f"Bearer {token}"})
    yield test_client

    config.get_settings.cache_clear()
    session_mod._engine = None
    session_mod._SessionLocal = None


from fastapi.testclient import TestClient  # noqa: E402  (after fixture deps)


def _overview(client, at, hours=24):
    """Fetch the overview as if the wall clock read `at`."""
    with patch("aegis.api.routes.utcnow", return_value=at):
        response = client.get(f"/api/overview?hours={hours}")
    assert response.status_code == 200
    return response.json()


def _decisions(payload):
    return next(t["value"] for t in payload["tiles"] if t["key"] == "decisions")


class TestTheNumbersHoldStill:
    """The regression itself: same data, different clock, same answer."""

    def test_block_rate_is_identical_three_months_later(self, client):
        first = _overview(client, SEEDED_NOW)
        later = _overview(client, SEEDED_NOW + timedelta(days=90))
        assert first["block_rate"] == later["block_rate"]
        assert _decisions(first) == _decisions(later)

    @pytest.mark.parametrize("hours_later", [1, 6, 24, 72, 240, 720, 2160])
    def test_no_tile_moves_as_the_clock_advances(self, client, hours_later):
        first = _overview(client, SEEDED_NOW)
        later = _overview(client, SEEDED_NOW + timedelta(hours=hours_later))
        assert {t["key"]: t["value"] for t in first["tiles"]} == {
            t["key"]: t["value"] for t in later["tiles"]
        }

    def test_the_window_does_not_empty_out(self, client):
        """The old failure mode: eventually every tile read zero."""
        much_later = _overview(client, SEEDED_NOW + timedelta(days=365))
        assert _decisions(much_later) == 200

    def test_derived_rates_are_stable_too(self, client):
        """Rates are the numbers people quote, so they matter most."""
        first = _overview(client, SEEDED_NOW)
        later = _overview(client, SEEDED_NOW + timedelta(days=30))
        for key in (
            "block_rate",
            "false_block_rate",
            "reported_false_block_rate",
            "step_up_approval_rate",
        ):
            assert first[key] == later[key], key


class TestTheWindowIsHonestAboutItself:
    def test_data_as_of_reports_the_newest_decision(self, client):
        payload = _overview(client, SEEDED_NOW)
        # Newest fixture decision is 2 hours before SEEDED_NOW.
        assert payload["data_as_of"].startswith("2026-08-23T10:00")

    def test_window_start_is_hours_before_the_newest_decision(self, client):
        payload = _overview(client, SEEDED_NOW, hours=24)
        assert payload["window_start"].startswith("2026-08-22T10:00")

    def test_data_as_of_does_not_follow_the_clock(self, client):
        first = _overview(client, SEEDED_NOW)
        later = _overview(client, SEEDED_NOW + timedelta(days=10))
        assert first["data_as_of"] == later["data_as_of"]


class TestTheRateIsStillMeasuredCorrectly:
    """Stability is worthless if the number it holds still at is wrong."""

    def test_block_rate_matches_the_fixture(self, client):
        payload = _overview(client, SEEDED_NOW)
        assert _decisions(payload) == 200
        assert payload["block_rate"] == pytest.approx(10 / 200)

    def test_a_narrower_window_sees_fewer_decisions(self, client):
        """Anchoring must not collapse the window into "everything"."""
        narrow = _overview(client, SEEDED_NOW, hours=2)
        wide = _overview(client, SEEDED_NOW, hours=24)
        assert _decisions(narrow) < _decisions(wide)
