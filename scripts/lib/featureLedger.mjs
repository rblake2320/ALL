// Feature verification ledger (W-090).
//
// Purpose: a durable record of WHAT was built, WHICH tests prove it, and WHETHER it passed at each verified
// commit — so a feature that once worked and later broke is flagged as REGRESSED with its last-good commit.
//
// Ledger file: docs/verification/ledger.jsonl, one JSON entry per line, hash-chained:
//   hash = sha256(canonical(entry without hash/mac)),  entry.prevHash = previous entry's hash (genesis = 64×"0").
//   Optional keyed seal: if VERIFY_LEDGER_KEY is set, mac = HMAC-SHA256(key, hash). Without a key the chain
//   detects edits, deletions, reordering and truncation, but anyone can re-hash a forged chain; the key (kept
//   out of the repo) is what makes forgery detectable. verify reports which mode each entry used.
//
// Crash safety: appends rewrite the whole file to <file>.tmp-<pid>, fsync, rename (atomic on NTFS and POSIX).
// Concurrency: an exclusive lock file (<file>.lock, O_EXCL) with stale-lock takeover after LOCK_STALE_MS.
// Fault barrier: append refuses to extend a broken chain; repairTornTail parks the bad tail (never deletes).

import { createHash, createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const GENESIS = '0'.repeat(64);
/** How far a feature is proven: Node tests only → real browser → target device/store → live production. */
export const PROOF_LEVELS = Object.freeze(['unit', 'e2e', 'device', 'prod']);
export const LOCK_STALE_MS = 10 * 60 * 1000;
export const STATUS = Object.freeze({ PASS: 'pass', FAIL: 'fail', MISSING: 'missing', PLANNED: 'planned', NO_TESTS: 'no-tests' });

/** Deterministic JSON: object keys sorted recursively; arrays keep order. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonical: non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

export function hashEntry(entry) {
  const { hash: _h, mac: _m, ...body } = entry;
  return sha256(canonical(body));
}

export function sealEntry(body, prevHash, key) {
  const entry = { ...body, prevHash };
  entry.hash = hashEntry(entry);
  if (key) entry.mac = createHmac('sha256', key).update(entry.hash).digest('hex');
  return entry;
}

/** Validate the registry shape. Returns a list of problems (empty = valid). */
export function validateRegistry(reg) {
  const problems = [];
  if (!reg || typeof reg !== 'object' || !Array.isArray(reg.features)) return ['registry: missing features[]'];
  const seen = new Set();
  for (const [i, f] of reg.features.entries()) {
    const where = `features[${i}]`;
    if (!f || typeof f.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(f.id)) problems.push(`${where}: bad id`);
    else if (seen.has(f.id)) problems.push(`${where}: duplicate id ${f.id}`);
    else seen.add(f.id);
    if (typeof f.name !== 'string' || !f.name.trim()) problems.push(`${where}: missing name`);
    if (f.proof !== undefined && !PROOF_LEVELS.includes(f.proof)) problems.push(`${where}: proof must be one of ${PROOF_LEVELS.join('/')}`);
    if (f.online !== undefined && typeof f.online !== 'boolean') problems.push(`${where}: online must be boolean`);
    // Real-browser proof scripts (tests/e2e/*.mjs) are listed separately: they are run by CI / the Spark2 runner,
    // not by this vitest-based verifier, so they never count as "missing" here — but they must exist.
    if (f.e2e !== undefined) {
      if (!Array.isArray(f.e2e) || f.e2e.some((t) => typeof t !== 'string' || !/^tests\/e2e\/[A-Za-z0-9_.-]+\.mjs$/.test(t)))
        problems.push(`${where}: e2e must list tests/e2e/*.mjs scripts`);
      if (f.status === 'planned') problems.push(`${where}: planned feature cannot list e2e proof`);
    }
    if (f.status === 'planned') {
      if (f.tests && f.tests.length) problems.push(`${where}: planned feature must not list tests (mark it built)`);
      if (f.proof) problems.push(`${where}: planned feature cannot claim proof level ${f.proof}`);
    } else if (!Array.isArray(f.tests) || f.tests.length === 0) {
      problems.push(`${where}: built feature ${f.id} lists no tests — every built feature needs proof`);
    } else {
      for (const t of f.tests) {
        if (typeof t !== 'string' || path.isAbsolute(t) || t.split(/[\\/]/).includes('..'))
          problems.push(`${where}: unsafe test path ${JSON.stringify(t)}`);
      }
    }
  }
  return problems;
}

const toPosix = (p) => p.split(path.sep).join('/');

/** Expand a feature's test paths (files or directories) to repo-relative *.test.ts files that exist. */
export function expandTests(root, tests) {
  const files = [];
  const missing = [];
  for (const t of tests) {
    const abs = path.join(root, t);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      missing.push(t);
      continue;
    }
    if (st.isDirectory()) {
      const found = [];
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith('.test.ts')) found.push(toPosix(path.relative(root, p)));
        }
      };
      walk(abs);
      if (found.length === 0) missing.push(t);
      files.push(...found);
    } else files.push(toPosix(t));
  }
  return { files: [...new Set(files)], missing };
}

