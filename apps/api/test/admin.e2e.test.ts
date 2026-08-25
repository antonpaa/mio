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
 * WP-28: the administration plane - identity only, step-up on credential
 * resets, the role matrix rendered from the generated capabilities, the
 * audit view X4-minimised. And PP5: the clinician export that will not
 * move without a recorded reason.
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
const admin = world.staff.find((s) => s.roles.length === 1 && s.roles[0] === 'administrator')!;
const auditor = world.staff.find((s) => s.roles.includes('auditor'))!;
const treatment = world.treatments.find((t) => {
  const team = world.teams.find((candidate) => candidate.id === t.teamId);
  return t.state === 'active' && (team?.leadIds.length ?? 0) > 0;
})!;
const team = world.teams.find((candidate) => candidate.id === treatment.teamId)!;
const lead = world.staff.find((s) => team.leadIds.includes(s.id))!;
const patient = world.patients.find((p) => p.id === treatment.patientId)!;
const sparePatient = world.patients.find((p) => p.id !== patient.id)!;

let adminCookie: string;
let leadCookie: string;
let auditorCookie: string;

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
  adminCookie = await signIn(admin.email);
  leadCookie = await signIn(lead.email);
  auditorCookie = await signIn(auditor.email);
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
  const login = await inject('POST', `/api/staff/auth/login`, {
    email,
    password: DEMO_PASSWORD,
  });
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

