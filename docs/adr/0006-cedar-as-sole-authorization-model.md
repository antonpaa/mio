# 0006. Cedar as the sole authorization model

- **Date:** 2026-08-21
- **Status:** Accepted

## Context

Mio has four user levels — Patient, Treatment Member, Treatment Lead,
Administrator — but role alone never determines access. What matters is the
relationship: which treatment team a clinician belongs to, whether a care
relationship with a patient exists, whether a treatment is active.

Two requirements shape this decision beyond ordinary access control:

1. Administrators must have **no access to clinical data**, while retaining full
   account administration.
2. Patients must be able to ask **who accessed their records**, and get a
   complete and truthful answer.

## Decision

**Cedar, embedded in the API process, is the only authorization model in the
system.**

- Policies live in the repository, are reviewed as code, and are tested.
- No other component holds roles, groups or permissions. In particular, if an
  external identity provider is ever introduced (superseding ADR-0005), it
  issues *identity only* — never authorization claims. Splitting the capability
  model across two systems produces two half-truths and no way to answer "what
  can this user do?"
- The **capability matrix** at `docs/authz/capability-matrix.yaml` is the single
  source of truth. It generates the Cedar policy test suite, the UI capability
  flags, and the human-readable matrix for the compliance pack.
- **The Cedar decision point is the audit point.** Every authorization decision
  on a patient-scoped resource writes its audit record in the same database
  transaction as the access it permits. Audit is therefore not something a
  developer can forget to call.
- **Cedar decides; SQL scopes.** Cedar answers per-resource questions. It does
  not filter result sets, so list and search endpoints scope in SQL via a
  materialised `care_relationship` table. Both are generated from the same
  capability matrix so they cannot disagree.
- PostgreSQL row-level security sits underneath as defence in depth
  (ADR-0007).

## Consequences

- One place to answer "who can do what", in a language designed to be analysed
  rather than a scattering of `if` statements.
- The generated role × action × resource test suite is exhaustive by
  construction — the highest-value tests in the system.
- Access decisions and the audit trail cannot diverge, because they are the same
  transaction.
- Two enforcement mechanisms (Cedar for resources, SQL for lists) must be kept
  consistent. Generating both from the capability matrix is what makes this
  safe; hand-writing either would not be.
- Cedar needs entity data to evaluate against, so authorization requires loading
  the relevant entities. Hot paths need care to avoid per-request entity fan-out.
- Cedar is a Rust library with JavaScript bindings — an additional SOUP entry
  with its own upgrade obligations.

## Alternatives considered

**OpenFGA / SpiceDB (ReBAC).** A good fit for the relationship-heavy parts, but
Cedar was specified in the product brief, expresses these relationships
adequately through entity hierarchies, and embeds in-process without another
service to run.

**Roles and permissions in application code.** Rejected: unanalysable,
untestable exhaustively, and impossible to present as a compliance artifact.

**AWS Verified Permissions** (managed Cedar). Rejected: Mio will not run on AWS,
and the open-source Cedar library has no such constraint.
