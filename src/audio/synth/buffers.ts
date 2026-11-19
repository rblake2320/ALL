/**
 * Procedurally generated AudioBuffers, cached per context: seamless white/pink/brown noise, crackle /
 * droplet textures, Karplus-Strong plucks and the reverb impulse response. Generation is deterministic
 * (seeded) so offline renders are reproducible.
 */
import { createRng } from '../prng';

export type NoiseColor = 'white' | 'pink' | 'brown';

interface ContextCache {
  noise: Partial<Record<NoiseColor, AudioBuffer>>;
  textures: Map<string, AudioBuffer>;
  ks: Map<string, AudioBuffer>;
  waves: Map<string, PeriodicWave>;
  ir: AudioBuffer | null;
  lfo: AudioBuffer | null;
}

const caches = new WeakMap<BaseAudioContext, ContextCache>();
const KS_MAX = 64;
const KS_RATE = 24000;

function cacheFor(ctx: BaseAudioContext): ContextCache {
  let c = caches.get(ctx);
  if (!c) {
    c = { noise: {}, textures: new Map(), ks: new Map(), waves: new Map(), ir: null, lfo: null };
    caches.set(ctx, c);
  }
  return c;
}

function rate(ctx: BaseAudioContext): number {
  const sr = ctx.sampleRate;
  return Number.isFinite(sr) && sr >= 3000 ? sr : 44100;
}

function normalize(x: Float32Array, peak: number): void {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < x.length; i++) x[i] *= k;
  }
}

function removeDc(x: Float32Array): void {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  const mean = s / Math.max(1, x.length);
  for (let i = 0; i < x.length; i++) x[i] -= mean;
}

/** Crossfade the extra tail into the head so the buffer loops without a click. */
function makeSeamless(x: Float32Array, n: number, fade: number): Float32Array {
  const out = x.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    out[i] = x[i] * w + x[n + i] * (1 - w);
  }
  return out;
}

export function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  const cache = cacheFor(ctx);
  const hit = cache.noise[color];
  if (hit) return hit;
  const sr = rate(ctx);
  const n = Math.round(sr * 3);
  const fade = Math.round(sr * 0.05);
  const raw = new Float32Array(n + fade);
  const r = createRng(color === 'white' ? 1 : color === 'pink' ? 2 : 3);
  if (color === 'white') {
    for (let i = 0; i < raw.length; i++) raw[i] = r.next() * 2 - 1;
  } else if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = r.next() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      raw[i] = b0 + b1 + b2 + w * 0.1848;
    }
  } else {
    let b = 0;
    let hp = 0;
    let prev = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = r.next() * 2 - 1;
      b = (b + 0.02 * w) / 1.02;
      // DC blocker keeps the random walk centred
      hp = b - prev + 0.997 * hp;
      prev = b;
      raw[i] = hp;
    }
  }
  const x = makeSeamless(raw, n, fade);
  removeDc(x);
  normalize(x, color === 'white' ? 0.9 : 0.85);
  const buf = ctx.createBuffer(1, n, sr);
  buf.getChannelData(0).set(x);
  cache.noise[color] = buf;
  return buf;
}

/** Random-LFO table: new random values per second at playbackRate 1. */
export const LFO_TABLE_RATE = 10;
/** Table sample rate: low (small table) but inside every browser's createBuffer range. */
export const LFO_TABLE_SR = 8000;
const LFO_POINTS = 64;
const LFO_STEP = LFO_TABLE_SR / LFO_TABLE_RATE;

/**
 * Smooth cyclic random signal (Catmull-Rom through 64 seeded points, peak 0.9, zero mean) for slow random
 * modulation. Played at playbackRate = rateHz / LFO_TABLE_RATE, so 0.2 Hz gusts and 80 Hz flutter both use
 * ordinary playback rates (0.02..8): no browser clamps or resampler limits are involved, unlike crawling a
 * full-rate noise buffer at 1e-5x.
 */
