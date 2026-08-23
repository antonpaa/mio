import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/** Change events: who changed what. References only - detail carries state
 * names and ids, never clinical content (docs/architecture/data-model.md). */
export interface ChangeEventInput {
  actorUserId: string | null;
  actorRealm: 'patient' | 'staff' | 'system';
  action: string;
  resourceType: string;
  resourceId: string | null;
  patientId: string | null;
  detail?: object;
}

export async function writeChangeEvent(
  client: pg.ClientBase,
  event: ChangeEventInput,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO audit.change_event (id, actor_user_id, actor_realm, action, resource_type, resource_id, patient_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      event.actorUserId,
      event.actorRealm,
      event.action,
      event.resourceType,
      event.resourceId,
      event.patientId,
      JSON.stringify(event.detail ?? {}),
    ],
  );
  return id;
}
