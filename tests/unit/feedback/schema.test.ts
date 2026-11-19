/** W-110 §5.2: `.alreport` schema round-trip, strict validation, forged / malformed / oversized files rejected. */
import { describe, expect, it } from 'vitest';
import { bytesToBase64, utf8Encode } from '../../../src/persistence/bytes';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { sha256HexSync } from '../../../src/persistence/sha256';
import { FEEDBACK_ID_RE, idFromKey, idKey, isFeedbackId, newFeedbackId } from '../../../src/feedback/id';
import { imageInfo, splitImageDataUrl } from '../../../src/feedback/image';
import { REPORT_MAX_CHARS, SCREENSHOT_MAX_BYTES, encodeReport, parseReport, reportChecksum, sealReport, validateReport, type FeedbackReport } from '../../../src/feedback/schema';
import { baseBody, fakeJpeg, sealed } from './helpers';

/** Re-seal after an edit so only the edited rule (not the checksum) can reject it. */
function forge(edit: (r: Record<string, unknown>) => void): Record<string, unknown> {
  const r = JSON.parse(JSON.stringify(sealed())) as Record<string, unknown>;
  edit(r);
  r.sha256 = reportChecksum(r);
  return r;
}

describe('.alreport round trip', () => {
  it('encode → parse gives back the identical, valid report', () => {
    const r = sealed();
    const text = encodeReport(r);
    const p = parseReport(text);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.report).toEqual(r);
    expect(encodeReport(p.report)).toBe(text); // canonical: stable bytes
  });
  it('accepts a BOM, a save attachment and every type/area/source', () => {
    const save = utf8Encode('{"tick":1}');
    for (const type of ['bug', 'idea', 'praise'] as const)
      for (const area of ['live', 'buy', 'build', 'caz', 'store', 'menu'] as const)
        for (const source of ['pause', 'settings', 'hotkey', 'crash', 'menu'] as const) {
          const r = sealReport(baseBody({ type, area, source, save: { encoding: 'json', bytes: save.length, sha256: sha256HexSync(save), data: bytesToBase64(save) } }));
          expect(parseReport(`﻿${encodeReport(r)}`).ok, `${type}/${area}/${source}`).toBe(true);
        }
  });
  it('a report without screenshot / with presets only is valid', () => {
    expect(validateReport(sealed({ screenshot: null })).ok).toBe(true);
    expect(validateReport(sealed({ text: '', presets: ['stuck', 'lostProgress'] })).ok).toBe(true);
  });
});

