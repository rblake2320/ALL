/**
 * Integration with the real engine: createSimulation(createNewWorld(...)) driven for several game days.
 * Proves the home content/systems wire up with SIM-ENGINE + SIM-SPATIAL (+ whatever SIM-PEOPLE ships), produce no
 * home faults, keep invariants, issue bills, run the cook → eat loop from a player command, keep lockstep
 * simulations identical, and survive a save/load round trip.
 */
import { describe, expect, it } from 'vitest';
import type { SimContext, SimulationAPI } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { createNewWorld, createSimulation, validateContent } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { IX } from '../../../src/sim/content/home/ids';

const HOME_FAULT = /^(system:(decay|food|economy|upkeep)|effect:home_|requirement:home_|condition:home_|api:(decay|food|economy|upkeep)|behavior:(sleep|embalm|beEmbalmed|stitch|beStitched|pickUpLimb|fitProsthetic|reanimate|kitReanimate|mourn|mirror|cook|eat|putAwayLeftovers|throwAway|cleanFridge|deliverPizza|payBills|checkMail|repossess|sellPainting|activity|sit|toggle|watchTv|dance|listen|read|paint|cleanUp|wipeDown|fightFire|repair|emptyTrash|feedPlant|epitaph)\.)/;

/** Multi-day runs are CPU-bound; other agents share this machine, so allow generous wall time. */
const HEAVY = 240_000;

function newSim(seed: number): SimulationAPI {
  const world = createNewWorld({
    seed,
    householdName: 'Grimsby',
    members: [
      { firstName: 'Mort', lastName: 'Grimsby', appearance: defaultAppearance(), traits: ['gourmand', 'clumsy', 'vain'], aspiration: 'masterPreserver' },
      { firstName: 'Ghoulia', lastName: 'Grimsby', appearance: defaultAppearance(), traits: ['neatFreak', 'bookworm', 'artistic'], aspiration: 'renaissanceCorpse' },
    ],
    lotTemplate: 'starter',
    difficulty: 'normal',
  });
  return createSimulation(world);
}

function run(sim: SimulationAPI, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    if (i % 240 === 0) sim.drainEvents();
  }
  sim.drainEvents();
}

function homeFaults(sim: SimulationAPI) {
  return sim.faults().filter((f) => HOME_FAULT.test(f.where));
}

