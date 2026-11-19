/** Household events, socials and gross-out comedy. */
import { textureBuffer } from '../synth/buffers';
import {
  clap, creak, envAHR, filterNode, fmBell, gainNode, lfo, metal, miniVoice, noiseHit, noiseSrc, oscNode, randomLfo,
  shaper, squelch, startStop, stereo, tick, tone,
} from '../synth/core';
import type { OneShot, Sx } from '../synth/types';
import { planVoice } from '../voice/groanish';
import { renderVoice } from '../voice/render';
import { done, N } from './util';

export const doorOpen: OneShot = (sx) => {
  const r = sx.rng;
  return done(sx,
    tick(sx, { f: 2200, peak: 0.18 }),
    noiseHit(sx, { filter: 'bandpass', f: 1800, q: 2, d: 0.015, peak: 0.12 }),
    creak(sx, { at: 0.05, rate: r.range(38, 50), rate2: r.range(22, 30), d: 0.6, peak: 0.22, formants: [r.range(560, 640), 1250, 2700] }),
    tone(sx, { at: 0.64, f: 110, f2: 75, glide: 0.06, d: 0.1, peak: 0.14 }));
};

export const doorbell: OneShot = (sx) =>
  done(sx,
    fmBell(sx, { f: N(74), ratio: 2, index: 1.2, d: 1.0, peak: 0.26, bright: 0.2 }),
    fmBell(sx, { f: N(86), ratio: 2, index: 0.3, d: 0.4, peak: 0.05 }),
    fmBell(sx, { at: 0.45, f: N(70), ratio: 2, index: 1.2, d: 0.72, peak: 0.24, bright: 0.2 }));

export const mailbox: OneShot = (sx) =>
  done(sx,
    metal(sx, { f: 640, ratios: [1, 2.4, 3.95, 5.6], d: 0.28, peak: 0.2 }),
    creak(sx, { at: 0.02, rate: 60, rate2: 40, d: 0.22, peak: 0.1, formants: [900, 2000, 3200] }),
    noiseHit(sx, { at: 0.1, filter: 'bandpass', f: 3200, q: 1, a: 0.02, d: 0.1, peak: 0.06 }),
    tone(sx, { at: 0.25, f: 180, f2: 120, glide: 0.04, d: 0.06, peak: 0.16 }),
    metal(sx, { at: 0.25, f: 700, ratios: [1, 2.4, 3.9], d: 0.15, peak: 0.1 }));

/** One ring burst: bell trill (0.9 s). */
export function ringBurst(sx: Sx, dt: number): number {
  const ends: number[] = [];
  for (let i = 0; i < 14; i++) {
    const shape = Math.min(1, (i + 1) / 3, (14 - i) / 3);
    ends.push(fmBell(sx, { at: dt + i * 0.0625, f: N(i % 2 ? 88 : 84), ratio: 2.01, index: 0.8, d: 0.12, peak: 0.11 * shape }));
  }
  return Math.max(...ends);
}

export const phoneRing: OneShot = (sx) => done(sx, ringBurst(sx, 0));

export const phoneDial: OneShot = (sx) => {
  const rows = [697, 770, 852];
  const cols = [1209, 1336, 1477];
  const ends: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 0.12;
    ends.push(
      tone(sx, { at: a, f: sx.rng.pick(rows), a: 0.005, hold: 0.06, d: 0.02, peak: 0.1 }),
      tone(sx, { at: a, f: sx.rng.pick(cols), a: 0.005, hold: 0.06, d: 0.02, peak: 0.08 }),
    );
  }
  return done(sx, ...ends);
};

function honk(sx: Sx, dt: number, len: number): number {
  return Math.max(
    tone(sx, { at: dt, type: 'sawtooth', f: 349, f2: 342, glide: len, a: 0.012, hold: len, d: 0.06, peak: 0.12, lp: 1600 }),
    tone(sx, { at: dt, type: 'sawtooth', f: 440, f2: 431, glide: len, a: 0.012, hold: len, d: 0.06, peak: 0.1, lp: 1600 }),
  );
}

export const carpoolHonk: OneShot = (sx) => done(sx, honk(sx, 0, 0.16), honk(sx, 0.25, 0.36));

