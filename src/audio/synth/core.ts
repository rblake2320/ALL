/**
 * Synthesis toolkit. Every helper is NaN-proof (WebAudio throws on non-finite values), schedules its own
 * stop, and returns the absolute end time so recipes can compute their duration. Frequencies are scaled
 * by sx.pitch and levels by sx.vol automatically.
 */
import { LFO_TABLE_RATE, lfoBuffer, noiseBuffer, ksBuffer, type NoiseColor } from './buffers';
import type { Sx } from './types';

export const EPS = 1e-4;

export function fin(x: number, fb: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fb;
}

function tm(t: number): number {
  const v = fin(t, 0);
  return v < 0 ? 0 : v;
}

export function setAt(p: AudioParam, v: number, t: number): void {
  try {
    p.setValueAtTime(fin(v, 0), tm(t));
  } catch {
    /* ignore */
  }
}

export function rampLin(p: AudioParam, v: number, t: number): void {
  try {
    p.linearRampToValueAtTime(fin(v, 0), tm(t));
  } catch {
    /* ignore */
  }
}

export function rampExp(p: AudioParam, v: number, t: number): void {
  try {
    const x = fin(v, EPS);
    p.exponentialRampToValueAtTime(Math.abs(x) < EPS ? (x < 0 ? -EPS : EPS) : x, tm(t));
  } catch {
    /* ignore */
  }
}

export function targetAt(p: AudioParam, v: number, t: number, tc: number): void {
  try {
    p.setTargetAtTime(fin(v, 0), tm(t), Math.max(0.0005, fin(tc, 0.01)));
  } catch {
    /* ignore */
  }
}

/** Live (unscheduled) change without zipper noise: hold the current value, then glide. */
export function glideParam(ctx: BaseAudioContext, p: AudioParam, v: number, tc: number): void {
  try {
    const now = ctx.currentTime;
    const cur = fin(p.value, fin(v, 0));
    p.cancelScheduledValues(now);
    p.setValueAtTime(cur, now);
    p.setTargetAtTime(fin(v, 0), now, Math.max(0.001, fin(tc, 0.03)));
  } catch {
    /* ignore */
  }
}

/** Percussive envelope: linear attack to `peak`, exponential decay reaching -60 dB at t+a+d. */
export function envPerc(p: AudioParam, t: number, peak: number, a: number, d: number): number {
  const att = Math.max(0.001, fin(a, 0.002));
  const dec = Math.max(0.005, fin(d, 0.2));
  setAt(p, 0, t);
  rampLin(p, Math.max(0, fin(peak, 0)), t + att);
  targetAt(p, 0, t + att, dec / 6.9);
  return t + att + dec;
}

/** Attack / hold / exponential release. */
export function envAHR(p: AudioParam, t: number, peak: number, a: number, hold: number, r: number): number {
  const att = Math.max(0.001, fin(a, 0.005));
  const h = Math.max(0, fin(hold, 0));
  const rel = Math.max(0.005, fin(r, 0.1));
  const pk = Math.max(0, fin(peak, 0));
  setAt(p, 0, t);
  rampLin(p, pk, t + att);
  if (h > 0) setAt(p, pk, t + att + h);
  targetAt(p, 0, t + att + h, rel / 6.9);
  return t + att + h + rel;
}

export function gainNode(ctx: BaseAudioContext, v: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = fin(v, 0);
  return g;
}

export function filterNode(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  const nyq = ctx.sampleRate / 2;
  f.frequency.value = Math.min(nyq * 0.98, Math.max(10, fin(freq, 1000)));
  f.Q.value = Math.max(0.0001, fin(q, 0.707));
  f.gain.value = fin(gainDb, 0);
  return f;
}

/** Start at t; schedule a stop only for a finite end (loops pass Infinity and stop explicitly later). */
export function startStop(src: AudioScheduledSourceNode, t: number, end: number): void {
  try {
    src.start(tm(t));
    if (Number.isFinite(end)) src.stop(tm(Math.max(end, t) + 0.02));
  } catch {
    /* ignore */
  }
}

/** Stop a source now-or-later, swallowing InvalidStateError (never started / already stopped). */
export function stopSrc(src: AudioScheduledSourceNode, when: number): void {
  try {
    src.stop(tm(when));
  } catch {
    /* ignore */
  }
}

