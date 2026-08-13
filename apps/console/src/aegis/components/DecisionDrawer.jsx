import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  formatCurrency,
  formatDateTime,
  formatLatency,
  formatReason,
  formatRuleName,
  formatScore,
} from 'aegis/format';
import { useDecision, useOpenDispute } from 'aegis/hooks';
import { useSnackbar } from 'notistack';
import { useBreakpoints } from 'providers/BreakpointsProvider';
import IconifyIcon from 'components/base/IconifyIcon';
import { Hash } from './Mono';
import Mono from './Mono';
import Term from './Term';
import VerdictChip from './VerdictChip';

/**
 * The Decision Drawer.
 *
 * Every decision in the product opens here, and this is where AEGIS either
 * earns trust or loses it. The order is deliberate and matches how a person
 * actually interrogates an outcome:
 *
 *   verdict  ->  why (in plain words)  ->  the evidence behind it
 *
 * The card-member toggle at the bottom is the honesty check: it shows the same
 * decision as the person whose money it is would see it. If those two views
 * disagree in substance, the product is lying to somebody.
 *
 * Slide-over Drawer on desktop/tablet, full-height Dialog on mobile.
 */

const Section = ({ title, term, children, action }) => (
  <Stack spacing={1.5} sx={{ py: 2.5 }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between">
      <Typography
        variant="caption"
        sx={{
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'text.disabled',
        }}
      >
        {term ? <Term term={term}>{title}</Term> : title}
      </Typography>
      {action}
    </Stack>
    {children}
  </Stack>
);

const Field = ({ label, children, mono = false }) => (
  <Stack
    direction="row"
    spacing={2}
    alignItems="baseline"
    justifyContent="space-between"
    sx={{ minWidth: 0 }}
  >
    <Typography variant="body2" sx={{ color: 'text.secondary', flexShrink: 0 }}>
      {label}
    </Typography>
    <Box sx={{ minWidth: 0, textAlign: 'right' }}>
      {mono ? <Mono variant="monoSmall">{children}</Mono> : children}
    </Box>
  </Stack>
);

/** The same decision, as the card member sees it. */
const MemberView = ({ decision }) => (
  <Stack
    spacing={2}
    sx={(theme) => ({
      p: 2.5,
      borderRadius: 3,
      border: '1px solid',
      borderColor: theme.vars.palette.divider,
      backgroundColor: theme.vars.palette.background.elevation2,
    })}
  >
    <Stack direction="row" spacing={1.5} alignItems="center">
      <IconifyIcon
        icon="material-symbols:smartphone-outline-rounded"
        sx={{ fontSize: 18, color: 'text.disabled' }}
      />
      <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 600 }}>
        WHAT THE CARD MEMBER SEES
      </Typography>
    </Stack>

    <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.35 }}>
      {decision.verdict === 'DENY'
        ? 'This purchase was blocked'
        : decision.verdict === 'STEP_UP'
          ? 'Your approval is needed'
          : 'Purchase approved'}
    </Typography>

    {/* The member-readable reason, verbatim from the engine. Not a paraphrase:
        if it does not stand on its own here, it is not good enough to send. */}
    <Typography variant="body1" sx={{ lineHeight: 1.6 }}>
      {decision.human_readable_reason}
    </Typography>

    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Chip size="small" variant="soft" color="neutral" label={decision.merchant_name} />
      <Chip size="small" variant="soft" color="neutral" label={formatCurrency(decision.amount)} />
    </Stack>

    {decision.verdict === 'STEP_UP' && (
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="contained" disabled>
          Approve once
        </Button>
        <Button size="small" variant="outlined" color="neutral" disabled>
          Decline
        </Button>
      </Stack>
    )}
  </Stack>
);

