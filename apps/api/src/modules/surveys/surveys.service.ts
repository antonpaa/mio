import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type pg from 'pg';
import { authorize } from '@mio/authz/engine';
import { withUserContext, writeAccessEvent, writeChangeEvent } from '@mio/db';
import {
  missingTranslations,
  normaliseDraft,
  progressOf,
  validateSubmission,
  type Answers,
  type LocaleBundle,
  type SurveyDefinition,
} from '@mio/survey-schema';
import { APP_POOL } from '../../shared/db.module.js';
import type { PatientPrincipal } from '../../shared/patient-session.js';

/**
 * Surveys (WP-14): the patient fill/submit path. The SERVER is the
 * authority - the shared engine validates here with exactly the semantics
 * the renderer showed: visibility over answered questions, required over
 * visible only, hidden answers discarded on submit
 * (docs/architecture/surveys-and-alerts.md).
 */

interface VersionRow {
  id: string;
  survey_id: string;
  version: number;
  definition: SurveyDefinition;
  locales: LocaleBundle[];
  content_hash: string;
}

interface ResponseRow {
  id: string;
  survey_version_id: string;
  treatment_id: string;
  patient_id: string;
  locale: string;
  status: 'draft' | 'submitted';
  answers: Answers;
  submitted_at: string | null;
}

/** The patient's language if the variant is complete, else English - a
 * variant with gaps is never offered (B1/B4). */
function pickBundle(version: VersionRow, preferred: string): LocaleBundle {
  const complete = (bundle: LocaleBundle): boolean =>
    missingTranslations(version.definition, bundle).length === 0;
  const wanted = version.locales.find((bundle) => bundle.locale === preferred);
  if (wanted && complete(wanted)) return wanted;
  const english = version.locales.find((bundle) => bundle.locale === 'en');
  if (english && complete(english)) return english;
  const any = version.locales.find(complete);
  if (!any) throw new BadRequestException({ status: 'no_complete_locale' });
  return any;
}

@Injectable()
export class SurveysService {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  private decideSelf(
    patient: PatientPrincipal,
    action: 'view' | 'save_draft' | 'submit',
    resourceId: string,
    patientId: string,
  ): 'allow' | 'deny' {
    return authorize({
      principal: { userId: patient.userId, role: 'patient' },
      action,
      resource: {
        type: 'survey_response',
        id: resourceId,
        patientId,
        subjectUserId: patientId,
      },
    }).decision;
  }

