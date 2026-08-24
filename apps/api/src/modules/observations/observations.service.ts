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
import { APP_POOL } from '../../shared/db.module.js';
import type { StaffPrincipal } from '../../shared/staff-session.js';

/**
 * Observations (WP-21, docs/architecture/observations.md): value series
 * with provenance-bearing entries (PP2) and the taxonomy-coded symptom
 * register (PP3). Provenance is columns and always rendered; trends are
 * DISPLAY DERIVATION by the documented deterministic rules below, never
 * stored clinical judgement. Interpretation against program rules is the
 * rule engine's job (WP-22), not this module's.
 */

type ValueTrend = 'rising' | 'falling' | 'stable' | null;

/** Documented rule: over the latest three numeric entries, in
 * chronological order strictly monotone => rising/falling, else stable;
 * fewer than two entries or a marker series => no label. */
export function valueTrendOf(kind: string, latestFirst: number[]): ValueTrend {
  if (kind !== 'numeric' || latestFirst.length < 2) return null;
  const chronological = latestFirst.slice(0, 3).reverse();
  const up = chronological.every((value, index) =>
    index === 0 ? true : value > chronological[index - 1]!,
  );
  const down = chronological.every((value, index) =>
    index === 0 ? true : value < chronological[index - 1]!,
  );
  return up ? 'rising' : down ? 'falling' : 'stable';
}

type SymptomTrend = 'new' | 'worsening' | 'stable' | 'easing';
const GRADE_RANK: Record<string, number> = { mild: 1, moderate: 2, severe: 3 };

/** Documented rule: one observation => new; otherwise compare the two
 * latest grades - higher => worsening, lower => easing, equal => stable. */
export function symptomTrendOf(latestGrades: string[]): SymptomTrend {
  if (latestGrades.length < 2) return 'new';
  const [now, before] = latestGrades;
  const a = GRADE_RANK[now ?? ''] ?? 0;
  const b = GRADE_RANK[before ?? ''] ?? 0;
  return a > b ? 'worsening' : a < b ? 'easing' : 'stable';
}

@Injectable()
export class ObservationsService {
  constructor(@Inject(APP_POOL) private readonly pool: pg.Pool) {}

