# AEGIS — Agent Governance Platform

Authorisation, delegation, and a provable audit trail for autonomous agents that
spend money.

An agent with a card is an agent with your money. AEGIS decides — per
transaction, in single-digit milliseconds — whether an agent may spend, records
every decision in an append-only hash-chained ledger, and can prove afterwards
who was answerable when something went wrong.

The policy engine, delegation checks, hash-chained ledger and verification all
genuinely execute server-side. **No outcome in this system is hardcoded.**

---

## Quick start

```bash
# Everything: postgres 16, redis 7, the service (migrates + seeds on boot)
cd infra && docker compose up

# Console      http://localhost:5002
# Member app   http://localhost:5003
# Simulator    http://localhost:5004
# API + docs   http://localhost:8000/docs
```

Then, in two more terminals:

```bash
cd apps/console && npm install && npm run dev    # operator console
cd apps/member  && npm install && npm run dev    # card member surface
```

**Sign in** (all passwords `password123`):

| Email | Role | Sees |
|---|---|---|
| `operator@aegis.test` | operator | Everything: fleet, policy, incidents, disputes |
| `operator2@aegis.test` | operator | Second approver for the two-person re-arm |
| `agentops@aegis.test` | agent_operator | Only NorthStar's own agents |
| `member@aegis.test` | card_member | Only their own decisions, in plain language |

### Running without Docker

```bash
cd services/aegis
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
DATABASE_URL="sqlite:///./dev.db" .venv/bin/python -m aegis.seed.run --actions 25000
DATABASE_URL="sqlite:///./dev.db" AEGIS_ENABLE_DEMO=true \
  .venv/bin/python -m uvicorn aegis.main:app --port 8000
```

---

## Repository layout

```
apps/console      Aurora MUI admin template, re-themed → operator console
apps/member       lightweight MUI app → card member phone surface
apps/simulator    storefront surface → drive a real agent through a checkout
services/aegis    FastAPI + Pydantic + SQLAlchemy + Alembic
infra             docker-compose: postgres:16, redis:7, the service
```

---

## The engine

Seven modules under `services/aegis/aegis/engine/`, all pure functions of their
inputs — no I/O, no hidden state, fully unit-tested.

### Rule order (first match wins)

Rules run in a **fixed order** and the first match decides. That is what makes a
decision explainable: there is exactly one reason, and it is the first thing
that was wrong.

```
 1  fleet_stop                  DENY   the big red button
 2  agent_breaker               DENY   this agent is tripped
 3  operator_revoked            DENY   the operator lost authority
 4  agent_inactive              DENY   suspended or revoked
 5  mandate_expired             DENY
 6  delegation_depth            DENY   deeper than the mandate allows
6b  suspected_injection         DENY   deterministic, pre-model
6c  ship_to_mismatch            DENY   deterministic, pre-model
 7  prohibited_attribute_veto   DENY   deterministic, pre-model (merchant + CART)
 8  conformance < 0.45          DENY
 9  conformance < 0.70          STEP_UP
10  amount > ceiling            STEP_UP
11  velocity                    STEP_UP
12  novel_merchant              STEP_UP
13  conformance < 0.85          ALLOW + flag
14  allow                       ALLOW
```

### Fail closed

If the conformance scorer errors or times out, rules 8, 9 and 13 are **skipped —
not defaulted, not guessed** — and the engine returns `STEP_UP` with reason
`scorer_unavailable_fail_closed`. It **never** returns ALLOW on scorer failure.
Rules 1–7 still run first, because a fleet stop or a prohibited attribute is
decidable without a score.

There is a property test that sweeps the input space asserting ALLOW is
unreachable when the scorer is down.

### The trap merchant pair

The seed contains two merchants that are indistinguishable on the fields a naive
control inspects:

| Merchant | MCC | Sells | Verdict |
|---|---|---|---|
| FreshMart Daily Grocers | 5411 | groceries | **ALLOW** |
| FreshMart Gift Card Centre | 5411 | open-loop gift cards | **DENY** |

Same category code, same brand family. The prohibited-attribute veto is computed
by set intersection over ground-truth attributes **before any model call**, so it
holds even with the scorer completely offline.

