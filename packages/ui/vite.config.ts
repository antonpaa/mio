import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The component workbench: `pnpm --filter @mio/ui dev` and browse every
// component in every state. Deliberately zero extra dependencies - it is a
// plain Vite page, and it doubles as the manual-accessibility target.
export default defineConfig({
  root: 'playground',
  plugins: [react(), tailwindcss()],
  server: { port: 5199 },
});
