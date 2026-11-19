import { describe, it, expect } from 'vitest';
import { computeVisualState, createVisualState, isCandleLight, visualStateEquals } from '../../../src/render/objects/visualState';
import { selectLamps, type LampCandidate } from '../../../src/render/lighting/lampPool';
import { qualitySettings, effectivePixelRatio, QUALITY_LEVELS } from '../../../src/render/core/quality';
import { rayAabb, rayCapsule, rayPlaneY, raySphere } from '../../../src/render/picking/rayMath';
import { clamp, dampFactor, wrapAngle, parseHexColor, mulberry32, hashString, mod } from '../../../src/render/core/math';
import { ThrottledWarn, FpsMeter } from '../../../src/render/core/diagnostics';
import { PHYSICAL_BY_ID } from '../../../src/shared/catalog';
import type { ObjectState } from '../../../src/sim/types';

function obj(p: Partial<ObjectState> = {}): ObjectState {
  return {
    id: 'o1',
    defId: 'lamp_skull',
    placement: { kind: 'floor', x: 1, z: 1, rot: 0 },
    value: 0,
    purchasedTick: 0,
    tint: null,
    condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 },
    data: {},
    reservedBy: {},
    inUseBy: [],
    rev: 1,
    ...p,
  };
}
const ENV = { utilitiesOn: true, lampsOn: true, billsOutstanding: false };

describe('object visual state', () => {
  it('powered lamps glow at night only with utilities on and not broken', () => {
    const spec = PHYSICAL_BY_ID.lamp_skull;
    const s = computeVisualState(obj(), spec, ENV, createVisualState());
    expect(s.powered).toBe(true);
    expect(s.lit).toBe(true);
    expect(computeVisualState(obj(), spec, { ...ENV, lampsOn: false }, createVisualState()).lit).toBe(false);
    const off = computeVisualState(obj(), spec, { ...ENV, utilitiesOn: false }, createVisualState());
    expect(off.powered).toBe(false);
    expect(off.lit).toBe(false);
    const broken = computeVisualState(obj({ condition: { broken: true, dirt: 0, burning: false, burnMinutes: 0 } }), spec, ENV, createVisualState());
    expect(broken.powered).toBe(false);
    expect(broken.broken).toBe(true);
    expect(broken.lit).toBe(false);
    expect(computeVisualState(obj({ data: { off: true } }), spec, ENV, createVisualState()).lit).toBe(false);
  });

  it('candles glow without power; non-power objects always count as powered', () => {
    const spec = PHYSICAL_BY_ID.candelabra_drippy;
    expect(isCandleLight(spec)).toBe(true);
    const s = computeVisualState(obj({ defId: 'candelabra_drippy' }), spec, { ...ENV, utilitiesOn: false }, createVisualState());
    expect(s.powered).toBe(true);
    expect(s.lit).toBe(true);
    const chair = computeVisualState(obj({ defId: 'chair_creaky' }), PHYSICAL_BY_ID.chair_creaky, { ...ENV, utilitiesOn: false }, createVisualState());
    expect(chair.powered).toBe(true);
    expect(chair.lit).toBe(false); // no light spec
  });

  it('mailbox flag: mail waiting or bills outstanding', () => {
    const spec = PHYSICAL_BY_ID.mailbox_crooked;
    expect(computeVisualState(obj({ data: { mail: 2 } }), spec, ENV, createVisualState()).flag).toBe(true);
    expect(computeVisualState(obj(), spec, { ...ENV, billsOutstanding: true }, createVisualState()).flag).toBe(true);
    expect(computeVisualState(obj(), spec, ENV, createVisualState()).flag).toBe(false);
    // non-mailboxes never show a flag
    expect(computeVisualState(obj({ data: { mail: 5 } }), PHYSICAL_BY_ID.chair_creaky, { ...ENV, billsOutstanding: true }, createVisualState()).flag).toBe(false);
  });

  it('servings / progress / dirt are clamped; inUse & burning mirror the state', () => {
    const s = computeVisualState(
      obj({ data: { servings: 6, progress: 3 }, inUseBy: ['a1'], condition: { broken: false, dirt: 2, burning: true, burnMinutes: 3 } }),
      PHYSICAL_BY_ID.item_meal,
      ENV,
      createVisualState(),
    );
    expect(s.servings).toBe(4);
    expect(s.progress).toBe(1);
    expect(s.dirt).toBe(1);
    expect(s.inUse).toBe(true);
    expect(s.burning).toBe(true);
  });

  it('adversarial: garbage data, missing condition, null spec/object never throw', () => {
    const garbage = obj({ data: { servings: 'lots', progress: NaN, mail: 'yes', off: 'true' } as unknown as ObjectState['data'], condition: null as unknown as ObjectState['condition'], inUseBy: 'a1' as unknown as string[] });
    const s = computeVisualState(garbage, PHYSICAL_BY_ID.lamp_skull, ENV, createVisualState());
    expect(s.servings).toBe(0);
    expect(s.progress).toBe(0);
    expect(s.dirt).toBe(0);
    expect(s.inUse).toBe(false);
    expect(s.lit).toBe(true); // off must be === true
    expect(() => computeVisualState(null, null, ENV, createVisualState())).not.toThrow();
    const n = computeVisualState(undefined, undefined, ENV, createVisualState());
    expect(n.powered).toBe(true);
    expect(n.lit).toBe(false);
    expect(computeVisualState(obj({ data: { servings: -3 } }), null, ENV, createVisualState()).servings).toBe(0);
  });

  it('equality helper', () => {
    const a = createVisualState();
    const b = createVisualState();
    expect(visualStateEquals(a, b)).toBe(true);
    b.servings = 2;
    expect(visualStateEquals(a, b)).toBe(false);
  });
});

