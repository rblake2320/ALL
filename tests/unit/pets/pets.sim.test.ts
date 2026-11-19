/**
 * W-013 (D-008) strays to pets on a REAL simulation (allSystems, starter lot, real save validator + SaveManager):
 * scheduled strays, Chase never catches, Offer Scraps costs food, trust → adopt at 70, pet needs decay, neglect makes a
 * pet run away and come back as a stray (never dies), determinism, save/reload keeps the pet.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/sim/contracts';
import type { PetsState, WorldState } from '../../../src/sim/types';
import { PET_SPECIES, TICK_MINUTES } from '../../../src/sim/types';
import { allSystems } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine';
import { validateWorld } from '../../../src/persistence/validation';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { makeMeta, silentLogger } from '../persistence/fixtures';
import { jsonClone, newWorld, opts, simOf } from '../quests/helpers';
import { CALM_MIN, CHASE_COOL_MIN, CHASE_TRUST_LOSS, NEGLECT_RUN_MIN, PET_ADOPT_TRUST, RETURN_MIN, RETURN_TRUST, SNACK_COST, scheduledArrival } from '../../../src/sim/systems/pets';
import { DATA } from '../../../src/sim/content/home/ids';
import { LEFTOVER_SPOIL_MIN, readLeftovers } from '../../../src/sim/systems/home/food/leftovers';

function world(seed = 77): EngineSimulation {
  const sys = allSystems();
  return simOf(newWorld(opts(seed, 2), sys), sys);
}
const pets = (sim: EngineSimulation): PetsState => sim.state.pets!;
const stepMin = (sim: EngineSimulation, min: number) => {
  for (let i = 0, n = Math.round(min / TICK_MINUTES); i < n; i++) sim.step();
};
/** The zombies cook on their own: clear every fridge so only the snack can pay. */
const emptyFridges = (sim: EngineSimulation) => {
  for (const o of Object.values(sim.state.objects)) if (typeof o.data?.leftovers === 'string') o.data.leftovers = '[]';
};
/** The zombie stands next to the animal first (an action only happens when the zombie is close); `far` skips that. */
const cmd = (sim: EngineSimulation, c: Record<string, unknown>, far = false) => {
  const ps = sim.state.pets!;
  const a = [...ps.strays, ...ps.pets].find((x) => x.id === (c.strayId ?? c.petId));
  const ag = sim.state.agents[c.agentId as string];
  if (a && ag && !far) ag.pos = { x: a.pos.x, z: a.pos.z };
  return sim.dispatch({ type: 'pet', ...c } as Command);
};

/** Earn trust with Offer Scraps / Befriend / Pet, waiting out the calm time between them, then adopt. */
function befriendAndAdopt(sim: EngineSimulation, strayId: string): string {
  const agentId = sim.state.household.memberIds[0];
  const actions = ['offerScraps', 'befriend', 'pet'];
  for (let i = 0; pets(sim).strays.find((s) => s.id === strayId)!.trust < PET_ADOPT_TRUST; i++) {
    expect(i).toBeLessThan(20);
    const r = cmd(sim, { action: actions[i % 3], agentId, strayId });
    expect(r.ok).toBe(true);
    stepMin(sim, CALM_MIN);
  }
  expect(cmd(sim, { action: 'adopt', agentId, strayId }).ok).toBe(true);
  return strayId.replace(/^s/, 'p');
}

