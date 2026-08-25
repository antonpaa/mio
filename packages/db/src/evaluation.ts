import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/**
 * Persist one rule evaluation - triggers with their traces, the
 * aggregated alert, the notification outbox row, custom notifications
 * and rule-created tasks - in the CALLER'S transaction, so the firing
 * commits with whatever caused it (a submission, a missed-window sweep)
 * or not at all. Typed structurally so this stays a persistence helper,
 * not a rules dependency; the evaluator's shapes satisfy it as-is.
 *
 * Idempotent by construction: triggers land ON CONFLICT DO NOTHING
 * against the (rule, anchor) unique pairs, and when every firing turns
 * out to be a duplicate, nothing else is written either.
 */

export interface EvaluationFiring {
  ruleId: string;
  questionId: string | null;
  severity: 'low' | 'moderate' | 'high' | null;
  outcomes: (
    | { kind: 'alert'; severity: 'low' | 'moderate' | 'high' }
    | { kind: 'notify'; recipients: ('team' | 'lead' | 'patient')[] }
    | { kind: 'task' }
  )[];
  trace: unknown;
}

export interface EvaluationContext {
  treatmentId: string;
  patientId: string;
  surveyVersionId: string;
  /** the triggering response; null on missed-window evaluations */
  surveyResponseId: string | null;
  /** the anchoring occurrence; null on ad-hoc submissions */
  activityId: string | null;
  /** rule id -> authored texts per audience and locale, assembled from
   * the version's bundles by the caller */
  ruleTexts: Record<
    string,
    {
      notifyTexts: Record<'team' | 'lead' | 'patient', Record<string, string>>;
      taskTitle: Record<string, string>;
    }
  >;
}

export interface EvaluationResultRow {
  alertId: string | null;
  triggerIds: string[];
  notificationIds: string[];
  taskIds: string[];
}

const NOTIFY_AUDIENCES = ['team', 'lead', 'patient'] as const;

/** rule id -> per-audience per-locale authored outcome texts, assembled
 * from a version's locale bundles (structural: any bundle-shaped array
 * works). X13: each audience resolves its own text, falling back to the
 * pre-X13 single notifyText so already-published payloads keep working. */
export function ruleTextsFromBundles(
  locales: {
    locale: string;
    rules?: Record<
      string,
      {
        notifyText?: string;
        notifyTexts?: Partial<Record<'team' | 'lead' | 'patient', string>>;
        taskTitle?: string;
      }
    >;
  }[],
): EvaluationContext['ruleTexts'] {
  const out: EvaluationContext['ruleTexts'] = {};
  for (const bundle of locales) {
    for (const [ruleId, texts] of Object.entries(bundle.rules ?? {})) {
      const slot = (out[ruleId] ??= {
        notifyTexts: { team: {}, lead: {}, patient: {} },
        taskTitle: {},
      });
      for (const audience of NOTIFY_AUDIENCES) {
        const text = texts.notifyTexts?.[audience] ?? texts.notifyText;
        if (text !== undefined && text.trim() !== '') {
          slot.notifyTexts[audience][bundle.locale] = text;
        }
      }
      if (texts.taskTitle !== undefined && texts.taskTitle.trim() !== '') {
        slot.taskTitle[bundle.locale] = texts.taskTitle;
      }
    }
  }
  return out;
}

