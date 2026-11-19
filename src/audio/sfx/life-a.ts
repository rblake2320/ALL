/** Domestic life sounds (kitchen, bathroom, hobbies). */
import { generateBar } from '../music/composer';
import { playNote } from '../music/instruments';
import { MOODS } from '../music/moods';
import { secondsPerBeat, swingBeat } from '../music/scheduler';
import { textureBuffer } from '../synth/buffers';
import {
  creak, envAHR, filterNode, fmBell, gainNode, lfo, metal, noiseHit, noiseSrc, oscNode, randomLfo, shaper, squelch,
  startStop, tick, tone,
} from '../synth/core';
import type { OneShot, Sx } from '../synth/types';
import { cloneSx } from '../synth/types';
import { planVoice } from '../voice/groanish';
import { renderVoice } from '../voice/render';
import { at, choke, done, N } from './util';

export const footstep: OneShot = (sx) => {
  const r = sx.rng;
  return done(sx,
    tone(sx, { f: r.range(80, 100), f2: 55, glide: 0.06, d: 0.09, peak: 0.24 }),
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: r.range(350, 500), d: 0.06, peak: 0.22 }),
    noiseHit(sx, { at: 0.035, color: 'pink', filter: 'bandpass', f: r.range(1100, 1900), f2: r.range(700, 1000), q: 0.9, a: 0.03, d: 0.13, peak: 0.08 }));
};

export const eat: OneShot = (sx) => {
  const ends: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = i * 0.27 + sx.rng.range(0, 0.03);
    ends.push(
      noiseHit(sx, { at: a, filter: 'bandpass', f: sx.rng.range(1500, 2800), q: 1.1, d: 0.05, peak: 0.24 }),
      noiseHit(sx, { at: a + 0.02, filter: 'bandpass', f: 3500, q: 2, d: 0.03, peak: 0.08 }),
      squelch(sx, { at: a + 0.01, f: 500, f2: 260, d: 0.09, peak: 0.1 }),
      tone(sx, { at: a, f: 160, f2: 120, glide: 0.05, d: 0.06, peak: 0.08 }),
    );
  }
  return done(sx, ...ends);
};

export const drink: OneShot = (sx) => {
  const ends: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = i * 0.3 + sx.rng.range(0, 0.02);
    ends.push(
      tone(sx, { at: a, f: sx.rng.range(170, 200), f2: sx.rng.range(380, 460), glide: 0.06, a: 0.008, d: 0.09, peak: 0.28, lp: 900 }),
      noiseHit(sx, { at: a + 0.05, filter: 'bandpass', f: 650, q: 1.5, d: 0.02, peak: 0.07 }),
    );
  }
  return done(sx, ...ends);
};

/** Sizzle bed shared by the cook one-shot and loop. */
export function sizzle(sx: Sx, dest: AudioNode, t: number, end: number | null): AudioScheduledSourceNode[] {
  const ctx = sx.ctx;
  const hiss = noiseSrc(sx, 'white', t, end ?? Infinity);
  const hp = filterNode(ctx, 'highpass', 2200, 0.7);
  const bp = filterNode(ctx, 'bandpass', 5200, 0.6);
  const hg = gainNode(ctx, 0.35);
  hiss.connect(hp).connect(bp).connect(hg).connect(dest);
  const tex = ctx.createBufferSource();
  tex.buffer = textureBuffer(ctx, 'sizzle', { rate: 90, popRate: 3, decayMs: [0.6, 3], bright: 0.9, seconds: 3, seed: 5 });
  tex.loop = true;
  const thp = filterNode(ctx, 'highpass', 2500, 0.7);
  const tg = gainNode(ctx, 0.55);
  tex.connect(thp).connect(tg).connect(dest);
  try {
    tex.start(t, sx.rng.next() * 2.5);
    if (end !== null) tex.stop(end + 0.02);
  } catch {
    /* ignore */
  }
  return [hiss, tex, randomLfo(sx, 3, 0.15, hg.gain, t, end ?? Infinity)];
}

