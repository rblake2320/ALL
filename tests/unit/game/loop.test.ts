import { describe, expect, it } from 'vitest';
import {
  FrameDriver,
  MAX_FRAME_SECONDS,
  MAX_TICKS_PER_FRAME,
  advanceAccumulator,
  minutesPerSecond,
  runTicks,
  sanitizeDt,
  ticksPerSecond,
} from '../../../src/game/loop';
import { SPEED_MINUTES_PER_SECOND, TICK_MINUTES, type Speed } from '../../../src/sim/types';
import { FakeEnv } from './fakes';

describe('ticksPerSecond / minutesPerSecond', () => {
  it('matches SPEED_MINUTES_PER_SECOND / TICK_MINUTES for every speed', () => {
    for (const s of [0, 1, 2, 3, 4] as Speed[]) {
      expect(ticksPerSecond(s)).toBe(SPEED_MINUTES_PER_SECOND[s] / TICK_MINUTES);
      expect(minutesPerSecond(s)).toBe(SPEED_MINUTES_PER_SECOND[s]);
    }
    expect(ticksPerSecond(1)).toBe(4);
    expect(ticksPerSecond(4)).toBe(120);
  });
  it('treats invalid speeds as paused', () => {
    expect(ticksPerSecond(7 as Speed)).toBe(0);
    expect(ticksPerSecond(-1 as Speed)).toBe(0);
    expect(ticksPerSecond(NaN as unknown as Speed)).toBe(0);
    expect(minutesPerSecond('3' as unknown as Speed)).toBe(0);
  });
});

describe('advanceAccumulator', () => {
  it('1× for one second = 4 ticks, no remainder', () => {
    const r = advanceAccumulator(0, 1, 1);
    expect(r).toEqual({ ticks: 4, dropped: 0, accumulator: 0, alpha: 0 });
  });

  it('accumulates fractional ticks across frames and alpha stays in [0,1)', () => {
    let acc = 0;
    let total = 0;
    for (let i = 0; i < 600; i++) {
      const r = advanceAccumulator(acc, 1 / 60, 1);
      acc = r.accumulator;
      total += r.ticks;
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThan(1);
      expect(r.alpha).toBe(r.accumulator);
    }
    // 10 seconds at 4 ticks/s = 40 ticks (floating error may defer at most one tick)
    expect(total).toBeGreaterThanOrEqual(39);
    expect(total).toBeLessThanOrEqual(40);
  });

  it('a speed change mid-stream keeps the fractional accumulator (units are ticks)', () => {
    const a = advanceAccumulator(0, 0.1, 1); // 0.4 ticks
    expect(a.ticks).toBe(0);
    expect(a.alpha).toBeCloseTo(0.4, 10);
    const b = advanceAccumulator(a.accumulator, 0.1, 3); // + 3.2 ticks
    expect(b.ticks).toBe(3);
    expect(b.alpha).toBeCloseTo(0.6, 10);
  });

  it('pausing freezes alpha where it was (no visual snap) and runs nothing', () => {
    const a = advanceAccumulator(0, 0.15, 2); // 1.8 ticks
    expect(a.ticks).toBe(1);
    const p = advanceAccumulator(a.accumulator, 5, 0);
    expect(p.ticks).toBe(0);
    expect(p.dropped).toBe(0);
    expect(p.alpha).toBeCloseTo(a.alpha, 12);
  });

  it(`caps at ${MAX_TICKS_PER_FRAME} ticks and DROPS the excess (never carried → no spiral)`, () => {
    const r = advanceAccumulator(0, MAX_FRAME_SECONDS, 4); // 120 ticks: under the cap
    expect(r.ticks).toBe(120);
    const custom = advanceAccumulator(0, 1, 4, 50);
    expect(custom.ticks).toBe(50);
    expect(custom.dropped).toBe(70);
    expect(custom.accumulator).toBeLessThan(1);
    // the next frame does not inherit the dropped backlog
    const next = advanceAccumulator(custom.accumulator, 1 / 60, 4, 50);
    expect(next.ticks).toBeLessThanOrEqual(3);
  });

  it('a huge stall (tab restored after minutes) is bounded by MAX_FRAME_SECONDS and the cap', () => {
    const r = advanceAccumulator(0, 600, 4);
    expect(r.ticks).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);
    expect(r.ticks).toBe(ticksPerSecond(4) * MAX_FRAME_SECONDS);
  });

  it('adversarial inputs never produce NaN, negative or runaway ticks', () => {
    const bad = [NaN, -1, -Infinity, Infinity, Number.MAX_VALUE, -0];
    for (const dt of bad) {
      for (const acc of [NaN, -5, Infinity, 0.5, 1e308]) {
        const r = advanceAccumulator(acc, dt, 4);
        expect(Number.isFinite(r.ticks)).toBe(true);
        expect(r.ticks).toBeGreaterThanOrEqual(0);
        expect(r.ticks).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);
        expect(r.alpha).toBeGreaterThanOrEqual(0);
        expect(r.alpha).toBeLessThan(1);
      }
    }
    expect(advanceAccumulator(0, 1, 1, NaN).ticks).toBe(0);
    expect(advanceAccumulator(0, 1, 1, -3).ticks).toBe(0);
  });

  it('sanitizeDt clamps', () => {
    expect(sanitizeDt(-1)).toBe(0);
    expect(sanitizeDt(NaN)).toBe(0);
    expect(sanitizeDt(0.016)).toBe(0.016);
    expect(sanitizeDt(99)).toBe(MAX_FRAME_SECONDS);
  });
});

