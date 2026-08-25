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
 * A4 reporting on the clinical side (gate P8, decided 2026-08-24):
 * aggregates over the CALLER'S treatments only, no patient identity in
 * the payload, audited as report.view - and the roles the matrix denies
 * (administrator, auditor) get nothing at all.
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

interface Overview {
  windowDays: number;
  surveys: { due: number; completed: number; ratePercent: number | null };
  alerts: { openNow: number; openHigh: number };
  programs: { program: string; patients: number; openAlerts: number }[];
}

let db: TestDatabase;
let owner: pg.Pool;
let app: NestFastifyApplication;
let mailer: CapturingMailer;

const world = generateWorld('demo', 42);
const member = world.staff.find(
  (s) =>
    s.roles.includes('clinician') &&
    !s.roles.includes('author') &&
    !s.roles.includes('administrator'),
)!;
const admin = world.staff.find((s) => s.roles.length === 1 && s.roles[0] === 'administrator')!;
const auditor = world.staff.find((s) => s.roles.includes('auditor'))!;
const patient = world.patients[0]!;

// the member's lawful slice, computed independently from the world:
// treatments whose attached staff team contains them (leads ride the
// same team membership in the synthetic model)
const myTeamIds = new Set(
  world.teams.filter((t) => t.memberIds.includes(member.id)).map((t) => t.id),
);
const myTreatments = world.treatments.filter((t) => myTeamIds.has(t.teamId));
const expectedPrograms = [...new Set(myTreatments.map((t) => t.name))].sort();

let memberCookie: string;
let adminCookie: string;
let auditorCookie: string;
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
  memberCookie = await signIn('staff', member.email);
  adminCookie = await signIn('staff', admin.email);
  auditorCookie = await signIn('staff', auditor.email);
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

describe('A4 reporting (P8: clinical side)', () => {
  it('aggregates exactly the caller-scoped treatments, identity-free, and audits the view', async () => {
    const { rows: before } = await owner.query(
      `SELECT count(*)::int AS n FROM audit.access_event
        WHERE actor_user_id = $1 AND action = 'report.view' AND decision = 'allow'`,
      [member.id],
    );

    const response = await inject('GET', '/api/staff/reporting', undefined, memberCookie);
    expect(response.statusCode).toBe(200);
    const overview = response.json() as Overview;

    expect(overview.windowDays).toBe(30);
    // the programme list is EXACTLY the caller's slice - nothing beyond it
    expect(overview.programs.map((p) => p.program).sort()).toEqual(expectedPrograms);
    for (const name of expectedPrograms) {
      const expectedPatients = new Set(
        myTreatments.filter((t) => t.name === name).map((t) => t.patientId),
      ).size;
      expect(overview.programs.find((p) => p.program === name)!.patients).toBe(expectedPatients);
    }
    // aggregates stay internally consistent, and carry no identities
    expect(overview.surveys.completed).toBeLessThanOrEqual(overview.surveys.due);
    if (overview.surveys.ratePercent !== null) {
      expect(overview.surveys.ratePercent).toBeGreaterThanOrEqual(0);
      expect(overview.surveys.ratePercent).toBeLessThanOrEqual(100);
    }
    expect(overview.alerts.openHigh).toBeLessThanOrEqual(overview.alerts.openNow);
    expect(JSON.stringify(overview)).not.toContain(patient.familyName);

    // the disclosure is on the trail
    const { rows: after } = await owner.query(
      `SELECT count(*)::int AS n FROM audit.access_event
        WHERE actor_user_id = $1 AND action = 'report.view' AND decision = 'allow'`,
      [member.id],
    );
    expect((after[0] as { n: number }).n).toBe((before[0] as { n: number }).n + 1);
  });

  it('denies the roles the matrix denies: administrator, auditor, patient realm', async () => {
    const asAdmin = await inject('GET', '/api/staff/reporting', undefined, adminCookie);
    expect(asAdmin.statusCode).toBe(403);
    const asAuditor = await inject('GET', '/api/staff/reporting', undefined, auditorCookie);
    expect(asAuditor.statusCode).toBe(403);
    const asPatient = await inject('GET', '/api/staff/reporting', undefined, patientCookie);
    expect(asPatient.statusCode).toBe(401);
  });
});
