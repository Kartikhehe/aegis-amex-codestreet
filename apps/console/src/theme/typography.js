/**
 * AEGIS typography.
 *
 * Two faces, one rule: Plus Jakarta Sans carries language, JetBrains Mono
 * carries fact. Every number, hash, ID, score, latency and amount is mono --
 * which is what makes tabular data line up, hashes comparable at a glance, and
 * the whole product read as infrastructure rather than as a report.
 *
 * The `mono*` variants below are registered on the theme (see theme.js) so a
 * component asks for <Typography variant="mono"> rather than hand-setting a
 * font family, and the discipline cannot drift component by component.
 */
export const monoFontFamily = [
  'JetBrains Mono',
  'ui-monospace',
  'SFMono-Regular',
  'monospace',
].join(',');

/** Shared mono treatment: tabular figures so digits never shift width. */
const monoBase = {
  fontFamily: monoFontFamily,
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum" 1, "zero" 1',
  letterSpacing: '-0.01em',
};

const typography = {
  fontFamily: ['Plus Jakarta Sans', 'sans-serif'].join(','),
  monoFontFamily,

  /** Inline figures inside body copy -- amounts, counts, latencies. */
  mono: {
    ...monoBase,
    fontWeight: 500,
    fontSize: '0.8125rem', // 13px
    lineHeight: 1.45,
  },
  /** Secondary/dense figures: table cells, chip values, timestamps. */
  monoSmall: {
    ...monoBase,
    fontWeight: 500,
    fontSize: '0.75rem', // 12px
    lineHeight: 1.4,
  },
  /** Hashes and IDs -- smallest, muted, meant to be scanned not read. */
  monoCaption: {
    ...monoBase,
    fontWeight: 400,
    fontSize: '0.6875rem', // 11px
    lineHeight: 1.35,
    letterSpacing: '0',
  },
  /** Metric tiles and the big verdict score in the decision drawer. */
  monoDisplay: {
    ...monoBase,
    fontWeight: 600,
    fontSize: '2rem', // 32px
    lineHeight: 1.15,
    letterSpacing: '-0.02em',
  },
  /** Between body and display: section-level figures, drawer sub-headers. */
  monoHeading: {
    ...monoBase,
    fontWeight: 600,
    fontSize: '1.125rem', // 18px
    lineHeight: 1.3,
    letterSpacing: '-0.015em',
  },
  h1: {
    fontWeight: 700,
    fontSize: '3rem', // 48px
    lineHeight: 1.5,
  },
  h2: {
    fontWeight: 700,
    fontSize: '2.625rem', // 42px
    lineHeight: 1.5,
  },
  h3: {
    fontWeight: 700,
    fontSize: '2rem', // 32px
    lineHeight: 1.5,
  },
  h4: {
    fontWeight: 700,
    fontSize: '1.75rem', // 28px
    lineHeight: 1.5,
  },
  h5: {
    fontWeight: 700,
    fontSize: '1.5rem', // 24px
    lineHeight: 1.5,
  },
  h6: {
    fontWeight: 700,
    fontSize: '1.3125rem', // 21px
    lineHeight: 1.4,
  },
  subtitle1: {
    fontWeight: 400,
    fontSize: '1rem', // 16px
    lineHeight: 1.3,
  },
  subtitle2: {
    fontWeight: 500,
    fontSize: '0.875rem', // 14px
    lineHeight: 1.3,
  },
  body1: {
    fontWeight: 400,
    fontSize: '1rem', // 16px
    lineHeight: 1.6,
  },
  body2: {
    fontWeight: 400,
    fontSize: '0.875rem', // 14px
    lineHeight: 1.6,
  },
  button: {
    fontWeight: 700,
    fontSize: '0.875rem', // 14px
    lineHeight: 1.286,
    textTransform: 'capitalize',
  },
  caption: {
    fontWeight: 400,
    fontSize: '0.75rem', // 12px
    lineHeight: 1.2,
  },
  overline: {
    fontWeight: 400,
    fontSize: '0.75rem', // 12px
    lineHeight: 1.2,
    textTransform: 'uppercase',
  },
};

export default typography;
