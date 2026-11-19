/** Short musical motifs for life events, played on the score's own toy orchestra. */
import { envAHR, filterNode, gainNode, lfo, noiseHit, oscNode, rampLin, setAt, startStop, targetAt } from '../synth/core';
import type { OneShot, Sx } from '../synth/types';
import { at, choke, done, motif, N } from './util';

function quieter(sx: Sx, k: number): Sx {
  return { ctx: sx.ctx, out: sx.out, t: sx.t, rng: sx.rng, pitch: sx.pitch, vol: sx.vol * k };
}

export const promotion: OneShot = (sx) => {
  const s = quieter(sx, 0.62);
  return done(sx,
    motif(s, 'brass', [[0, 67, 0.11, 0.8], [0.13, 72, 0.11, 0.8], [0.26, 76, 0.11, 0.85], [0.39, 79, 0.12, 0.9]]),
    motif(s, 'brass', [[0.55, 72, 0.8, 0.8], [0.55, 76, 0.8, 0.75], [0.55, 79, 0.8, 0.75], [0.55, 84, 0.8, 0.8]]),
    motif(s, 'glock', [[0.55, 84, 0.5, 0.7], [0.55, 91, 0.5, 0.6], [0.75, 96, 0.5, 0.5]]),
    motif(s, 'timpani', [[0.55, 48, 1, 0.8]]),
    noiseHit(s, { at: 0.55, filter: 'highpass', f: 6000, d: 1.1, peak: 0.07 }));
};

export const skillUp: OneShot = (sx) => {
  const s = quieter(sx, 0.85);
  return done(sx,
    motif(s, 'celesta', [[0, 79, 0.2, 0.7], [0.07, 83, 0.2, 0.7], [0.14, 86, 0.2, 0.75], [0.21, 91, 0.6, 0.85]]),
    motif(s, 'glock', [[0.21, 95, 0.6, 0.5], [0.28, 98, 0.6, 0.45]]));
};

export const milestone: OneShot = (sx) => choke(sx, 2.5, 0.6, milestoneRaw);

const milestoneRaw: OneShot = (sx) => {
  const s = quieter(sx, 0.6);
  const gliss: [number, number, number, number][] = [48, 52, 55, 60, 64, 67, 72, 76].map((m, i) => [i * 0.04, m, 0.8, 0.55 + i * 0.03]);
  return done(sx,
    motif(s, 'harp', gliss),
    motif(s, 'celesta', [[0.4, 65, 0.3, 0.6], [0.4, 69, 0.3, 0.6], [0.4, 72, 0.3, 0.6]]),
    motif(s, 'celesta', [[0.75, 67, 0.3, 0.6], [0.75, 71, 0.3, 0.6], [0.75, 74, 0.3, 0.6]]),
    motif(s, 'bell', [[1.1, 72, 1, 0.6]]),
    motif(s, 'glock', [[1.1, 84, 0.8, 0.6], [1.1, 88, 0.8, 0.55], [1.1, 91, 0.8, 0.55], [1.25, 96, 0.8, 0.45]]),
    motif(s, 'pad', [[1.1, 60, 0.5, 0.6], [1.1, 64, 0.5, 0.55], [1.1, 67, 0.5, 0.55]]));
};

/** Comedic muted-trombone "wah". */
function trombone(sx: Sx, dt: number, midi: number, dur: number, vib: boolean): number {
  const ctx = sx.ctx;
  const t = sx.t + dt;
  const o = oscNode(ctx, 'sawtooth', N(midi) * sx.pitch);
  setAt(o.frequency, N(midi) * sx.pitch * 1.02, t);
  targetAt(o.frequency, N(midi) * sx.pitch, t, 0.03);
  const lp = filterNode(ctx, 'lowpass', 400, 4);
  setAt(lp.frequency, 380, t);
  rampLin(lp.frequency, 1300, t + Math.min(0.15, dur * 0.4));
  rampLin(lp.frequency, 600, t + dur);
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, 0.26 * sx.vol, 0.03, Math.max(0, dur - 0.05), 0.12);
  if (vib) {
    const lo = oscNode(ctx, 'sine', 5.5);
    const lg = gainNode(ctx, 0);
    setAt(lg.gain, 0, t);
    rampLin(lg.gain, 45, t + dur * 0.7);
    lo.connect(lg).connect(o.detune);
    startStop(lo, t, end);
    // the classic wobbling mute
    lfo(sx, 'sine', 5.5, 500, lp.frequency, t, end);
  }
  o.connect(lp).connect(g).connect(sx.out);
  startStop(o, t, end);
  return end;
}

export const fail: OneShot = (sx) =>
  done(sx,
    trombone(sx, 0, 58, 0.28, false),
    trombone(sx, 0.34, 57, 0.28, false),
    trombone(sx, 0.68, 56, 0.28, false),
    trombone(sx, 1.02, 55, 0.95, true));

export const romanceSting: OneShot = (sx) => {
  const s = quieter(sx, 0.7);
  const arp: [number, number, number, number][] = [53, 57, 60, 64, 67, 69, 72].map((m, i) => [i * 0.07, m, 1.1, 0.6]);
  return done(sx,
    motif(s, 'harp', arp),
    motif(s, 'celesta', [[0.52, 81, 0.35, 0.6], [0.82, 84, 0.8, 0.65]]),
    motif(s, 'pad', [[0.2, 65, 0.9, 0.5], [0.2, 69, 0.9, 0.45], [0.2, 72, 0.9, 0.45], [0.2, 76, 0.9, 0.4]]));
};

export const sadSting: OneShot = (sx) => choke(sx, 2.5, 0.5, sadStingRaw);

const sadStingRaw: OneShot = (sx) => {
  const s = quieter(sx, 0.85);
  return done(sx,
    motif(s, 'musicBox', [[0, 76, 0.28, 0.7], [0.3, 74, 0.28, 0.65], [0.6, 72, 0.28, 0.65], [0.9, 71, 0.28, 0.6], [1.2, 69, 0.9, 0.7]]),
    motif(at(s, 0), 'pad', [[0, 45, 1.3, 0.5], [0, 52, 1.3, 0.45]]));
};
