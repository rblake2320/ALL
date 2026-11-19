/**
 * W-013 Guard trait: a looked-after Guard pet runs to the gate, barks at the Repo Ghoul and holds it off (a twice-only
 * delay; it never cancels the bill), on the REAL simulation. Controls in both directions: no pet, another trait and a
 * neglected Guard pet let the ghoul in on the same schedule.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/sim/contracts';
import type { PetState, PetsState, WorldState } from '../../../src/sim/types';
import { TICK_MINUTES, TICKS_PER_DAY } from '../../../src/sim/types';
import { FLAG } from '../../../src/sim/content/home/ids';
import { allSystems } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine';
import { GUARD_HOLD_MIN, GUARD_MAX_HOLDS, PET_ADOPT_TRUST } from '../../../src/sim/systems/pets';
import { payAll } from '../../../src/sim/systems/home/economy/bills';
import { validateWorld } from '../../../src/persistence/validation';
import { jsonClone, newWorld, opts, simOf } from '../quests/helpers';

function world(seed = 44): EngineSimulation {
  const sys = allSystems();
  return simOf(newWorld(opts(seed, 2), sys), sys);
}
const pets = (sim: EngineSimulation): PetsState => sim.state.pets!;
const stepMin = (sim: EngineSimulation, min: number) => {
  for (let i = 0, n = Math.round(min / TICK_MINUTES); i < n; i++) sim.step();
};
/** The ghoul was sent: it is on the lot, or it already finished (an empty house ends the visit at once and marks the bill stage 4). */
const ghoulHere = (sim: EngineSimulation) => !!sim.state.flags[FLAG.repoNpc] || sim.state.household.bills.some((b) => b.id === 'billGuard' && b.stage >= 4);

/** Adopt the first stray (zombie stands next to it), make it `trait`, keep it fed. */
function withPet(sim: EngineSimulation, trait: PetState['trait']): PetState {
  const stray = pets(sim).strays[0];
  const agentId = sim.state.household.memberIds[0];
  sim.state.agents[agentId].pos = { ...stray.pos };
  stray.trust = PET_ADOPT_TRUST + 10;
  expect(sim.dispatch({ type: 'pet', action: 'adopt', agentId, strayId: stray.id } as Command).ok).toBe(true);
  const pet = pets(sim).pets[0];
  pet.trait = trait;
  return pet;
}

/** An unpaid bill that is 6.5 days overdue: the Repo Ghoul is due at the next hourly check. */
function overdue(sim: EngineSimulation): void {
  sim.state.household.funds = 0;
  sim.state.household.bills.push({ id: 'billGuard', issuedTick: sim.state.tick, dueTick: sim.state.tick - Math.round(6.5 * TICKS_PER_DAY), amount: 400, paidTick: null, stage: 0 });
}

const keepFed = (pet: PetState) => {
  for (const k of ['appetite', 'fun', 'hygiene', 'affection'] as const) pet.needs[k] = 90;
};

