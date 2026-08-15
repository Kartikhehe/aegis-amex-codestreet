import { formatCurrency, formatScore } from 'aegis/format';

/**
 * Turns a decision record into the steps AEGIS actually took to reach it.
 *
 * This is the evidence view: what came in, which gate each rule applied, where
 * it stopped, and what was written down. It reads from the SAME record the
 * ledger hashed -- nothing here is reconstructed or assumed, so the flow cannot
 * drift from the decision it claims to explain.
 *
 * Two things the shape has to be honest about:
 *
 *   1. Evaluation is FIRST MATCH WINS. A decision that stops at rule 10 never
 *      ran rules 11-16, and showing those as "passed" would be a lie. They are
 *      marked `not_reached`.
 *   2. A rule that was skipped because the ruleset disabled it is not the same
 *      as one that ran and found nothing.
 */

// What each rule is actually asking, in the language of the person reading it.
// Without this the flow is a list of identifiers, which explains nothing.
const RULE_QUESTIONS = {
  fleet_stop: 'Is the whole fleet halted by an operator?',
  agent_breaker: 'Has this agent tripped a circuit breaker?',
  operator_revoked: 'Is the operator still allowed to act?',
  agent_inactive: 'Is this agent active, not paused or revoked?',
  mandate_expired: 'Is the authority still in date?',
  delegation_depth: 'Was authority passed down further than permitted?',
  suspected_injection: 'Was the agent fed text trying to override its limits?',
  ship_to_mismatch: 'Are the goods going where the card member authorised?',
  prohibited_attribute_veto: 'Does the basket contain something never permitted?',
  conformance_deny_floor: 'Does this match the stated purpose at all?',
  conformance_review_floor: 'Does it match the purpose clearly enough to pass unseen?',
  amount_above_ceiling: 'Is it within the per-purchase and daily limits?',
  velocity_limit: 'Has this agent bought too many times today?',
  novel_merchant: 'Has this agent used this merchant before?',
  conformance_marginal: 'A weaker-than-usual match: allow, but flag it.',
  allow: 'Everything checked out.',
};

// Rules whose job is to stop bad things. A match on one of those is a BLOCK
// and the tile reads as one. `allow` is the opposite: matching it IS the pass,
// so it must never be drawn in the red "stopped here" treatment.
const CLEARANCE_RULES = new Set(['allow', 'conformance_marginal']);

const STAGES = [
  {
    key: 'authority',
    title: 'Authority',
    caption: 'Is this agent allowed to act at all?',
    rules: [
      'fleet_stop',
      'agent_breaker',
      'operator_revoked',
      'agent_inactive',
      'mandate_expired',
      'delegation_depth',
    ],
  },
  {
    key: 'integrity',
    title: 'Integrity',
    caption: 'Deterministic vetoes, applied before any model sees this',
    rules: ['suspected_injection', 'ship_to_mismatch', 'prohibited_attribute_veto'],
  },
  {
    key: 'conformance',
    title: 'Conformance',
    caption: 'Does the purchase match the purpose it was authorised for?',
    rules: ['conformance_deny_floor', 'conformance_review_floor'],
  },
  {
    key: 'limits',
    title: 'Limits',
    caption: 'Ceilings, velocity and merchant familiarity',
    rules: ['amount_above_ceiling', 'velocity_limit', 'novel_merchant'],
  },
  {
    key: 'outcome',
    title: 'Outcome',
    caption: 'Nothing stopped it — allowed, flagged if the match was weak',
    rules: ['conformance_marginal', 'allow'],
  },
];

/**
 * Every rule the engine can evaluate, in order.
 *
 * Mirrors RULE_ORDER in the engine. The stage map above MUST cover it exactly:
 * a rule missing from both is invisible in this view, and a rule named here
 * that the engine does not have would be drawn as "not reached" forever. An
 * earlier version invented `daily_ceiling` and `within_mandate`, and both
 * showed up as permanently-unrun steps on decisions that had in fact run
 * every check.
 */
const ENGINE_RULES = STAGES.flatMap((stage) => stage.rules);

/**
 * Warn in development when a decision carries a rule this view does not map.
 *
 * Silent divergence is the failure mode that matters: the engine gains a rule,
 * the flow keeps rendering happily, and the new rule is simply never shown to
 * anyone. A console warning is enough -- this must never break the screen a
 * user is trying to read.
 */
const warnedRules = new Set();
const warnAboutUnmappedRules = (fired) => {
  if (!import.meta.env.DEV) return;
  fired.forEach(({ rule_name: name }) => {
    if (ENGINE_RULES.includes(name) || warnedRules.has(name)) return;
    warnedRules.add(name);
    console.warn(
      `[DecisionFlow] rule "${name}" is not in any stage and will not be shown. ` +
        'Add it to STAGES in aegis/decisionFlow.js.',
    );
  });
};

const asStatus = (rule, stoppedAt, index) => {
  if (rule.matched) return 'matched';
  if (rule.skipped) return 'skipped';
  // Everything after the winning rule was never evaluated.
  if (stoppedAt >= 0 && index > stoppedAt) return 'not_reached';
  return 'passed';
};

/**
 * Redact anything that would be unsafe or pointless on a shared screen.
 *
 * Hashes are the proof, so they stay -- but truncated, because a full 64-char
 * digest is unreadable and nobody verifies one by eye. Injected text is shown
 * only as its shape, never verbatim: it is hostile input, and reproducing it
 * in full on a demo screen invites someone to copy it.
 */
