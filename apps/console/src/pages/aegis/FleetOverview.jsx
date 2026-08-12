import { useState } from 'react';
import { Alert, Box, Grid, Paper, Stack, Typography } from '@mui/material';
import BlockRateChart from 'aegis/charts/BlockRateChart';
import ExposureChart from 'aegis/charts/ExposureChart';
import DecisionDrawer from 'aegis/components/DecisionDrawer';
import DecisionStream from 'aegis/components/DecisionStream';
import EmptyState from 'aegis/components/EmptyState';
import MetricTile from 'aegis/components/MetricTile';
import Mono from 'aegis/components/Mono';
import PageHeader from 'aegis/components/PageHeader';
import Term from 'aegis/components/Term';
import { useLiveDecisions, useLiveIncidents } from 'aegis/firestoreHooks';
import { formatRelative } from 'aegis/format';
import { useDecisions, useIncidents, useOverview, usePolicies } from 'aegis/hooks';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * FLEET OVERVIEW — "What is happening now?"
 *
 * The reading order is deliberate: four numbers say whether the system is
 * healthy, the live stream says what it is doing right now, the charts say
 * whether that is getting better or worse, and the breakers say what has
 * already been stopped for you.
 */

const TILE_ICONS = {
  decisions: 'material-symbols:bolt-rounded',
  blocked: 'material-symbols:block-rounded',
  step_up: 'material-symbols:contact-support-rounded',
  exposure: 'material-symbols:payments-outline-rounded',
};

const TILE_TONES = { blocked: 'danger', step_up: 'warning' };

const BreakerRow = ({ incident }) => (
  <Stack
    direction="row"
    spacing={1.5}
    alignItems="flex-start"
    sx={(theme) => ({
      p: 1.5,
      borderRadius: 2,
      border: '1px solid',
      borderColor: incident.suspected_prompt_injection
        ? `rgba(${theme.vars.palette.error.mainChannel} / 0.45)`
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
        fontSize: 18,
        mt: 0.25,
        flexShrink: 0,
        color: incident.severity === 'critical' ? 'error.main' : 'warning.main',
      }}
    />
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 700,
          color: incident.suspected_prompt_injection ? 'error.main' : 'text.primary',
        }}
      >
        {incident.title}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {incident.agent_name || incident.agent_id || incident.operator_id} ·{' '}
        {formatRelative(incident.created_at)}
      </Typography>
    </Stack>
  </Stack>
);