export function lfoBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cache = cacheFor(ctx);
  if (cache.lfo) return cache.lfo;
  const r = createRng(4242);
  const pts = new Float64Array(LFO_POINTS);
  let mean = 0;
  for (let i = 0; i < LFO_POINTS; i++) {
    pts[i] = r.next() * 2 - 1;
    mean += pts[i];
  }
  mean /= LFO_POINTS;
  for (let i = 0; i < LFO_POINTS; i++) pts[i] -= mean;
  const n = LFO_POINTS * LFO_STEP;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / LFO_STEP);
    const u = (i - k * LFO_STEP) / LFO_STEP;
    const p0 = pts[(k + LFO_POINTS - 1) % LFO_POINTS];
    const p1 = pts[k];
    const p2 = pts[(k + 1) % LFO_POINTS];
    const p3 = pts[(k + 2) % LFO_POINTS];
    // Catmull-Rom: C1-continuous, and cyclic indices make the loop seamless
    x[i] = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  }
  removeDc(x);
  normalize(x, 0.9);
  const buf = ctx.createBuffer(1, n, LFO_TABLE_SR);
  buf.getChannelData(0).set(x);
  cache.lfo = buf;
  return buf;
}

export interface TextureOpts {
  /** Small grains per second. */
  rate: number;
  /** Big pops per second. */
  popRate: number;
  /** Grain decay range (ms). */
  decayMs: [number, number];
  /** 0..1 high-pass emphasis (crackle brightness). */
  bright: number;
  seconds?: number;
  seed?: number;
}

/** Sparse impulse texture (fire crackle, rain droplets, bristles). Loopable. */
export function textureBuffer(ctx: BaseAudioContext, key: string, o: TextureOpts): AudioBuffer {
  const cache = cacheFor(ctx);
  const hit = cache.textures.get(key);
  if (hit) return hit;
  const sr = rate(ctx);
  const n = Math.round(sr * (o.seconds ?? 4));
  const x = new Float32Array(n);
  const r = createRng(o.seed ?? 77);
  const grain = (pos: number, amp: number, decay: number): void => {
    const len = Math.min(n, Math.round(decay * sr * 4));
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (decay * sr));
      const w = r.next() * 2 - 1;
      lp = lp + (w - lp) * (1 - o.bright * 0.85);
      const v = (o.bright > 0.5 ? w - lp : lp) * env * amp;
      x[(pos + i) % n] += v;
    }
  };
  const grains = Math.round(o.rate * (n / sr));
  for (let g = 0; g < grains; g++) {
    const amp = Math.pow(r.next(), 2.2) * 0.8 + 0.05;
    grain(Math.floor(r.next() * n), amp, r.range(o.decayMs[0], o.decayMs[1]) / 1000);
  }
  const pops = Math.round(o.popRate * (n / sr));
  for (let p = 0; p < pops; p++) grain(Math.floor(r.next() * n), r.range(0.7, 1), r.range(o.decayMs[1], o.decayMs[1] * 2.5) / 1000);
  removeDc(x);
  normalize(x, 0.9);
  const buf = ctx.createBuffer(1, n, sr);
  buf.getChannelData(0).set(x);
  cache.textures.set(key, buf);
  return buf;
}

/**
 * Karplus-Strong plucked string rendered in JS (fractional delay, damping loop filter, DC blocker).
 * `decay` = seconds to -60 dB, `bright` 0..1. Cached (LRU) per pitch/decay/brightness.
 */
