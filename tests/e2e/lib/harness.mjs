/**
 * Minimal deterministic test harness for the browser E2E flow: ordered steps with dependencies, checks inside
 * steps, console/page-error capture attributed to the running step, screenshots, and a pass/fail table.
 *
 * A step fails when it throws or when any check inside it fails. A step whose `needs` did not pass is SKIPPED
 * (reported, counted, and makes the run fail) instead of producing a cascade of misleading errors.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Console / page errors that are NOT product defects. Every entry needs a written justification; keep it empty
 * unless a message is provably outside the game's control.
 * @type {{ re: RegExp, why: string }[]}
 */
export const CONSOLE_ALLOW = [];

export class Harness {
  /** @param {{ outDir: string, log?: (s: string) => void }} o */
  constructor({ outDir, log = (s) => console.log(s) }) {
    this.outDir = outDir;
    this.log = log;
    /** @type {{ name: string, status: 'PASS' | 'FAIL' | 'SKIP', ms: number, checks: number, failed: number, detail: string }[]} */
    this.results = [];
    /** @type {{ step: string, kind: string, text: string }[]} */
    this.errors = [];
    /** @type {{ step: string, kind: string, text: string }[]} */
    this.allowed = [];
    /** @type {Map<string, number>} */
    this.warnings = new Map();
    this.current = '(setup)';
    this.shotIndex = 0;
    this.shots = [];
    this._checks = [];
    mkdirSync(outDir, { recursive: true });
  }

  /** Record one console/page error; returns true if it counts as a failure. */
  recordError(kind, text) {
    const t = String(text).slice(0, 1200);
    const allow = CONSOLE_ALLOW.find((a) => a.re.test(t));
    const entry = { step: this.current, kind, text: t };
    if (allow) {
      this.allowed.push({ ...entry, why: allow.why });
      return false;
    }
    this.errors.push(entry);
    this.log(`    !! [${kind}] ${t.split('\n')[0].slice(0, 300)}`);
    return true;
  }

  recordWarning(text) {
    const key = String(text).replace(/0x[0-9a-f]+/gi, '0x…').slice(0, 200);
    this.warnings.set(key, (this.warnings.get(key) ?? 0) + 1);
  }

