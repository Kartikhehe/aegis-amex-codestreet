import { Box, Stack, Typography } from '@mui/material';
import Mono from './Mono';

/**
 * One turn in the conversation.
 *
 * Three speakers, deliberately distinguishable at a glance:
 *
 *   you    -- what you asked for, right-aligned like any messaging app
 *   agent  -- the shop's assistant, left-aligned
 *   system -- AEGIS itself: not a speaker but a ruling, so it is centred and
 *             styled as a notice. Making the governance decision look like
 *             another chat bubble would suggest it is one opinion among
 *             several, which is precisely wrong.
 */

const VERDICT_TONE = {
  ALLOW: 'success',
  DENY: 'error',
  STEP_UP: 'warning',
};

const ChatMessage = ({ message }) => {
  const { role, text, verdict, meta } = message;

  if (role === 'system') {
    const tone = VERDICT_TONE[verdict] ?? 'primary';
    return (
      <Box
        sx={(theme) => ({
          alignSelf: 'stretch',
          px: 2,
          py: 1.5,
          my: 0.5,
          borderRadius: 2,
          border: '1px solid',
          borderColor: `rgba(${theme.vars.palette[tone].mainChannel} / 0.38)`,
          backgroundColor: `rgba(${theme.vars.palette[tone].mainChannel} / 0.10)`,
        })}
      >
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography
              variant="caption"
              sx={(theme) => ({
                fontWeight: 800,
                letterSpacing: '0.08em',
                color: theme.vars.palette[tone].main,
              })}
            >
              AEGIS · {verdict}
            </Typography>
            {meta?.rule && (
              <Mono size="0.7rem" sx={{ color: 'text.disabled' }}>
                {meta.rule}
              </Mono>
            )}
          </Stack>
          <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
            {text}
          </Typography>
          {meta?.actionId && (
            <Mono size="0.7rem" sx={{ color: 'text.disabled' }}>
              {meta.actionId}
            </Mono>
          )}
        </Stack>
      </Box>
    );
  }

  const mine = role === 'you';
  return (
    <Box
      sx={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: { xs: '90%', sm: '78%' },
      }}
    >
      <Box
        sx={(theme) => ({
          px: 1.75,
          py: 1.25,
          borderRadius: 2.5,
          borderTopRightRadius: mine ? 6 : undefined,
          borderTopLeftRadius: mine ? undefined : 6,
          backgroundColor: mine
            ? theme.vars.palette.primary.main
            : theme.vars.palette.background.elevation2,
          color: mine ? theme.vars.palette.primary.contrastText : undefined,
        })}
      >
        <Typography variant="body2" sx={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {text}
        </Typography>
      </Box>
    </Box>
  );
};

export default ChatMessage;