export function oscNode(ctx: BaseAudioContext, type: OscillatorType, freq: number, wave?: PeriodicWave | null): OscillatorNode {
  const o = ctx.createOscillator();
  if (wave) o.setPeriodicWave(wave);
  else o.type = type;
  o.frequency.value = Math.min(ctx.sampleRate / 2, Math.max(0.01, fin(freq, 440)));
  return o;
}

/** Looping noise source starting at a random offset (so repeated hits never sound identical). */
export function noiseSrc(sx: Sx, color: NoiseColor, t: number, end: number, rate = 1): AudioBufferSourceNode {
  const src = sx.ctx.createBufferSource();
  const buf = noiseBuffer(sx.ctx, color);
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = Math.max(0.0001, fin(rate, 1));
  try {
    src.start(tm(t), sx.rng.next() * Math.max(0, buf.duration - 0.01));
    if (Number.isFinite(end)) src.stop(tm(Math.max(end, t) + 0.02));
  } catch {
    /* ignore */
  }
  return src;
}

export function connect(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[0];
}

export function stereo(ctx: BaseAudioContext, pan: number): AudioNode {
  const c = ctx as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode };
  if (typeof c.createStereoPanner === 'function') {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, fin(pan, 0)));
    return p;
  }
  return ctx.createGain();
}

/** Sine/other LFO added onto a param (depth in param units). */
export function lfo(sx: Sx, type: OscillatorType, rateHz: number, depth: number, param: AudioParam, t: number, end: number): OscillatorNode {
  const o = oscNode(sx.ctx, type, rateHz);
  const g = gainNode(sx.ctx, depth);
  o.connect(g).connect(param);
  startStop(o, t, end);
  return o;
}

/** Playback-rate bounds for the random-LFO table (0.01 Hz .. 640 Hz modulation). */
const LFO_RATE_MIN = 1e-3;
const LFO_RATE_MAX = 64;

/** Map a modulation rate (random values per second) to the LFO table's playback rate. */
export function lfoPlaybackRate(rateHz: number): number {
  const r = fin(rateHz, 2) / LFO_TABLE_RATE;
  return r < LFO_RATE_MIN ? LFO_RATE_MIN : r > LFO_RATE_MAX ? LFO_RATE_MAX : r;
}

/**
 * Smooth random modulation at `rateHz` new values per second, peak ±0.9·depth, added onto `param`.
 * Uses the shared low-rate LFO table (see lfoBuffer) from a random offset, so every voice drifts differently.
 */
export function randomLfo(sx: Sx, rateHz: number, depth: number, param: AudioParam, t: number, end: number): AudioBufferSourceNode {
  const ctx = sx.ctx;
  const src = ctx.createBufferSource();
  const buf = lfoBuffer(ctx);
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = lfoPlaybackRate(rateHz);
  try {
    src.start(tm(t), sx.rng.next() * Math.max(0, buf.duration - 0.01));
    if (Number.isFinite(end)) src.stop(tm(Math.max(end, t) + 0.02));
  } catch {
    /* ignore */
  }
  const g = gainNode(ctx, depth);
  src.connect(g).connect(param);
  return src;
}

const curves = new Map<number, Float32Array>();
/** Soft-clip waveshaper (tanh), curve cached per drive amount. */
export function shaper(ctx: BaseAudioContext, drive: number): WaveShaperNode {
  const k = Math.round(Math.min(20, Math.max(1, fin(drive, 2))) * 4) / 4;
  let c = curves.get(k);
  if (!c) {
    c = new Float32Array(1024);
    const norm = Math.tanh(k);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    curves.set(k, c);
  }
  const ws = ctx.createWaveShaper();
  ws.curve = c as Float32Array<ArrayBuffer>;
  ws.oversample = '2x';
  return ws;
}

// ───────────────────────────── composite voices ─────────────────────────────

export interface ToneOpts {
  at?: number;
  type?: OscillatorType;
  wave?: PeriodicWave | null;
  f: number;
  /** Glide target (exponential unless glideLin). */
  f2?: number;
  glide?: number;
  glideLin?: boolean;
  a?: number;
  hold?: number;
  d: number;
  peak: number;
  detune?: number;
  /** [rateHz, cents] */
  vib?: [number, number];
  lp?: number;
  lpQ?: number;
  hp?: number;
  dest?: AudioNode;
}

