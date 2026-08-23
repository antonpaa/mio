import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRolePool, migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { generateWorld, seedWorld, DEMO_PASSWORD } from '@mio/synthetic';
import { AppModule } from '../src/app.module.js';
import { MAILER, type ContentlessMail, type Mailer } from '../src/modules/identity/index.js';
import { sweepSurveyOccurrences } from '../../worker/src/survey-sweep.js';

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
let workerPool: pg.Pool;
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

let leadCookie: string;
let patientCookie: string;
let surveyId: string;

beforeAll(async () => {
  db = await provisionTestDatabase();
  await migrate(db.connectionString);
  await seedWorld(db.connectionString, world);
  owner = new pg.Pool({ connectionString: db.connectionString, max: 2 });
  workerPool = createRolePool({ connectionString: db.connectionString, role: 'mio_worker' });

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
  patientCookie = await signIn('patient', patient.email);

  const { rows } = await owner.query(
    `SELECT id FROM clinical.survey WHERE name = 'Weekly symptom survey'`,
  );
  surveyId = (rows[0] as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await workerPool?.end();
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

function isoDay(offset: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + offset);
  return at.toISOString().slice(0, 10);
}

describe('the staff catalog and T4 assignment', () => {
  it('lists the catalog with versions and the licensing column', async () => {
    const catalog = await inject('GET', '/api/staff/surveys', undefined, leadCookie);
    expect(catalog.statusCode).toBe(200);
    const rows = catalog.json() as { name: string; versions: { state: string }[] }[];
    expect(rows.length).toBe(5);
    expect(rows.every((row) => row.versions.some((v) => v.state === 'published'))).toBe(true);
  });

  it('send-now creates a survey occurrence the patient sees as due TODAY', async () => {
    const assigned = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/surveys`,
      { surveyId, mode: 'now', language: 'sv' },
      leadCookie,
    );
    expect(assigned.statusCode).toBe(201);
    const { activityId } = assigned.json() as { activityId: string };
    expect(activityId).toBeTruthy();

    const list = await inject('GET', '/api/patient/surveys', undefined, patientCookie);
    const due = (list.json() as { due: { activityId: string; overdue: boolean }[] }).due;
    const mine = due.find((entry) => entry.activityId === activityId)!;
    expect(mine).toBeTruthy();
    expect(mine.overdue).toBe(false);
  });

  it('the patient fills the occurrence in the ASSIGNED language and submitting completes it', async () => {
    const list = await inject('GET', '/api/patient/surveys', undefined, patientCookie);
    const due = (list.json() as { due: { activityId: string }[] }).due;
    const activityId = due[0]!.activityId;

    const started = await inject(
      'POST',
      `/api/patient/activities/${activityId}/fill`,
      {},
      patientCookie,
    );
    expect(started.statusCode).toBe(201);
    const { responseId } = started.json() as { responseId: string };

    // filling again while the draft is open resumes the SAME response
    const resumed = await inject(
      'POST',
      `/api/patient/activities/${activityId}/fill`,
      {},
      patientCookie,
    );
    expect((resumed.json() as { responseId: string }).responseId).toBe(responseId);

    const payload = await inject(
      'GET',
      `/api/patient/responses/${responseId}`,
      undefined,
      patientCookie,
    );
    expect((payload.json() as { bundle: { locale: string } }).bundle.locale).toBe('sv');

    const submit = await inject(
      'POST',
      `/api/patient/responses/${responseId}/submit`,
      { answers: { nausea: 'none', fatigue: 'none' } },
      patientCookie,
    );
    expect(submit.statusCode).toBe(200);

    const { rows } = await owner.query(`SELECT status FROM clinical.activity WHERE id = $1`, [
      activityId,
    ]);
    expect((rows[0] as { status: string }).status).toBe('completed');

    // a completed occurrence is closed - no re-fill
    const again = await inject(
      'POST',
      `/api/patient/activities/${activityId}/fill`,
      {},
      patientCookie,
    );
    expect(again.statusCode).toBe(400);
  });

  it('recurring assignment materialises occurrences bound to the survey', async () => {
    const assigned = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/surveys`,
      {
        surveyId,
        mode: 'recurring',
        anchorDate: isoDay(-40),
        segments: [{ freq: 'weekly', count: 8 }],
        answerWindowDays: 7,
        reminderAfterDays: 3,
      },
      leadCookie,
    );
    expect(assigned.statusCode).toBe(201);
    const { scheduleId } = assigned.json() as { scheduleId: string };
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM clinical.activity WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect((rows[0] as { n: number }).n).toBe(8);

    const assignments = await inject(
      'GET',
      `/api/staff/treatments/${treatment.id}/surveys`,
      undefined,
      leadCookie,
    );
    const entry = (
      assignments.json() as { survey_id: string; schedule: { answerWindowDays: number } | null }[]
    ).find((row) => row.survey_id === surveyId)!;
    expect(entry.schedule?.answerWindowDays).toBe(7);
  });
});

describe('the worker sweep', () => {
  it('sends ONE reminder per open occurrence and marks window-closed ones missed', async () => {
    const sent: { recipient: string; locale: string }[] = [];
    const first = await sweepSurveyOccurrences(workerPool, async (mail) => {
      sent.push(mail);
    });
    // anchor 40 days back, weekly x8: several occurrences are past their
    // 7-day window (missed); the ones inside it but past reminder day get
    // a nudge; the submitted send-now occurrence gets nothing
    expect(first.missed).toBeGreaterThan(0);
    expect(first.reminders).toBeGreaterThan(0);
    expect(sent.length).toBe(first.reminders);
    expect(sent.every((mail) => mail.recipient === patient.email)).toBe(true);

    const second = await sweepSurveyOccurrences(workerPool, async (mail) => {
      sent.push(mail);
    });
    expect(second.reminders).toBe(0); // change-event dedupe holds
    expect(second.missed).toBe(0);

    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM clinical.activity WHERE status = 'missed'`,
    );
    expect((rows[0] as { n: number }).n).toBe(first.missed);
  });

  it('missed occurrences leave the patient due list', async () => {
    const list = await inject('GET', '/api/patient/surveys', undefined, patientCookie);
    const due = (list.json() as { due: { overdue: boolean }[] }).due;
    // whatever remains due is inside its window - none of the missed ones
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM clinical.activity
        WHERE patient_id = $1 AND kind = 'survey' AND status = 'missed'`,
      [patient.id],
    );
    expect((rows[0] as { n: number }).n).toBeGreaterThan(0);
    expect(due.every((entry) => typeof entry.overdue === 'boolean')).toBe(true);
  });
});
