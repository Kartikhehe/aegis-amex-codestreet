import { useState } from 'react';
import { Box, Chip, Collapse, Stack, Tooltip, Typography } from '@mui/material';
import { buildDecisionFlow, shortHash } from 'aegis/decisionFlow';
import { formatRuleName } from 'aegis/format';
import IconifyIcon from 'components/base/IconifyIcon';
import Mono from './Mono';

/**
 * The decision flow: what AEGIS did, step by step, to reach this verdict.
 *
 * Built for the moment someone asks "but what actually happened?". It shows
 * the inputs, every gate the request passed through, the one that decided the
 * outcome, and the ledger record written afterwards.
 *
 * Design decisions that keep it readable rather than exhaustive:
 *
 *   - Stages, not sixteen equal rows. Four named phases (authority, integrity,
 *     conformance, limits) match how a person reasons about it; the individual
 *     rules live inside them.
 *   - Passed rules collapse to a count. Nobody needs to read nine green lines
 *     saying nothing happened -- but they can expand if they want to.
 *   - The decisive rule is always shown, in full, wherever it sits.
 *   - Rules AFTER the winner are marked "not reached", never "passed".
 *     Evaluation is first-match-wins, and claiming a rule passed when it never
 *     ran would be the one dishonest thing this view could do.
 */

const STATUS = {
  matched: { color: 'error', icon: 'material-symbols:cancel-rounded', label: 'stopped here' },
  passed: { color: 'success', icon: 'material-symbols:check-circle-rounded', label: 'passed' },
  skipped: { color: 'neutral', icon: 'material-symbols:remove-rounded', label: 'not applicable' },
  not_reached: {
    color: 'neutral',
    icon: 'material-symbols:more-horiz',
    label: 'not reached',
  },
};

const tone = (theme, color, key) =>
  color === 'neutral' ? theme.vars.palette.text.disabled : theme.vars.palette[color][key];

// Detail text carries the decisive number; keep it readable rather than loud.
const toneText = (color) => (color === 'neutral' ? 'text.disabled' : `${color}.main`);

/** A dashed connector between steps: the flow reads as a path, not a list. */
const Connector = ({ vertical = true, dim = false }) => (
  <Box
    aria-hidden
    sx={(theme) => ({
      alignSelf: vertical ? 'flex-start' : 'center',
      ml: vertical ? '11px' : 0,
      my: vertical ? 0.25 : 0,
      mx: vertical ? 0 : 0.75,
      width: vertical ? 0 : 18,
      height: vertical ? 12 : 0,
      borderLeft: vertical ? '1px dashed' : 0,
      borderTop: vertical ? 0 : '1px dashed',
      borderColor: dim ? theme.vars.palette.divider : theme.vars.palette.text.disabled,
      opacity: dim ? 0.5 : 0.8,
    })}
  />
);

const StepTile = ({ step, dense }) => {
  const status = STATUS[step.status] ?? STATUS.passed;
  // A matched clearance rule (`within_mandate`) is a pass, not a block.
  const color = step.decisive && step.isClearance ? 'success' : status.color;
  const icon = step.decisive && step.isClearance ? STATUS.passed.icon : status.icon;

  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        px: 1.25,
        py: dense ? 0.75 : 1,
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: step.decisive
          ? `rgba(${theme.vars.palette[color === 'neutral' ? 'primary' : color].mainChannel} / 0.42)`
          : theme.vars.palette.divider,
        backgroundColor: step.decisive
          ? `rgba(${theme.vars.palette[color === 'neutral' ? 'primary' : color].mainChannel} / 0.10)`
          : 'transparent',
        opacity: step.status === 'not_reached' ? 0.55 : 1,
      })}
    >
      <IconifyIcon
        icon={icon}
        sx={(theme) => ({
          fontSize: 16,
          mt: '1px',
          flexShrink: 0,
          color: tone(theme, color, 'main'),
        })}
      />
      <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ fontWeight: step.decisive ? 700 : 500 }}>
            {formatRuleName(step.name)}
          </Typography>
          {step.status === 'not_reached' && (
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              not reached
            </Typography>
          )}
        </Stack>
        {step.question && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {step.question}
          </Typography>
        )}
        {step.detail && (
          <Typography variant="caption" sx={{ color: toneText(color) }}>
            <Mono variant="monoCaption">{step.detail}</Mono>
          </Typography>
        )}
      </Stack>
    </Box>
  );
};