export function ksBuffer(ctx: BaseAudioContext, freq: number, decay: number, bright: number): AudioBuffer {
  const f = Math.min(4000, Math.max(30, Number.isFinite(freq) ? freq : 220));
  const d = Math.min(3, Math.max(0.05, Number.isFinite(decay) ? decay : 0.8));
  const br = Math.min(1, Math.max(0, Number.isFinite(bright) ? bright : 0.5));
  const key = `${Math.round(f * 4)}|${Math.round(d * 20)}|${Math.round(br * 10)}`;
  const cache = cacheFor(ctx);
  const hit = cache.ks.get(key);
  if (hit) {
    cache.ks.delete(key);
    cache.ks.set(key, hit);
    return hit;
  }
  const sr = KS_RATE;
  const len = Math.round(sr * (d + 0.03));
  const out = new Float32Array(len);
  const period = sr / f;
  const delay = Math.max(2, period - 0.5);
  const size = Math.ceil(delay) + 4;
  const line = new Float32Array(size);
  const r = createRng(Math.round(f * 13) + 7);
  // excitation: lowpassed noise burst, mean removed
  let lp = 0;
  const exLen = Math.min(size, Math.ceil(period));
  const ex = new Float32Array(exLen);
  let mean = 0;
  for (let i = 0; i < exLen; i++) {
    lp += (r.next() * 2 - 1 - lp) * (0.25 + 0.7 * br);
    ex[i] = lp;
    mean += lp;
  }
  mean /= exLen;
  const g = Math.pow(10, -3 / (f * d)); // per-period loop gain for -60 dB at `decay`
  const s = 0.5 - 0.35 * br; // loop filter mix (lower = brighter)
  let w = 0;
  let prev = 0;
  let dcX = 0;
  let dcY = 0;
  for (let n = 0; n < len; n++) {
    const readPos = w - delay;
    const i0 = Math.floor(readPos);
    const frac = readPos - i0;
    const a = line[((i0 % size) + size) % size];
    const b = line[(((i0 + 1) % size) + size) % size];
    const delayed = a + (b - a) * frac;
    const filtered = g * ((1 - s) * delayed + s * prev);
    prev = delayed;
    const input = n < exLen ? ex[n] - mean : 0;
    const y = input + filtered;
    line[w % size] = y;
    w++;
    // DC blocker
    dcY = y - dcX + 0.995 * dcY;
    dcX = y;
    out[n] = dcY;
  }
  // tiny fade-out to avoid a tail click
  const fl = Math.min(len, Math.round(sr * 0.02));
  for (let i = 0; i < fl; i++) out[len - 1 - i] *= i / fl;
  normalize(out, 0.9);
  const buf = ctx.createBuffer(1, len, sr);
  buf.getChannelData(0).set(out);
  cache.ks.set(key, buf);
  if (cache.ks.size > KS_MAX) {
    const oldest = cache.ks.keys().next().value;
    if (oldest !== undefined) cache.ks.delete(oldest);
  }
  return buf;
}

/** Stereo impulse response: early reflections + damped exponential tail. */
export function reverbIR(ctx: BaseAudioContext, seconds = 1.7): AudioBuffer {
  const cache = cacheFor(ctx);
  if (cache.ir) return cache.ir;
  const sr = rate(ctx);
  const n = Math.round(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const x = buf.getChannelData(ch);
    const r = createRng(ch === 0 ? 101 : 202);
    const pre = Math.round(sr * 0.012);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.9 * t) / (seconds * 0.85));
      const damp = 0.15 + 0.8 * Math.min(1, t / seconds);
      lp += (r.next() * 2 - 1 - lp) * (1 - damp);
      x[i] = lp * env;
    }
    // early reflections
    const taps = [0.017, 0.023, 0.031, 0.041, 0.053, 0.067];
    for (let k = 0; k < taps.length; k++) {
      const pos = Math.round(sr * (taps[k] + (ch ? 0.0023 * k : 0)));
      if (pos < n) x[pos] += (k % 2 ? -1 : 1) * 0.5 * Math.pow(0.8, k);
    }
    const fade = Math.round(sr * 0.05);
    for (let i = 0; i < fade; i++) x[n - 1 - i] *= i / fade;
  }
  cache.ir = buf;
  return buf;
}

/** Cached PeriodicWave from harmonic amplitudes (index 1 = fundamental). */
export function harmonicWave(ctx: BaseAudioContext, key: string, harmonics: readonly number[]): PeriodicWave | null {
  const cache = cacheFor(ctx);
  const hit = cache.waves.get(key);
  if (hit) return hit;
  try {
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    for (let i = 0; i < harmonics.length; i++) imag[i + 1] = harmonics[i];
    const w = ctx.createPeriodicWave(real, imag);
    cache.waves.set(key, w);
    return w;
  } catch {
    return null;
  }
}

/** Pulse wave of a given duty cycle (0.05..0.5) as a PeriodicWave. */
export function pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave | null {
  const d = Math.min(0.5, Math.max(0.05, Number.isFinite(duty) ? duty : 0.5));
  const q = Math.round(d * 20) / 20;
  const h: number[] = [];
  // 64 harmonics: a 72 Hz groan still reaches ~4.6 kHz, so F3 of buzzy low voices is excited
  // (PeriodicWave tables are band-limited per pitch range, so high voices do not alias)
  for (let k = 1; k <= 64; k++) h.push((2 / (k * Math.PI)) * Math.sin(k * Math.PI * q));
  // sin terms of a pulse are cosine-phase; fine for audio (phase-insensitive)
  return harmonicWave(ctx, `pulse${q}`, h);
}