export const cook: OneShot = (sx) => {
  const g = gainNode(sx.ctx, 0);
  const end = envAHR(g.gain, sx.t, 0.32 * sx.vol, 0.12, 0.6, 0.25);
  g.connect(sx.out);
  sizzle(sx, g, sx.t, end);
  return done(sx, end, squelch(sx, { at: 0.3, f: 500, f2: 900, d: 0.08, peak: 0.04 }));
};

export const chop: OneShot = (sx) =>
  done(sx,
    noiseHit(sx, { filter: 'bandpass', f: 2800, q: 1.5, d: 0.014, peak: 0.32 }),
    tone(sx, { f: 900, f2: 700, glide: 0.02, d: 0.03, peak: 0.16 }),
    tone(sx, { f: 240, f2: 180, glide: 0.03, d: 0.05, peak: 0.22 }));

export const fridgeOpen: OneShot = (sx) =>
  done(sx,
    noiseHit(sx, { color: 'pink', filter: 'lowpass', f: 300, f2: 1200, sweep: 0.1, a: 0.01, d: 0.14, peak: 0.32 }),
    tone(sx, { at: 0.02, f: 90, f2: 70, glide: 0.08, d: 0.1, peak: 0.2 }),
    fmBell(sx, { at: 0.12, f: 2800, ratio: 2.7, index: 0.5, d: 0.18, peak: 0.05 }),
    fmBell(sx, { at: 0.16, f: 3300, ratio: 2.7, index: 0.5, d: 0.15, peak: 0.04 }),
    tone(sx, { at: 0.1, type: 'sawtooth', f: 60, a: 0.15, hold: 0.25, d: 0.25, peak: 0.05, lp: 300 }),
    noiseHit(sx, { at: 0.1, color: 'pink', filter: 'bandpass', f: 180, q: 2, a: 0.15, hold: 0.2, d: 0.25, peak: 0.1 }));

export const microwave: OneShot = (sx) =>
  done(sx,
    tone(sx, { type: 'sawtooth', f: 120, a: 0.05, hold: 0.45, d: 0.1, peak: 0.06, lp: 600 }),
    tone(sx, { f: 60, a: 0.05, hold: 0.45, d: 0.1, peak: 0.12 }),
    noiseHit(sx, { color: 'brown', filter: 'lowpass', f: 400, a: 0.05, hold: 0.45, d: 0.1, peak: 0.08 }),
    fmBell(sx, { at: 0.65, f: 1760, ratio: 3.5, index: 0.8, d: 0.5, peak: 0.2 }));

export const espresso: OneShot = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, 0.2 * sx.vol, 0.1, 0.7, 0.3);
  const src = noiseSrc(sx, 'pink', t, end);
  const bp = filterNode(ctx, 'bandpass', 1600, 3);
  const am = gainNode(ctx, 0.5);
  src.connect(bp).connect(am).connect(g).connect(sx.out);
  randomLfo(sx, 18, 0.5, am.gain, t, end);
  const ends = [
    end,
    tone(sx, { type: 'sawtooth', f: 50, a: 0.05, hold: 0.8, d: 0.2, peak: 0.12, lp: 300 }),
    noiseHit(sx, { filter: 'highpass', f: 4000, a: 0.3, hold: 0.4, d: 0.3, peak: 0.06 }),
  ];
  for (let i = 0; i < 5; i++) ends.push(squelch(sx, { at: sx.rng.range(0.2, 0.9), f: 800, f2: 400, d: 0.05, peak: 0.05 }));
  return done(sx, ...ends);
};

