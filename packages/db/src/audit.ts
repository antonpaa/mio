import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/**
 * The same-transaction audit hook (ADR-0006): the Cedar decision point
 * returns an access-event row; the caller writes it on the SAME client, in
 * the SAME transaction, as the access it permits - allow and deny alike.
 *
 * Structurally identical to @mio/authz's AccessEventRow, joined by
 * structural typing on purpose: @mio/db stays free of authz concerns and
 * vice versa.
 */
export interface AccessEventInput {
  actorUserId: string | null;
  actorRealm: 'patient' | 'staff' | 'system';
  action: string;
  resourceType: string;
  resourceId: string | null;
  patientId: string | null;
  decision: 'allow' | 'deny';
  context?: object;
}

export async function writeAccessEvent(
  client: pg.ClientBase,
  event: AccessEventInput,
): Promise<string> {
  // The id is generated HERE, not via RETURNING: app roles hold INSERT on
  // audit tables and nothing else, and RETURNING requires SELECT.
  const id = randomUUID();
  await client.query(
    `INSERT INTO audit.access_event
       (id, actor_user_id, actor_realm, action, resource_type, resource_id, patient_id, decision, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      event.actorUserId,
      event.actorRealm,
      event.action,
      event.resourceType,
      event.resourceId,
      event.patientId,
      event.decision,
      JSON.stringify(event.context ?? {}),
    ],
  );
  return id;
}
