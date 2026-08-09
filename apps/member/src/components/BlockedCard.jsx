import { Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import { formatCurrency, formatDateTime } from '../aegis/format';

/**
 * The blocked-purchase card.
 *
 * A person who sees "declined" and no explanation assumes the system is
 * broken, or that they are. So this card gives one sentence of reason, and
 * puts the purpose they authorised right beside it -- the comparison is the
 * explanation. It also offers the one escape hatch that matters: this wasn't
 * me.
 */
const BlockedCard = ({ decision, onDispute, busy }) => (
  <Paper sx={{ p: 3 }}>
    <Stack spacing={2.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
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
            When
          </Typography>
          <Typography variant="monoSmall">{formatDateTime(decision.decided_at)}</Typography>
        </Stack>
      </Stack>

      <Button
        variant="text"
        disabled={busy}
        onClick={() => onDispute?.(decision)}
        sx={{ alignSelf: 'flex-start', px: 0, minHeight: 'auto' }}
      >
        {busy ? 'Opening…' : "This wasn't me →"}
      </Button>
    </Stack>
  </Paper>
);

export default BlockedCard;
