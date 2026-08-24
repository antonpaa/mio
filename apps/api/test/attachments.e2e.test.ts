import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRolePool, migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { createDevScanner, createFsStorage } from '@mio/storage';
import { generateWorld, seedWorld, DEMO_PASSWORD } from '@mio/synthetic';
import { scanAttachments } from '../../worker/src/attachment-scan.js';
import { AppModule } from '../src/app.module.js';
import { MAILER, type ContentlessMail, type Mailer } from '../src/modules/identity/index.js';

/**
 * WP-24: quarantine -> sniff -> scan -> promote, end to end. Nothing is
 * served before the scanner promotes it; the sniffed type is the served
 * type; rejected bytes are gone; and an attachment travels only inside
 * its author's own message.
 */

// a real 1x1 transparent PNG
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

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
let storageDir: string;

const world = generateWorld('demo', 42);
const treatment = world.treatments.find((t) => {
  const team = world.teams.find((candidate) => candidate.id === t.teamId);
  return t.state === 'active' && (team?.leadIds.length ?? 0) > 0;
})!;
const team = world.teams.find((candidate) => candidate.id === treatment.teamId)!;
const lead = world.staff.find((s) => team.leadIds.includes(s.id))!;
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

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'mio-attach-'));
  process.env['MIO_STORAGE_DIR'] = storageDir;
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
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ bodyLimit: 8 * 1024 * 1024 }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  leadCookie = await signIn('staff', lead.email);
  patientCookie = await signIn('patient', patient.email);
  outsiderCookie = await signIn('staff', outsider.email);
});

afterAll(async () => {
  await app?.close();
  await workerPool?.end();
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

const runScan = () => scanAttachments(workerPool, createFsStorage(storageDir), createDevScanner());

describe('the pipeline', () => {
  let attachmentId: string;

  it('uploads into quarantine; nothing is served before the scan', async () => {
    const uploaded = await inject(
      'POST',
      '/api/patient/attachments',
      { treatmentId: treatment.id, filename: 'wound.png', dataBase64: TINY_PNG },
      patientCookie,
    );
    expect(uploaded.statusCode).toBe(201);
    const body = uploaded.json() as { attachmentId: string; state: string };
    attachmentId = body.attachmentId;
    expect(body.state).toBe('quarantined');

    const pending = await inject(
      'GET',
      `/api/patient/attachments/${attachmentId}`,
      undefined,
      patientCookie,
    );
    expect(pending.statusCode).toBe(202);
    expect((pending.json() as { state: string }).state).toBe('quarantined');
  });

  it('a lying filename does not matter, but lying bytes do', async () => {
    const notAnImage = await inject(
      'POST',
      '/api/patient/attachments',
      {
        treatmentId: treatment.id,
        filename: 'innocent.png',
        dataBase64: Buffer.from('#!/bin/sh\necho pwned').toString('base64'),
      },
      patientCookie,
    );
    expect(notAnImage.statusCode).toBe(415);
  });

  it('the sweep promotes; the bytes serve with the sniffed type and hostile-content headers', async () => {
    const swept = await runScan();
    expect(swept.clean).toBeGreaterThanOrEqual(1);

    const served = await inject(
      'GET',
      `/api/patient/attachments/${attachmentId}`,
      undefined,
      patientCookie,
    );
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(String(served.headers['content-security-policy'])).toContain('sandbox');
    expect(served.rawPayload.length).toBeGreaterThan(50);
  });

  it('travels only inside its author message: linking, serving to the team, outsiders blind', async () => {
    const sent = await inject(
      'POST',
      `/api/patient/messages/threads/${treatment.id}/messages`,
      {
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Photo of the area.' }] },
            { type: 'attachment', attachmentId },
          ],
        },
      },
      patientCookie,
    );
    expect(sent.statusCode).toBe(201);

    // the care team reads the bytes; an outsider cannot even see the row
    const staffRead = await inject(
      'GET',
      `/api/staff/attachments/${attachmentId}`,
      undefined,
      leadCookie,
    );
    expect(staffRead.statusCode).toBe(200);
    const outsiderRead = await inject(
      'GET',
      `/api/staff/attachments/${attachmentId}`,
      undefined,
      outsiderCookie,
    );
    expect(outsiderRead.statusCode).toBe(404);

    // an already-linked attachment cannot ride a second message
    const reused = await inject(
      'POST',
      `/api/patient/messages/threads/${treatment.id}/messages`,
      { body: { type: 'doc', content: [{ type: 'attachment', attachmentId }] } },
      patientCookie,
    );
    expect(reused.statusCode).toBe(400);
  });

  it('rejects infected bytes and deletes them; notes never carry attachments', async () => {
    const pngWithEicar = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(EICAR, 'latin1'),
    ]);
    const uploaded = await inject(
      'POST',
      '/api/staff/attachments',
      {
        treatmentId: treatment.id,
        filename: 'scan.png',
        dataBase64: pngWithEicar.toString('base64'),
      },
      leadCookie,
    );
    expect(uploaded.statusCode).toBe(201);
    const { attachmentId: badId } = uploaded.json() as { attachmentId: string };

    const swept = await runScan();
    expect(swept.rejected).toBeGreaterThanOrEqual(1);

    const gone = await inject('GET', `/api/staff/attachments/${badId}`, undefined, leadCookie);
    expect(gone.statusCode).toBe(410);
    const { rows } = await owner.query(
      `SELECT state, scan_detail FROM clinical.attachment WHERE id = $1`,
      [badId],
    );
    expect((rows[0] as { state: string }).state).toBe('rejected');
    expect((rows[0] as { scan_detail: string }).scan_detail).toContain('Eicar');
    // the bytes themselves are gone from storage
    const storage = createFsStorage(storageDir);
    expect(await storage.get(`attachments/${badId}`)).toBeNull();

    const noteRefused = await inject(
      'POST',
      `/api/staff/messages/threads/${treatment.id}/notes`,
      {
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'internal' }] },
            { type: 'attachment', attachmentId },
          ],
        },
      },
      leadCookie,
    );
    expect(noteRefused.statusCode).toBe(400);
    expect(noteRefused.body).toContain('no_note_attachments');
  });
});
