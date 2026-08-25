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
const lead = world.staff.find((s) => world.teams.some((t) => t.leadIds.includes(s.id)))!;
const treatment = world.treatments.find((t) => {
  const team = world.teams.find((team) => team.id === t.teamId);
  return t.state === 'active' && team?.leadIds.includes(lead.id);
})!;
const team = world.teams.find((t) => t.id === treatment.teamId)!;
// a plain clinician on the same team who does NOT hold the lead position
// there - task.complete is own OR team_lead, so for them only 'own' applies
const member = world.staff.find(
  (s) =>
    s.roles.includes('clinician') &&
    !s.roles.includes('administrator') &&
    team.memberIds.includes(s.id) &&
    !team.leadIds.includes(s.id),
)!;
// an active staffer caring for this patient in NO treatment at all, so the
// RLS backstop (patient-level) and Cedar (treatment-level) both exclude them
const caringStaff = new Set(
  world.treatments
    .filter((t) => t.patientId === treatment.patientId)
    .flatMap((t) => {
      const tm = world.teams.find((candidate) => candidate.id === t.teamId);
      return tm ? [...tm.memberIds, ...tm.leadIds] : [];
    }),
);
const outsider = world.staff.find(
  (s) =>
    s.roles.includes('clinician') && !s.roles.includes('administrator') && !caringStaff.has(s.id),
)!;

let leadCookie: string;
let memberCookie: string;
let outsiderCookie: string;

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
  leadCookie = await signIn(lead.email);
  memberCookie = await signIn(member.email);
  outsiderCookie = await signIn(outsider.email);
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
  const login = await inject('POST', `/api/staff/auth/login`, { email, password: DEMO_PASSWORD });
  expect(login.statusCode).toBe(200);
  const { challengeId } = login.json() as { challengeId: string };
  const verify = await inject('POST', `/api/staff/auth/verify`, {
    challengeId,
    code: mailer.lastCodeFor(email),
  });
  expect(verify.statusCode).toBe(200);
  const setCookie = verify.headers['set-cookie'];
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (value as string).split(';')[0] as string;
}

