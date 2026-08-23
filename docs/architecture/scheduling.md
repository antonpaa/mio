# Scheduling and recurrence

The brief asks for Outlook-grade recurrence configuration, including phased
patterns: monthly surveys for six months, then one every three months.

## Model: ordered RRULE segments

Do not invent a recurrence syntax. Use **RFC 5545 RRULE**, extended by ordering
segments.

A schedule is an **ordered list of segments**, each an RRULE with its own
`COUNT` or `UNTIL`, plus `RDATE` additions and `EXDATE` exclusions.

```
Segment 1   FREQ=MONTHLY;COUNT=6
Segment 2   FREQ=MONTHLY;INTERVAL=3
```

That is the brief's example, exactly, in a standard notation. Segments run in
sequence. The handoff rule: a segment's first occurrence falls one of **its
own** intervals after the previous segment's last (monthly ×6 from 15 Sep,
then every 3 months → 15 Feb is the sixth, 15 May opens the next phase).
Arbitrary phasing follows.

Implementation (decided in WP-12): the RFC 5545 **subset** we actually use —
DAILY/WEEKLY/MONTHLY, INTERVAL, COUNT/UNTIL, BYDAY, RDATE/EXDATE — lives in
`@mio/schedule`, ~200 lines of date-level arithmetic shared verbatim by the
builder preview, the API and the worker. `rrule.js` was considered and
dropped per ADR-0009: it is time-of-day-based (DST shifts leak into dates),
and we need none of the exotic clauses. Monthly steps clamp per occurrence
anchored on the segment start (31 Aug → 30 Sep → **31 Oct**), which RFC 5545
itself leaves to the implementation.

## Materialise occurrences

Store the rule, and **materialise occurrences** into a schedule table on a
rolling horizon of roughly twelve months, extended by a worker job.

Why not expand on read:

- Calendar, worklist and overdue queries become ordinary SQL with ordinary
  indexes. Expanding recurrence rules inside a query is not something to
  attempt.
- A materialised occurrence is a **thing that can be modified**. Skipping one
  survey, moving another by two days, or attaching a response all need an
  identity to attach to.
- "This occurrence" versus "this and all future" — the semantics every user
  expects from a calendar — need materialised rows to be expressible at all.

Editing a rule rewrites unmaterialised future occurrences and leaves the past
untouched. Occurrences with responses attached are never destroyed.

## Time zones

The trap, stated plainly:

**Survey due dates are dates, not instants.**

| Kind | Storage |
|---|---|
| Appointment, activity with a time | UTC instant |
| Survey due date, deadline | Local date + IANA time zone |

Storing "due 15 March" as a UTC instant means it becomes overdue at 01:00 or
02:00 local depending on the season, and twice a year the daylight saving
transition moves the boundary. Patients receive "your survey is overdue"
notifications at hours that make no sense, on a system that is asking them about
cancer symptoms.

Patients carry an IANA time zone (`Europe/Helsinki`, `Europe/Stockholm`) on
their account. Overdue evaluation, reminder dispatch and calendar rendering all
resolve against it.

Recurrence expansion happens in the patient's local time zone, not UTC. "Monthly
on the 15th" means the 15th where the patient is.

## Answer window, reminders and escalation

Attached to the assignment, not the schedule (T3/T4 in the canvases): an
**answer window** per occurrence (e.g. 7 days), reminder offsets after the due
date ("after 2 days"), and an if-unanswered action ("remind, then notify
team").

When an occurrence's window passes unanswered, the worker marks it missed and
runs the **missed-response rules** of the survey's effective rule set — which
may raise an alert, send a custom notification, or create a task ("no response
for 2 surveys in a row → notify care coordinator + create task", B7). This is
why occurrences are materialised: non-response is a clinical signal, and a
signal needs a concrete row to be evaluated against
([`surveys-and-alerts.md`](surveys-and-alerts.md)).

Reminder emails carry no clinical content — only that something is waiting in
Mio.

## Configuration UI

The recurrence editor is one of the harder interaction problems in the product,
and it is used by clinicians under time pressure.

- Always offer a custom option; presets are shortcuts, never the whole surface.
- Show the next several occurrences as the rule is edited. A recurrence rule
  nobody can verify is a recurrence rule nobody trusts.
- Phased schedules need the segment structure visible, not buried behind an
  "advanced" toggle — the brief's own example is a phased schedule, so it is a
  primary case. The designed dialog (T3) shows it: Once / Weekly / Monthly /
  Phased, ordered phases with "+ Add phase", and a natural-language preview
  with the next occurrence date — the preview is the verification device.
- Keyboard-operable throughout, per WCAG 2.2 AA. React Aria's date primitives
  ([ADR-0004](../adr/0004-spa-frontend-with-openapi-contract.md)) exist for
  exactly this.
