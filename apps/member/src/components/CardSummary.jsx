import { Box, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import { formatCurrency } from '../aegis/format';

/**
 * The standing answer to "what is happening with my card?".
 *
 * On a phone this sits above the list; on a wide screen it is a sidebar that
 * stays visible while the member works through the list. Either way it exists
 * because the tabs alone answer "what needs me now?" and never "is this thing
 * generally under control?" -- which is the question somebody handing a card
 * to software actually has.
 *
 * Every number is derived from decisions already loaded. No extra request, and
 * nothing here can disagree with the list beside it.
 */
const Stat = ({ label, value, tone = 'text.primary', hint }) => (
  <Stack spacing={0.25}>
    <Typography variant="caption" sx={{ color: 'text.disabled' }}>
      {label}
    </Typography>
    <Typography variant="mono" sx={{ fontSize: '1.35rem', fontWeight: 700, color: tone }}>
      {value}
    </Typography>
    {hint && (
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {hint}
      </Typography>
    )}
  </Stack>
);

const CardSummary = ({ decisions = [], agents = [], pending = 0 }) => {
  const allowed = decisions.filter((d) => d.verdict === 'ALLOW');
  const blocked = decisions.filter((d) => d.verdict === 'DENY');
  const spent = allowed.reduce((total, d) => total + Number(d.amount ?? 0), 0);
  const activeAgents = agents.filter((a) => a.status === 'active');
  const pausedAgents = agents.filter((a) => a.status !== 'active');

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 3 }}>
      <Stack spacing={2.5}>
        <Stack spacing={0.5}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Your card
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Across everything your agents have tried recently.
          </Typography>
        </Stack>

        {/* A grid, not a wrapping row: three stats of unequal label length
            wrap into a ragged shape that reads as broken rather than dense. */}
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', md: 'repeat(2, 1fr)' },
          }}
        >
          <Stat
            label="Approved"
            value={formatCurrency(spent)}
            hint={`${allowed.length} purchases`}
          />
          <Stat
            label="Blocked"
            value={String(blocked.length)}
            tone={blocked.length ? 'error.main' : 'text.primary'}
            hint="nothing charged"
          />
          <Stat
            label="Waiting for you"
            value={String(pending)}
            tone={pending ? 'warning.main' : 'text.primary'}
            hint={pending ? 'needs a decision' : 'all clear'}
          />
        </Box>

        <Divider />

        <Stack spacing={1}>
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            Agents on your card
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Chip
              size="small"
              variant="outlined"
              color="success"
              label={`${activeAgents.length} active`}
            />
            {pausedAgents.length > 0 && (
              <Chip
                size="small"
                variant="outlined"
                color="neutral"
                label={`${pausedAgents.length} paused`}
              />
            )}
          </Stack>
        </Stack>

        <Box
          sx={(theme) => ({
            p: 1.75,
            borderRadius: 2,
            backgroundColor: theme.vars.palette.background.elevation2,
          })}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
            Every purchase is checked against limits you set before any money
            moves. You can pause any agent at any time.
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
};

export default CardSummary;
