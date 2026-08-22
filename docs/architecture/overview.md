# Mio — architecture overview

Mio is a web-based cancer treatment management system providing two-way
interaction between patients and hospital care teams, and management of
treatments, surveys and alerts.

This document is the entry point. Decisions are recorded in [`../adr/`](../adr/);
this describes the system those decisions produced.

## Sizing

| | |
|---|---|
| Patients | 5,000–20,000 |
| Staff users | < 1,000 |
| Realistic peak concurrency | a few hundred |
| Languages | English, Finnish, Swedish |
| Integrations in v1 | none — Mio is standalone |

**Mio is not a scale problem.** It is an access-control, auditability and
correctness problem. Nearly every decision in this architecture follows from
that sentence.

## Shape

```
                    ┌──────────────────────────────┐
   patient (phone)  │                              │
   clinician (desk) │   SPA — React, static assets │
                    │                              │
                    └──────────────┬───────────────┘
                                   │  same origin, httpOnly session cookie
                    ┌──────────────▼───────────────┐
                    │   API — modular monolith     │
                    │                              │
                    │   Cedar decision point       │──── audit written in the
                    │   ↓ same transaction         │     same transaction
                    └──────┬───────────────┬───────┘
                           │               │
              ┌────────────▼───┐   ┌───────▼────────┐
              │  PostgreSQL    │   │ Object storage │
              │                │   │  attachments   │
              │  identity.*    │   │  CMEK, separate│
              │  clinical.*    │   │  serving origin│
              │  audit.*       │   └────────────────┘
              │  job queue     │
              └────────▲───────┘
                       │
              ┌────────┴───────┐
              │   Worker       │  email · reminders · escalation
              │                │  recurrence materialisation
              │                │  virus scan · GDPR export · audit archival
              └────────────────┘
```

Two deployables, one codebase, one database ([ADR-0002](../adr/0002-modular-monolith-on-postgresql.md)).

## Modules

| Module | Responsibility |
|---|---|
| `identity` | Accounts, credentials, sessions, MFA, account lifecycle |
| `authz` | Cedar policy evaluation, care relationships, capability matrix |
| `patients` | Patient records, roster, profile aggregation |
| `observations` | Value series and symptom observations ([ADR-0011](../adr/0011-absorb-design-package-scope.md)) |
| `treatments` | Treatments, templates, teams, activities, lifecycle |
| `surveys` | Builder, versioning, assignment, responses; the rule engine (conditions → alert / notification / task outcomes) |
| `messaging` | Threads, messages, internal notes, attachments |
| `alerts` | Alert raising, triage workflow, assignment, resolution |
| `tasks` | Clinician tasks — claim, assign, complete |
| `notifications` | In-app notification centre, email dispatch |
| `audit` | Access and change logging, patient-facing access history |
| `admin` | Account and team administration — **no clinical access** |
| `reporting` | Response rates, open alerts per programme |

Modules expose explicit public interfaces. Cross-module access goes through
those interfaces only, enforced by an architecture test in CI. The boundaries
are the seams along which the system could be split later if it ever needed to
be — which, at this scale, it will not.

## Stack

