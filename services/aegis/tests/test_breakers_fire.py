"""Every breaker condition must actually fire.

Written after an audit found two that appeared dead. They were not -- the test
had placed the baseline outside the comparison window -- but the audit did
surface a real gap: the relative velocity check needs a preceding window, so a
brand-new or long-idle agent was never velocity-checked at all.

The window arithmetic is the subtle part and the reason these tests exist:
`recent` is the last `window_minutes`, and `prior` is the window immediately
before that. A baseline placed anywhere else is invisible.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from aegis.engine.breakers import (
    BreakerConfig,
    BreakerType,
    ObservedDecision,
    evaluate_breakers,
    evaluate_correlated_anomaly,
)
from aegis.engine.types import Verdict

NOW = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)
CFG = BreakerConfig()


def obs(
    n,
    *,
    verdict=Verdict.ALLOW,
    score=0.9,
    minutes_ago=5,
    merchant="mch_a",
    agent="ag_1",
    amount="500",
    known=True,
):
    return [
        ObservedDecision(
            action_id=f"{agent}-{merchant}-{minutes_ago}-{i}",
            agent_id=agent,
            operator_id="op_1",
            verdict=verdict,
            conformance_score=score,
            merchant_id=merchant,
            merchant_known=known,
            amount=Decimal(amount),
            decided_at=NOW - timedelta(minutes=minutes_ago),
        )
        for i in range(n)
    ]


def fired(events):
    return {e.breaker for e in events}


# The baseline window is the one immediately before the current one, i.e.
# window_minutes..window_minutes*2 ago. 90 minutes sits inside it for the
# default 60-minute window.
BASELINE_AGO = 90
RECENT_AGO = 5


class TestEachBreakerFires:
    def test_velocity_on_a_count_spike(self):
        events = evaluate_breakers(
            "ag_1",
            "op_1",
            obs(4, minutes_ago=BASELINE_AGO) + obs(30, minutes_ago=RECENT_AGO),
            now=NOW,
            config=CFG,
        )
        assert BreakerType.VELOCITY in fired(events)

    def test_velocity_on_an_amount_spike(self):
        events = evaluate_breakers(
            "ag_1",
            "op_1",
            obs(10, minutes_ago=BASELINE_AGO, amount="100")
            + obs(10, minutes_ago=RECENT_AGO, amount="9000"),
            now=NOW,
            config=CFG,
        )
        assert BreakerType.VELOCITY in fired(events)

    def test_denial_rate(self):
        events = evaluate_breakers(
            "ag_1", "op_1", obs(12, verdict=Verdict.DENY), now=NOW, config=CFG
        )
        assert BreakerType.DENIAL_RATE in fired(events)

    def test_conformance_collapse_on_the_absolute_floor(self):
        events = evaluate_breakers("ag_1", "op_1", obs(12, score=0.2), now=NOW, config=CFG)
        assert BreakerType.CONFORMANCE_COLLAPSE in fired(events)

    def test_conformance_collapse_on_a_drop(self):
        """A healthy agent turning is the prompt-injection signature."""
        events = evaluate_breakers(
            "ag_1",
            "op_1",
            obs(10, score=0.95, minutes_ago=BASELINE_AGO)
            + obs(10, score=0.6, minutes_ago=RECENT_AGO),
            now=NOW,
            config=CFG,
        )
        assert BreakerType.CONFORMANCE_COLLAPSE in fired(events)

    def test_novel_merchant_burst(self):
        rows = []
        for i in range(7):
            rows += obs(2, merchant=f"mch_new{i}", known=False)
        events = evaluate_breakers("ag_1", "op_1", rows, now=NOW, config=CFG)
        assert BreakerType.NOVEL_MERCHANT in fired(events)

    def test_correlated_anomaly_across_agents(self):
        rows = []
        for agent in ("ag_1", "ag_2", "ag_3", "ag_4"):
            rows += obs(10, agent=agent, verdict=Verdict.DENY)
        event = evaluate_correlated_anomaly("op_1", rows, now=NOW, config=CFG)
        assert event is not None
        assert event.breaker is BreakerType.CORRELATED_ANOMALY


class TestTheVelocityBlindSpot:
    """The gap the audit found: no baseline meant no velocity check at all."""

    def test_a_new_agent_with_no_baseline_is_still_capped(self):
        events = evaluate_breakers(
            "ag_1", "op_1", obs(CFG.absolute_txn_cap + 15), now=NOW, config=CFG
        )
        assert BreakerType.VELOCITY in fired(events)

    def test_the_absolute_cap_names_its_basis(self):
        events = evaluate_breakers(
            "ag_1", "op_1", obs(CFG.absolute_txn_cap + 15), now=NOW, config=CFG
        )
        velocity = next(e for e in events if e.breaker is BreakerType.VELOCITY)
        assert velocity.evidence["prior_count"] == 0
        assert "absolute" in velocity.evidence["basis"]

    def test_a_normal_busy_hour_does_not_trip(self):
        """The cap must sit far above legitimate behaviour."""
        events = evaluate_breakers("ag_1", "op_1", obs(12), now=NOW, config=CFG)
        assert BreakerType.VELOCITY not in fired(events)

    def test_the_cap_is_above_every_seeded_daily_limit(self):
        from aegis.seed import distribution as dist

        highest = max(c.max_transactions_per_day for c in dist.MANDATE_CLASSES)
        assert CFG.absolute_txn_cap > highest


class TestGuards:
    def test_too_few_samples_never_trips(self):
        """One denied second purchase must not read as a 50% denial rate."""
        events = evaluate_breakers(
            "ag_1", "op_1", obs(2, verdict=Verdict.DENY), now=NOW, config=CFG
        )
        assert events == []

    def test_activity_outside_the_window_is_ignored(self):
        events = evaluate_breakers(
            "ag_1", "op_1", obs(40, minutes_ago=600), now=NOW, config=CFG
        )
        assert events == []

    def test_another_agents_activity_is_ignored(self):
        events = evaluate_breakers(
            "ag_1", "op_1", obs(30, agent="ag_other", verdict=Verdict.DENY), now=NOW, config=CFG
        )
        assert events == []
