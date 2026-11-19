/**
 * Music playback: a MusicSection renders one cue (mood) through per-instrument channels (level, pan,
 * reverb send) with a fade gain; MusicPlayer crossfades sections (2 s) and drives their lookahead
 * sequencers from the engine timer. Works on any BaseAudioContext (offline renders pump once).
 */
import type { MusicMood } from '../../shared/audioIds';
import { createRng, hashSeed, type Rng } from '../prng';
import { filterNode, fin, gainNode, glideParam, lfo, setAt, stereo, stopSrc, targetAt } from '../synth/core';
import type { Sx } from '../synth/types';
import { generateBar } from './composer';
import { playNote } from './instruments';
import { MOODS } from './moods';
import { LookaheadSequencer, secondsPerBeat, LOOKAHEAD_SEC } from './scheduler';
import { UNPITCHED, type InstrumentId, type NoteEvent } from './types';

export const CROSSFADE_SEC = 2;
/** Hard cap on simultaneously sounding notes per cue (bounded node count: ≈ 5 nodes per note). */
export const MAX_CUE_NOTES = 40;

/** Fixed-size bag of note end times; counts what is still sounding without allocating. */
class NoteBudget {
  private readonly ends = new Float64Array(MAX_CUE_NOTES).fill(-Infinity);
  dropped = 0;
  /** Reserve a slot for a note sounding until `end`; false = over budget. */
  take(now: number, end: number): boolean {
    for (let i = 0; i < this.ends.length; i++) {
      if (this.ends[i] <= now) {
        this.ends[i] = end;
        return true;
      }
    }
    this.dropped++;
    return false;
  }
}

interface Channel {
  input: GainNode;
}

export class MusicSection {
  readonly mood: MusicMood;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly channels = new Map<InstrumentId, Channel>();
  private readonly seq: LookaheadSequencer;
  private readonly sx: Sx;
  private readonly rng: Rng;
  private readonly extraSources: AudioScheduledSourceNode[] = [];
  private fadeEndAt = Infinity;
  private killAt = Infinity;
  private disposed = false;
  private readonly budget = new NoteBudget();
  notes = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    dryDest: AudioNode,
    wetDest: AudioNode | null,
    mood: MusicMood,
    startTime: number,
    fadeIn: number,
    tempo: () => number,
  ) {
    this.mood = mood;
    const def = MOODS[mood];
    this.rng = createRng(hashSeed('music-human', mood));
    this.dry = gainNode(ctx, 0);
    this.wet = gainNode(ctx, 0);
    this.dry.connect(dryDest);
    if (wetDest) this.wet.connect(wetDest);
    const lvl = def.level;
    if (fadeIn > 0.01) {
      setAt(this.dry.gain, 0, startTime);
      this.dry.gain.linearRampToValueAtTime(lvl, startTime + fadeIn);
      setAt(this.wet.gain, 0, startTime);
      this.wet.gain.linearRampToValueAtTime(lvl, startTime + fadeIn);
    } else {
      this.dry.gain.value = lvl;
      this.wet.gain.value = lvl;
    }
    this.sx = { ctx, out: this.dry, t: 0, rng: this.rng, pitch: 1, vol: 1 };
    this.seq = new LookaheadSequencer({
      startTime: startTime + 0.05,
      bar: (i) => generateBar(mood, i),
      spb: () => secondsPerBeat(def.bpm, tempo()),
      swing: def.swing,
      emit: (ev, t, durSec) => this.play(ev, t, durSec),
    });
  }

  private channel(inst: InstrumentId): Channel {
    let ch = this.channels.get(inst);
    if (ch) return ch;
    const mix = MOODS[this.mood].mix[inst] ?? { gain: 0.3, send: 0.3 };
    const input = gainNode(this.ctx, mix.gain);
    let head: AudioNode = input;
    if (inst === 'pad') {
      // one tone filter for every pad note of the cue (instead of one per note)
      const lp = filterNode(this.ctx, 'lowpass', 1150, 0.6);
      input.connect(lp);
      head = lp;
    }
    if (inst === 'vibes') {
      // motor tremolo shared by all vibraphone notes
      const trem = gainNode(this.ctx, 0.8);
      input.connect(trem);
      this.extraSources.push(lfo({ ...this.sx, t: this.ctx.currentTime }, 'sine', 5.2, 0.2, trem.gain, this.ctx.currentTime, Infinity));
      head = trem;
    }
    if (mix.pan) {
      const p = stereo(this.ctx, mix.pan);
      head.connect(p);
      head = p;
    }
    head.connect(this.dry);
    if (mix.send > 0) {
      const send = gainNode(this.ctx, mix.send);
      head.connect(send).connect(this.wet);
    }
    ch = { input };
    this.channels.set(inst, ch);
    return ch;
  }

  private play(ev: NoteEvent, t: number, durSec: number): void {
    if (this.disposed || t > this.fadeEndAt) return;
    const human = UNPITCHED.has(ev.inst) ? this.rng.range(-0.002, 0.002) : this.rng.range(-0.004, 0.006);
    const start = Math.max(0, t + human);
    // conservative ring estimate: written length + typical release/decay tail
    if (!this.budget.take(start, start + durSec + (UNPITCHED.has(ev.inst) ? 0.3 : 1.2))) return;
    this.sx.t = start;
    this.sx.out = this.channel(ev.inst).input;
    playNote(this.sx, ev.inst, ev.midi, durSec, ev.vel, ev.glide, true);
    this.notes++;
  }

  /** Schedule notes due before now + lookahead (or an explicit horizon for offline renders). */
  pump(now: number, lookahead: number = LOOKAHEAD_SEC): void {
    if (this.disposed) return;
    this.seq.pump(now, lookahead);
  }

  fadeOut(now: number, dur: number): void {
    const d = Math.max(0.05, fin(dur, CROSSFADE_SEC));
    glideParam(this.ctx, this.dry.gain, 0, d / 4);
    glideParam(this.ctx, this.wet.gain, 0, d / 4);
    this.fadeEndAt = Math.min(this.fadeEndAt, now + d);
  }

  /** Fast fade (rapid mood flipping): silent within ~0.15 s, finished shortly after. */
  kill(now: number): void {
    glideParam(this.ctx, this.dry.gain, 0, 0.03);
    glideParam(this.ctx, this.wet.gain, 0, 0.03);
    this.fadeEndAt = Math.min(this.fadeEndAt, now);
    this.killAt = Math.min(this.killAt, now + 0.25);
  }

  /** True once faded and the longest tails (reverb, bells) have died away. */
  finished(now: number): boolean {
    return now > this.fadeEndAt + 3.5 || now > this.killAt;
  }

  get droppedNotes(): number {
    return this.budget.dropped;
  }

  get fading(): boolean {
    return Number.isFinite(this.fadeEndAt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.extraSources) stopSrc(s, 0);
    try {
      this.dry.disconnect();
      this.wet.disconnect();
    } catch {
      /* ignore */
    }
    this.channels.clear();
  }
}

