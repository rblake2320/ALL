/**
 * The orchestra: every InstrumentId rendered from toolkit voices. Used by the music sequencer and by the
 * musical SFX stingers, so the whole game shares one "spooky-cute toy orchestra" palette.
 */
import { harmonicWave, pulseWave } from '../synth/buffers';
import {
  clap, envAHR, filterNode, fin, fmBell, gainNode, hat, kick, noiseHit, oscNode, pluck, rampLin, setAt, snare,
  startStop, targetAt, tick, tone,
} from '../synth/core';
import type { Sx } from '../synth/types';
import { mtof } from './theory';
import type { InstrumentId } from './types';

/** Shorter decays for higher notes (pitched percussion). */
function decayFor(midi: number, base: number): number {
  return base * Math.pow(2, -(midi - 72) / 24);
}

function pad(sx: Sx, f: number, dur: number, vel: number, cutoff: number | null): number {
  const ctx = sx.ctx;
  const t = sx.t;
  const g = gainNode(ctx, 0);
  const a = Math.min(0.45, dur * 0.4);
  const end = envAHR(g.gain, t, 0.09 * vel * sx.vol, a, Math.max(0, dur - a), 0.7);
  // `cutoff` null: the caller's channel already low-passes (music cues share one filter per pad channel)
  const head: AudioNode = cutoff === null ? g : filterNode(ctx, 'lowpass', cutoff, 0.6);
  for (const det of [-7, 6]) {
    const o = oscNode(ctx, 'sawtooth', f * sx.pitch);
    o.detune.value = det;
    o.connect(head);
    startStop(o, t, end);
  }
  if (head !== g) head.connect(g);
  g.connect(sx.out);
  return end;
}

function theremin(sx: Sx, f: number, dur: number, vel: number, from?: number): number {
  const ctx = sx.ctx;
  const t = sx.t;
  const wave = harmonicWave(ctx, 'theremin', [1, 0.16, 0.07, 0.03]);
  const o = oscNode(ctx, 'sine', (from ?? f) * sx.pitch, wave);
  setAt(o.frequency, (from ?? f) * sx.pitch, t);
  if (from !== undefined) targetAt(o.frequency, f * sx.pitch, t + 0.02, 0.06);
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, 0.3 * vel * sx.vol, 0.08, Math.max(0, dur - 0.05), 0.3);
  // vibrato that blooms over the note
  const lfoO = oscNode(ctx, 'sine', 5.8);
  const lfoG = gainNode(ctx, 0);
  setAt(lfoG.gain, 0, t);
  rampLin(lfoG.gain, 28, t + Math.min(0.6, dur * 0.8 + 0.1));
  lfoO.connect(lfoG).connect(o.detune);
  const lp = filterNode(ctx, 'lowpass', 2600, 0.7);
  o.connect(lp).connect(g).connect(sx.out);
  startStop(o, t, end);
  startStop(lfoO, t, end);
  return end;
}

function brass(sx: Sx, f: number, dur: number, vel: number): number {
  const ctx = sx.ctx;
  const t = sx.t;
  const g = gainNode(ctx, 0);
  const end = envAHR(g.gain, t, 0.12 * vel * sx.vol, 0.03, dur, 0.14);
  const lp = filterNode(ctx, 'lowpass', 500, 1.2);
  setAt(lp.frequency, 450, t);
  rampLin(lp.frequency, 900 + 2200 * vel, t + 0.05);
  targetAt(lp.frequency, 700 + 1100 * vel, t + 0.06, 0.15);
  for (const det of [-9, 8]) {
    const o = oscNode(ctx, 'sawtooth', f * sx.pitch);
    o.detune.value = det;
    o.connect(lp);
    startStop(o, t, end);
  }
  lp.connect(g).connect(sx.out);
  return end;
}

function choir(sx: Sx, f: number, dur: number, vel: number): number {
  const ctx = sx.ctx;
  const t = sx.t;
  const g = gainNode(ctx, 0);
  const a = Math.min(0.5, dur * 0.4);
  const end = envAHR(g.gain, t, 0.22 * vel * sx.vol, a, Math.max(0, dur - a), 0.8);
  const mix = gainNode(ctx, 1);
  const f1 = filterNode(ctx, 'bandpass', 420, 5);
  const f2 = filterNode(ctx, 'bandpass', 820, 7);
  const f2g = gainNode(ctx, 0.45);
  for (const det of [-10, 0, 11]) {
    const o = oscNode(ctx, 'sawtooth', f * sx.pitch);
    o.detune.value = det;
    o.connect(f1);
    o.connect(f2);
    startStop(o, t, end);
  }
  f1.connect(mix);
  f2.connect(f2g).connect(mix);
  mix.connect(g).connect(sx.out);
  return end;
}

/**
 * Play one note. `sx.t` is the onset, `sx.out` the instrument channel. Returns the end time.
 * `sharedFilter`: the destination channel already provides the instrument's tone filter (pads).
 */
