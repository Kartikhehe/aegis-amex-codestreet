import { Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import { formatCurrency } from '../aegis/format';

/**
 * The agent authority card: "what it may do" vs "what it may never do".
 *
 * Card members do not think in mandates, ceilings and MCCs. They think in
 * "what is this thing allowed to buy on my card?" -- so the two lists are the
 * whole card, blue for permitted and red for forbidden, in words rather than
 * codes.
 *
 * The prohibitions are shown as prominently as the permissions. A permission
 * list alone reads as marketing; the pair reads as a contract.
 */

const ScopeList = ({ title, items, tone }) => (
  <Stack spacing={1}>
    <Typography
      variant="caption"
      sx={{
        fontWeight: 700,
        letterSpacing: '0.06em',
        color: tone === 'error' ? 'error.main' : 'info.main',
      }}
    >
      {title}
    </Typography>
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
      {items.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.disabled' }}>
          Nothing listed
        </Typography>
      ) : (
        items.map((item) => (
          <Chip
            key={item}
            size="small"
            variant="outlined"
            color={tone}
            label={item}
            sx={{ fontWeight: 500 }}
          />
        ))
      )}
    </Stack>
  </Stack>
);

/** MCCs mean nothing to a card member. Say what the shop actually is. */
const CATEGORY_NAMES = {
  5411: 'Grocery shops',
  5499: 'Speciality food shops',
  5541: 'Fuel stations',
  4121: 'Taxis and ride-hailing',
  4112: 'Rail travel',
  4511: 'Airlines',
  7011: 'Hotels',
  5943: 'Office supplies',
  5734: 'Software',
  7372: 'Cloud services',
  5812: 'Restaurants',
  5814: 'Cafés',
  7349: 'Cleaning services',
  5533: 'Vehicle parts',
  5912: 'Pharmacies',
  5111: 'Stationery',
};

const PROHIBITION_NAMES = {
  gift_card: 'Gift cards',
  cash_equivalent: 'Cash equivalents',
  crypto: 'Cryptocurrency',
  prepaid_instrument: 'Prepaid wallets',
  wire_transfer: 'Wire transfers',
  gambling: 'Gambling',
  alcohol: 'Alcohol',
  tobacco: 'Tobacco',
  adult: 'Adult goods',
  firearms: 'Firearms',
};

const AgentAuthorityCard = ({ agent, spendToday = 0, onPause, onChangeScope, busy }) => {
  const mandate = agent.mandate ?? {};
  const paused = agent.status !== 'active';

  return (
    <Paper sx={{ p: 3 }}>
      <Stack spacing={2.5}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {agent.name}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {agent.operator_name || agent.operator_id}
            </Typography>
          </Stack>
          <Chip
            size="small"
            color={paused ? 'warning' : 'success'}
            variant="filled"
            label={paused ? 'Paused' : 'Active'}
          />
        </Stack>

        <Box
          sx={(theme) => ({
            p: 2,
            borderRadius: 3,
            backgroundColor: theme.vars.palette.background.inset,
          })}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            You authorised it to
          </Typography>
          <Typography variant="body1" sx={{ mt: 0.5, lineHeight: 1.55 }}>
            {mandate.purpose}
          </Typography>
        </Box>

        <Stack direction="row" spacing={3}>
          <Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Spent today
            </Typography>
            <Typography variant="monoHeading">{formatCurrency(spendToday)}</Typography>
          </Stack>
          <Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Limit per purchase
            </Typography>
            <Typography variant="monoHeading">
              {formatCurrency(mandate.per_transaction_ceiling)}
            </Typography>
          </Stack>
        </Stack>

        <Divider />

        <ScopeList
          title="WHAT IT MAY DO"
          tone="info"
          items={(mandate.permitted_categories ?? []).map(
            (code) => CATEGORY_NAMES[code] ?? `Category ${code}`,
          )}
        />

        <ScopeList
          title="WHAT IT MAY NEVER DO"
          tone="error"
          items={(mandate.prohibited_attributes ?? []).map(
            (key) => PROHIBITION_NAMES[key] ?? key.replace(/_/g, ' '),
          )}
        />

        <Stack direction="row" spacing={1.25} sx={{ pt: 0.5 }}>
          <Button
            fullWidth
            variant="outlined"
            color="inherit"
            onClick={onChangeScope}
            sx={{ borderColor: 'divider' }}
          >
            Change scope
          </Button>
          <Button
            fullWidth
            variant={paused ? 'contained' : 'outlined'}
            color={paused ? 'primary' : 'inherit'}
            disabled={busy}
            onClick={onPause}
            sx={!paused ? { borderColor: 'divider' } : undefined}
          >
            {paused ? 'Resume agent' : 'Pause agent'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
};

export default AgentAuthorityCard;