/** Running-water bed (sink); used by one-shot and loop. */
export function waterBed(sx: Sx, dest: AudioNode, t: number, end: number | null, wide: boolean): AudioScheduledSourceNode[] {
  const ctx = sx.ctx;
  const e = end ?? Infinity;
  const a = noiseSrc(sx, wide ? 'white' : 'pink', t, e);
  const out: AudioScheduledSourceNode[] = [a];
  if (wide) {
    // shower: broad hiss
    const hp = filterNode(ctx, 'highpass', 500, 0.7);
    const lp = filterNode(ctx, 'lowpass', 7000, 0.7);
    const g = gainNode(ctx, 0.35);
    a.connect(hp).connect(lp).connect(g).connect(dest);
    const b = noiseSrc(sx, 'pink', t, e);
    const bp = filterNode(ctx, 'bandpass', 2500, 0.5);
    const bg = gainNode(ctx, 0.3);
    b.connect(bp).connect(bg).connect(dest);
    out.push(b, randomLfo(sx, 7, 0.18, bg.gain, t, e), randomLfo(sx, 0.4, 0.08, g.gain, t, e));
  } else {
    const bp = filterNode(ctx, 'bandpass', 1400, 0.8);
    const g = gainNode(ctx, 0.5);
    a.connect(bp).connect(g).connect(dest);
    out.push(randomLfo(sx, 5, 380, bp.frequency, t, e));
    const b = noiseSrc(sx, 'white', t, e);
    const bp2 = filterNode(ctx, 'bandpass', 3500, 1);
    const g2 = gainNode(ctx, 0.12);
    b.connect(bp2).connect(g2).connect(dest);
    out.push(b, randomLfo(sx, 9, 0.08, g2.gain, t, e));
  }
  return out;
}

export function bubble(sx: Sx, dt: number, peak: number): number {
  const f = sx.rng.range(700, 1700);
  return tone(sx, { at: dt, f, f2: f * 1.7, glide: 0.04, a: 0.004, d: 0.05, peak });
}

export function droplet(sx: Sx, dt: number, peak: number): number {
  return tick(sx, { at: dt, f: sx.rng.range(2000, 4500), peak, d: 0.012, noise: 0.3 });
}

export const sinkWater: OneShot = (sx) => {
  const g = gainNode(sx.ctx, 0);
  const end = envAHR(g.gain, sx.t, 0.5 * sx.vol, 0.1, 0.7, 0.3);
  g.connect(sx.out);
  waterBed(sx, g, sx.t, end, false);
  const ends = [end];
  for (let i = 0; i < 6; i++) ends.push(bubble(sx, sx.rng.range(0.1, 0.9), 0.05));
  return done(sx, ...ends);
};

export const shower: OneShot = (sx) => {
  const g = gainNode(sx.ctx, 0);
  const end = envAHR(g.gain, sx.t, 0.55 * sx.vol, 0.15, 0.7, 0.3);
  g.connect(sx.out);
  waterBed(sx, g, sx.t, end, true);
  const ends = [end];
  for (let i = 0; i < 8; i++) ends.push(droplet(sx, sx.rng.range(0.1, 1.0), 0.05));
  return done(sx, ...ends);
};

export const bathSplash: OneShot = (sx) => {
  const ends = [
    noiseHit(sx, { filter: 'bandpass', f: 1800, f2: 700, sweep: 0.3, q: 0.8, a: 0.005, d: 0.35, peak: 0.38 }),
    tone(sx, { f: 140, f2: 70, glide: 0.12, d: 0.16, peak: 0.26 }),
    noiseHit(sx, { at: 0.05, color: 'pink', filter: 'lowpass', f: 800, d: 0.4, peak: 0.14 }),
  ];
  for (let i = 0; i < 6; i++) ends.push(bubble(sx, sx.rng.range(0.1, 0.6), 0.07));
  return done(sx, ...ends);
};

