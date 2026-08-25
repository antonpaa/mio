# Running Mio locally

Everything runs on your machine: Postgres and Mailpit in Docker, the
three Node processes from the workspace. Every outbound email — OTP
codes, invitations, notification nudges — lands in Mailpit's inbox at
<http://localhost:8025>, which is also how you sign in.

## Prerequisites

- Node.js 22+
- pnpm 10 (`corepack enable` gives you the pinned version)
- Docker with Compose (for Postgres 17 + Mailpit, and for the
  integration tests' throwaway databases)

## 1. Install and start services

```bash
pnpm install
pnpm dev:services       # Postgres 17 on :5432, Mailpit on :8025 (UI) / :1025 (SMTP)
```

The compose file creates the database `mio` with the **owner** user
`mio` / password `mio-local-only`. That owner URL is used for
migrations and the bootstrap CLI only; the running apps drop to the
restricted carrier roles (`mio_app`, `mio_worker`) that the first
migration creates.

## 2. Migrate

```bash
DATABASE_URL="postgres://mio:mio-local-only@localhost:5432/mio" pnpm migrate
```

Forward-only SQL migrations from `packages/db/migrations/` — schemas,
roles, row-level security, the audit tables, the job bus.

## 3. Choose your starting point

### Option A — the synthetic demo world (recommended first run)

Seeds a deterministic world of synthetic patients, staff, treatments,
surveys, responses and alerts. **Never contains real data** — the
seeder refuses to run against a database holding any non-`.example`
account (the E8 tripwire).

```bash
DATABASE_URL="postgres://mio:mio-local-only@localhost:5432/mio" \
  pnpm --filter @mio/synthetic seed
```

Every seeded account signs in with the password
**`demo-password-mio-42`**. Emails are deterministic for the demo
profile (seed 42); useful ones:

| Role | Email |
|---|---|
| Administrator | `satu.jokinen.0@staff.example` |
| Auditor | `nils.jonsson.2@staff.example` |
| Treatment Lead | `eetu.virtanen.5@staff.example` |
| Treatment member | `elias.heikkinen.9@staff.example` |
| Patient | `sampo.jarvinen.1@patient.example` |

(Any account you see in A1 works the same way; the OTP at sign-in
arrives in Mailpit.)

### Option B — an empty system (the real first-run)

An empty system has nobody who can sign in, so the very first
administrator is created from outside it with the owner credentials —
the sanctioned break-glass path (see
[runbooks — Bootstrap the first administrator](runbooks.md#bootstrap-the-first-administrator-break-glass)):

```bash
cd apps/api
DATABASE_URL="postgres://mio:mio-local-only@localhost:5432/mio" \
  node --import @swc-node/register/esm-register src/cli/bootstrap-admin.ts \
  you@example.org "Your" "Name" en --base-url http://localhost:5173
```

It prints a single-use `http://localhost:5173/welcome/<token>` link
(valid 7 days, deliberately not emailed). With the web app running
(step 4): open the link, set a password (12+ characters, not
containing your own name or email), accept the terms, and enter the
OTP code from Mailpit. You land in A1 — from there you create every
other staff member and patient; their invitation links arrive in
Mailpit. The bootstrap act itself is on the audit trail as a
system-actor `staff_account.bootstrap` change event.

## 4. Run the apps

Three terminals from the repo root (API and worker share the same
environment; `MIO_STORAGE_DIR` must be the **same absolute path** for
both, or the worker will scan a different attachment store than the
API writes to):

```bash
# terminal 1 — API on :3000
MIO_DATABASE_URL="postgres://mio:mio-local-only@localhost:5432/mio" \
MIO_OTP_PEPPER="local-dev-pepper-0123456789" \
MIO_COOKIE_SECURE=false \
MIO_SMTP_URL="smtp://localhost:1025" \
MIO_STORAGE_DIR="$PWD/.storage-dev" \
  pnpm --filter @mio/api dev

# terminal 2 — web (Vite) on :5173, proxies /api and /health to :3000
pnpm --filter @mio/web dev

# terminal 3 — worker (reminders, notification fan-out, survey sweeps,
# attachment scanning, retention; optional for a quick look, needed for
# anything scheduled to actually happen)
MIO_DATABASE_URL="postgres://mio:mio-local-only@localhost:5432/mio" \
MIO_SMTP_URL="smtp://localhost:1025" \
MIO_STORAGE_DIR="$PWD/.storage-dev" \
  pnpm --filter @mio/worker dev
```

Environment notes:

- `MIO_OTP_PEPPER` — any string of 16+ characters locally; the API
  refuses to start without one.
- `MIO_COOKIE_SECURE=false` — required over plain http, or the browser
  drops the session cookie.
- `MIO_SMTP_URL` — with it, mail goes to Mailpit; **without it, the
  API logs each mail (including OTP codes) to stdout instead**, which
  also works if you'd rather not run Mailpit.
- No ClamAV locally: without `MIO_CLAMAV_ADDR` the worker uses a dev
  scanner that passes clean files, so image attachments clear
  quarantine on the next minute tick.
- The auth surface is rate-limited (WP-30): default 30 requests per
  5 minutes per IP. Scripted logins can raise it via
  `MIO_AUTH_RATE_LIMIT`.

Open <http://localhost:5173>, sign in, and fetch the 6-digit code from
<http://localhost:8025>.

## 5. Validate before pushing

```bash
pnpm check    # lint + format + typecheck + tests + dependency boundaries
```

The integration tests need a Postgres. With Docker running they
provision throwaway `postgres:17` containers by themselves. To reuse
the compose cluster instead (faster), create a dedicated test database
once and point the tests at it — **never the dev database**, the tests
truncate and reseed:

```bash
docker compose exec postgres createdb -U mio mio_test
MIO_TEST_DATABASE_URL="postgres://mio:mio-local-only@localhost:5432/mio_test" pnpm check
```

## Resetting

```bash
pnpm dev:services:down          # stop containers, keep data
docker volume rm mio_postgres-data   # ...or drop the database entirely
```

Then start again from step 1. Re-seeding the demo world on an existing
database also works — the seeder replaces the synthetic world in place.
