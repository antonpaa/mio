import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type pg from 'pg';
import { authorize } from '@mio/authz/engine';
import { attachmentIdsOf, parseMessageDoc, plainTextOf, type MessageDoc } from '@mio/contracts';
import { withUserContext, writeAccessEvent, writeChangeEvent } from '@mio/db';
import { APP_POOL } from '../../shared/db.module.js';
import type { PatientPrincipal } from '../../shared/patient-session.js';
import type { StaffPrincipal } from '../../shared/staff-session.js';

/**
 * Messaging (WP-23, docs/architecture/messaging-and-attachments.md): one
 * thread per treatment programme, shared across the care team, created
 * lazily by whichever side posts first. Message bodies are structured
 * documents - parseMessageDoc rebuilds them against the schema, so
 * nothing an editor or a crafted request smuggles in survives to
 * storage. Internal notes are their own entity end to end: separate
 * table without a patient RLS arm, separate endpoint, separate Cedar
 * action - the patient path never touches them in any code path. An
 * ended programme's thread stays readable but takes no new posts.
 */

interface TreatmentRow {
  id: string;
  patient_id: string;
  name: string;
  state: string;
}

/** Ended programmes keep their thread readable - and read-only (P10). */
const POSTABLE_STATES = ['active', 'paused'];

const PREVIEW_LENGTH = 120;

