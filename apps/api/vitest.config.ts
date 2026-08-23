import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Integration files share one database - never run them in parallel.
    fileParallelism: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
  plugins: [
    // NestJS needs decorator metadata, which esbuild (vitest's default
    // transform) cannot emit - SWC does.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