const DecisionBody = ({ decision, onClose }) => {
  const [memberView, setMemberView] = useState(false);
  const { trigger: openDispute, isMutating } = useOpenDispute();
  const { enqueueSnackbar } = useSnackbar();

  const conformance = decision.conformance ?? {};
  const scored = conformance.available && conformance.score != null;

  const handleDispute = async () => {
    try {
      const dispute = await openDispute({
        action_id: decision.action_id,
        reason: 'Raised from the operator console',
      });
      enqueueSnackbar(`Dispute opened — ${dispute.dispute_id.slice(0, 8)}`, {
        variant: 'success',
      });
    } catch (error) {
      enqueueSnackbar(error?.data?.detail ?? 'Could not open a dispute.', { variant: 'error' });
    }
  };

  return (
    <Stack sx={{ height: '100%' }}>
      {/* ---- header: verdict, score, plain-language reason ---------------- */}
      <Stack
        spacing={2}
        sx={(theme) => ({
          p: 3,
          borderBottom: '1px solid',
          borderColor: theme.vars.palette.divider,
          backgroundColor: theme.vars.palette.background.elevation2,
        })}
      >
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
          <VerdictChip
            verdict={decision.verdict}
            stepUpState={decision.step_up_state}
            size="large"
          />
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <IconifyIcon icon="material-symbols:close-rounded" />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={3} alignItems="baseline" flexWrap="wrap" useFlexGap>
          <Stack>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              Amount
            </Typography>
            <Mono variant="monoHeading">{formatCurrency(decision.amount)}</Mono>
          </Stack>
          <Stack>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              <Term term="conformance_score">Conformance</Term>
            </Typography>
            <Mono
              variant="monoHeading"
              sx={{
                color: !scored
                  ? 'text.disabled'
                  : conformance.score < 0.45
                    ? 'error.main'
                    : conformance.score < 0.7
                      ? 'warning.main'
                      : 'success.main',
              }}
            >
              {scored ? formatScore(conformance.score) : 'n/a'}
            </Mono>
          </Stack>
          <Stack>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              Decided in
            </Typography>
            <Mono variant="monoHeading">{formatLatency(decision.latency_ms)}</Mono>
          </Stack>
        </Stack>

        <Typography variant="body1" sx={{ lineHeight: 1.6 }}>
          {decision.human_readable_reason}
        </Typography>
      </Stack>

      {/* ---- evidence ---------------------------------------------------- */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 3 }}>
        {memberView ? (
          <Box sx={{ py: 3 }}>
            <MemberView decision={decision} />
          </Box>
        ) : (
          <>
            <Section title="Transaction">
              <Stack spacing={1}>
                <Field label="Merchant">{decision.merchant_name}</Field>
                <Field label="Category (MCC)" mono>
                  {decision.merchant_category}
                </Field>
                <Field label="When" mono>
                  {formatDateTime(decision.decided_at)}
                </Field>
                <Field label="Action ID">
                  <Hash value={decision.action_id} head={10} tail={4} />
                </Field>
                {decision.description && (
                  <Field label="Description">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {decision.description}
                    </Typography>
                  </Field>
                )}
                {decision.cart_items?.length > 0 && (
                  <Stack spacing={0.75} sx={{ pt: 1 }}>
                    <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 700 }}>
                      IN THE BASKET
                    </Typography>
                    {decision.cart_items.map((item, index) => (
                      <Stack
                        key={`${item.label}-${index}`}
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ minWidth: 0 }}
                      >
                        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                          {item.quantity > 1 ? `${item.quantity} x ` : ''}
                          {item.label}
                        </Typography>
                        {(item.attributes ?? []).map((attribute) => (
                          <Chip
                            key={attribute}
                            size="small"
                            variant="soft"
                            color="error"
                            label={attribute.replace(/_/g, ' ')}
                          />
                        ))}
                      </Stack>
                    ))}
                  </Stack>
                )}

                {decision.ship_to && (
                  <Field label="Deliver to">
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {decision.ship_to}
                    </Typography>
                  </Field>
                )}

                {decision.merchant_attributes?.length > 0 && (
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ pt: 0.5 }}>
                    {decision.merchant_attributes.map((attribute) => (
                      <Chip
                        key={attribute}
                        size="small"
                        variant="soft"
                        color="error"
                        label={attribute.replace(/_/g, ' ')}
                      />
                    ))}
                  </Stack>
                )}
              </Stack>
            </Section>

            {decision.injected_instruction && (
              <>
                <Divider />
                <Section title="Untrusted text" term="prompt_injection">
                  {/* Shown as evidence, never as instruction. This is the text
                      that reached the agent -- displaying it verbatim is how an
                      investigator sees what the attacker actually tried. */}
                  <Stack
                    spacing={1}
                    sx={(theme) => ({
                      p: 1.75,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: `rgba(${theme.vars.palette.error.mainChannel} / 0.45)`,
                      backgroundColor: `rgba(${theme.vars.palette.error.mainChannel} / 0.1)`,
                    })}
                  >
                    <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 700 }}>
                      RECORDED AS EVIDENCE — NEVER EXECUTED
                    </Typography>
                    <Typography
                      variant="monoSmall"
                      sx={{ color: 'text.primary', wordBreak: 'break-word' }}
                    >
                      {decision.injected_instruction}
                    </Typography>
                  </Stack>
                </Section>
              </>
            )}

            <Divider />

            <Section title="Mandate" term="mandate">
              <Stack spacing={1}>
                <Field label="Agent">{decision.agent_name || decision.agent_id}</Field>
                <Field label="Operator" mono>
                  {decision.operator_id}
                </Field>
              </Stack>
            </Section>

            <Divider />

            <Section title="Conformance" term="conformance">
              {scored ? (
                <Stack spacing={1}>
                  <Field label="Score" mono>
                    {formatScore(conformance.score)}
                  </Field>
                  {conformance.rationale && (
                    <Typography
                      variant="body2"
                      sx={{ color: 'text.secondary', lineHeight: 1.6, pt: 0.5 }}
                    >
                      {conformance.rationale}
                    </Typography>
                  )}
                  <Field label="Model">
                    <Mono variant="monoCaption">{conformance.model_version || '—'}</Mono>
                  </Field>
                  <Field label={<Term term="prompt_hash">Prompt hash</Term>}>
                    <Hash value={conformance.prompt_hash} />
                  </Field>
                </Stack>
              ) : (
                <Stack
                  direction="row"
                  spacing={1.5}
                  alignItems="flex-start"
                  sx={(theme) => ({
                    p: 1.5,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: `rgba(${theme.vars.palette.warning.mainChannel} / 0.4)`,
                    backgroundColor: `rgba(${theme.vars.palette.warning.mainChannel} / 0.1)`,
                  })}
                >
                  <IconifyIcon
                    icon="material-symbols:warning-rounded"
                    sx={{ color: 'warning.main', fontSize: 18, mt: 0.25 }}
                  />
                  <Typography variant="body2">
                    Conformance could not be established for this transaction, so the engine{' '}
                    <Term term="fail_closed">failed closed</Term> and withheld approval.
                  </Typography>
                </Stack>
              )}
            </Section>

            <Divider />

            <Section title="Rules fired" term="winning_rule">
              <Stack spacing={0.5}>
                {(decision.rules_fired ?? []).map((rule, index) => {
                  const won = rule.matched;
                  return (
                    <Stack
                      key={`${rule.rule_name}-${index}`}
                      direction="row"
                      spacing={1.5}
                      alignItems="center"
                      sx={(theme) => ({
                        px: 1.5,
                        py: 0.875,
                        borderRadius: 1.5,
                        border: '1px solid',
                        borderColor: won
                          ? `rgba(${theme.vars.palette.primary.mainChannel} / 0.45)`
                          : 'transparent',
                        backgroundColor: won
                          ? `rgba(${theme.vars.palette.primary.mainChannel} / 0.1)`
                          : theme.vars.palette.background.elevation2,
                      })}
                    >
                      <IconifyIcon
                        icon={
                          won
                            ? 'material-symbols:gavel-rounded'
                            : rule.skipped
                              ? 'material-symbols:skip-next-rounded'
                              : 'material-symbols:check-small-rounded'
                        }
                        sx={{
                          fontSize: 16,
                          flexShrink: 0,
                          color: won
                            ? 'primary.main'
                            : rule.skipped
                              ? 'warning.main'
                              : 'text.disabled',
                        }}
                      />
                      <Mono
                        variant="monoSmall"
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          fontWeight: won ? 700 : 400,
                          color: won ? 'text.primary' : 'text.secondary',
                        }}
                      >
                        {formatRuleName(rule.rule_name)}
                      </Mono>
                      {rule.skipped && (
                        <Tooltip title={rule.detail || 'Rule could not run'}>
                          <Typography variant="monoCaption" sx={{ color: 'warning.main' }}>
                            skipped
                          </Typography>
                        </Tooltip>
                      )}
                      {won && (
                        <Typography variant="monoCaption" sx={{ color: 'primary.main' }}>
                          {formatReason(decision.reason_code)}
                        </Typography>
                      )}
                    </Stack>
                  );
                })}
              </Stack>
            </Section>

            <Divider />

            <Section title="Delegation chain" term="delegation">
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                {(decision.delegation_chain ?? []).map((agentId, index) => (
                  <Stack key={agentId} direction="row" spacing={0.75} alignItems="center">
                    {index > 0 && (
                      <IconifyIcon
                        icon="material-symbols:chevron-right-rounded"
                        sx={{ fontSize: 14, color: 'text.disabled' }}
                      />
                    )}
                    <Chip
                      size="small"
                      variant="soft"
                      color={index === decision.delegation_chain.length - 1 ? 'primary' : 'neutral'}
                      label={<Mono variant="monoCaption">{agentId}</Mono>}
                    />
                  </Stack>
                ))}
              </Stack>
            </Section>

            <Divider />

            <Section title="Features">
              <Stack spacing={0.75}>
                {Object.entries(decision.features ?? {}).map(([key, value]) => (
                  <Field key={key} label={key.replace(/_/g, ' ')} mono>
                    {value === null
                      ? '—'
                      : typeof value === 'boolean'
                        ? String(value)
                        : Array.isArray(value)
                          ? value.join(', ') || '—'
                          : String(value)}
                  </Field>
                ))}
              </Stack>
            </Section>

            <Divider />

            <Section title="Ledger" term="hash_chain">
              {decision.ledger ? (
                <Stack spacing={1}>
                  <Field label="Sequence" mono>
                    #{decision.ledger.sequence}
                  </Field>
                  <Field label={<Term term="prev_hash">Previous hash</Term>}>
                    <Hash value={decision.ledger.prev_hash} />
                  </Field>
                  <Field label={<Term term="self_hash">Record hash</Term>}>
                    <Hash value={decision.ledger.self_hash} />
                  </Field>
                  <Field label={<Term term="ruleset_hash">Ruleset</Term>}>
                    <Hash value={decision.ruleset_hash} />
                  </Field>
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                  No ledger record loaded for this decision.
                </Typography>
              )}
            </Section>
          </>
        )}
      </Box>

      {/* ---- footer ------------------------------------------------------ */}
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        justifyContent="space-between"
        sx={(theme) => ({
          p: 2,
          borderTop: '1px solid',
          borderColor: theme.vars.palette.divider,
          backgroundColor: theme.vars.palette.background.elevation2,
        })}
      >
        <Button
          size="small"
          variant="text"
          color="neutral"
          startIcon={
            <IconifyIcon
              icon={
                memberView
                  ? 'material-symbols:admin-panel-settings-outline-rounded'
                  : 'material-symbols:smartphone-outline-rounded'
              }
            />
          }
          onClick={() => setMemberView((value) => !value)}
        >
          {memberView ? 'Operator view' : 'Card member view'}
        </Button>

        <Button size="small" variant="contained" onClick={handleDispute} disabled={isMutating}>
          {isMutating ? 'Opening…' : 'Generate dispute packet'}
        </Button>
      </Stack>
    </Stack>
  );
};

const DecisionDrawer = ({ actionId, open, onClose }) => {
  const { up } = useBreakpoints();
  const isDesktop = up('md');
  const { data, isLoading } = useDecision(open ? actionId : null);

  const content =
    isLoading || !data ? (
      <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', p: 4 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Loading decision…
        </Typography>
      </Stack>
    ) : (
      <DecisionBody decision={data} onClose={onClose} />
    );

  if (isDesktop) {
    return (
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        slotProps={{
          paper: {
            sx: { width: { md: 520, lg: 580 }, maxWidth: '100vw' },
          },
        }}
      >
        {content}
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      {content}
    </Dialog>
  );
};

export default DecisionDrawer;
