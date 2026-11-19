#!/usr/bin/env node
/**
 * Compile the Electron main/preload TypeScript (electron/tsconfig.json) into electron/dist.
 *
 *  1. wipe electron/dist (no stale modules can survive a rename)
 *  2. tsc -p electron/tsconfig.json   (CommonJS, noEmitOnError)
 *  3. write electron/dist/package.json {"type":"commonjs"} — the repo root is "type":"module", and
 *     without this marker Node/Electron would parse the CommonJS output as ESM
 *  4. verify the sandbox contract: preload.js may require ONLY 'electron' (a sandboxed preload
 *     cannot load local files); main.js/preload.js must exist
 *
 * Cross-platform (no shell): spawns tsc through process.execPath. Usage: node scripts/build-electron-main.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Return every module id passed to require("...") in CommonJS source. */
export function requiredModules(source) {
  const ids = [];
  const re = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(source)) !== null) ids.push(m[2]);
  return ids;
}

export function checkPreload(source) {
  const bad = requiredModules(source).filter((id) => id !== 'electron');
  if (bad.length > 0) {
    return `preload.js requires ${bad.map((b) => JSON.stringify(b)).join(', ')} — a sandboxed preload may only require('electron'). Use \`import type\` for local types.`;
  }
  if (/\bimport\s*\(|^\s*import\s/m.test(source)) return 'preload.js contains ESM import syntax; it must be CommonJS';
  return null;
}

export function build({ projectRoot = root, log = console.log } = {}) {
  const outDir = join(projectRoot, 'electron', 'dist');
  rmSync(outDir, { recursive: true, force: true });
  const require = createRequire(join(projectRoot, 'package.json'));
  const tsc = require.resolve('typescript/bin/tsc');
  log(`[electron] compiling electron/*.ts -> electron/dist`);
  const r = spawnSync(process.execPath, [tsc, '-p', join(projectRoot, 'electron', 'tsconfig.json')], { stdio: 'inherit', cwd: projectRoot });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`tsc failed with exit code ${r.status}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs', private: true }, null, 2) + '\n');
  for (const f of ['main.js', 'preload.js', 'fileStore.js']) {
    if (!existsSync(join(outDir, f))) throw new Error(`expected output electron/dist/${f} is missing`);
  }
  const problem = checkPreload(readFileSync(join(outDir, 'preload.js'), 'utf8'));
  if (problem) throw new Error(problem);
  log('[electron] main + preload built; preload sandbox check passed');
  return outDir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    build();
  } catch (e) {
    console.error(`[electron] build failed: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1; // not process.exit(): let piped output drain
  }
}
