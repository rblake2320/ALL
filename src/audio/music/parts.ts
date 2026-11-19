/**
 * Generic, deterministic part generators (bass / comping / arpeggios / melody / drums) used by the mood
 * arrangers. Everything writes into SectionCtx.out via push(), which enforces bar-length invariants.
 */
import { chordPcs, chordScale, foldInto, inSet, nearestIn, pc, scaleStep, voiceLead, SCALES, type Chord } from './theory';
import type { BarChord, InstrumentId, NoteEvent, SectionCtx } from './types';

export function chordAt(bar: readonly BarChord[], beat: number): Chord {
  let ch = bar[0].chord;
  for (const bc of bar) if (bc.beat <= beat + 1e-9) ch = bc.chord;
  return ch;
}

export interface Span {
  start: number;
  end: number;
  chord: Chord;
}

export function spans(bar: readonly BarChord[], beats: number): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < bar.length; i++) {
    const start = bar[i].beat;
    const end = i + 1 < bar.length ? bar[i + 1].beat : beats;
    if (end > start) out.push({ start, end, chord: bar[i].chord });
  }
  return out;
}

export function push(c: SectionCtx, bar: number, ev: NoteEvent): void {
  if (bar < 0 || bar >= c.out.length) return;
  if (!(ev.beat >= 0 && ev.beat < c.beats)) return;
  ev.dur = Math.min(ev.dur, c.beats - ev.beat);
  if (!(ev.dur > 1e-6)) return;
  ev.vel = Math.max(0.05, Math.min(1, ev.vel));
  c.out[bar].push(ev);
}

/** Pitch-class-preserving pick of the octave closest to `near` inside [lo, hi]. */
export function closestPc(target: number, near: number, lo: number, hi: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let m = lo; m <= hi; m++) {
    if (pc(m) !== pc(target)) continue;
    const d = Math.abs(m - near);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best >= 0 ? best : foldInto(target, lo, hi);
}

export function defaultScale(c: SectionCtx, ch: Chord): number[] {
  const base = c.mood.mode === 'major' ? SCALES.major : SCALES.minor;
  return chordScale(ch, c.mood.tonic, base);
}

function humanVel(c: SectionCtx, v: number): number {
  return v * (0.9 + c.rng.next() * 0.16);
}

// ───────────────────────────── bass ─────────────────────────────

export function bassRoots(c: SectionCtx, inst: InstrumentId, lo: number, hi: number, vel: number, beatsList: readonly number[], dur: number): void {
  let prev = Math.round((lo + hi) / 2);
  for (let b = 0; b < c.bars.length; b++) {
    const bar = c.bars[b];
    for (const beat of beatsList) {
      if (beat >= c.beats) continue;
      const ch = chordAt(bar, beat);
      const m = closestPc(ch.root, prev, lo, hi);
      push(c, b, { beat, dur, midi: m, vel: humanVel(c, beat === 0 ? vel : vel * 0.85), inst });
      prev = m;
    }
    // chord changes that don't fall on listed beats still get a root
    for (const bc of bar) {
      if (bc.beat > 0 && !beatsList.includes(bc.beat)) {
        const m = closestPc(bc.chord.root, prev, lo, hi);
        push(c, b, { beat: bc.beat, dur, midi: m, vel: humanVel(c, vel * 0.9), inst });
        prev = m;
      }
    }
  }
}

/** Waltz bass: one ringing root per chord span (beat 1). */
export function bassWaltz(c: SectionCtx, inst: InstrumentId, lo: number, hi: number, vel: number): void {
  let prev = Math.round((lo + hi) / 2);
  for (let b = 0; b < c.bars.length; b++) {
    for (const sp of spans(c.bars[b], c.beats)) {
      const m = closestPc(sp.chord.root, prev, lo, hi);
      push(c, b, { beat: sp.start, dur: Math.min(1.5, sp.end - sp.start), midi: m, vel: humanVel(c, vel), inst });
      prev = m;
    }
  }
}

