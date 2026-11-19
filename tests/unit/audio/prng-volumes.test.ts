import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, toSeed } from '../../../src/audio/prng';
import {
  DEFAULT_VOLUMES, VOLUME_KEYS, mergeVolumes, readSpatial, sanitizeMultiplier, sanitizePan, sanitizeSpatialGain,
  sanitizeVolume, volumeToGain,
} from '../../../src/audio/volumes';

describe('audio prng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    const sc = Array.from({ length: 50 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) expect(v >= 0 && v < 1).toBe(true);
  });

  it('accepts hostile seeds without producing NaN', () => {
    for (const seed of [NaN, Infinity, -Infinity, -1, 0.5, 1e300, -0, 'zombie', {}, null, undefined, true]) {
      const r = createRng(seed);
      for (let i = 0; i < 20; i++) {
        const v = r.next();
        expect(Number.isFinite(v)).toBe(true);
        expect(v >= 0 && v < 1).toBe(true);
      }
      expect(Number.isFinite(toSeed(seed))).toBe(true);
    }
  });

  it('range/int/vary/jitter stay in bounds; int handles inverted/NaN bounds', () => {
    const r = createRng(7);
    for (let i = 0; i < 2000; i++) {
      const x = r.range(-3, 5);
      expect(x >= -3 && x < 5).toBe(true);
      const n = r.int(2, 6);
      expect(Number.isInteger(n) && n >= 2 && n <= 6).toBe(true);
      const v = r.vary(100, 0.05);
      expect(v >= 95 && v <= 105).toBe(true);
      const j = r.jitter(2);
      expect(j >= -2 && j <= 2).toBe(true);
    }
    expect(r.int(5, 1)).toBe(5);
    expect(r.int(NaN, NaN)).toBe(0);
    expect(r.pick([] as number[])).toBeUndefined();
  });

  it('distribution is roughly uniform (sanity, not a stats suite)', () => {
    const r = createRng(1234);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) buckets[Math.floor(r.next() * 10)]++;
    for (const b of buckets) expect(b).toBeGreaterThan(1700);
  });

  it('hashSeed is order sensitive and stable', () => {
    expect(hashSeed('a', 1)).toBe(hashSeed('a', 1));
    expect(hashSeed('a', 1)).not.toBe(hashSeed(1, 'a'));
    expect(hashSeed()).toBe(hashSeed());
  });

  it('state round-trips', () => {
    const r = createRng(99);
    r.next();
    const s = r.getState();
    const x = r.next();
    r.setState(s);
    expect(r.next()).toBe(x);
  });
});

describe('audio volumes', () => {
  it('clamps NaN / negative / >1 / infinities / non-numbers', () => {
    expect(sanitizeVolume(NaN, 0.3)).toBe(0.3);
    expect(sanitizeVolume(-1, 0.3)).toBe(0);
    expect(sanitizeVolume(-0, 0.3)).toBe(0);
    expect(sanitizeVolume(2, 0.3)).toBe(1);
    expect(sanitizeVolume(Infinity, 0.3)).toBe(1);
    expect(sanitizeVolume(-Infinity, 0.3)).toBe(0);
    expect(sanitizeVolume('0.5', 0.3)).toBe(0.3);
    expect(sanitizeVolume(null, 0.3)).toBe(0.3);
    expect(sanitizeVolume(0.42, 0.3)).toBe(0.42);
  });

  it('merges partial patches and ignores junk', () => {
    const base = { ...DEFAULT_VOLUMES };
    const m = mergeVolumes(base, { music: 2, sfx: NaN, voice: -3, ui: 0.25, bogus: 1 } as unknown);
    expect(m.music).toBe(1);
    expect(m.sfx).toBe(base.sfx);
    expect(m.voice).toBe(0);
    expect(m.ui).toBe(0.25);
    expect(m.master).toBe(base.master);
    expect(Object.keys(m).sort()).toEqual([...VOLUME_KEYS].sort());
    expect(mergeVolumes(base, null)).toEqual(base);
    expect(mergeVolumes(base, 'loud')).toEqual(base);
    expect(mergeVolumes(base, 7)).toEqual(base);
    // returns a copy, never the same object
    expect(mergeVolumes(base, {})).not.toBe(base);
  });

  it('survives hostile getters', () => {
    const evil = Object.defineProperty({}, 'music', { get() { throw new Error('boom'); }, enumerable: true });
    const m = mergeVolumes(DEFAULT_VOLUMES, evil);
    expect(m.music).toBe(DEFAULT_VOLUMES.music);
  });

  it('volumeToGain is a monotonic squared taper in [0,1]', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(NaN)).toBe(0);
    expect(volumeToGain(5)).toBe(1);
    let prev = -1;
    for (let v = 0; v <= 1; v += 0.05) {
      const g = volumeToGain(v);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it('sanitises spatial hints and multipliers', () => {
    expect(sanitizePan(NaN)).toBe(0);
    expect(sanitizePan(-7)).toBe(-1);
    expect(sanitizePan(Infinity)).toBe(1);
    expect(sanitizeSpatialGain(NaN)).toBe(1);
    expect(sanitizeSpatialGain(Infinity)).toBe(1);
    expect(sanitizeSpatialGain(-2)).toBe(0);
    const out = { pan: 9, gain: 9 };
    readSpatial(undefined, out);
    expect(out).toEqual({ pan: 0, gain: 1 });
    readSpatial({ pan: 0.5, gain: 0.25 }, out);
    expect(out).toEqual({ pan: 0.5, gain: 0.25 });
    readSpatial({ pan: 'left', gain: null }, out);
    expect(out).toEqual({ pan: 0, gain: 1 });
    const evil = Object.defineProperty({}, 'pan', { get() { throw new Error('x'); } });
    readSpatial(evil, out);
    expect(out).toEqual({ pan: 0, gain: 1 });
    expect(sanitizeMultiplier(NaN, 1, 0.25, 4)).toBe(1);
    expect(sanitizeMultiplier(-2, 1, 0.25, 4)).toBe(1);
    expect(sanitizeMultiplier(0, 1, 0.25, 4)).toBe(1);
    expect(sanitizeMultiplier(100, 1, 0.25, 4)).toBe(4);
    expect(sanitizeMultiplier(0.01, 1, 0.25, 4)).toBe(0.25);
  });
});
