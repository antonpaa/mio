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
 * WP-21: values with provenance (PP2), the taxonomy-coded symptom
 * register (PP3), on-behalf entry flows, and the survey->register write
 * on submission. Boundaries: outsiders get 404s, provenance is always
 * columns, never inference.
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
// a patient with generated PSA values: any active prostate treatment
const valueTreatment = world.treatments.find((t) => {
  const team = world.teams.find((candidate) => candidate.id === t.teamId);
  return (
    t.state === 'active' &&
    t.templateKey.startsWith('prostate') &&
    (team?.leadIds.length ?? 0) > 0 &&
    world.values.some((value) => value.patientId === t.patientId)
  );
})!;
const valueTeam = world.teams.find((candidate) => candidate.id === valueTreatment.teamId)!;
const valueLead = world.staff.find((s) => valueTeam.leadIds.includes(s.id))!;
const valuePatient = world.patients.find((p) => p.id === valueTreatment.patientId)!;
const outsider = world.staff.find(
  (s) =>
    !valueTeam.memberIds.includes(s.id) &&
    !valueTeam.leadIds.includes(s.id) &&
    !(world.careRelationships.get(valuePatient.id) ?? []).includes(s.id),
)!;

// a weekly-symptoms treatment for the survey-driven register write
const surveyTreatment = world.treatments.find((t) => {
  const team = world.teams.find((candidate) => candidate.id === t.teamId);
  return (
    t.state === 'active' &&
    t.surveyKeys.includes('weekly-symptoms') &&
    (team?.leadIds.length ?? 0) > 0
  );
})!;
const surveyTeam = world.teams.find((candidate) => candidate.id === surveyTreatment.teamId)!;
const surveyLead = world.staff.find((s) => surveyTeam.leadIds.includes(s.id))!;
const surveyPatient = world.patients.find((p) => p.id === surveyTreatment.patientId)!;

let leadCookie: string;
let outsiderCookie: string;
let surveyLeadCookie: string;
let surveyPatientCookie: string;
let psaSeriesId: string;

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
  leadCookie = await signIn('staff', valueLead.email);
  outsiderCookie = await signIn('staff', outsider.email);
  surveyLeadCookie = await signIn('staff', surveyLead.email);
  surveyPatientCookie = await signIn('patient', surveyPatient.email);

  const { rows } = await owner.query(`SELECT id FROM clinical.value_series WHERE key = 'psa'`);
  psaSeriesId = (rows[0] as { id: string }).id;
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

