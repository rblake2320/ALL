/**
 * Groanish renderer: glottal source (saw/pulse) + vibrato + jitter + roughness AM (+ waveshaper drive)
 * -> parallel 3-formant bank following per-syllable vowel targets, aspiration noise shaped by the same
 * formants (own envelope so 'h' can precede the vowel), consonant noise bursts, nasal colouring.
 * Bounded node count (~32) regardless of utterance length.
 */
import { pulseWave } from '../synth/buffers';
import { EPS, fin, filterNode, gainNode, lfo, noiseSrc, oscNode, randomLfo, rampExp, rampLin, setAt, shaper, startStop, targetAt } from '../synth/core';
import type { Sx } from '../synth/types';
import { VOWELS, type OnsetId, type VoicePlan } from './groanish';

/** Overall Groanish output level (peaks of the loudest emotions stay below ~0.65). */
export const VOICE_LEVEL = 0.62;

export interface VoiceHandle {
  end: number;
  stop(when: number): void;
}

const PLOSIVE: Partial<Record<OnsetId, [number, number, number]>> = {
  // [filter Hz, burst sec, level]
  b: [900, 0.014, 0.25],
  bl: [900, 0.014, 0.22],
  d: [3000, 0.012, 0.25],
  g: [1700, 0.018, 0.3],
  gr: [1600, 0.02, 0.3],
  k: [2900, 0.022, 0.4],
};

/**
 * Writes automation to one AudioParam in non-decreasing time order: a write earlier than the previous one is
 * moved forward to it. Very short syllables (tight durations, adversarial plans) therefore keep their envelope
 * order instead of interleaving with their neighbours'.
 */
class Lane {
  private last: number;
  constructor(private readonly p: AudioParam, t0: number) {
    this.last = t0;
  }
  private at(t: number): number {
    const v = t > this.last ? t : this.last;
    this.last = v;
    return v;
  }
  set(v: number, t: number): void {
    setAt(this.p, v, this.at(t));
  }
  lin(v: number, t: number): void {
    rampLin(this.p, v, this.at(t));
  }
  exp(v: number, t: number): void {
    rampExp(this.p, v, this.at(t));
  }
  target(v: number, t: number, tc: number): void {
    targetAt(this.p, v, this.at(t), tc);
  }
}

