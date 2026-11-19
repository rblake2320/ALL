import { describe, it, expect } from 'vitest';
import { environmentIntensity } from '../../../src/render/lighting/lighting';
import { sampleLighting, createLightingSample, LIGHT_KEYS, keyIndexAt, lampsOn, fullMoonTonight, type LightingSample } from '../../../src/render/lighting/keyframes';
import { timeInfo } from '../../../src/sim/time';
import { TICK_MINUTES } from '../../../src/sim/types';

function sample(m: number, moon = 0): LightingSample {
  return sampleLighting(m, moon, createLightingSample());
}

function finiteSample(s: LightingSample): boolean {
  const nums = [s.keyIntensity, s.keyAzimuth, s.keyElevation, s.hemiIntensity, s.fogDensity, s.stars, s.moon, s.windowGlow, s.lamps, s.exposure, s.night, s.moonTint, s.moonSize];
  const cols = [s.keyColor, s.hemiSky, s.hemiGround, s.fogColor, s.skyZenith, s.skyHorizon].flat();
  return nums.concat(cols).every((v) => Number.isFinite(v));
}

describe('lighting keyframes', () => {
  it('table is sorted, starts at midnight and covers the day', () => {
    for (let i = 1; i < LIGHT_KEYS.length; i++) expect(LIGHT_KEYS[i].t).toBeGreaterThan(LIGHT_KEYS[i - 1].t);
    expect(LIGHT_KEYS[0].t).toBe(0);
    expect(LIGHT_KEYS[LIGHT_KEYS.length - 1].t).toBeLessThan(1440);
  });

  it('samples exactly the keyframe values at key times', () => {
    for (const k of LIGHT_KEYS) {
      const s = sample(k.t);
      expect(s.keyIntensity).toBeCloseTo(k.keyIntensity, 9);
      expect(s.keyColor[0]).toBeCloseTo(k.keyColor[0], 9);
      expect(s.night).toBeCloseTo(k.night, 9);
    }
  });

  it('noon is bright day; midnight is night with stars, moon, glowing windows and lamps on', () => {
    const noon = sample(12 * 60);
    expect(noon.night).toBe(0);
    expect(noon.stars).toBe(0);
    expect(lampsOn(noon)).toBe(false);
    expect(noon.keyIntensity).toBeGreaterThan(2);
    const mid = sample(0);
    expect(mid.night).toBe(1);
    expect(mid.stars).toBe(1);
    expect(mid.windowGlow).toBe(1);
    expect(lampsOn(mid)).toBe(true);
    expect(mid.keyIntensity).toBeLessThan(noon.keyIntensity);
  });

  it('dusk is warm (red > blue) and lamps come on', () => {
    const dusk = sample(1125);
    expect(dusk.keyColor[0]).toBeGreaterThan(dusk.keyColor[2]);
    expect(lampsOn(dusk)).toBe(true);
  });

  it('wraps smoothly at midnight (23:59.9 ≈ 00:00)', () => {
    const a = sample(1439.99);
    const b = sample(0);
    expect(a.keyIntensity).toBeCloseTo(b.keyIntensity, 3);
    expect(a.fogColor[2]).toBeCloseTo(b.fogColor[2], 3);
    // interpolation across the wrap segment (last key → first key + 1440) stays within both endpoints
    const last = LIGHT_KEYS[LIGHT_KEYS.length - 1];
    const mid = sample((last.t + 1440) / 2);
    const lo = Math.min(last.keyIntensity, LIGHT_KEYS[0].keyIntensity) - 1e-9;
    const hi = Math.max(last.keyIntensity, LIGHT_KEYS[0].keyIntensity) + 1e-9;
    expect(mid.keyIntensity).toBeGreaterThanOrEqual(lo);
    expect(mid.keyIntensity).toBeLessThanOrEqual(hi);
  });

  it('out-of-range minutes wrap (negative, > 1 day)', () => {
    expect(sample(-60).keyIntensity).toBeCloseTo(sample(1380).keyIntensity, 9);
    expect(sample(1440 * 5 + 750).keyIntensity).toBeCloseTo(sample(750).keyIntensity, 9);
  });

  it('is continuous: no jumps between consecutive minutes anywhere in the day', () => {
    let prev = sample(0);
    for (let m = 0.5; m <= 1440; m += 0.5) {
      const s = sample(m);
      expect(Math.abs(s.keyIntensity - prev.keyIntensity)).toBeLessThan(0.1);
      expect(Math.abs(s.hemiIntensity - prev.hemiIntensity)).toBeLessThan(0.05);
      expect(Math.abs(s.fogColor[0] - prev.fogColor[0])).toBeLessThan(0.05);
      prev = s;
    }
  });

  it('full moon tints the night green and enlarges the moon, but not the day', () => {
    const plain = sample(60, 0);
    const moon = sample(60, 1);
    expect(moon.moonTint).toBeGreaterThan(0.9);
    expect(moon.keyColor[1]).toBeGreaterThan(plain.keyColor[1]);
    expect(moon.keyColor[1] - moon.keyColor[2]).toBeGreaterThan(plain.keyColor[1] - plain.keyColor[2]);
    expect(moon.moonSize).toBeGreaterThan(1.3);
    const noonMoon = sample(720, 1);
    expect(noonMoon.moonTint).toBe(0);
    expect(noonMoon.keyColor).toEqual(sample(720, 0).keyColor);
  });

  it('keyIndexAt picks the key at or before the minute', () => {
    expect(keyIndexAt(0)).toBe(0);
    expect(LIGHT_KEYS[keyIndexAt(700)].t).toBeLessThanOrEqual(700);
    expect(keyIndexAt(1439)).toBe(LIGHT_KEYS.length - 1);
  });

  describe('adversarial', () => {
    it('NaN / Infinity minutes act like noon; NaN moon like no moon; output always finite', () => {
      const s = sample(NaN, NaN);
      expect(s.keyIntensity).toBeCloseTo(sample(720).keyIntensity, 9);
      expect(finiteSample(s)).toBe(true);
      expect(finiteSample(sample(Infinity, Infinity))).toBe(true);
      expect(finiteSample(sample(-1e12, -5))).toBe(true);
      expect(sample(60, 99).moonTint).toBeLessThanOrEqual(1);
    });

    it('reuses the output object (no allocation per sample)', () => {
      const out = createLightingSample();
      const a = sampleLighting(100, 0, out);
      const b = sampleLighting(900, 0, out);
      expect(a).toBe(b);
      expect(a.keyColor).toBe(b.keyColor);
    });
  });
});

