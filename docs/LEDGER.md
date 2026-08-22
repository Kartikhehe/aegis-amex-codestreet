# The ledger

Every decision AEGIS makes is appended to a hash-linked ledger. Each record
stores the hash of the record before it, so the whole history forms a chain:
change any record and every hash after it stops matching.

This document covers how to look at it, how to prove it is intact, and what it
is actually for.

## Where to see it

**Console → Incidents & disputes.** The strip at the top re-walks the entire
chain, recomputing each hash from the record's own contents. Green means every
record verified. If a link fails, the strip stops dead at that record instead
of filling to the end — after a break, nothing downstream can be trusted, and a
progress bar that completes and then announces failure hides where the failure
was.

Underneath it, **Show the records** lists the records themselves: each one's
hash, the predecessor hash it commits to, and the action it belongs to. The
link icon is computed in your browser by comparing each row's `prev_hash`
against the next row's `self_hash` — not read off the server's verdict. So the
chain can be confirmed by a sceptic without trusting our summary.

## Where to see it from a terminal

```bash
TOKEN=$(curl -s -X POST localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"operator@aegis.test","password":"password123"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

# Is the chain intact?
curl -s localhost:8000/api/verify -H "Authorization: Bearer $TOKEN"

# The newest records
curl -s "localhost:8000/api/ledger?limit=5" -H "Authorization: Bearer $TOKEN"
```

`/api/verify` accepts `from_sequence` and `to_sequence` to check a slice, which
is what you want for a dispute covering a known window rather than all history.

## Running on Postgres

SQLite is the default so the demo starts with no setup. Postgres is what makes
the immutability claim real, because the guarantee is enforced by the database
rather than by our code.

```bash
brew services start postgresql@15    # or: pg_ctl -D ... start

createuser aegis_app --pwprompt      # password: aegis_dev_pw
createdb aegis

cd services/aegis
DATABASE_URL="postgresql+psycopg://aegis_app:aegis_dev_pw@localhost:5432/aegis" \
  .venv/bin/alembic upgrade head

# Seed as a superuser: the seed truncates the ledger, which the app role is
# deliberately forbidden from doing (see below).
DATABASE_URL="postgresql+psycopg://$USER@localhost:5432/aegis" \
  .venv/bin/python -m aegis.seed.run

# Then run the app as the restricted role.
export DATABASE_URL="postgresql+psycopg://aegis_app:aegis_dev_pw@localhost:5432/aegis"
./aegis.sh restart
```

`aegis.sh` honours an existing `DATABASE_URL`, so exporting it is the whole
switch. Unset it to go back to SQLite.

### Why two roles

The application role holds `SELECT, INSERT, REFERENCES, TRIGGER` on `ledger` —
and nothing else. It cannot UPDATE, DELETE, or TRUNCATE a record, so a bug or
an SQL injection in the service has no path to rewriting history. The seed is a
maintenance operation, not application traffic, so it runs as a superuser.

## Proving it, live

Four attacks, all refused:

```bash
# 1. The app role tries to edit a record -> permission denied
PGPASSWORD=aegis_dev_pw psql -U aegis_app -h localhost -d aegis \
  -c "UPDATE ledger SET action_id='act_TAMPERED' WHERE sequence=4000;"

# 2. A SUPERUSER tries to edit a record -> refused by trigger
psql -d aegis -c "UPDATE ledger SET action_id='act_TAMPERED' WHERE sequence=4000;"

# 3. A superuser tries to wipe the table -> refused by trigger
psql -d aegis -c "TRUNCATE ledger;"

# 4. A forged append with a wrong prev_hash -> refused by trigger
psql -d aegis -c "INSERT INTO ledger (...) VALUES (..., repeat('f',64), ...);"
```

The second one is the interesting result. `REVOKE` alone would not stop a
superuser, or even the table's own owner — so the append-only property is
enforced by triggers (`trg_ledger_append_only`, `trg_ledger_no_truncate`,
`trg_ledger_chain_continuity`) rather than by grants alone. There is no SQL
path to editing a record, at any privilege level.

To confirm nothing changed after those attempts:

```sql
SELECT count(*) FROM (
  SELECT prev_hash, lag(self_hash) OVER (ORDER BY sequence) AS want FROM ledger
) t WHERE want IS NOT NULL AND prev_hash <> want;   -- 0 = intact
```

That query checks the chain using only Postgres, with none of our code
involved — a useful independent second opinion on `/api/verify`.

## What it is for

**Disputes.** Open a dispute from any decision and AEGIS assembles a numbered
evidence packet from the stored record: the mandate in force, the rules that
fired, the cart, and the ledger sequence. The packet is evidence rather than
assertion because the record it is drawn from cannot have been edited after the
fact — which is the difference between "our logs say" and "here is the record,
verify it yourself".

**Post-incident review.** When a breaker trips, the ledger holds every decision
that led there in order, with the features each was scored on. The chain matters
because the review is only worth running if the history was not touched between
the incident and the review.

**Audit.** `/api/verify` re-walks the chain on demand and reports how long it
took. A regulator's question is not "do you keep logs" but "can you show the
logs were not edited"; the head hash answers that in one value — publish it, and
any later change to any record becomes detectable.

## Schema changes

Migrations live in `services/aegis/alembic/versions/`. SQLite development uses
`create_all`, which builds whatever the models declare and never reads the
migrations — so a model column can work for weeks and then fail on first
contact with Postgres. `tests/test_migrations.py` guards against exactly that
by building a schema from the migrations alone and diffing it against the
models. If you add a column to a model, add a migration in the same change.
