# Delivery phasing

The work-package plan for building Mio, now that the design package fixes the
application's extent. Work packages map one-to-one to branches
(`wp/<nn>-<slug>`, [`conventions.md`](conventions.md)) and merge by PR; phases
are dependency bands, not calendar units. No dates here — order, dependency
and size only.

**Size key:** S — days; M — one to two weeks; L — several weeks of focused
work. Sizes are relative effort, not commitments.

## Principles

1. **Foundations once, then vertical slices.** Phase 0 builds the platforms
   everything rides on (schemas, authz toolchain, tokens, CI). After that,
   every work package cuts through UI → API → database and lands demoable.
2. **Walking skeleton first.** A deployed sign-in into three empty shells
   proves auth, sessions, i18n, CI/CD and the environment story before any
   clinical feature exists.
3. **The riskiest subsystem is not last.** The survey→rules→alert loop is the
   product's heart and its regulatory core (ADR-0009, ADR-0011); it lands in
   the middle where there is still room to learn from it, not at the end.
4. **Structural guarantees are built, not retrofitted.** Schema split, RLS,
   decision-point audit and the contentless email layer exist from Phase 0–1
   and every later package inherits them.
5. **Compliance runs beside the code.** External-lead-time items (MDR, EORTC,
   national registration) start now and gate *release*, not development.

## Phase 0 — Foundations

Everything else depends on these. WP-01 first; the rest parallelize.

| WP | Branch | Scope | Size | Depends |
|---|---|---|---|---|
| WP-01 | `wp/01-scaffold` | pnpm monorepo per [ADR-0003](adr/0003-typescript-node-backend.md): `apps/web` (Vite/React/TanStack), `apps/api` (NestJS/Fastify), `apps/worker`, `packages/{contracts,survey-schema,authz,ui,i18n}`; TS strict; lint/format; CI skeleton (lint, typecheck, test); module-boundary architecture test; local dev via docker-compose (Postgres, Mailpit); CLAUDE.md | M | — |
| WP-02 | `wp/02-database` | Migration tooling (plain SQL, forward-only, CI-gated); `identity`/`clinical`/`audit` schemas with the four roles and grants of [data-model.md](architecture/data-model.md); RLS scaffolding + `SET LOCAL` plumbing; append-only audit tables; pg-boss; the two connection pools; Testcontainers integration-test harness proving the grants (admin role cannot read `clinical.*` — the test *is* the guarantee) | M | WP-01 |
| WP-03 | `wp/03-ui-foundation` | Tokens from [design-system.md](design/design-system.md) as Tailwind `@theme`; self-hosted fonts (E11); logo/mark/favicon assets rebuilt from S5; core components: pill button, card, severity/status chips, inputs, table, list rows, empty/error/loading patterns (S1/S6), the three nav shells as dumb components; React Aria wired; axe-core in CI; component workbench (Storybook or Ladle) | M | WP-01 |
| WP-04 | `wp/04-authz-toolchain` | Capability-matrix codegen: YAML → Cedar entity model, exhaustive policy test suite (324 grants), UI capability flags, docs table; `validate_matrix.py` folds into the generator; embedded Cedar decision service with the same-transaction audit hook of [authorization.md](architecture/authorization.md) (wired to real resources in WP-10) | M | WP-01, WP-02 |
| WP-05 | `wp/05-synthetic-data` | The generator [platform.md](architecture/platform.md) commits us to: FI/SV names, staff, patients, programs, survey histories with trends, messages, alerts at each severity; seeds dev/staging; the 20k-patient authz performance dataset | M | WP-02 |

## Phase 1 — Identity and the walking skeleton

