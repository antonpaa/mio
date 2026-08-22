# Data model

A sketch, not a schema. It fixes the boundaries that are expensive to change and
leaves table detail to implementation.

See [ADR-0007](../adr/0007-separate-identity-from-clinical-data.md) for the
rationale behind the split described here.

## Three schemas, three roles

```
identity.*     direct identifiers, credentials, sessions, account lifecycle
clinical.*     treatments, surveys, responses, alerts, messages, tasks
audit.*        append-only access and change log
```

| Connection role | `identity` | `clinical` | `audit` |
|---|---|---|---|
| `mio_app` | SELECT/INSERT/UPDATE | SELECT/INSERT/UPDATE | INSERT only |
| `mio_admin` | SELECT/INSERT/UPDATE | **no grant** | INSERT only |
| `mio_worker` | SELECT (minimal) | SELECT/INSERT/UPDATE | INSERT only |
| `mio_audit_reader` | no grant | no grant | SELECT |

The administration code path uses `mio_admin`. That is what makes
"Administrators have no access to clinical data" a database permission error
rather than a policy someone must remember.

No role anywhere holds UPDATE or DELETE on `audit.*`.

## The pseudonymous join

`clinical.*` tables reference `patient_id` and **never** duplicate a direct
identifier — no name, no date of birth, no national identity number, no email,
no address in any clinical table.

```
identity.patient_account          clinical.treatment_enrolment
├─ id            (patient_id) ────────► patient_id
├─ email                          ├─ treatment_id
├─ given_name                     ├─ enrolled_at
├─ family_name                    └─ status
├─ national_id_number (encrypted)
├─ address, phone
├─ locale, timezone
├─ preferences
└─ status
```

Assembling a patient-facing screen therefore reads from two schemas and joins in
the application. That cost is paid on nearly every screen and is accepted
deliberately.

> **Free-text caveat.** Clinical free text — messages, internal notes, survey
> free-text answers — can contain identifiers that a clinician typed. The split
> is a strong structural control over *columns*, not a guarantee about
> *content*. Free text is treated as clinical data everywhere, is never exposed
> to the administration path, and is excluded from any aggregate reporting.

## Core entities

### Identity

```
identity.patient_account       identity.staff_account
identity.patient_session       identity.staff_session
identity.credential_token      (invites, resets, OTP — all hashed)
identity.terms_acceptance      (which version, when, by whom)
```

Two account tables, not one with a discriminator column
([ADR-0005](../adr/0005-authentication-built-in-app.md)). A CI test asserts no
query joins across them.

### Clinical

```
clinical.treatment                 draft │ active │ paused │ completed │ discontinued
clinical.treatment_template        ──► template_version (draft │ published │ archived)
clinical.treatment_team            ──► team_membership (member │ lead)
clinical.treatment_enrolment       patient ↔ treatment
clinical.activity                  scheduled activity within a treatment
clinical.task                      clinician-side work item
clinical.care_relationship         materialised; drives SQL scoping

clinical.survey                    ──► survey_version ──► locale_variant
clinical.survey_assignment         many-to-many with treatment
clinical.survey_response           binds to survey_version_id + locale
clinical.alert_rule                versioned with the survey_version
clinical.alert                     new │ acknowledged │ resolved
clinical.alert_evaluation_trace    why this alert fired

clinical.message_thread            per treatment programme
clinical.message                   structured document, not HTML
clinical.internal_note             never visible to patients
clinical.attachment                metadata; bytes live in object storage

clinical.value_series              named, unit-bearing measurement track
clinical.value_entry               provenance-carrying entries over time
clinical.symptom                   taxonomy (FI-canonical, growing, coded)
clinical.symptom_observation       severity + detail + source + provenance
```

Values and symptoms are the `observations` module
([`observations.md`](observations.md), ADR-0011). Observations store facts;
whether a fact is alarming is decided per treatment program by the rule
engine, never stored on the observation.

### Audit

```
audit.access_event      who read what, when, under which policy decision
audit.change_event      who changed what, before/after
audit.auth_event        login, MFA, reset, session lifecycle
```

## Provenance

Any clinical record a clinician entered on a patient's behalf carries
provenance — who, when, and on whose behalf — and the UI renders it explicitly
("entered by X on behalf of patient"). This applies to survey responses in
particular. Provenance is columns on the record, not an audit-log lookup,
because it is clinically meaningful information rather than a security trail.

## Row-level security

RLS is enabled on `clinical.*` as defence in depth beneath Cedar. Policies read
a transaction-scoped setting:

```sql
SET LOCAL app.current_user_id = '...';
SET LOCAL app.current_user_realm = 'staff';
```

`SET LOCAL` is correct under PgBouncer transaction pooling. Session pooling is
**not** safe here; deployment configuration must enforce transaction mode.

RLS is a backstop. Cedar remains the primary decision point
([ADR-0006](../adr/0006-cedar-as-sole-authorization-model.md)); RLS exists so
that a missing application check still meets a wall.

## Audit

Every authorization decision on a patient-scoped resource writes an
`audit.access_event` in the same transaction as the access it permits. HTTP-layer
auditing would miss internal reads; hand-placed audit calls get forgotten. This
is why audit is bound to the Cedar decision point rather than to a controller.

Audit records reference resource identifiers and never embed clinical content.
This keeps the audit log useful to a patient asking who accessed their records
without turning the log itself into a second copy of the record. The
administrator-facing audit view (A3) renders subjects minimised to initials
and event text generic — event type plus resource reference, no clinical
fragments (reconciliation X4 in [`../design/README.md`](../design/README.md)).

Records are exported periodically to immutable object storage — blob
immutability policy or bucket lock — so retention survives database compromise.

**Patients can read their own access history.** This is a first-class product
feature, not an internal tool; Finnish patients expect to be able to ask.

> **Open question.** Who may read the audit log in full? Administrators need
> some access for operational purposes, but audit records reveal that patient X
> has a treatment — metadata that is itself sensitive. A dedicated auditor/DPO
> role may be warranted. Tracked in
> [`../compliance/register.md`](../compliance/register.md).

## Retention and offboarding

Kept simple, per the brief.

| | |
|---|---|
| Completed treatments | Archived, retained, read-only |
| Deactivated accounts | Credentials void, sessions revoked, data retained |
| Deceased patients | Retained as long as legally required, handled respectfully |
| Audit records | Retained per statutory minimum, exported to immutable storage |
| Attachments | Retained with their treatment |

Statutory retention periods for Finland and Sweden are an open item in the
compliance register. The model supports per-record retention classification;
the periods themselves are a legal input, not a technical one.

## GDPR access and portability

"Download my data" is available in settings for patients and staff. It runs as
a worker job, assembles identity and clinical data for the subject, and is
itself audited. The export is machine-readable and includes the subject's
access history.

Clinicians can also prepare an export of a patient's data from the profile
(PP5) — scope selection, PDF or machine-readable — **with a recorded reason**;
the audit entry carries who requested it and why. This is the
`patient_data_export` capability, care-relationship scoped.

## Non-production data

**Production data never appears in a non-production environment.** Staging and
development run on a synthetic data generator producing realistic Finnish and
Swedish names, treatments, surveys and response histories.

This is a real work package, and it is worth building early: it unblocks
demonstrations, testing and design review, all of which otherwise pull toward
using real data.
