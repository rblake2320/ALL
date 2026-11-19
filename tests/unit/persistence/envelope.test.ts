import { describe, expect, it } from 'vitest';
import { buildEnvelope, prettyEnvelopeText, SAVE_FORMAT, verifyEnvelope } from '../../../src/persistence/envelope';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { decodeSave, prepareWorld } from '../../../src/persistence/loadPipeline';
import { gzipBytes } from '../../../src/persistence/gzip';
import { utf8DecodeStrict, utf8Encode } from '../../../src/persistence/bytes';
import { sha256Hex } from '../../../src/persistence/sha256';
import { SAVE_SCHEMA_VERSION } from '../../../src/sim/types';
import { makeMeta, makeWorld, prng } from './fixtures';

async function envelopeBytes(opts: { gzip?: boolean; world?: unknown; schemaVersion?: number } = {}): Promise<Uint8Array> {
  const world = (opts.world ?? makeWorld()) as Record<string, unknown>;
  const { text } = await buildEnvelope({
    payloadText: canonicalJson(world),
    schemaVersion: opts.schemaVersion ?? SAVE_SCHEMA_VERSION,
    gameVersion: '1.0.0',
    slotId: 'slot1',
    name: 'My Save',
    createdAt: '2026-11-01T10:00:00.000Z',
    savedAt: '2026-11-05T10:00:00.000Z',
    playMinutes: 42,
    meta: makeMeta(),
  });
  const bytes = utf8Encode(text);
  return opts.gzip ? gzipBytes(bytes) : bytes;
}

const MAX = SAVE_SCHEMA_VERSION;

describe('envelope round trip', () => {
  for (const gzip of [false, true]) {
    it(`builds, decodes and verifies (${gzip ? 'gzip' : 'plain'})`, async () => {
      const bytes = await envelopeBytes({ gzip });
      if (gzip) expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
      const d = await decodeSave(bytes, { maxSchemaVersion: MAX });
      expect(d.ok).toBe(true);
      if (!d.ok) return;
      expect(d.compressed).toBe(gzip);
      expect(d.warnings).toEqual([]);
      expect(d.envelope.format).toBe(SAVE_FORMAT);
      expect(d.envelope.slotId).toBe('slot1');
      expect(d.envelope.playMinutes).toBe(42);
      expect(d.envelope.meta).toEqual(makeMeta());
      expect(d.envelope.payload).toEqual(JSON.parse(JSON.stringify(makeWorld())));
      const p = await prepareWorld(d.envelope, { migrations: [], targetSchemaVersion: MAX, repair: null });
      expect(p.ok).toBe(true);
      if (p.ok) {
        expect(p.world).toEqual(makeWorld());
        expect(p.warnings).toEqual([]);
      }
    });
  }

  it('text layout: header first, payload last, payloadSha256 = sha256(canonical payload)', async () => {
    const text = utf8DecodeStrict(await envelopeBytes());
    expect(text.startsWith('{"createdAt":')).toBe(true);
    expect(text.indexOf('"payload":')).toBeGreaterThan(text.indexOf('"payloadSha256"'));
    const obj = JSON.parse(text) as Record<string, unknown>;
    expect(obj.payloadSha256).toBe(await sha256Hex(canonicalJson(makeWorld())));
    expect(obj.formatVersion).toBe(1);
    expect(typeof obj.headerSha256).toBe('string');
  });

  it('pretty export text verifies exactly like the compact form (CRLF and BOM tolerated)', async () => {
    const d = await decodeSave(await envelopeBytes(), { maxSchemaVersion: MAX });
    if (!d.ok) throw new Error(d.error);
    const { headerSha256, payload, ...rest } = d.envelope;
    const pretty = prettyEnvelopeText({ ...rest, headerSha256: headerSha256 ?? '' }, payload);
    expect(pretty).toContain('\n  "payload": {\n    "agents"');
    for (const variant of [pretty, pretty.replace(/\n/g, '\r\n'), '﻿' + pretty]) {
      const again = await decodeSave(utf8Encode(variant), { maxSchemaVersion: MAX });
      expect(again.ok).toBe(true);
    }
  });

  it('envelopes without headerSha256 are accepted with a warning', async () => {
    const obj = JSON.parse(utf8DecodeStrict(await envelopeBytes())) as Record<string, unknown>;
    delete obj.headerSha256;
    const d = await decodeSave(utf8Encode(JSON.stringify(obj)), { maxSchemaVersion: MAX });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.warnings.join(' ')).toMatch(/no checksum/);
  });
});