| WP | Branch | Scope | Size | Depends |
|---|---|---|---|---|
| WP-06 | `wp/06-auth-core` | [authentication.md](architecture/authentication.md) core: two account tables, Argon2id, opaque sessions with realm-scoped cookies, email OTP (hashed, single-use, rate-limited), progressive delay, timing-safe flows, `audit.auth_event` for everything; `AuthenticationProvider` interface; second-engineer review per conventions | L | WP-02 |
| WP-07 | `wp/07-onboarding-recovery` | Invitations + welcome email through the contentless mail layer (built here: `{recipient, notificationType, deepLink}` and the S4 template); first-login password set; terms acceptance with version record (S3); forgot/reset (enumeration-safe); administrator reset with step-up; session timeout policy + S2 warning/signed-out UX; client-side composer-text preservation (X3) | M | WP-06 |
| WP-08 | `wp/08-login-ui-shells` | L0–L7 built on WP-03 components; react-intl runtime with EN/FI/SV, pre-auth language switcher, per-account persistence; the three shells navigable with capability-flag-gated routes and empty pages | M | WP-03, WP-06 |
| WP-09 | `wp/09-environments` | Terraform per [ADR-0010](adr/0010-cloud-agnostic-container-platform.md): dev + staging on the chosen cloud (**gate D1**), API+worker containers, managed Postgres, object storage, secrets, OTel export; deploy pipeline with migration gate; staging seeded by WP-05 | M | WP-01; D1 |

**Milestone M1 — walking skeleton:** a designed sign-in (password + OTP, all
three languages) into three empty shells, deployed on staging with synthetic
accounts. Auth, audit, i18n, CI/CD and the environment story all proven.

## Phase 2 — Clinical core

| WP | Branch | Scope | Size | Depends |
|---|---|---|---|---|
| WP-10 | `wp/10-patients-relationships` | Patient records; materialised `care_relationship`; Cedar wired end-to-end with same-transaction audit on the first real patient-scoped reads; roster (C3) with SQL scoping, list-level audit events; patient profile shell with sub-navigation | L | WP-04, WP-05, WP-08 |
| WP-11 | `wp/11-treatments` | Treatments with lifecycle states; teams incl. attached team groups; template catalog, instantiate-and-modify with provenance ("template updates don't change running treatments"); T1/T2, PP1; on-behalf provenance columns | L | WP-10 |
| WP-12 | `wp/12-scheduling` | RRULE segment model, materialisation worker, activities, answer windows; date-vs-instant rules of [scheduling.md](architecture/scheduling.md); recurrence dialog (T3) incl. phased patterns with preview; patient calendar (P9/P16) | L | WP-11 |
| WP-13 | `wp/13-tasks` | Tasks: claim/assign/complete, team queue, treatment linkage, completed-task → activity log; C5 and the dashboard tasks slice | M | WP-11 |

**Milestone M2 — clinical core:** a clinician runs a real program: instantiate
from template, team assembled, activities scheduled on a phased recurrence,
tasks flowing. No surveys yet.

## Phase 3 — Surveys

WP-15/16 parallelize after WP-14; WP-17 closes the phase.

| WP | Branch | Scope | Size | Depends |
|---|---|---|---|---|
| WP-14 | `wp/14-survey-engine` | The shared `survey-schema` package — the one implementation of question tree, visibility/progress semantics, typed validation incl. the linear-time-safe regex subset (E12), version binding, locale variants; server-side authoritative validation; patient fill UX (P4 frame) with server-side save-and-resume; submitted view (P12, static copy) | L | WP-10 |
| WP-15 | `wp/15-builder` | Catalog (B1), editor (B2 minus rules), pages, conditional-logic editor (B5), validation config (B6), versions & languages (B4), publish flow with immutability; licensing-provenance flag on catalog entries (R11) | L | WP-14 |
| WP-16 | `wp/16-body-map` | The component with its parallel accessible representation; region set with L/R sides; builder config (B3) with template-critical areas; renderer + response detail rendering | M | WP-14 |
| WP-17 | `wp/17-assignment` | Assign dialog (T4: version pick, language, send/scheduled/recurring); schedules on templates riding WP-12 occurrences; reminders; overdue state; missed-occurrence marking; patient surveys page (P3/P13) | M | WP-14, WP-12 |