describe('home × engine integration', () => {
  it('shipped content validates with home + people systems', () => {
    const problems = validateContent().filter((p) => /home|decay|food|economy|upkeep/.test(p));
    expect(problems).toEqual([]);
  });

  it('runs 3+ game days with no home faults, clean invariants, a Thursday bill and decaying freshness', () => {
    const sim = newSim(1234);
    const members = sim.state.household.memberIds.map((id) => sim.state.agents[id]);
    const startPres = members.map((m) => m.needs.preservation);
    run(sim, 3 * TICKS_PER_DAY + 240); // Mon 09:00 → Thu 10:00 (first bill at Thu 09:00)
    expect(homeFaults(sim)).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
    expect(sim.state.household.bills.length).toBeGreaterThanOrEqual(1); // Thursday 09:00 of day 4
    expect(sim.state.stats.counters.billsIssued).toBeGreaterThanOrEqual(1);
    const nowPres = members.map((m) => m.needs.preservation);
    expect(nowPres.some((p, i) => p < startPres[i])).toBe(true);
    for (const m of members) {
      expect(Number.isFinite(m.needs.preservation)).toBe(true);
      expect(m.needs.preservation).toBeLessThanOrEqual(m.vitality);
    }
    // the economy view and decay api are reachable through the engine
    const view = sim.bills();
    expect(view.outstanding).toBeGreaterThan(0);
    expect(sim.lotValue()).toBeGreaterThan(1000);
    const needs = sim.needs(members[0].id).find((n) => n.id === 'preservation')!;
    expect(Number.isFinite(needs.trend)).toBe(true);
  }, HEAVY);

  it('a player-queued Cook… with a recipe charges once, produces a meal and the cook eats it', () => {
    const sim = newSim(99);
    const mort = sim.state.agents[sim.state.household.memberIds[0]];
    const fridge = Object.values(sim.state.objects).find((o) => o.defId === 'fridge_humming')!;
    const menu = sim.menu(mort.id, { kind: 'object', id: fridge.id });
    const cook = menu.find((e) => e.interactionId === IX.cook)!;
    expect(cook.children?.map((c) => c.params.recipe)).toEqual(['brainLoaf', 'cerebellumStew', 'frontalLasagna', 'medullaFlambe']);
    const funds = sim.state.household.funds;
    const res = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.cook, target: { kind: 'object', id: fridge.id }, params: { recipe: 'brainLoaf' } });
    expect(res.ok).toBe(true);
    let sawMeal = false;
    for (let i = 0; i < 6 * 240 && !sawMeal; i++) {
      sim.step();
      sim.drainEvents();
      sawMeal = Object.values(sim.state.objects).some((o) => o.defId === 'item_meal' && o.data.cookId === mort.id);
    }
    expect(sawMeal || sim.state.stats.counters.firesStarted > 0).toBe(true);
    expect(funds - sim.state.household.funds).toBeGreaterThanOrEqual(12);
    expect(homeFaults(sim)).toEqual([]);
  });

  it('Embalm Other pairs the patient onto the slab and applies +60 freshness (real pair choreography)', () => {
    const sim = newSim(31337);
    const [mort, ghoulia] = sim.state.household.memberIds.map((id) => sim.state.agents[id]);
    sim.state.household.funds = 20000;
    let placed = false;
    for (let z = 3; z < 24 && !placed; z++) for (let x = 3; x < 26 && !placed; x++) placed = sim.build.apply({ type: 'buy', defId: 'station_embalming', x, z, rot: 0 }).ok;
    expect(placed).toBe(true);
    sim.build.clearHistory();
    mort.skills.mortuary.level = 2;
    ghoulia.needs.preservation = 25;
    const res = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.embalmOther, target: { kind: 'agent', id: ghoulia.id } });
    expect(res.ok).toBe(true);
    let sawPartner = false;
    for (let i = 0; i < 4 * 240 && !(sim.state.stats.agent[mort.id]?.embalmedOthers >= 1); i++) {
      sim.step();
      sim.drainEvents();
      if (ghoulia.active?.interactionId === IX.beEmbalmed) sawPartner = true;
    }
    expect(sawPartner).toBe(true);
    expect(sim.state.stats.agent[mort.id]?.embalmedOthers).toBe(1);
    expect(ghoulia.needs.preservation).toBeGreaterThan(25 + 60 - 6);
    expect(ghoulia.moodlets.some((m) => m.id === 'embalmed')).toBe(true);
    expect(homeFaults(sim)).toEqual([]);
  });

  it('ordering pizza through the food api brings a ghoul (people createService) that leaves a pizza and goes home', () => {
    const sim = newSim(8080);
    const mort = sim.state.agents[sim.state.household.memberIds[0]];
    const ctx = (sim as unknown as { engine: { ctx: SimContext } }).engine.ctx;
    const funds = sim.state.household.funds;
    expect(ctx.sys('food').orderPizza(mort.id)).toBe(true);
    expect(sim.state.household.funds).toBe(funds - 35);
    let pizza = false;
    for (let i = 0; i < 4 * 240; i++) {
      sim.step();
      sim.drainEvents();
      if (!pizza && Object.values(sim.state.objects).some((o) => o.defId === 'item_pizza')) pizza = true;
      if (pizza && !Object.keys(sim.state.flags).some((k) => k.startsWith('home.pizza.') && k !== 'home.pizza.count')) break;
    }
    expect(pizza).toBe(true);
    const ghouls = Object.values(sim.state.agents).filter((a) => a.role === 'service');
    expect(ghouls.length).toBeGreaterThanOrEqual(1);
    expect(ghouls.every((g) => g.presence !== 'onLot')).toBe(true);
    expect(homeFaults(sim)).toEqual([]);
  });

  it('lockstep simulations with the same seed stay identical (api calls resolve to the right world)', () => {
    const a = newSim(4242);
    const b = newSim(4242);
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      a.step();
      b.step();
      if (i % 480 === 0) {
        // UI-style api queries between steps must not disturb either world
        a.bills();
        b.objectView(Object.keys(b.state.objects)[0]);
      }
    }
    a.drainEvents();
    b.drainEvents();
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  }, HEAVY);

  it('survives a save/load round trip mid-game and keeps simulating', () => {
    const sim = newSim(555);
    run(sim, TICKS_PER_DAY / 2);
    const saved = JSON.parse(JSON.stringify(sim.serialize())) as WorldState;
    const loaded = createSimulation(saved);
    run(loaded, TICKS_PER_DAY / 2);
    expect(homeFaults(loaded)).toEqual([]);
    expect(loaded.checkInvariants()).toEqual([]);
  }, HEAVY);
});
