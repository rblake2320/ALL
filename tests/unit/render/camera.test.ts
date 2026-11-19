import { describe, it, expect } from 'vitest';
import {
  CAMERA_LIMITS,
  YAW_STEP,
  clampPitch,
  clampDistance,
  clampTarget,
  sanitizeBounds,
  stepYaw,
  cameraOffset,
  cameraRight,
  viewDirection,
  panWorldDelta,
  panScreenDelta,
  defaultCameraGoal,
  zoomDistance,
} from '../../../src/render/camera/cameraMath';

const B = { width: 30, depth: 30 };

describe('camera clamps', () => {
  it('pitch within 0.35..1.25, distance within 6..60', () => {
    expect(clampPitch(0.1)).toBe(CAMERA_LIMITS.pitchMin);
    expect(clampPitch(2)).toBe(CAMERA_LIMITS.pitchMax);
    expect(clampPitch(0.8)).toBe(0.8);
    expect(clampDistance(1)).toBe(6);
    expect(clampDistance(100)).toBe(60);
    expect(clampDistance(25)).toBe(25);
  });

  it('garbage pitch/distance fall back to sane defaults inside the limits', () => {
    for (const g of [NaN, Infinity, -Infinity, undefined, 'x']) {
      const p = clampPitch(g);
      const d = clampDistance(g);
      expect(p).toBeGreaterThanOrEqual(CAMERA_LIMITS.pitchMin);
      expect(p).toBeLessThanOrEqual(CAMERA_LIMITS.pitchMax);
      expect(d).toBeGreaterThanOrEqual(CAMERA_LIMITS.distanceMin);
      expect(d).toBeLessThanOrEqual(CAMERA_LIMITS.distanceMax);
    }
  });

  it('target clamps to the lot bounds plus margin; NaN → lot centre', () => {
    const o = { x: 0, z: 0 };
    expect(clampTarget(-50, 99, B, 4, o)).toEqual({ x: -4, z: 34 });
    expect(clampTarget(10, 12, B, 4, o)).toEqual({ x: 10, z: 12 });
    expect(clampTarget(NaN, Infinity, B, 4, o)).toEqual({ x: 15, z: 15 }); // non-finite → centre
    expect(clampTarget(NaN, NaN, B, 4, o)).toEqual({ x: 15, z: 15 });
    expect(clampTarget(-1, -1, B, NaN, o)).toEqual({ x: -1, z: -1 }); // NaN margin → default 4
    expect(clampTarget(-10, -10, B, -5, o)).toEqual({ x: -4, z: -4 });
  });

  it('bounds sanitiser', () => {
    expect(sanitizeBounds(null)).toEqual({ width: 30, depth: 30 });
    expect(sanitizeBounds({ width: -1, depth: NaN })).toEqual({ width: 30, depth: 30 });
    expect(sanitizeBounds({ width: 1e9, depth: 12 })).toEqual({ width: 10000, depth: 12 });
  });
});

describe('45° rotation steps', () => {
  it('+1 = clockwise from above = yaw decreases by 45°', () => {
    expect(stepYaw(0, 1)).toBeCloseTo(-YAW_STEP);
    expect(stepYaw(0, -1)).toBeCloseTo(YAW_STEP);
    expect(stepYaw(YAW_STEP, 2)).toBeCloseTo(-YAW_STEP);
    expect(stepYaw(0, 8)).toBeCloseTo(-2 * Math.PI);
  });

  it('snaps an off-grid yaw to the next multiple in the travel direction', () => {
    expect(stepYaw(0.3, 1)).toBeCloseTo(0);
    expect(stepYaw(0.3, -1)).toBeCloseTo(YAW_STEP);
    expect(stepYaw(-0.3, 1)).toBeCloseTo(-YAW_STEP);
  });

  it('garbage steps are ignored; huge step counts are bounded', () => {
    expect(stepYaw(0.5, 0)).toBe(0.5);
    expect(stepYaw(0.5, NaN)).toBe(0.5);
    expect(stepYaw(NaN, 1)).toBeCloseTo(-YAW_STEP);
    expect(stepYaw(0, 0.9)).toBe(0); // truncated to 0 steps
    expect(Number.isFinite(stepYaw(0, 1e12))).toBe(true);
    expect(stepYaw(0, 1e12)).toBeCloseTo(-64 * YAW_STEP);
  });
});

