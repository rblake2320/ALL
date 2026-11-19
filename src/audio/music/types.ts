import type { MusicMood } from '../../shared/audioIds';
import type { Chord } from './theory';
import type { Rng } from '../prng';

export type InstrumentId =
  // pitched
  | 'celesta' | 'musicBox' | 'vibes' | 'marimba' | 'xylo' | 'glock' | 'pizz' | 'harp' | 'bass' | 'pad'
  | 'organ' | 'theremin' | 'brass' | 'bassoon' | 'epiano' | 'pulse' | 'choir' | 'bell' | 'timpani'
  // unpitched
  | 'kick' | 'snare' | 'brush' | 'swish' | 'hat' | 'ohat' | 'ride' | 'clap' | 'snap' | 'shaker' | 'woodblock' | 'tick';

export const UNPITCHED: ReadonlySet<InstrumentId> = new Set<InstrumentId>([
  'kick', 'snare', 'brush', 'swish', 'hat', 'ohat', 'ride', 'clap', 'snap', 'shaker', 'woodblock', 'tick',
]);

export interface NoteEvent {
  /** Onset in beats from the start of the bar, [0, beatsPerBar). */
  beat: number;
  /** Length in beats (> 0; beat + dur <= beatsPerBar). */
  dur: number;
  midi: number;
  /** 0..1 */
  vel: number;
  inst: InstrumentId;
  /** Portamento source note (theremin). */
  glide?: number;
}

export interface BarChord {
  beat: number;
  chord: Chord;
}

export interface BarPlan {
  /** Absolute bar index from the start of the cue. */
  index: number;
  beats: number;
  section: string;
  chords: BarChord[];
  events: NoteEvent[];
}

export interface SectionDef {
  name: string;
  /** One entry per bar; two chords in a bar are space separated ("iiø7 V7"). */
  bars: string[];
}

export interface MixEntry {
  gain: number;
  /** Reverb send 0..1 */
  send: number;
  pan?: number;
}

export interface SectionCtx {
  mood: MoodDef;
  section: SectionDef;
  sectionIndex: number;
  formIndex: number;
  loop: number;
  bars: BarChord[][];
  beats: number;
  rng: Rng;
  /** Per-bar output (arrangers push here). */
  out: NoteEvent[][];
}

export interface MoodDef {
  id: MusicMood;
  bpm: number;
  beatsPerBar: 3 | 4;
  /** Off-beat position inside a beat: 0.5 straight, ~0.64 swung. */
  swing: number;
  tonic: number;
  mode: 'major' | 'minor';
  /** Every pitched note must have one of these pitch classes. */
  allowedPcs: readonly number[];
  form: readonly SectionDef[];
  mix: Partial<Record<InstrumentId, MixEntry>>;
  /** Output level of the whole cue. */
  level: number;
  arrange(c: SectionCtx): void;
}
