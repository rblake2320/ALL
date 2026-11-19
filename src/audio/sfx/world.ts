/** World / service / ambience sounds (power, ghoul, pizza, owl, wind, crickets, thunder, crows, rain, full moon). */
import { textureBuffer } from '../synth/buffers';
import {
  envAHR, filterNode, gainNode, lfo, miniVoice, noiseHit, noiseSrc, oscNode, randomLfo, rampExp, rampLin, setAt,
  startStop, tick, tone,
} from '../synth/core';
import type { OneShot, Sx } from '../synth/types';
import { cloneSx } from '../synth/types';
import { choke, done, motif, N } from './util';

export const powerOff: OneShot = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  const o = oscNode(ctx, 'sawtooth', 220 * sx.pitch);
  setAt(o.frequency, 220 * sx.pitch, t);
  rampExp(o.frequency, 28 * sx.pitch, t + 0.8);
  const lp = filterNode(ctx, 'lowpass', 2000, 1);
  setAt(lp.frequency, 2000, t);
  rampExp(lp.frequency, 200, t + 0.8);
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, 0.15 * sx.vol, 0.01, 0.3, 0.5);
  o.connect(lp).connect(g).connect(sx.out);
  startStop(o, t, end);
  return done(sx, end,
    tick(sx, { f: 1800, peak: 0.26 }),
    noiseHit(sx, { filter: 'bandpass', f: 1200, q: 2, d: 0.02, peak: 0.2 }),
    tone(sx, { f: 120, f2: 40, glide: 0.8, a: 0.01, hold: 0.2, d: 0.5, peak: 0.12 }));
};

export const powerOn: OneShot = (sx) => {
  const ends = [
    tone(sx, { f: 140, f2: 60, glide: 0.06, d: 0.08, peak: 0.32 }),
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 800, d: 0.05, peak: 0.2 }),
    tone(sx, { type: 'sawtooth', f: 40, f2: 120, glide: 0.35, a: 0.1, hold: 0.2, d: 0.3, peak: 0.06, lp: 900 }),
    tone(sx, { f: 60, f2: 120, glide: 0.35, a: 0.1, hold: 0.2, d: 0.3, peak: 0.1 }),
    tone(sx, { at: 0.3, f: 120, a: 0.05, hold: 0.2, d: 0.3, peak: 0.05 }),
  ];
  for (let i = 0; i < 3; i++) ends.push(tick(sx, { at: 0.1 + i * 0.07 + sx.rng.range(0, 0.03), f: 4000, peak: 0.07 }));
  return done(sx, ...ends);
};

/** Ominous arrival of the Repo Ghoul (stinger category). */
export const repoGhoul: OneShot = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  const ends = [
    tone(sx, { type: 'sawtooth', f: 55, a: 0.3, hold: 0.6, d: 0.5, peak: 0.1, lp: 400 }),
    tone(sx, { type: 'sawtooth', f: 58.27, a: 0.3, hold: 0.6, d: 0.5, peak: 0.1, lp: 400 }),
    miniVoice(sx, { at: 0.2, f: 140, f2: 105, d: 1.0, peak: 0.12, formants: [570, 840], formants2: [330, 820], vib: 30 }),
    noiseHit(sx, { color: 'pink', filter: 'bandpass', f: 400, f2: 1600, sweep: 0.8, q: 0.8, a: 0.3, d: 0.5, peak: 0.12 }),
  ];
  for (const m of [57, 58, 64]) {
    const o = oscNode(ctx, 'sawtooth', N(m) * sx.pitch);
    const lp = filterNode(ctx, 'lowpass', 1500, 0.7);
    const g = gainNode(ctx, 0);
    const e = envAHR(g.gain, t, 0.05 * sx.vol, 0.2, 0.35, 0.45);
    const trem = gainNode(ctx, 0.6);
    o.connect(lp).connect(g).connect(trem).connect(sx.out);
    lfo(sx, 'sine', 8, 0.4, trem.gain, t, e);
    startStop(o, t, e);
    ends.push(e);
  }
  return done(sx, ...ends);
};

export const pizzaArrive: OneShot = (sx) =>
  choke(sx, 1.15, 0.35, (s) =>
    done(s,
      tone(s, { type: 'square', f: 700, f2: 680, glide: 0.1, a: 0.01, hold: 0.08, d: 0.04, peak: 0.12, lp: 2500 }),
      tone(s, { at: 0.17, type: 'square', f: 700, f2: 680, glide: 0.1, a: 0.01, hold: 0.08, d: 0.04, peak: 0.12, lp: 2500 }),
      // cardboard box set down
      noiseHit(s, { at: 0.36, color: 'pink', filter: 'lowpass', f: 450, d: 0.08, peak: 0.24 }),
      tone(s, { at: 0.36, f: 150, f2: 100, glide: 0.05, d: 0.08, peak: 0.18 }),
      motif(s, 'marimba', [[0.5, 72, 0.2, 0.7], [0.6, 76, 0.2, 0.7], [0.7, 79, 0.35, 0.8]])));

