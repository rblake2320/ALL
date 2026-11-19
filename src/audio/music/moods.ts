/**
 * The adaptive score: nine cues, each a small deterministic "composition program" (form + arranger).
 * Keys/meters/tempi per the audio brief. Chord progressions are generic functional harmony.
 */
import type { MusicMood } from '../../shared/audioIds';
import { chordScale, SCALES, type Chord } from './theory';
import {
  arpeggio, bassOompah, bassPulse8, bassRoots, bassStaccato, bassSustain, bassWalking, bassWaltz,
  compJazz, compPad, compStabs, compWaltz, defaultScale, drumsLight, drumsLounge, drumsParty, drumsPlayful,
  drumsTense, melody, push,
} from './parts';
import type { MoodDef, SectionCtx } from './types';

const D = 2, E = 4, F = 5, G = 7, A = 9, C = 0, Eb = 3;

const scaleOf = (c: SectionCtx) => (ch: Chord): readonly number[] => defaultScale(c, ch);

const menu: MoodDef = {
  id: 'menu', bpm: 84, beatsPerBar: 3, swing: 0.5, tonic: D, mode: 'minor', level: 3.46,
  // D natural minor + C# (harmonic minor leading tone)
  allowedPcs: [2, 4, 5, 7, 9, 10, 0, 1],
  form: [
    { name: 'A', bars: ['i', 'iv', 'V', 'i', 'VI', 'iv', 'V7', 'i'] },
    { name: 'A2', bars: ['i', 'iv', 'VII', 'III', 'VI', 'iiø7', 'V7', 'i'] },
    { name: 'B', bars: ['III', 'VII', 'i', 'V', 'VI', 'III', 'iv', 'V7'] },
    { name: 'A3', bars: ['i', 'iv', 'V', 'i', 'VI', 'iiø7', 'V7', 'i'] },
  ],
  mix: {
    harp: { gain: 0.3, send: 0.35 }, pizz: { gain: 0.4, send: 0.3, pan: -0.25 }, musicBox: { gain: 0.55, send: 0.45, pan: 0.2 },
    celesta: { gain: 0.48, send: 0.45, pan: 0.15 }, pad: { gain: 0.15, send: 0.5 }, bell: { gain: 0.22, send: 0.6 },
  },
  arrange(c) {
    bassWaltz(c, 'harp', 38, 55, 0.8);
    compWaltz(c, 'pizz', 2, 57, 72, 0.55);
    const lead = c.formIndex === 2 ? 'celesta' : 'musicBox';
    melody(c, { inst: lead, lo: 69, hi: 88, vel: 0.75, density: 'medium', scaleFor: scaleOf(c) });
    if (c.formIndex > 0 || c.loop > 0) compPad(c, 'pad', 3, 50, 67, 0.5);
    if (c.loop > 0) push(c, 0, { beat: 0, dur: 3, midi: 50, vel: 0.6, inst: 'bell' });
  },
};

const caz: MoodDef = {
  id: 'caz', bpm: 112, beatsPerBar: 4, swing: 0.5, tonic: E, mode: 'minor', level: 2.5,
  // E dorian
  allowedPcs: [4, 6, 7, 9, 11, 1, 2],
  form: [
    { name: 'A', bars: ['i', 'IV', 'i', 'IV', 'i', 'IV', 'v', 'i'] },
    { name: 'B', bars: ['III', 'VII', 'IV', 'i', 'III', 'VII', 'v', 'IV'] },
  ],
  mix: {
    bassoon: { gain: 0.3, send: 0.12 }, pizz: { gain: 0.36, send: 0.25, pan: -0.3 }, marimba: { gain: 0.52, send: 0.25, pan: 0.15 },
    xylo: { gain: 0.3, send: 0.25, pan: 0.3 }, snap: { gain: 0.3, send: 0.2, pan: 0.2 }, shaker: { gain: 0.16, send: 0.1, pan: -0.35 },
    woodblock: { gain: 0.25, send: 0.2, pan: 0.4 },
  },
  arrange(c) {
    const dorian = (ch: Chord) => chordScale(ch, E, SCALES.dorian);
    bassStaccato(c, 'bassoon', 40, 55, 0.85);
    compStabs(c, 'pizz', 3, 55, 71, 0.5, [1.5, 3.5], 0.3);
    melody(c, { inst: 'marimba', lo: 64, hi: 84, vel: 0.8, density: c.formIndex === 0 ? 'busy' : 'medium', scaleFor: dorian, double: c.loop % 2 === 1 ? 'xylo' : undefined, legato: 0.8 });
    drumsPlayful(c, 0.8);
  },
};

