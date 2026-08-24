import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type pg from 'pg';
import { authorize } from '@mio/authz/engine';
import { withUserContext, writeAccessEvent, writeChangeEvent } from '@mio/db';
import { sniffImageMime, type ObjectStorage } from '@mio/storage';
import { APP_POOL } from '../../shared/db.module.js';
import { OBJECT_STORAGE } from '../../shared/storage.module.js';
import type { PatientPrincipal } from '../../shared/patient-session.js';
import type { StaffPrincipal } from '../../shared/staff-session.js';

/**
 * WP-24: quarantine -> sniff -> scan -> promote. The sniff happens HERE,
 * at the door - bytes that are not one of the served image types never
 * reach storage at all. Everything that enters waits in quarantine until
 * the worker's scanner promotes it; serving happens only from 'clean',
 * through this API, after a Cedar decision and an audit row. The bytes'
 * type is always the sniffed one - the declared name is metadata.
 */

const MAX_BYTES = 5 * 1024 * 1024;

interface UploadInput {
  filename?: string;
  dataBase64?: string;
}

interface AttachmentRow {
  id: string;
  patient_id: string;
  treatment_id: string;
  state: 'quarantined' | 'clean' | 'rejected';
  sniffed_mime: string;
  filename: string;
  size_bytes: number;
  storage_key: string;
  uploaded_by: string;
}

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(APP_POOL) private readonly pool: pg.Pool,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private decode(input: UploadInput): { bytes: Buffer; mime: string; filename: string } {
    const filename = (input.filename ?? '').trim().slice(0, 200) || 'image';
    if (typeof input.dataBase64 !== 'string' || input.dataBase64.length === 0) {
      throw new BadRequestException({ status: 'data_required' });
    }
    // 4/3 expansion plus slack; refuse before decoding anything huge
    if (input.dataBase64.length > MAX_BYTES * 1.4) {
      throw new BadRequestException({ status: 'too_large' });
    }
    const bytes = Buffer.from(input.dataBase64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      throw new BadRequestException({ status: 'too_large' });
    }
    const mime = sniffImageMime(bytes);
    if (mime === null) {
      throw new UnsupportedMediaTypeException({ status: 'unsupported_type' });
    }
    return { bytes, mime, filename };
  }

  private async persist(
    client: pg.ClientBase,
    row: {
      patientId: string;
      treatmentId: string;
      filename: string;
      declaredMime: string;
      mime: string;
      size: number;
      uploadedBy: string;
      realm: 'patient' | 'staff';
    },
    bytes: Buffer,
  ): Promise<{ attachmentId: string; state: string }> {
    const attachmentId = randomUUID();
    const storageKey = `attachments/${attachmentId}`;
    await this.storage.put(storageKey, bytes, row.mime);
    await client.query(
      `INSERT INTO clinical.attachment
         (id, patient_id, treatment_id, filename, declared_mime, sniffed_mime,
          size_bytes, storage_key, uploaded_by, uploaded_realm)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        attachmentId,
        row.patientId,
        row.treatmentId,
        row.filename,
        row.declaredMime,
        row.mime,
        row.size,
        storageKey,
        row.uploadedBy,
        row.realm,
      ],
    );
    await writeChangeEvent(client, {
      actorUserId: row.uploadedBy,
      actorRealm: row.realm,
      action: 'attachment.upload',
      resourceType: 'attachment',
      resourceId: attachmentId,
      patientId: row.patientId,
      detail: { mime: row.mime, size: row.size },
    });
    // no job enqueue: the worker's scan sweep POLLS quarantined rows
    // (the WP-17 sweep pattern) - a missed message can never strand a
    // row in quarantine
    return { attachmentId, state: 'quarantined' };
  }

  async uploadAsPatient(
    patient: PatientPrincipal,
    input: UploadInput & { treatmentId?: string },
  ): Promise<object> {
    const { bytes, mime, filename } = this.decode(input);
    if (!input.treatmentId) throw new BadRequestException({ status: 'treatment_required' });
    return withUserContext(
      this.pool,
      { userId: patient.userId, realm: 'patient' },
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM clinical.treatment WHERE id = $1 AND patient_id = $2`,
          [input.treatmentId, patient.userId],
        );
        if (rows.length === 0) throw new NotFoundException({ status: 'unknown_treatment' });
        const decision = authorize({
          principal: { userId: patient.userId, role: 'patient' },
          action: 'upload',
          resource: {
            type: 'attachment',
            id: 'new',
            patientId: patient.userId,
            subjectUserId: patient.userId,
          },
        }).decision;
        await writeAccessEvent(client, {
          actorUserId: patient.userId,
          actorRealm: 'patient',
          action: 'attachment.upload',
          resourceType: 'attachment',
          resourceId: null,
          patientId: patient.userId,
          decision,
        });
        if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
        return this.persist(
          client,
          {
            patientId: patient.userId,
            treatmentId: input.treatmentId!,
            filename,
            declaredMime: 'application/octet-stream',
            mime,
            size: bytes.length,
            uploadedBy: patient.userId,
            realm: 'patient',
          },
          bytes,
        );
      },
    );
  }

  async uploadAsStaff(
    staff: StaffPrincipal,
    input: UploadInput & { treatmentId?: string },
  ): Promise<object> {
    const { bytes, mime, filename } = this.decode(input);
    if (!input.treatmentId) throw new BadRequestException({ status: 'treatment_required' });
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows } = await client.query<{ id: string; patient_id: string }>(
        `SELECT id, patient_id FROM clinical.treatment WHERE id = $1`,
        [input.treatmentId],
      );
      const treatment = rows[0];
      if (!treatment) throw new NotFoundException({ status: 'unknown_treatment' });
      const decision = authorize({
        principal: { userId: staff.userId, role: staff.role },
        action: 'upload',
        resource: {
          type: 'attachment',
          id: 'new',
          patientId: treatment.patient_id,
          teamUserIds: [staff.userId],
        },
      }).decision;
      await writeAccessEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'attachment.upload',
        resourceType: 'attachment',
        resourceId: null,
        patientId: treatment.patient_id,
        decision,
      });
      if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
      return this.persist(
        client,
        {
          patientId: treatment.patient_id,
          treatmentId: treatment.id,
          filename,
          declaredMime: 'application/octet-stream',
          mime,
          size: bytes.length,
          uploadedBy: staff.userId,
          realm: 'staff',
        },
        bytes,
      );
    });
  }

  /**
   * Serve or report state. RLS scopes the row to the caller first; the
   * Cedar decision and its access event follow the matrix
   * (attachment.download, audit always). Clean rows stream bytes with
   * the SNIFFED type and hostile-content headers; a quarantined row
   * answers its state to the uploader; rejected answers 410.
   */
  async fetch(
    principal: {
      userId: string;
      role: 'patient' | 'treatment_member' | 'treatment_lead' | 'administrator' | 'auditor';
      realm: 'patient' | 'staff';
    },
    attachmentId: string,
  ): Promise<
    | { kind: 'bytes'; bytes: Uint8Array; mime: string; filename: string }
    | { kind: 'state'; state: string }
  > {
    return withUserContext(
      this.pool,
      { userId: principal.userId, realm: principal.realm },
      async (client) => {
        const { rows } = await client.query<AttachmentRow>(
          `SELECT id, patient_id, treatment_id, state, sniffed_mime, filename,
                  size_bytes, storage_key, uploaded_by
             FROM clinical.attachment WHERE id = $1`,
          [attachmentId],
        );
        const row = rows[0];
        if (!row) throw new NotFoundException({ status: 'unknown_attachment' });
        const decision = authorize({
          principal: { userId: principal.userId, role: principal.role },
          action: 'download',
          resource: {
            type: 'attachment',
            id: row.id,
            patientId: row.patient_id,
            ...(principal.realm === 'patient'
              ? { subjectUserId: principal.userId }
              : { careTeamUserIds: [principal.userId] }),
          },
        }).decision;
        await writeAccessEvent(client, {
          actorUserId: principal.userId,
          actorRealm: principal.realm,
          action: 'attachment.download',
          resourceType: 'attachment',
          resourceId: row.id,
          patientId: row.patient_id,
          decision,
        });
        if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
        if (row.state !== 'clean') return { kind: 'state', state: row.state };
        const bytes = await this.storage.get(row.storage_key);
        if (bytes === null) throw new NotFoundException({ status: 'missing_bytes' });
        return { kind: 'bytes', bytes, mime: row.sniffed_mime, filename: row.filename };
      },
    );
  }
}
