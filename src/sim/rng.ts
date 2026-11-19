/**
 * Deterministic PRNG (xoshiro128**) whose state lives inside WorldState so saves resume identical sequences.
 * NEVER use Math.random() inside src/sim — always ctx.rng / createRng(state.rng).
 */
import type { RngState } from './types';
import type { Rng } from './contracts';

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedRngState(seed: number): RngState {
  const sm = splitmix32(seed);
  const st = { a: sm(), b: sm(), c: sm(), d: sm() };
  if ((st.a | st.b | st.c | st.d) === 0) st.a = 1; // all-zero state is a fixed point
  return st;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Advance the state in place and return a uint32. */
export function nextU32(s: RngState): number {
  const result = Math.imul(rotl(Math.imul(s.b, 5) >>> 0, 7), 9) >>> 0;
  const t = (s.b << 9) >>> 0;
  s.c = (s.c ^ s.a) >>> 0;
  s.d = (s.d ^ s.b) >>> 0;
  s.b = (s.b ^ s.c) >>> 0;
  s.a = (s.a ^ s.d) >>> 0;
  s.c = (s.c ^ t) >>> 0;
  s.d = rotl(s.d, 11);
  return result;
}

/** Wrap a mutable RngState (typically state.rng) in the Rng helper interface. */
export function createRng(s: RngState): Rng {
  const next = () => nextU32(s) / 4294967296;
  return {
    next,
    int(min: number, max: number) {
      if (!(max >= min)) return min;
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p: number) {
      if (!(p > 0)) return false;
      if (p >= 1) return true;
      return next() < p;
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error('rng.pick on empty array');
      return arr[Math.floor(next() * arr.length)];
    },
    weighted(weights: readonly number[]) {
      let total = 0;
      for (const w of weights) total += w > 0 && Number.isFinite(w) ? w : 0;
      if (total <= 0) return weights.length > 0 ? 0 : -1;
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i] > 0 && Number.isFinite(weights[i]) ? weights[i] : 0;
        if (r < w) return i;
        r -= w;
      }
      return weights.length - 1;
    },
    shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    },
  };
}
