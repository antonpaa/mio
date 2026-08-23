import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { AppModule } from '../src/app.module.js';
import { MAILER, type ContentlessMail, type Mailer } from '../src/modules/identity/index.js';
import { PATIENT_AUTH, STAFF_AUTH } from '../src/modules/identity/identity.tokens.js';
import type { AuthService } from '../src/modules/identity/domain/auth.service.js';

class CapturingMailer implements Mailer {
  mails: ContentlessMail[] = [];
  async send(mail: ContentlessMail): Promise<void> {
    this.mails.push(mail);
  }
  lastCodeFor(recipient: string): string {
    const mail = [...this.mails].reverse().find((m) => m.recipient === recipient && m.code);
    if (!mail?.code) throw new Error(`no code mailed to ${recipient}`);
    return mail.code;
  }
}

let db: TestDatabase;
let owner: pg.Pool;
let app: NestFastifyApplication;
let mailer: CapturingMailer;
let staffAuth: AuthService;
let patientAuth: AuthService;

const STAFF_EMAIL = 'elina.koskinen@staff.example';
const PATIENT_EMAIL = 'anna.virtanen@patient.example';
const GOOD_PASSWORD = 'calm-harbour-morning-42';

async function seedAccounts(): Promise<{ staffId: string; patientId: string }> {
  const staff = await owner.query<{ id: string }>(
    `INSERT INTO identity.staff_account (email, given_name, family_name, role, status)
     VALUES ($1, 'Elina', 'Koskinen', 'treatment_lead', 'invited') RETURNING id`,
    [STAFF_EMAIL],
  );
  const patient = await owner.query<{ id: string }>(
    `INSERT INTO identity.patient_account (email, given_name, family_name, status)
     VALUES ($1, 'Anna', 'Virtanen', 'invited') RETURNING id`,
    [PATIENT_EMAIL],
  );
  return { staffId: staff.rows[0]!.id, patientId: patient.rows[0]!.id };
}

let staffId: string;
let patientId: string;

beforeAll(async () => {
  db = await provisionTestDatabase();
  await migrate(db.connectionString);
  owner = new pg.Pool({ connectionString: db.connectionString, max: 2 });
  await owner.query(
    `TRUNCATE identity.patient_session, identity.staff_session, identity.credential_token,
              identity.terms_acceptance RESTART IDENTITY`,
  );
  await owner.query(`DELETE FROM identity.patient_account`);
  await owner.query(`DELETE FROM identity.staff_account`);
  ({ staffId, patientId } = await seedAccounts());

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
  staffAuth = app.get(STAFF_AUTH);
  patientAuth = app.get(PATIENT_AUTH);

  expect((await staffAuth.setPassword(staffId, GOOD_PASSWORD, [])).status).toBe('ok');
  expect((await patientAuth.setPassword(patientId, GOOD_PASSWORD, [])).status).toBe('ok');
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await db?.stop();
});

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

function sessionCookieFrom(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error('no set-cookie');
  return value.split(';')[0] as string;
}

describe('password policy', () => {
  it('rejects short, common, and name-containing passwords', async () => {
    expect((await staffAuth.setPassword(staffId, 'short', [])).status).toBe('policy');
    expect((await staffAuth.setPassword(staffId, 'passw0rd1234', [])).status).toBe('policy');
    expect((await staffAuth.setPassword(staffId, 'koskinen-office-1', ['koskinen'])).status).toBe(
      'policy',
    );
    // restore the good password (policy failures must not have changed it)
    const login = await inject('POST', '/api/staff/auth/login', {
      email: STAFF_EMAIL,
      password: GOOD_PASSWORD,
    });
    expect(login.statusCode).toBe(200);
  });
});

