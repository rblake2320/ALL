/**
 * The soak verdict (tests/e2e/lib/soakVerdict.mjs) decides whether a 30-minute real-browser run found a leak. These
 * tests feed it synthetic runs: a flat one must pass, each planted leak must be caught and named, and noise must not
 * fail a healthy run.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper shared with the e2e scripts (no type declarations)
import { BOUNDED, GROWTH, MIN_SAMPLES, judge, quarters } from '../../e2e/lib/soakVerdict.mjs';

type Sample = Record<string, number | string | boolean | null>;

/** A healthy 40-sample run: bounded counters flat with jitter, heap and world growing slowly with game time. */
function healthy(n = 40, patch: (s: Sample, i: number) => void = () => undefined): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const jitter = (i * 7919) % 5; // deterministic 0..4
    const s: Sample = {
      tick: 500 + i * 1440, // a quarter game day per sample
      ticksPerSec: 46 + (jitter - 2),
      heapBytes: 60 * 1048576 + i * 0.25 * 2 * 1048576 + jitter * 300_000, // 2 MB per game day
      worldBytes: 110_000 + i * 0.25 * 20_000, // 20 kB per game day
      domNodes: 1500 + jitter * 10,
      listeners: 400 + jitter,
      documents: 1,
      canvases: 2,
      geometries: 300 + jitter,
      textures: 60 + (jitter % 2),
      programs: 22,
      drawCalls: 120 + jitter * 3,
      toasts: jitter,
      notifications: 40,
      txLog: 50,
      queueMax: jitter % 3,
      faults: 0,
      fatal: null,
      screen: 'game',
      contextLost: false,
      lastSaveFailed: false,
    };
    patch(s, i);
    out.push(s);
  }
  return out;
}
type Run = { errors: string[]; saves: number; saveFailures: number; actions: Record<string, number> };
const run: Run = { errors: [], saves: 5, saveFailures: 0, actions: { goHere: 9, 'buy:stool': 4, sell: 4, room: 4, undo: 4, save: 5 } };
const failed = (v: ReturnType<typeof judge>) => [...v.rows.filter((r: { ok: boolean }) => !r.ok).map((r: { metric: string }) => r.metric), ...v.checks.filter((c: { ok: boolean }) => !c.ok).map((c: { name: string }) => c.name)];

