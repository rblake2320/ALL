#!/usr/bin/env node
/**
 * Desktop dev loop (cross-platform; PowerShell users can also run scripts/dev-electron.ps1):
 *   1. compile electron/ (scripts/build-electron-main.mjs)
 *   2. start the Vite dev server (or reuse one already listening on the port)
 *   3. launch Electron with ELECTRON_RENDERER_URL pointing at it (honoured only when unpackaged)
 *   4. when Electron exits, stop the dev server we started and exit with Electron's code
 *
 * Usage: node scripts/dev-electron.mjs [--port 5173] [--no-vite]
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build-electron-main.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = Number(portArg >= 0 ? args[portArg + 1] : process.env.AFTERLIFE_DEV_PORT || 5173);
const url = `http://localhost:${port}/`;

async function responds(target) {
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(target, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await responds(target)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function electronBinary() {
  try {
    return require('electron'); // the npm package exports the path of the downloaded binary
  } catch (e) {
    console.error('[dev] Electron binary is missing. Run `npm install` (without ELECTRON_SKIP_BINARY_DOWNLOAD) to download it.');
    console.error(`[dev] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

async function run() {
  build();
  let vite = null;
  if (!args.includes('--no-vite') && !(await responds(url))) {
    console.log(`[dev] starting Vite on ${url}`);
    vite = spawn(process.execPath, [require.resolve('vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: 'inherit' });
    vite.on('exit', (code) => {
      if (code !== null && code !== 0) console.error(`[dev] Vite exited with ${code}`);
    });
  }
  if (!(await waitFor(url, 60_000))) {
    vite?.kill();
    throw new Error(`dev server did not respond at ${url}`);
  }
  const electron = spawn(electronBinary(), ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RENDERER_URL: url, ELECTRON_ENABLE_LOGGING: '1' },
  });
  const stop = () => {
    if (!electron.killed) electron.kill();
    if (vite && !vite.killed) vite.kill();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  electron.on('exit', (code) => {
    if (vite && !vite.killed) vite.kill();
    process.exit(code ?? 0);
  });
}

run().catch((e) => {
  console.error(`[dev] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
