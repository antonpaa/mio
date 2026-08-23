/**
 * Deterministic PRNG (mulberry32). Same seed, same world - reproducible
 * bugs, reproducible benchmarks, and fixtures that diff cleanly.
 */

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick from empty array');
  return item;
}

export function pickWeighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  const last = entries[entries.length - 1];
  if (!last) throw new Error('pickWeighted from empty array');
  return last[0];
}

export function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function sample<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0] as T);
  }
  return out;
}

/** Deterministic uuid-shaped id from a namespace + counter - NOT random. */
export function syntheticId(namespace: string, n: number): string {
  const ns = namespace.padEnd(8, '0').slice(0, 8);
  const hex = ns
    .split('')
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
  const tail = n.toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-${tail}`;
}
