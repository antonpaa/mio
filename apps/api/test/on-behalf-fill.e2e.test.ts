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
 * On-behalf survey fill (the PP "Report" group's "Fill a survey"): a
 * clinician records the answers a patient gave by phone or in clinic.
 * The rules must fire exactly as they would for the patient's own
 * submission - that is the whole point - while every record the
 * submission derives carries the clinician's provenance, so the
 * register never claims the patient entered it themselves.
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
  return t.state === 'active' && t.surveyKeys.includes('weekly-symptoms') && team !== undefined;
})!;
const team = world.teams.find((candidate) => candidate.id === treatment.teamId)!;
const lead = world.staff.find((s) => team.leadIds.includes(s.id))!;
const patient = world.patients.find((p) => p.id === treatment.patientId)!;
const outsider = world.staff.find(
  (s) =>
    !s.roles.includes('administrator') &&
    !s.roles.includes('auditor') &&
    !team.memberIds.includes(s.id) &&
    !team.leadIds.includes(s.id) &&
    !(world.careRelationships.get(patient.id) ?? []).includes(s.id),
)!;

let leadCookie: string;
let outsiderCookie: string;
let patientCookie: string;

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
  return String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;
}

interface Fillable {
  activity_id: string | null;
  treatment_id: string;
  survey_id: string;
  survey_name: string;
  due_date: string | null;
}

describe('on-behalf survey fill', () => {
  it('records the patient answers with the clinician as provenance, rules firing as always', async () => {
    const options = await inject(
      'GET',
      `/api/staff/patients/${patient.id}/fillable`,
      undefined,
      leadCookie,
    );
    expect(options.statusCode).toBe(200);
    const fillable = options.json() as Fillable[];
    const weekly = fillable.find((row) => row.survey_name === 'Weekly symptom survey')!;
    expect(weekly).toBeTruthy();

    const started = await inject(
      'POST',
      `/api/staff/patients/${patient.id}/responses`,
      {
        treatmentId: weekly.treatment_id,
        surveyId: weekly.survey_id,
        ...(weekly.activity_id !== null ? { activityId: weekly.activity_id } : {}),
      },
      leadCookie,
    );
    expect(started.statusCode).toBe(201);
    const { responseId } = started.json() as { responseId: string };

    // the fill payload speaks the patient's bound language and hides
    // rule criticality exactly as the patient's own fill does
    const payload = await inject(
      'GET',
      `/api/staff/responses/${responseId}/fill`,
      undefined,
      leadCookie,
    );
    expect(payload.statusCode).toBe(200);
    const body = payload.json() as {
      status: string;
      definition: { pages: unknown[] };
      patient: { given_name: string };
    };
    expect(body.status).toBe('draft');
    expect(body.definition.pages.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.definition)).not.toContain('critical');
    expect(body.patient.given_name).toBe(patient.givenName);

    // save-and-resume mid-entry
    const saved = await inject(
      'POST',
      `/api/staff/responses/${responseId}/answers`,
      { answers: { nausea: 'severe' } },
      leadCookie,
    );
    expect(saved.statusCode).toBe(200);

    const submitted = await inject(
      'POST',
      `/api/staff/responses/${responseId}/submit`,
      {
        answers: {
          nausea: 'severe',
          'nausea-frequency': 'twice-or-more',
          'nausea-impact': 9,
          fatigue: 'considerable',
        },
      },
      leadCookie,
    );
    expect(submitted.statusCode).toBe(200);

    // provenance on the response itself
    const { rows: responseRows } = await owner.query<{
      status: string;
      on_behalf_by: string | null;
      patient_id: string;
    }>(`SELECT status, on_behalf_by, patient_id FROM clinical.survey_response WHERE id = $1`, [
      responseId,
    ]);
    expect(responseRows[0]!.status).toBe('submitted');
    expect(responseRows[0]!.on_behalf_by).toBe(lead.id);
    expect(responseRows[0]!.patient_id).toBe(patient.id);

    // ...and on every record the submission derived
    const { rows: observations } = await owner.query<{
      entered_by: string;
      on_behalf_of_patient: boolean;
      source: string;
    }>(
      `SELECT entered_by, on_behalf_of_patient, source FROM clinical.symptom_observation
        WHERE survey_response_id = $1`,
      [responseId],
    );
    expect(observations.length).toBeGreaterThan(0);
    for (const row of observations) {
      expect(row.source).toBe('survey');
      expect(row.entered_by).toBe(lead.id);
      expect(row.on_behalf_of_patient).toBe(true);
    }

    // the rules fired exactly as they would have for the patient
    const { rows: alerts } = await owner.query<{ severity: string }>(
      `SELECT severity FROM clinical.alert WHERE survey_response_id = $1`,
      [responseId],
    );
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.severity).toBe('high');

    // the act is on the trail as an on-behalf submission by the clinician
    const { rows: events } = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit.access_event
        WHERE actor_user_id = $1 AND resource_id = $2
          AND action = 'survey_response.submit_on_behalf_of_patient' AND decision = 'allow'`,
      [lead.id, responseId],
    );
    expect(events[0]!.n).toBe(1);
  });

  it('refuses everyone the matrix refuses: outsiders, the patient realm', async () => {
    // a clinician with no care relationship cannot even see the options
    const outsiderList = await inject(
      'GET',
      `/api/staff/patients/${patient.id}/fillable`,
      undefined,
      outsiderCookie,
    );
    expect([200, 403]).toContain(outsiderList.statusCode);
    if (outsiderList.statusCode === 200) {
      expect(outsiderList.json()).toEqual([]);
    }

    // ...nor start one
    const outsiderStart = await inject(
      'POST',
      `/api/staff/patients/${patient.id}/responses`,
      { treatmentId: treatment.id, surveyId: '00000000-0000-0000-0000-000000000000' },
      outsiderCookie,
    );
    expect([403, 404]).toContain(outsiderStart.statusCode);

    // the patient's own session has no business on the staff surface
    const asPatient = await inject(
      'GET',
      `/api/staff/patients/${patient.id}/fillable`,
      undefined,
      patientCookie,
    );
    expect(asPatient.statusCode).toBe(401);
  });
});
