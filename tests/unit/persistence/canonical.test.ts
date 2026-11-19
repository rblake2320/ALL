import { describe, expect, it } from 'vitest';
import { canonicalJson, CanonicalJsonError } from '../../../src/persistence/canonicalJson';
import { sha256Hex, sha256HexSync } from '../../../src/persistence/sha256';
import { base64ToBytes, bytesToBase64, utf8DecodeStrict, utf8Encode } from '../../../src/persistence/bytes';
import { makeWorld, prng } from './fixtures';

function shuffleKeys(v: unknown, rnd: () => number): unknown {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, rnd));
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of entries) out[k] = shuffleKeys(x, rnd);
    return out;
  }
  return v;
}

describe('canonicalJson — determinism', () => {
  it('is independent of key insertion order (deeply)', () => {
    const w = makeWorld();
    const base = canonicalJson(w);
    const rnd = prng(42);
    for (let i = 0; i < 25; i++) expect(canonicalJson(shuffleKeys(w, rnd))).toBe(base);
  });

  it('is a fixed point under parse/serialize and equals JSON semantics', () => {
    const w = makeWorld(3);
    const c = canonicalJson(w);
    expect(canonicalJson(JSON.parse(c))).toBe(c);
    expect(JSON.parse(c)).toEqual(JSON.parse(JSON.stringify(w)));
  });

  it('sorts keys by code unit (numeric-looking keys are NOT special)', () => {
    expect(canonicalJson({ b: 1, a: 2, '10': 3, '2': 4, B: 5 })).toBe('{"10":3,"2":4,"B":5,"a":2,"b":1}');
  });

  it('handles awkward but legal values', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson({ s: '\u0000\n"\\  ünï 💀', e: [], o: {}, n: null })).toBe('{"e":[],"n":null,"o":{},"s":"\\u0000\\n\\"\\\\  ünï 💀"}');
    // lone surrogates are escaped by well-formed JSON.stringify and round-trip
    const lone = canonicalJson({ x: '\ud800' });
    expect(canonicalJson(JSON.parse(lone))).toBe(lone);
    expect(canonicalJson(Object.create(null))).toBe('{}');
    expect(canonicalJson(1e21)).toBe('1e+21');
    expect(canonicalJson(5e-324)).toBe('5e-324');
  });

  it('shared (non-cyclic) references are fine', () => {
    const shared = { k: 1 };
    expect(canonicalJson({ a: shared, b: shared, c: [shared, shared] })).toBe('{"a":{"k":1},"b":{"k":1},"c":[{"k":1},{"k":1}]}');
  });

  it('pretty mode keeps canonical order and parses back identically', () => {
    const w = makeWorld();
    const pretty = canonicalJson(w, { indent: 2 });
    expect(pretty).toContain('\n  "agents": {');
    expect(canonicalJson(JSON.parse(pretty))).toBe(canonicalJson(w));
  });
});