  private async decideOnPatient(
    client: pg.ClientBase,
    staff: StaffPrincipal,
    patientId: string,
    resourceType: 'value_entry' | 'symptom_observation',
    action: 'view' | 'create',
    resourceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM clinical.care_relationship cr
        WHERE cr.patient_id = $1 AND cr.staff_id = $2 AND cr.ended_at IS NULL`,
      [patientId, staff.userId],
    );
    // out-of-care staff get the same 404 as an unknown patient id
    if (rows.length === 0) throw new NotFoundException({ status: 'unknown_patient' });
    const decision = authorize({
      principal: { userId: staff.userId, role: staff.role },
      action,
      resource: {
        type: resourceType,
        id: resourceId,
        patientId,
        careTeamUserIds: [staff.userId],
      },
    });
    await writeAccessEvent(client, {
      actorUserId: staff.userId,
      actorRealm: 'staff',
      action: `${resourceType}.${action}`,
      resourceType,
      resourceId,
      patientId,
      decision: decision.decision,
    });
    if (decision.decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
  }

  /** PP2 summary: the patient's series (from their programs' templates,
   * plus any series that already has entries), latest three entries each,
   * with the derived trend label. */
  async valuesSummary(staff: StaffPrincipal, patientId: string): Promise<object[]> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideOnPatient(client, staff, patientId, 'value_entry', 'view', 'summary');
      const { rows: series } = await client.query(
        `SELECT DISTINCT s.id, s.key, s.name, s.unit, s.kind
           FROM clinical.value_series s
          WHERE EXISTS (
              SELECT 1 FROM clinical.template_value_series tvs
              JOIN clinical.treatment_template_version tv ON tv.template_id = tvs.template_id
              JOIN clinical.treatment t
                ON t.template_version_id = tv.id AND t.patient_id = $1
                   AND t.state = 'active'
             WHERE tvs.series_id = s.id)
             OR EXISTS (
              SELECT 1 FROM clinical.value_entry e
             WHERE e.series_id = s.id AND e.patient_id = $1)
          ORDER BY s.name`,
        [patientId],
      );
      const out: object[] = [];
      for (const row of series as {
        id: string;
        key: string;
        name: string;
        unit: string;
        kind: string;
      }[]) {
        const { rows: latest } = await client.query(
          `SELECT e.id, e.value, e.measured_at::text AS measured_at, e.note,
                  e.on_behalf_of_patient,
                  s.given_name AS entered_given, s.family_name AS entered_family
             FROM clinical.value_entry e
             LEFT JOIN identity.staff_account s
               ON s.id = e.entered_by AND e.on_behalf_of_patient
            WHERE e.patient_id = $1 AND e.series_id = $2
            ORDER BY e.measured_at DESC, e.created_at DESC
            LIMIT 3`,
          [patientId, row.id],
        );
        const numbers = (latest as { value: string | number | null }[])
          .map((entry) => (entry.value === null ? null : Number(entry.value)))
          .filter((value): value is number => value !== null);
        out.push({ ...row, latest, trend: valueTrendOf(row.kind, numbers) });
      }
      return out;
    });
  }

  /** PP2 series page: 12 months of entries for the chart plus the full
   * record table with provenance and notes. */
  async seriesDetail(staff: StaffPrincipal, patientId: string, seriesId: string): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideOnPatient(client, staff, patientId, 'value_entry', 'view', seriesId);
      const { rows: seriesRows } = await client.query(
        `SELECT id, key, name, unit, kind FROM clinical.value_series WHERE id = $1`,
        [seriesId],
      );
      const series = seriesRows[0];
      if (!series) throw new NotFoundException({ status: 'unknown_series' });
      const { rows: entries } = await client.query(
        `SELECT e.id, e.value, e.measured_at::text AS measured_at, e.note,
                e.on_behalf_of_patient, e.created_at::text AS created_at,
                s.given_name AS entered_given, s.family_name AS entered_family,
                p.given_name AS patient_given, p.family_name AS patient_family
           FROM clinical.value_entry e
           LEFT JOIN identity.staff_account s
             ON s.id = e.entered_by AND e.on_behalf_of_patient
           LEFT JOIN identity.patient_account p
             ON p.id = e.entered_by AND NOT e.on_behalf_of_patient
          WHERE e.patient_id = $1 AND e.series_id = $2
          ORDER BY e.measured_at DESC, e.created_at DESC
          LIMIT 200`,
        [patientId, seriesId],
      );
      return { series, entries };
    });
  }

  /** "New value" - clinician on-behalf entry, provenance recorded. */
  async createValue(
    staff: StaffPrincipal,
    patientId: string,
    seriesId: string,
    input: { value?: number; measuredAt?: string; note?: string },
  ): Promise<{ entryId: string }> {
    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
      throw new BadRequestException({ status: 'value_required' });
    }
    if (typeof input.measuredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.measuredAt)) {
      throw new BadRequestException({ status: 'measured_at_required' });
    }
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideOnPatient(client, staff, patientId, 'value_entry', 'create', seriesId);
      const entryId = randomUUID();
      const inserted = await client.query(
        `INSERT INTO clinical.value_entry
           (id, series_id, patient_id, value, measured_at, note, entered_by, on_behalf_of_patient)
         SELECT $1, s.id, $3, $4, $5, $6, $7, true
           FROM clinical.value_series s WHERE s.id = $2`,
        [
          entryId,
          seriesId,
          patientId,
          input.value,
          input.measuredAt,
          input.note?.trim() ?? '',
          staff.userId,
        ],
      );
      if (inserted.rowCount === 0) throw new NotFoundException({ status: 'unknown_series' });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'value_entry.create',
        resourceType: 'value_entry',
        resourceId: entryId,
        patientId,
        detail: { seriesId, onBehalf: true },
      });
      return { entryId };
    });
  }

  /** PP3: the symptom register - per-symptom latest observation, derived
   * trend, and the recent history that backs it. */
  async symptomRegister(staff: StaffPrincipal, patientId: string): Promise<object> {
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideOnPatient(
        client,
        staff,
        patientId,
        'symptom_observation',
        'view',
        'register',
      );
      const { rows } = await client.query(
        `SELECT o.id, o.severity, o.detail, o.observed_at::text AS observed_at, o.source,
                o.on_behalf_of_patient, o.survey_response_id,
                y.id AS symptom_id, y.code, y.label_en, y.label_fi, y.label_sv,
                s.given_name AS entered_given, s.family_name AS entered_family
           FROM clinical.symptom_observation o
           JOIN clinical.symptom y ON y.id = o.symptom_id
           LEFT JOIN identity.staff_account s
             ON s.id = o.entered_by AND o.on_behalf_of_patient
          WHERE o.patient_id = $1
          ORDER BY y.code, o.observed_at DESC, o.created_at DESC`,
        [patientId],
      );
      const bySymptom = new Map<string, Record<string, unknown>[]>();
      for (const row of rows as Record<string, unknown>[]) {
        const code = row['code'] as string;
        const list = bySymptom.get(code) ?? [];
        list.push(row);
        bySymptom.set(code, list);
      }
      const register = [...bySymptom.entries()].map(([code, observations]) => ({
        code,
        symptomId: observations[0]!['symptom_id'],
        labels: {
          en: observations[0]!['label_en'],
          fi: observations[0]!['label_fi'],
          sv: observations[0]!['label_sv'],
        },
        latest: observations[0],
        trend: symptomTrendOf(observations.map((entry) => entry['severity'] as string)),
        recent: observations.slice(0, 6),
        count: observations.length,
      }));
      register.sort((a, b) =>
        String(b.latest!['observed_at']).localeCompare(String(a.latest!['observed_at'])),
      );
      const { rows: taxonomy } = await client.query(
        `SELECT id, code, label_en, label_fi, label_sv FROM clinical.symptom
          WHERE active ORDER BY label_en`,
      );
      return { register, taxonomy };
    });
  }

  /** "Report a symptom" - clinician on-behalf observation. */
  async createObservation(
    staff: StaffPrincipal,
    patientId: string,
    input: { symptomId?: string; severity?: string; note?: string; observedAt?: string },
  ): Promise<{ observationId: string }> {
    if (!input.symptomId) throw new BadRequestException({ status: 'symptom_required' });
    if (!['mild', 'moderate', 'severe'].includes(input.severity ?? '')) {
      throw new BadRequestException({ status: 'severity_required' });
    }
    const observedAt = input.observedAt ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observedAt)) {
      throw new BadRequestException({ status: 'bad_date' });
    }
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      await this.decideOnPatient(
        client,
        staff,
        patientId,
        'symptom_observation',
        'create',
        input.symptomId ?? '',
      );
      const observationId = randomUUID();
      const inserted = await client.query(
        `INSERT INTO clinical.symptom_observation
           (id, patient_id, symptom_id, severity, detail, observed_at,
            source, entered_by, on_behalf_of_patient)
         SELECT $1, $2, y.id, $4, $5, $6, 'clinician', $7, true
           FROM clinical.symptom y WHERE y.id = $3 AND y.active`,
        [
          observationId,
          patientId,
          input.symptomId,
          input.severity,
          JSON.stringify(input.note?.trim() ? { note: input.note.trim() } : {}),
          observedAt,
          staff.userId,
        ],
      );
      if (inserted.rowCount === 0) throw new NotFoundException({ status: 'unknown_symptom' });
      await writeChangeEvent(client, {
        actorUserId: staff.userId,
        actorRealm: 'staff',
        action: 'symptom_observation.create',
        resourceType: 'symptom_observation',
        resourceId: observationId,
        patientId,
        detail: { onBehalf: true },
      });
      return { observationId };
    });
  }

  /** X8: series definitions for the builder's binding select. Reference
   * data - matrix says staff any, audit never. */
  async seriesCatalog(staff: StaffPrincipal): Promise<object[]> {
    const decision = authorize({
      principal: { userId: staff.userId, role: staff.role },
      action: 'view',
      resource: { type: 'value_series', id: 'catalog' },
    }).decision;
    if (decision !== 'allow') throw new ForbiddenException({ status: 'forbidden' });
    return withUserContext(this.pool, { userId: staff.userId, realm: 'staff' }, async (client) => {
      const { rows } = await client.query(
        `SELECT id, key, name, unit, kind FROM clinical.value_series ORDER BY name`,
      );
      return rows as object[];
    });
  }
}
