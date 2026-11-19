import { afterEach, describe, expect, it } from 'vitest';
import { measureJsonDepth, sanitizeParse, sanitizeParseDetailed, SanitizeError } from '../../../src/persistence/sanitize';
import { reconcile } from '../../../src/persistence/profileStore';

function assertPrototypesClean(): void {
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  expect((Array.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
}

afterEach(() => {
  delete (Object.prototype as Record<string, unknown>).polluted;
});

describe('sanitizeParse — prototype pollution', () => {
  const payloads = [
    '{"__proto__":{"polluted":true}}',
    '{"a":{"__proto__":{"polluted":true}}}',
    '{"constructor":{"prototype":{"polluted":true}}}',
    '{"a":[{"__proto__":{"polluted":1}}]}',
    '{"\\u005f_proto__":{"polluted":true}}', // escaped spelling
    '{"\\u005f\\u005fproto\\u005f\\u005f":{"polluted":true}}',
    '{"prototype":{"polluted":true}}',
  ];
  for (const p of payloads) {
    it(`drops forbidden keys in ${p}`, () => {
      const r = sanitizeParseDetailed(p);
      expect(r.droppedKeys).toBeGreaterThan(0);
      const v = r.value as Record<string, unknown>;
      // The dangerous patterns: spread / Object.assign / naive deep merge of the parsed value.
      const spread = { ...v };
      const assigned = Object.assign({}, v);
      const merged: Record<string, unknown> = {};
      const deepMerge = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
        for (const k of Object.keys(src)) {
          const sv = src[k];
          if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
            if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
            deepMerge(dst[k] as Record<string, unknown>, sv as Record<string, unknown>);
          } else dst[k] = sv;
        }
      };
      deepMerge(merged, v);
      void spread;
      void assigned;
      assertPrototypesClean();
      expect(Object.keys(JSON.parse(JSON.stringify(v)))).not.toContain('__proto__');
      expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    });
  }

  it('control: plain JSON.parse keeps an own __proto__ key (which is what a merge would weaponize)', () => {
    const raw = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(raw, '__proto__')).toBe(true);
    const sanitized = sanitizeParse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(sanitized, '__proto__')).toBe(false);
  });

  it('keeps look-alike keys and strings untouched', () => {
    const v = sanitizeParse('{"proto":1,"__proto":2,"constructors":3,"s":"__proto__","arr":["constructor"]}');
    expect(v).toEqual({ proto: 1, __proto: 2, constructors: 3, s: '__proto__', arr: ['constructor'] });
  });

  it('profile reconcile cannot be used to pollute either', () => {
    const stored = sanitizeParse('{"volumes":{"__proto__":{"polluted":true},"master":0.5}}');
    const out = reconcile({ volumes: { master: 1, music: 1 } }, stored);
    expect(out).toEqual({ volumes: { master: 0.5, music: 1 } });
    assertPrototypesClean();
  });
});

describe('sanitizeParse — caps and errors', () => {
  it('enforces the size cap before parsing', () => {
    expect(() => sanitizeParse('[' + '1,'.repeat(1000) + '1]', { maxChars: 100 })).toThrow(SanitizeError);
    try {
      sanitizeParse('x'.repeat(101), { maxChars: 100 });
    } catch (e) {
      expect((e as SanitizeError).code).toBe('too_large');
    }
  });

  it('enforces the depth cap without recursion (100k nesting does not blow the stack)', () => {
    const deep = '['.repeat(100_000) + ']'.repeat(100_000);
    expect(() => sanitizeParse(deep)).toThrow(/nesting exceeds 128/);
    expect(() => sanitizeParse('{"a":'.repeat(129) + '1' + '}'.repeat(129))).toThrow(SanitizeError);
    expect(sanitizeParse('{"a":'.repeat(128) + '1' + '}'.repeat(128))).toBeTruthy();
  });

  it('depth scan ignores brackets inside strings and escaped quotes', () => {
    expect(measureJsonDepth('{"a":"[[[[{{{{\\"]]]]"}')).toBe(1);
    expect(measureJsonDepth('[[1],[2,[3]]]')).toBe(3);
  });

  it('reports syntax errors as SanitizeError(syntax)', () => {
    for (const bad of ['', '{', '{"a":1,}', 'NaN', '{"a":01}', '\u0000', '{"a":1}garbage']) {
      try {
        sanitizeParse(bad);
        throw new Error('expected failure for ' + JSON.stringify(bad));
      } catch (e) {
        expect(e).toBeInstanceOf(SanitizeError);
        expect((e as SanitizeError).code).toBe('syntax');
      }
    }
  });

  it('rejects non-string input', () => {
    expect(() => sanitizeParse(42 as unknown as string)).toThrow(SanitizeError);
  });
});
