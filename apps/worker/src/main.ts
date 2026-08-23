import { createJobBus, createRolePool } from '@mio/db';
import { createLifecycle } from './lifecycle.js';

const lifecycle = createLifecycle();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void lifecycle.shutdown().then(() => process.exit(0));
  });
}

const log = (level: 'info' | 'error', msg: string): void => {
  console.error(JSON.stringify({ level, msg, pid: process.pid }));
};

async function main(): Promise<void> {
  const connectionString = process.env['MIO_DATABASE_URL'];
  if (!connectionString) {
    // Deployable exists before its database does (WP-01 ordering); the real
    // deployment always provides MIO_DATABASE_URL.
    log('info', 'mio worker started without MIO_DATABASE_URL - idle');
    return;
  }

  const pool = createRolePool({ connectionString, role: 'mio_worker' });
  const boss = await createJobBus({ pool });
  lifecycle.onStop(async () => {
    await boss.stop({ graceful: true });
    await pool.end();
  });
  log('info', 'mio worker started, job bus running');
}

main().catch((error) => {
  log('error', `worker failed to start: ${String(error)}`);
  process.exit(1);
});