**Milestone M3a:** a patient answers a versioned, branching, multilingual
survey assigned on a phased schedule. Nothing evaluates yet.

## Phase 4 — Rules, alerts, observations

The regulatory core. Evaluation traces and determinism from the first commit.

| WP | Branch | Scope | Size | Depends |
|---|---|---|---|---|
| WP-18 | `wp/18-rule-engine` | Declarative rule model + deterministic evaluator in the shared package; single-response conditions; severity grading; alert creation with same-transaction outbox to notifications; **evaluation traces stored from day one**; builder rule config (B2/B3 rules panels) | L | WP-14, WP-17 |
| WP-19 | `wp/19-alert-workflow` | new→acknowledged→resolved with assignment, comments, audited history; alert detail (PP6); dashboard triage queue slice (C1); notification bell wiring for alerts | M | WP-18 |
| WP-20 | `wp/20-trend-rules` | Consecutive-response and missed-response conditions over materialised occurrences; outcomes: custom notifications (team/role/patient, authored text, in-app only) and task creation; rule editor (B7); worker evaluation on window expiry | L | WP-18, WP-13 |
| WP-21 | `wp/21-observations` | The observations module: value series + entries with provenance and charts (PP2), symptom taxonomy + observations + register with trends (PP3), on-behalf flows (Report a symptom / Fill a survey / New value), survey→symptom mapping; survey→value binding once **P7** is decided | L | WP-10, WP-14 |
| WP-22 | `wp/22-program-rules` | Program-specific override layer (`treatment.configure_program_rules`); effective-rule-set resolution; response detail (C7) with per-answer standing against program rules; completed-surveys list (PP4); patient summary assembly (C2) | L | WP-18, WP-21 |

**Milestone M3 — the loop closes:** severe answers → graded alert with trace →
triage → response detail against program rules. The product's heart beats.
This is also the moment to revisit R1 with the regulatory advisor: the thing
Rule 11 applies to now exists and can be demonstrated.

## Phase 5 — Messaging and notifications

| WP | Branch | Scope | Size | Depends |
|---|---|---|---|---|
| WP-23 | `wp/23-messaging` | Threads per program, structured-document messages, internal notes as their own entity with the C4 composer toggle, read-only ended threads; P6/P10/P14, C4; unread counts | L | WP-10 |
| WP-24 | `wp/24-attachments` | Quarantine → sniff → ClamAV → promote pipeline; separate serving origin, short-lived signed URLs post-authorization; image paste in the composer | M | WP-23 |
| WP-25 | `wp/25-notifications` | In-app notification centre (P11) and Updates feed; email dispatch on the WP-07 contentless layer with per-type toggles (P8 slice); custom-notification delivery from WP-20 into Updates | M | WP-19, WP-23 |

## Phase 6 — Assembly

The landing pages come late deliberately: they are aggregations of everything
above, and building them earlier means building them twice.

| WP | Branch | Scope | Size | Depends |
|---|---|---|---|---|
| WP-26 | `wp/26-patient-landing-settings` | P1/P7 widgets (Action needed, Messages, Updates, Upcoming); settings (P8) complete; "Who has viewed my records" access log; GDPR self-export | M | WP-17, WP-23, WP-25, WP-12 |
| WP-27 | `wp/27-clinician-dashboard` | C1 complete (alerts, unread, overdue + send reminder, tasks, today & upcoming, my-patients/whole-team); roster polish; C6 states | M | WP-19, WP-20, WP-23, WP-13 |
| WP-28 | `wp/28-admin` | A1 users (create/deactivate/reset-login), A5 teams, A2 roles view rendered from the matrix, A3 audit log UI (minimised display per X4), clinician patient-data export with reason (PP5); A4 reporting per the **P8** decision | L | WP-06, WP-04; P8 |

**Milestone M4 — feature complete.** Everything on the canvases exists.

## Phase 7 — Hardening and pilot readiness