| Layer | Choice | ADR |
|---|---|---|
| Frontend | React 19, TypeScript strict, Vite, TanStack Router + Query | [0004](../adr/0004-spa-frontend-with-openapi-contract.md) |
| A11y primitives | React Aria Components | [0004](../adr/0004-spa-frontend-with-openapi-contract.md) |
| Styling | Tailwind v4 with `@theme` design tokens | [0004](../adr/0004-spa-frontend-with-openapi-contract.md) |
| UI i18n | react-intl (ICU MessageFormat) | [0004](../adr/0004-spa-frontend-with-openapi-contract.md) |
| API contract | OpenAPI-first, generated TS client | [0004](../adr/0004-spa-frontend-with-openapi-contract.md) |
| Backend | Node 22 LTS, NestJS on Fastify | [0003](../adr/0003-typescript-node-backend.md) |
| Data access | Drizzle + node-postgres, plain SQL migrations | [0003](../adr/0003-typescript-node-backend.md) |
| Database | PostgreSQL 17, managed | [0002](../adr/0002-modular-monolith-on-postgresql.md) |
| Queue | PostgreSQL via pg-boss | [0008](../adr/0008-job-queue-in-postgresql.md) |
| Authentication | Built in-app | [0005](../adr/0005-authentication-built-in-app.md) |
| Authorization | Cedar, embedded | [0006](../adr/0006-cedar-as-sole-authorization-model.md) |
| Platform | Containers on Container Apps / Cloud Run | [0010](../adr/0010-cloud-agnostic-container-platform.md) |
| IaC | Terraform | [0010](../adr/0010-cloud-agnostic-container-platform.md) |
| Observability | OpenTelemetry → OTLP | [0010](../adr/0010-cloud-agnostic-container-platform.md) |

## Four properties the architecture guarantees structurally

These are the design's load-bearing claims. Each is enforced by construction
rather than by review discipline.

**1. Administrators cannot read clinical data.** The administration code path
connects to PostgreSQL with a role holding no grant on `clinical.*`. Violating
this raises a database permission error
([ADR-0007](../adr/0007-separate-identity-from-clinical-data.md)).

**2. Every read of patient data is audited.** The Cedar decision point *is* the
audit point: an authorization decision on a patient-scoped resource writes its
audit record in the same transaction as the access it permits. A developer
cannot forget to call it, because there is no path around it
([ADR-0006](../adr/0006-cedar-as-sole-authorization-model.md)).

**3. Email never contains clinical content.** The notification API's payload
type is `{ recipient, notificationType, deepLink }` and nothing more. The email
templating layer has no type-level access to clinical fields, so a violation is
a compile error rather than a review catch. (In-app notifications are the
content-bearing layer and are access-controlled as clinical reads — see
[`messaging-and-attachments.md`](messaging-and-attachments.md).)

**4. Alerts are never lost.** The alert record, its audit entry and its queued
notification commit in one transaction, because the queue lives in the same
database ([ADR-0008](../adr/0008-job-queue-in-postgresql.md)).

## Subsystems with their own documents

| Document | Covers |
|---|---|
| [`data-model.md`](data-model.md) | Schema layout, identity/clinical split, RLS, audit |
| [`authentication.md`](authentication.md) | The in-app auth work package, in full |
| [`authorization.md`](authorization.md) | Cedar entities, actions, the Cedar/SQL split |
| [`surveys-and-alerts.md`](surveys-and-alerts.md) | Versioning, the rule model, the body map |
| [`scheduling.md`](scheduling.md) | Phased recurrence, materialisation, time zones |
| [`messaging-and-attachments.md`](messaging-and-attachments.md) | Rich text, upload pipeline, serving |
| [`platform.md`](platform.md) | Environments, CI/CD, observability, backups, testing |
| [`observations.md`](observations.md) | Values, the symptom taxonomy, program-specific interpretation |

## Design

The approved design package (warm-editorial design language, all ~56 screens)
lives in `design/handoff-2026-08-21/` and is analyzed in
[`../design/README.md`](../design/README.md); tokens and component rules in
[`../design/design-system.md`](../design/design-system.md), and the
screen-to-module map in
[`../design/screen-inventory.md`](../design/screen-inventory.md). The
application ships as three shells — patient, clinician, administration — the
administration shell being served by the no-clinical-grant path (ADR-0007).

## Deliberate non-goals for v1

- No microservices, no Kubernetes, no message broker, no GraphQL.
- No external identity provider, no caregiver/proxy access (v2 per the brief).
- No integrations — no Kanta, no EHR, no HL7/FHIR interface. The data model
  keeps optional coded fields (see `surveys-and-alerts.md`) so this stays cheap
  to add, but nothing in v1 depends on it.
- No real-time transport beyond server-sent events for the notification bell.
  Polling with TanStack Query covers the rest.
