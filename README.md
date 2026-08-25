# Mio

The end-to-end cancer patient treatment management system.

Mio provides two-way interaction between patients and hospital care teams, and
management of treatments, surveys and alerts. It ships in English, Finnish and
Swedish.

*Care, together — Hoitoa yhdessä — Vård, tillsammans*

## Status

**Built.** All 33 work packages from [`docs/phasing.md`](docs/phasing.md)
are implemented — patient and clinician apps, survey builder with rules
and body map, alert workflow, messaging, observations, admin plane,
auditor role, retention, GCP infrastructure — with the deliberate
deferrals recorded in
[`docs/design/README.md`](docs/design/README.md) and the items owned
outside the repository (DPIA, retention periods, Class B filing,
external security testing) tracked in the
[compliance register](docs/compliance/register.md). Architecture is
decided ([`docs/adr/`](docs/adr/)); the approved design canvases live in
`design/handoff-2026-08-21/`.

## Run it locally

```bash
pnpm install
pnpm dev:services   # Postgres 17 on :15432 + Mailpit (http://localhost:8025)
DATABASE_URL="postgres://mio:mio-local-only@localhost:15432/mio" pnpm migrate
```

Then seed the synthetic demo world **or** bootstrap your own first
administrator, and start the API, web app and worker — the full
walkthrough, including sign-in via Mailpit and every environment
variable, is in
[`docs/ops/local-development.md`](docs/ops/local-development.md).

## Documentation

Start at [`docs/README.md`](docs/README.md).

| | |
|---|---|
| [Architecture overview](docs/architecture/overview.md) | The system in one document |
| [Decisions](docs/adr/) | Why it is built this way |
| [Capability matrix](docs/authz/capability-matrix.yaml) | Who can do what — the source of truth |
| [Compliance register](docs/compliance/register.md) | Open regulatory and product questions |
| [Local development](docs/ops/local-development.md) | Run the whole system on your machine |
| [Runbooks](docs/ops/runbooks.md) | Operating it — deploys, restore, bootstrap, incidents |
| [Conventions](docs/conventions.md) | Branches, commits, pull requests |

## Stack

React, TypeScript, Node, NestJS, PostgreSQL, Cedar, Terraform

A modular monolith with one worker, on a cloud-agnostic container platform.
Target scale is 5,000–20,000 patients and fewer than 1,000 staff — Mio is not a
scale problem, it is an access-control and auditability problem.

## Contributing

Work happens on work-package branches cut from `main`, merged by reviewed pull
request. `main` is protected. See [`docs/conventions.md`](docs/conventions.md).
