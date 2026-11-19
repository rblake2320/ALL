/**
 * Small seeded PRNG for the audio engine (mulberry32) + seed hashing.
 * Audio never uses Math.random(): every "random" variation is reproducible from the engine seed, so the
 * offline verification and the unit tests can render bit-identical sequences.
 */

const GOLDEN = 0x9e3779b9;

function hashString(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Map anything to a uint32 seed. Integers map to themselves (mod 2^32); everything else is hashed. */
export function toSeed(x: unknown): number {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) return Number.isNaN(x) ? 0x7ff80000 : x > 0 ? 0x7ff00000 : 0xfff00000;
    if (Number.isInteger(x) && Math.abs(x) <= 0x7fffffff * 2) return x >>> 0;
    return hashString(String(x));
  }
  if (typeof x === 'string') return hashString(x);
  if (typeof x === 'boolean') return x ? 1 : 0;
  return GOLDEN;
}

function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Combine several parts into one well-mixed uint32 seed (order-sensitive). */
export function hashSeed(...parts: readonly unknown[]): number {
  let h = 0x2545f491;
  for (let i = 0; i < parts.length; i++) {
    h = mix32((h ^ toSeed(parts[i])) + GOLDEN + i);
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, maxInclusive]. */
  int(min: number, maxInclusive: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** base * (1 ± fraction), uniform. */
  vary(base: number, fraction: number): number;
  /** Roughly gaussian (Irwin-Hall, 3 terms) in [-amount, amount], mean 0. */
  jitter(amount: number): number;
  getState(): number;
  setState(state: number): void;
}

/** mulberry32: tiny, fast, good enough for audio variation. Methods live on the prototype (no closures). */
export class SeededRng implements Rng {
  private s: number;

  constructor(seed: unknown) {
    this.s = toSeed(seed) | 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    const lo = Math.ceil(min);
    const hi = Math.floor(maxInclusive);
    if (!(hi >= lo)) return Number.isFinite(lo) ? lo : 0;
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }

  vary(base: number, fraction: number): number {
    return base * (1 + (this.next() * 2 - 1) * fraction);
  }

  jitter(amount: number): number {
    return ((this.next() + this.next() + this.next()) / 1.5 - 1) * amount;
  }

  getState(): number {
    return this.s >>> 0;
  }

  setState(state: number): void {
    this.s = toSeed(state) | 0;
  }
}

export function createRng(seed: unknown): Rng {
  return new SeededRng(seed);
}
