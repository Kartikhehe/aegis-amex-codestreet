import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  Paper,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import DecisionDrawer from 'aegis/components/DecisionDrawer';
import EmptyState from 'aegis/components/EmptyState';
import Mono, { Hash } from 'aegis/components/Mono';
import PageHeader from 'aegis/components/PageHeader';
import PolicyChangesDialog from 'aegis/components/PolicyChangesDialog';
import Term from 'aegis/components/Term';
import { formatCurrency, formatDateTime, formatNumber, formatScore } from 'aegis/format';
import {
  useCreatePolicy,
  useDeletePolicy,
  usePolicies,
  usePromotePolicy,
  useRefreshAll,
  useSimulatePolicy,
} from 'aegis/hooks';
import { useSnackbar } from 'notistack';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * POLICY STUDIO — "What if I change this?"
 *
 * The blast radius is the point of this screen. Anyone can tighten a
 * threshold; the question is what that would have done to traffic that
 * actually happened. Every number here comes from replaying REAL recorded
 * decisions through the engine under the candidate ruleset -- not a model, not
 * an estimate -- and the specific transactions that would change are listed,
 * because a count is a claim and a list is evidence.
 */

const THRESHOLDS = [
  {
    key: 'conformance_deny_floor',
    label: 'Deny floor',
    help: 'Below this conformance score, the purchase is denied outright.',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'conformance_review_floor',
    label: 'Review floor',
    help: 'Below this score, the card member is asked before anything is charged.',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'conformance_marginal_floor',
    label: 'Flag floor',
    help: 'Below this score the purchase is allowed, but flagged for review.',
    min: 0,
    max: 1,
    step: 0.01,
  },
];

// Human names for every threshold, for the version details panel. Derived from
// the slider definitions so the two cannot drift apart, plus the two switches
// that have no slider of their own.
const THRESHOLD_LABELS = {
  ...Object.fromEntries(THRESHOLDS.map((threshold) => [threshold.key, threshold.label])),
  novel_merchant_check_enabled: 'Ask about first-time merchants',
  velocity_check_enabled: 'Watch for unusual bursts of spending',
};

const DEFAULTS = {
  conformance_deny_floor: 0.45,
  conformance_review_floor: 0.7,
  conformance_marginal_floor: 0.85,
  novel_merchant_check_enabled: true,
  velocity_check_enabled: true,
};

/** Renders the ruleset as monospace source, with the edited values highlighted. */
const PolicySource = ({ thresholds, deployed }) => {
  const line = (key, value) => {
    const changed = deployed && deployed[key] !== value;
    return (
      <Box
        key={key}
        component="div"
        sx={(theme) => ({
          px: 1,
          py: 0.25,
          borderRadius: 0.75,
          backgroundColor: changed
            ? `rgba(${theme.vars.palette.warning.mainChannel} / 0.14)`
            : 'transparent',
        })}
      >
        <Mono variant="monoSmall" sx={{ color: 'text.disabled' }}>
          {'  '}
        </Mono>
        <Mono variant="monoSmall" sx={{ color: 'info.main' }}>
          {key}
        </Mono>
        <Mono variant="monoSmall" sx={{ color: 'text.disabled' }}>
          {' = '}
        </Mono>
        <Mono
          variant="monoSmall"
          sx={{ color: changed ? 'warning.main' : 'success.main', fontWeight: 600 }}
        >
          {typeof value === 'boolean' ? String(value) : Number(value).toFixed(2)}
        </Mono>
        {changed && (
          <Mono variant="monoCaption" sx={{ color: 'text.disabled', ml: 1 }}>
            {`// was ${typeof deployed[key] === 'boolean' ? deployed[key] : Number(deployed[key]).toFixed(2)}`}
          </Mono>
        )}
      </Box>
    );
  };

  return (
    <Box
      sx={(theme) => ({
        p: 2,
        borderRadius: 2,
        border: '1px solid',
        borderColor: theme.vars.palette.divider,
        backgroundColor: theme.vars.palette.background.elevation2,
        overflowX: 'auto',
      })}
    >
      <Mono variant="monoSmall" sx={{ color: 'text.disabled', display: 'block' }}>
        ruleset {'{'}
      </Mono>
      {Object.entries(thresholds).map(([key, value]) => line(key, value))}
      <Mono variant="monoSmall" sx={{ color: 'text.disabled', display: 'block' }}>
        {'}'}
      </Mono>
    </Box>
  );
};

