import { mtof } from '../music/theory';
import { playNote } from '../music/instruments';
import type { InstrumentId } from '../music/types';
import type { Sx } from '../synth/types';

/** Duration from sx.t to the latest of the given end times. */
export function done(sx: Sx, ...ends: number[]): number {
  let m = sx.t;
  for (const e of ends) if (e > m) m = e;
  return m - sx.t;
}

/** Shifted copy (for sequencing notes inside a recipe). */
export function at(sx: Sx, dt: number): Sx {
  return { ctx: sx.ctx, out: sx.out, t: sx.t + dt, rng: sx.rng, pitch: sx.pitch, vol: sx.vol };
}

export const N = mtof;

/** Play a short motif: [offsetSec, midi, durSec, vel][] on an instrument; returns the latest end time. */
export function motif(sx: Sx, inst: InstrumentId, notes: readonly (readonly [number, number, number, number])[], transpose = 0): number {
  let end = sx.t;
  for (const [dt, m, d, v] of notes) end = Math.max(end, playNote(at(sx, dt), inst, m + transpose, d, v));
  return end;
}

/**
 * Run `fn` into a gate that fades to silence by `len` seconds (keeps instrument timbres but bounds the
 * tail of musical one-shots). Returns the effective duration.
 */
export function choke(sx: Sx, len: number, fade: number, fn: (s: Sx) => number): number {
  const g = sx.ctx.createGain();
  g.connect(sx.out);
  const s: Sx = { ctx: sx.ctx, out: g, t: sx.t, rng: sx.rng, pitch: sx.pitch, vol: sx.vol };
  const d = fn(s);
  const startFade = sx.t + Math.max(0, len - fade);
  try {
    g.gain.setValueAtTime(1, startFade);
    g.gain.setTargetAtTime(0, startFade, fade / 5);
  } catch {
    /* ignore */
  }
  return Math.min(d, len + 0.01);
}