export function tone(sx: Sx, o: ToneOpts): number {
  const ctx = sx.ctx;
  const t = sx.t + fin(o.at ?? 0, 0);
  const a = o.a ?? 0.004;
  const hold = o.hold ?? 0;
  const f = fin(o.f, 440) * sx.pitch;
  const os = oscNode(ctx, o.type ?? 'sine', f, o.wave);
  setAt(os.frequency, f, t);
  if (o.f2 !== undefined) {
    const f2 = Math.max(1, fin(o.f2, o.f) * sx.pitch);
    const gt = t + Math.max(0.002, fin(o.glide ?? a + hold + o.d, 0.1));
    if (o.glideLin) rampLin(os.frequency, f2, gt);
    else rampExp(os.frequency, f2, gt);
  }
  if (o.detune) os.detune.value = fin(o.detune, 0);
  const g = gainNode(ctx, 0);
  const end = hold > 0 || o.a !== undefined ? envAHR(g.gain, t, o.peak * sx.vol, a, hold, o.d) : envPerc(g.gain, t, o.peak * sx.vol, a, o.d);
  if (o.vib) lfo(sx, 'sine', o.vib[0], o.vib[1], os.detune, t, end);
  let head: AudioNode = os;
  if (o.lp) {
    const lp = filterNode(ctx, 'lowpass', o.lp * sx.pitch, o.lpQ ?? 0.707);
    head.connect(lp);
    head = lp;
  }
  if (o.hp) {
    const hp = filterNode(ctx, 'highpass', o.hp, 0.707);
    head.connect(hp);
    head = hp;
  }
  head.connect(g).connect(o.dest ?? sx.out);
  startStop(os, t, end);
  return end;
}

export interface NoiseOpts {
  at?: number;
  color?: NoiseColor;
  filter?: BiquadFilterType;
  f: number;
  f2?: number;
  sweep?: number;
  q?: number;
  a?: number;
  hold?: number;
  d: number;
  peak: number;
  rate?: number;
  hp?: number;
  lp?: number;
  dest?: AudioNode;
}

export function noiseHit(sx: Sx, o: NoiseOpts): number {
  const ctx = sx.ctx;
  const t = sx.t + fin(o.at ?? 0, 0);
  const a = o.a ?? 0.002;
  const hold = o.hold ?? 0;
  const g = gainNode(ctx, 0);
  const end = hold > 0 || o.a !== undefined ? envAHR(g.gain, t, o.peak * sx.vol, a, hold, o.d) : envPerc(g.gain, t, o.peak * sx.vol, a, o.d);
  const src = noiseSrc(sx, o.color ?? 'white', t, end, o.rate ?? 1);
  const flt = filterNode(ctx, o.filter ?? 'bandpass', o.f * sx.pitch, o.q ?? 1);
  if (o.f2 !== undefined) {
    setAt(flt.frequency, o.f * sx.pitch, t);
    rampExp(flt.frequency, Math.min(ctx.sampleRate * 0.48, Math.max(20, o.f2 * sx.pitch)), t + fin(o.sweep ?? a + hold + o.d, 0.1));
  }
  let head: AudioNode = flt;
  src.connect(flt);
  if (o.hp) {
    const hp = filterNode(ctx, 'highpass', o.hp, 0.707);
    head.connect(hp);
    head = hp;
  }
  if (o.lp) {
    const lp = filterNode(ctx, 'lowpass', o.lp, 0.707);
    head.connect(lp);
    head = lp;
  }
  head.connect(g).connect(o.dest ?? sx.out);
  return end;
}

export interface BellOpts {
  at?: number;
  f: number;
  ratio: number;
  index: number;
  d: number;
  peak: number;
  a?: number;
  /** Fraction of d over which the modulation index decays. */
  bright?: number;
  dest?: AudioNode;
  detune?: number;
}

/** 2-operator FM bell/chime/tine. */
export function fmBell(sx: Sx, o: BellOpts): number {
  const ctx = sx.ctx;
  const t = sx.t + fin(o.at ?? 0, 0);
  const f = fin(o.f, 880) * sx.pitch;
  const car = oscNode(ctx, 'sine', f);
  const mod = oscNode(ctx, 'sine', f * fin(o.ratio, 2));
  const mg = gainNode(ctx, 0);
  const dev = f * fin(o.ratio, 2) * fin(o.index, 1);
  setAt(mg.gain, dev, t);
  targetAt(mg.gain, dev * 0.05, t, Math.max(0.005, o.d * (o.bright ?? 0.25)) / 3);
  mod.connect(mg).connect(car.frequency);
  if (o.detune) car.detune.value = o.detune;
  const g = gainNode(ctx, 0);
  const end = envPerc(g.gain, t, o.peak * sx.vol, o.a ?? 0.002, o.d);
  car.connect(g).connect(o.dest ?? sx.out);
  startStop(car, t, end);
  startStop(mod, t, end);
  return end;
}

