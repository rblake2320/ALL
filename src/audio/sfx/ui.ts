/** Interface sounds: soft, toy-like, rounded (sines/triangles/FM tines). */
import { fmBell, noiseHit, tick, tone } from '../synth/core';
import type { OneShot } from '../synth/types';
import { at, choke, done, motif, N } from './util';

export const uiClick: OneShot = (sx) =>
  done(sx,
    tone(sx, { f: 1250, f2: 820, glide: 0.025, d: 0.035, peak: 0.32 }),
    noiseHit(sx, { filter: 'bandpass', f: 3800, q: 1.4, d: 0.008, peak: 0.12 }));

export const uiHover: OneShot = (sx) => done(sx, tone(sx, { f: 2350, f2: 2500, glide: 0.02, d: 0.028, peak: 0.07 }));

export const uiOpen: OneShot = (sx) =>
  done(sx,
    tone(sx, { type: 'triangle', f: 440, f2: 740, glide: 0.07, a: 0.01, d: 0.16, peak: 0.26 }),
    fmBell(sx, { at: 0.05, f: 1480, ratio: 3, index: 0.6, d: 0.25, peak: 0.07 }));

export const uiClose: OneShot = (sx) =>
  done(sx,
    tone(sx, { type: 'triangle', f: 700, f2: 420, glide: 0.07, a: 0.006, d: 0.13, peak: 0.22 }),
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 900, a: 0.01, d: 0.05, peak: 0.05 }));

export const uiError: OneShot = (sx) =>
  done(sx,
    tone(sx, { type: 'triangle', f: N(55), a: 0.004, hold: 0.05, d: 0.09, peak: 0.3, lp: 1400 }),
    tone(sx, { type: 'sine', f: N(43), a: 0.004, hold: 0.04, d: 0.08, peak: 0.16 }),
    tone(sx, { at: 0.14, type: 'triangle', f: N(54), a: 0.004, hold: 0.07, d: 0.14, peak: 0.3, lp: 1200 }),
    tone(sx, { at: 0.14, type: 'sine', f: N(42), a: 0.004, hold: 0.06, d: 0.12, peak: 0.16 }));

export const uiConfirm: OneShot = (sx) =>
  done(sx,
    fmBell(sx, { f: N(84), ratio: 2, index: 0.6, d: 0.3, peak: 0.18 }),
    fmBell(sx, { at: 0.065, f: N(91), ratio: 2, index: 0.5, d: 0.42, peak: 0.16 }));

export const uiTab: OneShot = (sx) =>
  done(sx,
    noiseHit(sx, { filter: 'bandpass', f: 2400, q: 1.2, d: 0.03, peak: 0.16 }),
    tone(sx, { f: 1050, f2: 980, glide: 0.03, d: 0.05, peak: 0.12 }));

export const uiToggle: OneShot = (sx) => done(sx, tick(sx, { f: 1300, peak: 0.25 }), tick(sx, { at: 0.045, f: 1850, peak: 0.2 }));

export const notify: OneShot = (sx) =>
  choke(sx, 1.05, 0.35, (s) => done(s, motif(s, 'musicBox', [[0, 79, 0.3, 0.75], [0.09, 84, 0.3, 0.75], [0.18, 88, 0.5, 0.85]])));

export const notifyBad: OneShot = (sx) =>
  done(sx,
    tone(sx, { type: 'triangle', f: N(69), a: 0.01, hold: 0.1, d: 0.14, peak: 0.24, lp: 1800 }),
    tone(sx, { at: 0.2, type: 'triangle', f: N(63), a: 0.01, hold: 0.16, d: 0.32, peak: 0.24, lp: 1500, vib: [6, 22] }),
    fmBell(sx, { at: 0.2, f: N(45), ratio: 1.41, index: 1, d: 0.6, peak: 0.12 }));

