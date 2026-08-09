# Firebase / Firestore setup

AEGIS uses Firestore as its **live data layer**: the backend mirrors decisions,
agents, incidents and fleet state there, and both frontends subscribe to them
for real-time updates without polling.

Project: **`aegis-6f60f`**

---

## What lives where, and why

| Data | Store | Why |
|---|---|---|
| **The hash-chained ledger** | SQL (Postgres/SQLite) | Tamper-evidence depends on the *database* refusing `UPDATE`/`DELETE` — triggers plus `REVOKE`, verified by tests that attack the table through raw SQL |
| Decisions, agents, merchants, operators, incidents, disputes, fleet state | **Firestore** | The console subscribes and updates live |

This split is the one architectural decision worth defending. Firestore has no
triggers, and the Admin SDK bypasses security rules by design — so "append-only"
there would be a convention, not a guarantee. Keeping the ledger in SQL is what
lets `/verify` mean something.

**Mirroring is always best-effort.** The SQL write commits first and is the
source of truth; the Firestore write happens after and is wrapped. A Firestore
outage degrades the console to REST polling. It can never fail an
authorisation.

---

## Setup

### 1. Get a service-account key

Firebase Console → ⚙ Project Settings → **Service Accounts** →
**Generate new private key**. Save it outside the repo, or at
`services/aegis/serviceAccountKey.json` (already gitignored).

> This file **is** a secret — unlike the web API key in `apps/*/.env`, which
> only identifies the project and is governed by security rules.

### 2. Point the backend at it

```bash
export FIREBASE_ENABLED=true
export FIREBASE_PROJECT_ID=aegis-6f60f
export GOOGLE_APPLICATION_CREDENTIALS="$PWD/services/aegis/serviceAccountKey.json"
```

Or add them to `aegis.sh`. On boot you should see:

```
INFO  aegis.firestore: firestore mirror: ENABLED (project aegis-6f60f)
```

If the key is missing you get a warning and the system runs on REST — by
design.

### 3. Deploy the security rules and indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes --project aegis-6f60f
```

The rules are the real access control. Two principles:

- **No client ever writes.** Every document mirrors a decision the backend
  already made. A client that could write here could fabricate governance
  history.
- **Reads are scoped by role**, from custom-token claims the backend sets at
  sign-in. An agent operator physically cannot read another operator's
  decisions — the console's query filter is a convenience, the rule is the
  control.

### 4. Backfill

```bash
cd services/aegis
FIREBASE_ENABLED=true \
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json \
  .venv/bin/python -m aegis.seed.run --actions 25000
```

Writes in batches of 450 (Firestore caps a batch at 500) and reports how many
documents were mirrored.

---

## How auth flows

```
POST /api/auth/login
   ↓  verifies the password, returns:
   ├─ token            the AEGIS JWT      → REST API
   └─ firebase_token   a custom token     → Firestore
                       carrying the SAME role / operator_id / card_member_id
   ↓
console signs in to Firebase  →  security rules read those claims
```

The claims come from the user record the backend just authenticated, so a
client cannot influence them. When `firebase_token` is absent (Firestore not
configured), the console skips the exchange and uses REST.

---

## Local development without a key

The Firestore emulator needs **JDK 21+** (`java -version` to check):

```bash
firebase emulators:start --only firestore --project aegis-6f60f
export FIRESTORE_EMULATOR_HOST=localhost:8080
export VITE_FIRESTORE_EMULATOR_HOST=localhost:8080   # for the frontends
```

The mirror's own tests (`tests/test_firestore_mirror.py`, 11 tests) run against
an in-memory fake and need no JVM — including the one that matters most: a
Firestore outage returns `False` rather than raising.

---

## Verifying it works

| Check | How |
|---|---|
| Mirror enabled | `firestore mirror: ENABLED` in the API log at boot |
| Documents arriving | Firebase Console → Firestore → `decisions` |
| Console is live | The "firestore" marker beside **Live decision stream** |
| Fallback intact | Unset `FIREBASE_ENABLED`; everything still works on REST |
| Rules enforced | Sign in as `agentops@aegis.test`; a query for another operator's decisions is denied |

---

## Environment reference

| Variable | Where | Purpose |
|---|---|---|
| `FIREBASE_ENABLED` | backend | Master switch, default off |
| `GOOGLE_APPLICATION_CREDENTIALS` | backend | Path to the service-account key |
| `FIREBASE_PROJECT_ID` | backend | Optional; read from the key otherwise |
| `FIRESTORE_EMULATOR_HOST` | backend | Local emulator |
| `VITE_FIREBASE_*` | frontends | Web config (not secret) |
| `VITE_FIRESTORE_EMULATOR_HOST` | frontends | Local emulator |
