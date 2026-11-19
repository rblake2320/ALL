/**
 * Small allocation-free numeric helpers shared by the renderer. Everything here is pure and safe to
 * call with garbage (NaN, Infinity, strings at runtime) — callers never have to pre-validate.
 */

export const TAU = Math.PI * 2;

/** Clamp `v` into [lo, hi]. NaN maps to `lo`. */
export function clamp(v: number, lo: number, hi: number): number {
  if (!(v >= lo)) return lo; // also catches NaN
  if (v > hi) return hi;
  return v;
}

/** `v` if it is a finite number, else `fallback`. */
export function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep on [0,1] (input clamped). */
export function smooth01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Frame-rate independent exponential smoothing factor: `current += (target - current) * dampFactor(k, dt)`.
 * `lambda` is the convergence rate (1/s). Invalid/non-positive dt → 0 (no motion); lambda = Infinity → 1 (snap);
 * invalid/non-positive lambda → 0.
 */
export function dampFactor(lambda: number, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  if (lambda === Infinity) return 1;
  if (!(lambda > 0) || !Number.isFinite(lambda)) return 0;
  return 1 - Math.exp(-lambda * dt);
}

/** Wrap an angle into [-PI, PI). Non-finite input returns 0. */
export function wrapAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}

/** Signed shortest angular difference `to - from`, in [-PI, PI). */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Positive modulo. */
export function mod(a: number, n: number): number {
  const r = a % n;
  return r < 0 ? r + n : r;
}

/** Deterministic 32-bit string hash (FNV-1a). Allocation free. */
export function hashString(s: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG factory: deterministic stream in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parse '#rgb' / '#rrggbb' (case-insensitive, optional '#') into 0xRRGGBB, or null if invalid. */
export function parseHexColor(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return parseInt(s, 16);
}

/** A promise that settles (never rejects) when `p` settles; undefined → already settled. */
export function safeReady(p: Promise<void> | undefined): Promise<void> {
  return Promise.resolve(p).then(
    () => undefined,
    () => undefined,
  );
}

/** Resolves after `ms`; the timer never keeps a Node process (tests, tools) alive. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms) as unknown as { unref?: () => void };
    if (t && typeof t.unref === 'function') t.unref();
  });
}
