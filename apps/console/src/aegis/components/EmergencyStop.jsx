import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useLiveFleetState } from 'aegis/firestoreHooks';
import { useFleetState, useRearmFleet, useRefreshAll, useStopFleet } from 'aegis/hooks';
import { useSnackbar } from 'notistack';
import IconifyIcon from 'components/base/IconifyIcon';
import Mono from './Mono';

/**
 * The emergency stop, pinned to the sidebar footer.
 *
 * Two asymmetries are deliberate:
 *
 *   Stopping is ONE step behind a typed confirmation and a reason. It must be
 *   fast, because the moment you need it you need it now -- but not so fast
 *   that a misclick halts a fleet, and never without a recorded reason.
 *
 *   Re-arming needs TWO DIFFERENT operators. A control one person can switch
 *   off alone is not a control: the same person who panicked, or whose account
 *   was compromised, could quietly undo it.
 */
const EmergencyStop = ({ collapsed = false }) => {
  const { data: state, mutate } = useLiveFleetState(useFleetState());
  const { trigger: stop, isMutating: stopping } = useStopFleet();
  const { trigger: rearm, isMutating: rearming } = useRearmFleet();
  const refreshAll = useRefreshAll();
  const { enqueueSnackbar } = useSnackbar();

  const [stopOpen, setStopOpen] = useState(false);
  const [rearmOpen, setRearmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const stopped = Boolean(state?.stopped);
  const approvals = state?.rearm_approvals ?? [];
  const required = state?.approvals_required ?? 2;

  const handleStop = async () => {
    try {
      await stop({ reason: reason.trim() });
      await mutate();
      refreshAll();
      setStopOpen(false);
      setReason('');
      setConfirmText('');
      enqueueSnackbar('Fleet stopped. Every agent is now denied.', { variant: 'error' });
    } catch (error) {
      enqueueSnackbar(error?.data?.detail ?? 'Could not stop the fleet.', { variant: 'error' });
    }
  };

  const handleRearm = async () => {
    try {
      const result = await rearm();
      await mutate();
      refreshAll();
      enqueueSnackbar(result?.message ?? 'Approval recorded.', {
        variant: result?.rearmed ? 'success' : 'info',
      });
      if (result?.rearmed) setRearmOpen(false);
    } catch (error) {
      enqueueSnackbar(error?.data?.detail ?? 'Could not re-arm.', { variant: 'error' });
    }
  };

  return (
    <>
      <Box sx={{ p: collapsed ? 1 : 2, pt: 1 }}>
        <Button
          fullWidth
          variant={stopped ? 'outlined' : 'contained'}
          color="error"
          onClick={() => (stopped ? setRearmOpen(true) : setStopOpen(true))}
          startIcon={
            !collapsed && (
              <IconifyIcon
                icon={
                  stopped
                    ? 'material-symbols:lock-open-rounded'
                    : 'material-symbols:pan-tool-rounded'
                }
              />
            )
          }
          sx={[
            {
              minWidth: 0,
              px: collapsed ? 1 : 2,
              py: 1.25,
              fontWeight: 700,
              letterSpacing: '0.04em',
            },
            // A stopped fleet pulses continuously. This is the one place a
            // persistent animation is right: the state is abnormal and must
            // not be possible to forget.
            stopped && {
              animation: 'aegisStopPulse 2s ease-in-out infinite',
              '@keyframes aegisStopPulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.55 },
              },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            },
          ]}
        >
          {collapsed ? (
            <IconifyIcon
              icon={
                stopped ? 'material-symbols:lock-open-rounded' : 'material-symbols:pan-tool-rounded'
              }
              sx={{ fontSize: 20 }}
            />
          ) : stopped ? (
            'RE-ARM FLEET'
          ) : (
            'EMERGENCY STOP'
          )}
        </Button>

        {!collapsed && stopped && (
          <Typography
            variant="monoCaption"
            sx={{ display: 'block', mt: 1, color: 'error.main', textAlign: 'center' }}
          >
            {approvals.length}/{required} approvals
          </Typography>
        )}
      </Box>

      {/* ---- Stop confirmation ---------------------------------------- */}
      <Dialog open={stopOpen} onClose={() => setStopOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <IconifyIcon icon="material-symbols:pan-tool-rounded" sx={{ color: 'error.main' }} />
          Stop the entire fleet?
        </DialogTitle>
        <DialogContent>
          <Alert severity="error" variant="outlined" sx={{ mb: 2.5 }}>
            Every agent, across every operator, will be denied immediately. In-flight purchases will
            not complete. Re-arming requires approval from <strong>two different operators</strong>.
          </Alert>

          <TextField
            fullWidth
            multiline
            rows={2}
            label="Why are you stopping the fleet?"
            placeholder="e.g. Suspected credential compromise at operator NorthStar"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            sx={{ mb: 2.5 }}
            helperText="Recorded against the stop. Whoever re-arms will read this."
          />

          <TextField
            fullWidth
            label="Type STOP to confirm"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            slotProps={{ input: { sx: (theme) => theme.typography.mono } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button variant="text" color="neutral" onClick={() => setStopOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={confirmText !== 'STOP' || reason.trim().length < 3 || stopping}
            onClick={handleStop}
          >
            {stopping ? 'Stopping…' : 'Stop the fleet'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Re-arm, two-approval ------------------------------------- */}
      <Dialog open={rearmOpen} onClose={() => setRearmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Re-arm the fleet</DialogTitle>
        <DialogContent>
          {state?.stop_reason && (
            <Alert severity="warning" variant="outlined" sx={{ mb: 2.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                Stopped by {state.stopped_by}
              </Typography>
              <Typography variant="body2">{state.stop_reason}</Typography>
            </Alert>
          )}

          <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
            Re-arming requires <strong>{required} approvals from different operators</strong>. Your
            approval is recorded against your signed-in account.
          </Typography>

          <Stack spacing={1}>
            {Array.from({ length: required }).map((_, index) => {
              const approver = approvals[index];
              return (
                <Stack
                  key={index}
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  sx={(theme) => ({
                    p: 1.5,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: approver ? 'success.main' : theme.vars.palette.divider,
                    backgroundColor: theme.vars.palette.background.elevation2,
                  })}
                >
                  <IconifyIcon
                    icon={
                      approver
                        ? 'material-symbols:check-circle-rounded'
                        : 'material-symbols:radio-button-unchecked'
                    }
                    sx={{ color: approver ? 'success.main' : 'text.disabled', fontSize: 20 }}
                  />
                  <Mono
                    variant="monoSmall"
                    sx={{ color: approver ? 'text.primary' : 'text.disabled' }}
                  >
                    {approver ?? `Approval ${index + 1} — awaiting a different operator`}
                  </Mono>
                </Stack>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button variant="text" color="neutral" onClick={() => setRearmOpen(false)}>
            Close
          </Button>
          <Button variant="contained" onClick={handleRearm} disabled={rearming}>
            {rearming ? 'Recording…' : 'Approve re-arm'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default EmergencyStop;