describe('camera vectors', () => {
  it('yaw 0 puts the camera on the street (+Z) side, looking toward -Z', () => {
    const o = cameraOffset(0, 0.6, 10, { x: 0, y: 0, z: 0 });
    expect(o.x).toBeCloseTo(0);
    expect(o.z).toBeGreaterThan(0);
    expect(o.y).toBeCloseTo(10 * Math.sin(0.6));
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(10);
    const v = viewDirection(0, { x: 0, z: 0 });
    expect(v.z).toBeCloseTo(-1);
    const r = cameraRight(0, { x: 0, z: 0 });
    expect([r.x, r.z]).toEqual([1, -0]);
  });

  it('right vector is perpendicular to the view direction for any yaw', () => {
    for (let y = -7; y < 7; y += 0.37) {
      const v = viewDirection(y, { x: 0, z: 0 });
      const r = cameraRight(y, { x: 0, z: 0 });
      expect(v.x * r.x + v.z * r.z).toBeCloseTo(0, 9);
      // right = forward × up  (forward=(vx,0,vz), up=(0,1,0) → (-vz, 0, vx))
      expect(r.x).toBeCloseTo(-v.z, 9);
      expect(r.z).toBeCloseTo(v.x, 9);
    }
  });
});

describe('panning', () => {
  it('panWorld is the identity at yaw 0 and camera-relative otherwise', () => {
    const o = { x: 0, z: 0 };
    expect(panWorldDelta(1, 2, 0, o)).toEqual({ x: 1, z: 2 });
    // yaw 90°: camera on +X; "right" is -Z, "toward camera" is +X
    const p = panWorldDelta(1, 0, Math.PI / 2, o);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-1);
    const q = panWorldDelta(0, 1, Math.PI / 2, { x: 0, z: 0 });
    expect(q.x).toBeCloseTo(1);
  });

  it('panWorld clamps absurd inputs and ignores NaN', () => {
    const o = panWorldDelta(1e9, NaN, NaN, { x: 0, z: 0 });
    expect(o.x).toBe(1000);
    expect(o.z).toBeCloseTo(0);
  });

  it('screen pan: dragging right moves the target left (grab the world)', () => {
    const o = panScreenDelta(100, 0, 0, 0.8, 20, 32, 800, { x: 0, z: 0 });
    expect(o.x).toBeLessThan(0);
    expect(o.z).toBeCloseTo(0);
    // dragging down moves the target away from the camera (−Z at yaw 0)
    const d = panScreenDelta(0, 100, 0, 0.8, 20, 32, 800, { x: 0, z: 0 });
    expect(d.z).toBeLessThan(0);
  });

  it('screen pan scales with distance and survives garbage viewport sizes', () => {
    const near = panScreenDelta(100, 0, 0, 0.8, 10, 32, 800, { x: 0, z: 0 });
    const far = panScreenDelta(100, 0, 0, 0.8, 40, 32, 800, { x: 0, z: 0 });
    expect(Math.abs(far.x)).toBeCloseTo(Math.abs(near.x) * 4, 6);
    const g = panScreenDelta(NaN, Infinity, 0, NaN, NaN, NaN, 0, { x: 0, z: 0 });
    expect(Number.isFinite(g.x) && Number.isFinite(g.z)).toBe(true);
  });
});

describe('zoom & defaults', () => {
  it('positive delta zooms in, clamped to limits and ±10 notches per call', () => {
    expect(zoomDistance(30, 1)).toBeLessThan(30);
    expect(zoomDistance(30, -1)).toBeGreaterThan(30);
    expect(zoomDistance(30, 1000)).toBe(zoomDistance(30, 10));
    expect(zoomDistance(7, 50)).toBe(CAMERA_LIMITS.distanceMin);
    expect(zoomDistance(30, NaN)).toBe(30);
  });

  it('default view is from the street, elevated, within limits', () => {
    const g = defaultCameraGoal(B);
    expect(Math.cos(g.yaw)).toBeGreaterThan(0); // +Z side
    expect(g.pitch).toBeGreaterThanOrEqual(CAMERA_LIMITS.pitchMin);
    expect(g.pitch).toBeLessThanOrEqual(CAMERA_LIMITS.pitchMax);
    expect(g.distance).toBeLessThanOrEqual(CAMERA_LIMITS.distanceMax);
    expect(g.targetX).toBe(15);
  });
});