describe('strays', () => {
  it('a new game has a stray on the street and one in the graveyard, from the fixed schedule', () => {
    const sim = world();
    const s = pets(sim).strays;
    expect(s.map((x) => [x.species, x.place])).toEqual([
      [scheduledArrival(0).species, 'street'],
      [scheduledArrival(1).species, 'graveyard'],
    ]);
    expect(new Set(PET_SPECIES)).toEqual(new Set([0, 1, 2, 3].map((d) => scheduledArrival(d).species)));
    for (const x of s) expect(x.trust).toBe(0);
  });

  it('more strays arrive at the start of each new day', () => {
    const sim = world();
    const before = pets(sim).strays.length;
    stepMin(sim, 24 * 60 + 5);
    expect(pets(sim).strays.length).toBe(before + 1);
  });

  it('Chase never catches: a stray that trusts you stays, loses exactly 10 trust, and bolts; nothing is adopted or hurt', () => {
    const sim = world();
    const agentId = sim.state.household.memberIds[0];
    const stray = pets(sim).strays[0];
    stray.trust = 60;
    expect(cmd(sim, { action: 'chase', agentId, strayId: stray.id }).ok).toBe(true);
    const after = pets(sim).strays.find((x) => x.id === stray.id)!;
    expect(after).toBeDefined();
    expect(after.trust).toBe(60 - CHASE_TRUST_LOSS);
    expect(after.anim).toBe('flee');
    expect(pets(sim).pets).toEqual([]);
  });

  it('Chase has a cool-down: the same stray cannot be chased again for free fun, until the cool-down is over', () => {
    const sim = world();
    const agentId = sim.state.household.memberIds[0];
    const stray = pets(sim).strays[0];
    stray.trust = 80;
    expect(cmd(sim, { action: 'chase', agentId, strayId: stray.id }).ok).toBe(true);
    for (let i = 0; i < 10; i++) {
      expect(cmd(sim, { action: 'chase', agentId, strayId: stray.id }).ok).toBe(false);
      sim.step();
    }
    expect(stray.trust).toBe(80 - CHASE_TRUST_LOSS);
    stepMin(sim, CHASE_COOL_MIN);
    expect(cmd(sim, { action: 'chase', agentId, strayId: stray.id }).ok).toBe(true);
    expect(stray.trust).toBe(80 - 2 * CHASE_TRUST_LOSS);
  });

  it('animals never get spoiled food: a fridge holding only spoiled leftovers is skipped and the snack pays', () => {
    const sim = world();
    const agentId = sim.state.household.memberIds[0];
    const strayId = pets(sim).strays[0].id;
    emptyFridges(sim);
    const fridge = Object.values(sim.state.objects).find((o) => o.defId === 'fridge_humming')!;
    fridge.data ??= {};
    fridge.data[DATA.leftovers] = JSON.stringify([{ s: 2, q: 3, r: 'brainLoaf', a: LEFTOVER_SPOIL_MIN + 30 }]);
    fridge.data[DATA.spoiledServings] = 2;
    const funds = sim.state.household.funds;
    expect(cmd(sim, { action: 'offerScraps', agentId, strayId }).ok).toBe(true);
    expect(sim.state.household.funds).toBe(funds - SNACK_COST);
    expect(readLeftovers(fridge).reduce((n, l) => n + l.s, 0)).toBe(2);
  });

  it('Offer Scraps costs a snack when the fridges are empty, and is refused when it cannot be paid', () => {
    const sim = world();
    const agentId = sim.state.household.memberIds[0];
    const strayId = pets(sim).strays[0].id;
    emptyFridges(sim);
    const funds = sim.state.household.funds;
    expect(cmd(sim, { action: 'offerScraps', agentId, strayId }).ok).toBe(true);
    expect(sim.state.household.funds).toBe(funds - SNACK_COST);
    stepMin(sim, CALM_MIN);
    emptyFridges(sim);
    sim.state.household.funds = 0;
    expect(cmd(sim, { action: 'offerScraps', agentId, strayId }).ok).toBe(false);
  });

  it('adopting below trust 70 is refused; strangers cannot interact', () => {
    const sim = world();
    const strayId = pets(sim).strays[0].id;
    expect(cmd(sim, { action: 'adopt', agentId: sim.state.household.memberIds[0], strayId }).ok).toBe(false);
    expect(cmd(sim, { action: 'befriend', agentId: 'a999', strayId }).ok).toBe(false);
  });
});

describe('old saves', () => {
  it('a save written before pets existed starts with a stray on the street and one in the graveyard, each with a position', () => {
    const sim = world(21);
    const w = jsonClone(sim.serialize()) as WorldState & { pets?: unknown };
    delete w.pets;
    const again = simOf(w as WorldState, allSystems());
    const strays = pets(again).strays;
    expect(strays.length).toBe(2);
    expect(strays.map((x) => x.place).sort()).toEqual(['graveyard', 'street']);
    for (const x of strays) {
      expect(Number.isFinite(x.pos.x) && Number.isFinite(x.pos.z)).toBe(true);
      expect(x.pos.x).toBeGreaterThanOrEqual(0);
      expect(x.pos.x).toBeLessThanOrEqual(again.state.lot.width);
    }
  });

  it('a pets block whose animals have no usable position gets them placed on load', () => {
    const sim = world(22);
    const petId = befriendAndAdopt(sim, pets(sim).strays[0].id);
    const w = jsonClone(sim.serialize()) as WorldState;
    for (const x of [...w.pets!.strays, ...w.pets!.pets]) (x as unknown as { pos: unknown }).pos = null;
    const again = simOf(w, allSystems());
    for (const x of [...pets(again).strays, ...pets(again).pets]) expect(Number.isFinite(x.pos.x) && Number.isFinite(x.pos.z)).toBe(true);
    expect(pets(again).pets.map((p) => p.id)).toEqual([petId]);
  });
});