/** Cues allowed to crossfade out at once; older ones are fast-faded (never hard-cut while audible). */
const MAX_FADING = 3;
const MAX_DYING = 4;

export class MusicPlayer {
  private current: MusicSection | null = null;
  private readonly fading: MusicSection[] = [];
  private readonly dying: MusicSection[] = [];
  private tempoScale = 1;
  private mood: MusicMood | 'none' = 'none';
  /** Notes dropped by the per-cue budget in cues that have since been disposed. */
  private droppedTotal = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dryDest: AudioNode,
    private readonly wetDest: AudioNode | null,
  ) {}

  get currentMood(): MusicMood | 'none' {
    return this.mood;
  }

  setTempoScale(s: number): void {
    this.tempoScale = Number.isFinite(s) && s > 0 ? Math.min(1.2, Math.max(0.8, s)) : 1;
  }

  setMood(mood: MusicMood | 'none', now: number): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (this.current) {
      this.current.fadeOut(now, CROSSFADE_SEC);
      this.fading.push(this.current);
      this.current = null;
    }
    if (mood !== 'none') {
      this.current = new MusicSection(this.ctx, this.dryDest, this.wetDest, mood, now + 0.03, CROSSFADE_SEC, () => this.tempoScale);
    }
    // bound the number of simultaneously decaying cues (rapid mood flipping): the oldest fast-fades out
    while (this.fading.length > MAX_FADING) {
      const old = this.fading.shift() as MusicSection;
      old.kill(now);
      this.dying.push(old);
    }
    while (this.dying.length > MAX_DYING) this.retire(this.dying.shift() as MusicSection);
  }

  pump(now: number): void {
    if (this.current) this.current.pump(now);
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      if (f.finished(now)) {
        this.retire(f);
        this.fading.splice(i, 1);
      } else {
        f.pump(now);
      }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (this.dying[i].finished(now)) {
        this.retire(this.dying[i]);
        this.dying.splice(i, 1);
      }
    }
  }

  /** Cues holding nodes: the current one, crossfading ones and fast-fading ones (bounded: ≤ 1 + 3 + 4). */
  get activeSections(): number {
    return (this.current ? 1 : 0) + this.fading.length + this.dying.length;
  }

  /** Notes skipped by the polyphony budget since this player was created (diagnostics). */
  get droppedNotes(): number {
    let n = this.droppedTotal + (this.current?.droppedNotes ?? 0);
    for (const f of this.fading) n += f.droppedNotes;
    for (const f of this.dying) n += f.droppedNotes;
    return n;
  }

  private retire(sec: MusicSection): void {
    this.droppedTotal += sec.droppedNotes;
    sec.dispose();
  }

  dispose(): void {
    this.current?.dispose();
    this.current = null;
    for (const f of this.fading) f.dispose();
    this.fading.length = 0;
    for (const f of this.dying) f.dispose();
    this.dying.length = 0;
    this.mood = 'none';
  }
}

/** Stand-alone fade helper for the engine's stinger ducking. */
export function duckFor(ctx: BaseAudioContext, p: AudioParam, depth: number, hold: number): void {
  const now = ctx.currentTime;
  glideParam(ctx, p, depth, 0.04);
  targetAt(p, 1, now + Math.max(0.1, hold), 0.35);
}

