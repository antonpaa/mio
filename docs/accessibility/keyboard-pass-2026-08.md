# Accessibility pass — August 2026 (WP-31)

What was checked, how, what was found, what was fixed. The automated
layers run in CI on every change; the scripted browser pass below was
run against the dev build on 2026-08-24 after the WP-31 fixes landed.

## Standing automated coverage (CI, every change)

- **axe-core** runs inside the component tests (`@mio/ui`) and the page
  tests (`apps/web`) — every core page renders through an axe check with
  zero violations as the assertion.
- **Component semantics by construction**: interactive primitives come
  from React Aria (focus rings, ARIA wiring, keyboard activation); the
  body map renders as a fieldset of real checkboxes, so region selection
  is keyboard- and screen-reader-native rather than pointer-only.

## Finding of this pass — and the fix

The fifteen hand-rolled `role="dialog"` overlays (and the shared
ConfirmDialog) opened **without moving focus**: keyboard and
screen-reader users stayed on the page behind the overlay (WCAG 2.4.3),
could Tab out of the open dialog (2.1.2), and lost their place when it
closed. Fixed in this work package with `useModalFocus` (`@mio/ui`):
initial focus moves to the first focusable control, Tab and Shift+Tab
wrap inside the dialog, and closing returns focus to the opener. Applied
to every dialog site; unit-tested in the kit and verified live below.

## Scripted keyboard pass (real browser, dev build, 2026-08-24)

| # | Check | Result |
|---|---|---|
| L1 | Login: Tab order reaches language switch → email → password → Continue | PASS |
| D1 | PP5 export dialog: opening moves focus into the dialog (reason field) | PASS |
| D2 | PP5 export dialog: Tab cycles inside — no escape to the page behind | PASS |
| D3 | PP5 export dialog: Escape closes and focus returns to the opener | PASS |
| T3 | Recurrence editor: focus moves in on open | PASS |
| T3 | Recurrence editor: Tab stays inside through every field of the phased editor | PASS |
| T3 | Recurrence editor: Escape closes, opener refocused | PASS |
| P1 | Patient self-report dialog: focus moves in (symptom select) | PASS |
| P2 | Patient self-report dialog: Escape restores the opener | PASS |

Script: session scratch `wp31-keyboard-pass.mjs` (Playwright over the
dev server, real Chromium, real sign-in both realms).

## Deep passes

- **Body map**: checkbox-group semantics verified in the kit tests
  (toggle by click and by keyboard, selection summary announced as
  text); axe-clean. No pointer-only interaction exists.
- **Recurrence editor (T3)**: full keyboard traversal of the phased
  editor verified live (table above); all controls are native
  inputs/selects/buttons inside the trapped dialog.

## Open items (honest)

- **Assistive-technology session pending**: these checks prove the
  keyboard and ARIA contract; a session with real screen readers
  (NVDA + VoiceOver at minimum) by a tester who uses them is still
  required before the statement below can claim full conformance.
  Tracked with R7 in the compliance register.
- Colour-contrast axe rule is relaxed in a handful of component tests
  where the brand palette is under review; re-enable as tokens settle.