export async function persistEvaluation(
  client: pg.ClientBase,
  context: EvaluationContext,
  evaluation: { fired: EvaluationFiring[]; severity: 'low' | 'moderate' | 'high' | null },
): Promise<EvaluationResultRow> {
  const result: EvaluationResultRow = {
    alertId: null,
    triggerIds: [],
    notificationIds: [],
    taskIds: [],
  };
  if (evaluation.fired.length === 0) return result;

  // drop firings whose (rule, anchor) already has a trigger - a re-run
  // sweep must not raise a second alert for the same window. (The patient
  // realm cannot read triggers, but a response also cannot submit twice,
  // so the systematic re-run case is the worker's, where this works.)
  const ruleIds = evaluation.fired.map((fired) => fired.ruleId);
  const { rows: existing } = await client.query<{ rule_id: string }>(
    `SELECT rule_id FROM clinical.rule_trigger
      WHERE rule_id = ANY($3)
        AND ((survey_response_id IS NOT NULL AND survey_response_id = $1)
          OR (survey_response_id IS NULL AND activity_id IS NOT NULL AND activity_id = $2))`,
    [context.surveyResponseId, context.activityId, ruleIds],
  );
  const already = new Set(existing.map((row) => row.rule_id));
  const fresh = evaluation.fired.filter((fired) => !already.has(fired.ruleId));
  if (fresh.length === 0) return result;
  const rank = { low: 1, moderate: 2, high: 3 } as const;
  const severity = fresh.reduce<'low' | 'moderate' | 'high' | null>(
    (acc, fired) =>
      fired.severity === null || (acc !== null && rank[acc] >= rank[fired.severity])
        ? acc
        : fired.severity,
    null,
  );

  const alertId = severity === null ? null : randomUUID();
  if (alertId !== null && severity !== null) {
    await client.query(
      `INSERT INTO clinical.alert (id, treatment_id, patient_id, survey_response_id, severity)
       VALUES ($1, $2, $3, $4, $5)`,
      [alertId, context.treatmentId, context.patientId, context.surveyResponseId, severity],
    );
    await client.query(
      `INSERT INTO clinical.notification_outbox (id, kind, treatment_id, patient_id, payload)
       VALUES ($1, 'alert.raised', $2, $3, $4)`,
      [
        randomUUID(),
        context.treatmentId,
        context.patientId,
        JSON.stringify({ alertId, severity, surveyResponseId: context.surveyResponseId }),
      ],
    );
    result.alertId = alertId;
  }

  for (const fired of fresh) {
    const triggerId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO clinical.rule_trigger
         (id, alert_id, treatment_id, patient_id, survey_response_id, activity_id,
          survey_version_id, rule_id, question_id, severity, trace)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT DO NOTHING`,
      [
        triggerId,
        fired.severity === null ? null : alertId,
        context.treatmentId,
        context.patientId,
        context.surveyResponseId,
        context.activityId,
        context.surveyVersionId,
        fired.ruleId,
        fired.questionId ?? '',
        fired.severity,
        JSON.stringify(fired.trace),
      ],
    );
    // duplicate anchor => this rule already fired here; none of its
    // outcomes may run again
    if (inserted.rowCount === 0) continue;
    result.triggerIds.push(triggerId);

    for (const outcome of fired.outcomes) {
      if (outcome.kind === 'notify') {
        const notificationId = randomUUID();
        // body keyed by audience (X13): dispatch hands each recipient
        // their own copy
        const texts = context.ruleTexts[fired.ruleId]?.notifyTexts;
        const body = Object.fromEntries(
          outcome.recipients.map((audience) => [audience, texts?.[audience] ?? {}]),
        );
        await client.query(
          `INSERT INTO clinical.rule_notification
             (id, treatment_id, patient_id, trigger_id, recipients, body)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            notificationId,
            context.treatmentId,
            context.patientId,
            triggerId,
            outcome.recipients,
            JSON.stringify(body),
          ],
        );
        result.notificationIds.push(notificationId);
      } else if (outcome.kind === 'task') {
        const taskId = randomUUID();
        const titles = context.ruleTexts[fired.ruleId]?.taskTitle ?? {};
        const title = titles['en'] ?? Object.values(titles)[0] ?? fired.ruleId;
        await client.query(
          `INSERT INTO clinical.task
             (id, treatment_id, patient_id, activity_id, title, detail, assignee_id, created_by)
           VALUES ($1, $2, $3, $4, $5, '', NULL, NULL)`,
          [taskId, context.treatmentId, context.patientId, context.activityId, title],
        );
        result.taskIds.push(taskId);
      }
    }
  }
  return result;
}