/** Oom-pah: root on 1, fifth (or octave) on the mid-bar beat. */
export function bassOompah(c: SectionCtx, inst: InstrumentId, lo: number, hi: number, vel: number): void {
  let prev = Math.round((lo + hi) / 2);
  const mid = c.beats === 3 ? 1 : 2;
  for (let b = 0; b < c.bars.length; b++) {
    const bar = c.bars[b];
    for (const sp of spans(bar, c.beats)) {
      const root = closestPc(sp.chord.root, prev, lo, hi);
      push(c, b, { beat: sp.start, dur: 0.6, midi: root, vel: humanVel(c, vel), inst });
      prev = root;
      const second = sp.start + mid;
      if (second < sp.end) {
        const tones = chordPcs(sp.chord);
        const fifth = tones.length > 2 ? closestPc(tones[2], root + 5, lo, hi) : root;
        push(c, b, { beat: second, dur: 0.6, midi: c.rng.chance(0.25) ? closestPc(sp.chord.root, root + 12, lo, hi) : fifth, vel: humanVel(c, vel * 0.82), inst });
      }
    }
  }
}

/** Staccato root-fifth bounce with a syncopated pickup (playful). */
export function bassStaccato(c: SectionCtx, inst: InstrumentId, lo: number, hi: number, vel: number): void {
  let prev = Math.round((lo + hi) / 2);
  const pattern = [0, 1.5, 2, 3];
  for (let b = 0; b < c.bars.length; b++) {
    const bar = c.bars[b];
    for (let i = 0; i < pattern.length; i++) {
      const beat = pattern[i];
      if (beat >= c.beats) continue;
      const ch = chordAt(bar, beat);
      const tones = chordPcs(ch);
      let m: number;
      if (i === 0 || bar.some((x) => x.beat === beat)) m = closestPc(ch.root, prev, lo, hi);
      else if (i === 1) m = closestPc(tones[2] ?? ch.root, prev + 4, lo, hi);
      else if (i === 2) m = closestPc(ch.root, prev, lo, hi);
      else m = c.rng.chance(0.5) ? closestPc(ch.root, prev + 12, lo, hi) : closestPc(tones[1], prev + 2, lo, hi);
      push(c, b, { beat, dur: 0.4, midi: m, vel: humanVel(c, i === 0 ? vel : vel * 0.8), inst });
      prev = m;
    }
  }
}

/** Driving eighth-note pulse, 3+3+2 accents, octave pop on the last eighth. */
export function bassPulse8(c: SectionCtx, inst: InstrumentId, lo: number, hi: number, vel: number): void {
  for (let b = 0; b < c.bars.length; b++) {
    const bar = c.bars[b];
    for (let i = 0; i < c.beats * 2; i++) {
      const beat = i / 2;
      const ch = chordAt(bar, beat);
      const root = closestPc(ch.root, lo + 5, lo, hi);
      const accent = i === 0 || i === 3 || i === 6;
      const m = i === c.beats * 2 - 1 && b % 2 === 1 ? Math.min(hi, root + 12) : root;
      push(c, b, { beat, dur: 0.32, midi: inSet(m, chordPcs(ch)) ? m : root, vel: humanVel(c, accent ? vel : vel * 0.62), inst });
    }
  }
}

/** Whole-span sustained roots (pads / drones). */
export function bassSustain(c: SectionCtx, inst: InstrumentId, lo: number, hi: number, vel: number): void {
  let prev = Math.round((lo + hi) / 2);
  for (let b = 0; b < c.bars.length; b++) {
    for (const sp of spans(c.bars[b], c.beats)) {
      const m = closestPc(sp.chord.root, prev, lo, hi);
      push(c, b, { beat: sp.start, dur: sp.end - sp.start, midi: m, vel: humanVel(c, vel), inst });
      prev = m;
    }
  }
}

