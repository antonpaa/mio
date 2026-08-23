-- 0003 Identity: the two realms, sessions, credential tokens, terms.
--
-- TWO account tables, not one with a discriminator (ADR-0005): a bug in the
-- patient login flow must have no reachable path into staff accounts. The
-- CI test asserting no query joins across them lives in apps/api.

CREATE TABLE identity.patient_account (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL,
  given_name            text NOT NULL,
  family_name           text NOT NULL,
  locale                text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'fi', 'sv')),
  timezone              text NOT NULL DEFAULT 'Europe/Helsinki',
  date_of_birth         date,
  phone                 text,
  address               jsonb,
  status                text NOT NULL DEFAULT 'invited'
                        CHECK (status IN ('invited', 'active', 'deactivated')),
  password_hash         text,
  password_set_at       timestamptz,
  failed_login_count    integer NOT NULL DEFAULT 0,
  next_login_allowed_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX patient_account_email_idx ON identity.patient_account (lower(email));

CREATE TABLE identity.staff_account (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL,
  given_name            text NOT NULL,
  family_name           text NOT NULL,
  locale                text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'fi', 'sv')),
  role                  text NOT NULL
                        CHECK (role IN ('treatment_member', 'treatment_lead', 'administrator')),
  title                 text,
  status                text NOT NULL DEFAULT 'invited'
                        CHECK (status IN ('invited', 'active', 'deactivated')),
  password_hash         text,
  password_set_at       timestamptz,
  failed_login_count    integer NOT NULL DEFAULT 0,
  next_login_allowed_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_account_email_idx ON identity.staff_account (lower(email));

-- Opaque server-side sessions, one table PER REALM - separate code paths
-- all the way down. Ids are 256-bit random, never sequential.
CREATE TABLE identity.patient_session (
  id                  text PRIMARY KEY,
  account_id          uuid NOT NULL REFERENCES identity.patient_account (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz
);
CREATE INDEX patient_session_account_idx ON identity.patient_session (account_id);

CREATE TABLE identity.staff_session (
  id                  text PRIMARY KEY,
  account_id          uuid NOT NULL REFERENCES identity.staff_account (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz
);
CREATE INDEX staff_session_account_idx ON identity.staff_session (account_id);

-- Invites, resets and OTP challenges share one token pattern: single-use,
-- HASHED at rest, short-TTL, attempt-limited, bound to one account.
CREATE TABLE identity.credential_token (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm        text NOT NULL CHECK (realm IN ('patient', 'staff')),
  account_id   uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('invite', 'reset', 'otp')),
  secret_hash  text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credential_token_account_idx ON identity.credential_token (realm, account_id, kind);

CREATE TABLE identity.terms_acceptance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm       text NOT NULL CHECK (realm IN ('patient', 'staff')),
  account_id  uuid NOT NULL,
  version     text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX terms_acceptance_account_idx ON identity.terms_acceptance (realm, account_id);
