import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { formatCurrency, formatDateTime, formatNumber, formatScore } from 'aegis/format';
import IconifyIcon from 'components/base/IconifyIcon';
import Mono from './Mono';
import VerdictChip from './VerdictChip';

/**
 * The transactions a candidate policy would change, one by one.
 *
 * The blast radius used to be four numbers. Numbers are not reviewable: "298
 * newly blocked" reads identically whether those 298 are fraud attempts or a
 * card member's weekly groceries, and only one of those is a reason to promote.
 * So every row here carries what is known about whether the purchase was
 * actually wanted, and the header states the trade in those terms.
 *
 * Layout is list-on-the-left, detail-on-the-right: scanning for the odd one out
 * and reading one case in full are different jobs, and a single table does
 * neither well. "Open full decision" hands off to the same drawer used
 * everywhere else, so this is a lens onto the record rather than a second
 * version of it.
 */

// How each verdict change is judged, and what to say about it. Keyed by the
// `judgement` the API computes -- see `_delta_row` in service.py.
const JUDGEMENTS = {
  harms_good_traffic: {
    label: 'Was wanted',
    color: 'error',
    icon: 'material-symbols:sentiment-dissatisfied-rounded',
    blurb: 'The card member wanted this purchase. Stopping it is a false block.',
  },
  catches_bad_traffic: {
    label: 'Should be stopped',
    color: 'success',
    icon: 'material-symbols:shield-rounded',
    blurb: 'This purchase was outside what the agent was authorised to do.',
  },
  disputed_unreviewed: {
    label: 'Disputed',
    color: 'warning',
    icon: 'material-symbols:help-rounded',
    blurb:
      'The member said this block was wrong, but no operator has reviewed the claim yet, so it is not counted as a false block.',
  },
  unknown: {
    label: 'No evidence',
    color: 'neutral',
    icon: 'material-symbols:remove-rounded',
    blurb: 'Nobody has said whether this purchase was wanted, so it cannot be judged either way.',
  },
};

/** "1 purchase" / "2 purchases". Careful numbers deserve careful grammar. */
const plural = (count, singular, pluralForm = `${singular}s`) =>
  count === 1 ? singular : pluralForm;

/** One line of the header verdict. Only rendered when the count is non-zero. */
const Trade = ({ icon, color, count, children }) => (
  <Stack direction="row" spacing={1} alignItems="flex-start">
    <IconifyIcon icon={icon} sx={{ fontSize: 17, mt: 0.15, color: `${color}.main` }} />
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      <Box component="span" sx={{ fontWeight: 700, color: `${color}.main` }}>
        {formatNumber(count)}
      </Box>{' '}
      {children}
    </Typography>
  </Stack>
);

