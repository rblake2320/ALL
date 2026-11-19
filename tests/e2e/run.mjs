/**
 * Afterlife Lease — real-browser E2E suite runner.
 *
 *   node tests/e2e/run.mjs [--rebuild | --no-build] [--dist=<dir>] [--url=<http://host:port/>] [--out=<dir>] [--headed]
 *
 * 1. Builds the production bundle into dist/ (or reuses it when it is newer than every build input).
 * 2. Serves it with `vite preview` on a free 127.0.0.1 port (skipped with --url).
 * 3. Drives headless Chromium (SwiftShader WebGL2) through tests/e2e/flow.mjs.
 * 4. Prints a pass/fail table, writes <out>/report.json + screenshots, exits 1 on any failure or console error.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness } from './lib/harness.mjs';
import { ensureBuild, startPreview } from './lib/server.mjs';
import { runFlow } from './flow.mjs';

// playwright is a global tool here (not a package dependency): CommonJS resolution honours NODE_PATH, ESM does not.
const require = createRequire(import.meta.url);
/** @type {typeof import('playwright')} */
const { chromium } = loadPlaywright();

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    console.error('Cannot load playwright. Install it globally (npm i -g playwright) or set NODE_PATH to a folder that contains it.');
    throw e;
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const flag = (n) => argv.includes(`--${n}`);
  const opt = (n, d) => {
    const a = argv.find((x) => x.startsWith(`--${n}=`));
    return a ? a.slice(n.length + 3) : d;
  };
  return {
    build: flag('rebuild') ? 'always' : flag('no-build') ? 'never' : 'auto',
    dist: path.resolve(ROOT, opt('dist', process.env.E2E_DIST || 'dist')),
    url: opt('url', process.env.E2E_URL || ''),
    out: path.resolve(ROOT, opt('out', process.env.E2E_OUT || path.join('dev', 'out', 'e2e'))),
    headed: flag('headed'),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const t0 = Date.now();
  const log = (s) => console.log(s);
  mkdirSync(args.out, { recursive: true });
  for (const f of readdirSync(args.out)) if (/\.(png|json)$/.test(f)) rmSync(path.join(args.out, f));
  const h = new Harness({ outDir: args.out, log });
  let server = null;
  let browser = null;
  let fatal = null;
  const meta = { startedAt: new Date().toISOString() };
  try {
    let url = args.url;
    if (!url) {
      const b = await ensureBuild({ root: ROOT, distDir: args.dist, mode: args.build, log });
      meta.buildMs = b.ms;
      meta.built = b.built;
      server = await startPreview({ root: ROOT, distDir: args.dist, log });
      url = server.url;
    }
    meta.url = url;
    // SwiftShader WebGL2 (headless default when no GPU); the flags make it explicit and identical on every host.
    browser = await chromium.launch({ headless: !args.headed, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    meta.browser = browser.version();
    await runFlow({ h, browser, url, viewport: { width: 1280, height: 720 } });
  } catch (e) {
    fatal = e;
    console.error(`\nE2E RUN ABORTED: ${e && e.stack ? e.stack : e}`);
  } finally {
    await browser?.close().catch(() => {});
    await server?.stop().catch(() => {});
  }
  meta.totalMs = Date.now() - t0;
  console.log(`\n${'='.repeat(100)}\n${h.table()}`);
  if (h.errors.length) {
    console.log('\nconsole / page errors:');
    for (const e of h.errors) console.log(`  [${e.step}] ${e.kind}: ${e.text.split('\n')[0].slice(0, 300)}`);
  }
  if (h.allowed.length) {
    console.log('\nallow-listed (justified) messages:');
    for (const e of h.allowed) console.log(`  [${e.step}] ${e.kind}: ${e.text.slice(0, 160)} — ${e.why}`);
  }
  if (h.warnings.size) {
    console.log('\nconsole warnings (not failures):');
    for (const [text, n] of [...h.warnings.entries()].slice(0, 15)) console.log(`  ×${n} ${text}`);
  }
  const ok = !fatal && h.ok;
  h.writeReport({ meta, fatal: fatal ? String(fatal.stack || fatal) : null });
  console.log(`\n${ok ? 'E2E PASSED' : 'E2E FAILED'} in ${(meta.totalMs / 1000).toFixed(1)} s — screenshots + report.json in ${path.relative(ROOT, args.out) || args.out}`);
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