/**
 * One number from the blast radius.
 *
 * Clickable when there are underlying transactions to show, because a count
 * nobody can open is a claim rather than evidence -- "298 newly blocked" says
 * nothing about whether those are fraud or somebody's groceries. The affordance
 * has to be obvious without a click, so the whole card lifts and its border
 * picks up the accent colour on hover, and a small chevron sits beside the
 * label. A card with nothing behind it stays flat and inert rather than
 * offering a click that would open an empty list.
 */
const DeltaCard = ({ label, before, after, formatter = formatNumber, invert = false, onClick }) => {
  const delta = after - before;
  const worse = invert ? delta < 0 : delta > 0;
  const clickable = Boolean(onClick);
  return (
    <Stack
      spacing={0.5}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      sx={(theme) => ({
        p: 2,
        borderRadius: 2,
        border: '1px solid',
        borderColor: theme.vars.palette.divider,
        backgroundColor: theme.vars.palette.background.elevation2,
        ...(clickable && {
          cursor: 'pointer',
          transition: 'transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            borderColor: `rgba(${theme.vars.palette.primary.mainChannel} / 0.55)`,
            boxShadow: `0 6px 18px -10px rgba(${theme.vars.palette.primary.mainChannel} / 0.6)`,
          },
          '&:focus-visible': {
            outline: `2px solid rgba(${theme.vars.palette.primary.mainChannel} / 0.6)`,
            outlineOffset: 2,
          },
        }),
      })}
    >
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 700 }}>
          {label}
        </Typography>
        {clickable && (
          <IconifyIcon
            icon="material-symbols:chevron-right-rounded"
            sx={{ fontSize: 15, color: 'text.disabled' }}
          />
        )}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Mono variant="monoHeading">{formatter(after)}</Mono>
        {delta !== 0 && (
          <Mono
            variant="monoSmall"
            sx={{ color: worse ? 'error.main' : 'success.main', fontWeight: 600 }}
          >
            {delta > 0 ? '+' : ''}
            {formatter(delta)}
          </Mono>
        )}
      </Stack>
      <Mono variant="monoCaption" sx={{ color: 'text.disabled' }}>
        was {formatter(before)}
      </Mono>
    </Stack>
  );
};

