import type { Rng } from '../prng';

/**
 * Synthesis target. Recipes render into ANY BaseAudioContext (realtime or offline) and connect only to
 * `out`; they never keep a reference to `Sx` after returning (the engine reuses one scratch object),
 * except loop factories which receive their own copy.
 */
export interface Sx {
  ctx: BaseAudioContext;
  out: AudioNode;
  /** Absolute start time (context seconds). */
  t: number;
  rng: Rng;
  /** Pitch multiplier applied by every toolkit voice (1 = nominal). */
  pitch: number;
  /** Volume multiplier applied by every toolkit voice. */
  vol: number;
}

/** One-shot recipe: schedules nodes from sx.t and returns the duration (s) until silence. */
export type OneShot = (sx: Sx) => number;

export interface LoopVoice {
  /** Stop all sources at `when` (the caller fades the loop's output gain before this). */
  stop(when: number): void;
  /** Event-driven loops schedule discrete events in [from, to) (called from the lookahead timer). */
  schedule?(from: number, to: number): void;
}

export type LoopFactory = (sx: Sx) => LoopVoice;

export function cloneSx(sx: Sx, out?: AudioNode): Sx {
  return { ctx: sx.ctx, out: out ?? sx.out, t: sx.t, rng: sx.rng, pitch: sx.pitch, vol: sx.vol };
}
