import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateWorld } from './generate.js';
import { worldCollections } from './serialize.js';

/**
 * Write a generated world as JSONL fixtures (gitignored - fixtures are
 * derived artifacts; the seed is the source).
 *
 *   pnpm --filter @mio/synthetic generate -- --profile demo --seed 42
 */

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

const profile = arg('profile', 'demo');
if (profile !== 'demo' && profile !== 'perf') {
  console.error(`Unknown profile '${profile}' - use demo or perf`);
  process.exit(1);
}
const seed = Number(arg('seed', '42'));
const outDir = arg('out', path.join('.synthetic', `${profile}-${seed}`));

const started = performance.now();
const world = generateWorld(profile, seed);
mkdirSync(outDir, { recursive: true });

const collections = worldCollections(world);

for (const [name, rows] of Object.entries(collections)) {
  const file = path.join(outDir, `${name}.jsonl`);
  writeFileSync(
    file,
    rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''),
  );
  console.error(`${name}: ${rows.length}`);
}
console.error(
  `world '${profile}' seed ${seed} written to ${outDir} in ${Math.round(performance.now() - started)}ms`,
);
