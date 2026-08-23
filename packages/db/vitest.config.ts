import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // One database, stateful assertions - run files sequentially.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
