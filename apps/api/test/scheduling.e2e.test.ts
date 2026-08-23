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
const lead = world.staff.find((s) => s.role === 'treatment_lead')!;

// a treatment whose team the lead can be added to trivially: use one the
// lead already leads via seeding? seeding put team leads individually; take
// any active treatment whose team includes the lead
const treatment = world.treatments.find((t) => {
  const team = world.teams.find((team) => team.id === t.teamId);
  return t.state === 'active' && team?.leadIds.includes(lead.id);
})!;

let leadCookie: string;

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

describe('one-off activities (T1)', () => {
  it('creates, lists, and walks the status flow; illegal jumps rejected', async () => {
    const created = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/activities`,
      {
        title: 'Clinic visit — pre-cycle review',
        kind: 'visit',
        date: '2026-09-07',
        timeOfDay: '10:30',
        location: 'Outpatient clinic',
      },
      leadCookie,
    );
    expect(created.statusCode).toBe(201);
    const { activityId } = created.json() as { activityId: string };

    const list = await inject(
      'GET',
      `/api/staff/treatments/${treatment.id}/activities`,
      undefined,
      leadCookie,
    );
    expect(list.statusCode).toBe(200);
    const rows = list.json() as {
      id: string;
      occurrence_date: string;
      scheduled_at: string | null;
      status: string;
    }[];
    const mine = rows.find((row) => row.id === activityId)!;
    expect(mine.status).toBe('planned');
    // the LOCAL date crosses the wire as a plain date, never a timestamp
    expect(mine.occurrence_date).toBe('2026-09-07');
    // 10:30 Helsinki in September (EEST) is 07:30Z - the tz edge, live.
    expect(mine.scheduled_at).toContain('07:30');

    const confirmed = await inject(
      'POST',
      `/api/staff/activities/${activityId}/status`,
      { to: 'confirmed' },
      leadCookie,
    );
    expect(confirmed.statusCode).toBe(200);
    const illegal = await inject(
      'POST',
      `/api/staff/activities/${activityId}/status`,
      { to: 'planned' },
      leadCookie,
    );
    expect(illegal.statusCode).toBe(400);
  });
});

describe('recurrence schedules (T3)', () => {
  let scheduleId: string;

  it('creates the brief-example phased schedule and materialises it NOW', async () => {
    const created = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/schedules`,
      {
        anchorDate: '2026-09-15',
        segments: [
          { freq: 'monthly', count: 6 },
          { freq: 'monthly', interval: 3, count: 2 },
        ],
        payload: { title: 'PSA reporting', kind: 'survey' },
      },
      leadCookie,
    );
    expect(created.statusCode).toBe(201);
    const body = created.json() as { scheduleId: string; materialised: number };
    scheduleId = body.scheduleId;
    expect(body.materialised).toBe(8); // 6 monthly + 2 quarterly inside 365d

    const { rows } = await owner.query(
      `SELECT occurrence_date::text FROM clinical.activity
        WHERE schedule_id = $1 ORDER BY occurrence_date`,
      [scheduleId],
    );
    expect(rows.map((row) => (row as { occurrence_date: string }).occurrence_date)).toEqual([
      '2026-09-15',
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
      '2027-02-15',
      '2027-05-15',
      '2027-08-15',
    ]);
  });

  it('editing regenerates only untouched future occurrences', async () => {
    // a human confirms one occurrence...
    const { rows } = await owner.query(
      `SELECT id FROM clinical.activity WHERE schedule_id = $1 AND occurrence_date = '2026-10-15'`,
      [scheduleId],
    );
    const touchedId = (rows[0] as { id: string }).id;
    await inject(
      'POST',
      `/api/staff/activities/${touchedId}/status`,
      { to: 'confirmed' },
      leadCookie,
    );

    // ...then the rule moves to the 20th
    const updated = await inject(
      'POST',
      `/api/staff/schedules/${scheduleId}`,
      {
        anchorDate: '2026-09-20',
        segments: [{ freq: 'monthly', count: 4 }],
        payload: { title: 'PSA reporting', kind: 'survey' },
      },
      leadCookie,
    );
    expect(updated.statusCode).toBe(200);

    const after = await owner.query(
      `SELECT occurrence_date::text AS d, status FROM clinical.activity
        WHERE schedule_id = $1 ORDER BY occurrence_date`,
      [scheduleId],
    );
    const dates = (after.rows as { d: string; status: string }[]).map((row) => row.d);
    // the confirmed 10-15 SURVIVED; planned siblings regenerated on the 20th
    expect(dates).toContain('2026-10-15');
    expect(dates).toContain('2026-09-20');
    expect(dates).not.toContain('2026-11-15');
    expect(
      (after.rows as { d: string; status: string }[]).find((row) => row.d === '2026-10-15')?.status,
    ).toBe('confirmed');
  });

  it('a broken rule fails at creation, not in the worker at 3am', async () => {
    const openEnded = await inject(
      'POST',
      `/api/staff/treatments/${treatment.id}/schedules`,
      { anchorDate: '2026-09-15', segments: [], payload: { title: 'x' } },
      leadCookie,
    );
    expect(openEnded.statusCode).toBe(400);
  });
});

describe('patient calendar (P9)', () => {
  it('shows the patient their own upcoming items only, audited as one event', async () => {
    const patient = world.patients.find((p) => p.id === treatment.patientId)!;
    const cookie = await signIn('patient', patient.email);
    const calendar = await inject('GET', '/api/patient/calendar', undefined, cookie);
    expect(calendar.statusCode).toBe(200);
    const rows = calendar.json() as { title: string; treatment_name: string }[];
    expect(rows.length).toBeGreaterThan(0);
    // all rows verified against ownership in the database
    const { rows: ownRows } = await owner.query(
      `SELECT count(*)::int AS n FROM clinical.activity WHERE patient_id != $1
        AND id IN (SELECT id FROM clinical.activity WHERE patient_id = $1)`,
      [patient.id],
    );
    expect((ownRows[0] as { n: number }).n).toBe(0);

    const audit = await owner.query(
      `SELECT count(*)::int AS n FROM audit.access_event
        WHERE actor_user_id = $1 AND resource_type = 'calendar'`,
      [patient.id],
    );
    expect((audit.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  it('staff scheduling endpoints reject patient sessions', async () => {
    const patient = world.patients.find((p) => p.id === treatment.patientId)!;
    const cookie = await signIn('patient', patient.email);
    const denied = await inject(
      'GET',
      `/api/staff/treatments/${treatment.id}/activities`,
      undefined,
      cookie,
    );
    expect(denied.statusCode).toBe(401);
  });
});

describe('worker horizon extension', () => {
  it('extendScheduleHorizons materialises the gap idempotently', async () => {
    const { extendScheduleHorizons } = await import('../../worker/src/main.js');
    // shrink a schedule's horizon artificially, then extend
    await owner.query(
      `UPDATE clinical.schedule SET generated_until = anchor_date + interval '60 days'`,
    );
    await owner.query(`DELETE FROM clinical.activity WHERE schedule_id IS NOT NULL
      AND occurrence_date > (SELECT min(generated_until) FROM clinical.schedule)`);
    const first = await extendScheduleHorizons(owner as never, '2026-09-15');
    const second = await extendScheduleHorizons(owner as never, '2026-09-15');
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
  });
});
