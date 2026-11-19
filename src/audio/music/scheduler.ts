/**
 * Lookahead scheduling math (pure: time is always passed in). The engine's 25 ms timer calls pump(now)
 * with AudioContext time; every event whose time falls before now + lookahead is emitted exactly once,
 * in order. Tempo is sampled per bar so speed changes land on bar lines. Late events are dropped rather
 * than bunched; a long stall skips whole bars instead of replaying them.
 */
import type { BarPlan, NoteEvent } from './types';

export const SCHEDULER_INTERVAL_MS = 25;
export const LOOKAHEAD_SEC = 0.2;
export const LATE_TOLERANCE_SEC = 0.04;

/** Map a beat position through swing: the off-beat 8th moves from 0.5 to `ratio` inside each beat. */
export function swingBeat(beat: number, ratio: number): number {
  const r = Number.isFinite(ratio) ? Math.min(0.75, Math.max(0.5, ratio)) : 0.5;
  if (r === 0.5 || !Number.isFinite(beat)) return beat;
  const whole = Math.floor(beat);
  const u = beat - whole;
  const mapped = u < 0.5 ? u * (r / 0.5) : r + (u - 0.5) * ((1 - r) / 0.5);
  return whole + mapped;
}

export function secondsPerBeat(bpm: number, tempoScale: number): number {
  const b = Number.isFinite(bpm) && bpm > 0 ? bpm : 100;
  const s = Number.isFinite(tempoScale) && tempoScale > 0 ? Math.min(2, Math.max(0.5, tempoScale)) : 1;
  return 60 / (b * s);
}

export interface SequencerOptions {
  startTime: number;
  bar(index: number): BarPlan;
  /** Seconds per beat, sampled at each bar start. */
  spb(): number;
  swing: number;
  emit(ev: NoteEvent, time: number, durSec: number, spb: number, barIndex: number): void;
  lookahead?: number;
  lateTolerance?: number;
}

export class LookaheadSequencer {
  barIndex = 0;
  barStart: number;
  private eventIndex = 0;
  private current: BarPlan | null = null;
  private barSpb = 0.5;
  private readonly lookahead: number;
  private readonly late: number;
  dropped = 0;
  emitted = 0;

  constructor(private readonly o: SequencerOptions) {
    this.barStart = Number.isFinite(o.startTime) ? o.startTime : 0;
    this.lookahead = o.lookahead ?? LOOKAHEAD_SEC;
    this.late = o.lateTolerance ?? LATE_TOLERANCE_SEC;
  }

  /** Time the current bar ends (after the next pump has loaded it). */
  get barEnd(): number {
    return this.barStart + (this.current ? this.current.beats : 4) * this.barSpb;
  }

  /** Emit all events due before now + lookahead. Returns the number emitted by this call. */
  pump(now: number, lookahead: number = this.lookahead): number {
    if (!Number.isFinite(now)) return 0;
    const horizon = now + Math.max(0, lookahead);
    let n = 0;
    for (let guard = 0; guard < 256; guard++) {
      if (this.current === null) this.loadBar();
      const bar = this.current as BarPlan;
      const spb = this.barSpb;
      const evs = bar.events;
      while (this.eventIndex < evs.length) {
        const ev = evs[this.eventIndex];
        const t = this.barStart + swingBeat(ev.beat, this.o.swing) * spb;
        if (t >= horizon) return n;
        this.eventIndex++;
        if (t < now - this.late) {
          this.dropped++;
          continue;
        }
        try {
          this.o.emit(ev, t, ev.dur * spb, spb, this.barIndex);
        } catch {
          /* one bad note never stalls the sequence */
        }
        this.emitted++;
        n++;
      }
      const barLen = bar.beats * spb;
      const end = this.barStart + barLen;
      if (end >= horizon) return n;
      // advance; skip whole bars if we stalled for a long time
      this.barIndex++;
      this.barStart = end;
      if (barLen > 0 && end + barLen < now) {
        const skip = Math.floor((now - end) / barLen);
        this.barIndex += skip;
        this.barStart += skip * barLen;
      }
      this.current = null;
    }
    return n;
  }

  private loadBar(): void {
    let plan: BarPlan;
    try {
      plan = this.o.bar(this.barIndex);
    } catch {
      plan = { index: this.barIndex, beats: 4, section: '?', chords: [], events: [] };
    }
    if (!plan || !(plan.beats > 0)) plan = { index: this.barIndex, beats: 4, section: '?', chords: [], events: [] };
    this.current = plan;
    this.eventIndex = 0;
    const spb = this.o.spb();
    this.barSpb = Number.isFinite(spb) && spb > 0.05 ? Math.min(4, spb) : 0.5;
  }
}