const liveScale = (ch: Chord): readonly number[] => {
  if (ch.root === D) return chordScale(ch, G, SCALES.harmonicMinor);
  if (ch.root === G && ch.quality === 'min6') return chordScale(ch, G, SCALES.dorian);
  return chordScale(ch, G, SCALES.minor);
};

const live: MoodDef = {
  id: 'live', bpm: 96, beatsPerBar: 4, swing: 0.64, tonic: G, mode: 'minor', level: 2.4,
  // G natural minor + F# (V7) + E (i6 / dorian colour)
  allowedPcs: [7, 9, 10, 0, 2, 3, 5, 6, 4],
  form: [
    { name: 'A', bars: ['iv7', 'VII7', 'IIImaj7', 'VImaj7', 'iiø7', 'V7', 'i7', 'i7'] },
    { name: 'B', bars: ['iiø7', 'V7', 'i7', 'i6', 'iv7', 'VII7', 'IIImaj7', 'V7'] },
    { name: 'A2', bars: ['iv7', 'VII7', 'IIImaj7', 'VImaj7', 'iiø7', 'V7', 'i7', 'iiø7 V7'] },
    { name: 'B2', bars: ['iiø7', 'V7b9', 'i7', 'i6', 'iv7', 'VII7', 'iiø7 V7', 'i7'] },
  ],
  mix: {
    bass: { gain: 0.32, send: 0.12 }, vibes: { gain: 0.44, send: 0.4, pan: -0.2 }, celesta: { gain: 0.44, send: 0.45, pan: 0.25 },
    theremin: { gain: 0.3, send: 0.55, pan: 0.15 }, ride: { gain: 0.2, send: 0.2, pan: 0.35 }, brush: { gain: 0.3, send: 0.2, pan: -0.1 },
    swish: { gain: 0.22, send: 0.2, pan: -0.1 }, kick: { gain: 0.22, send: 0.05 }, snare: { gain: 0.22, send: 0.2 },
  },
  arrange(c) {
    bassWalking(c, 'bass', 31, 50, 0.85, liveScale);
    compJazz(c, 'vibes', 3, 58, 74, 0.6);
    drumsLounge(c, 0.8);
    const theremin = c.formIndex === 3 || (c.formIndex === 1 && c.loop % 2 === 1);
    if (theremin) melody(c, { inst: 'theremin', lo: 62, hi: 81, vel: 0.75, density: 'sparse', scaleFor: liveScale, glide: true, legato: 1 });
    else if (c.formIndex !== 1) melody(c, { inst: 'celesta', lo: 67, hi: 86, vel: 0.7, density: 'medium', scaleFor: liveScale, rest: (b) => c.loop === 0 && c.formIndex === 0 && b < 2 });
  },
};

const night: MoodDef = {
  id: 'night', bpm: 66, beatsPerBar: 4, swing: 0.5, tonic: A, mode: 'minor', level: 3.06,
  allowedPcs: [9, 11, 0, 2, 4, 5, 7],
  form: [
    { name: 'A', bars: ['i', 'VI', 'III', 'VII', 'i', 'VI', 'iv', 'v'] },
    { name: 'B', bars: ['VI', 'VII', 'i', 'i', 'iv', 'v', 'VI', 'VII'] },
  ],
  mix: {
    pad: { gain: 0.18, send: 0.55 }, musicBox: { gain: 0.48, send: 0.55, pan: 0.2 }, harp: { gain: 0.28, send: 0.5, pan: -0.25 },
    bell: { gain: 0.2, send: 0.65, pan: -0.1 },
  },
  arrange(c) {
    compPad(c, 'pad', 3, 52, 69, 0.55);
    bassSustain(c, 'pad', 33, 45, 0.3);
    melody(c, { inst: 'musicBox', lo: 72, hi: 91, vel: 0.6, density: 'sparse', scaleFor: scaleOf(c), rest: (b) => (c.loop === 0 ? b % 2 === 1 : b % 4 === 3) });
    if (c.loop > 0 || c.formIndex === 1) arpeggio(c, 'harp', 3, 57, 76, 0.4, [0, 1, 2, 3, 2, 1], 1, 2.5);
    push(c, 0, { beat: 0, dur: 4, midi: 57, vel: 0.5, inst: 'bell' });
  },
};