/** Inharmonic partial stack (metal clank, bar, plate). */
export function metal(sx: Sx, o: { at?: number; f: number; ratios: readonly number[]; d: number; peak: number; dest?: AudioNode; a?: number }): number {
  const ctx = sx.ctx;
  const t = sx.t + fin(o.at ?? 0, 0);
  const out = gainNode(ctx, 1);
  out.connect(o.dest ?? sx.out);
  let end = t;
  for (let i = 0; i < o.ratios.length; i++) {
    const os = oscNode(ctx, 'sine', fin(o.f, 400) * o.ratios[i] * sx.pitch);
    const g = gainNode(ctx, 0);
    const e = envPerc(g.gain, t, (o.peak * sx.vol) / (1 + i * 0.6), o.a ?? 0.001, o.d / (1 + i * 0.35));
    os.connect(g).connect(out);
    startStop(os, t, e);
    end = Math.max(end, e);
  }
  return end;
}

/** Karplus-Strong pluck (buffer cached per pitch). */
export function pluck(sx: Sx, o: { at?: number; f: number; d: number; bright: number; peak: number; dest?: AudioNode; lp?: number }): number {
  const ctx = sx.ctx;
  const t = sx.t + fin(o.at ?? 0, 0);
  const buf = ksBuffer(ctx, fin(o.f, 220) * sx.pitch, o.d, o.bright);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = gainNode(ctx, fin(o.peak * sx.vol, 0));
  let head: AudioNode = src;
  if (o.lp) {
    const lp = filterNode(ctx, 'lowpass', o.lp, 0.707);
    src.connect(lp);
    head = lp;
  }
  head.connect(g).connect(o.dest ?? sx.out);
  const end = t + buf.duration;
  startStop(src, t, end);
  return end;
}

export function kick(sx: Sx, o: { at?: number; f0?: number; f1?: number; d?: number; peak: number; click?: number; dest?: AudioNode }): number {
  const t = sx.t + fin(o.at ?? 0, 0);
  const at = o.at ?? 0;
  const d = o.d ?? 0.32;
  const end = tone(sx, { at, f: o.f0 ?? 140, f2: o.f1 ?? 46, glide: 0.07, d, peak: o.peak, dest: o.dest });
  if ((o.click ?? 0.25) > 0) noiseHit(sx, { at, filter: 'lowpass', f: 3500, d: 0.012, peak: o.peak * (o.click ?? 0.25), dest: o.dest });
  return Math.max(end, t + d);
}

export function snare(sx: Sx, o: { at?: number; peak: number; tone?: number; d?: number; dest?: AudioNode }): number {
  const at = o.at ?? 0;
  const e1 = tone(sx, { at, type: 'triangle', f: o.tone ?? 190, f2: (o.tone ?? 190) * 0.8, glide: 0.05, d: 0.09, peak: o.peak * 0.5, dest: o.dest });
  const e2 = noiseHit(sx, { at, filter: 'highpass', f: 1400, d: o.d ?? 0.17, peak: o.peak * 0.7, lp: 9000, dest: o.dest });
  return Math.max(e1, e2);
}

export function hat(sx: Sx, o: { at?: number; peak: number; d?: number; f?: number; dest?: AudioNode }): number {
  return noiseHit(sx, { at: o.at, filter: 'highpass', f: o.f ?? 7500, q: 0.8, d: o.d ?? 0.05, peak: o.peak, dest: o.dest });
}

/** Hand clap: three quick bursts then a short tail. */
export function clap(sx: Sx, o: { at?: number; peak: number; f?: number; dest?: AudioNode }): number {
  const ctx = sx.ctx;
  const t = sx.t + fin(o.at ?? 0, 0);
  const g = gainNode(ctx, 0);
  const pk = o.peak * sx.vol;
  for (let i = 0; i < 3; i++) {
    setAt(g.gain, pk * (0.7 + i * 0.15), t + i * 0.011);
    targetAt(g.gain, 0, t + i * 0.011 + 0.001, 0.003);
  }
  setAt(g.gain, pk, t + 0.033);
  targetAt(g.gain, 0, t + 0.034, 0.03);
  const end = t + 0.25;
  const src = noiseSrc(sx, 'white', t, end);
  const bp = filterNode(ctx, 'bandpass', (o.f ?? 1200) * sx.pitch, 1.1);
  src.connect(bp).connect(g).connect(o.dest ?? sx.out);
  return end;
}

