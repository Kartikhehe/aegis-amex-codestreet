import { useState } from 'react';
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { formatCurrency, formatRelative } from '../aegis/format';

/**
 * The step-up approval card.
 *
 * This is the moment the whole platform exists for: a person deciding, in a
 * few seconds, whether an agent may spend their money. Everything here serves
 * that decision.
 *
 *   * The amount is the largest thing on the card.
 *   * The reason states the tension plainly -- above your limit, BUT it matches
 *     what you authorised -- because hiding the "but" would be manipulative in
 *     one direction and useless in the other.
 *   * "Always allow" is offered but is not the primary button. Making the
 *     broadest permission the easiest tap is a dark pattern.
 */
const StepUpCard = ({ decision, onResolve, busy }) => {
  const [choice, setChoice] = useState(null);

  const handle = async (value) => {
    setChoice(value);
    try {
      await onResolve(value);
    } finally {
      setChoice(null);
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Stack spacing={2.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Chip size="small" color="warning" variant="filled" label="Needs your approval" />
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            {formatRelative(decision.decided_at)}
          </Typography>
        </Stack>

        <Stack spacing={0.5}>
          <Typography variant="monoDisplay" sx={{ fontWeight: 700 }}>
            {formatCurrency(decision.amount)}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {decision.merchant_name}
          </Typography>
        </Stack>

        {/* The engine's own member-readable sentence, verbatim. */}
        <Typography variant="body1" sx={{ lineHeight: 1.6 }}>
          {decision.human_readable_reason}
        </Typography>

        <Stack spacing={1.25} sx={{ pt: 0.5 }}>
          <Button
            fullWidth
            size="large"
            variant="contained"
            disabled={busy}
            onClick={() => handle('approve_once')}
          >
            {choice === 'approve_once' ? 'Approving…' : 'Approve this once'}
          </Button>

          <Stack direction="row" spacing={1.25}>
            <Button
              fullWidth
              variant="outlined"
              color="inherit"
              disabled={busy}
              onClick={() => handle('decline')}
              sx={{ borderColor: 'divider' }}
            >
              {choice === 'decline' ? 'Declining…' : 'Decline'}
            </Button>
            <Button
              fullWidth
              variant="outlined"
              color="inherit"
              disabled={busy}
              onClick={() => handle('always_allow')}
              sx={{ borderColor: 'divider' }}
            >
              {choice === 'always_allow' ? 'Saving…' : 'Always allow'}
            </Button>
          </Stack>
        </Stack>

        <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center' }}>
          Nothing has been charged yet.
        </Typography>
      </Stack>
    </Paper>
  );
};

export default StepUpCard;
