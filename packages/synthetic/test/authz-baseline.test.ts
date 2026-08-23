import { describe, expect, it } from 'vitest';
import { authorize } from '@mio/authz/engine';
import { generateWorld } from '../src/index.js';
import { createRng, pick } from '../src/random.js';

/**
 * The 20k-patient authorization baseline docs/architecture/authorization.md
 * commits to: the hot path must be measured against a realistic dataset
 * before launch, not discovered in production. This is that measurement,
 * running on every CI push - with a deliberately generous floor so it
 * catches catastrophic regressions, never noisy neighbors.
 */

describe('authz at 20k patients', () => {
  it('roster-scale decisions stay correct and fast enough', () => {
    const world = generateWorld('perf', 7);
    const rng = createRng(1234);
    const staffIds = new Set(world.staff.map((s) => s.id));

    interface Case {
      staffId: string;
      patient: (typeof world.patients)[number];
      careTeam: string[];
      expected: 'allow' | 'deny';
    }
    const cases: Case[] = [];
    while (cases.length < 400) {
      const patient = pick(rng, world.patients);
      const careTeam = world.careRelationships.get(patient.id) ?? [];
      if (careTeam.length === 0) continue;
      // one insider, one outsider per sampled patient
      cases.push({ staffId: pick(rng, careTeam), patient, careTeam, expected: 'allow' });
      let outsider = pick(rng, [...staffIds]);
      while (careTeam.includes(outsider)) outsider = pick(rng, [...staffIds]);
      cases.push({ staffId: outsider, patient, careTeam, expected: 'deny' });
    }

    const started = performance.now();
    let wrong = 0;
    for (const testCase of cases) {
      const result = authorize({
        principal: { userId: testCase.staffId, role: 'treatment_member' },
        action: 'view',
        resource: {
          type: 'patient_clinical_profile',
          id: `profile-${testCase.patient.id}`,
          patientId: testCase.patient.id,
          careTeamUserIds: testCase.careTeam,
        },
      });
      if (result.decision !== testCase.expected) wrong += 1;
    }
    const elapsed = performance.now() - started;
    const perSecond = Math.round((cases.length / elapsed) * 1000);

    console.error(
      `[authz-baseline] ${cases.length} decisions in ${Math.round(elapsed)}ms ` +
        `(${perSecond}/s, care teams up to ${Math.max(...cases.map((c) => c.careTeam.length))} members)`,
    );

    expect(wrong).toBe(0);
    // Floor, not a target: catches an accidental O(world) slip, tolerates CI.
    expect(perSecond).toBeGreaterThan(200);
  });
});
