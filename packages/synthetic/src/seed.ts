import { createHash } from 'node:crypto';
import pg from 'pg';
import { hash } from '@node-rs/argon2';
import { docFromText } from '@mio/contracts';
import {
  canonicalJson,
  deriveObservations,
  evaluateResponse,
  validateSubmission,
  type Answers,
} from '@mio/survey-schema';
import { PROGRAM_TEMPLATES } from './pools.js';
import { syntheticId } from './random.js';
import { SYNTHETIC_SURVEYS } from './surveys.js';
import type { Severity, SyntheticWorld } from './world.js';

/** Fixed anchor for seeded conversation timestamps - determinism over
 * realism, like every other synthetic date. Anchored well before the
 * other fixture dates so the spread (index * 7h across ~46 treatments)
 * can never reach "now" - a seeded message stamped in the future would
 * sit above every read watermark and count as unread forever. */
const MESSAGE_EPOCH = Date.parse('2026-07-01T08:30:00Z');

/** Concrete answers whose evaluation lands on the target severity - the
 * evaluator grades, the template only steers. Benign sets stay benign. */
function answerSetFor(surveyKey: string, target: Severity | undefined): Answers {
  const core: Record<string, Answers> = {
    high: {
      nausea: 'severe',
      'nausea-frequency': 'twice-or-more',
      'nausea-impact': 8,
      fatigue: 'considerable',
    },
    moderate: {
      nausea: 'mild',
      'nausea-frequency': 'twice-or-more',
      'nausea-impact': 5,
      fatigue: 'moderate',
    },
    low: { nausea: 'mild', 'nausea-frequency': 'once', fatigue: 'considerable' },
    benign: { nausea: 'none', fatigue: 'slight' },
  };
  const answers = { ...core[target ?? 'benign']! };
  if (surveyKey === 'chemo-symptoms') {
    if (target === 'high') {
      answers['skin-change'] = 'yes';
      answers['skin-change-map'] = ['chest'];
    } else if (target === 'moderate') {
      answers['skin-change'] = 'yes';
      answers['skin-change-map'] = ['thigh-left', 'thigh-right', 'abdomen'];
    } else if (target === 'low') {
      answers['skin-change'] = 'yes';
      answers['skin-change-map'] = ['forearm-left'];
    } else {
      answers['skin-change'] = 'no';
    }
  }
  return answers;
}

/**
 * Seed a generated world into a real database (owner connection). Grows a
 * section whenever a new entity's tables land - identity accounts and the
 * care graph today (WP-10); treatments and beyond as their WPs arrive.
 * Never runs against production by construction: it refuses when the
 * database has any non-.example account.
 */

export const DEMO_PASSWORD = 'demo-password-mio-42';