In the seeded corpus: 1,147 grocery purchases allowed and **all 435 gift-card
attempts denied**. The grocer also shows 47 denials — every one is an attack
scene staged at a legitimate merchant (36 unauthorised delivery addresses, 11
injected instructions), which is the point: the same shop can be used honestly
and dishonestly, and only the cart, the address and the text distinguish them.

### Governing the cart, not the category

A merchant category says what kind of shop this is. The **cart** says what is in
the basket, and the basket is what gets governed:

```json
{ "merchant_category": "5411",              // grocery — looks fine
  "cart_items": [{"label": "Amazon gift card",
                  "attributes": ["gift_card"]}] }   // ← caught here
```

Prohibited attributes are checked against the **union** of merchant and cart
attributes. Carts are content-addressed (`cart_digest = sha256(canonical(cart))`)
so two identical baskets hash alike.

### Two more deterministic vetoes

Both run **before any model call**, so neither can be disabled by an outage:

| Veto | Catches |
|---|---|
| `ship_to_mismatch` | Ordinary goods, unauthorised delivery address — the exfiltration signature no amount or category check notices |
| `suspected_injection` | Untrusted text containing instruction-override phrasing |

Injection detection keys on the **grammar of manipulation**, not on topic. An
agent legitimately reads text mentioning gift cards; no agent legitimately reads
text telling it to ignore its own limits. The text is recorded as **evidence and
never executed** — an injected string can influence the audit trail but can
never reach the decision logic.

### Delegation

A child mandate must be a strict subset of its parent on **every** dimension —
categories, ceilings, transaction counts, delegation depth, expiry. Prohibitions
work in reverse: a child may add new "never"s but may never drop an inherited
one.

Checked at **issuance**, not at spend time, so an over-broad sub-agent can never
come into existence. Rejections name every violating dimension with both values,
because "you asked for a ₹15,000 ceiling under a ₹5,000 parent" is actionable
and "rejected" is not.

Revocation **cascades**: a sub-agent's authority exists only as a narrowing of
its parent's, so removing the parent removes the source of everything below it.

### The ledger

Every decision is appended with `self_hash = sha256(prev_hash + canonical_json)`.
Because each hash covers the previous one, altering any historical record
invalidates every record after it.

Immutability is enforced **at the database level**, not in application code:

- a `BEFORE UPDATE OR DELETE` trigger that raises unconditionally
- `REVOKE UPDATE, DELETE, TRUNCATE` from the application role
- a chain-continuity trigger so concurrent inserts cannot fork history

Application code cannot rewrite history even if fully compromised. Tests attack
the ledger through the ORM *and* through raw SQL and assert both are refused.

`GET /verify` recomputes the chain and reports the **first broken link** — the
exact row, with expected vs actual hash. Nightly Merkle checkpoints pin the
chain to a point in time, so even an attacker who rewrote every record could not
match a previously published root.

### Attribution

Liability is derived from **ledger fields only** — no heuristics, no model, no
outside context — and every determination returns the derivation steps it rested
on, so a reviewer can check the reasoning rather than trust it.

| Situation | Liable |
|---|---|
| Valid mandate + conformant | card member |
| Exceeded the authorised purpose | operator |
| No mandate at all | operator (with platform) |
| Merchant mismatch | merchant |
| Prompt injection | shared: operator + platform |
| Settled without a conformance check | platform |

---

## Conformance scoring

`conformance.py` calls **OpenAI `gpt-4.1-mini`** with a fixed prompt and strict
structured outputs (`json_schema`, `strict: true`), returning
`{score, rationale, vetoes[]}`. Results are cached in Redis on
`(mandate_hash, action_signature)`; `model_version` and `prompt_hash` are
persisted on every decision so an old score stays interpretable after the prompt
or model changes.

Four modes via `AEGIS_SCORER_MODE`:

| Mode | Behaviour |
|---|---|
| `auto` (default) | live when `OPENAI_API_KEY` is set, else replay |
| `live` | always call the API; fails closed if unreachable |
| `replay` | serve **recorded real scores** from a frozen fixture |
| `off` | permanently unavailable — exercises the fail-closed path |

