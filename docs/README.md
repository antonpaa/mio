# Mio documentation

Mio is a web-based cancer treatment management system for hospital care teams
and their patients.

This is the foundational documentation set, written before implementation. It
records the decisions the system will be built on and the questions still open.

## Start here

| | |
|---|---|
| [`architecture/overview.md`](architecture/overview.md) | The system, in one document |
| [`adr/`](adr/) | Why it is built this way |
| [`authz/capability-matrix.yaml`](authz/capability-matrix.yaml) | Who can do what — the source of truth |
| [`compliance/register.md`](compliance/register.md) | What is still open, and who must answer it |

## Decisions

| ADR | Decision |
|---|---|
| [0001](adr/0001-record-architecture-decisions.md) | Record architecture decisions |
| [0002](adr/0002-modular-monolith-on-postgresql.md) | Modular monolith on PostgreSQL |
| [0003](adr/0003-typescript-node-backend.md) | TypeScript on Node for the backend |
| [0004](adr/0004-spa-frontend-with-openapi-contract.md) | SPA frontend with an OpenAPI contract |
| [0005](adr/0005-authentication-built-in-app.md) | Authentication built in-app |
| [0006](adr/0006-cedar-as-sole-authorization-model.md) | Cedar as the sole authorization model |
| [0007](adr/0007-separate-identity-from-clinical-data.md) | Separate identity from clinical data at the schema level |
| [0008](adr/0008-job-queue-in-postgresql.md) | Job queue in PostgreSQL |
| [0009](adr/0009-iec-62304-shaped-development.md) | IEC 62304-shaped development; MDR decided before go-live |
| [0010](adr/0010-cloud-agnostic-container-platform.md) | Cloud-agnostic container platform |

## Architecture

| Document | Covers |
|---|---|
| [overview](architecture/overview.md) | Shape, modules, stack, guarantees |
| [data-model](architecture/data-model.md) | Schemas, identity/clinical split, RLS, audit, retention |
| [authentication](architecture/authentication.md) | The in-app auth work package, specified |
| [authorization](architecture/authorization.md) | Cedar runtime, care relationships, Cedar/SQL split |
| [surveys-and-alerts](architecture/surveys-and-alerts.md) | Versioning, alert rules, body map |
| [scheduling](architecture/scheduling.md) | Phased recurrence, materialisation, time zones |
| [messaging-and-attachments](architecture/messaging-and-attachments.md) | Rich text, upload pipeline, serving |
| [platform](architecture/platform.md) | Environments, CI/CD, testing, observability, backups |

## Reference

| | |
|---|---|
| [`conventions.md`](conventions.md) | Branches, commits, pull requests, dependencies |
| [`glossary.md`](glossary.md) | EN / FI / SV vocabulary |
| [`authz/README.md`](authz/README.md) | How to read and change the capability matrix |

## The shape of the argument

Mio serves 5,000–20,000 patients and fewer than 1,000 staff. Peak concurrency is
a few hundred. **It is not a scale problem** — it is an access-control,
auditability and correctness problem, and nearly every decision here follows
from that.

Four properties are guaranteed structurally rather than by review discipline:

1. **Administrators cannot read clinical data** — the administration database
   role holds no grant on `clinical.*`.
2. **Every read of patient data is audited** — the authorization decision point
   *is* the audit point, in the same transaction.
3. **Email never contains clinical content** — the notification payload type has
   no access to clinical fields.
4. **Alerts are never lost** — alert, audit record and queued notification
   commit together.

## Status

Documentation only. No implementation yet, and phasing is not yet set — it will
follow the design package.

The highest-priority open item is
[R1: MDR classification](compliance/register.md) — it has external lead time and
should not be discovered late.