/** Jazz walking bass: roots on changes, chord tones / scale steps between, approach tones into changes. */
export function bassWalking(c: SectionCtx, inst: InstrumentId, lo: number, hi: number, vel: number, scaleFor: (ch: Chord) => readonly number[]): void {
  let prev = closestPc(c.bars[0][0].chord.root, lo + 7, lo, hi);
  const allowed = c.mood.allowedPcs;
  for (let b = 0; b < c.bars.length; b++) {
    const bar = c.bars[b];
    const nextBar = c.bars[b + 1] ?? c.bars[0];
    for (let beat = 0; beat < c.beats; beat++) {
      const ch = chordAt(bar, beat);
      const isChange = bar.some((x) => Math.abs(x.beat - beat) < 1e-9);
      const nextChanges = beat + 1 >= c.beats || bar.some((x) => Math.abs(x.beat - (beat + 1)) < 1e-9);
      const nextCh = beat + 1 < c.beats ? chordAt(bar, beat + 1) : chordAt(nextBar, 0);
      let m: number;
      if (isChange) {
        m = closestPc(ch.root, prev, lo, hi);
      } else if (nextChanges) {
        const target = closestPc(nextCh.root, prev, lo, hi);
        const dir = target >= prev ? -1 : 1;
        let cand = target + dir;
        if (!allowed.includes(pc(cand)) || !scaleFor(ch).includes(pc(cand))) cand = scaleStep(target, dir, scaleFor(ch));
        if (cand === prev || !allowed.includes(pc(cand))) cand = closestPc(chordPcs(ch)[2] ?? ch.root, prev, lo, hi);
        m = cand;
      } else {
        const tones = chordPcs(ch);
        if (c.rng.chance(0.55)) m = nearestIn(prev + (c.rng.chance(0.5) ? 3 : -4), tones);
        else m = scaleStep(prev, c.rng.chance(0.6) ? 1 : -1, scaleFor(ch));
        if (m === prev) m = scaleStep(prev, 1, scaleFor(ch));
      }
      m = foldInto(m, lo, hi);
      push(c, b, { beat, dur: 0.9, midi: m, vel: humanVel(c, beat % 2 === 0 ? vel : vel * 0.86), inst });
      prev = m;
    }
  }
}

// ───────────────────────────── harmony ─────────────────────────────

/** Sustained voice-led chords, one event per voice per chord span. */
export function compPad(c: SectionCtx, inst: InstrumentId, voices: number, lo: number, hi: number, vel: number, opts: { rootless?: boolean; skipBars?: (bar: number) => boolean } = {}): void {
  let voicing: number[] | null = null;
  for (let b = 0; b < c.bars.length; b++) {
    for (const sp of spans(c.bars[b], c.beats)) {
      voicing = voiceLead(voicing, sp.chord, voices, lo, hi, { rootless: opts.rootless });
      if (opts.skipBars?.(b)) continue;
      for (const m of voicing) push(c, b, { beat: sp.start, dur: sp.end - sp.start, midi: m, vel: humanVel(c, vel), inst });
    }
  }
}

/** Waltz "pah-pah" on beats 2 and 3. */
export function compWaltz(c: SectionCtx, inst: InstrumentId, voices: number, lo: number, hi: number, vel: number): void {
  let voicing: number[] | null = null;
  for (let b = 0; b < c.bars.length; b++) {
    for (let beat = 1; beat < c.beats; beat++) {
      const ch = chordAt(c.bars[b], beat);
      voicing = voiceLead(voicing, ch, voices, lo, hi);
      if (beat === 2 && c.rng.chance(0.15)) continue;
      for (const m of voicing) push(c, b, { beat, dur: 0.7, midi: m, vel: humanVel(c, beat === 1 ? vel : vel * 0.85), inst });
    }
  }
}

/** Short chord stabs at fixed beat positions (party organ off-beats, playful pizz). */
export function compStabs(c: SectionCtx, inst: InstrumentId, voices: number, lo: number, hi: number, vel: number, positions: readonly number[], dur: number): void {
  let voicing: number[] | null = null;
  for (let b = 0; b < c.bars.length; b++) {
    for (const beat of positions) {
      if (beat >= c.beats) continue;
      const ch = chordAt(c.bars[b], beat);
      voicing = voiceLead(voicing, ch, voices, lo, hi);
      for (const m of voicing) push(c, b, { beat, dur, midi: m, vel: humanVel(c, vel), inst });
    }
  }
}

const VIBES_PATTERNS: readonly (readonly [number, number])[][] = [
  [[0, 1.5], [1.5, 0.5]],
  [[1.5, 1.5]],
  [[0, 1], [2.5, 1]],
  [[1, 1], [3, 1]],
  [[0.5, 1], [2.5, 1.5]],
  [[0, 2], [3.5, 0.5]],
];

/** Rootless jazz comping with rhythm patterns picked per bar (deterministic). */
export function compJazz(c: SectionCtx, inst: InstrumentId, voices: number, lo: number, hi: number, vel: number): void {
  let voicing: number[] | null = null;
  for (let b = 0; b < c.bars.length; b++) {
    const bar = c.bars[b];
    const sp = spans(bar, c.beats);
    if (sp.length > 1) {
      for (const s of sp) {
        voicing = voiceLead(voicing, s.chord, voices, lo, hi, { rootless: true });
        for (const m of voicing) push(c, b, { beat: s.start, dur: Math.min(1.5, s.end - s.start), midi: m, vel: humanVel(c, vel), inst });
      }
      continue;
    }
    voicing = voiceLead(voicing, sp[0].chord, voices, lo, hi, { rootless: true });
    const pat = c.rng.pick(VIBES_PATTERNS);
    for (const [beat, dur] of pat) {
      for (const m of voicing) push(c, b, { beat, dur, midi: m, vel: humanVel(c, beat === 0 ? vel : vel * 0.9), inst });
    }
  }
}