> **Note on the current seed.** The committed corpus was generated with
> `OPENAI_API_KEY` unset, so it used the clearly-labelled `heuristic-offline-v1`
> scorer (`model_version` records this on every row — it is never presented as a
> model score). To regenerate with genuine scores:
>
> ```bash
> export OPENAI_API_KEY=sk-...
> cd services/aegis
> .venv/bin/python -m aegis.seed.run --actions 25000 --freeze
> ```
>
> `--freeze` writes the real responses to `aegis/seed/conformance_fixture.json`
> so later runs replay them deterministically and offline. The cache key ignores
> `action_id` and timestamp, so 25,000 actions collapse to roughly 20,000
> distinct scorer inputs — and far fewer once merchants and amounts repeat.

---

## The seed

`~25,000 synthetic actions across 12 mandate classes`, generated from a
**documented distribution** (`aegis/seed/distribution.py` — every number is a
stated modelling choice) and then run through the **real engine**. The seeder
never forces a verdict; the mix is whatever the rules decide.

Result from the committed run:

```
ALLOW    18,043   72.2%
DENY      3,001   12.0%
STEP_UP   3,956   15.8%

within_mandate              17,240
velocity_limit               2,235
prohibited_attribute_veto    1,837
amount_above_ceiling         1,121
conformance_marginal           803
novel_merchant                 600
conformance_below_deny_floor   547
ship_to_mismatch               359
suspected_injection            258
```

**False-block rate: 0.00%, measured over 21,999 labelled-legitimate actions.**
Every generated kind marked illegitimate was denied; every kind marked
legitimate was not. The label is recorded at generation time
(`seed_kind`, `seed_legitimate`), so the metric is measured rather than assumed
— see [DISTRIBUTION.md](DISTRIBUTION.md).

239 agents across 4 operators, 25,030 ledger records, 30 days with diurnal
weighting, and a scripted conformance collapse on one agent that trips the
breaker labelled **SUSPECTED PROMPT INJECTION**.

Fleet size is derived from action volume (`agent_scale()`): each mandate permits
4–12 transactions/agent/day, so the corpus must carry enough agents that a
normal day sits inside those limits. Under-provisioning makes every agent
saturate its velocity rule and drowns every other reason code.

---

## ACE integration seams

AEGIS is positioned as an **ACE-compatible governance layer**, not a competitor
to Amex's kit. Each of the four ACE services it would consume has a narrow
Protocol in [`providers.py`](services/aegis/aegis/providers.py) with two
implementations:

| ACE service | Seam | MVP | Production |
|---|---|---|---|
| Agent Registration | `IdentityProvider.verify()` | local registry | ACE call |
| Intent Intelligence | `MandateProvider.get()` | seeded mandates | ACE call |
| Cart Context | `CartProvider.get()` | inline cart | ACE call |
| Payment Credentials | `PaymentProvider.token()` | fake token | ACE call |

`AEGIS_PROVIDERS=sim|ace` is the entire switch. The ACE implementations
**refuse rather than invent** — a governance control that fabricates an identity
when its source is unreachable is worse than one that stops, so they raise and
`/decide` returns 503.

## Operational hardening

| Guarantee | Behaviour |
|---|---|
| **Idempotency** | `idempotency_key` on `/decide`; a retry returns the original decision instead of writing a second ledger record |
| **Rate limiting** | Per-agent, `AEGIS_DECIDE_RATE_LIMIT` (default 120/min), `429` + `Retry-After` |
| **Storage fail-closed** | If the ledger write fails, the transaction rolls back and **no verdict is returned** — a decision that cannot be recorded cannot be defended |
| **Redis optional** | Idempotency fails *open* (worst case: a visible duplicate). Rate limiting degrades to process-local counting and says so |
| **Live stream** | `WS /stream?token=<jwt>`, role-scoped server-side, heartbeats every 25s. Broadcasting is best-effort and can never fail a decision |

## Tests

```bash
cd services/aegis && .venv/bin/python -m pytest tests/ -q
# 147 passed
```

`tests/test_acceptance.py` maps 1:1 to the acceptance criteria:

| Criterion | Status |
|---|---|
| gift-card → DENY, score < 0.15, member-readable reason | ✅ |
| sub-agent above parent ceiling rejected at issuance | ✅ |
| `/verify` passes clean, fails + names the row after tamper | ✅ |
| revoke parent cascades to every descendant | ✅ |
| scorer timeout → STEP_UP, never ALLOW | ✅ |
| fleet stop → all DENY / `fleet_emergency_stop` | ✅ |
| policy edit changes blast-radius numbers from real history | ✅ |

