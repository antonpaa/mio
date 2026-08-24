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
 * WP-26 self-service: the P8 profile, "Who has viewed my records" over
 * the dedicated audit-reader role, and the GDPR export assembled under
 * the patient's own RLS - what it CAN contain is what the patient can
 * read, so internal notes are absent by construction.
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
  return t.state === 'active' && (team?.leadIds.length ?? 0) > 0;
})!;
const team = world.teams.find((candidate) => candidate.id === treatment.teamId)!;
const lead = world.staff.find((s) => team.leadIds.includes(s.id))!;
const patient = world.patients.find((p) => p.id === treatment.patientId)!;

let leadCookie: string;
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
  patientCookie = await signIn('patient', patient.email);
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await db?.stop();
});

function inject(method: 'GET' | 'POST' | 'PUT', url: string, payload?: object, cookie?: string) {
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

describe('the profile', () => {
  it('reads and updates contact details and language; garbage is refused', async () => {
    const before = await inject('GET', '/api/patient/settings/profile', undefined, patientCookie);
    expect(before.statusCode).toBe(200);
    expect((before.json() as { email: string }).email).toBe(patient.email);

    const put = await inject(
      'PUT',
      '/api/patient/settings/profile',
      { phone: '+358 40 7654321', locale: 'sv' },
      patientCookie,
    );
    expect(put.statusCode).toBe(200);
    const after = await inject('GET', '/api/patient/settings/profile', undefined, patientCookie);
    const profile = after.json() as { phone: string; locale: string };
    expect(profile.phone).toBe('+358 40 7654321');
    expect(profile.locale).toBe('sv');

    const bad = await inject(
      'PUT',
      '/api/patient/settings/profile',
      { locale: 'de' },
      patientCookie,
    );
    expect(bad.statusCode).toBe(400);
  });
});

describe('who has viewed my records', () => {
  it('lists direct reads and worklist disclosures with the clinician named', async () => {
    // a direct audited read of this patient...
    const profileRead = await inject(
      'GET',
      `/api/staff/patients/${patient.id}`,
      undefined,
      leadCookie,
    );
    expect(profileRead.statusCode).toBe(200);
    // ...and a worklist disclosure that carries the patient only inside
    // context.patientIds
    const inbox = await inject('GET', '/api/staff/messages', undefined, leadCookie);
    expect(inbox.statusCode).toBe(200);

    const history = await inject(
      'GET',
      '/api/patient/privacy/access-history',
      undefined,
      patientCookie,
    );
    expect(history.statusCode).toBe(200);
    const { events } = history.json() as {
      events: { action: string; actor_family: string | null }[];
    };
    expect(events.length).toBeGreaterThan(0);
    const direct = events.find((event) => event.action.startsWith('patient_clinical_profile'));
    expect(direct?.actor_family).toBe(lead.familyName);
    expect(events.some((event) => event.action === 'message_thread.view')).toBe(true);
  });
});

describe('the export', () => {
  it('carries the patient record but never an internal note; both actions audited', async () => {
    const note = await inject(
      'POST',
      `/api/staff/messages/threads/${treatment.id}/notes`,
      {
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'EXPORT-CANARY: internal wording, staff only.' }],
            },
          ],
        },
      },
      leadCookie,
    );
    expect(note.statusCode).toBe(201);

    // audit is append-only and the scratch database is shared across
    // suite runs - count relatively, not absolutely
    const { rows: before } = await owner.query(
      `SELECT count(*)::int AS n FROM audit.access_event
        WHERE actor_user_id = $1 AND action LIKE 'own_data_export.%'`,
      [patient.id],
    );
    const response = await inject('POST', '/api/patient/privacy/export', {}, patientCookie);
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      format: string;
      account: { email: string };
      treatments: unknown[];
      messages: unknown[];
      surveyResponses: unknown[];
    };
    expect(body.format).toBe('mio-export/v1');
    expect(body.account.email).toBe(patient.email);
    expect(body.treatments.length).toBeGreaterThan(0);
    expect(body.messages.length).toBeGreaterThan(0); // the seeded conversation
    expect(response.body).not.toContain('EXPORT-CANARY');

    const { rows } = await owner.query(
      `SELECT action, count(*)::int AS n FROM audit.access_event
        WHERE actor_user_id = $1 AND action LIKE 'own_data_export.%'
        GROUP BY action ORDER BY action`,
      [patient.id],
    );
    const total = (rows as { n: number }[]).reduce((sum, row) => sum + row.n, 0);
    expect((rows as { action: string }[]).map((row) => row.action)).toEqual([
      'own_data_export.download',
      'own_data_export.request',
    ]);
    expect(total).toBe((before[0] as { n: number }).n + 2);
  });
});
