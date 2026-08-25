import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateWorld, serializeWorld, SYMPTOMS } from '../src/index.js';

describe('determinism', () => {
  it('same seed, same world - different seed, different world', () => {
    const a = createHash('sha256')
      .update(serializeWorld(generateWorld('demo', 42)))
      .digest('hex');
    const b = createHash('sha256')
      .update(serializeWorld(generateWorld('demo', 42)))
      .digest('hex');
    const c = createHash('sha256')
      .update(serializeWorld(generateWorld('demo', 43)))
      .digest('hex');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('demo world sanity', () => {
  const world = generateWorld('demo', 42);

  it('every patient is enrolled and has a care graph consistent with team membership', () => {
    const treatmentsByPatient = new Map<string, number>();
    for (const treatment of world.treatments) {
      treatmentsByPatient.set(
        treatment.patientId,
        (treatmentsByPatient.get(treatment.patientId) ?? 0) + 1,
      );
    }
    const teamById = new Map(world.teams.map((t) => [t.id, t]));
    for (const patient of world.patients) {
      expect(treatmentsByPatient.get(patient.id) ?? 0).toBeGreaterThan(0);
      const expected = new Set<string>();
      for (const treatment of world.treatments) {
        if (treatment.patientId !== patient.id) continue;
        for (const memberId of teamById.get(treatment.teamId)?.memberIds ?? []) {
          expected.add(memberId);
        }
      }
      expect(new Set(world.careRelationships.get(patient.id))).toEqual(expected);
    }
  });

  it('all three locales appear across people', () => {
    const locales = new Set([...world.patients, ...world.staff].map((p) => p.locale));
    expect(locales).toEqual(new Set(['en', 'fi', 'sv']));
  });

  it('alerts exist at every severity, reference real records, and non-new ones are assigned', () => {
    const severities = new Set(world.alerts.map((a) => a.severity));
    expect(severities).toEqual(new Set(['high', 'moderate', 'low']));
    const responseIds = new Set(world.responses.map((r) => r.id));
    const treatmentIds = new Set(world.treatments.map((t) => t.id));
    const staffIds = new Set(world.staff.map((s) => s.id));
    for (const alert of world.alerts) {
      expect(treatmentIds.has(alert.treatmentId)).toBe(true);
      if (alert.responseId !== undefined) expect(responseIds.has(alert.responseId)).toBe(true);
      if (alert.state !== 'new') expect(staffIds.has(alert.assigneeStaffId ?? '')).toBe(true);
    }
  });

  it('symptom trends produce non-response gaps and on-behalf provenance', () => {
    expect(world.responses.some((r) => r.onBehalfOfStaffId !== undefined)).toBe(true);
    // some weeks skipped: fewer responses than treatments x weeks
    const perTreatment = new Map<string, number>();
    for (const r of world.responses) {
      perTreatment.set(r.treatmentId, (perTreatment.get(r.treatmentId) ?? 0) + 1);
    }
    expect([...perTreatment.values()].some((n) => n < 5)).toBe(true);
    for (const response of world.responses) {
      expect(response.answers).toHaveLength(SYMPTOMS.length);
    }
  });

  it('internal notes are staff-authored only', () => {
    for (const message of world.messages.filter((m) => m.internalNote)) {
      expect(message.authorKind).toBe('staff');
    }
  });
});

describe('role model (2026-08-25 restructure)', () => {
  const world = generateWorld('demo', 42);
  const staffById = new Map(world.staff.map((s) => [s.id, s]));

  it('every staff account holds at least one role, with no duplicates', () => {
    for (const staff of world.staff) {
      expect(staff.roles.length).toBeGreaterThan(0);
      expect(new Set(staff.roles).size).toBe(staff.roles.length);
    }
  });

  it('exactly one auditor, and the auditor role is exclusive', () => {
    const auditors = world.staff.filter((s) => s.roles.includes('auditor'));
    expect(auditors).toHaveLength(1);
    expect(auditors[0]!.roles).toEqual(['auditor']);
  });

  it('the world exercises dual capacity: an administrator who is also a clinician', () => {
    expect(
      world.staff.some((s) => s.roles.includes('administrator') && s.roles.includes('clinician')),
    ).toBe(true);
  });

  it('care teams hold clinicians only - never the auditor or a pure administrator', () => {
    for (const team of world.teams) {
      for (const memberId of team.memberIds) {
        expect(staffById.get(memberId)?.roles ?? []).toContain('clinician');
      }
      for (const leadId of team.leadIds) {
        expect(team.memberIds).toContain(leadId);
        // seeded leads mirror the migration backfill: clinician + author
        expect(staffById.get(leadId)?.roles ?? []).toContain('clinician');
        expect(staffById.get(leadId)?.roles ?? []).toContain('author');
      }
    }
  });
});

describe('synthetic-only PII discipline (E8)', () => {
  const world = generateWorld('demo', 42);

  it('every email lives under the reserved .example TLD', () => {
    for (const person of [...world.patients, ...world.staff]) {
      expect(person.email).toMatch(/@(patient|staff)\.example$/);
    }
  });

  it('phones use the synthetic prefixes only', () => {
    for (const patient of world.patients) {
      expect(patient.phone).toMatch(/^\+(358 40|46 70) \d{7}$/);
    }
  });
});
