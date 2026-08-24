# SOUP inventory (ADR-0009)

Every external **runtime** dependency, with why it earns its place. The
standing rule: prefer the platform, prefer twenty lines — a dependency
is admitted only when hand-rolling it would be a larger risk than
carrying it. Dev-time tooling (TypeScript, vitest, eslint, vite, SWC,
Playwright, testcontainers) is listed separately below: it never ships,
but it does shape the shipped artifact.

Versions are ranges from the workspace manifests; `pnpm-lock.yaml` pins
the exact resolution and is the authoritative record per release.
Regenerate the table's facts with the dependency listing in this
directory's README when manifests change — a row without a justification
is a finding, not a formality.

## Runtime dependencies

| Package | Version | Used by | Purpose | Justification / risk posture |
|---|---|---|---|---|
| `@cedar-policy/cedar-wasm` | ^4.12.0 | authz | Evaluates the generated Cedar policies | The decision engine itself. WASM sandbox, no I/O; policies and schema are generated from our matrix. Hand-rolling an authz evaluator is the larger risk |
| `@nestjs/common` / `core` / `platform-fastify` | ^11.2.1 | api | HTTP application framework | Module structure the architecture leans on (one module per domain, index-only imports). Large but mainstream, actively maintained |
| `fastify` | ^5.12.1 | api | HTTP server under Nest | Speed and a small plugin surface; we hand-roll headers/rate-limit/SPA rather than adopt its plugin ecosystem (WP-30) |
| `@node-rs/argon2` | ^2.1.0 | api, synthetic | Argon2id password hashing | The one thing never to hand-roll. Rust implementation of the winning PHC algorithm |
| `pg` | ^8.23.0 | api, worker, db, synthetic | PostgreSQL driver | The canonical Node driver; everything data touches it |
| `pg-boss` | ^12.27.0 | db | Job bus over Postgres (ADR-0008) | Chosen over a broker to keep ONE stateful system; SQL-visible queue state |
| `nodemailer` | ^9.0.5 | api, worker | SMTP delivery of contentless mail | SMTP is a protocol worth not reimplementing; the contentless mail types bound what can pass through it |
| `reflect-metadata` | ^0.2.2 | api | Decorator metadata for Nest DI | Required by Nest; no independent behaviour |
| `rxjs` | ^7.8.2 | api | Nest peer dependency | Unused directly; rides with Nest |
| `react` / `react-dom` | ^19.2.8 | web | UI runtime | The UI platform |
| `react-aria-components` | ^1.20.0 | ui | Accessible primitives (WP-03) | Accessibility semantics (focus, ARIA, keyboard) are expensive to get right and regulated by EN 301 549 (R7); this is Adobe's maintained implementation |
| `@tanstack/react-query` | ^5.102.1 | web | Server-state cache | Retry/invalidation/cache discipline that ad-hoc fetch code gets wrong |
| `@tanstack/react-router` | ^1.170.32 | web | Client routing | Typed routes; the auth gate lives in its lifecycle |
| `react-intl` | ^10.1.23 | web | EN/FI/SV message formatting | ICU plurals/dates for three locales — exactly its job |
| `yaml` | ^2.9.0 | authz | Parses the capability matrix | The matrix is YAML for reviewability; parsing YAML by hand is how injection bugs happen |

## Notable hand-rolled instead

Kept out of the dependency list deliberately, with tests standing in for
a maintainer: RRULE subset (`@mio/schedule`), survey engine and rule
evaluator (`@mio/survey-schema`), GCS client with service-account JWT
signing via `node:crypto` (`@mio/storage`), ClamAV clamd client, image
MIME sniffing, security headers / auth rate limit / SPA static serving
(WP-30), migrations runner, OTP + token issuance, i18n catalogs.

## Dev-time (does not ship)

TypeScript, SWC (+ `@swc-node/register`, runs the API/worker source in
the container — the one dev-tool that IS on the runtime path, pinned in
the lockfile and inside the image), vite, vitest, testing-library,
axe-core, eslint + prettier, dependency-cruiser, Playwright (screenshots
only), `@testcontainers/postgresql` (CI datastore).

## Standing obligations

- A new dependency needs a row here **in the same PR** (ADR-0009), a
  reason hand-rolling loses, and a look at its transitive surface.
- `pnpm audit` runs in CI; a finding in a runtime row above is a release
  blocker until assessed.
- Version bumps are ordinary PRs; the lockfile diff is the review
  surface.
