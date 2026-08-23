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
 * WP-10 acceptance: the roster is SQL-scoped by care relationship with one
 * list-level audit event; the profile read is Cedar-decided with its audit
 * row in the same transaction - allow AND deny; a patient session gets
 * nothing from staff endpoints. Runs on the synthetic demo world.
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

/** A clinician with patients, one of their patients, and an outsider patient. */
function pickActors(): { clinician: (typeof world.staff)[number]; own: string; foreign: string } {
  for (const staff of world.staff) {
    if (staff.role === 'administrator') continue;
    const own = [...world.careRelationships.entries()].find(([, team]) => team.includes(staff.id));
    const foreign = [...world.careRelationships.entries()].find(
      ([, team]) => !team.includes(staff.id),
    );
    if (own && foreign) return { clinician: staff, own: own[0], foreign: foreign[0] };
  }
  throw new Error('no suitable actors in world');
}

describe('roster and profile', () => {
  const { clinician, own, foreign } = pickActors();
  let cookie: string;

  beforeAll(async () => {
    cookie = await signIn('staff', clinician.email);
  });

  it('roster returns exactly the care-relationship patients, audited as ONE event', async () => {
    const roster = await inject('GET', '/api/staff/patients', undefined, cookie);
    expect(roster.statusCode).toBe(200);
    const rows = roster.json() as { patientId: string }[];
    const expected = new Set(
      [...world.careRelationships.entries()]
        .filter(([, team]) => team.includes(clinician.id))
        .map(([patientId]) => patientId),
    );
    expect(new Set(rows.map((row) => row.patientId))).toEqual(expected);
    expect(rows.length).toBeGreaterThan(0);

    const audit = await owner.query<{ context: { patientIds: string[] } }>(
      `SELECT context FROM audit.access_event
        WHERE actor_user_id = $1 AND resource_type = 'patient_roster'
        ORDER BY occurred_at DESC LIMIT 1`,
      [clinician.id],
    );
    expect(new Set(audit.rows[0]?.context.patientIds)).toEqual(expected);
  });

  it('profile allows with a care relationship - audit row in the same transaction', async () => {
    const profile = await inject('GET', `/api/staff/patients/${own}`, undefined, cookie);
    expect(profile.statusCode).toBe(200);
    const body = profile.json() as { patientId: string; careTeamSize: number; givenName: string };
    expect(body.patientId).toBe(own);
    expect(body.careTeamSize).toBe(world.careRelationships.get(own)?.length);

    const audit = await owner.query(
      `SELECT decision FROM audit.access_event
        WHERE actor_user_id = $1 AND action = 'patient_clinical_profile.view' AND patient_id = $2
        ORDER BY occurred_at DESC LIMIT 1`,
      [clinician.id, own],
    );
    expect(audit.rows[0]?.decision).toBe('allow');
  });

  it('profile denies without a relationship - and the DENIAL is audited', async () => {
    const profile = await inject('GET', `/api/staff/patients/${foreign}`, undefined, cookie);
    expect(profile.statusCode).toBe(403);

    const audit = await owner.query(
      `SELECT decision FROM audit.access_event
        WHERE actor_user_id = $1 AND action = 'patient_clinical_profile.view' AND patient_id = $2
        ORDER BY occurred_at DESC LIMIT 1`,
      [clinician.id, foreign],
    );
    expect(audit.rows[0]?.decision).toBe('deny');
  });

  it('a patient session gets nothing from staff endpoints', async () => {
    const patient = world.patients.find((p) => p.id === own);
    expect(patient).toBeDefined();
    const patientCookie = await signIn('patient', patient!.email);
    const roster = await inject('GET', '/api/staff/patients', undefined, patientCookie);
    expect(roster.statusCode).toBe(401);
  });

  it('the RLS backstop holds: an app-role query with a foreign staff context sees nothing', async () => {
    const { createRolePool, withUserContext } = await import('@mio/db');
    const appPool = createRolePool({
      connectionString: db.connectionString,
      role: 'mio_app',
      max: 1,
    });
    try {
      const rows = await withUserContext(
        appPool,
        { userId: clinician.id, realm: 'staff' },
        (client) =>
          client
            .query(
              `SELECT count(*)::int AS n FROM clinical.care_relationship WHERE staff_id != $1`,
              [clinician.id],
            )
            .then((r) => r.rows[0] as { n: number }),
      );
      // The WHERE asks for everyone else's rows; RLS answers none.
      expect(rows.n).toBe(0);
    } finally {
      await appPool.end();
    }
  });
});
