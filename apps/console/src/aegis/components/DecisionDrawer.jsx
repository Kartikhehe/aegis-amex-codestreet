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
  Typography,
} from '@mui/material';
import { formatCurrency, formatDateTime, formatLatency, formatScore } from 'aegis/format';
import { useDecision, useOpenDispute } from 'aegis/hooks';
import { useSnackbar } from 'notistack';
import { useBreakpoints } from 'providers/BreakpointsProvider';
import IconifyIcon from 'components/base/IconifyIcon';
import DecisionFlow from './DecisionFlow';
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

const DecisionBody = ({ decision, onClose, onMaximise }) => {
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

            <Section
              title="How it was decided"
              term="winning_rule"
              action={
                <Button
                  size="small"
                  onClick={onMaximise}
                  startIcon={<IconifyIcon icon="material-symbols:open-in-full-rounded" />}
                  sx={{ color: 'text.secondary' }}
                >
                  Expand
                </Button>
              }
            >
              <DecisionFlow decision={decision} />
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

/**
 * The maximised flow.
 *
 * The drawer is 580px wide, which is right for reading a verdict and wrong for
 * following a sixteen-step pipeline. This opens the same flow with every check
 * expanded and room to breathe -- the view to put on a projector when someone
 * asks to see exactly what the engine did.
 *
 * Columns on a wide screen, a single scrolling column otherwise. The stages are
 * independent, so they reflow without losing their order.
 */
const MaximisedFlow = ({ decision, open, onClose }) => (
  <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      spacing={2}
      sx={(theme) => ({
        px: 3,
        py: 2,
        borderBottom: '1px solid',
        borderColor: theme.vars.palette.divider,
      })}
    >
      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          How this decision was reached
        </Typography>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Mono variant="monoCaption" sx={{ color: 'text.disabled' }}>
            {decision.action_id}
          </Mono>
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            {formatDateTime(decision.decided_at)}
          </Typography>
        </Stack>
      </Stack>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <VerdictChip
          verdict={decision.verdict}
          stepUpState={decision.step_up_state}
          size="medium"
        />
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <IconifyIcon icon="material-symbols:close-rounded" />
        </IconButton>
      </Stack>
    </Stack>

    <Box sx={{ p: 3, overflowY: 'auto' }}>
      {/* Plain language first: the reason is the answer, the flow is the
          working. Someone should be able to stop reading after this line. */}
      <Typography variant="body1" sx={{ mb: 3, maxWidth: '72ch' }}>
        {decision.human_readable_reason}
      </Typography>
      <DecisionFlow decision={decision} expanded />
    </Box>
  </Dialog>
);

const DecisionDrawer = ({ actionId, open, onClose }) => {
  const { up } = useBreakpoints();
  const isDesktop = up('md');
  const { data, isLoading } = useDecision(open ? actionId : null);
  const [maximised, setMaximised] = useState(false);

  const content =
    isLoading || !data ? (
      <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', p: 4 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Loading decision…
        </Typography>
      </Stack>
    ) : (
      <DecisionBody decision={data} onClose={onClose} onMaximise={() => setMaximised(true)} />
    );

  const maximisedFlow = data && (
    <MaximisedFlow decision={data} open={maximised} onClose={() => setMaximised(false)} />
  );

  if (isDesktop) {
    return (
      <>
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
        {maximisedFlow}
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} fullScreen>
        {content}
      </Dialog>
      {maximisedFlow}
    </>
  );
};

export default DecisionDrawer;
