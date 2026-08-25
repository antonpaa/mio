import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { generateWorld, seedWorld, DEMO_PASSWORD } from '@mio/synthetic';
import type { LocaleBundle, SurveyDefinition } from '@mio/survey-schema';
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
const author = world.staff.find((s) => s.roles.includes('author'))!;
const member = world.staff.find(
  (s) =>
    s.roles.includes('clinician') &&
    !s.roles.includes('author') &&
    !s.roles.includes('administrator'),
)!;

let leadCookie: string;
let memberCookie: string;

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
  leadCookie = await signIn(author.email);
  memberCookie = await signIn(member.email);
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

const DEFINITION: SurveyDefinition = {
  kind: 'symptom',
  pages: [
    {
      id: 'page-1',
      questions: [
        {
          id: 'appetite',
          type: 'choice_single',
          required: true,
          options: [{ id: 'normal' }, { id: 'reduced' }],
          followUps: [
            {
              id: 'appetite-days',
              type: 'number',
              required: true,
              condition: { questionId: 'appetite', op: 'equals', value: 'reduced' },
              validation: { min: 0, max: 60, decimals: 0, unit: 'days' },
            },
          ],
        },
      ],
    },
  ],
};

const bundles = (fi: boolean): LocaleBundle[] => [
  {
    locale: 'en',
    title: 'Appetite check',
    questions: {
      appetite: { label: 'Appetite this week', options: { normal: 'Normal', reduced: 'Reduced' } },
      'appetite-days': { label: 'For how many days?' },
    },
  },
  {
    locale: 'fi',
    title: fi ? 'Ruokahalukysely' : '',
    questions: fi
      ? {
          appetite: {
            label: 'Ruokahalu tällä viikolla',
            options: { normal: 'Normaali', reduced: 'Heikentynyt' },
          },
          'appetite-days': { label: 'Kuinka monta päivää?' },
        }
      : {},
  },
  { locale: 'sv', title: '', questions: {} },
];

let surveyId: string;
let versionId: string;