export const iceCrack: OneShot = (sx) => {
  const ends: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = sx.rng.range(0, 0.25);
    ends.push(
      noiseHit(sx, { at: a, filter: 'highpass', f: 2500, d: 0.005, peak: 0.36 }),
      noiseHit(sx, { at: a, filter: 'bandpass', f: sx.rng.range(4000, 6500), q: 6, d: 0.03, peak: 0.12 }),
    );
  }
  ends.push(
    creak(sx, { at: 0.05, rate: 90, rate2: 60, d: 0.35, peak: 0.08, formants: [900, 1900, 3100] }),
    fmBell(sx, { at: 0.2, f: sx.rng.range(3500, 5000), ratio: 2.7, index: 0.5, d: 0.25, peak: 0.05 }),
    fmBell(sx, { at: 0.32, f: sx.rng.range(3500, 5000), ratio: 2.7, index: 0.5, d: 0.25, peak: 0.04 }),
  );
  return done(sx, ...ends);
};

/** One snore cycle: rattling inhale + breathy exhale (~1.15 s). */
export const snore: OneShot = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  const g = gainNode(ctx, 0);
  const end1 = envAHR(g.gain, t, 0.34 * sx.vol, 0.25, 0.22, 0.2);
  const saw = oscNode(ctx, 'sawtooth', 38 * sx.pitch);
  saw.frequency.setValueAtTime(38 * sx.pitch, t);
  saw.frequency.linearRampToValueAtTime(31 * sx.pitch, end1);
  const bp = filterNode(ctx, 'bandpass', 450 * sx.pitch, 1.5);
  saw.connect(bp).connect(g);
  const n = noiseSrc(sx, 'pink', t, end1);
  const nbp = filterNode(ctx, 'bandpass', 900, 1);
  const ng = gainNode(ctx, 0.4);
  n.connect(nbp).connect(ng).connect(g);
  g.connect(sx.out);
  startStop(saw, t, end1);
  return done(sx, end1,
    noiseHit(sx, { at: 0.72, color: 'pink', filter: 'lowpass', f: 1200, a: 0.08, d: 0.35, peak: 0.14 }),
    tone(sx, { at: 0.75, f: 820, f2: 600, glide: 0.25, a: 0.06, hold: 0.1, d: 0.2, peak: 0.03 }));
};

export const yawn: OneShot = (sx) => {
  const plan = planVoice(sx.rng.int(1, 99999), sx.rng.range(0.3, 0.6), 'yawn', 1100, sx.rng.int(0, 999));
  return renderVoice(sx, plan, 0.9).end - sx.t;
};

/** TV static bed (shared with loop). */
export function staticBed(sx: Sx, dest: AudioNode, t: number, end: number | null, level: number): AudioScheduledSourceNode[] {
  const ctx = sx.ctx;
  const n = noiseSrc(sx, 'white', t, end ?? Infinity);
  const bp = filterNode(ctx, 'bandpass', 3000, 0.4);
  const hp = filterNode(ctx, 'highpass', 900, 0.7);
  const g = gainNode(ctx, 0.5 * level);
  n.connect(bp).connect(hp).connect(g).connect(dest);
  const tex = ctx.createBufferSource();
  tex.buffer = textureBuffer(ctx, 'crackle', { rate: 30, popRate: 1.5, decayMs: [0.5, 4], bright: 0.8, seconds: 4, seed: 9 });
  tex.loop = true;
  const tg = gainNode(ctx, 0.4 * level);
  tex.connect(tg).connect(dest);
  try {
    tex.start(t, sx.rng.next() * 3.5);
    if (end !== null) tex.stop(end + 0.02);
  } catch {
    /* ignore */
  }
  return [n, tex];
}

export const tvStatic: OneShot = (sx) => {
  const g = gainNode(sx.ctx, 0);
  const end = envAHR(g.gain, sx.t, 0.36 * sx.vol, 0.02, 0.45, 0.12);
  g.connect(sx.out);
  staticBed(sx, g, sx.t, end, 1);
  return done(sx, end);
};