export const shortHash = (value, length = 12) =>
  value ? `${String(value).slice(0, length)}…` : '—';

export const redactInjection = (text) => {
  if (!text) return null;
  const clean = String(text).trim();
  if (clean.length <= 48) return clean;
  return `${clean.slice(0, 48)}… (${clean.length} chars)`;
};

/**
 * Build the flow. Returns stages of rule tiles plus the inputs and outputs.
 */
export const buildDecisionFlow = (decision) => {
  if (!decision) return null;

  const fired = decision.rules_fired ?? [];
  warnAboutUnmappedRules(fired);

  const byName = new Map(fired.map((rule, index) => [rule.rule_name, { ...rule, index }]));
  const stoppedAt = fired.findIndex((rule) => rule.matched);
  const winner = stoppedAt >= 0 ? fired[stoppedAt] : null;

  const stages = STAGES.map((stage) => {
    const steps = stage.rules.map((name) => {
      const rule = byName.get(name);
      // A rule ABSENT from rules_fired never ran -- the engine stops at the
      // first match and records nothing after it. Showing it as not_reached is
      // the whole point; dropping it would quietly hide the back half of the
      // pipeline on every blocked decision, which is exactly the dishonesty
      // this view exists to avoid.
      if (!rule) {
        return {
          name,
          question: RULE_QUESTIONS[name] ?? '',
          detail: '',
          status: 'not_reached',
          decisive: false,
          isClearance: CLEARANCE_RULES.has(name),
          verdict: null,
        };
      }
      return {
        name,
        question: RULE_QUESTIONS[name] ?? '',
        detail: rule.detail || '',
        status: asStatus(rule, stoppedAt, rule.index),
        // A matched clearance rule is a pass, not a block.
        decisive: rule.matched,
        isClearance: CLEARANCE_RULES.has(name),
        verdict: rule.verdict,
      };
    });

    return {
      ...stage,
      steps,
      // A stage is "reached" if any of its rules actually ran.
      reached: steps.some((s) => s.status !== 'not_reached'),
      decisive: steps.some((s) => s.decisive),
    };
  });

  // ---- what went in -----------------------------------------------------
  const features = decision.features ?? {};
  const cart = decision.cart_items ?? [];
  const inputs = [
    { label: 'Agent', value: decision.agent_name || decision.agent_id, mono: false },
    { label: 'Merchant', value: decision.merchant_name, mono: false },
    { label: 'Category (MCC)', value: decision.merchant_category, mono: true },
    { label: 'Amount', value: formatCurrency(decision.amount), mono: true },
  ];
  if (decision.ship_to) inputs.push({ label: 'Deliver to', value: decision.ship_to, mono: false });
  if (cart.length) {
    inputs.push({
      label: 'Basket',
      value: `${cart.length} line${cart.length === 1 ? '' : 's'}`,
      mono: false,
    });
  }
  const riskAttributes = [
    ...new Set([
      ...(decision.merchant_attributes ?? []),
      ...cart.flatMap((line) => line.attributes ?? []),
    ]),
  ];

  // ---- what the authority permitted -------------------------------------
  const authority = [
    features.per_transaction_ceiling != null && {
      label: 'Per purchase',
      value: formatCurrency(features.per_transaction_ceiling),
    },
    features.daily_ceiling != null && {
      label: 'Per day',
      value: formatCurrency(features.daily_ceiling),
    },
    features.max_transactions_per_day != null && {
      label: 'Purchases/day',
      value: String(features.max_transactions_per_day),
    },
    features.transactions_today != null && {
      label: 'Used today',
      value: `${features.transactions_today} · ${formatCurrency(features.amount_today ?? 0)}`,
    },
  ].filter(Boolean);

  // ---- what came out ----------------------------------------------------
  const ledger = decision.ledger ?? null;

  return {
    stages,
    winner: winner
      ? {
          name: winner.rule_name,
          detail: winner.detail || '',
          question: RULE_QUESTIONS[winner.rule_name] ?? '',
          isClearance: CLEARANCE_RULES.has(winner.rule_name),
        }
      : null,
    evaluated: stoppedAt >= 0 ? stoppedAt + 1 : fired.length,
    total: fired.length,
    inputs,
    riskAttributes,
    authority,
    purpose: decision.purpose ?? null,
    conformance: decision.conformance ?? null,
    injected: redactInjection(decision.injected_instruction),
    ledger,
    // What the card member did after the engine paused.
    //
    // A STEP_UP is not the end of the story: the purchase stopped, a human
    // answered, and it then completed or did not. Without this the flow ends
    // at "held for approval" and gives no sign that anything happened next --
    // which is the single most important part of the step-up story to show.
    stepUp:
      decision.verdict === 'STEP_UP'
        ? {
            state: decision.step_up_state ?? 'pending',
            resolvedAt: decision.step_up_resolved_at ?? null,
          }
        : null,
    verdict: decision.verdict,
    reasonCode: decision.reason_code,
    reason: decision.human_readable_reason,
    rulesetHash: decision.ruleset_hash,
    cartDigest: decision.cart_digest,
    scoreLabel:
      decision.conformance?.score != null ? formatScore(decision.conformance.score) : null,
  };
};

export { RULE_QUESTIONS };
