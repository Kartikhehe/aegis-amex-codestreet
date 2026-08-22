import { useState } from 'react';
import { Box, Button, Collapse, Stack, Typography } from '@mui/material';
import { formatDateTime } from 'aegis/format';
import { useLedger } from 'aegis/hooks';
import IconifyIcon from 'components/base/IconifyIcon';
import Mono from './Mono';

/**
 * The ledger records themselves.
 *
 * ChainStrip above already answers "is the chain intact, and where did it
 * break?". What it cannot do is show the evidence, so the strongest claim in
 * the product rested on a green bar and the reader's goodwill. This lists the
 * actual records behind that bar.
 *
 * The link column is the point. `prev_hash` of a record must equal `self_hash`
 * of its predecessor, and that comparison happens HERE, in the browser, against
 * the rows on screen -- not read off the server's verdict. So a sceptical
 * reader (an auditor, a judge) can confirm the chain themselves rather than
 * taking our word for it.
 *
 * Collapsed by default: the summary is what you want 95% of the time, and the
 * records are what you want when you are proving something.
 */

const PAGE = 25;

const COLUMNS = [
  ['#', 62],
  ['Link', 34],
  ['This record’s hash', 190],
  ['Commits to', 190],
  ['Action', 150],
  ['Recorded', 0],
];

const LedgerChain = ({ verification }) => {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);

  // Don't fetch records until someone actually opens the panel.
  const { data, isLoading } = useLedger({ limit: PAGE, offset: page * PAGE }, { enabled: open });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const brokenSeq = verification?.first_broken_link?.sequence ?? null;

  return (
    <Stack spacing={1.5}>
      <Button
        size="small"
        color="neutral"
        onClick={() => setOpen((v) => !v)}
        sx={{ alignSelf: 'flex-start', color: 'text.secondary' }}
        startIcon={
          <IconifyIcon
            icon="material-symbols:chevron-right-rounded"
            sx={{
              fontSize: 18,
              transition: 'transform 160ms ease',
              transform: open ? 'rotate(90deg)' : 'none',
            }}
          />
        }
      >
        {open ? 'Hide the records' : 'Show the records'}
      </Button>

      <Collapse in={open} unmountOnExit>
        <Stack spacing={1.5}>
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            Newest first. Each record commits to the hash of the one before it — the link icon is
            checked in your browser, against the rows below.
          </Typography>

          <Box sx={{ overflowX: 'auto' }}>
            <Box sx={{ minWidth: 700 }}>
              <Stack
                direction="row"
                spacing={2}
                sx={(theme) => ({
                  px: 1.5,
                  py: 1,
                  borderBottom: `1px solid ${theme.vars.palette.divider}`,
                })}
              >
                {COLUMNS.map(([label, width]) => (
                  <Typography
                    key={label}
                    variant="caption"
                    sx={{
                      width: width || undefined,
                      flex: width ? undefined : 1,
                      color: 'text.disabled',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      fontSize: 10,
                    }}
                  >
                    {label}
                  </Typography>
                ))}
              </Stack>

              {isLoading && (
                <Typography variant="body2" sx={{ p: 2, color: 'text.secondary' }}>
                  Loading the chain…
                </Typography>
              )}

              {rows.map((row, index) => {
                // The list is newest-first, so this row's predecessor is the
                // NEXT one down. On the last row of a page there is nothing to
                // compare against, so the link is unknown rather than broken.
                const older = rows[index + 1];
                const linked = older ? row.prev_hash === older.self_hash : null;
                const isGenesis = /^0+$/.test(row.prev_hash);
                const isBroken = brokenSeq != null && row.sequence === brokenSeq;
                const bad = isBroken || linked === false;

                return (
                  <Stack
                    key={row.sequence}
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    sx={(theme) => ({
                      px: 1.5,
                      py: 1.25,
                      borderBottom: `1px solid ${theme.vars.palette.divider}`,
                      backgroundColor: bad
                        ? `rgba(${theme.vars.palette.error.mainChannel} / 0.1)`
                        : 'transparent',
                    })}
                  >
                    <Mono variant="monoCaption" sx={{ width: 62, color: 'text.secondary' }}>
                      {row.sequence}
                    </Mono>
                    <Box sx={{ width: 34, display: 'grid', placeItems: 'center' }}>
                      <IconifyIcon
                        icon={
                          bad
                            ? 'material-symbols:link-off-rounded'
                            : 'material-symbols:link-rounded'
                        }
                        sx={{
                          fontSize: 16,
                          color: bad
                            ? 'error.main'
                            : linked === null && !isGenesis
                              ? 'text.disabled'
                              : 'success.main',
                        }}
                      />
                    </Box>
                    <Mono variant="monoCaption" sx={{ width: 190 }}>
                      {row.self_hash.slice(0, 22)}…
                    </Mono>
                    <Mono variant="monoCaption" sx={{ width: 190, color: 'text.secondary' }}>
                      {isGenesis ? (
                        <Box component="span" sx={{ color: 'text.disabled' }}>
                          genesis
                        </Box>
                      ) : (
                        `${row.prev_hash.slice(0, 22)}…`
                      )}
                    </Mono>
                    <Mono variant="monoCaption" sx={{ width: 150, color: 'text.secondary' }}>
                      {row.action_id}
                    </Mono>
                    <Typography
                      variant="caption"
                      sx={{ flex: 1, color: 'text.disabled', whiteSpace: 'nowrap' }}
                    >
                      {row.recorded_at ? formatDateTime(row.recorded_at) : '—'}
                    </Typography>
                  </Stack>
                );
              })}
            </Box>
          </Box>

          {total > PAGE && (
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                <Mono variant="monoCaption">
                  {(page * PAGE + 1).toLocaleString('en-IN')}–
                  {Math.min((page + 1) * PAGE, total).toLocaleString('en-IN')}
                </Mono>{' '}
                of <Mono variant="monoCaption">{total.toLocaleString('en-IN')}</Mono> records
              </Typography>
              <Stack direction="row" spacing={0.5}>
                <Button
                  size="small"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  sx={{ color: 'text.secondary' }}
                >
                  Newer
                </Button>
                <Button
                  size="small"
                  disabled={(page + 1) * PAGE >= total}
                  onClick={() => setPage((p) => p + 1)}
                  sx={{ color: 'text.secondary' }}
                >
                  Older
                </Button>
              </Stack>
            </Stack>
          )}
        </Stack>
      </Collapse>
    </Stack>
  );
};

export default LedgerChain;