export function playNote(sx: Sx, inst: InstrumentId, midi: number, dur: number, vel: number, glideFrom?: number, sharedFilter = false): number {
  const m = fin(midi, 60);
  const f = mtof(m);
  const d = Math.max(0.03, fin(dur, 0.5));
  const v = Math.min(1, Math.max(0, fin(vel, 0.7)));
  switch (inst) {
    case 'celesta':
      return fmBell(sx, { f, ratio: 4, index: 1.1 * v, d: decayFor(m, 1.5), peak: 0.32 * v, bright: 0.07 });
    case 'musicBox':
      return Math.max(
        fmBell(sx, { f, ratio: 7, index: 0.7 * v, d: decayFor(m, 1.6), peak: 0.28 * v, bright: 0.035 }),
        tone(sx, { f: f * 2, d: decayFor(m, 0.5), peak: 0.04 * v }),
      );
    case 'vibes':
      return Math.max(tone(sx, { f, a: 0.002, d: Math.max(d + 0.6, 2.0), peak: 0.22 * v }), tone(sx, { f: f * 4, d: 0.3, peak: 0.05 * v }));
    case 'marimba':
      return Math.max(tone(sx, { f, a: 0.003, d: decayFor(m, 0.6), peak: 0.38 * v }), tone(sx, { f: f * 4, d: 0.07, peak: 0.1 * v }));
    case 'xylo':
      // FM ratio 3 gives the bright odd partial + mallet click in 2 oscillators
      return fmBell(sx, { f, ratio: 3, index: 1.3 * v, d: decayFor(m, 0.34), peak: 0.32 * v, bright: 0.08, a: 0.001 });
    case 'glock':
      return fmBell(sx, { f, ratio: 2.76, index: 0.45 * v, d: decayFor(m, 2.2), peak: 0.22 * v, bright: 0.12 });
    case 'pizz':
      return pluck(sx, { f, d: 0.45, bright: 0.55, peak: 0.42 * v, lp: 3600 });
    case 'harp':
      return pluck(sx, { f, d: Math.min(1.4, d + 0.6), bright: 0.42, peak: 0.4 * v, lp: 5200 });
    case 'bass':
      return Math.max(
        pluck(sx, { f, d: Math.min(1.2, d + 0.4), bright: 0.3, peak: 0.5 * v, lp: 1500 }),
        tone(sx, { f, a: 0.01, hold: Math.max(0, d * 0.5), d: 0.2, peak: 0.09 * v }),
      );
    case 'pad':
      return pad(sx, f, d, v, sharedFilter ? null : 900 + 500 * v);
    case 'organ':
      return tone(sx, { f, wave: harmonicWave(sx.ctx, 'organ', [1, 0.55, 0.32, 0.22, 0.1, 0.07, 0.04, 0.03]), a: 0.006, hold: Math.max(0, d - 0.02), d: 0.08, peak: 0.16 * v, lp: 3400 });
    case 'theremin':
      return theremin(sx, f, d, v, glideFrom !== undefined ? mtof(glideFrom) : undefined);
    case 'brass':
      return brass(sx, f, d, v);
    case 'bassoon':
      return tone(sx, { f, wave: pulseWave(sx.ctx, 0.3), a: 0.014, hold: Math.max(0, d * 0.6), d: 0.08, peak: 0.24 * v, lp: 900, lpQ: 2.5 });
    case 'epiano':
      return fmBell(sx, { f, ratio: 1, index: 1.5 * v, d: decayFor(m, 1.8), peak: 0.26 * v, bright: 0.3 });
    case 'pulse':
      return tone(sx, { f, type: 'square', a: 0.004, hold: Math.max(0, d * 0.5), d: 0.12, peak: 0.2 * v, lp: 420, lpQ: 5 });
    case 'choir':
      return choir(sx, f, d, v);
    case 'bell':
      return fmBell(sx, { f, ratio: 1.41, index: 1.8 * v, d: 3.5, peak: 0.26 * v, bright: 0.15 });
    case 'timpani':
      return Math.max(
        tone(sx, { f: f * 1.05, f2: f, glide: 0.06, a: 0.003, d: 1.3, peak: 0.55 * v }),
        noiseHit(sx, { filter: 'lowpass', f: 320, d: 0.14, peak: 0.35 * v, color: 'brown' }),
      );
    case 'kick':
      return kick(sx, { peak: 0.85 * v, click: 0 });
    case 'snare':
      return snare(sx, { peak: 0.6 * v });
    case 'brush':
      return noiseHit(sx, { filter: 'bandpass', f: 4200, q: 0.6, a: 0.004, d: 0.16, peak: 0.34 * v });
    case 'swish':
      return noiseHit(sx, { filter: 'bandpass', f: 2800, f2: 5200, q: 0.5, a: Math.min(0.5, d * 0.45), d: Math.max(0.1, d * 0.5), peak: 0.16 * v });
    case 'hat':
      return hat(sx, { peak: 0.28 * v, d: 0.04 });
    case 'ohat':
      return hat(sx, { peak: 0.22 * v, d: 0.22, f: 6500 });
    case 'ride':
      return Math.max(noiseHit(sx, { filter: 'bandpass', f: 6800, q: 1.6, d: 0.32, peak: 0.2 * v }), tone(sx, { f: 3150, d: 0.5, peak: 0.035 * v }));
    case 'clap':
      return clap(sx, { peak: 0.55 * v });
    case 'snap':
      return Math.max(noiseHit(sx, { filter: 'bandpass', f: 2300, q: 2.4, d: 0.035, peak: 0.6 * v }), tick(sx, { f: 1800, peak: 0.12 * v, noise: 0 }));
    case 'shaker':
      return noiseHit(sx, { filter: 'highpass', f: 5600, a: 0.012, d: 0.05, peak: 0.2 * v });
    case 'woodblock':
      return Math.max(tone(sx, { f: 1180, f2: 1060, glide: 0.05, d: 0.07, peak: 0.42 * v }), noiseHit(sx, { filter: 'bandpass', f: 2600, q: 2, d: 0.008, peak: 0.12 * v }));
    case 'tick':
      return tick(sx, { f: 3300, peak: 0.22 * v, d: 0.012 });
    default:
      return sx.t;
  }
}
