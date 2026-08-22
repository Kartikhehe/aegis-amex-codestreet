import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';

/**
 * The card member's purchase standards -- their diligence bar.
 *
 * Deliberately understated: a collapsed row that opens when someone wants it.
 * The bar has sensible defaults and most members will never touch it, so it
 * should not compete for attention with the approvals that actually need a
 * decision.
 *
 * It lives on the Agents tab because that is where the agents it governs are.
 * A separate settings tab would imply this is a bigger part of the product than
 * it is.
 */

const money = (v) => `+${Math.round(Number(v) * 100)}%`;

const PurchaseStandards = ({ api, endpoints }) => {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    api
      .get(endpoints.purchaseStandards)
      .then((data) => {
        setSaved(data);
        setDraft(data);
      })
      .catch(() => {});
  }, [api, endpoints]);

  if (!draft) return null;

  const dirty =
    saved &&
    (Number(draft.min_rating) !== Number(saved.min_rating) ||
      Number(draft.min_reviews) !== Number(saved.min_reviews) ||
      Number(draft.price_tolerance) !== Number(saved.price_tolerance) ||
      draft.require_diligence !== saved.require_diligence);

  const save = async () => {
    setBusy(true);
    setNote('');
    try {
      const next = await api.put(endpoints.purchaseStandards, {
        min_rating: Number(draft.min_rating),
        min_reviews: Number(draft.min_reviews),
        price_tolerance: Number(draft.price_tolerance),
        require_diligence: Boolean(draft.require_diligence),
      });
      setSaved(next);
      setDraft(next);
      setNote('Saved. This applies to your next purchase.');
    } catch {
      setNote('Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const row = (label, hint, control) => (
    <Stack spacing={0.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="mono" sx={{ fontSize: '0.85rem' }}>
          {hint}
        </Typography>
      </Stack>
      {control}
    </Stack>
  );

  return (
    <Box sx={{ mt: 1 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((v) => !v)}
        sx={{
          cursor: 'pointer',
          py: 1.25,
          px: 0.5,
          borderRadius: 1,
          '&:hover': { backgroundColor: 'action.hover' },
        }}
      >
        <Stack spacing={0.25}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Purchase standards
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            {open
              ? 'How carefully your agents should shop'
              : `${draft.min_rating}★ minimum · ${draft.min_reviews}+ reviews`}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ color: 'text.disabled' }}>
          {open ? '−' : '›'}
        </Typography>
      </Stack>

      <Collapse in={open} unmountOnExit>
        <Stack
          spacing={2.5}
          sx={(theme) => ({
            p: 2,
            mt: 0.5,
            borderRadius: 2,
            border: '1px solid',
            borderColor: theme.vars.palette.divider,
          })}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
            Your agents check every purchase against these before buying. They are
            a guide, not a block — we tell you when something falls short rather
            than stopping it, unless you ask us to.
          </Typography>

          {row(
            'Minimum rating',
            `${draft.min_rating}★`,
            <Slider
              size="small"
              min={0}
              max={5}
              step={0.1}
              value={Number(draft.min_rating)}
              onChange={(_, v) => setDraft({ ...draft, min_rating: v })}
              aria-label="Minimum rating"
            />,
          )}

          {row(
            'Minimum reviews',
            `${draft.min_reviews}`,
            <Slider
              size="small"
              min={0}
              max={500}
              step={10}
              value={Number(draft.min_reviews)}
              onChange={(_, v) => setDraft({ ...draft, min_reviews: v })}
              aria-label="Minimum reviews"
            />,
          )}

          {row(
            'Price tolerance',
            money(draft.price_tolerance),
            <Slider
              size="small"
              min={0}
              max={1}
              step={0.05}
              value={Number(draft.price_tolerance)}
              onChange={(_, v) => setDraft({ ...draft, price_tolerance: v })}
              aria-label="Price tolerance"
            />,
          )}

          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack spacing={0.25} sx={{ pr: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Ask me first
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                Hold purchases that fall short instead of just flagging them.
              </Typography>
            </Stack>
            <Switch
              checked={Boolean(draft.require_diligence)}
              onChange={(e) => setDraft({ ...draft, require_diligence: e.target.checked })}
            />
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button size="small" variant="contained" disabled={!dirty || busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            {dirty && !busy && (
              <Button
                size="small"
                variant="text"
                color="neutral"
                onClick={() => setDraft(saved)}
              >
                Reset
              </Button>
            )}
            {note && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {note}
              </Typography>
            )}
          </Stack>
        </Stack>
      </Collapse>
    </Box>
  );
};

export default PurchaseStandards;
