# 0001. Record architecture decisions

- **Date:** 2026-08-21
- **Status:** Accepted

## Context

Mio is a clinical system handling patient data under GDPR and Finnish/Swedish
national healthcare regulation, and it may fall in scope of EU MDR 2017/745
(see ADR-0009). In all three regimes, the *rationale* behind a technical
decision is an artifact auditors and regulators ask for — not just the code.

The project also expects to run for years with changing contributors. Decisions
whose reasoning is lost get re-litigated or, worse, silently reversed.

## Decision

We record architecturally significant decisions as Architecture Decision
Records in `docs/adr/`, in MADR-style format, using `docs/adr/0000-template.md`.

- ADRs are numbered sequentially and never renumbered.
- ADRs are immutable once Accepted. A decision that changes gets a *new* ADR
  that supersedes the old one; the old one is marked
  `Superseded by ADR-NNNN` and stays in the repository.
- "Architecturally significant" means: it is expensive to reverse, it affects
  more than one module, or it has a compliance consequence.

## Consequences

- Regulatory evidence for design rationale is a by-product of normal work
  rather than a documentation project before an audit.
- Every significant PR carries a small documentation obligation.
- The ADR log is append-only, so it grows and includes decisions no longer in
  force. That is intentional: superseded ADRs record why we changed our mind.

## Alternatives considered

**A wiki or Confluence space.** Rejected: it drifts from the code, is not
reviewable in a PR, and is not versioned alongside the change it describes.

**No formal record.** Rejected: does not survive contact with an audit or with
contributor turnover.
