import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin API in every environment (ADR-0004); the dev server
      // mirrors that so cookies behave identically.
      '/health': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
});
