# Mio — Design brief (original ask, saved for reference)

## The ask
Design a new web-based system called **Mio**, a cancer treatment management system for hospital care teams and their patients.

Constraints and direction:
- No existing code or design system — defined from scratch.
- Design the Mio logo from scratch: works as small mark (favicon, app bar) and full lockup.
- Visual direction: clean, not default AI-dashboard look. White/light grey base, lightly dignified and calm, good UX.
- **Primary navigation on top, centered.**
- Mockups in English (system ships EN/FI/SV).
- Patient views: responsive, mobile-first. Clinician views: desktop-first, still responsive.
- Brief is first iteration; refinement rounds follow.

Deliverables — 3 core parts:
1. **Login (shared)** — email + password, email-code MFA step, first-login password-setup variant.
2. **Patient view** — landing page (Messages summary, Updates, Action needed, Upcoming) + enough of Messages / Treatments / Surveys to establish patterns.
3. **Treatment/hospital view** — clinician dashboard/worklist: alert triage, unread patient messages, my Tasks, today's & upcoming activities, overdue surveys.

Also show **empty states** and at least **one alert/error state**.

## System description

### Overview
- Web-based two-way patient–care-team interaction + treatment/program management, specifically cancer treatment.
- PII/patient data; careful data architecture. Standalone v1: no integrations, own account management.
- Name: Mio. Slogan: "Care, together" / "Hoitoa yhdessä" / "Vård, tillsammans".

### Accounts, roles, authentication
- Patients and clinician users in distinct user bases.
- Levels: Patient, Treatment Member, Treatment Lead, Administrator (suitable for Cedar; role capability matrix). Administrators ideally no clinical data access.
- No self-registration. Account = email. Users created from application side; welcome email; password set on first login; email MFA code finalizes onboarding.
- MFA via email code. Forgot-password self-serve; Administrator human reset as fallback (resets login only, never data). Define session timeout/auto-logout.
- 3 languages EN/FI/SV, user-managed persistent selection.
- First-login terms & privacy acceptance. "Download my data" (GDPR) in settings.

### Patient side
- **Landing:** summaries of Messages, Updates, Action needed, Upcoming widget.
- **Upcoming/calendar:** consolidated across all patient's programs (widget + full page).
- **Notification center:** in-app bell, unread indicators on messages and surveys; complements email notifications.
- **Messages:** per treatment program team (patient can be in multiple). In-app only, never email. Rich text (bold, italics, lists), links auto-hyperlink, images paste/add, attachments.
- **Treatments:** active + inactive (inactive hidden by default, filter). Quick-view expand + full view. Per treatment: team info, next planned activity, history of relevant actions.
- **Surveys page:** surveys link to treatments but own page; save-and-resume drafts, due dates, reminders, clear overdue state. Non-response is a signal.
- **Settings:** personal info (address, email, phone); notification management (email default, each activity type toggleable, all on by default); site preferences (time/date format); language.

### Treatment / hospital side
- **Dashboard/worklist** — start view: alert triage queue, unread patient messages, my Tasks, today's & upcoming activities, overdue/unanswered surveys. Filterable "my patients" vs whole team.
- **Tasks:** clinician activities are Tasks. Claim, assign to another user, see within treatment. Assigned tasks on Dashboard + dedicated Tasks page.
- **Patient roster + patient profile:** per patient aggregate of treatments, survey history/trends over time, messages, activity log. Clinicians think patient-first.
- **Messaging:** team-shared per program; internal notes invisible to patient. No reply templates, no drafts.
- **Treatment management:** team, scheduling, adding activities, lifecycle, inputs on behalf of patient (provenance: "entered by X on behalf of patient").
- **Treatment lifecycle:** draft, active, paused, completed, discontinued.
- **Treatment catalog:** templates, modifiable when instantiated.
- **Survey catalog** + management: statuses, assignments.
- **Survey responses:** detailed individual review; same survey over time (per patient + aggregate).
- **Survey assignment & scheduling:** manual + recurring schedules on treatment templates, reminders, escalation on non-response.
- **Scheduling & recurrence:** highly configurable, Outlook-style, incl. phased patterns (monthly ×6, then every 3 months).
- **User management** + **team management** (teams = groups of users).
- **Reporting (light):** response rates + open alerts per program; one screen for v1.