/**
 * Turn a vitest JSON report into per-file outcomes keyed by repo-relative path.
 * A file whose suite failed to load (no assertions, status failed) counts as failed.
 */
export function fileOutcomes(root, report) {
  const out = new Map();
  for (const r of report?.testResults ?? []) {
    const rel = toPosix(path.relative(root, r.name));
    let passed = 0, failed = 0, skipped = 0;
    const failures = [];
    for (const a of r.assertionResults ?? []) {
      if (a.status === 'passed') passed++;
      else if (a.status === 'failed') {
        failed++;
        if (failures.length < 5) failures.push(String(a.fullName ?? a.title).slice(0, 200));
      } else skipped++;
    }
    if (r.status === 'failed' && failed === 0) {
      failed = 1;
      failures.push(`suite failed to run: ${String(r.message ?? '').split('\n')[0].slice(0, 200)}`);
    }
    out.set(rel, { passed, failed, skipped, failures });
  }
  return out;
}

/** Compute each feature's result for this run. */
export function featureResults(root, reg, outcomes) {
  const results = {};
  for (const f of reg.features) {
    if (f.status === 'planned') {
      results[f.id] = { status: STATUS.PLANNED };
      continue;
    }
    const { files, missing } = expandTests(root, f.tests);
    let passed = 0, failed = 0, skipped = 0;
    const failures = [];
    const notRun = [];
    for (const file of files) {
      const o = outcomes.get(file);
      if (!o) {
        notRun.push(file);
        continue;
      }
      passed += o.passed;
      failed += o.failed;
      skipped += o.skipped;
      for (const m of o.failures) if (failures.length < 5) failures.push(`${file}: ${m}`);
    }
    let status;
    if (failed > 0) status = STATUS.FAIL;
    else if (missing.length > 0 || notRun.length > 0) status = STATUS.MISSING;
    else if (passed === 0) status = STATUS.NO_TESTS;
    else status = STATUS.PASS;
    results[f.id] = { status, passed, failed, skipped, files: files.length, ...(missing.length ? { missing } : {}), ...(notRun.length ? { notRun } : {}), ...(failures.length ? { failures } : {}) };
  }
  return results;
}

/**
 * Compare this run with the ledger history. A feature is REGRESSED when it passed in an earlier entry and does
 * not pass now; `lastGood` names the most recent passing entry. `firstVerified` is the first passing entry.
 */
export function history(entries, results) {
  const out = {};
  for (const [id, r] of Object.entries(results)) {
    let firstVerified = null;
    let lastGood = null;
    for (const e of entries) {
      if (e.results?.[id]?.status === STATUS.PASS) {
        if (!firstVerified) firstVerified = { seq: e.seq, commit: e.commit, ts: e.ts };
        lastGood = { seq: e.seq, commit: e.commit, ts: e.ts };
      }
    }
    const regressed = r.status !== STATUS.PASS && r.status !== STATUS.PLANNED && lastGood !== null;
    out[id] = { firstVerified, lastGood, regressed };
  }
  return out;
}

/** Parse ledger text. Returns {entries, tornTail} — a final line that is not valid JSON is a torn tail. */
export function parseLedger(text) {
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const entries = [];
  let tornTail = null;
  for (let i = 0; i < lines.length; i++) {
    try {
      entries.push(JSON.parse(lines[i]));
    } catch {
      if (i === lines.length - 1) tornTail = lines[i];
      else throw new Error(`ledger line ${i + 1} is not JSON (mid-file corruption; not a torn tail)`);
    }
  }
  return { entries, tornTail };
}