/** Broken-chord arpeggio over each chord span. `pattern` indexes the (voices+1)-note voicing. */
export function arpeggio(c: SectionCtx, inst: InstrumentId, voices: number, lo: number, hi: number, vel: number, pattern: readonly number[], step: number, ring: number): void {
  let voicing: number[] | null = null;
  for (let b = 0; b < c.bars.length; b++) {
    for (const sp of spans(c.bars[b], c.beats)) {
      voicing = voiceLead(voicing, sp.chord, voices, lo, hi);
      const notes = [...voicing, voicing[0] + 12];
      let i = 0;
      for (let beat = sp.start; beat < sp.end - 1e-9; beat += step) {
        const idx = pattern[i % pattern.length] % notes.length;
        const accent = Math.abs(beat - Math.round(beat)) < 1e-9 ? 1 : 0.82;
        push(c, b, { beat, dur: Math.min(step * ring, sp.end - beat), midi: notes[idx], vel: humanVel(c, vel * accent), inst });
        i++;
      }
    }
  }
}

// ───────────────────────────── melody ─────────────────────────────

type Rhythm = readonly (readonly [number, number])[];

const RHYTHMS: Record<3 | 4, Record<'sparse' | 'medium' | 'busy', readonly Rhythm[]>> = {
  3: {
    sparse: [[[0, 3]], [[0, 2], [2, 1]], [[0, 1], [1, 2]]],
    medium: [[[0, 2], [2, 1]], [[0, 1], [1, 1], [2, 1]], [[0, 1.5], [1.5, 0.5], [2, 1]], [[0, 1], [1, 2]], [[0, 2], [2, 0.5], [2.5, 0.5]]],
    busy: [[[0, 1], [1, 0.5], [1.5, 0.5], [2, 1]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 1]], [[0, 1], [1, 1], [2, 0.5], [2.5, 0.5]]],
  },
  4: {
    sparse: [[[0, 4]], [[0, 2], [2, 2]], [[0, 3], [3, 1]], [[1, 3]], [[0, 2]]],
    medium: [[[0, 1], [1, 1], [2, 2]], [[0, 1.5], [1.5, 0.5], [2, 2]], [[0, 2], [2, 1], [3, 1]], [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]], [[0.5, 0.5], [1, 1], [2, 1], [3, 1]], [[0, 1], [2, 1], [3, 1]]],
    busy: [
      [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1]],
      [[0, 1], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
      [[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 0.5]],
      [[0, 0.75], [0.75, 0.25], [1, 1], [2, 0.75], [2.75, 0.25], [3, 1]],
    ],
  },
};

const CADENCE: Record<3 | 4, readonly Rhythm[]> = {
  3: [[[0, 3]], [[0, 2]], [[0, 1], [1, 2]]],
  4: [[[0, 4]], [[0, 3]], [[0, 2], [2, 2]]],
};

export interface MelodyOpts {
  inst: InstrumentId;
  lo: number;
  hi: number;
  vel: number;
  density: 'sparse' | 'medium' | 'busy';
  scaleFor: (ch: Chord) => readonly number[];
  /** Bars (section-relative) left silent (pitch state still advances). */
  rest?: (bar: number) => boolean;
  glide?: boolean;
  /** Extra layer an octave up (or `doubleShift` semitones). */
  double?: InstrumentId;
  doubleShift?: number;
  /** -1 prefers falling contours, +1 rising. */
  bias?: number;
  /** Shorten notes (staccato) — fraction of the written length. */
  legato?: number;
}

function stepSet(bias: number): readonly number[] {
  if (bias < 0) return [-3, -2, -1, -1, -1, 0, 1, 1, 2];
  if (bias > 0) return [-2, -1, -1, 0, 1, 1, 1, 2, 3];
  return [-3, -2, -1, -1, 0, 1, 1, 2, 3];
}

