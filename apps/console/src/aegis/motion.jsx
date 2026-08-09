import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * Motion, deliberately rationed.
 *
 * AEGIS specifies a *medium* motion budget: a few signature moments, and calm
 * everywhere else. Animation in a governance console is not decoration -- it
 * is how the operator notices that something changed while they were looking
 * somewhere else. Spend it on the five moments that carry meaning:
 *
 *   1. a new decision arriving in the live stream
 *   2. a DENY, which pulses once and then settles
 *   3. a metric changing value
 *   4. the fleet halting
 *   5. the ledger verifying, link by link
 *
 * Everything here honours prefers-reduced-motion. That setting is often set by
 * people who get migraines or motion sickness from animation, so "respecting"
 * it means removing the movement, not shortening it.
 */

/** 180ms, per the specification -- fast enough to feel immediate. */
export const STREAM_ROW_DURATION = 0.18;

export const useMotionAllowed = () => !useReducedMotion();

/** New stream rows slide down and fade in from the top. */
export const streamRowVariants = {
  initial: { opacity: 0, y: -12, scaleY: 0.96 },
  animate: { opacity: 1, y: 0, scaleY: 1 },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

export const streamRowTransition = {
  duration: STREAM_ROW_DURATION,
  ease: [0.22, 1, 0.36, 1], // decelerating: fast in, gentle settle
};

/** Reduced-motion equivalent: appear, but do not move. */
export const staticRowVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

/**
 * Count a number up on first render, and flash it on change.
 *
 * Returns the display value plus a `changed` flag the caller can use to tint
 * the figure briefly. Counting up is a first-load affordance only -- a metric
 * that re-animated on every poll would be unreadable.
 */
export const useCountUp = (value, { duration = 900, enabled = true } = {}) => {
  const reduced = useReducedMotion();
  const target = Number(value ?? 0);
  const [display, setDisplay] = useState(reduced || !enabled ? target : 0);
  const [changed, setChanged] = useState(false);
  const previous = useRef(target);
  const hasRun = useRef(false);

  useEffect(() => {
    if (reduced || !enabled) {
      setDisplay(target);
      previous.current = target;
      return undefined;
    }

    const from = hasRun.current ? previous.current : 0;
    previous.current = target;

    if (hasRun.current && from !== target) {
      setChanged(true);
      const timer = setTimeout(() => setChanged(false), 600);
      // A changed metric snaps to its new value and flashes: re-counting on
      // every refresh would turn a live dashboard into a slot machine.
      setDisplay(target);
      return () => clearTimeout(timer);
    }

    hasRun.current = true;
    if (from === target) {
      setDisplay(target);
      return undefined;
    }

    let frame;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      // easeOutCubic -- arrives quickly, settles gently.
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(from + (target - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduced, enabled]);

  return { value: display, changed };
};

/**
 * The one-shot DENY glow.
 *
 * A denial is the event an operator most needs to catch, but a permanently
 * glowing row would train them to ignore it. So it pulses once on arrival and
 * then settles into an ordinary row.
 */
export const useDenyPulse = (shouldPulse, { duration = 1400 } = {}) => {
  const reduced = useReducedMotion();
  const [pulsing, setPulsing] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (!shouldPulse || reduced || fired.current) return undefined;
    fired.current = true;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), duration);
    return () => clearTimeout(timer);
  }, [shouldPulse, reduced, duration]);

  return pulsing;
};

/** The DENY glow's box-shadow, as an sx fragment. */
export const denyGlowSx = (theme) => ({
  animation: 'aegisDenyPulse 1400ms cubic-bezier(0.22, 1, 0.36, 1) 1',
  '@keyframes aegisDenyPulse': {
    '0%': {
      boxShadow: `inset 0 0 0 1px rgba(${theme.vars.palette.error.mainChannel} / 0.9),
                  0 0 24px 2px rgba(${theme.vars.palette.error.mainChannel} / 0.45)`,
      backgroundColor: `rgba(${theme.vars.palette.error.mainChannel} / 0.16)`,
    },
    '100%': {
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0), 0 0 0 0 rgba(0,0,0,0)',
      backgroundColor: 'transparent',
    },
  },
  '@media (prefers-reduced-motion: reduce)': {
    animation: 'none',
  },
});

/** The fleet-halt banner: slides down from the top, then holds. */
export const haltBannerVariants = {
  initial: { y: '-100%', opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: '-100%', opacity: 0 },
};

export const haltBannerTransition = { type: 'spring', stiffness: 260, damping: 26 };

/** Full-screen dim behind the halt banner. */
export const dimVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

/**
 * Ledger verification: fill the block strip left to right, then stop dead at
 * the broken link if there is one.
 *
 * The stop is the point. A progress bar that completes and *then* reports
 * failure hides where the failure was; this one halts exactly at the row that
 * did not verify.
 */
export const useChainFill = (total, { breakAt = null, active = false, stepMs = 14 } = {}) => {
  const reduced = useReducedMotion();
  const limit = breakAt ?? total;
  const [filled, setFilled] = useState(0);

  useEffect(() => {
    if (!active || !total) {
      setFilled(0);
      return undefined;
    }
    if (reduced) {
      setFilled(limit);
      return undefined;
    }

    setFilled(0);
    let current = 0;
    // Long chains animate in chunks so a 25,000-record verification still
    // resolves in about a second rather than in five minutes.
    const step = Math.max(Math.ceil(limit / 60), 1);
    const timer = setInterval(() => {
      current = Math.min(current + step, limit);
      setFilled(current);
      if (current >= limit) clearInterval(timer);
    }, stepMs);
    return () => clearInterval(timer);
  }, [active, total, limit, reduced, stepMs]);

  return { filled, complete: filled >= limit };
};