export const trashLid: OneShot = (sx) =>
  done(sx,
    metal(sx, { f: 520, ratios: [1, 1.59, 2.14, 2.65, 3.91], d: 0.45, peak: 0.22 }),
    noiseHit(sx, { filter: 'bandpass', f: 3000, q: 0.7, d: 0.04, peak: 0.26 }),
    metal(sx, { at: 0.14, f: 560, ratios: [1, 1.6, 2.2], d: 0.2, peak: 0.1 }),
    tone(sx, { at: 0.14, f: 150, f2: 110, glide: 0.04, d: 0.06, peak: 0.1 }));

export const dishClatter: OneShot = (sx) => {
  const ends: number[] = [];
  for (let i = 0; i < 5; i++) {
    ends.push(fmBell(sx, { at: sx.rng.range(0, 0.4), f: sx.rng.range(2200, 4500), ratio: 2.71, index: 0.7, d: sx.rng.range(0.08, 0.2), peak: sx.rng.range(0.06, 0.14) }));
  }
  ends.push(
    noiseHit(sx, { at: sx.rng.range(0, 0.2), filter: 'bandpass', f: 4000, q: 1, d: 0.03, peak: 0.05 }),
    noiseHit(sx, { at: sx.rng.range(0.2, 0.4), filter: 'bandpass', f: 3600, q: 1, d: 0.03, peak: 0.05 }),
  );
  return done(sx, ...ends);
};

export const plantChomp: OneShot = (sx) => {
  const ends = [
    noiseHit(sx, { filter: 'bandpass', f: 3200, q: 1.5, d: 0.02, peak: 0.28 }),
    noiseHit(sx, { filter: 'bandpass', f: 900, f2: 400, sweep: 0.1, q: 2, a: 0.005, d: 0.1, peak: 0.32 }),
    tone(sx, { f: 220, f2: 90, glide: 0.1, d: 0.14, peak: 0.26 }),
    squelch(sx, { at: 0.05, f: 600, f2: 250, d: 0.15, peak: 0.12 }),
  ];
  for (let i = 0; i < 4; i++) ends.push(noiseHit(sx, { at: sx.rng.range(0.1, 0.3), filter: 'bandpass', f: sx.rng.range(2500, 4000), q: 2, d: 0.012, peak: 0.1 }));
  return done(sx, ...ends);
};

export const limbDrop: OneShot = (sx) => {
  const ends = [
    tone(sx, { f: 110, f2: 45, glide: 0.15, d: 0.2, peak: 0.36 }),
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 500, d: 0.12, peak: 0.2 }),
    squelch(sx, { at: 0.01, f: 1100, f2: 260, d: 0.28, peak: 0.28, q: 5 }),
    noiseHit(sx, { at: 0.005, color: 'pink', filter: 'bandpass', f: 750, q: 1.2, d: 0.09, peak: 0.22 }),
  ];
  let a = 0.12;
  for (let i = 0; i < 3; i++) {
    const f = sx.rng.range(1200, 2500);
    ends.push(tone(sx, { at: a, f, f2: f * 0.9, glide: 0.02, d: 0.03, peak: 0.1 }), noiseHit(sx, { at: a, filter: 'bandpass', f: 3000, q: 2, d: 0.006, peak: 0.06 }));
    a += sx.rng.range(0.04, 0.08);
  }
  return done(sx, ...ends);
};

export const limbReattach: OneShot = (sx) =>
  done(sx,
    tick(sx, { at: 0.02, f: 3000, peak: 0.08 }),
    squelch(sx, { f: 300, f2: 1200, d: 0.25, peak: 0.17 }),
    tone(sx, { at: 0.26, f: 400, f2: 900, glide: 0.04, d: 0.06, peak: 0.22 }),
    fmBell(sx, { at: 0.3, f: 2637, ratio: 3, index: 0.5, d: 0.3, peak: 0.06 }),
    fmBell(sx, { at: 0.36, f: 3520, ratio: 3, index: 0.5, d: 0.3, peak: 0.05 }));

