# Working conventions

## Branches

Work happens on **work-package branches cut from `main`**.

```
main
 ├── wp/01-authentication
 ├── wp/02-capability-matrix-enforcement
 └── wp/03-survey-versioning
```

- Branch from `main`, never from another work-package branch.
- One work package per branch, one pull request per branch.
- `main` is protected: no direct pushes, ever.
- Squash merge, so `main` carries one commit per work package.
- Delete the branch after merge.

Branches created by an agent session use that session's designated branch name
instead; the rules above otherwise apply unchanged.

## Commits

Conventional Commits.

```
feat(surveys): bind responses to survey version
fix(authz): scope roster query to active care relationships
docs(adr): record Cedar as sole authorization model
chore(deps): bump drizzle-orm to 0.36.1
```

Scope is the module name from
[`architecture/overview.md`](architecture/overview.md).

The commit message explains **why**. The diff already shows what.

## Pull requests

Every change reaches `main` by reviewed pull request. This is not only code
quality — it is the change-control evidence
[ADR-0009](adr/0009-iec-62304-shaped-development.md) requires: a traceable link
from a change to the reason it was made.

A pull request describes what changed, why, and what was verified.

Changes needing a second reviewer:

- anything in the `identity` module ([`architecture/authentication.md`](architecture/authentication.md))
- anything in `authz`, including `docs/authz/capability-matrix.yaml`
- alert rule evaluation
- database migrations touching `clinical.*` or `audit.*`

## Architecture decisions

Decisions that are expensive to reverse, cross module boundaries, or carry a
compliance consequence get an ADR in [`adr/`](adr/), using
[`adr/0000-template.md`](adr/0000-template.md).

ADRs are immutable once Accepted. Changing a decision means a new ADR that
supersedes the old one; the old one stays, marked superseded. See
[ADR-0001](adr/0001-record-architecture-decisions.md).

## Documentation

Documentation lives with the code and changes in the same pull request as the
behaviour it describes.

Specifically: a change to authorization updates
[`authz/capability-matrix.yaml`](authz/capability-matrix.yaml) in the same PR —
CI fails otherwise. A new open regulatory question goes into
[`compliance/register.md`](compliance/register.md) when it is noticed, not when
it becomes urgent. A new user-facing term goes into
[`glossary.md`](glossary.md) before it reaches a translator.

## Dependencies

Adding a dependency is a reviewed decision, not a reflex.

Every dependency is SOUP under IEC 62304 and must be inventoried with version,
purpose and justification. Prefer the platform, prefer a small module, prefer
writing twenty lines over adding a package that does forty things.

## Language

Code, identifiers, comments, commit messages, documentation and ADRs are in
English. User-facing strings are translated per
[`glossary.md`](glossary.md).