const build: MoodDef = {
  id: 'build', bpm: 104, beatsPerBar: 4, swing: 0.5, tonic: F, mode: 'major', level: 3.6,
  allowedPcs: [5, 7, 9, 10, 0, 2, 4],
  form: [
    { name: 'A', bars: ['I', 'V', 'vi', 'IV', 'I', 'V', 'IV', 'V'] },
    { name: 'B', bars: ['IV', 'V', 'iii', 'vi', 'ii', 'V', 'I', 'I'] },
  ],
  mix: {
    pizz: { gain: 0.46, send: 0.3, pan: -0.15 }, bass: { gain: 0.24, send: 0.12 }, marimba: { gain: 0.44, send: 0.3, pan: 0.25 },
    glock: { gain: 0.2, send: 0.45, pan: 0.3 }, shaker: { gain: 0.12, send: 0.1, pan: -0.4 }, woodblock: { gain: 0.18, send: 0.2, pan: 0.35 },
  },
  arrange(c) {
    arpeggio(c, 'pizz', 3, 53, 74, 0.6, [0, 1, 2, 1, 3, 1, 2, 1], 0.5, 1);
    bassRoots(c, 'bass', 36, 52, 0.7, [0, 2], 1.6);
    if (c.formIndex === 1 || c.loop > 0) melody(c, { inst: 'marimba', lo: 65, hi: 84, vel: 0.7, density: 'medium', scaleFor: scaleOf(c), legato: 0.85 });
    if (c.loop > 0) {
      drumsLight(c, 0.6);
      push(c, 0, { beat: 0, dur: 2, midi: 84, vel: 0.5, inst: 'glock' });
    }
  },
};

const tense: MoodDef = {
  id: 'tense', bpm: 80, beatsPerBar: 4, swing: 0.5, tonic: C, mode: 'minor', level: 2.06,
  // C minor + Db (phrygian) + B (harmonic)
  allowedPcs: [0, 1, 2, 3, 5, 7, 8, 10, 11],
  form: [
    { name: 'A', bars: ['i', 'i', 'bII', 'i', 'i', 'VI', 'V', 'V'] },
    { name: 'B', bars: ['VI', 'VI', 'bII', 'bII', 'i', 'i', 'V', 'V'] },
  ],
  mix: {
    pulse: { gain: 0.34, send: 0.15 }, pad: { gain: 0.2, send: 0.5 }, timpani: { gain: 0.36, send: 0.4 }, tick: { gain: 0.16, send: 0.2, pan: 0.3 },
    kick: { gain: 0.3, send: 0.2 }, celesta: { gain: 0.2, send: 0.6, pan: -0.3 }, theremin: { gain: 0.18, send: 0.6, pan: 0.25 },
  },
  arrange(c) {
    bassPulse8(c, 'pulse', 31, 48, 0.8);
    compPad(c, 'pad', 3, 48, 63, 0.5);
    drumsTense(c, 0.75, c.bars[0][0].chord.root);
    for (const b of [3, 7]) {
      const ch = c.bars[b][0].chord;
      const hi = ch.root === G ? 83 : 84;
      push(c, b, { beat: 2, dur: 2, midi: hi, vel: 0.45, inst: 'celesta' });
      push(c, b, { beat: 2, dur: 2, midi: hi + 1, vel: 0.4, inst: 'celesta' });
    }
    if (c.formIndex === 1 && c.loop > 0) melody(c, { inst: 'theremin', lo: 60, hi: 76, vel: 0.6, density: 'sparse', scaleFor: scaleOf(c), glide: true, legato: 1, bias: -1 });
  },
};