export function renderVoice(sx: Sx, plan: VoicePlan, level = 1): VoiceHandle {
  const ctx = sx.ctx;
  const t0 = sx.t;
  const tb = plan.timbre;
  const end = t0 + plan.duration + 0.08;
  const sources: AudioScheduledSourceNode[] = [];
  const fs = tb.formantScale * Math.pow(sx.pitch, 0.3);
  const syl = plan.syllables;

  // ── source + prosody ──
  const src = oscNode(ctx, 'sawtooth', (syl[0]?.f0Start ?? tb.f0) * sx.pitch, tb.buzz > 0.3 ? pulseWave(ctx, 0.5 - 0.3 * tb.buzz) : null);
  sources.push(src);
  const fr = new Lane(src.frequency, t0);
  for (let i = 0; i < syl.length; i++) {
    const s = syl[i];
    const ts = t0 + s.start;
    const te = ts + s.dur;
    const p = sx.pitch;
    if (i === 0) fr.set(s.f0Start * p, t0);
    else fr.lin(s.f0Start * p, ts);
    if (s.f0Mid !== undefined) fr.lin(s.f0Mid * p, ts + s.dur * 0.35);
    fr.exp(s.f0End * p, te);
  }
  sources.push(lfo(sx, 'sine', plan.vibRate, plan.vibDepth, src.detune, t0, end));
  sources.push(randomLfo(sx, 14, tb.jitter, src.detune, t0, end));

  // ── roughness / drive / tilt ──
  const rough = gainNode(ctx, 1 - plan.roughness * 0.5);
  sources.push(lfo(sx, 'triangle', tb.roughRate, plan.roughness * 0.5, rough.gain, t0, end));
  let head: AudioNode = src;
  if (plan.drive > 0.05) {
    const pre = gainNode(ctx, 1 + 5 * plan.drive);
    const ws = shaper(ctx, 2 + 5 * plan.drive);
    const post = gainNode(ctx, 1 / (1 + 0.8 * plan.drive));
    src.connect(pre).connect(ws).connect(post);
    head = post;
  }
  head.connect(rough);
  const tilt = filterNode(ctx, 'lowpass', tb.bright, 0.5);
  rough.connect(tilt);
  const voiced = gainNode(ctx, 0);
  tilt.connect(voiced);

  // ── formant bank (fed by voiced source + aspiration) ──
  const bankIn = gainNode(ctx, 1);
  voiced.connect(bankIn);
  // loudness compensation: formant bank output grows with f0 (denser harmonics near formants)
  let f0eff = 0;
  for (const s of syl) f0eff += (s.f0Start + s.f0End) / 2;
  f0eff = Math.max(60, syl.length ? f0eff / syl.length : tb.f0);
  const makeup = 2.6 * Math.pow(f0eff / 150, -0.45) * (f0eff > 300 ? Math.pow(300 / f0eff, 0.8) : 1);
  const fmix = gainNode(ctx, makeup);
  const Q = [6, 9, 12];
  const G = [1, 0.55, 0.22];
  const F: Lane[] = [];
  const v0 = VOWELS[syl[0]?.vowel ?? 'uh'];
  for (let k = 0; k < 3; k++) {
    const f = filterNode(ctx, 'bandpass', v0[k] * fs, Q[k]);
    const g = gainNode(ctx, G[k]);
    bankIn.connect(f).connect(g).connect(fmix);
    F.push(new Lane(f.frequency, t0));
  }
  for (const s of syl) {
    const ts = t0 + s.start;
    const v1 = VOWELS[s.vowel];
    const v2 = VOWELS[s.vowelEnd];
    const nasalOnset = s.onset === 'm' || s.onset === 'n';
    const nasalCoda = s.coda === 'm' || s.coda === 'n';
    for (let k = 0; k < 3; k++) {
      const target = v1[k] * fs;
      if (nasalOnset && k === 0) {
        F[k].set(260 * fs, ts);
        F[k].target(target, ts + 0.04, 0.02);
      } else if (s.onset === 'bl' && k === 1) {
        F[k].set(1000 * fs, ts);
        F[k].target(target, ts + 0.03, 0.02);
      } else {
        F[k].target(target, Math.max(t0, ts - 0.01), 0.02);
      }
      if (s.vowelEnd !== s.vowel) F[k].target(v2[k] * fs, ts + s.dur * 0.45, 0.04);
      if (nasalCoda && k < 2) F[k].target((k === 0 ? 280 : 1000) * fs, ts + s.dur - 0.06, 0.02);
    }
  }

  const out = gainNode(ctx, fin(level, 1) * sx.vol * VOICE_LEVEL * fin(plan.level, 1));
  const nasal = filterNode(ctx, 'peaking', 1150 * fs, 3, plan.nasal * 9);
  fmix.connect(nasal).connect(out);
  const bodyLp = filterNode(ctx, 'lowpass', 520, 0.7);
  const body = gainNode(ctx, 0.14);
  voiced.connect(bodyLp).connect(body).connect(out);

  // ── aspiration ──
  const breathSrc = noiseSrc(sx, 'white', t0, end);
  sources.push(breathSrc);
  const breathHp = filterNode(ctx, 'highpass', 500, 0.7);
  const breath = gainNode(ctx, 0);
  breathSrc.connect(breathHp).connect(breath).connect(bankIn);
  const bb = plan.breath * 0.9;

  // ── consonant bursts (outside the vowel envelope) ──
  const consSrc = noiseSrc(sx, 'white', t0, end);
  sources.push(consSrc);
  const consBp = filterNode(ctx, 'bandpass', 2000, 1.2);
  const cons = gainNode(ctx, 0);
  consSrc.connect(consBp).connect(cons).connect(out);

  // ── per-syllable envelopes ──
  const vg = new Lane(voiced.gain, t0);
  const bg = new Lane(breath.gain, t0);
  const cg = new Lane(cons.gain, t0);
  const cf = new Lane(consBp.frequency, t0);
  vg.set(0, t0);
  bg.set(0, t0);
  cg.set(0, t0);
  let prevEnd = t0;
  for (let i = 0; i < syl.length; i++) {
    const s = syl[i];
    const ts = t0 + s.start;
    const te = ts + s.dur;
    const nextStart = i + 1 < syl.length ? t0 + syl[i + 1].start : end;
    const A = s.amp;
    const att = Math.min(0.035, s.dur * 0.3);
    const rel = Math.min(0.045, s.dur * 0.3);

    // voiced
    vg.lin(0, ts);
    if (s.onset === 'm' || s.onset === 'n') {
      vg.lin(A * 0.4, ts + 0.02);
      vg.lin(A, ts + Math.max(att, 0.06));
    } else if (s.onset === 'r' || s.onset === 'gr') {
      vg.lin(A * 0.8, ts + 0.012);
      vg.lin(A * 0.35, ts + 0.024);
      vg.lin(A * 0.85, ts + 0.036);
      vg.lin(A * 0.4, ts + 0.048);
      vg.lin(A, ts + 0.06);
    } else if (s.onset === 'h') {
      vg.lin(A, ts + att + 0.015);
    } else {
      vg.lin(A, ts + att);
    }
    const onsetEnd = ts + (s.onset === 'm' || s.onset === 'n' || s.onset === 'r' || s.onset === 'gr' ? 0.06 : att + 0.015);
    const tc = Math.max(onsetEnd + 0.003, te - 0.07);
    if (s.coda === 'r' && te - tc >= 0.066) {
      vg.lin(A * 0.85, tc);
      for (let k = 0; k < 3; k++) {
        vg.lin(A * 0.35, tc + 0.012 + k * 0.022);
        vg.lin(A * 0.75, tc + 0.023 + k * 0.022);
      }
    } else if ((s.coda === 'm' || s.coda === 'n') && te - tc >= 0.04) {
      vg.lin(A * 0.8, tc);
      vg.lin(A * 0.38, te - 0.03);
    } else {
      vg.lin(A * 0.82, Math.max(onsetEnd + 0.001, te - rel));
    }
    vg.lin(0, te);

    // breath: follows the syllable; 'h' onsets lead the vowel, 'h' codas trail it
    const pre = s.onset === 'h' ? Math.max(prevEnd, ts - 0.045) : ts;
    bg.lin(0, pre);
    if (s.onset === 'h') {
      bg.lin(0.85 * A, ts);
      bg.lin(Math.max(bb * A, 0.2 * A), ts + 0.045);
    } else {
      bg.lin(bb * A, ts + att);
    }
    bg.lin(bb * A * 0.8, Math.max(ts + 0.05, te - rel));
    if (s.coda === 'h') {
      const tail = Math.min(te + 0.09, nextStart - 0.05);
      bg.lin(0.55 * A, te);
      bg.lin(0, Math.max(te + 0.01, tail));
      prevEnd = Math.max(te + 0.01, tail);
    } else {
      bg.lin(0, te);
      prevEnd = te;
    }

    // plosive / fricative onset noise
    const pl = PLOSIVE[s.onset];
    if (pl) {
      cf.set(pl[0] * fs, Math.max(t0, ts - 0.004));
      cg.lin(0, Math.max(t0, ts - 0.003));
      cg.lin(pl[2] * A, ts);
      cg.lin(0, ts + pl[1]);
    } else if (s.onset === 'sh') {
      cf.set(3400, Math.max(t0, ts - 0.05));
      cg.lin(0, Math.max(t0, ts - 0.05));
      cg.lin(0.22 * A, ts - 0.015);
      cg.lin(0, ts + 0.03);
    }
  }
  out.connect(sx.out);
  startStop(src, t0, end);

  return {
    end,
    stop(when: number): void {
      const w = Math.max(fin(when, ctx.currentTime), ctx.currentTime);
      try {
        out.gain.cancelScheduledValues(w);
        out.gain.setValueAtTime(Math.max(EPS, fin(out.gain.value, 0)), w);
        out.gain.linearRampToValueAtTime(0, w + 0.03);
      } catch {
        /* ignore */
      }
      for (const s of sources) {
        try {
          s.stop(w + 0.05);
        } catch {
          /* ignore */
        }
      }
    },
  };
}
