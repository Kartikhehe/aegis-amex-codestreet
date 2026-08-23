"""Deleting a policy version, and the two cases where it must be refused.

A draft nobody has decided under is genuinely disposable -- the studio
accumulates experiments and there has to be a way to tidy them up. But a
ruleset that has ever judged a purchase is part of the audit trail: its hash is
recorded on every decision it made and in the ledger beside them. Delete it and
those records point at a ruleset that no longer exists, which is exactly the
question a dispute has to answer.

Demoting to draft must not become a way around that, which is why the check is
on decisions-under-the-hash rather than on the current stage alone.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from aegis.auth.security import hash_password
from aegis.db.immutability import install_orm_guards, install_sqlite_triggers
from aegis.db.models import Base, DecisionRow, Operator, PolicyVersion, User

THRESHOLDS = {
    "conformance_deny_floor": 0.45,
    "conformance_review_floor": 0.70,
    "conformance_marginal_floor": 0.85,
    "novel_merchant_check_enabled": True,
    "velocity_check_enabled": True,
}


@pytest.fixture
def client(monkeypatch, tmp_path):
    db_path = tmp_path / "policy.db"
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
        db.commit()

    from fastapi.testclient import TestClient

    from aegis.main import create_app

    test_client = TestClient(create_app())
    token = test_client.post(
        "/api/auth/login",
        json={"email": "operator@aegis.test", "password": "password123"},
    ).json()["token"]
    test_client.headers.update({"Authorization": f"Bearer {token}"})
    test_client.aegis_factory = factory
    yield test_client

    config.get_settings.cache_clear()
    session_mod._engine = None
    session_mod._SessionLocal = None


def make_policy(client, *, stage="draft", ruleset_hash="a" * 64, name="candidate"):
    with client.aegis_factory() as db:
        row = PolicyVersion(
            policy_id=f"pol_{name}",
            name=name,
            version=1,
            stage=stage,
            thresholds=THRESHOLDS,
            ruleset_hash=ruleset_hash,
            created_by="operator@aegis.test",
        )
        db.add(row)
        db.commit()
    return f"pol_{name}"


def add_decision_under(client, ruleset_hash):
    """One recorded decision attributed to this ruleset."""
    from datetime import datetime

    with client.aegis_factory() as db:
        db.add(
            DecisionRow(
                action_id="act_hist",
                agent_id="ag_1",
                operator_id="op_test",
                card_member_id="cm_1",
                verdict="ALLOW",
                reason_code="within_mandate",
                human_readable_reason="fixture",
                winning_rule="within_mandate",
                ruleset_hash=ruleset_hash,
                flagged=False,
                merchant_id="m_1",
                merchant_name="Fresh",
                merchant_category="5411",
                amount=Decimal("100"),
                currency="INR",
                cart_digest="c" * 64,
                prompt_hash="p" * 64,
                latency_ms=5,
                decided_at=datetime(2026, 8, 20, 12, 0),
            )
        )
        db.commit()


class TestADraftCanBeDiscarded:
    def test_deleting_an_unused_draft_succeeds(self, client):
        policy_id = make_policy(client)
        assert client.delete(f"/api/policy/{policy_id}").status_code == 204

    def test_it_is_actually_gone(self, client):
        policy_id = make_policy(client)
        client.delete(f"/api/policy/{policy_id}")
        assert client.delete(f"/api/policy/{policy_id}").status_code == 404

    def test_an_unknown_policy_is_a_404(self, client):
        assert client.delete("/api/policy/pol_nope").status_code == 404


class TestHistoryIsNotDeletable:
    @pytest.mark.parametrize("stage", ["shadow", "enforcing"])
    def test_a_live_policy_cannot_be_deleted(self, client, stage):
        policy_id = make_policy(client, stage=stage)
        response = client.delete(f"/api/policy/{policy_id}")
        assert response.status_code == 409
        assert stage in response.json()["detail"]

    def test_a_draft_with_decisions_cannot_be_deleted(self, client):
        """Demoting to draft must not become a way around the guard."""
        policy_id = make_policy(client, ruleset_hash="b" * 64)
        add_decision_under(client, "b" * 64)
        response = client.delete(f"/api/policy/{policy_id}")
        assert response.status_code == 409
        assert "audit trail" in response.json()["detail"]

    def test_the_refusal_says_how_much_history_there_is(self, client):
        """A number a reviewer can check beats a flat refusal."""
        policy_id = make_policy(client, ruleset_hash="c" * 64)
        add_decision_under(client, "c" * 64)
        assert "1 decision" in client.delete(f"/api/policy/{policy_id}").json()["detail"]

    def test_an_unrelated_hash_does_not_protect_a_draft(self, client):
        """The guard must key on THIS ruleset, not on any history existing."""
        policy_id = make_policy(client, ruleset_hash="d" * 64)
        add_decision_under(client, "e" * 64)  # a different ruleset
        assert client.delete(f"/api/policy/{policy_id}").status_code == 204


class TestOnlyOperatorsMayDelete:
    def test_an_unauthenticated_delete_is_refused(self, client):
        policy_id = make_policy(client)
        response = client.delete(
            f"/api/policy/{policy_id}", headers={"Authorization": ""}
        )
        assert response.status_code in (401, 403)
