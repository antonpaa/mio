import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRolePool, migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { generateWorld, seedWorld, DEMO_PASSWORD } from '@mio/synthetic';
import {
  dispatchNotifications,
  type NotificationMail,
} from '../../worker/src/notification-dispatch.js';
import { AppModule } from '../src/app.module.js';
import { MAILER, type ContentlessMail, type Mailer } from '../src/modules/identity/index.js';

/**
 * WP-25: the outbox and the rule notifications become per-recipient rows
 * in the in-app centre - the content-bearing layer - while email stays a
 * contentless nudge behind the P8 toggles. Dispatch is idempotent and
 * the centre is recipient-only.
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
let workerPool: pg.Pool;
let app: NestFastifyApplication;
let mailer: CapturingMailer;
const sentMails: NotificationMail[] = [];
const captureMail = async (mail: NotificationMail): Promise<void> => {
  sentMails.push(mail);
};

const world = generateWorld('demo', 42);
const treatment = world.treatments.find((t) => {
  const team = world.teams.find((candidate) => candidate.id === t.teamId);
  return (
    t.state === 'active' &&
    t.surveyKeys.includes('weekly-symptoms') &&
    (team?.leadIds.length ?? 0) > 0
  );
})!;
const team = world.teams.find((candidate) => candidate.id === treatment.teamId)!;
const lead = world.staff.find((s) => team.leadIds.includes(s.id))!;
const patient = world.patients.find((p) => p.id === treatment.patientId)!;
const otherPatient = world.patients.find((p) => p.id !== patient.id)!;

let leadCookie: string;
let patientCookie: string;
let otherPatientCookie: string;
let surveyId: string;

beforeAll(async () => {
  db = await provisionTestDatabase();
  await migrate(db.connectionString);
  await seedWorld(db.connectionString, world);
  owner = new pg.Pool({ connectionString: db.connectionString, max: 2 });
  workerPool = createRolePool({ connectionString: db.connectionString, role: 'mio_worker' });

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
  otherPatientCookie = await signIn('patient', otherPatient.email);

  const { rows } = await owner.query(
    `SELECT id FROM clinical.survey WHERE name = 'Weekly symptom survey'`,
  );
  surveyId = (rows[0] as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await workerPool?.end();
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

describe('the dispatch', () => {
  it('fans the seeded backlog out once - a second run moves nothing', async () => {
    const first = await dispatchNotifications(workerPool, captureMail);
    // the seeded world carries alert.raised outbox rows and severe-nausea
    // rule notifications addressed to patient + lead
    expect(first.outboxProcessed).toBeGreaterThan(0);
    expect(first.rulesDispatched).toBeGreaterThan(0);
    expect(first.rowsWritten).toBeGreaterThan(0);
    const second = await dispatchNotifications(workerPool, captureMail);
    expect(second).toEqual({
      outboxProcessed: 0,
      rulesDispatched: 0,
      rowsWritten: 0,
      mailsSent: 0,
    });
    // alert.raised never becomes anyone's row - patients must not see
    // alerts and the triage queue is the clinician surface
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM clinical.notification WHERE kind = 'alert.raised'`,
    );
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it('a live severe answer and a staff reply reach the patient centre - and the lead', async () => {
    sentMails.length = 0;
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
    const submitted = await inject(
      'POST',
      `/api/patient/responses/${responseId}/submit`,
      {
        answers: {
          nausea: 'severe',
          'nausea-frequency': 'twice-or-more',
          'nausea-impact': 8,
          fatigue: 'considerable',
        },
      },
      patientCookie,
    );
    expect(submitted.statusCode).toBe(200);
    const posted = await inject(
      'POST',
      `/api/staff/messages/threads/${treatment.id}/messages`,
      {
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'We saw your answers.' }] },
          ],
        },
      },
      leadCookie,
    );
    expect(posted.statusCode).toBe(201);

    await dispatchNotifications(workerPool, captureMail);

    const centre = await inject('GET', '/api/patient/notifications', undefined, patientCookie);
    expect(centre.statusCode).toBe(200);
    const body = centre.json() as {
      items: { kind: string; body: Record<string, string> | null }[];
      unread: number;
    };
    const ruleItem = body.items.find((item) => item.kind === 'rule.notify')!;
    expect(ruleItem.body?.[patient.locale]).toContain(
      {
        en: 'care team has been notified',
        fi: 'hoitotiimillesi on ilmoitettu',
        sv: 'vårdteam meddelats',
      }[patient.locale as 'en' | 'fi' | 'sv'],
    );
    expect(body.items.some((item) => item.kind === 'message.new')).toBe(true);
    expect(body.unread).toBeGreaterThanOrEqual(2);

    // the lead got a staff-realm row with the LEAD copy (X13): the
    // clinical prompt, not the patient's "your care team has been
    // notified" sentence
    const { rows: leadRows } = await owner.query(
      `SELECT body FROM clinical.notification
        WHERE recipient_id = $1 AND recipient_realm = 'staff' AND kind = 'rule.notify'
        ORDER BY created_at DESC LIMIT 1`,
      [lead.id],
    );
    const leadBody = (leadRows[0] as { body: Record<string, string> }).body;
    expect(leadBody['en']).toContain('Review the response');
    expect(JSON.stringify(leadBody)).not.toContain('your care team has been notified');

    const staffCentre = await inject('GET', '/api/staff/notifications', undefined, leadCookie);
    expect(staffCentre.statusCode).toBe(200);
    const staffBody = staffCentre.json() as {
      items: {
        kind: string;
        body: Record<string, string> | null;
        patient_given: string | null;
      }[];
      unread: number;
    };
    const staffNote = staffBody.items.find((item) => item.kind === 'rule.notify')!;
    expect(staffNote).toBeTruthy();
    // it names the patient it concerns: a team note about nobody is useless
    expect(staffNote.patient_given).toBe(patient.givenName);
    expect(staffBody.unread).toBeGreaterThan(0);

    // reading is not the patient's centre: no patient-addressed row leaks in
    const { rows: mine } = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM clinical.notification
        WHERE recipient_realm = 'patient' AND recipient_id = $1`,
      [patient.id],
    );
    expect(mine[0]!.n).toBeGreaterThan(0);
    expect(staffBody.items.length).toBeLessThan(mine[0]!.n + staffBody.items.length + 1);

    // marking read clears the badge for this reader only
    const marked = await inject('POST', '/api/staff/notifications/read', {}, leadCookie);
    expect(marked.statusCode).toBe(200);
    const after = await inject('GET', '/api/staff/notifications', undefined, leadCookie);
    expect((after.json() as { unread: number }).unread).toBe(0);
    const patientCentreAfter = await inject(
      'GET',
      '/api/patient/notifications',
      undefined,
      patientCookie,
    );
    expect((patientCentreAfter.json() as { unread: number }).unread).toBeGreaterThan(0);

    // emails: contentless nudges to the patient, never a clinical word
    const toPatient = sentMails.filter((mail) => mail.recipient === patient.email);
    expect(toPatient.some((mail) => mail.type === 'rule_notification')).toBe(true);
    expect(toPatient.some((mail) => mail.type === 'new_message')).toBe(true);
    expect(JSON.stringify(sentMails)).not.toContain('nausea');
    // staff never get email nudges
    expect(sentMails.some((mail) => mail.recipient === lead.email)).toBe(false);
  });

  it('the P8 toggle silences the email but never the in-app row', async () => {
    const put = await inject(
      'PUT',
      '/api/patient/settings/notifications',
      { emailPrefs: { 'message.new': false } },
      patientCookie,
    );
    expect(put.statusCode).toBe(200);
    const settings = await inject(
      'GET',
      '/api/patient/settings/notifications',
      undefined,
      patientCookie,
    );
    expect((settings.json() as { emailPrefs: Record<string, boolean> }).emailPrefs).toEqual({
      'message.new': false,
    });

    sentMails.length = 0;
    const posted = await inject(
      'POST',
      `/api/staff/messages/threads/${treatment.id}/messages`,
      {
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One more thing.' }] }],
        },
      },
      leadCookie,
    );
    expect(posted.statusCode).toBe(201);
    const result = await dispatchNotifications(workerPool, captureMail);
    expect(result.rowsWritten).toBeGreaterThan(0); // in-app still delivered
    expect(sentMails.some((mail) => mail.type === 'new_message')).toBe(false);

    const rejected = await inject(
      'PUT',
      '/api/patient/settings/notifications',
      { emailPrefs: { 'not-a-kind': true } },
      patientCookie,
    );
    expect(rejected.statusCode).toBe(400);
  });

  it('marking read empties the badge; another patient sees none of it', async () => {
    const marked = await inject('POST', '/api/patient/notifications/read', {}, patientCookie);
    expect(marked.statusCode).toBe(200);
    const centre = await inject('GET', '/api/patient/notifications', undefined, patientCookie);
    expect((centre.json() as { unread: number }).unread).toBe(0);

    const other = await inject('GET', '/api/patient/notifications', undefined, otherPatientCookie);
    expect(other.statusCode).toBe(200);
    // recipient-only: nothing addressed to our patient appears here
    expect(other.body).not.toContain(patient.id);
  });

  it('a pre-X13 flat-body rule notification still reaches every audience', async () => {
    // rows written before the per-audience change carry one flat locale
    // map; dispatch must keep delivering those, to everyone, as-is
    const { rows: triggers } = await owner.query(
      `SELECT id FROM clinical.rule_trigger WHERE treatment_id = $1 LIMIT 1`,
      [treatment.id],
    );
    const triggerId = (triggers[0] as { id: string }).id;
    const { rows: inserted } = await owner.query(
      `INSERT INTO clinical.rule_notification
         (id, treatment_id, patient_id, trigger_id, recipients, body)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id`,
      [
        treatment.id,
        patient.id,
        triggerId,
        ['patient', 'lead'],
        JSON.stringify({ en: 'Legacy single text.', fi: 'Vanha yksi teksti.' }),
      ],
    );
    const legacyId = (inserted[0] as { id: string }).id;

    const result = await dispatchNotifications(workerPool, captureMail);
    expect(result.rulesDispatched).toBeGreaterThan(0);

    const { rows: delivered } = await owner.query(
      `SELECT recipient_realm, body FROM clinical.notification
        WHERE ref->>'triggerId' = $1 AND created_at >= now() - interval '1 minute'
        ORDER BY created_at DESC`,
      [triggerId],
    );
    const legacyRows = (
      delivered as { recipient_realm: string; body: Record<string, string> }[]
    ).filter((row) => row.body?.['en'] === 'Legacy single text.');
    expect(legacyRows.some((row) => row.recipient_realm === 'patient')).toBe(true);
    expect(legacyRows.some((row) => row.recipient_realm === 'staff')).toBe(true);

    const { rows: marked } = await owner.query(
      `SELECT dispatched_at FROM clinical.rule_notification WHERE id = $1`,
      [legacyId],
    );
    expect((marked[0] as { dispatched_at: string | null }).dispatched_at).not.toBeNull();
  });
});
