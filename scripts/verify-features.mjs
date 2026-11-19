#!/usr/bin/env node
// Feature verification run (W-090). See scripts/lib/featureLedger.mjs for the ledger format.
//
//   node scripts/verify-features.mjs              run all built features' tests, record (integration branch), regenerate checklist
//   node scripts/verify-features.mjs --gates      also run typecheck + production build and record them
//   node scripts/verify-features.mjs --check      verify the ledger chain + registry only (fast; CI)
//   node scripts/verify-features.mjs --dry-run    run and print, never write the ledger
//   node scripts/verify-features.mjs --record     record even when not on the integration branch
//   node scripts/verify-features.mjs --force      record even if identical to the last entry
//   node scripts/verify-features.mjs --repair-tail  park a torn last ledger line (never deletes it)
//   node scripts/verify-features.mjs --only a,b   run just these feature ids (never recorded)
//
// Exit codes: 0 all built features pass · 1 a feature fails/regressed/missing proof · 2 ledger/registry broken.
// Recording happens only on the integration branch (ship/final-phase) by default so peers' branches never fork
// the chain; peers run with the default (dry run off-branch) to check their work.

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendEntry, expandTests, featureResults, fileOutcomes, history, readLedger, renderChecklist,
  repairTornTail, sha256, validateRegistry, verifyChain, writeAtomic, STATUS,
} from './lib/featureLedger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REG = path.join(ROOT, 'docs', 'verification', 'features.json');
const LEDGER = path.join(ROOT, 'docs', 'verification', 'ledger.jsonl');
const CHECKLIST = path.join(ROOT, 'docs', 'verification', 'CHECKLIST.md');
const INTEGRATION_BRANCH = 'ship/final-phase';
const IS_WIN = process.platform === 'win32';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const only = (() => {
  const i = args.indexOf('--only');
  return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',')) : null;
})();
const key = process.env.VERIFY_LEDGER_KEY || undefined;

const git = (...a) => {
  try {
    return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

function loadRegistry() {
  const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));
  const problems = validateRegistry(reg);
  if (problems.length) {
    console.error(`features.json is invalid:\n  ${problems.join('\n  ')}`);
    process.exit(2);
  }
  return reg;
}

function npx(cmdArgs) {
  // shell:true on Windows so npx.cmd resolves; args are fixed strings from this file, never user input.
  return spawnSync(IS_WIN ? 'npx.cmd' : 'npx', cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: IS_WIN });
}

function main() {
  if (has('--repair-tail')) {
    const r = repairTornTail(LEDGER);
    console.log(r.repaired ? `Parked torn tail to ${path.relative(ROOT, r.parked)}` : 'No torn tail.');
    return 0;
  }
  const reg = loadRegistry();
  const { entries, tornTail } = readLedger(LEDGER);
  const chain = verifyChain(entries, key);
  if (tornTail !== null) chain.problems.unshift('torn last line (run --repair-tail)');
  if (has('--check')) {
    if (chain.problems.length) {
      console.error(`Ledger BROKEN:\n  ${chain.problems.join('\n  ')}`);
      return 2;
    }
    const seal = key ? `, ${chain.keyed} HMAC-verified` : chain.sealUnverified ? `; WARNING ${chain.sealUnverified} HMAC seals present but NOT verified (set VERIFY_LEDGER_KEY)` : ' (unkeyed hash chain)';
    console.log(`Ledger OK: ${entries.length} entries${seal}; registry OK (${reg.features.length} features).`);
    return 0;
  }

  const features = only ? reg.features.filter((f) => only.has(f.id)) : reg.features;
  const runReg = { ...reg, features };
  const files = [...new Set(features.filter((f) => f.status !== 'planned').flatMap((f) => expandTests(ROOT, f.tests).files))];
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-features-'));
  const reportFile = path.join(scratch, 'vitest.json');
  console.log(`Running ${files.length} test files for ${features.filter((f) => f.status !== 'planned').length} built features…`);
  npx(['vitest', 'run', '--reporter=json', `--outputFile=${reportFile}`, '--reporter=dot', ...files]);
  let report = { testResults: [] };
  try {
    report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  } catch {
    console.error('vitest produced no JSON report — every feature will show as not run.');
  }
  fs.rmSync(scratch, { recursive: true, force: true });

  const gates = {};
  if (has('--gates')) {
    gates.typecheck = npx(['tsc', '--noEmit', '-p', '.']).status === 0 ? 'pass' : 'fail';
    gates.build = npx(['vite', 'build']).status === 0 ? 'pass' : 'fail';
  }

  const results = featureResults(ROOT, runReg, fileOutcomes(ROOT, report));
  const dirtyLines = git('status', '--porcelain').split('\n').filter((l) => l && !l.includes('docs/verification/'));
  const body = {
    ts: new Date().toISOString(),
    commit: git('rev-parse', 'HEAD') || 'unknown',
    branch: git('rev-parse', '--abbrev-ref', 'HEAD') || 'unknown',
    dirty: dirtyLines.length > 0,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    registrySha: sha256(fs.readFileSync(REG, 'utf8')),
    gates,
    results,
  };

  const onIntegration = body.branch === INTEGRATION_BRANCH;
  const record = !has('--dry-run') && !only && (onIntegration || has('--record'));
  let allEntries = entries;
  let latest = { ...body, seq: entries.length + 1 };
  if (record) {
    if (chain.problems.length) {
      console.error(`Ledger BROKEN — not recording:\n  ${chain.problems.join('\n  ')}`);
      return 2;
    }
    const r = appendEntry(LEDGER, body, { key, force: has('--force') });
    allEntries = r.entries;
    latest = r.entry;
    console.log(r.appended ? `Recorded run #${r.entry.seq}.` : `Identical to run #${r.entry.seq}; nothing new recorded.`);
  } else {
    console.log(`Dry run (branch ${body.branch}${only ? ', --only' : ''}): ledger not written.`);
  }
  const hist = history(record ? allEntries : entries.concat([latest]), results);
  const after = verifyChain(allEntries, key);
  if (record) writeAtomic(CHECKLIST, renderChecklist(reg, latest, hist, { ...after, entries: allEntries.length }));

  let bad = 0;
  for (const f of features) {
    const r = results[f.id];
    if (r.status === STATUS.PLANNED) continue;
    const h = hist[f.id];
    const tag = h.regressed ? 'REGRESSED' : r.status.toUpperCase();
    if (r.status !== STATUS.PASS) bad++;
    console.log(`${tag.padEnd(9)} ${f.id.padEnd(22)} ${r.passed ?? 0} passed, ${r.failed ?? 0} failed${h.regressed ? ` (last good ${h.lastGood.commit.slice(0, 7)})` : ''}`);
    for (const m of r.failures ?? []) console.log(`          ↳ ${m}`);
    for (const m of [...(r.missing ?? []), ...(r.notRun ?? [])]) console.log(`          ↳ missing/not run: ${m}`);
  }
  for (const [g, v] of Object.entries(gates)) {
    console.log(`${v.toUpperCase().padEnd(9)} gate:${g}`);
    if (v !== 'pass') bad++;
  }
  console.log(bad ? `\n${bad} feature(s)/gate(s) not passing.` : '\nAll built features pass.');
  return bad ? 1 : 0;
}

process.exitCode = main();