describe('lamp pool selection', () => {
  const out = new Int32Array(8);
  const scratch = new Float64Array(8);
  it('picks the nearest lamps to the target, nearest first, at most max', () => {
    const cands: LampCandidate[] = [];
    for (let i = 0; i < 20; i++) cands.push({ x: i, y: 1, z: 0, bias: 0 });
    const n = selectLamps(cands, cands.length, 10.2, 0, 4, out, scratch);
    expect(n).toBe(4);
    expect([...out.slice(0, 4)]).toEqual([10, 11, 9, 12]);
  });

  it('bias pushes street lamps behind lot lamps', () => {
    const cands: LampCandidate[] = [
      { x: 0, y: 4, z: 0, bias: 20 },
      { x: 5, y: 1, z: 0, bias: 0 },
    ];
    expect(selectLamps(cands, 2, 0, 0, 1, out, scratch)).toBe(1);
    expect(out[0]).toBe(1);
  });

  it('fewer candidates than lights, zero max, garbage entries', () => {
    const cands = [
      { x: 1, y: 1, z: 1, bias: 0 },
      { x: NaN, y: 1, z: 1, bias: 0 },
      null as unknown as LampCandidate,
      { x: 2, y: 1, z: 2, bias: NaN },
    ];
    expect(selectLamps(cands, 4, 0, 0, 8, out, scratch)).toBe(2);
    expect(selectLamps(cands, 4, 0, 0, 0, out, scratch)).toBe(0);
    expect(selectLamps(cands, 99, NaN, NaN, NaN, out, scratch)).toBe(0);
    expect(selectLamps([], 0, 0, 0, 8, out, scratch)).toBe(0);
    // max beyond the output buffer is clamped
    const many = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 0, z: 0, bias: 0 }));
    expect(selectLamps(many, 30, 0, 0, 100, out, scratch)).toBe(8);
  });
});

describe('quality presets', () => {
  it('match the brief', () => {
    const low = qualitySettings('low');
    expect(low.shadows).toBe(false);
    expect(low.bloom).toBe(false);
    expect(effectivePixelRatio('low', 3)).toBe(1);
    expect(qualitySettings('medium').shadowMapSize).toBe(1024);
    const high = qualitySettings('high');
    expect(high.shadowMapSize).toBe(2048);
    expect(high.softShadows && high.bloom && high.vignette).toBe(true);
    const ultra = qualitySettings('ultra');
    expect(ultra.shadowMapSize).toBe(4096);
    expect(effectivePixelRatio('ultra', 1)).toBeGreaterThan(1);
    expect(QUALITY_LEVELS.length).toBe(4);
  });

  it('garbage levels → high; garbage DPR → 1; huge canvases cap the pixel ratio', () => {
    expect(qualitySettings('extreme').level).toBe('high');
    expect(effectivePixelRatio('high', NaN)).toBe(1);
    expect(effectivePixelRatio('high', -2)).toBe(1);
    expect(effectivePixelRatio('high', 2, 8000, 8000)).toBeLessThan(1);
    const s = qualitySettings('low');
    s.shadows = true;
    expect(qualitySettings('low').shadows).toBe(false); // copies, not shared
  });
});

