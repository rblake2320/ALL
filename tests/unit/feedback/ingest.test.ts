/**
 * W-110 §5.2 + §3.1: `feedback:ingest` — rejects malformed / oversized / forged files, re-scrubs personal data,
 * computes the dedupe key, groups duplicates idempotently, writes the normalised record + attachments, prints a
 * GitHub-ready summary. The CLI itself is run as a child process on real temp files.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { addToGroups, dedupeKey, emptyGroups, errorSignature, ingestReport, markdownSummary, normaliseSignature, readGroups } from '../../../src/feedback/ingest';
import { encodeReport, reportChecksum, REPORT_MAX_CHARS } from '../../../src/feedback/schema';
import { sealed, baseBody } from './helpers';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const ROOT = path.resolve(__dirname, '../../..');
const tmp = mkdtempSync(path.join(tmpdir(), 'al-ingest-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('ingest core', () => {
  it('normalises a valid report and re-scrubs what an edited file could carry', () => {
    // a producer that "forgot" to scrub (e.g. a hand-edited, re-sealed file)
    const body = baseBody({ text: 'mail me: zed@example.org, call +44 20 7946 0958', diagnostics: { ...baseBody().diagnostics, errors: [{ at: '2026-11-06T09:59:00.000Z', where: 'saveFlow', message: 'EPERM C:\\Users\\zed\\AppData\\x.dat from 192.168.1.20' }] } });
    const r = ingestReport(encodeReport({ ...body, sha256: reportChecksum(body) }), { now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = JSON.stringify(r.record) + r.markdown;
    expect(s).not.toMatch(/zed@example|7946|192\.168|Users\\\\zed|Users\\zed/);
    expect(r.record).toMatchObject({ id: 'FB-7Q3KM-X2P9A', type: 'bug', area: 'buy', bracket: '13plus', presets: ['cantPlace'] });
    expect(r.record.attachments.screenshot).toMatchObject({ file: 'fb-7q3km-x2p9a.jpg', width: 640, height: 360 });
    expect(r.screenshot?.[0]).toBe(0xff);
    expect(r.record.dedupeKey).toMatch(/^[0-9a-f]{16}$/);
    expect(r.markdown).toMatch(/^### \[bug\]/);
    expect(r.markdown).toContain('`area:buy`');
  });

  it('dedupe key = error signature + area + version; volatile numbers/ids/strings do not split a group', () => {
    expect(normaliseSignature("Cannot read 'x' of undefined at 12:34 (0xdeadbeef) id 9f8e7d6c5b4a")).toBe('Cannot read <str> of undefined at <n>:<n> (<hex>) id <hex>');
    const a = sealed({ id: 'FB-AAAAA-AAAAA', diagnostics: { ...baseBody().diagnostics, errors: [{ at: '2026-11-06T09:00:00.000Z', where: 'render.frame', message: 'WebGL context lost after 123 frames' }] } });
    const b = sealed({ id: 'FB-BBBBB-BBBBB', diagnostics: { ...baseBody().diagnostics, errors: [{ at: '2026-11-06T10:00:00.000Z', where: 'render.frame', message: 'WebGL context lost after 98765 frames' }] } });
    const c = sealed({ id: 'FB-CCCCC-CCCCC', area: 'live', diagnostics: b.diagnostics });
    const ka = dedupeKey(errorSignature(a), a.area, a.game.version);
    expect(ka).toBe(dedupeKey(errorSignature(b), b.area, b.game.version));
    expect(ka).not.toBe(dedupeKey(errorSignature(c), c.area, c.game.version));
    expect(errorSignature(sealed({ diagnostics: { ...baseBody().diagnostics, crash: { message: 'boom 42', stack: null } } }))).toBe('crash: boom <n>');
    expect(errorSignature(sealed({ presets: ['stuck', 'cantPlace'], diagnostics: { ...baseBody().diagnostics, errors: [] } }))).toBe('bug: cantPlace+stuck');
  });

  it('groups count duplicates once per report id', () => {
    const recs = ['FB-AAAAA-AAAAA', 'FB-BBBBB-BBBBB'].map((id) => {
      const r = ingestReport(encodeReport(sealed({ id })), { now: NOW });
      if (!r.ok) throw new Error(r.errors.join());
      return r.record;
    });
    let g = emptyGroups();
    let res = addToGroups(g, recs[0]);
    g = res.index;
    res = addToGroups(g, recs[0]);
    expect(res).toMatchObject({ count: 1, duplicate: true });
    res = addToGroups(res.index, recs[1]);
    expect(res.count).toBe(2);
    expect(readGroups(JSON.parse(JSON.stringify(res.index)))).toEqual(res.index);
    expect(readGroups({ v: 1, groups: { '../x': { ids: [], count: 1 } } })).toEqual(emptyGroups());
    expect(readGroups('junk')).toEqual(emptyGroups());
  });

  it('markdown cannot inject markup or ping people', () => {
    const r = ingestReport(encodeReport(sealed({ text: '<img src=x onerror=alert(1)> @everyone [click](javascript:x) ```' })), { now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const md = markdownSummary(r.record);
    expect(md).not.toMatch(/(?<!\\)<img/); // only the escaped form \<img, which renders as text
    expect(md).not.toMatch(/@everyone/);
    expect(md).not.toMatch(/(?<!\\)\]\(javascript/);
  });

  it('rejects malformed, forged and out-of-policy reports with reasons', () => {
    const forged = JSON.parse(encodeReport(sealed()));
    forged.text = 'changed after sealing';
    const kid = baseBody({ bracket: 'under13', text: 'hi', presets: ['stuck'] });
    for (const [label, text] of [
      ['not json', 'not json'],
      ['forged', JSON.stringify(forged)],
      ['under-13 with text (re-sealed)', encodeReport({ ...kid, sha256: reportChecksum(kid) })],
      ['oversized', 'x'.repeat(REPORT_MAX_CHARS + 1)],
    ] as const) {
      const r = ingestReport(text, { now: NOW });
      expect(r.ok, label).toBe(false);
      if (!r.ok) expect(r.errors.length, label).toBeGreaterThan(0);
    }
  });
});

function runCli(args: string[]) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'feedback-ingest.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('feedback:ingest CLI (child process, real files)', () => {
  it('files a valid report: record + screenshot + groups, markdown on stdout; re-ingest is idempotent', () => {
    const out = path.join(tmp, 'inbox1');
    const f = path.join(tmp, 'good.alreport');
    writeFileSync(f, encodeReport(sealed()));
    const r1 = runCli([f, `--out=${out}`]);
    expect(r1.code, r1.err).toBe(0);
    expect(r1.out).toContain('### [bug]');
    expect(r1.out).toMatch(/Filed FB-7Q3KM-X2P9A .* 1 report\b/);
    expect(readdirSync(out).sort()).toEqual(['_groups.json', 'fb-7q3km-x2p9a.jpg', 'fb-7q3km-x2p9a.json']);
    const rec = JSON.parse(readFileSync(path.join(out, 'fb-7q3km-x2p9a.json'), 'utf8'));
    expect(rec).toMatchObject({ id: 'FB-7Q3KM-X2P9A', area: 'buy' });
    expect(rec.diagnostics.text).toBeTypeOf('string');
    expect(JSON.stringify(rec)).not.toContain('"data":'); // pixels live in the .jpg, not the record
    const r2 = runCli([f, `--out=${out}`]);
    expect(r2.code).toBe(0);
    expect(r2.out).toContain('(already ingested)');
    expect(JSON.parse(readFileSync(path.join(out, '_groups.json'), 'utf8')).groups[rec.dedupeKey].count).toBe(1);
  }, 60_000);

  it('rejects bad files (exit 1, reasons on stderr) and writes nothing for them', () => {
    const out = path.join(tmp, 'inbox2');
    const files: Record<string, string | Buffer> = {
      'malformed.alreport': '{"format":"afterlife-lease-report",',
      'forged.alreport': encodeReport(sealed()).replace('The sofa', 'A sofa'),
      'notutf8.alreport': Buffer.from([0x7b, 0xff, 0xfe, 0x7d]),
      'save.alsave': JSON.stringify({ format: 'afterlife-lease-save' }),
    };
    for (const [n, c] of Object.entries(files)) writeFileSync(path.join(tmp, n), c);
    // oversized: refused from its size, before reading
    const big = path.join(tmp, 'big.alreport');
    writeFileSync(big, Buffer.alloc(4 * 1024 * 1024 + 10, 0x20));
    const r = runCli([...Object.keys(files).map((n) => path.join(tmp, n)), big, path.join(tmp, 'missing.alreport'), `--out=${out}`]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/REJECTED .*malformed\.alreport/);
    expect(r.err).toMatch(/checksum mismatch/);
    expect(r.err).toMatch(/not valid UTF-8/);
    expect(r.err).toMatch(/not an Afterlife Lease report/);
    expect(r.err).toMatch(/bytes; the limit is/);
    expect(r.err).toMatch(/cannot read: ENOENT/);
    expect(r.err).toContain('0 filed, 6 rejected');
    expect(existsSync(out) ? readdirSync(out).filter((x) => x !== '_groups.json') : []).toEqual([]);
  }, 60_000);

  it('a different file claiming an already-filed id is refused (no overwrite)', () => {
    const out = path.join(tmp, 'inbox3');
    const a = path.join(tmp, 'a.alreport');
    const b = path.join(tmp, 'b.alreport');
    writeFileSync(a, encodeReport(sealed()));
    writeFileSync(b, encodeReport(sealed({ text: 'same id, other content' })));
    expect(runCli([a, `--out=${out}`]).code).toBe(0);
    const r = runCli([b, `--out=${out}`]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/already filed with different content/);
    expect(JSON.parse(readFileSync(path.join(out, 'fb-7q3km-x2p9a.json'), 'utf8')).text).toBe('The sofa would not go next to the wall.');
  }, 60_000);

  it('usage error without files (exit 2)', () => {
    expect(runCli([]).code).toBe(2);
  });
});
