import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { AppModule } from '../src/app.module.js';
import { MAILER, type ContentlessMail, type Mailer } from '../src/modules/identity/index.js';
import { bootstrapAdmin } from '../src/cli/bootstrap-admin.js';

/**
 * The break-glass bootstrap (decided 2026-08-24): an EMPTY system's
 * first administrator is created from outside it, with the operator's
 * owner credentials, and the printed welcome link works end to end -
 * accept, sign in, and stand in A1 able to create everyone else. The
 * out-of-band act itself is on the audit trail.
 */

class CapturingMailer implements Mailer {
  mails: ContentlessMail[] = [];
  async send(mail: ContentlessMail): Promise<void> {
    this.mails.push(mail);
  }
}

let db: TestDatabase;
let owner: pg.Pool;
let app: NestFastifyApplication;
let mailer: CapturingMailer;

beforeAll(async () => {
  db = await provisionTestDatabase();
  await migrate(db.connectionString);
  // deliberately NO seed: the point is the empty system
  owner = new pg.Pool({ connectionString: db.connectionString, max: 2 });
  await owner.query(`DELETE FROM identity.credential_token WHERE realm = 'staff'`);
  await owner.query(`UPDATE identity.staff_session SET revoked_at = now()`);
  // the shared scratch database persists across runs AND across suite
  // files - remove this suite's fixture accounts on the way in (so every
  // run exercises the true first-run path) and on the way out (so the
  // other suites' seed never sees them). The audit trail stays, as it must.
  await removeFixtureAccounts();

  process.env['MIO_DATABASE_URL'] = db.connectionString;
  process.env['MIO_OTP_PEPPER'] = 'test-pepper-not-for-production';
  process.env['MIO_COOKIE_SECURE'] = 'false';

  mailer = new CapturingMailer();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await removeFixtureAccounts();
  await owner?.end();
  await db?.stop();
});

async function removeFixtureAccounts(): Promise<void> {
  for (const email of ['first.admin@bootstrap.example', 'lead@bootstrap.example']) {
    await owner.query(
      `WITH doomed AS (SELECT id FROM identity.staff_account WHERE lower(email) = lower($1)),
            s AS (DELETE FROM identity.staff_session WHERE account_id IN (SELECT id FROM doomed)),
            m AS (DELETE FROM identity.team_membership WHERE staff_id IN (SELECT id FROM doomed)),
            t AS (DELETE FROM identity.credential_token
                   WHERE realm = 'staff' AND account_id IN (SELECT id FROM doomed)),
            a AS (DELETE FROM identity.terms_acceptance
                   WHERE realm = 'staff' AND account_id IN (SELECT id FROM doomed))
       DELETE FROM identity.staff_account WHERE id IN (SELECT id FROM doomed)`,
      [email],
    );
  }
}

function inject(method: 'GET' | 'POST', url: string, payload?: object, cookie?: string) {
  return app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      ...(payload !== undefined ? { payload } : {}),
      ...(cookie !== undefined ? { headers: { cookie } } : {}),
    });
}

describe('break-glass bootstrap', () => {
  it('creates the first administrator out of band; the link works end to end', async () => {
    const result = await bootstrapAdmin(db.connectionString, {
      email: 'first.admin@bootstrap.example',
      givenName: 'First',
      familyName: 'Admin',
      locale: 'fi',
    });
    expect(result.reinvited).toBe(false);
    expect(result.welcomePath).toMatch(/^\/welcome\//);
    const token = result.welcomePath.split('/').pop()!;

    // the out-of-band act is on the trail, marked as such
    const { rows } = await owner.query(
      `SELECT detail FROM audit.change_event
        WHERE action = 'staff_account.bootstrap' AND resource_id = $1`,
      [result.accountId],
    );
    expect(rows.length).toBe(1);
    expect((rows[0] as { detail: { bootstrap: boolean } }).detail.bootstrap).toBe(true);

    // the printed link is a real invite: accept, then sign in
    // NB: the password policy bans your own name - 'first'/'admin' would 400
    const accept = await inject('POST', '/api/staff/auth/invite/accept', {
      token,
      password: 'correct-horse-battery-42',
      acceptTerms: true,
    });
    expect(accept.statusCode).toBe(200);
    const { challengeId } = accept.json() as { challengeId: string };
    const code = [...mailer.mails]
      .reverse()
      .find((m) => m.recipient === 'first.admin@bootstrap.example' && m.code)!.code!;
    const verify = await inject('POST', '/api/staff/auth/verify', { challengeId, code });
    expect(verify.statusCode).toBe(200);
    const setCookie = verify.headers['set-cookie'];
    const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;

    // standing in A1, able to create everyone else
    const users = await inject('GET', '/api/admin/users', undefined, cookie);
    expect(users.statusCode).toBe(200);

    // running it again re-invites rather than duplicating
    const again = await bootstrapAdmin(db.connectionString, {
      email: 'first.admin@bootstrap.example',
      givenName: 'First',
      familyName: 'Admin',
    });
    expect(again.reinvited).toBe(true);
    expect(again.accountId).toBe(result.accountId);

    // and it refuses to escalate an existing non-administrator
    await owner.query(
      `WITH created AS (
         INSERT INTO identity.staff_account (email, given_name, family_name)
         VALUES ('lead@bootstrap.example', 'Some', 'Lead')
         ON CONFLICT DO NOTHING RETURNING id
       )
       INSERT INTO identity.staff_account_role (account_id, role)
       SELECT id, 'clinician' FROM created`,
    );
    await expect(
      bootstrapAdmin(db.connectionString, {
        email: 'lead@bootstrap.example',
        givenName: 'Some',
        familyName: 'Lead',
      }),
    ).rejects.toThrow(/refusing to escalate/);
  });
});