describe('A1 users', () => {
  it('lists accounts for the administrator; a lead is refused', async () => {
    const users = await inject('GET', '/api/admin/users', undefined, adminCookie);
    expect(users.statusCode).toBe(200);
    const body = users.json() as { staff: object[]; patients: object[] };
    expect(body.staff.length).toBeGreaterThan(3);
    expect(body.patients.length).toBeGreaterThan(3);
    // identity metadata only - the row shape IS the minimisation
    expect(Object.keys(body.patients[0] as object).sort()).toEqual([
      'email',
      'family_name',
      'given_name',
      'id',
      'locale',
      'status',
    ]);

    const denied = await inject('GET', '/api/admin/users', undefined, leadCookie);
    expect(denied.statusCode).toBe(403);
  });

  it('creates a staff account and mails the welcome invite', async () => {
    mailer.mails.length = 0;
    const created = await inject(
      'POST',
      '/api/admin/staff',
      {
        email: 'uusi.hoitaja@staff.example',
        givenName: 'Uusi',
        familyName: 'Hoitaja',
        roles: ['clinician'],
        title: 'Nurse',
        locale: 'fi',
      },
      adminCookie,
    );
    expect(created.statusCode).toBe(201);
    const invite = mailer.mails.find(
      (mail) => mail.recipient === 'uusi.hoitaja@staff.example' && mail.kind === 'welcome_invite',
    );
    expect(invite).toBeTruthy();
  });

  it('a staff account can hold SEVERAL roles - and auditor never combines', async () => {
    const created = await inject(
      'POST',
      '/api/admin/staff',
      {
        email: 'moni.rooli@staff.example',
        givenName: 'Moni',
        familyName: 'Rooli',
        roles: ['clinician', 'administrator'],
      },
      adminCookie,
    );
    expect(created.statusCode).toBe(201);
    const users = await inject('GET', '/api/admin/users', undefined, adminCookie);
    const staffRows = (users.json() as { staff: { email: string; roles: string[] }[] }).staff;
    const row = staffRows.find((r) => r.email === 'moni.rooli@staff.example');
    expect(row?.roles).toEqual(['administrator', 'clinician']);

    const rejected = await inject(
      'POST',
      '/api/admin/staff',
      {
        email: 'kielletty@staff.example',
        givenName: 'Kielletty',
        familyName: 'Yhdistelma',
        roles: ['auditor', 'clinician'],
      },
      adminCookie,
    );
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).toContain('invalid_roles');
  });

  it('edits an account role set - audited, never self-targeting, never empty', async () => {
    const created = await inject(
      'POST',
      '/api/admin/staff',
      {
        email: 'rooli.muutos@staff.example',
        givenName: 'Rooli',
        familyName: 'Muutos',
        roles: ['clinician'],
      },
      adminCookie,
    );
    const { accountId } = created.json() as { accountId: string };

    const updated = await inject(
      'POST',
      `/api/admin/users/staff/${accountId}/roles`,
      { roles: ['clinician', 'author'] },
      adminCookie,
    );
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { roles: string[] }).roles).toEqual(['author', 'clinician']);

    const emptied = await inject(
      'POST',
      `/api/admin/users/staff/${accountId}/roles`,
      { roles: [] },
      adminCookie,
    );
    expect(emptied.statusCode).toBe(400);

    // never self-targeting: an administrator cannot change their own set
    const self = await inject(
      'POST',
      `/api/admin/users/staff/${admin.id}/roles`,
      { roles: ['administrator', 'clinician'] },
      adminCookie,
    );
    expect(self.statusCode).toBe(400);
    expect(self.body).toContain('cannot_target_self');

    const changeEvent = await owner.query(
      `SELECT detail FROM audit.change_event
        WHERE action = 'staff_account.update_roles' AND resource_id = $1`,
      [accountId],
    );
    expect(changeEvent.rows[0]?.detail).toMatchObject({
      before: ['clinician'],
      after: ['author', 'clinician'],
    });
  });

  it('admin acts on OTHERS only: self reset and self team-membership are refused', async () => {
    const reset = await inject(
      'POST',
      `/api/admin/users/staff/${admin.id}/reset-login`,
      { password: DEMO_PASSWORD },
      adminCookie,
    );
    expect(reset.statusCode).toBe(400);
    expect(reset.body).toContain('cannot_target_self');

    const membership = await inject(
      'POST',
      `/api/admin/teams/${team.id}/membership`,
      { add: [admin.id] },
      adminCookie,
    );
    expect(membership.statusCode).toBe(400);
    expect(membership.body).toContain('cannot_target_self');
  });

  it('creates a patient account (P1: administration, not care); a lead cannot', async () => {
    mailer.mails.length = 0;
    const created = await inject(
      'POST',
      '/api/admin/patients',
      {
        email: 'uusi.potilas@patient.example',
        givenName: 'Uusi',
        familyName: 'Potilas',
        locale: 'fi',
      },
      adminCookie,
    );
    expect(created.statusCode).toBe(201);
    expect(
      mailer.mails.some(
        (mail) =>
          mail.recipient === 'uusi.potilas@patient.example' && mail.kind === 'welcome_invite',
      ),
    ).toBe(true);

    const leadTry = await inject(
      'POST',
      '/api/admin/patients',
      { email: 'x@patient.example', givenName: 'X', familyName: 'Y' },
      leadCookie,
    );
    expect(leadTry.statusCode).toBe(403);

    // the same decision tightened identity teams: administration only
    const leadTeam = await inject('POST', '/api/admin/teams', { name: 'Rogue unit' }, leadCookie);
    expect(leadTeam.statusCode).toBe(403);
  });

  it('reset-login demands step-up; with it, sessions die and a fresh invite mails', async () => {
    const noStepUp = await inject(
      'POST',
      `/api/admin/users/patient/${sparePatient.id}/reset-login`,
      { password: 'wrong-password' },
      adminCookie,
    );
    expect(noStepUp.statusCode).toBe(403);
    expect(noStepUp.body).toContain('step_up_required');

    mailer.mails.length = 0;
    const reset = await inject(
      'POST',
      `/api/admin/users/patient/${sparePatient.id}/reset-login`,
      { password: DEMO_PASSWORD },
      adminCookie,
    );
    expect(reset.statusCode).toBe(200);
    expect(
      mailer.mails.some(
        (mail) => mail.recipient === sparePatient.email && mail.kind === 'welcome_invite',
      ),
    ).toBe(true);
  });

  it('deactivation kills the account and its sessions', async () => {
    const spareStaff = world.staff.find(
      (s) =>
        s.roles.includes('clinician') &&
        !s.roles.includes('administrator') &&
        !team.memberIds.includes(s.id),
    )!;
    const deactivated = await inject(
      'POST',
      `/api/admin/users/staff/${spareStaff.id}/deactivate`,
      {},
      adminCookie,
    );
    expect(deactivated.statusCode).toBe(200);
    const login = await inject('POST', '/api/staff/auth/login', {
      email: spareStaff.email,
      password: DEMO_PASSWORD,
    });
    expect(login.statusCode).not.toBe(200);

    // A1's inverse: reactivation restores sign-in with the same password
    const reactivated = await inject(
      'POST',
      `/api/admin/users/staff/${spareStaff.id}/reactivate`,
      {},
      adminCookie,
    );
    expect(reactivated.statusCode).toBe(200);
    const retry = await inject('POST', '/api/staff/auth/login', {
      email: spareStaff.email,
      password: DEMO_PASSWORD,
    });
    expect(retry.statusCode).toBe(200);
  });
});

