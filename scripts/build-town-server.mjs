#!/usr/bin/env node
/**
 * Bundle the shared-town server (server/main.ts and everything it imports, the WebSocket library included) into ONE
 * file, dist-server/town-server.mjs, that plain Node runs with nothing installed next to it.
 *
 *   node scripts/build-town-server.mjs
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'dist-server', 'town-server.mjs');
mkdirSync(path.dirname(outfile), { recursive: true });
await build({
  entryPoints: [path.join(root, 'server', 'main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // the WebSocket library is CommonJS and calls require() for Node's own modules
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  // optional native speed-ups of the WebSocket library; it runs without them
  external: ['bufferutil', 'utf-8-validate'],
  legalComments: 'inline',
  logLevel: 'warning',
});
console.log(`[town-server] built ${path.relative(root, outfile)}`);