  /** The patient's fillable surveys + open drafts + recent submissions. */
  async listForPatient(patient: PatientPrincipal): Promise<object> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const decision = this.decideSelf(patient, 'view', 'list', patient.userId);
        await writeAccessEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'survey_response.view',
          resourceType: 'survey_list',
          resourceId: patient.userId,
          patientId: patient.userId,
          decision,
        });
        if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

        const { rows: fillable } = await client.query(
          `SELECT DISTINCT ON (s.id, t.id)
                  s.id AS survey_id, s.kind, t.id AS treatment_id, t.name AS treatment_name,
                  v.id AS version_id, v.locales
             FROM clinical.treatment_survey ts
             JOIN clinical.treatment t ON t.id = ts.treatment_id AND t.state = 'active'
             JOIN clinical.survey s ON s.id = ts.survey_id
             JOIN clinical.survey_version v ON v.survey_id = s.id AND v.state = 'published'
            WHERE ts.removed_at IS NULL AND t.patient_id = $1
              AND v.id = COALESCE(
                ts.pinned_version_id,
                (SELECT v2.id FROM clinical.survey_version v2
                  WHERE v2.survey_id = s.id AND v2.state = 'published'
                  ORDER BY v2.version DESC LIMIT 1))
            ORDER BY s.id, t.id`,
          [patient.userId],
        );
        const { rows: drafts } = await client.query(
          `SELECT r.id, r.survey_version_id, r.treatment_id, r.locale, r.updated_at,
                  v.locales, v.definition, r.answers
             FROM clinical.survey_response r
             JOIN clinical.survey_version v ON v.id = r.survey_version_id
            WHERE r.patient_id = $1 AND r.status = 'draft'
            ORDER BY r.updated_at DESC`,
          [patient.userId],
        );
        const { rows: submitted } = await client.query(
          `SELECT r.id, r.survey_version_id, r.locale, r.submitted_at, v.locales
             FROM clinical.survey_response r
             JOIN clinical.survey_version v ON v.id = r.survey_version_id
            WHERE r.patient_id = $1 AND r.status = 'submitted'
            ORDER BY r.submitted_at DESC LIMIT 10`,
          [patient.userId],
        );
        const titleOf = (locales: LocaleBundle[], locale: string): string =>
          (locales.find((bundle) => bundle.locale === locale) ?? locales[0])?.title ?? '';
        const draftVersionIds = new Set(
          (drafts as { survey_version_id: string }[]).map((row) => row.survey_version_id),
        );
        return {
          fillable: (fillable as Record<string, unknown>[])
            .filter((row) => !draftVersionIds.has(row['version_id'] as string))
            .map((row) => ({
              surveyId: row['survey_id'],
              treatmentId: row['treatment_id'],
              treatmentName: row['treatment_name'],
              kind: row['kind'],
              title: titleOf(row['locales'] as LocaleBundle[], 'en'),
              titles: Object.fromEntries(
                (row['locales'] as LocaleBundle[]).map((bundle) => [bundle.locale, bundle.title]),
              ),
            })),
          drafts: (drafts as Record<string, unknown>[]).map((row) => ({
            responseId: row['id'],
            treatmentId: row['treatment_id'],
            locale: row['locale'],
            title: titleOf(row['locales'] as LocaleBundle[], row['locale'] as string),
            progress: progressOf(row['definition'] as SurveyDefinition, row['answers'] as Answers),
            updatedAt: row['updated_at'],
          })),
          submitted: (submitted as Record<string, unknown>[]).map((row) => ({
            responseId: row['id'],
            locale: row['locale'],
            title: titleOf(row['locales'] as LocaleBundle[], row['locale'] as string),
            submittedAt: row['submitted_at'],
          })),
        };
      },
    );
  }

  /** Open (or resume) a draft for an attached survey - P4's entry. */
  async start(
    patient: PatientPrincipal,
    surveyId: string,
    treatmentId: string,
  ): Promise<{ responseId: string }> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const { rows } = await client.query<{
          version_id: string;
          locales: LocaleBundle[];
          definition: SurveyDefinition;
          content_hash: string;
        }>(
          `SELECT v.id AS version_id, v.locales, v.definition, v.content_hash
             FROM clinical.treatment_survey ts
             JOIN clinical.treatment t ON t.id = ts.treatment_id AND t.state = 'active'
             JOIN clinical.survey_version v ON v.survey_id = ts.survey_id AND v.state = 'published'
            WHERE ts.treatment_id = $1 AND ts.survey_id = $2 AND ts.removed_at IS NULL
              AND t.patient_id = $3
              AND v.id = COALESCE(
                ts.pinned_version_id,
                (SELECT v2.id FROM clinical.survey_version v2
                  WHERE v2.survey_id = ts.survey_id AND v2.state = 'published'
                  ORDER BY v2.version DESC LIMIT 1))`,
          [treatmentId, surveyId, patient.userId],
        );
        const version = rows[0];
        if (!version) throw new NotFoundException({ status: 'not_fillable' });

        const decision = this.decideSelf(patient, 'save_draft', 'new', patient.userId);
        await writeAccessEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'survey_response.save_draft',
          resourceType: 'survey_response',
          resourceId: surveyId,
          patientId: patient.userId,
          decision,
        });
        if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

        const { rows: locale } = await client.query<{ locale: string }>(
          `SELECT locale FROM identity.patient_account WHERE id = $1`,
          [patient.userId],
        );
        const bundle = pickBundle(
          {
            id: version.version_id,
            survey_id: surveyId,
            version: 0,
            definition: version.definition,
            locales: version.locales,
            content_hash: version.content_hash,
          },
          locale[0]?.locale ?? 'en',
        );

        const { rows: existing } = await client.query<{ id: string }>(
          `SELECT id FROM clinical.survey_response
            WHERE patient_id = $1 AND treatment_id = $2 AND survey_version_id = $3
              AND status = 'draft' AND activity_id IS NULL`,
          [patient.userId, treatmentId, version.version_id],
        );
        if (existing[0]) return { responseId: existing[0].id };

        const responseId = randomUUID();
        await client.query(
          `INSERT INTO clinical.survey_response
             (id, survey_version_id, treatment_id, patient_id, locale, content_hash)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            responseId,
            version.version_id,
            treatmentId,
            patient.userId,
            bundle.locale,
            version.content_hash,
          ],
        );
        await writeChangeEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'survey_response.start',
          resourceType: 'survey_response',
          resourceId: responseId,
          patientId: patient.userId,
          detail: { surveyId, treatmentId },
        });
        return { responseId };
      },
    );
  }

  private async loadResponse(
    client: pg.ClientBase,
    responseId: string,
  ): Promise<{ response: ResponseRow; version: VersionRow }> {
    const { rows } = await client.query(
      `SELECT r.id, r.survey_version_id, r.treatment_id, r.patient_id, r.locale, r.status,
              r.answers, r.submitted_at::text AS submitted_at,
              v.id AS v_id, v.survey_id, v.version, v.definition, v.locales, v.content_hash
         FROM clinical.survey_response r
         JOIN clinical.survey_version v ON v.id = r.survey_version_id
        WHERE r.id = $1`,
      [responseId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundException({ status: 'unknown_response' });
    return {
      response: {
        id: row['id'] as string,
        survey_version_id: row['survey_version_id'] as string,
        treatment_id: row['treatment_id'] as string,
        patient_id: row['patient_id'] as string,
        locale: row['locale'] as string,
        status: row['status'] as 'draft' | 'submitted',
        answers: row['answers'] as Answers,
        submitted_at: row['submitted_at'] as string | null,
      },
      version: {
        id: row['v_id'] as string,
        survey_id: row['survey_id'] as string,
        version: row['version'] as number,
        definition: row['definition'] as SurveyDefinition,
        locales: row['locales'] as LocaleBundle[],
        content_hash: row['content_hash'] as string,
      },
    };
  }

  /** The fill payload: definition + the bound locale bundle + answers. */
  async getResponse(patient: PatientPrincipal, responseId: string): Promise<object> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const { response, version } = await this.loadResponse(client, responseId);
        const decision = this.decideSelf(patient, 'view', responseId, response.patient_id);
        await writeAccessEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'survey_response.view',
          resourceType: 'survey_response',
          resourceId: responseId,
          patientId: response.patient_id,
          decision,
        });
        if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
        const bundle =
          version.locales.find((entry) => entry.locale === response.locale) ?? version.locales[0]!;
        return {
          responseId,
          status: response.status,
          locale: response.locale,
          kind: version.definition.kind ?? 'generic',
          definition: version.definition,
          bundle,
          answers: response.answers,
          progress: progressOf(version.definition, response.answers),
          submittedAt: response.submitted_at,
        };
      },
    );
  }

  /** Server-side save-and-resume: the draft stores visible valid answers. */
  async saveDraft(
    patient: PatientPrincipal,
    responseId: string,
    answers: Answers,
  ): Promise<object> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const { response, version } = await this.loadResponse(client, responseId);
        if (response.status !== 'draft') {
          throw new BadRequestException({ status: 'already_submitted' });
        }
        const decision = this.decideSelf(patient, 'save_draft', responseId, response.patient_id);
        if (decision !== 'allow') {
          await writeAccessEvent(client, {
            actorUserId: patient.userId,
            actorRealm: 'patient',
            action: 'survey_response.save_draft',
            resourceType: 'survey_response',
            resourceId: responseId,
            patientId: response.patient_id,
            decision,
          });
          throw new ForbiddenException({ status: 'forbidden' });
        }
        const kept = normaliseDraft(version.definition, answers);
        await client.query(
          `UPDATE clinical.survey_response
              SET answers = $2, updated_at = now() WHERE id = $1`,
          [responseId, JSON.stringify(kept)],
        );
        return { progress: progressOf(version.definition, kept) };
      },
    );
  }

  /** Authoritative submission - what the engine validates is what stores. */
  async submit(patient: PatientPrincipal, responseId: string, answers: Answers): Promise<object> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const { response, version } = await this.loadResponse(client, responseId);
        if (response.status !== 'draft') {
          throw new BadRequestException({ status: 'already_submitted' });
        }
        const decision = this.decideSelf(patient, 'submit', responseId, response.patient_id);
        await writeAccessEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'survey_response.submit',
          resourceType: 'survey_response',
          resourceId: responseId,
          patientId: response.patient_id,
          decision,
        });
        if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

        const result = validateSubmission(version.definition, answers);
        if (!result.ok) {
          throw new BadRequestException({ status: 'invalid_answers', errors: result.errors });
        }
        await client.query(
          `UPDATE clinical.survey_response
              SET answers = $2, status = 'submitted', submitted_at = now(), updated_at = now()
            WHERE id = $1`,
          [responseId, JSON.stringify(result.answers)],
        );
        await writeChangeEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'survey_response.submit',
          resourceType: 'survey_response',
          resourceId: responseId,
          patientId: response.patient_id,
          detail: { surveyVersionId: response.survey_version_id },
        });
        return { status: 'submitted' };
      },
    );
  }
}
