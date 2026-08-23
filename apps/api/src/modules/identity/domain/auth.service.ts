import type pg from 'pg';
import { writeAuthEvent } from '@mio/db';
import { burnEqualWork, hashPassword, passwordPolicyError, verifyPassword } from './passwords.js';
import { delaySecondsFor } from './rate-limit.js';
import { generateOtpCode, hashOtp, OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES, otpMatches } from './otp.js';
import { newSessionId, SESSION_POLICY, type SessionRealm } from './session-ids.js';
import type { ContentlessMail, Mailer } from '../ports/mailer.js';

/**
 * One realm's authentication service. The table names are FIXED at
 * construction - a patient service physically cannot query staff tables.
 * Instantiated twice (patient, staff); never shared, never discriminated.
 */

export interface RealmTables {
  realm: SessionRealm;
  accountTable: 'identity.patient_account' | 'identity.staff_account';
  sessionTable: 'identity.patient_session' | 'identity.staff_session';
}

export const PATIENT_TABLES: RealmTables = {
  realm: 'patient',
  accountTable: 'identity.patient_account',
  sessionTable: 'identity.patient_session',
};

export const STAFF_TABLES: RealmTables = {
  realm: 'staff',
  accountTable: 'identity.staff_account',
  sessionTable: 'identity.staff_session',
};

export interface AccountRow {
  id: string;
  email: string;
  given_name: string;
  family_name: string;
  locale: 'en' | 'fi' | 'sv';
  status: 'invited' | 'active' | 'deactivated';
  password_hash: string | null;
  failed_login_count: number;
  next_login_allowed_at: Date | null;
  role?: string;
}

export type BeginLoginResult =
  | { status: 'invalid' }
  | { status: 'delayed'; retryAfterSeconds: number }
  | { status: 'otp_sent'; challengeId: string };

export type VerifyOtpResult =
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'session'; sessionId: string; account: AccountRow };

export type SessionState =
  { status: 'none' } | { status: 'active'; account: AccountRow; sessionId: string };

