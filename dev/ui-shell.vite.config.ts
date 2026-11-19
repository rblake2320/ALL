/**
 * UI-SHELL dev harness server (dev only):
 *   npx vite --config dev/ui-shell.vite.config.ts      → http://localhost:5177/dev/ui-shell.html
 *   UI_SHELL_HMR=0 npx vite --config dev/ui-shell.vite.config.ts   (no live reload — for scripted runs)
 * Aliases App.tsx's `./hud/Hud` import to a harness switch (stub HUD by default, `?hud=real` loads UI-HUD).
 */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root,
  base: '/',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  // UI_SHELL_HMR=0 disables live reload: automated screenshot/a11y runs must not be reloaded mid-test when other
  // modules edit shared files in this tree.
  server: { port: 5177, strictPort: true, open: false, hmr: process.env.UI_SHELL_HMR === '0' ? false : undefined },
  plugins: [
    {
      name: 'ui-shell-hud-switch',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === './hud/Hud' && importer && importer.replace(/\\/g, '/').endsWith('/src/ui/App.tsx')) {
          return path.resolve(root, 'src/ui/shell/dev/HudSwitch.tsx');
        }
        return null;
      },
    },
  ],
});
