# Authorization — capability matrix

[`capability-matrix.yaml`](capability-matrix.yaml) is the single source of truth
for who can do what in Mio ([ADR-0006](../adr/0006-cedar-as-sole-authorization-model.md)).

It is a **compliance artifact**. Changes to it are reviewed and audited.

## What it generates

```
                     capability-matrix.yaml
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  Cedar policy          UI capability        Human-readable
  test suite            flags                matrix for the
  (324 assertions)      (web client)         compliance pack
```

Cedar policies themselves are hand-written and reviewed — a policy language is
worth having precisely because humans read it. What is generated is the
*exhaustive test suite* proving those policies match the agreed matrix. Editing a
policy without editing the matrix fails CI, and vice versa.

## Validating

```
python3 docs/authz/validate_matrix.py
```

Checks the six invariants the matrix declares. This runs in CI. When the
application codebase exists, this logic moves into the Cedar test generator and
the standalone script is retired.

## Reading a row

```yaml
- id: patient_clinical_profile
  schema: clinical
  patient_scoped: true
  actions:
    - id: view
      audit: always
      grants:
        patient: self
        treatment_member: care_relationship
        treatment_lead: care_relationship
        administrator: deny
```

A grant is never simply "yes" — it is the **condition** under which the action
is permitted. `care_relationship` means the clinician is on a team treating that
patient, not merely that they hold a clinical role.

`audit: always` means an authorization decision on this action writes an
`audit.access_event` in the same transaction as the access it permits. `schema`
determines which database role can reach it at all. `patient_scoped` marks
resources that concern a specific patient, as distinct from catalogue content.

## Two enforcement paths

**Cedar decides. SQL scopes.**

Cedar answers per-resource questions: may this principal view *this* response?
It does not filter result sets. List and search endpoints scope in SQL using the
materialised `clinical.care_relationship` table.

Both are generated from this file, which is what keeps them consistent.
Hand-writing either would not be safe — divergence between "can I open it" and
"does it appear in my list" is the classic policy-engine failure, and it fails
in the direction of disclosure.

## Invariants

| Invariant | Guards against |
|---|---|
| `exhaustive` | Silent defaults. Every triple is explicit; a missing grant fails the build. |
| `superset_lead_member` | An edit accidentally narrowing a lead's access below a member's. |
| `administrator_no_clinical` | The brief's clearest requirement eroding over time. |
| `patient_self_only` | Any path by which a patient could reach another patient's data. |
| `internal_notes_never_patient` | The single worst disclosure this system could make. |
| `patient_scoped_reads_are_audited` | An unaudited read path, which would make access history a lie. |

`administrator_no_clinical` is deliberately redundant: the database grant in
[ADR-0007](../adr/0007-separate-identity-from-clinical-data.md) enforces it
independently. Two mechanisms, because one is a policy and the other is physics.

## Open questions

Five product decisions are recorded at the bottom of the matrix under
`open_questions`, and mirrored in
[`../compliance/register.md`](../compliance/register.md). They are open in the
file rather than resolved by an engineering guess. Two are worth flagging as
needing a clinical rather than technical answer:

- whether patients should see that an alert was raised from their responses
- whether emergency access outside a care relationship (break-glass) is required
