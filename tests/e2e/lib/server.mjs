/**
 * Production build + static server for the E2E suite.
 *
 *  - ensureBuild(): reuses dist/ when it is newer than every build input (src/, public/, index.html, vite.config.ts,
 *    package.json, tsconfig.json); otherwise runs `vite build --outDir <dist>` (no type-check: `npm run build` does
 *    that, and other agents' in-progress type errors must not block a browser run).
 *  - startPreview(): `vite preview` on a free 127.0.0.1 port, resolved once the server answers HTTP 200.
 *
 * Everything is spawned through process.execPath + the vite JS entry so it behaves the same on Windows and Linux
 * (no npx.cmd / shell quoting).
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';

const BUILD_INPUTS = ['src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json'];

function newestMtime(p) {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let best = st.mtimeMs;
  for (const name of readdirSync(p)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    best = Math.max(best, newestMtime(path.join(p, name)));
  }
  return best;
}

/** Oldest mtime of the build outputs that matter (index.html + the entry chunks it references). */
function distMtime(distDir) {
  const index = path.join(distDir, 'index.html');
  if (!existsSync(index)) return 0;
  const assets = path.join(distDir, 'assets');
  let oldest = statSync(index).mtimeMs;
  if (existsSync(assets)) {
    for (const name of readdirSync(assets)) {
      if (/^index-.*\.(js|css)$/.test(name)) oldest = Math.min(oldest, statSync(path.join(assets, name)).mtimeMs);
    }
  }
  return oldest;
}

export function viteBin(root) {
  return path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(args[0] ?? cmd)} exited ${code}\n${out.slice(-4000)}`))));
  });
}

/**
 * @param {{ root: string, distDir: string, mode: 'auto' | 'always' | 'never', log: (s: string) => void }} o
 * @returns {Promise<{ built: boolean, ms: number }>}
 */
export async function ensureBuild({ root, distDir, mode, log }) {
  const t0 = Date.now();
  const inputs = Math.max(...BUILD_INPUTS.map((p) => newestMtime(path.join(root, p))));
  const out = distMtime(distDir);
  const fresh = out > 0 && out >= inputs;
  if (mode === 'never' || (mode === 'auto' && fresh)) {
    if (out === 0) throw new Error(`--no-build given but ${distDir} has no build`);
    log(`reusing ${path.relative(root, distDir) || distDir} (${fresh ? 'fresh' : 'STALE — --no-build'})`);
    return { built: false, ms: Date.now() - t0 };
  }
  log(`building production bundle into ${path.relative(root, distDir) || distDir} (${out === 0 ? 'missing' : fresh ? 'forced' : 'stale'})…`);
  await run(process.execPath, [viteBin(root), 'build', '--outDir', distDir, '--emptyOutDir'], { cwd: root, env: { ...process.env, NODE_ENV: 'production' } });
  return { built: true, ms: Date.now() - t0 };
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * @returns {Promise<{ url: string, port: number, stop: () => Promise<void> }>}
 */
export async function startPreview({ root, distDir, log, port: fixedPort }) {
  // `port` pins the origin (oldSave.mjs serves two builds one after the other on the SAME origin, so the browser
  // profile's IndexedDB carries over like a real in-place update). Default: any free port.
  const port = fixedPort ?? (await freePort());
  const child = spawn(process.execPath, [viteBin(root), 'preview', '--outDir', distDir, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  let exited = null;
  child.on('exit', (code) => (exited = code));
  const url = `http://127.0.0.1:${port}/`;
  const end = Date.now() + 30_000;
  while (!(await httpOk(url))) {
    if (exited !== null) throw new Error(`vite preview exited (${exited}):\n${output}`);
    if (Date.now() > end) {
      child.kill();
      throw new Error(`vite preview did not answer on ${url} within 30 s:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  log(`serving ${path.relative(root, distDir) || distDir} at ${url}`);
  const stop = () =>
    new Promise((resolve) => {
      if (exited !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill();
      setTimeout(() => {
        if (exited === null) child.kill('SIGKILL');
        resolve();
      }, 3000).unref();
    });
  return { url, port, stop };
}