const PolicyStudio = () => {
  const { data: policies, mutate: refetchPolicies } = usePolicies();
  const { trigger: simulate, isMutating: simulating } = useSimulatePolicy();
  const { trigger: createPolicy, isMutating: creating } = useCreatePolicy();
  const { trigger: promote, isMutating: promoting } = usePromotePolicy();
  const { trigger: deletePolicy, isMutating: deleting } = useDeletePolicy();
  const refreshAll = useRefreshAll();

  // Which blast-radius group the changes dialog opens to, and which decision
  // the drawer is showing. `null` for the dialog means closed.
  const [changesFocus, setChangesFocus] = useState(null);
  const [drawerActionId, setDrawerActionId] = useState(null);
  // Which policy row has its details expanded, and which is pending deletion.
  const [expandedPolicy, setExpandedPolicy] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const { enqueueSnackbar } = useSnackbar();

  const deployed = useMemo(
    () => (policies ?? []).find((policy) => policy.stage === 'enforcing'),
    [policies],
  );
  const deployedThresholds = deployed?.thresholds ?? DEFAULTS;

  const [draft, setDraft] = useState(null);
  const [result, setResult] = useState(null);

  // The editor starts from whatever is actually deployed, but must not stomp
  // on edits when the policy list refetches. Deriving it during render (rather
  // than setting state in an effect) means there is no window where the editor
  // shows defaults that were never deployed.
  const thresholds = draft ?? { ...DEFAULTS, ...deployedThresholds };
  const setThreshold = (key, value) =>
    setDraft((prev) => ({ ...(prev ?? { ...DEFAULTS, ...deployedThresholds }), [key]: value }));

  const dirty = useMemo(
    () => Object.keys(thresholds).some((key) => thresholds[key] !== deployedThresholds[key]),
    [thresholds, deployedThresholds],
  );

  const handleSimulate = async () => {
    try {
      const simulation = await simulate({ thresholds, name: 'candidate', limit: 5000 });
      setResult(simulation);
    } catch (error) {
      enqueueSnackbar(error?.data?.detail ?? 'Could not run the simulation.', {
        variant: 'error',
      });
    }
  };

  const handleSaveDraft = async () => {
    try {
      const created = await createPolicy({
        thresholds,
        name: `candidate-${new Date().toISOString().slice(0, 10)}`,
        limit: 5000,
      });
      enqueueSnackbar(`Draft saved — v${created.version}`, { variant: 'success' });
      refetchPolicies();
    } catch (error) {
      enqueueSnackbar(error?.data?.detail ?? 'Could not save the draft.', { variant: 'error' });
    }
  };

  const handlePromote = async (policy, stage) => {
    try {
      await promote({ policy_id: policy.policy_id, stage });
      enqueueSnackbar(`${policy.name} → ${stage}`, { variant: 'success' });
      await refetchPolicies();
      refreshAll();
    } catch (error) {
      enqueueSnackbar(error?.data?.detail ?? 'Could not promote.', { variant: 'error' });
    }
  };

  const handleDelete = async (policy) => {
    try {
      await deletePolicy(policy.policy_id);
      enqueueSnackbar(`Deleted ${policy.name} v${policy.version}`, { variant: 'success' });
      setConfirmDelete(null);
      await refetchPolicies();
    } catch (error) {
      // The server refuses to delete anything with decisions behind it, and
      // that reason is worth reading in full rather than reducing to "failed".
      enqueueSnackbar(error?.data?.detail ?? 'Could not delete this policy.', {
        variant: 'error',
        style: { whiteSpace: 'pre-line', maxWidth: 460 },
      });
      setConfirmDelete(null);
    }
  };

  // How many recorded decisions this candidate would actually change. Distinct
  // from the verdict totals moving: those shift for reasons unrelated to the
  // policy, so a tile can move while no individual decision does.
  const changedCount = (result?.newly_blocked_count ?? 0) + (result?.newly_allowed_count ?? 0);
  const hasChanges = changedCount > 0;

  return (
    <>
      <PageHeader
        title="Policy studio"
        question="What if I change this?"
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              color="neutral"
              onClick={handleSaveDraft}
              disabled={creating || !dirty}
            >
              Save draft
            </Button>
            <Button variant="contained" onClick={handleSimulate} disabled={simulating}>
              {simulating ? 'Replaying…' : 'Run blast radius'}
            </Button>
          </Stack>
        }
      />

      <Grid container spacing={{ xs: 2, md: 3 }}>
        {/* ---- editor --------------------------------------------------- */}
        <Grid size={{ xs: 12, lg: 5 }}>
          <Paper sx={{ p: 2.5 }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Ruleset
              </Typography>
              {dirty && <Chip size="small" variant="soft" color="warning" label="modified" />}
            </Stack>

            <Stack spacing={3}>
              {THRESHOLDS.map((threshold) => (
                <Stack key={threshold.key} spacing={0.5}>
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {threshold.label}
                    </Typography>
                    <Mono
                      variant="monoSmall"
                      sx={{
                        fontWeight: 700,
                        color:
                          thresholds[threshold.key] !== deployedThresholds[threshold.key]
                            ? 'warning.main'
                            : 'text.primary',
                      }}
                    >
                      {formatScore(thresholds[threshold.key])}
                    </Mono>
                  </Stack>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {threshold.help}
                  </Typography>
                  <Slider
                    size="small"
                    min={threshold.min}
                    max={threshold.max}
                    step={threshold.step}
                    value={thresholds[threshold.key]}
                    onChange={(_, value) => setThreshold(threshold.key, value)}
                  />
                </Stack>
              ))}

              <Divider />

              {[
                [
                  'novel_merchant_check_enabled',
                  'Hold first purchases at a new merchant',
                  'novel_merchant',
                ],
                ['velocity_check_enabled', 'Hold when spending accelerates', 'velocity'],
              ].map(([key, label, term]) => (
                <Stack key={key} direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2">
                    <Term term={term}>{label}</Term>
                  </Typography>
                  <Switch
                    checked={thresholds[key]}
                    onChange={(event) => setThreshold(key, event.target.checked)}
                  />
                </Stack>
              ))}
            </Stack>
          </Paper>
        </Grid>

        {/* ---- what changed vs the live policy ---------------------------- */}
        <Grid size={{ xs: 12, lg: 7 }}>
          <Paper sx={{ p: 2.5 }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                What you changed
              </Typography>
              {deployed && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                    <Term term="ruleset_hash">deployed</Term>
                  </Typography>
                  <Hash value={deployed.ruleset_hash} />
                </Stack>
              )}
            </Stack>

            <PolicySource thresholds={thresholds} deployed={deployedThresholds} />

            {!dirty && (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
                Identical to the deployed policy. Change a threshold to see its blast radius.
              </Typography>
            )}
          </Paper>
        </Grid>

        {/* ---- blast radius --------------------------------------------- */}
        <Grid size={12}>
          <Paper sx={{ p: 2.5 }}>
            <Stack spacing={0.25} sx={{ mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                <Term term="blast_radius">What this would have done</Term>
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Replayed against real recorded traffic, not an estimate.
              </Typography>
            </Stack>

            {!result ? (
              <EmptyState
                icon="material-symbols:science-outline-rounded"
                title="No simulation run yet"
                body="Adjust a threshold and run the blast radius to see exactly which past transactions this policy would have changed."
                action="Run blast radius"
                onAction={handleSimulate}
              />
            ) : (
              <Stack spacing={3}>
                <Alert severity="info" variant="outlined">
                  Replayed <Mono variant="monoSmall">{formatNumber(result.replayed_count)}</Mono>{' '}
                  real decisions through the candidate ruleset{' '}
                  <Mono variant="monoCaption">{result.candidate_ruleset_hash.slice(0, 8)}</Mono>.
                </Alert>

                {/* Each count opens the transactions behind it. A tile with
                    no changed rows is left inert rather than opening an empty
                    list -- the verdict totals move for reasons other than this
                    policy, so "no rows changed" is a real answer. */}
                <Grid container spacing={2}>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <DeltaCard
                      label="Allowed"
                      before={result.counts.before.ALLOW}
                      after={result.counts.after.ALLOW}
                      invert
                      onClick={hasChanges ? () => setChangesFocus('allowed') : undefined}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <DeltaCard
                      label="Sent for approval"
                      before={result.counts.before.STEP_UP}
                      after={result.counts.after.STEP_UP}
                      onClick={hasChanges ? () => setChangesFocus('all') : undefined}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <DeltaCard
                      label="Denied"
                      before={result.counts.before.DENY}
                      after={result.counts.after.DENY}
                      onClick={hasChanges ? () => setChangesFocus('blocked') : undefined}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <DeltaCard
                      label="Approved exposure"
                      before={Number(result.exposure_before)}
                      after={Number(result.exposure_after)}
                      formatter={formatCurrency}
                      invert
                      onClick={hasChanges ? () => setChangesFocus('all') : undefined}
                    />
                  </Grid>
                </Grid>

                {/* The single entry point that shows everything at once. */}
                <Button
                  variant="outlined"
                  color="neutral"
                  disabled={!hasChanges}
                  onClick={() => setChangesFocus('all')}
                  startIcon={<IconifyIcon icon="material-symbols:difference-rounded" />}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {hasChanges
                    ? `Review all ${formatNumber(changedCount)} changed transactions`
                    : 'No recorded decision would change'}
                </Button>
              </Stack>
            )}
          </Paper>
        </Grid>

        {/* ---- promotion ------------------------------------------------ */}
        <Grid size={12}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
              Promotion
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              A policy must run in <Term term="shadow_mode">shadow</Term> before it can enforce.
              Shadow records what it would have decided without affecting any real purchase.
            </Typography>

            <Stack spacing={1}>
              {(policies ?? []).map((policy) => (
                <Box
                  key={policy.policy_id}
                  sx={(theme) => ({
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor:
                      policy.stage === 'enforcing'
                        ? `rgba(${theme.vars.palette.success.mainChannel} / 0.4)`
                        : theme.vars.palette.divider,
                    backgroundColor: theme.vars.palette.background.elevation2,
                  })}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    alignItems={{ sm: 'center' }}
                    sx={{ p: 1.75 }}
                  >
                    <Chip
                      size="small"
                      variant="soft"
                      color={
                        policy.stage === 'enforcing'
                          ? 'success'
                          : policy.stage === 'shadow'
                            ? 'warning'
                            : 'neutral'
                      }
                      label={policy.stage}
                    />
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        {policy.name} <Mono variant="monoCaption">v{policy.version}</Mono>
                      </Typography>
                      <Hash value={policy.ruleset_hash} />
                      {/* Enough to tell two versions apart at a glance. Several
                        drafts with the same name and different thresholds are
                        otherwise indistinguishable in this list. */}
                      <Typography variant="caption" sx={{ color: 'text.disabled', mt: 0.25 }}>
                        Created {formatDateTime(policy.created_at)}
                        {policy.created_by ? ` by ${policy.created_by}` : ''}
                        {policy.promoted_at
                          ? ` · promoted ${formatDateTime(policy.promoted_at)}`
                          : ''}
                      </Typography>
                    </Stack>

                    <Stack direction="row" spacing={1} alignItems="center">
                      <Button
                        size="small"
                        color="neutral"
                        onClick={() =>
                          setExpandedPolicy(
                            expandedPolicy === policy.policy_id ? null : policy.policy_id,
                          )
                        }
                        sx={{ color: 'text.secondary' }}
                        startIcon={
                          <IconifyIcon
                            icon="material-symbols:info-outline-rounded"
                            sx={{ fontSize: 17 }}
                          />
                        }
                      >
                        {expandedPolicy === policy.policy_id ? 'Hide' : 'Details'}
                      </Button>
                      {policy.stage === 'draft' && (
                        <Button
                          size="small"
                          variant="outlined"
                          color="neutral"
                          disabled={promoting}
                          onClick={() => handlePromote(policy, 'shadow')}
                        >
                          Promote to shadow
                        </Button>
                      )}
                      {policy.stage === 'shadow' && (
                        <Button
                          size="small"
                          variant="contained"
                          disabled={promoting}
                          onClick={() => handlePromote(policy, 'enforcing')}
                        >
                          Enforce
                        </Button>
                      )}
                      {/* Only drafts offer deletion. A shadow policy is being
                        observed and an enforcing one is what every decision
                        under it points back to; the server refuses both, and
                        offering a button that always fails would be worse than
                        not offering one. */}
                      {policy.stage === 'draft' && (
                        <IconButton
                          size="small"
                          disabled={deleting}
                          onClick={() => setConfirmDelete(policy)}
                          aria-label={`Delete ${policy.name} v${policy.version}`}
                          sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                        >
                          <IconifyIcon
                            icon="material-symbols:delete-outline-rounded"
                            sx={{ fontSize: 18 }}
                          />
                        </IconButton>
                      )}
                    </Stack>
                  </Stack>

                  {/* The values themselves. Without these, two drafts are just
                    two hashes -- and a hash tells you they differ, not how. */}
                  <Collapse in={expandedPolicy === policy.policy_id} unmountOnExit>
                    <Divider />
                    <Stack spacing={1.25} sx={{ p: 1.75 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'text.disabled',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          fontSize: 10,
                        }}
                      >
                        Thresholds
                      </Typography>
                      {Object.entries(policy.thresholds ?? {}).map(([key, value]) => {
                        // Compare against what is live -- the only comparison a
                        // reviewer actually cares about.
                        const liveValue = deployed?.thresholds?.[key];
                        const differs =
                          deployed &&
                          deployed.policy_id !== policy.policy_id &&
                          liveValue !== undefined &&
                          liveValue !== value;
                        return (
                          <Stack
                            key={key}
                            direction="row"
                            spacing={1.5}
                            alignItems="center"
                            sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
                          >
                            <Typography
                              variant="caption"
                              sx={{ width: 230, color: 'text.secondary' }}
                            >
                              {THRESHOLD_LABELS[key] ?? key}
                            </Typography>
                            <Mono
                              variant="monoCaption"
                              sx={{ fontWeight: 600, color: differs ? 'warning.main' : undefined }}
                            >
                              {typeof value === 'boolean' ? (value ? 'on' : 'off') : value}
                            </Mono>
                            {differs && (
                              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                                enforcing:{' '}
                                <Mono variant="monoCaption">
                                  {typeof liveValue === 'boolean'
                                    ? liveValue
                                      ? 'on'
                                      : 'off'
                                    : liveValue}
                                </Mono>
                              </Typography>
                            )}
                          </Stack>
                        );
                      })}
                      <Stack direction="row" spacing={1.5} sx={{ pt: 0.5 }}>
                        <Typography variant="caption" sx={{ width: 230, color: 'text.secondary' }}>
                          Ruleset hash
                        </Typography>
                        <Mono variant="monoCaption">{policy.ruleset_hash}</Mono>
                      </Stack>
                    </Stack>
                  </Collapse>
                </Box>
              ))}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {/* ---- the changed transactions ---------------------------------- */}
      <PolicyChangesDialog
        open={Boolean(changesFocus)}
        focus={changesFocus ?? 'all'}
        result={result}
        onClose={() => setChangesFocus(null)}
        onOpenDecision={(actionId) => setDrawerActionId(actionId)}
      />

      {/* The same drawer used everywhere else, so this is a lens onto the
          record rather than a second version of it. */}
      <DecisionDrawer
        actionId={drawerActionId}
        open={Boolean(drawerActionId)}
        onClose={() => setDrawerActionId(null)}
      />

      {/* ---- delete confirmation -------------------------------------- */}
      <Dialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Delete this draft?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {confirmDelete?.name} v{confirmDelete?.version}
            </Box>{' '}
            will be removed. Nothing has been decided under it, so no record points at it — but this
            cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="neutral" onClick={() => setConfirmDelete(null)}>
            Keep it
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleting}
            onClick={() => handleDelete(confirmDelete)}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default PolicyStudio;
