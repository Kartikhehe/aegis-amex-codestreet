import { useState } from 'react';
import { Box, Chip, Collapse, Stack, Tooltip, Typography } from '@mui/material';
import { buildDecisionFlow, shortHash } from 'aegis/decisionFlow';
import { formatRuleName } from 'aegis/format';
import IconifyIcon from 'components/base/IconifyIcon';
import Mono from './Mono';

/**
 * The decision flow: what AEGIS did, step by step, to reach this verdict.
 *
 * Drawn as an actual flow -- a continuous spine with nodes on it -- rather than
 * a stack of cards, because the thing a reader needs to grasp first is that
 * this is ONE path with an order, and that it stops somewhere. A list cannot
 * show "stops here"; a line with a terminator can.
 *
 * The visual grammar, used consistently:
 *
 *   ● filled node     a check that ran
 *   ◆ decisive node   the one that decided the outcome, ringed and coloured
 *   ○ hollow node     never evaluated -- the path had already ended
 *   solid rail        the path that was actually taken
 *   dashed rail       the path that was never walked
 *
 * Colour carries verdict meaning only: red stops, green clears, amber holds.
 * Stage headers are neutral, so nothing competes with the one node that
 * actually decided this.
 */

const STATUS = {
  matched: { color: 'error', icon: 'material-symbols:block-rounded' },
  passed: { color: 'success', icon: 'material-symbols:check-small-rounded' },
  skipped: { color: 'neutral', icon: 'material-symbols:remove-rounded' },
  not_reached: { color: 'neutral', icon: null },
};

const RAIL_X = 13; // centre of the node column, in px
const NODE = 26;

/** The vertical rail the nodes sit on. */
const Rail = ({ walked = true, height = 14 }) => (
  <Box
    aria-hidden
    sx={(theme) => ({
      ml: `${RAIL_X}px`,
      width: 0,
      height,
      borderLeft: walked ? '2px solid' : '2px dashed',
      borderColor: walked ? theme.vars.palette.divider : theme.vars.palette.background.elevation3,
    })}
  />
);

const Node = ({ status, decisive, isClearance }) => {
  const config = STATUS[status] ?? STATUS.passed;
  const color = decisive && isClearance ? 'success' : config.color;
  const icon = decisive && isClearance ? STATUS.passed.icon : config.icon;
  const neutral = color === 'neutral';

  return (
    <Box
      sx={(theme) => ({
        width: NODE,
        height: NODE,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        border: '2px solid',
        borderColor: neutral
          ? theme.vars.palette.background.elevation3
          : theme.vars.palette[color].main,
        backgroundColor: neutral
          ? theme.vars.palette.background.default
          : decisive
            ? theme.vars.palette[color].main
            : `rgba(${theme.vars.palette[color].mainChannel} / 0.16)`,
        // The deciding node gets a halo so the eye lands on it first.
        boxShadow: decisive
          ? `0 0 0 4px rgba(${theme.vars.palette[color].mainChannel} / 0.18)`
          : 'none',
      })}
    >
      {icon ? (
        <IconifyIcon
          icon={icon}
          sx={(theme) => ({
            fontSize: 15,
            color: decisive
              ? theme.vars.palette[color].contrastText
              : neutral
                ? theme.vars.palette.text.disabled
                : theme.vars.palette[color].main,
          })}
        />
      ) : (
        <Box
          sx={(theme) => ({
            width: 5,
            height: 5,
            borderRadius: '50%',
            backgroundColor: theme.vars.palette.text.disabled,
            opacity: 0.5,
          })}
        />
      )}
    </Box>
  );
};

const Step = ({ step, last }) => {
  const config = STATUS[step.status] ?? STATUS.passed;
  const color = step.decisive && step.isClearance ? 'success' : config.color;
  const unreached = step.status === 'not_reached';

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Node status={step.status} decisive={step.decisive} isClearance={step.isClearance} />
        <Box
          sx={(theme) => ({
            flex: 1,
            minWidth: 0,
            mt: '1px',
            px: 1.5,
            py: 1,
            borderRadius: 1.5,
            border: '1px solid',
            borderColor: step.decisive
              ? `rgba(${theme.vars.palette[color].mainChannel} / 0.5)`
              : theme.vars.palette.divider,
            backgroundColor: step.decisive
              ? `rgba(${theme.vars.palette[color].mainChannel} / 0.09)`
              : theme.vars.palette.background.elevation1,
            opacity: unreached ? 0.5 : 1,
          })}
        >
          <Stack direction="row" spacing={1} alignItems="baseline" sx={{ flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ fontWeight: step.decisive ? 700 : 500 }}>
              {formatRuleName(step.name)}
            </Typography>
            {step.decisive && (
              <Chip
                size="small"
                label={step.isClearance ? 'cleared' : 'stopped here'}
                color={color}
                sx={{ height: 17, fontSize: 10, fontWeight: 700 }}
              />
            )}
            {unreached && (
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                not evaluated
              </Typography>
            )}
          </Stack>
          {step.question && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              {step.question}
            </Typography>
          )}
          {step.detail && (
            <Mono
              variant="monoCaption"
              sx={{
                display: 'block',
                mt: 0.5,
                color: color === 'neutral' ? 'text.disabled' : `${color}.main`,
              }}
            >
              {step.detail}
            </Mono>
          )}
        </Box>
      </Stack>
      {!last && <Rail walked={!unreached} />}
    </Box>
  );
};

