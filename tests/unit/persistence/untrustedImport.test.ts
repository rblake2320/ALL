/**
 * Save import of UNTRUSTED files (docs/SECURITY.md §4). The attacker model is "anyone who can hand the player
 * an .alsave file": they can read the format and RECOMPUTE both checksums (SHA-256 is not a secret), so a
 * re-sealed file passes verification. These tests pin down that everything after the checksums still treats
 * the data as hostile: no exception escapes, no prototype is polluted, every stored world stays
 * serializable, and limits (size, decompressed size, depth, thumbnails, meta) hold for re-sealed files too.
 */
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { SaveManagerImpl, type SaveManagerOptions } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { utf8DecodeStrict, utf8Encode } from '../../../src/persistence/bytes';
import { sha256Hex } from '../../../src/persistence/sha256';
import { makeMeta, makeWorld, silentLogger } from './fixtures';

function manager(over: Partial<SaveManagerOptions> = {}) {
  const backend = createMemoryBackend();
  let t = Date.parse('2026-11-05T12:00:00.000Z');
  return new SaveManagerImpl({ backend, logger: silentLogger, now: () => (t += 1000), compress: false, ...over });
}

/** A genuine export, parsed RAW (own "__proto__" keys stay plain keys). */
async function exportedEnvelope(): Promise<Record<string, unknown>> {
  const m = manager();
  expect((await m.save('slot1', 'Mine', makeWorld(), makeMeta())).ok).toBe(true);
  const ex = await m.exportSlot('slot1');
  return JSON.parse(utf8DecodeStrict(ex!.data)) as Record<string, unknown>;
}

/** What an attacker does: recompute payloadSha256 and headerSha256 over the modified envelope. */
async function reseal(env: Record<string, unknown>): Promise<Uint8Array> {
  const payload = env.payload;
  env.payloadSha256 = await sha256Hex(canonicalJson(payload));
  const header = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of Object.entries(env)) if (k !== 'payload' && k !== 'headerSha256') header[k] = v;
  env.headerSha256 = await sha256Hex(canonicalJson(header));
  return utf8Encode(JSON.stringify(env));
}

afterEach(() => {
  // A polluted prototype would leak into every later test; fail loudly instead.
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
});

describe('untrusted import — checksums are not tamper-proofing', () => {
  it('a re-sealed edited file (funds changed) imports: checksums only detect accidental damage', async () => {
    const env = await exportedEnvelope();
    const payload = env.payload as { household: { funds: number } };
    payload.household.funds = 9_999_999;
    const r = await manager().importFile(await reseal(env));
    expect(r.ok).toBe(true);
    // ...but the value still went through structural validation and is a finite number.
    if (r.ok) expect(Number.isFinite(r.world.household.funds)).toBe(true);
  });

  it('re-sealed hostile values never throw; whatever is accepted is valid, serializable and re-saveable', async () => {
    const hostile: Array<(p: Record<string, any>) => void> = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      (p) => (p.household.funds = -1e308),
      (p) => (p.household.funds = 'lots'),
      (p) => (p.agents = 'nope'),
      (p) => (p.agents = null),
      (p) => (p.objects = [1, 2, 3]),
      (p) => (p.tick = -5),
      (p) => (p.tick = 1e308),
      (p) => (p.seed = { x: 1 }),
      (p) => {
        for (const a of Object.values(p.agents as Record<string, any>)) { // eslint-disable-line @typescript-eslint/no-explicit-any
          a.firstName = 'x'.repeat(1_000_000);
          a.needs = { hunger: 1e308, energy: -1e308, preservation: 'full', social: null, fun: [], hygiene: {} };
          a.pos = { x: 1e308, z: -1e308 };
        }
      },
      (p) => {
        for (const k of Object.keys(p)) if (k !== 'schemaVersion') delete p[k];
      },
    ];
    for (const mutate of hostile) {
      const env = await exportedEnvelope();
      mutate(env.payload as Record<string, unknown>);
      const m = manager();
      const r = await m.importFile(await reseal(env));
      if (!r.ok) {
        expect(['invalid', 'corrupt']).toContain(r.code);
        continue;
      }
      // Accepted (repaired): the world must be canonical-JSON clean and survive a save/load round trip.
      expect(() => canonicalJson(r.world)).not.toThrow();
      expect((await m.save('again', 'again', r.world, makeMeta())).ok).toBe(true);
      expect((await m.load('again')).ok).toBe(true);
    }
  });
});

