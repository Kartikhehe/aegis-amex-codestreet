import { useState } from 'react';
import { Box, Button, Chip, Menu, MenuItem, Stack, TextField, Typography } from '@mui/material';
import IconifyIcon from 'components/base/IconifyIcon';

/**
 * A time window for any list of decisions.
 *
 * Presets cover what people actually ask for; a custom range covers the rest.
 * The value is `{ since, until, label }` where the two bounds are ISO strings
 * (or null for "no bound"), which is exactly what the API takes.
 *
 * Times are computed in the READER's zone and sent as instants. "Today" means
 * today where you are sitting, not today in UTC -- the two differ by hours in
 * India, and getting it wrong is how a dashboard ends up disagreeing with the
 * clock on the wall.
 */

const startOfLocalDay = (offsetDays = 0) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date;
};

export const RANGES = {
  all: { label: 'All time', build: () => ({ since: null, until: null }) },
  today: {
    label: 'Today',
    build: () => ({ since: startOfLocalDay().toISOString(), until: null }),
  },
  yesterday: {
    label: 'Yesterday',
    build: () => ({
      since: startOfLocalDay(-1).toISOString(),
      until: startOfLocalDay().toISOString(),
    }),
  },
  h24: {
    label: 'Last 24 hours',
    build: () => ({ since: new Date(Date.now() - 864e5).toISOString(), until: null }),
  },
  d7: {
    label: 'Last 7 days',
    build: () => ({ since: startOfLocalDay(-6).toISOString(), until: null }),
  },
  d30: {
    label: 'Last 30 days',
    build: () => ({ since: startOfLocalDay(-29).toISOString(), until: null }),
  },
};

export const buildRange = (key) => ({ ...RANGES[key].build(), label: RANGES[key].label, key });

const DateRangeFilter = ({ value, onChange, size = 'small' }) => {
  const [anchor, setAnchor] = useState(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const close = () => setAnchor(null);

  const pick = (key) => {
    onChange(buildRange(key));
    close();
  };

  const applyCustom = () => {
    if (!from && !to) return;
    // `to` is an inclusive DAY in the picker but an exclusive INSTANT in the
    // query, so a range ending "15 Aug" must include all of the 15th.
    const until = to ? new Date(`${to}T00:00:00`) : null;
    if (until) until.setDate(until.getDate() + 1);
    onChange({
      since: from ? new Date(`${from}T00:00:00`).toISOString() : null,
      until: until ? until.toISOString() : null,
      label: from && to ? `${from} → ${to}` : from ? `From ${from}` : `Until ${to}`,
      key: 'custom',
    });
    setCustomOpen(false);
    close();
  };

  return (
    <>
      <Button
        size={size}
        variant="outlined"
        color="neutral"
        onClick={(event) => setAnchor(event.currentTarget)}
        startIcon={<IconifyIcon icon="material-symbols:calendar-month-outline-rounded" />}
        endIcon={<IconifyIcon icon="material-symbols:expand-more-rounded" />}
        sx={{ color: 'text.secondary' }}
      >
        {value?.label ?? 'All time'}
      </Button>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => {
          setCustomOpen(false);
          close();
        }}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        {Object.entries(RANGES).map(([key, range]) => (
          <MenuItem key={key} selected={value?.key === key} onClick={() => pick(key)}>
            {range.label}
          </MenuItem>
        ))}

        <MenuItem onClick={() => setCustomOpen((open) => !open)} selected={value?.key === 'custom'}>
          Custom range…
        </MenuItem>

        {customOpen && (
          <Box sx={{ px: 2, py: 1.5, minWidth: 260 }}>
            <Stack spacing={1.5}>
              <TextField
                size="small"
                type="date"
                label="From"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                size="small"
                type="date"
                label="To"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <Button size="small" variant="contained" onClick={applyCustom}>
                Apply
              </Button>
            </Stack>
          </Box>
        )}
      </Menu>
    </>
  );
};

/** A one-click narrowing, for when a number on screen invites a question. */
export const DrillChip = ({ label, onClick, icon = 'material-symbols:filter-alt-outline' }) => (
  <Chip
    size="small"
    variant="outlined"
    clickable
    onClick={onClick}
    icon={<IconifyIcon icon={icon} style={{ fontSize: 14 }} />}
    label={
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
    }
    sx={{ height: 24 }}
  />
);

export default DateRangeFilter;