/** Small-speaker chain for TV voices. */
export function tvSpeaker(sx: Sx): AudioNode {
  const ctx = sx.ctx;
  const hp = filterNode(ctx, 'highpass', 320, 0.7);
  const lp = filterNode(ctx, 'lowpass', 3400, 0.9);
  const pk = filterNode(ctx, 'peaking', 1800, 1.2, 5);
  hp.connect(lp).connect(pk).connect(sx.out);
  return hp;
}

export const tvChatter: OneShot = (sx) => choke(sx, 1.18, 0.12, tvChatterRaw);

const tvChatterRaw: OneShot = (sx) => {
  const spk = tvSpeaker(sx);
  const s = cloneSx(sx, spk);
  const a = renderVoice(s, planVoice(sx.rng.int(1, 1e5), 0.62, 'neutral', 560, sx.rng.int(0, 99)), 0.7);
  const b = renderVoice(at(s, 0.62), planVoice(sx.rng.int(1, 1e5), 0.42, sx.rng.chance(0.5) ? 'question' : 'happy', 520, sx.rng.int(0, 99)), 0.7);
  const g = gainNode(sx.ctx, 0);
  const se = envAHR(g.gain, sx.t, 0.05 * sx.vol, 0.05, 1.0, 0.1);
  g.connect(sx.out);
  staticBed(sx, g, sx.t, se, 1);
  return done(sx, a.end, b.end, se);
};

/** Lo-fi "zombie radio" chain. */
export function radioChain(sx: Sx): AudioNode {
  const ctx = sx.ctx;
  const hp = filterNode(ctx, 'highpass', 280, 0.7);
  const lp = filterNode(ctx, 'lowpass', 3200, 1);
  const ws = shaper(ctx, 1.6);
  const g = gainNode(ctx, 0.9);
  hp.connect(lp).connect(ws).connect(g).connect(sx.out);
  return hp;
}

/**
 * The stereo's "station": the playful CAZ cue, which never plays as the score while the household is live
 * (so a stereo at a party never flams against the party cue), re-mixed with the cue's own instrument balance.
 */
export const RADIO_MOOD = 'caz' as const;
// -2 dB vs a straight 0.8x: matches the stereo loop to the previous radio level (≈ -23.5 dB active RMS)
const RADIO_GAIN = 0.63 * MOODS[RADIO_MOOD].level;

/** Schedule the radio station's notes (bar 0 at `startTime`) into `dest` inside [from, to). */
export function radioNotes(sx: Sx, dest: AudioNode, startTime: number, from: number, to: number): void {
  const mood = MOODS[RADIO_MOOD];
  const spb = secondsPerBeat(mood.bpm, 1);
  const barLen = spb * mood.beatsPerBar;
  const first = Math.max(0, Math.floor((from - startTime) / barLen));
  const last = Math.floor((to - startTime) / barLen);
  const s = cloneSx(sx, dest);
  for (let b = first; b <= last && b - first < 8; b++) {
    const plan = generateBar(RADIO_MOOD, b);
    for (const ev of plan.events) {
      const t = startTime + b * barLen + swingBeat(ev.beat, mood.swing) * spb;
      if (t < from || t >= to) continue;
      s.t = t;
      s.vol = sx.vol * RADIO_GAIN * (mood.mix[ev.inst]?.gain ?? 0.3);
      playNote(s, ev.inst, ev.midi, ev.dur * spb, ev.vel, ev.glide);
    }
  }
}

export const stereoMusic: OneShot = (sx) => {
  const g = gainNode(sx.ctx, 0);
  const end = envAHR(g.gain, sx.t, 0.55 * sx.vol, 0.05, 0.95, 0.2);
  const chainSx = cloneSx(sx, g);
  g.connect(sx.out);
  radioNotes(sx, radioChain(chainSx), sx.t, sx.t, sx.t + 1.0);
  return done(sx, end);
};

