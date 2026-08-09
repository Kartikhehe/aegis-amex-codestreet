import { Box, Stack, Typography } from '@mui/material';
import { useLiveFleetState } from 'aegis/firestoreHooks';
import { formatDateTime } from 'aegis/format';
import { useFleetState } from 'aegis/hooks';
import {
  dimVariants,
  haltBannerTransition,
  haltBannerVariants,
  useMotionAllowed,
} from 'aegis/motion';
import { AnimatePresence, motion } from 'framer-motion';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * The fleet-halt banner: signature motion moment #4.
 *
 * When the fleet is stopped, the whole console dims and a banner slides down
 * from the top. The dim is the point -- it says the screen you are looking at
 * no longer describes a system that is running. It stays non-blocking
 * (pointerEvents: none) so an operator can still navigate and investigate
 * while stopped; the state is grave, not modal.
 */
const FleetHaltBanner = () => {
  const { data: state } = useLiveFleetState(useFleetState());
  const animate = useMotionAllowed();
  const stopped = Boolean(state?.stopped);

  return (
    <AnimatePresence>
      {stopped && (
        <>
          {/* Full-screen dim, behind the banner and above the content. */}
          <Box
            component={motion.div}
            variants={animate ? dimVariants : undefined}
            initial={animate ? 'initial' : false}
            animate="animate"
            exit={animate ? 'exit' : undefined}
            transition={{ duration: 0.25 }}
            sx={(theme) => ({
              position: 'fixed',
              inset: 0,
              zIndex: theme.zIndex.appBar + 1,
              pointerEvents: 'none',
              backgroundColor: `rgba(${theme.vars.palette.error.mainChannel} / 0.06)`,
              backdropFilter: 'saturate(0.72)',
            })}
          />

          <Box
            component={motion.div}
            variants={animate ? haltBannerVariants : undefined}
            initial={animate ? 'initial' : false}
            animate="animate"
            exit={animate ? 'exit' : undefined}
            transition={haltBannerTransition}
            sx={(theme) => ({
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              zIndex: theme.zIndex.appBar + 2,
              px: { xs: 2, md: 4 },
              py: 1.5,
              backgroundColor: theme.vars.palette.error.main,
              color: theme.vars.palette.common.white,
              boxShadow: `0 8px 32px rgba(${theme.vars.palette.error.mainChannel} / 0.4)`,
              ...theme.applyStyles('dark', {
                backgroundColor: theme.vars.palette.error.dark,
              }),
            })}
          >
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 0.5, sm: 2 }}
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              justifyContent="center"
            >
              <Stack direction="row" spacing={1.25} alignItems="center">
                <IconifyIcon
                  icon="material-symbols:pan-tool-rounded"
                  sx={{
                    fontSize: 20,
                    animation: 'aegisHaltBlink 1.6s ease-in-out infinite',
                    '@keyframes aegisHaltBlink': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0.4 },
                    },
                    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                  }}
                />
                <Typography variant="subtitle2" sx={{ fontWeight: 800, letterSpacing: '0.04em' }}>
                  FLEET EMERGENCY STOP ENGAGED — every agent is being denied
                </Typography>
              </Stack>

              <Typography variant="monoCaption" sx={{ opacity: 0.9 }}>
                {state?.stopped_by ? `by ${state.stopped_by}` : ''}
                {state?.stopped_at ? ` · ${formatDateTime(state.stopped_at)}` : ''}
              </Typography>
            </Stack>

            {state?.stop_reason && (
              <Typography variant="body2" sx={{ textAlign: 'center', mt: 0.5, opacity: 0.92 }}>
                {state.stop_reason}
              </Typography>
            )}
          </Box>
        </>
      )}
    </AnimatePresence>
  );
};

export default FleetHaltBanner;
