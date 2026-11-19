#!/usr/bin/env node
// Full W-073 clipping gate (cross-platform env var; Windows-safe): CLIP_GATE_FULL=1 vitest run tests/unit/clip-audit
//
// FAIL-CLOSED: the heavy gate suites use describe.skipIf(!fullGate), and fullGate is false when the GLBs or manifest are
// missing (e.g. an LFS checkout without `git lfs pull`). A plain vitest exit 0 would then report PASS with every heavy
// suite skipped. This wrapper therefore (1) refuses to start if a required asset is missing or is an LFS pointer, and
// (2) fails if vitest reports ANY skipped/todo test in the run.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const IS_WIN = process.platform === 'win32';
const ASSETS = join(process.cwd(), 'public', 'assets');
const REQUIRED = ['models/characters/zombie.glb', 'manifest.cast.json', 'models/objects/chair_creaky.glb', 'models/characters/cast/mascot.glb', 'manifest.premium.json',
  ...['sexton', 'lowside', 'waitress', 'patient', 'fisherman'].flatMap(id => [`models/characters/premium/${id}.glb`, `models/characters/premium/${id}_low.glb`])];

function lfsPointer(p) {
  if (statSync(p).size > 1024) return false;
  const fd = openSync(p, 'r'); const b = Buffer.alloc(64); readSync(fd, b, 0, 64, 0); closeSync(fd);
  return b.toString('utf8').startsWith('version https://git-lfs');
}
const bad = REQUIRED.filter((r) => { const p = join(ASSETS, r); return !existsSync(p) || lfsPointer(p); });
if (bad.length) {
  console.error(`[clip:gate] FAIL: required assets missing or LFS pointers (run \`git lfs pull\`):\n  ${bad.join('\n  ')}`);
  process.exit(2);
}

const OUT = join('dev', 'out', 'clip-gate');
mkdirSync(OUT, { recursive: true });
const report = join(OUT, 'vitest.json');
const r = spawnSync(IS_WIN ? 'npx.cmd' : 'npx', ['vitest', 'run', 'tests/unit/clip-audit', '--reporter=default', '--reporter=json', `--outputFile=${report}`, ...process.argv.slice(2)], {
  stdio: 'inherit', shell: IS_WIN, env: { ...process.env, CLIP_GATE_FULL: '1' },
});
if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);

let j;
try { j = JSON.parse(readFileSync(report, 'utf8')); } catch (e) { console.error(`[clip:gate] FAIL: no vitest JSON report (${e.message})`); process.exit(3); }
const skipped = (j.numPendingTests ?? 0) + (j.numTodoTests ?? 0);
if (!(j.numPassedTests > 0) || skipped > 0) {
  console.error(`[clip:gate] FAIL: ${j.numPassedTests ?? 0} passed, ${skipped} skipped/todo — the full gate must execute every suite`);
  process.exit(4);
}
console.log(`[clip:gate] PASS: ${j.numPassedTests} tests executed, 0 skipped (report ${report})`);
