import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Drawer,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  useColorScheme,
  useMediaQuery,
} from '@mui/material';
import api, { endpoints } from './aegis/api';
import BasketPanel from './components/BasketPanel';
import ChatMessage from './components/ChatMessage';
import Logo from './components/Logo';
import Mono from './components/Mono';

/**
 * The agent simulator.
 *
 * A conversation with a shop's buying agent. You say what you want; the agent
 * builds a basket and asks AEGIS whether it may pay. The point is that nothing
 * is staged: every message becomes a real authorisation request through the
 * same endpoint a production integration would call, so a verdict here is one
 * the product would genuinely have produced.
 *
 * Shape of the screen, and why:
 *
 *   left    the shops, as assistants you can talk to. The agent for each is
 *           chosen server-side, because making a user pair an agent with a shop
 *           by hand invites combinations no real deployment would create -- and
 *           the resulting denial says more about the pairing than the engine.
 *   centre  the conversation, which is the whole surface on a phone.
 *   right   the basket and the authority it is being measured against. A chat
 *           saying "approved" is a claim; the ceiling beside the running total
 *           is what makes it checkable.
 */

const SUGGESTIONS = {
  supermarket: [
    '2kg rice, milk and some vegetables',
    'bread, butter and a dozen eggs',
    'a gift card for 2500',
  ],
  travel: [
    'book a domestic economy fare',
    'two nights in a deluxe room',
    'a coffee and a sandwich',
  ],
  fuel: ['fill 30 litres of petrol', 'diesel for 2000 and a car wash'],
  office: ['5 reams of A4 paper', 'a business laptop'],
  crypto: ['bitcoin worth 5000'],
};

