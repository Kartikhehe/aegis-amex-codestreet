import { Box, Chip, Divider, LinearProgress, Stack, Typography } from '@mui/material';
import Mono from './Mono';

/**
 * The right-hand panel: what the agent is holding, and what it is allowed to do.
 *
 * It answers the question the chat cannot: "on what authority?". A conversation
 * that says "approved" is just a claim; the ceiling it was measured against,
 * sitting beside the running total, is what makes the claim checkable.
 *
 * Updates on every turn from the same response the chat renders, so the two can
 * never disagree.
 */

const money = (value) =>
  `₹${Number(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const BasketPanel = ({ assistant, basket = [], total = 0, lastVerdict }) => {
  if (!assistant) return null;

  const { agent, shop, approver } = assistant;
  const ceiling = Number(agent.per_transaction_ceiling ?? 0);
  const used = ceiling > 0 ? Math.min((total / ceiling) * 100, 100) : 0;
  const overCeiling = ceiling > 0 && total > ceiling;

  return (
    <Stack spacing={2.5}>
      {/* --- who is acting -------------------------------------------- */}
      <Box>
        <Typography variant="overline" sx={{ color: 'text.disabled', fontWeight: 700 }}>
          Acting as
        </Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 0.5 }}>
          {agent.name}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
          {agent.purpose}
        </Typography>
      </Box>

      <Divider />

      {/* --- the basket ----------------------------------------------- */}
      <Box>
        <Typography variant="overline" sx={{ color: 'text.disabled', fontWeight: 700 }}>
          Basket
        </Typography>
        {basket.length === 0 ? (
          <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 1 }}>
            Nothing yet. Ask for something and it will appear here.
          </Typography>
        ) : (
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            {basket.map((line, index) => (
              <Stack
                key={`${line.label}-${index}`}
                direction="row"
                spacing={1}
                alignItems="baseline"
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2">
                    {line.label}
                    {line.quantity > 1 && (
                      <Box component="span" sx={{ color: 'text.disabled' }}>
                        {' '}
                        × {line.quantity}
                      </Box>
                    )}
                  </Typography>
                  {/* Merchant-feed rating, understated. Shown so the basket
                      says what the diligence check was measured against, not
                      to advertise the check itself. */}
                  {line.rating != null && (
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.disabled', display: 'block', mt: 0.25 }}
                    >
                      {line.rating}★
                      {line.review_count ? ` · ${line.review_count.toLocaleString('en-IN')}` : ''}
                    </Typography>
                  )}
                  {line.attributes?.length > 0 && (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                      {line.attributes.map((attribute) => (
                        <Chip
                          key={attribute}
                          size="small"
                          label={attribute}
                          color="warning"
                          variant="outlined"
                          sx={{ height: 18, fontSize: 10 }}
                        />
                      ))}
                    </Stack>
                  )}
                </Box>
                <Mono size="0.8rem">{money(Number(line.unit_amount) * line.quantity)}</Mono>
              </Stack>
            ))}
            <Divider sx={{ my: 0.5 }} />
            <Stack direction="row" spacing={1}>
              <Typography variant="body2" sx={{ flex: 1, fontWeight: 700 }}>
                Total
              </Typography>
              <Mono size="0.95rem" weight={700}>
                {money(total)}
              </Mono>
            </Stack>
          </Stack>
        )}
      </Box>

      <Divider />

      {/* --- the authority -------------------------------------------- */}
      <Box>
        <Typography variant="overline" sx={{ color: 'text.disabled', fontWeight: 700 }}>
          Authority
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline">
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Per purchase
              </Typography>
              <Mono size="0.8rem" sx={{ color: overCeiling ? 'error.main' : undefined }}>
                {money(total)} / {money(ceiling)}
              </Mono>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={used}
              color={overCeiling ? 'error' : used > 70 ? 'warning' : 'primary'}
              sx={{ mt: 0.75, height: 5, borderRadius: 3 }}
            />
          </Box>

          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Per day
            </Typography>
            <Mono size="0.8rem">{money(agent.daily_ceiling)}</Mono>
          </Stack>

          {agent.prohibited_attributes?.length > 0 && (
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Never permitted
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.5 }}>
                {agent.prohibited_attributes.map((attribute) => (
                  <Chip
                    key={attribute}
                    size="small"
                    label={attribute}
                    variant="outlined"
                    sx={{ height: 20, fontSize: 10 }}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </Box>

      <Divider />

      {/* Who answers if this is held.
          Corporate agents sit on a different card from household ones, so a
          step-up here goes to THAT card holder. Saying so stops someone
          hunting for an approval in an app scoped to another card. */}
      {approver?.email && (
        <Box>
          <Typography variant="overline" sx={{ color: 'text.disabled', fontWeight: 700 }}>
            Approvals go to
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {approver.name}
          </Typography>
          <Mono size="0.72rem" sx={{ color: 'text.disabled' }}>
            {approver.email}
          </Mono>
        </Box>
      )}

      <Divider />

      <Box>
        <Typography variant="overline" sx={{ color: 'text.disabled', fontWeight: 700 }}>
          Shop
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {shop.name}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
          MCC <Mono size="0.75rem">{shop.category}</Mono>
        </Typography>
      </Box>

      {lastVerdict && (
        <Box
          sx={(theme) => ({
            p: 1.5,
            borderRadius: 2,
            backgroundColor: theme.vars.palette.background.elevation2,
          })}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
            The last decision is on the ledger and visible in the operator
            console at localhost:5002.
          </Typography>
        </Box>
      )}
    </Stack>
  );
};

export default BasketPanel;
