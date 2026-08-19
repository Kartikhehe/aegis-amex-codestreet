import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  Paper,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import EmptyState from 'aegis/components/EmptyState';
import Mono, { Hash } from 'aegis/components/Mono';
import PageHeader from 'aegis/components/PageHeader';
import Term from 'aegis/components/Term';
import VerdictChip from 'aegis/components/VerdictChip';
import { formatCurrency, formatNumber, formatScore } from 'aegis/format';
import {
  useCreatePolicy,
  usePolicies,
  usePromotePolicy,
  useRefreshAll,
  useSimulatePolicy,
} from 'aegis/hooks';
import { useSnackbar } from 'notistack';

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

const DeltaCard = ({ label, before, after, formatter = formatNumber, invert = false }) => {
  const delta = after - before;
  const worse = invert ? delta < 0 : delta > 0;
  return (
    <Stack
      spacing={0.5}
      sx={(theme) => ({
        p: 2,
        borderRadius: 2,
        border: '1px solid',
        borderColor: theme.vars.palette.divider,
        backgroundColor: theme.vars.palette.background.elevation2,
      })}
    >
      <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 700 }}>
        {label}
      </Typography>
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
  const refreshAll = useRefreshAll();
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

                <Grid container spacing={2}>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <DeltaCard
                      label="Allowed"
                      before={result.counts.before.ALLOW}
                      after={result.counts.after.ALLOW}
                      invert
                    />
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <DeltaCard
                      label="Sent for approval"
                      before={result.counts.before.STEP_UP}
                      after={result.counts.after.STEP_UP}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <DeltaCard
                      label="Denied"
                      before={result.counts.before.DENY}
                      after={result.counts.after.DENY}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, md: 3 }}>
                    <DeltaCard
                      label="Approved exposure"
                      before={Number(result.exposure_before)}
                      after={Number(result.exposure_after)}
                      formatter={formatCurrency}
                      invert
                    />
                  </Grid>
                </Grid>

                {result.newly_blocked.length > 0 && (
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {formatNumber(result.newly_blocked_count)} transactions this policy would
                      newly stop
                    </Typography>
                    <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
                      <Stack spacing={0.5}>
                        {result.newly_blocked.map((row) => (
                          <Stack
                            key={row.action_id}
                            direction="row"
                            spacing={1.5}
                            alignItems="center"
                            sx={(theme) => ({
                              px: 1.5,
                              py: 1,
                              borderRadius: 1.5,
                              backgroundColor: theme.vars.palette.background.elevation2,
                            })}
                          >
                            <VerdictChip
                              verdict={row.after_verdict}
                              size="small"
                              showLabel={false}
                            />
                            <Typography
                              variant="subtitle2"
                              sx={{
                                flex: 1,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {row.merchant_name}
                            </Typography>
                            <Mono variant="monoCaption" sx={{ color: 'text.disabled' }}>
                              {formatScore(row.conformance_score)}
                            </Mono>
                            <Mono variant="monoSmall" sx={{ fontWeight: 600 }}>
                              {formatCurrency(row.amount)}
                            </Mono>
                          </Stack>
                        ))}
                      </Stack>
                    </Box>
                  </Stack>
                )}
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
                <Stack
                  key={policy.policy_id}
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.5}
                  alignItems={{ sm: 'center' }}
                  sx={(theme) => ({
                    p: 1.75,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor:
                      policy.stage === 'enforcing'
                        ? `rgba(${theme.vars.palette.success.mainChannel} / 0.4)`
                        : theme.vars.palette.divider,
                    backgroundColor: theme.vars.palette.background.elevation2,
                  })}
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
                  </Stack>

                  <Stack direction="row" spacing={1}>
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
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </>
  );
};

export default PolicyStudio;
