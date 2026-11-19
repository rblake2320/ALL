// W-090 feature ledger: adversarial suite. Proves the checklist can be trusted to say "this worked at commit X
// and is broken now": chain tamper detection, regression detection, crash safety, locking, idempotency, and
// that the real registry maps every built feature to test files that exist.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(__dirname, '../../..');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let L: Any;
let dir: string;
let ledger: string;

const body = (commit: string, results: Any, extra: Any = {}) => ({
  ts: '2026-11-05T00:00:00.000Z', commit, branch: 'ship/final-phase', dirty: false, node: 'v22', platform: 'linux-x64',
  registrySha: 'r', gates: {}, results, ...extra,
});
const pass = { status: 'pass', passed: 3, failed: 0, skipped: 0, files: 1 };
const fail = { status: 'fail', passed: 2, failed: 1, skipped: 0, files: 1, failures: ['x.test.ts: boom'] };
const lines = () => fs.readFileSync(ledger, 'utf8').trimEnd().split('\n');
const rewrite = (ls: string[]) => fs.writeFileSync(ledger, ls.join('\n') + '\n');

beforeEach(async () => {
  L = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/featureLedger.mjs')).href);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  ledger = path.join(dir, 'ledger.jsonl');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('canonical hashing', () => {
  it('key order never changes the hash; values do', () => {
    expect(L.canonical({ b: 1, a: { d: [2, 1], c: null } })).toBe(L.canonical({ a: { c: null, d: [2, 1] }, b: 1 }));
    expect(L.canonical({ a: [1, 2] })).not.toBe(L.canonical({ a: [2, 1] }));
    expect(() => L.canonical({ a: Number.NaN })).toThrow();
    expect(L.canonical({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('hash chain: every kind of tampering is detected', () => {
  beforeEach(() => {
    L.appendEntry(ledger, body('c1', { f: pass }));
    L.appendEntry(ledger, body('c2', { f: pass }));
    L.appendEntry(ledger, body('c3', { f: fail }));
  });
  it('an intact ledger verifies', () => {
    const { entries } = L.readLedger(ledger);
    expect(entries.map((e: Any) => e.seq)).toEqual([1, 2, 3]);
    expect(L.verifyChain(entries).ok).toBe(true);
  });
  it('editing a past result (fail → pass) is detected', () => {
    const ls = lines();
    rewrite([ls[0], ls[1], ls[2].replace('"status":"fail"', '"status":"pass"')]);
    const v = L.verifyChain(L.readLedger(ledger).entries);
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toMatch(/edited after sealing/);
  });
  it('deleting a middle entry is detected', () => {
    const ls = lines();
    rewrite([ls[0], ls[2]]);
    expect(L.verifyChain(L.readLedger(ledger).entries).problems.join()).toMatch(/deleted or reordered|chain broken/);
  });
  it('reordering entries is detected', () => {
    const ls = lines();
    rewrite([ls[1], ls[0], ls[2]]);
    expect(L.verifyChain(L.readLedger(ledger).entries).ok).toBe(false);
  });
  it('a re-hashed forgery passes the unkeyed chain but fails the HMAC seal', () => {
    fs.rmSync(ledger);
    L.appendEntry(ledger, body('c1', { f: fail }), { key: 'k' });
    const { entries } = L.readLedger(ledger);
    const forged = L.sealEntry({ ...entries[0], results: { f: pass }, hash: undefined, mac: undefined, prevHash: undefined }, L.GENESIS);
    rewrite([JSON.stringify(forged)]);
    expect(L.verifyChain(L.readLedger(ledger).entries).ok).toBe(true); // documented limit of unkeyed mode
    const keyed = L.verifyChain(L.readLedger(ledger).entries, 'k');
    expect(keyed.ok).toBe(false);
    expect(keyed.problems.join()).toMatch(/no HMAC seal/);
    expect(L.verifyChain(entries, 'wrong').problems.join()).toMatch(/HMAC seal invalid/);
    expect(L.verifyChain(entries, 'k')).toMatchObject({ ok: true, keyed: 1, sealUnverified: 0 });
    // Luna (W-091 review): a sealed entry checked WITHOUT the key must say its seal is unverified, never a silent OK.
    const noKey = L.verifyChain(entries);
    expect(noKey).toMatchObject({ ok: true, keyed: 0, sealUnverified: 1 });
    const md = L.renderChecklist({ features: [] }, null, {}, { ...noKey, entries: 1 });
    expect(md).toMatch(/1 HMAC seals NOT verified \(no key supplied\)/);
  });
  it('append refuses to extend a broken chain (fault barrier) and leaves the file untouched', () => {
    const ls = lines();
    rewrite([ls[0], ls[2]]);
    const before = fs.readFileSync(ledger, 'utf8');
    expect(() => L.appendEntry(ledger, body('c4', { f: pass }))).toThrow(/chain is broken/);
    expect(fs.readFileSync(ledger, 'utf8')).toBe(before);
  });
});

describe('crash safety', () => {
  it('a torn last line (crash mid-write by an older tool) blocks appends until parked; nothing is deleted', () => {
    L.appendEntry(ledger, body('c1', { f: pass }));
    fs.appendFileSync(ledger, '{"seq":2,"commit":"c2","res');
    expect(L.readLedger(ledger).tornTail).toContain('"seq":2');
    expect(() => L.appendEntry(ledger, body('c2', { f: pass }))).toThrow(/torn last line/);
    const r = L.repairTornTail(ledger, 123);
    expect(r.repaired).toBe(true);
    expect(fs.readFileSync(r.parked, 'utf8')).toContain('"seq":2');
    expect(L.appendEntry(ledger, body('c2', { f: pass })).appended).toBe(true);
    expect(L.verifyChain(L.readLedger(ledger).entries).ok).toBe(true);
  });
  it('corruption in the middle is not mistaken for a torn tail', () => {
    L.appendEntry(ledger, body('c1', { f: pass }));
    L.appendEntry(ledger, body('c2', { f: pass }));
    const ls = lines();
    rewrite(['garbage', ls[1]]);
    expect(() => L.readLedger(ledger)).toThrow(/mid-file corruption/);
  });
  it('atomic write leaves no temp files behind and replaces content whole', () => {
    L.writeAtomic(ledger, 'a\n');
    L.writeAtomic(ledger, 'b\n');
    expect(fs.readFileSync(ledger, 'utf8')).toBe('b\n');
    expect(fs.readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });
});

describe('locking + idempotency', () => {
  it('a second concurrent run is refused while the lock is fresh', () => {
    const release = L.acquireLock(ledger);
    expect(() => L.appendEntry(ledger, body('c1', { f: pass }))).toThrow(/locked/);
    release();
    expect(L.appendEntry(ledger, body('c1', { f: pass })).appended).toBe(true);
    expect(fs.existsSync(`${ledger}.lock`)).toBe(false);
  });
  it('a stale or unreadable lock (crashed run) is taken over', () => {
    fs.writeFileSync(`${ledger}.lock`, JSON.stringify({ pid: 999999, at: Date.now() - L.LOCK_STALE_MS - 1 }));
    expect(L.appendEntry(ledger, body('c1', { f: pass })).appended).toBe(true);
    fs.writeFileSync(`${ledger}.lock`, 'not json');
    expect(L.appendEntry(ledger, body('c2', { f: pass })).appended).toBe(true);
  });
  it('re-running the same clean commit with the same results records nothing; a change or --force does', () => {
    expect(L.appendEntry(ledger, body('c1', { f: pass })).appended).toBe(true);
    expect(L.appendEntry(ledger, body('c1', { f: pass })).appended).toBe(false);
    expect(L.appendEntry(ledger, body('c1', { f: pass }), { force: true }).appended).toBe(true);
    expect(L.appendEntry(ledger, body('c1', { f: fail })).appended).toBe(true);
    expect(L.appendEntry(ledger, body('c1', { f: fail }, { dirty: true })).appended).toBe(true); // dirty never dedups
    expect(L.readLedger(ledger).entries).toHaveLength(4);
  });
});

describe('regression detection', () => {
  it('worked → broke is REGRESSED with the last-good commit; never-passed is not', () => {
    const entries = [
      { seq: 1, commit: 'aaa1111', ts: '2026-11-01T00:00:00Z', results: { a: pass, b: fail } },
      { seq: 2, commit: 'bbb2222', ts: '2026-11-02T00:00:00Z', results: { a: pass, b: fail } },
      { seq: 3, commit: 'ccc3333', ts: '2026-11-03T00:00:00Z', results: { a: fail, b: fail, p: { status: 'planned' } } },
    ];
    const h = L.history(entries, entries[2].results);
    expect(h.a).toMatchObject({ regressed: true, lastGood: { commit: 'bbb2222' }, firstVerified: { commit: 'aaa1111' } });
    expect(h.b.regressed).toBe(false);
    expect(h.p.regressed).toBe(false);
  });
  it('deleted proof (test files removed) after a pass also counts as REGRESSED', () => {
    const entries = [{ seq: 1, commit: 'a', ts: 't', results: { a: pass } }, { seq: 2, commit: 'b', ts: 't', results: { a: { status: 'missing' } } }];
    expect(L.history(entries, entries[1].results).a.regressed).toBe(true);
  });
});

describe('mapping vitest results to features', () => {
  const report = (files: Record<string, Any>, root = ROOT) => ({
    testResults: Object.entries(files).map(([name, v]) => ({ name: path.join(root, name), ...v })),
  });
  it('a suite that fails to load counts as failed, not as zero tests', () => {
    const out = L.fileOutcomes(ROOT, report({ 'tests/unit/x.test.ts': { status: 'failed', message: 'SyntaxError: nope', assertionResults: [] } }));
    expect(out.get('tests/unit/x.test.ts')).toMatchObject({ failed: 1 });
    expect(out.get('tests/unit/x.test.ts').failures[0]).toMatch(/failed to run: SyntaxError/);
  });
  it('fail beats missing; missing beats pass; skipped-only is no-tests', () => {
    // A directory result must not depend on what other tests happen to live in this repository.
    const fixture = path.join(dir, 'tests/unit/verification');
    fs.mkdirSync(fixture, { recursive: true });
    fs.writeFileSync(path.join(fixture, 'featureLedger.test.ts'), '// fixture');
    const reg = { features: [
      { id: 'f1', name: 'n', tests: ['tests/unit/verification/featureLedger.test.ts', 'tests/unit/nope.test.ts'] },
      { id: 'f2', name: 'n', tests: ['tests/unit/verification/featureLedger.test.ts'] },
      { id: 'f3', name: 'n', tests: ['tests/unit/verification'] },
      { id: 'f4', name: 'n', status: 'planned' },
    ] };
    const mk = (a: Any[]) => L.fileOutcomes(dir, report({ 'tests/unit/verification/featureLedger.test.ts': { status: 'passed', assertionResults: a } }, dir));
    let r = L.featureResults(dir, reg, mk([{ status: 'passed' }, { status: 'failed', fullName: 'boom' }]));
    expect(r.f1.status).toBe('fail');
    r = L.featureResults(dir, reg, mk([{ status: 'passed' }]));
    expect(r.f1).toMatchObject({ status: 'missing', missing: ['tests/unit/nope.test.ts'] });
    expect(r.f2.status).toBe('pass');
    expect(r.f3.status).toBe('pass');
    expect(r.f4.status).toBe('planned');
    r = L.featureResults(dir, reg, mk([{ status: 'skipped' }]));
    expect(r.f2.status).toBe('no-tests');
    r = L.featureResults(dir, reg, new Map());
    expect(r.f2).toMatchObject({ status: 'missing', notRun: ['tests/unit/verification/featureLedger.test.ts'] });
    fs.writeFileSync(path.join(fixture, 'another.test.ts'), '// deliberately not run');
    r = L.featureResults(dir, reg, mk([{ status: 'passed' }]));
    expect(r.f3).toMatchObject({ status: 'missing', notRun: ['tests/unit/verification/another.test.ts'] });
  });
});

describe('registry validation', () => {
  it('rejects duplicates, built features without proof, planned features with tests, and path escapes', () => {
    const p = L.validateRegistry({ features: [
      { id: 'aa', name: 'x', tests: ['tests/unit/engine'] },
      { id: 'aa', name: 'x', tests: ['tests/unit/engine'] },
      { id: 'bb', name: 'x' },
      { id: 'cc', name: 'x', status: 'planned', tests: ['t'] },
      { id: 'dd', name: 'x', tests: ['../../etc/passwd'] },
      { id: 'ee', name: 'x', tests: ['/abs/path.test.ts'] },
      { id: 'Bad Id', name: 'x', tests: ['t'] },
    ] }).join('\n');
    expect(p).toMatch(/duplicate id aa/);
    expect(p).toMatch(/bb lists no tests/);
    expect(p).toMatch(/planned feature must not list tests/);
    expect(p).toMatch(/unsafe test path "..\/..\/etc\/passwd"/);
    expect(p).toMatch(/unsafe test path "\/abs/);
    expect(p).toMatch(/bad id/);
    expect(L.validateRegistry(null)).toEqual(['registry: missing features[]']);
    const q = L.validateRegistry({ features: [
      { id: 'pp', name: 'x', tests: ['t'], proof: 'vibes' },
      { id: 'qq', name: 'x', status: 'planned', proof: 'e2e' },
      { id: 'rr', name: 'x', status: 'planned', online: 'yes' },
    ] }).join('\n');
    expect(q).toMatch(/proof must be one of unit\/e2e\/device\/prod/);
    expect(q).toMatch(/planned feature cannot claim proof level e2e/);
    expect(q).toMatch(/online must be boolean/);
    const e = L.validateRegistry({ features: [
      { id: 'e1', name: 'x', tests: ['t'], e2e: ['tests/e2e/placement.mjs'] },
      { id: 'e2', name: 'x', tests: ['t'], e2e: ['../evil.mjs'] },
      { id: 'e3', name: 'x', status: 'planned', e2e: ['tests/e2e/a.mjs'] },
    ] }).join('\n');
    expect(e).not.toMatch(/features\[0\]/);
    expect(e).toMatch(/features\[1\]: e2e must list tests\/e2e/);
    expect(e).toMatch(/planned feature cannot list e2e proof/);
  });
  it('the REAL registry is valid and every built feature points at test files that exist (committed proof)', () => {
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/verification/features.json'), 'utf8'));
    expect(L.validateRegistry(reg)).toEqual([]);
    const ids = reg.features.map((f: Any) => f.id);
    expect(ids).toContain('feature-ledger');
    // every listed browser proof script exists in the repo
    const missingE2e = reg.features.flatMap((f: Any) => (f.e2e ?? []).filter((t: string) => !fs.existsSync(path.join(ROOT, t))));
    expect(missingE2e).toEqual([]);
    const proofless = reg.features
      .filter((f: Any) => f.status !== 'planned')
      .filter((f: Any) => L.expandTests(ROOT, f.tests).files.length === 0)
      .map((f: Any) => f.id);
    expect(proofless).toEqual([]);
  });
});

describe('checklist rendering', () => {
  it('shows checked/unchecked boxes, REGRESSED with last-good commit, and a broken-chain banner', () => {
    const reg = { features: [{ id: 'a', name: 'Feature A', work: 'W-1', tests: ['t'] }, { id: 'p', name: 'Planned P', work: 'W-2', status: 'planned', online: true }] };
    const entry = { seq: 2, commit: 'bbbbbbbbb', ts: '2026-11-02T00:00:00Z', node: 'v22', platform: 'linux', results: { a: fail, p: { status: 'planned' } }, gates: { build: 'pass' } };
    const md = L.renderChecklist(reg, entry, { a: { regressed: true, lastGood: { commit: 'aaaaaaaa', ts: '2026-11-01T00:00:00Z' }, firstVerified: { commit: 'aaaaaaaa', ts: '2026-11-01T00:00:00Z' } }, p: {} }, { ok: false, problems: ['entry 1: edited'], entries: 2 });
    expect(md).toMatch(/\| \[ \] ❌ \| Feature A \| W-1 \| — \|/);
    expect(md).toMatch(/1 of 2 requirements verified|0 of 2 requirements verified/);
    expect(md).toMatch(/REGRESSED\*\* — last passed at `aaaaaaa`/);
    expect(md).toMatch(/\| \[ \] ⬜ \| Planned P 🌐 .*needs the backend/);
    expect(md).toMatch(/Online .*0 of 1 done/);
    expect(md).toMatch(/BROKEN\*\* — entry 1: edited/);
    expect(md).toMatch(/build ✅/);
    expect(md).toMatch(/x\.test\.ts: boom/);
  });
});