describe('ray math', () => {
  it('plane, box, sphere, capsule hits and misses', () => {
    expect(rayPlaneY(10, -1, 0)).toBe(10);
    expect(rayPlaneY(10, 1, 0)).toBe(Infinity);
    expect(rayPlaneY(10, 0, 0)).toBe(Infinity);
    expect(rayAabb(-5, 0.5, 0.5, 1, 0, 0, 0, 0, 0, 1, 1, 1)).toBeCloseTo(5);
    expect(rayAabb(-5, 2, 0.5, 1, 0, 0, 0, 0, 0, 1, 1, 1)).toBe(Infinity);
    expect(rayAabb(0.5, 0.5, 0.5, 1, 0, 0, 0, 0, 0, 1, 1, 1)).toBe(0); // inside
    expect(raySphere(0, 0, -5, 0, 0, 1, 0, 0, 0, 1)).toBeCloseTo(4);
    expect(raySphere(0, 3, -5, 0, 0, 1, 0, 0, 0, 1)).toBe(Infinity);
    // vertical capsule from y=0.3 to 1.5 radius 0.3 at origin, ray along +X at y=1
    expect(rayCapsule(-5, 1, 0, 1, 0, 0, 0, 0.3, 0, 0, 1.5, 0, 0.3)).toBeCloseTo(4.7);
    // hits the top cap sphere
    expect(rayCapsule(0, 5, 0, 0, -1, 0, 0, 0.3, 0, 0, 1.5, 0, 0.3)).toBeCloseTo(3.2);
    expect(rayCapsule(-5, 3, 0, 1, 0, 0, 0, 0.3, 0, 0, 1.5, 0, 0.3)).toBe(Infinity);
  });

  it('adversarial: degenerate capsules/rays and NaN radii', () => {
    expect(rayCapsule(-5, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.5)).toBeCloseTo(4.5); // zero-length = sphere
    expect(rayCapsule(-5, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, NaN)).toBe(Infinity);
    expect(rayCapsule(-5, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, -1)).toBe(Infinity);
    expect(raySphere(0, 0, 0, 0, 0, 0, 1, 1, 1, 1)).toBe(Infinity);
    expect(rayPlaneY(NaN, -1, 0)).toBe(Infinity);
  });
});

describe('math helpers', () => {
  it('clamp / damp / wrap / mod', () => {
    expect(clamp(NaN, 0, 1)).toBe(0);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(dampFactor(10, 0)).toBe(0);
    expect(dampFactor(10, NaN)).toBe(0);
    expect(dampFactor(Infinity, 0.016)).toBe(1);
    expect(dampFactor(-1, 0.016)).toBe(0);
    expect(dampFactor(10, 0.1)).toBeCloseTo(1 - Math.exp(-1));
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(-0.5)).toBeCloseTo(-0.5);
    expect(mod(-1, 4)).toBe(3);
  });

  it('hex colours', () => {
    expect(parseHexColor('#ff8000')).toBe(0xff8000);
    expect(parseHexColor('abc')).toBe(0xaabbcc);
    expect(parseHexColor('#ggg')).toBeNull();
    expect(parseHexColor(123)).toBeNull();
  });

  it('prng + hash are deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(hashString('wall')).toBe(hashString('wall'));
    expect(hashString('wall')).not.toBe(hashString('walk'));
  });
});

describe('diagnostics', () => {
  it('throttles repeated warnings per key', () => {
    let t = 0;
    const w = new ThrottledWarn(1000, () => t);
    const orig = console.warn;
    const logged: unknown[] = [];
    console.warn = (...a: unknown[]) => logged.push(a);
    try {
      expect(w.warn('k', 'first')).toBe(true);
      expect(w.warn('k', 'again')).toBe(false);
      expect(w.warn('other', 'x')).toBe(true);
      t = 1500;
      expect(w.warn('k', 'later')).toBe(true);
    } finally {
      console.warn = orig;
    }
    expect(logged.length).toBe(3);
  });

  it('fps meter smooths and ignores garbage', () => {
    const f = new FpsMeter();
    expect(f.fps()).toBe(0);
    for (let i = 0; i < 120; i++) f.tick(i * (1000 / 60));
    expect(f.fps()).toBeGreaterThan(55);
    expect(f.fps()).toBeLessThan(65);
    f.tick(NaN);
    f.tick(-1e9);
    expect(Number.isFinite(f.fps())).toBe(true);
  });
});