const Stage = ({ stage, index, expandedAll }) => {
  const [open, setOpen] = useState(false);
  const expanded = expandedAll || open;

  const quiet = stage.steps.filter((s) => !s.decisive);
  const decisive = stage.steps.filter((s) => s.decisive);
  const hiddenCount = quiet.length;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 1 }}>
        <Mono
          variant="monoCaption"
          sx={{ color: 'text.disabled', fontWeight: 700 }}
        >{`${index + 1}`}</Mono>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {stage.title}
        </Typography>
        {!stage.reached && (
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            not reached
          </Typography>
        )}
      </Stack>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        {stage.caption}
      </Typography>

      {/* A stage the decision never got to is stated once, not enumerated.
          Listing every unrun rule would bury the ones that actually decided
          this outcome -- but omitting the stage entirely would hide half the
          pipeline, so it stays visible and explicitly unreached. */}
      {!stage.reached ? (
        <Box
          sx={(theme) => ({
            px: 1.25,
            py: 1,
            borderRadius: 1.5,
            border: '1px dashed',
            borderColor: theme.vars.palette.divider,
          })}
        >
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            Not reached — an earlier rule already decided this.{' '}
            <Mono variant="monoCaption">
              {stage.steps.length} check{stage.steps.length === 1 ? '' : 's'}
            </Mono>{' '}
            did not run.
          </Typography>
        </Box>
      ) : (
        <Stack>
          {/* The rule that decided this stage is never collapsed. */}
          {decisive.map((step, i) => (
            <Box key={step.name}>
              {i > 0 && <Connector />}
              <StepTile step={step} />
            </Box>
          ))}

          {hiddenCount > 0 && (
            <>
              {decisive.length > 0 && <Connector dim />}
              <Collapse in={expanded} unmountOnExit>
                <Stack>
                  {quiet.map((step, i) => (
                    <Box key={step.name}>
                      {i > 0 && <Connector dim />}
                      <StepTile step={step} dense />
                    </Box>
                  ))}
                </Stack>
              </Collapse>
              {!expandedAll && (
                <Box
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen((v) => !v)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpen((v) => !v)}
                  sx={{
                    cursor: 'pointer',
                    px: 1.25,
                    py: 0.5,
                    mt: expanded ? 0.5 : 0,
                    borderRadius: 1,
                    '&:hover': { backgroundColor: 'action.hover' },
                  }}
                >
                  <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                    {expanded ? 'Hide' : `${hiddenCount} more check${hiddenCount === 1 ? '' : 's'}`}
                  </Typography>
                </Box>
              )}
            </>
          )}
        </Stack>
      )}
    </Box>
  );
};

const Panel = ({ title, children, sx }) => (
  <Box
    sx={[
      (theme) => ({
        p: 1.5,
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: theme.vars.palette.divider,
        backgroundColor: theme.vars.palette.background.elevation1,
      }),
      ...(Array.isArray(sx) ? sx : [sx]),
    ]}
  >
    <Typography
      variant="caption"
      sx={{
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'text.disabled',
        display: 'block',
        mb: 1,
      }}
    >
      {title}
    </Typography>
    {children}
  </Box>
);

