import { createHash, randomUUID } from 'node:crypto';
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
  canonicalJson,
  missingTranslations,
  normaliseDraft,
  patientView,
  progressOf,
  validateDefinition,
  validateSubmission,
  type Answers,
  type LocaleBundle,
  type SurveyDefinition,
} from '@mio/survey-schema';
import {
  addDays,
  DEFAULT_HORIZON_DAYS,
  expandSchedule,
  formatDate,
  materialiseSchedule,
  parseDate,
  type ScheduleSegment,
} from '@mio/schedule';
import { APP_POOL } from '../../shared/db.module.js';
import type { PatientPrincipal } from '../../shared/patient-session.js';
import type { StaffPrincipal } from '../../shared/staff-session.js';

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
  activity_id: string | null;
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

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
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
        // Scheduled occurrences: due (and overdue) survey activities that
        // have no submitted response yet (P3's Open section).
        const { rows: due } = await client.query(
          `SELECT a.id AS activity_id, a.occurrence_date::text AS due_date, a.title,
                  a.treatment_id, t.name AS treatment_name,
                  COALESCE(a.survey_id, sch.survey_id) AS survey_id,
                  (SELECT r.id FROM clinical.survey_response r
                    WHERE r.activity_id = a.id) AS response_id
             FROM clinical.activity a
             LEFT JOIN clinical.schedule sch ON sch.id = a.schedule_id
             JOIN clinical.treatment t ON t.id = a.treatment_id
            WHERE a.patient_id = $1 AND a.kind = 'survey'
              AND a.status IN ('planned', 'confirmed')
              AND COALESCE(a.survey_id, sch.survey_id) IS NOT NULL
              AND a.occurrence_date <= current_date + 14
            ORDER BY a.occurrence_date`,
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
        const today = isoToday();
        return {
          due: (due as Record<string, unknown>[]).map((row) => ({
            activityId: row['activity_id'],
            responseId: row['response_id'],
            dueDate: row['due_date'],
            overdue: (row['due_date'] as string) < today,
            title: row['title'],
            treatmentName: row['treatment_name'],
          })),
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
      `SELECT r.id, r.survey_version_id, r.treatment_id, r.patient_id, r.activity_id,
              r.locale, r.status, r.answers, r.submitted_at::text AS submitted_at,
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
        activity_id: row['activity_id'] as string | null,
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
          // criticality is clinician configuration - never patient-visible
          definition: patientView(version.definition),
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
        if (response.activity_id !== null) {
          // completes the occurrence; self-guarding SECURITY DEFINER since
          // the patient realm holds no UPDATE on clinical.activity
          await client.query(`SELECT app.complete_survey_occurrence($1)`, [response.activity_id]);
        }
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

  private async treatmentContext(
    client: pg.ClientBase,
    treatmentId: string,
  ): Promise<{ patientId: string; teamUserIds: string[]; leadUserIds: string[] } | undefined> {
    const { rows } = await client.query<{ patient_id: string }>(
      `SELECT patient_id FROM clinical.treatment WHERE id = $1`,
      [treatmentId],
    );
    const treatment = rows[0];
    if (!treatment) return undefined;
    const { rows: staffRows } = await client.query<{ staff_id: string; is_lead: boolean }>(
      `SELECT staff_id, is_lead FROM app.treatment_staff($1)`,
      [treatmentId],
    );
    return {
      patientId: treatment.patient_id,
      teamUserIds: staffRows.map((row) => row.staff_id),
      leadUserIds: staffRows.filter((row) => row.is_lead).map((row) => row.staff_id),
    };
  }

  /** B1-lite: the staff survey catalog with versions and usage. */
  async catalog(staff: StaffPrincipal): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      // Catalogue content: audit 'never' per the matrix; Cedar still gates.
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'view',
        resource: { type: 'survey_template', id: 'catalog' },
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query(
        `SELECT s.id, s.name, s.kind, s.licensed_source,
                (SELECT json_agg(json_build_object('id', v.id, 'version', v.version, 'state', v.state)
                        ORDER BY v.version DESC)
                   FROM clinical.survey_version v WHERE v.survey_id = s.id) AS versions,
                (SELECT count(*)::int FROM clinical.treatment_survey ts
                  WHERE ts.survey_id = s.id AND ts.removed_at IS NULL) AS in_use
           FROM clinical.survey s
          ORDER BY s.name`,
      );
      return rows;
    });
  }

  /** The treatment's survey assignments with their schedules (T1/T4). */
  async listAssignments(staff: StaffPrincipal, treatmentId: string): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const context = await this.treatmentContext(client, treatmentId);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'view',
        resource: {
          type: 'survey_assignment',
          id: treatmentId,
          patientId: context.patientId,
          teamUserIds: context.teamUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_assignment.view',
        resourceType: 'survey_assignment_list',
        resourceId: treatmentId,
        patientId: context.patientId,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query(
        `SELECT ts.id, ts.survey_id, ts.pinned_version_id, ts.language,
                s.name, s.kind, s.licensed_source,
                pv.version AS pinned_version,
                (SELECT max(v.version) FROM clinical.survey_version v
                  WHERE v.survey_id = s.id AND v.state = 'published') AS newest_version,
                (SELECT json_build_object('id', sch.id, 'anchorDate', sch.anchor_date::text,
                                          'segments', sch.segments,
                                          'answerWindowDays', sch.answer_window_days,
                                          'reminderAfterDays', sch.reminder_after_days,
                                          'escalateUnanswered', sch.escalate_unanswered)
                   FROM clinical.schedule sch
                  WHERE sch.treatment_id = ts.treatment_id AND sch.survey_id = ts.survey_id
                    AND sch.ended_at IS NULL
                  ORDER BY sch.created_at DESC LIMIT 1) AS schedule,
                (SELECT min(a.occurrence_date)::text FROM clinical.activity a
                  LEFT JOIN clinical.schedule sc ON sc.id = a.schedule_id
                  WHERE a.treatment_id = ts.treatment_id AND a.kind = 'survey'
                    AND COALESCE(a.survey_id, sc.survey_id) = ts.survey_id
                    AND a.status IN ('planned', 'confirmed')) AS next_due
           FROM clinical.treatment_survey ts
           JOIN clinical.survey s ON s.id = ts.survey_id
           LEFT JOIN clinical.survey_version pv ON pv.id = ts.pinned_version_id
          WHERE ts.treatment_id = $1 AND ts.removed_at IS NULL
          ORDER BY s.name`,
        [treatmentId],
      );
      return rows;
    });
  }

  /** T4: attach a survey and send it now, on a date, or on a recurrence
   * riding the WP-12 machinery. */
  async assign(
    staff: StaffPrincipal,
    treatmentId: string,
    input: {
      surveyId: string;
      versionId?: string;
      language?: string;
      mode: 'now' | 'scheduled' | 'recurring';
      date?: string;
      anchorDate?: string;
      segments?: ScheduleSegment[];
      answerWindowDays?: number;
      reminderAfterDays?: number;
      escalateUnanswered?: boolean;
    },
  ): Promise<{ assignmentId: string; scheduleId?: string; activityId?: string }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const context = await this.treatmentContext(client, treatmentId);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: input.mode === 'recurring' ? 'schedule_recurring' : 'create',
        resource: {
          type: 'survey_assignment',
          id: 'new',
          patientId: context.patientId,
          teamUserIds: context.teamUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: `survey_assignment.${input.mode === 'recurring' ? 'schedule_recurring' : 'create'}`,
        resourceType: 'survey_assignment',
        resourceId: treatmentId,
        patientId: context.patientId,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

      const { rows: versions } = await client.query<{
        id: string;
        survey_id: string;
        locales: LocaleBundle[];
        name: string;
      }>(
        `SELECT v.id, v.survey_id, v.locales, s.name
           FROM clinical.survey_version v
           JOIN clinical.survey s ON s.id = v.survey_id
          WHERE v.survey_id = $1 AND v.state = 'published'
          ORDER BY v.version DESC`,
        [input.surveyId],
      );
      if (versions.length === 0) throw new BadRequestException({ status: 'no_published_version' });
      if (input.versionId !== undefined && !versions.some((v) => v.id === input.versionId)) {
        throw new BadRequestException({ status: 'unknown_version' });
      }
      if (
        input.language !== undefined &&
        input.language !== '' &&
        !['en', 'fi', 'sv'].includes(input.language)
      ) {
        throw new BadRequestException({ status: 'unknown_language' });
      }

      const assignmentId = randomUUID();
      const { rows: upserted } = await client.query<{ id: string }>(
        `INSERT INTO clinical.treatment_survey (id, treatment_id, survey_id, pinned_version_id, language, added_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (treatment_id, survey_id)
         DO UPDATE SET removed_at = NULL, pinned_version_id = $4, language = $5
         RETURNING id`,
        [
          assignmentId,
          treatmentId,
          input.surveyId,
          input.versionId ?? null,
          input.language || null,
          staff.userId,
        ],
      );
      const finalAssignmentId = upserted[0]?.id ?? assignmentId;

      // The occurrence/schedule title is what the patient's calendar shows -
      // use the bundle title in the assignment language (or English).
      const wanted = input.language || 'en';
      const bundle =
        versions[0]!.locales.find((entry) => entry.locale === wanted) ??
        versions[0]!.locales.find((entry) => entry.locale === 'en') ??
        versions[0]!.locales[0]!;
      const title = bundle.title;

      let scheduleId: string | undefined;
      let activityId: string | undefined;
      if (input.mode === 'recurring') {
        const anchorDate = input.anchorDate ?? '';
        const segments = input.segments ?? [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate) || segments.length === 0) {
          throw new BadRequestException({ status: 'anchor_and_segments_required' });
        }
        const horizonTo = formatDate(addDays(parseDate(anchorDate), DEFAULT_HORIZON_DAYS));
        expandSchedule({ anchorDate, segments }, { to: horizonTo, max: 400 });
        const { rows: tz } = await client.query<{ timezone: string }>(
          `SELECT timezone FROM identity.patient_account WHERE id = $1`,
          [context.patientId],
        );
        const timezone = tz[0]?.timezone ?? 'Europe/Helsinki';
        scheduleId = randomUUID();
        await client.query(
          `INSERT INTO clinical.schedule
             (id, treatment_id, patient_id, timezone, anchor_date, segments, payload, survey_id,
              answer_window_days, reminder_after_days, escalate_unanswered, generated_until, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            scheduleId,
            treatmentId,
            context.patientId,
            timezone,
            anchorDate,
            JSON.stringify(segments),
            JSON.stringify({ title, kind: 'survey' }),
            input.surveyId,
            input.answerWindowDays ?? null,
            input.reminderAfterDays ?? null,
            input.escalateUnanswered ?? false,
            horizonTo,
            staff.userId,
          ],
        );
        await materialiseSchedule(
          client,
          {
            id: scheduleId,
            treatment_id: treatmentId,
            patient_id: context.patientId,
            timezone,
            anchor_date: anchorDate,
            segments,
            add_dates: null,
            remove_dates: null,
            payload: { title, kind: 'survey' },
          },
          { from: anchorDate, to: horizonTo },
        );
      } else {
        const date = input.mode === 'now' ? isoToday() : (input.date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new BadRequestException({ status: 'date_required' });
        }
        activityId = randomUUID();
        await client.query(
          `INSERT INTO clinical.activity
             (id, treatment_id, patient_id, occurrence_date, title, kind, survey_id, created_by)
           VALUES ($1, $2, $3, $4, $5, 'survey', $6, $7)`,
          [activityId, treatmentId, context.patientId, date, title, input.surveyId, staff.userId],
        );
      }
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_assignment.create',
        resourceType: 'survey_assignment',
        resourceId: finalAssignmentId,
        patientId: context.patientId,
        detail: { surveyId: input.surveyId, mode: input.mode },
      });
      return {
        assignmentId: finalAssignmentId,
        ...(scheduleId ? { scheduleId } : {}),
        ...(activityId ? { activityId } : {}),
      };
    });
  }

  /** P3: open a draft bound to a scheduled OCCURRENCE. */
  async startFromActivity(
    patient: PatientPrincipal,
    activityId: string,
  ): Promise<{ responseId: string }> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const { rows } = await client.query<{
          id: string;
          treatment_id: string;
          patient_id: string;
          status: string;
          survey_id: string | null;
        }>(
          `SELECT a.id, a.treatment_id, a.patient_id, a.status,
                  COALESCE(a.survey_id, sch.survey_id) AS survey_id
             FROM clinical.activity a
             LEFT JOIN clinical.schedule sch ON sch.id = a.schedule_id
            WHERE a.id = $1 AND a.kind = 'survey'`,
          [activityId],
        );
        const activity = rows[0];
        if (!activity || activity.patient_id !== patient.userId || activity.survey_id === null) {
          throw new NotFoundException({ status: 'unknown_occurrence' });
        }
        if (!['planned', 'confirmed'].includes(activity.status)) {
          throw new BadRequestException({ status: 'occurrence_closed' });
        }
        const { rows: existing } = await client.query<{ id: string }>(
          `SELECT id FROM clinical.survey_response WHERE activity_id = $1`,
          [activityId],
        );
        if (existing[0]) return { responseId: existing[0].id };

        const decision = this.decideSelf(patient, 'save_draft', 'new', patient.userId);
        await writeAccessEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'survey_response.save_draft',
          resourceType: 'survey_response',
          resourceId: activityId,
          patientId: patient.userId,
          decision,
        });
        if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

        const { rows: versionRows } = await client.query<{
          version_id: string;
          definition: SurveyDefinition;
          locales: LocaleBundle[];
          content_hash: string;
          language: string | null;
          locale: string;
        }>(
          `SELECT v.id AS version_id, v.definition, v.locales, v.content_hash,
                  ts.language, p.locale
             FROM clinical.survey_version v
             LEFT JOIN clinical.treatment_survey ts
               ON ts.treatment_id = $2 AND ts.survey_id = v.survey_id AND ts.removed_at IS NULL
             JOIN identity.patient_account p ON p.id = $3
            WHERE v.survey_id = $1 AND v.state = 'published'
              AND v.id = COALESCE(
                ts.pinned_version_id,
                (SELECT v2.id FROM clinical.survey_version v2
                  WHERE v2.survey_id = $1 AND v2.state = 'published'
                  ORDER BY v2.version DESC LIMIT 1))`,
          [activity.survey_id, activity.treatment_id, patient.userId],
        );
        const version = versionRows[0];
        if (!version) throw new NotFoundException({ status: 'no_published_version' });
        const bundle = pickBundle(
          {
            id: version.version_id,
            survey_id: activity.survey_id,
            version: 0,
            definition: version.definition,
            locales: version.locales,
            content_hash: version.content_hash,
          },
          version.language ?? version.locale ?? 'en',
        );
        const responseId = randomUUID();
        await client.query(
          `INSERT INTO clinical.survey_response
             (id, survey_version_id, treatment_id, patient_id, activity_id, locale, content_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            responseId,
            version.version_id,
            activity.treatment_id,
            patient.userId,
            activityId,
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
          detail: { surveyId: activity.survey_id, activityId },
        });
        return { responseId };
      },
    );
  }

  private decideTemplate(
    staff: StaffPrincipal,
    action: 'view' | 'create' | 'update_draft' | 'publish' | 'archive',
    resourceId: string,
  ): 'allow' | 'deny' {
    return authorize({
      principal: { userId: staff.userId, role: staff.role },
      action,
      resource: { type: 'survey_template', id: resourceId },
    }).decision;
  }

  private static hashContent(definition: SurveyDefinition, locales: LocaleBundle[]): string {
    return createHash('sha256').update(canonicalJson({ definition, locales })).digest('hex');
  }

  /** Missing-text count per locale: title + labels + option labels. */
  private static completeness(
    definition: SurveyDefinition,
    locales: LocaleBundle[],
  ): Record<string, number> {
    return Object.fromEntries(
      locales.map((bundle) => [
        bundle.locale,
        missingTranslations(definition, bundle).length + (bundle.title.trim() === '' ? 1 : 0),
      ]),
    );
  }

  /** B1 "+ New survey": the survey and an EMPTY draft v1 to edit. */
  async createSurvey(
    staff: StaffPrincipal,
    input: { name: string; kind?: string; licensedSource?: string },
  ): Promise<{ surveyId: string; versionId: string }> {
    if (!input.name?.trim()) throw new BadRequestException({ status: 'name_required' });
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const decision = this.decideTemplate(staff, 'create', 'new');
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_template.create',
        resourceType: 'survey_template',
        resourceId: null,
        patientId: null,
        decision,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

      const surveyId = randomUUID();
      const versionId = randomUUID();
      const kind = input.kind === 'symptom' ? 'symptom' : 'generic';
      const definition: SurveyDefinition = {
        kind: kind as 'symptom' | 'generic',
        pages: [{ id: 'page-1', questions: [] }],
      };
      const locales: LocaleBundle[] = (['en', 'fi', 'sv'] as const).map((locale) => ({
        locale,
        title: locale === 'en' ? input.name.trim() : '',
        questions: {},
      }));
      await client.query(
        `INSERT INTO clinical.survey (id, name, kind, licensed_source, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [surveyId, input.name.trim(), kind, input.licensedSource?.trim() || null, staff.userId],
      );
      await client.query(
        `INSERT INTO clinical.survey_version
           (id, survey_id, version, state, definition, locales, content_hash, created_by)
         VALUES ($1, $2, 1, 'draft', $3, $4, $5, $6)`,
        [
          versionId,
          surveyId,
          JSON.stringify(definition),
          JSON.stringify(locales),
          SurveysService.hashContent(definition, locales),
          staff.userId,
        ],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_template.create',
        resourceType: 'survey_template',
        resourceId: surveyId,
        patientId: null,
      });
      return { surveyId, versionId };
    });
  }

  /** B4: the survey with its versions and per-locale completeness. */
  async surveyDetail(staff: StaffPrincipal, surveyId: string): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const decision = this.decideTemplate(staff, 'view', surveyId);
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query(
        `SELECT id, name, kind, licensed_source FROM clinical.survey WHERE id = $1`,
        [surveyId],
      );
      const survey = rows[0] as Record<string, unknown> | undefined;
      if (!survey) throw new NotFoundException({ status: 'unknown_survey' });
      const { rows: versions } = await client.query(
        `SELECT id, version, state, definition, locales,
                created_at, published_at
           FROM clinical.survey_version WHERE survey_id = $1 ORDER BY version DESC`,
        [surveyId],
      );
      return {
        ...survey,
        versions: (versions as Record<string, unknown>[]).map((row) => ({
          id: row['id'],
          version: row['version'],
          state: row['state'],
          createdAt: row['created_at'],
          publishedAt: row['published_at'],
          completeness: SurveysService.completeness(
            row['definition'] as SurveyDefinition,
            row['locales'] as LocaleBundle[],
          ),
          questionCount: allQuestionCount(row['definition'] as SurveyDefinition),
        })),
      };
    });
  }

  /** The editor payload: the full version with its survey header. */
  async versionDetail(staff: StaffPrincipal, versionId: string): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const decision = this.decideTemplate(staff, 'view', versionId);
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query(
        `SELECT v.id, v.survey_id, v.version, v.state, v.definition, v.locales,
                s.name, s.kind, s.licensed_source
           FROM clinical.survey_version v
           JOIN clinical.survey s ON s.id = v.survey_id
          WHERE v.id = $1`,
        [versionId],
      );
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new NotFoundException({ status: 'unknown_version' });
      return {
        ...row,
        completeness: SurveysService.completeness(
          row['definition'] as SurveyDefinition,
          row['locales'] as LocaleBundle[],
        ),
      };
    });
  }

  /** B2/B5/B6: update a DRAFT. A published version never comes back here -
   * the service refuses and the storage trigger backstops it. Licensed
   * instruments are locked from restructuring entirely (R11). */
  async updateDraft(
    staff: StaffPrincipal,
    versionId: string,
    input: { definition: SurveyDefinition; locales: LocaleBundle[] },
  ): Promise<{ issues: object[] }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const decision = this.decideTemplate(staff, 'update_draft', versionId);
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_template.update_draft',
        resourceType: 'survey_template',
        resourceId: versionId,
        patientId: null,
        decision,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query<{ state: string; licensed_source: string | null }>(
        `SELECT v.state, s.licensed_source
           FROM clinical.survey_version v JOIN clinical.survey s ON s.id = v.survey_id
          WHERE v.id = $1`,
        [versionId],
      );
      const version = rows[0];
      if (!version) throw new NotFoundException({ status: 'unknown_version' });
      if (version.state !== 'draft') throw new BadRequestException({ status: 'not_a_draft' });
      if (version.licensed_source !== null) {
        throw new BadRequestException({ status: 'licensed_locked' });
      }

      const issues = validateDefinition(input.definition);
      // an EMPTY page set is fine while drafting; every other issue blocks
      const blocking = issues.filter((issue) => issue.code !== 'empty');
      if (blocking.length > 0) {
        throw new BadRequestException({ status: 'invalid_definition', issues: blocking });
      }
      const locales = normaliseLocales(input.locales);
      await client.query(
        `UPDATE clinical.survey_version
            SET definition = $2, locales = $3, content_hash = $4 WHERE id = $1`,
        [
          versionId,
          JSON.stringify(input.definition),
          JSON.stringify(locales),
          SurveysService.hashContent(input.definition, locales),
        ],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_template.update_draft',
        resourceType: 'survey_template',
        resourceId: versionId,
        patientId: null,
      });
      return { issues };
    });
  }

  /** B4: publish - immutable from this moment on. Requires a real
   * definition and at least one COMPLETE locale (a variant with gaps is
   * never offered to patients, so an all-gaps version cannot go live). */
  async publishVersion(staff: StaffPrincipal, versionId: string): Promise<void> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const decision = this.decideTemplate(staff, 'publish', versionId);
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_template.publish',
        resourceType: 'survey_template',
        resourceId: versionId,
        patientId: null,
        decision,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query<{
        state: string;
        definition: SurveyDefinition;
        locales: LocaleBundle[];
      }>(`SELECT state, definition, locales FROM clinical.survey_version WHERE id = $1`, [
        versionId,
      ]);
      const version = rows[0];
      if (!version) throw new NotFoundException({ status: 'unknown_version' });
      if (version.state !== 'draft') throw new BadRequestException({ status: 'not_a_draft' });
      const issues = validateDefinition(version.definition);
      if (issues.length > 0) {
        throw new BadRequestException({ status: 'invalid_definition', issues });
      }
      const completeness = SurveysService.completeness(version.definition, version.locales);
      if (!Object.values(completeness).some((missing) => missing === 0)) {
        throw new BadRequestException({ status: 'no_complete_locale', completeness });
      }
      await client.query(
        `UPDATE clinical.survey_version
            SET state = 'published', published_at = now() WHERE id = $1`,
        [versionId],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_template.publish',
        resourceType: 'survey_template',
        resourceId: versionId,
        patientId: null,
      });
    });
  }

  async archiveVersion(staff: StaffPrincipal, versionId: string): Promise<void> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const decision = this.decideTemplate(staff, 'archive', versionId);
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_template.archive',
        resourceType: 'survey_template',
        resourceId: versionId,
        patientId: null,
        decision,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const result = await client.query(
        `UPDATE clinical.survey_version SET state = 'archived'
          WHERE id = $1 AND state IN ('draft', 'published')`,
        [versionId],
      );
      if (result.rowCount === 0) throw new NotFoundException({ status: 'unknown_version' });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_template.archive',
        resourceType: 'survey_template',
        resourceId: versionId,
        patientId: null,
      });
    });
  }

  /** B4 "New draft from vN": any edit to a published version starts here. */
  async newDraft(
    staff: StaffPrincipal,
    surveyId: string,
  ): Promise<{ versionId: string; version: number }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const decision = this.decideTemplate(staff, 'update_draft', surveyId);
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_template.update_draft',
        resourceType: 'survey_template',
        resourceId: surveyId,
        patientId: null,
        decision,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query<{
        id: string;
        version: number;
        state: string;
        definition: SurveyDefinition;
        locales: LocaleBundle[];
        content_hash: string;
        licensed_source: string | null;
      }>(
        `SELECT v.id, v.version, v.state, v.definition, v.locales, v.content_hash,
                s.licensed_source
           FROM clinical.survey_version v JOIN clinical.survey s ON s.id = v.survey_id
          WHERE v.survey_id = $1 ORDER BY v.version DESC`,
        [surveyId],
      );
      if (rows.length === 0) throw new NotFoundException({ status: 'unknown_survey' });
      if (rows[0]!.licensed_source !== null) {
        throw new BadRequestException({ status: 'licensed_locked' });
      }
      if (rows.some((row) => row.state === 'draft')) {
        throw new BadRequestException({ status: 'draft_exists' });
      }
      const source = rows[0]!;
      const versionId = randomUUID();
      const version = source.version + 1;
      await client.query(
        `INSERT INTO clinical.survey_version
           (id, survey_id, version, state, definition, locales, content_hash, created_by)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7)`,
        [
          versionId,
          surveyId,
          version,
          JSON.stringify(source.definition),
          JSON.stringify(source.locales),
          source.content_hash,
          staff.userId,
        ],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_template.new_draft',
        resourceType: 'survey_template',
        resourceId: versionId,
        patientId: null,
        detail: { surveyId, fromVersion: source.version, version },
      });
      return { versionId, version };
    });
  }
}

function allQuestionCount(definition: SurveyDefinition): number {
  let count = 0;
  const visit = (questions: { followUps?: unknown[] }[]): void => {
    for (const question of questions) {
      count += 1;
      if (question.followUps) visit(question.followUps as { followUps?: unknown[] }[]);
    }
  };
  for (const page of definition.pages) visit(page.questions);
  return count;
}

/** Keep exactly the three platform locales, shaped, in a stable order. */
function normaliseLocales(input: LocaleBundle[]): LocaleBundle[] {
  return (['en', 'fi', 'sv'] as const).map((locale) => {
    const bundle = input.find((entry) => entry.locale === locale);
    return {
      locale,
      title: typeof bundle?.title === 'string' ? bundle.title : '',
      ...(bundle?.description !== undefined ? { description: bundle.description } : {}),
      questions: bundle?.questions ?? {},
    };
  });
}
