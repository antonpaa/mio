# Mio — agent guide

Cancer treatment management system. **Read `docs/README.md` first** — the
architecture is decided and documented; do not re-litigate it in code.

## Commands

```bash
pnpm install               # workspace install (SessionStart hook does this on the web)
pnpm check                 # lint + format + typecheck + test + boundaries — run before pushing
pnpm lint / format / typecheck / test
pnpm boundaries            # dependency-cruiser architecture rules
python3 docs/authz/validate_matrix.py   # capability matrix invariants
pnpm dev:services          # Postgres 17 + Mailpit (http://localhost:8025)
pnpm migrate               # apply SQL migrations (DATABASE_URL, owner user)
pnpm --filter @mio/api dev     # API on :3000
pnpm --filter @mio/web dev     # SPA on :5173 (proxies /health, /api)
pnpm --filter @mio/worker dev  # worker
```

## Layout

```
apps/api      NestJS on Fastify — modular monolith; modules under src/modules/<name>/,
              imported ONLY via their index.ts (dependency-cruiser enforces this)
apps/web      Vite + React 19 + TanStack Router/Query; same-origin API
apps/worker   async jobs — pg-boss consumer over @mio/db
packages/     contracts · survey-schema · authz · i18n · ui · db — shared,
              source-first; never import from apps. @mio/db owns migrations
              (packages/db/migrations/*.sql, forward-only), role-carrying
              pools, the RLS user context and the job bus
docs/         ADRs, architecture, capability matrix, phasing, glossary
design/       approved canvases — the visual source of truth
```

## Hard rules

- Work = work packages from `docs/phasing.md` (WP-01…WP-33), one branch each
  (`docs/conventions.md`). Conventional commits; the message explains *why*.
- **Never** add a dependency casually — every one is SOUP (ADR-0009). Prefer
  the platform, prefer twenty lines.
- Access-rule changes and the capability matrix
  (`docs/authz/capability-matrix.yaml`) move in the same PR; CI runs the
  validator.
- Patient data never appears in logs, fixtures, tests or non-prod
  environments; synthetic data only (WP-05 generator).
- No clinical content in anything email-shaped; in-app is the content-bearing
  layer.
- Terminology comes from `docs/glossary.md`; new user-facing terms get a row
  there in the same PR.
- Every new patient-scoped read goes through the Cedar decision point with
  same-transaction audit (from WP-04/WP-10 on).
- Design deltas are reconciled in `docs/design/README.md` (X-items), not
  improvised in code.

## Standing definition of done

See the end of `docs/phasing.md` — matrix, migrations, integration tests
against real Postgres, axe-clean UI, EN strings + FI/SV keys, audit events,
synthetic data, docs updated.