/** Verify the chain. Returns {ok, problems[], keyed: count of entries with a verified mac}. */
export function verifyChain(entries, key) {
  const problems = [];
  let prev = GENESIS;
  let keyed = 0;
  let sealUnverified = 0;
  entries.forEach((e, i) => {
    const n = i + 1;
    if (e.seq !== n) problems.push(`entry ${n}: seq ${e.seq} (expected ${n}) — deleted or reordered entries`);
    if (e.prevHash !== prev) problems.push(`entry ${n}: prevHash does not match entry ${n - 1} — chain broken`);
    const h = hashEntry(e);
    if (h !== e.hash) problems.push(`entry ${n}: content does not match its hash — edited after sealing`);
    if (key) {
      if (!e.mac) problems.push(`entry ${n}: no HMAC seal but a key is configured`);
      else if (createHmac('sha256', key).update(e.hash ?? '').digest('hex') !== e.mac) problems.push(`entry ${n}: HMAC seal invalid — forged or wrong key`);
      else keyed++;
    } else if (e.mac !== undefined) {
      // A sealed entry checked without the key: the hash chain is verified, the seal is NOT. Never report this as
      // a verified seal (Luna's W-091 review): callers must surface `sealUnverified` instead of a plain OK.
      sealUnverified++;
    }
    prev = e.hash;
  });
  return { ok: problems.length === 0, problems, keyed, sealUnverified };
}

export function readLedger(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return parseLedger(text);
}

/** Atomic write: tmp + fsync + rename; directory fsync where supported. */
export function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
  try {
    const dfd = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch { /* Windows cannot fsync a directory; rename is still atomic there */ }
}

/** Exclusive cross-process lock. Returns a release function. Throws if held by a live, non-stale owner. */
export function acquireLock(file, { now = Date.now(), staleMs = LOCK_STALE_MS } = {}) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: now }));
      fs.closeSync(fd);
      return () => { try { fs.unlinkSync(lock); } catch { /* released already */ } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let info = null;
      try { info = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { /* unreadable lock = stale */ }
      const stale = !info || typeof info.at !== 'number' || now - info.at > staleMs;
      if (!stale || attempt === 1) throw new Error(`ledger is locked by pid ${info?.pid ?? '?'} (${lock}); another verify run is in progress`);
      try { fs.unlinkSync(lock); } catch { /* raced with another taker */ }
    }
  }
  throw new Error('unreachable');
}

/**
 * Append one entry. Idempotent: if the last entry has the same commit, clean tree and identical results,
 * nothing is written (returns {appended:false}). Refuses on a broken chain or torn tail (fault barrier).
 */
export function appendEntry(file, body, { key, force = false } = {}) {
  const release = acquireLock(file);
  try {
    const { entries, tornTail } = readLedger(file);
    if (tornTail !== null) throw new Error('ledger has a torn last line; run with --repair-tail first (it parks the bad line)');
    const v = verifyChain(entries, key);
    if (!v.ok) throw new Error(`ledger chain is broken — refusing to append:\n  ${v.problems.join('\n  ')}`);
    const last = entries[entries.length - 1];
    if (!force && last && last.commit === body.commit && !last.dirty && !body.dirty && canonical(last.results) === canonical(body.results)) {
      return { appended: false, entry: last, entries };
    }
    const entry = sealEntry({ ...body, seq: entries.length + 1 }, last ? last.hash : GENESIS, key);
    const text = [...entries, entry].map((e) => JSON.stringify(e)).join('\n') + '\n';
    writeAtomic(file, text);
    return { appended: true, entry, entries: [...entries, entry] };
  } finally {
    release();
  }
}

