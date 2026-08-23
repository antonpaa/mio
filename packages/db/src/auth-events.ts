import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/** Auth events (docs/architecture/authentication.md): every login success
 * and failure, MFA outcome, credential change and session lifecycle step.
 * Same INSERT-only posture as access events; id generated client-side. */
export interface AuthEventInput {
  realm: 'patient' | 'staff';
  accountId: string | null;
  event:
    | 'login_succeeded'
    | 'login_failed'
    | 'login_delayed'
    | 'otp_sent'
    | 'otp_succeeded'
    | 'otp_failed'
    | 'session_created'
    | 'session_revoked'
    | 'session_expired'
    | 'password_set'
    | 'password_reset_requested'
    | 'password_reset_completed'
    | 'invite_created'
    | 'invite_accepted'
    | 'terms_accepted'
    | 'account_deactivated'
    | 'admin_reset_login';
  sourceIp?: string | null;
  detail?: object;
}

export async function writeAuthEvent(
  client: pg.ClientBase,
  event: AuthEventInput,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO audit.auth_event (id, realm, account_id, event, source_ip, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      event.realm,
      event.accountId,
      event.event,
      event.sourceIp ?? null,
      JSON.stringify(event.detail ?? {}),
    ],
  );
  return id;
}
