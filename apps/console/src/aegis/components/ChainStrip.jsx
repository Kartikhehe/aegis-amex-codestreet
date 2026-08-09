import { Box, Stack, Typography } from '@mui/material';
import { formatLatency, formatNumber } from 'aegis/format';
import { useChainFill } from 'aegis/motion';
import IconifyIcon from 'components/base/IconifyIcon';
import Mono, { Hash } from './Mono';

/**
 * The ledger verification strip. Signature motion moment #5.
 *
 * Blocks fill green left to right as the chain verifies, and STOP DEAD at the
 * broken link if there is one. The stop is the whole design: a progress bar
 * that completes and then announces failure hides where the failure was. This
 * one halts exactly at the record that did not verify, and everything after it
 * stays unfilled -- because after a break, nothing downstream can be trusted.
 */

const BLOCK_COUNT = 60;

const ChainStrip = ({ result, active = true }) => {
  const total = result?.records_checked ?? 0;
  const broken = result?.first_broken_link ?? null;

  // Map the real record count onto a fixed number of blocks, so a 25,000-record
  // chain and a 12-record chain both read at a glance.
  const breakBlock = broken
    ? Math.max(
        Math.floor(
          ((broken.sequence - (result.from_sequence ?? 1)) / Math.max(total, 1)) * BLOCK_COUNT,
        ),
        0,
      )
    : null;

  const { filled } = useChainFill(BLOCK_COUNT, { breakAt: breakBlock, active });
  const ok = result?.ok;

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={0.375}
        sx={{ height: 34, alignItems: 'stretch', overflow: 'hidden' }}
      >
        {Array.from({ length: BLOCK_COUNT }).map((_, index) => {
          const isBreak = breakBlock !== null && index === breakBlock;
          const isFilled = index < filled;

          return (
            <Box
              key={index}
              sx={(theme) => ({
                flex: 1,
                minWidth: 2,
                borderRadius: 0.5,
                transition: 'background-color 160ms ease',
                backgroundColor: isBreak
                  ? theme.vars.palette.error.main
                  : isFilled
                    ? theme.vars.palette.success.main
                    : theme.vars.palette.background.elevation3,
                ...(isBreak && {
                  boxShadow: `0 0 12px rgba(${theme.vars.palette.error.mainChannel} / 0.7)`,
                }),
              })}
            />
          );
        })}
      </Stack>

      {result && (
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="flex-start"
          sx={(theme) => ({
            p: 2,
            borderRadius: 2,
            border: '1px solid',
            borderColor: ok
              ? `rgba(${theme.vars.palette.success.mainChannel} / 0.4)`
              : `rgba(${theme.vars.palette.error.mainChannel} / 0.5)`,
            backgroundColor: ok
              ? `rgba(${theme.vars.palette.success.mainChannel} / 0.1)`
              : `rgba(${theme.vars.palette.error.mainChannel} / 0.12)`,
          })}
        >
          <IconifyIcon
            icon={ok ? 'material-symbols:verified-rounded' : 'material-symbols:error-rounded'}
            sx={{ fontSize: 22, mt: 0.125, color: ok ? 'success.main' : 'error.main' }}
          />

          <Stack spacing={0.75} sx={{ minWidth: 0, flex: 1 }}>
            {ok ? (
              <>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'success.main' }}>
                  Chain intact
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  <Mono variant="monoSmall">{formatNumber(total)}</Mono> records verified in{' '}
                  <Mono variant="monoSmall">{formatLatency(result.duration_ms)}</Mono>. Every record
                  still hashes to its recorded fingerprint.
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                    head
                  </Typography>
                  <Hash value={result.head_hash} />
                </Stack>
              </>
            ) : (
              <>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'error.main' }}>
                  Chain broken at record #{broken?.sequence}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {broken?.failure === 'self_hash_mismatch'
                    ? 'This record was altered after it was written. Its contents no longer hash to the fingerprint stored with it.'
                    : 'A record was removed, reordered or inserted. This record does not link to the one before it.'}
                </Typography>

                <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Typography variant="caption" sx={{ color: 'text.disabled', width: 64 }}>
                      expected
                    </Typography>
                    <Hash value={broken?.expected_hash} head={12} tail={8} />
                  </Stack>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Typography variant="caption" sx={{ color: 'error.main', width: 64 }}>
                      actual
                    </Typography>
                    <Hash value={broken?.actual_hash} head={12} tail={8} />
                  </Stack>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Typography variant="caption" sx={{ color: 'text.disabled', width: 64 }}>
                      action
                    </Typography>
                    <Mono variant="monoCaption">{broken?.action_id}</Mono>
                  </Stack>
                </Stack>
              </>
            )}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
};

export default ChainStrip;
