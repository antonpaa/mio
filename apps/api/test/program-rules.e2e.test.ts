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
 * WP-22: the program override layer. The same answers behave differently
 * in another program; the effective rule set is template + overrides;
 * traces say which layer supplied the condition; and C7 renders each
 * answer's standing against THIS program's rules.
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
    (team?.leadIds.length ?? 0) > 0 &&
    (team?.memberIds.filter((id) => !team.leadIds.includes(id)).length ?? 0) > 0
  );
})!;
const team = world.teams.find((candidate) => candidate.id === treatment.teamId)!;
const lead = world.staff.find((s) => team.leadIds.includes(s.id))!;
const member = world.staff.find(
  (s) =>
    team.memberIds.includes(s.id) && !team.leadIds.includes(s.id) && s.role === 'treatment_member',
)!;
const patient = world.patients.find((p) => p.id === treatment.patientId)!;
const outsider = world.staff.find(
  (s) =>
    !team.memberIds.includes(s.id) &&
    !team.leadIds.includes(s.id) &&
    !(world.careRelationships.get(patient.id) ?? []).includes(s.id),
)!;

let leadCookie: string;
let memberCookie: string;
let outsiderCookie: string;
let patientCookie: string;
let surveyId: string;
let responseId: string;

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
  memberCookie = await signIn('staff', member.email);
  outsiderCookie = await signIn('staff', outsider.email);
  patientCookie = await signIn('patient', patient.email);

  const { rows } = await owner.query(
    `SELECT id FROM clinical.survey WHERE name = 'Weekly symptom survey'`,
  );
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

describe('configuring the override layer', () => {
  it('is Treatment Lead capability; members are denied, bad overrides rejected', async () => {
    const denied = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/surveys/${surveyId}/rules`,
      { overrides: { rules: { 'r-nausea-impact': { value: 5 } } } },
      memberCookie,
    );
    expect(denied.statusCode).toBe(403);

    const invalid = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/surveys/${surveyId}/rules`,
      { overrides: { rules: { 'r-does-not-exist': { value: 1 } } } },
      leadCookie,
    );
    expect(invalid.statusCode).toBe(400);

    const saved = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/surveys/${surveyId}/rules`,
      { overrides: { rules: { 'r-nausea-impact': { value: 5 } } } },
      leadCookie,
    );
    expect(saved.statusCode).toBe(200);

    const read = await inject(
      'GET',
      `/api/staff/treatments/${treatment.id}/surveys/${surveyId}/rules`,
      undefined,
      leadCookie,
    );
    const payload = read.json() as { overrides: { rules: Record<string, { value: number }> } };
    expect(payload.overrides.rules['r-nausea-impact']!.value).toBe(5);
  });

  it('the same answers now fire under this program - trace says the layer', async () => {
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
    responseId = (started.json() as { responseId: string }).responseId;
    // impact 6: BELOW the template threshold (7), ABOVE the program's (5)
    const submitted = await inject(
      'POST',
      `/api/patient/responses/${responseId}/submit`,
      {
        answers: {
          nausea: 'mild',
          'nausea-frequency': 'twice-or-more',
          'nausea-impact': 6,
          fatigue: 'none',
        },
      },
      patientCookie,
    );
    expect(submitted.statusCode).toBe(200);

    const { rows: triggers } = await owner.query<{
      rule_id: string;
      trace: { source: string };
    }>(
      `SELECT rule_id, trace FROM clinical.rule_trigger
        WHERE survey_response_id = $1 ORDER BY rule_id`,
      [responseId],
    );
    expect(triggers.map((row) => row.rule_id)).toEqual(['r-nausea-frequent', 'r-nausea-impact']);
    const impact = triggers.find((row) => row.rule_id === 'r-nausea-impact')!;
    expect(impact.trace.source).toBe('program'); // the override supplied the threshold
    const frequent = triggers.find((row) => row.rule_id === 'r-nausea-frequent')!;
    expect(frequent.trace.source).toBe('template');
  });
});

describe('C7 response detail and PP4', () => {
  it('renders per-answer standing against the PROGRAM rules with cited triggers', async () => {
    const response = await inject(
      'GET',
      `/api/staff/responses/${responseId}`,
      undefined,
      leadCookie,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      response: { survey_name: string; version: number };
      standing: Record<string, string>;
      overrides: { rules: Record<string, unknown> };
      triggers: { rule_id: string; source: string; citation: { questionLabel: string } }[];
    };
    expect(body.response.survey_name).toBe('Weekly symptom survey');
    expect(body.standing['nausea-impact']).toBe('above_expected');
    expect(body.standing['nausea-frequency']).toBe('above_expected');
    expect(body.standing['fatigue']).toBeUndefined(); // expected in this program
    expect(body.overrides.rules['r-nausea-impact']).toBeTruthy();
    const impact = body.triggers.find((t) => t.rule_id === 'r-nausea-impact')!;
    expect(impact.source).toBe('program');
    expect(impact.citation.questionLabel).toBeTruthy();
  });

  it('PP4 lists the response color-coded by what it raised', async () => {
    const list = await inject(
      'GET',
      `/api/staff/patients/${patient.id}/responses`,
      undefined,
      leadCookie,
    );
    expect(list.statusCode).toBe(200);
    const rows = list.json() as {
      id: string;
      survey_name: string;
      alert_severity: string | null;
      trigger_count: number;
    }[];
    const mine = rows.find((row) => row.id === responseId)!;
    expect(mine.survey_name).toBe('Weekly symptom survey');
    expect(mine.alert_severity).toBe('moderate');
    expect(mine.trigger_count).toBe(2);
  });

  it('an outsider gets a 404 on the detail', async () => {
    const response = await inject(
      'GET',
      `/api/staff/responses/${responseId}`,
      undefined,
      outsiderCookie,
    );
    expect(response.statusCode).toBe(404);
  });
});
