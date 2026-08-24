# Runbooks (WP-32)

Operational procedures for the deployed environments (WP-09: Cloud Run
api + worker, Cloud SQL Postgres, one object-storage bucket, deploys via
`.github/workflows/deploy.yml`). Each runbook states the symptom, the
diagnosis commands, and the smallest safe action. Structured JSON logs
from api and worker land in Cloud Logging; the WP-32 alerts (uptime,
5xx rate, p95 latency) are declared in `infra/modules/monitoring`.

## Deploy and rollback

**Deploy** happens on merge to `main` (staging) or by manual dispatch
(dev): build images → **migration gate** → roll services. A migration
failure stops the rollout before any new code serves traffic.

**Rollback** — new revision misbehaves, migrations were compatible
(the normal case; migrations are forward-only and additive by
convention):

```bash
gcloud run revisions list --service mio-staging-api --region europe-north1
gcloud run services update-traffic mio-staging-api \
  --region europe-north1 --to-revisions <previous-revision>=100
# and the worker the same way
```

If the bad behaviour came WITH a migration, do not roll the schema
back — migrations are forward-only. Fix forward: a new migration or a
new image, through the same gate.

## Migration gate failed

Symptom: deploy job red at "Migration gate"; no traffic moved.

1. Read the job log — the failing statement is printed.
2. Reproduce locally: `DATABASE_URL=<local scratch> pnpm migrate` against
   a copy restored from backup (see below) when data-shape-dependent.
3. Fix the migration IN PLACE only if it has never applied anywhere
   (gate failed = it did not apply to that environment; check the others).
   If it applied somewhere, write a follow-up migration instead.

## Restore from backup (E7 — rehearsed, see evidence below)

Cloud SQL keeps automated daily backups + PITR WAL. Two shapes:

**Full instance restore** (data loss / corruption):
```bash
gcloud sql backups list --instance mio-staging-pg
gcloud sql backups restore <backup-id> --restore-instance mio-staging-pg
```
PITR to a moment: `gcloud sql instances clone mio-staging-pg mio-staging-pg-pitr --point-in-time <RFC3339>`
then repoint the `database-url` secret and roll the services.

**Logical restore** (one environment's data into a fresh database —
the shape rehearsed locally):
```bash
pg_dump --format=custom --no-owner "$SOURCE_URL" -f mio.dump
createdb <target>   # or gcloud sql databases create
pg_restore --no-owner --role=<owner> -d "$TARGET_URL" mio.dump
```
Then validate before pointing anything at it — the rehearsal's checks:
row counts on `identity.patient_account`, `clinical.treatment`,
`audit.access_event`; one care-scoped query as `mio_app` under RLS
context to prove grants and policies survived the dump (they do:
roles are cluster-level, `pg_restore` recreates grants and policies).

**Rehearsal evidence (2026-08-24, local scratch cluster, 20k-patient
perf dataset):** recorded in
[`performance-baseline.md`](performance-baseline.md) alongside the
timings — dump, restore, validation queries and their outputs.

## Worker stuck / jobs not running

Symptom: reminders or notifications stop; `notifications dispatched`
log lines absent.

1. `gcloud run services describe mio-staging-worker` — is a revision
   serving? Worker logs: look for `worker failed to start` or repeated
   job errors (pg-boss retries with backoff; a poison job logs each try).
2. Job state is IN POSTGRES (`pgboss` schema): `SELECT name, state,
   count(*) FROM pgboss.job GROUP BY 1,2;` — `failed` rows carry
   `output` with the error.
3. Restart is safe at any time: every job is idempotent by design
   (watermarks, unique pairs, change-event dedupe). Roll the worker
   revision; it catches up on boot (each queue sends itself a kick).

## Auth-surface rate limiting (WP-30)

Symptom: legitimate users see 429 on login (e.g. a clinic behind one
NAT address).

- The window is per instance and per IP: `MIO_AUTH_RATE_LIMIT`
  (default 30) per `MIO_AUTH_RATE_WINDOW_MS` (default 5 min).
- Raise the limit via service env vars and roll; no build needed.
- The per-account progressive delay stays; it is the real brake.

## Database pressure

Symptom: p95 latency alert; Cloud SQL CPU high.

1. `SELECT * FROM pg_stat_activity WHERE state <> 'idle' ORDER BY query_start;`
2. The hot paths and their expected shapes are recorded in
   [`performance-baseline.md`](performance-baseline.md) — compare
   `EXPLAIN (ANALYZE, BUFFERS)` output against the baseline's plans
   before adding indexes in an incident.
3. The audit tables only ever grow — if they dominate, confirm the
   WP-29 export job is running and consider partitioning as planned
   work, not an incident action.

## Bootstrap the first administrator (break-glass)

A fresh environment has nobody who can sign in, so the very first
administrator is created from OUTSIDE the system — the one sanctioned
out-of-band write path (decided 2026-08-24). It needs the **owner**
database credentials (the migration role, not `mio_app`):

```bash
cd apps/api
DATABASE_URL="postgres://<owner>@<host>/<db>" \
  node --import @swc-node/register/esm-register src/cli/bootstrap-admin.ts \
  admin@example.org "Given" "Family" fi --base-url https://mio.example
```

- Prints a `/welcome/<token>` link: single-use, expires in 7 days,
  deliberately **not** emailed — hand it over on a trusted channel.
- Re-running for the same email re-invites (new link, old ones
  dead-lettered); it refuses deactivated accounts and refuses to
  escalate an existing non-administrator account.
- The act lands in `audit.change_event` as a system-actor
  `staff_account.bootstrap` event with `detail.bootstrap = true` —
  verify it after use; a break-glass act with no trace is an incident.
- Every later account is created in A1 by that administrator; this
  command is for empty systems and lockouts only.

## Secrets rotation

`database-url` (per env) lives in Secret Manager; the services read it
at boot. Rotate: add a new secret version → roll both services. The
mailer/SMTP and ClamAV settings are plain env vars on the services.

## Incident basics

1. Declare in the team channel; one person drives.
2. Patient-data exposure suspected → the DPIA support material
   (`../compliance/dpia-support.md`) lists processor/controller
   obligations; preserve the audit log (it is append-only and exported
   daily — do not "clean up").
3. Every action through `gcloud`/console is fine during an incident;
   reconcile terraform afterwards so drift does not linger.
