# Mio

The end-to-end cancer patient treatment management system.

Mio provides two-way interaction between patients and hospital care teams, and
management of treatments, surveys and alerts. It ships in English, Finnish and
Swedish.

*Care, together · Hoitoa yhdessä · Vård, tillsammans*

## Status

**Documentation phase.** No implementation yet.

The architecture is decided and recorded; the design package and delivery
phasing are in progress.

## Documentation

Start at [`docs/README.md`](docs/README.md).

| | |
|---|---|
| [Architecture overview](docs/architecture/overview.md) | The system in one document |
| [Decisions](docs/adr/) | Why it is built this way |
| [Capability matrix](docs/authz/capability-matrix.yaml) | Who can do what — the source of truth |
| [Compliance register](docs/compliance/register.md) | Open regulatory and product questions |
| [Conventions](docs/conventions.md) | Branches, commits, pull requests |

## Stack

React · TypeScript · Node · NestJS · PostgreSQL · Cedar · Terraform

A modular monolith with one worker, on a cloud-agnostic container platform.
Target scale is 5,000–20,000 patients and fewer than 1,000 staff — Mio is not a
scale problem, it is an access-control and auditability problem.

## Contributing

Work happens on work-package branches cut from `main`, merged by reviewed pull
request. `main` is protected. See [`docs/conventions.md`](docs/conventions.md).