  /** Attach console / pageerror / failed-request listeners to a page. */
  watch(page) {
    page.on('console', (m) => {
      const type = m.type();
      if (type === 'error') this.recordError('console.error', m.text());
      else if (type === 'warning') this.recordWarning(m.text());
    });
    page.on('pageerror', (e) => this.recordError('pageerror', e.stack || e.message));
    page.on('requestfailed', (r) => {
      const f = r.failure();
      // Navigations we abort ourselves (reload while a request is in flight) report net::ERR_ABORTED.
      if (f && /ERR_ABORTED/.test(f.errorText)) return;
      this.recordError('requestfailed', `${r.method()} ${r.url()} — ${f ? f.errorText : 'failed'}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) this.recordError('http', `${r.status()} ${r.request().method()} ${r.url()}`);
    });
  }

  /** Assert inside a step. Never throws (a step keeps collecting checks); the step fails if any check failed. */
  check(name, ok, detail) {
    const pass = !!ok;
    this._checks.push({ name, pass, detail });
    const d = detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
    const at = this._t0 ? `+${((Date.now() - this._t0) / 1000).toFixed(1)}s ` : '';
    this.log(`    ${pass ? 'ok  ' : 'FAIL'} ${at}${name}${d.length > 400 ? `${d.slice(0, 400)}…` : d}`);
    return pass;
  }

  /** Like check() but aborts the step on failure (later checks depend on it). */
  require(name, ok, detail) {
    if (!this.check(name, ok, detail)) throw new Error(`required check failed: ${name}`);
  }

  passed(name) {
    const r = this.results.find((x) => x.name === name);
    return !!r && r.status === 'PASS';
  }

  /**
   * @param {string} name
   * @param {() => Promise<void>} fn
   * @param {{ needs?: string[], onFail?: (e: unknown) => Promise<void> }} [opts]
   */
  async step(name, fn, opts = {}) {
    const missing = (opts.needs ?? []).filter((n) => !this.passed(n));
    if (missing.length) {
      this.results.push({ name, status: 'SKIP', ms: 0, checks: 0, failed: 0, failedChecks: 0, detail: `needs: ${missing.join(', ')}` });
      this.log(`\n-- ${name}: SKIPPED (needs ${missing.join(', ')})`);
      return false;
    }
    this.log(`\n-- ${name}`);
    this.current = name;
    this._checks = [];
    const errorsBefore = this.errors.length;
    const t0 = Date.now();
    this._t0 = t0;
    let thrown = null;
    try {
      await fn();
    } catch (e) {
      thrown = e;
      this.log(`    EXCEPTION ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e}`);
      if (opts.onFail) await opts.onFail(e).catch(() => {});
    }
    const ms = Date.now() - t0;
    const failedChecks = this._checks.filter((c) => !c.pass);
    const newErrors = this.errors.length - errorsBefore;
    const ok = !thrown && failedChecks.length === 0 && newErrors === 0;
    const detail = thrown
      ? String(thrown.message || thrown).split('\n')[0]
      : failedChecks.length
        ? failedChecks.map((c) => c.name).join('; ')
        : newErrors
          ? `${newErrors} console/page error(s)`
          : '';
    this.results.push({ name, status: ok ? 'PASS' : 'FAIL', ms, checks: this._checks.length, failed: failedChecks.length + (thrown ? 1 : 0), failedChecks: failedChecks.length, detail });
    this.log(`   => ${ok ? 'PASS' : 'FAIL'} (${(ms / 1000).toFixed(1)} s)`);
    this.current = '(between steps)';
    return ok;
  }

  /** Screenshot to <outDir>/NN-name.png (SwiftShader: a capture waits for a composited frame). */
  async shot(page, name) {
    // Portable filenames: CI artifact upload rejects " : < > | * ? \r \n (and Windows forbids them too).
    const safe = String(name).replace(/["*:<>?|\\/\r\n]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
    const file = path.join(this.outDir, `${String(++this.shotIndex).padStart(2, '0')}-${safe}.png`);
    const t0 = Date.now();
    try {
      await page.screenshot({ path: file, timeout: 120_000 });
      this.shots.push(path.basename(file));
      if (Date.now() - t0 > 5000) this.log(`    (screenshot ${name} took ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (e) {
      this.log(`    (screenshot ${name} failed: ${String(e.message).split('\n')[0]})`);
    }
    return Date.now() - t0;
  }

  table() {
    const rows = this.results.map((r, i) => [String(i + 1), r.name, r.status, `${(r.ms / 1000).toFixed(1)}s`, `${r.checks - r.failedChecks}/${r.checks}`, r.detail]);
    const head = ['#', 'step', 'result', 'time', 'checks', 'detail'];
    const w = head.map((h, c) => Math.min(c === 5 ? 70 : 60, Math.max(h.length, ...rows.map((r) => r[c].length))));
    const line = (cells) => cells.map((s, c) => (s.length > w[c] ? `${s.slice(0, w[c] - 1)}…` : s.padEnd(w[c]))).join(' | ');
    const out = [line(head), w.map((n) => '-'.repeat(n)).join('-|-'), ...rows.map(line)];
    const count = (s) => this.results.filter((r) => r.status === s).length;
    out.push('');
    out.push(`steps: ${this.results.length}  pass: ${count('PASS')}  fail: ${count('FAIL')}  skip: ${count('SKIP')}  ` + `console/page errors: ${this.errors.length}  allow-listed: ${this.allowed.length}  distinct warnings: ${this.warnings.size}`);
    return out.join('\n');
  }

  get ok() {
    return this.results.length > 0 && this.results.every((r) => r.status === 'PASS') && this.errors.length === 0;
  }

  writeReport(extra = {}) {
    const report = {
      ok: this.ok,
      results: this.results,
      errors: this.errors,
      allowed: this.allowed,
      warnings: [...this.warnings.entries()].map(([text, count]) => ({ text, count })),
      shots: this.shots,
      ...extra,
    };
    writeFileSync(path.join(this.outDir, 'report.json'), JSON.stringify(report, null, 2));
  }
}