describe('runTicks', () => {
  it('runs exactly n steps when under budget', () => {
    let n = 0;
    const r = runTicks(() => n++, 37, 1000, () => 0);
    expect(r).toEqual({ ran: 37, overBudget: false, errors: [] });
    expect(n).toBe(37);
  });

  it('stops early when the CPU budget is exhausted (but always runs at least the first tick)', () => {
    let t = 0;
    let n = 0;
    const r = runTicks(() => {
      n++;
      t += 10; // each tick "costs" 10 ms
    }, 400, 28, () => t);
    expect(r.overBudget).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThan(10);
  });

  it('is a fault barrier: a throwing step is caught, at most 3 errors kept, and it stops hammering', () => {
    let n = 0;
    const r = runTicks(() => {
      n++;
      throw new Error(`boom ${n}`);
    }, 400, 1000, () => 0);
    expect(r.errors.length).toBe(3);
    expect(n).toBe(3);
  });

  it('handles bogus counts', () => {
    expect(runTicks(() => undefined, NaN, 10, () => 0).ran).toBe(0);
    expect(runTicks(() => undefined, -4, 10, () => 0).ran).toBe(0);
    expect(runTicks(() => undefined, 2.9, 10, () => 0).ran).toBe(2);
  });
});

describe('FrameDriver', () => {
  it('drives the callback on animation frames with real dt', () => {
    const env = new FakeEnv();
    const seen: number[] = [];
    const d = new FrameDriver(env, (dt) => seen.push(Math.round(dt * 1000)));
    d.start();
    env.frame(16);
    env.frame(20);
    expect(seen).toEqual([16, 20]);
    d.stop();
    env.frame(16);
    expect(seen.length).toBe(2);
  });

  it('keeps simulating from a timer when frames stall (hidden tab), flagged as background', () => {
    const env = new FakeEnv();
    const bg: boolean[] = [];
    const d = new FrameDriver(env, (_dt, _now, info) => bg.push(info.background), { fallbackIntervalMs: 500, stallMs: 1000 });
    d.start();
    env.advance(3000); // no rAF callbacks delivered
    expect(bg.length).toBeGreaterThanOrEqual(2);
    expect(bg.every((b) => b)).toBe(true);
    d.stop();
  });

  it('survives a throwing callback (reported, loop continues) and runs without rAF support', () => {
    const env = new FakeEnv();
    env.rafEnabled = false;
    const errors: unknown[] = [];
    let calls = 0;
    const d = new FrameDriver(
      env,
      () => {
        calls++;
        throw new Error('frame failed');
      },
      { onError: (e) => errors.push(e), fallbackIntervalMs: 100, stallMs: 100 },
    );
    d.start();
    env.advance(1000);
    expect(calls).toBeGreaterThan(3);
    expect(errors.length).toBe(calls);
    d.stop();
    expect(d.running).toBe(false);
  });

  it('start() is idempotent (no double loops)', () => {
    const env = new FakeEnv();
    let calls = 0;
    const d = new FrameDriver(env, () => calls++);
    d.start();
    d.start();
    env.frame(16);
    expect(calls).toBe(1);
  });
});
