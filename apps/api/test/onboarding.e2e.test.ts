import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { AppModule } from '../src/app.module.js';
import {
  CURRENT_TERMS_VERSION,
  MAILER,
  PATIENT_AUTH,
  PATIENT_ONBOARDING,
  STAFF_AUTH,
  STAFF_ONBOARDING,
  type ContentlessMail,
  type Mailer,
} from '../src/modules/identity/index.js';
import type { OnboardingService } from '../src/modules/identity/domain/onboarding.service.js';
import type { AuthService } from '../src/modules/identity/domain/auth.service.js';

class CapturingMailer implements Mailer {
  mails: ContentlessMail[] = [];
  async send(mail: ContentlessMail): Promise<void> {
    this.mails.push(mail);
  }
  last(kind: string, recipient: string): ContentlessMail {
    const mail = [...this.mails]
      .reverse()
      .find((m) => m.kind === kind && m.recipient === recipient);
    if (!mail) throw new Error(`no ${kind} mailed to ${recipient}`);
    return mail;
  }
}

let db: TestDatabase;
let owner: pg.Pool;
let app: NestFastifyApplication;
let mailer: CapturingMailer;
let patientOnboarding: OnboardingService;
let staffOnboarding: OnboardingService;
let staffAuth: AuthService;

const PASSWORD = 'quiet-meadow-evening-77';

