import type { SyntheticWorld } from './world.js';

/** Canonical collection view - one shape for fixtures, seeds and tests. */
export function worldCollections(world: SyntheticWorld): Record<string, object[]> {
  return {
    patients: world.patients,
    staff: world.staff,
    teams: world.teams,
    treatments: world.treatments,
    care_relationships: [...world.careRelationships.entries()].map(([patientId, staffIds]) => ({
      patientId,
      staffIds,
    })),
    responses: world.responses,
    alerts: world.alerts,
    messages: world.messages,
    values: world.values,
    tasks: world.tasks,
  };
}

export function serializeWorld(world: SyntheticWorld): string {
  const collections = worldCollections(world);
  return Object.entries(collections)
    .map(([name, rows]) => `# ${name}\n` + rows.map((row) => JSON.stringify(row)).join('\n'))
    .join('\n');
}