/** Distant moaning chorus into a muffled distance filter. */
export function groanCluster(sx: Sx, dt: number, voices: number, level: number): number {
  const lp = filterNode(sx.ctx, 'lowpass', 900, 0.7);
  lp.connect(sx.out);
  const s = cloneSx(sx, lp);
  let end = sx.t;
  for (let k = 0; k < voices; k++) {
    const f = sx.rng.range(85, 130);
    end = Math.max(end, miniVoice(s, { at: dt + sx.rng.range(0, 0.3), f, f2: f * 0.85, d: sx.rng.range(0.7, 0.9), peak: 0.07 * level, formants: [570, 840], formants2: [330, 820], vib: 20 }));
  }
  return end;
}

export const groanAmbient: OneShot = (sx) => done(sx, groanCluster(sx, 0, 4, 1));

function hoot(sx: Sx, dt: number, len: number, f: number): number {
  return Math.max(
    tone(sx, { at: dt, f, f2: f * 0.94, glide: len, a: 0.04, hold: len * 0.5, d: len * 0.5, peak: 0.24, lp: 1500 }),
    tone(sx, { at: dt, f: f * 2, f2: f * 1.88, glide: len, a: 0.05, hold: len * 0.4, d: len * 0.4, peak: 0.02 }),
    noiseHit(sx, { at: dt, color: 'pink', filter: 'lowpass', f: 600, a: 0.03, d: len, peak: 0.04 }),
  );
}

/** One dog "woof": a short formant burst gliding down, a noise rasp on the front, a low thump under it. */
function woof(sx: Sx, at: number, f: number, peak: number): number[] {
  return [
    miniVoice(sx, { at, f, f2: f * 0.62, d: 0.14, peak, formants: [640, 1150], formants2: [440, 820], type: 'sawtooth' }),
    noiseHit(sx, { at, color: 'pink', filter: 'bandpass', f: 1500, q: 1.1, d: 0.06, peak: peak * 0.55 }),
    tone(sx, { at, f: f * 0.5, f2: f * 0.34, glide: 0.1, d: 0.13, peak: peak * 0.5 }),
  ];
}

/** A dog barking at something at the gate (a Guard pet and the Repo Ghoul): woof, woof, woof-woof. Synthesized, no samples. */
export const bark: OneShot = (sx) => {
  const f = sx.rng.range(300, 380);
  return done(sx, ...woof(sx, 0, f, 0.3), ...woof(sx, 0.3, f * 0.94, 0.27), ...woof(sx, 0.78, f * 1.04, 0.3), ...woof(sx, 0.98, f * 0.97, 0.25));
};

export const owl: OneShot = (sx) => {
  const f = sx.rng.range(360, 400);
  return done(sx, hoot(sx, 0, 0.3, f), hoot(sx, 0.42, 0.12, f * 0.97), hoot(sx, 0.56, 0.12, f * 0.97), hoot(sx, 0.74, 0.42, f * 0.95));
};

/** Wind bed (gusty howl + body) into dest. */
export function windBed(sx: Sx, dest: AudioNode, t: number, end: number | null, howl = 1): AudioScheduledSourceNode[] {
  const ctx = sx.ctx;
  const e = end ?? Infinity;
  const a = noiseSrc(sx, 'pink', t, e);
  const bp = filterNode(ctx, 'bandpass', 420, 2.6);
  const ga = gainNode(ctx, 0.7 * howl);
  a.connect(bp).connect(ga).connect(dest);
  const b = noiseSrc(sx, 'brown', t, e);
  const lp = filterNode(ctx, 'lowpass', 500, 0.7);
  const gb = gainNode(ctx, 0.35);
  b.connect(lp).connect(gb).connect(dest);
  return [a, b, randomLfo(sx, 0.9, 230, bp.frequency, t, e), randomLfo(sx, 0.35, 0.35 * howl, ga.gain, t, e), randomLfo(sx, 0.2, 0.15, gb.gain, t, e)];
}

export const wind: OneShot = (sx) => {
  const g = gainNode(sx.ctx, 0);
  const end = envAHR(g.gain, sx.t, 0.6 * sx.vol, 0.35, 0.4, 0.45);
  g.connect(sx.out);
  windBed(sx, g, sx.t, end);
  return done(sx, end);
};