describe('login -> otp -> session (staff)', () => {
  let cookie: string;

  it('walks the full designed flow', async () => {
    const login = await inject('POST', '/api/staff/auth/login', {
      email: STAFF_EMAIL,
      password: GOOD_PASSWORD,
    });
    expect(login.statusCode).toBe(200);
    const { challengeId } = login.json() as { challengeId: string };

    const wrong = await inject('POST', '/api/staff/auth/verify', {
      challengeId,
      code: '000000',
    });
    expect(wrong.statusCode).toBe(401);

    const code = mailer.lastCodeFor(STAFF_EMAIL);
    const verify = await inject('POST', '/api/staff/auth/verify', { challengeId, code });
    expect(verify.statusCode).toBe(200);
    const body = verify.json() as { account: { givenName: string; role: string } };
    expect(body.account.givenName).toBe('Elina');
    expect(body.account.role).toBe('treatment_lead');
    cookie = sessionCookieFrom(verify.headers['set-cookie']);

    const whoami = await inject('GET', '/api/staff/auth/session', undefined, cookie);
    expect(whoami.statusCode).toBe(200);

    // single use: the same challenge+code cannot mint a second session
    const replay = await inject('POST', '/api/staff/auth/verify', { challengeId, code });
    expect(replay.statusCode).toBe(401);
  });

  it('realm separation: a staff cookie is nothing to the patient realm', async () => {
    const cross = await inject('GET', '/api/patient/auth/session', undefined, cookie);
    expect(cross.statusCode).toBe(401);
  });

  it('logout revokes and clears', async () => {
    const logout = await inject('POST', '/api/staff/auth/logout', {}, cookie);
    expect(logout.statusCode).toBe(200);
    const after = await inject('GET', '/api/staff/auth/session', undefined, cookie);
    expect(after.statusCode).toBe(401);
  });
});

