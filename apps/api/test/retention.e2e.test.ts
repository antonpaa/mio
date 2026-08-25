import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { generateWorld, seedWorld, DEMO_PASSWORD } from '@mio/synthetic';
import { AppModule } from '../src/app.module.js';
import { MAILER, type ContentlessMail, type Mailer } from '../src/modules/identity/index.js';

/**
 * WP-29: deceased-patient handling is a care decision with total
 * consequences - sign-in closes, sessions die, and the record stays.
 * And the finalised self-export carries the access history and the
 * attachment metadata the data model promises.
 */

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

const world = generateWorld('demo', 42);
const admin = world.staff.find((s) => s.roles.length === 1 && s.roles[0] === 'administrator')!;
const treatment = world.treatments.find((t) => {
  const team = world.teams.find((candidate) => candidate.id === t.teamId);
  return t.state === 'active' && (team?.leadIds.length ?? 0) > 0;
})!;
const team = world.teams.find((candidate) => candidate.id === treatment.teamId)!;
const lead = world.staff.find((s) => team.leadIds.includes(s.id))!;
const patient = world.patients.find((p) => p.id === treatment.patientId)!;
// a second patient under the SAME team, so the lead's disclosure below
// is an allowed read that lands in the access history
const spareTreatment = world.treatments.find(
  (t) =>
    t.teamId === treatment.teamId && t.patientId !== treatment.patientId && t.state === 'active',
)!;
const sparePatient = world.patients.find((p) => p.id === spareTreatment.patientId)!;

let adminCookie: string;
let leadCookie: string;

beforeAll(async () => {
  db = await provisionTestDatabase();
  await migrate(db.connectionString);
  await seedWorld(db.connectionString, world);
  owner = new pg.Pool({ connectionString: db.connectionString, max: 2 });

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
  adminCookie = await signIn('staff', admin.email);
  leadCookie = await signIn('staff', lead.email);
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

async function signIn(realm: 'staff' | 'patient', email: string): Promise<string> {
  const login = await inject('POST', `/api/${realm}/auth/login`, {
    email,
    password: DEMO_PASSWORD,
  });
  expect(login.statusCode).toBe(200);
  const { challengeId } = login.json() as { challengeId: string };
  const verify = await inject('POST', `/api/${realm}/auth/verify`, {
    challengeId,
    code: mailer.lastCodeFor(email),
  });
  expect(verify.statusCode).toBe(200);
  const setCookie = verify.headers['set-cookie'];
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (value as string).split(';')[0] as string;
}

describe('deceased-patient handling', () => {
  it('is a lead-only care decision that closes the account, once', async () => {
    const badDate = await inject(
      'POST',
      `/api/staff/patients/${patient.id}/deceased`,
      { date: 'yesterday' },
      leadCookie,
    );
    expect(badDate.statusCode).toBe(400);

    // the administrator plane deliberately cannot do this
    const adminTry = await inject(
      'POST',
      `/api/staff/patients/${patient.id}/deceased`,
      { date: '2026-08-20' },
      adminCookie,
    );
    expect(adminTry.statusCode).toBe(404);

    const marked = await inject(
      'POST',
      `/api/staff/patients/${patient.id}/deceased`,
      { date: '2026-08-20' },
      leadCookie,
    );
    expect(marked.statusCode).toBe(200);

    // sign-in is closed with the same shape as any deactivated account
    const login = await inject('POST', '/api/patient/auth/login', {
      email: patient.email,
      password: DEMO_PASSWORD,
    });
    expect(login.statusCode).not.toBe(200);

    // marking is not repeatable - the date is a fact, not a status flag
    const again = await inject(
      'POST',
      `/api/staff/patients/${patient.id}/deceased`,
      { date: '2026-08-21' },
      leadCookie,
    );
    expect(again.statusCode).toBe(400);

    // the profile carries the marker for the care side
    const profile = await inject('GET', `/api/staff/patients/${patient.id}`, undefined, leadCookie);
    expect((profile.json() as { deceasedOn: string | null }).deceasedOn).toBe('2026-08-20');

    // and a reminder to this patient refuses respectfully instead of mailing
    const { rows } = await owner.query(
      `SELECT id FROM clinical.activity
        WHERE patient_id = $1 AND kind = 'survey' AND status IN ('planned', 'confirmed')
        LIMIT 1`,
      [patient.id],
    );
    if (rows.length > 0) {
      const remind = await inject(
        'POST',
        `/api/staff/activities/${(rows[0] as { id: string }).id}/remind`,
        {},
        leadCookie,
      );
      expect(remind.statusCode).toBe(200);
      expect(remind.json()).toEqual({ sent: false, reason: 'patient_deceased' });
    }

    // >= because the audit tables are append-only across reruns on the
    // shared scratch cluster; the 400 above proves no double-marking
    const { rows: change } = await owner.query(
      `SELECT count(*)::int AS n FROM audit.change_event
        WHERE action = 'patient_account.mark_deceased' AND patient_id = $1`,
      [patient.id],
    );
    expect((change[0] as { n: number }).n).toBeGreaterThanOrEqual(1);
  });
});

describe('finalised self-export', () => {
  it('includes the access history and attachment metadata', async () => {
    const patientCookie = await signIn('patient', sparePatient.email);
    // create at least one staff disclosure to appear in the history
    await inject('GET', `/api/staff/patients/${sparePatient.id}`, undefined, leadCookie);
    const exported = await inject('POST', '/api/patient/privacy/export', {}, patientCookie);
    expect(exported.statusCode).toBe(200);
    const body = exported.json() as {
      format: string;
      accessHistory: { action: string }[];
      attachments: unknown[];
    };
    expect(body.format).toBe('mio-export/v1');
    expect(Array.isArray(body.attachments)).toBe(true);
    expect(body.accessHistory.length).toBeGreaterThan(0);
    expect(exported.body).not.toContain('internal_note');
  });
});