/** A stage: a labelled band of the flow, with its own rail segment. */
const Stage = ({ stage, index, expandedAll, isLast }) => {
  const [open, setOpen] = useState(false);
  const expanded = expandedAll || open;

  const decisive = stage.steps.filter((s) => s.decisive);
  const quiet = stage.steps.filter((s) => !s.decisive);
  const shown = expanded ? stage.steps : decisive;
  const hidden = expanded ? 0 : quiet.length;

  return (
    <Box>
      {/* --- stage header, sitting ON the rail ---------------------- */}
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.25 }}>
        <Box
          sx={(theme) => ({
            width: NODE,
            height: NODE,
            flexShrink: 0,
            borderRadius: 1,
            display: 'grid',
            placeItems: 'center',
            backgroundColor: stage.reached
              ? theme.vars.palette.background.elevation3
              : 'transparent',
            border: stage.reached ? 'none' : '1px dashed',
            borderColor: theme.vars.palette.divider,
          })}
        >
          <Mono
            variant="monoCaption"
            sx={{ fontWeight: 700, color: stage.reached ? 'text.primary' : 'text.disabled' }}
          >
            {index + 1}
          </Mono>
        </Box>
        <Stack sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 700, color: stage.reached ? 'text.primary' : 'text.disabled' }}
          >
            {stage.title}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {stage.caption}
          </Typography>
        </Stack>
      </Stack>

      {/* --- the stage's own steps ---------------------------------- */}
      <Box sx={{ pl: 0 }}>
        {!stage.reached ? (
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Node status="not_reached" />
            <Box
              sx={(theme) => ({
                flex: 1,
                px: 1.5,
                py: 1,
                borderRadius: 1.5,
                border: '1px dashed',
                borderColor: theme.vars.palette.divider,
              })}
            >
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                Never evaluated — the path ended earlier.{' '}
                <Mono variant="monoCaption">{stage.steps.length}</Mono> checks skipped.
              </Typography>
            </Box>
          </Stack>
        ) : (
          <>
            {shown.map((step, i) => (
              <Step key={step.name} step={step} last={i === shown.length - 1 && !hidden} />
            ))}

            {hidden > 0 && (
              <>
                {shown.length > 0 && <Rail />}
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ width: NODE, display: 'grid', placeItems: 'center' }}>
                    <Box
                      sx={(theme) => ({
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        border: '1px solid',
                        borderColor: theme.vars.palette.divider,
                      })}
                    />
                  </Box>
                  <Box
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpen(true)}
                    onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}
                    sx={{
                      cursor: 'pointer',
                      px: 1,
                      py: 0.5,
                      borderRadius: 1,
                      '&:hover': { backgroundColor: 'action.hover' },
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                      {hidden} more check{hidden === 1 ? '' : 's'}, all passed — show
                    </Typography>
                  </Box>
                </Stack>
              </>
            )}

            <Collapse in={expanded && !expandedAll} unmountOnExit>
              <Box sx={{ pt: 1 }}>
                <Typography
                  variant="caption"
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(false)}
                  sx={{ ml: `${NODE + 12}px`, color: 'text.disabled', cursor: 'pointer' }}
                >
                  Hide passed checks
                </Typography>
              </Box>
            </Collapse>
          </>
        )}
      </Box>

      {!isLast && <Rail walked={stage.reached} height={20} />}
    </Box>
  );
};

/** A titled block of key/value evidence. */
const Panel = ({ title, tone, children }) => (
  <Box
    sx={(theme) => ({
      borderRadius: 2,
      border: '1px solid',
      borderColor: tone
        ? `rgba(${theme.vars.palette[tone].mainChannel} / 0.32)`
        : theme.vars.palette.divider,
      backgroundColor: tone
        ? `rgba(${theme.vars.palette[tone].mainChannel} / 0.07)`
        : theme.vars.palette.background.elevation1,
      overflow: 'hidden',
    })}
  >
    <Typography
      variant="caption"
      sx={(theme) => ({
        display: 'block',
        px: 1.75,
        py: 1,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: tone ? `${tone}.main` : 'text.disabled',
        borderBottom: '1px solid',
        borderColor: tone
          ? `rgba(${theme.vars.palette[tone].mainChannel} / 0.24)`
          : theme.vars.palette.divider,
      })}
    >
      {title}
    </Typography>
    <Box sx={{ px: 1.75, py: 1.5 }}>{children}</Box>
  </Box>
);