function preview(body: MessageDoc | null): string | null {
  if (body === null) return null;
  const text = plainTextOf(body).replace(/\n/g, ' ');
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

@Injectable()
export class MessagesService {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  private async loadTreatment(client: pg.ClientBase, treatmentId: string): Promise<TreatmentRow> {
    const { rows } = await client.query<TreatmentRow>(
      `SELECT id, patient_id, name, state FROM clinical.treatment WHERE id = $1 AND state <> 'draft'`,
      [treatmentId],
    );
    // RLS hides out-of-scope treatments - outsiders get the same 404 as an
    // unknown id, never an existence oracle
    if (!rows[0]) throw new NotFoundException({ status: 'unknown_thread' });
    return rows[0];
  }

  private async teamOf(client: pg.ClientBase, treatmentId: string): Promise<string[]> {
    const { rows } = await client.query<{ staff_id: string }>(
      `SELECT staff_id FROM app.treatment_staff($1)`,
      [treatmentId],
    );
    return rows.map((row) => row.staff_id);
  }

  private async decideStaff(
    client: pg.ClientBase,
    staff: StaffPrincipal,
    treatment: TreatmentRow,
    resource: 'message_thread' | 'internal_note',
    action: 'view' | 'post',
    team: string[],
  ): Promise<void> {
    const decision = authorize({
      principal: { userId: staff.userId, roles: staff.roles },
      action,
      resource: {
        type: resource,
        id: treatment.id,
        patientId: treatment.patient_id,
        teamUserIds: team,
      },
    });
    await writeAccessEvent(client, {
      actorUserId: staff.userId,
      actorRealm: 'staff',
      action: `${resource}.${action}`,
      resourceType: resource,
      resourceId: treatment.id,
      patientId: treatment.patient_id,
      decision: decision.decision,
    });
    if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
  }

  private async decidePatient(
    client: pg.ClientBase,
    patient: PatientPrincipal,
    treatment: TreatmentRow,
    action: 'view' | 'post',
  ): Promise<void> {
    const decision = authorize({
      principal: { userId: patient.userId, roles: ['patient'] },
      action,
      resource: {
        type: 'message_thread',
        id: treatment.id,
        patientId: treatment.patient_id,
        subjectUserId: treatment.patient_id,
      },
    });
    await writeAccessEvent(client, {
      actorUserId: patient.userId,
      actorRealm: 'patient',
      action: `message_thread.${action}`,
      resourceType: 'message_thread',
      resourceId: treatment.id,
      patientId: treatment.patient_id,
      decision: decision.decision,
    });
    if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
  }

  private async ensureThread(
    client: pg.ClientBase,
    treatment: TreatmentRow,
  ): Promise<{ id: string }> {
    await client.query(
      `INSERT INTO clinical.message_thread (id, treatment_id, patient_id)
       VALUES ($1, $2, $3) ON CONFLICT (treatment_id) DO NOTHING`,
      [randomUUID(), treatment.id, treatment.patient_id],
    );
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM clinical.message_thread WHERE treatment_id = $1`,
      [treatment.id],
    );
    return rows[0]!;
  }

  private async markRead(client: pg.ClientBase, treatmentId: string, userId: string) {
    await client.query(
      `INSERT INTO clinical.thread_read (thread_id, user_id, patient_id, last_read_at)
       SELECT th.id, $2, th.patient_id, now() FROM clinical.message_thread th
        WHERE th.treatment_id = $1
       ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = now()`,
      [treatmentId, userId],
    );
  }

  /** C4: the team-shared inbox - one row per care patient's programme,
   * with preview and unread count (messages AND notes count for staff).
   * One list-level access event carries the disclosed patient ids. */
  async staffInbox(staff: StaffPrincipal): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows } = await client.query(
        `SELECT t.id AS treatment_id, t.name AS treatment_name, t.state, t.patient_id,
                p.given_name AS patient_given, p.family_name AS patient_family,
                lm.body AS last_body, lm.created_at::text AS last_at,
                lm.author_realm AS last_author_realm,
                lm.author_id AS last_author_id,
                lm.author_given AS last_author_given,
                COALESCE((SELECT count(*)::int FROM clinical.message m
                  WHERE m.thread_id = th.id AND m.author_id <> $1
                    AND m.created_at > COALESCE(tr.last_read_at, 'epoch'::timestamptz)), 0)
                + COALESCE((SELECT count(*)::int FROM clinical.internal_note n
                  WHERE n.thread_id = th.id AND n.author_id <> $1
                    AND n.created_at > COALESCE(tr.last_read_at, 'epoch'::timestamptz)), 0)
                  AS unread
           FROM clinical.treatment t
           JOIN identity.patient_account p ON p.id = t.patient_id
           LEFT JOIN clinical.message_thread th ON th.treatment_id = t.id
           LEFT JOIN clinical.thread_read tr ON tr.thread_id = th.id AND tr.user_id = $1
           LEFT JOIN LATERAL (
             SELECT m.body, m.created_at, m.author_realm, m.author_id,
                    COALESCE(sa.given_name, pa.given_name) AS author_given
               FROM clinical.message m
               LEFT JOIN identity.staff_account sa
                 ON sa.id = m.author_id AND m.author_realm = 'staff'
               LEFT JOIN identity.patient_account pa
                 ON pa.id = m.author_id AND m.author_realm = 'patient'
              WHERE m.thread_id = th.id ORDER BY m.created_at DESC LIMIT 1
           ) lm ON true
          WHERE t.state <> 'draft'
            AND EXISTS (SELECT 1 FROM clinical.care_relationship cr
                         WHERE cr.patient_id = t.patient_id
                           AND cr.staff_id = $1 AND cr.ended_at IS NULL)
          ORDER BY lm.created_at DESC NULLS LAST, t.name`,
        [staff.userId],
      );
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'message_thread.view',
        resourceType: 'message_inbox',
        resourceId: null,
        patientId: null,
        decision: 'allow',
        context: {
          patientIds: [...new Set((rows as { patient_id: string }[]).map((r) => r.patient_id))],
        },
      });
      return (rows as (Record<string, unknown> & { last_body: MessageDoc | null })[]).map(
        ({ last_body, ...row }) => ({ ...row, last_preview: preview(last_body) }),
      );
    });
  }

  /** The staff thread: messages and internal notes as one timeline, the
   * programme's alerts as cross-reference markers, read watermark moved.
   * Note disclosure is its own matrix action - the view writes TWO
   * access events, like the alert trace precedent. */
  async staffThread(staff: StaffPrincipal, treatmentId: string): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const treatment = await this.loadTreatment(client, treatmentId);
      const team = await this.teamOf(client, treatmentId);
      await this.decideStaff(client, staff, treatment, 'message_thread', 'view', team);
      await this.decideStaff(client, staff, treatment, 'internal_note', 'view', team);

      const { rows: messages } = await client.query(
        `SELECT m.id, m.author_id, m.author_realm, m.body, m.created_at::text AS created_at,
                COALESCE(sa.given_name, pa.given_name) AS author_given,
                COALESCE(sa.family_name, pa.family_name) AS author_family
           FROM clinical.message m
           JOIN clinical.message_thread th ON th.id = m.thread_id
           LEFT JOIN identity.staff_account sa ON sa.id = m.author_id AND m.author_realm = 'staff'
           LEFT JOIN identity.patient_account pa ON pa.id = m.author_id AND m.author_realm = 'patient'
          WHERE th.treatment_id = $1
          ORDER BY m.created_at`,
        [treatmentId],
      );
      const { rows: notes } = await client.query(
        `SELECT n.id, n.author_id, n.body, n.created_at::text AS created_at,
                sa.given_name AS author_given, sa.family_name AS author_family
           FROM clinical.internal_note n
           JOIN clinical.message_thread th ON th.id = n.thread_id
           LEFT JOIN identity.staff_account sa ON sa.id = n.author_id
          WHERE th.treatment_id = $1
          ORDER BY n.created_at`,
        [treatmentId],
      );
      const { rows: alerts } = await client.query(
        `SELECT a.id, a.severity, a.status, a.created_at::text AS created_at,
                s.name AS survey_name
           FROM clinical.alert a
           LEFT JOIN clinical.survey_response r ON r.id = a.survey_response_id
           LEFT JOIN clinical.survey_version v ON v.id = r.survey_version_id
           LEFT JOIN clinical.survey s ON s.id = v.survey_id
          WHERE a.treatment_id = $1 ORDER BY a.created_at`,
        [treatmentId],
      );
      type TimelineRow = Record<string, unknown> & { created_at: string };
      const items = [
        ...(messages as TimelineRow[]).map((row) => ({ kind: 'message' as const, ...row })),
        ...(notes as TimelineRow[]).map((row) => ({
          kind: 'note' as const,
          author_realm: 'staff',
          ...row,
        })),
      ].sort((a, b) => a.created_at.localeCompare(b.created_at));
      await this.markRead(client, treatmentId, staff.userId);
      const { rows: patient } = await client.query(
        `SELECT given_name, family_name FROM identity.patient_account WHERE id = $1`,
        [treatment.patient_id],
      );
      return {
        treatment: {
          id: treatment.id,
          name: treatment.name,
          state: treatment.state,
          patient_id: treatment.patient_id,
          patient_given: patient[0]?.given_name ?? '',
          patient_family: patient[0]?.family_name ?? '',
        },
        readOnly: !POSTABLE_STATES.includes(treatment.state),
        items,
        alerts,
      };
    });
  }

  /** P10: the patient's threads - one per programme, ended ones marked
   * read-only. Unread counts messages only; notes do not exist here. */
  async patientThreads(patient: PatientPrincipal): Promise<object[]> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const { rows } = await client.query(
          `SELECT t.id AS treatment_id, t.name AS treatment_name, t.state,
                  lm.body AS last_body, lm.created_at::text AS last_at,
                  lm.author_realm AS last_author_realm,
                  lm.author_id AS last_author_id,
                  lm.author_given AS last_author_given,
                  (SELECT it.name FROM clinical.treatment_care_team tct
                     JOIN identity.team it ON it.id = tct.team_id
                    WHERE tct.treatment_id = t.id AND tct.removed_at IS NULL
                    ORDER BY it.name LIMIT 1) AS team_name,
                  COALESCE((SELECT count(*)::int FROM clinical.message m
                    WHERE m.thread_id = th.id AND m.author_id <> $1
                      AND m.created_at > COALESCE(tr.last_read_at, 'epoch'::timestamptz)), 0)
                    AS unread
             FROM clinical.treatment t
             LEFT JOIN clinical.message_thread th ON th.treatment_id = t.id
             LEFT JOIN clinical.thread_read tr ON tr.thread_id = th.id AND tr.user_id = $1
             LEFT JOIN LATERAL (
               SELECT m.body, m.created_at, m.author_realm, m.author_id,
                      COALESCE(sa.given_name, pa.given_name) AS author_given
                 FROM clinical.message m
                 LEFT JOIN identity.staff_account sa
                   ON sa.id = m.author_id AND m.author_realm = 'staff'
                 LEFT JOIN identity.patient_account pa
                   ON pa.id = m.author_id AND m.author_realm = 'patient'
                WHERE m.thread_id = th.id ORDER BY m.created_at DESC LIMIT 1
             ) lm ON true
            WHERE t.state <> 'draft' AND t.patient_id = $1
            ORDER BY lm.created_at DESC NULLS LAST, t.name`,
          [patient.userId],
        );
        await writeAccessEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'message_thread.view',
          resourceType: 'message_inbox',
          resourceId: null,
          patientId: patient.userId,
          decision: 'allow',
        });
        return (rows as (Record<string, unknown> & { last_body: MessageDoc | null })[]).map(
          ({ last_body, ...row }) => ({
            ...row,
            last_preview: preview(last_body),
            readOnly: !POSTABLE_STATES.includes(row['state'] as string),
          }),
        );
      },
    );
  }

  /** P6/P14: one thread, messages only - the internal-note table has no
   * patient RLS arm and this path never queries it. */
  async patientThread(patient: PatientPrincipal, treatmentId: string): Promise<object> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const treatment = await this.loadTreatment(client, treatmentId);
        await this.decidePatient(client, patient, treatment, 'view');
        const { rows: messages } = await client.query(
          `SELECT m.id, m.author_id, m.author_realm, m.body, m.created_at::text AS created_at,
                  COALESCE(sa.given_name, pa.given_name) AS author_given,
                  COALESCE(sa.family_name, pa.family_name) AS author_family
             FROM clinical.message m
             JOIN clinical.message_thread th ON th.id = m.thread_id
             LEFT JOIN identity.staff_account sa ON sa.id = m.author_id AND m.author_realm = 'staff'
             LEFT JOIN identity.patient_account pa ON pa.id = m.author_id AND m.author_realm = 'patient'
            WHERE th.treatment_id = $1
            ORDER BY m.created_at`,
          [treatmentId],
        );
        await this.markRead(client, treatmentId, patient.userId);
        return {
          treatment: { id: treatment.id, name: treatment.name, state: treatment.state },
          readOnly: !POSTABLE_STATES.includes(treatment.state),
          items: (messages as object[]).map((row) => ({ kind: 'message' as const, ...row })),
        };
      },
    );
  }

  private async insertMessage(
    client: pg.ClientBase,
    treatment: TreatmentRow,
    author: { userId: string; realm: 'patient' | 'staff' },
    body: unknown,
  ): Promise<{ id: string }> {
    if (!POSTABLE_STATES.includes(treatment.state)) {
      throw new ConflictException({ status: 'thread_read_only' });
    }
    const doc = parseMessageDoc(body);
    if (doc === null) throw new BadRequestException({ status: 'invalid_body' });
    const thread = await this.ensureThread(client, treatment);
    const id = randomUUID();
    await client.query(
      `INSERT INTO clinical.message (id, thread_id, patient_id, author_id, author_realm, body)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, thread.id, treatment.patient_id, author.userId, author.realm, JSON.stringify(doc)],
    );
    // WP-24: attachment references must be the AUTHOR'S own clean,
    // still-unlinked uploads for THIS patient - anything else refuses
    // the whole message. Linking happens here, in the send transaction.
    const attachmentIds = attachmentIdsOf(doc);
    if (attachmentIds.length > 0) {
      const { rowCount } = await client.query(
        `UPDATE clinical.attachment
            SET message_id = $1
          WHERE id = ANY($2) AND uploaded_by = $3 AND patient_id = $4
            AND state = 'clean' AND message_id IS NULL`,
        [id, attachmentIds, author.userId, treatment.patient_id],
      );
      if ((rowCount ?? 0) !== new Set(attachmentIds).size) {
        throw new BadRequestException({ status: 'invalid_attachment' });
      }
    }
    // WP-25 consumes these into the notification centre + contentless
    // email; the payload carries references, never message text
    await client.query(
      `INSERT INTO clinical.notification_outbox (id, kind, treatment_id, patient_id, payload)
       VALUES ($1, 'message.new', $2, $3, $4)`,
      [
        randomUUID(),
        treatment.id,
        treatment.patient_id,
        JSON.stringify({ threadId: thread.id, messageId: id, authorRealm: author.realm }),
      ],
    );
    await writeChangeEvent(client, {
      actorUserId: author.userId,
      actorRealm: author.realm,
      action: 'message.post',
      resourceType: 'message',
      resourceId: id,
      patientId: treatment.patient_id,
      detail: { treatmentId: treatment.id },
    });
    await this.markRead(client, treatment.id, author.userId);
    return { id };
  }

  async staffPost(staff: StaffPrincipal, treatmentId: string, body: unknown): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const treatment = await this.loadTreatment(client, treatmentId);
      const team = await this.teamOf(client, treatmentId);
      await this.decideStaff(client, staff, treatment, 'message_thread', 'post', team);
      return this.insertMessage(client, treatment, { userId: staff.userId, realm: 'staff' }, body);
    });
  }

  async patientPost(
    patient: PatientPrincipal,
    treatmentId: string,
    body: unknown,
  ): Promise<object> {
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const treatment = await this.loadTreatment(client, treatmentId);
        await this.decidePatient(client, patient, treatment, 'post');
        return this.insertMessage(
          client,
          treatment,
          { userId: patient.userId, realm: 'patient' },
          body,
        );
      },
    );
  }

  /** C4's other lane: an internal note into the same timeline, never a
   * notification, never patient-readable - a distinct entity throughout. */
  async staffPostNote(staff: StaffPrincipal, treatmentId: string, body: unknown): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const treatment = await this.loadTreatment(client, treatmentId);
      const team = await this.teamOf(client, treatmentId);
      await this.decideStaff(client, staff, treatment, 'internal_note', 'post', team);
      if (!POSTABLE_STATES.includes(treatment.state)) {
        throw new ConflictException({ status: 'thread_read_only' });
      }
      const doc = parseMessageDoc(body);
      if (doc === null) throw new BadRequestException({ status: 'invalid_body' });
      // WP-24: notes never carry attachments - the attachment read arms
      // are built around messages, and a note-side file would be a
      // patient-invisible clinical artifact with no serving story
      if (attachmentIdsOf(doc).length > 0) {
        throw new BadRequestException({ status: 'no_note_attachments' });
      }
      const thread = await this.ensureThread(client, treatment);
      const id = randomUUID();
      await client.query(
        `INSERT INTO clinical.internal_note (id, thread_id, patient_id, author_id, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, thread.id, treatment.patient_id, staff.userId, JSON.stringify(doc)],
      );
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'internal_note.post',
        resourceType: 'internal_note',
        resourceId: id,
        patientId: treatment.patient_id,
        detail: { treatmentId: treatment.id },
      });
      await this.markRead(client, treatment.id, staff.userId);
      return { id };
    });
  }
}
