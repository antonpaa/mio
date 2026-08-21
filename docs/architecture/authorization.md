# Authorization

Cedar, embedded in the API process, is the only authorization model in Mio
([ADR-0006](../adr/0006-cedar-as-sole-authorization-model.md)).

The capability matrix at [`../authz/capability-matrix.yaml`](../authz/capability-matrix.yaml)
is the source of truth; [`../authz/README.md`](../authz/README.md) explains how
to read and change it. This document describes the runtime.

## Principle: role never suffices

Mio has four user levels, but a role alone never grants access to patient data.
What grants access is a **relationship** — team membership on a treatment the
patient is enrolled in.

A Treatment Member is not "a clinician who can see patients". They are a
clinician who can see *the patients on their treatments*. Every clinical grant in
the matrix carries a relational scope for this reason.

## Entities

```
User            ─ realm (patient | staff), role, team memberships
Patient
Treatment       ─ lifecycle state, team
TreatmentTeam   ─ members, leads
CareRelationship─ user ↔ patient, derived from team ∩ enrolment, time-bounded
Survey / SurveyVersion / SurveyResponse
Message / MessageThread / InternalNote
Alert / Task / Activity / Attachment
```

`CareRelationship` is the pivot of the whole model. It is derived — a clinician
has a care relationship with a patient when they are on the team of a treatment
that patient is enrolled in — but it is **materialised** into
`clinical.care_relationship`, because it must be queryable in SQL for list
scoping and it must be time-bounded for audit ("did this person have access on
the day they looked?").

## The decision point

```
  request
     │
     ▼
  load principal + resource entities
     │
     ▼
  ┌──────────────────────────────────────────┐
  │  Cedar: isAuthorized(principal, action,  │
  │                      resource, context)  │
  └───────────────┬──────────────────────────┘
                  │
      ┌───────────┴───────────┐
      │                       │
   ALLOW                    DENY
      │                       │
      ▼                       ▼
  write audit.access_event  write audit.access_event
  perform the access        return 403
      │                       │
      └────── same transaction ──────┘
```

**Denied attempts are audited too.** A clinician repeatedly trying to open
records they have no relationship to is exactly the signal an access log exists
to surface.

Because audit is bound to the decision point rather than to a controller, there
is no code path that reads patient data without producing an audit record. A
developer cannot forget to call it; there is nothing to call.

## Cedar decides, SQL scopes

Cedar is not a query planner. Asking it to filter a roster of 20,000 patients
means loading 20,000 entities per request.

| | Mechanism |
|---|---|
| "May I open patient 4711's profile?" | Cedar |
| "Which patients appear on my roster?" | SQL over `clinical.care_relationship` |
| "May I resolve this alert?" | Cedar |
| "Which alerts are in my triage queue?" | SQL, then Cedar per rendered row |

The two must never disagree. Consistency is maintained by generating both the
Cedar policy tests and the SQL scoping predicates from the capability matrix.

Divergence here fails in the direction of disclosure: an item appearing in a list
it should not have. The generated tests assert that anything reachable by SQL
scoping is also permitted by Cedar for the same principal.

## Audit volume on list views

A worklist render can touch dozens of patient-scoped rows. One audit event per
row would bury the signal that a patient's access history is meant to carry.

List views therefore emit **one** `audit.access_event` recording the view and the
set of patients disclosed, rather than one event per row. Opening an individual
record emits its own event. A patient reading their access history should see
"Dr. X viewed the oncology worklist, which included you" as distinct from
"Dr. X opened your record".

## Performance

Cedar evaluation is fast; loading entities is not. The hot paths — dashboard,
roster, message list — must not fan out into per-row entity fetches.

Approach: load the entity slice for a request once, evaluate all decisions for
that request against it, and keep the slice request-scoped. Care relationships
and team memberships are the entities that matter and both are small per user.

This is a known optimisation target, not a solved problem. It should be measured
against a realistic synthetic dataset (20,000 patients) before launch rather than
discovered in production.

## Policy change control

Cedar policies live in the repository and are reviewed as code. A change to
authorization requires a matching change to the capability matrix, and CI fails
if either moves without the other.

Under [ADR-0009](../adr/0009-iec-62304-shaped-development.md) this gives a
traceable link from an access rule to the reason it exists — which is what an
auditor asks for.
