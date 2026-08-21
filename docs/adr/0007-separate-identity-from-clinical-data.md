# 0007. Separate identity from clinical data at the schema level

- **Date:** 2026-08-21
- **Status:** Accepted

## Context

The brief states that Administrators should have no access to clinical data
while remaining able to create accounts, deactivate them and perform credential
resets. Enforcing that only in application code makes it a convention: one
missing check, or one developer adding a convenient join, quietly breaks it.

Separately, GDPR data-minimisation and Finnish and Swedish patient data
legislation all favour keeping direct identifiers separable from clinical
content.

This is the single decision in the Mio architecture that is genuinely painful to
retrofit. Splitting identity out of a populated clinical schema later means
rewriting every query in the system.

## Decision

Direct identifiers and clinical data live in **separate PostgreSQL schemas in
the same database, with separate database roles.**

- `identity.*` — name, date of birth, any national identity number, address,
  email, phone, credentials, sessions, account status.
- `clinical.*` — treatments, activities, surveys, responses, alerts, messages,
  tasks. Clinical rows reference a pseudonymous `patient_id` and **never**
  duplicate a direct identifier.
- `audit.*` — append-only, INSERT-only grant (ADR-0002 and
  `docs/architecture/data-model.md`).

The administration code path connects with a role that has **no grant on
`clinical.*` at all**. "Administrators cannot read clinical data" is then a
database permission error, not a policy that must hold.

**Row-level security** is enabled on clinical tables as defence in depth beneath
Cedar (ADR-0006), driven by a transaction-scoped `SET LOCAL app.current_user_id`.

## Consequences

- The strongest requirement in the brief becomes structurally true rather than
  reviewed-for.
- Defence in depth: an authorization bug in application code still meets a
  database-level barrier.
- Assembling a patient's full view requires reading from two schemas and joining
  in the application. This is a real, ongoing ergonomic cost, paid on every
  patient-facing screen. It is accepted.
- Reporting that needs both identifiers and clinical data must be explicitly
  designed and explicitly authorized, rather than falling out of an ad-hoc join.
- Connection pooling must preserve transaction-scoped settings. With PgBouncer
  this requires transaction pooling mode; `SET LOCAL` inside the transaction is
  correct under it. This constraint must be respected in deployment
  configuration.
- Two connection pools with different roles are required, adding some
  operational surface.

## Alternatives considered

**One schema, access controlled in application code.** Rejected: makes the
brief's clearest requirement a convention.

**Separate databases for identity and clinical data.** Rejected for v1: loses
the single transaction boundary that ADR-0002 depends on, for isolation only
marginally stronger than separate schemas with separate roles.

**Application-level column encryption of clinical free text.** Rejected for v1:
breaks search and reporting, and adds key management burden without addressing
the actual threat model, which is over-broad *authorized* access rather than
storage compromise. Storage is covered by cloud-managed keys (ADR-0010).