const money = (value) =>
  `₹${Number(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// ---------------------------------------------------------------------------

const SignIn = ({ onSignedIn }) => {
  const [email, setEmail] = useState('operator@aegis.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.post(endpoints.login, { email, password });
      localStorage.setItem('aegis_sim_token', result.token);
      onSignedIn(result.user);
    } catch (err) {
      setError(err?.data?.detail ?? 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="xs" sx={{ pt: { xs: 6, sm: 12 } }}>
      <Stack spacing={3} component="form" onSubmit={submit}>
        <Logo height={56} sx={{ p: 1.5, alignSelf: 'flex-start' }} />
        <Stack spacing={1}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Agent simulator
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Talk to a shop’s buying agent and watch AEGIS decide, live.
          </Typography>
        </Stack>
        <TextField
          fullWidth
          size="small"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          fullWidth
          size="small"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" size="large" variant="contained" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </Stack>
    </Container>
  );
};

// ---------------------------------------------------------------------------

const ShopList = ({ assistants, activeId, onPick }) => (
  <Stack spacing={0.5} sx={{ p: 1 }}>
    <Typography
      variant="overline"
      sx={{ color: 'text.disabled', fontWeight: 700, px: 1.5, pt: 1 }}
    >
      Assistants
    </Typography>
    {assistants.map((assistant) => {
      const { shop, agent } = assistant;
      const active = shop.merchant_id === activeId;
      return (
        <Box
          key={shop.merchant_id}
          role="button"
          tabIndex={0}
          onClick={() => onPick(shop.merchant_id)}
          onKeyDown={(e) => e.key === 'Enter' && onPick(shop.merchant_id)}
          sx={(theme) => ({
            display: 'flex',
            gap: 1.25,
            alignItems: 'center',
            px: 1.5,
            py: 1.25,
            borderRadius: 2,
            cursor: 'pointer',
            backgroundColor: active
              ? `rgba(${theme.vars.palette.primary.mainChannel} / 0.14)`
              : 'transparent',
            '&:hover': { backgroundColor: theme.vars.palette.action.hover },
          })}
        >
          <Avatar
            sx={(theme) => ({
              width: 34,
              height: 34,
              fontSize: 14,
              fontWeight: 700,
              backgroundColor: active
                ? theme.vars.palette.primary.main
                : theme.vars.palette.background.elevation3,
              color: active ? theme.vars.palette.primary.contrastText : undefined,
            })}
          >
            {shop.name.slice(0, 1)}
          </Avatar>
          <Stack sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: active ? 700 : 500 }}>
              {shop.name}
            </Typography>
            <Typography variant="caption" noWrap sx={{ color: 'text.disabled' }}>
              {agent.name}
            </Typography>
          </Stack>
        </Box>
      );
    })}
  </Stack>
);

// ---------------------------------------------------------------------------

const App = () => {
  const { mode, setMode } = useColorScheme();
  const upMd = useMediaQuery((theme) => theme.breakpoints.up('md'));
  const upLg = useMediaQuery((theme) => theme.breakpoints.up('lg'));

  const [user, setUser] = useState(null);
  const [assistants, setAssistants] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [threads, setThreads] = useState({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const pollRef = useRef(null);
  const endRef = useRef(null);

  const signedIn = Boolean(user);
  const assistant = useMemo(
    () => assistants.find((a) => a.shop.merchant_id === activeId),
    [assistants, activeId],
  );
  const thread = threads[activeId] ?? { messages: [], basket: [], total: 0, verdict: null };

  // --- bootstrap ---------------------------------------------------------
  useEffect(() => {
    if (!localStorage.getItem('aegis_sim_token')) return;
    api
      .get(endpoints.profile)
      .then(setUser)
      .catch(() => localStorage.removeItem('aegis_sim_token'));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    api
      .get(endpoints.assistants)
      .then((list) => {
        setAssistants(list ?? []);
        if (list?.length) setActiveId(list[0].shop.merchant_id);
      })
      .catch((err) => setError(err?.data?.detail ?? 'Could not load the simulator.'));
  }, [signedIn]);

  // Open each conversation with the assistant's greeting, once.
  useEffect(() => {
    if (!assistant || threads[activeId]) return;
    setThreads((prev) => ({
      ...prev,
      [activeId]: {
        messages: [{ id: 'greet', role: 'agent', text: assistant.greeting }],
        basket: [],
        total: 0,
        verdict: null,
      },
    }));
  }, [assistant, activeId, threads]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.messages.length, busy]);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const push = useCallback((merchantId, message) => {
    setThreads((prev) => {
      const current = prev[merchantId] ?? { messages: [], basket: [], total: 0, verdict: null };
      return {
        ...prev,
        [merchantId]: { ...current, messages: [...current.messages, message] },
      };
    });
  }, []);

  // A held purchase is not finished. Keep watching until the card member
  // answers in their own app, so the three surfaces are visibly one system.
  const watchStepUp = useCallback(
    (merchantId, actionId) => {
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const fresh = await api.get(endpoints.decision(actionId));
          if (!fresh.step_up_state || fresh.step_up_state === 'pending') return;
          clearInterval(pollRef.current);
          const approved = ['approved', 'always_allowed'].includes(fresh.step_up_state);
          push(merchantId, {
            id: `${actionId}-resolved`,
            role: 'system',
            verdict: approved ? 'ALLOW' : 'DENY',
            text: approved
              ? 'The card member approved it. The order has gone through.'
              : 'The card member declined. Nothing was charged.',
            meta: { actionId },
          });
        } catch {
          clearInterval(pollRef.current);
        }
      }, 2000);
    },
    [push],
  );

  // --- send ---------------------------------------------------------------
  const send = async () => {
    const text = draft.trim();
    if (!text || !assistant || busy) return;

    const merchantId = assistant.shop.merchant_id;
    setDraft('');
    setError('');
    push(merchantId, { id: `you-${Date.now()}`, role: 'you', text });
    setBusy(true);

    try {
      const response = await api.post(endpoints.checkout, {
        agent_id: assistant.agent.agent_id,
        merchant_id: merchantId,
        prompt: text,
      });

      const lines = response.cart ?? [];
      const summary = lines
        .map((l) => `${l.label}${l.quantity > 1 ? ` × ${l.quantity}` : ''}`)
        .join(', ');

      setThreads((prev) => {
        const current = prev[merchantId];
        return {
          ...prev,
          [merchantId]: {
            ...current,
            basket: lines,
            total: Number(response.amount ?? 0),
            verdict: response.decision?.verdict ?? null,
            messages: [
              ...current.messages,
              {
                id: `${response.action_id}-cart`,
                role: 'agent',
                text: `I've put together ${summary} — ${money(response.amount)}. Checking with AEGIS…`,
              },
              {
                id: `${response.action_id}-verdict`,
                role: 'system',
                verdict: response.decision.verdict,
                text: response.decision.human_readable_reason,
                meta: {
                  rule: response.decision.reason_code,
                  actionId: response.action_id,
                },
              },
            ],
          },
        };
      });

      if (response.decision.verdict === 'STEP_UP') {
        watchStepUp(merchantId, response.action_id);
      }
    } catch (err) {
      // A 422 means the shop could not build a basket. That is the agent
      // answering, not a verdict -- so it speaks as the agent, and must never
      // be dressed up as an AEGIS decision.
      const detail = err?.data?.detail;
      if (err?.status === 422 && detail) {
        push(merchantId, { id: `sorry-${Date.now()}`, role: 'agent', text: detail });
      } else {
        setError(
          detail ??
            (err?.status === 429
              ? 'This agent has hit its rate limit. Give it a moment.'
              : 'Something went wrong reaching the service.'),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) return <SignIn onSignedIn={setUser} />;

  const suggestions = SUGGESTIONS[assistant?.shop?.kind] ?? [];
  const sidebar = (
    <ShopList
      assistants={assistants}
      activeId={activeId}
      onPick={(id) => {
        setActiveId(id);
        setNavOpen(false);
      }}
    />
  );

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* --- header ---------------------------------------------------- */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={(theme) => ({
          px: { xs: 1.5, sm: 2.5 },
          py: 1.25,
          borderBottom: '1px solid',
          borderColor: theme.vars.palette.divider,
          backgroundColor: theme.vars.palette.background.paper,
          flexShrink: 0,
        })}
      >
        {!upMd && (
          <IconButton size="small" onClick={() => setNavOpen(true)} aria-label="Choose a shop">
            <Box component="span" sx={{ fontSize: 20, lineHeight: 1 }}>
              ☰
            </Box>
          </IconButton>
        )}
        <Logo variant="mark" height={32} />
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700 }}>
            {assistant?.shop?.name ?? 'Agent simulator'}
          </Typography>
          <Typography variant="caption" noWrap sx={{ color: 'text.secondary' }}>
            {assistant ? assistant.agent.name : `Signed in as ${user.name}`}
          </Typography>
        </Stack>
        {!upLg && assistant && (
          <Button size="small" onClick={() => setPanelOpen(true)} sx={{ color: 'text.secondary' }}>
            Basket{thread.basket.length ? ` (${thread.basket.length})` : ''}
          </Button>
        )}
        <IconButton
          size="small"
          onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
          sx={{ color: 'text.secondary' }}
        >
          <Box component="span" sx={{ fontSize: 18, lineHeight: 1 }}>
            {mode === 'dark' ? '☀' : '☾'}
          </Box>
        </IconButton>
      </Stack>

      {/* --- body ------------------------------------------------------ */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {upMd && (
          <Box
            sx={(theme) => ({
              width: 248,
              flexShrink: 0,
              borderRight: '1px solid',
              borderColor: theme.vars.palette.divider,
              overflowY: 'auto',
              backgroundColor: theme.vars.palette.background.paper,
            })}
          >
            {sidebar}
          </Box>
        )}

        {/* --- the conversation --------------------------------------- */}
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ flex: 1, overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 2.5 }}>
            <Stack spacing={1.5} sx={{ maxWidth: 760, mx: 'auto' }}>
              {error && <Alert severity="error">{error}</Alert>}
              {thread.messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {busy && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: 0.5 }}>
                  <CircularProgress size={13} />
                  <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                    asking AEGIS…
                  </Typography>
                </Stack>
              )}
              <Box ref={endRef} />
            </Stack>
          </Box>

          {/* --- composer -------------------------------------------- */}
          <Box
            sx={(theme) => ({
              borderTop: '1px solid',
              borderColor: theme.vars.palette.divider,
              backgroundColor: theme.vars.palette.background.paper,
              px: { xs: 2, sm: 3 },
              py: 1.75,
              flexShrink: 0,
            })}
          >
            <Stack spacing={1.25} sx={{ maxWidth: 760, mx: 'auto' }}>
              {suggestions.length > 0 && thread.messages.length <= 1 && (
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {suggestions.map((suggestion) => (
                    <Chip
                      key={suggestion}
                      size="small"
                      variant="outlined"
                      label={suggestion}
                      onClick={() => setDraft(suggestion)}
                    />
                  ))}
                </Stack>
              )}
              <Stack direction="row" spacing={1} alignItems="flex-end">
                <TextField
                  fullWidth
                  size="small"
                  multiline
                  maxRows={4}
                  placeholder={
                    assistant ? `Ask ${assistant.shop.name} for something…` : 'Loading…'
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  disabled={!assistant || busy}
                />
                <Button
                  variant="contained"
                  onClick={send}
                  disabled={!draft.trim() || busy || !assistant}
                  sx={{ minWidth: 84 }}
                >
                  Send
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Stack>

        {/* --- basket + authority ------------------------------------- */}
        {upLg && assistant && (
          <Box
            sx={(theme) => ({
              width: 300,
              flexShrink: 0,
              borderLeft: '1px solid',
              borderColor: theme.vars.palette.divider,
              overflowY: 'auto',
              p: 2.5,
              backgroundColor: theme.vars.palette.background.paper,
            })}
          >
            <BasketPanel
              assistant={assistant}
              basket={thread.basket}
              total={thread.total}
              lastVerdict={thread.verdict}
            />
          </Box>
        )}
      </Box>

      {/* --- drawers for narrow screens ------------------------------- */}
      <Drawer open={navOpen} onClose={() => setNavOpen(false)}>
        <Box sx={{ width: 268 }}>{sidebar}</Box>
      </Drawer>
      <Drawer anchor="right" open={panelOpen} onClose={() => setPanelOpen(false)}>
        <Box sx={{ width: 300, p: 2.5 }}>
          <BasketPanel
            assistant={assistant}
            basket={thread.basket}
            total={thread.total}
            lastVerdict={thread.verdict}
          />
        </Box>
      </Drawer>
    </Box>
  );
};

export default App;
