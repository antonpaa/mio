import { generateWorld } from './generate.js';
import { seedWorld } from './seed.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  console.error('DATABASE_URL (owner) is required');
  process.exit(1);
}
const profileArg = process.argv.includes('--profile')
  ? process.argv[process.argv.indexOf('--profile') + 1]
  : 'demo';
if (profileArg !== 'demo' && profileArg !== 'perf') {
  console.error(`unknown profile '${profileArg}'`);
  process.exit(1);
}
const seedArg = process.argv.includes('--seed')
  ? Number(process.argv[process.argv.indexOf('--seed') + 1])
  : 42;

const world = generateWorld(profileArg, seedArg);
seedWorld(connectionString, world, (msg) => console.error(msg))
  .then(() => console.error(`seeded '${profileArg}' (seed ${seedArg})`))
  .catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
