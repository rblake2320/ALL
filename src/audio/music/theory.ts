/** Pure music theory helpers: pitch classes, scales, roman-numeral chords, voice leading. */

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
} as const;
export type ScaleName = keyof typeof SCALES;

export type ChordQuality =
  | 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4'
  | 'maj7' | 'min7' | 'dom7' | 'hdim7' | 'dim7' | 'min6' | 'maj6' | 'add9' | 'minAdd9' | 'dom7b9' | 'dom7sus4' | 'minMaj7';

export const CHORD_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  hdim7: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  min6: [0, 3, 7, 9],
  maj6: [0, 4, 7, 9],
  add9: [0, 4, 7, 14],
  minAdd9: [0, 3, 7, 14],
  dom7b9: [0, 4, 7, 10, 13],
  dom7sus4: [0, 5, 7, 10],
  minMaj7: [0, 3, 7, 11],
};

export interface Chord {
  /** Absolute pitch class 0..11 of the root. */
  root: number;
  quality: ChordQuality;
  symbol: string;
}

export function pc(m: number): number {
  return ((Math.round(m) % 12) + 12) % 12;
}

export function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function noteName(m: number): string {
  return NOTE_NAMES[pc(m)] + String(Math.floor(Math.round(m) / 12) - 1);
}

export function chordPcs(ch: Chord): number[] {
  return CHORD_INTERVALS[ch.quality].map((i) => (ch.root + i) % 12);
}

/** Chord tones that matter most for voicing (3rd/7th first, then root, 5th, extensions). */
export function essentialPcs(ch: Chord): number[] {
  const iv = CHORD_INTERVALS[ch.quality];
  const out: number[] = [];
  for (const i of iv) if (i === 3 || i === 4 || i === 10 || i === 11 || i === 9 || i === 6 || i === 5 || i === 2) out.push((ch.root + i) % 12);
  out.push(ch.root % 12);
  return out;
}

const MAJOR_DEG = [0, 2, 4, 5, 7, 9, 11];
const MINOR_DEG = [0, 2, 3, 5, 7, 8, 10];
const ROMAN = ['vii', 'iii', 'vi', 'iv', 'v', 'ii', 'i'] as const; // longest-match order
const ROMAN_INDEX: Record<string, number> = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };

const parseCache = new Map<string, Chord>();

/**
 * Parse a roman numeral relative to a key. Degrees follow the mode's scale (minor: natural minor, so
 * 'VI' in D minor is Bb); case picks major/minor triads. Suffixes: 7, maj7, ø7, o, o7, +, 6, sus2, sus4,
 * add9, 7b9, 7sus4, mM7. Prefix b/# alters the root.
 */
export function parseRoman(numeral: string, tonic: number, mode: 'major' | 'minor'): Chord {
  const key = `${numeral}|${tonic}|${mode}`;
  const hit = parseCache.get(key);
  if (hit) return hit;
  let s = numeral.trim();
  let alter = 0;
  while (s.startsWith('b') || s.startsWith('#')) {
    alter += s[0] === 'b' ? -1 : 1;
    s = s.slice(1);
  }
  const lower = s.toLowerCase();
  let deg = -1;
  let len = 0;
  for (const r of ROMAN) {
    if (lower.startsWith(r)) {
      deg = ROMAN_INDEX[r];
      len = r.length;
      break;
    }
  }
  if (deg < 0) throw new Error(`bad roman numeral: ${numeral}`);
  const upper = s[0] === s[0].toUpperCase();
  const suffix = s.slice(len);
  let quality: ChordQuality;
  switch (suffix) {
    case '': quality = upper ? 'maj' : 'min'; break;
    case '7': quality = upper ? 'dom7' : 'min7'; break;
    case 'maj7': case 'M7': quality = 'maj7'; break;
    case 'ø7': case 'h7': quality = 'hdim7'; break;
    case 'o': case '°': quality = 'dim'; break;
    case 'o7': case '°7': quality = 'dim7'; break;
    case '+': quality = 'aug'; break;
    case '6': quality = upper ? 'maj6' : 'min6'; break;
    case 'sus2': quality = 'sus2'; break;
    case 'sus4': quality = 'sus4'; break;
    case 'add9': quality = upper ? 'add9' : 'minAdd9'; break;
    case '7b9': quality = 'dom7b9'; break;
    case '7sus4': quality = 'dom7sus4'; break;
    case 'mM7': quality = 'minMaj7'; break;
    default: throw new Error(`bad chord suffix: ${numeral}`);
  }
  const degs = mode === 'major' ? MAJOR_DEG : MINOR_DEG;
  const root = (((tonic + degs[deg] + alter) % 12) + 12) % 12;
  const chord: Chord = { root, quality, symbol: `${NOTE_NAMES[root]}${quality === 'maj' ? '' : quality}` };
  parseCache.set(key, chord);
  return chord;
}

export function scalePcs(tonic: number, scale: readonly number[]): number[] {
  return scale.map((i) => (tonic + i) % 12);
}

export function inSet(m: number, pcs: readonly number[]): boolean {
  return pcs.includes(pc(m));
}

