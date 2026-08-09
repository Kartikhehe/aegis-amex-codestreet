"""Circuit breakers.

Breakers watch the *shape* of an agent's recent behaviour rather than any
single decision. A single odd purchase is a decision problem; a run of them is
a control problem, and the response is to stop the agent rather than keep
adjudicating one transaction at a time.

Five breakers:

  velocity              -- spending or transacting far faster than normal
  denial_rate           -- a high share of recent attempts are being denied,
                           i.e. the agent keeps trying things it may not do
  conformance_collapse  -- mean conformance falls off a cliff. Labelled
                           SUSPECTED PROMPT INJECTION, because an agent whose
                           purchases suddenly stop matching its mandate is the
                           signature of an agent taking instructions from
                           somewhere other than its principal.
  novel_merchant        -- a burst of never-seen merchants in a short window
  correlated_anomaly    -- several agents of the SAME OPERATOR degrading at
                           once, which points at the operator's own stack
                           rather than at any one agent

A trip pushes a ComplianceEvent and sets breaker_tripped, which policy.py
reads at rule 2 (DENY, agent_breaker_tripped).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from statistics import mean
from typing import Any, Iterable, Optional, Sequence

from .types import Verdict, utcnow


class BreakerType(str, Enum):
    VELOCITY = "velocity"
    DENIAL_RATE = "denial_rate"
    CONFORMANCE_COLLAPSE = "conformance_collapse"
    NOVEL_MERCHANT = "novel_merchant"
    CORRELATED_ANOMALY = "correlated_anomaly"


class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass(frozen=True)
class BreakerConfig:
    window_minutes: int = 60
    min_samples: int = 8

    velocity_txn_multiplier: float = 3.0
    velocity_amount_multiplier: float = 4.0

    denial_rate_threshold: float = 0.40

    conformance_collapse_floor: float = 0.55
    conformance_collapse_drop: float = 0.25

    novel_merchant_threshold: int = 5

    correlated_min_agents: int = 3


@dataclass(frozen=True)
class ObservedDecision:
    """The slice of a decision the breakers need."""

    action_id: str
    agent_id: str
    operator_id: str
    verdict: Verdict
    conformance_score: Optional[float]
    merchant_id: str
    merchant_known: bool
    amount: Decimal
    decided_at: datetime


@dataclass(frozen=True)
class ComplianceEvent:
    event_id: str
    breaker: BreakerType
    agent_id: str
    operator_id: str
    severity: Severity
    title: str
    detail: str
    evidence: dict[str, Any] = field(default_factory=dict)
    suspected_prompt_injection: bool = False
    created_at: datetime = field(default_factory=utcnow)

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "breaker": self.breaker.value,
            "agent_id": self.agent_id,
            "operator_id": self.operator_id,
            "severity": self.severity.value,
            "title": self.title,
            "detail": self.detail,
            "evidence": self.evidence,
            "suspected_prompt_injection": self.suspected_prompt_injection,
            "created_at": self.created_at.isoformat(),
        }


def _window(
    decisions: Sequence[ObservedDecision], now: datetime, minutes: int
) -> list[ObservedDecision]:
    cutoff = now - timedelta(minutes=minutes)
    return [d for d in decisions if d.decided_at > cutoff]


def _baseline(
    decisions: Sequence[ObservedDecision], now: datetime, minutes: int
) -> list[ObservedDecision]:
    """The window immediately before the current one -- what 'normal' looked
    like for this agent, so the breakers compare an agent against itself."""
    cutoff = now - timedelta(minutes=minutes)
    prior = now - timedelta(minutes=minutes * 2)
    return [d for d in decisions if prior < d.decided_at <= cutoff]


def evaluate_breakers(
    agent_id: str,
    operator_id: str,
    decisions: Sequence[ObservedDecision],
    config: Optional[BreakerConfig] = None,
    now: Optional[datetime] = None,
    event_id_prefix: str = "evt",
) -> list[ComplianceEvent]:
    """Run every breaker for one agent. Returns the events that tripped."""
    cfg = config or BreakerConfig()
    at = now or utcnow()
    mine = [d for d in decisions if d.agent_id == agent_id]
    recent = _window(mine, at, cfg.window_minutes)
    prior = _baseline(mine, at, cfg.window_minutes)
    events: list[ComplianceEvent] = []

    def emit(
        breaker: BreakerType,
        severity: Severity,
        title: str,
        detail: str,
        evidence: dict[str, Any],
        injection: bool = False,
    ) -> None:
        events.append(
            ComplianceEvent(
                event_id=f"{event_id_prefix}_{agent_id}_{breaker.value}_{int(at.timestamp())}",
                breaker=breaker,
                agent_id=agent_id,
                operator_id=operator_id,
                severity=severity,
                title=title,
                detail=detail,
                evidence=evidence,
                suspected_prompt_injection=injection,
                created_at=at,
            )
        )

    if len(recent) < cfg.min_samples:
        return events

    # --- velocity -----------------------------------------------------------
    if prior:
        prior_count = len(prior)
        prior_amount = sum((d.amount for d in prior), Decimal("0"))
        recent_amount = sum((d.amount for d in recent), Decimal("0"))
        count_spike = len(recent) > prior_count * cfg.velocity_txn_multiplier
        amount_spike = prior_amount > 0 and recent_amount > prior_amount * Decimal(
            str(cfg.velocity_amount_multiplier)
        )
        if count_spike or amount_spike:
            emit(
                BreakerType.VELOCITY,
                Severity.WARNING,
                "Velocity breaker tripped",
                (
                    f"{len(recent)} transactions totalling {recent_amount} in the last "
                    f"{cfg.window_minutes} minutes, against {prior_count} totalling "
                    f"{prior_amount} in the preceding window."
                ),
                {
                    "recent_count": len(recent),
                    "prior_count": prior_count,
                    "recent_amount": str(recent_amount),
                    "prior_amount": str(prior_amount),
                },
            )

    # --- denial rate --------------------------------------------------------
    denials = [d for d in recent if d.verdict is Verdict.DENY]
    denial_rate = len(denials) / len(recent)
    if denial_rate >= cfg.denial_rate_threshold:
        emit(
            BreakerType.DENIAL_RATE,
            Severity.WARNING,
            "Denial-rate breaker tripped",
            (
                f"{len(denials)} of {len(recent)} recent attempts were denied "
                f"({denial_rate:.0%}). The agent is repeatedly attempting actions "
                "outside its mandate."
            ),
            {"denials": len(denials), "total": len(recent), "rate": round(denial_rate, 4)},
        )

    # --- conformance collapse (SUSPECTED PROMPT INJECTION) ------------------
    recent_scores = [d.conformance_score for d in recent if d.conformance_score is not None]
    prior_scores = [d.conformance_score for d in prior if d.conformance_score is not None]
    if len(recent_scores) >= max(cfg.min_samples // 2, 3):
        recent_mean = mean(recent_scores)
        collapsed = recent_mean < cfg.conformance_collapse_floor
        dropped = False
        prior_mean = None
        if len(prior_scores) >= 3:
            prior_mean = mean(prior_scores)
            dropped = (prior_mean - recent_mean) >= cfg.conformance_collapse_drop
        if collapsed or dropped:
            emit(
                BreakerType.CONFORMANCE_COLLAPSE,
                Severity.CRITICAL,
                "SUSPECTED PROMPT INJECTION",
                (
                    f"Mean mandate conformance fell to {recent_mean:.2f}"
                    + (f" from {prior_mean:.2f}" if prior_mean is not None else "")
                    + ". A sustained collapse in conformance indicates the agent is "
                    "acting on instructions other than its principal's."
                ),
                {
                    "recent_mean": round(recent_mean, 4),
                    "prior_mean": None if prior_mean is None else round(prior_mean, 4),
                    "sample_size": len(recent_scores),
                },
                injection=True,
            )

    # --- novel merchant burst ----------------------------------------------
    novel = {d.merchant_id for d in recent if not d.merchant_known}
    if len(novel) >= cfg.novel_merchant_threshold:
        emit(
            BreakerType.NOVEL_MERCHANT,
            Severity.WARNING,
            "Novel-merchant breaker tripped",
            (
                f"{len(novel)} previously-unseen merchants in the last "
                f"{cfg.window_minutes} minutes."
            ),
            {"novel_merchants": sorted(novel), "count": len(novel)},
        )

    return events


def evaluate_correlated_anomaly(
    operator_id: str,
    decisions: Sequence[ObservedDecision],
    config: Optional[BreakerConfig] = None,
    now: Optional[datetime] = None,
    event_id_prefix: str = "evt",
) -> Optional[ComplianceEvent]:
    """Fleet-level: are several of one operator's agents degrading together?

    Simultaneous degradation across independent agents is not a coincidence --
    it points at shared infrastructure: the operator's prompt template, tool
    server, or upstream data source.
    """
    cfg = config or BreakerConfig()
    at = now or utcnow()
    recent = _window([d for d in decisions if d.operator_id == operator_id], at, cfg.window_minutes)
    if not recent:
        return None

    by_agent: dict[str, list[ObservedDecision]] = {}
    for d in recent:
        by_agent.setdefault(d.agent_id, []).append(d)

    degraded: list[str] = []
    for agent_id, rows in by_agent.items():
        scores = [r.conformance_score for r in rows if r.conformance_score is not None]
        denials = sum(1 for r in rows if r.verdict is Verdict.DENY)
        if len(rows) < 3:
            continue
        if (scores and mean(scores) < cfg.conformance_collapse_floor) or (
            denials / len(rows) >= cfg.denial_rate_threshold
        ):
            degraded.append(agent_id)

    if len(degraded) < cfg.correlated_min_agents:
        return None

    return ComplianceEvent(
        event_id=f"{event_id_prefix}_{operator_id}_correlated_{int(at.timestamp())}",
        breaker=BreakerType.CORRELATED_ANOMALY,
        agent_id="",
        operator_id=operator_id,
        severity=Severity.CRITICAL,
        title="Correlated anomaly across operator fleet",
        detail=(
            f"{len(degraded)} agents operated by {operator_id} degraded simultaneously. "
            "Simultaneous degradation across independent agents indicates a shared "
            "cause in the operator's own stack rather than agent-level drift."
        ),
        evidence={"degraded_agents": sorted(degraded), "window_minutes": cfg.window_minutes},
        suspected_prompt_injection=False,
        created_at=at,
    )