export const cash: OneShot = (sx) => {
  const ends = [
    // "cha": drawer clunk
    noiseHit(sx, { filter: 'bandpass', f: 3000, q: 0.8, d: 0.05, peak: 0.28 }),
    tick(sx, { f: 2200, peak: 0.2 }),
    tone(sx, { f: 160, f2: 90, glide: 0.05, d: 0.07, peak: 0.26 }),
    // "ching": bell pair
    fmBell(sx, { at: 0.085, f: 2093, ratio: 1.41, index: 2, d: 0.85, peak: 0.2 }),
    fmBell(sx, { at: 0.095, f: 2637, ratio: 1.41, index: 1.6, d: 0.75, peak: 0.16 }),
  ];
  for (let i = 0; i < 4; i++) {
    ends.push(fmBell(sx, { at: 0.1 + i * 0.06 + sx.rng.range(0, 0.03), f: sx.rng.range(3000, 5200), ratio: 2.4, index: 0.6, d: sx.rng.range(0.12, 0.25), peak: sx.rng.range(0.04, 0.07) }));
  }
  return done(sx, ...ends);
};

export const cashLoss: OneShot = (sx) =>
  done(sx,
    tone(sx, { type: 'triangle', f: 520, f2: 260, glide: 0.42, a: 0.01, hold: 0.1, d: 0.35, vib: [7, 30], peak: 0.24, lp: 2000 }),
    fmBell(sx, { at: 0.12, f: 2600, ratio: 2.4, index: 0.6, d: 0.2, peak: 0.08 }),
    fmBell(sx, { at: 0.25, f: 2200, ratio: 2.4, index: 0.6, d: 0.2, peak: 0.06 }),
    fmBell(sx, { at: 0.36, f: 1900, ratio: 2.4, index: 0.6, d: 0.2, peak: 0.05 }),
    tone(sx, { at: 0.3, f: 130, f2: 88, glide: 0.25, a: 0.02, d: 0.3, peak: 0.15 }));

export const speedChange: OneShot = (sx) =>
  done(sx,
    tone(sx, { f: 1600, f2: 1450, glide: 0.03, d: 0.05, peak: 0.22 }),
    noiseHit(sx, { filter: 'bandpass', f: 3200, q: 1.5, d: 0.006, peak: 0.1 }),
    tone(sx, { at: 0.075, f: 1200, f2: 1080, glide: 0.03, d: 0.06, peak: 0.2 }),
    noiseHit(sx, { at: 0.075, filter: 'bandpass', f: 2600, q: 1.5, d: 0.006, peak: 0.09 }));

export const modeLive: OneShot = (sx) =>
  choke(sx, 0.8, 0.3, (s) =>
    done(s,
      motif(s, 'celesta', [[0, 72, 0.3, 0.55], [0.045, 76, 0.3, 0.55], [0.09, 79, 0.45, 0.6]]),
      noiseHit(s, { color: 'pink', filter: 'bandpass', f: 800, f2: 2400, sweep: 0.25, q: 0.7, a: 0.08, d: 0.2, peak: 0.06 })));

export const modeBuild: OneShot = (sx) =>
  done(sx,
    motif(sx, 'marimba', [[0, 67, 0.2, 0.8], [0.07, 72, 0.25, 0.8]]),
    tick(sx, { at: 0.15, f: 2600, peak: 0.08 }),
    tick(sx, { at: 0.175, f: 2900, peak: 0.07 }));

export const modeBuy: OneShot = (sx) =>
  done(sx,
    fmBell(sx, { f: 1760, ratio: 2.4, index: 0.7, d: 0.3, peak: 0.14 }),
    fmBell(sx, { at: 0.06, f: 2637, ratio: 2.4, index: 0.6, d: 0.36, peak: 0.12 }),
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 500, d: 0.06, peak: 0.1 }));

export const save: OneShot = (sx) =>
  choke(sx, 1.1, 0.35, (s) =>
    done(s,
      noiseHit(s, { filter: 'bandpass', f: 3800, q: 2, a: 0.02, d: 0.09, peak: 0.07 }),
      noiseHit(s, { at: 0.07, filter: 'bandpass', f: 4600, q: 2, a: 0.015, d: 0.08, peak: 0.06 }),
      motif(at(s, 0.12), 'celesta', [[0, 79, 0.3, 0.5], [0.06, 84, 0.3, 0.5], [0.12, 88, 0.3, 0.55], [0.18, 91, 0.5, 0.6]])));
