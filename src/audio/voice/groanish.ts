/**
 * "Groanish" — the zombies' original gibberish language. This file is the pure planner: it turns
 * (seed, voicePitch, emotion, duration, variant) into a syllable/prosody plan. Timbre depends only on the
 * seed + pitch (a zombie always sounds like itself); the words change per utterance via `variant`.
 */
import type { VoiceEmotion } from '../../shared/audioIds';
import { VOICE_EMOTIONS } from '../../shared/audioIds';
import { createRng, hashSeed, type Rng } from '../prng';

export type VowelId = 'a' | 'e' | 'i' | 'o' | 'u' | 'ae' | 'uh' | 'schwa';
/** Formant centre frequencies F1..F3 (Hz) for an average adult voice; scaled per zombie. */
export const VOWELS: Readonly<Record<VowelId, readonly [number, number, number]>> = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [310, 2200, 2950],
  o: [570, 840, 2410],
  u: [330, 820, 2240],
  ae: [660, 1720, 2410],
  uh: [640, 1190, 2390],
  schwa: [500, 1450, 2450],
};

export type OnsetId = 'none' | 'g' | 'gr' | 'b' | 'bl' | 'd' | 'm' | 'n' | 'h' | 'r' | 'sh' | 'k';
export type CodaId = 'none' | 'm' | 'n' | 'r' | 'h';

export interface VoiceTimbre {
  /** Base fundamental (Hz) from voicePitch 0..1. */
  f0: number;
  formantScale: number;
  roughness: number;
  roughRate: number;
  breath: number;
  vibRate: number;
  /** cents */
  vibDepth: number;
  /** cents */
  jitter: number;
  /** 0 = sawtooth, 1 = narrow buzzy pulse */
  buzz: number;
  /** Tilt lowpass cutoff (Hz). */
  bright: number;
}

export interface VoiceSyllable {
  start: number;
  dur: number;
  f0Start: number;
  f0End: number;
  /** Optional mid-syllable pitch target (yawn arcs, scream wobble). */
  f0Mid?: number;
  vowel: VowelId;
  vowelEnd: VowelId;
  onset: OnsetId;
  coda: CodaId;
  amp: number;
}

export interface VoicePlan {
  emotion: VoiceEmotion;
  /** Seconds; the last syllable (plus release) ends here. */
  duration: number;
  timbre: VoiceTimbre;
  drive: number;
  breath: number;
  roughness: number;
  vibRate: number;
  vibDepth: number;
  nasal: number;
  /** Emotion loudness multiplier. */
  level: number;
  syllables: VoiceSyllable[];
}

export const MIN_VOICE_MS = 150;
export const MAX_VOICE_MS = 6000;
export const RELEASE_SEC = 0.05;
const MAX_SYLLABLES = 48;

