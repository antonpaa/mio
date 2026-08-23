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
 * WP-27: the C1 worklists - overdue occurrences with the manual
 * reminder (contentless, P8-honouring) and the week's agenda, both
 * care-scoped with one list-level access event.
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
const treatment = world.treatments.find((t) => {
  const team = world.teams.find((candidate) => candidate.id === t.teamId);
  return (
    t.state === 'active' &&
    t.surveyKeys.includes('weekly-symptoms') &&
    (team?.leadIds.length ?? 0) > 0
  );
})!;
const team = world.teams.find((candidate) => candidate.id === treatment.teamId)!;
const lead = world.staff.find((s) => team.leadIds.includes(s.id))!;
const patient = world.patients.find((p) => p.id === treatment.patientId)!;
const outsider = world.staff.find(
  (s) =>
    !team.memberIds.includes(s.id) &&
    !team.leadIds.includes(s.id) &&
    !(world.careRelationships.get(patient.id) ?? []).includes(s.id),
)!;

let leadCookie: string;
let outsiderCookie: string;
let patientCookie: string;
let surveyId: string;
let overdueActivityId: string;

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
  leadCookie = await signIn('staff', lead.email);
  outsiderCookie = await signIn('staff', outsider.email);
  patientCookie = await signIn('patient', patient.email);

  const { rows } = await owner.query(
    `SELECT id FROM clinical.survey WHERE name = 'Weekly symptom survey'`,
  );
  surveyId = (rows[0] as { id: string }).id;

  // an occurrence assigned now, shifted into the past = overdue
  const assigned = await inject(
    'POST',
    `/api/staff/treatments/${treatment.id}/surveys`,
    { surveyId, mode: 'now' },
    leadCookie,
  );
  overdueActivityId = (assigned.json() as { activityId: string }).activityId;
  await owner.query(
    `UPDATE clinical.activity SET occurrence_date = current_date - 3 WHERE id = $1`,
    [overdueActivityId],
  );
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await db?.stop();
});

function inject(method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, cookie?: string) {
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

async function signIn(realm: 'patient' | 'staff', email: string): Promise<string> {
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

describe('the overdue worklist', () => {
  it('lists the missed occurrence for the team, never for an outsider', async () => {
    const mine = await inject('GET', '/api/staff/dashboard/overdue', undefined, leadCookie);
    expect(mine.statusCode).toBe(200);
    const rows = mine.json() as { id: string; survey_name: string; patient_given: string }[];
    const row = rows.find((entry) => entry.id === overdueActivityId)!;
    expect(row.survey_name).toBe('Weekly symptom survey');
    expect(row.patient_given).toBe(patient.givenName);

    const theirs = await inject('GET', '/api/staff/dashboard/overdue', undefined, outsiderCookie);
    expect(theirs.statusCode).toBe(200);
    expect(
      (theirs.json() as { id: string }[]).some((entry) => entry.id === overdueActivityId),
    ).toBe(false);
  });

  it('the manual reminder sends one contentless mail and marks the occurrence', async () => {
    mailer.mails.length = 0;
    const reminded = await inject(
      'POST',
      `/api/staff/activities/${overdueActivityId}/remind`,
      {},
      leadCookie,
    );
    expect(reminded.statusCode).toBe(200);
    expect(reminded.json()).toEqual({ sent: true });
    const mail = mailer.mails.find((entry) => entry.kind === 'survey_reminder')!;
    expect(mail.recipient).toBe(patient.email);
    expect(JSON.stringify(mail)).not.toContain('symptom'); // never the survey name
    const { rows } = await owner.query(`SELECT reminded_at FROM clinical.activity WHERE id = $1`, [
      overdueActivityId,
    ]);
    expect((rows[0] as { reminded_at: string | null }).reminded_at).not.toBeNull();
  });

  it('a declined email preference sends nothing - and says so', async () => {
    const declined = await inject(
      'PUT',
      '/api/patient/settings/notifications',
      { emailPrefs: { survey_reminder: false } },
      patientCookie,
    );
    expect(declined.statusCode).toBe(200);
    mailer.mails.length = 0;
    const reminded = await inject(
      'POST',
      `/api/staff/activities/${overdueActivityId}/remind`,
      {},
      leadCookie,
    );
    expect(reminded.statusCode).toBe(200);
    expect(reminded.json()).toEqual({ sent: false, reason: 'email_declined' });
    expect(mailer.mails.some((entry) => entry.kind === 'survey_reminder')).toBe(false);
  });
});

describe('the agenda', () => {
  it('shows this week for care patients only', async () => {
    const assigned = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/surveys`,
      { surveyId, mode: 'now' },
      leadCookie,
    );
    const todayActivityId = (assigned.json() as { activityId: string }).activityId;

    const agenda = await inject('GET', '/api/staff/dashboard/agenda', undefined, leadCookie);
    expect(agenda.statusCode).toBe(200);
    const rows = agenda.json() as { id: string; patient_given: string }[];
    const row = rows.find((entry) => entry.id === todayActivityId)!;
    expect(row.patient_given).toBe(patient.givenName);

    const theirs = await inject('GET', '/api/staff/dashboard/agenda', undefined, outsiderCookie);
    expect((theirs.json() as { id: string }[]).some((entry) => entry.id === todayActivityId)).toBe(
      false,
    );
  });
});
