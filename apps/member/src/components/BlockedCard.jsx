import { Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import { formatCurrency, formatDateTime } from '../aegis/format';

/**
 * A purchase AEGIS blocked, explained to the person whose card it is.
 *
 * Someone who sees "declined" with no explanation assumes the system is broken,
 * or that they are. So this gives one sentence of reason and the authority it
 * was measured against -- the comparison IS the explanation.
 *
 * Two different escape hatches, deliberately not merged:
 *
 *   "I did want this"  -- the block was wrong. This is the only source of a
 *                         false-block rate over real traffic, because nobody
 *                         labels a live purchase as legitimate in advance.
 *                         It goes to an operator to confirm; a member alone
 *                         cannot move a published metric.
 *   "This wasn't me"   -- suspected fraud. A different problem with a different
 *                         remedy, and conflating the two would lose both.
 */
const BlockedCard = ({ decision, onDispute, onReport, busy }) => {
  const reported = decision.block_report;
  const confirmed = decision.block_report_confirmed;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 3 }}>
      <Stack spacing={2.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Chip size="small" color="error" variant="filled" label="Blocked" />
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            {formatDateTime(decision.decided_at)}
          </Typography>
        </Stack>

        <Typography variant="body1" sx={{ lineHeight: 1.6, fontWeight: 500 }}>
          {decision.human_readable_reason}
        </Typography>

        <Divider />

        <Stack spacing={1.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Merchant
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>
              {decision.merchant_name}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Amount
            </Typography>
            <Typography variant="mono" sx={{ fontWeight: 700 }}>
              {formatCurrency(decision.amount)}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Nothing was charged
            </Typography>
            <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 600 }}>
              Confirmed
            </Typography>
          </Stack>
        </Stack>

        <Divider />

        {/* Already answered: show the state rather than asking again. */}
        {reported ? (
          <Box
            sx={(theme) => ({
              p: 1.75,
              borderRadius: 2,
              backgroundColor: theme.vars.palette.background.elevation2,
            })}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {reported === 'wrong'
                ? confirmed === true
                  ? 'Confirmed as a wrong block'
                  : confirmed === false
                    ? 'Reviewed — the block was correct'
                    : 'You reported this as wrong'
                : 'You agreed this block was right'}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {reported === 'wrong' && confirmed == null
                ? 'A reviewer is looking at it. Blocks confirmed as wrong are counted and used to tune what your agents may do.'
                : 'Thank you — this helps us judge how often we get it wrong.'}
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1.25}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Did you want this purchase?
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button
                fullWidth
                size="medium"
                variant="outlined"
                disabled={busy}
                onClick={() => onReport?.(decision, 'wrong')}
              >
                Yes — this was fine
              </Button>
              <Button
                fullWidth
                size="medium"
                variant="outlined"
                color="neutral"
                disabled={busy}
                onClick={() => onReport?.(decision, 'correct')}
              >
                No — good block
              </Button>
            </Stack>
          </Stack>
        )}

        <Button
          variant="text"
          size="small"
          disabled={busy}
          onClick={() => onDispute?.(decision)}
          sx={{ alignSelf: 'flex-start', px: 0, minHeight: 'auto', color: 'text.secondary' }}
        >
          {busy ? 'Opening…' : "This wasn't me — report fraud"}
        </Button>
      </Stack>
    </Paper>
  );
};

export default BlockedCard;