describe('untrusted import — numbers JSON can smuggle in', () => {
  it('1e999 / -1e999 (parse to ±Infinity) are refused as corrupt, never stored', async () => {
    const env = await exportedEnvelope();
    const text = JSON.stringify(env);
    for (const lit of ['1e999', '-1e999']) {
      const evil = text.replace(/"funds":\s*-?\d+(\.\d+)?/, `"funds":${lit}`);
      expect(evil).not.toBe(text);
      const m = manager();
      const r = await m.importFile(utf8Encode(evil));
      expect(!r.ok && r.code).toBe('corrupt');
      expect(await m.listSlots()).toEqual([]);
    }
  });

  it('±Infinity in the HEADER (meta) is corrupt as well (the header hash cannot be computed over it)', async () => {
    const env = await exportedEnvelope();
    const evil = JSON.stringify(env).replace(/"lotValue":\s*\d+/, '"lotValue":1e999');
    const r = await manager().importFile(utf8Encode(evil));
    expect(!r.ok && r.code).toBe('corrupt');
  });
});

describe('untrusted import — prototype pollution', () => {
  it('re-sealed __proto__ / constructor.prototype keys at every level import without polluting anything', async () => {
    const env = await exportedEnvelope();
    const p = env.payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    // JSON.parse creates OWN "__proto__" properties; build the same shape with defineProperty (Object.assign
    // would invoke the __proto__ setter — exactly the vector under test).
    const addEvil = (o: Record<string, unknown>) => {
      const own = (k: string, v: unknown) => Object.defineProperty(o, k, { value: v, enumerable: true, configurable: true, writable: true });
      own('__proto__', { polluted: true });
      own('constructor', { prototype: { polluted: true } });
      own('prototype', { polluted: true });
    };
    addEvil(p);
    for (const a of Object.values(p.agents as Record<string, Record<string, unknown>>)) addEvil(a);
    addEvil(p.household);
    const bytes = await reseal(env);
    expect(utf8DecodeStrict(bytes)).toContain('"__proto__"');
    const m = manager();
    const r = await m.importFile(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join('\n')).toMatch(/unsafe key/);
    const stored = canonicalJson(r.world);
    expect(stored).not.toMatch(/__proto__|"constructor"|"prototype"/);
    // And the re-saved slot loads cleanly afterwards (no key the loader would drop is stored).
    const again = await m.load(r.slotId!);
    expect(again.ok && again.warnings.some((w) => /unsafe key/.test(w))).toBe(false);
  });

  it('\\u-escaped spellings ("\\u005f\\u005fproto__") are recognised too', async () => {
    const env = await exportedEnvelope();
    const household = (env.payload as Record<string, Record<string, unknown>>).household;
    Object.defineProperty(household, '__proto__', { value: { polluted: true }, enumerable: true, configurable: true, writable: true });
    // Checksums are computed over the PARSED value, so swapping in the escaped spelling keeps them valid.
    const text = utf8DecodeStrict(await reseal(env)).replace('"__proto__"', '"\\u005f\\u005fproto__"');
    expect(text).toContain('\\u005f\\u005fproto__');
    const r = await manager().importFile(utf8Encode(text));
    expect(r.ok).toBe(true);
    if (r.ok) expect(canonicalJson(r.world)).not.toContain('polluted');
  });
});

