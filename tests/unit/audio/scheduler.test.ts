import { describe, expect, it } from 'vitest';
import { LookaheadSequencer, swingBeat, secondsPerBeat, LOOKAHEAD_SEC, SCHEDULER_INTERVAL_MS } from '../../../src/audio/music/scheduler';
import type { BarPlan, NoteEvent } from '../../../src/audio/music/types';

function bar(index: number, beats = 4, onsets = [0, 1, 2, 3]): BarPlan {
  return {
    index,
    beats,
    section: 'T',
    chords: [],
    events: onsets.map((b) => ({ beat: b, dur: 0.5, midi: 60, vel: 0.8, inst: 'celesta' }) as NoteEvent),
  };
}

function makeSeq(startTime: number, spb = 0.5, swing = 0.5, onsets?: number[]) {
  const got: { t: number; bar: number; beat: number; at: number }[] = [];
  let now = 0;
  const seq = new LookaheadSequencer({
    startTime,
    bar: (i) => bar(i, 4, onsets),
    spb: () => spb,
    swing,
    emit: (ev, t, _d, _spb, b) => got.push({ t, bar: b, beat: ev.beat, at: now }),
  });
  return { seq, got, setNow: (n: number) => { now = n; } };
}

describe('swing math', () => {
  it('straight swing is identity; triplet swing moves the off-beat', () => {
    expect(swingBeat(1.5, 0.5)).toBe(1.5);
    expect(swingBeat(1.5, 2 / 3)).toBeCloseTo(1 + 2 / 3);
    expect(swingBeat(2, 0.66)).toBe(2);
    expect(swingBeat(0.25, 0.66)).toBeCloseTo(0.33);
    expect(swingBeat(0.75, 0.66)).toBeCloseTo(0.83);
    // monotonic and within the beat
    let prev = -1;
    for (let b = 0; b < 4; b += 0.125) {
      const s = swingBeat(b, 0.64);
      expect(s).toBeGreaterThan(prev);
      expect(Math.floor(s)).toBe(Math.floor(b));
      prev = s;
    }
    expect(swingBeat(1.5, NaN)).toBe(1.5);
    expect(swingBeat(1.5, 5)).toBeCloseTo(1.75); // clamped to 0.75
    expect(Number.isNaN(swingBeat(NaN, 0.6))).toBe(true);
  });

  it('secondsPerBeat clamps bad tempo input', () => {
    expect(secondsPerBeat(120, 1)).toBeCloseTo(0.5);
    expect(secondsPerBeat(120, 2)).toBeCloseTo(0.25);
    expect(secondsPerBeat(NaN, 1)).toBeCloseTo(0.6);
    expect(secondsPerBeat(120, -3)).toBeCloseTo(0.5);
    expect(secondsPerBeat(120, 100)).toBeCloseTo(0.25);
  });
});

describe('LookaheadSequencer', () => {
  it('emits only events inside now + lookahead, each exactly once', () => {
    const { seq, got } = makeSeq(1.0);
    seq.pump(0.0, 0.2);
    expect(got).toEqual([]);
    seq.pump(0.85, 0.2);
    expect(got.map((g) => g.t)).toEqual([1.0]);
    seq.pump(0.85, 0.2);
    expect(got.length).toBe(1);
    seq.pump(1.35, 0.2);
    expect(got.map((g) => g.t)).toEqual([1.0, 1.5]);
    seq.pump(1.85, 0.2);
    seq.pump(2.35, 0.2);
    seq.pump(2.85, 0.2);
    // 2.0, 2.5, 3.0 (bar 1 starts at 3.0)
    expect(got.map((g) => g.t)).toEqual([1.0, 1.5, 2.0, 2.5, 3.0]);
    expect(got[4].bar).toBe(1);
    // jumping ahead: events that are already in the past are dropped, not bunched
    seq.pump(4.52, 0.2);
    expect(got.map((g) => g.t)).toEqual([1.0, 1.5, 2.0, 2.5, 3.0, 4.5]);
  });

  it('every event is scheduled at least ~100ms ahead with a jittery 25ms timer', () => {
    const { seq, got, setNow } = makeSeq(0.3, 0.25, 0.5, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    let now = 0;
    let k = 0;
    while (now < 20) {
      setNow(now);
      seq.pump(now, LOOKAHEAD_SEC);
      now += (SCHEDULER_INTERVAL_MS + ((k++ * 37) % 23) - 11) / 1000;
    }
    expect(got.length).toBeGreaterThan(100);
    for (const g of got) expect(g.t - g.at).toBeGreaterThanOrEqual(0.1 - 1e-9);
    for (let i = 1; i < got.length; i++) expect(got[i].t).toBeGreaterThan(got[i - 1].t);
    expect(seq.dropped).toBe(0);
  });

  it('bar timing accumulates without drift', () => {
    const { seq, got } = makeSeq(0, 60 / 96);
    for (let t = 0; t < 400; t += 0.025) seq.pump(t, 0.2);
    const downbeats = got.filter((g) => g.beat === 0);
    for (const d of downbeats) expect(d.t).toBeCloseTo(d.bar * 4 * (60 / 96), 6);
  });

  it('drops late events instead of bunching them, and skips stalled bars', () => {
    const { seq, got } = makeSeq(0, 0.5);
    seq.pump(0, 0.2);
    expect(got.length).toBe(1);
    // main thread stalled for 1.3 s
    seq.pump(1.31, 0.2);
    expect(got.map((g) => g.t)).toEqual([0, 1.5]);
    expect(seq.dropped).toBe(2); // 0.5 and 1.0 were too late
    // background tab: 60 s with no ticks -> skip bars, do not replay a minute of notes
    const before = got.length;
    seq.pump(61, 0.2);
    expect(got.length - before).toBeLessThanOrEqual(2);
    expect(seq.barIndex).toBeGreaterThanOrEqual(29);
  });

  it('samples tempo at bar boundaries only', () => {
    let spb = 0.5;
    const got: number[] = [];
    const seq = new LookaheadSequencer({ startTime: 0, bar: (i) => bar(i), spb: () => spb, swing: 0.5, emit: (_e, t) => got.push(t) });
    const run = (from: number, to: number) => { for (let t = from; t <= to + 1e-9; t += 0.025) seq.pump(t, 0.2); };
    run(0, 0.4); // bar 0 loaded at 0.5 spb: events 0, 0.5
    expect(got).toEqual([0, 0.5]);
    spb = 0.25; // change mid-bar
    run(0.425, 1.75); // rest of bar 0 still at 0.5 spb; bar 1 starts at 2.0
    expect(got).toEqual([0, 0.5, 1.0, 1.5]);
    run(1.775, 2.6);
    expect(got.slice(4)).toEqual([2.0, 2.25, 2.5, 2.75]);
  });

  it('survives throwing generators/emitters and junk times', () => {
    let calls = 0;
    const seq = new LookaheadSequencer({
      startTime: NaN,
      bar: (i) => { if (i === 1) throw new Error('compose fail'); return bar(i); },
      spb: () => NaN,
      swing: NaN,
      emit: () => { calls++; if (calls === 2) throw new Error('emit fail'); },
    });
    expect(() => seq.pump(NaN)).not.toThrow();
    for (let t = 0; t < 10; t += 0.025) expect(() => seq.pump(t)).not.toThrow();
    // bar 1 failed to compose (empty bar) but bars 0 and 2+ played; the throwing emit did not stop the sequence
    expect(calls).toBeGreaterThan(8);
    expect(seq.barIndex).toBeGreaterThanOrEqual(4);
  });
});