/**
 * Motif-based melody: a 2-bar rhythm+contour motif, stated, sequenced, varied, then a cadence.
 * Strong beats land on chord tones; weak beats move by scale step.
 */
export function melody(c: SectionCtx, o: MelodyOpts): void {
  const meter = (c.beats === 3 ? 3 : 4) as 3 | 4;
  const bank = RHYTHMS[meter][o.density];
  const motifR: Rhythm[] = [c.rng.pick(bank), c.rng.pick(bank)];
  const steps = stepSet(o.bias ?? 0);
  const motifS: number[][] = motifR.map((r) => {
    const s: number[] = [];
    let last = 0;
    for (let i = 0; i < r.length; i++) {
      let st = c.rng.pick(steps);
      if (Math.abs(last) >= 3) st = -Math.sign(last) * c.rng.int(1, 2);
      s.push(st);
      last = st;
    }
    return s;
  });
  const center = Math.round((o.lo + o.hi) / 2);
  let p = nearestIn(center, chordPcs(c.bars[0][0].chord));
  let prevNote: number | null = null;
  const n = c.bars.length;
  for (let b = 0; b < n; b++) {
    const local = b % 8;
    const lastOfHalf = local === 7;
    const finalBar = b === n - 1;
    let rhythm: Rhythm;
    let contour: number[];
    if (lastOfHalf) {
      rhythm = c.rng.pick(CADENCE[meter]);
      contour = rhythm.map(() => 0);
    } else if (local === 6) {
      rhythm = motifR[0];
      contour = motifS[0].map((s) => (c.rng.chance(0.4) ? -s : s));
    } else if (local >= 4) {
      rhythm = motifR[local - 4];
      contour = motifS[local - 4].map((s, i) => (i === motifS[local - 4].length - 1 ? -s : s));
    } else {
      rhythm = motifR[local % 2];
      contour = motifS[local % 2];
    }
    const silent = o.rest?.(b) ?? false;
    for (let i = 0; i < rhythm.length; i++) {
      const [beat, dur] = rhythm[i];
      const ch = chordAt(c.bars[b], beat);
      const tones = chordPcs(ch);
      const scale = o.scaleFor(ch);
      const strong = beat === 0 || (meter === 4 && beat === 2);
      if (lastOfHalf && i === rhythm.length - 1) {
        // cadence: root on the final bar of the section, any chord tone mid-section
        p = finalBar ? closestPc(ch.root, p, o.lo, o.hi) : nearestIn(p, tones);
      } else {
        p = scaleStep(p, contour[i] ?? 0, scale);
        if (strong) p = nearestIn(p, tones);
      }
      if (p > o.hi) p = nearestIn(p - 12 >= o.lo ? p - 12 : o.hi, strong ? tones : scale);
      if (p < o.lo) p = nearestIn(p + 12 <= o.hi ? p + 12 : o.lo, strong ? tones : scale);
      if (!inSet(p, scale) && !inSet(p, tones)) p = nearestIn(p, scale);
      if (silent) continue;
      const accent = beat === 0 ? 1 : strong ? 0.92 : 0.82;
      const arch = 0.9 + 0.12 * Math.sin((Math.PI * (local + beat / c.beats)) / 8);
      const len = dur * (o.legato ?? 0.95);
      const ev: NoteEvent = { beat, dur: len, midi: p, vel: humanVel(c, o.vel * accent * arch), inst: o.inst };
      if (o.glide && prevNote !== null) ev.glide = prevNote;
      push(c, b, ev);
      if (o.double) push(c, b, { beat, dur: len, midi: p + (o.doubleShift ?? 12), vel: ev.vel * 0.55, inst: o.double });
      prevNote = p;
    }
  }
}

// ───────────────────────────── drums ─────────────────────────────

