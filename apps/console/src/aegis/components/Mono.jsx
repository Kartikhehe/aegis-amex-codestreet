import { Box, Tooltip, Typography } from '@mui/material';
import { truncateHash } from 'aegis/format';

/**
 * Mono primitives.
 *
 * AEGIS design law: EVERY number, hash, ID, score, latency and amount is set
 * in JetBrains Mono. These components exist so a screen asks for `<Mono>` or
 * `<Hash>` rather than reaching for a font family -- which is what keeps the
 * rule from eroding one component at a time.
 */

/** Any figure. `variant` picks the registered mono scale. */
export const Mono = ({ children, variant = 'mono', color, sx, ...rest }) => (
  <Typography component="span" variant={variant} color={color} sx={sx} {...rest}>
    {children}
  </Typography>
);

/**
 * A hash or long identifier. Truncated head…tail, full value on hover, and
 * click-to-copy -- an auditor comparing two hashes needs the whole string.
 */
export const Hash = ({ value, head = 6, tail = 4, variant = 'monoCaption', sx, ...rest }) => {
  if (!value) return <Mono variant={variant}>—</Mono>;

  const copy = async (event) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(value));
    } catch {
      // Clipboard is unavailable outside a secure context. The tooltip still
      // shows the full value, so the user is not stuck.
    }
  };

  return (
    <Tooltip title={`${value} — click to copy`} placement="top">
      <Box
        component="span"
        onClick={copy}
        sx={[
          {
            cursor: 'pointer',
            color: 'text.secondary',
            transition: 'color 120ms ease',
            '&:hover': { color: 'text.primary' },
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        <Mono variant={variant} {...rest}>
          {truncateHash(value, head, tail)}
        </Mono>
      </Box>
    </Tooltip>
  );
};

export default Mono;
