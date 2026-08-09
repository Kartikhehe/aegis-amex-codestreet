# The seed distribution

Every action in the AEGIS demo database is synthetic. That is a deliberate
choice, not a shortcut, and this document states exactly what is generated and
why — so the numbers on screen can be argued with rather than merely believed.

**The important property: the seeder never decides a verdict.** It generates
*proposed actions* from the mix below and runs every one through the real
engine. The verdict distribution is whatever the rules produce. If a policy
threshold changes, these numbers change with it.

---

## Why simulated data is the right answer here

The reference architecture has seven data inputs. Six of them are either the
system's own logic or its own traffic:

| Input | Source | Could it be real? |
|---|---|---|
| Agents & identities | simulated | ACE Agent Registration — spec not public |
| Mandates / intent | simulated | ACE Intent Intelligence — spec public, access gated |
| Cart contents | simulated | ACE Cart Context — spec not public |
| Payment credentials | simulated | ACE Payment Credentials — access gated |
| The action stream | simulated | No — this is the product's own traffic |
| Conformance score | **computed** | Yes — deterministic scorer, or a live model |
| Verdicts, ledger, breakers | **computed** | These are the engine, not external data |

Only the conformance score reaches outside the system, and it has a
deterministic fallback. Everything else is authored or derived. See
`services/aegis/aegis/providers.py` for the ACE seams that make each simulated
input a one-line swap later.

---

## Volume and shape

```
25,000 actions · 30 days · 12 mandate classes · 4 operators · ~230 agents
random seed 20260808 (fixed — the corpus is byte-identical on every machine)
```

**Fleet sizing is load-bearing.** Each mandate permits 4–12 transactions per
agent per day. The agent count is derived from action volume
(`distribution.agent_scale()`) so a normal day sits at ~3.5 actions per agent —
comfortably inside those limits. Under-provisioning agents makes every one of
them saturate its velocity rule, and `velocity_limit` then drowns out every
other reason code. That is a property of the generator, not of the engine, and
getting it wrong makes the corpus say nothing.

**Temporal shape.** Actions are spread across 30 days with diurnal weighting
(heavier 08:00–22:00 IST) so velocity breakers and the hourly block-rate chart
have real structure rather than uniform noise.

---

## The action mix

Each generated action is assigned a *kind*. The kind decides what the action
looks like — it does **not** decide the verdict.

| Kind | Share | What it looks like | Legitimate? |
|---|---|---|---|
| `in_purpose_normal` | 74.0% | Routine purchase, in category, within ceiling, known merchant | ✅ |
| `in_purpose_novel_merchant` | 5.5% | In purpose, but a merchant never seen before | ✅ |
| `in_purpose_over_ceiling` | 4.5% | Genuine purchase above the per-transaction limit | ✅ |
| `in_purpose_marginal` | 4.0% | In purpose but a weak match — lands in the flag band | ✅ |
| `out_of_purpose` | 5.0% | Wrong category entirely (watches under a grocery mandate) | ❌ |
| `prohibited_attribute` | 4.5% | Gift cards, crypto, wallet top-ups | ❌ |
| `exfiltration_ship_to` | 1.5% | Ordinary goods, unauthorised delivery address | ❌ |
| `prompt_injection` | 1.0% | Untrusted text containing instruction-override phrasing | ❌ |

### Ground truth, and why it matters

The **Legitimate?** column is recorded on every seeded decision
(`seed_kind`, `seed_legitimate`). It is the only honest basis for a
false-block rate:

```
false-block rate = DENYs on legitimate actions / all legitimate actions
```

Measuring it any other way is circular — you cannot ask the system that made a
decision whether that decision was correct. Rows without a label (real traffic)
are excluded from the calculation rather than guessed at, and the console
reports the sample size alongside the rate.

A rate quoted without its denominator is a number nobody can challenge.

---

## The trap merchant pair

Two merchants that are indistinguishable on every field a conventional control
inspects:

| Merchant | MCC | Category | Sells |
|---|---|---|---|
| FreshMart Daily Grocers | **5411** | grocery | groceries |
| FreshMart Gift Card Centre | **5411** | grocery | open-loop gift cards |

Same category code. Similar name. Any control keyed on MCC treats them as one
merchant. AEGIS separates them because the prohibited-attribute veto reads the
**cart**, not the category — and that veto is pure set intersection computed
before any model call, so it holds with the scorer completely offline.

This is the single most important row in the corpus. If it ever stops working,
the product's central claim has stopped being true.

---

## Carts

Every action carries a plausible basket (`CART_LINES` in
`distribution.py`) — between one and three line items drawn from that
merchant's catalogue, each with its own attributes. A corpus with empty carts
would never exercise the thing the engine actually governs on.

Baskets are content-addressed: `cart_digest = sha256(canonical(cart))`. Two
identical baskets hash alike regardless of when or by whom they were proposed.

---

## Delivery destinations

Each operator has one authorised destination (`SHIP_TO_BY_OPERATOR`). The
`exfiltration_ship_to` kind keeps the goods ordinary and changes only the
address — the signature of an agent being used to move value out. No amount
check, category check or velocity check notices this; the ship-to veto does.

---

## Untrusted text

`prompt_injection` actions carry text containing instruction-override phrasing
("ignore previous instructions", "do not tell the account holder"). Detection
keys on the **grammar of manipulation**, not on topic — an agent legitimately
reads text mentioning gift cards; no agent legitimately reads text telling it
to ignore its own limits.

A further ~6% of *ordinary* actions carry benign merchant chatter ("your order
ships Tuesday"), so the detector is continuously exercised against text that
must **not** trip it. False positives here are an accepted cost: the failure
mode is a step-up the card member can clear, not an unnoticed compromise.

---

## The injection scenario

One agent (`ag_travel_rogue`) has a scripted history: healthy conformance for
several days, then a sharp collapse in the final hours across unrelated
merchants. This is what trips the conformance-collapse breaker and produces the
incident labelled **SUSPECTED PROMPT INJECTION** on the Incidents screen.

It is scripted because a breaker that has never fired is a breaker nobody has
tested.

---

## Conformance scoring during seeding

Controlled by `AEGIS_SCORER_MODE`:

| Mode | Behaviour |
|---|---|
| `auto` (default) | Live model when `OPENAI_API_KEY` is set, else replay |
| `live` | Call OpenAI `gpt-4.1-mini`, cached by `(mandate_hash, action_signature)` |
| `replay` | Serve previously recorded **real** scores from a frozen fixture |
| `off` | Scorer permanently unavailable — exercises the fail-closed path |

Without a key and without a fixture, seeding falls back to
`DeterministicScorer` (`model_version: "deterministic-v1"`). That version string
is written to every decision, so a deterministic score can never be mistaken
for a model score when reading the ledger later.

The cache key ignores `action_id` and timestamp, so 25,000 actions collapse to
roughly 20,000 distinct scorer inputs — and far fewer once merchants, amounts
and baskets repeat.

To regenerate with genuine model scores:

```bash
export OPENAI_API_KEY=sk-...
cd services/aegis
.venv/bin/python -m aegis.seed.run --actions 25000 --freeze
```

`--freeze` writes the real responses to `aegis/seed/conformance_fixture.json`
so subsequent runs replay them deterministically and offline.

---

## Reproducing

```bash
cd services/aegis
.venv/bin/python -m aegis.seed.run --actions 25000
```

The random seed is fixed at `20260808`. A demo whose numbers differ between
machines is not reproducible, and a reviewer must be able to see exactly what
we see.