export function drumsLounge(c: SectionCtx, vel: number): void {
  for (let b = 0; b < c.bars.length; b++) {
    // ride: 1, 2, 2&, 3, 4, 4&  (swing applied at schedule time)
    for (const beat of [0, 1, 1.5, 2, 3, 3.5]) {
      if (beat >= c.beats) continue;
      const v = beat % 1 === 0 ? (beat % 2 === 1 ? vel * 0.85 : vel * 0.7) : vel * 0.5;
      push(c, b, { beat, dur: 0.5, midi: 0, vel: humanVel(c, v), inst: 'ride' });
    }
    push(c, b, { beat: 1, dur: 0.5, midi: 0, vel: humanVel(c, vel * 0.8), inst: 'brush' });
    push(c, b, { beat: 3, dur: 0.5, midi: 0, vel: humanVel(c, vel * 0.85), inst: 'brush' });
    if (b % 2 === 0) push(c, b, { beat: 0, dur: 2, midi: 0, vel: humanVel(c, vel * 0.45), inst: 'swish' });
    push(c, b, { beat: 0, dur: 0.5, midi: 0, vel: humanVel(c, vel * 0.45), inst: 'kick' });
    if (b % 8 === 7) {
      push(c, b, { beat: 3.5, dur: 0.25, midi: 0, vel: humanVel(c, vel * 0.7), inst: 'snare' });
      push(c, b, { beat: 3.75, dur: 0.25, midi: 0, vel: humanVel(c, vel * 0.55), inst: 'snare' });
    }
  }
}

export function drumsParty(c: SectionCtx, vel: number): void {
  for (let b = 0; b < c.bars.length; b++) {
    const fill = b % 8 === 7;
    for (let beat = 0; beat < c.beats; beat++) {
      push(c, b, { beat, dur: 0.5, midi: 0, vel: humanVel(c, beat % 2 === 0 ? vel : vel * 0.8), inst: 'kick' });
      if (beat % 2 === 1 && !(fill && beat === 3)) push(c, b, { beat, dur: 0.5, midi: 0, vel: humanVel(c, vel * 0.8), inst: 'clap' });
    }
    for (let i = 0; i < c.beats * 2; i++) {
      const beat = i / 2;
      const open = i === c.beats * 2 - 1 && !fill;
      push(c, b, { beat, dur: 0.5, midi: 0, vel: humanVel(c, i % 2 === 1 ? vel * 0.55 : vel * 0.35), inst: open ? 'ohat' : 'hat' });
    }
    if (fill) for (const beat of [3, 3.25, 3.5, 3.75]) push(c, b, { beat, dur: 0.25, midi: 0, vel: humanVel(c, vel * (0.5 + (beat - 3) * 0.6)), inst: 'snare' });
  }
}

export function drumsPlayful(c: SectionCtx, vel: number): void {
  for (let b = 0; b < c.bars.length; b++) {
    push(c, b, { beat: 1, dur: 0.25, midi: 0, vel: humanVel(c, vel), inst: 'snap' });
    push(c, b, { beat: 3, dur: 0.25, midi: 0, vel: humanVel(c, vel), inst: 'snap' });
    for (let i = 0; i < c.beats * 2; i++) push(c, b, { beat: i / 2, dur: 0.5, midi: 0, vel: humanVel(c, i % 2 ? vel * 0.42 : vel * 0.3), inst: 'shaker' });
    if (b % 4 === 3) push(c, b, { beat: 3.5, dur: 0.25, midi: 0, vel: humanVel(c, vel * 0.7), inst: 'woodblock' });
  }
}

export function drumsTense(c: SectionCtx, vel: number, root: number): void {
  for (let b = 0; b < c.bars.length; b++) {
    for (let i = 0; i < c.beats * 2; i++) push(c, b, { beat: i / 2, dur: 0.5, midi: 0, vel: humanVel(c, i % 2 ? vel * 0.3 : vel * 0.45), inst: 'tick' });
    if (b % 4 === 0) push(c, b, { beat: 0, dur: 2, midi: closestPc(root, 41, 36, 48), vel: humanVel(c, vel), inst: 'timpani' });
    if (b % 2 === 1) push(c, b, { beat: 0, dur: 1, midi: 0, vel: humanVel(c, vel * 0.6), inst: 'kick' });
  }
}

export function drumsLight(c: SectionCtx, vel: number): void {
  for (let b = 0; b < c.bars.length; b++) {
    for (let i = 0; i < c.beats * 4; i++) {
      if (i % 2 === 1 && c.rng.chance(0.35)) continue;
      push(c, b, { beat: i / 4, dur: 0.25, midi: 0, vel: humanVel(c, i % 4 === 2 ? vel * 0.7 : vel * 0.4), inst: 'shaker' });
    }
    push(c, b, { beat: 1, dur: 0.25, midi: 0, vel: humanVel(c, vel * 0.8), inst: 'woodblock' });
    push(c, b, { beat: 3, dur: 0.25, midi: 0, vel: humanVel(c, vel * 0.7), inst: 'woodblock' });
  }
}