export function sanitizePitch01(p: unknown): number {
  if (typeof p !== 'number' || Number.isNaN(p)) return 0.5;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export function sanitizeEmotion(e: unknown): VoiceEmotion {
  return (VOICE_EMOTIONS as readonly unknown[]).includes(e) ? (e as VoiceEmotion) : 'neutral';
}

export function sanitizeDurationMs(ms: unknown, emotion: VoiceEmotion): number {
  const def = emotion === 'groan' || emotion === 'yawn' ? 1400 : emotion === 'laugh' ? 1100 : 900;
  if (typeof ms !== 'number' || Number.isNaN(ms)) return def;
  return Math.min(MAX_VOICE_MS, Math.max(MIN_VOICE_MS, ms));
}

/** Stable per-zombie timbre. */
export function timbreFromSeed(seed: unknown, pitch01: unknown): VoiceTimbre {
  const p = sanitizePitch01(pitch01);
  const r = createRng(hashSeed('groanish-timbre', seed));
  return {
    f0: 72 * Math.pow(310 / 72, p) * r.range(0.96, 1.04),
    formantScale: (0.9 + 0.24 * p) * r.range(0.94, 1.06),
    roughness: r.range(0.12, 0.42),
    roughRate: r.range(26, 48),
    breath: r.range(0.04, 0.14),
    vibRate: r.range(4.6, 6.4),
    vibDepth: r.range(8, 22),
    jitter: r.range(10, 30),
    buzz: r.range(0, 0.6),
    bright: r.range(2800, 4600) * (0.9 + 0.2 * p),
  };
}

interface Prosody {
  /** Output level for this emotion (loudness-matched by offline measurement). */
  level: number;
  pitchMul: number;
  syl: [number, number];
  gap: [number, number];
  amp: number;
  drive: number;
  breath: number;
  vib: number;
  rough: number;
  nasal: number;
  vowels: readonly VowelId[];
  onsets: readonly OnsetId[];
  codaChance: number;
  /** false: every gap is a between-word gap (laughs pulse evenly instead of running syllables together). */
  words?: boolean;
  /** Amplitude lost by the last syllable relative to the first (0 = flat). */
  fade?: number;
  /** Semitone offsets for syllable i of n: [start, end]. */
  contour(i: number, n: number, r: Rng): [number, number];
}

const BACK: readonly VowelId[] = ['uh', 'o', 'u', 'a', 'schwa', 'uh', 'o'];
const GRUFF: readonly OnsetId[] = ['g', 'gr', 'b', 'm', 'n', 'h', 'r', 'none', 'bl', 'd'];

export const PROSODY: Readonly<Record<VoiceEmotion, Prosody>> = {
  neutral: {
    level: 1, pitchMul: 1, syl: [110, 160], gap: [18, 45], amp: 0.8, drive: 0.05, breath: 0, vib: 1, rough: 1, nasal: 0,
    vowels: BACK, onsets: GRUFF, codaChance: 0.25,
    contour: (i, n, r) => { const s = -2.5 * (i / Math.max(1, n - 1)) + r.jitter(1.5); return [s, s - r.range(0.3, 1.2)]; },
  },
  question: {
    level: 1.19, pitchMul: 1, syl: [110, 160], gap: [18, 40], amp: 0.8, drive: 0.05, breath: 0, vib: 1, rough: 1, nasal: 0,
    vowels: BACK, onsets: GRUFF, codaChance: 0.2,
    contour: (i, n, r) => (i === n - 1 ? [0.5, 7] : (() => { const s = -1.5 * (i / Math.max(1, n - 1)) + r.jitter(1.2); return [s, s - 0.4] as [number, number]; })()),
  },
  happy: {
    level: 1, pitchMul: 1.15, syl: [90, 130], gap: [12, 32], amp: 0.9, drive: 0.05, breath: 0, vib: 1.2, rough: 0.7, nasal: 0,
    vowels: ['a', 'e', 'ae', 'a', 'uh', 'i'], onsets: ['b', 'bl', 'm', 'n', 'g', 'none', 'd'], codaChance: 0.15,
    contour: (i, n, r) => { const rise = 3 * (i / Math.max(1, n - 1)); const b = i % 2 === 0 ? 2.2 : -1.2; const s = rise + b + r.jitter(0.6); return [s, s + (i % 2 === 0 ? -0.6 : 1.6)]; },
  },
  sad: {
    level: 1.26, pitchMul: 0.88, syl: [150, 180], gap: [45, 85], amp: 0.6, drive: 0, breath: 0.12, vib: 0.8, rough: 0.9, nasal: 0.1,
    vowels: ['o', 'u', 'uh', 'o', 'schwa'], onsets: ['m', 'n', 'h', 'none', 'b', 'g'], codaChance: 0.35,
    contour: (i, n, r) => { const s = -5 * (i / Math.max(1, n - 1)) + r.jitter(0.7); return [s, s - 1.8]; },
  },
  angry: {
    level: 1.7, pitchMul: 1.06, syl: [90, 130], gap: [10, 26], amp: 1, drive: 0.75, breath: 0, vib: 0.3, rough: 1.5, nasal: 0,
    vowels: ['a', 'ae', 'uh', 'a', 'o'], onsets: ['gr', 'k', 'g', 'b', 'd', 'r', 'sh'], codaChance: 0.4,
    contour: (i, n, r) => { const s = 1.5 + r.jitter(1.4) + (i % 3 === 0 ? 1.5 : 0); return [s, s - r.range(2, 4)]; },
  },
  flirty: {
    level: 1.26, pitchMul: 0.97, syl: [140, 180], gap: [30, 60], amp: 0.65, drive: 0, breath: 0.32, vib: 1.1, rough: 0.6, nasal: 0.15,
    vowels: ['o', 'a', 'uh', 'e', 'u'], onsets: ['m', 'n', 'h', 'm', 'none', 'b'], codaChance: 0.4,
    contour: (i, n, r) => (i === n - 1 ? [-1, 5] : i % 2 === 0 ? [-1 + r.jitter(0.8), 3.5] : [3 + r.jitter(0.8), -1.5]),
  },
  disgusted: {
    level: 1.19, pitchMul: 0.95, syl: [120, 170], gap: [30, 50], amp: 0.8, drive: 0.2, breath: 0.05, vib: 0.4, rough: 1.2, nasal: 0.85,
    vowels: ['e', 'ae', 'e', 'uh', 'i'], onsets: ['bl', 'b', 'g', 'n', 'none'], codaChance: 0.3,
    contour: (i, n, r) => (i === n - 1 ? [-3.5, 0.8] : [r.jitter(1), -3]),
  },
  surprised: {
    level: 2.7, pitchMul: 1.25, syl: [100, 150], gap: [20, 40], amp: 0.95, drive: 0.1, breath: 0.15, vib: 0.6, rough: 0.6, nasal: 0,
    vowels: ['o', 'a', 'o', 'ae', 'uh'], onsets: ['none', 'h', 'b', 'm', 'none'], codaChance: 0.15,
    contour: (i, _n, r) => (i === 0 ? [4, 9] : (() => { const s = 3 - 2 * i + r.jitter(0.8); return [s, s - 2] as [number, number]; })()),
  },
  laugh: {
    // ~5 "hah"s per second (human laughter pulses at 4-6 Hz), each breathy gap a real gap, tailing off
    level: 1.26, pitchMul: 1.2, syl: [90, 115], gap: [60, 100], amp: 0.9, drive: 0.1, breath: 0.4, vib: 0.2, rough: 0.8, nasal: 0,
    vowels: ['a', 'a', 'uh', 'ae'], onsets: ['h'], codaChance: 0, words: false, fade: 0.35,
    contour: (i, _n, r) => { const s = 3 - (i % 6) * 0.8 + r.jitter(0.4); return [s, s - 0.6]; },
  },
  groan: {
    level: 1.19, pitchMul: 0.72, syl: [420, 900], gap: [50, 90], amp: 0.8, drive: 0.3, breath: 0.08, vib: 1.6, rough: 1.7, nasal: 0.1,
    vowels: ['o', 'u', 'uh', 'o'], onsets: ['none', 'g', 'm', 'b', 'r'], codaChance: 0.5,
    contour: (_i, _n, r) => { const s = r.jitter(1); return [s, s - 2.5]; },
  },
  yawn: {
    level: 1.17, pitchMul: 0.95, syl: [600, 6000], gap: [0, 0], amp: 0.55, drive: 0, breath: 0.45, vib: 0.5, rough: 0.8, nasal: 0,
    vowels: ['a'], onsets: ['h'], codaChance: 0,
    contour: () => [2, -6],
  },
  scream: {
    level: 2.5, pitchMul: 2.2, syl: [260, 620], gap: [20, 50], amp: 0.85, drive: 0.45, breath: 0.1, vib: 2.4, rough: 0.6, nasal: 0,
    vowels: ['a', 'ae', 'a'], onsets: ['none', 'h'], codaChance: 0,
    contour: (i, _n, r) => (i === 0 ? [1 + r.jitter(0.5), 4] : [3, -3]),
  },
};

function semis(f: number, st: number): number {
  return Math.min(1000, Math.max(45, f * Math.pow(2, st / 12)));
}

/**
 * Plan an utterance. Deterministic for identical inputs. `variant` picks different "words" for the same
 * zombie/emotion (the engine passes an utterance counter).
 */
export function planVoice(seed: unknown, pitch01: unknown, emotionIn: unknown, durationMs: unknown, variant: number = 0): VoicePlan {
  const emotion = sanitizeEmotion(emotionIn);
  const pros = PROSODY[emotion];
  const timbre = timbreFromSeed(seed, pitch01);
  const dur = sanitizeDurationMs(durationMs, emotion) / 1000;
  const r = createRng(hashSeed('groanish-words', seed, emotion, Number.isFinite(variant) ? variant : 0));
  const f0 = timbre.f0 * pros.pitchMul;
  const end = Math.max(0.08, dur - RELEASE_SEC);
  const syllables: VoiceSyllable[] = [];

  if (emotion === 'yawn') {
    syllables.push({ start: 0, dur: end, f0Start: semis(f0, 2), f0Mid: semis(f0, 5), f0End: semis(f0, -6), vowel: 'a', vowelEnd: 'u', onset: 'h', coda: 'h', amp: pros.amp });
  } else {
    // Choose a syllable count that fits, then fit gaps (and only if needed, syllables) to the duration.
    const words = pros.words !== false;
    const avgSyl = (pros.syl[0] + pros.syl[1]) / 2000;
    const wordGap = (pros.gap[0] + pros.gap[1]) / 2000;
    const avgGap = words ? (wordGap + 0.015 * 2) / 3 : wordGap;
    const count = Math.max(1, Math.min(MAX_SYLLABLES, Math.round((end + avgGap) / (avgSyl + avgGap))));
    const lens: number[] = [];
    const gaps: number[] = [];
    let wordLeft = 0;
    for (let i = 0; i < count; i++) {
      lens.push(r.range(pros.syl[0], pros.syl[1]) / 1000);
      if (wordLeft <= 0) wordLeft = words ? r.int(1, 3) : 1;
      wordLeft--;
      if (i < count - 1) gaps.push(wordLeft === 0 ? r.range(pros.gap[0], pros.gap[1]) / 1000 : r.range(8, 22) / 1000);
    }
    let sumL = 0;
    let sumG = 0;
    for (const l of lens) sumL += l;
    for (const g of gaps) sumG += g;
    if (count === 1) {
      lens[0] = end;
    } else {
      let kg = sumG > 0 ? (end - sumL) / sumG : 1;
      kg = Math.min(3, Math.max(0.25, kg));
      for (let i = 0; i < gaps.length; i++) gaps[i] *= kg;
      const kl = (end - sumG * kg) / sumL;
      for (let i = 0; i < lens.length; i++) lens[i] *= kl;
    }
    const starts: number[] = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
      starts.push(t);
      t += lens[i] + (gaps[i] ?? 0);
    }
    const n = starts.length;
    for (let i = 0; i < n; i++) {
      const [s0, s1] = pros.contour(i, n, r);
      const v = r.pick(pros.vowels);
      const v2 = r.chance(0.3) ? r.pick(pros.vowels) : v;
      const stress = (i === 0 || r.chance(0.3) ? 1 : 0.82) * (1 - (pros.fade ?? 0) * (n > 1 ? i / (n - 1) : 0));
      const syl: VoiceSyllable = {
        start: starts[i],
        dur: lens[i],
        f0Start: semis(f0, s0),
        f0End: semis(f0, s1),
        vowel: v,
        vowelEnd: v2,
        onset: r.pick(pros.onsets),
        coda: r.chance(pros.codaChance) ? r.pick(['m', 'n', 'r', 'h'] as const) : 'none',
        amp: pros.amp * stress * r.range(0.9, 1.05),
      };
      if (emotion === 'scream' && i === 0) syl.f0Mid = semis(f0, 5);
      if (emotion === 'groan') syl.f0Mid = semis(f0, (s0 + s1) / 2 + 1.2);
      syllables.push(syl);
    }
  }

  return {
    emotion,
    duration: dur,
    timbre,
    drive: Math.min(1, pros.drive),
    breath: Math.min(0.8, timbre.breath + pros.breath),
    roughness: Math.min(0.9, timbre.roughness * pros.rough),
    vibRate: timbre.vibRate * (emotion === 'scream' ? 1.3 : 1),
    vibDepth: timbre.vibDepth * pros.vib,
    nasal: pros.nasal,
    level: pros.level,
    syllables,
  };
}
