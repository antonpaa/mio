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

const lead = world.staff.find(
  (s) => s.roles.includes('author') && world.teams.some((t) => t.leadIds.includes(s.id)),
)!;
const member = world.staff.find(
  (s) =>
    s.roles.includes('clinician') &&
    !s.roles.includes('author') &&
    !s.roles.includes('administrator'),
)!;
let leadCookie: string;
let memberCookie: string;

beforeAll(async () => {
  leadCookie = await signIn('staff', lead.email);
  memberCookie = await signIn('staff', member.email);
});

describe('template catalog (T2)', () => {
  it('lists templates with versions and in-use counts', async () => {
    const catalog = await inject('GET', '/api/staff/templates', undefined, leadCookie);
    expect(catalog.statusCode).toBe(200);
    const rows = catalog.json() as {
      name: string;
      version: number;
      state: string;
      in_use: number;
    }[];
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.some((row) => row.state === 'draft')).toBe(true);
    expect(rows.some((row) => row.in_use > 0)).toBe(true);
  });

  it('members cannot create templates; leads can - and publishing makes it selectable', async () => {
    const denied = await inject(
      'POST',
      '/api/staff/templates',
      { name: 'Member template' },
      memberCookie,
    );
    expect(denied.statusCode).toBe(403);

    const created = await inject(
      'POST',
      '/api/staff/templates',
      { name: 'Palliative support plan', detail: 'Weekly follow-up' },
      leadCookie,
    );
    expect(created.statusCode).toBe(201);
    const { versionId } = created.json() as { versionId: string };

    // Draft versions cannot be instantiated...
    const anyPatient = world.patients[0]!;
    const draftUse = await inject(
      'POST',
      '/api/staff/treatments',
      { templateVersionId: versionId, patientId: anyPatient.id },
      leadCookie,
    );
    expect(draftUse.statusCode).toBe(400);

    const published = await inject(
      'POST',
      `/api/staff/templates/versions/${versionId}/publish`,
      {},
      leadCookie,
    );
    expect(published.statusCode).toBe(200);

    // ...and a published version is immutable: editing creates the next draft.
    const republish = await inject(
      'POST',
      `/api/staff/templates/versions/${versionId}/publish`,
      {},
      leadCookie,
    );
    expect(republish.statusCode).toBe(400);
    const nextDraft = await inject(
      'POST',
      `/api/staff/templates/versions/${versionId}/new-draft`,
      {},
      leadCookie,
    );
    expect(nextDraft.statusCode).toBe(201);
    expect((nextDraft.json() as { version: number }).version).toBe(2);
  });
});