/** Move a torn last line into <file>.torn-<ts>.jsonl (parked, never deleted) and rewrite the valid prefix. */
export function repairTornTail(file, now = Date.now()) {
  const release = acquireLock(file);
  try {
    const { entries, tornTail } = readLedger(file);
    if (tornTail === null) return { repaired: false };
    const parked = `${file}.torn-${now}.jsonl`;
    writeAtomic(parked, tornTail + '\n');
    writeAtomic(file, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
    return { repaired: true, parked };
  } finally {
    release();
  }
}

const ICON = { pass: '✅', fail: '❌', missing: '⚠️', 'no-tests': '⚠️', planned: '⬜' };

/** Render the human checklist from the registry + latest entry + history (grouped by area, with proof level). */
export function renderChecklist(reg, entry, hist, chain) {
  const counts = { pass: 0, fail: 0, missing: 0, 'no-tests': 0, planned: 0, regressed: 0, online: 0, onlineDone: 0 };
  const proofCounts = { unit: 0, e2e: 0, device: 0, prod: 0 };
  const groups = new Map();
  for (const f of reg.features) {
    const area = f.area ?? 'other';
    if (!groups.has(area)) groups.set(area, []);
    const r = entry?.results?.[f.id] ?? { status: f.status === 'planned' ? 'planned' : 'missing' };
    const h = hist?.[f.id] ?? {};
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (h.regressed) counts.regressed++;
    if (f.online) { counts.online++; if (r.status === 'pass') counts.onlineDone++; }
    if (r.status === 'pass' && f.proof) proofCounts[f.proof]++;
    const box = r.status === 'pass' ? '[x]' : '[ ]';
    let note;
    if (h.regressed) note = `**REGRESSED** — last passed at \`${h.lastGood.commit.slice(0, 7)}\` (${h.lastGood.ts.slice(0, 10)})`;
    else if (r.status === 'pass') note = `${r.passed} tests passed in ${r.files} files`;
    else if (r.status === 'fail') note = `${r.failed} failing`;
    else if (r.status === 'missing') note = `test files missing/not run: ${[...(r.missing ?? []), ...(r.notRun ?? [])].slice(0, 3).join(', ')}`;
    else if (r.status === 'no-tests') note = 'no test cases ran';
    else note = f.online ? 'not built — needs the backend' : 'not built yet';
    const proof = r.status === 'pass' ? (f.proof ?? 'unit') : '—';
    const first = h.firstVerified ? `\`${h.firstVerified.commit.slice(0, 7)}\` ${h.firstVerified.ts.slice(0, 10)}` : '—';
    const rows = groups.get(area);
    const e2eNote = Array.isArray(f.e2e) && f.e2e.length ? ` · browser: ${f.e2e.map((t) => `\`${t.split('/').pop()}\``).join(', ')}` : '';
    rows.push(`| ${box} ${ICON[r.status] ?? ''} | ${f.name}${f.online ? ' 🌐' : ''} | ${f.work ?? ''} | ${proof} | ${first} | ${note}${e2eNote} |`);
    if (r.failures?.length) for (const m of r.failures.slice(0, 3)) rows.push(`|  |  ↳ \`${m.replace(/\|/g, '\\|')}\` |  |  |  |  |`);
  }
  const head = entry
    ? `Last verified run: **#${entry.seq}** at \`${entry.commit.slice(0, 7)}\`${entry.dirty ? ' (uncommitted changes)' : ''} on ${entry.ts} — Node ${entry.node}, ${entry.platform}.`
    : 'No verified run recorded yet.';
  const gates = entry?.gates && Object.keys(entry.gates).length
    ? `\nBuild gates: ${Object.entries(entry.gates).map(([k, v]) => `${k} ${v === 'pass' ? '✅' : v === 'skipped' ? '⏭️' : '❌'}`).join(' · ')}\n`
    : '';
  const total = reg.features.length;
  const sections = [...groups.entries()].map(([area, rows]) => `### ${area}\n\n| Done | Requirement | Work item | Proof | First verified | Status |\n|---|---|---|---|---|---|\n${rows.join('\n')}`).join('\n\n');
  return `# Master checklist — every requirement, whether it is done, and how it is proven

<!-- GENERATED by scripts/verify-features.mjs from docs/verification/features.json + ledger.jsonl. Do not edit by hand. -->

${head}
Ledger: ${chain.ok ? `chain intact (${chain.entries} entries${chain.keyed ? `, ${chain.keyed} HMAC-verified` : ', unkeyed hashes'}${chain.sealUnverified ? `; **${chain.sealUnverified} HMAC seals NOT verified (no key supplied)**` : ''})` : `**BROKEN** — ${chain.problems[0]}`}.
${gates}
**${counts.pass} of ${total} requirements verified · ${counts.fail} failing · ${counts.regressed} regressed · ${counts.missing + counts['no-tests']} missing proof · ${counts.planned} not built**

Proof strength of the verified ones: **${proofCounts.unit} unit-only** (Node tests, no real browser) · **${proofCounts.e2e} e2e** (also driven in a real browser) · **${proofCounts.device} device** · **${proofCounts.prod} production**.
Online (🌐 needs the backend, which does not exist yet): **${counts.onlineDone} of ${counts.online} done**.

${sections}

Legend: ✅ verified at this commit · ❌ tests failing · ⚠️ proof missing · ⬜ not built · 🌐 needs the online backend.
Proof: unit = logic/asset tests in Node · e2e = real browser via tests/e2e · device = target hardware/store · prod = live.
REGRESSED = passed in an earlier recorded run and does not pass now; fix before merging (TEAM_PLAN CI rule).

How to run (Windows PowerShell or bash):

\`\`\`
npm run verify:features            # run every built feature's tests, record, regenerate this file
npm run verify:features -- --gates # also typecheck + production build
npm run verify:features -- --check # verify the ledger chain only (CI)
\`\`\`
`;
}
