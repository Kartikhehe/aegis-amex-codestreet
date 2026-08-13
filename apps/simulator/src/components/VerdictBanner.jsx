import { Box, Stack, Typography } from '@mui/material';
import Mono from './Mono';

/**
 * The storefront's answer to "did my purchase go through?"
 *
 * Written from the SHOPPER's side of the counter. The console explains the
 * verdict to an engineer and the member app explains it to a card holder; here
 * the question is narrower -- the order either completed, is waiting, or was
 * refused -- so the reason is shown as supporting detail rather than as the
 * headline.
 */

const STATES = {
  ALLOW: {
    title: 'Order confirmed',
    body: 'The card was charged and the order is on its way.',
    palette: 'success',
    icon: '✓',
  },
  DENY: {
    title: 'Payment refused',
    body: 'Your card holder has not authorised this agent to make this purchase.',
    palette: 'error',
    icon: '✕',
  },
  STEP_UP: {
    title: 'Waiting for card member',
    body: 'Nothing has been charged. The purchase needs approval before it can complete.',
    palette: 'warning',
    icon: '⏱',
  },
  STEP_UP_APPROVED: {
    title: 'Approved — order confirmed',
    body: 'The card member approved this purchase and the order has completed.',
    palette: 'success',
    icon: '✓',
  },
  STEP_UP_DECLINED: {
    title: 'Declined by card member',
    body: 'The card member declined this purchase. Nothing was charged.',
    palette: 'error',
    icon: '✕',
  },
};

const VerdictBanner = ({ verdict, stepUpState, decision }) => {
  let key = verdict;
  if (verdict === 'STEP_UP') {
    if (stepUpState === 'approved' || stepUpState === 'always_allowed') key = 'STEP_UP_APPROVED';
    else if (stepUpState === 'declined') key = 'STEP_UP_DECLINED';
  }
  const state = STATES[key] ?? STATES.STEP_UP;

  return (
    <Box
      sx={(theme) => ({
        p: 2.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: `rgba(${theme.vars.palette[state.palette].mainChannel} / 0.42)`,
        backgroundColor: `rgba(${theme.vars.palette[state.palette].mainChannel} / 0.12)`,
      })}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box
          sx={(theme) => ({
            fontSize: 20,
            lineHeight: 1.2,
            color: theme.vars.palette[state.palette].main,
          })}
        >
          {state.icon}
        </Box>
        <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="subtitle1"
            sx={(theme) => ({ fontWeight: 800, color: theme.vars.palette[state.palette].main })}
          >
            {state.title}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {state.body}
          </Typography>

          {/* Why, in the engine's own words. The storefront does not
              paraphrase this: the reason on the record is the reason shown. */}
          {decision?.human_readable_reason && (
            <Typography variant="body2" sx={{ color: 'text.primary', mt: 0.5 }}>
              {decision.human_readable_reason}
            </Typography>
          )}

          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mt: 0.5 }}>
            {decision?.reason_code && (
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                rule <Mono>{decision.reason_code}</Mono>
              </Typography>
            )}
            {decision?.conformance?.score != null && (
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                score <Mono>{Number(decision.conformance.score).toFixed(2)}</Mono>
              </Typography>
            )}
            {decision?.action_id && (
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                <Mono>{decision.action_id}</Mono>
              </Typography>
            )}
          </Stack>
        </Stack>
      </Stack>
    </Box>
  );
};

export default VerdictBanner;
