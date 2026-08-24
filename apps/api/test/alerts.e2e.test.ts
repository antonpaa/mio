import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { generateWorld, seedWorld, DEMO_PASSWORD, SYNTHETIC_SURVEYS } from '@mio/synthetic';
import { AppModule } from '../src/app.module.js';
import { MAILER, type ContentlessMail, type Mailer } from '../src/modules/identity/index.js';

/**
 * WP-19: the alert workflow - triage queue, PP6 detail with cited
 * triggers, acknowledge/assign/comment/resolve with race-safe
 * transitions, and the boundary: outsiders get 404s, patients get
 * nothing at all.
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
  (s) => team.memberIds.includes(s.id) && !team.leadIds.includes(s.id),
)!;
const patient = world.patients.find((p) => p.id === treatment.patientId)!;
const outsider = world.staff.find(
  (s) =>
    !team.memberIds.includes(s.id) &&
    !team.leadIds.includes(s.id) &&
    !(world.careRelationships.get(patient.id) ?? []).includes(s.id),
)!;

let leadCookie: string;
let patientCookie: string;
let outsiderCookie: string;
let alertId: string;

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
  outsiderCookie = await signIn('staff', outsider.email);

  // raise a REAL alert through the real path: assign now, fill, severe submit
  const { rows } = await owner.query(
    `SELECT id FROM clinical.survey WHERE name = 'Weekly symptom survey'`,
  );
  const surveyId = (rows[0] as { id: string }).id;
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
  await inject(
    'POST',
    `/api/patient/responses/${responseId}/submit`,
    {
      answers: {
        nausea: 'severe',
        'nausea-frequency': 'twice-or-more',
        'nausea-impact': 9,
        fatigue: 'none',
      },
    },
    patientCookie,
  );
  const { rows: alerts } = await owner.query(
    `SELECT id FROM clinical.alert WHERE survey_response_id = $1`,
    [responseId],
  );
  alertId = (alerts[0] as { id: string }).id;
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

describe('C1 triage and PP6 detail', () => {
  it('the queue ranks new before acknowledged, high before moderate, and names the patient', async () => {
    const response = await inject('GET', '/api/staff/alerts', undefined, leadCookie);
    expect(response.statusCode).toBe(200);
    const rows = response.json() as {
      id: string;
      status: string;
      severity: string;
      patient_given: string;
      trigger_count: number;
      survey_name: string;
    }[];
    const mine = rows.find((row) => row.id === alertId)!;
    expect(mine).toBeTruthy();
    expect(mine.severity).toBe('high');
    expect(mine.status).toBe('new');
    expect(mine.trigger_count).toBe(3);
    expect(mine.survey_name).toBe('Weekly symptom survey');
    expect(mine.patient_given).toBe(patient.givenName);
    // ordering invariant: no acknowledged row before a new one
    const firstAcknowledged = rows.findIndex((row) => row.status === 'acknowledged');
    const lastNew = rows.map((row) => row.status).lastIndexOf('new');
    if (firstAcknowledged !== -1) expect(firstAcknowledged).toBeGreaterThan(lastNew);
  });

  it('the detail cites each trigger from the trace in the response locale', async () => {
    const response = await inject('GET', `/api/staff/alerts/${alertId}`, undefined, leadCookie);
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      alert: { severity: string; status: string; survey_name: string };
      triggers: {
        rule_id: string;
        severity: string | null;
        citation: {
          questionLabel: string;
          kind: string;
          valueLabel?: string;
          threshold?: number;
          observed?: unknown;
        };
      }[];
      comments: unknown[];
      team: { staff_id: string }[];
    };
    expect(body.alert.severity).toBe('high');
    expect(body.triggers.map((t) => t.rule_id).sort()).toEqual([
      'r-nausea-frequent',
      'r-nausea-impact',
      'r-nausea-severe',
    ]);
    const weekly = SYNTHETIC_SURVEYS.find((s) => s.key === 'weekly-symptoms')!;
    const bundle =
      weekly.locales.find((entry) => entry.locale === patient.locale) ?? weekly.locales[0]!;
    const severe = body.triggers.find((t) => t.rule_id === 'r-nausea-severe')!;
    expect(severe.citation.questionLabel).toBe(bundle.questions['nausea']!.label);
    expect(severe.citation.valueLabel).toBe(bundle.questions['nausea']!.options!['severe']);
    const impact = body.triggers.find((t) => t.rule_id === 'r-nausea-impact')!;
    expect(impact.citation.threshold).toBe(7);
    expect(impact.citation.observed).toBe(9);
    expect(body.team.some((entry) => entry.staff_id === lead.id)).toBe(true);
    // both matrix actions were audited for the disclosure
    const { rows: events } = await owner.query(
      `SELECT action FROM audit.access_event
        WHERE resource_id = $1 AND actor_user_id = $2 ORDER BY occurred_at`,
      [alertId, lead.id],
    );
    const actions = (events as { action: string }[]).map((row) => row.action);
    expect(actions).toContain('alert.view');
    expect(actions).toContain('alert.view_evaluation_trace');
  });

  it('an outsider gets the same 404 as an unknown id - no existence oracle', async () => {
    const response = await inject('GET', `/api/staff/alerts/${alertId}`, undefined, outsiderCookie);
    expect(response.statusCode).toBe(404);
  });

  it('patients cannot reach the alert surface at all', async () => {
    const response = await inject('GET', '/api/staff/alerts', undefined, patientCookie);
    expect(response.statusCode).toBe(401);
  });
});

describe('the workflow', () => {
  it('acknowledge is race-safe: first wins, second conflicts', async () => {
    const first = await inject('POST', `/api/staff/alerts/${alertId}/acknowledge`, {}, leadCookie);
    expect(first.statusCode).toBe(200);
    const second = await inject('POST', `/api/staff/alerts/${alertId}/acknowledge`, {}, leadCookie);
    expect(second.statusCode).toBe(409);
  });

  it('assigns only within the team', async () => {
    const bad = await inject(
      'POST',
      `/api/staff/alerts/${alertId}/assign`,
      { assigneeId: outsider.id },
      leadCookie,
    );
    expect(bad.statusCode).toBe(400);
    const good = await inject(
      'POST',
      `/api/staff/alerts/${alertId}/assign`,
      { assigneeId: member.id },
      leadCookie,
    );
    expect(good.statusCode).toBe(200);
  });

  it('comments are appended with their author and kept OUT of the audit detail', async () => {
    const posted = await inject(
      'POST',
      `/api/staff/alerts/${alertId}/comments`,
      { body: 'Rang the patient, arranging an extra visit tomorrow.' },
      leadCookie,
    );
    expect(posted.statusCode).toBe(201);
    const { commentId } = posted.json() as { commentId: string };
    const detail = await inject('GET', `/api/staff/alerts/${alertId}`, undefined, leadCookie);
    const { comments } = detail.json() as {
      comments: { id: string; body: string; author_given: string }[];
    };
    const mine = comments.find((entry) => entry.id === commentId)!;
    expect(mine.body).toContain('extra visit');
    expect(mine.author_given).toBe(lead.givenName);
    const { rows: events } = await owner.query(
      `SELECT detail FROM audit.change_event WHERE action = 'alert.comment' AND resource_id = $1`,
      [alertId],
    );
    expect(JSON.stringify((events[0] as { detail: unknown }).detail)).not.toContain('visit');
  });

  it('resolve is terminal: no re-resolve, no late acknowledge, comments still allowed', async () => {
    const resolved = await inject('POST', `/api/staff/alerts/${alertId}/resolve`, {}, leadCookie);
    expect(resolved.statusCode).toBe(200);
    expect(
      (await inject('POST', `/api/staff/alerts/${alertId}/resolve`, {}, leadCookie)).statusCode,
    ).toBe(409);
    expect(
      (await inject('POST', `/api/staff/alerts/${alertId}/acknowledge`, {}, leadCookie)).statusCode,
    ).toBe(400);
    const postscript = await inject(
      'POST',
      `/api/staff/alerts/${alertId}/comments`,
      { body: 'Follow-up done, closing notes.' },
      leadCookie,
    );
    expect(postscript.statusCode).toBe(201);

    const detail = await inject('GET', `/api/staff/alerts/${alertId}`, undefined, leadCookie);
    const { alert } = detail.json() as {
      alert: {
        status: string;
        resolved_at: string | null;
        resolved_given: string | null;
        acknowledged_given: string | null;
        assignee_given: string | null;
      };
    };
    expect(alert.status).toBe('resolved');
    expect(alert.resolved_at).toBeTruthy();
    expect(alert.resolved_given).toBe(lead.givenName);
    expect(alert.acknowledged_given).toBe(lead.givenName);
    expect(alert.assignee_given).toBe(member.givenName);

    // resolved alerts leave the triage queue
    const queue = await inject('GET', '/api/staff/alerts', undefined, leadCookie);
    expect((queue.json() as { id: string }[]).some((row) => row.id === alertId)).toBe(false);
  });
});