export const crumble: OneShot = (sx) => {
  const ends = [
    tone(sx, { f: 70, f2: 40, glide: 0.2, d: 0.3, peak: 0.32 }),
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 1500, f2: 400, sweep: 1.0, a: 0.03, d: 1.0, peak: 0.16 }),
  ];
  let a = 0.01;
  for (let i = 0; i < 22; i++) {
    const k = 1 - i / 26;
    ends.push(noiseHit(sx, { at: a, filter: 'bandpass', f: sx.rng.range(1200, 4500), q: 2, d: sx.rng.range(0.01, 0.03), peak: sx.rng.range(0.05, 0.16) * k }));
    a += 0.012 + i * 0.0025 + sx.rng.range(0, 0.02);
    if (a > 0.95) break;
  }
  for (let i = 0; i < 3; i++) {
    const f = sx.rng.range(900, 1400);
    ends.push(tone(sx, { at: sx.rng.range(0.1, 0.7), f, f2: f * 0.85, glide: 0.03, d: 0.04, peak: 0.12 }));
  }
  return done(sx, ...ends);
};

/** Big resurrection cue (stinger category). */
export const reanimate: OneShot = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  // rising electric zap
  const saw = oscNode(ctx, 'sawtooth', 80 * sx.pitch);
  saw.frequency.setValueAtTime(80 * sx.pitch, t);
  saw.frequency.exponentialRampToValueAtTime(900 * sx.pitch, t + 0.55);
  const zg = gainNode(ctx, 0);
  const zEnd = envAHR(zg.gain, t, 0.09 * sx.vol, 0.02, 0.45, 0.15);
  randomLfo(sx, 40, 300, saw.detune, t, zEnd);
  const bp = filterNode(ctx, 'bandpass', 1500, 1);
  saw.connect(bp).connect(zg).connect(sx.out);
  startStop(saw, t, zEnd);
  const ends = [zEnd];
  // choir: D minor swelling into D major (Picardy third)
  const choirNote = (dt: number, m: number, d: number, v: number) => {
    const g = gainNode(ctx, 0);
    const e = envAHR(g.gain, t + dt, 0.05 * v * sx.vol, 0.25, d, 0.5);
    const mix = gainNode(ctx, 1);
    const f1 = filterNode(ctx, 'bandpass', 600, 5);
    const f2 = filterNode(ctx, 'bandpass', 1000, 7);
    for (const det of [-9, 9]) {
      const o = oscNode(ctx, 'sawtooth', N(m) * sx.pitch);
      o.detune.value = det;
      o.connect(f1);
      o.connect(f2);
      startStop(o, t + dt, e);
    }
    f1.connect(mix);
    f2.connect(mix);
    mix.connect(g).connect(sx.out);
    ends.push(e);
  };
  choirNote(0.05, 50, 0.3, 1);
  choirNote(0.1, 53, 0.25, 0.9);
  choirNote(0.12, 57, 0.25, 0.9);
  choirNote(0.55, 54, 0.55, 1.1);
  choirNote(0.55, 62, 0.55, 0.9);
  ends.push(
    tone(sx, { at: 0.55, f: 90, f2: 35, glide: 0.2, d: 0.6, peak: 0.42 }),
    noiseHit(sx, { at: 0.55, color: 'brown', filter: 'lowpass', f: 300, d: 0.5, peak: 0.3 }),
    fmBell(sx, { at: 0.62, f: N(98), ratio: 3, index: 0.5, d: 0.6, peak: 0.06 }),
    fmBell(sx, { at: 0.72, f: N(102), ratio: 3, index: 0.5, d: 0.6, peak: 0.05 }),
  );
  return done(sx, ...ends);
};

export const fireStart: OneShot = (sx) => {
  const ends = [
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 200, f2: 2500, sweep: 0.25, a: 0.05, d: 0.5, peak: 0.42 }),
    noiseHit(sx, { color: 'brown', filter: 'lowpass', f: 300, a: 0.03, d: 0.4, peak: 0.3 }),
  ];
  for (let i = 0; i < 6; i++) ends.push(noiseHit(sx, { at: sx.rng.range(0.1, 0.7), filter: 'bandpass', f: sx.rng.range(2000, 6000), q: 2, d: 0.006, peak: sx.rng.range(0.08, 0.2) }));
  return done(sx, ...ends);
};

