# DPIA support material (R4)

Engineering input for the data protection impact assessment. This is
**support material for the DPO who owns the DPIA** (register item R4) —
it maps what the system actually does to the questions Article 35 asks,
with pointers into the architecture docs and the code that enforces each
claim. It is not the DPIA, and it does not decide lawful basis or
controller/processor allocation; those stay with R4's owner.

## Processing at a glance

| | |
|---|---|
| Purpose | Remote symptom follow-up during cancer treatment: surveys, values, symptoms, messaging between patient and care team, alerting on concerning answers |
| Subjects | Patients under treatment; staff users (clinicians, administrators) |
| Special categories | Health data (Art. 9) throughout `clinical.*` — the system exists for it |
| Scale | Designed for clinic-scale cohorts; synthetic baseline tested at 20k patients |
| Location | EU regions only (`europe-north1`); no third-country transfer in the architecture |

## Data categories and where they live

One PostgreSQL cluster, three schemas with different rules
([data-model](../architecture/data-model.md)):

- **`identity`** — accounts, sessions, teams. Names, emails, phones,
  addresses, dates of birth. No clinical content.
- **`clinical`** — treatments, survey responses, observed values and
  symptoms, messages, attachments, alerts, notifications. All
  patient-scoped rows carry `patient_id` and sit behind row-level
  security.
- **`audit`** — access, change and auth events. Append-only for every
  role including the owner; carries references and decisions, never
  clinical content (verified at the write sites; the A3 admin view and
  the patient's own access history are both rendered from these rows).

Email is a **contentless channel** by type-level construction: every
mail shape can carry a kind, a code or a deep link, and no field exists
for clinical content ([messaging](../architecture/messaging-and-attachments.md)).

## Access control — technical measures

- Two authentication realms (patient, staff) with separate session
  tables; passwords (Argon2id) plus an emailed one-time code on every
  sign-in ([authentication](../architecture/authentication.md)).
- Authorization is a generated Cedar policy set from ONE capability
  matrix ([`docs/authz/capability-matrix.yaml`](../authz/capability-matrix.yaml));
  the same artifact renders the admin's A2 roles screen, so the screen
  cannot drift from the enforcement.
- Every patient-scoped read passes the decision point and writes an
  access event in the same transaction; refusals are written too.
- Postgres row-level security backs the application decisions per
  schema; the carrier roles (`mio_app`, `mio_worker`,
  `mio_audit_reader`) hold least-privilege grants — the app cannot
  DELETE identity rows or read the audit log; only the dedicated reader
  role can.
- The administrator plane is identity-only by construction: no clinical
  grants, no clinical queries, credential resets behind step-up
  re-authentication (WP-28).

## Data subject rights — implementation map

| Right | Implementation |
|---|---|
| Access / portability | "Download my data": one JSON document (`mio-export/v1`) assembled under the patient's own RLS context — internal care-team notes are excluded by construction. Includes the subject's access history and attachment metadata (WP-26/29) |
| Transparency of disclosures | "Who has viewed my records" in settings — first-class product, includes worklist disclosures |
| Rectification | Contact details editable in settings; clinical corrections follow care-side workflows with change events |
| Erasure / retention | Per-class policy in `audit.retention_policy`; statutory periods are register item **R5** and every class holds a NULL period (= retain, never delete) until that lands. Deceased patients: care-side flag, outbound automation stops, record retained read-only |
| Objection to communication | Per-kind email toggles (P8); in-app remains the content-bearing layer |

## Retention and offboarding mechanics (WP-29)

- Completed and discontinued treatments are stamped `archived_at` by a
  daily job after a 90-day quiet period.
- Audit events are copied daily to object storage as JSONL behind a
  watermark; bucket versioning provides tamper evidence, and a dedicated
  retention-locked bucket is the production endgame once R5 supplies the
  lock period.
- Account deactivation voids credentials and revokes sessions; data is
  retained. Reactivation restores sign-in only.
- A deceased patient is recorded by their treatment lead (audited,
  care-side only — the admin plane cannot do it): sign-in closes,
  reminders, notifications and emails stop at every job and endpoint
  that sends anything.

## Risks the engineering already mitigates

| Risk | Mitigation |
|---|---|
| Clinical data in email | Contentless mail types; no field to carry it |
| Clinical data in logs/fixtures | Synthetic-only test data (WP-05); PII discipline tests |
| Over-broad staff access | Care-relationship scoping in SQL + Cedar + RLS, worklist reads audited with subject lists |
| Audit log as a side channel | X4-minimised admin view (patients as initials); patient names never rendered there |
| Malicious uploads | Quarantine pipeline: sniff, scan, promote/reject; only clean bytes served, with `Content-Security-Policy: sandbox` |
| Tampering with audit trail | Append-only tables (owner included) + daily export to versioned object storage |

## Open items the DPIA must resolve (owned outside engineering)

- Lawful basis under Art. 6/9 and the controller/processor split per
  hospital (R4) — shapes who answers data subject requests.
- Statutory retention periods FI/SE (R5) — unlocks real deletion
  schedules and the bucket retention lock.
- Whether a dedicated auditor/DPO role should replace administrator
  access to the full audit log (open question in
  [data-model](../architecture/data-model.md), P2).
