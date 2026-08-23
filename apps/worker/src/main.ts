import { createLifecycle } from './lifecycle.js';

const lifecycle = createLifecycle();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void lifecycle.shutdown().then(() => process.exit(0));
  });
}

// Queue consumption arrives with pg-boss in WP-02. Until then the worker
// only proves the deployable exists and shuts down cleanly.
console.log(JSON.stringify({ level: 'info', msg: 'mio worker started', pid: process.pid }));
