import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppBar,
  Box,
  Button,
  Container,
  IconButton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Typography,
  useColorScheme,
  useMediaQuery,
} from "@mui/material";
import axios from "axios";
import AgentAuthorityCard from "./components/AgentAuthorityCard";
import Logo from "./components/Logo";
import BlockedCard from "./components/BlockedCard";
import CardSummary from "./components/CardSummary";
import StepUpCard from "./components/StepUpCard";
import endpoints from "./aegis/api";

/**
 * The card member surface.
 *
 * Phone-first, plain language, no tables and no jargon. It shows the same
 * decisions the console shows, but answers a different question: not "is the
 * fleet healthy?" but "is something waiting for me, and what may this thing
 * do with my card?"
 *
 * It talks to the SAME API with the SAME JWT as the console. The scoping is
 * server-side: a card_member token only ever returns that member's rows, so
 * this app does not need -- and cannot grant itself -- broader access.
 */

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000/api",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("aegis_member_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  (error) =>
    Promise.reject({
      status: error.response?.status,
      data: error.response?.data,
    }),
);

const Login = ({ onSignedIn }) => {
  const [email, setEmail] = useState("member@aegis.test");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.post(endpoints.login, { email, password });
      localStorage.setItem("aegis_member_token", result.token);
      onSignedIn(result.user);
    } catch (err) {
      setError(err?.data?.detail ?? "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ pt: 8 }}>
      <Stack spacing={3} component="form" onSubmit={submit}>
        {/* On a bare page the lockup's opaque background would read as a
            stray box, so it is given deliberate padding and framing instead. */}
        <Logo height={60} sx={{ p: 1.5, alignSelf: "flex-start" }} />
        <Stack spacing={1}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Your card, your rules
          </Typography>
          <Typography variant="body1" sx={{ color: "text.secondary" }}>
            Sign in to review what your agents are allowed to spend.
          </Typography>
        </Stack>

        <TextField
          fullWidth
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          fullWidth
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && (
          <Typography variant="body2" sx={{ color: "error.main" }}>
            {error}
          </Typography>
        )}

        <Button type="submit" size="large" variant="contained" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </Stack>
    </Container>
  );
};

const EmptyMessage = ({ title, body }) => (
  <Stack
    spacing={1}
    alignItems="center"
    sx={{ py: 8, px: 3, textAlign: "center" }}
  >
    <Typography variant="h6" sx={{ fontWeight: 700 }}>
      {title}
    </Typography>
    <Typography variant="body1" sx={{ color: "text.secondary" }}>
      {body}
    </Typography>
  </Stack>
);

