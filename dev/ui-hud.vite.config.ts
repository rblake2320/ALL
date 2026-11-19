/**
 * UI-HUD dev harness server (dev only):
 *   npx vite --config dev/ui-hud.vite.config.ts            → http://localhost:5178/dev/ui-hud.html?mode=live
 *   HUD_HMR=0 npx vite --config dev/ui-hud.vite.config.ts   (no live reload — for scripted screenshot / e2e runs,
 *   so edits other modules make in this tree never reload a page mid-check)
 */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root,
  base: '/',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  server: { port: 5178, strictPort: true, open: false, hmr: process.env.HUD_HMR === '0' ? false : undefined },
});