const party: MoodDef = {
  id: 'party', bpm: 124, beatsPerBar: 4, swing: 0.5, tonic: G, mode: 'minor', level: 2.05,
  allowedPcs: [7, 9, 10, 0, 2, 3, 5, 6],
  form: [
    { name: 'A', bars: ['i', 'i', 'iv', 'V', 'i', 'i', 'VI', 'V7'] },
    { name: 'B', bars: ['iv', 'i', 'V', 'i', 'iv', 'i', 'VI V', 'i'] },
    { name: 'A2', bars: ['i', 'i', 'iv', 'V', 'i', 'i', 'VI', 'V7'] },
    { name: 'C', bars: ['VI', 'VII', 'III', 'i', 'VI', 'iv', 'V', 'V7'] },
  ],
  mix: {
    bass: { gain: 0.24, send: 0.1 }, organ: { gain: 0.3, send: 0.25, pan: -0.25 }, xylo: { gain: 0.55, send: 0.3, pan: 0.2 },
    glock: { gain: 0.16, send: 0.35, pan: 0.35 }, brass: { gain: 0.2, send: 0.3, pan: -0.1 }, kick: { gain: 0.28, send: 0.05 },
    clap: { gain: 0.28, send: 0.25, pan: 0.1 }, hat: { gain: 0.14, send: 0.1, pan: 0.3 }, ohat: { gain: 0.12, send: 0.15, pan: 0.3 },
    snare: { gain: 0.25, send: 0.2 },
  },
  arrange(c) {
    bassOompah(c, 'bass', 31, 50, 0.9);
    compStabs(c, 'organ', 3, 55, 70, 0.55, [0.5, 1.5, 2.5, 3.5], 0.28);
    melody(c, { inst: 'xylo', lo: 67, hi: 88, vel: 0.8, density: c.formIndex === 3 ? 'medium' : 'busy', scaleFor: scaleOf(c), double: c.loop > 0 && c.formIndex !== 3 ? 'glock' : undefined, legato: 0.7 });
    if (c.formIndex === 3) compStabs(c, 'brass', 3, 55, 72, 0.5, [0], 1.5);
    drumsParty(c, 0.85);
  },
};

const sad: MoodDef = {
  id: 'sad', bpm: 64, beatsPerBar: 4, swing: 0.5, tonic: A, mode: 'minor', level: 2.34,
  // A natural minor + G# (V)
  allowedPcs: [9, 11, 0, 2, 4, 5, 7, 8],
  form: [
    { name: 'A', bars: ['i', 'v', 'VI', 'III', 'iv', 'i', 'VI', 'V'] },
    { name: 'B', bars: ['VI', 'VII', 'v', 'i', 'iv', 'VII', 'Vsus4', 'V'] },
  ],
  mix: {
    epiano: { gain: 0.4, send: 0.4, pan: -0.1 }, celesta: { gain: 0.44, send: 0.5, pan: 0.2 }, pad: { gain: 0.15, send: 0.55 },
    bass: { gain: 0.18, send: 0.2 },
  },
  arrange(c) {
    arpeggio(c, 'epiano', 3, 48, 72, 0.5, [0, 1, 2, 3, 2, 1, 2, 1], 0.5, 2);
    bassSustain(c, 'bass', 33, 45, 0.55);
    melody(c, { inst: 'celesta', lo: 69, hi: 86, vel: 0.65, density: 'sparse', scaleFor: scaleOf(c), bias: -1 });
    if (c.formIndex === 1) compPad(c, 'pad', 3, 52, 69, 0.45);
  },
};

const romance: MoodDef = {
  id: 'romance', bpm: 88, beatsPerBar: 3, swing: 0.5, tonic: Eb, mode: 'major', level: 3.05,
  allowedPcs: [3, 5, 7, 8, 10, 0, 2],
  form: [
    { name: 'A', bars: ['Imaj7', 'vi7', 'ii7', 'V7', 'Imaj7', 'IVmaj7', 'ii7', 'V7'] },
    { name: 'B', bars: ['iii7', 'vi7', 'IVmaj7', 'V7', 'iii7', 'vi7', 'ii7', 'V7'] },
  ],
  mix: {
    harp: { gain: 0.4, send: 0.45, pan: -0.2 }, bass: { gain: 0.2, send: 0.2 }, celesta: { gain: 0.46, send: 0.5, pan: 0.2 },
    pad: { gain: 0.15, send: 0.55 },
  },
  arrange(c) {
    arpeggio(c, 'harp', 3, 51, 75, 0.55, [0, 1, 2, 3, 2, 1], 0.5, 3);
    bassWaltz(c, 'bass', 39, 55, 0.6);
    melody(c, { inst: 'celesta', lo: 70, hi: 89, vel: 0.65, density: 'medium', scaleFor: scaleOf(c), rest: (b) => c.loop === 0 && c.formIndex === 0 && b < 1 });
    compPad(c, 'pad', 3, 55, 70, 0.4);
  },
};

export const MOODS: Readonly<Record<MusicMood, MoodDef>> = { menu, caz, live, night, build, tense, party, sad, romance };
export const MOOD_IDS = Object.keys(MOODS) as MusicMood[];