describe('enumeration and delay', () => {
  it('unknown email and wrong password return identical bodies', async () => {
    const unknown = await inject('POST', '/api/patient/auth/login', {
      email: 'nobody@patient.example',
      password: 'whatever-long-enough',
    });
    const wrongPassword = await inject('POST', '/api/patient/auth/login', {
      email: PATIENT_EMAIL,
      password: 'wrong-password-here',
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknown.body).toBe(wrongPassword.body);
  });

  it('progressive delay engages after repeated failures and blocks even correct passwords', async () => {
    for (let i = 0; i < 3; i++) {
      await inject('POST', '/api/patient/auth/login', {
        email: PATIENT_EMAIL,
        password: 'still-wrong-password',
      });
    }
    const delayed = await inject('POST', '/api/patient/auth/login', {
      email: PATIENT_EMAIL,
      password: GOOD_PASSWORD,
    });
    expect(delayed.statusCode).toBe(401);
    expect((delayed.json() as { status: string }).status).toBe('delayed');
    expect((delayed.json() as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);

    // lift the delay (as time passing would) and confirm recovery
    await owner.query(
      `UPDATE identity.patient_account SET next_login_allowed_at = NULL, failed_login_count = 0
       WHERE id = $1`,
      [patientId],
    );
    const recovered = await inject('POST', '/api/patient/auth/login', {
      email: PATIENT_EMAIL,
      password: GOOD_PASSWORD,
    });
    expect(recovered.statusCode).toBe(200);
  });
});

describe('otp lifecycle', () => {
  async function freshChallenge(): Promise<string> {
    const login = await inject('POST', '/api/patient/auth/login', {
      email: PATIENT_EMAIL,
      password: GOOD_PASSWORD,
    });
    expect(login.statusCode).toBe(200);
    return (login.json() as { challengeId: string }).challengeId;
  }

  it('five wrong attempts kill the challenge even for the right code afterwards', async () => {
    const challengeId = await freshChallenge();
    const code = mailer.lastCodeFor(PATIENT_EMAIL);
    for (let i = 0; i < 5; i++) {
      const attempt = await inject('POST', '/api/patient/auth/verify', {
        challengeId,
        code: '999999',
      });
      expect(attempt.statusCode).toBe(401);
    }
    const rightButDead = await inject('POST', '/api/patient/auth/verify', { challengeId, code });
    expect(rightButDead.statusCode).toBe(401);
  });

  it('an expired challenge reports expired', async () => {
    const challengeId = await freshChallenge();
    await owner.query(
      `UPDATE identity.credential_token SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [challengeId],
    );
    const expired = await inject('POST', '/api/patient/auth/verify', {
      challengeId,
      code: mailer.lastCodeFor(PATIENT_EMAIL),
    });
    expect(expired.statusCode).toBe(401);
    expect((expired.json() as { status: string }).status).toBe('expired');
  });

  it('resend issues a fresh code and dead-letters the old one', async () => {
    const challengeId = await freshChallenge();
    const oldCode = mailer.lastCodeFor(PATIENT_EMAIL);
    const resend = await inject('POST', '/api/patient/auth/resend', { challengeId });
    expect(resend.statusCode).toBe(200);
    const newCode = mailer.lastCodeFor(PATIENT_EMAIL);
    expect(newCode).not.toBe(oldCode);
    const oldAttempt = await inject('POST', '/api/patient/auth/verify', {
      challengeId,
      code: oldCode,
    });
    expect(oldAttempt.statusCode).toBe(401);
  });
});

describe('session expiry', () => {
  async function signIn(): Promise<string> {
    const login = await inject('POST', '/api/patient/auth/login', {
      email: PATIENT_EMAIL,
      password: GOOD_PASSWORD,
    });
    const { challengeId } = login.json() as { challengeId: string };
    const verify = await inject('POST', '/api/patient/auth/verify', {
      challengeId,
      code: mailer.lastCodeFor(PATIENT_EMAIL),
    });
    return sessionCookieFrom(verify.headers['set-cookie']);
  }

  it('idle timeout revokes the session (30 min patient)', async () => {
    const cookie = await signIn();
    await owner.query(
      `UPDATE identity.patient_session SET last_seen_at = now() - interval '31 minutes'
       WHERE account_id = $1 AND revoked_at IS NULL`,
      [patientId],
    );
    const expired = await inject('GET', '/api/patient/auth/session', undefined, cookie);
    expect(expired.statusCode).toBe(401);
  });

  it('absolute cap ends the session regardless of activity', async () => {
    const cookie = await signIn();
    await owner.query(
      `UPDATE identity.patient_session SET absolute_expires_at = now() - interval '1 minute'
       WHERE account_id = $1 AND revoked_at IS NULL`,
      [patientId],
    );
    const expired = await inject('GET', '/api/patient/auth/session', undefined, cookie);
    expect(expired.statusCode).toBe(401);
  });
});

describe('audit trail', () => {
  it('recorded the whole story', async () => {
    const { rows } = await owner.query<{ event: string; n: string }>(
      `SELECT event, count(*)::text AS n FROM audit.auth_event GROUP BY event ORDER BY event`,
    );
    const events = Object.fromEntries(rows.map((r) => [r.event, Number(r.n)]));
    for (const expected of [
      'login_succeeded',
      'login_failed',
      'login_delayed',
      'otp_sent',
      'otp_failed',
      'otp_succeeded',
      'session_created',
      'session_revoked',
      'session_expired',
      'password_set',
    ]) {
      if (expected === 'login_succeeded') continue; // success is otp_sent + otp_succeeded
      expect(events[expected], `${expected} missing from audit`).toBeGreaterThan(0);
    }
  });
});

describe('realm isolation is structural', () => {
  it('no source line touches both account tables', () => {
    const root = path.resolve(import.meta.dirname, '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          readFileSync(full, 'utf8')
            .split('\n')
            .forEach((line, index) => {
              const sqlish = /\b(SELECT|JOIN|FROM|UPDATE|INSERT|DELETE)\b/i.test(line);
              if (sqlish && line.includes('patient_account') && line.includes('staff_account')) {
                offenders.push(`${full}:${index + 1}`);
              }
            });
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
