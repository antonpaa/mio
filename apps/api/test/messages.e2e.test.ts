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
 * WP-23: one thread per programme, structured documents, and the
 * boundary that matters most - internal notes never reach a patient
 * through any path, and nothing outside the document schema survives
 * to storage.
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
    (team?.leadIds.length ?? 0) > 0 &&
    (team?.memberIds.filter((id) => !team.leadIds.includes(id)).length ?? 0) > 0
  );
})!;
const team = world.teams.find((candidate) => candidate.id === treatment.teamId)!;
const lead = world.staff.find((s) => team.leadIds.includes(s.id))!;
const member = world.staff.find(
  (s) =>
    team.memberIds.includes(s.id) &&
    !team.leadIds.includes(s.id) &&
    s.roles.includes('clinician') &&
    !s.roles.includes('administrator'),
)!;
const patient = world.patients.find((p) => p.id === treatment.patientId)!;
const outsider = world.staff.find(
  (s) =>
    !team.memberIds.includes(s.id) &&
    !team.leadIds.includes(s.id) &&
    !(world.careRelationships.get(patient.id) ?? []).includes(s.id),
)!;
const otherPatient = world.patients.find((p) => p.id !== patient.id)!;

let leadCookie: string;
let memberCookie: string;
let outsiderCookie: string;
let patientCookie: string;
let otherPatientCookie: string;

function doc(text: string): object {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

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
  otherPatientCookie = await signIn('patient', otherPatient.email);
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

describe('the thread lifecycle', () => {
  // seedWorld already grew a conversation on this treatment - the
  // assertions are relative to that baseline, not absolute counts
  it('the patient posts - the staff inbox unread rises by one, their own falls to zero', async () => {
    const before = await inject('GET', '/api/staff/messages', undefined, leadCookie);
    const beforeRow = (before.json() as { treatment_id: string; unread: number }[]).find(
      (entry) => entry.treatment_id === treatment.id,
    )!;

    const posted = await inject(
      'POST',
      `/api/patient/messages/threads/${treatment.id}/messages`,
      { body: doc('The nausea got worse over the weekend.') },
      patientCookie,
    );
    expect(posted.statusCode).toBe(201);

    const inbox = await inject('GET', '/api/staff/messages', undefined, leadCookie);
    expect(inbox.statusCode).toBe(200);
    const row = (
      inbox.json() as { treatment_id: string; unread: number; last_preview: string | null }[]
    ).find((entry) => entry.treatment_id === treatment.id)!;
    expect(row.unread).toBe(beforeRow.unread + 1);
    expect(row.last_preview).toContain('nausea got worse');

    const own = await inject('GET', '/api/patient/messages', undefined, patientCookie);
    const ownRow = (own.json() as { treatment_id: string; unread: number }[]).find(
      (entry) => entry.treatment_id === treatment.id,
    )!;
    // posting moves YOUR watermark - you were in the thread to write
    expect(ownRow.unread).toBe(0);

    // the outbox carries references for WP-25, never message text - the
    // seeded conversations write none, so this post's row is the only one
    const { rows: outbox } = await owner.query<{ payload: { messageId: string } }>(
      `SELECT payload FROM clinical.notification_outbox WHERE kind = 'message.new'`,
    );
    expect(outbox.length).toBe(1);
    expect(JSON.stringify(outbox[0]!.payload)).not.toContain('nausea');
  });

  it('a staff reply and an internal note land in the team timeline; the patient sees only the reply', async () => {
    const reply = await inject(
      'POST',
      `/api/staff/messages/threads/${treatment.id}/messages`,
      { body: doc('Thank you for telling us - we will adjust the anti-nausea plan.') },
      leadCookie,
    );
    expect(reply.statusCode).toBe(201);
    const note = await inject(
      'POST',
      `/api/staff/messages/threads/${treatment.id}/notes`,
      { body: doc('Consider moving the antiemetic earlier; check with the ward.') },
      leadCookie,
    );
    expect(note.statusCode).toBe(201);

    const staffView = await inject(
      'GET',
      `/api/staff/messages/threads/${treatment.id}`,
      undefined,
      memberCookie,
    );
    expect(staffView.statusCode).toBe(200);
    const staffBody = staffView.json() as { items: { kind: string }[]; alerts: unknown[] };
    // this test's own tail, after whatever the seed put first
    expect(staffBody.items.slice(-3).map((item) => item.kind)).toEqual([
      'message',
      'message',
      'note',
    ]);
    expect(staffBody.items.some((item) => item.kind === 'note')).toBe(true);
    expect(Array.isArray(staffBody.alerts)).toBe(true);

    const patientView = await inject(
      'GET',
      `/api/patient/messages/threads/${treatment.id}`,
      undefined,
      patientCookie,
    );
    expect(patientView.statusCode).toBe(200);
    const patientBody = patientView.json() as { items: { kind: string }[] };
    // every note - ours and the seeded one - is absent, in kind and in text
    expect(patientBody.items.every((item) => item.kind === 'message')).toBe(true);
    expect(patientBody.items.length).toBe(
      staffBody.items.filter((item) => item.kind === 'message').length,
    );
    expect(patientView.body).not.toContain('antiemetic');
    expect(patientView.body).not.toContain('pahoinvointilääkityksen annostus');
  });

  it('reading moves the watermark - the unread count falls to zero', async () => {
    const own = await inject('GET', '/api/patient/messages', undefined, patientCookie);
    const ownRow = (own.json() as { treatment_id: string; unread: number }[]).find(
      (entry) => entry.treatment_id === treatment.id,
    )!;
    expect(ownRow.unread).toBe(0); // the thread view above marked it read
  });
});

describe('the document schema is the boundary', () => {
  it('anything outside the schema does not survive to storage', async () => {
    const posted = await inject(
      'POST',
      `/api/patient/messages/threads/${treatment.id}/messages`,
      {
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'clean text', onclick: 'steal()' }],
            },
            { type: 'iframe', src: 'https://evil.example' },
          ],
        },
      },
      patientCookie,
    );
    expect(posted.statusCode).toBe(201);
    const { id } = posted.json() as { id: string };
    const { rows } = await owner.query<{ body: unknown }>(
      `SELECT body FROM clinical.message WHERE id = $1`,
      [id],
    );
    const stored = JSON.stringify(rows[0]!.body);
    expect(stored).toContain('clean text');
    expect(stored).not.toContain('iframe');
    expect(stored).not.toContain('onclick');
  });

  it('editor HTML and empty documents are rejected outright', async () => {
    const html = await inject(
      'POST',
      `/api/patient/messages/threads/${treatment.id}/messages`,
      { body: '<b>hi</b>' },
      patientCookie,
    );
    expect(html.statusCode).toBe(400);
    const blank = await inject(
      'POST',
      `/api/patient/messages/threads/${treatment.id}/messages`,
      { body: { type: 'doc', content: [] } },
      patientCookie,
    );
    expect(blank.statusCode).toBe(400);
  });
});

