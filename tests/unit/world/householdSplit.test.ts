/**
 * AC-13 — household split at runtime (W-025 S4, docs/DESIGN_WORLD_LEVELS.md §1.4, §1.15), real engine, 8 members:
 *  - 8 members in 8 different lots (none at home): every member's region is live and simulated (needs move, commands
 *    run), live lots = 9 = LIVE_LOT_WORST_CASE (home + 8) and never more, surroundings drop to 0 lots;
 *  - each member is selected (menu) and commanded in turn: nothing is refused for being "out of range";
 *  - the worst case stays in the sim budget: ms / tick measured over 1,000 ticks (≤ 3.5 ms in Node CI, AC-13);
 *  - regrouping at home brings the surroundings back (≤ 6 lots, neighbours live again).
 */
import { describe, expect, it } from 'vitest';
import { LIVE_LOT_BUDGET, LIVE_LOT_WORST_CASE } from '../../../src/shared/world';
import { onLotSorted } from '../../../src/sim/engine/agents';
import { agentRegion, isRegionActive } from '../../../src/sim/engine/regions';
import { regionDefOf } from '../../../src/sim/engine/worldMove';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { GRAVEYARD, HOME, N1, N3, goHere } from './s3Harness';
import { streamWorld } from './s4Harness';

const SPLIT = [N1, N3, 'wormwood:mildew_n4', 'wormwood:mildew_s1', 'wormwood:mildew_s2', 'wormwood:mildew_s3', 'wormwood:mildew_s4', GRAVEYARD];

function liveLots(sim: EngineSimulation): string[] {
  return sim.state.town!.stream.active.filter((id) => regionDefOf(sim.engine, id)?.kind === 'lot');
}

function place(sim: EngineSimulation, id: string, region: string, x: number, z: number): void {
  const a = sim.state.agents[id];
  if (region === HOME) delete a.regionId;
  else a.regionId = region;
  a.pos = { x: x + 0.5, z: z + 0.5 };
  a.prevPos = { ...a.pos };
  a.path = null;
  a.active = null;
  a.queue = [];
}

describe('AC-13 household split (runtime)', () => {
  it('8 members in 8 lots: 9 live lots, everyone simulated and commandable; within the tick budget; regrouping recovers', () => {
    const { sim, eng, members } = streamWorld({ seed: 5, members: 8, autonomy: 'full' });
    expect(members.length).toBe(8);
    for (let i = 0; i < 8; i++) sim.step();
    expect(liveLots(sim).length).toBeLessThanOrEqual(LIVE_LOT_BUDGET);
    // split: each member to its own lot (the front yard, a walkable tile of every stand-in template)
    members.forEach((m, i) => place(sim, m, SPLIT[i], 5, 25));
    // members' regions are required: at the next evaluation (≤ 4 ticks) all 8 are live
    for (let i = 0; i < 4; i++) sim.step();
    for (const m of members) expect(isRegionActive(eng, agentRegion(eng, sim.state.agents[m]))).toBe(true);
    expect(liveLots(sim).sort()).toEqual([HOME, ...SPLIT].sort());
    expect(liveLots(sim).length).toBe(LIVE_LOT_WORST_CASE);
    // selected + commanded in turn: never refused for being far away
    members.forEach((m, i) => {
      expect(sim.menu(m, { kind: 'agent', id: m }).length).toBeGreaterThan(0);
      const r = goHere(sim, m, { regionId: SPLIT[i], x: 8 + i, z: 26 });
      expect({ m, ok: r.ok, reason: r.reason }).toEqual({ m, ok: true, reason: undefined });
    });
    const needs0 = members.map((m) => sim.state.agents[m].needs.hunger);
    // the worst case under load (autonomy on): measure
    for (let i = 0; i < 200; i++) sim.step(); // warm-up (fields, caches)
    const times: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      sim.step();
      times.push(performance.now() - t0);
      if (i % 50 === 0) {
        expect(liveLots(sim).length).toBeLessThanOrEqual(LIVE_LOT_WORST_CASE);
        expect(onLotSorted(eng).length).toBeLessThanOrEqual(32);
        for (const m of members) expect(isRegionActive(eng, agentRegion(eng, sim.state.agents[m]))).toBe(true);
      }
    }
    sim.drainEvents();
    times.sort((a, b) => a - b);
    const mean = times.reduce((n, t) => n + t, 0) / times.length;
    const p95 = times[Math.floor(times.length * 0.95)];
    const median = times[Math.floor(times.length / 2)];
    // eslint-disable-next-line no-console
    console.log(`[AC-13] 8 members in 8 lots + home: ${liveLots(sim).length} live lots, ${sim.state.town!.stream.active.length} live regions, ${onLotSorted(eng).length} agents; ms/tick median ${median.toFixed(3)} mean ${mean.toFixed(3)} p95 ${p95.toFixed(3)} max ${times[times.length - 1].toFixed(3)}`);
    // the budget is judged on the median (a shared CI box's scheduling spikes land in the mean / max, printed above)
    expect(median).toBeLessThanOrEqual(3.5);
    // everyone was simulated where they stand (needs moved; nobody stuck at the split tick's values)
    members.forEach((m, i) => expect(sim.state.agents[m].needs.hunger).not.toBe(needs0[i]));
    // regroup at home: the surroundings come back, within the together budget
    members.forEach((m, i) => place(sim, m, HOME, 10 + (i % 4), 22 + Math.floor(i / 4)));
    for (let i = 0; i < 4 * 200; i++) sim.step(); // > dwell: far member lots may leave
    expect(liveLots(sim).length).toBeLessThanOrEqual(LIVE_LOT_BUDGET);
    expect(liveLots(sim)).toContain(N1);
    expect(liveLots(sim)).toContain(N3);
    expect(liveLots(sim)).not.toContain(GRAVEYARD);
    expect(sim.faults()).toEqual([]);
  });
});