describe('adopt path end to end', () => {
  it('trust rises to 70 → free adoption → a household pet whose needs decay and whose care works', () => {
    const sim = world();
    const stray = pets(sim).strays[0];
    const petId = befriendAndAdopt(sim, stray.id);
    const funds = sim.state.household.funds;
    const pet = pets(sim).pets.find((p) => p.id === petId)!;
    expect(pet).toBeDefined();
    expect(pet.species).toBe(stray.species);
    expect(pets(sim).strays.some((s) => s.id === stray.id)).toBe(false);
    expect(sim.state.household.funds).toBe(funds); // adoption is free
    const n0 = { ...pet.needs };
    stepMin(sim, 4 * 60);
    for (const k of ['appetite', 'fun', 'hygiene', 'affection'] as const) expect(pet.needs[k]).toBeLessThan(n0[k]);
    const agentId = sim.state.household.memberIds[1];
    const a = pet.needs.appetite;
    expect(cmd(sim, { action: 'feed', agentId, petId }).ok).toBe(true);
    expect(pet.needs.appetite).toBeGreaterThan(a);
    const f = pet.needs.fun;
    expect(cmd(sim, { action: 'play', agentId, petId }).ok).toBe(true);
    expect(pet.needs.fun).toBeGreaterThan(f);
    const af = pet.needs.affection;
    expect(cmd(sim, { action: 'cuddle', agentId, petId }).ok).toBe(true);
    expect(pet.needs.affection).toBeGreaterThan(af);
  });
});

describe('neglect', () => {
  it('a neglected pet runs away (never dies) and comes back later as a stray', () => {
    const sim = world();
    const petId = befriendAndAdopt(sim, pets(sim).strays[0].id);
    const pet = pets(sim).pets.find((p) => p.id === petId)!;
    for (const k of ['appetite', 'fun', 'hygiene', 'affection'] as const) pet.needs[k] = 0;
    stepMin(sim, NEGLECT_RUN_MIN - 30);
    expect(pets(sim).pets.some((p) => p.id === petId)).toBe(true);
    stepMin(sim, 60);
    expect(pets(sim).pets.some((p) => p.id === petId)).toBe(false);
    const away = pets(sim).away.find((p) => p.id === petId)!;
    expect(away).toBeDefined();
    expect(sim.state.notifications.some((n) => /ran away/.test(n.title))).toBe(true);
    expect(sim.state.notifications.some((n) => /died|dead/i.test(`${n.title} ${n.text}`))).toBe(false);
    stepMin(sim, RETURN_MIN + 5);
    expect(pets(sim).away.some((p) => p.id === petId)).toBe(false);
    const back = pets(sim).strays.find((s) => s.name === away.name && s.species === away.species && s.trust === RETURN_TRUST);
    expect(back).toBeDefined();
  }, 120_000);
});

describe('determinism and saves', () => {
  it('same seed, same script → identical worlds', () => {
    const run = () => {
      const sim = world(5);
      befriendAndAdopt(sim, pets(sim).strays[1].id);
      stepMin(sim, 120);
      return JSON.stringify(sim.serialize());
    };
    expect(run()).toBe(run());
  });

  it('save and reload keeps the pet (validator + SaveManager round trip), and the reloaded world continues identically', async () => {
    const sim = world();
    const petId = befriendAndAdopt(sim, pets(sim).strays[0].id);
    const w = jsonClone(sim.serialize()) as WorldState;
    const v = validateWorld(jsonClone(w));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.world.pets).toEqual(w.pets);
    const sm = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silentLogger, repair: null });
    expect((await sm.save('pets', 'Pets', w, makeMeta())).ok).toBe(true);
    const loaded = await sm.load('pets');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const sys = allSystems();
    const again = simOf(loaded.world as WorldState, sys);
    expect(pets(again).pets.map((p) => p.id)).toEqual([petId]);
    stepMin(sim, 60);
    stepMin(again, 60);
    expect(jsonClone(again.serialize())).toEqual(jsonClone(sim.serialize()));
  });

  it('a save without pets loads silently; a broken pets block is dropped and recreated', () => {
    const sim = world();
    const w = jsonClone(sim.serialize()) as WorldState & { pets?: unknown };
    delete w.pets;
    const v = validateWorld(jsonClone(w));
    expect(v.ok && v.issues.length).toBe(0);
    w.pets = { version: 9 } as unknown as WorldState['pets'];
    const v2 = validateWorld(jsonClone(w));
    expect(v2.ok).toBe(true);
    if (v2.ok) expect(v2.world.pets).toBeUndefined();
  });
});
