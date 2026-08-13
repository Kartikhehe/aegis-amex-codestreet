import { Box } from '@mui/material';

/**
 * Monospace text.
 *
 * AEGIS design law: every number, hash, ID, score, latency and amount is set
 * in JetBrains Mono. Amounts that share a column must share a digit width, or
 * a reader cannot compare them at a glance.
 */
const Mono = ({ children, size = 'inherit', weight = 500, sx, ...rest }) => (
  <Box
    component="span"
    sx={{
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: size,
      fontWeight: weight,
      fontVariantNumeric: 'tabular-nums',
      ...sx,
    }}
    {...rest}
  >
    {children}
  </Box>
);

export default Mono;
