import type pg from 'pg';
import { writeAuthEvent } from '@mio/db';
import type { AuthService, RealmTables } from './auth.service.js';
import { burnEqualWork } from './passwords.js';
import {
  hashLinkToken,
  INVITE_TTL_DAYS,
  linkTokenMatches,
  newLinkToken,
  RESET_TTL_MINUTES,
} from './tokens.js';
import { CURRENT_TERMS_VERSION } from './terms.js';
import type { ContentlessMail, Mailer } from '../ports/mailer.js';

/**
 * Account lifecycle around authentication: invitations, first login,
 * forgot/reset. Same realm discipline as AuthService - tables fixed at
 * construction, one instance per realm.
 */

export const STAFF_ACCOUNT_ROLES = ['clinician', 'author', 'administrator', 'auditor'] as const;
export type StaffAccountRole = (typeof STAFF_ACCOUNT_ROLES)[number];

export interface InviteInput {
  email: string;
  givenName: string;
  familyName: string;
  locale?: 'en' | 'fi' | 'sv';
  /** staff realm only: every role the account holds. At least one;
   * auditor never combines with anything else (segregation of duties). */
  roles?: readonly StaffAccountRole[];
  title?: string;
}

/** Shared by invite and role edits: the rules a staff role SET must obey. */
export function validateStaffRoles(roles: readonly string[]): StaffAccountRole[] {
  const unique = [...new Set(roles)];
  if (unique.length === 0) throw new Error('staff account requires at least one role');
  for (const role of unique) {
    if (!(STAFF_ACCOUNT_ROLES as readonly string[]).includes(role)) {
      throw new Error(`unknown staff role '${role}'`);
    }
  }
  if (unique.includes('auditor') && unique.length > 1) {
    throw new Error('auditor is an exclusive role');
  }
  // canonical order: every surface (list, edit echo, audit detail) sorts
  return (unique as StaffAccountRole[]).sort();
}

export type AcceptInviteResult =
  | { status: 'invalid' }
  | { status: 'policy'; message: string }
  | { status: 'terms_required' }
  | { status: 'otp_sent'; challengeId: string };