function keystroke(sx: Sx, dt: number, vel: number, space: boolean): number {
  if (space) {
    return done(sx,
      tone(sx, { at: dt, f: 180, f2: 150, glide: 0.03, d: 0.045, peak: 0.16 * vel }),
      noiseHit(sx, { at: dt, filter: 'bandpass', f: 1500, q: 1, d: 0.02, peak: 0.12 * vel })) + sx.t;
  }
  return done(sx,
    noiseHit(sx, { at: dt, filter: 'bandpass', f: 4200, q: 1.5, d: 0.006, peak: 0.22 * vel }),
    tone(sx, { at: dt, f: sx.rng.range(1700, 2100), d: 0.012, peak: 0.08 * vel }),
    tone(sx, { at: dt, f: 280, d: 0.02, peak: 0.1 * vel })) + sx.t;
}

/** Typing burst of `n` keys starting at dt; returns end. */
export function typingBurst(sx: Sx, dt: number, n: number): number {
  let t = dt;
  let end = sx.t;
  for (let i = 0; i < n; i++) {
    end = Math.max(end, keystroke(sx, t, sx.rng.range(0.6, 1), sx.rng.chance(0.12)));
    t += sx.rng.range(0.06, 0.13);
  }
  return end;
}

export const computerTyping: OneShot = (sx) => done(sx, typingBurst(sx, 0, 9));

const PENT = [72, 74, 76, 79, 81, 84, 86, 88];

/** One chip-tune phrase (8 sixteenths + optional pew). */
export function arcadePhrase(sx: Sx, dt: number): number {
  const ends: number[] = [];
  const step = 0.1;
  let idx = sx.rng.int(0, 4);
  for (let i = 0; i < 8; i++) {
    idx = Math.max(0, Math.min(PENT.length - 1, idx + sx.rng.pick([-2, -1, 1, 1, 2])));
    ends.push(tone(sx, { at: dt + i * step, type: 'square', f: N(PENT[idx]), a: 0.002, hold: 0.03, d: 0.05, peak: 0.07, lp: 4000 }));
  }
  if (sx.rng.chance(0.6)) ends.push(tone(sx, { at: dt + 0.8, type: 'square', f: 1800, f2: 300, glide: 0.15, a: 0.002, d: 0.16, peak: 0.07, lp: 3500 }));
  else ends.push(noiseHit(sx, { at: dt + 0.8, color: 'brown', filter: 'lowpass', f: 900, f2: 200, sweep: 0.3, d: 0.3, peak: 0.12 }));
  return Math.max(...ends);
}

export const arcadeBlips: OneShot = (sx) => done(sx, arcadePhrase(sx, 0));

export const chessClack: OneShot = (sx) =>
  done(sx,
    tone(sx, { f: 1550, f2: 1400, glide: 0.01, d: 0.02, peak: 0.26 }),
    noiseHit(sx, { filter: 'bandpass', f: 3200, q: 1.5, d: 0.008, peak: 0.18 }),
    tone(sx, { f: 420, f2: 380, glide: 0.02, d: 0.05, peak: 0.16 }));

export const pageTurn: OneShot = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t;
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, 0.24 * sx.vol, 0.06, 0.1, 0.12);
  const src = noiseSrc(sx, 'white', t, end);
  const bp = filterNode(ctx, 'bandpass', 2500, 0.7);
  bp.frequency.setValueAtTime(2500, t);
  bp.frequency.exponentialRampToValueAtTime(5500, t + 0.25);
  const am = gainNode(ctx, 0.65);
  src.connect(bp).connect(g).connect(am).connect(sx.out);
  lfo(sx, 'sine', 26, 0.35, am.gain, t, end);
  return done(sx, end, noiseHit(sx, { at: 0.22, color: 'pink', filter: 'lowpass', f: 350, d: 0.05, peak: 0.16 }));
};

