import { Box, Tooltip } from '@mui/material';
import { glossary } from 'aegis/glossary';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * The verdict chip.
 *
 * AEGIS design law: solid tinted background + 1px border + icon + label, in
 * the semantic colour for that verdict and nothing else. Semantic colour is
 * reserved for status in this product, so a green chip always means ALLOW --
 * it is never decorative.
 *
 * The icon matters as much as the colour: roughly one in twelve men has some
 * colour vision deficiency, and a red/green distinction carried by hue alone
 * would make the single most important signal in the product unreadable to
 * them.
 */

const VERDICTS = {
  ALLOW: {
    label: 'Allowed',
    icon: 'material-symbols:check-circle-rounded',
    palette: 'success',
  },
  DENY: {
    label: 'Denied',
    icon: 'material-symbols:block-rounded',
    palette: 'error',
  },
  STEP_UP: {
    label: 'Needs approval',
    icon: 'material-symbols:contact-support-rounded',
    palette: 'warning',
  },
  HOLD: {
    label: 'On hold',
    icon: 'material-symbols:pause-circle-rounded',
    palette: 'neutral',
  },
};

const SIZES = {
  small: { px: 0.75, py: 0.25, gap: 0.5, font: 'monoCaption', icon: 13, radius: 6 },
  medium: { px: 1, py: 0.5, gap: 0.625, font: 'monoSmall', icon: 15, radius: 7 },
  large: { px: 1.75, py: 1, gap: 1, font: 'monoHeading', icon: 24, radius: 10 },
};

const VerdictChip = ({ verdict, size = 'medium', showLabel = true, sx, ...rest }) => {
  const config = VERDICTS[verdict] ?? VERDICTS.HOLD;
  const dimensions = SIZES[size] ?? SIZES.medium;
  const isNeutral = config.palette === 'neutral';

  return (
    <Tooltip title={glossary[verdict] ?? ''} placement="top" enterDelay={400}>
      <Box
        sx={[
          (theme) => ({
            display: 'inline-flex',
            alignItems: 'center',
            gap: dimensions.gap,
            px: dimensions.px,
            py: dimensions.py,
            borderRadius: `${dimensions.radius}px`,
            border: '1px solid',
            whiteSpace: 'nowrap',
            lineHeight: 1,
            // Light mode: tinted wash behind the semantic text colour.
            backgroundColor: isNeutral
              ? theme.vars.palette.background.elevation2
              : `rgba(${theme.vars.palette[config.palette].mainChannel} / 0.12)`,
            borderColor: isNeutral
              ? theme.vars.palette.divider
              : `rgba(${theme.vars.palette[config.palette].mainChannel} / 0.32)`,
            color: isNeutral
              ? theme.vars.palette.text.secondary
              : theme.vars.palette[config.palette].main,
            // Dark mode: the specified near-solid chip grounds, which read as
            // deliberate surfaces rather than as translucent overlays.
            ...theme.applyStyles('dark', {
              backgroundColor: isNeutral
                ? theme.vars.palette.background.elevation2
                : `rgba(${theme.vars.palette[config.palette].mainChannel} / 0.16)`,
              borderColor: isNeutral
                ? theme.vars.palette.background.elevation4
                : `rgba(${theme.vars.palette[config.palette].mainChannel} / 0.42)`,
              color: isNeutral
                ? theme.vars.palette.text.secondary
                : theme.vars.palette[config.palette].light,
            }),
          }),
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...rest}
      >
        <IconifyIcon icon={config.icon} sx={{ fontSize: dimensions.icon, flexShrink: 0 }} />
        {showLabel && (
          <Box
            component="span"
            sx={(theme) => ({
              ...theme.typography[dimensions.font],
              fontWeight: 600,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            })}
          >
            {config.label}
          </Box>
        )}
      </Box>
    </Tooltip>
  );
};

export { VERDICTS };
export default VerdictChip;
