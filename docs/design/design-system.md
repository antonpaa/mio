# Mio design system — "warm editorial"

Approved direction (turn 2 of the design engagement): warm editorial — paper
tones, serif italic accents, pill controls, calm and dignified. This document
translates the canvases into tokens and rules for implementation. Visual source
of truth: `design/handoff-2026-08-21/`.

Tokens below become the Tailwind v4 `@theme` set in `packages/ui`
([ADR-0004](../adr/0004-spa-frontend-with-openapi-contract.md)).

## Color

Verified against actual usage across all current canvases.

### Base

| Token | Value | Use |
|---|---|---|
| `paper` | `#F6F4EF` | App background |
| `surface` | `#FFFEFB` | Cards, panels |
| `surface-sunken` | `#F1EEE6` | Inset areas, table headers |
| `ink` | `#221F1A` | Primary text |
| `ink-strong-secondary` | `#55503F` | Emphasised secondary text |
| `secondary` | `#7C766A` | Secondary text |
| `muted` | `#9C9585` | Tertiary text, placeholders |
| `hairline` | `#EFEBE0` | Row separators |
| `border` | `#DDD8CB` | Input and card borders |
| `border-strong` | `#C9C3B4` | Emphasised borders |

### Teal — primary / calm-positive

| Token | Value |
|---|---|
| `teal` | `#115E59` |
| `teal-hover` | `#0D4A46` |
| `teal-tint` | `#E9F0EC` |
| `teal-chip-border` | `#BFD6CE` |
| `teal-on-dark` | `#7FB5AE` (logo/links on dark, S5) |

### Amber — Moderate severity, caution

| Token | Value |
|---|---|
| `amber` | `#A16207` |
| `amber-tint` | `#F7EEDA` |
| `amber-chip-border` | `#E5D3A8` |

### Red — High severity, errors

| Token | Value |
|---|---|
| `red` | `#B3372B` |
| `red-tint` | `#F8E7E2` |
| `red-chip-border` | `#EBC5BC` |
| `red-tint-soft` | `#FDF6F4` |

Low severity's chip is the teal outline (X6, owner-decided 2026-08-24): teal-outline
chip until design supplies one.

## Typography

| Role | Face | Notes |
|---|---|---|
| UI, body, data | **Schibsted Grotesk** 400/500/600 | Everything by default |
| Display accents | **Newsreader** italic (optical sizing) | Greeting lines, empty-state headings, the wordmark — sparingly; it is the signature, not a second body face |
| Code/IDs (internal) | ui-monospace | Canvas annotation only, not product |

**Fonts are self-hosted in production.** The canvases load Google Fonts; a
healthcare product must not have every page view send visitor IPs to a
third-party font CDN (GDPR — the *LG München* line of rulings). Ship WOFF2 with
the bundle; both faces are open (SIL OFL). Standing obligation E11 in the
[compliance register](../compliance/register.md).

## Shape, depth, motion

| | Rule |
|---|---|
| Buttons, chips, inputs | Pill — `border-radius: 99px` |
| Cards, dialogs | 16px radius (12–18 band); small nested elements 8–10px |
| Resting shadow | `0 1px 6px rgba(60,52,36,0.08)` — warm-tinted, never grey-black |
| Raised (dialogs, popovers) | `0 2px 12px rgba(60,52,36,0.10), 0 1px 2px rgba(60,52,36,0.08)` |
| Primary CTA emphasis | `0 8px 20px rgba(17,94,89,0.22)` |
| Hover | Soft lift + warm tint — never a bare color swap |
| Loading | Breathing logo splash (scale 1→1.08, opacity 0.85→1); shimmer skeletons for content |
| Reduced motion | All of the above respect `prefers-reduced-motion` |

## Logo

Two tilted overlapping circles — light circle low-left (`teal` at 14%
opacity), dark circle high-right (30%) — with Newsreader italic "mio".

- Full lockup: sign-in, emails. Mark alone: app bar (44px), favicon (24/16px).
- Below 24px drop the wordmark and enlarge circle radii (S5).
- The circles stay tilted at every size; never rotate the lockup horizontal.
- On dark: tint `#7FB5AE`.
- **Never use "·" as a separator anywhere in the UI** — an explicit rule from
  the direction approval. Use an en dash with spaces (" — "), as every canvas
  does.

## Icons — print registration (X10, owner-requested addition)

Not from the canvases; recorded as delta X10 in [README.md](README.md).
Hand-drawn stroke glyphs (24-grid, 1.6 stroke, round caps) in
`packages/ui/src/components/icons.tsx` — no icon library. Every glyph
carries the logo's light circle as a `teal` tint layer (18 % — the
lockup's 14 % adjusted for glyph scale) that rests misregistered
low-left, exactly like the lockup, and slides into register when the
enclosing control is hovered or focused; on the current nav page it
stays registered at the dark circle's 30 %. Icons are decorative by
contract (`aria-hidden`, the text label names the item) and the motion
obeys `prefers-reduced-motion` via the global rule.

## Component inventory (from the canvases)

Severity chip (outlined, tinted, leading dot); status chip
(Active/Draft/Published/Archived/Ended/Done); pill button (primary teal /
quiet outline); card with header action link ("All alerts"); list row with
leading avatar/initials; date block (weekday + day, calendar rows); top
centered primary nav with unread-count badges; patient-scoped left
sub-navigation with group headers (clinician profile pages); segmented filter
(My patients / Whole team); search input; data table (roster, catalogs,
values, audit); message bubble pair + internal-note block (visibly distinct,
labelled "not visible to patient"); composer with B/I, attachment, and
Reply-vs-Internal-note toggle; body map (front/back SVG, selectable regions);
stepper survey frame (progress "2 of 8", Save & exit); OTP six-digit input;
toggle switch; phased-recurrence editor; dialog (assign, recurrence);
notification popover from the bell; empty-state card (logo mark + Newsreader
line + one action); error card ("Nothing was lost" + Try again); timeout
warning modal; trend arrows (↑ worsening, → stable, ↓ easing/resolved).

## Voice

The copy is part of the design system; the canvases are consistent about it:

- Calm, concrete, second person; never clinical jargon to patients ("Your
  answers are with your care team").
- Honest about the system ("Your connection or our service hiccupped. Nothing
  you've done was lost") — no blameless-passive error copy.
- Sets expectations in the interface ("Replies usually within 1 working day.
  Not for emergencies"), and always offers the human path ("Feeling very
  unwell right now? Call the clinic").
- Explains *why* for anything privacy-adjacent ("Emails only say something is
  waiting — never health details"; "To protect your information, you'll be
  signed out…").
- States provenance and audit plainly where clinicians act ("Membership
  changes take effect immediately and are written to the audit log").

All three languages must carry this register — the glossary governs terms; this
governs tone.

## Accessibility hotspots

WCAG 2.2 AA holds everywhere; these are the components the canvases add that
carry the most risk, in addition to the two already tracked (body map,
recurrence editor):

- **Severity must never be color-alone**: chips pair color with the text label
  and dot; trend arrows pair with text ("worsening").
- The OTP input must behave as one field for assistive tech (paste, autofill
  `one-time-code`).
- The timeout warning needs `role="alertdialog"`, focus capture, and a
  non-visual countdown announcement.
- Internal-note blocks need a programmatic label ("Internal note — not visible
  to the patient"), not only the visual treatment.
- Newsreader italic is display-only; body text stays Schibsted Grotesk at
  AA-passing contrast on `paper`/`surface` (`secondary` on `paper` is the pair
  to watch in review).