/** Wet squelch: resonant band sweep on pink noise + a low "blorp". */
export function squelch(sx: Sx, o: { at?: number; f: number; f2: number; d: number; peak: number; q?: number; dest?: AudioNode }): number {
  const e1 = noiseHit(sx, { at: o.at, color: 'pink', filter: 'bandpass', f: o.f, f2: o.f2, q: o.q ?? 7, a: 0.01, d: o.d, peak: o.peak * 1.6, dest: o.dest });
  const e2 = tone(sx, { at: o.at, type: 'sine', f: o.f * 0.32, f2: o.f2 * 0.32, glide: o.d * 0.7, d: o.d * 0.7, peak: o.peak * 0.45, dest: o.dest });
  return Math.max(e1, e2);
}

/** Stick-slip creak: jittery low pulse train through narrow wood resonances. */
export function creak(sx: Sx, o: { at?: number; rate: number; rate2: number; d: number; peak: number; formants?: readonly number[]; q?: number; dest?: AudioNode }): number {
  const ctx = sx.ctx;
  const t = sx.t + fin(o.at ?? 0, 0);
  const os = oscNode(ctx, 'sawtooth', o.rate);
  setAt(os.frequency, o.rate, t);
  rampExp(os.frequency, o.rate2, t + o.d * 0.9);
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, o.peak * sx.vol, 0.03, o.d * 0.6, o.d * 0.4);
  randomLfo(sx, 18, o.rate * 0.35, os.frequency, t, end);
  const mix = gainNode(ctx, 1);
  for (const f of o.formants ?? [620, 1350, 2600]) {
    const bp = filterNode(ctx, 'bandpass', f * sx.pitch, o.q ?? 9);
    os.connect(bp).connect(mix);
  }
  mix.connect(g).connect(o.dest ?? sx.out);
  startStop(os, t, end);
  return end;
}

/** Short tick: a tiny decaying sine with a noise edge. */
export function tick(sx: Sx, o: { at?: number; f: number; peak: number; d?: number; noise?: number; dest?: AudioNode }): number {
  const d = o.d ?? 0.018;
  const e1 = tone(sx, { at: o.at, f: o.f, f2: o.f * 0.75, glide: d, d, peak: o.peak, dest: o.dest });
  const e2 = o.noise === 0 ? 0 : noiseHit(sx, { at: o.at, filter: 'bandpass', f: o.f * 2.5, q: 1.5, d: 0.006, peak: o.peak * (o.noise ?? 0.5), dest: o.dest });
  return Math.max(e1, e2);
}

/** Simple formant "voice" for crowds / babble (cheap: 1 osc + 2 formants). */
export function miniVoice(sx: Sx, o: { at?: number; f: number; f2: number; d: number; peak: number; formants: readonly [number, number]; formants2?: readonly [number, number]; vib?: number; dest?: AudioNode; type?: OscillatorType }): number {
  const ctx = sx.ctx;
  const t = sx.t + fin(o.at ?? 0, 0);
  const os = oscNode(ctx, o.type ?? 'sawtooth', o.f * sx.pitch);
  setAt(os.frequency, o.f * sx.pitch, t);
  rampExp(os.frequency, o.f2 * sx.pitch, t + o.d);
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, o.peak * sx.vol, 0.03, o.d * 0.55, o.d * 0.45);
  if (o.vib) lfo(sx, 'sine', 5.5, o.vib, os.detune, t, end);
  const mix = gainNode(ctx, 1);
  const f1 = filterNode(ctx, 'bandpass', o.formants[0] * sx.pitch, 6);
  const f2 = filterNode(ctx, 'bandpass', o.formants[1] * sx.pitch, 8);
  if (o.formants2) {
    rampExp(f1.frequency, o.formants2[0] * sx.pitch, t + o.d);
    rampExp(f2.frequency, o.formants2[1] * sx.pitch, t + o.d);
  }
  const g2 = gainNode(ctx, 0.5);
  os.connect(f1).connect(mix);
  os.connect(f2).connect(g2).connect(mix);
  mix.connect(g).connect(o.dest ?? sx.out);
  startStop(os, t, end);
  return end;
}