describe('Guard pet and the Repo Ghoul', () => {
  it('control: with no pet, the ghoul arrives within a few hours', () => {
    const sim = world();
    overdue(sim);
    stepMin(sim, 240);
    expect(ghoulHere(sim)).toBe(true);
  });

  it('control: a Lazy pet (or any other trait) does not stop it', () => {
    const sim = world();
    const pet = withPet(sim, 'lazy');
    overdue(sim);
    keepFed(pet);
    stepMin(sim, 240);
    expect(ghoulHere(sim)).toBe(true);
  });

  it('control: a neglected Guard pet does not stop it', () => {
    const sim = world();
    const pet = withPet(sim, 'guard');
    for (const k of ['appetite', 'fun', 'hygiene', 'affection'] as const) pet.needs[k] = 2;
    overdue(sim);
    stepMin(sim, 240);
    expect(ghoulHere(sim)).toBe(true);
  });

  it('a looked-after Guard pet barks: the ghoul is held off, the pet runs to the gate and plays the bark, and the household is told', () => {
    const sim = world();
    const pet = withPet(sim, 'guard');
    overdue(sim);
    const seen = new Set<string>();
    let barks = 0;
    for (let i = 0; i < Math.round(240 / TICK_MINUTES); i++) {
      keepFed(pet);
      sim.step();
      for (const ev of sim.drainEvents()) if (ev.type === 'sfx' && ev.id === 'bark') barks++;
      seen.add(pet.anim);
    }
    expect(barks).toBe(1); // one bark sound for the one time the ghoul was held off
    expect(ghoulHere(sim)).toBe(false);
    expect(sim.state.notifications.some((n) => /barks at the Repo Ghoul/.test(n.title))).toBe(true);
    expect(seen.has('run')).toBe(true);
    expect(seen.has('play')).toBe(true);
    expect(sim.state.household.bills.some((b) => b.id === 'billGuard' && b.paidTick === null && b.stage < 4)).toBe(true); // the bill is untouched, the ghoul not sent
  }, 120_000);

  it('the hold lasts 12 hours, works twice, then the ghoul comes anyway (a pet buys time, it does not cancel a bill)', () => {
    const sim = world();
    const pet = withPet(sim, 'guard');
    overdue(sim);
    const tickOf = () => sim.state.tick;
    let arrivedAfterMin: number | null = null;
    const t0 = tickOf();
    for (let i = 0; i < Math.round((GUARD_HOLD_MIN * (GUARD_MAX_HOLDS + 1)) / TICK_MINUTES) && arrivedAfterMin === null; i++) {
      keepFed(pet);
      sim.step();
      if (ghoulHere(sim)) arrivedAfterMin = (tickOf() - t0) * TICK_MINUTES;
    }
    expect(arrivedAfterMin).not.toBeNull();
    // two 12 h holds, plus up to the hourly checks: it must not arrive in the first 23 hours and must in the 26th
    expect(arrivedAfterMin!).toBeGreaterThan(GUARD_HOLD_MIN * GUARD_MAX_HOLDS - 60);
    expect(arrivedAfterMin!).toBeLessThan(GUARD_HOLD_MIN * GUARD_MAX_HOLDS + 130);
    expect(sim.state.notifications.filter((n) => /barks at the Repo Ghoul/.test(n.title)).length).toBe(GUARD_MAX_HOLDS);
  }, 180_000);

  it('paying the bill during the hold ends it: no ghoul at all', () => {
    const sim = world();
    const pet = withPet(sim, 'guard');
    overdue(sim);
    stepMin(sim, 130);
    expect(ghoulHere(sim)).toBe(false);
    sim.state.household.bills.find((b) => b.id === 'billGuard')!.paidTick = sim.state.tick;
    for (let i = 0; i < Math.round((GUARD_HOLD_MIN * 3) / TICK_MINUTES); i++) {
      keepFed(pet);
      sim.step();
    }
    expect(ghoulHere(sim)).toBe(false);
  }, 180_000);
});

/** Run `minutes` of game time keeping the pet fed; returns how many barks (Repo Ghoul held off) were heard. */
function run(sim: EngineSimulation, pet: PetState, minutes: number): number {
  let barks = 0;
  for (let i = 0; i < Math.round(minutes / TICK_MINUTES); i++) {
    keepFed(pet);
    sim.step();
    for (const ev of sim.drainEvents()) if (ev.type === 'sfx' && ev.id === 'bark') barks++;
  }
  return barks;
}
const holds = (sim: EngineSimulation) => sim.state.flags.petGuardHolds as number | undefined;
const debt = (sim: EngineSimulation, id: string, amount = 400) => {
  sim.state.household.bills.push({ id, issuedTick: sim.state.tick, dueTick: sim.state.tick - Math.round(6.5 * TICKS_PER_DAY), amount, paidTick: null, stage: 0 });
};
const stage = (sim: EngineSimulation, id: string) => sim.state.household.bills.find((b) => b.id === id)!.stage;

