/**
 * W-117 Act 1 funnel on the REAL simulation: the scripted Act 1 player (tests/unit/quests/act1Driver.ts) drives a
 * derelict world through every beat; the session-log service is fed the drained events exactly as frame.ts feeds it.
 * The summary must list all 14 Act 1 steps, in order, each with a reached-at time, time in step and sim time, plus
 * the 8 beats and the 340 Bones they award.
 */
import { describe, expect, it } from 'vitest';
import type { Core } from '../../../src/game/core';
import type { SimulationAPI } from '../../../src/sim/contracts';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { ACT1_QUEST_IDS, ACT1_QUESTS } from '../../../src/sim/content/quests';
import { EventTrail } from '../../../src/feedback/trail';
import { SessionLogService } from '../../../src/game/sessionLog';
import { act1Commands } from '../quests/act1Driver';
import { newWorld, opts, simOf, systemsWithQuests } from '../quests/helpers';

function stubCore(now: () => number): Core {
  return {
    trail: new EventTrail(now),
    env: { now, wallNow: () => Date.parse('2026-11-06T12:00:00Z'), viewport: () => ({ width: 1280, height: 720 }), devicePixelRatio: () => 1, native: () => null, window: null, document: null },
    settings: { quality: 'auto' },
    screen: 'game',
    rendererReady: false,
    economy: { age: { bracket: 'adult' } },
    profile: { load: async (_k: string, f: unknown) => f, save: async () => {} },
    profileWriter: { write: async () => {} },
    notifier: { notifyNow() {} },
    report() {},
    guard: (_w: string, fn: () => void) => fn(),
  } as unknown as Core;
}

describe('Act 1 funnel from the real sim', () => {
  it('lists every Act 1 step in order with reached-at / time-in-step / sim time, and the Bones awarded', async () => {
    let now = 0;
    const svc = new SessionLogService(stubCore(() => now));
    await svc.init();
    const systems = systemsWithQuests();
    const sim = simOf(newWorld({ ...opts(41, 2), lotTemplate: 'derelict' }, systems), systems);
    svc.seedQuests(sim as unknown as SimulationAPI); // what world entry does (frame.ts → enterWorld)
    const mem: Record<string, unknown> = {};
    const end = sim.state.tick + TICKS_PER_DAY * 10;
    while (sim.state.tick < end) {
      if (sim.state.tick % 4 === 0) for (const c of act1Commands(sim, mem)) sim.dispatch(c);
      sim.step();
      now += 250; // speed 1: one game minute per real second = 4 ticks
      svc.simEvents(sim as unknown as SimulationAPI, sim.drainEvents());
      if (ACT1_QUEST_IDS.every((id) => (sim.state.quests?.completions[id] ?? 0) > 0)) break;
    }
    const log = (await svc.log())!;
    const expected = ACT1_QUESTS.flatMap((q) => q.steps.map((s) => `${q.id}.${s.id}`));
    expect(expected).toHaveLength(14);
    const act1 = log.funnel.filter((f) => f.arc === 'act1');
    expect(act1.map((f) => f.step)).toEqual(expected);
    for (let i = 0; i < act1.length; i++) {
      expect(act1[i].done, act1[i].step).not.toBeNull();
      expect(act1[i].done!).toBeGreaterThanOrEqual(act1[i].on);
      if (i > 0) expect(act1[i].on).toBeGreaterThanOrEqual(act1[i - 1].on);
    }
    expect(log.quests.filter((q) => q.arc === 'act1').map((q) => q.quest)).toEqual([...ACT1_QUEST_IDS]);
    expect(log.quests.filter((q) => q.arc === 'act1').reduce((s, q) => s + q.bones, 0)).toBe(340);

    const text = (await svc.summary())!;
    expect(text).toContain('ACT 1 FUNNEL (14/14 steps done)');
    expect(text).toContain('beats completed: 8/8 · Bones awarded 340');
    const lines = text.split('\n');
    const rows = expected.map((step) => lines.findIndex((l) => new RegExp(`^\\s+\\d+\\s+${step.replace('.', '\\.')}\\s`).test(l)));
    expect(rows.every((r) => r > 0)).toBe(true);
    expect([...rows].sort((a, b) => a - b)).toEqual(rows); // printed in order
    // each row: reached, time in step, done at, sim clock
    for (const r of rows) expect(lines[r]).toMatch(/\s\d+:\d{2}(:\d{2})?\s+\d+:\d{2}(:\d{2})?\s+\d+:\d{2}(:\d{2})?\s+D\d+ \d{2}:\d{2}$/);
  });
});