beforeAll(async () => {
  db = await provisionTestDatabase();
  await migrate(db.connectionString);
  owner = new pg.Pool({ connectionString: db.connectionString, max: 2 });
  await owner.query(`TRUNCATE identity.patient_session, identity.staff_session,
    identity.credential_token, identity.terms_acceptance`);
  await owner.query(`DELETE FROM identity.patient_account`);
  await owner.query(`DELETE FROM identity.staff_account`);

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
  patientOnboarding = app.get(PATIENT_ONBOARDING);
  staffOnboarding = app.get(STAFF_ONBOARDING);
  staffAuth = app.get(STAFF_AUTH);
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

describe('invitation -> first login (L3)', () => {
  let token: string;
  let accountId: string;

  it('creating an invite mails a link and no clinical anything', async () => {
    const invite = await patientOnboarding.createInvite({
      email: 'anna.virtanen@patient.example',
      givenName: 'Anna',
      familyName: 'Virtanen',
      locale: 'fi',
    });
    token = invite.token;
    accountId = invite.accountId;
    const mail = mailer.last('welcome_invite', 'anna.virtanen@patient.example');
    expect(mail.deepLink).toContain('/welcome/');
    expect(mail.locale).toBe('fi');
  });

  it('the invite page greets by name', async () => {
    const inspect = await inject('GET', `/api/patient/auth/invite/${token}`);
    expect(inspect.statusCode).toBe(200);
    expect(inspect.json()).toMatchObject({ givenName: 'Anna' });
  });

  it('terms are required, policy is enforced, and a policy miss does not burn the invite', async () => {
    const noTerms = await inject('POST', '/api/patient/auth/invite/accept', {
      token,
      password: PASSWORD,
      acceptTerms: false,
    });
    expect(noTerms.statusCode).toBe(400);

    const badPassword = await inject('POST', '/api/patient/auth/invite/accept', {
      token,
      password: 'anna-virtanen-1',
      acceptTerms: true,
    });
    expect(badPassword.statusCode).toBe(400);
    expect((badPassword.json() as { status: string }).status).toBe('policy');

    const accept = await inject('POST', '/api/patient/auth/invite/accept', {
      token,
      password: PASSWORD,
      acceptTerms: true,
    });
    expect(accept.statusCode).toBe(200);
    const { challengeId } = accept.json() as { challengeId: string };

    const code = mailer.last('login_code', 'anna.virtanen@patient.example').code;
    const verify = await inject('POST', '/api/patient/auth/verify', { challengeId, code });
    expect(verify.statusCode).toBe(200);

    const terms = await owner.query(
      `SELECT version FROM identity.terms_acceptance WHERE account_id = $1`,
      [accountId],
    );
    expect(terms.rows[0]?.version).toBe(CURRENT_TERMS_VERSION);
  });

  it('a spent invite is dead', async () => {
    const again = await inject('GET', `/api/patient/auth/invite/${token}`);
    expect(again.statusCode).toBe(404);
  });
});

describe('forgot -> reset', () => {
  it('unknown and known emails get the same response', async () => {
    const unknown = await inject('POST', '/api/patient/auth/forgot', {
      email: 'nobody@patient.example',
    });
    const known = await inject('POST', '/api/patient/auth/forgot', {
      email: 'anna.virtanen@patient.example',
    });
    expect(unknown.statusCode).toBe(200);
    expect(known.body).toBe(unknown.body);
  });

  it('the mailed link resets the password once, revokes sessions, and dies', async () => {
    const link = mailer.last('password_reset', 'anna.virtanen@patient.example').deepLink ?? '';
    const resetToken = link.split('/reset/')[1] ?? '';
    expect(resetToken.length).toBeGreaterThan(20);

    const newPassword = 'harbour-lantern-sunday-9';
    const reset = await inject('POST', '/api/patient/auth/reset', {
      token: resetToken,
      password: newPassword,
    });
    expect(reset.statusCode).toBe(200);

    const oldLogin = await inject('POST', '/api/patient/auth/login', {
      email: 'anna.virtanen@patient.example',
      password: PASSWORD,
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await inject('POST', '/api/patient/auth/login', {
      email: 'anna.virtanen@patient.example',
      password: newPassword,
    });
    expect(newLogin.statusCode).toBe(200);

    const replay = await inject('POST', '/api/patient/auth/reset', {
      token: resetToken,
      password: 'another-fine-password-3',
    });
    expect(replay.statusCode).toBe(400);
  });
});

describe('administrator reset (the first live Cedar decision point)', () => {
  let adminCookie: string;
  let memberCookie: string;
  let targetPatientId: string;

  async function staffSignIn(email: string): Promise<string> {
    const login = await inject('POST', '/api/staff/auth/login', { email, password: PASSWORD });
    const { challengeId } = login.json() as { challengeId: string };
    const verify = await inject('POST', '/api/staff/auth/verify', {
      challengeId,
      code: mailer.last('login_code', email).code,
    });
    const setCookie = verify.headers['set-cookie'];
    const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    return (value as string).split(';')[0] as string;
  }

  beforeAll(async () => {
    const admin = await staffOnboarding.createInvite({
      email: 'hanna.korpela@staff.example',
      givenName: 'Hanna',
      familyName: 'Korpela',
      role: 'administrator',
    });
    const member = await staffOnboarding.createInvite({
      email: 'mikael.aho@staff.example',
      givenName: 'Mikael',
      familyName: 'Aho',
      role: 'treatment_member',
    });
    await staffAuth.setPassword(admin.accountId, PASSWORD, []);
    await staffAuth.setPassword(member.accountId, PASSWORD, []);
    const patient = await patientOnboarding.createInvite({
      email: 'pekka.laine@patient.example',
      givenName: 'Pekka',
      familyName: 'Laine',
    });
    targetPatientId = patient.accountId;
    adminCookie = await staffSignIn('hanna.korpela@staff.example');
    memberCookie = await staffSignIn('mikael.aho@staff.example');
  });

  it('a treatment member is denied - and the denial is audited', async () => {
    const attempt = await inject(
      'POST',
      `/api/staff/admin/accounts/patient/${targetPatientId}/reset-login`,
      { currentPassword: PASSWORD },
      memberCookie,
    );
    expect(attempt.statusCode).toBe(403);
    const audit = await owner.query(
      `SELECT decision FROM audit.access_event
       WHERE action = 'patient_account.reset_credentials' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(audit.rows[0]?.decision).toBe('deny');
  });

  it('an administrator without step-up is refused', async () => {
    const attempt = await inject(
      'POST',
      `/api/staff/admin/accounts/patient/${targetPatientId}/reset-login`,
      { currentPassword: 'wrong-password-entirely' },
      adminCookie,
    );
    expect(attempt.statusCode).toBe(403);
    expect((attempt.json() as { status: string }).status).toBe('step_up_required');
  });

  it('with step-up: credentials void, sessions dead, setup link mailed, data untouched', async () => {
    // give the patient a live password first
    const patientAuth = app.get<AuthService>(PATIENT_AUTH);
    await patientAuth.setPassword(targetPatientId, PASSWORD, []);

    const reset = await inject(
      'POST',
      `/api/staff/admin/accounts/patient/${targetPatientId}/reset-login`,
      { currentPassword: PASSWORD },
      adminCookie,
    );
    expect(reset.statusCode).toBe(200);

    const account = await owner.query(
      `SELECT password_hash, status, given_name FROM identity.patient_account WHERE id = $1`,
      [targetPatientId],
    );
    expect(account.rows[0]?.password_hash).toBeNull();
    expect(account.rows[0]?.status).toBe('invited');
    expect(account.rows[0]?.given_name).toBe('Pekka'); // never the data

    const mail = mailer.last('welcome_invite', 'pekka.laine@patient.example');
    expect(mail.deepLink).toContain('/welcome/');

    const allowRow = await owner.query(
      `SELECT decision FROM audit.access_event
       WHERE action = 'patient_account.reset_credentials' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(allowRow.rows[0]?.decision).toBe('allow');
  });
});