describe('the allowance of holds belongs to one debt (review F1)', () => {
  it('Astra\'s control: both holds used, the whole debt paid, a later debt gets two fresh holds (it used to be sent at once)', () => {
    const sim = world();
    const pet = withPet(sim, 'guard');
    overdue(sim);
    expect(run(sim, pet, GUARD_HOLD_MIN + 120)).toBe(2);
    expect(holds(sim)).toBe(2);
    sim.state.household.funds = 100000;
    expect(payAll(sim.engine.ctx, sim.state.household.memberIds[0])).toBe(true);
    expect(holds(sim)).toBeUndefined(); // the whole debt settled: allowance gone
    sim.state.household.funds = 0; // (zombies with money would pay the next bill themselves)
    sim.state.tick += 7 * TICKS_PER_DAY; // a week later
    debt(sim, 'billB');
    expect(run(sim, pet, 240)).toBe(1); // held off at once, not sent
    expect(stage(sim, 'billB')).toBeLessThan(4);
    expect(run(sim, pet, GUARD_HOLD_MIN + 120)).toBe(1); // and a second hold
    expect(holds(sim)).toBe(2);
  }, 240_000);

  it('a PARTIAL payment keeps the allowance: the remaining debt gets no third hold', () => {
    const sim = world();
    const pet = withPet(sim, 'guard');
    overdue(sim); // billGuard 400
    debt(sim, 'billTwo', 300);
    expect(run(sim, pet, GUARD_HOLD_MIN + 120)).toBe(2);
    sim.state.household.funds = 400; // enough for the oldest bill only
    const r = payAll(sim.engine.ctx, sim.state.household.memberIds[0]);
    expect(r).not.toBe(true);
    expect(sim.state.household.bills.filter((b) => b.paidTick === null).map((b) => b.id)).toEqual(['billTwo']);
    expect(holds(sim)).toBe(2);
    expect(run(sim, pet, GUARD_HOLD_MIN + 120)).toBe(0); // no third bark
    expect(stage(sim, 'billTwo')).toBeGreaterThanOrEqual(4); // the ghoul came for the rest
  }, 240_000);

  it('a debt settled some other way (no unpaid bill left) also starts over, at the next hourly check', () => {
    const sim = world();
    const pet = withPet(sim, 'guard');
    overdue(sim);
    expect(run(sim, pet, 240)).toBe(1);
    expect(holds(sim)).toBe(1);
    for (const b of sim.state.household.bills) b.paidTick = sim.state.tick;
    run(sim, pet, 130);
    expect(holds(sim)).toBeUndefined();
  }, 120_000);

  it('save and load in the middle of a hold keep the count; paying afterwards still clears it and a later debt gets two holds', () => {
    const sim = world();
    const pet = withPet(sim, 'guard');
    overdue(sim);
    expect(run(sim, pet, 240)).toBe(1);
    const w = jsonClone(sim.serialize()) as WorldState;
    const v = validateWorld(jsonClone(w));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const again = simOf(v.world as WorldState, allSystems());
    const pet2 = pets(again).pets[0];
    expect(holds(again)).toBe(1);
    again.state.household.funds = 100000;
    expect(payAll(again.engine.ctx, again.state.household.memberIds[0])).toBe(true);
    expect(holds(again)).toBeUndefined();
    again.state.household.funds = 0;
    debt(again, 'billLater');
    expect(run(again, pet2, GUARD_HOLD_MIN * 2 + 240)).toBe(2);
  }, 240_000);
});

describe('the Guard benefit follows the care tier (living-things.md)', () => {
  const keep = (pet: PetState, v: number) => {
    for (const k of ['appetite', 'fun', 'hygiene', 'affection'] as const) pet.needs[k] = v;
  };
  const arrival = (care: number): { minutes: number | null; barks: number } => {
    const sim = world();
    const pet = withPet(sim, 'guard');
    overdue(sim);
    let barks = 0;
    const t0 = sim.state.tick;
    for (let i = 0; i < Math.round((GUARD_HOLD_MIN * 3) / TICK_MINUTES); i++) {
      keep(pet, care);
      sim.step();
      for (const ev of sim.drainEvents()) if (ev.type === 'sfx' && ev.id === 'bark') barks++;
      if (ghoulHere(sim)) return { minutes: (sim.state.tick - t0) * TICK_MINUTES, barks };
    }
    return { minutes: null, barks };
  };

  it('below the half tier holds nothing (the ghoul comes within the hour check), the half tier holds once, the full tier holds the full allowance', () => {
    const none = arrival(20);
    expect(none.barks).toBe(0);
    expect(none.minutes!).toBeLessThan(240);
    const half = arrival(30);
    expect(half.barks).toBe(1);
    expect(half.minutes!).toBeGreaterThan(GUARD_HOLD_MIN - 60);
    expect(half.minutes!).toBeLessThan(GUARD_HOLD_MIN + 130);
    const full = arrival(75);
    expect(full.barks).toBe(GUARD_MAX_HOLDS);
    expect(full.minutes!).toBeGreaterThan(GUARD_HOLD_MIN * GUARD_MAX_HOLDS - 60);
  }, 300_000);
});
