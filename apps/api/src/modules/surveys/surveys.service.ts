import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type pg from 'pg';
import type { Role } from '@mio/authz';
import { authorize } from '@mio/authz/engine';
import {
  persistEvaluation,
  ruleTextsFromBundles,
  withUserContext,
  writeAccessEvent,
  writeChangeEvent,
} from '@mio/db';
import {
  applyOverrides,
  BODY_REGION_IDS,
  canonicalJson,
  deriveObservations,
  deriveValueEntries,
  evaluateResponse,
  evaluateTrends,
  maxSeverity,
  missingTranslations,
  normaliseDraft,
  patientBundleView,
  patientView,
  progressOf,
  validateDefinition,
  validateOverrides,
  validateSubmission,
  type Answers,
  type LocaleBundle,
  type ProgramOverrides,
  type RuleTrace,
  type SurveyDefinition,
  type TrendEntry,
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
import { citeTrigger } from '../../shared/trigger-citation.js';
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

/**
 * Who is entering answers: the patient, or a clinician on their behalf
 * (the PP "Report" group's "Fill a survey"). Everything downstream of
 * the authorisation is identical; the actor is what provenance and the
 * audit trail record.
 */
type FillActor =
  { realm: 'patient'; userId: string } | { realm: 'staff'; userId: string; role: Role };

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

  /**
   * The consecutive-occurrence history for trend evaluation: every
   * occurrence of the SAME survey in the SAME treatment up to the
   * anchoring one, oldest first. An occurrence neither submitted nor
   * missed is 'open' and breaks every streak. The just-submitted
   * response is spliced in because its row-status update and this read
   * share a transaction.
   */
  private async occurrenceHistory(
    client: pg.ClientBase,
    activityId: string,
    current: { responseId: string; answers: Answers },
  ): Promise<TrendEntry[]> {
    const { rows: anchorRows } = await client.query<{
      survey_id: string;
      treatment_id: string;
      occurrence_date: string;
    }>(
      `SELECT COALESCE(a.survey_id, sch.survey_id) AS survey_id, a.treatment_id,
              a.occurrence_date::text AS occurrence_date
         FROM clinical.activity a
         LEFT JOIN clinical.schedule sch ON sch.id = a.schedule_id
        WHERE a.id = $1`,
      [activityId],
    );
    const anchorRow = anchorRows[0];
    if (!anchorRow || anchorRow.survey_id === null) return [];
    const { rows } = await client.query<{
      activity_id: string;
      date: string;
      status: string;
      response_id: string | null;
      answers: Answers | null;
    }>(
      `SELECT a.id AS activity_id, a.occurrence_date::text AS date, a.status,
              r.id AS response_id, r.answers
         FROM clinical.activity a
         LEFT JOIN clinical.schedule sch ON sch.id = a.schedule_id
         LEFT JOIN clinical.survey_response r
                ON r.activity_id = a.id AND r.status = 'submitted'
        WHERE a.treatment_id = $1 AND a.kind = 'survey'
          AND COALESCE(a.survey_id, sch.survey_id) = $2
          AND a.occurrence_date <= $3
        ORDER BY a.occurrence_date DESC, a.id DESC
        LIMIT 24`,
      [anchorRow.treatment_id, anchorRow.survey_id, anchorRow.occurrence_date],
    );
    return rows.reverse().map((row): TrendEntry => {
      if (row.activity_id === activityId) {
        return {
          date: row.date,
          status: 'submitted',
          responseId: current.responseId,
          activityId: row.activity_id,
          answers: current.answers,
        };
      }
      if (row.response_id !== null) {
        return {
          date: row.date,
          status: 'submitted',
          responseId: row.response_id,
          activityId: row.activity_id,
          answers: row.answers ?? {},
        };
      }
      return {
        date: row.date,
        status: row.status === 'missed' ? 'missed' : 'open',
        activityId: row.activity_id,
      };
    });
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
          bundle: patientBundleView(bundle),
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
        return this.finishSubmission(
          client,
          { realm: 'patient', userId: patient.userId },
          response,
          version,
          answers,
        );
      },
    );
  }

  /**
   * Everything a submission does once it is authorised: validate,
   * store, complete the occurrence, evaluate the effective rule set,
   * and derive observations and value entries. Shared by the patient's
   * own submission and a clinician's on-behalf entry - the rules must
   * fire identically either way, so there is exactly one copy of this.
   * Only the ACTOR differs, and the actor is what provenance records.
   */
  private async finishSubmission(
    client: pg.ClientBase,
    actor: FillActor,
    response: ResponseRow,
    version: VersionRow,
    answers: Answers,
  ): Promise<object> {
    const onBehalf = actor.realm === 'staff';
    const responseId = response.id;
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
    // WP-18/20/22: single-response AND trend evaluation run in the
    // SAME transaction as the submission, against the treatment's
    // EFFECTIVE rule set (template + program overrides) - triggers,
    // alert, notifications and rule-created tasks commit with the
    // answers or not at all. The patient's reply stays the designed
    // P12 copy; nothing rule-shaped is returned here.
    const { rows: overrideRows } = await client.query<{ rule_overrides: ProgramOverrides }>(
      `SELECT rule_overrides FROM clinical.treatment_survey
          WHERE treatment_id = $1 AND survey_id = $2`,
      [response.treatment_id, version.survey_id],
    );
    const effective = applyOverrides(version.definition, overrideRows[0]?.rule_overrides ?? {});
    const singles = evaluateResponse(effective, result.answers);
    const trends =
      response.activity_id === null
        ? { fired: [], severity: null }
        : evaluateTrends(
            effective,
            await this.occurrenceHistory(client, response.activity_id, {
              responseId,
              answers: result.answers,
            }),
          );
    const persisted = await persistEvaluation(
      client,
      {
        treatmentId: response.treatment_id,
        patientId: response.patient_id,
        surveyVersionId: response.survey_version_id,
        surveyResponseId: responseId,
        activityId: response.activity_id,
        ruleTexts: ruleTextsFromBundles(version.locales),
      },
      {
        fired: [...singles.fired, ...trends.fired],
        severity: maxSeverity(singles.severity, trends.severity),
      },
    );
    // WP-21: mapped answers land in the symptom register in the same
    // transaction, source 'survey', provenance = the submitting patient
    const derived = deriveObservations(version.definition, result.answers);
    if (derived.length > 0) {
      const { rows: symptomRows } = await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM clinical.symptom WHERE active AND code = ANY($1)`,
        [derived.map((entry) => entry.code)],
      );
      const symptomByCode = new Map(symptomRows.map((row) => [row.code, row.id]));
      for (const entry of derived) {
        const symptomId = symptomByCode.get(entry.code);
        if (symptomId === undefined) continue; // unmapped code: skip, never fail a submission
        await client.query(
          `INSERT INTO clinical.symptom_observation
               (id, patient_id, treatment_id, symptom_id, severity, detail, observed_at,
                source, survey_response_id, entered_by, on_behalf_of_patient)
             VALUES ($1, $2, $3, $4, $5, $6, current_date, 'survey', $7, $8, $9)`,
          [
            randomUUID(),
            response.patient_id,
            response.treatment_id,
            symptomId,
            entry.severity,
            JSON.stringify(entry.regions !== undefined ? { regions: entry.regions } : {}),
            responseId,
            actor.userId,
            onBehalf,
          ],
        );
      }
    }
    // X8: bound numeric answers land in the patient's value series
    // in the same transaction - value from the bound question, date
    // from its date neighbour when present, provenance the patient.
    // An unknown series key skips silently: a rename must never fail
    // a submission.
    const valueWrites = deriveValueEntries(version.definition, result.answers);
    if (valueWrites.length > 0) {
      const { rows: seriesRows } = await client.query<{ id: string; key: string }>(
        `SELECT id, key FROM clinical.value_series WHERE key = ANY($1)`,
        [valueWrites.map((entry) => entry.seriesKey)],
      );
      const seriesByKey = new Map(seriesRows.map((row) => [row.key, row.id]));
      for (const entry of valueWrites) {
        const seriesId = seriesByKey.get(entry.seriesKey);
        if (seriesId === undefined) continue;
        await client.query(
          `INSERT INTO clinical.value_entry
               (id, series_id, patient_id, value, measured_at, note, entered_by,
                on_behalf_of_patient)
             VALUES ($1, $2, $3, $4, $5, '', $6, $7)`,
          [
            randomUUID(),
            seriesId,
            response.patient_id,
            entry.value,
            entry.measuredAt ?? new Date().toISOString().slice(0, 10),
            actor.userId,
            onBehalf,
          ],
        );
      }
    }
    await writeChangeEvent(client, {
      actorUserId: actor.userId,
      actorRealm: actor.realm,
      action: 'survey_response.submit',
      resourceType: 'survey_response',
      resourceId: responseId,
      patientId: response.patient_id,
      detail: { surveyVersionId: response.survey_version_id },
    });
    if (persisted.alertId !== null) {
      // the PP6 timeline's "raised by rule" entry - the actor is the
      // submission that caused it, the why lives in the trigger traces
      await writeChangeEvent(client, {
        actorUserId: actor.userId,
        actorRealm: actor.realm,
        action: 'alert.raise',
        resourceType: 'alert',
        resourceId: persisted.alertId,
        patientId: response.patient_id,
        detail: {
          severity: maxSeverity(singles.severity, trends.severity),
          ruleIds: [...singles.fired, ...trends.fired]
            .filter((fired) => fired.severity !== null)
            .map((fired) => fired.ruleId),
        },
      });
    }
    return { status: 'submitted' };
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

  /** The published version bound for this patient x treatment: the
   * attachment's pin when there is one, otherwise the newest published,
   * plus the language the fill should speak. */
  private async resolveBoundVersion(
    client: pg.ClientBase,
    surveyId: string,
    treatmentId: string,
    patientId: string,
  ): Promise<
    | {
        version_id: string;
        definition: SurveyDefinition;
        locales: LocaleBundle[];
        content_hash: string;
        language: string | null;
        locale: string;
      }
    | undefined
  > {
    const { rows } = await client.query<{
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
      [surveyId, treatmentId, patientId],
    );
    return rows[0];
  }

  /**
   * PP "Report" -> "Fill a survey": what this patient's care team may
   * fill on their behalf right now. Open occurrences first (the common
   * case - the patient answered by phone or in clinic), then every
   * attached survey for an ad-hoc entry.
   */
  async fillableForPatient(staff: StaffPrincipal, patientId: string): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows: treatmentRows } = await client.query<{ id: string }>(
        `SELECT id FROM clinical.treatment
          WHERE patient_id = $1 AND state = 'active' AND archived_at IS NULL`,
        [patientId],
      );
      if (treatmentRows.length === 0) {
        // RLS already hides out-of-care patients; an in-care patient with
        // no active treatment simply has nothing fillable
        return [];
      }
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'view',
        resource: {
          type: 'survey_assignment',
          id: patientId,
          patientId,
          teamUserIds: [staff.userId],
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_assignment.view',
        resourceType: 'survey_assignment',
        resourceId: patientId,
        patientId,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

      const { rows } = await client.query(
        `SELECT a.id AS activity_id, a.treatment_id, a.occurrence_date::text AS due_date,
                COALESCE(a.survey_id, sch.survey_id) AS survey_id,
                s.name AS survey_name, t.name AS treatment_name,
                (SELECT r.id FROM clinical.survey_response r
                  WHERE r.activity_id = a.id AND r.status = 'draft') AS draft_id
           FROM clinical.activity a
           LEFT JOIN clinical.schedule sch ON sch.id = a.schedule_id
           JOIN clinical.treatment t ON t.id = a.treatment_id
           JOIN clinical.survey s ON s.id = COALESCE(a.survey_id, sch.survey_id)
          WHERE a.patient_id = $1 AND a.kind = 'survey'
            AND a.status IN ('planned', 'confirmed')
            AND t.state = 'active' AND t.archived_at IS NULL
          ORDER BY a.occurrence_date NULLS LAST`,
        [patientId],
      );
      const { rows: adHoc } = await client.query(
        `SELECT NULL::uuid AS activity_id, ts.treatment_id, NULL::text AS due_date,
                ts.survey_id, s.name AS survey_name, t.name AS treatment_name,
                NULL::uuid AS draft_id
           FROM clinical.treatment_survey ts
           JOIN clinical.treatment t ON t.id = ts.treatment_id
           JOIN clinical.survey s ON s.id = ts.survey_id
          WHERE t.patient_id = $1 AND ts.removed_at IS NULL
            AND t.state = 'active' AND t.archived_at IS NULL
          ORDER BY s.name`,
        [patientId],
      );
      return [...rows, ...adHoc] as object[];
    });
  }

  /**
   * Opens (or resumes) a response the clinician fills on the patient's
   * behalf. The provenance is stamped at creation - on_behalf_by - so a
   * response can never become on-behalf after the fact, and PP4/PP2/PP3
   * render "on behalf of patient" from it.
   */
  async startOnBehalf(
    staff: StaffPrincipal,
    patientId: string,
    input: { treatmentId: string; surveyId: string; activityId?: string },
  ): Promise<{ responseId: string }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const context = await this.treatmentContext(client, input.treatmentId);
      if (!context || context.patientId !== patientId) {
        throw new NotFoundException({ status: 'unknown_treatment' });
      }
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'enter_on_behalf_of_patient',
        resource: {
          type: 'treatment',
          id: input.treatmentId,
          patientId,
          teamUserIds: context.teamUserIds,
          leadUserIds: context.leadUserIds,
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'treatment.enter_on_behalf_of_patient',
        resourceType: 'survey_response',
        resourceId: input.activityId ?? input.treatmentId,
        patientId,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

      if (input.activityId !== undefined) {
        const { rows: activityRows } = await client.query<{
          patient_id: string;
          treatment_id: string;
          status: string;
          survey_id: string | null;
        }>(
          `SELECT a.patient_id, a.treatment_id, a.status,
                  COALESCE(a.survey_id, sch.survey_id) AS survey_id
             FROM clinical.activity a
             LEFT JOIN clinical.schedule sch ON sch.id = a.schedule_id
            WHERE a.id = $1 AND a.kind = 'survey'`,
          [input.activityId],
        );
        const activity = activityRows[0];
        if (
          !activity ||
          activity.patient_id !== patientId ||
          activity.treatment_id !== input.treatmentId
        ) {
          throw new NotFoundException({ status: 'unknown_occurrence' });
        }
        if (!['planned', 'confirmed'].includes(activity.status)) {
          throw new BadRequestException({ status: 'occurrence_closed' });
        }
        // the patient may already have a draft open on this occurrence:
        // it is the same answer sheet, so the clinician continues it
        // rather than opening a competing one
        const { rows: existing } = await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM clinical.survey_response WHERE activity_id = $1`,
          [input.activityId],
        );
        if (existing[0]) {
          if (existing[0].status !== 'draft') {
            throw new BadRequestException({ status: 'already_submitted' });
          }
          await client.query(
            `UPDATE clinical.survey_response SET on_behalf_by = $2, updated_at = now()
              WHERE id = $1`,
            [existing[0].id, staff.userId],
          );
          return { responseId: existing[0].id };
        }
      }

      const version = await this.resolveBoundVersion(
        client,
        input.surveyId,
        input.treatmentId,
        patientId,
      );
      if (!version) throw new NotFoundException({ status: 'no_published_version' });
      if (input.activityId === undefined) {
        // ad-hoc: one open draft per patient x treatment x version is a
        // database invariant - resume whichever is open, whoever opened it
        const { rows: openDraft } = await client.query<{ id: string }>(
          `SELECT id FROM clinical.survey_response
            WHERE patient_id = $1 AND treatment_id = $2 AND survey_version_id = $3
              AND status = 'draft' AND activity_id IS NULL`,
          [patientId, input.treatmentId, version.version_id],
        );
        if (openDraft[0]) {
          await client.query(
            `UPDATE clinical.survey_response SET on_behalf_by = $2, updated_at = now()
              WHERE id = $1`,
            [openDraft[0].id, staff.userId],
          );
          return { responseId: openDraft[0].id };
        }
      }
      const bundle = pickBundle(
        {
          id: version.version_id,
          survey_id: input.surveyId,
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
           (id, survey_version_id, treatment_id, patient_id, activity_id, locale,
            content_hash, on_behalf_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          responseId,
          version.version_id,
          input.treatmentId,
          patientId,
          input.activityId ?? null,
          bundle.locale,
          version.content_hash,
          staff.userId,
        ],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_response.start',
        resourceType: 'survey_response',
        resourceId: responseId,
        patientId,
        detail: {
          surveyId: input.surveyId,
          activityId: input.activityId ?? null,
          onBehalfOfPatient: true,
        },
      });
      return { responseId };
    });
  }

  /** The on-behalf fill payload. Deliberately the PATIENT view of the
   * definition: the clinician is recording the patient's answers, and
   * rule criticality is not part of that conversation (B3). */
  async responseForFill(staff: StaffPrincipal, responseId: string): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { response, version } = await this.loadResponse(client, responseId);
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'view',
        resource: {
          type: 'survey_response',
          id: responseId,
          patientId: response.patient_id,
          careTeamUserIds: [staff.userId],
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_response.view',
        resourceType: 'survey_response',
        resourceId: responseId,
        patientId: response.patient_id,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const bundle =
        version.locales.find((entry) => entry.locale === response.locale) ?? version.locales[0]!;
      const { rows: who } = await client.query<{ given_name: string; family_name: string }>(
        `SELECT given_name, family_name FROM identity.patient_account WHERE id = $1`,
        [response.patient_id],
      );
      return {
        responseId,
        status: response.status,
        locale: response.locale,
        kind: version.definition.kind ?? 'generic',
        definition: patientView(version.definition),
        bundle: patientBundleView(bundle),
        answers: response.answers,
        progress: progressOf(version.definition, response.answers),
        submittedAt: response.submitted_at,
        patient: who[0] ?? null,
      };
    });
  }

  /** Save-and-resume for an on-behalf fill: the same entry act, still
   * in progress, so it rides enter_on_behalf_of_patient. */
  async saveDraftOnBehalf(
    staff: StaffPrincipal,
    responseId: string,
    answers: Answers,
  ): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { response, version } = await this.loadResponse(client, responseId);
      if (response.status !== 'draft') {
        throw new BadRequestException({ status: 'already_submitted' });
      }
      const context = await this.treatmentContext(client, response.treatment_id);
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'enter_on_behalf_of_patient',
        resource: {
          type: 'treatment',
          id: response.treatment_id,
          patientId: response.patient_id,
          teamUserIds: context?.teamUserIds ?? [],
          leadUserIds: context?.leadUserIds ?? [],
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'treatment.enter_on_behalf_of_patient',
        resourceType: 'survey_response',
        resourceId: responseId,
        patientId: response.patient_id,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const kept = normaliseDraft(version.definition, answers);
      await client.query(
        `UPDATE clinical.survey_response
            SET answers = $2, on_behalf_by = $3, updated_at = now() WHERE id = $1`,
        [responseId, JSON.stringify(kept), staff.userId],
      );
      return { progress: progressOf(version.definition, kept) };
    });
  }

  /**
   * The on-behalf submission. Same engine, same rules, same alerts as
   * the patient's own - only the actor differs, and every derived
   * record carries on_behalf_of_patient so the register never claims
   * the patient said it themselves.
   */
  async submitOnBehalf(
    staff: StaffPrincipal,
    responseId: string,
    answers: Answers,
  ): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { response, version } = await this.loadResponse(client, responseId);
      if (response.status !== 'draft') {
        throw new BadRequestException({ status: 'already_submitted' });
      }
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'submit_on_behalf_of_patient',
        resource: {
          type: 'survey_response',
          id: responseId,
          patientId: response.patient_id,
          careTeamUserIds: [staff.userId],
        },
      });
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_response.submit_on_behalf_of_patient',
        resourceType: 'survey_response',
        resourceId: responseId,
        patientId: response.patient_id,
        decision: decision.decision,
      });
      if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      await client.query(`UPDATE clinical.survey_response SET on_behalf_by = $2 WHERE id = $1`, [
        responseId,
        staff.userId,
      ]);
      return this.finishSubmission(
        client,
        { realm: 'staff', userId: staff.userId, role: staff.role },
        response,
        version,
        answers,
      );
    });
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

  /** Resolve one attachment's effective version + overrides for the
   * program-rules panel and the C7 standing computation. */
  private async loadAttachment(
    client: pg.ClientBase,
    treatmentId: string,
    surveyId: string,
  ): Promise<{ version: VersionRow; overrides: ProgramOverrides } | undefined> {
    const { rows } = await client.query(
      `SELECT ts.rule_overrides, v.id, v.survey_id, v.version, v.definition, v.locales,
              v.content_hash
         FROM clinical.treatment_survey ts
         JOIN clinical.survey_version v ON v.id = COALESCE(
           ts.pinned_version_id,
           (SELECT v2.id FROM clinical.survey_version v2
             WHERE v2.survey_id = ts.survey_id AND v2.state = 'published'
             ORDER BY v2.version DESC LIMIT 1))
        WHERE ts.treatment_id = $1 AND ts.survey_id = $2 AND ts.removed_at IS NULL`,
      [treatmentId, surveyId],
    );
    const row = rows[0] as (VersionRow & { rule_overrides: ProgramOverrides }) | undefined;
    if (!row) return undefined;
    return {
      version: {
        id: row.id,
        survey_id: row.survey_id,
        version: row.version,
        definition: row.definition,
        locales: row.locales,
        content_hash: row.content_hash,
      },
      overrides: row.rule_overrides ?? {},
    };
  }

  private decideProgramRules(
    staff: StaffPrincipal,
    treatmentId: string,
    context: { patientId: string; teamUserIds: string[]; leadUserIds: string[] },
  ): 'allow' | 'deny' {
    return authorize({
      principal: { userId: staff.userId, role: staff.role },
      action: 'configure_program_rules',
      resource: {
        type: 'treatment',
        id: treatmentId,
        patientId: context.patientId,
        teamUserIds: context.teamUserIds,
        leadUserIds: context.leadUserIds,
      },
    }).decision;
  }

  /** The program-rules panel payload: the effective version, its locales
   * for labels, and the current overrides. REGULATED-ADJACENT read, so
   * it is audited like the write. */
  async programRules(
    staff: StaffPrincipal,
    treatmentId: string,
    surveyId: string,
  ): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const context = await this.treatmentContext(client, treatmentId);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = this.decideProgramRules(staff, treatmentId, context);
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'treatment.configure_program_rules',
        resourceType: 'program_rules',
        resourceId: `${treatmentId}:${surveyId}`,
        patientId: context.patientId,
        decision,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const attachment = await this.loadAttachment(client, treatmentId, surveyId);
      if (!attachment) throw new NotFoundException({ status: 'unknown_attachment' });
      return {
        versionId: attachment.version.id,
        version: attachment.version.version,
        definition: attachment.version.definition,
        locales: attachment.version.locales,
        overrides: attachment.overrides,
      };
    });
  }

  /** Write the program's override layer. Validated against the effective
   * version so an override can never reference a rule that is not there. */
  async saveProgramRules(
    staff: StaffPrincipal,
    treatmentId: string,
    surveyId: string,
    overrides: ProgramOverrides,
  ): Promise<{ status: string }> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const context = await this.treatmentContext(client, treatmentId);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = this.decideProgramRules(staff, treatmentId, context);
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'treatment.configure_program_rules',
        resourceType: 'program_rules',
        resourceId: `${treatmentId}:${surveyId}`,
        patientId: context.patientId,
        decision,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const attachment = await this.loadAttachment(client, treatmentId, surveyId);
      if (!attachment) throw new NotFoundException({ status: 'unknown_attachment' });
      const issues = validateOverrides(
        attachment.version.definition,
        overrides ?? {},
        BODY_REGION_IDS,
      );
      if (issues.length > 0) {
        throw new BadRequestException({ status: 'invalid_overrides', issues });
      }
      await client.query(
        `UPDATE clinical.treatment_survey SET rule_overrides = $3
          WHERE treatment_id = $1 AND survey_id = $2`,
        [treatmentId, surveyId, JSON.stringify(overrides ?? {})],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'treatment.configure_program_rules',
        resourceType: 'treatment_survey',
        resourceId: `${treatmentId}:${surveyId}`,
        patientId: context.patientId,
        detail: {
          overriddenRules: Object.keys(overrides?.rules ?? {}),
          criticalSets: Object.keys(overrides?.criticalRegions ?? {}),
        },
      });
      return { status: 'saved' };
    });
  }

  /** C7: one response with per-answer STANDING against the program's
   * effective rules ("Above expected" / "Expected in this program" /
   * "Critical area"), the stored triggers it actually raised, and the
   * program rule summary. Staff surface - the full definition ships. */
  async responseDetail(staff: StaffPrincipal, responseId: string): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { response, version } = await this.loadResponse(client, responseId);
      const context = await this.treatmentContext(client, response.treatment_id);
      if (!context) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'view',
        resource: {
          type: 'survey_response',
          id: responseId,
          patientId: response.patient_id,
          careTeamUserIds: [staff.userId],
        },
      }).decision;
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_response.view',
        resourceType: 'survey_response',
        resourceId: responseId,
        patientId: response.patient_id,
        decision,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });

      const attachment = await this.loadAttachment(
        client,
        response.treatment_id,
        version.survey_id,
      );
      const overrides = attachment?.overrides ?? {};
      // standing is computed against the response's OWN version with the
      // program's overrides - the exact rule set this program applies to
      // these answers
      const effective = applyOverrides(version.definition, overrides);
      const evaluation = evaluateResponse(effective, response.answers);
      const standing: Record<string, 'above_expected' | 'critical_area' | 'expected'> = {};
      for (const fired of evaluation.fired) {
        if (fired.questionId === null || fired.severity === null) continue;
        const kind = fired.trace.condition.kind;
        standing[fired.questionId] =
          kind === 'critical_region' ? 'critical_area' : 'above_expected';
      }

      const { rows: head } = await client.query(
        `SELECT t.name AS treatment_name, s.name AS survey_name,
                p.given_name AS patient_given, p.family_name AS patient_family,
                b.given_name AS behalf_given, b.family_name AS behalf_family
           FROM clinical.survey_response r
           JOIN clinical.treatment t ON t.id = r.treatment_id
           JOIN clinical.survey_version v ON v.id = r.survey_version_id
           JOIN clinical.survey s ON s.id = v.survey_id
           JOIN identity.patient_account p ON p.id = r.patient_id
           LEFT JOIN identity.staff_account b ON b.id = r.on_behalf_by
          WHERE r.id = $1`,
        [responseId],
      );
      const { rows: triggerRows } = await client.query<{
        id: string;
        rule_id: string;
        severity: string | null;
        trace: RuleTrace;
        alert_id: string | null;
      }>(
        `SELECT id, rule_id, severity, trace, alert_id
           FROM clinical.rule_trigger WHERE survey_response_id = $1 ORDER BY rule_id`,
        [responseId],
      );
      return {
        response: {
          id: response.id,
          status: response.status,
          locale: response.locale,
          submitted_at: response.submitted_at,
          answers: response.answers,
          treatment_id: response.treatment_id,
          patient_id: response.patient_id,
          version: version.version,
          ...head[0],
        },
        definition: version.definition,
        effectiveDefinition: effective,
        locales: version.locales,
        overrides,
        standing,
        triggers: triggerRows.map((row) => ({
          id: row.id,
          rule_id: row.rule_id,
          severity: row.severity,
          alert_id: row.alert_id,
          source: row.trace.source,
          citation: citeTrigger(row.trace, version.locales, response.locale),
        })),
      };
    });
  }

  /** PP4: the patient's completed surveys, each color-coded by what its
   * submission raised and opening the WHOLE response bound to its exact
   * version. One list-level audited disclosure. */
  async patientResponses(staff: StaffPrincipal, patientId: string): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows: care } = await client.query(
        `SELECT 1 FROM clinical.care_relationship
          WHERE patient_id = $1 AND staff_id = $2 AND ended_at IS NULL`,
        [patientId, staff.userId],
      );
      if (care.length === 0) throw new NotFoundException({ status: 'unknown_patient' });
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'view',
        resource: {
          type: 'survey_response',
          id: 'list',
          patientId,
          careTeamUserIds: [staff.userId],
        },
      }).decision;
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'survey_response.view',
        resourceType: 'survey_response_list',
        resourceId: patientId,
        patientId,
        decision,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      const { rows } = await client.query(
        `SELECT r.id, r.locale, r.submitted_at::text AS submitted_at,
                v.version, s.name AS survey_name,
                b.given_name AS behalf_given, b.family_name AS behalf_family,
                (SELECT a.severity FROM clinical.alert a
                  WHERE a.survey_response_id = r.id
                  ORDER BY CASE a.severity WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 ELSE 1 END DESC
                  LIMIT 1) AS alert_severity,
                (SELECT count(*)::int FROM clinical.rule_trigger rt
                  WHERE rt.survey_response_id = r.id) AS trigger_count
           FROM clinical.survey_response r
           JOIN clinical.survey_version v ON v.id = r.survey_version_id
           JOIN clinical.survey s ON s.id = v.survey_id
           LEFT JOIN identity.staff_account b ON b.id = r.on_behalf_by
          WHERE r.patient_id = $1 AND r.status = 'submitted'
          ORDER BY r.submitted_at DESC
          LIMIT 100`,
        [patientId],
      );
      return rows as object[];
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
    const rules = Object.fromEntries(
      Object.entries(bundle?.rules ?? {}).filter(
        ([, texts]) =>
          (texts.notifyText !== undefined && texts.notifyText.trim() !== '') ||
          (texts.taskTitle !== undefined && texts.taskTitle.trim() !== ''),
      ),
    );
    return {
      locale,
      title: typeof bundle?.title === 'string' ? bundle.title : '',
      ...(bundle?.description !== undefined ? { description: bundle.description } : {}),
      questions: bundle?.questions ?? {},
      ...(Object.keys(rules).length > 0 ? { rules } : {}),
    };
  });
}