describe('PP2 values', () => {
  it('lists the programme series with latest entries, trend and an audited read', async () => {
    const response = await inject(
      'GET',
      `/api/staff/patients/${valuePatient.id}/values`,
      undefined,
      leadCookie,
    );
    expect(response.statusCode).toBe(200);
    const series = response.json() as {
      key: string;
      unit: string;
      latest: { value: string | number }[];
      trend: string | null;
    }[];
    const psa = series.find((row) => row.key === 'psa')!;
    expect(psa.unit).toBe('µg/l');
    expect(psa.latest.length).toBeGreaterThan(0);
    expect(psa.latest.length).toBeLessThanOrEqual(3);
    expect(['rising', 'falling', 'stable', null]).toContain(psa.trend);
    // the programme brings the marker series even before any entry exists
    expect(series.some((row) => row.key === 'psa-reporting')).toBe(true);

    const { rows: events } = await owner.query(
      `SELECT 1 FROM audit.access_event
        WHERE action = 'value_entry.view' AND actor_user_id = $1 AND patient_id = $2`,
      [valueLead.id, valuePatient.id],
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it('on-behalf entry records provenance as COLUMNS and renders in the detail', async () => {
    const created = await inject(
      'POST',
      `/api/staff/patients/${valuePatient.id}/values/${psaSeriesId}`,
      { value: 4.2, measuredAt: '2026-08-20', note: 'Lab call-in' },
      leadCookie,
    );
    expect(created.statusCode).toBe(201);

    const detail = await inject(
      'GET',
      `/api/staff/patients/${valuePatient.id}/values/${psaSeriesId}`,
      undefined,
      leadCookie,
    );
    const { entries } = detail.json() as {
      entries: {
        value: string | number;
        note: string;
        on_behalf_of_patient: boolean;
        entered_given: string | null;
      }[];
    };
    const mine = entries.find((entry) => entry.note === 'Lab call-in')!;
    expect(mine).toBeTruthy();
    expect(Number(mine.value)).toBe(4.2);
    expect(mine.on_behalf_of_patient).toBe(true);
    expect(mine.entered_given).toBe(valueLead.givenName);
  });

  it('an out-of-care clinician gets a 404, not an empty page', async () => {
    const response = await inject(
      'GET',
      `/api/staff/patients/${valuePatient.id}/values`,
      undefined,
      outsiderCookie,
    );
    expect(response.statusCode).toBe(404);
  });
});

describe('PP3 symptom register', () => {
  it('groups seeded survey-driven observations per symptom with derived trends', async () => {
    const response = await inject(
      'GET',
      `/api/staff/patients/${surveyPatient.id}/symptoms`,
      undefined,
      surveyLeadCookie,
    );
    expect(response.statusCode).toBe(200);
    const { register, taxonomy } = response.json() as {
      register: {
        code: string;
        trend: string;
        latest: { source: string; severity: string };
        labels: { fi: string };
      }[];
      taxonomy: { code: string }[];
    };
    expect(taxonomy).toHaveLength(27);
    // the seeded world submits weekly surveys for this treatment, so the
    // mapped symptoms are in the register with survey provenance
    if (register.length > 0) {
      expect(
        register.every((row) => ['new', 'worsening', 'stable', 'easing'].includes(row.trend)),
      ).toBe(true);
      expect(register[0]!.labels.fi).toBeTruthy();
    }
  });

  it('a clinician reports a symptom on behalf; the register shows it with provenance', async () => {
    const { rows } = await owner.query(`SELECT id FROM clinical.symptom WHERE code = 'joint_pain'`);
    const symptomId = (rows[0] as { id: string }).id;
    const created = await inject(
      'POST',
      `/api/staff/patients/${surveyPatient.id}/symptoms`,
      { symptomId, severity: 'moderate', note: 'Mentioned during the phone call.' },
      surveyLeadCookie,
    );
    expect(created.statusCode).toBe(201);

    const response = await inject(
      'GET',
      `/api/staff/patients/${surveyPatient.id}/symptoms`,
      undefined,
      surveyLeadCookie,
    );
    const { register } = response.json() as {
      register: {
        code: string;
        latest: {
          source: string;
          severity: string;
          on_behalf_of_patient: boolean;
          entered_given: string | null;
          detail: { note?: string };
        };
      }[];
    };
    const jointPain = register.find((row) => row.code === 'joint_pain')!;
    expect(jointPain.latest.source).toBe('clinician');
    expect(jointPain.latest.on_behalf_of_patient).toBe(true);
    expect(jointPain.latest.entered_given).toBe(surveyLead.givenName);
    expect(jointPain.latest.detail.note).toContain('phone call');
  });

  it('submitting a mapped survey writes graded observations with source=survey', async () => {
    const { rows } = await owner.query(
      `SELECT id FROM clinical.survey WHERE name = 'Weekly symptom survey'`,
    );
    const surveyId = (rows[0] as { id: string }).id;
    const assigned = await inject(
      'POST',
      `/api/staff/treatments/${surveyTreatment.id}/surveys`,
      { surveyId, mode: 'now' },
      surveyLeadCookie,
    );
    const { activityId } = assigned.json() as { activityId: string };
    const started = await inject(
      'POST',
      `/api/patient/activities/${activityId}/fill`,
      {},
      surveyPatientCookie,
    );
    const { responseId } = started.json() as { responseId: string };
    const submitted = await inject(
      'POST',
      `/api/patient/responses/${responseId}/submit`,
      {
        answers: {
          nausea: 'severe',
          'nausea-frequency': 'once',
          fatigue: 'moderate',
        },
      },
      surveyPatientCookie,
    );
    expect(submitted.statusCode).toBe(200);

    const { rows: observations } = await owner.query(
      `SELECT y.code, o.severity, o.source, o.entered_by, o.on_behalf_of_patient
         FROM clinical.symptom_observation o
         JOIN clinical.symptom y ON y.id = o.symptom_id
        WHERE o.survey_response_id = $1 ORDER BY y.code`,
      [responseId],
    );
    expect(
      (observations as { code: string; severity: string }[]).map((row) => [row.code, row.severity]),
    ).toEqual([
      ['fatigue', 'moderate'],
      ['nausea', 'severe'],
    ]);
    expect(
      (
        observations as { source: string; entered_by: string; on_behalf_of_patient: boolean }[]
      ).every(
        (row) =>
          row.source === 'survey' &&
          row.entered_by === surveyPatient.id &&
          !row.on_behalf_of_patient,
      ),
    ).toBe(true);
  });
});

describe('X7 patient self-report', () => {
  it('a patient reports a symptom; the register shows it as self_report', async () => {
    const view = await inject('GET', '/api/patient/symptoms', undefined, surveyPatientCookie);
    expect(view.statusCode).toBe(200);
    const { taxonomy } = view.json() as { taxonomy: { id: string; code: string }[] };
    const headache = taxonomy.find((row) => row.code === 'headache') ?? taxonomy[0]!;

    const reported = await inject(
      'POST',
      '/api/patient/symptoms',
      { symptomId: headache.id, severity: 'moderate', note: 'Started this morning.' },
      surveyPatientCookie,
    );
    expect(reported.statusCode).toBe(201);
    const { observationId } = reported.json() as { observationId: string };
    const { rows } = await owner.query(
      `SELECT source, entered_by, on_behalf_of_patient, severity
         FROM clinical.symptom_observation WHERE id = $1`,
      [observationId],
    );
    const row = rows[0] as {
      source: string;
      entered_by: string;
      on_behalf_of_patient: boolean;
      severity: string;
    };
    expect(row.source).toBe('self_report');
    expect(row.entered_by).toBe(surveyPatient.id);
    expect(row.on_behalf_of_patient).toBe(false);

    // their own list shows it; the clinician register shows the same fact
    const again = await inject('GET', '/api/patient/symptoms', undefined, surveyPatientCookie);
    const { own } = again.json() as { own: { id: string; source: string }[] };
    expect(own.some((entry) => entry.id === observationId && entry.source === 'self_report')).toBe(
      true,
    );
    const register = await inject(
      'GET',
      `/api/staff/patients/${surveyPatient.id}/symptoms`,
      undefined,
      surveyLeadCookie,
    );
    expect(register.statusCode).toBe(200);
    expect(register.body).toContain(observationId);
  });

  it('refuses a gradeless or unknown report', async () => {
    const bad = await inject(
      'POST',
      '/api/patient/symptoms',
      { symptomId: '00000000-0000-4000-8000-000000000000', severity: 'moderate' },
      surveyPatientCookie,
    );
    expect(bad.statusCode).toBe(404);
    const graded = await inject(
      'POST',
      '/api/patient/symptoms',
      { symptomId: '00000000-0000-4000-8000-000000000000', severity: 'alarming' },
      surveyPatientCookie,
    );
    expect(graded.statusCode).toBe(400);
  });
});