describe('soak verdict', () => {
  it('a healthy run passes with every row and check green', () => {
    const v = judge(healthy(), run);
    expect(failed(v)).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.rows.map((r: { metric: string }) => r.metric).sort()).toEqual([...Object.keys(BOUNDED), ...Object.keys(GROWTH)].sort());
  });

  it('warm-up growth in the first quarter is ignored', () => {
    // Everything triples while assets load, then stays flat.
    const v = judge(healthy(40, (s, i) => { if (i < 10) for (const k of Object.keys(BOUNDED)) s[k] = Number(s[k]) / 3; }), run);
    expect(failed(v)).toEqual([]);
  });

  it.each(Object.keys(BOUNDED))('a steady leak in %s is caught and named', (metric) => {
    const lim = BOUNDED[metric as keyof typeof BOUNDED];
    // Linear climb: Q4 mean ends well past both limits relative to Q2.
    const v = judge(healthy(40, (s, i) => { s[metric] = Number(s[metric]) + i * (lim.abs / 6 + Number(s[metric]) * 0.05); }), run);
    expect(failed(v)).toEqual([metric]);
    expect(v.ok).toBe(false);
    expect(v.rows.find((r: { metric: string }) => r.metric === metric).note).toContain('still climbing');
  });

  it('a big ratio on a tiny number, or a big absolute step on a big number, is not a leak (both limits must be exceeded)', () => {
    // toasts 1 → 4: 4× but only +3. domNodes 20000 → 20600: +600 but 1.03×.
    const v = judge(healthy(40, (s, i) => { s.toasts = i < 20 ? 1 : 4; s.domNodes = i < 20 ? 20000 : 20600; }), run);
    expect(failed(v)).toEqual([]);
  });

  it('heap and save growth are judged per game day', () => {
    const leak = judge(healthy(40, (s, i) => { s.heapBytes = 60 * 1048576 + i * 0.25 * 40 * 1048576; }), run); // 40 MB/day
    expect(failed(leak)).toEqual(['heapBytes']);
    const save = judge(healthy(40, (s, i) => { s.worldBytes = 110_000 + i * 0.25 * 400_000; }), run); // 400 kB/day
    expect(failed(save)).toEqual(['worldBytes']);
    // The same heap bytes spread over 20× the game time is history, not a leak.
    const slow = judge(healthy(40, (s, i) => { s.heapBytes = 60 * 1048576 + i * 0.25 * 40 * 1048576; s.tick = 500 + i * 1440 * 20; }), run);
    expect(failed(slow)).toEqual([]);
  });

  it('growth while game time stands still fails (a paused game must not leak either)', () => {
    const v = judge(healthy(40, (s, i) => { s.tick = 500; s.heapBytes = 60 * 1048576 + i * 1048576; }), run);
    expect(failed(v)).toContain('heapBytes');
    expect(failed(v)).toContain('game time advanced between the compared quarters');
  });

  it('a sim that slows down, faults, fatals, context loss, errors and failed saves each fail on their own check', () => {
    const cases: Array<[string, Sample[] | null, Partial<Run>, RegExp]> = [
      ['slow', healthy(40, (s, i) => { if (i >= 30) s.ticksPerSec = 20; }), {}, /did not slow down/],
      ['fault', healthy(40, (s, i) => { if (i >= 35) s.faults = 2; }), {}, /no sim faults/],
      ['unreadable fault log', healthy(40, (s, i) => { if (i === 3) s.faults = -1; }), {}, /no sim faults/],
      ['fatal', healthy(40, (s, i) => { if (i === 39) { s.fatal = 'boom'; s.screen = 'menu'; } }), {}, /no fatal error/],
      ['fell to the menu', healthy(40, (s, i) => { if (i === 25) s.screen = 'menu'; }), {}, /no fatal error/],
      ['context', healthy(40, (s, i) => { if (i === 12) s.contextLost = true; }), {}, /context was never lost/],
      ['console', null, { errors: ['console.error: x'] }, /no page or console errors/],
      ['save failed', null, { saveFailures: 1 }, /every manual save succeeded/],
      ['never saved', null, { saves: 0 }, /every manual save succeeded/],
      ['save flag', healthy(40, (s, i) => { if (i === 20) s.lastSaveFailed = true; }), {}, /every manual save succeeded/],
      ['player idle', null, { actions: { goHere: 3, save: 2 } }, /exercised orders, buy, sell, build and undo/],
      ['player threw', null, { actions: { ...run.actions, 'ERR:TypeError': 1 } }, /no player action threw/],
    ];
    for (const [label, samples, over, re] of cases) {
      const v = judge(samples ?? healthy(), { ...run, ...over });
      expect(v.ok, label).toBe(false);
      expect(failed(v).filter((f) => re.test(f)).length, `${label}: ${failed(v).join(' | ')}`).toBe(1);
      expect(failed(v).length, `${label}: only its own check fails (${failed(v).join(' | ')})`).toBe(1);
    }
  });

  it('a household dying (game over) is the end of a world, not a failed soak', () => {
    const v = judge(healthy(40, (s, i) => { if (i === 25) s.screen = 'gameOver'; }), run);
    expect(failed(v)).toEqual([]);
  });

  it('too few samples, or garbage, is a failure and never a pass or a throw', () => {
    expect(judge(healthy(MIN_SAMPLES - 1), run).ok).toBe(false);
    expect(judge([], run).ok).toBe(false);
    expect(judge(null as never, run).ok).toBe(false);
    // NaN / missing / string fields count as 0 and cannot crash the verdict.
    const v = judge(healthy(40, (s, i) => { if (i % 3 === 0) { s.geometries = Number.NaN; delete s.textures; s.programs = 'x' as never; } }), run);
    expect(typeof v.ok).toBe('boolean');
  });

  it('quarters: the compared ranges never overlap the warm-up and never each other', () => {
    for (let n = MIN_SAMPLES; n < 60; n++) {
      const q = quarters(new Array(n).fill(0));
      expect(q.q2[0]).toBe(q.warmupCount);
      expect(q.q2[1]).toBeLessThan(q.q4[0]);
      expect(q.q4[1]).toBe(n - 1);
      expect(q.q2[1] - q.q2[0]).toBe(q.q4[1] - q.q4[0]);
      expect(q.q2[1] - q.q2[0]).toBeGreaterThanOrEqual(1);
    }
  });
});
