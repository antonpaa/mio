# Threat model

First full pass (WP-30). Maintained with the architecture: a change to
an entry point, a trust boundary or a data flow updates this file in the
same PR. STRIDE per surface, mitigations pointing at the code that
enforces them, and an honest section for what is accepted or open. The
**external penetration test** (phasing WP-30) is commissioned against
this document; its named priority targets are marked ⊕.

## Assets, in priority order

1. Patient health data (`clinical.*`) — confidentiality and integrity.
2. The audit trail (`audit.*`) — integrity and completeness; it is the
   accountability mechanism for everything else.
3. Credentials and sessions (`identity.*`).
4. Alert delivery — availability; a suppressed severe alert is patient
   harm, not just an outage.

## Trust boundaries

| # | Boundary | Notes |
|---|---|---|
| B1 | Internet → API (Cloud Run) | The only ingress; the SPA is served from the same origin |
| B2 | API/worker → Postgres | NOLOGIN carrier roles; RLS realms via transaction-scoped context |
| B3 | API/worker → object storage | Private bucket, application-mediated bytes only |
| B4 | API/worker → SMTP | One-way; contentless mail types by construction |
| B5 | Patient realm ↔ staff realm | Separate session tables, separate cookies, separate guards |
| B6 | Care team ↔ rest of staff | Care-relationship scoping in SQL + Cedar + RLS |
| B7 | Admin plane ↔ clinical data | Identity-only by construction (WP-28) |

## Surfaces

### Authentication ⊕ (`apps/api/src/modules/identity`)

| Threat | Mitigation |
|---|---|
| S: credential stuffing, password spraying | Argon2id; per-ACCOUNT progressive delay (never a lockout DoS lever); per-IP window over the whole auth surface (WP-30, `hardening.ts`); MFA: emailed one-time code on every sign-in |
| S: OTP brute force | Codes are single-use, short-lived, attempt-limited per challenge |
| S: session theft | Opaque random ids, httpOnly + secure + SameSite cookies, absolute expiry, revocation honoured everywhere (`revoked_at`) |
| T: invite/reset token forgery | Single-use hashed tokens with expiry; consumed in one transaction |
| I: user enumeration | Login and forgot-password answer identically for unknown accounts |
| E: deactivated account use | Status checked at login; sessions revoked at deactivation and on mark-deceased |
| R: disputed sign-ins | `audit.auth_event` rows incl. source address |

### Authorization (every clinical read/write)

| Threat | Mitigation |
|---|---|
| E: horizontal privilege escalation (staff → out-of-care patient) | Three independent layers must agree: care-relationship scope in the SQL, the Cedar decision (generated from the matrix), and RLS as the backstop. Outsiders get 404, not 403 |
| E: vertical escalation (member → lead/admin actions) | Role grants in the matrix; A2 renders FROM the same artifact so drift is visible; step-up for credential resets |
| E: patient reading another patient | RLS realm policies key on `app.current_user_id()`; sessions cannot cross realms (B5) |
| R: silent reads | Same-transaction access events, including refusals and worklist subject lists |
| T: audit suppression | Audit INSERT-only for every role including the owner; daily export to versioned object storage (WP-29) |

### Attachments ⊕ (`modules/attachments`, `@mio/storage`, scan worker)

| Threat | Mitigation |
|---|---|
| T: malware distribution | Quarantine on upload; bytes served only from state `clean` after scanner promotion (ClamAV in deployments); rejected bytes deleted |
| T: content-type confusion / stored XSS | Magic-byte sniffing (png/jpeg/gif/webp only); served with the SNIFFED type, `nosniff`, and `Content-Security-Policy: default-src 'none'; sandbox` |
| D: oversized uploads | 8 MB body limit at the adapter |
| I: cross-patient access to bytes | Serving path runs the same authorize + audit as any clinical read; storage keys are unguessable and never exposed |
| T: path traversal (fs adapter) | Normalised-path prefix guard in the adapter and in the SPA server |

### Messaging and notifications

| Threat | Mitigation |
|---|---|
| I: clinical content in email | Contentless mail TYPES — no field can carry it; nudges say only "you have a message" |
| I: internal notes reaching patients | No patient RLS arm on `internal_note`; excluded from exports by construction |
| S: XSS via message content | Structured message doc (typed nodes), no HTML path; React escaping; strict CSP |

### Admin plane (WP-28)

| Threat | Mitigation |
|---|---|
| E: admin reading clinical data | No clinical grants for the role, no clinical queries in the module, patients as initials in A3 (X4) |
| E: stolen admin session resetting credentials | Step-up: the administrator re-enters their own password; failures are audited denials |

### HTTP layer (WP-30, `shared/hardening.ts`)

| Threat | Mitigation |
|---|---|
| S: clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| T: script injection | `default-src 'self'`; no inline script; hashed same-origin assets |
| I: downgrade / cookie exposure | HSTS in secure deployments; secure cookies |
| D: auth-surface flooding | Per-IP fixed window → 429 (per instance; see accepted risks) |

### Supply chain

`docs/security/soup-inventory.md` (18 runtime dependencies, each
justified), lockfile-pinned installs, `pnpm audit --prod` as a CI gate,
generated authz artifacts checked for freshness in CI.

## Accepted risks and open items

- **Email OTP shares a channel with password reset** (register R6): an
  attacker with mailbox access holds both factors, so sign-in is closer
  to one strong factor than true 2FA. **Accepted by the owner
  (2026-08-24)**; passkeys remain the mitigation path.
- **In-memory rate limit is per instance.** Horizontal scale multiplies
  the window by instance count. Accepted at pilot scale; move the
  counter to Postgres or the LB if instance count grows past a handful.
- **Style CSP allows `'unsafe-inline'`** for React Aria's positioning
  styles. Script CSP does not; residual risk is CSS-only injection,
  which the structured message doc gives no path to.
- **P2 (open):** should a dedicated auditor/DPO role replace
  administrator access to the full audit log? Matrix change when
  decided.
- **Container runs TypeScript via a dev loader** (WP-09 choice). The
  loader is part of the runtime SOUP surface and is pinned; a compiled
  image is a later hardening step.
- **Pen test pending** (WP-30's external half): commissioned against
  this document, priority targets ⊕ authentication and attachments.
  Findings land in the compliance register with owners.
