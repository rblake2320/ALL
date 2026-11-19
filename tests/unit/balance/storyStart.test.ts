/**
 * W-113 story start economy (docs/systems/story-start.md §3): the derelict claim's starting funds pay for the day-1
 * essentials (fridge + stove or microwave + shower) but not for furnishing the starter cottage, and a household that
 * buys those essentials on day 1 survives its first 3 days on the REAL sim (shipped content, autonomy, bills, decay).
 */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation, LOT_TEMPLATES, loadContent } from '../../../src/sim/index';
import { createLotTemplate } from '../../../src/sim/spatial';
import { DEFAULT_STARTING_FUNDS } from '../../../src/sim/engine/world';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { buildCazCatalog } from '../../../src/game/gddCatalog';
import { randomHousehold } from '../../../src/game/randomZombie';
import { LOT_FUNDS } from '../../../src/ui/shell/data';
import { LAYOUT } from '../quests/act1Driver';

const content = loadContent();
const price = (id: string) => {
  const d = content.objects[id];
  if (!d) throw new Error(`no object ${id}`);
  return d.price;
};

const derelictFunds = LOT_TEMPLATES.find((t) => t.id === 'derelict')!.startingFunds;
/** The cheapest and the "proper kitchen" day-1 essentials. */
const ESSENTIALS_CHEAP = ['fridge_humming', 'microwave_nuke', 'shower_drizzle'];
const ESSENTIALS_STOVE = ['fridge_humming', 'stove_greasefire', 'shower_drizzle'];
const cost = (ids: string[]) => ids.reduce((s, id) => s + price(id), 0);

/** Catalog value of everything the furnished starter cottage comes with (doors/windows excluded). */
function starterFurnishingCost(): number {
  return createLotTemplate('starter')
    .objects.filter((o) => o.placement.kind !== 'opening')
    .reduce((s, o) => s + price(o.defId), 0);
}

describe('story start: starting funds', () => {
  it('the three places that state the derelict funds agree ($2,500)', () => {
    expect(derelictFunds).toBe(2500);
    expect(DEFAULT_STARTING_FUNDS.derelict).toBe(derelictFunds);
    expect(LOT_FUNDS.derelict).toBe(derelictFunds);
  });

  it('cover the day-1 essentials with room to spare, with either a stove or a microwave', () => {
    expect(cost(ESSENTIALS_CHEAP)).toBe(950);
    expect(cost(ESSENTIALS_STOVE)).toBe(1200);
    // after the essentials: still enough for ~a week of groceries + the first bill + the Act 1 builds (≈ $400)
    expect(derelictFunds - cost(ESSENTIALS_STOVE)).toBeGreaterThanOrEqual(1000);
  });

  it('are far below what furnishing the starter cottage costs (so the player must choose what to build)', () => {
    const furnish = starterFurnishingCost();
    expect(furnish).toBeGreaterThan(6000); // $6,920 today
    expect(derelictFunds).toBeLessThan(furnish);
    expect(derelictFunds).toBeLessThan(furnish / 2.5);
  });
});

function buyEssentials(sim: EngineSimulation, cooker: 'stove_greasefire' | 'microwave_nuke'): void {
  const spots: [string, readonly [number, number, number]][] = [
    ['fridge_humming', LAYOUT.fridge],
    [cooker, LAYOUT.stove],
    ['shower_drizzle', LAYOUT.shower],
  ];
  for (const [defId, [x, z, rot]] of spots) {
    const r = sim.build.apply({ type: 'buy', defId, x, z, rot: rot as 0 | 1 | 2 | 3 });
    expect(r.ok, `${defId}: ${r.reason}`).toBe(true);
  }
  sim.dispatch({ type: 'endBuildSession' });
}

function newDerelict(seed: number, members: number): EngineSimulation {
  const catalog = buildCazCatalog(content, LOT_TEMPLATES);
  const hh = randomHousehold(seed, catalog, members);
  const world = createNewWorld({ seed, householdName: hh.householdName, members: hh.members, lotTemplate: 'derelict', difficulty: 'normal' });
  return createSimulation(world) as EngineSimulation;
}

interface Outcome {
  funds: number;
  gameOver: boolean;
  crumbled: number;
  minPreservation: number;
  minHunger: number;
  faults: number;
  violations: string[];
}

function runDays(sim: EngineSimulation, days: number): Outcome {
  const end = sim.state.tick + days * TICKS_PER_DAY;
  let minP = 100;
  let minH = 100;
  const violations: string[] = [];
  while (sim.state.tick < end && !sim.state.gameOver) {
    sim.step();
    if (sim.state.tick % TICKS_PER_HOUR === 0) {
      sim.drainEvents();
      for (const id of sim.state.household.memberIds) {
        const a = sim.state.agents[id];
        if (!a || a.presence !== 'onLot') continue;
        minP = Math.min(minP, a.needs.preservation);
        minH = Math.min(minH, a.needs.hunger);
      }
      if (violations.length < 10) violations.push(...sim.checkInvariants());
    }
  }
  const crumbled = sim.state.household.memberIds.filter((id) => {
    const p = sim.state.agents[id]?.presence;
    return p === 'crumbled' || p === 'gone';
  }).length;
  return { funds: sim.state.household.funds, gameOver: sim.state.gameOver, crumbled, minPreservation: minP, minHunger: minH, faults: sim.faults().length, violations };
}

describe('story start: a household that buys the day-1 essentials survives the first 3 days', () => {
  const cases: { seed: number; members: number; cooker: 'stove_greasefire' | 'microwave_nuke' }[] = [
    { seed: 11, members: 1, cooker: 'stove_greasefire' },
    { seed: 22, members: 1, cooker: 'microwave_nuke' },
    { seed: 33, members: 2, cooker: 'stove_greasefire' },
    { seed: 44, members: 2, cooker: 'microwave_nuke' },
  ];
  for (const c of cases) {
    it(`seed ${c.seed}, ${c.members} zombie(s), ${c.cooker}`, () => {
      const sim = newDerelict(c.seed, c.members);
      expect(sim.state.household.funds).toBe(derelictFunds + 500 * (c.members - 1));
      buyEssentials(sim, c.cooker);
      const o = runDays(sim, 3);
      expect(o, JSON.stringify(o)).toMatchObject({ gameOver: false, crumbled: 0, faults: 0, violations: [] });
      expect(o.funds).toBeGreaterThan(0);
      // nobody was left at zero freshness or starving at any sampled hour
      expect(o.minPreservation).toBeGreaterThan(0);
      expect(o.minHunger).toBeGreaterThan(0);
    }, 120_000);
  }

  it('ADVERSARIAL control: without the essentials the same household is measurably worse off (the bare shack is not a home yet)', () => {
    const bare = runDays(newDerelict(11, 1), 3);
    const kitted = newDerelict(11, 1);
    buyEssentials(kitted, 'stove_greasefire');
    const ok = runDays(kitted, 3);
    expect(bare.faults).toBe(0);
    expect(bare.minHunger, JSON.stringify({ bare, ok })).toBeLessThan(ok.minHunger);
  }, 120_000);
});