const FleetOverview = () => {
  const [selected, setSelected] = useState(null);

  const { data: overview } = useOverview(24);
  // Firestore when it is available, REST when it is not. The screen does not
  // need to know which, and shows a "live" marker only when it truly is.
  const decisionsQuery = useLiveDecisions(useDecisions({ limit: 60 }), { max: 60 });
  const incidentsQuery = useLiveIncidents(useIncidents({ limit: 8 }), { max: 8 });
  const { data: decisionPage } = decisionsQuery;
  const { data: incidents } = incidentsQuery;
  const { data: policies } = usePolicies();

  const shadowRunning = (policies ?? []).some((policy) => policy.stage === 'shadow');
  const decisions = decisionPage?.items ?? [];
  const tiles = overview?.tiles ?? [];

  // Four zero tiles are ambiguous: they read identically whether nothing
  // happened in the window or the screen is broken. When the tiles are empty
  // but the ledger clearly holds decisions, say which of the two it is --
  // otherwise an operator is left guessing at their own dashboard.
  const windowEmpty = tiles.length > 0 && tiles.every((tile) => !tile.value);
  const ledgerHasHistory = (decisionPage?.total ?? 0) > 0;
  const staleWindow = windowEmpty && ledgerHasHistory;

  return (
    <>
      <PageHeader
        title="Fleet overview"
        question="What is happening now?"
        actions={
          overview?.ruleset_hash && (
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                <Term term="ruleset_hash">Policy</Term>
              </Typography>
              <Mono variant="monoCaption" sx={{ color: 'text.secondary' }}>
                {overview.ruleset_hash.slice(0, 8)}
              </Mono>
            </Stack>
          )
        }
      />

      {staleWindow && (
        <Alert severity="info" variant="outlined" sx={{ mb: { xs: 2, md: 3 } }}>
          No decisions in the last 24 hours. The ledger holds{' '}
          <Mono variant="monoCaption">{decisionPage.total.toLocaleString('en-IN')}</Mono> older
          records — the tiles below measure a 24-hour window, so they read zero.
        </Alert>
      )}

      <Grid container spacing={{ xs: 2, md: 3 }}>
        {/* ---- metric tiles -------------------------------------------- */}
        {tiles.map((tile) => (
          <Grid key={tile.key} size={{ xs: 6, lg: 3 }}>
            <MetricTile
              tile={tile}
              icon={TILE_ICONS[tile.key]}
              tone={TILE_TONES[tile.key] ?? 'default'}
            />
          </Grid>
        ))}

        {/* ---- live decision stream ------------------------------------ */}
        <Grid size={{ xs: 12, xl: 8 }}>
          <Paper sx={{ height: { xs: 480, xl: 604 }, display: 'flex', flexDirection: 'column' }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ p: 2, pb: 1.5 }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Box
                  sx={(theme) => ({
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: theme.vars.palette.success.main,
                    animation: 'aegisLivePulse 2s ease-in-out infinite',
                    '@keyframes aegisLivePulse': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0.3 },
                    },
                    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                  })}
                />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Live decision stream
                </Typography>
                {decisionsQuery.isLive && (
                  <Typography variant="monoCaption" sx={{ color: 'success.main' }}>
                    firestore
                  </Typography>
                )}
              </Stack>
              {shadowRunning && (
                <Typography variant="monoCaption" sx={{ color: 'warning.main' }}>
                  shadow policy running
                </Typography>
              )}
            </Stack>

            <Box sx={{ flex: 1, minHeight: 0 }}>
              <DecisionStream
                decisions={decisions}
                onSelect={(decision) => setSelected(decision.action_id)}
                showShadow={shadowRunning}
              />
            </Box>
          </Paper>
        </Grid>

        {/* ---- armed breakers ------------------------------------------ */}
        <Grid size={{ xs: 12, xl: 4 }}>
          <Paper sx={{ p: 2, height: { xs: 'auto', xl: 560 }, overflowY: 'auto' }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              <Term term="circuit_breaker">Armed breakers</Term>
            </Typography>

            {(incidents ?? []).length === 0 ? (
              <EmptyState
                dense
                icon="material-symbols:shield-outline-rounded"
                title="No breakers armed"
                body="Circuit breakers appear here when an agent's recent behaviour looks wrong as a pattern rather than as a single purchase."
              />
            ) : (
              <Stack spacing={1}>
                {incidents.map((incident) => (
                  <BreakerRow key={incident.event_id} incident={incident} />
                ))}
              </Stack>
            )}
          </Paper>
        </Grid>

        {/* ---- charts --------------------------------------------------- */}
        <Grid size={{ xs: 12, lg: 7 }}>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={0.25} sx={{ mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Blocks vs <Term term="false_block">false blocks</Term>
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Blocking more is easy. This is what it costs in friction.
              </Typography>
            </Stack>
            {(overview?.block_rate_series ?? []).length === 0 ? (
              <EmptyState
                dense
                icon="material-symbols:show-chart-rounded"
                title="Not enough traffic yet"
                body="The block rate plots once decisions have been made in this window."
              />
            ) : (
              <BlockRateChart series={overview.block_rate_series} />
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={0.25} sx={{ mb: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Exposure by operator
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Value approved in the last 24 hours.
              </Typography>
            </Stack>
            {(overview?.exposure_by_operator ?? []).length === 0 ? (
              <EmptyState
                dense
                icon="material-symbols:bar-chart-rounded"
                title="No approved spend yet"
                body="Approved transactions are grouped by the operator that ran the agent."
              />
            ) : (
              <ExposureChart data={overview.exposure_by_operator} />
            )}
          </Paper>
        </Grid>
      </Grid>

      <DecisionDrawer
        actionId={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      />
    </>
  );
};

export default FleetOverview;