Mostly parallel; WP-33 closes.

| WP | Branch | Scope | Size | Depends |
|---|---|---|---|---|
| WP-29 | `wp/29-gdpr-retention` | Retention classification + archival jobs, deceased-patient handling, account offboarding, export finalisation, DPIA support material (R4) | M | M4 |
| WP-30 | `wp/30-security` | Threat-model revisit, pen test (auth + attachments named targets) and fixes, CSP/headers, rate-limit tuning, SOUP inventory completion | L | M4 |
| WP-31 | `wp/31-accessibility` | Manual keyboard/screen-reader passes on every core flow; body map and recurrence editor deep passes; EN 301 549 statement (R7) | M | M4 |
| WP-32 | `wp/32-performance-ops` | Authz hot paths and worklists against the 20k dataset; restore rehearsal with evidence (E7); observability dashboards; runbooks; portability spot-check on the non-chosen cloud (ADR-0010) | M | M4 |
| WP-33 | `wp/33-compliance-closure` | Fold in the R1 MDR decision; Finnish Class B registration (R2); final terms/privacy content; QLQ-C30 onboarding if R11 licensed; release checklist against the register | M | R1–R5 |

**Milestone M5 — pilot-ready.**

## Decision gates

Non-engineering inputs, mapped to the first WP they block. Everything is
start-now; none blocks Phase 0.

| Gate | Decision | Blocks | Register |
|---|---|---|---|
| D1 | Cloud: Azure or GCP — **decided 2026-08-24: GCP**, swap to Azure kept possible (see the decision note in ADR-0010) | WP-09 (staging deploy) | ADR-0010 |
| D2 | P1 — who creates patient accounts — **decided 2026-08-24: administrators only** (leads are treatment-specific roles) | WP-07 final onboarding UI | P1 |
| D3 | P4 — patient-facing alert posture — **owner confirmed 2026-08-24: patients never see severities** | WP-18/P12 dynamic copy | P4 |
| D4 | P7 — survey→value binding — **decided 2026-08-24: explicit per-question binding (X8), shipped** | that slice of WP-21 | P7 |
| D5 | P8 — reporting placement — **decided 2026-08-24: clinical side**, not the admin shell (admins cannot read the aggregates) | A4 slice of WP-28 | P8 |
| D6 | X5 — *kysely* vs *lomake* | FI translation pass (continuous) | X5 |
| D7 | R1 — MDR classification — **decided 2026-08-24: not a medical device** (reopens if claims change) | release | R1 |
| D8 | R11 — **decided 2026-08-24: no licensed instruments ship**; authoring organisations own validity at build time | — | R11 |
| D9 | Glossary native clinical review | translation freeze before M4 | Glossary |

## Parallel lanes

For concurrent sessions/contributors, the low-contention split per phase:

- **Lane A — domain/backend:** WP-02 → 04 → 06/07 → 10 → 11/12/13 → 18/20 → 22
- **Lane B — UI system/patient app:** WP-03 → 08 → 14-fill-UX → 16 → 23-UI → 26
- **Lane C — builder/clinician tooling:** WP-15 → 17 → 19 → 21 → 27/28
- **Continuous:** WP-05 grows with every new entity; translations trail each
  merged WP; ADRs and the register update in the PR that triggers them.

Contention watchpoints: the capability matrix (single file, many WPs touch it
— rebase early, land small) and the shared `survey-schema` package (WP-14/18
own it; others consume released versions).

## Standing definition of done

Every work package, in addition to its scope: capability matrix updated in the
same PR where access changes (CI enforces); migrations reviewed; integration
tests against real Postgres incl. RLS/grant assertions where touched;
axe-clean UI; EN strings complete with FI/SV keys stubbed for the translation
trail; audit events for every new patient-scoped read; synthetic data extended
for every new entity; docs and ADRs updated where behaviour or structure
changed; second-engineer review where [`conventions.md`](conventions.md)
requires it.