export class OnboardingService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly tables: RealmTables,
    private readonly auth: AuthService,
    private readonly mailer: Mailer,
    private readonly publicBaseUrl: string,
  ) {}

  get realm(): 'patient' | 'staff' {
    return this.tables.realm;
  }

  /** Creates (or re-invites) an account and mails the welcome link. */
  async createInvite(input: InviteInput): Promise<{ accountId: string; token: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await this.auth.findByEmail(client, input.email);
      let accountId: string;
      if (existing) {
        if (existing.status === 'deactivated') throw new Error('account is deactivated');
        accountId = existing.id;
      } else if (this.realm === 'staff') {
        const roles = validateStaffRoles(input.roles ?? []);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO identity.staff_account (email, given_name, family_name, locale, title)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            input.email,
            input.givenName,
            input.familyName,
            input.locale ?? 'en',
            input.title ?? null,
          ],
        );
        accountId = rows[0]!.id;
        for (const role of roles) {
          await client.query(
            `INSERT INTO identity.staff_account_role (account_id, role) VALUES ($1, $2)`,
            [accountId, role],
          );
        }
      } else {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO identity.patient_account (email, given_name, family_name, locale)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [input.email, input.givenName, input.familyName, input.locale ?? 'en'],
        );
        accountId = rows[0]!.id;
      }

      // A fresh invite dead-letters outstanding ones.
      await client.query(
        `UPDATE identity.credential_token SET consumed_at = now()
         WHERE realm = $1 AND account_id = $2 AND kind = 'invite' AND consumed_at IS NULL`,
        [this.realm, accountId],
      );
      const token = newLinkToken();
      await client.query(
        `INSERT INTO identity.credential_token (realm, account_id, kind, secret_hash, max_attempts, expires_at)
         VALUES ($1, $2, 'invite', $3, 1, now() + make_interval(days => $4))`,
        [this.realm, accountId, hashLinkToken(token), INVITE_TTL_DAYS],
      );
      await writeAuthEvent(client, { realm: this.realm, accountId, event: 'invite_created' });
      await this.mailer.send({
        recipient: input.email,
        kind: 'welcome_invite',
        locale: input.locale ?? 'en',
        deepLink: `${this.publicBaseUrl}/welcome/${token}`,
      } satisfies ContentlessMail);
      await client.query('COMMIT');
      return { accountId, token };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async findLiveToken(
    client: pg.ClientBase,
    kind: 'invite' | 'reset',
    token: string,
  ): Promise<{ id: string; account_id: string } | undefined> {
    // Tokens are random 256-bit values; look up by hash directly.
    const { rows } = await client.query<{ id: string; account_id: string; secret_hash: string }>(
      `SELECT id, account_id, secret_hash FROM identity.credential_token
       WHERE realm = $1 AND kind = $2 AND secret_hash = $3
         AND consumed_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [this.realm, kind, hashLinkToken(token)],
    );
    const row = rows[0];
    if (!row || !linkTokenMatches(row.secret_hash, token)) return undefined;
    return row;
  }

  /** L3 preview: who is being welcomed. */
  async inspectInvite(
    token: string,
  ): Promise<{ status: 'invalid' } | { status: 'ok'; givenName: string; email: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const live = await this.findLiveToken(client, 'invite', token);
      if (!live) {
        await client.query('COMMIT');
        return { status: 'invalid' };
      }
      const account = await this.auth.findById(client, live.account_id);
      await client.query('COMMIT');
      if (!account) return { status: 'invalid' };
      return { status: 'ok', givenName: account.given_name, email: account.email };
    } finally {
      client.release();
    }
  }

  /**
   * First login (L3): set password + accept terms in one step, then the
   * email OTP finalizes onboarding - so the account only ever becomes
   * active with terms on record.
   */
  async acceptInvite(
    token: string,
    password: string,
    acceptedTerms: boolean,
  ): Promise<AcceptInviteResult> {
    if (!acceptedTerms) return { status: 'terms_required' };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const live = await this.findLiveToken(client, 'invite', token);
      if (!live) {
        await client.query('COMMIT');
        return { status: 'invalid' };
      }
      const account = await this.auth.findById(client, live.account_id);
      if (!account) {
        await client.query('COMMIT');
        return { status: 'invalid' };
      }
      await client.query(`UPDATE identity.credential_token SET consumed_at = now() WHERE id = $1`, [
        live.id,
      ]);
      await client.query('COMMIT');

      // Policy check + hash happen through the auth service (revokes
      // sessions, audits password_set, activates the account).
      const set = await this.auth.setPassword(account.id, password, [
        account.given_name.toLowerCase(),
        account.family_name.toLowerCase(),
        account.email.split('@')[0]?.toLowerCase() ?? '',
      ]);
      if (set.status === 'policy') {
        // The token is spent by design even on a policy failure? No - that
        // would burn the invite on a typo. Re-open it.
        const reopen = await this.pool.connect();
        try {
          await reopen.query(
            `UPDATE identity.credential_token SET consumed_at = NULL WHERE id = $1`,
            [live.id],
          );
        } finally {
          reopen.release();
        }
        return { status: 'policy', message: set.message };
      }

      const record = await this.pool.connect();
      try {
        await record.query('BEGIN');
        await record.query(
          `INSERT INTO identity.terms_acceptance (realm, account_id, version) VALUES ($1, $2, $3)`,
          [this.realm, account.id, CURRENT_TERMS_VERSION],
        );
        await writeAuthEvent(record, {
          realm: this.realm,
          accountId: account.id,
          event: 'terms_accepted',
          detail: { version: CURRENT_TERMS_VERSION },
        });
        await writeAuthEvent(record, {
          realm: this.realm,
          accountId: account.id,
          event: 'invite_accepted',
        });
        await record.query('COMMIT');
      } catch (error) {
        await record.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        record.release();
      }

      // Straight into the designed OTP step.
      const login = await this.auth.beginLogin(account.email, password);
      if (login.status !== 'otp_sent') return { status: 'invalid' };
      return { status: 'otp_sent', challengeId: login.challengeId };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Forgot password: uniform response, equal work, mail on live accounts. */
  async requestReset(email: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await this.auth.findByEmail(client, email);
      if (!account || account.status !== 'active') {
        await burnEqualWork(email);
        await client.query('COMMIT');
        return;
      }
      await client.query(
        `UPDATE identity.credential_token SET consumed_at = now()
         WHERE realm = $1 AND account_id = $2 AND kind = 'reset' AND consumed_at IS NULL`,
        [this.realm, account.id],
      );
      const token = newLinkToken();
      await client.query(
        `INSERT INTO identity.credential_token (realm, account_id, kind, secret_hash, max_attempts, expires_at)
         VALUES ($1, $2, 'reset', $3, 1, now() + make_interval(mins => $4))`,
        [this.realm, account.id, hashLinkToken(token), RESET_TTL_MINUTES],
      );
      await writeAuthEvent(client, {
        realm: this.realm,
        accountId: account.id,
        event: 'password_reset_requested',
      });
      await this.mailer.send({
        recipient: account.email,
        kind: 'password_reset',
        locale: account.locale,
        deepLink: `${this.publicBaseUrl}/reset/${token}`,
      } satisfies ContentlessMail);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async completeReset(
    token: string,
    password: string,
  ): Promise<{ status: 'ok' } | { status: 'invalid' } | { status: 'policy'; message: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const live = await this.findLiveToken(client, 'reset', token);
      if (!live) {
        await client.query('COMMIT');
        return { status: 'invalid' };
      }
      const account = await this.auth.findById(client, live.account_id);
      if (!account) {
        await client.query('COMMIT');
        return { status: 'invalid' };
      }
      await client.query(`UPDATE identity.credential_token SET consumed_at = now() WHERE id = $1`, [
        live.id,
      ]);
      await client.query('COMMIT');

      const set = await this.auth.setPassword(account.id, password, [
        account.given_name.toLowerCase(),
        account.family_name.toLowerCase(),
      ]);
      if (set.status === 'policy') {
        const reopen = await this.pool.connect();
        try {
          await reopen.query(
            `UPDATE identity.credential_token SET consumed_at = NULL WHERE id = $1`,
            [live.id],
          );
        } finally {
          reopen.release();
        }
        return { status: 'policy', message: set.message };
      }
      const record = await this.pool.connect();
      try {
        await writeAuthEvent(record, {
          realm: this.realm,
          accountId: account.id,
          event: 'password_reset_completed',
        });
      } finally {
        record.release();
      }
      return { status: 'ok' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