describe('team queue: create, claim, assign (C5)', () => {
  let queueTaskId: string;

  it('creates an unclaimed task; the worklist shows it with patient context and audits ONE event', async () => {
    const created = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/tasks`,
      { title: 'Call patient about lab results', dueDate: '2026-08-25' },
      leadCookie,
    );
    expect(created.statusCode).toBe(201);
    queueTaskId = (created.json() as { taskId: string }).taskId;

    const list = await inject('GET', '/api/staff/tasks', undefined, memberCookie);
    expect(list.statusCode).toBe(200);
    const rows = list.json() as {
      id: string;
      assignee_id: string | null;
      patient_given: string;
      treatment_name: string;
      due_date: string;
    }[];
    const mine = rows.find((row) => row.id === queueTaskId)!;
    expect(mine.assignee_id).toBeNull();
    expect(mine.treatment_name).toBe(treatment.name);
    expect(mine.due_date).toBe('2026-08-25');
    expect(mine.patient_given.length).toBeGreaterThan(0);

    const { rows: audits } = await owner.query(
      `SELECT context FROM audit.access_event
        WHERE actor_user_id = $1 AND action = 'task.view' AND resource_type = 'task_worklist'
        ORDER BY occurred_at DESC LIMIT 1`,
      [member.id],
    );
    expect(audits).toHaveLength(1);
    expect((audits[0] as { context: { patientIds: string[] } }).context.patientIds).toContain(
      treatment.patientId,
    );
  });

  it('an off-team staffer sees an empty worklist and cannot touch the task', async () => {
    const list = await inject('GET', '/api/staff/tasks', undefined, outsiderCookie);
    expect(list.statusCode).toBe(200);
    expect((list.json() as { id: string }[]).find((row) => row.id === queueTaskId)).toBeUndefined();
    // the RLS backstop hides the row entirely - not-found, never "exists
    // but forbidden", so the response discloses nothing
    const claim = await inject('POST', `/api/staff/tasks/${queueTaskId}/claim`, {}, outsiderCookie);
    expect(claim.statusCode).toBe(404);
  });

  it('claim is first-writer-wins; the loser gets 409', async () => {
    const claimed = await inject('POST', `/api/staff/tasks/${queueTaskId}/claim`, {}, memberCookie);
    expect(claimed.statusCode).toBe(200);
    expect((claimed.json() as { assigneeId: string }).assigneeId).toBe(member.id);
    const again = await inject('POST', `/api/staff/tasks/${queueTaskId}/claim`, {}, leadCookie);
    expect(again.statusCode).toBe(409);
  });

  it('assign_to_other validates team membership', async () => {
    const bad = await inject(
      'POST',
      `/api/staff/tasks/${queueTaskId}/assign`,
      { assigneeId: outsider.id },
      leadCookie,
    );
    expect(bad.statusCode).toBe(400);
    const ok = await inject(
      'POST',
      `/api/staff/tasks/${queueTaskId}/assign`,
      { assigneeId: lead.id },
      leadCookie,
    );
    expect(ok.statusCode).toBe(200);
  });

  it('complete: a member may complete only OWN tasks; the lead completes any; the log entry lands', async () => {
    // task now assigned to the lead - the member is denied (matrix: own)
    const denied = await inject(
      'POST',
      `/api/staff/tasks/${queueTaskId}/complete`,
      {},
      memberCookie,
    );
    expect(denied.statusCode).toBe(403);
    const done = await inject('POST', `/api/staff/tasks/${queueTaskId}/complete`, {}, leadCookie);
    expect(done.statusCode).toBe(200);

    const { rows } = await owner.query(
      `SELECT detail FROM audit.change_event
        WHERE action = 'task.complete' AND resource_id = $1`,
      [queueTaskId],
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { detail: { treatmentId: string } }).detail.treatmentId).toBe(treatment.id);

    // completed tasks are done - no second completion, no reopening
    const again = await inject('POST', `/api/staff/tasks/${queueTaskId}/complete`, {}, leadCookie);
    expect(again.statusCode).toBe(400);
  });

  it('a member completes their own claimed task', async () => {
    const created = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/tasks`,
      { title: 'Order infusion supplies', assigneeId: member.id },
      memberCookie,
    );
    expect(created.statusCode).toBe(201);
    const { taskId } = created.json() as { taskId: string };
    const done = await inject('POST', `/api/staff/tasks/${taskId}/complete`, {}, memberCookie);
    expect(done.statusCode).toBe(200);
  });
});

describe('treatment task list and staff lookup (T1)', () => {
  it('lists the treatment tasks open-first and resolves the assign dropdown', async () => {
    const list = await inject(
      'GET',
      `/api/staff/treatments/${treatment.id}/tasks`,
      undefined,
      leadCookie,
    );
    expect(list.statusCode).toBe(200);
    const rows = list.json() as { status: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const staffList = await inject(
      'GET',
      `/api/staff/treatments/${treatment.id}/staff`,
      undefined,
      leadCookie,
    );
    expect(staffList.statusCode).toBe(200);
    const staffRows = staffList.json() as { staff_id: string; is_lead: boolean }[];
    expect(staffRows.find((row) => row.staff_id === lead.id)?.is_lead).toBe(true);
    expect(staffRows.some((row) => row.staff_id === member.id)).toBe(true);
  });

  it('patients have no path to tasks', async () => {
    const anyPatient = world.patients[0]!;
    const login = await inject('POST', '/api/patient/auth/login', {
      email: anyPatient.email,
      password: DEMO_PASSWORD,
    });
    expect(login.statusCode).toBe(200);
    const { challengeId } = login.json() as { challengeId: string };
    const verify = await inject('POST', '/api/patient/auth/verify', {
      challengeId,
      code: mailer.lastCodeFor(anyPatient.email),
    });
    const setCookie = verify.headers['set-cookie'];
    const cookie = ((Array.isArray(setCookie) ? setCookie[0] : setCookie) as string).split(';')[0]!;
    const list = await inject('GET', '/api/staff/tasks', undefined, cookie);
    expect(list.statusCode).toBe(401);
  });
});