describe('the builder lifecycle (B1/B2/B4)', () => {
  it('a member cannot author; a lead creates a survey with an empty draft v1', async () => {
    const denied = await inject('POST', '/api/staff/surveys', { name: 'X' }, memberCookie);
    expect(denied.statusCode).toBe(403);

    const created = await inject(
      'POST',
      '/api/staff/surveys',
      { name: 'Appetite check', kind: 'symptom' },
      leadCookie,
    );
    expect(created.statusCode).toBe(201);
    ({ surveyId, versionId } = created.json() as { surveyId: string; versionId: string });

    const detail = await inject('GET', `/api/staff/surveys/${surveyId}`, undefined, leadCookie);
    const body = detail.json() as {
      versions: { version: number; state: string; completeness: Record<string, number> }[];
    };
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0]!.state).toBe('draft');
    // en has its title from the name; fi and sv are missing theirs
    expect(body.versions[0]!.completeness['en']).toBe(0);
    expect(body.versions[0]!.completeness['fi']).toBe(1);
  });

  it('draft updates validate structurally and recompute the hash', async () => {
    const bad = await inject(
      'POST',
      `/api/staff/surveys/versions/${versionId}`,
      {
        definition: {
          pages: [
            {
              id: 'p',
              questions: [{ id: 'q-one', type: 'text', validation: { pattern: '(a+)+' } }],
            },
          ],
        },
        locales: bundles(false),
      },
      leadCookie,
    );
    expect(bad.statusCode).toBe(400);
    expect(JSON.stringify(bad.json())).toContain('unsafe_pattern');

    const { rows: before } = await owner.query(
      `SELECT content_hash FROM clinical.survey_version WHERE id = $1`,
      [versionId],
    );
    const ok = await inject(
      'POST',
      `/api/staff/surveys/versions/${versionId}`,
      { definition: DEFINITION, locales: bundles(false) },
      leadCookie,
    );
    expect(ok.statusCode).toBe(200);
    const { rows: after } = await owner.query(
      `SELECT content_hash FROM clinical.survey_version WHERE id = $1`,
      [versionId],
    );
    expect((after[0] as { content_hash: string }).content_hash).not.toBe(
      (before[0] as { content_hash: string }).content_hash,
    );
  });

  it('publishing requires a complete locale, then freezes the version', async () => {
    const published = await inject(
      'POST',
      `/api/staff/surveys/versions/${versionId}/publish`,
      {},
      leadCookie,
    );
    expect(published.statusCode).toBe(200);

    // en was complete, fi partial: the variant list reflects it
    const detail = await inject('GET', `/api/staff/surveys/${surveyId}`, undefined, leadCookie);
    const version = (
      detail.json() as { versions: { state: string; completeness: Record<string, number> }[] }
    ).versions[0]!;
    expect(version.state).toBe('published');
    expect(version.completeness['sv']).toBeGreaterThan(0);

    // editing a published version is refused by the SERVICE...
    const edit = await inject(
      'POST',
      `/api/staff/surveys/versions/${versionId}`,
      { definition: DEFINITION, locales: bundles(true) },
      leadCookie,
    );
    expect(edit.statusCode).toBe(400);
    // ...and by the STORAGE layer even for the owner
    await expect(
      owner.query(`UPDATE clinical.survey_version SET definition = '{"pages":[]}' WHERE id = $1`, [
        versionId,
      ]),
    ).rejects.toThrow(/immutable/);
  });

  it('an empty or gap-only draft cannot publish', async () => {
    const created = await inject('POST', '/api/staff/surveys', { name: 'Empty one' }, leadCookie);
    const empty = created.json() as { versionId: string };
    const refused = await inject(
      'POST',
      `/api/staff/surveys/versions/${empty.versionId}/publish`,
      {},
      leadCookie,
    );
    expect(refused.statusCode).toBe(400);
  });

  it('new draft from the published version bumps the number; only one open draft', async () => {
    const draft = await inject('POST', `/api/staff/surveys/${surveyId}/draft`, {}, leadCookie);
    expect(draft.statusCode).toBe(201);
    const { versionId: draftId, version } = draft.json() as {
      versionId: string;
      version: number;
    };
    expect(version).toBe(2);
    const again = await inject('POST', `/api/staff/surveys/${surveyId}/draft`, {}, leadCookie);
    expect(again.statusCode).toBe(400);

    // completing the fi bundle on the draft and publishing v2
    const updated = await inject(
      'POST',
      `/api/staff/surveys/versions/${draftId}`,
      { definition: DEFINITION, locales: bundles(true) },
      leadCookie,
    );
    expect(updated.statusCode).toBe(200);
    const published = await inject(
      'POST',
      `/api/staff/surveys/versions/${draftId}/publish`,
      {},
      leadCookie,
    );
    expect(published.statusCode).toBe(200);

    // the catalog shows both published versions, newest first
    const catalog = await inject('GET', '/api/staff/surveys', undefined, leadCookie);
    const entry = (
      catalog.json() as { id: string; versions: { version: number; state: string }[] }[]
    ).find((row) => row.id === surveyId)!;
    expect(entry.versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('archiving retires a version; licensed instruments are locked (R11)', async () => {
    const detail = await inject('GET', `/api/staff/surveys/${surveyId}`, undefined, leadCookie);
    const v1 = (detail.json() as { versions: { id: string; version: number }[] }).versions.find(
      (v) => v.version === 1,
    )!;
    const archived = await inject(
      'POST',
      `/api/staff/surveys/versions/${v1.id}/archive`,
      {},
      leadCookie,
    );
    expect(archived.statusCode).toBe(200);

    const licensed = await inject(
      'POST',
      '/api/staff/surveys',
      { name: 'Quality of life (QLQ-30)', licensedSource: 'EORTC — licensed instrument' },
      leadCookie,
    );
    const { versionId: licensedVersion, surveyId: licensedSurvey } = licensed.json() as {
      versionId: string;
      surveyId: string;
    };
    const edit = await inject(
      'POST',
      `/api/staff/surveys/versions/${licensedVersion}`,
      { definition: DEFINITION, locales: bundles(true) },
      leadCookie,
    );
    expect(edit.statusCode).toBe(400);
    expect((edit.json() as { status: string }).status).toBe('licensed_locked');
    const draft = await inject(
      'POST',
      `/api/staff/surveys/${licensedSurvey}/draft`,
      {},
      leadCookie,
    );
    expect(draft.statusCode).toBe(400);
  });
});
