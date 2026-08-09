/**
 * The shared glossary.
 *
 * AEGIS design law: every technical term carries a tooltip. A governance
 * console is read by compliance officers and disputed by lawyers, not only
 * operated by engineers -- so a term the reader cannot look up in place is a
 * term that will be misread.
 *
 * Definitions are written for an intelligent non-specialist. They say what the
 * thing IS and why it matters, in one or two sentences, without assuming the
 * reader knows the engine internals.
 */

export const glossary = {
  // --- verdicts ------------------------------------------------------------
  ALLOW:
    'The purchase was authorised and went through. It matched the mandate the card member granted.',
  DENY: 'The purchase was blocked outright and nothing was charged. It broke a rule that has no exception.',
  STEP_UP:
    'The purchase was held and sent to the card member to approve. Nothing is charged unless they say yes.',
  HOLD: 'The purchase is paused pending a manual review by an operator.',

  // --- core concepts -------------------------------------------------------
  mandate:
    'The authority a card member grants an agent: what it may buy, where, up to what amount, and for how long. An agent can never act outside its mandate.',
  mandate_hash:
    'A fingerprint of the exact mandate in force when a decision was made. If the mandate later changes, this proves which version applied at the time.',
  conformance:
    'How well a purchase matches the purpose the card member actually authorised, scored from 0.00 to 1.00. A valid mandate used for the wrong thing scores low.',
  conformance_score:
    'Between 0.00 and 1.00. Below 0.45 the purchase is denied; below 0.70 it needs the card member; below 0.85 it is allowed but flagged for review.',
  ruleset_hash:
    'A fingerprint of the exact policy that produced a decision. Every decision records one, so any outcome can be traced back to the rules that caused it.',
  delegation:
    'An agent handing part of its authority to a sub-agent. Authority can only ever narrow as it passes down -- a sub-agent can never exceed its parent.',
  delegation_depth:
    'How many levels of sub-agent sit between the original mandate and the agent making this purchase.',
  prohibited_attribute:
    'Something the card member said the agent may never buy, such as gift cards or crypto. Checked before any scoring, so it holds even if other systems fail.',
  veto: 'An absolute block. Unlike a score, a veto has no threshold to tune and cannot be overridden by a good conformance score.',
  novel_merchant:
    'A merchant this agent has never successfully transacted with before. First contact is held for approval, because a new counterparty is where fraud usually starts.',
  velocity: 'How fast an agent is spending relative to its limits and its own recent behaviour.',

  // --- ledger --------------------------------------------------------------
  ledger:
    'The append-only record of every decision. Rows can be added but never edited or removed -- the database itself refuses.',
  hash_chain:
    'Each ledger record contains a fingerprint of the one before it. Changing any past record breaks every record after it, so tampering cannot be hidden.',
  prev_hash:
    'The fingerprint of the record immediately before this one. This is the link in the chain.',
  self_hash:
    "This record's own fingerprint, computed from its contents and the previous record's fingerprint.",
  merkle_checkpoint:
    'A nightly fingerprint of the whole chain, stored separately. Even an attacker who rewrote every record would not match a checkpoint published beforehand.',
  chain_of_custody:
    'The unbroken record of where a piece of evidence has been, proving it has not been altered since it was created.',

  // --- controls ------------------------------------------------------------
  circuit_breaker:
    'An automatic switch that stops an agent when its recent behaviour looks wrong as a pattern, rather than judging one purchase at a time.',
  prompt_injection:
    'An attack where hidden instructions in content the agent reads cause it to act for someone other than the card member. Its signature is a sudden collapse in conformance.',
  fleet_stop:
    'The emergency stop. Every agent, every operator, denied immediately. Re-arming requires two different operators to approve.',
  fail_closed:
    'When a check cannot run, the system withholds approval rather than granting it. A broken control never becomes an open door.',
  shadow_mode:
    'A policy that runs alongside the live one and records what it would have decided, without affecting any real purchase.',
  blast_radius:
    'What a policy change would have done to real past traffic: how many transactions it would newly block, and how much spend it would have stopped.',
  step_up_approval:
    'The card member confirming a held purchase. Approving also teaches the system that this merchant is expected.',

  // --- liability -----------------------------------------------------------
  liability:
    'Who is answerable for a disputed transaction. Derived only from what the ledger recorded, so the reasoning can be checked rather than trusted.',
  card_member:
    'The person whose account is being spent from, and who granted the mandate in the first place.',
  operator:
    'The company running the agent. Answerable when its agent exceeded the authority it was given.',
  platform:
    'AEGIS itself. Answerable when a transaction settled without a control that policy required.',

  // --- technical -----------------------------------------------------------
  mcc: 'Merchant Category Code — a four-digit code describing what kind of business a merchant is. Two very different shops can share one.',
  p99_latency:
    'The time the slowest 1 in 100 decisions took. A better measure of the worst experience than an average.',
  false_block:
    'A purchase we held that the card member then approved. Friction we created for something they actually wanted.',
  model_version:
    'The exact model that produced this conformance score, recorded so old scores stay interpretable.',
  prompt_hash:
    'A fingerprint of the scoring instructions used. A score only means something alongside the prompt that produced it.',
  reason_code: 'The machine-readable cause of a decision. Every decision has exactly one.',
  winning_rule:
    'Rules are checked in a fixed order and the first match decides the outcome. This is the rule that matched.',
};

/** Look up a term, tolerating case and separator differences. */
export const lookupTerm = (term) => {
  if (!term) return null;
  const key = String(term).trim();
  if (glossary[key]) return glossary[key];
  const normalised = key.toLowerCase().replace(/[\s-]+/g, '_');
  return glossary[normalised] ?? null;
};

export default glossary;
