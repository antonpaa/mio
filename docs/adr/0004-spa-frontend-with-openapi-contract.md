# 0004. SPA frontend with an OpenAPI contract

- **Date:** 2026-08-21
- **Status:** Accepted

## Context

Every Mio screen is behind authentication. There is no public content, no SEO
requirement and no first-paint-for-anonymous-visitors concern, so
server-side rendering has no payoff here.

Patient views are mobile-first responsive; clinician views are desktop-first
responsive. Accessibility is WCAG 2.2 AA — a hard requirement, not a target.

The hosting cloud is deliberately undecided (ADR-0010), so the frontend must not
assume a hosting flavour.

## Decision

A **React 19 + TypeScript single-page application built with Vite**, served as
static assets from the **same origin** as the API.

- **TanStack Router** (type-safe routes, so role-gated routes are checkable) and
  **TanStack Query** for server state.
- **React Aria Components** as accessibility primitives. The visual design
  system is bespoke and built on design tokens; the *behaviour* of dates,
  comboboxes, dialogs and the recurrence editor is not something to reimplement
  when WCAG 2.2 AA is a requirement.
- **Tailwind v4** with `@theme` tokens, mapping onto tokens exported from the
  design package.
- **react-intl (ICU MessageFormat)** for UI strings. Finnish plural and case
  handling needs ICU. Note that multilingual *survey content* is data, not UI
  strings, and uses a different mechanism entirely
  (`docs/architecture/surveys-and-alerts.md`).
- **React Hook Form + Zod** for forms.
- The API contract is **OpenAPI-first**, with the TypeScript client generated
  from the specification.

Same-origin serving means `httpOnly` session cookies work with no CORS
configuration and no backend-for-frontend layer.

## Consequences

- Exactly one data boundary to audit: the HTTP API. There is no server-rendered
  component tree that might close over clinical data and ship it to the client.
- The OpenAPI document is a reviewable interface specification — useful as a
  regulatory artifact and for any future client.
- Static assets deploy anywhere; nothing is coupled to a hosting vendor.
- Initial bundle size needs active management, mitigated by route-level code
  splitting. The clinician application in particular will grow.
- No SSR means no server-rendered first paint. Acceptable: users are
  authenticated and the shell is cached.

## Alternatives considered

**Next.js.** Rejected: SSR earns nothing behind a login wall, and the
server/client component boundary introduces a new way to leak clinical data by
accident — a risk with no offsetting benefit here.

**GraphQL.** Rejected: a documented, versioned interface matters more than
client-shaped queries, and per-field authorization in a system with Mio's
access rules is substantially harder to get right and to audit.

**tRPC.** Tempting given TypeScript on both sides (ADR-0003), but it produces no
language-neutral interface document, which weakens the compliance story.
