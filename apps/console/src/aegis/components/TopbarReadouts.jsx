import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { formatLatency, formatRate } from 'aegis/format';
import { glossary } from 'aegis/glossary';
import { useOverview } from 'aegis/hooks';
import { usePolicies } from 'aegis/hooks';

/**
 * Live readouts in the topbar: p99 · block rate · false-block · policy stage.
 *
 * These four numbers answer "is the system healthy and what is it enforcing?"
 * without leaving whatever screen you are on. They are mono, because they are
 * facts, and they are always visible, because a governance console that hides
 * its own health is asking to be trusted rather than checked.
 */

const Readout = ({ label, value, term, tone = 'default' }) => (
  <Tooltip title={glossary[term] ?? ''} placement="bottom" enterDelay={300}>
    {/* Explicit block layout: as inline spans the caption and the value ran
        together into "P990 ms". */}
    <Box sx={{ cursor: 'help', minWidth: 0, lineHeight: 1.35 }}>
      <Typography
        component="div"
        variant="monoCaption"
        sx={{
          display: 'block',
          color: 'text.disabled',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Typography>
      <Typography
        component="div"
        variant="monoSmall"
        sx={{
          display: 'block',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          color:
            tone === 'danger' ? 'error.main' : tone === 'warning' ? 'warning.main' : 'text.primary',
        }}
      >
        {value}
      </Typography>
    </Box>
  </Tooltip>
);

const StagePill = ({ stage }) => {
  const enforcing = stage === 'enforcing';
  return (
    <Tooltip
      title={enforcing ? 'The live policy is deciding real transactions.' : glossary.shadow_mode}
      placement="bottom"
    >
      <Box
        sx={(theme) => ({
          px: 1.25,
          py: 0.5,
          borderRadius: '999px',
          border: '1px solid',
          cursor: 'help',
          whiteSpace: 'nowrap',
          ...theme.typography.monoCaption,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: enforcing ? theme.vars.palette.success.main : theme.vars.palette.warning.main,
          borderColor: enforcing
            ? `rgba(${theme.vars.palette.success.mainChannel} / 0.4)`
            : `rgba(${theme.vars.palette.warning.mainChannel} / 0.4)`,
          backgroundColor: enforcing
            ? `rgba(${theme.vars.palette.success.mainChannel} / 0.12)`
            : `rgba(${theme.vars.palette.warning.mainChannel} / 0.12)`,
        })}
      >
        {enforcing ? 'Enforcing' : 'Shadow'}
      </Box>
    </Tooltip>
  );
};

const TopbarReadouts = () => {
  const { data } = useOverview(24);
  const { data: policies } = usePolicies();

  const shadowPolicy = (policies ?? []).find((p) => p.stage === 'shadow');
  const stage = shadowPolicy ? 'shadow' : (data?.policy_stage ?? 'enforcing');

  const blockRate = data?.block_rate ?? 0;
  const falseBlockRate = data?.false_block_rate ?? 0;

  return (
    <Stack
      direction="row"
      spacing={{ xs: 2, lg: 3 }}
      alignItems="center"
      sx={{
        // Below lg the topbar belongs to navigation; these readouts move into
        // the Fleet Overview header rather than crowding it.
        display: { xs: 'none', lg: 'flex' },
        px: 2,
        py: 0.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.elevation2',
      }}
    >
      <Readout label="p99" value={formatLatency(data?.p99_latency_ms ?? 0)} term="p99_latency" />
      <Readout
        label="Block rate"
        value={formatRate(blockRate)}
        term="DENY"
        tone={blockRate > 0.35 ? 'warning' : 'default'}
      />
      <Readout
        label="False block"
        value={formatRate(falseBlockRate)}
        term="false_block"
        tone={falseBlockRate > 0.15 ? 'warning' : 'default'}
      />
      <StagePill stage={stage} />
    </Stack>
  );
};

export default TopbarReadouts;