/** Fire roar + crackle texture into dest; end null = loop until stopped. */
export function fireBed(sx: Sx, dest: AudioNode, t: number, end: number | null): AudioScheduledSourceNode[] {
  const ctx = sx.ctx;
  const e = end ?? Infinity;
  const roar = noiseSrc(sx, 'brown', t, e);
  const hpR = filterNode(ctx, 'highpass', 160, 0.7);
  const lp = filterNode(ctx, 'lowpass', 900, 0.7);
  const rg = gainNode(ctx, 0.55);
  roar.connect(hpR).connect(lp).connect(rg).connect(dest);
  const tex = ctx.createBufferSource();
  tex.buffer = textureBuffer(ctx, 'fire', { rate: 16, popRate: 1.2, decayMs: [1, 6], bright: 0.75, seconds: 5, seed: 21 });
  tex.loop = true;
  const hp = filterNode(ctx, 'highpass', 1200, 0.7);
  const tg = gainNode(ctx, 1);
  tex.connect(hp).connect(tg).connect(dest);
  try {
    tex.start(t, sx.rng.next() * 4.5);
    if (end !== null) tex.stop(end + 0.02);
  } catch {
    /* ignore */
  }
  return [roar, tex, randomLfo(sx, 2.2, 0.22, rg.gain, t, e), randomLfo(sx, 1.3, 200, lp.frequency, t, e)];
}

export const fireLoop: OneShot = (sx) => {
  const g = gainNode(sx.ctx, 0);
  const end = envAHR(g.gain, sx.t, 0.55 * sx.vol, 0.15, 0.7, 0.3);
  g.connect(sx.out);
  fireBed(sx, g, sx.t, end);
  return done(sx, end);
};

export const extinguish: OneShot = (sx) => {
  const ctx = sx.ctx;
  const ends = [
    noiseHit(sx, { filter: 'highpass', f: 3000, a: 0.03, hold: 0.5, d: 0.4, peak: 0.26 }),
    noiseHit(sx, { filter: 'bandpass', f: 6000, q: 0.8, a: 0.02, hold: 0.4, d: 0.3, peak: 0.1 }),
    noiseHit(sx, { at: 0.2, color: 'pink', filter: 'bandpass', f: 1200, q: 0.6, a: 0.2, d: 0.6, peak: 0.08 }),
  ];
  const tex = ctx.createBufferSource();
  tex.buffer = textureBuffer(ctx, 'sizzle', { rate: 90, popRate: 3, decayMs: [0.6, 3], bright: 0.9, seconds: 3, seed: 5 });
  tex.loop = true;
  const g = gainNode(ctx, 0);
  const e = envAHR(g.gain, sx.t, 0.18 * sx.vol, 0.1, 0.3, 0.5);
  tex.connect(g).connect(sx.out);
  startStop(tex, sx.t, e);
  ends.push(e);
  return done(sx, ...ends);
};

/** A single buzzing fly into dest (pan wanders). */
export function fly(sx: Sx, dest: AudioNode, t: number, end: number, level: number): AudioScheduledSourceNode[] {
  const ctx = sx.ctx;
  const f = sx.rng.range(180, 250) * sx.pitch;
  const o = oscNode(ctx, 'sawtooth', f);
  const bp = filterNode(ctx, 'bandpass', 420, 1);
  const hp = filterNode(ctx, 'highpass', 150, 0.7);
  const g = gainNode(ctx, level);
  const pan = stereo(ctx, sx.rng.range(-0.5, 0.5));
  o.connect(bp).connect(hp).connect(g).connect(pan).connect(dest);
  startStop(o, t, end);
  const srcs: AudioScheduledSourceNode[] = [
    o,
    randomLfo(sx, 3.5, f * 0.16, o.frequency, t, end),
    lfo(sx, 'sine', sx.rng.range(9, 14), 6, o.frequency, t, end),
    randomLfo(sx, 2.5, level * 0.7, g.gain, t, end),
  ];
  if ('pan' in pan) srcs.push(randomLfo(sx, 0.8, 0.5, (pan as StereoPannerNode).pan, t, end));
  return srcs;
}

export const flies: OneShot = (sx) => {
  const g = gainNode(sx.ctx, 0);
  const end = envAHR(g.gain, sx.t, 1 * sx.vol, 0.15, 0.8, 0.25);
  g.connect(sx.out);
  for (let i = 0; i < 3; i++) fly(sx, g, sx.t, end, 0.06);
  return done(sx, end);
};