/** Nearest MIDI note to `target` whose pitch class is in `pcs` (ties go down). */
export function nearestIn(target: number, pcs: readonly number[]): number {
  const t = Math.round(target);
  for (let d = 0; d <= 12; d++) {
    if (inSet(t - d, pcs)) return t - d;
    if (inSet(t + d, pcs)) return t + d;
  }
  return t;
}

/** Move by `steps` scale degrees (pcs sorted or not). Non-scale start snaps first. */
export function scaleStep(m: number, steps: number, pcs: readonly number[]): number {
  let cur = nearestIn(m, pcs);
  const dir = steps < 0 ? -1 : 1;
  let n = Math.abs(Math.round(steps));
  while (n > 0) {
    cur += dir;
    let guard = 0;
    while (!inSet(cur, pcs) && guard++ < 12) cur += dir;
    n--;
  }
  return cur;
}

/** Fold a note into [lo, hi] by octaves (keeps pitch class). */
export function foldInto(m: number, lo: number, hi: number): number {
  let x = m;
  if (hi - lo < 12) return Math.min(hi, Math.max(lo, x));
  while (x < lo) x += 12;
  while (x > hi) x -= 12;
  return x;
}

function candidatesNear(prev: number, pcs: readonly number[], lo: number, hi: number, spread: number): number[] {
  const out: number[] = [];
  for (let m = Math.max(lo, prev - spread); m <= Math.min(hi, prev + spread); m++) if (inSet(m, pcs)) out.push(m);
  return out;
}

/**
 * Voice-lead to a new chord: choose `voices` notes (ascending, distinct) from the chord's pitch classes
 * within [lo, hi] minimising total motion from `prev`, while covering 3rd/7th (and root unless rootless).
 * Deterministic (brute force over nearby candidates, first best wins).
 */
export function voiceLead(prev: readonly number[] | null, ch: Chord, voices: number, lo: number, hi: number, opts: { rootless?: boolean; center?: number } = {}): number[] {
  const pcs = chordPcs(ch);
  const n = Math.max(1, Math.min(5, Math.floor(voices)));
  const center = opts.center ?? Math.round((lo + hi) / 2);
  const ref: number[] = prev && prev.length === n ? [...prev] : Array.from({ length: n }, (_, i) => Math.round(center - (n - 1) * 2 + i * 4));
  const must: number[] = [];
  const iv = CHORD_INTERVALS[ch.quality];
  for (const i of iv) {
    const p = (ch.root + i) % 12;
    if (i === 3 || i === 4 || i === 10 || i === 11 || i === 6 || i === 9 || i === 13 || i === 5) must.push(p);
  }
  if (!opts.rootless) must.push(ch.root);
  const cands = ref.map((r) => {
    let c = candidatesNear(r, pcs, lo, hi, 7);
    if (c.length < 2) c = candidatesNear(r, pcs, lo, hi, 14);
    return c;
  });
  let best: number[] | null = null;
  let bestScore = Infinity;
  const cur = new Array<number>(n).fill(0);
  const rec = (v: number): void => {
    if (v === n) {
      let score = 0;
      for (let i = 0; i < n; i++) score += Math.abs(cur[i] - ref[i]);
      const present = new Set(cur.map((x) => pc(x)));
      for (const p of must) if (!present.has(p)) score += 7;
      // doubling penalty
      score += (n - present.size) * 2;
      for (let i = 1; i < n; i++) if (cur[i] - cur[i - 1] > 12) score += 4;
      // avoid muddy low clusters
      if (n > 1 && cur[1] - cur[0] < 3 && cur[0] < 52) score += 3;
      if (score < bestScore) {
        bestScore = score;
        best = cur.slice();
      }
      return;
    }
    const list = cands[v];
    for (let k = 0; k < list.length; k++) {
      const m = list[k];
      if (v > 0 && m <= cur[v - 1]) continue;
      cur[v] = m;
      rec(v + 1);
    }
  };
  rec(0);
  if (best) return best;
  // Fallback: stacked chord tones from lo upwards (always valid).
  const out: number[] = [];
  let m = nearestIn(Math.max(lo, center - 7), pcs);
  while (out.length < n) {
    if (inSet(m, pcs) && (out.length === 0 || m > out[out.length - 1])) out.push(m);
    m++;
    if (m > hi + 24) break;
  }
  while (out.length < n) out.push((out[out.length - 1] ?? center) + 12);
  return out;
}

/**
 * Chord-scale: the key's base scale with chord tones substituted in (e.g. C# replaces C over A major in
 * D minor). The displaced neighbour is the lower one unless that is the tonic or a chord tone.
 */
export function chordScale(ch: Chord, tonic: number, base: readonly number[]): number[] {
  const tones = chordPcs(ch);
  const out = base.map((i) => (tonic + i) % 12);
  const t0 = tonic % 12;
  for (const t of tones) {
    if (out.includes(t)) continue;
    const lower = (t + 11) % 12;
    const upper = (t + 1) % 12;
    let idx = out.indexOf(lower);
    if (idx < 0 || lower === t0 || tones.includes(lower)) {
      idx = out.indexOf(upper);
      if (idx >= 0 && (upper === t0 || tones.includes(upper))) idx = -1;
    }
    if (idx >= 0) out.splice(idx, 1);
    out.push(t);
  }
  return out.sort((a, b) => a - b);
}
