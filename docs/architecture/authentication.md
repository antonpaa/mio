# Authentication

Mio builds authentication in-app
([ADR-0005](../adr/0005-authentication-built-in-app.md)). This document is the
specification for that work package.

Authorization is a separate concern — see
[`authorization.md`](authorization.md).

> Building authentication rather than buying it converts a vendor feature list
> into work we own. The list below is that work, enumerated, because this is the
> part of a system that is routinely under-scoped.

## Two user bases means two of everything

`identity.patient_account` and `identity.staff_account` are separate tables,
with separate session cookies, separate middleware and separate code paths.

Not one table with a `type` column. With a discriminator, one missing `WHERE`
clause crosses the realm boundary; with separate tables and separate code paths,
a bug in the patient login flow has no reachable path into staff accounts.

A CI test asserts that no query joins across the two account tables.

The realms differ in more than storage: session timeouts, password policy,
lockout behaviour and onboarding flow are all realm-specific.

## Passwords

- **Argon2id** via `@node-rs/argon2`, at OWASP parameters — m = 19456 KiB,
  t = 2, p = 1 as the floor. Parameters are configuration, reviewed periodically.
- Policy follows **NIST SP 800-63B**: minimum 12 characters, screened against a
  local common-password list, **no composition rules and no forced rotation**.
  Both of those measurably worsen real-world security, and clinicians rotating
  passwords on shift produce predictable ones.
- Password changes revoke all of that user's sessions.

## Sessions

**Opaque server-side session identifiers stored in PostgreSQL. Not JWTs.**

This is deliberate and should not be revisited casually. Mio needs instant
revocation for account deactivation, administrator reset, and logout-everywhere.
A JWT cannot be revoked without a blocklist, and a blocklist is a session table
with extra steps and worse failure modes.

| | Patient | Staff |
|---|---|---|
| Idle timeout | ~30 min | ~15 min |
| Absolute cap | 8–12 h | 8–12 h |

- Cookie: `httpOnly; Secure; SameSite=Lax`, scoped per realm.
- Session identifier rotates on login and on any privilege change.
- Sliding renewal within the idle window, hard stop at the absolute cap.
- Staff work on shared workstations, so a visible session timer and a fast
  re-lock are UX requirements, not niceties.

## Email OTP

- Six digits from a CSPRNG.
- **Stored hashed**, never in plaintext.
- 5–10 minute TTL, single-use, invalidated on use.
- Maximum 5 attempts, then the code is invalidated entirely.
- A fresh code on every resend; codes are never reused.
- Constant-time comparison.
- Rate-limited per account **and** per IP.

> **Known weakness.** Email-delivered OTP shares a channel with password reset,
> so it is a weak second factor. Accepted for v1 per the brief, recorded as an
> open risk in [`../compliance/register.md`](../compliance/register.md), and the
> reason the provider interface below exists.

## Invite and reset tokens

Invites and password resets use one token pattern: single-use, **hashed at
rest**, short TTL (invites ~7 days, resets ~1 hour), bound to a specific account.

Forgot-password must return an **identical response, in identical time**, whether
or not the account exists. Otherwise it is an account enumeration oracle — and on
a cancer treatment system, "does this email address have an account" is itself
sensitive information about a person's health. This is a stronger requirement
here than in an ordinary product, and it needs an explicit test.

## Account lifecycle

No self-registration. Accounts are created from the application side.

```
Administrator creates account
        │
        ▼
  Welcome email  ── contains a link and no clinical content whatsoever
        │
        ▼
  Set password  ──►  Accept terms & privacy  ──►  Email OTP  ──►  Active
                     (version recorded)
```

Terms acceptance records *which version* was accepted and when. A new version
re-prompts.

**Administrator reset** requires step-up re-authentication from the
administrator, touches credentials only, and never data. The schema split in
[ADR-0007](../adr/0007-separate-identity-from-clinical-data.md) is what makes
"never the user's data" enforceable rather than promised: the administration
path has no grant on `clinical.*`.

**Deactivation** revokes all sessions immediately and voids outstanding tokens.

## Rate limiting and lockout

**Progressive delay, not hard lockout.** A hard lockout on a clinical system is a
denial-of-service vector against clinicians mid-shift — an attacker who knows a
clinician's email address can lock them out of patient care. Progressive delay
raises attacker cost without handing them that capability.

Rate limits apply per account and per source address, on login, OTP verification,
OTP resend and reset requests.

Login must not leak account existence through response timing.

## Audit

Every authentication event writes to `audit.auth_event`:

login success, login failure, MFA success, MFA failure, password change, reset
requested, reset completed, session created, session destroyed, and every
administrator credential action.

## The provider interface

All of the above sits behind an `AuthenticationProvider` interface.

This seam will get used. Swedish healthcare practice expects staff accessing
patient records to authenticate with a strong e-ID (SITHS or BankID), and email
OTP is unlikely to satisfy that. The expected sequence:

| | |
|---|---|
| v1 | Password + email OTP |
| Fast-follow | Passkeys / WebAuthn — better security *and* better patient UX on phones |
| v2 | Suomi.fi e-Identification, Swedish BankID |

Nothing in application code should know which provider is in use.

## Dependencies

`node:crypto` and `@node-rs/argon2`, plus a sessions table. That is the right
amount of code.

Do not add an auth framework. Passport is dated; Lucia is deprecated as a
library and now exists as a learning resource. Fewer dependencies also means a
smaller SOUP inventory
([ADR-0009](../adr/0009-iec-62304-shaped-development.md)).

## Review obligations

- A dedicated security review of this module before it ships.
- A named target in the pre-launch penetration test.
- Changes require review by a second engineer.