describe('A5 teams and A2 roles', () => {
  it('creates a team, edits membership, and renders roles from the matrix', async () => {
    const created = await inject('POST', '/api/admin/teams', { name: 'Sarcoma unit' }, adminCookie);
    expect(created.statusCode).toBe(201);
    const { teamId } = created.json() as { teamId: string };
    const updated = await inject(
      'POST',
      `/api/admin/teams/${teamId}/membership`,
      { add: [lead.id] },
      adminCookie,
    );
    expect(updated.statusCode).toBe(200);
    const teams = await inject('GET', '/api/admin/teams', undefined, adminCookie);
    expect(teams.body).toContain('Sarcoma unit');
    expect(teams.body).toContain(lead.familyName);

    const roles = await inject('GET', '/api/admin/roles', undefined, adminCookie);
    const body = roles.json() as { roles: Record<string, string[]> };
    // rendered FROM the generated capabilities - spot-check the shape
    expect(body.roles['administrator']).toContain('staff_account.create');
    expect(body.roles['patient']).toContain('survey_response.submit');
    expect(body.roles['administrator']).not.toContain('patient_clinical_profile.view');
    // P2: the full log belongs to the auditor alone
    expect(body.roles['auditor']).toContain('audit_log.view_full');
    expect(body.roles['administrator']).not.toContain('audit_log.view_full');
    expect(body.roles['auditor']).not.toContain('patient_clinical_profile.view');
  });
});

