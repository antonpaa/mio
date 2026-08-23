import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRolePool, migrate, withUserContext } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { generateWorld, seedWorld, DEMO_PASSWORD } from '@mio/synthetic';
import { AppModule } from '../src/app.module.js';
import { MAILER, type ContentlessMail, type Mailer } from '../src/modules/identity/index.js';

/**
 * WP-18: submitting severe answers raises a graded alert with per-rule
 * traces and a same-transaction outbox row - and none of it is visible
 * to patients, who only ever see the designed P12 copy.
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
let appPool: pg.Pool;
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
  (s) => !team.memberIds.includes(s.id) && !team.leadIds.includes(s.id),
)!;

let leadCookie: string;
let patientCookie: string;
let surveyId: string;
let severeResponseId: string;
let alertId: string;

beforeAll(async () => {
  db = await provisionTestDatabase();
  await migrate(db.connectionString);
  await seedWorld(db.connectionString, world);
  owner = new pg.Pool({ connectionString: db.connectionString, max: 2 });
  appPool = createRolePool({ connectionString: db.connectionString, role: 'mio_app' });

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
  await appPool?.end();
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

async function startFill(): Promise<string> {
  const assigned = await inject(
    'POST',
    `/api/staff/treatments/${treatment.id}/surveys`,
    { surveyId, mode: 'now' },
    leadCookie,
  );
  expect(assigned.statusCode).toBe(201);
  const { activityId } = assigned.json() as { activityId: string };
  const started = await inject(
    'POST',
    `/api/patient/activities/${activityId}/fill`,
    {},
    patientCookie,
  );
  expect(started.statusCode).toBe(201);
  return (started.json() as { responseId: string }).responseId;
}

describe('evaluation on submit', () => {
  it('never ships rules or severities to the patient fill payload', async () => {
    severeResponseId = await startFill();
    const payload = await inject(
      'GET',
      `/api/patient/responses/${severeResponseId}`,
      undefined,
      patientCookie,
    );
    expect(payload.statusCode).toBe(200);
    const body = JSON.stringify(payload.json());
    expect(body).not.toContain('"rules"');
    expect(body).not.toContain('criticalRegions');
    expect(body).not.toContain('severity');
  });

  it('grades severe answers into ONE alert citing every trigger, with traces', async () => {
    const submit = await inject(
      'POST',
      `/api/patient/responses/${severeResponseId}/submit`,
      {
        answers: {
          nausea: 'severe',
          'nausea-frequency': 'twice-or-more',
          'nausea-impact': 8,
          fatigue: 'considerable',
        },
      },
      patientCookie,
    );
    expect(submit.statusCode).toBe(200);
    // the patient-facing reply carries nothing rule-shaped
    expect(submit.json()).toEqual({ status: 'submitted' });

    const { rows: alerts } = await owner.query(
      `SELECT id, severity, status, treatment_id, patient_id
         FROM clinical.alert WHERE survey_response_id = $1`,
      [severeResponseId],
    );
    expect(alerts).toHaveLength(1);
    const alert = alerts[0] as { id: string; severity: string; status: string; patient_id: string };
    alertId = alert.id;
    expect(alert.severity).toBe('high'); // max over high + 2x moderate
    expect(alert.status).toBe('new');
    expect(alert.patient_id).toBe(patient.id);

    const { rows: triggers } = await owner.query(
      `SELECT rule_id, question_id, severity, alert_id, trace
         FROM clinical.rule_trigger WHERE survey_response_id = $1 ORDER BY rule_id`,
      [severeResponseId],
    );
    expect((triggers as { rule_id: string }[]).map((row) => row.rule_id)).toEqual([
      'r-fatigue-considerable',
      'r-nausea-frequent',
      'r-nausea-impact',
      'r-nausea-severe',
    ]);

    // record-only firing: stored, cited by NO alert
    const recordOnly = (
      triggers as { rule_id: string; severity: string | null; alert_id: string | null }[]
    ).find((row) => row.rule_id === 'r-fatigue-considerable')!;
    expect(recordOnly.severity).toBeNull();
    expect(recordOnly.alert_id).toBeNull();

    const severe = (
      triggers as {
        rule_id: string;
        severity: string | null;
        alert_id: string | null;
        trace: Record<string, unknown>;
      }[]
    ).find((row) => row.rule_id === 'r-nausea-severe')!;
    expect(severe.alert_id).toBe(alertId);
    expect(severe.trace).toMatchObject({
      ruleId: 'r-nausea-severe',
      questionId: 'nausea',
      condition: { kind: 'option', optionId: 'severe' },
      source: 'template',
      observed: 'severe',
      outcomes: [
        { kind: 'alert', severity: 'high' },
        { kind: 'notify', recipients: ['patient', 'lead'] },
      ],
    });
  });

  it('wrote the same-transaction outbox row and the audit trail entry', async () => {
    const { rows: outbox } = await owner.query(
      `SELECT kind, payload, processed_at FROM clinical.notification_outbox
        WHERE payload ->> 'alertId' = $1`,
      [alertId],
    );
    expect(outbox).toHaveLength(1);
    const row = outbox[0] as { kind: string; payload: Record<string, unknown>; processed_at: null };
    expect(row.kind).toBe('alert.raised');
    expect(row.processed_at).toBeNull();
    expect(row.payload['severity']).toBe('high');
    expect(row.payload['surveyResponseId']).toBe(severeResponseId);

    const { rows: events } = await owner.query(
      `SELECT patient_id, detail FROM audit.change_event
        WHERE action = 'alert.raise' AND resource_id = $1`,
      [alertId],
    );
    expect(events).toHaveLength(1);
    const event = events[0] as { patient_id: string; detail: Record<string, unknown> };
    expect(event.patient_id).toBe(patient.id);
    expect(event.detail['severity']).toBe('high');
    expect(event.detail['ruleIds']).toEqual([
      'r-nausea-severe',
      'r-nausea-frequent',
      'r-nausea-impact',
    ]);
  });

  it('benign answers raise nothing at all', async () => {
    const responseId = await startFill();
    const submit = await inject(
      'POST',
      `/api/patient/responses/${responseId}/submit`,
      { answers: { nausea: 'none', fatigue: 'none' } },
      patientCookie,
    );
    expect(submit.statusCode).toBe(200);
    const { rows } = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM clinical.alert WHERE survey_response_id = $1) AS alerts,
         (SELECT count(*)::int FROM clinical.rule_trigger WHERE survey_response_id = $1) AS triggers`,
      [responseId],
    );
    expect(rows[0]).toEqual({ alerts: 0, triggers: 0 });
  });
});

describe('the alert boundary', () => {
  it('care staff read the alert; outsiders and patients read NOTHING', async () => {
    // scoped to THIS alert: the synthetic world seeds alerts for other
    // patients, which an unrelated staff member may legitimately care for
    const count = async (userId: string, realm: 'staff' | 'patient'): Promise<number> =>
      withUserContext(appPool, { userId, realm }, async (client) => {
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM clinical.alert WHERE id = $1`,
          [alertId],
        );
        return (rows[0] as { n: number }).n;
      });
    expect(await count(lead.id, 'staff')).toBe(1);
    expect(await count(outsider.id, 'staff')).toBe(0);
    expect(await count(patient.id, 'patient')).toBe(0);
    // and the patient realm sees NO alert at all, ever
    const patientTotal = await withUserContext(
      appPool,
      { userId: patient.id, realm: 'patient' },
      async (client) => {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM clinical.alert`);
        return (rows[0] as { n: number }).n;
      },
    );
    expect(patientTotal).toBe(0);
  });

  it('traces are evidence: the application cannot rewrite or delete them', async () => {
    await expect(
      withUserContext(appPool, { userId: lead.id, realm: 'staff' }, (client) =>
        client.query(`UPDATE clinical.rule_trigger SET severity = 'low'`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withUserContext(appPool, { userId: lead.id, realm: 'staff' }, (client) =>
        client.query(`DELETE FROM clinical.rule_trigger`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
