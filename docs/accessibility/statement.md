# Accessibility statement (draft — EN 301 549 / WCAG 2.2 AA)

**Status: engineering draft (WP-31).** This is the statement's factual
skeleton, maintained with the code. Publication — where it appears in
the product, the FI/SV translations, the feedback contact, and the
formal conformance wording — is the R7 owner's decision (compliance
register). Nothing here may be published claiming conformance until the
assistive-technology session below has happened.

## Scope

The Mio web application: patient, clinician and administrator surfaces,
in English, Finnish and Swedish.

## Conformance target

WCAG 2.2 level AA, as required by EN 301 549 for the web software
clause. Target, not yet a verified claim.

## What is engineered in, today

- **Semantics by construction**: interactive primitives come from React
  Aria; the body map is a fieldset of real checkboxes; every icon is
  decorative (`aria-hidden`) with the localized label as the accessible
  name; status dots and chips carry screen-reader text.
- **Keyboard**: every flow operable without a pointer. Dialogs move
  focus in on open, trap Tab, close on Escape and return focus to the
  opener (`useModalFocus`, verified live —
  [keyboard-pass-2026-08.md](keyboard-pass-2026-08.md)).
- **Automated checks in CI**: axe-core assertions on components and
  pages; a violation fails the build.
- **Motion**: the icon-registration animation respects
  `prefers-reduced-motion`.
- **Language**: the document language follows the account's locale;
  all three locales are complete, not partial translations.

## Known limitations (current, honest)

- A full assistive-technology audit (NVDA, VoiceOver, TalkBack) by
  testers who use them daily has not yet been performed; automated and
  scripted checks cover the keyboard/ARIA contract only.
- Colour contrast is spot-relaxed in a few component tests while brand
  tokens settle; final palette must re-enable the axe contrast rule
  everywhere.
- Charts (value series) present data visually with a text summary;
  a full data-table alternative is not yet offered.

## Feedback channel

To be defined at publication (R7): how a user reports an accessibility
barrier and the response-time commitment.
