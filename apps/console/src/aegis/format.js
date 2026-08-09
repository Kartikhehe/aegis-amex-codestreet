/**
 * Formatting rules, in one place.
 *
 * AEGIS specifies exact presentation for every kind of figure. Centralising it
 * means a score is never rendered to three decimals in one screen and two in
 * another -- inconsistency in numbers reads as carelessness in a governance
 * product.
 *
 *   currency  ₹4,980        Indian digit grouping (lakh/crore), no decimals
 *                           unless the amount actually has paise
 *   latency   31 ms
 *   scores    0.11          always two decimal places, never rounded to one
 *   hashes    a3f2…9c14     head and tail, middle elided
 */

/** ₹ with Indian grouping: 4980 -> ₹4,980; 1234567 -> ₹12,34,567. */
export const formatCurrency = (value, { withDecimals = 'auto' } = {}) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '₹0';

  const hasPaise = Math.abs(amount % 1) > 0.004;
  const showDecimals = withDecimals === 'auto' ? hasPaise : Boolean(withDecimals);

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(amount);
};

/** Compact currency for tiles where the full figure would not fit: ₹5.2L. */
export const formatCurrencyCompact = (value) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '₹0';
  const abs = Math.abs(amount);
  if (abs >= 1e7) return `₹${(amount / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(amount / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `₹${(amount / 1e3).toFixed(1)}K`;
  return formatCurrency(amount);
};

/** Plain integers with Indian grouping. */
export const formatNumber = (value) => new Intl.NumberFormat('en-IN').format(Number(value ?? 0));

/** Conformance and rates: ALWAYS two decimals. 0.1 -> "0.10", never "0.1". */
export const formatScore = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(2);
};

/** Percentages from a 0-1 rate: 0.0312 -> "3.12%". */
export const formatRate = (value, decimals = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(decimals)}%`;
};

/** "31 ms" -- with the space, per the specification. */
export const formatLatency = (ms) => {
  const value = Number(ms ?? 0);
  if (!Number.isFinite(value)) return '— ms';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
};

/** Hashes: head…tail, so two can be compared at a glance without wrapping. */
export const truncateHash = (hash, head = 6, tail = 4) => {
  if (!hash) return '—';
  const value = String(hash);
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
};

/** Time of day for stream rows: 14:32:07. */
export const formatTime = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-GB', { hour12: false });
};

/** Full timestamp for evidence: 08 Aug 2026, 14:32:07. */
export const formatDateTime = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

/** "3 minutes ago" -- for the live stream's sense of recency. */
export const formatRelative = (iso) => {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

/** reason_code -> the sentence an operator reads. */
export const reasonLabels = {
  fleet_emergency_stop: 'Fleet emergency stop',
  agent_breaker_tripped: 'Circuit breaker tripped',
  operator_revoked: 'Operator revoked',
  agent_inactive: 'Agent inactive',
  mandate_expired: 'Mandate expired',
  delegation_depth_exceeded: 'Delegation too deep',
  prohibited_attribute_veto: 'Prohibited purchase',
  conformance_below_deny_floor: 'Outside authorised purpose',
  conformance_below_review_floor: 'Unclear match to purpose',
  conformance_marginal: 'Weak match, allowed and flagged',
  amount_above_ceiling: 'Above spending limit',
  velocity_limit: 'Spending too fast',
  novel_merchant: 'New merchant',
  scorer_unavailable_fail_closed: 'Could not verify — held',
  within_mandate: 'Within mandate',
};

export const formatReason = (code) => reasonLabels[code] ?? String(code ?? '').replace(/_/g, ' ');

/** rule_name -> readable label for the rules-fired list. */
export const formatRuleName = (name) =>
  String(name ?? '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
