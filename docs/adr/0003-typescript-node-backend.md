# 0003. TypeScript on Node for the backend

- **Date:** 2026-08-21
- **Status:** Accepted

## Context

The frontend is React/TypeScript regardless of backend choice (ADR-0004).

The decisive project-specific factor is the **survey engine**. A survey
definition drives both a dynamic form renderer in the browser and authoritative
validation on the server. Client-side validation exists for user experience;
server-side validation exists because the client cannot be trusted. If the two
are written in different languages they are two implementations of one
specification, and they will drift. In this system drift means a patient's
response is accepted by one side and rejected — or silently reinterpreted — by
the other.

Alert rule evaluation (`docs/architecture/surveys-and-alerts.md`) has the same
shape: the survey builder must preview what the server will compute.

## Decision

**Node 22 LTS with TypeScript in `strict` mode.**

- **NestJS on the Fastify adapter** — its module system and dependency injection
  give the modular monolith (ADR-0002) structure that is enforced rather than
  encouraged, and make authorization and audit interception clean to wire.
- **Drizzle with `node-postgres`** for data access. SQL-first, so it composes
  with row-level security and per-transaction session variables
  (`docs/architecture/data-model.md`) rather than fighting them.
- **Plain versioned SQL migration files**, forward-only, reviewed as code.
  Generated migrations are a liability when the migration itself is a
  compliance-relevant change.
- Survey schema and validators live in a shared package consumed by both the
  API and the web client.

Dependencies are kept deliberately few. Under IEC 62304 (ADR-0009) every
third-party library is SOUP that must be inventoried, justified and monitored.

## Consequences

- One language, one type system, one set of survey validators. The
  client/server drift class of bug is eliminated by construction rather than by
  testing.
- Full-stack contributors can work across the whole system.
- Node's weakness on CPU-bound work is real but confined to report generation
  and document rendering; those run in the worker, not the request path.
- Runtime type safety at the system edges is not free — every external input is
  parsed through a schema (Zod) at the boundary. This is a standing convention,
  not an optional practice.
- The npm ecosystem's dependency sprawl works against a small SOUP inventory.
  Adding a dependency is a reviewed decision, not a reflex.

## Alternatives considered

**.NET 9 + EF Core.** Genuinely strong here: better suited to a rich long-lived
domain model, more batteries-included so fewer SOUP entries, and well staffed in
the Nordics. Lost on the survey-schema sharing argument, which would require
generating JSON Schema from C# types and keeping two validators aligned. This
remains the most credible alternative if team composition changes.

**Java/Kotlin + Spring Boot.** Equivalent long-term footing to .NET and common
in Nordic hospital IT, but no advantage over it for this system, and the same
split-language cost.

**Python/FastAPI.** Fast to build and strong for the analytics side, but opt-in
typing is a poor fit for a large regulated domain model maintained over years.
