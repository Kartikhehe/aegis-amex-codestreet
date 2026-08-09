import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ConformanceSparkline from 'aegis/charts/ConformanceSparkline';
import DecisionDrawer from 'aegis/components/DecisionDrawer';
import DecisionStream from 'aegis/components/DecisionStream';
import DelegationTree from 'aegis/components/DelegationTree';
import EmptyState from 'aegis/components/EmptyState';
import Mono, { Hash } from 'aegis/components/Mono';
import PageHeader from 'aegis/components/PageHeader';
import SpawnSubAgentDialog from 'aegis/components/SpawnSubAgentDialog';
import Term from 'aegis/components/Term';
import { formatCurrency, formatDateTime, formatScore } from 'aegis/format';
import { useAgent, useAgents, useRevokeAgent, useSuspendAgent } from 'aegis/hooks';
import { useSnackbar } from 'notistack';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * AGENTS — "What may this agent do?"
 *
 * A list of agents is not the answer to that question; the mandate is. So the
 * detail pane leads with what the agent may and may never do, in the card
 * member's own words, and only then shows the machinery.
 */

const StatusDot = ({ status, breakerTripped }) => {
  const color =
    status === 'revoked' || breakerTripped
      ? 'error'
      : status === 'suspended'
        ? 'warning'
        : 'success';
  return (
    <Box
      sx={(theme) => ({
        width: 8,
        height: 8,
        borderRadius: '50%',
        flexShrink: 0,
        backgroundColor: theme.vars.palette[color].main,
      })}
    />
  );
};

const AgentListItem = ({ agent, selected, onSelect }) => (
  <Stack
    direction="row"
    spacing={1.25}
    alignItems="center"
    onClick={() => onSelect(agent.agent_id)}
    sx={(theme) => ({
      px: 1.5,
      py: 1.25,
      borderRadius: 2,
      cursor: 'pointer',
      minWidth: 0,
      backgroundColor: selected ? theme.vars.palette.background.elevation3 : 'transparent',
      '&:hover': { backgroundColor: theme.vars.palette.background.elevation2 },
    })}
  >
    <StatusDot status={agent.status} breakerTripped={agent.breaker_tripped} />
    <Stack sx={{ minWidth: 0, flex: 1 }}>
      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 600,
          // Two lines rather than an ellipsis: "Household pantry ..." is not a
          // name an operator can act on, and this list is how they pick.
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          lineHeight: 1.35,
          ...(agent.status === 'revoked' && {
            textDecoration: 'line-through',
            color: 'text.disabled',
          }),
        }}
      >
        {agent.name}
      </Typography>
      <Typography variant="monoCaption" sx={{ color: 'text.disabled' }}>
        {agent.operator_name || agent.operator_id}
      </Typography>
    </Stack>
    <Mono variant="monoCaption" sx={{ color: 'text.disabled', flexShrink: 0 }}>
      {formatCurrency(agent.mandate?.per_transaction_ceiling ?? 0)}
    </Mono>
  </Stack>
);

const RevokeDialog = ({ open, onClose, agent, descendants, onConfirm, busy }) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>Revoke {agent?.name}?</DialogTitle>
    <DialogContent>
      <Alert severity="error" variant="outlined" sx={{ mb: 2.5 }}>
        Revocation cascades. A sub-agent's authority exists only as a narrowing of its parent's, so
        removing the parent removes the source of every authority below it.
      </Alert>

      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        This will revoke {descendants.length + 1} agent
        {descendants.length === 0 ? '' : 's'}:
      </Typography>

      <Stack spacing={0.75}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={(theme) => ({
            p: 1.25,
            borderRadius: 1.5,
            backgroundColor: theme.vars.palette.background.elevation2,
          })}
        >
          <IconifyIcon
            icon="material-symbols:account-tree-rounded"
            sx={{ fontSize: 16, color: 'error.main' }}
          />
          <Typography variant="subtitle2">{agent?.name}</Typography>
          <Mono variant="monoCaption" sx={{ color: 'text.disabled' }}>
            {agent?.agent_id}
          </Mono>
        </Stack>

        {descendants.map((descendant) => (
          <Stack
            key={descendant.agent_id}
            direction="row"
            spacing={1}
            alignItems="center"
            sx={(theme) => ({
              p: 1.25,
              ml: 2,
              borderRadius: 1.5,
              backgroundColor: theme.vars.palette.background.elevation2,
            })}
          >
            <IconifyIcon
              icon="material-symbols:subdirectory-arrow-right-rounded"
              sx={{ fontSize: 16, color: 'text.disabled' }}
            />
            <Typography variant="subtitle2">{descendant.name}</Typography>
            <Mono variant="monoCaption" sx={{ color: 'text.disabled' }}>
              {descendant.agent_id}
            </Mono>
          </Stack>
        ))}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2.5 }}>
      <Button variant="text" color="neutral" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="contained" color="error" onClick={onConfirm} disabled={busy}>
        {busy
          ? 'Revoking…'
          : `Revoke ${descendants.length + 1} agent${descendants.length === 0 ? '' : 's'}`}
      </Button>
    </DialogActions>
  </Dialog>
);