/** One cricket chirp (3-4 pulses) at dt. */
export function chirp(sx: Sx, dt: number, f: number, level: number): number {
  const n = sx.rng.int(3, 4);
  let end = sx.t;
  for (let p = 0; p < n; p++) end = Math.max(end, tone(sx, { at: dt + p * 0.045, f, a: 0.004, hold: 0.012, d: 0.012, peak: 0.07 * level }));
  return end;
}

export const crickets: OneShot = (sx) => {
  const ends: number[] = [];
  for (let c = 0; c < 2; c++) {
    const f = sx.rng.range(4200, 5200);
    const period = sx.rng.range(0.35, 0.55);
    for (let t = c * 0.13; t < 1.05; t += period) ends.push(chirp(sx, t, f, 1));
  }
  return done(sx, ...ends);
};

/** Thunder (ambient category, longer tail). */
export const thunder: OneShot = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, 0.62 * sx.vol, 0.08, 0.4, 2.6);
  const n = noiseSrc(sx, 'brown', t, end);
  const lp = filterNode(ctx, 'lowpass', 1200, 0.7);
  setAt(lp.frequency, 1200, t);
  rampExp(lp.frequency, 160, t + 2.5);
  const am = gainNode(ctx, 0.7);
  n.connect(lp).connect(g).connect(am).connect(sx.out);
  randomLfo(sx, 3, 0.35, am.gain, t, end);
  return done(sx, end,
    noiseHit(sx, { filter: 'highpass', f: 1500, a: 0.002, d: 0.15, peak: 0.3 }),
    noiseHit(sx, { at: 0.6, color: 'brown', filter: 'lowpass', f: 600, f2: 120, sweep: 2, a: 0.3, d: 2, peak: 0.35 }));
};

/** Distant crow caws (day ambience; internal, not an SfxId). */
export const crow: OneShot = (sx) => {
  const ctx = sx.ctx;
  const lp = filterNode(ctx, 'lowpass', 3000, 0.7);
  lp.connect(sx.out);
  const caws = sx.rng.int(1, 3);
  let end = sx.t;
  for (let i = 0; i < caws; i++) {
    const t = sx.t + i * sx.rng.range(0.28, 0.36);
    const f = sx.rng.range(700, 900) * sx.pitch;
    const o = oscNode(ctx, 'sawtooth', f);
    setAt(o.frequency, f, t);
    rampExp(o.frequency, f * 0.8, t + 0.25);
    const g = gainNode(ctx, 0);
    const e = envAHR(g.gain, t, 0.12 * sx.vol, 0.02, 0.08, 0.15);
    randomLfo(sx, 80, 60, o.frequency, t, e);
    const mix = gainNode(ctx, 1);
    const f1 = filterNode(ctx, 'bandpass', 1300, 3);
    const f2 = filterNode(ctx, 'bandpass', 2600, 4);
    o.connect(f1).connect(mix);
    o.connect(f2).connect(mix);
    mix.connect(g).connect(lp);
    startStop(o, t, e);
    end = Math.max(end, e);
  }
  return done(sx, end);
};

/** Rain bed: hiss + droplet texture + low rumble. */
export function rainBed(sx: Sx, dest: AudioNode, t: number, end: number | null): AudioScheduledSourceNode[] {
  const ctx = sx.ctx;
  const e = end ?? Infinity;
  const a = noiseSrc(sx, 'pink', t, e);
  const hp = filterNode(ctx, 'highpass', 500, 0.7);
  const lp = filterNode(ctx, 'lowpass', 7500, 0.7);
  const ga = gainNode(ctx, 0.45);
  a.connect(hp).connect(lp).connect(ga).connect(dest);
  const tex = ctx.createBufferSource();
  tex.buffer = textureBuffer(ctx, 'rain', { rate: 140, popRate: 4, decayMs: [0.4, 2], bright: 0.85, seconds: 4, seed: 33 });
  tex.loop = true;
  const bp = filterNode(ctx, 'bandpass', 4200, 0.8);
  const gt = gainNode(ctx, 0.35);
  tex.connect(bp).connect(gt).connect(dest);
  try {
    tex.start(t, sx.rng.next() * 3.5);
    if (end !== null) tex.stop(end + 0.02);
  } catch {
    /* ignore */
  }
  const b = noiseSrc(sx, 'brown', t, e);
  const blp = filterNode(ctx, 'lowpass', 220, 0.7);
  const gb = gainNode(ctx, 0.3);
  b.connect(blp).connect(gb).connect(dest);
  return [a, tex, b, randomLfo(sx, 0.3, 0.1, ga.gain, t, e)];
}