const KeyValue = ({ label, value, mono }) => (
  <Stack direction="row" spacing={1.5} justifyContent="space-between" alignItems="baseline">
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

/** Terminator: the start and end caps that make this read as a flow. */
const Terminus = ({ label, tone = 'neutral', top = false }) => (
  <Box>
    {!top && <Rail height={18} />}
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Box
        sx={(theme) => ({
          width: NODE,
          height: NODE,
          flexShrink: 0,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          backgroundColor:
            tone === 'neutral'
              ? theme.vars.palette.background.elevation3
              : theme.vars.palette[tone].main,
        })}
      >
        <IconifyIcon
          icon={top ? 'material-symbols:play-arrow-rounded' : 'material-symbols:flag-rounded'}
          sx={(theme) => ({
            fontSize: 15,
            color:
              tone === 'neutral'
                ? theme.vars.palette.text.secondary
                : theme.vars.palette[tone].contrastText,
          })}
        />
      </Box>
      <Typography
        variant="caption"
        sx={{
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: tone === 'neutral' ? 'text.secondary' : `${tone}.main`,
        }}
      >
        {label}
      </Typography>
    </Stack>
    {top && <Rail height={18} />}
  </Box>
);

const VERDICT_TONE = { ALLOW: 'success', DENY: 'error', STEP_UP: 'warning' };

const DecisionFlow = ({ decision, expanded = false }) => {
  const flow = buildDecisionFlow(decision);
  if (!flow) return null;
  const tone = VERDICT_TONE[flow.verdict] ?? 'neutral';

  return (
    <Stack spacing={2}>
      {/* ---- inputs ------------------------------------------------- */}
      <Panel title="What came in">
        <Stack spacing={0.75}>
          {flow.inputs.map((input) => (
            <KeyValue key={input.label} {...input} />
          ))}
          {flow.riskAttributes.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, pt: 0.75 }}>
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
            <Box sx={{ pt: 0.75 }}>
              <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
                Injected instruction detected
              </Typography>
              {/* Hostile input, shown as evidence and truncated. Never
                  reproduced in full on a shared screen. */}
              <Mono variant="monoCaption" sx={{ display: 'block', color: 'text.disabled' }}>
                {flow.injected}
              </Mono>
            </Box>
          )}
        </Stack>
      </Panel>

      {flow.authority.length > 0 && (
        <Panel title="Authority it was checked against">
          <Stack spacing={0.75}>
            {flow.authority.map((item) => (
              <KeyValue key={item.label} {...item} mono />
            ))}
          </Stack>
        </Panel>
      )}

      {/* ---- the flow itself ---------------------------------------- */}
      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 2 }}>
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
          <Tooltip title="Rules run in order; the first one to match decides the outcome and the rest never run.">
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              <Mono variant="monoCaption">
                {flow.evaluated}/{flow.total}
              </Mono>{' '}
              checks run
            </Typography>
          </Tooltip>
        </Stack>

        <Terminus label="Request received" top />

        {flow.stages.map((stage, index) => (
          <Stage
            key={stage.key}
            stage={stage}
            index={index}
            expandedAll={expanded}
            isLast={index === flow.stages.length - 1}
          />
        ))}

        <Terminus label={flow.verdict} tone={tone} />
      </Box>

      {/* ---- the score ---------------------------------------------- */}
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
              <Typography variant="caption" sx={{ color: 'text.primary', lineHeight: 1.6 }}>
                “{flow.conformance.rationale}”
              </Typography>
            )}
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              model <Mono variant="monoCaption">{flow.conformance.model_version}</Mono>
              {flow.conformance.cached ? ' · from cache' : ''}
            </Typography>
          </Stack>
        </Panel>
      )}

      {/* ---- the record --------------------------------------------- */}
      <Panel title="What was written down" tone={tone === 'neutral' ? undefined : tone}>
        <Stack spacing={0.75}>
          <KeyValue label="Verdict" value={flow.verdict} mono />
          <KeyValue label="Deciding rule" value={formatRuleName(flow.winner?.name ?? '—')} />
          {/* Hashes stay -- they are the proof -- but truncated, because
              nobody verifies a 64-character digest by eye. */}
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