describe('instantiate -> team -> lifecycle (T1)', () => {
  let treatmentId: string;
  let patientId: string;
  let publishedVersionId: string;

  beforeAll(async () => {
    // a patient the lead has NO relationship with yet - instantiation creates it
    const strangers = world.patients.filter(
      (p) => !(world.careRelationships.get(p.id) ?? []).includes(lead.id),
    );
    patientId = strangers[0]!.id;
    const created = await inject(
      'POST',
      '/api/staff/templates',
      { name: 'Recovery follow-up' },
      leadCookie,
    );
    publishedVersionId = (created.json() as { versionId: string }).versionId;
    await inject(
      'POST',
      `/api/staff/templates/versions/${publishedVersionId}/publish`,
      {},
      leadCookie,
    );
  });

  it('instantiating copies the template, makes the creator lead, and creates the care relationship', async () => {
    const before = await inject('GET', '/api/staff/patients', undefined, leadCookie);
    const beforeIds = new Set((before.json() as { patientId: string }[]).map((r) => r.patientId));
    expect(beforeIds.has(patientId)).toBe(false);

    const created = await inject(
      'POST',
      '/api/staff/treatments',
      { templateVersionId: publishedVersionId, patientId },
      leadCookie,
    );
    expect(created.statusCode).toBe(201);
    treatmentId = (created.json() as { treatmentId: string }).treatmentId;

    const detail = await inject(
      'GET',
      `/api/staff/treatments/${treatmentId}`,
      undefined,
      leadCookie,
    );
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      state: string;
      template: { template_name?: string; version: number } | null;
      team: { staff_id: string | null; role: string }[];
      legalTransitions: string[];
    };
    expect(body.state).toBe('draft');
    expect(body.team.some((m) => m.staff_id === lead.id && m.role === 'lead')).toBe(true);
    expect(body.legalTransitions).toContain('active');

    // the care graph grew in the same transaction: the roster shows the patient now
    const after = await inject('GET', '/api/staff/patients', undefined, leadCookie);
    const afterIds = new Set((after.json() as { patientId: string }[]).map((r) => r.patientId));
    expect(afterIds.has(patientId)).toBe(true);
  });

  it('attaching a staff TEAM pulls its members into the care graph', async () => {
    const team = world.teams[0]!;
    const added = await inject(
      'POST',
      `/api/staff/treatments/${treatmentId}/team`,
      { teamId: team.id },
      leadCookie,
    );
    expect(added.statusCode).toBe(200);
    const { rows } = await owner.query<{ staff_id: string }>(
      `SELECT staff_id FROM clinical.care_relationship
        WHERE treatment_id = $1 AND ended_at IS NULL`,
      [treatmentId],
    );
    const staffIds = new Set(rows.map((row) => row.staff_id));
    for (const memberId of team.memberIds) {
      expect(staffIds.has(memberId), `team member ${memberId} missing from care graph`).toBe(true);
    }
  });

  it('lifecycle: draft->active sets started_at; illegal jumps rejected; members denied and audited', async () => {
    const memberAttempt = await inject(
      'POST',
      `/api/staff/treatments/${treatmentId}/state`,
      { to: 'active' },
      memberCookie,
    );
    expect(memberAttempt.statusCode).toBe(403);
    const deniedAudit = await owner.query(
      `SELECT decision FROM audit.access_event
        WHERE action = 'treatment.change_lifecycle_state' AND actor_user_id = $1
        ORDER BY occurred_at DESC LIMIT 1`,
      [member.id],
    );
    expect(deniedAudit.rows[0]?.decision).toBe('deny');

    const illegal = await inject(
      'POST',
      `/api/staff/treatments/${treatmentId}/state`,
      { to: 'paused' },
      leadCookie,
    );
    expect(illegal.statusCode).toBe(400);

    const activated = await inject(
      'POST',
      `/api/staff/treatments/${treatmentId}/state`,
      { to: 'active' },
      leadCookie,
    );
    expect(activated.statusCode).toBe(200);
    const { rows } = await owner.query(
      `SELECT state, started_at FROM clinical.treatment WHERE id = $1`,
      [treatmentId],
    );
    expect(rows[0]?.state).toBe('active');
    expect(rows[0]?.started_at).not.toBeNull();

    const change = await owner.query(
      `SELECT detail FROM audit.change_event
        WHERE action = 'treatment.change_lifecycle_state' AND resource_id = $1
        ORDER BY occurred_at DESC LIMIT 1`,
      [treatmentId],
    );
    expect(change.rows[0]?.detail).toMatchObject({ from: 'draft', to: 'active' });
  });

  it('PP1: the patient treatment list is relationship-gated', async () => {
    const allowed = await inject(
      'GET',
      `/api/staff/patients/${patientId}/treatments`,
      undefined,
      leadCookie,
    );
    expect(allowed.statusCode).toBe(200);
    const rows = allowed.json() as { id: string; template_name: string | null }[];
    expect(rows.some((row) => row.id === treatmentId)).toBe(true);

    const outsider = world.staff.find(
      (s) =>
        s.roles.includes('clinician') &&
        !s.roles.includes('administrator') &&
        s.id !== lead.id && // the instantiate test above gave the lead a relationship
        !(world.careRelationships.get(patientId) ?? []).includes(s.id) &&
        !world.teams[0]!.memberIds.includes(s.id),
    );
    if (outsider) {
      const outsiderCookie = await signIn('staff', outsider.email);
      const denied = await inject(
        'GET',
        `/api/staff/patients/${patientId}/treatments`,
        undefined,
        outsiderCookie,
      );
      expect(denied.statusCode).toBe(403);
    }
  });

  it('P5: the patient sees their own treatments with the team, and only their own', async () => {
    const patient = world.patients.find((p) => p.id === patientId)!;
    const cookie = await signIn('patient', patient.email);
    const list = await inject('GET', '/api/patient/treatments', undefined, cookie);
    expect(list.statusCode).toBe(200);
    const rows = list.json() as { id: string; team: { is_lead: boolean }[] }[];
    expect(rows.some((row) => row.id === treatmentId)).toBe(true);
    expect(rows.every((row) => row.team.length > 0)).toBe(true);
    // every returned treatment belongs to this patient
    const { rows: ownRows } = await owner.query(
      `SELECT id FROM clinical.treatment WHERE patient_id = $1`,
      [patient.id],
    );
    const ownIds = new Set(ownRows.map((row) => (row as { id: string }).id));
    for (const row of rows) expect(ownIds.has(row.id)).toBe(true);
  });
});