Plus per-module suites for policy, conformance, delegation, ledger, breakers,
attribution, and persistence (including DB-enforced ledger immutability).

---

## Console screens

| Screen | Question it answers |
|---|---|
| **Fleet overview** | What is happening now? |
| **Agents** | What may this agent do? |
| **Policy studio** | What if I change this? |
| **Incidents & disputes** | Can I prove it? |

The **Decision Drawer** opens from any decision anywhere: verdict → plain-language
reason → evidence (mandate, conformance with model provenance, rules fired with
the winner highlighted, delegation chain, features, ledger hashes). Its
**card member view** toggle shows the same decision as the person whose money it
is would see it — if those two views disagree in substance, the product is lying
to somebody.

**Policy Studio's blast radius** replays real recorded decisions under a
candidate ruleset and lists the specific transactions that would change. A count
is a claim; a list is evidence.

---

## The OpenAI key

AEGIS runs, decides and demonstrates **without** a key. Setting one upgrades two
things: conformance scoring, and how the simulator reads your prompt.

```bash
cp .env.local.example .env.local
# put the real key in .env.local
./aegis.sh restart
./aegis.sh status          # confirms: scorer LIVE (gpt-4.1-mini, key ...abcd)
```

`.env.local` is gitignored and `aegis.sh` reads it at startup. Anything already
exported in your shell wins, so a one-off still works:

```bash
OPENAI_API_KEY=sk-... ./aegis.sh restart
```

| | without a key | with a key |
|---|---|---|
| Conformance score | recorded fixture, then deterministic scorer | `gpt-4.1-mini`, deterministic on failure |
| Simulator parsing | keyword rules | model extraction, rules on failure |
| Network calls | none | one per uncached decision |

**A bad key does not break anything.** The call fails, the deterministic scorer
takes over, and the reason is recorded in `model_version` — so a fallback score
can never be mistaken for a model score:

```
deterministic-v1 (fallback: AuthenticationError: 401 ...)
```

Note that seeding 25,000 actions with a live key means 25,000 billable calls.
Seed offline, then set the key for demos.

---

## The agent simulator

`apps/simulator` (port 5004) is a storefront you can walk into as an agent. Pick
an operator, pick one of its agents, pick a shop, and say what you want in
words:

```
FreshMart Daily Grocers · "buy 2kg rice, milk and some vegetables"
  → cart  Basmati rice 5kg ×2, Milk 1L ×1, Fresh vegetables basket ×1
  → ALLOW  within_mandate

FreshMart Gift Card Centre · "get me a gift card for 2500"
  → DENY   prohibited_attribute_veto
```

**It is a real client, not a demo mode.** `POST /simulate/checkout` reads the
sentence into a basket and then calls the same `decide()` any production
integration would: same identity seam, same rate limit, same idempotency, same
engine, same ledger append. A verdict seen here is one the product would
genuinely have produced. There is deliberately no shortcut into the engine —
a simulator that could stage its own verdicts would demonstrate nothing.

Two rules make that guarantee hold:

- **Prices and risk attributes come from the server's catalogue**, never from
  the client. If prose could set an amount or clear a `gift_card` attribute,
  anyone could talk a cart past `prohibited_attribute_veto`.
- **Injection detection stays deterministic** even when a model parses the
  sentence. Asking a model whether its own input was adversarial is not a
  control.

The prompt is read by rules (offline, deterministic, same cart every time). If
`OPENAI_API_KEY` is set the model does the extraction instead — but only to
pick SKUs and quantities from the catalogue — and falls back to the rules on
any failure.

### Watching all three surfaces

The point of the simulator is the loop between the three apps:

| | | |
|---|---|---|
| **5004** simulator | an agent tries to buy something | |
| **5002** console | the decision appears in the live stream | operator's view |
| **5003** member app | a held purchase waits to be answered | card member's view |

A `STEP_UP` demonstrates it end to end: the storefront shows "waiting for card
member" and keeps polling; you approve in the member app; the storefront
completes the order and the console chip turns from *Needs approval* to
*Approved by member*.

---

## Demo script