export class AuthService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly tables: RealmTables,
    private readonly mailer: Mailer,
    private readonly otpPepper: string,
  ) {}

  get realm(): SessionRealm {
    return this.tables.realm;
  }

  async findByEmail(client: pg.ClientBase, email: string): Promise<AccountRow | undefined> {
    const { rows } = await client.query<AccountRow>(
      `SELECT * FROM ${this.tables.accountTable} WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows[0];
  }

  async findById(client: pg.ClientBase, id: string): Promise<AccountRow | undefined> {
    const { rows } = await client.query<AccountRow>(
      `SELECT * FROM ${this.tables.accountTable} WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  /** Password check -> OTP challenge -> code mailed. Enumeration-uniform. */
  async beginLogin(email: string, password: string, sourceIp?: string): Promise<BeginLoginResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await this.findByEmail(client, email);

      if (!account || account.status !== 'active' || account.password_hash === null) {
        // Identical response and comparable work whether or not the account
        // exists - and the failure is still recorded.
        await burnEqualWork(password);
        await writeAuthEvent(client, {
          realm: this.realm,
          accountId: account?.id ?? null,
          event: 'login_failed',
          sourceIp: sourceIp ?? null,
          detail: { reason: account ? 'inactive_or_unset' : 'unknown_email' },
        });
        await client.query('COMMIT');
        return { status: 'invalid' };
      }

      if (account.next_login_allowed_at && account.next_login_allowed_at > new Date()) {
        const retryAfterSeconds = Math.ceil(
          (account.next_login_allowed_at.getTime() - Date.now()) / 1000,
        );
        await writeAuthEvent(client, {
          realm: this.realm,
          accountId: account.id,
          event: 'login_delayed',
          sourceIp: sourceIp ?? null,
        });
        await client.query('COMMIT');
        return { status: 'delayed', retryAfterSeconds };
      }

      const passwordOk = await verifyPassword(account.password_hash, password);
      if (!passwordOk) {
        const failed = account.failed_login_count + 1;
        const delay = delaySecondsFor(failed);
        await client.query(
          `UPDATE ${this.tables.accountTable}
             SET failed_login_count = $2,
                 next_login_allowed_at = CASE WHEN $3::int > 0
                   THEN now() + make_interval(secs => $3) ELSE NULL END
           WHERE id = $1`,
          [account.id, failed, delay],
        );
        await writeAuthEvent(client, {
          realm: this.realm,
          accountId: account.id,
          event: 'login_failed',
          sourceIp: sourceIp ?? null,
          detail: { failedCount: failed, delaySeconds: delay },
        });
        await client.query('COMMIT');
        return { status: 'invalid' };
      }

      await client.query(
        `UPDATE ${this.tables.accountTable}
           SET failed_login_count = 0, next_login_allowed_at = NULL WHERE id = $1`,
        [account.id],
      );

      const challengeId = await this.createOtpChallenge(client, account);
      await writeAuthEvent(client, {
        realm: this.realm,
        accountId: account.id,
        event: 'otp_sent',
        sourceIp: sourceIp ?? null,
      });
      await client.query('COMMIT');
      return { status: 'otp_sent', challengeId };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async createOtpChallenge(client: pg.ClientBase, account: AccountRow): Promise<string> {
    // A fresh code invalidates every outstanding one - codes never coexist.
    await client.query(
      `UPDATE identity.credential_token SET consumed_at = now()
       WHERE realm = $1 AND account_id = $2 AND kind = 'otp' AND consumed_at IS NULL`,
      [this.realm, account.id],
    );
    const code = generateOtpCode();
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO identity.credential_token (realm, account_id, kind, secret_hash, max_attempts, expires_at)
       VALUES ($1, $2, 'otp', 'pending', $3, now() + make_interval(mins => $4))
       RETURNING id`,
      [this.realm, account.id, OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES],
    );
    const challengeId = rows[0]?.id;
    if (!challengeId) throw new Error('otp challenge insert failed');
    await client.query(`UPDATE identity.credential_token SET secret_hash = $2 WHERE id = $1`, [
      challengeId,
      hashOtp(code, this.otpPepper, challengeId),
    ]);
    await this.mailer.send({
      recipient: account.email,
      kind: 'login_code',
      locale: account.locale,
      code,
    } satisfies ContentlessMail);
    return challengeId;
  }

  async resendOtp(challengeId: string): Promise<{ status: 'ok' | 'invalid' }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ account_id: string }>(
        `SELECT account_id FROM identity.credential_token
         WHERE id = $1 AND realm = $2 AND kind = 'otp' AND consumed_at IS NULL AND expires_at > now()`,
        [challengeId, this.realm],
      );
      const tokenRow = rows[0];
      if (!tokenRow) {
        await client.query('COMMIT');
        return { status: 'invalid' };
      }
      const account = await this.findById(client, tokenRow.account_id);
      if (!account) {
        await client.query('COMMIT');
        return { status: 'invalid' };
      }
      await this.createOtpChallenge(client, account);
      await writeAuthEvent(client, { realm: this.realm, accountId: account.id, event: 'otp_sent' });
      await client.query('COMMIT');
      return { status: 'ok' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyOtp(challengeId: string, code: string, sourceIp?: string): Promise<VerifyOtpResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        account_id: string;
        secret_hash: string;
        attempts: number;
        max_attempts: number;
        expires_at: Date;
        consumed_at: Date | null;
      }>(
        `SELECT id, account_id, secret_hash, attempts, max_attempts, expires_at, consumed_at
         FROM identity.credential_token
         WHERE id = $1 AND realm = $2 AND kind = 'otp' FOR UPDATE`,
        [challengeId, this.realm],
      );
      const token = rows[0];
      if (!token || token.consumed_at !== null) {
        await client.query('COMMIT');
        return { status: 'invalid' };
      }
      if (token.expires_at <= new Date()) {
        await client.query('COMMIT');
        return { status: 'expired' };
      }
      if (token.attempts >= token.max_attempts) {
        await client.query(
          `UPDATE identity.credential_token SET consumed_at = now() WHERE id = $1`,
          [token.id],
        );
        await client.query('COMMIT');
        return { status: 'invalid' };
      }

      const matches = otpMatches(token.secret_hash, code, this.otpPepper, token.id);
      if (!matches) {
        await client.query(
          `UPDATE identity.credential_token SET attempts = attempts + 1 WHERE id = $1`,
          [token.id],
        );
        await writeAuthEvent(client, {
          realm: this.realm,
          accountId: token.account_id,
          event: 'otp_failed',
          sourceIp: sourceIp ?? null,
        });
        await client.query('COMMIT');
        return { status: 'invalid' };
      }

      await client.query(`UPDATE identity.credential_token SET consumed_at = now() WHERE id = $1`, [
        token.id,
      ]);
      const account = await this.findById(client, token.account_id);
      if (!account || account.status !== 'active') {
        await client.query('COMMIT');
        return { status: 'invalid' };
      }

      const policy = SESSION_POLICY[this.realm];
      const sessionId = newSessionId();
      await client.query(
        `INSERT INTO ${this.tables.sessionTable} (id, account_id, absolute_expires_at)
         VALUES ($1, $2, now() + make_interval(hours => $3))`,
        [sessionId, account.id, policy.absoluteHours],
      );
      await writeAuthEvent(client, {
        realm: this.realm,
        accountId: account.id,
        event: 'otp_succeeded',
        sourceIp: sourceIp ?? null,
      });
      await writeAuthEvent(client, {
        realm: this.realm,
        accountId: account.id,
        event: 'session_created',
        sourceIp: sourceIp ?? null,
      });
      await client.query('COMMIT');
      return { status: 'session', sessionId, account };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Sliding idle window inside a hard absolute cap; expired -> revoked. */
  async validateSession(sessionId: string): Promise<SessionState> {
    if (!sessionId) return { status: 'none' };
    const policy = SESSION_POLICY[this.realm];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        account_id: string;
        last_seen_at: Date;
        absolute_expires_at: Date;
        revoked_at: Date | null;
      }>(`SELECT * FROM ${this.tables.sessionTable} WHERE id = $1 FOR UPDATE`, [sessionId]);
      const session = rows[0];
      if (!session || session.revoked_at !== null) {
        await client.query('COMMIT');
        return { status: 'none' };
      }
      const now = Date.now();
      const idleDeadline = session.last_seen_at.getTime() + policy.idleMinutes * 60_000;
      if (now > idleDeadline || now > session.absolute_expires_at.getTime()) {
        await client.query(
          `UPDATE ${this.tables.sessionTable} SET revoked_at = now() WHERE id = $1`,
          [sessionId],
        );
        await writeAuthEvent(client, {
          realm: this.realm,
          accountId: session.account_id,
          event: 'session_expired',
        });
        await client.query('COMMIT');
        return { status: 'none' };
      }
      await client.query(
        `UPDATE ${this.tables.sessionTable} SET last_seen_at = now() WHERE id = $1`,
        [sessionId],
      );
      const account = await this.findById(client, session.account_id);
      await client.query('COMMIT');
      if (!account || account.status !== 'active') return { status: 'none' };
      return { status: 'active', account, sessionId };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeSession(sessionId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ account_id: string }>(
        `UPDATE ${this.tables.sessionTable} SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL RETURNING account_id`,
        [sessionId],
      );
      const revoked = rows[0];
      if (revoked) {
        await writeAuthEvent(client, {
          realm: this.realm,
          accountId: revoked.account_id,
          event: 'session_revoked',
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeAllSessions(client: pg.ClientBase, accountId: string): Promise<void> {
    await client.query(
      `UPDATE ${this.tables.sessionTable} SET revoked_at = now()
       WHERE account_id = $1 AND revoked_at IS NULL`,
      [accountId],
    );
    await writeAuthEvent(client, {
      realm: this.realm,
      accountId,
      event: 'session_revoked',
      detail: { scope: 'all' },
    });
  }

  /** Sets a password (policy-checked) and revokes every session. */
  async setPassword(
    accountId: string,
    password: string,
    forbiddenFragments: readonly string[],
  ): Promise<{ status: 'ok' } | { status: 'policy'; message: string }> {
    const message = passwordPolicyError({ password, forbiddenFragments });
    if (message !== null) return { status: 'policy', message };
    const passwordHash = await hashPassword(password);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ${this.tables.accountTable}
           SET password_hash = $2, password_set_at = now(), status = 'active',
               failed_login_count = 0, next_login_allowed_at = NULL
         WHERE id = $1`,
        [accountId, passwordHash],
      );
      await this.revokeAllSessions(client, accountId);
      await writeAuthEvent(client, { realm: this.realm, accountId, event: 'password_set' });
      await client.query('COMMIT');
      return { status: 'ok' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