export const paintBrush: OneShot = (sx) => {
  const ctx = sx.ctx;
  const ends = [noiseHit(sx, { color: 'pink', filter: 'bandpass', f: 1300, f2: 2000, sweep: 0.3, q: 1.2, a: 0.08, hold: 0.1, d: 0.2, peak: 0.24 })];
  const tex = ctx.createBufferSource();
  tex.buffer = textureBuffer(ctx, 'bristle', { rate: 220, popRate: 0, decayMs: [0.3, 1.2], bright: 0.9, seconds: 2, seed: 3 });
  tex.loop = true;
  const bp = filterNode(ctx, 'bandpass', 3200, 1);
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, sx.t, 0.1 * sx.vol, 0.08, 0.1, 0.2);
  tex.connect(bp).connect(g).connect(sx.out);
  startStop(tex, sx.t, end);
  ends.push(end);
  return done(sx, ...ends);
};

export const gymClank: OneShot = (sx) =>
  done(sx,
    metal(sx, { f: 340, ratios: [1, 2.32, 4.25, 6.63, 9.38], d: 0.6, peak: 0.26 }),
    noiseHit(sx, { filter: 'bandpass', f: 2500, q: 0.8, d: 0.03, peak: 0.26 }),
    tone(sx, { f: 120, f2: 70, glide: 0.06, d: 0.1, peak: 0.26 }),
    metal(sx, { at: 0.085, f: 410, ratios: [1, 2.4, 3.9, 6.1], d: 0.35, peak: 0.12 }));

export const embalmPump: OneShot = (sx) =>
  done(sx,
    tone(sx, { f: 95, f2: 60, glide: 0.08, d: 0.1, peak: 0.32 }),
    noiseHit(sx, { at: 0.05, filter: 'bandpass', f: 2500, f2: 3500, sweep: 0.2, q: 2, a: 0.12, d: 0.1, peak: 0.13 }),
    squelch(sx, { at: 0.28, f: 1200, f2: 300, d: 0.22, peak: 0.15, q: 8 }),
    tone(sx, { at: 0.3, f: 300, f2: 180, glide: 0.08, d: 0.1, peak: 0.06 }));

export const stitch: OneShot = (sx) => {
  const ctx = sx.ctx;
  const t = sx.t + 0.03;
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, 0.16 * sx.vol, 0.03, 0.08, 0.06);
  const src = noiseSrc(sx, 'white', t, end);
  const bp = filterNode(ctx, 'bandpass', 1500, 3);
  bp.frequency.setValueAtTime(1500, t);
  bp.frequency.exponentialRampToValueAtTime(4000, t + 0.15);
  const am = gainNode(ctx, 0.5);
  src.connect(bp).connect(g).connect(am).connect(sx.out);
  lfo(sx, 'square', 55, 0.45, am.gain, t, end);
  return done(sx, end, tick(sx, { f: 3500, peak: 0.15 }));
};

export const mirrorShimmer: OneShot = (sx) => {
  const notes = [88, 91, 93, 96, 98, 100];
  const ends: number[] = [];
  const up = sx.rng.chance(0.5);
  for (let i = 0; i < notes.length; i++) {
    const m = notes[up ? i : notes.length - 1 - i];
    ends.push(fmBell(sx, { at: i * 0.085, f: N(m), ratio: 3.5, index: 0.4, d: 0.5, peak: 0.08 }));
  }
  const ctx = sx.ctx;
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, sx.t, 0.05 * sx.vol, 0.2, 0.3, 0.35);
  const src = noiseSrc(sx, 'white', sx.t, end);
  const hp = filterNode(ctx, 'highpass', 7000, 0.7);
  src.connect(hp).connect(g).connect(sx.out);
  randomLfo(sx, 20, 0.04, g.gain, sx.t, end);
  ends.push(end,
    tone(sx, { f: N(76), a: 0.3, hold: 0.2, d: 0.4, peak: 0.05 }),
    tone(sx, { f: N(83), a: 0.3, hold: 0.2, d: 0.4, peak: 0.04 }));
  return done(sx, ...ends);
};