describe('canonicalJson — rejects values that would not round-trip', () => {
  const cases: [string, unknown, RegExp][] = [
    ['NaN', { a: { b: NaN } }, /non-finite number \(NaN\) at \$\.a\.b/],
    ['Infinity', [1, Infinity], /non-finite number \(Infinity\) at \$\[1\]/],
    ['-Infinity', { x: -Infinity }, /non-finite/],
    ['undefined prop', { a: undefined }, /undefined value at \$\.a/],
    ['undefined element', [undefined], /undefined array element at \$\[0\]/],
    ['function', { f: () => 1 }, /function value at \$\.f/],
    ['symbol', { s: Symbol('x') }, /symbol value/],
    ['bigint', { n: 10n }, /bigint value/],
    ['Date', { d: new Date(0) }, /non-plain object \(Date\)/],
    ['Map', { m: new Map() }, /non-plain object \(Map\)/],
    ['Set', { s: new Set() }, /non-plain object \(Set\)/],
    ['typed array', { t: new Uint8Array(2) }, /non-plain object \(Uint8Array\)/],
    ['class instance', { c: new (class Foo {})() }, /non-plain object \(Foo\)/],
    ['toJSON trap', { t: { toJSON: () => 'x' } }, /function value at \$\.t\.toJSON/],
    ['weird key path', { 'a b': { 'c.d': NaN } }, /at \$\["a b"\]\["c\.d"\]/],
  ];
  for (const [name, value, re] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
      expect(() => canonicalJson(value)).toThrow(re);
    });
  }

  it('rejects sparse arrays', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(() => canonicalJson([1, , 3])).toThrow(/sparse array hole at \$\[1\]/);
  });

  it('rejects cycles (object and array) with a path', () => {
    const o: Record<string, unknown> = { a: { b: {} } };
    (o.a as Record<string, Record<string, unknown>>).b.back = o;
    expect(() => canonicalJson(o)).toThrow(/circular reference at \$\.a\.b\.back/);
    const arr: unknown[] = [];
    arr.push(arr);
    expect(() => canonicalJson(arr)).toThrow(/circular reference at \$\[0\]/);
  });

  it('rejects excessive depth instead of overflowing the stack', () => {
    let deep: unknown = 0;
    for (let i = 0; i < 300; i++) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow(/nesting deeper than 256/);
    expect(canonicalJson(deep, { maxDepth: 400 })).toMatch(/^\[{300}0\]{300}$/);
  });

  it("'omit' mode drops undefined properties but still rejects undefined elements", () => {
    expect(canonicalJson({ a: undefined, b: 1 }, { undefinedProps: 'omit' })).toBe('{"b":1}');
    expect(() => canonicalJson([undefined], { undefinedProps: 'omit' })).toThrow(/undefined array element/);
  });
});

describe('sha256', () => {
  it('matches known vectors (WebCrypto and pure JS)', async () => {
    const vectors: [string, string][] = [
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ];
    for (const [input, hex] of vectors) {
      expect(await sha256Hex(input)).toBe(hex);
      expect(sha256HexSync(input)).toBe(hex);
    }
  });

  it('pure-JS fallback agrees with WebCrypto on random inputs of every padding length', async () => {
    const rnd = prng(7);
    for (let len = 0; len < 200; len += 1) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = Math.floor(rnd() * 256);
      expect(sha256HexSync(bytes)).toBe(await sha256Hex(bytes));
    }
    const big = new Uint8Array(1_000_003).map((_, i) => (i * 31) & 255);
    expect(sha256HexSync(big)).toBe(await sha256Hex(big));
  });

  it('hashes views over larger buffers correctly (no buffer over-read)', async () => {
    const buf = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
    const view = buf.subarray(2, 5);
    expect(await sha256Hex(view)).toBe(await sha256Hex(new Uint8Array([1, 2, 3])));
  });

  it('falls back to pure JS when crypto.subtle is missing (insecure context)', async () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
    try {
      expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    } finally {
      if (desc) Object.defineProperty(globalThis, 'crypto', desc);
    }
  });
});

describe('bytes helpers', () => {
  it('base64 round-trips every length and rejects malformed input', () => {
    const rnd = prng(3);
    for (let len = 0; len < 70; len++) {
      const b = new Uint8Array(len).map(() => Math.floor(rnd() * 256));
      const s = bytesToBase64(b);
      expect(s).toBe(Buffer.from(b).toString('base64'));
      expect(Array.from(base64ToBytes(s) ?? [])).toEqual(Array.from(b));
    }
    for (const bad of ['a', 'ab=c', '====', 'ab!d', 'abc=abcd', 'é===', 'ab\ncd']) expect(base64ToBytes(bad)).toBeNull();
  });

  it('strict UTF-8 decoding throws on invalid sequences and strips a BOM', () => {
    expect(() => utf8DecodeStrict(new Uint8Array([0xc3, 0x28]))).toThrow();
    expect(() => utf8DecodeStrict(new Uint8Array([0xff]))).toThrow();
    expect(utf8DecodeStrict(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toBe('{}');
    expect(utf8DecodeStrict(utf8Encode('💀 Ñ'))).toBe('💀 Ñ');
  });
});
