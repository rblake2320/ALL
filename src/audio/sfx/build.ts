/** Build / buy mode feedback: chunky, satisfying, wooden. */
import { creak, envAHR, filterNode, fmBell, gainNode, lfo, noiseHit, noiseSrc, squelch, tick, tone } from '../synth/core';
import type { OneShot } from '../synth/types';
import { done } from './util';

export const placeObject: OneShot = (sx) =>
  done(sx,
    tone(sx, { f: 150, f2: 62, glide: 0.1, d: 0.17, peak: 0.45 }),
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 700, d: 0.07, peak: 0.28 }),
    tone(sx, { f: 620, f2: 560, glide: 0.02, d: 0.03, peak: 0.1 }),
    tone(sx, { at: 0.03, type: 'triangle', f: 1240, d: 0.06, peak: 0.04 }));

export const placeInvalid: OneShot = (sx) =>
  done(sx,
    tone(sx, { type: 'square', f: 233, a: 0.004, hold: 0.06, d: 0.05, peak: 0.12, lp: 1800 }),
    tone(sx, { type: 'triangle', f: 117, a: 0.004, hold: 0.06, d: 0.05, peak: 0.16 }),
    tone(sx, { at: 0.12, type: 'square', f: 196, a: 0.004, hold: 0.08, d: 0.07, peak: 0.12, lp: 1500 }),
    tone(sx, { at: 0.12, type: 'triangle', f: 98, a: 0.004, hold: 0.08, d: 0.07, peak: 0.16 }));

export const rotateObject: OneShot = (sx) =>
  done(sx,
    tick(sx, { f: 2600, peak: 0.12 }),
    tick(sx, { at: 0.035, f: 2900, peak: 0.12 }),
    tick(sx, { at: 0.07, f: 3200, peak: 0.12 }),
    noiseHit(sx, { filter: 'bandpass', f: 1200, f2: 2600, sweep: 0.12, q: 0.9, a: 0.02, d: 0.1, peak: 0.12 }));

export const sellObject: OneShot = (sx) =>
  done(sx,
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 3200, f2: 500, sweep: 0.25, a: 0.01, d: 0.3, peak: 0.32 }),
    fmBell(sx, { at: 0.05, f: 2637, ratio: 2.4, index: 0.8, d: 0.35, peak: 0.14 }),
    fmBell(sx, { at: 0.12, f: 3136, ratio: 2.4, index: 0.7, d: 0.35, peak: 0.12 }));

export const pickUpObject: OneShot = (sx) =>
  done(sx,
    tone(sx, { f: 300, f2: 640, glide: 0.08, a: 0.006, d: 0.1, peak: 0.3 }),
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 1200, a: 0.02, d: 0.06, peak: 0.08 }));

export const wallBuild: OneShot = (sx) =>
  done(sx,
    tone(sx, { f: 120, f2: 70, glide: 0.06, d: 0.1, peak: 0.26 }),
    tone(sx, { f: 1450, f2: 1300, glide: 0.01, d: 0.035, peak: 0.22 }),
    noiseHit(sx, { filter: 'bandpass', f: 2200, q: 2, d: 0.012, peak: 0.22 }),
    tone(sx, { at: 0.06, f: 1700, f2: 1550, glide: 0.01, d: 0.03, peak: 0.12 }),
    noiseHit(sx, { at: 0.08, color: 'pink', filter: 'bandpass', f: 1600, f2: 1100, sweep: 0.15, q: 1.5, a: 0.02, d: 0.14, peak: 0.14 }));

export const wallDelete: OneShot = (sx) => {
  const ends = [
    tone(sx, { f: 90, f2: 50, glide: 0.1, d: 0.16, peak: 0.36 }),
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 1500, a: 0.02, d: 0.35, peak: 0.12 }),
  ];
  let t = 0.02;
  for (let i = 0; i < 9; i++) {
    ends.push(noiseHit(sx, { at: t, filter: 'bandpass', f: sx.rng.range(1000, 3500), q: 2, d: sx.rng.range(0.015, 0.04), peak: sx.rng.range(0.05, 0.16) * (1 - i * 0.07) }));
    t += 0.02 + i * 0.008 + sx.rng.range(0, 0.02);
  }
  return done(sx, ...ends);
};

export const floorPaint: OneShot = (sx) =>
  done(sx,
    noiseHit(sx, { color: 'pink', filter: 'bandpass', f: 900, f2: 2400, sweep: 0.18, q: 1.2, a: 0.04, d: 0.16, peak: 0.26 }),
    tick(sx, { at: 0.17, f: 900, peak: 0.05 }));

export const wallPaint: OneShot = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, 0.26 * sx.vol, 0.05, 0.15, 0.12);
  const src = noiseSrc(sx, 'pink', t, end);
  const lp = filterNode(ctx, 'lowpass', 1100 * sx.pitch, 1);
  const am = gainNode(ctx, 0.7);
  src.connect(lp).connect(g).connect(am).connect(sx.out);
  lfo(sx, 'sine', 9, 0.3, am.gain, t, end);
  return done(sx, end, squelch(sx, { at: 0.05, f: 700, f2: 400, d: 0.12, peak: 0.06 }));
};

export const doorPlace: OneShot = (sx) =>
  done(sx,
    tick(sx, { f: 2400, peak: 0.2 }),
    tone(sx, { at: 0.03, f: 130, f2: 70, glide: 0.08, d: 0.13, peak: 0.36 }),
    noiseHit(sx, { at: 0.03, color: 'pink', filter: 'lowpass', f: 600, d: 0.06, peak: 0.18 }),
    creak(sx, { at: 0.07, rate: 45, rate2: 30, d: 0.24, peak: 0.14 }));

export const undo: OneShot = (sx) =>
  done(sx,
    noiseHit(sx, { color: 'pink', filter: 'bandpass', f: 3200, f2: 700, sweep: 0.2, q: 1, a: 0.16, d: 0.06, peak: 0.22 }),
    tone(sx, { f: 900, f2: 500, glide: 0.18, a: 0.12, d: 0.08, peak: 0.1 }));