### Surveys & the builder
- Custom form builder. Typical question types (à la MS Forms) + custom **body map** component (SVG body, selectable parts).
- Paging + progress bar for respondent.
- **Conditional logic:** show follow-up questions depending on an answer's value; follow-ups are nestable (branch within branch) as deep as needed.
- **Input validation:** per-question input type checks (numeric with range/decimals/unit); advanced: custom regex pattern with custom error message.
- **Alert rules in builder:** graded severity levels, not on/off.
- **Trend rules across responses:** condition can span consecutive surveys ("if X for Y surveys in a row"); the consequence is configurable — raise alert (severity), send a custom notification (choose recipients/text), and/or create a task.
- **Custom notifications:** a rule can raise a custom notification to the team (or roles) with authored text, instead of or alongside an alert. Conditions cover a single response OR multi-survey trends ("if x for y surveys in a row"). The outcome ("then") is optional and configurable: raise an alert (severity), send a **custom notification** (to treatment team and/or patient, custom message), both, or record-only.
- **Alert workflow:** new → acknowledged → resolved; assignable; severity; comments; fully audited.
- **Versioning:** surveys + treatment templates draft/published/archived. Responses bind to exact version. Editing in-use template creates new version; older version selectable on attach (defaults newest).
- **Multilingual surveys v1:** one language or several; separate forms per language OR one survey with language variants.
- Surveys ↔ treatments many-to-many.

### Cross-cutting
- GDPR + Finnish/Swedish national + EU regulation.
- **Access & audit logging first-class:** who viewed/edited what, when.
- Email notifications never contain clinical content.
- Attachment policy: allowed types, size limits, virus scanning.
- Retention & offboarding simple: archive completed treatments; deactivate accounts; deceased patients' data retained as legally required, respectfully.
- Accessibility WCAG 2.2 AA.

### Naming conventions
- "Updates" for landing feed. "Action needed" for patient pending items. "Alerts" (with severity) for survey-raised flags.

### Out of v1
- Caregiver/proxy access.

### Symptom taxonomy (from user, Finnish — EN working translations)
Hengenahdistus (shortness of breath), Ihottuma/ihomuutos (rash/skin change — marked on body map, some areas critically alarming), Nivelkipu (joint pain), Ripuli (diarrhea), Turvotus (swelling), Yskä (cough), QLQ-30 (EORTC QoL survey), Erektiohäiriö (erectile dysfunction), Eturauhasen kipu (prostate pain), Kipu (pain), Kivulias virtsaaminen (painful urination), Kuume (fever), Muut oireet (other symptoms), Neuropatia (neuropathy), Oksentelu (vomiting), Pahoinvointi (nausea), Paleltumat (cold sensitivity/frostbite), Peräaukon kipu (anal pain), Ruokahalun väheneminen (decreased appetite), Suun kuivuminen (dry mouth), Suun limakalvovauriot (oral mucosal damage), Tihentynyt virtsaamisen tarve (urinary frequency), Ummetus (constipation), Verivirtsaisuus (hematuria), Virtsan karkailu (urinary incontinence), Virtsapakko (urinary urgency), Virtsaumpi (urinary retention). List may grow.

Key rule: whether a reported symptom raises a trigger/alert is **treatment-program-specific** (expected vs alarming depends on the program); triggers trace back to the exact survey responses that raised them (e.g. skin change → body-map parts, some critical).

### Patient profile sub-pages (clinician side; Finnish → EN)
Patient-scoped sub-navigation, grouped (headers not links):
- **Potilaan profiili / Patient profile:** Potilaan yhteenveto (Patient summary — combination view), Ohjelmat, lomakkeet ja hoitotiimi (Programs, surveys & care team), Potilaan tiedot (Patient details)
- **Terveystiedot / Health data:** Arvot (Values), Oireet (Symptoms), Täytetyt lomakkeet (Completed surveys — viewable whole with responses, color-coded criticality), Potilaan tietojen vienti (Data export)
- **Raportti / Report:** Raportoi oire (Report a symptom), Täytä lomake (Fill a survey), Uusi arvo (New value)

Patient summary also shows, when the data exists: 3 latest values each for "PSA-arvo", "Testo", "PSA-raportointi" (+ all records, + add new); latest fulfilled surveys and open surveys; latest activities; and management of the patient's assigned surveys (e.g. "Prostatan sädehoito", "Kemoterapian oirekysely", "Immunoterapian oirekysely").

## Approved design language (turn 2)
Warm editorial: Schibsted Grotesk + Newsreader italic. Paper #F6F4EF, surface #FFFEFB, ink #221F1A, secondary #7C766A, muted #9C9585, hairline #EFEBE0, border #DDD8CB. Teal #115E59 (hover #0D4A46, tint #E9F0EC, chip border #BFD6CE). Amber #A16207 (#F7EEDA / #E5D3A8). Red #B3372B (#F8E7E2 / #EBC5BC). Pills for buttons, radius 12–18, soft warm shadows, outlined severity chips with dot. Logo: two tilted overlapping circles + Newsreader italic "mio". Never use "·" as separator. Loaders: breathing logo splash, shimmer skeletons. Hovers: soft lift + warm tint, not bare color swaps.
