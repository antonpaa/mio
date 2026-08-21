# 0002. Modular monolith on PostgreSQL

- **Date:** 2026-08-21
- **Status:** Accepted

## Context

Target scale is 5,000–20,000 patients and fewer than 1,000 staff users. Realistic
peak concurrency is a few hundred users. Mio is therefore not a scale problem.

It *is* an access-control, auditability and correctness problem. The system must
prove who read which patient's data and when (see ADR-0007 and
`docs/architecture/data-model.md`), must never leak clinical data across
treatment team boundaries, and must keep alert delivery reliable because missed
alerts are a patient safety issue.

## Decision

A **modular monolith**: one codebase, two deployables (the API and an async
worker), one PostgreSQL database.

Modules — `identity`, `authz`, `patients`, `treatments`, `surveys`, `messaging`,
`alerts`, `tasks`, `notifications`, `audit`, `admin`, `reporting` — have
explicit public interfaces. Cross-module access goes through those interfaces
only, enforced by an architecture test in CI that fails the build on a boundary
violation.

PostgreSQL is the primary store for relational data, survey definitions and
responses (JSONB), full-text search, and the job queue (ADR-0008).

## Consequences

- One transaction boundary. An alert being raised, its audit record and its
  queued notification commit atomically. In a distributed design this is a
  saga, and every saga is a chance to lose a clinical signal.
- Audit and authorization are enforceable at a single choke point rather than
  reimplemented per service.
- Operations are small enough for a small team: one API, one worker, one
  database, one deployment pipeline.
- Module boundaries are enforced by convention plus a test, not by the network.
  Discipline is required; the CI check is what makes it stick.
- Horizontal scaling is limited to running more API instances against one
  database. At the stated scale this is ample; if it ever is not, the enforced
  module boundaries are the seams along which to split.

## Alternatives considered

**Microservices.** Rejected. Buys scale we do not need in exchange for
distributed transactions, cross-service audit correlation, and per-service
authorization — all of which are the exact things this system must get right.

**Serverless functions.** Rejected. Connection-pool pressure on PostgreSQL,
cold starts on interactive clinician workflows, and fragmented audit paths.

**Separate databases per module.** Rejected for v1 for the transactional
reasons above. Schema separation inside one database (ADR-0007) achieves the
isolation we actually need.
