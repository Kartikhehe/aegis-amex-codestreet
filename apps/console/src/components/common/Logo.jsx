import { Link, Stack, Typography } from '@mui/material';
import paths from 'routes/paths';

/**
 * The AEGIS mark.
 *
 * A shield, because that is what the product is: the thing standing between an
 * autonomous agent and someone's account. Drawn in the brand blue, with the
 * wordmark set in the mono face so the identity matches the discipline used for
 * every number in the console.
 */
const Logo = ({ showName = true, sx, ...rest }) => (
  <Link
    href={paths.aegisFleet}
    underline="none"
    sx={{ display: 'flex', alignItems: 'center', gap: 1.25, ...sx }}
    {...rest}
  >
    <Stack
      component="svg"
      viewBox="0 0 24 26"
      sx={{ width: 22, height: 24, flexShrink: 0, display: 'block' }}
      aria-hidden
    >
      {/* shield outline */}
      <path
        d="M12 1.5 21.5 5v8.2c0 5.3-3.8 9.4-9.5 11.3C6.3 22.6 2.5 18.5 2.5 13.2V5L12 1.5Z"
        fill="var(--aegis-palette-primary-main)"
        fillOpacity="0.16"
        stroke="var(--aegis-palette-primary-main)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* the check: a decision was made, and it held */}
      <path
        d="m7.8 12.6 3 3 5.4-5.6"
        fill="none"
        stroke="var(--aegis-palette-primary-main)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Stack>

    {showName && (
      <Typography
        sx={(theme) => ({
          ...theme.typography.monoHeading,
          fontWeight: 700,
          letterSpacing: '0.14em',
          color: theme.vars.palette.text.primary,
          lineHeight: 1,
        })}
      >
        AEGIS
      </Typography>
    )}
  </Link>
);

export default Logo;
