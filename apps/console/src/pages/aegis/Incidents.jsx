import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ChainStrip from 'aegis/components/ChainStrip';
import EmptyState from 'aegis/components/EmptyState';
import LedgerChain from 'aegis/components/LedgerChain';
import Mono from 'aegis/components/Mono';
import PageHeader from 'aegis/components/PageHeader';
import Term from 'aegis/components/Term';
import { formatDateTime, formatRelative } from 'aegis/format';
import { useDisputes, useIncidents, useVerify } from 'aegis/hooks';
import { useSnackbar } from 'notistack';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * INCIDENTS & DISPUTES — "Can I prove it?"
 *
 * Everything else in the console describes what the system decided. This
 * screen is where those claims are tested: the chain either verifies or it
 * names the row where it broke, and a dispute either produces a numbered
 * document derived from stored records or it does not.
 */

const SEVERITY_COLOR = { critical: 'error', warning: 'warning', info: 'info' };

const IncidentRow = ({ incident }) => (
  <Stack
    direction="row"
    spacing={1.5}
    alignItems="flex-start"
    sx={(theme) => ({
      p: 2,
      borderRadius: 2,
      border: '1px solid',
      borderColor: incident.suspected_prompt_injection
        ? `rgba(${theme.vars.palette.error.mainChannel} / 0.5)`
        : theme.vars.palette.divider,
      backgroundColor: incident.suspected_prompt_injection
        ? `rgba(${theme.vars.palette.error.mainChannel} / 0.1)`
        : theme.vars.palette.background.elevation2,
    })}
  >
    <IconifyIcon
      icon={
        incident.suspected_prompt_injection
          ? 'material-symbols:e911-emergency-rounded'
          : 'material-symbols:electric-bolt-outline-rounded'
      }
      sx={{
        fontSize: 20,
        mt: 0.25,
        flexShrink: 0,
        color: SEVERITY_COLOR[incident.severity]
          ? `${SEVERITY_COLOR[incident.severity]}.main`
          : 'text.disabled',
      }}
    />

    <Stack spacing={0.75} sx={{ minWidth: 0, flex: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 700,
            color: incident.suspected_prompt_injection ? 'error.main' : 'text.primary',
          }}
        >
          {incident.title}
        </Typography>
        {incident.suspected_prompt_injection && (
          <Chip
            size="small"
            variant="soft"
            color="error"
            label={<Term term="prompt_injection">injection</Term>}
          />
        )}
        <Chip
          size="small"
          variant="soft"
          color="neutral"
          label={<Mono variant="monoCaption">{incident.breaker}</Mono>}
        />
      </Stack>

      <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
        {incident.detail}
      </Typography>

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <Typography variant="monoCaption" sx={{ color: 'text.disabled' }}>
          {incident.agent_name || incident.agent_id || incident.operator_id}
        </Typography>
        <Typography variant="monoCaption" sx={{ color: 'text.disabled' }}>
          {formatRelative(incident.created_at)}
        </Typography>
      </Stack>
    </Stack>
  </Stack>
);