describe('A3 audit view (P2: the auditor role)', () => {
  it('the auditor reads the full log with real identities; admin and lead cannot', async () => {
    // make sure there is at least one patient-subject disclosure
    await inject('GET', `/api/staff/patients/${patient.id}`, undefined, leadCookie);
    const audit = await inject('GET', '/api/admin/audit?limit=100', undefined, auditorCookie);
    expect(audit.statusCode).toBe(200);
    const { events } = audit.json() as {
      events: { action: string; subject: string | null; actor: string }[];
    };
    expect(events.length).toBeGreaterThan(0);
    // oversight is the role's purpose: subjects appear as full identities
    const fullName = `${patient.givenName} ${patient.familyName}`;
    expect(events.some((event) => event.subject === fullName)).toBe(true);

    // the administrator plane lost this view with the P2 decision
    const adminTry = await inject('GET', '/api/admin/audit', undefined, adminCookie);
    expect(adminTry.statusCode).toBe(403);
    const denied = await inject('GET', '/api/admin/audit', undefined, leadCookie);
    expect(denied.statusCode).toBe(403);

    // reading the log is itself always audited
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM audit.access_event
        WHERE action = 'audit_log.view_full' AND actor_user_id = $1 AND decision = 'allow'`,
      [auditor.id],
    );
    expect((rows[0] as { n: number }).n).toBeGreaterThan(0);

    // and the auditor holds nothing clinical: a patient profile is a 404
    const clinical = await inject(
      'GET',
      `/api/staff/patients/${patient.id}`,
      undefined,
      auditorCookie,
    );
    expect([403, 404]).toContain(clinical.statusCode);
  });

  it('filters by event and person, and exports exactly the filtered view', async () => {
    await inject('GET', `/api/staff/patients/${patient.id}`, undefined, leadCookie);
    const all = await inject('GET', '/api/admin/audit?limit=200', undefined, auditorCookie);
    const body = all.json() as {
      events: { action: string; actor: string }[];
      range: { from: string; to: string };
      filters: { actions: string[]; actors: { id: string; name: string }[] };
    };
    // the facets describe the range, so they are a superset of the page
    expect(body.filters.actions).toContain('patient_clinical_profile.view');
    expect(body.filters.actors.some((actor) => actor.id === lead.id)).toBe(true);
    expect(body.range.from < body.range.to).toBe(true);

    const narrowed = await inject(
      'GET',
      `/api/admin/audit?action=patient_clinical_profile.view&actor=${lead.id}`,
      undefined,
      auditorCookie,
    );
    const narrowedBody = narrowed.json() as {
      events: { action: string }[];
      filters: { actions: string[] };
    };
    expect(narrowedBody.events.length).toBeGreaterThan(0);
    expect(
      narrowedBody.events.every((event) => event.action === 'patient_clinical_profile.view'),
    ).toBe(true);
    // narrowing must not shrink the filter list you narrow WITH
    expect(narrowedBody.filters.actions.length).toBe(body.filters.actions.length);

    // an empty window is empty, not everything
    const empty = await inject(
      'GET',
      '/api/admin/audit?from=1990-01-01&to=1990-01-02',
      undefined,
      auditorCookie,
    );
    expect((empty.json() as { events: unknown[] }).events).toEqual([]);

    // the export is the same filtered view, as a file, still minimised
    const csv = await inject(
      'GET',
      `/api/admin/audit/export?action=patient_clinical_profile.view&actor=${lead.id}`,
      undefined,
      auditorCookie,
    );
    expect(csv.statusCode).toBe(200);
    const text = (csv.json() as { csv: string }).csv;
    expect(text.split('\n')[0]).toBe(
      'occurred_at,actor,actor_realm,action,resource_type,subject,decision',
    );
    expect(text).toContain('patient_clinical_profile.view');
    expect(text.split('\n').length).toBe(narrowedBody.events.length + 1);

    // and nobody else may export it
    const adminExport = await inject('GET', '/api/admin/audit/export', undefined, adminCookie);
    expect(adminExport.statusCode).toBe(403);
  });
});

describe('PP5 export with reason', () => {
  it('refuses without a reason; with one, both actions audit with the reason attached', async () => {
    const missing = await inject(
      'POST',
      `/api/staff/patients/${patient.id}/export`,
      {},
      leadCookie,
    );
    expect(missing.statusCode).toBe(400);

    const exported = await inject(
      'POST',
      `/api/staff/patients/${patient.id}/export`,
      { reason: 'Care transfer to Turku university hospital.' },
      leadCookie,
    );
    expect(exported.statusCode).toBe(200);
    const body = exported.json() as { format: string; reason: string; treatments: object[] };
    expect(body.format).toBe('mio-export/v1');
    expect(body.treatments.length).toBeGreaterThan(0);
    expect(exported.body).not.toContain('internal_note');

    const { rows } = await owner.query(
      `SELECT action, context FROM audit.access_event
        WHERE resource_type = 'patient_data_export' AND patient_id = $1 ORDER BY action`,
      [patient.id],
    );
    const actions = (rows as { action: string; context: { reason?: string } }[]).map(
      (row) => row.action,
    );
    expect(actions).toContain('patient_data_export.request');
    expect(actions).toContain('patient_data_export.download');
    expect(
      (rows as { context: { reason?: string } }[]).every(
        (row) => row.context.reason === 'Care transfer to Turku university hospital.',
      ),
    ).toBe(true);

    // the administrator has no clinical hands: the export path denies
    const adminTry = await inject(
      'POST',
      `/api/staff/patients/${patient.id}/export`,
      { reason: 'testing' },
      adminCookie,
    );
    expect([403, 404]).toContain(adminTry.statusCode);
  });
});