export async function seedWorld(
  connectionString: string,
  world: SyntheticWorld,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 4 });
  try {
    const { rows: nonSynthetic } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT email FROM identity.patient_account WHERE email NOT LIKE '%.example'
         UNION ALL
         SELECT email FROM identity.staff_account WHERE email NOT LIKE '%.example'
       ) reals`,
    );
    if (Number(nonSynthetic[0]?.n ?? '0') > 0) {
      throw new Error('refusing to seed: database contains non-synthetic accounts (E8)');
    }

    const passwordHash = await hash(DEMO_PASSWORD, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    await pool.query('BEGIN');
    // FK order: responses and occurrences first, then the catalog they
    // reference, then the treatment graph.
    await pool.query('DELETE FROM clinical.attachment');
    await pool.query('DELETE FROM clinical.notification');
    await pool.query('DELETE FROM clinical.thread_read');
    await pool.query('DELETE FROM clinical.internal_note');
    await pool.query('DELETE FROM clinical.message');
    await pool.query('DELETE FROM clinical.message_thread');
    await pool.query('DELETE FROM clinical.symptom_observation');
    await pool.query('DELETE FROM clinical.value_entry');
    await pool.query('DELETE FROM clinical.template_value_series');
    await pool.query('DELETE FROM clinical.value_series');
    await pool.query('DELETE FROM clinical.rule_notification');
    await pool.query('DELETE FROM clinical.rule_trigger');
    await pool.query('DELETE FROM clinical.alert_comment');
    await pool.query('DELETE FROM clinical.alert');
    await pool.query('DELETE FROM clinical.notification_outbox');
    await pool.query('DELETE FROM clinical.survey_response');
    await pool.query('DELETE FROM clinical.task');
    await pool.query('DELETE FROM clinical.activity');
    await pool.query('DELETE FROM clinical.schedule');
    await pool.query('DELETE FROM clinical.treatment_survey');
    await pool.query('DELETE FROM clinical.survey_version');
    await pool.query('DELETE FROM clinical.survey');
    await pool.query('DELETE FROM clinical.schedule');
    await pool.query('DELETE FROM clinical.care_relationship');
    await pool.query('DELETE FROM clinical.treatment_care_team');
    await pool.query('DELETE FROM clinical.treatment');
    await pool.query('DELETE FROM clinical.treatment_template_version');
    await pool.query('DELETE FROM clinical.treatment_template');
    await pool.query('DELETE FROM identity.team_membership');
    await pool.query('DELETE FROM identity.team');
    await pool.query('DELETE FROM identity.credential_token');
    await pool.query('DELETE FROM identity.terms_acceptance');
    await pool.query('DELETE FROM identity.patient_session');
    await pool.query('DELETE FROM identity.staff_session');
    await pool.query('DELETE FROM identity.patient_account');
    await pool.query('DELETE FROM identity.staff_account');

    for (const staff of world.staff) {
      await pool.query(
        `INSERT INTO identity.staff_account
           (id, email, given_name, family_name, locale, role, title, status, password_hash, password_set_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, now())`,
        [
          staff.id,
          staff.email,
          staff.givenName,
          staff.familyName,
          staff.locale,
          staff.role,
          staff.title,
          passwordHash,
        ],
      );
    }
    log(`staff: ${world.staff.length}`);

    for (const patient of world.patients) {
      await pool.query(
        `INSERT INTO identity.patient_account
           (id, email, given_name, family_name, locale, date_of_birth, phone, address, status, password_hash, password_set_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, now())`,
        [
          patient.id,
          patient.email,
          patient.givenName,
          patient.familyName,
          patient.locale,
          patient.dateOfBirth,
          patient.phone,
          JSON.stringify(patient.address),
          passwordHash,
        ],
      );
    }
    log(`patients: ${world.patients.length}`);

    for (const team of world.teams) {
      await pool.query(`INSERT INTO identity.team (id, name) VALUES ($1, $2)`, [
        team.id,
        team.name,
      ]);
      for (const staffId of team.memberIds) {
        await pool.query(
          `INSERT INTO identity.team_membership (team_id, staff_id) VALUES ($1, $2)`,
          [team.id, staffId],
        );
      }
    }
    log(`teams: ${world.teams.length}`);

    // Templates from the designed catalog: one published v1 each; the first
    // template also carries a draft v2 so the catalog shows the state.
    const versionByKey = new Map<string, string>();
    const someLead = world.staff.find((s) => s.role === 'treatment_lead') ?? world.staff[0];
    for (const [index, template] of PROGRAM_TEMPLATES.entries()) {
      const templateId = syntheticId('tmpl', index);
      const versionId = syntheticId('tmplv', index);
      await pool.query(
        `INSERT INTO clinical.treatment_template (id, name, detail, created_by)
         VALUES ($1, $2, $3, $4)`,
        [templateId, template.name, template.detail, someLead!.id],
      );
      await pool.query(
        `INSERT INTO clinical.treatment_template_version (id, template_id, version, state, created_by, published_at)
         VALUES ($1, $2, 1, 'published', $3, now())`,
        [versionId, templateId, someLead!.id],
      );
      if (index === 0) {
        await pool.query(
          `INSERT INTO clinical.treatment_template_version (id, template_id, version, state, created_by)
           VALUES ($1, $2, 2, 'draft', $3)`,
          [syntheticId('tmplv', 100), templateId, someLead!.id],
        );
      }
      versionByKey.set(template.key, versionId);
    }
    log(`templates: ${PROGRAM_TEMPLATES.length}`);

    const teamById = new Map(world.teams.map((team) => [team.id, team]));
    for (const treatment of world.treatments) {
      const team = teamById.get(treatment.teamId);
      const lead = team?.leadIds[0] ?? someLead!.id;
      await pool.query(
        `INSERT INTO clinical.treatment
           (id, patient_id, template_version_id, name, state, created_by, started_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [
          treatment.id,
          treatment.patientId,
          versionByKey.get(treatment.templateKey) ?? null,
          treatment.name,
          treatment.state,
          lead,
          treatment.startedAt,
        ],
      );
      // Leads individually, the staff team attached as a group (PP1).
      for (const leadId of team?.leadIds ?? []) {
        await pool.query(
          `INSERT INTO clinical.treatment_care_team (treatment_id, staff_id, role, added_by)
           VALUES ($1, $2, 'lead', $3)`,
          [treatment.id, leadId, lead],
        );
      }
      await pool.query(
        `INSERT INTO clinical.treatment_care_team (treatment_id, team_id, role, added_by)
         VALUES ($1, $2, 'member', $3)`,
        [treatment.id, treatment.teamId, lead],
      );
      await pool.query(`SELECT app.sync_care_relationships($1)`, [treatment.id]);
    }
    log(`treatments: ${world.treatments.length} (care graph synced per treatment)`);

    // The survey catalog: one published v1 per instrument, attached to
    // treatments via the world's surveyKeys (WP-14).
    const surveyByKey = new Map<string, string>();
    const surveyVersionByKey = new Map<string, { id: string; hash: string }>();
    for (const [index, survey] of SYNTHETIC_SURVEYS.entries()) {
      const surveyId = syntheticId('srvy', index);
      const versionId = syntheticId('srvv', index);
      surveyByKey.set(survey.key, surveyId);
      await pool.query(
        `INSERT INTO clinical.survey (id, name, kind, licensed_source, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [surveyId, survey.name, survey.kind, survey.licensedSource ?? null, someLead!.id],
      );
      const contentHash = createHash('sha256')
        .update(canonicalJson({ definition: survey.definition, locales: survey.locales }))
        .digest('hex');
      surveyVersionByKey.set(survey.key, { id: versionId, hash: contentHash });
      await pool.query(
        `INSERT INTO clinical.survey_version
           (id, survey_id, version, state, definition, locales, content_hash, created_by, published_at)
         VALUES ($1, $2, 1, 'published', $3, $4, $5, $6, now())`,
        [
          versionId,
          surveyId,
          JSON.stringify(survey.definition),
          JSON.stringify(survey.locales),
          contentHash,
          someLead!.id,
        ],
      );
    }
    for (const treatment of world.treatments) {
      for (const key of treatment.surveyKeys) {
        const surveyId = surveyByKey.get(key);
        if (!surveyId) continue;
        await pool.query(
          `INSERT INTO clinical.treatment_survey (treatment_id, survey_id, added_by)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [treatment.id, surveyId, someLead!.id],
        );
      }
    }
    log(`surveys: ${SYNTHETIC_SURVEYS.length} (published v1, attached via surveyKeys)`);

    // Submitted responses + alerts (WP-18/19): the world's abstract
    // response history maps to concrete answer sets per target severity,
    // and the REAL evaluator grades them - a seeded alert is never
    // hand-graded, it is whatever the rules produce for those answers.
    // Workflow states rotate so every triage state exists in the demo.
    const treatmentById = new Map(world.treatments.map((entry) => [entry.id, entry]));
    const seedable = world.responses
      .filter((response) => {
        const treatment = treatmentById.get(response.treatmentId);
        return (
          (response.surveyKey === 'weekly-symptoms' || response.surveyKey === 'chemo-symptoms') &&
          treatment !== undefined &&
          treatment.state === 'active' &&
          treatment.surveyKeys.includes(response.surveyKey)
        );
      })
      .slice(0, 36);
    let alertCount = 0;
    let alertIndex = 0;
    let notifyCount = 0;
    const commentBodies = [
      'Soitettu potilaalle, vointi vakaa. Seurataan.',
      'Sovittu ylimääräisestä kontrollista ensi viikolle.',
      'Oireet lievittyneet, ei lisätoimia.',
    ];
    for (const [index, entry] of seedable.entries()) {
      const treatment = treatmentById.get(entry.treatmentId)!;
      const version = surveyVersionByKey.get(entry.surveyKey)!;
      const definition = SYNTHETIC_SURVEYS.find((s) => s.key === entry.surveyKey)!.definition;
      const answers = answerSetFor(entry.surveyKey, entry.raisedSeverity);
      const checked = validateSubmission(definition, answers);
      if (!checked.ok) throw new Error(`seed fixture invalid: ${JSON.stringify(checked.errors)}`);
      const responseId = syntheticId('resp', index);
      const patient = world.patients.find((p) => p.id === entry.patientId)!;
      await pool.query(
        `INSERT INTO clinical.survey_response
           (id, survey_version_id, treatment_id, patient_id, locale, status, answers,
            content_hash, started_at, updated_at, submitted_at)
         VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, $8, $8, $8)`,
        [
          responseId,
          version.id,
          entry.treatmentId,
          entry.patientId,
          patient.locale,
          JSON.stringify(checked.answers),
          version.hash,
          entry.answeredAt,
        ],
      );
      // WP-21: mapped answers land in the symptom register exactly as a
      // live submission would write them - the REAL deriver decides
      for (const [obsIndex, observation] of deriveObservations(
        definition,
        checked.answers,
      ).entries()) {
        await pool.query(
          `INSERT INTO clinical.symptom_observation
             (id, patient_id, treatment_id, symptom_id, severity, detail, observed_at,
              source, survey_response_id, entered_by, on_behalf_of_patient)
           SELECT $1, $2, $3, y.id, $5, $6, $7, 'survey', $8, $2, false
             FROM clinical.symptom y WHERE y.code = $4`,
          [
            syntheticId('sobs', index * 8 + obsIndex),
            entry.patientId,
            entry.treatmentId,
            observation.code,
            observation.severity,
            JSON.stringify(
              observation.regions !== undefined ? { regions: observation.regions } : {},
            ),
            entry.answeredAt,
            responseId,
          ],
        );
      }
      const evaluation = evaluateResponse(definition, checked.answers);
      if (evaluation.fired.length === 0) continue;
      const alertId = evaluation.severity === null ? null : syntheticId('alrt', alertIndex);
      // the alert row first - triggers cite it by FK
      if (alertId !== null && evaluation.severity !== null) {
        const team = teamById.get(treatment.teamId)!;
        const actor = team.leadIds[0] ?? team.memberIds[0]!;
        // rotate the workflow so the triage queue shows every state:
        // new -> acknowledged -> acknowledged+assigned -> resolved
        const phase = alertIndex % 4;
        const at = new Date(entry.answeredAt);
        const ackAt = new Date(at.getTime() + 35 * 60_000).toISOString();
        const resolveAt = new Date(at.getTime() + 26 * 3_600_000).toISOString();
        await pool.query(
          `INSERT INTO clinical.alert
             (id, treatment_id, patient_id, survey_response_id, severity, status, created_at,
              assignee_id, assigned_at, assigned_by,
              acknowledged_at, acknowledged_by, resolved_at, resolved_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            alertId,
            entry.treatmentId,
            entry.patientId,
            responseId,
            evaluation.severity,
            phase === 0 ? 'new' : phase === 3 ? 'resolved' : 'acknowledged',
            entry.answeredAt,
            phase === 2 ? actor : null,
            phase === 2 ? ackAt : null,
            phase === 2 ? actor : null,
            phase === 0 ? null : ackAt,
            phase === 0 ? null : actor,
            phase === 3 ? resolveAt : null,
            phase === 3 ? actor : null,
          ],
        );
        await pool.query(
          `INSERT INTO clinical.notification_outbox (id, kind, treatment_id, patient_id, payload, created_at)
           VALUES ($1, 'alert.raised', $2, $3, $4, $5)`,
          [
            syntheticId('outb', alertIndex),
            entry.treatmentId,
            entry.patientId,
            JSON.stringify({
              alertId,
              severity: evaluation.severity,
              surveyResponseId: responseId,
            }),
            entry.answeredAt,
          ],
        );
        if (phase !== 0) {
          await pool.query(
            `INSERT INTO clinical.alert_comment (id, alert_id, patient_id, author_id, body, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              syntheticId('acom', alertIndex),
              alertId,
              entry.patientId,
              actor,
              commentBodies[alertIndex % commentBodies.length]!,
              ackAt,
            ],
          );
        }
        alertCount += 1;
        alertIndex += 1;
      }
      const instrument = SYNTHETIC_SURVEYS.find((s) => s.key === entry.surveyKey)!;
      for (const [firedIndex, fired] of evaluation.fired.entries()) {
        const triggerId = syntheticId('trig', index * 8 + firedIndex);
        await pool.query(
          `INSERT INTO clinical.rule_trigger
             (id, alert_id, treatment_id, patient_id, survey_response_id,
              survey_version_id, rule_id, question_id, severity, trace, fired_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            triggerId,
            fired.severity === null ? null : alertId,
            entry.treatmentId,
            entry.patientId,
            responseId,
            version.id,
            fired.ruleId,
            fired.questionId,
            fired.severity,
            JSON.stringify(fired.trace),
            entry.answeredAt,
          ],
        );
        // WP-20 notify outcomes: the authored per-locale text, exactly as
        // persistEvaluation writes it - WP-25's dispatch delivers these
        for (const outcome of fired.outcomes) {
          if (outcome.kind !== 'notify') continue;
          const body = Object.fromEntries(
            instrument.locales
              .map((bundle) => [bundle.locale, bundle.rules?.[fired.ruleId]?.notifyText])
              .filter(([, text]) => typeof text === 'string' && text.length > 0),
          );
          await pool.query(
            `INSERT INTO clinical.rule_notification
               (id, treatment_id, patient_id, trigger_id, recipients, body, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              syntheticId('rnot', index * 8 + firedIndex),
              entry.treatmentId,
              entry.patientId,
              triggerId,
              outcome.recipients,
              JSON.stringify(body),
              entry.answeredAt,
            ],
          );
          notifyCount += 1;
        }
      }
    }
    log(
      `responses: ${seedable.length} submitted, ${alertCount} alerts, ${notifyCount} rule notifications (graded by the evaluator)`,
    );

    // Value series (WP-21): the catalog rows the prostate templates bring
    // with them, then the world's generated PSA/testosterone histories
    // with provenance.
    const seriesDefs = [
      { key: 'psa', name: 'PSA value', unit: 'µg/l', kind: 'numeric' },
      { key: 'testosterone', name: 'Testosterone', unit: 'nmol/l', kind: 'numeric' },
      { key: 'psa-reporting', name: 'PSA reporting', unit: 'reported', kind: 'reported_marker' },
    ];
    const seriesIdByKey = new Map<string, string>();
    for (const [index, def] of seriesDefs.entries()) {
      const seriesId = syntheticId('vser', index);
      seriesIdByKey.set(def.key, seriesId);
      await pool.query(
        `INSERT INTO clinical.value_series (id, key, name, unit, kind) VALUES ($1,$2,$3,$4,$5)`,
        [seriesId, def.key, def.name, def.unit, def.kind],
      );
    }
    for (const [templateIndex, template] of PROGRAM_TEMPLATES.entries()) {
      if (template.key !== 'prostate-rt' && template.key !== 'prostate-docetaxel') continue;
      for (const key of ['psa', 'testosterone', 'psa-reporting']) {
        await pool.query(
          `INSERT INTO clinical.template_value_series (template_id, series_id) VALUES ($1, $2)`,
          [syntheticId('tmpl', templateIndex), seriesIdByKey.get(key)!],
        );
      }
    }
    for (const [index, value] of world.values.entries()) {
      const seriesId = seriesIdByKey.get(value.series);
      if (seriesId === undefined) continue;
      await pool.query(
        `INSERT INTO clinical.value_entry
           (id, series_id, patient_id, value, measured_at, note, entered_by, on_behalf_of_patient)
         VALUES ($1, $2, $3, $4, $5, '', $6, $7)`,
        [
          syntheticId('vent', index),
          seriesId,
          value.patientId,
          value.value,
          value.measuredAt,
          value.onBehalfOfStaffId ?? value.patientId,
          value.onBehalfOfStaffId !== undefined,
        ],
      );
    }
    log(`values: ${world.values.length} entries across ${seriesDefs.length} series`);

    // WP-23: one thread per programme with a small conversation in the
    // patient's own language, and an internal note the patient must
    // never see. Bodies are structured documents built by the same
    // helper the app uses - synthetic content only, deterministic.
    const CONVERSATION: Record<string, { opener: string; reply: string; thanks: string }> = {
      fi: {
        opener: 'Pahoinvointi on pahentunut viikonlopun aikana. Mitä minun kannattaisi tehdä?',
        reply:
          'Kiitos viestistä. Ottakaa pahoinvointilääke jo aamulla — seuraamme tilannetta. Soittakaa, jos vointi heikkenee.',
        thanks: 'Kiitos, kokeilen tätä.',
      },
      sv: {
        opener: 'Illamåendet har blivit värre under helgen. Vad borde jag göra?',
        reply:
          'Tack för ditt meddelande. Ta medicinen mot illamående redan på morgonen — vi följer läget. Ring om du mår sämre.',
        thanks: 'Tack, jag provar det.',
      },
      en: {
        opener: 'The nausea has gotten worse over the weekend. What should I do?',
        reply:
          'Thank you for your message. Take the anti-nausea medication in the morning — we are keeping an eye on this. Call us if you feel worse.',
        thanks: 'Thank you, I will try that.',
      },
    };
    let messageCount = 0;
    let noteCount = 0;
    for (const [index, treatment] of world.treatments.entries()) {
      const treatmentTeam = world.teams.find((candidate) => candidate.id === treatment.teamId);
      const leadId = treatmentTeam?.leadIds[0];
      if (leadId === undefined) continue;
      const treatmentPatient = world.patients.find((p) => p.id === treatment.patientId)!;
      const texts = CONVERSATION[treatmentPatient.locale] ?? CONVERSATION['en']!;
      const threadId = syntheticId('mthr', index);
      await pool.query(
        `INSERT INTO clinical.message_thread (id, treatment_id, patient_id, created_at) VALUES ($1,$2,$3,$4)`,
        [
          threadId,
          treatment.id,
          treatment.patientId,
          new Date(MESSAGE_EPOCH + index * 7 * 3_600_000).toISOString(),
        ],
      );
      const turns: { author: string; realm: 'patient' | 'staff'; text: string; offset: number }[] =
        [
          { author: treatment.patientId, realm: 'patient', text: texts.opener, offset: 0 },
          { author: leadId, realm: 'staff', text: texts.reply, offset: 2 },
          { author: treatment.patientId, realm: 'patient', text: texts.thanks, offset: 5 },
        ];
      for (const [turnIndex, turn] of turns.entries()) {
        await pool.query(
          `INSERT INTO clinical.message (id, thread_id, patient_id, author_id, author_realm, body, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            syntheticId('mesg', index * 4 + turnIndex),
            threadId,
            treatment.patientId,
            turn.author,
            turn.realm,
            JSON.stringify(docFromText(turn.text)),
            new Date(MESSAGE_EPOCH + index * 7 * 3_600_000 + turn.offset * 3_600_000).toISOString(),
          ],
        );
        messageCount += 1;
      }
      await pool.query(
        `INSERT INTO clinical.internal_note (id, thread_id, patient_id, author_id, body, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          syntheticId('note', index),
          threadId,
          treatment.patientId,
          leadId,
          JSON.stringify(
            docFromText('Tarkistetaan pahoinvointilääkityksen annostus seuraavalla käynnillä.'),
          ),
          new Date(MESSAGE_EPOCH + index * 7 * 3_600_000 + 3 * 3_600_000).toISOString(),
        ],
      );
      noteCount += 1;
    }
    log(`messages: ${messageCount} across threads, ${noteCount} internal notes`);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await pool.end();
  }
}
