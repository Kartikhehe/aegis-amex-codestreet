import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { formatCurrency, formatReason, formatScore, formatTime } from 'aegis/format';
import {
  denyGlowSx,
  staticRowVariants,
  streamRowTransition,
  streamRowVariants,
  useMotionAllowed,
} from 'aegis/motion';
import { AnimatePresence, motion } from 'framer-motion';
import IconifyIcon from 'components/base/IconifyIcon';
import Mono from './Mono';
import VerdictChip from './VerdictChip';

/**
 * The live decision stream.
 *
 * Signature motion moments #1 and #2 live here: rows slide+fade in at the top
 * (180ms), and a new DENY pulses red once before settling.
 *
 * Built as custom rows rather than a DataGrid on purpose -- MUI X virtualises
 * and recycles row nodes, which fights per-row enter animations and makes a
 * "new row arrived" cue impossible to land reliably.
 */

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'ALLOW', label: 'Allowed' },
  { key: 'STEP_UP', label: 'Needs approval' },
  { key: 'DENY', label: 'Denied' },
];

const StreamRow = ({ decision, isNew, onSelect, showShadow }) => {
  const animate = useMotionAllowed();
  const isDeny = decision.verdict === 'DENY';
  const pulse = isNew && isDeny && animate;

  return (
    <Box
      component={motion.div}
      layout={animate ? 'position' : false}
      variants={animate ? streamRowVariants : staticRowVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={streamRowTransition}
      onClick={() => onSelect?.(decision)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(decision);
        }
      }}
      sx={[
        (theme) => ({
          display: 'grid',
          // Column count must match what the row actually renders, otherwise
          // every cell after the mismatch shifts and the merchant column gets
          // squeezed to an ellipsis. The shadow column is only declared when
          // a shadow policy is running and the cell is actually present.
          gridTemplateColumns: {
            xs: 'auto minmax(0, 1fr) auto',
            md: `68px 132px minmax(0, 1fr) 104px 64px${showShadow ? ' 76px' : ''}`,
          },
          columnGap: { xs: 1.25, md: 2 },
          alignItems: 'center',
          gap: { xs: 1, md: 2 },
          px: { xs: 1.5, md: 2 },
          py: 1.25,
          borderBottom: '1px solid',
          borderColor: theme.vars.palette.divider,
          cursor: 'pointer',
          outline: 'none',
          transition: 'background-color 120ms ease',
          '&:hover, &:focus-visible': {
            backgroundColor: theme.vars.palette.background.elevation2,
          },
        }),
        pulse && denyGlowSx,
      ]}
    >
      {/* time */}
      <Mono
        variant="monoCaption"
        sx={{ color: 'text.disabled', display: { xs: 'none', md: 'block' } }}
      >
        {formatTime(decision.decided_at)}
      </Mono>

      {/* verdict */}
      <Box>
        <VerdictChip verdict={decision.verdict} stepUpState={decision.step_up_state} size="small" />
      </Box>

      {/* merchant + reason */}
      <Stack sx={{ minWidth: 0 }}>
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {decision.merchant_name}
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {formatReason(decision.reason_code)}
          </Typography>
          {decision.flagged && (
            <IconifyIcon
              icon="material-symbols:flag-rounded"
              sx={{ fontSize: 13, color: 'warning.main', flexShrink: 0 }}
            />
          )}
        </Stack>
      </Stack>

      {/* amount */}
      <Mono variant="monoSmall" sx={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {formatCurrency(decision.amount)}
      </Mono>

      {/* conformance */}
      <Mono
        variant="monoSmall"
        sx={{
          textAlign: 'right',
          display: { xs: 'none', md: 'block' },
          color:
            decision.conformance?.score == null
              ? 'text.disabled'
              : decision.conformance.score < 0.45
                ? 'error.main'
                : decision.conformance.score < 0.7
                  ? 'warning.main'
                  : 'text.secondary',
        }}
      >
        {formatScore(decision.conformance?.score)}
      </Mono>

      {/* shadow verdict, only while a shadow policy is running */}
      {showShadow && (
        <Box sx={{ display: { xs: 'none', md: 'block' }, textAlign: 'right' }}>
          {decision.shadow ? (
            <Mono
              variant="monoCaption"
              sx={{ color: decision.shadow.differs ? 'warning.main' : 'text.disabled' }}
            >
              {decision.shadow.differs ? `→ ${decision.shadow.verdict}` : 'same'}
            </Mono>
          ) : (
            <Mono variant="monoCaption" sx={{ color: 'text.disabled' }}>
              —
            </Mono>
          )}
        </Box>
      )}
    </Box>
  );
};

