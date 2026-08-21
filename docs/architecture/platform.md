# Platform, delivery and testing

Infrastructure decisions are recorded in
[ADR-0010](../adr/0010-cloud-agnostic-container-platform.md).

## Environments

| Environment | Purpose | Data |
|---|---|---|
| `dev` | Integration of merged work | Synthetic |
| `staging` | Release validation, demos, design review | Synthetic |
| `prod` | Live | Real |

**Production data never appears in a non-production environment.** Not for
debugging, not for a demo, not temporarily.

That rule only holds if the alternative is good enough, so the synthetic data
generator is a real work package: realistic Finnish and Swedish names,
plausible treatments, survey histories with trends, message threads, alerts at
each severity. Built early, because every pressure toward using real data —
demos, testing, design review — arrives early.

It also produces the 20,000-patient dataset the authorization hot paths need to
be measured against ([`authorization.md`](authorization.md)).

## Deployment

Containers on Azure Container Apps or GCP Cloud Run, provisioned by Terraform,
split into cloud-agnostic application configuration and a thin cloud-specific
layer.

Two images from one repository: the API and the worker.

Migrations are forward-only, reviewed as code, and run as a gated step before
the new image is promoted. A migration that cannot roll forward safely is a
design problem to solve before merge, not during a deploy.

## CI/CD

On every pull request:

```
lint · typecheck · unit tests · integration tests (Testcontainers)
capability matrix validation · architecture boundary test
e2e (Playwright) · axe-core accessibility · dependency + secret scanning
```

`main` is protected. No direct pushes. Every change arrives by reviewed pull
request from a work-package branch ([`../conventions.md`](../conventions.md)),
which is also the change-control evidence
[ADR-0009](../adr/0009-iec-62304-shaped-development.md) requires.

## Testing

| Layer | Approach |
|---|---|
| Unit | Domain logic, rule evaluation, recurrence expansion |
| Integration | Against real PostgreSQL via Testcontainers — RLS and grants are the thing under test, and neither exists in a mock |
| Authorization | Generated from the capability matrix: 288 role × action grants asserted |
| E2E | Playwright over the core patient and clinician journeys |
| Accessibility | axe-core in CI, plus manual keyboard and screen-reader passes |

The generated authorization suite is the highest-value testing in this system.
It is exhaustive by construction, so a policy change that quietly widens access
fails a test rather than reaching review.

Automated accessibility tooling catches perhaps 40% of WCAG issues. The rest
requires manual passes on each core flow — with specific attention to the body
map ([`surveys-and-alerts.md`](surveys-and-alerts.md)) and the recurrence editor
([`scheduling.md`](scheduling.md)), the two components most likely to fail.

## Observability

OpenTelemetry with OTLP export, so the backend is configuration rather than code.

**No patient data in logs, traces or metrics — ever.** Structured logging with a
field allowlist rather than a redaction denylist: an allowlist fails closed when
someone adds a field, a denylist fails open. Enforced by lint rule and test.

Error reporting is subject to the same rule. Stack traces and request context are
scrubbed before leaving the system, and any third-party error service must be
assessed against it before adoption.

What is worth alerting on: undelivered alert notifications, stuck jobs, failed
virus scans, authentication anomaly rates, and audit export failures.

## Backups and continuity

- Point-in-time recovery on the managed database.
- Object storage versioning and soft delete.
- Audit records exported to immutable storage — blob immutability policy or
  bucket lock — so retention survives a database compromise.
- **Restores are rehearsed on a schedule.** Auditors ask for evidence of the
  rehearsal, not the policy, and an untested backup is a belief rather than a
  control.

RPO and RTO targets are an open item in
[`../compliance/register.md`](../compliance/register.md); they are a business
input, not a technical one.

## Security practice

- Threat model (STRIDE) before build, revisited per major subsystem.
- Dependency scanning, secret scanning and SAST in CI.
- A SOUP inventory: every dependency with version, purpose and justification
  ([ADR-0009](../adr/0009-iec-62304-shaped-development.md)). Also the standing
  reason to keep dependency count low.
- Penetration test before go-live, with authentication
  ([`authentication.md`](authentication.md)) and the attachment pipeline
  ([`messaging-and-attachments.md`](messaging-and-attachments.md)) as named
  targets.
- Portability is a claim until exercised: stand up a throwaway environment on
  the non-chosen cloud once, before the cloud decision is final.
