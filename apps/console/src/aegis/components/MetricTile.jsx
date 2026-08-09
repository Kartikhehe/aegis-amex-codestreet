import { Box, Paper, Tooltip, Typography } from '@mui/material';
import { formatCurrency, formatCurrencyCompact, formatNumber } from 'aegis/format';
import { useCountUp } from 'aegis/motion';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * A metric tile.
 *
 * Signature motion moment #3: the figure counts up on first load and flashes
 * when it changes. Counting up once tells you the number is live; re-counting
 * on every poll would make it unreadable, so a change snaps and tints instead.
 *
 * Laid out as an explicit two-row block rather than a Stack, so the label can
 * never end up sharing a line with the value -- a caption butted against a
 * 32px figure reads as one broken string ("DECISIONS989").
 */
const MetricTile = ({ tile, icon, tone = 'default' }) => {
  const isCurrency = tile.unit === 'INR';
  const { value, changed } = useCountUp(tile.value);

  const display = isCurrency
    ? tile.value >= 100000
      ? formatCurrencyCompact(value)
      : formatCurrency(Math.round(value))
    : formatNumber(Math.round(value));

  const toneColor =
    tone === 'danger' ? 'error.main' : tone === 'warning' ? 'warning.main' : 'text.primary';

  return (
    <Paper sx={{ p: { xs: 2, md: 2.5 }, height: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          mb: 1.5,
        }}
      >
        <Tooltip title={tile.tooltip ?? ''} placement="top" enterDelay={300}>
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              lineHeight: 1.4,
              cursor: tile.tooltip ? 'help' : 'default',
            }}
          >
            {tile.label}
          </Typography>
        </Tooltip>
        {icon && (
          <IconifyIcon
            icon={icon}
            sx={{
              fontSize: 18,
              flexShrink: 0,
              color: tone === 'default' ? 'text.disabled' : toneColor,
            }}
          />
        )}
      </Box>

      <Typography
        variant="monoDisplay"
        sx={{
          display: 'block',
          color: toneColor,
          transition: 'color 300ms ease',
          ...(changed && {
            animation: 'aegisMetricFlash 600ms ease-out 1',
            '@keyframes aegisMetricFlash': {
              '0%': { color: 'var(--aegis-palette-primary-main)' },
              '100%': { color: 'inherit' },
            },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }),
        }}
      >
        {display}
      </Typography>
    </Paper>
  );
};

export default MetricTile;