export const zap: OneShot = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, 0.2 * sx.vol, 0.004, 0.12, 0.1);
  const a = oscNode(ctx, 'sawtooth', 120 * sx.pitch);
  const b = oscNode(ctx, 'square', 1700 * sx.pitch);
  const bp = filterNode(ctx, 'bandpass', 2500, 1.5);
  const ws = shaper(ctx, 4);
  a.connect(bp);
  b.connect(bp);
  bp.connect(ws).connect(g).connect(sx.out);
  randomLfo(sx, 60, 800, b.frequency, t, end);
  startStop(a, t, end);
  startStop(b, t, end);
  const ends = [end];
  for (let i = 0; i < 4; i++) ends.push(noiseHit(sx, { at: sx.rng.range(0, 0.2), filter: 'highpass', f: 3000, d: 0.005, peak: 0.2 }));
  return done(sx, ...ends);
};

export const kiss: OneShot = (sx) =>
  done(sx,
    tone(sx, { f: 180, a: 0.04, hold: 0.08, d: 0.05, peak: 0.08, lp: 600 }),
    tone(sx, { at: 0.14, f: 350, f2: 950, glide: 0.015, d: 0.03, peak: 0.26 }),
    noiseHit(sx, { at: 0.14, filter: 'bandpass', f: 1800, q: 1.5, d: 0.02, peak: 0.2 }),
    fmBell(sx, { at: 0.17, f: 2400, ratio: 3, index: 0.4, d: 0.2, peak: 0.04 }));

export const hug: OneShot = (sx) =>
  done(sx,
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 900, a: 0.06, d: 0.25, peak: 0.26 }),
    tone(sx, { at: 0.05, f: 200, f2: 190, a: 0.05, hold: 0.1, d: 0.15, vib: [5, 20], peak: 0.08, lp: 800 }),
    fmBell(sx, { at: 0.15, f: N(84), ratio: 2, index: 0.3, d: 0.35, peak: 0.05 }),
    fmBell(sx, { at: 0.2, f: N(88), ratio: 2, index: 0.3, d: 0.3, peak: 0.04 }));

export const slap: OneShot = (sx) =>
  done(sx,
    noiseHit(sx, { filter: 'highpass', f: 900, a: 0.001, d: 0.05, peak: 0.5 }),
    noiseHit(sx, { filter: 'bandpass', f: 2500, q: 0.7, d: 0.03, peak: 0.25 }),
    tone(sx, { f: 220, f2: 150, glide: 0.03, d: 0.04, peak: 0.2 }));

export const laugh: OneShot = (sx) => {
  const plan = planVoice(sx.rng.int(1, 99999), sx.rng.range(0.35, 0.7), 'laugh', 1000, sx.rng.int(0, 999));
  return renderVoice(sx, plan, 0.9).end - sx.t;
};

export const cheer: OneShot = (sx) => {
  const ends: number[] = [];
  for (let k = 0; k < 5; k++) {
    const f = sx.rng.range(160, 320);
    ends.push(miniVoice(sx, { at: sx.rng.range(0, 0.12), f, f2: f * 1.25, d: sx.rng.range(0.6, 0.85), peak: 0.07, formants: [700, 1200], formants2: [550, 1800], vib: 25 }));
  }
  for (let i = 0; i < 10; i++) ends.push(clap(sx, { at: sx.rng.range(0.1, 0.95), peak: sx.rng.range(0.1, 0.2), f: sx.rng.range(1000, 1500) }));
  return done(sx, ...ends);
};

export const partyHorn: OneShot = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  const o = oscNode(ctx, 'sawtooth', 500 * sx.pitch);
  o.frequency.setValueAtTime(500 * sx.pitch, t);
  o.frequency.linearRampToValueAtTime(560 * sx.pitch, t + 0.45);
  o.frequency.linearRampToValueAtTime(470 * sx.pitch, t + 0.72);
  const bp = filterNode(ctx, 'bandpass', 1500, 2);
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, 0.3 * sx.vol, 0.03, 0.55, 0.15);
  const am = gainNode(ctx, 0.75);
  o.connect(bp).connect(g).connect(am).connect(sx.out);
  lfo(sx, 'sine', 24, 0.25, am.gain, t, end);
  startStop(o, t, end);
  return done(sx, end, noiseHit(sx, { filter: 'bandpass', f: 2500, q: 1, a: 0.03, hold: 0.5, d: 0.15, peak: 0.03 }));
};
