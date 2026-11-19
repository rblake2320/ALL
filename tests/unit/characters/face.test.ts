/** FaceController: procedural blinks (2-6 s), talk flaps, smoothing, determinism, eyes-closed hints, bad dt. */
import { describe, expect, it } from 'vitest';
import { FACE_INDEX, FaceController } from '../../../src/render/characters/face';

function run(fc: FaceController, seconds: number, dt = 1 / 60, each?: (t: number) => void): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    fc.update(dt);
    each?.(i * dt);
  }
}

describe('FaceController', () => {
  it('blinks every 2-6 s with a short (~0.18 s) closure', () => {
    const fc = new FaceController(1234);
    const starts: number[] = [];
    let closed = false;
    let maxBlink = 0;
    run(fc, 40, 1 / 120, (t) => {
      const b = fc.weights[FACE_INDEX.blink];
      maxBlink = Math.max(maxBlink, b);
      if (b > 0.5 && !closed) {
        starts.push(t);
        closed = true;
      }
      if (b < 0.1) closed = false;
    });
    expect(maxBlink).toBeGreaterThan(0.9);
    expect(starts.length).toBeGreaterThanOrEqual(7);
    expect(starts.length).toBeLessThanOrEqual(20);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      expect(gap).toBeGreaterThan(1.9);
      expect(gap).toBeLessThan(6.3);
    }
  });

  it('is deterministic per seed and differs between seeds', () => {
    const trace = (seed: number) => {
      const fc = new FaceController(seed);
      const out: number[] = [];
      run(fc, 12, 1 / 30, () => out.push(fc.weights[FACE_INDEX.blink]));
      return out;
    };
    expect(trace(7)).toEqual(trace(7));
    expect(trace(7)).not.toEqual(trace(8));
  });

  it('flaps the mouth while talking and relaxes afterwards', () => {
    const fc = new FaceController(5);
    fc.setTalking(true);
    let lo = 1;
    let hi = 0;
    run(fc, 2, 1 / 60, () => {
      const v = fc.weights[FACE_INDEX.talk];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    });
    expect(hi - lo).toBeGreaterThan(0.35);
    fc.setTalking(false);
    run(fc, 1.5);
    expect(fc.weights[FACE_INDEX.talk]).toBeLessThan(0.02);
  });

  it('blends smoothly into an expression and out again', () => {
    const fc = new FaceController(9);
    fc.setExpression('angry');
    fc.update(1 / 60);
    const first = fc.weights[FACE_INDEX.angry];
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.5);
    run(fc, 1);
    expect(fc.weights[FACE_INDEX.angry]).toBeGreaterThan(0.95);
    fc.setExpression('neutral');
    run(fc, 1);
    expect(fc.weights[FACE_INDEX.angry]).toBeLessThan(0.05);
  });

  it('closes the eyes for sleeping animations and reduces blink by lid closure', () => {
    const fc = new FaceController(3);
    fc.setAnimHint('sleep');
    run(fc, 2);
    expect(fc.weights[FACE_INDEX.blink]).toBeGreaterThan(0.6);
    const fc2 = new FaceController(3);
    fc2.setExpression('sleepy');
    let maxBlink = 0;
    run(fc2, 20, 1 / 120, () => (maxBlink = Math.max(maxBlink, fc2.weights[FACE_INDEX.blink])));
    expect(maxBlink).toBeLessThan(0.6);
  });

  it('ignores NaN / negative / huge dt', () => {
    const fc = new FaceController(1);
    fc.setExpression('happy');
    for (const dt of [NaN, -1, Infinity, 1e9, 0]) fc.update(dt);
    for (const w of fc.weights) {
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1.0001);
    }
  });

  it('reseed() desyncs a fresh controller but never stalls blinking once it has started', () => {
    const a = new FaceController(1);
    const b = new FaceController(1);
    b.reseed(987654321);
    expect(a.nextBlinkIn).not.toBeCloseTo(b.nextBlinkIn, 4);
    // a controller re-seeded on every frame (colour slider dragged) still blinks every 2-6 s
    const c = new FaceController(7);
    let blinks = 0;
    let prev = 0;
    for (let i = 0; i < 30 * 20; i++) {
      c.reseed(1000 + i);
      const w = c.update(1 / 30)[FACE_INDEX.blink];
      if (w > 0.5 && prev <= 0.5) blinks++;
      prev = w;
    }
    expect(blinks).toBeGreaterThanOrEqual(3);
  });
});