describe('scope and lifecycle boundaries', () => {
  it('outsider staff and other patients get the same 404 as an unknown id', async () => {
    const outsiderView = await inject(
      'GET',
      `/api/staff/messages/threads/${treatment.id}`,
      undefined,
      outsiderCookie,
    );
    expect(outsiderView.statusCode).toBe(404);
    const crossPatient = await inject(
      'GET',
      `/api/patient/messages/threads/${treatment.id}`,
      undefined,
      otherPatientCookie,
    );
    expect(crossPatient.statusCode).toBe(404);
  });

  it('an ended programme keeps its thread readable and takes no new posts', async () => {
    await owner.query(`UPDATE clinical.treatment SET state = 'completed' WHERE id = $1`, [
      treatment.id,
    ]);
    const view = await inject(
      'GET',
      `/api/patient/messages/threads/${treatment.id}`,
      undefined,
      patientCookie,
    );
    expect(view.statusCode).toBe(200);
    expect((view.json() as { readOnly: boolean }).readOnly).toBe(true);

    const patientPost = await inject(
      'POST',
      `/api/patient/messages/threads/${treatment.id}/messages`,
      { body: doc('one more thing') },
      patientCookie,
    );
    expect(patientPost.statusCode).toBe(409);
    const staffNote = await inject(
      'POST',
      `/api/staff/messages/threads/${treatment.id}/notes`,
      { body: doc('late note') },
      leadCookie,
    );
    expect(staffNote.statusCode).toBe(409);
  });
});
