import { describe, it, expect } from 'vitest';
import { thumbKey, normalizeTint, isValidModelId, BoundedCache } from '../../../src/render/thumbs/thumbKey';

describe('thumbnail cache keys', () => {
  it('equivalent tints share a key', () => {
    expect(thumbKey('sofa_velvet', '#4B1F3A')).toBe('sofa_velvet|#4b1f3a');
    expect(thumbKey('sofa_velvet', '4b1f3a')).toBe('sofa_velvet|#4b1f3a');
    expect(thumbKey('chair_creaky', '#abc')).toBe('chair_creaky|#aabbcc');
    expect(thumbKey('chair_creaky', ' #AABBCC ')).toBe('chair_creaky|#aabbcc');
  });

  it('no tint / null / invalid tint all map to the untinted key', () => {
    const k = 'lamp_skull|';
    expect(thumbKey('lamp_skull')).toBe(k);
    expect(thumbKey('lamp_skull', null)).toBe(k);
    expect(thumbKey('lamp_skull', '')).toBe(k);
    expect(thumbKey('lamp_skull', 'red')).toBe(k);
    expect(thumbKey('lamp_skull', '#12345')).toBe(k);
    expect(thumbKey('lamp_skull', 0xff0000)).toBe(k);
  });

  it('different models / tints get different keys', () => {
    const keys = new Set([thumbKey('a', '#000000'), thumbKey('a', '#000001'), thumbKey('b', '#000000'), thumbKey('a')]);
    expect(keys.size).toBe(4);
  });

  it('rejects unusable model ids', () => {
    for (const bad of ['', null, undefined, 3, {}, 'has space', 'a|b', 'x'.repeat(65), '../../etc']) {
      expect(thumbKey(bad)).toBeNull();
    }
    expect(isValidModelId('env_house_a')).toBe(true);
    expect(isValidModelId('door-1.v2')).toBe(true);
  });

  it('normalizeTint', () => {
    expect(normalizeTint('#FFF')).toBe('#ffffff');
    expect(normalizeTint('#000000')).toBe('#000000');
    expect(normalizeTint('#0000001')).toBeNull();
    expect(normalizeTint(undefined)).toBeNull();
  });
});

describe('BoundedCache', () => {
  it('evicts the least recently used entry beyond capacity', () => {
    const c = new BoundedCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1); // a is now most recent
    c.set('c', 3);
    expect(c.has('b')).toBe(false);
    expect(c.has('a')).toBe(true);
    expect(c.size).toBe(2);
  });

  it('re-setting a key does not grow the cache', () => {
    const c = new BoundedCache<string>(3);
    for (let i = 0; i < 100; i++) c.set('k', String(i));
    expect(c.size).toBe(1);
    expect(c.get('k')).toBe('99');
  });

  it('garbage capacity becomes 1; delete / clear work', () => {
    const c = new BoundedCache<number>(NaN);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.size).toBe(1);
    expect(c.delete('b')).toBe(true);
    c.set('x', 5);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get('x')).toBeUndefined();
  });
});
