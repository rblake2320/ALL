/**
 * Deterministic composer: (mood, barIndex) -> BarPlan. Sections are generated whole (so melodies and
 * voicings flow across bars) and cached (small LRU). Pure: no WebAudio, no time.
 */
import type { MusicMood } from '../../shared/audioIds';
import { createRng, hashSeed } from '../prng';
import { MOODS } from './moods';
import { parseRoman } from './theory';
import type { BarChord, BarPlan, MoodDef, NoteEvent, SectionCtx } from './types';

const CACHE_MAX = 12;
const cache = new Map<string, BarPlan[]>();

function sectionBars(mood: MoodDef, formIndex: number): number {
  return mood.form[formIndex].bars.length;
}

/** Bars in one full pass of the form. */
export function formLength(mood: MoodDef): number {
  let n = 0;
  for (let i = 0; i < mood.form.length; i++) n += sectionBars(mood, i);
  return n;
}

/** Locate a bar: which section instance (cumulative index) and the bar inside it. */
export function locateBar(mood: MoodDef, barIndex: number): { sectionIndex: number; barInSection: number } {
  const total = formLength(mood);
  const b = Math.max(0, Math.floor(Number.isFinite(barIndex) ? barIndex : 0));
  const loop = Math.floor(b / total);
  let rem = b - loop * total;
  for (let i = 0; i < mood.form.length; i++) {
    const len = sectionBars(mood, i);
    if (rem < len) return { sectionIndex: loop * mood.form.length + i, barInSection: rem };
    rem -= len;
  }
  return { sectionIndex: loop * mood.form.length, barInSection: 0 };
}

export function parseBars(mood: MoodDef, formIndex: number): BarChord[][] {
  const sec = mood.form[formIndex];
  return sec.bars.map((cell) => {
    const parts = cell.split(/\s+/).filter(Boolean);
    const step = mood.beatsPerBar / parts.length;
    return parts.map((r, i) => ({ beat: i === 0 ? 0 : Math.round(i * step * 2) / 2, chord: parseRoman(r, mood.tonic, mood.mode) }));
  });
}

function sortEvents(evs: NoteEvent[]): void {
  evs.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
}

/** Compose one section instance (deterministic per mood + sectionIndex). */
export function composeSection(moodId: MusicMood, sectionIndex: number): BarPlan[] {
  const mood = MOODS[moodId];
  const si = Math.max(0, Math.floor(Number.isFinite(sectionIndex) ? sectionIndex : 0));
  const key = `${moodId}:${si}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const formIndex = si % mood.form.length;
  const loop = Math.floor(si / mood.form.length);
  const bars = parseBars(mood, formIndex);
  const out: NoteEvent[][] = bars.map(() => []);
  const c: SectionCtx = {
    mood,
    section: mood.form[formIndex],
    sectionIndex: si,
    formIndex,
    loop,
    bars,
    beats: mood.beatsPerBar,
    rng: createRng(hashSeed('music', moodId, si)),
    out,
  };
  try {
    mood.arrange(c);
  } catch {
    // A composition bug must never kill the score: fall back to sustained roots.
    for (let b = 0; b < bars.length; b++) {
      out[b].length = 0;
      out[b].push({ beat: 0, dur: mood.beatsPerBar, midi: 48 + bars[b][0].chord.root, vel: 0.5, inst: 'pad' });
    }
  }
  let firstBar = 0;
  for (let i = 0; i < formIndex; i++) firstBar += sectionBars(mood, i);
  firstBar += loop * formLength(mood);
  const plans: BarPlan[] = bars.map((chords, b) => {
    sortEvents(out[b]);
    return { index: firstBar + b, beats: mood.beatsPerBar, section: mood.form[formIndex].name, chords, events: out[b] };
  });
  cache.set(key, plans);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return plans;
}

/** The plan for an absolute bar of a cue (bar 0 = cue start). */
export function generateBar(moodId: MusicMood, barIndex: number): BarPlan {
  const mood = MOODS[moodId];
  const { sectionIndex, barInSection } = locateBar(mood, barIndex);
  return composeSection(moodId, sectionIndex)[barInSection];
}

export function clearComposerCache(): void {
  cache.clear();
}
