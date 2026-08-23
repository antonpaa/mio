import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { generateWorld, seedWorld, DEMO_PASSWORD } from '@mio/synthetic';
import { AppModule } from '../src/app.module.js';
import { MAILER, type ContentlessMail, type Mailer } from '../src/modules/identity/index.js';

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
// an ACTIVE treatment with the weekly-symptoms attachment and its patient
const treatment = world.treatments.find(
  (t) => t.state === 'active' && t.surveyKeys.includes('weekly-symptoms'),
)!;
const patient = world.patients.find((p) => p.id === treatment.patientId)!;
// a patient with NO active treatments at all
const otherPatient = world.patients.find(
  (p) => !world.treatments.some((t) => t.patientId === p.id && t.state === 'active'),
)!;

let patientCookie: string;
let otherCookie: string;

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
  patientCookie = await signIn(patient.email);
  otherCookie = await signIn(otherPatient.email);
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

async function signIn(email: string): Promise<string> {
  const login = await inject('POST', `/api/patient/auth/login`, {
    email,
    password: DEMO_PASSWORD,
  });
  expect(login.statusCode).toBe(200);
  const { challengeId } = login.json() as { challengeId: string };
  const verify = await inject('POST', `/api/patient/auth/verify`, {
    challengeId,
    code: mailer.lastCodeFor(email),
  });
  expect(verify.statusCode).toBe(200);
  const setCookie = verify.headers['set-cookie'];
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (value as string).split(';')[0] as string;
}

let responseId: string;

describe('fill and resume (P4, server-side save-and-resume)', () => {
  it('lists fillable surveys for active treatments in the patient locale', async () => {
    const list = await inject('GET', '/api/patient/surveys', undefined, patientCookie);
    expect(list.statusCode).toBe(200);
    const body = list.json() as { fillable: { surveyId: string; treatmentId: string }[] };
    expect(body.fillable.some((entry) => entry.treatmentId === treatment.id)).toBe(true);
  });

  it('start creates one draft and returns the SAME draft on retry', async () => {
    const surveyId = await surveyIdOf('weekly-symptoms');
    const first = await inject(
      'POST',
      `/api/patient/surveys/${surveyId}/start`,
      { treatmentId: treatment.id },
      patientCookie,
    );
    expect(first.statusCode).toBe(201);
    responseId = (first.json() as { responseId: string }).responseId;
    const again = await inject(
      'POST',
      `/api/patient/surveys/${surveyId}/start`,
      { treatmentId: treatment.id },
      patientCookie,
    );
    expect((again.json() as { responseId: string }).responseId).toBe(responseId);
  });

  it('drafts persist server-side and progress counts visible questions', async () => {
    const save = await inject(
      'POST',
      `/api/patient/responses/${responseId}/answers`,
      { answers: { nausea: 'severe', temperature: 'not-a-number' } },
      patientCookie,
    );
    expect(save.statusCode).toBe(200);
    // 'severe' reveals the follow-up: total grows from 3 to 4; the invalid
    // temperature is DROPPED from the draft, not stored
    expect((save.json() as { progress: object }).progress).toEqual({ answered: 1, total: 4 });

    const resumed = await inject(
      'GET',
      `/api/patient/responses/${responseId}`,
      undefined,
      patientCookie,
    );
    const body = resumed.json() as { answers: Record<string, unknown>; bundle: { locale: string } };
    expect(body.answers).toEqual({ nausea: 'severe' });
    expect(['en', 'fi', 'sv']).toContain(body.bundle.locale);
  });

  it('another patient can neither read nor write the draft', async () => {
    const read = await inject(
      'GET',
      `/api/patient/responses/${responseId}`,
      undefined,
      otherCookie,
    );
    expect(read.statusCode).toBe(404); // RLS hides the row - no existence leak
  });

  it('submit rejects missing required answers, then accepts and DISCARDS hidden ones', async () => {
    const missing = await inject(
      'POST',
      `/api/patient/responses/${responseId}/submit`,
      { answers: { nausea: 'severe' } },
      patientCookie,
    );
    expect(missing.statusCode).toBe(400);
    const errors = (missing.json() as { errors: { questionId: string; code: string }[] }).errors;
    expect(errors).toContainEqual({ questionId: 'nausea-frequency', code: 'required' });
    expect(errors).toContainEqual({ questionId: 'fatigue', code: 'required' });

    const submit = await inject(
      'POST',
      `/api/patient/responses/${responseId}/submit`,
      {
        answers: {
          nausea: 'none',
          'nausea-frequency': 'twice-or-more', // hidden now - must be discarded
          'nausea-impact': 9,
          fatigue: 'slight',
          temperature: '38,4',
        },
      },
      patientCookie,
    );
    expect(submit.statusCode).toBe(200);

    const { rows } = await owner.query(
      `SELECT answers, status FROM clinical.survey_response WHERE id = $1`,
      [responseId],
    );
    expect((rows[0] as { status: string }).status).toBe('submitted');
    expect((rows[0] as { answers: object }).answers).toEqual({
      nausea: 'none',
      fatigue: 'slight',
      temperature: '38,4',
    });

    const again = await inject(
      'POST',
      `/api/patient/responses/${responseId}/submit`,
      { answers: { nausea: 'none', fatigue: 'none' } },
      patientCookie,
    );
    expect(again.statusCode).toBe(400); // submitted responses are done
  });

  it('authored pattern rejects with 400 at submit, never stores', async () => {
    const surveyId = await surveyIdOf('weekly-symptoms');
    const started = await inject(
      'POST',
      `/api/patient/surveys/${surveyId}/start`,
      { treatmentId: treatment.id },
      patientCookie,
    );
    const freshId = (started.json() as { responseId: string }).responseId;
    const bad = await inject(
      'POST',
      `/api/patient/responses/${freshId}/submit`,
      { answers: { nausea: 'none', fatigue: 'none', temperature: 'hot' } },
      patientCookie,
    );
    expect(bad.statusCode).toBe(400);
    expect(
      (bad.json() as { errors: { questionId: string; code: string }[] }).errors,
    ).toContainEqual({ questionId: 'temperature', code: 'pattern' });
  });
});

describe('storage rules', () => {
  it('published survey versions are immutable at the database layer', async () => {
    const { rows } = await owner.query(
      `SELECT id FROM clinical.survey_version WHERE state = 'published' LIMIT 1`,
    );
    await expect(
      owner.query(
        `UPDATE clinical.survey_version SET definition = '{"pages":[]}'::jsonb WHERE id = $1`,
        [(rows[0] as { id: string }).id],
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('a patient with no active treatments has nothing to fill', async () => {
    const list = await inject('GET', '/api/patient/surveys', undefined, otherCookie);
    expect(list.statusCode).toBe(200);
    expect((list.json() as { fillable: unknown[] }).fillable).toEqual([]);
  });
});

async function surveyIdOf(key: string): Promise<string> {
  const names: Record<string, string> = { 'weekly-symptoms': 'Weekly symptom survey' };
  const { rows } = await owner.query(`SELECT id FROM clinical.survey WHERE name = $1`, [
    names[key] ?? key,
  ]);
  return (rows[0] as { id: string }).id;
}
