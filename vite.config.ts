import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { buildMetaCsp } from './electron/csp';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Feedback reports (W-110) name the build: short commit SHA (AFTERLIFE_BUILD_SHA overrides) + feature-checklist version. */
function buildSha(): string {
  const env = process.env.AFTERLIFE_BUILD_SHA;
  if (env && /^[A-Za-z0-9._+-]{1,40}$/.test(env)) return env;
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}
function checklistVersion(): string {
  try {
    const reg = JSON.parse(readFileSync(new URL('./docs/verification/features.json', import.meta.url), 'utf8')) as { version?: unknown; features?: unknown[] };
    return `v${Number(reg.version) || 0}-${Array.isArray(reg.features) ? reg.features.length : 0}`;
  } catch {
    return 'unknown';
  }
}

/**
 * The shared-town server this build's town page may connect to (VITE_TOWN_SERVER=wss://host[:port][/path]), as a CSP
 * origin; null when unset. A malformed value stops the build rather than shipping a page that cannot connect.
 */
export function townServerOrigin(value: string | undefined = process.env.VITE_TOWN_SERVER): string | null {
  if (!value) return null;
  const m = /^(wss?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?)(\/[A-Za-z0-9._~/-]*)?$/.exec(value);
  if (!m) throw new Error(`VITE_TOWN_SERVER must look like wss://host[:port][/path], got: ${value}`);
  return m[1].toLowerCase();
}

/**
 * Web-build Content-Security-Policy (docs/SECURITY.md §3): the same policy Electron sends as a header
 * (electron/csp.ts), as a <meta http-equiv> tag right after <meta charset> in the BUILT index.html. Build only —
 * the dev server needs Vite's inline HMR client. scripts/inline-build.mjs later adds the hashes of the
 * single-file build's inline scripts to script-src.
 */
export function cspMetaPlugin(): Plugin {
  return {
    name: 'afterlife-csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx?: { filename?: string }) {
        if (/http-equiv\s*=\s*["']?content-security-policy/i.test(html)) throw new Error('index.html already declares a CSP; keep one source of truth (electron/csp.ts)');
        // Only the shared-town test page may talk to a server, and only to the one named at build time.
        const town = /(^|[\\/])town\.html$/.test(ctx?.filename ?? '') ? townServerOrigin() : null;
        const tag = `<meta http-equiv="Content-Security-Policy" content="${buildMetaCsp(town ? { connect: [town] } : {})}" />`;
        const charset = /<meta\s+charset\s*=\s*["']?utf-8["']?\s*\/?>/i;
        if (charset.test(html)) return html.replace(charset, (m) => `${m}\n    ${tag}`);
        return html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${tag}`);
      },
    },
  };
}

/**
 * Relative base so the same build runs from Electron's app:// protocol, itch.io, a sub-path or any
 * static host. `--mode single` (scripts/inline-build.mjs) produces ONE JS chunk + ONE CSS file so the
 * build can be inlined into a single self-contained HTML file.
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [cspMetaPlugin()],
    define: {
      __AFTERLIFE_VERSION__: JSON.stringify(pkg.version),
      __AFTERLIFE_BUILD__: JSON.stringify(buildSha()),
      __AFTERLIFE_CHECKLIST__: JSON.stringify(checklistVersion()),
    },
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'preact',
    },
    build: {
      target: 'es2022',
      // No PUBLIC source maps in release builds (security review L-3): maps make tampering with the economy code and
      // reading any future endpoint logic trivial. `vite build --mode development` keeps full maps for debugging;
      // AFTERLIFE_SOURCEMAP=hidden emits maps WITHOUT the sourceMappingURL comment (keep them off the web host —
      // for crash symbolication only). The dev server always serves maps.
      sourcemap: mode === 'development' ? true : process.env.AFTERLIFE_SOURCEMAP === 'hidden' && !single ? 'hidden' : false,
      chunkSizeWarningLimit: 2500,
      // MIT/ISC/BSD notices of every BUNDLED dependency (three, preact, ...): minification strips the license
      // comments, so the notices ship as a file next to index.html (also inside the desktop app.asar). Not in a
      // dot-folder: app:// refuses dot-file paths.
      license: { fileName: 'THIRD_PARTY_LICENSES.md' },
      // Imported assets stay files in normal builds (GLBs/audio are fetched by URL); the single-file
      // build inlines small imported assets (fonts, icons) as data: URLs.
      assetsInlineLimit: single ? () => true : 0,
      cssCodeSplit: !single,
      modulePreload: single ? false : { polyfill: true },
      rollupOptions: {
        // the single-file build is the game alone; every other build also carries the shared-town test page
        ...(single ? { output: { inlineDynamicImports: true } } : { input: { main: 'index.html', town: 'town.html' } }),
        onwarn(warning, warn) {
          // src/persistence/semanticRepair.ts loads the engine LAZILY on purpose (persistence must never
          // hard-depend on, or fail to import because of, the engine); GAME imports it statically, so
          // "dynamic import will not move module into another chunk" is the expected outcome, not a defect.
          if (warning.plugin === 'vite:reporter' && /sim[\\/]index\.ts is dynamically imported by [^\n]*persistence[\\/]semanticRepair\.ts/.test(warning.message)) return;
          warn(warning);
        },
      },
    },
    server: { port: 5173, strictPort: true },
  };
});