describe('untrusted import — resource limits', () => {
  it('deep nesting: 129 levels is corrupt; 200 000 levels neither overflows the stack nor hangs', async () => {
    const env = await exportedEnvelope();
    const base = JSON.stringify(env);
    for (const depth of [129, 200_000]) {
      const deep = '['.repeat(depth) + ']'.repeat(depth);
      const evil = base.replace('"payload":{', `"payload":{"deep":${deep},`);
      const t0 = Date.now();
      const r = await manager().importFile(utf8Encode(evil));
      expect(!r.ok && r.code).toBe('corrupt');
      expect(Date.now() - t0).toBeLessThan(5_000);
    }
  });

  it('a file over the size cap is refused before parsing; so is a gzip bomb (bounded decompression)', async () => {
    const maxBytes = 256 * 1024;
    const big = new Uint8Array(maxBytes + 1).fill(0x20);
    big[0] = 0x7b; // '{'
    const r1 = await manager({ maxBytes }).importFile(big);
    expect(!r1.ok && r1.code).toBe('invalid');
    // 8 MiB of spaces gzips to ~8 KB: far under the file cap, far over the decompressed cap.
    const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 0x20));
    expect(bomb.byteLength).toBeLessThan(maxBytes);
    const r2 = await manager({ maxBytes }).importFile(new Uint8Array(bomb));
    expect(!r2.ok && r2.code).toBe('invalid');
    expect(!r2.ok && r2.error).toMatch(/exceeds/);
  });

  it('non-JSON, truncated, binary and invalid-UTF-8 files are corrupt, never exceptions', async () => {
    const env = await exportedEnvelope();
    const good = utf8Encode(JSON.stringify(env));
    const cases = [
      good.slice(0, good.length >> 1),
      new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
      utf8Encode('[1,2,3]'),
      utf8Encode('null'),
      utf8Encode('{"format":"afterlife-lease-save"}'),
      new Uint8Array(4096).map((_, i) => (i * 131) & 0xff),
    ];
    for (const c of cases) {
      const r = await manager().importFile(c);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['corrupt', 'invalid']).toContain(r.code);
    }
  });
});

describe('untrusted import — meta and thumbnails (shown in the load menu)', () => {
  it('re-sealed hostile thumbnails become null with a warning; a small base64 PNG survives', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const bad = [
      'javascript:alert(1)',
      'https://evil.example/pixel.png',
      'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/png;base64,AAAA"><img src=x onerror=alert(1)>',
      'data:image/png,%89PNG',
      `data:image/png;base64,${'A'.repeat(70 * 1024)}`,
      42,
      { src: png },
    ];
    for (const thumb of [...bad, png]) {
      const env = await exportedEnvelope();
      (env.meta as Record<string, unknown>).thumbnail = thumb;
      const r = await manager().importFile(await reseal(env));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      if (thumb === png) expect(r.info.meta.thumbnail).toBe(png);
      else {
        expect(r.info.meta.thumbnail).toBeNull();
        expect(r.warnings.join('\n')).toMatch(/thumbnail dropped/);
      }
    }
  });

  it('re-sealed hostile meta is coerced: lengths capped, control/bidi characters stripped, numbers finite', async () => {
    const env = await exportedEnvelope();
    env.meta = {
      householdName: '‮evil\u0000' + 'n'.repeat(10_000),
      memberNames: Array.from({ length: 1000 }, (_, i) => `m${i}`),
      day: -50,
      timeLabel: { toString: 'x' },
      funds: 1e308,
      lotValue: 'a lot',
      thumbnail: null,
    };
    env.name = '\u0007'.repeat(10) + 'Name';
    env.playMinutes = -1;
    env.savedAt = 'yesterday';
    const r = await manager().importFile(await reseal(env));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meta = r.info.meta;
    expect(meta.householdName.startsWith('evil')).toBe(true);
    expect(meta.householdName.length).toBeLessThanOrEqual(64);
    expect(meta.memberNames.length).toBeLessThanOrEqual(8);
    expect(meta.day).toBe(0);
    expect(meta.timeLabel).toBe('');
    expect(Number.isFinite(meta.funds) && Number.isFinite(meta.lotValue)).toBe(true);
    expect(r.info.name).toBe('Name');
    expect(r.info.playMinutes).toBe(0);
  });
});
