"""What a candidate policy would change, and whether that change is good.

Two counts -- how many more get blocked, how many more get through -- cannot
answer the only question that matters when promoting a policy: does it stop
things that should be stopped, or does it stop a card member's real groceries?
These tests cover the classification that makes the difference visible.

The severity ranking is the load-bearing part. Comparing verdicts against ALLOW
alone missed the most common useful change a policy makes: relaxing the deny
floor turns a flat refusal into a step-up, so the member is asked rather than
refused. That is a genuine improvement, and the old comparison reported it as
no change at all -- a candidate that cleared four confirmed false blocks
showed a blast radius of zero.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from aegis.service import _VERDICT_SEVERITY, _impact_summary


class FakeDecision:
    """Just enough of a Decision for _delta_row."""

    def __init__(self, verdict, reason="within_mandate", rule="within_mandate"):
        self.verdict = type("V", (), {"value": verdict})()
        self.reason_code = type("R", (), {"value": reason})()
        self.winning_rule = rule


def make_row(**kwargs):
    """A DecisionRow-shaped object for _delta_row."""
    defaults = dict(
        action_id="act_1",
        agent_id="ag_1",
        merchant_name="Fresh Mart",
        merchant_category="5411",
        amount=Decimal("1200"),
        conformance_score=Decimal("0.4"),
        decided_at=datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc),
        description="groceries",
        seed_legitimate=None,
        block_report=None,
        block_report_confirmed=None,
    )
    defaults.update(kwargs)
    return type("Row", (), defaults)()


class TestSeverityOrdering:
    """The ranking that decides which direction a change moved."""

    def test_allow_is_the_least_restrictive(self):
        assert _VERDICT_SEVERITY["ALLOW"] == min(_VERDICT_SEVERITY.values())

    def test_step_up_sits_between_allow_and_deny(self):
        """Asking a person is friction, not refusal -- and that gap is the bug."""
        assert (
            _VERDICT_SEVERITY["ALLOW"]
            < _VERDICT_SEVERITY["STEP_UP"]
            < _VERDICT_SEVERITY["DENY"]
        )

    def test_deny_to_step_up_reads_as_loosening(self):
        """The exact transition the old ALLOW-only comparison threw away."""
        assert _VERDICT_SEVERITY["STEP_UP"] < _VERDICT_SEVERITY["DENY"]

    def test_every_verdict_is_ranked(self):
        """An unranked verdict defaults to 0 and would look like a loosening."""
        assert set(_VERDICT_SEVERITY) == {"ALLOW", "STEP_UP", "HOLD", "DENY"}


class TestJudgingOneChangedDecision:
    """`judgement` answers: would this change harm someone or protect them?"""

    def _judge(self, **row_kwargs):
        from aegis.service import _delta_row

        return _delta_row(
            make_row(**row_kwargs),
            FakeDecision("ALLOW"),
            FakeDecision("DENY", "ship_to_mismatch", "ship_to_mismatch"),
        )["judgement"]

    def test_ground_truth_legitimate_means_good_traffic_harmed(self):
        assert self._judge(seed_legitimate=True) == "harms_good_traffic"

    def test_ground_truth_illegitimate_means_bad_traffic_caught(self):
        assert self._judge(seed_legitimate=False) == "catches_bad_traffic"

    def test_a_confirmed_member_report_counts_as_good_traffic(self):
        """No label, but two people agreed the block was wrong."""
        assert (
            self._judge(block_report="wrong", block_report_confirmed=True)
            == "harms_good_traffic"
        )

    def test_an_unreviewed_report_is_held_separately(self):
        """One person's claim must not silently become a confirmed fact."""
        assert (
            self._judge(block_report="wrong", block_report_confirmed=None)
            == "disputed_unreviewed"
        )

    def test_a_rejected_report_is_not_good_traffic(self):
        """The member complained and an operator found the block correct."""
        assert (
            self._judge(block_report="wrong", block_report_confirmed=False) == "unknown"
        )

    def test_no_evidence_is_unknown_not_assumed_good(self):
        """The distinction between a review and a rubber stamp."""
        assert self._judge() == "unknown"

    def test_ground_truth_outranks_a_member_report(self):
        """A label is exact; a report is an opinion two people share."""
        assert (
            self._judge(
                seed_legitimate=False, block_report="wrong", block_report_confirmed=True
            )
            == "catches_bad_traffic"
        )


class TestImpactSummary:
    def _rows(self, *judgements, **extra):
        return [
            {
                "judgement": j,
                "block_report": extra.get("block_report"),
                "block_report_confirmed": extra.get("block_report_confirmed"),
            }
            for j in judgements
        ]

    def test_counts_the_trade_in_both_directions(self):
        summary = _impact_summary(
            self._rows("catches_bad_traffic", "catches_bad_traffic", "harms_good_traffic"),
            self._rows("harms_good_traffic"),
        )
        assert summary["bad_traffic_newly_caught"] == 2
        assert summary["good_traffic_newly_harmed"] == 1
        assert summary["good_traffic_newly_released"] == 1

    def test_false_blocks_resolved_requires_confirmation(self):
        """The strongest argument for a change: it fixes known mistakes."""
        confirmed = self._rows(
            "harms_good_traffic", block_report="wrong", block_report_confirmed=True
        )
        pending = self._rows(
            "disputed_unreviewed", block_report="wrong", block_report_confirmed=None
        )
        summary = _impact_summary([], confirmed + pending)
        assert summary["false_blocks_resolved"] == 1
        assert summary["disputes_resolved"] == 2  # both, reviewed or not

    def test_releasing_bad_traffic_is_reported_not_hidden(self):
        """A loosening's cost must be as visible as its benefit."""
        summary = _impact_summary([], self._rows("catches_bad_traffic"))
        assert summary["bad_traffic_newly_released"] == 1

    def test_unlabelled_rows_are_surfaced(self):
        """A blast radius that is mostly unknown is not a reviewed change."""
        summary = _impact_summary(self._rows("unknown", "unknown"), self._rows("unknown"))
        assert summary["unlabelled"] == 3

    def test_an_empty_change_summarises_to_zeros(self):
        summary = _impact_summary([], [])
        assert summary["bad_traffic_newly_caught"] == 0
        assert summary["false_blocks_resolved"] == 0
        assert summary["unlabelled"] == 0