describe('full-moon calendar matches src/sim/time.ts', () => {
  it('agrees with timeInfo().fullMoon at night for two weeks of ticks', () => {
    for (let tick = 0; tick < 5760 * 15; tick += 120) {
      const ti = timeInfo(tick);
      if (!ti.isNight) continue;
      expect(fullMoonTonight(ti.totalMinutes)).toBe(ti.fullMoon ? 1 : 0);
    }
  });

  it('garbage input → 0', () => {
    expect(fullMoonTonight(NaN)).toBe(0);
    expect(fullMoonTonight(Infinity)).toBe(0);
    expect(TICK_MINUTES).toBeGreaterThan(0);
  });
});

describe('environment map intensity (decision #14b)', () => {
  it('≈0.35 by day, 0.12 at night, monotone in between, from the keyed night factor', () => {
    expect(environmentIntensity(0)).toBeCloseTo(0.35, 6);
    expect(environmentIntensity(1)).toBeCloseTo(0.12, 6);
    let prev = Infinity;
    for (let n = 0; n <= 1.0001; n += 0.05) {
      const v = environmentIntensity(n);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    expect(environmentIntensity(sampleLighting(720, 0).night)).toBeCloseTo(0.35, 6);
    expect(environmentIntensity(sampleLighting(0, 0).night)).toBeCloseTo(0.12, 6);
  });

  it('adversarial: NaN / out-of-range night factors clamp', () => {
    expect(environmentIntensity(NaN)).toBeCloseTo(0.35, 6);
    expect(environmentIntensity(-3)).toBeCloseTo(0.35, 6);
    expect(environmentIntensity(9)).toBeCloseTo(0.12, 6);
  });
});
