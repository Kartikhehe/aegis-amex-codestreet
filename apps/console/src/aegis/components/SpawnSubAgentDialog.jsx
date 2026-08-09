import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { formatCurrency } from 'aegis/format';
import { useCreateAgent } from 'aegis/hooks';
import { useSnackbar } from 'notistack';
import IconifyIcon from 'components/base/IconifyIcon';
import Mono from './Mono';

/**
 * Spawn a sub-agent.
 *
 * The submit runs the real can_issue() check server-side. If the requested
 * mandate exceeds the parent on any dimension, NOTHING is created and every
 * violating dimension comes back named, with both values. That is the whole
 * point: an operator who over-reaches should learn exactly which dimension and
 * by how much, not just that they were refused.
 *
 * The parent's ceilings are shown beside each field so the constraint is
 * visible while typing rather than discovered on submit.
 */

const ViolationList = ({ violations }) => (
  <Alert
    severity="error"
    variant="outlined"
    icon={<IconifyIcon icon="material-symbols:block-rounded" />}
    sx={{ mb: 2.5 }}
  >
    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
      Rejected — nothing was created
    </Typography>
    <Stack spacing={1.25}>
      {violations.map((violation) => (
        <Stack key={violation.dimension} spacing={0.25}>
          <Mono variant="monoSmall" sx={{ fontWeight: 700, color: 'error.main' }}>
            {violation.dimension}
          </Mono>
          <Typography variant="body2">{violation.message}</Typography>
          <Stack direction="row" spacing={2}>
            <Typography variant="monoCaption" sx={{ color: 'text.secondary' }}>
              parent: {violation.parent_value}
            </Typography>
            <Typography variant="monoCaption" sx={{ color: 'error.main' }}>
              requested: {violation.requested_value}
            </Typography>
          </Stack>
        </Stack>
      ))}
    </Stack>
  </Alert>
);

const SpawnSubAgentDialog = ({ open, onClose, parent, onCreated }) => {
  const { trigger: createAgent, isMutating } = useCreateAgent();
  const { enqueueSnackbar } = useSnackbar();
  const [violations, setViolations] = useState([]);

  const parentMandate = parent?.mandate ?? {};
  const [form, setForm] = useState({
    name: '',
    purpose: '',
    per_transaction_ceiling: '',
    daily_ceiling: '',
    max_transactions_per_day: '',
  });

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const handleSubmit = async () => {
    setViolations([]);
    try {
      const created = await createAgent({
        name: form.name.trim(),
        parent_agent_id: parent.agent_id,
        mandate: {
          purpose: form.purpose.trim() || `${parentMandate.purpose} (delegated)`,
          permitted_categories: parentMandate.permitted_categories ?? [],
          // Prohibitions are inherited wholesale: a child may add "never"s but
          // may never drop one, and the UI should not invite the attempt.
          prohibited_attributes: parentMandate.prohibited_attributes ?? [],
          permitted_merchants: parentMandate.permitted_merchants ?? null,
          per_transaction_ceiling: Number(form.per_transaction_ceiling || 0),
          daily_ceiling: Number(form.daily_ceiling || 0),
          max_transactions_per_day: Number(form.max_transactions_per_day || 0),
          max_delegation_depth: Math.max((parentMandate.max_delegation_depth ?? 1) - 1, 0),
          expires_at: parentMandate.expires_at ?? null,
        },
      });
      enqueueSnackbar(`Sub-agent created — ${created.name}`, { variant: 'success' });
      onCreated?.(created);
      onClose();
    } catch (error) {
      const detail = error?.data?.detail;
      if (detail?.violations) {
        setViolations(detail.violations);
      } else {
        enqueueSnackbar(typeof detail === 'string' ? detail : 'Could not create the sub-agent.', {
          variant: 'error',
        });
      }
    }
  };

  const canDelegate = (parentMandate.max_delegation_depth ?? 0) > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Spawn a sub-agent</DialogTitle>
      <DialogContent>
        {!canDelegate && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 2.5 }}>
            This agent's mandate does not permit delegation, so any sub-agent will be rejected at
            issuance.
          </Alert>
        )}

        {violations.length > 0 && <ViolationList violations={violations} />}

        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5 }}>
          A sub-agent can only ever hold <strong>less</strong> authority than its parent. Every
          dimension is checked before anything is created.
        </Typography>

        <Grid container spacing={2}>
          <Grid size={12}>
            <TextField
              fullWidth
              label="Name"
              placeholder="e.g. Produce top-ups"
              value={form.name}
              onChange={update('name')}
            />
          </Grid>
          <Grid size={12}>
            <TextField
              fullWidth
              multiline
              rows={2}
              label="Purpose"
              placeholder={parentMandate.purpose}
              value={form.purpose}
              onChange={update('purpose')}
              helperText="Plain language. The card member reads this."
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              type="number"
              label="Per-transaction ceiling"
              value={form.per_transaction_ceiling}
              onChange={update('per_transaction_ceiling')}
              helperText={`Parent: ${formatCurrency(parentMandate.per_transaction_ceiling ?? 0)}`}
              slotProps={{ input: { sx: (theme) => theme.typography.mono } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              type="number"
              label="Daily ceiling"
              value={form.daily_ceiling}
              onChange={update('daily_ceiling')}
              helperText={`Parent: ${formatCurrency(parentMandate.daily_ceiling ?? 0)}`}
              slotProps={{ input: { sx: (theme) => theme.typography.mono } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              type="number"
              label="Transactions per day"
              value={form.max_transactions_per_day}
              onChange={update('max_transactions_per_day')}
              helperText={`Parent: ${parentMandate.max_transactions_per_day ?? 0}`}
              slotProps={{ input: { sx: (theme) => theme.typography.mono } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box
              sx={(theme) => ({
                p: 1.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: theme.vars.palette.divider,
                backgroundColor: theme.vars.palette.background.elevation2,
              })}
            >
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                Inherited prohibitions
              </Typography>
              <Typography variant="monoCaption" sx={{ display: 'block', color: 'error.main' }}>
                {(parentMandate.prohibited_attributes ?? []).join(', ') || 'none'}
              </Typography>
            </Box>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="text" color="neutral" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={isMutating || form.name.trim().length < 2}
        >
          {isMutating ? 'Checking…' : 'Create sub-agent'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SpawnSubAgentDialog;
