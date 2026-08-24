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
 * X8: the explicit per-question value binding. A submitted PSA report
 * becomes a value_entry in the patient's series - value from the bound
 * question, measured_at from its date neighbour, provenance the
 * patient - inside the submission's transaction.
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
    t.surveyKeys.includes('psa-reporting') &&
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

  const { rows } = await owner.query(`SELECT id FROM clinical.survey WHERE name = 'PSA reporting'`);
  surveyId = (rows[0] as { id: string }).id;
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

describe('the value binding', () => {
  it('a submitted PSA report writes the dated entry with patient provenance', async () => {
    const assigned = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/surveys`,
      { surveyId, mode: 'now' },
      leadCookie,
    );
    const { activityId } = assigned.json() as { activityId: string };
    const started = await inject(
      'POST',
      `/api/patient/activities/${activityId}/fill`,
      {},
      patientCookie,
    );
    const { responseId } = started.json() as { responseId: string };
    const submitted = await inject(
      'POST',
      `/api/patient/responses/${responseId}/submit`,
      { answers: { 'psa-value': 6.4, 'lab-date': '2026-08-20', 'lab-location': 'Tyks' } },
      patientCookie,
    );
    expect(submitted.statusCode).toBe(200);

    const { rows } = await owner.query(
      `SELECT e.value, e.measured_at::text AS measured_at, e.entered_by,
              e.on_behalf_of_patient, s.key
         FROM clinical.value_entry e
         JOIN clinical.value_series s ON s.id = e.series_id
        WHERE e.patient_id = $1 AND s.key = 'psa' AND e.measured_at = '2026-08-20'`,
      [patient.id],
    );
    const entry = rows[0] as {
      value: string;
      measured_at: string;
      entered_by: string;
      on_behalf_of_patient: boolean;
      key: string;
    };
    expect(entry).toBeTruthy();
    expect(Number(entry.value)).toBe(6.4);
    expect(entry.entered_by).toBe(patient.id); // the patient, not on behalf
    expect(entry.on_behalf_of_patient).toBe(false);

    // the staff values view shows the new point
    const summary = await inject(
      'GET',
      `/api/staff/patients/${patient.id}/values`,
      undefined,
      leadCookie,
    );
    expect(summary.statusCode).toBe(200);
    expect(summary.body).toContain('6.4');
  });

  it('the builder lists the series catalog and refuses a binding on a choice question', async () => {
    const catalog = await inject('GET', '/api/staff/value-series', undefined, leadCookie);
    expect(catalog.statusCode).toBe(200);
    const keys = (catalog.json() as { key: string }[]).map((row) => row.key);
    expect(keys).toContain('psa');

    const created = await inject(
      'POST',
      '/api/staff/surveys',
      { name: 'Binding misfit', kind: 'generic' },
      leadCookie,
    );
    const { versionId } = created.json() as { versionId: string };
    const rejected = await inject(
      'POST',
      `/api/staff/surveys/versions/${versionId}`,
      {
        definition: {
          pages: [
            {
              id: 'p-1',
              questions: [
                {
                  id: 'q-1',
                  type: 'choice_single',
                  options: [{ id: 'a' }],
                  valueBinding: { seriesKey: 'psa' },
                },
              ],
            },
          ],
        },
        locales: [
          {
            locale: 'en',
            title: 'Misfit',
            questions: { 'q-1': { label: 'Q', options: { a: 'A' } } },
          },
        ],
      },
      leadCookie,
    );
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).toContain('bad_value_binding');
  });
});