const DecisionStream = ({
  decisions = [],
  onSelect,
  showShadow = false,
  maxRows = 40,
  // True counts across the whole filtered set, from the server. Without these
  // the chips can only count the rows on screen, so a stream showing 60 of
  // 8,267 claimed there were 60 decisions in total.
  serverCounts = null,
  // Paging, when the caller supports it.
  page = 0,
  pageSize = 0,
  totalRows = 0,
  onPageChange = null,
}) => {
  const [filter, setFilter] = useState('ALL');
  const seen = useRef(new Set());
  const [newIds, setNewIds] = useState(new Set());
  const firstLoad = useRef(true);

  const filtered = useMemo(() => {
    if (onPageChange) return decisions;
    const rows = filter === 'ALL' ? decisions : decisions.filter((d) => d.verdict === filter);
    return rows.slice(0, maxRows);
  }, [decisions, filter, maxRows, onPageChange]);

  // Track which rows are genuinely new so only they animate. On first load
  // everything is "new", which would be a wall of motion -- so the first batch
  // is marked seen without animating.
  useEffect(() => {
    if (!decisions.length) return;

    if (firstLoad.current) {
      decisions.forEach((d) => seen.current.add(d.action_id));
      firstLoad.current = false;
      return;
    }

    const arrivals = decisions
      .filter((d) => !seen.current.has(d.action_id))
      .map((d) => d.action_id);

    if (arrivals.length) {
      arrivals.forEach((id) => seen.current.add(id));
      setNewIds(new Set(arrivals));
      const timer = setTimeout(() => setNewIds(new Set()), 2000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [decisions]);

  const counts = useMemo(() => {
    // Prefer the server's totals; fall back to counting what is loaded when a
    // caller has not supplied them.
    if (serverCounts) {
      const allow = serverCounts.ALLOW ?? 0;
      const deny = serverCounts.DENY ?? 0;
      const stepUp = serverCounts.STEP_UP ?? 0;
      return { ALL: allow + deny + stepUp, ALLOW: allow, STEP_UP: stepUp, DENY: deny };
    }
    const base = { ALL: decisions.length, ALLOW: 0, STEP_UP: 0, DENY: 0 };
    decisions.forEach((d) => {
      if (base[d.verdict] !== undefined) base[d.verdict] += 1;
    });
    return base;
  }, [decisions, serverCounts]);

  // When the server pages for us it has already applied the verdict filter, so
  // filtering again locally would hide rows that belong on the page.
  const paged = Boolean(onPageChange);

  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: { xs: 1.5, md: 2 }, pb: 1.5, flexWrap: 'wrap', rowGap: 1 }}
      >
        {FILTERS.map((option) => (
          <Chip
            key={option.key}
            label={
              <Stack direction="row" spacing={0.75} alignItems="center">
                <span>{option.label}</span>
                <Mono variant="monoCaption" sx={{ opacity: 0.7 }}>
                  {counts[option.key] ?? 0}
                </Mono>
              </Stack>
            }
            size="small"
            clickable
            variant={filter === option.key ? 'filled' : 'soft'}
            color={filter === option.key ? 'primary' : 'neutral'}
            onClick={() => {
              setFilter(option.key);
              onPageChange?.(0, option.key);
            }}
          />
        ))}
      </Stack>

      {/* Column header. Without it the mono figures on the right are just
          numbers floating in space -- the reader has to infer that one is
          money and the other is a score. */}
      {filtered.length > 0 && (
        <Box
          sx={(theme) => ({
            display: { xs: 'none', md: 'grid' },
            gridTemplateColumns: `68px 132px minmax(0, 1fr) 104px 64px${showShadow ? ' 76px' : ''}`,
            columnGap: 2,
            px: 2,
            pb: 1,
            borderBottom: '1px solid',
            borderColor: theme.vars.palette.divider,
            ...theme.typography.monoCaption,
            color: theme.vars.palette.text.disabled,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          })}
        >
          <Box>Time</Box>
          <Box>Verdict</Box>
          <Box>Merchant</Box>
          <Box sx={{ textAlign: 'right' }}>Amount</Box>
          <Box sx={{ textAlign: 'right' }}>Score</Box>
          {showShadow && <Box sx={{ textAlign: 'right' }}>Shadow</Box>}
        </Box>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ py: 8, px: 3 }}>
            <IconifyIcon
              icon="material-symbols:filter-list-off-rounded"
              sx={{ fontSize: 32, color: 'text.disabled' }}
            />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              No{' '}
              {filter === 'ALL' ? '' : FILTERS.find((f) => f.key === filter)?.label.toLowerCase()}{' '}
              decisions in this window
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
              {filter === 'ALL'
                ? 'Decisions appear here the moment an agent attempts a purchase.'
                : 'Try another filter, or widen the time window.'}
            </Typography>
          </Stack>
        ) : (
          <AnimatePresence initial={false}>
            {filtered.map((decision) => (
              <StreamRow
                key={decision.action_id}
                decision={decision}
                isNew={newIds.has(decision.action_id)}
                onSelect={onSelect}
                showShadow={showShadow}
              />
            ))}
          </AnimatePresence>
        )}
      </Box>

      {/* Pager. Only when the caller pages server-side, and only when there is
          more than one page -- a lone "1 of 1" is noise. */}
      {paged && totalRows > pageSize && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          sx={(theme) => ({
            px: { xs: 1.5, md: 2 },
            py: 1,
            borderTop: `1px solid ${theme.vars.palette.divider}`,
            flexShrink: 0,
          })}
        >
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            <Mono variant="monoCaption">
              {(page * pageSize + 1).toLocaleString('en-IN')}–
              {Math.min((page + 1) * pageSize, totalRows).toLocaleString('en-IN')}
            </Mono>{' '}
            of <Mono variant="monoCaption">{totalRows.toLocaleString('en-IN')}</Mono>
          </Typography>
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              disabled={page === 0}
              onClick={() => onPageChange(page - 1, filter)}
              sx={{ color: 'text.secondary', minWidth: 0 }}
            >
              Newer
            </Button>
            <Button
              size="small"
              disabled={(page + 1) * pageSize >= totalRows}
              onClick={() => onPageChange(page + 1, filter)}
              sx={{ color: 'text.secondary', minWidth: 0 }}
            >
              Older
            </Button>
          </Stack>
        </Stack>
      )}
    </Stack>
  );
};

export default DecisionStream;