1. **Fleet overview** — live stream, DENY rows pulse red once, metrics count up.
2. **Click any DENY** → the drawer explains it in the card member's words.
3. **Agents** → pick a delegating agent → **Spawn sub-agent** with a ceiling
   above the parent's → rejected with every dimension named, nothing created.
4. **Revoke** the parent → the dialog lists every descendant it will take with it.
5. **Policy studio** → drag the review floor 0.70 → 0.85 → **Run blast radius**
   → real transactions move from ALLOW to STEP_UP, with the rows listed.
6. **Incidents** → the SUSPECTED PROMPT INJECTION event → **Verify ledger**
   (chain intact, 25,032 records) → `POST /api/demo/tamper?sequence=800`
   → verify again: **broken at #800**, expected vs actual hash.
7. **Build a dispute packet** → 7 numbered sections + liability derivation.
8. **EMERGENCY STOP** → console dims, banner slides down, every decision denies
   → re-arm needs a **second** operator.
9. **Member app** on a phone-sized window → approve a step-up for real.

---

## Deployment

**Frontend → Vercel** (both apps are static Vite builds):

```bash
cd apps/console && npm run build   # dist/
cd apps/member  && npm run build   # dist/
```
Set `VITE_API_URL` to the deployed API.

**Backend → Railway / Render**: deploy `services/aegis` (Dockerfile included) and
attach Postgres + Redis.

```bash
DATABASE_URL=postgresql+psycopg://…
REDIS_URL=redis://…
JWT_SECRET=<32+ bytes>            # boot warns loudly if left as the dev default
OPENAI_API_KEY=sk-…
AEGIS_ENABLE_DEMO=false           # MUST stay false in production
```

`AEGIS_ENABLE_DEMO` gates `/demo/tamper` and `/demo/restore`. Those endpoints
live in one file (`api/demo.py`) behind that flag, so a reviewer can confirm at a
glance that nothing else in the codebase writes to the ledger out of band.

---

## What came from Aurora vs. what was added

Aurora was scaffolding for the frontend, not part of the product. What remains
of it is infrastructure; everything demonstrative has been removed.

**Kept** — the MUI CSS-variable theme architecture (`colorSchemes.light/dark`),
the component override layer, the palette token pipeline, the sidenav + appbar
shell with its collapse behaviour, JWT auth (axios Bearer interceptor, guards),
SWR + `axiosFetcher`, `Intl` currency formatting, notistack, Iconify.

**Added** — the entire backend; AEGIS palette values and JetBrains Mono
variants; `framer-motion` and `@mui/x-tree-view`; the glossary, formatters,
motion primitives, verdict chips, emergency stop, halt banner, chain strip,
decision stream, delegation tree; four screens; the Decision Drawer; the member
app; the OpenAPI drift-checked client generator; the seed.

**Removed** — every demo page (ecommerce, CRM, kanban, email, chat, calendar,
file manager, hiring, invoice, landing, docs), their sections, providers and
fixture data; the settings customiser; topnav/combo navigation modes; i18n
(one locale ships); Auth0/Firebase/social auth paths; and the Aurora logo,
favicon and splash animation.

| | Before | After |
|---|---|---|
| Source files | 1,497 | 221 |
| Source size | 13 MB | 1.5 MB |
| Runtime dependencies | 74 | 30 |
| Production build | 73 s | 9 s |
| Bundle (gzipped) | — | 0.8 MB |

Five real defects surfaced during the cleanup, all now fixed:

1. **`MuiStack` defaulted to `direction: 'row'`**, inverting MUI's documented
   `column` default. Every `<Stack>` written against the standard behaviour
   laid out horizontally — this was the cause of the run-together text in the
   metric tiles, topbar readouts, page headers and decision stream.
2. **Charts never rendered.** `echarts-for-react/lib/core` needs an explicit
   `echarts` instance; Aurora passed it per demo page, so AEGIS's charts threw
   `Cannot read properties of undefined (reading 'init')`.
3. **Chart colours resolved to black** — MUI hands back `var(--…)` strings, and
   an ECharts canvas cannot resolve CSS variables. Now resolved via
   `useChartPalette`.
4. **Nav labels rendered lowercase i18n keys** (`fleet`, `agents`) after the
   `t()` indirection was removed.
5. **ECharts was inlined into a route chunk** rather than shared, and the 404
   page embedded 452 kB of Lottie JSON.
