# Mio — Design gap analysis (21 Aug 2026, updated)

Designed so far: login (L0–L7); patient mobile + desktop (P1–P16); clinician core (C1–C7 incl. patient summary w/ values & survey mgmt, response detail w/ body map); survey builder (B1–B7 incl. conditional logic, validation, trend rules & custom notifications); treatments (T1–T4 incl. lifecycle, catalog, phased recurrence, assignment); admin (A1–A5: users, role matrix, audit log, reporting, teams).

## Remaining

All gaps closed as of 21 Aug 2026:
- Patient-profile sub-pages → Mio Patient Profile.dc.html (PP1–PP6, incl. alert detail)
- Cross-cutting states → Mio States.dc.html (S1–S6: patient empty/error, session timeout + signed out, terms acceptance, notification email, logo usage, loading splash)

## File map
- Mio Login.dc.html — L0–L7
- Mio Patient v2.dc.html — P1–P16 (mobile + desktop)
- Mio Clinician v2.dc.html — C1–C7
- Mio Patient Profile.dc.html — PP1–PP6
- Mio Survey Builder.dc.html — B1–B7
- Mio Treatments.dc.html — T1–T4
- Mio Admin.dc.html — A1–A5
- Mio States.dc.html — S1–S6

## 1. Patient profile remaining sub-pages (clinician) — DONE (Mio Patient Profile.dc.html)
- Programs, surveys & care team; Patient details; Values (full page, all records); Symptoms; Completed surveys list (color-coded); Data export
- Alert detail: assign dialog, comment thread, acknowledged→resolved history (fully audited)

## 2. Cross-cutting states & artifacts — DONE (Mio States.dc.html)
- Patient-side empty states (landing all-caught-up, no messages) + error state; session-timeout warning + signed-out screen
- First-login terms & privacy acceptance (desktop variant)
- Notification email template (no clinical content: "You have a new message in Mio")
- Favicon/mark usage sheet (logo small-size check)