const App = () => {
  const { mode, setMode } = useColorScheme();
  // Drives the layout switch: a phone gets one stacked column, a laptop gets
  // the list beside a standing summary.
  const upSm = useMediaQuery((theme) => theme.breakpoints.up("sm"));
  const upMd = useMediaQuery((theme) => theme.breakpoints.up("md"));
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState(0);
  const [decisions, setDecisions] = useState([]);
  const [agents, setAgents] = useState([]);
  const [busy, setBusy] = useState(false);

  const signedIn = Boolean(user);

  const load = useCallback(async () => {
    if (!localStorage.getItem("aegis_member_token")) return;
    try {
      const [decisionPage, agentList] = await Promise.all([
        api.get(endpoints.decisions, { params: { limit: 50 } }),
        api.get(endpoints.agents),
      ]);
      setDecisions(decisionPage.items ?? []);
      setAgents(agentList ?? []);
    } catch {
      // A stale token is the usual cause; drop it and show the sign-in screen.
      localStorage.removeItem("aegis_member_token");
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("aegis_member_token");
    if (!token) return;
    api
      .get(endpoints.profile)
      .then((profile) => {
        setUser(profile);
        load();
      })
      .catch(() => localStorage.removeItem("aegis_member_token"));
  }, [load]);

  const pending = useMemo(
    () =>
      decisions.filter(
        (d) => d.verdict === "STEP_UP" && d.step_up_state === "pending",
      ),
    [decisions],
  );
  const blocked = useMemo(
    () => decisions.filter((d) => d.verdict === "DENY").slice(0, 12),
    [decisions],
  );

  const resolve = async (decision, choice) => {
    setBusy(true);
    try {
      await api.post(endpoints.resolveStepUp(decision.action_id), {
        decision: choice,
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const dispute = async (decision) => {
    setBusy(true);
    try {
      await api.post(endpoints.disputes, {
        action_id: decision.action_id,
        reason: "Reported from the card member app",
      });
    } finally {
      setBusy(false);
    }
  };

  // The member's verdict on a block. This is the only real-traffic source of
  // a false-block rate -- nobody labels a live purchase as legitimate before
  // it happens. An operator still has to confirm it before it counts.
  const reportBlock = async (decision, report) => {
    setBusy(true);
    try {
      await api.post(endpoints.blockReport(decision.action_id), { report });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async (agent) => {
    setBusy(true);
    try {
      await api.post(endpoints.suspendAgent(agent.agent_id));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) {
    return (
      <Login
        onSignedIn={(profile) => {
          setUser(profile);
          load();
        }}
      />
    );
  }

  return (
    <Box sx={{ pb: 10, minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="transparent" elevation={0}>
        <Box
          sx={(theme) => ({
            borderBottom: "1px solid",
            borderColor: theme.vars.palette.divider,
            backgroundColor: theme.vars.palette.background.paper,
          })}
        >
          {/* Contained, not edge-to-edge. A full-bleed bar on a 27" monitor is
              what makes a phone layout look like a phone layout in a browser. */}
          <Container maxWidth="lg" disableGutters>
            <Toolbar sx={{ px: { xs: 2, sm: 3 } }}>
              {/* Shield only: the wordmark would crowd out the member's own
                  name, which is what this bar is actually for. */}
              <Logo variant="mark" height={36} sx={{ mr: 1.25 }} />

              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="subtitle1"
                  sx={{ fontWeight: 700, lineHeight: 1.2 }}
                >
                  {user.name}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {pending.length > 0
                    ? `${pending.length} waiting for you`
                    : "Nothing needs your attention"}
                </Typography>
              </Stack>

              <IconButton
                onClick={() => setMode(mode === "dark" ? "light" : "dark")}
                aria-label={
                  mode === "dark" ? "Switch to light mode" : "Switch to dark mode"
                }
                sx={{ color: "text.secondary" }}
              >
                <Box component="span" sx={{ fontSize: 20, lineHeight: 1 }}>
                  {mode === "dark" ? "☀" : "☾"}
                </Box>
              </IconButton>
            </Toolbar>

            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              // Full-width tabs are right on a phone and wrong on a desktop,
              // where three stretched tabs read as a placeholder.
              variant={upSm ? "standard" : "fullWidth"}
              sx={{ px: { xs: 0, sm: 3 }, minHeight: 44 }}
            >
              <Tab
                label={`Approvals${pending.length ? ` (${pending.length})` : ""}`}
              />
              <Tab label={`Blocked${blocked.length ? ` (${blocked.length})` : ""}`} />
              <Tab label="Agents" />
            </Tabs>
          </Container>
        </Box>
      </AppBar>

      <Container maxWidth="lg" sx={{ pt: 3 }}>
        {/* One column on a phone; list + standing summary on a laptop. The
            summary is the answer to "is my card generally under control?",
            which the tabbed list on its own never gives. */}
        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 320px" },
            alignItems: "start",
          }}
        >
          <Box sx={{ minWidth: 0 }}>
        {tab === 0 &&
          (pending.length === 0 ? (
            <EmptyMessage
              title="Nothing waiting"
              body="When an agent wants to spend outside what you authorised, it will appear here before anything is charged."
            />
          ) : (
            <Stack spacing={2}>
              {pending.map((decision) => (
                <StepUpCard
                  key={decision.action_id}
                  decision={decision}
                  busy={busy}
                  onResolve={(choice) => resolve(decision, choice)}
                />
              ))}
            </Stack>
          ))}

        {tab === 1 &&
          (blocked.length === 0 ? (
            <EmptyMessage
              title="Nothing blocked"
              body="Purchases your agents were not allowed to make will be listed here, with the reason."
            />
          ) : (
            <Stack spacing={2}>
              {blocked.map((decision) => (
                <BlockedCard
                  key={decision.action_id}
                  decision={decision}
                  busy={busy}
                  onDispute={dispute}
                  onReport={reportBlock}
                />
              ))}
            </Stack>
          ))}

        {tab === 2 &&
          (agents.length === 0 ? (
            <EmptyMessage
              title="No agents yet"
              body="Agents you authorise to spend on your card will appear here, with exactly what each one may and may never buy."
            />
          ) : (
            <Stack spacing={2}>
              {agents.map((agent) => (
                <AgentAuthorityCard
                  key={agent.agent_id}
                  agent={agent}
                  busy={busy}
                  onPause={() => togglePause(agent)}
                />
              ))}
            </Stack>
          ))}
          </Box>

          {upMd && (
            <Box sx={{ position: "sticky", top: 96 }}>
              <CardSummary
                decisions={decisions}
                agents={agents}
                pending={pending.length}
              />
            </Box>
          )}
        </Box>
      </Container>
    </Box>
  );
};

export default App;