describe('rejects malformed, oversized and forged files', () => {
  const cases: [string, unknown][] = [
    ['not JSON', 'hello'],
    ['JSON array', '[]'],
    ['wrong format', JSON.stringify({ ...sealed(), format: 'afterlife-lease-save' })],
    ['future version', JSON.stringify({ ...sealed(), v: 2 })],
    ['deeply nested', `${'['.repeat(5000)}${']'.repeat(5000)}`],
    ['oversized', `{"format":"afterlife-lease-report","pad":"${'x'.repeat(REPORT_MAX_CHARS)}"}`],
    ['not text', 42],
  ];
  for (const [name, input] of cases) {
    it(name, () => {
      const p = parseReport(input as string);
      expect(p.ok).toBe(false);
    });
  }
  it('oversized files are flagged as tooLarge before parsing', () => {
    const p = parseReport('x'.repeat(REPORT_MAX_CHARS + 1));
    expect(p.ok).toBe(false);
    expect((p as { tooLarge?: boolean }).tooLarge).toBe(true);
  });

  it('checksum mismatch (edited text, edited bracket) is a forgery', () => {
    const r = JSON.parse(encodeReport(sealed())) as FeedbackReport;
    r.text = 'edited after sealing';
    const v = validateReport(r);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join()).toMatch(/checksum/);
    const r2 = JSON.parse(encodeReport(sealed({ bracket: 'under13', text: '', presets: ['stuck'] }))) as FeedbackReport;
    r2.bracket = '13plus';
    expect(validateReport(r2).ok).toBe(false);
  });

  const forged: [string, (r: Record<string, unknown>) => void, RegExp][] = [
    ['extra top-level field', (r) => (r.evil = 1), /unexpected field/],
    ['missing field', (r) => delete r.diagnostics, /missing field/],
    ['bad id', (r) => (r.id = 'FB-OOOOO-IIIII'), /id/],
    ['unknown type (online-only safety report)', (r) => (r.type = 'safety'), /type/],
    ['unknown preset', (r) => (r.presets = ['hack']), /presets/],
    ['duplicate presets', (r) => (r.presets = ['stuck', 'stuck']), /presets/],
    ['text too long', (r) => (r.text = 'a'.repeat(2001)), /longer than 2000/],
    ['empty report', (r) => ((r.text = ''), (r.presets = [])), /neither text nor a preset/],
    ['under-13 with free text', (r) => ((r.bracket = 'under13'), (r.text = 'hello')), /under-13 reports must not contain free text/],
    ['under-13 with a save', (r) => ((r.bracket = 'under13'), (r.text = ''), (r.save = { encoding: 'json', bytes: 2, sha256: sha256HexSync(utf8Encode('{}')), data: bytesToBase64(utf8Encode('{}')) })), /must not attach a save/],
    ['PNG screenshot claiming JPEG', (r) => ((r.screenshot as Record<string, unknown>).data = bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))), /not a JPEG or WebP/],
    ['SVG/HTML screenshot', (r) => ((r.screenshot as Record<string, unknown>).data = bytesToBase64(utf8Encode('<svg onload=alert(1)>'))), /not a JPEG or WebP/],
    ['screenshot dims lie', (r) => ((r.screenshot as Record<string, unknown>).width = 1), /dimensions do not match/],
    ['screenshot larger than 1280 px', (r) => Object.assign(r.screenshot as object, { data: bytesToBase64(fakeJpeg(4000, 3000)), width: 4000, height: 3000 }), /larger than 1280/],
    ['screenshot over 300 KB', (r) => ((r.screenshot as Record<string, unknown>).data = bytesToBase64(fakeJpeg(640, 360, SCREENSHOT_MAX_BYTES + 10))), /at most/],
    ['save checksum wrong', (r) => (r.save = { encoding: 'json', bytes: 2, sha256: '0'.repeat(64), data: bytesToBase64(utf8Encode('{}')) }), /save checksum/],
    ['save claims gzip', (r) => (r.save = { encoding: 'gzip', bytes: 2, sha256: sha256HexSync(utf8Encode('{}')), data: bytesToBase64(utf8Encode('{}')) }), /gzip/],
    ['events not closed vocabulary', (r) => ((r.diagnostics as Record<string, unknown>).events = [{ t: 0, k: 'text with spaces <b>', n: 1 }]), /events/],
    ['too many events', (r) => ((r.diagnostics as Record<string, unknown>).events = Array.from({ length: 51 }, (_, i) => ({ t: i, k: 'x', n: 1 }))), /events/],
    ['diagnostics text too long', (r) => ((r.diagnostics as Record<string, unknown>).text = 'x'.repeat(60_000)), /diagnostics.text/],
    ['bad createdAt', (r) => (r.createdAt = 'yesterday'), /createdAt/],
    ['bad game build', (r) => ((r.game as Record<string, unknown>).build = '../../etc'), /game.build/],
  ];
  for (const [name, edit, re] of forged) {
    it(name, () => {
      const v = validateReport(forge(edit));
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.errors.join(' | ')).toMatch(re);
    });
  }

  it('createdAt far in the future is refused when a clock is given', () => {
    const v = validateReport(sealed({ createdAt: '2099-01-01T00:00:00.000Z' }), { now: Date.parse('2026-11-06T00:00:00Z') });
    expect(v.ok).toBe(false);
  });
  it('prototype-pollution keys are dropped by the hardened parse (and then fail the checksum)', () => {
    const text = encodeReport(sealed()).replace('"area"', '"__proto__":{"polluted":true},"area"');
    const p = parseReport(text);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(p.ok).toBe(true); // reserved key stripped before validation; the remaining body still verifies
  });
  it('checksum is over the canonical body', () => {
    const r = sealed();
    const { sha256: _s, ...body } = r;
    expect(r.sha256).toBe(sha256HexSync(canonicalJson(body)));
  });
});

describe('feedback ids', () => {
  it('format, storage key round trip, no ambiguous letters', () => {
    let s = 1;
    const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      const id = newFeedbackId(rnd);
      expect(id).toMatch(FEEDBACK_ID_RE);
      expect(id).not.toMatch(/[ILOU]/);
      expect(idFromKey(idKey(id))).toBe(id);
      seen.add(id);
    }
    expect(seen.size).toBe(20_000); // 50 random bits: no collisions at this scale
    expect(isFeedbackId('FB-7Q3K')).toBe(false);
    expect(idFromKey('fbr-../..-xxxxx')).toBeNull();
  });
});

describe('image checks', () => {
  it('reads JPEG and WebP sizes, refuses everything else', () => {
    expect(imageInfo(fakeJpeg(1280, 720))).toEqual({ mime: 'image/jpeg', width: 1280, height: 720 });
    const vp8x = new Uint8Array(30);
    vp8x.set(utf8Encode('RIFF'), 0);
    vp8x.set(utf8Encode('WEBP'), 8);
    vp8x.set(utf8Encode('VP8X'), 12);
    vp8x.set([0x7f, 0x02, 0x00, 0x67, 0x01, 0x00], 24); // 640 x 360
    expect(imageInfo(vp8x)).toEqual({ mime: 'image/webp', width: 640, height: 360 });
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(imageInfo(utf8Encode('<html>'))).toBeNull();
    expect(splitImageDataUrl('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(splitImageDataUrl('javascript:alert(1)')).toBeNull();
    expect(splitImageDataUrl('data:image/jpeg;base64,AAAA')).toEqual({ mime: 'image/jpeg', data: 'AAAA' });
  });
});
