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

/**
 * WP-20: trend rules over consecutive occurrences. A repeat fires on the
 * submission that completes the run; a missed-response rule fires from
 * the worker when the window closes; outcomes combine (alert + custom
 * notification + rule-created task); and nothing ever double-fires.
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
let workerPool: pg.Pool;
let app: NestFastifyApplication;
let mailer: CapturingMailer;

const world = generateWorld('demo', 42);
const treatment = world.treatments.find((t) => {
  const team = world.teams.find((candidate) => candidate.id === t.teamId);
  return t.state === 'active' && (team?.leadIds.length ?? 0) > 0;
})!;
const team = world.teams.find((candidate) => candidate.id === treatment.teamId)!;
const lead = world.staff.find((s) => team.leadIds.includes(s.id))!;
const patient = world.patients.find((p) => p.id === treatment.patientId)!;

const DEFINITION = {
  kind: 'generic',
  pages: [
    {
      id: 'page-1',
      questions: [
        {
          id: 'q-mood',
          type: 'choice_single',
          required: true,
          options: [{ id: 'o-ok' }, { id: 'o-low' }],
        },
      ],
    },
  ],
  trendRules: [
    {
      id: 'r-low-run',
      when: {
        kind: 'repeat',
        questionId: 'q-mood',
        match: { kind: 'option', optionId: 'o-low' },
        times: 2,
      },
      outcomes: [
        { kind: 'alert', severity: 'moderate' },
        { kind: 'notify', recipients: ['team', 'patient'] },
        { kind: 'task' },
      ],
    },
    {
      id: 'r-missed',
      when: { kind: 'missed', times: 2 },
      outcomes: [{ kind: 'notify', recipients: ['lead'] }, { kind: 'task' }],
    },
  ],
};

const LOCALES = [
  {
    locale: 'en',
    title: 'Mood check',
    questions: { 'q-mood': { label: 'Mood today', options: { 'o-ok': 'Okay', 'o-low': 'Low' } } },
    rules: {
      'r-low-run': {
        notifyText: 'Mood has been low two check-ins in a row.',
        taskTitle: 'Call the patient',
      },
      'r-missed': {
        notifyText: 'Two check-ins in a row were missed.',
        taskTitle: 'Follow up on missed check-ins',
      },
    },
  },
  { locale: 'fi', title: '', questions: {} },
  { locale: 'sv', title: '', questions: {} },
];

let leadCookie: string;
let patientCookie: string;
let surveyId: string;
let scheduleId: string;

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

  // author + publish the trend-carrying survey through the builder API
  const created = await inject(
    'POST',
    '/api/staff/surveys',
    { name: 'Mood check', kind: 'generic' },
    leadCookie,
  );
  const { surveyId: sid, versionId } = created.json() as { surveyId: string; versionId: string };
  surveyId = sid;
  const saved = await inject(
    'POST',
    `/api/staff/surveys/versions/${versionId}`,
    { definition: DEFINITION, locales: LOCALES },
    leadCookie,
  );
  expect(saved.statusCode).toBe(200);
  const published = await inject(
    'POST',
    `/api/staff/surveys/versions/${versionId}/publish`,
    {},
    leadCookie,
  );
  expect(published.statusCode).toBe(200);

  // recurring assignment anchored in the past: occurrences at -28 … 0
  const assigned = await inject(
    'POST',
    `/api/staff/treatments/${treatment.id}/surveys`,
    {
      surveyId,
      mode: 'recurring',
      anchorDate: isoDay(-28),
      segments: [{ freq: 'weekly', count: 5 }],
      answerWindowDays: 3,
    },
    leadCookie,
  );
  expect(assigned.statusCode).toBe(201);
  scheduleId = (assigned.json() as { scheduleId: string }).scheduleId;
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

async function occurrenceIds(): Promise<string[]> {
  const { rows } = await owner.query(
    `SELECT id FROM clinical.activity WHERE schedule_id = $1 ORDER BY occurrence_date`,
    [scheduleId],
  );
  return (rows as { id: string }[]).map((row) => row.id);
}

async function submitOccurrence(activityId: string, mood: string): Promise<string> {
  const started = await inject(
    'POST',
    `/api/patient/activities/${activityId}/fill`,
    {},
    patientCookie,
  );
  expect(started.statusCode).toBe(201);
  const { responseId } = started.json() as { responseId: string };
  const submitted = await inject(
    'POST',
    `/api/patient/responses/${responseId}/submit`,
    { answers: { 'q-mood': mood } },
    patientCookie,
  );
  expect(submitted.statusCode).toBe(200);
  return responseId;
}

describe('repeat rules on the submit path', () => {
  it('nothing rule-shaped leaks into the patient payload', async () => {
    const [first] = await occurrenceIds();
    const started = await inject(
      'POST',
      `/api/patient/activities/${first!}/fill`,
      {},
      patientCookie,
    );
    const { responseId } = started.json() as { responseId: string };
    const payload = await inject(
      'GET',
      `/api/patient/responses/${responseId}`,
      undefined,
      patientCookie,
    );
    const body = JSON.stringify(payload.json());
    expect(body).not.toContain('trendRules');
    expect(body).not.toContain('notifyText');
    expect(body).not.toContain('taskTitle');
  });

  it('fires on the submission that completes the run - with alert, notification and task', async () => {
    const ids = await occurrenceIds();
    expect(ids).toHaveLength(5);
    await submitOccurrence(ids[0]!, 'o-low');
    // one low answer: no trend yet
    const { rows: none } = await owner.query(
      `SELECT count(*)::int AS n FROM clinical.rule_trigger WHERE rule_id = 'r-low-run'`,
    );
    expect((none[0] as { n: number }).n).toBe(0);

    const responseId = await submitOccurrence(ids[1]!, 'o-low');
    const { rows: triggers } = await owner.query(
      `SELECT alert_id, survey_response_id, activity_id, trace
         FROM clinical.rule_trigger WHERE rule_id = 'r-low-run'`,
    );
    expect(triggers).toHaveLength(1);
    const trigger = triggers[0] as {
      alert_id: string;
      survey_response_id: string;
      trace: { condition: { kind: string; times: number }; window: unknown[] };
    };
    expect(trigger.survey_response_id).toBe(responseId);
    expect(trigger.alert_id).toBeTruthy();
    expect(trigger.trace.condition).toMatchObject({ kind: 'repeat', times: 2 });
    expect(trigger.trace.window).toHaveLength(2);

    const { rows: alerts } = await owner.query(
      `SELECT severity FROM clinical.alert WHERE id = $1`,
      [trigger.alert_id],
    );
    expect((alerts[0] as { severity: string }).severity).toBe('moderate');

    const { rows: notifications } = await owner.query(
      `SELECT recipients, body FROM clinical.rule_notification
        WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [patient.id],
    );
    const notification = notifications[0] as { recipients: string[]; body: Record<string, string> };
    expect(notification.recipients.sort()).toEqual(['patient', 'team']);
    expect(notification.body['en']).toContain('low two check-ins');

    const { rows: tasks } = await owner.query(
      `SELECT title, assignee_id, created_by, status FROM clinical.task
        WHERE treatment_id = $1 AND title = 'Call the patient'`,
      [treatment.id],
    );
    expect(tasks).toHaveLength(1);
    const task = tasks[0] as { assignee_id: null; created_by: null; status: string };
    expect(task.assignee_id).toBeNull(); // unclaimed, in the team queue
    expect(task.created_by).toBeNull(); // created by rule, not a person
    expect(task.status).toBe('open');
  });
});

describe('missed-response rules via the worker', () => {
  it('fires when the second consecutive window closes, and never twice', async () => {
    const first = await sweepSurveyOccurrences(workerPool, async () => {});
    // occurrences -14 and -7 closed unanswered; 0 is still open
    expect(first.missed).toBeGreaterThanOrEqual(2);
    expect(first.trendFired).toBe(1);

    const { rows: triggers } = await owner.query(
      `SELECT survey_response_id, activity_id, alert_id, trace
         FROM clinical.rule_trigger WHERE rule_id = 'r-missed'`,
    );
    expect(triggers).toHaveLength(1);
    const trigger = triggers[0] as {
      survey_response_id: null;
      activity_id: string;
      alert_id: null;
      trace: { condition: { kind: string }; window: { status: string }[] };
    };
    expect(trigger.survey_response_id).toBeNull();
    expect(trigger.activity_id).toBeTruthy();
    expect(trigger.alert_id).toBeNull(); // notify + task authored, no alert
    expect(trigger.trace.window.every((entry) => entry.status === 'missed')).toBe(true);

    const { rows: notifications } = await owner.query(
      `SELECT recipients FROM clinical.rule_notification WHERE trigger_id IS NOT NULL
        AND patient_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [patient.id],
    );
    expect((notifications[0] as { recipients: string[] }).recipients).toEqual(['lead']);

    const { rows: tasks } = await owner.query(
      `SELECT count(*)::int AS n FROM clinical.task
        WHERE treatment_id = $1 AND title = 'Follow up on missed check-ins'`,
      [treatment.id],
    );
    expect((tasks[0] as { n: number }).n).toBe(1);

    // a re-run sweep marks nothing new and re-fires nothing
    const second = await sweepSurveyOccurrences(workerPool, async () => {});
    expect(second.missed).toBe(0);
    expect(second.trendFired).toBe(0);
    const { rows: still } = await owner.query(
      `SELECT count(*)::int AS n FROM clinical.rule_trigger WHERE rule_id = 'r-missed'`,
    );
    expect((still[0] as { n: number }).n).toBe(1);
  });

  it('the patient reads their addressed notification and ONLY that one', async () => {
    // the repeat notification includes 'patient'; the missed one is lead-only
    const { rows } = await owner.query(`SELECT count(*)::int AS n FROM clinical.rule_notification`);
    expect((rows[0] as { n: number }).n).toBeGreaterThanOrEqual(2);
    const appPool = createRolePool({ connectionString: db.connectionString, role: 'mio_app' });
    try {
      const { withUserContext } = await import('@mio/db');
      const visible = await withUserContext(
        appPool,
        { userId: patient.id, realm: 'patient' },
        async (client) => {
          const { rows: mine } = await client.query(
            `SELECT recipients FROM clinical.rule_notification`,
          );
          return mine as { recipients: string[] }[];
        },
      );
      expect(visible).toHaveLength(1);
      expect(visible[0]!.recipients).toContain('patient');
    } finally {
      await appPool.end();
    }
  });
});
