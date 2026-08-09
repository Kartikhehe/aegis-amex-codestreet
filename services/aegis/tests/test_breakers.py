"""breakers.py -- trip conditions, injection labelling, correlated anomalies."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from aegis.engine.breakers import (
    BreakerConfig,
    BreakerType,
    ObservedDecision,
    Severity,
    evaluate_breakers,
    evaluate_correlated_anomaly,
)
from aegis.engine.types import Verdict, utcnow


def _obs(i, *, score=0.92, verdict=Verdict.ALLOW, minutes=5, known=True,
         merchant="mch_a", amount="500", agent="ag1", operator="op1", now=None):
    return ObservedDecision(
        action_id=f"act_{i}",
        agent_id=agent,
        operator_id=operator,
        verdict=verdict,
        conformance_score=score,
        merchant_id=merchant,
        merchant_known=known,
        amount=Decimal(amount),
        decided_at=(now or utcnow()) - timedelta(minutes=minutes),
    )


def _types(events):
    return {e.breaker for e in events}


def test_quiet_agent_trips_nothing():
    now = utcnow()
    rows = [_obs(i, minutes=5, now=now) for i in range(10)]
    assert evaluate_breakers("ag1", "op1", rows, now=now) == []


def test_below_min_samples_never_trips():
    """Two bad transactions is a decision problem, not a control problem."""
    now = utcnow()
    rows = [_obs(i, score=0.05, verdict=Verdict.DENY, minutes=5, now=now) for i in range(3)]
    assert evaluate_breakers("ag1", "op1", rows, now=now) == []


def test_denial_rate_breaker():
    now = utcnow()
    rows = [_obs(i, verdict=Verdict.DENY, score=0.8, minutes=5, now=now) for i in range(6)]
    rows += [_obs(100 + i, minutes=5, now=now) for i in range(6)]
    events = evaluate_breakers("ag1", "op1", rows, now=now)
    assert BreakerType.DENIAL_RATE in _types(events)
    event = next(e for e in events if e.breaker is BreakerType.DENIAL_RATE)
    assert event.evidence["denials"] == 6
    assert event.evidence["rate"] == 0.5


def test_conformance_collapse_is_labelled_suspected_prompt_injection():
    now = utcnow()
    healthy = [_obs(i, score=0.94, minutes=90, now=now) for i in range(10)]
    collapsed = [_obs(100 + i, score=0.18, minutes=5, now=now) for i in range(10)]
    events = evaluate_breakers("ag1", "op1", healthy + collapsed, now=now)

    event = next(e for e in events if e.breaker is BreakerType.CONFORMANCE_COLLAPSE)
    assert event.suspected_prompt_injection is True
    assert event.severity is Severity.CRITICAL
    assert event.title == "SUSPECTED PROMPT INJECTION"
    assert event.evidence["recent_mean"] < 0.55


def test_a_gradual_drift_within_the_band_does_not_trip_injection():
    now = utcnow()
    rows = [_obs(i, score=0.90, minutes=90, now=now) for i in range(10)]
    rows += [_obs(100 + i, score=0.82, minutes=5, now=now) for i in range(10)]
    events = evaluate_breakers("ag1", "op1", rows, now=now)
    assert BreakerType.CONFORMANCE_COLLAPSE not in _types(events)


def test_velocity_breaker_on_a_count_spike():
    now = utcnow()
    prior = [_obs(i, minutes=90, now=now) for i in range(3)]
    recent = [_obs(100 + i, minutes=5, now=now) for i in range(20)]
    events = evaluate_breakers("ag1", "op1", prior + recent, now=now)
    assert BreakerType.VELOCITY in _types(events)


def test_velocity_breaker_on_an_amount_spike():
    now = utcnow()
    prior = [_obs(i, amount="100", minutes=90, now=now) for i in range(10)]
    recent = [_obs(100 + i, amount="900", minutes=5, now=now) for i in range(10)]
    events = evaluate_breakers("ag1", "op1", prior + recent, now=now)
    assert BreakerType.VELOCITY in _types(events)


def test_novel_merchant_burst():
    now = utcnow()
    rows = [
        _obs(i, merchant=f"mch_new_{i}", known=False, minutes=5, now=now) for i in range(8)
    ]
    events = evaluate_breakers("ag1", "op1", rows, now=now)
    event = next(e for e in events if e.breaker is BreakerType.NOVEL_MERCHANT)
    assert event.evidence["count"] == 8


def test_breakers_only_see_their_own_agent():
    now = utcnow()
    rows = [_obs(i, verdict=Verdict.DENY, score=0.1, minutes=5, agent="other", now=now)
            for i in range(20)]
    assert evaluate_breakers("ag1", "op1", rows, now=now) == []


def test_events_are_serialisable():
    now = utcnow()
    rows = [_obs(i, verdict=Verdict.DENY, score=0.9, minutes=5, now=now) for i in range(10)]
    for event in evaluate_breakers("ag1", "op1", rows, now=now):
        data = event.to_dict()
        assert data["breaker"] and data["severity"] and data["created_at"]


# ---------------------------------------------------------------------------
# Correlated anomaly -- points at the operator's stack, not one agent
# ---------------------------------------------------------------------------


def test_correlated_anomaly_across_an_operator_fleet():
    now = utcnow()
    rows = []
    for agent in ("ag1", "ag2", "ag3", "ag4"):
        rows += [_obs(f"{agent}_{i}", score=0.20, minutes=5, agent=agent, now=now)
                 for i in range(5)]
    event = evaluate_correlated_anomaly("op1", rows, now=now)
    assert event is not None
    assert event.breaker is BreakerType.CORRELATED_ANOMALY
    assert len(event.evidence["degraded_agents"]) == 4
    assert event.suspected_prompt_injection is False


def test_one_bad_agent_is_not_a_correlated_anomaly():
    now = utcnow()
    rows = [_obs(i, score=0.10, minutes=5, agent="ag1", now=now) for i in range(10)]
    rows += [_obs(100 + i, score=0.95, minutes=5, agent="ag2", now=now) for i in range(10)]
    assert evaluate_correlated_anomaly("op1", rows, now=now) is None


def test_correlated_anomaly_scopes_to_one_operator():
    now = utcnow()
    rows = []
    for agent in ("x1", "x2", "x3"):
        rows += [_obs(f"{agent}_{i}", score=0.1, minutes=5, agent=agent,
                      operator="op_other", now=now) for i in range(5)]
    assert evaluate_correlated_anomaly("op1", rows, now=now) is None