const KeyValue = ({ label, value, mono }) => (
  <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="baseline">
    <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
      {label}
    </Typography>
    {mono ? (
      <Mono variant="monoCaption" sx={{ textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </Mono>
    ) : (
      <Typography variant="caption" sx={{ textAlign: 'right', fontWeight: 500 }}>
        {value}
      </Typography>
    )}
  </Stack>
);

/**
 * @param {object} decision  the full decision record
 * @param {boolean} expanded maximized view: every check visible, wider layout
 */
const DecisionFlow = ({ decision, expanded = false }) => {
  const flow = buildDecisionFlow(decision);
  if (!flow) return null;

  return (
    <Stack spacing={2}>
      {/* ---- what came in ------------------------------------------- */}
      <Panel title="What came in">
        <Stack spacing={0.75}>
          {flow.inputs.map((input) => (
            <KeyValue key={input.label} {...input} />
          ))}
          {flow.riskAttributes.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, pt: 0.5 }}>
              {flow.riskAttributes.map((attribute) => (
                <Chip
                  key={attribute}
                  size="small"
                  label={attribute}
                  color="warning"
                  variant="outlined"
                  sx={{ height: 20 }}
                />
              ))}
            </Stack>
          )}
          {flow.injected && (
            <Box sx={{ pt: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
                Injected instruction detected
              </Typography>
              {/* Hostile input is shown as evidence, truncated. It is never
                  reproduced in full on a shared screen. */}
              <Mono
                variant="monoCaption"
                sx={{ display: 'block', color: 'text.disabled', mt: 0.25 }}
              >
                {flow.injected}
              </Mono>
            </Box>
          )}
        </Stack>
      </Panel>

      {/* ---- the authority it was checked against -------------------- */}
      {flow.authority.length > 0 && (
        <Panel title="Authority it was checked against">
          <Stack spacing={0.75}>
            {flow.authority.map((item) => (
              <KeyValue key={item.label} {...item} mono />
            ))}
          </Stack>
        </Panel>
      )}

      {/* ---- the pipeline ------------------------------------------- */}
      <Box>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="baseline"
          sx={{ mb: 1.5 }}
        >
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'text.disabled',
            }}
          >
            How it was decided
          </Typography>
          <Tooltip title="Rules are evaluated in order and the first match decides the outcome.">
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              <Mono variant="monoCaption">
                {flow.evaluated}/{flow.total}
              </Mono>{' '}
              checks run
            </Typography>
          </Tooltip>
        </Stack>

        <Stack spacing={expanded ? 2.5 : 2}>
          {flow.stages.map((stage, index) => (
            <Box key={stage.key}>
              {index > 0 && (
                <Box sx={{ mb: expanded ? 2.5 : 2 }}>
                  <Connector dim={!stage.reached} />
                </Box>
              )}
              <Stage stage={stage} index={index} expandedAll={expanded} />
            </Box>
          ))}
        </Stack>
      </Box>

      {/* ---- the conformance score, when one was taken --------------- */}
      {flow.conformance && (
        <Panel title="Conformance score">
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} alignItems="baseline">
              <Mono variant="monoHeading" sx={{ fontWeight: 700 }}>
                {flow.scoreLabel ?? '—'}
              </Mono>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {flow.conformance.available ? 'scored' : 'scorer unavailable — failed closed'}
              </Typography>
            </Stack>
            {flow.conformance.rationale && (
              <Typography variant="caption" sx={{ color: 'text.primary' }}>
                “{flow.conformance.rationale}”
              </Typography>
            )}
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                model <Mono variant="monoCaption">{flow.conformance.model_version}</Mono>
              </Typography>
              {flow.conformance.cached && (
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                  served from cache
                </Typography>
              )}
            </Stack>
          </Stack>
        </Panel>
      )}

      {/* ---- what was written down ---------------------------------- */}
      <Panel title="What was written down">
        <Stack spacing={0.75}>
          <KeyValue label="Verdict" value={flow.verdict} mono />
          <KeyValue label="Deciding rule" value={formatRuleName(flow.winner?.name ?? '—')} />
          {/* Hashes are the proof, so they stay -- truncated, because nobody
              verifies a 64-character digest by eye. */}
          <KeyValue label="Ruleset" value={shortHash(flow.rulesetHash)} mono />
          {flow.cartDigest && (
            <KeyValue label="Basket digest" value={shortHash(flow.cartDigest)} mono />
          )}
          {flow.ledger && (
            <>
              <KeyValue label="Ledger sequence" value={`#${flow.ledger.sequence}`} mono />
              <KeyValue label="Previous hash" value={shortHash(flow.ledger.prev_hash)} mono />
              <KeyValue label="This record" value={shortHash(flow.ledger.self_hash)} mono />
            </>
          )}
        </Stack>
      </Panel>
    </Stack>
  );
};

export default DecisionFlow;
