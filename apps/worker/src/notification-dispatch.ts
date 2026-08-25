import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/**
 * WP-25: the notification fan-out. Consumes the same-transaction outbox
 * (WP-18/23) and the rule notifications (WP-20) into per-recipient rows
 * in clinical.notification - the content-bearing IN-APP layer - and a
 * contentless email nudge where the patient's P8 toggle allows it.
 *
 * Delivery decisions, stated once:
 * - message.new by STAFF -> the patient gets a row (and the email nudge).
 *   By a PATIENT -> no rows: the team's C4 inbox unread already carries
 *   it; duplicating per-staff rows would double-track attention.
 * - alert.raised -> no rows for anyone: patients never see alerts (the
 *   matrix denies it), and the clinician triage queue with its bell IS
 *   the alert surface. WP-27 may fold alerts into the staff centre.
 * - rule.notify -> the authored text goes to each named recipient:
 *   'patient' as an in-app row (+ email nudge), 'team' to every staff
 *   member on the treatment, 'lead' to its treatment leads. Staff get
 *   no email - staff email notifications are not designed yet.
 */

/** Type-level contentless guarantee, like the API's ContentlessMail: no
 * field of this shape CAN carry clinical content. */
export interface NotificationMail {
  recipient: string;
  locale: string;
  type: 'new_message' | 'rule_notification';
  link: string;
}
export type NotificationSender = (mail: NotificationMail) => Promise<void>;

export interface DispatchResult {
  outboxProcessed: number;
  rulesDispatched: number;
  rowsWritten: number;
  mailsSent: number;
}

interface PatientContact {
  email: string;
  locale: string;
  email_prefs: Record<string, unknown>;
  deceased_on: string | null;
}

/** Returns null for a deceased patient (WP-29): no rows, no mails - the
 * respectful silence is total, and callers need no second check. */
async function patientContact(
  client: pg.ClientBase,
  patientId: string,
): Promise<PatientContact | null> {
  const { rows } = await client.query<PatientContact>(
    `SELECT email, locale, email_prefs, deceased_on::text AS deceased_on
       FROM identity.patient_account WHERE id = $1`,
    [patientId],
  );
  const contact = rows[0] ?? null;
  return contact === null || contact.deceased_on !== null ? null : contact;
}

/** Absent key = on; only an explicit false switches a type's email off. */
function emailAllowed(prefs: Record<string, unknown>, kind: string): boolean {
  return prefs[kind] !== false;
}

async function insertRow(
  client: pg.ClientBase,
  row: {
    recipientId: string;
    recipientRealm: 'patient' | 'staff';
    kind: string;
    patientId: string;
    treatmentId: string | null;
    ref: object;
    body?: object;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO clinical.notification
       (id, recipient_id, recipient_realm, kind, patient_id, treatment_id, ref, body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      row.recipientId,
      row.recipientRealm,
      row.kind,
      row.patientId,
      row.treatmentId,
      JSON.stringify(row.ref),
      row.body !== undefined ? JSON.stringify(row.body) : null,
    ],
  );
}

export async function dispatchNotifications(
  pool: { connect(): Promise<pg.PoolClient> },
  send: NotificationSender,
): Promise<DispatchResult> {
  const client = await pool.connect();
  const result: DispatchResult = {
    outboxProcessed: 0,
    rulesDispatched: 0,
    rowsWritten: 0,
    mailsSent: 0,
  };
  const mails: NotificationMail[] = [];
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.realm', 'system', true)`,
    );

    const { rows: outbox } = await client.query<{
      id: string;
      kind: string;
      treatment_id: string | null;
      patient_id: string | null;
      payload: { messageId?: string; authorRealm?: string };
    }>(
      `SELECT id, kind, treatment_id, patient_id, payload
         FROM clinical.notification_outbox
        WHERE processed_at IS NULL
        ORDER BY created_at
        LIMIT 500`,
    );
    for (const entry of outbox) {
      if (
        entry.kind === 'message.new' &&
        entry.payload.authorRealm === 'staff' &&
        entry.patient_id !== null
      ) {
        const contact = await patientContact(client, entry.patient_id);
        if (contact !== null) {
          await insertRow(client, {
            recipientId: entry.patient_id,
            recipientRealm: 'patient',
            kind: 'message.new',
            patientId: entry.patient_id,
            treatmentId: entry.treatment_id,
            ref: { treatmentId: entry.treatment_id, messageId: entry.payload.messageId },
          });
          result.rowsWritten += 1;
          if (emailAllowed(contact.email_prefs, 'message.new')) {
            mails.push({
              recipient: contact.email,
              locale: contact.locale,
              type: 'new_message',
              link: '/messages',
            });
          }
        }
      }
      await client.query(
        `UPDATE clinical.notification_outbox SET processed_at = now() WHERE id = $1`,
        [entry.id],
      );
      result.outboxProcessed += 1;
    }

    const { rows: ruleRows } = await client.query<{
      id: string;
      treatment_id: string;
      patient_id: string;
      trigger_id: string;
      recipients: string[];
      body: Record<string, string>;
    }>(
      `SELECT id, treatment_id, patient_id, trigger_id, recipients, body
         FROM clinical.rule_notification
        WHERE dispatched_at IS NULL
        ORDER BY created_at
        LIMIT 500`,
    );
    for (const rule of ruleRows) {
      const base = {
        kind: 'rule.notify',
        patientId: rule.patient_id,
        treatmentId: rule.treatment_id,
        ref: { triggerId: rule.trigger_id, treatmentId: rule.treatment_id },
        body: rule.body,
      };
      if (rule.recipients.includes('patient')) {
        const contact = await patientContact(client, rule.patient_id);
        if (contact !== null) {
          await insertRow(client, {
            ...base,
            recipientId: rule.patient_id,
            recipientRealm: 'patient',
          });
          result.rowsWritten += 1;
          if (emailAllowed(contact.email_prefs, 'rule.notify')) {
            mails.push({
              recipient: contact.email,
              locale: contact.locale,
              type: 'rule_notification',
              link: '/notifications',
            });
          }
        }
      }
      if (rule.recipients.includes('team') || rule.recipients.includes('lead')) {
        // 'lead' means THIS treatment's care-team leads (the position on
        // the team), not any account attribute - the 2026-08-25 role
        // restructure made that distinction structural.
        const { rows: staff } = await client.query<{ staff_id: string; is_lead: boolean }>(
          `SELECT ts.staff_id, ts.is_lead FROM app.treatment_staff($1) ts`,
          [rule.treatment_id],
        );
        const wanted = staff.filter(
          (member) =>
            rule.recipients.includes('team') ||
            (rule.recipients.includes('lead') && member.is_lead),
        );
        for (const member of wanted) {
          await insertRow(client, {
            ...base,
            recipientId: member.staff_id,
            recipientRealm: 'staff',
          });
          result.rowsWritten += 1;
        }
      }
      await client.query(
        `UPDATE clinical.rule_notification SET dispatched_at = now() WHERE id = $1`,
        [rule.id],
      );
      result.rulesDispatched += 1;
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // mails go out only after the rows committed - a mail for a
  // notification that does not exist would be the worse failure
  for (const mail of mails) {
    await send(mail);
    result.mailsSent += 1;
  }
  return result;
}