describe('corruption is always detected, never thrown', () => {
  /** The invariant: a damaged file is either rejected, or decodes to EXACTLY the original data. */
  async function assertRejectedOrIdentical(flipped: Uint8Array, original: string, where: string): Promise<'rejected' | 'benign'> {
    const d = await decodeSave(flipped, { maxSchemaVersion: MAX });
    if (!d.ok) {
      expect(['corrupt', 'invalid', 'future_version']).toContain(d.code);
      return 'rejected';
    }
    const { headerSha256: _h, ...rest } = d.envelope;
    expect(canonicalJson(rest), `flip at ${where} decoded to different data`).toBe(original);
    return 'benign';
  }

  async function originalCanonical(bytes: Uint8Array): Promise<string> {
    const d = await decodeSave(bytes, { maxSchemaVersion: MAX });
    if (!d.ok) throw new Error(d.error);
    const { headerSha256: _h, ...rest } = d.envelope;
    return canonicalJson(rest);
  }

  it('a single bit flip ANYWHERE in the file (plain JSON) is rejected or provably harmless', async () => {
    const bytes = await envelopeBytes();
    const original = await originalCanonical(bytes);
    const text = utf8DecodeStrict(bytes);
    const rnd = prng(1234);
    const positions = new Set<number>();
    const headerEnd = text.indexOf('"payload":');
    for (let i = 0; i < headerEnd; i++) positions.add(i); // every header byte
    while (positions.size < headerEnd + 400) positions.add(Math.floor(rnd() * bytes.length)); // + 400 payload bytes
    const keyStart = text.indexOf('"headerSha256"');
    for (const pos of positions) {
      for (const bit of [1, 2, 4, 8, 16, 32, 64, 128]) {
        const flipped = bytes.slice();
        flipped[pos] ^= bit;
        const r = await assertRejectedOrIdentical(flipped, original, `${pos}^${bit}`);
        // The only harmless flip: damaging the NAME of the optional headerSha256 key (data itself intact).
        if (r === 'benign') expect(pos > keyStart && pos < keyStart + 13, `benign flip outside headerSha256 key at ${pos}`).toBe(true);
        if (pos >= headerEnd) expect(r).toBe('rejected'); // payload: every flip is detected
      }
    }
  }, 180_000);

  it('a single bit flip anywhere in a gzip save is rejected or provably harmless', async () => {
    const bytes = await envelopeBytes({ gzip: true });
    const original = await originalCanonical(bytes);
    const rnd = prng(99);
    for (let n = 0; n < 400; n++) {
      const pos = n < 32 ? n : Math.floor(rnd() * bytes.length);
      const flipped = bytes.slice();
      flipped[pos] ^= 1 << Math.floor(rnd() * 8);
      const r = await assertRejectedOrIdentical(flipped, original, String(pos));
      // Harmless by construction: gzip header metadata (FLG.FTEXT, MTIME, XFL, OS — bytes 3..9) and the
      // padding bits of the final deflate byte (just before the 8-byte CRC32/ISIZE trailer).
      if (r === 'benign') expect((pos >= 3 && pos <= 9) || pos === bytes.length - 9, `benign flip at ${pos} of ${bytes.length}`).toBe(true);
    }
  });

  it('truncation at 20 random offsets (plain and gzip) -> corrupt, never throws', async () => {
    for (const gzip of [false, true]) {
      const bytes = await envelopeBytes({ gzip });
      const rnd = prng(gzip ? 5 : 6);
      for (let i = 0; i < 20; i++) {
        const cut = 1 + Math.floor(rnd() * (bytes.length - 1));
        const d = await decodeSave(bytes.slice(0, cut), { maxSchemaVersion: MAX });
        expect(d.ok).toBe(false);
        if (!d.ok) expect(d.code).toBe('corrupt');
      }
    }
  });

  const garbage: [string, Uint8Array][] = [
    ['empty', new Uint8Array(0)],
    ['one byte', new Uint8Array([0x7b])],
    ['random binary', new Uint8Array(4096).map((_, i) => (i * 7919) & 255)],
    ['gzip magic + garbage', new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])],
    ['gzip magic only', new Uint8Array([0x1f, 0x8b])],
    ['JSON array', utf8Encode('[1,2,3]')],
    ['JSON null', utf8Encode('null')],
    ['empty object', utf8Encode('{}')],
    ['wrong format tag', utf8Encode('{"format":"some-other-game","formatVersion":1}')],
    ['invalid UTF-8', new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d])],
    ['UTF-16 text', new Uint8Array([0xff, 0xfe, 0x7b, 0x00, 0x7d, 0x00])],
    ['html error page', utf8Encode('<!doctype html><title>404</title>')],
    ['deep nesting bomb', utf8Encode('{"format":"afterlife-lease-save","x":' + '['.repeat(5000) + ']'.repeat(5000) + '}')],
  ];
  for (const [name, bytes] of garbage) {
    it(`rejects ${name}`, async () => {
      const d = await decodeSave(bytes, { maxSchemaVersion: MAX });
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.code).toBe('corrupt');
    });
  }

  it('gzip of non-save content is rejected as corrupt', async () => {
    const d = await decodeSave(await gzipBytes(utf8Encode('hello world')), { maxSchemaVersion: MAX });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('corrupt');
  });

  it('gzip bombs are bounded (decompressed size cap -> invalid)', async () => {
    const big = utf8Encode('{"a":"' + 'x'.repeat(2_000_000) + '"}');
    const gz = await gzipBytes(big);
    expect(gz.length).toBeLessThan(50_000);
    const d = await decodeSave(gz, { maxSchemaVersion: MAX, maxBytes: 1_000_000 });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('invalid');
  });

  it('oversized raw files are refused before parsing', async () => {
    const d = await decodeSave(new Uint8Array(2000), { maxSchemaVersion: MAX, maxBytes: 1000 });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('invalid');
  });

  it('tampered payload with a recomputed payload hash still fails the header hash', async () => {
    const obj = JSON.parse(utf8DecodeStrict(await envelopeBytes())) as Record<string, unknown> & { payload: Record<string, unknown> };
    obj.payload.tick = 999999;
    obj.payloadSha256 = await sha256Hex(canonicalJson(obj.payload));
    const d = await decodeSave(utf8Encode(JSON.stringify(obj)), { maxSchemaVersion: MAX });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/header checksum mismatch/);
  });

  it('prototype-pollution keys INJECTED into a save (checksums untouched) are corruption, and never pollute', async () => {
    // The checksum covers exactly what is stored: added bytes are a modified file, like any bit flip.
    const text = utf8DecodeStrict(await envelopeBytes()).replace('"payload":{', '"payload":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":1}},');
    const d = await decodeSave(utf8Encode(text), { maxSchemaVersion: MAX });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('corrupt');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('a file whose checksums COVER reserved keys (foreign writer) loads with them stripped, warned, never polluting', async () => {
    const world = makeWorld();
    const raw = JSON.stringify(world).replace('{', '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":1}},');
    const parsedRaw = JSON.parse(raw) as Record<string, unknown>; // own __proto__ / constructor keys
    const { text } = await buildEnvelope({
      payloadText: canonicalJson(parsedRaw),
      schemaVersion: SAVE_SCHEMA_VERSION,
      gameVersion: 'other-tool',
      slotId: 'x',
      name: 'x',
      createdAt: new Date(0).toISOString(),
      savedAt: new Date(0).toISOString(),
      playMinutes: 0,
      meta: makeMeta(),
    });
    const d = await decodeSave(utf8Encode(text), { maxSchemaVersion: MAX });
    expect(d.ok, d.ok ? '' : d.error).toBe(true);
    if (d.ok) {
      expect(d.warnings.join(' ')).toMatch(/unsafe key/);
      expect(Object.prototype.hasOwnProperty.call(d.envelope.payload, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(d.envelope.payload, 'constructor')).toBe(false);
      const p = await prepareWorld(d.envelope, { migrations: [], targetSchemaVersion: MAX, repair: null });
      expect(p.ok && p.world).toEqual(world);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('versioning', () => {
  it('a newer world schema is reported as future_version (after checksum verification)', async () => {
    const world = { ...makeWorld(), schemaVersion: MAX + 1 };
    const bytes = await envelopeBytes({ world, schemaVersion: MAX + 1 });
    const d = await decodeSave(bytes, { maxSchemaVersion: MAX });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('future_version');
  });

  it('a newer file formatVersion is future_version', async () => {
    const obj = JSON.parse(utf8DecodeStrict(await envelopeBytes())) as Record<string, unknown>;
    obj.formatVersion = 2;
    const r = await verifyEnvelope(obj, MAX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('future_version');
  });

  it('header/payload schema disagreement is corruption', async () => {
    const world = { ...makeWorld(), schemaVersion: MAX };
    const obj = JSON.parse(utf8DecodeStrict(await envelopeBytes({ world }))) as Record<string, unknown>;
    obj.schemaVersion = MAX + 5;
    delete obj.headerSha256;
    const r = await verifyEnvelope(obj, MAX + 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('corrupt');
  });

  it('verifyEnvelope never throws on hostile objects', async () => {
    const hostile = [
      null,
      42,
      'str',
      [],
      { format: SAVE_FORMAT, formatVersion: 1, payloadSha256: 'x'.repeat(64), payload: {} },
      { format: SAVE_FORMAT, formatVersion: 1.5 },
      { format: SAVE_FORMAT, formatVersion: 1, payloadSha256: '0'.repeat(64), payload: [] },
      Object.defineProperty({ format: SAVE_FORMAT, formatVersion: 1 }, 'payloadSha256', {
        get() {
          throw new Error('getter bomb');
        },
        enumerable: true,
      }),
    ];
    for (const h of hostile) {
      const r = await verifyEnvelope(h, MAX);
      expect(r.ok).toBe(false);
    }
  });
});