export const rain: OneShot = (sx) => {
  const g = gainNode(sx.ctx, 0);
  const end = envAHR(g.gain, sx.t, 0.6 * sx.vol, 0.3, 0.5, 0.4);
  g.connect(sx.out);
  rainBed(sx, g, sx.t, end);
  return done(sx, end);
};

/**
 * Full-moon shimmer bed: glass-harmonica partials (A5 · E6 · B6, each a slowly beating sine pair) that swell in
 * and out on their own 6-14 s cycles, over a thin high "air". Quiet and outdoors-only by nature (the indoor
 * lowpass removes it).
 */
export function moonBed(sx: Sx, dest: AudioNode, t: number, end: number | null): AudioScheduledSourceNode[] {
  const ctx = sx.ctx;
  const e = end ?? Infinity;
  const srcs: AudioScheduledSourceNode[] = [];
  const partials: readonly (readonly [number, number, number])[] = [
    // [Hz, beat Hz, level]
    [880, 0.37, 0.5],
    [1318.5, 0.53, 0.36],
    [1975.5, 0.71, 0.22],
  ];
  for (const [f, beat, lvl] of partials) {
    const swell = gainNode(ctx, 0.4 * lvl);
    swell.connect(dest);
    for (const df of [0, beat]) {
      const o = oscNode(ctx, 'sine', (f + df) * sx.pitch);
      const g = gainNode(ctx, 0.5);
      o.connect(g).connect(swell);
      startStop(o, t, e);
      srcs.push(o);
    }
    // ±0.378·lvl around 0.4·lvl: each partial breathes from near-silence to full on its own clock
    srcs.push(randomLfo(sx, sx.rng.range(0.07, 0.16), 0.42 * lvl, swell.gain, t, e));
  }
  const air = noiseSrc(sx, 'white', t, e);
  const bp = filterNode(ctx, 'bandpass', 6200, 0.9);
  const ag = gainNode(ctx, 0.05);
  air.connect(bp).connect(ag).connect(dest);
  srcs.push(air, randomLfo(sx, 0.12, 0.04, ag.gain, t, e));
  return srcs;
}

/** One "awooo": rising onset, sustained bloom with growing vibrato, falling tail; lowpassed by distance. */
function howlCall(sx: Sx, dt: number, len: number, f: number, level: number, lpHz: number): number {
  const ctx = sx.ctx;
  const t = sx.t + dt;
  const fp = f * sx.pitch;
  const o = oscNode(ctx, 'triangle', fp * 0.78);
  setAt(o.frequency, fp * 0.78, t);
  rampExp(o.frequency, fp, t + 0.4);
  rampLin(o.frequency, fp * 1.03, t + len * 0.62);
  rampExp(o.frequency, fp * 0.7, t + len);
  const vib = oscNode(ctx, 'sine', 5.3);
  const vg = gainNode(ctx, 0);
  setAt(vg.gain, 0, t);
  rampLin(vg.gain, 16, t + len * 0.5);
  vib.connect(vg).connect(o.detune);
  const g = gainNode(ctx, 0);
  // distant: sits with the owls (≈ -30 dB once the ambience event gain applies), not over them
  const end = envAHR(g.gain, t, 0.1 * level * sx.vol, 0.32, Math.max(0, len - 0.87), 0.55);
  // throat: one soft formant gliding u -> o -> u, mixed with the (nearly pure) source
  const bp = filterNode(ctx, 'bandpass', 700, 1.4);
  setAt(bp.frequency, 520 * sx.pitch, t);
  rampLin(bp.frequency, 820 * sx.pitch, t + 0.5);
  rampLin(bp.frequency, 600 * sx.pitch, t + len);
  const lp = filterNode(ctx, 'lowpass', lpHz, 0.7);
  const mix = gainNode(ctx, 1);
  o.connect(mix);
  o.connect(bp).connect(mix);
  mix.connect(lp).connect(g).connect(sx.out);
  startStop(o, t, end);
  startStop(vib, t, end);
  const breath = noiseHit(sx, { at: dt, color: 'pink', filter: 'bandpass', f: f * 2.2, q: 2, a: 0.08, d: 0.5, peak: 0.01 * level, lp: lpHz });
  return Math.max(end, breath);
}

/** Distant full-moon howl, answered from farther away about half the time (ambient; ends by ~3 s). */
export const howl: OneShot = (sx) => {
  const r = sx.rng;
  let end = howlCall(sx, 0, r.range(1.7, 2.2), r.range(390, 470), 1, 2200);
  if (r.chance(0.55)) end = Math.max(end, howlCall(sx, r.range(0.9, 1.2), r.range(1.3, 1.7), r.range(420, 520), 0.45, 1300));
  return done(sx, end);
};
