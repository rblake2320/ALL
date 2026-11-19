/**
 * AC-10 — streaming bounds (W-025 S4, docs/DESIGN_WORLD_LEVELS.md §1.4, §1.15), real engine:
 *  - a member PACING back and forth across the 45 / 60-tile band (n1 ↔ the home, so the far lots' distance swings
 *    from 40 to 70) for 2 game hours changes any region's tier at most 4 times;
 *  - adversarial: a member JUMPING across the radius edge on every evaluation (distance 44 ↔ 61, every 4 ticks) for
 *    2 game hours: hysteresis + dwell hold the tiers (≤ 4 changes per region, where no hysteresis would flip 120×);
 *  - with the household together, live lot regions ≤ 6 at all times; simulated agents ≤ 32; members never stand in a
 *    dormant region (checked every tick).
 */
import { describe, expect, it } from 'vitest';
import { TICKS_PER_HOUR } from '../../../src/sim/types';
import { LIVE_LOT_BUDGET } from '../../../src/shared/world';
import { onLotSorted } from '../../../src/sim/engine/agents';
import { agentRegion, isRegionActive } from '../../../src/sim/engine/regions';
import { regionDefOf } from '../../../src/sim/engine/worldMove';
import { ENTER_RADIUS, LEAVE_RADIUS, MIN_DWELL_TICKS } from '../../../src/sim/engine/streaming';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { HOME, N1, goHere } from './s3Harness';
import { stepLogged, streamWorld, type TierChange } from './s4Harness';

function changesPerRegion(log: TierChange[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of log) for (const id of [...t.thawed, ...t.frozen]) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

function bounds(sim: EngineSimulation): void {
  const eng = sim.engine;
  const lots = sim.state.town!.stream.active.filter((id) => regionDefOf(eng, id)?.kind === 'lot');
  expect(lots.length).toBeLessThanOrEqual(LIVE_LOT_BUDGET);
  expect(onLotSorted(eng).length).toBeLessThanOrEqual(32);
  for (const id of sim.state.household.memberIds) expect(isRegionActive(eng, agentRegion(eng, sim.state.agents[id]))).toBe(true);
}

describe('AC-10 streaming hysteresis and bounds', () => {
  it('the rule constants: enter 45, leave 60, 30 game minutes of dwell', () => {
    expect([ENTER_RADIUS, LEAVE_RADIUS, MIN_DWELL_TICKS]).toEqual([45, 60, 120]);
  });

  it('pacing n1 ↔ home across the band for 2 game hours: ≤ 4 tier changes per region, bounds hold every tick', () => {
    const { sim, members } = streamWorld({ seed: 3, members: 1 });
    const [a] = members;
    for (let i = 0; i < 8; i++) sim.step(); // settle the tick-0 surroundings
    const log: TierChange[] = [];
    const end = sim.state.tick + 2 * TICKS_PER_HOUR;
    let leg = 0;
    while (sim.state.tick < end) {
      const ag = sim.state.agents[a];
      if (!ag.active && ag.queue.length === 0) expect(goHere(sim, a, leg++ % 2 === 0 ? { regionId: N1, x: 18, z: 28 } : { regionId: HOME, x: 22, z: 28 }).ok).toBe(true);
      stepLogged(sim, log);
      sim.drainEvents();
      bounds(sim);
    }
    expect(leg).toBeGreaterThanOrEqual(4); // it really paced (≥ 2 round trips across the band)
    const per = changesPerRegion(log);
    for (const [id, n] of per) expect({ id, n: Math.min(n, 4) }).toEqual({ id, n });
    expect(per.size).toBeGreaterThan(0); // the band was crossed: some far region did change
    expect(sim.faults()).toEqual([]);
    // eslint-disable-next-line no-console
    console.log(`[AC-10 pacing] ${leg} legs, changes per region: ${JSON.stringify(Object.fromEntries(per))}`);
  });

  it('adversarial: jumping across the radius edge every evaluation for 2 game hours never thrashes', () => {
    const { sim, eng, members } = streamWorld({ seed: 4, members: 1 });
    const [a] = members;
    for (let i = 0; i < 8; i++) sim.step();
    const log: TierChange[] = [];
    const end = sim.state.tick + 2 * TICKS_PER_HOUR;
    // street 4 (world x 130..160; streets are not lot-budget bound): home local x 16 (world 86) is 44 away, n1 local x 29
    // (world 69) is 61
    const edge = 'street:mildew:4';
    let flips = 0;
    while (sim.state.tick < end) {
      if (sim.state.tick % 4 === 0) {
        const ag = sim.state.agents[a];
        const near = flips++ % 2 === 0;
        if (near) delete ag.regionId;
        else ag.regionId = N1;
        ag.pos = { x: near ? 16.5 : 29.5, z: 28.5 };
        ag.prevPos = { ...ag.pos };
        ag.path = null;
      }
      stepLogged(sim, log);
      sim.drainEvents();
      bounds(sim);
    }
    const per = changesPerRegion(log);
    expect(flips).toBe(120);
    expect(per.get(edge) ?? 0).toBeGreaterThan(0); // the edge really was crossed
    for (const [id, n] of per) expect({ id, n: Math.min(n, 4) }).toEqual({ id, n });
    expect(isRegionActive(eng, HOME)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[AC-10 jumping] 120 edge jumps, changes per region: ${JSON.stringify(Object.fromEntries(per))}`);
  });
});
