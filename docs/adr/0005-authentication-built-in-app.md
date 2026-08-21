# 0005. Authentication built in-app

- **Date:** 2026-08-21
- **Status:** Accepted

## Context

Mio manages its own user accounts; v1 has no external identity integrations.
The required behaviour is specific: no self-registration, accounts created from
the application side, a welcome email, password set on first login, email-code
MFA, terms and privacy acceptance, self-serve forgot-password, an
Administrator-performed reset that touches credentials but never data, a defined
session timeout policy, and **distinct, separate user bases for patients and
staff**.

Authorization is a separate concern, decided in ADR-0006.

## Decision

Authentication is **built inside the Mio API**. No external identity provider in
v1.

The implementation is specified in `docs/architecture/authentication.md`. The
load-bearing points:

- **Two account tables**, `identity.patient_account` and
  `identity.staff_account`, with separate session cookies, separate middleware
  and separate code paths — not one table with a discriminator column.
- **Argon2id** password hashing at OWASP parameters; NIST SP 800-63B policy with
  no composition rules and no forced rotation.
- **Opaque server-side sessions** stored in PostgreSQL, not JWTs.
- Email OTP codes and all invite/reset tokens stored **hashed**, single-use,
  short-lived, rate-limited, compared in constant time.
- All of it behind an `AuthenticationProvider` interface so that
  passkeys/WebAuthn and later Suomi.fi e-Identification or Swedish BankID can be
  added without touching application code.

## Consequences

- No additional stateful service to operate, upgrade or patch.
- Full control over the patient onboarding experience, which is the most
  fragile flow in the product — first-time users, often unwell, on phones.
- **We own every authentication vulnerability in this system, permanently.**
  This is the real cost and it is accepted deliberately. Mitigations: the
  authentication module gets a dedicated security review, is a named target in
  the pre-launch penetration test, and changes to it require review by a second
  engineer.
- Realm separation is our discipline rather than a product feature. Enforced by
  separate tables, separate code paths, and a CI test asserting no query joins
  across the two.
- Account lifecycle administration (create, deactivate, reset) is a UI we must
  build. It is a named work package.
- Email-delivered OTP is a weak second factor: it shares a channel with password
  reset. Accepted for v1 per the brief, recorded as an open risk in
  `docs/compliance/register.md`, and the reason the provider interface exists.

## Alternatives considered

**Keycloak, two realms.** The requirement list above is close to a description
of Keycloak's feature set, and two realms model the separate user bases
structurally. Rejected in favour of avoiding a stateful JVM service with its own
database and upgrade cadence, and because email OTP would likely have needed a
custom authenticator anyway. This is the fallback if in-app authentication
proves more costly than estimated.

**Entra External ID / GCP Identity Platform.** Rejected: binds Mio to a cloud
that is deliberately still undecided (ADR-0010).

**An off-the-shelf Node auth framework.** Rejected. Passport is dated; Lucia is
deprecated as a library and is now a learning resource. `node:crypto`,
`@node-rs/argon2` and a sessions table are the right amount of code, and fewer
dependencies means a smaller SOUP inventory (ADR-0009).