/** The numbered evidence document. */
const PacketDialog = ({ open, onClose, packet }) => (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Stack>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Dispute packet
        </Typography>
        {packet && (
          <Mono variant="monoCaption" sx={{ color: 'text.disabled' }}>
            {packet.packet_id}
          </Mono>
        )}
      </Stack>
      <Stack direction="row" spacing={1}>
        {packet && (
          <Button
            size="small"
            variant="outlined"
            color="neutral"
            startIcon={<IconifyIcon icon="material-symbols:download-rounded" />}
            onClick={() => {
              const blob = new Blob([JSON.stringify(packet, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `aegis-dispute-${packet.dispute_id.slice(0, 8)}.json`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            JSON
          </Button>
        )}
        <IconButton size="small" onClick={onClose}>
          <IconifyIcon icon="material-symbols:close-rounded" />
        </IconButton>
      </Stack>
    </DialogTitle>

    <DialogContent dividers>
      {packet && (
        <Stack spacing={3}>
          {packet.sections.map((section) => (
            <Stack key={section.number} spacing={1}>
              <Stack direction="row" spacing={1.25} alignItems="baseline">
                <Mono variant="monoSmall" sx={{ color: 'primary.main', fontWeight: 700 }}>
                  {String(section.number).padStart(2, '0')}
                </Mono>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {section.title}
                </Typography>
              </Stack>

              <Stack spacing={0.5} sx={{ pl: 3.5 }}>
                {Object.entries(section.fields).map(([label, value]) => (
                  <Stack
                    key={label}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={{ xs: 0, sm: 2 }}
                    justifyContent="space-between"
                  >
                    <Typography variant="body2" sx={{ color: 'text.secondary', flexShrink: 0 }}>
                      {label}
                    </Typography>
                    <Mono
                      variant="monoSmall"
                      sx={{ textAlign: { sm: 'right' }, wordBreak: 'break-word' }}
                    >
                      {String(value)}
                    </Mono>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          ))}

          <Divider />

          {/* Liability, with its derivation shown so it can be checked. */}
          <Stack spacing={1}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              <Term term="liability">Liability derivation</Term>
            </Typography>
            <Stack spacing={0.5} sx={{ pl: 1 }}>
              {(packet.liability.derivation ?? []).map((step, index) => (
                <Mono
                  key={index}
                  variant="monoSmall"
                  sx={{ color: step.startsWith('->') ? 'primary.main' : 'text.secondary' }}
                >
                  {step}
                </Mono>
              ))}
            </Stack>
          </Stack>
        </Stack>
      )}
    </DialogContent>
  </Dialog>
);

const Incidents = () => {
  const { data: incidents } = useIncidents({ limit: 50 });
  const { data: disputes, mutate: refetchDisputes } = useDisputes();
  const { data: verification, mutate: reverify, isValidating } = useVerify();
  const { enqueueSnackbar } = useSnackbar();

  const [packet, setPacket] = useState(null);
  const [packetOpen, setPacketOpen] = useState(false);
  const [buildingId, setBuildingId] = useState(null);

  const buildFor = async (dispute) => {
    setBuildingId(dispute.dispute_id);
    try {
      // useSWRMutation is keyed per dispute, so call the endpoint directly via
      // the same fetcher rather than mounting a hook per row.
      const axiosFetcher = (await import('services/axios/axiosFetcher')).default;
      const endpoints = (await import('aegis/api')).default;
      const result = await axiosFetcher([
        endpoints.disputePacket(dispute.dispute_id),
        { method: 'post' },
      ]);
      setPacket(result);
      setPacketOpen(true);
      refetchDisputes();
    } catch (error) {
      enqueueSnackbar(error?.data?.detail ?? 'Could not build the packet.', { variant: 'error' });
    } finally {
      setBuildingId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Incidents & disputes"
        question="Can I prove it?"
        actions={
          <Button
            variant="contained"
            onClick={() => reverify()}
            disabled={isValidating}
            startIcon={<IconifyIcon icon="material-symbols:verified-outline-rounded" />}
          >
            {isValidating ? 'Verifying…' : 'Verify ledger'}
          </Button>
        }
      />

      <Grid container spacing={{ xs: 2, md: 3 }}>
        {/* ---- ledger verification -------------------------------------- */}
        <Grid size={12}>
          <Paper sx={{ p: 2.5 }}>
            <Stack spacing={0.25} sx={{ mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                <Term term="ledger">Ledger verification</Term>
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Every record is recomputed from its contents and the record before it.
              </Typography>
            </Stack>
            <ChainStrip result={verification} active={Boolean(verification)} />
            <Box sx={{ mt: 2 }}>
              <LedgerChain verification={verification} />
            </Box>
          </Paper>
        </Grid>

        {/* ---- compliance events ---------------------------------------- */}
        <Grid size={{ xs: 12, lg: 7 }}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              Compliance events
            </Typography>

            {(incidents ?? []).length === 0 ? (
              <EmptyState
                icon="material-symbols:shield-outline-rounded"
                title="No compliance events"
                body="Circuit breakers record an event here when an agent's behaviour degrades as a pattern. A conformance collapse is flagged as suspected prompt injection."
              />
            ) : (
              <Stack spacing={1.25}>
                {incidents.map((incident) => (
                  <IncidentRow key={incident.event_id} incident={incident} />
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>

        {/* ---- disputes -------------------------------------------------- */}
        <Grid size={{ xs: 12, lg: 5 }}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              Disputes
            </Typography>

            {(disputes ?? []).length === 0 ? (
              <EmptyState
                icon="material-symbols:gavel-rounded"
                title="No open disputes"
                body="Open a dispute from any decision. AEGIS assembles a numbered evidence packet from the stored ledger record."
              />
            ) : (
              <Stack spacing={1}>
                {disputes.map((dispute) => (
                  <Stack
                    key={dispute.dispute_id}
                    spacing={1}
                    sx={(theme) => ({
                      p: 1.75,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: theme.vars.palette.divider,
                      backgroundColor: theme.vars.palette.background.elevation2,
                    })}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Chip size="small" variant="soft" color="neutral" label={dispute.status} />
                      <Typography variant="monoCaption" sx={{ color: 'text.disabled' }}>
                        {formatDateTime(dispute.created_at)}
                      </Typography>
                    </Stack>

                    <Mono variant="monoCaption" sx={{ color: 'text.secondary' }}>
                      {dispute.action_id}
                    </Mono>

                    {dispute.liable_party && (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                          <Term term="liability">liable</Term>
                        </Typography>
                        <Chip
                          size="small"
                          variant="soft"
                          color={dispute.liable_party === 'card_member' ? 'neutral' : 'warning'}
                          label={dispute.liable_party.replace(/_/g, ' ')}
                        />
                      </Stack>
                    )}

                    <Button
                      size="small"
                      variant="outlined"
                      color="neutral"
                      onClick={() => buildFor(dispute)}
                      disabled={buildingId === dispute.dispute_id}
                    >
                      {buildingId === dispute.dispute_id ? 'Building…' : 'Build packet'}
                    </Button>
                  </Stack>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>

      <PacketDialog open={packetOpen} onClose={() => setPacketOpen(false)} packet={packet} />
    </>
  );
};

export default Incidents;