const Agents = () => {
  const [selectedId, setSelectedId] = useState(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [drawerAction, setDrawerAction] = useState(null);

  const { data: agents, mutate: refetchAgents } = useAgents();
  const { data: detail, mutate: refetchDetail } = useAgent(selectedId);
  const { trigger: revoke, isMutating: revoking } = useRevokeAgent(selectedId);
  const { trigger: suspend } = useSuspendAgent(selectedId);
  const { enqueueSnackbar } = useSnackbar();

  // Select the first root agent once the list arrives.
  useEffect(() => {
    if (!selectedId && agents?.length) {
      setSelectedId((agents.find((a) => !a.parent_agent_id) ?? agents[0]).agent_id);
    }
  }, [agents, selectedId]);

  const agent = detail?.agent;
  const mandate = agent?.mandate ?? {};

  const handleRevoke = async () => {
    try {
      const result = await revoke();
      enqueueSnackbar(`Revoked ${result.count} agent${result.count === 1 ? '' : 's'}.`, {
        variant: 'success',
      });
      setRevokeOpen(false);
      await Promise.all([refetchAgents(), refetchDetail()]);
    } catch (error) {
      enqueueSnackbar(error?.data?.detail ?? 'Could not revoke.', { variant: 'error' });
    }
  };

  const handleSuspend = async () => {
    try {
      const updated = await suspend();
      enqueueSnackbar(updated.status === 'suspended' ? 'Agent suspended.' : 'Agent resumed.', {
        variant: 'info',
      });
      await Promise.all([refetchAgents(), refetchDetail()]);
    } catch (error) {
      enqueueSnackbar(error?.data?.detail ?? 'Could not change status.', { variant: 'error' });
    }
  };

  return (
    <>
      <PageHeader title="Agents" question="What may this agent do?" />

      <Grid container spacing={{ xs: 2, md: 3 }}>
        {/* ---- agent list ---------------------------------------------- */}
        <Grid size={{ xs: 12, lg: 3 }}>
          <Paper sx={{ p: 1.5, height: { lg: 'calc(100vh - 220px)' }, overflowY: 'auto' }}>
            <Typography variant="caption" sx={{ px: 1.5, color: 'text.disabled', fontWeight: 700 }}>
              {(agents ?? []).length} AGENTS
            </Typography>
            <Stack spacing={0.25} sx={{ mt: 1 }}>
              {(agents ?? []).map((item) => (
                <AgentListItem
                  key={item.agent_id}
                  agent={item}
                  selected={item.agent_id === selectedId}
                  onSelect={setSelectedId}
                />
              ))}
            </Stack>
          </Paper>
        </Grid>

        {/* ---- detail --------------------------------------------------- */}
        <Grid size={{ xs: 12, lg: 9 }}>
          {!agent ? (
            <Paper>
              <EmptyState
                icon="material-symbols:smart-toy-outline-rounded"
                title="Select an agent"
                body="Choose an agent to see the authority it holds, who it delegated to, and how closely it has stayed inside its purpose."
              />
            </Paper>
          ) : (
            <Stack spacing={{ xs: 2, md: 3 }}>
              {/* header + actions */}
              <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  justifyContent="space-between"
                  alignItems={{ md: 'flex-start' }}
                >
                  <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <StatusDot status={agent.status} breakerTripped={agent.breaker_tripped} />
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {agent.name}
                      </Typography>
                      {agent.breaker_tripped && (
                        <Chip size="small" variant="soft" color="error" label="breaker tripped" />
                      )}
                    </Stack>
                    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                      <Mono variant="monoCaption" sx={{ color: 'text.disabled' }}>
                        {agent.agent_id}
                      </Mono>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {agent.operator_name || agent.operator_id}
                      </Typography>
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={1} flexShrink={0}>
                    <Button
                      size="small"
                      variant="outlined"
                      color="neutral"
                      onClick={handleSuspend}
                      disabled={agent.status === 'revoked'}
                    >
                      {agent.status === 'suspended' ? 'Resume' : 'Suspend'}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() => setRevokeOpen(true)}
                      disabled={agent.status === 'revoked'}
                    >
                      Revoke
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<IconifyIcon icon="material-symbols:add-rounded" />}
                      onClick={() => setSpawnOpen(true)}
                      disabled={agent.status !== 'active'}
                    >
                      Spawn sub-agent
                    </Button>
                  </Stack>
                </Stack>
              </Paper>

              <Grid container spacing={{ xs: 2, md: 3 }}>
                {/* mandate in plain language */}
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper sx={{ p: 2.5, height: '100%' }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                      <Term term="mandate">Mandate</Term>
                    </Typography>

                    <Typography variant="body1" sx={{ mb: 2.5, lineHeight: 1.6 }}>
                      {mandate.purpose}
                    </Typography>

                    <Stack spacing={2}>
                      <Stack spacing={0.75}>
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.disabled', fontWeight: 700 }}
                        >
                          MAY BUY
                        </Typography>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                          {(mandate.permitted_categories ?? []).map((category) => (
                            <Chip
                              key={category}
                              size="small"
                              variant="soft"
                              color="info"
                              label={<Mono variant="monoCaption">{category}</Mono>}
                            />
                          ))}
                        </Stack>
                      </Stack>

                      <Stack spacing={0.75}>
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.disabled', fontWeight: 700 }}
                        >
                          MAY NEVER BUY
                        </Typography>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                          {(mandate.prohibited_attributes ?? []).map((attribute) => (
                            <Chip
                              key={attribute}
                              size="small"
                              variant="soft"
                              color="error"
                              label={attribute.replace(/_/g, ' ')}
                            />
                          ))}
                        </Stack>
                      </Stack>

                      <Divider />

                      <Stack spacing={1}>
                        {[
                          ['Per transaction', formatCurrency(mandate.per_transaction_ceiling)],
                          ['Per day', formatCurrency(mandate.daily_ceiling)],
                          ['Transactions per day', mandate.max_transactions_per_day],
                          ['Delegation depth', mandate.max_delegation_depth],
                          [
                            'Expires',
                            mandate.expires_at ? formatDateTime(mandate.expires_at) : 'never',
                          ],
                        ].map(([label, value]) => (
                          <Stack
                            key={label}
                            direction="row"
                            justifyContent="space-between"
                            alignItems="baseline"
                          >
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              {label}
                            </Typography>
                            <Mono variant="monoSmall">{value}</Mono>
                          </Stack>
                        ))}
                        <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            <Term term="mandate_hash">Mandate hash</Term>
                          </Typography>
                          <Hash value={mandate.mandate_hash} />
                        </Stack>
                      </Stack>
                    </Stack>
                  </Paper>
                </Grid>

                {/* delegation tree */}
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper sx={{ p: 2.5, height: '100%' }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                      <Term term="delegation">Delegation tree</Term>
                    </Typography>

                    {detail?.tree?.children?.length ? (
                      <DelegationTree
                        tree={detail.tree}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                      />
                    ) : (
                      <>
                        <DelegationTree
                          tree={detail?.tree}
                          selectedId={selectedId}
                          onSelect={setSelectedId}
                        />
                        <EmptyState
                          dense
                          icon="material-symbols:account-tree-outline-rounded"
                          title="No sub-agents"
                          body={
                            mandate.max_delegation_depth > 0
                              ? 'This agent may delegate. A sub-agent can only ever hold less authority than it does.'
                              : 'This mandate does not permit delegation.'
                          }
                          action={
                            mandate.max_delegation_depth > 0 ? 'Spawn a sub-agent' : undefined
                          }
                          onAction={() => setSpawnOpen(true)}
                        />
                      </>
                    )}
                  </Paper>
                </Grid>

                {/* conformance */}
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper sx={{ p: 2.5 }}>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="baseline"
                      sx={{ mb: 1 }}
                    >
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        <Term term="conformance">Conformance</Term>
                      </Typography>
                      <Mono variant="monoHeading">
                        {formatScore(detail?.stats?.mean_conformance)}
                      </Mono>
                    </Stack>

                    {(detail?.stats?.conformance_series ?? []).length > 1 ? (
                      <ConformanceSparkline series={detail.stats.conformance_series} />
                    ) : (
                      <EmptyState
                        dense
                        icon="material-symbols:timeline-rounded"
                        title="Not enough scored decisions"
                        body="Conformance plots once this agent has been scored more than once."
                      />
                    )}
                  </Paper>
                </Grid>

                {/* recent decisions */}
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper sx={{ p: 0, overflow: 'hidden' }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, p: 2.5, pb: 1.5 }}>
                      Recent decisions
                    </Typography>
                    <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
                      <DecisionStream
                        decisions={detail?.recent_decisions ?? []}
                        onSelect={(decision) => setDrawerAction(decision.action_id)}
                        maxRows={20}
                      />
                    </Box>
                  </Paper>
                </Grid>
              </Grid>
            </Stack>
          )}
        </Grid>
      </Grid>

      <SpawnSubAgentDialog
        open={spawnOpen}
        onClose={() => setSpawnOpen(false)}
        parent={agent}
        onCreated={() => {
          refetchAgents();
          refetchDetail();
        }}
      />

      <RevokeDialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        agent={agent}
        descendants={detail?.descendants ?? []}
        onConfirm={handleRevoke}
        busy={revoking}
      />

      <DecisionDrawer
        actionId={drawerAction}
        open={Boolean(drawerAction)}
        onClose={() => setDrawerAction(null)}
      />
    </>
  );
};

export default Agents;