const PolicyChangesDialog = ({ open, onClose, result, focus = 'all', onOpenDecision }) => {
  // `focus` lets a specific tile open straight to its own rows -- clicking
  // "sent for approval" should not land you on a list of everything.
  const [tab, setTab] = useState(focus);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (open) {
      setTab(focus);
      setSelectedId(null);
    }
  }, [open, focus]);

  const impact = result?.impact ?? {};
  const blocked = result?.newly_blocked ?? [];
  const allowed = result?.newly_allowed ?? [];

  const rows = useMemo(() => {
    if (tab === 'blocked') return blocked;
    if (tab === 'allowed') return allowed;
    return [...blocked, ...allowed];
  }, [tab, blocked, allowed]);

  // Keep a selection in view as the tab changes rather than blanking the pane.
  const selected = rows.find((row) => row.action_id === selectedId) ?? rows[0] ?? null;

  // Tab counts are the TRUE totals from the whole replay, not the length of
  // the truncated preview. Showing 100 beside a header that says 1,365 reads
  // like one of the two numbers is wrong.
  const blockedTotal = result?.newly_blocked_count ?? blocked.length;
  const allowedTotal = result?.newly_allowed_count ?? allowed.length;
  const TABS = [
    { key: 'all', label: 'All changes', count: blockedTotal + allowedTotal },
    { key: 'blocked', label: 'Newly stopped', count: blockedTotal },
    { key: 'allowed', label: 'Newly let through', count: allowedTotal },
  ];

  const truncated =
    (result?.newly_blocked_count ?? 0) + (result?.newly_allowed_count ?? 0) >
    blocked.length + allowed.length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
          <Stack spacing={0.25}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              What this policy would change
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Replayed against{' '}
              <Mono variant="monoCaption">{formatNumber(result?.replayed_count ?? 0)}</Mono> real
              decisions. Nothing here has been applied.
            </Typography>
          </Stack>
          <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}>
            <IconifyIcon icon="material-symbols:close-rounded" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pt: 0 }}>
        {/* ---- the trade, in words ----------------------------------- */}
        <Stack
          spacing={1}
          sx={(theme) => ({
            p: 2,
            mb: 2,
            borderRadius: 2,
            border: `1px solid ${theme.vars.palette.divider}`,
            backgroundColor: theme.vars.palette.background.elevation2,
          })}
        >
          {impact.bad_traffic_newly_caught > 0 && (
            <Trade
              icon="material-symbols:shield-rounded"
              color="success"
              count={impact.bad_traffic_newly_caught}
            >
              unauthorised {plural(impact.bad_traffic_newly_caught, 'purchase')} would now be
              stopped.
            </Trade>
          )}
          {impact.good_traffic_newly_harmed > 0 && (
            <Trade
              icon="material-symbols:sentiment-dissatisfied-rounded"
              color="error"
              count={impact.good_traffic_newly_harmed}
            >
              {plural(impact.good_traffic_newly_harmed, 'purchase')} the card member wanted would
              now be stopped —{' '}
              {plural(impact.good_traffic_newly_harmed, 'a new false block', 'new false blocks')}.
            </Trade>
          )}
          {impact.false_blocks_resolved > 0 && (
            <Trade
              icon="material-symbols:check-circle-rounded"
              color="success"
              count={impact.false_blocks_resolved}
            >
              confirmed {plural(impact.false_blocks_resolved, 'false block')} would be resolved —
              {impact.false_blocks_resolved === 1 ? ' a block' : ' blocks'} a member disputed and an
              operator upheld.
            </Trade>
          )}
          {impact.disputes_resolved > impact.false_blocks_resolved && (
            <Trade
              icon="material-symbols:help-rounded"
              color="warning"
              count={impact.disputes_resolved - impact.false_blocks_resolved}
            >
              further disputed{' '}
              {plural(impact.disputes_resolved - impact.false_blocks_resolved, 'block')} would be
              resolved, still awaiting operator review.
            </Trade>
          )}
          {impact.bad_traffic_newly_released > 0 && (
            <Trade
              icon="material-symbols:warning-rounded"
              color="warning"
              count={impact.bad_traffic_newly_released}
            >
              unauthorised {plural(impact.bad_traffic_newly_released, 'purchase')} would no longer
              be stopped outright.
            </Trade>
          )}
          {impact.unlabelled > 0 && (
            <Trade icon="material-symbols:remove-rounded" color="neutral" count={impact.unlabelled}>
              {plural(impact.unlabelled, 'change')} {impact.unlabelled === 1 ? 'has' : 'have'} no
              evidence either way, so {impact.unlabelled === 1 ? 'it cannot' : 'they cannot'} be
              judged.
            </Trade>
          )}
          {!blocked.length && !allowed.length && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              This policy would not have changed any recorded decision.
            </Typography>
          )}
        </Stack>

        {/* ---- tabs -------------------------------------------------- */}
        <Stack direction="row" spacing={0.5} sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
          {TABS.map((option) => (
            <Button
              key={option.key}
              size="small"
              variant={tab === option.key ? 'soft' : 'text'}
              color={tab === option.key ? 'primary' : 'neutral'}
              onClick={() => setTab(option.key)}
              sx={{ color: tab === option.key ? undefined : 'text.secondary' }}
            >
              {option.label}
              <Mono variant="monoCaption" sx={{ ml: 0.75, opacity: 0.75 }}>
                {formatNumber(option.count)}
              </Mono>
            </Button>
          ))}
        </Stack>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ minHeight: 420 }}>
          {/* ---- left: the list ------------------------------------- */}
          <Box
            sx={(theme) => ({
              width: { xs: '100%', md: 340 },
              flexShrink: 0,
              maxHeight: 470,
              overflowY: 'auto',
              borderRadius: 2,
              border: `1px solid ${theme.vars.palette.divider}`,
            })}
          >
            {rows.length === 0 && (
              <Typography variant="body2" sx={{ p: 2, color: 'text.secondary' }}>
                Nothing in this group.
              </Typography>
            )}
            {rows.map((row) => {
              const judgement = JUDGEMENTS[row.judgement] ?? JUDGEMENTS.unknown;
              const isSelected = selected?.action_id === row.action_id;
              return (
                <Stack
                  key={row.action_id}
                  onClick={() => setSelectedId(row.action_id)}
                  spacing={0.5}
                  sx={(theme) => ({
                    p: 1.5,
                    cursor: 'pointer',
                    borderBottom: `1px solid ${theme.vars.palette.divider}`,
                    backgroundColor: isSelected
                      ? `rgba(${theme.vars.palette.primary.mainChannel} / 0.1)`
                      : 'transparent',
                    '&:hover': {
                      backgroundColor: isSelected
                        ? `rgba(${theme.vars.palette.primary.mainChannel} / 0.14)`
                        : theme.vars.palette.background.elevation2,
                    },
                  })}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <IconifyIcon
                      icon={judgement.icon}
                      sx={{ fontSize: 15, color: `${judgement.color}.main`, flexShrink: 0 }}
                    />
                    <Typography
                      variant="subtitle2"
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.merchant_name}
                    </Typography>
                    <Mono variant="monoCaption" sx={{ fontWeight: 600 }}>
                      {formatCurrency(row.amount)}
                    </Mono>
                  </Stack>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <VerdictChip verdict={row.before_verdict} size="small" showLabel={false} />
                    <IconifyIcon
                      icon="material-symbols:arrow-right-alt-rounded"
                      sx={{ fontSize: 15, color: 'text.disabled' }}
                    />
                    <VerdictChip verdict={row.after_verdict} size="small" showLabel={false} />
                    <Typography variant="caption" sx={{ color: 'text.disabled', ml: 0.5 }}>
                      {judgement.label}
                    </Typography>
                  </Stack>
                </Stack>
              );
            })}
          </Box>

          {/* ---- right: the one case in full ------------------------ */}
          <Box
            sx={(theme) => ({
              flex: 1,
              minWidth: 0,
              borderRadius: 2,
              border: `1px solid ${theme.vars.palette.divider}`,
              p: 2,
            })}
          >
            {!selected ? (
              <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', py: 6 }}>
                <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                  Select a transaction to see why it changed.
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={2}>
                <Stack
                  direction="row"
                  spacing={2}
                  alignItems="flex-start"
                  justifyContent="space-between"
                >
                  <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      {selected.merchant_name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {formatCurrency(selected.amount)} · {selected.merchant_category} ·{' '}
                      {formatDateTime(selected.decided_at)}
                    </Typography>
                  </Stack>
                  <Chip
                    size="small"
                    variant="soft"
                    color={(JUDGEMENTS[selected.judgement] ?? JUDGEMENTS.unknown).color}
                    label={(JUDGEMENTS[selected.judgement] ?? JUDGEMENTS.unknown).label}
                  />
                </Stack>

                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {(JUDGEMENTS[selected.judgement] ?? JUDGEMENTS.unknown).blurb}
                </Typography>

                <Divider />

                {/* The change itself, with the rule on each side. */}
                <Stack spacing={1.25}>
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
                    The change
                  </Typography>
                  <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                    <Stack spacing={0.5}>
                      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                        Today
                      </Typography>
                      <VerdictChip verdict={selected.before_verdict} size="small" />
                      <Mono variant="monoCaption" sx={{ color: 'text.secondary' }}>
                        {selected.before_rule}
                      </Mono>
                    </Stack>
                    <IconifyIcon
                      icon="material-symbols:arrow-right-alt-rounded"
                      sx={{ fontSize: 22, color: 'text.disabled' }}
                    />
                    <Stack spacing={0.5}>
                      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                        Under this policy
                      </Typography>
                      <VerdictChip verdict={selected.after_verdict} size="small" />
                      <Mono variant="monoCaption" sx={{ color: 'text.secondary' }}>
                        {selected.after_rule}
                      </Mono>
                    </Stack>
                  </Stack>
                </Stack>

                <Divider />

                <Stack spacing={1}>
                  {selected.description && (
                    <Stack direction="row" spacing={1}>
                      <Typography variant="caption" sx={{ color: 'text.disabled', width: 118 }}>
                        Purchase
                      </Typography>
                      <Typography variant="caption">{selected.description}</Typography>
                    </Stack>
                  )}
                  <Stack direction="row" spacing={1}>
                    <Typography variant="caption" sx={{ color: 'text.disabled', width: 118 }}>
                      Purpose match
                    </Typography>
                    <Mono variant="monoCaption">
                      {selected.conformance_score == null
                        ? 'not scored'
                        : formatScore(selected.conformance_score)}
                    </Mono>
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    <Typography variant="caption" sx={{ color: 'text.disabled', width: 118 }}>
                      Agent
                    </Typography>
                    <Mono variant="monoCaption">{selected.agent_id}</Mono>
                  </Stack>
                  {selected.block_report && (
                    <Stack direction="row" spacing={1}>
                      <Typography variant="caption" sx={{ color: 'text.disabled', width: 118 }}>
                        Member report
                      </Typography>
                      <Typography variant="caption">
                        {selected.block_report_confirmed === true
                          ? 'Said the block was wrong — an operator confirmed it'
                          : selected.block_report_confirmed === false
                            ? 'Said the block was wrong — an operator found the block correct'
                            : 'Said the block was wrong — not yet reviewed'}
                      </Typography>
                    </Stack>
                  )}
                  <Stack direction="row" spacing={1}>
                    <Typography variant="caption" sx={{ color: 'text.disabled', width: 118 }}>
                      Action
                    </Typography>
                    <Mono variant="monoCaption">{selected.action_id}</Mono>
                  </Stack>
                </Stack>

                <Button
                  size="small"
                  variant="outlined"
                  color="neutral"
                  onClick={() => onOpenDecision?.(selected.action_id)}
                  startIcon={<IconifyIcon icon="material-symbols:open-in-new-rounded" />}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Open full decision
                </Button>
              </Stack>
            )}
          </Box>
        </Stack>

        {truncated && (
          <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: 'text.disabled' }}>
            Listing the first {formatNumber(rows.length)} of{' '}
            {formatNumber(blockedTotal + allowedTotal)} changed transactions. The counts and the
            summary above cover the whole replay.
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PolicyChangesDialog;
