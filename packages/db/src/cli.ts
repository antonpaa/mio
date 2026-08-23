import { migrate } from './migrate.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

migrate(connectionString, { log: (msg) => console.error(msg) })
  .then((result) => {
    console.error(
      `migrations: ${result.applied.length} applied, ${result.alreadyApplied} already in place`,
    );
  })
  .catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
