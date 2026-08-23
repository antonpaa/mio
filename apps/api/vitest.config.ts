import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
  plugins: [
    // NestJS needs decorator metadata, which esbuild (vitest's default
    // transform) cannot emit - SWC does.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
