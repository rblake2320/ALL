/**
 * Save/load determinism under stress (decision #9): the engine must keep NOTHING the outcome depends on outside
 * WorldState. (1) fixture world + a chaos system: serialise -> fresh simulation EVERY tick vs. never saving;
 * (2) the real spatial/home/people modules: periodic save/load over a game day vs. never saving.
 */
import { describe, expect, it } from 'vitest';
import type { NewGameOptions, SimSystem } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_HOUR } from '../../../src/sim/types';
import { defaultAppearance } from '../../../src/shared/appearance';
import { fixtureRegistry, fixtureSim, hashState, member, newFixtureWorld, place } from '../../../src/sim/engine/fixtures/world';
import { createCounters, fixtureSystems } from '../../../src/sim/engine/fixtures/systems';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';

type SimIndex = typeof import('../../../src/sim/index');
let real: SimIndex | null = null;
let loadError = '';
try {
  real = await import('../../../src/sim/index');
} catch (e) {
  loadError = e instanceof Error ? e.message : String(e);
}

/** First differing leaf paths between two JSON values (for a readable failure). */
function diff(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (out.length >= 12 || JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) {
      diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    }
  } else out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`);
  return out;
}

/** Deterministic chaos from a system hook: power flips, items appear/vanish, runs interrupted or failed. */
function chaosSystem(): SimSystem {
  return {
    id: 'x_chaos',
    tick(ctx) {
      const t = ctx.state.tick;
      if (t % 97 === 0) ctx.state.household.utilitiesOn = !ctx.state.household.utilitiesOn;
      if (t % 131 === 0) {
        const loose = Object.values(ctx.state.objects).filter((o) => o.placement.kind === 'loose');
        if (loose.length && ctx.rng.chance(0.5)) ctx.removeObject(ctx.rng.pick(loose).id, 'The meal vanished');
        else ctx.placeItemNear('item_meal', { x: ctx.rng.int(2, 26) + 0.5, z: ctx.rng.int(2, 24) + 0.5 });
      }
      const busy = ctx.agentsOnLot().filter((a) => a.active);
      if (t % 173 === 0 && busy.length) ctx.interrupt(ctx.rng.pick(busy), 'chaos');
      if (t % 211 === 0 && busy.length) ctx.failRun(ctx.rng.pick(busy), 'Chaos says no');
    },
  };
}

function chaoticWorld(seed: number): EngineSimulation {
  const registry = fixtureRegistry();
  const systems = [...fixtureSystems(createCounters()), chaosSystem()];
  const state = newFixtureWorld({ seed, lotTemplate: 'starter', members: [member('A'), member('B'), member('C')], registry, systems });
  const { sim } = fixtureSim(state, { registry, systems });
  place(sim, 'tv_crt', 16, 8);
  place(sim, 'chair_creaky', 16, 11, 2);
  place(sim, 'stereo_boombox', 22, 8);
  place(sim, 'shower_drizzle', 3, 14);
  place(sim, 'coffin_pine', 14, 14);
  place(sim, 'fridge_humming', 5, 5);
  place(sim, 'mirror_cracked', 22, 14);
  sim.state.settings.autonomy = 'full';
  for (const id of sim.state.household.memberIds) Object.assign(sim.state.agents[id].needs, { hunger: 30, fun: 25, energy: 35 });
  return sim;
}

describe('save/load determinism', () => {
  it('fixture world under chaos: saving and reloading EVERY tick is identical to never saving', () => {
    const live = chaoticWorld(5);
    const registry = live.engine.content;
    const systems = live.engine.systems.map((e) => e.sys);
    let other = fixtureSim(JSON.parse(JSON.stringify(live.serialize())) as WorldState, { registry, systems }).sim;
    for (let i = 0; i < 1200; i++) {
      live.step();
      other.step();
      const a = live.serialize();
      const b = other.serialize();
      if (hashState(a) !== hashState(b)) throw new Error(`diverged at tick ${live.state.tick}: ${diff(a, b).join('; ')}`);
      other = fixtureSim(JSON.parse(JSON.stringify(b)) as WorldState, { registry, systems }).sim;
      expect(other.repairWarnings).toEqual([]);
    }
    expect(live.faults()).toEqual([]);
    expect(live.checkInvariants()).toEqual([]);
  }, 240000);

  it.skipIf(!real)(`real modules: periodic save/load over a game day is identical to never saving${loadError ? ` (skipped: ${loadError})` : ''}`, () => {
    const opts: NewGameOptions = {
      seed: 4,
      householdName: 'The Graves',
      members: [
        { firstName: 'Mort', lastName: 'Graves', appearance: defaultAppearance(), traits: ['gourmand', 'neatFreak', 'nightOwl'], aspiration: 'tycoon' },
        { firstName: 'Ghoulia', lastName: 'Graves', appearance: defaultAppearance(), traits: ['cheerful', 'artistic'], aspiration: 'afterparty' },
      ],
      lotTemplate: 'starter',
      difficulty: 'normal',
    };
    const live = real!.createSimulation(real!.createNewWorld(opts));
    let other = real!.createSimulation(JSON.parse(JSON.stringify(live.serialize())) as WorldState);
    for (let i = 1; i <= 24 * TICKS_PER_HOUR; i++) {
      live.step();
      other.step();
      if (i % 500 === 0) {
        live.drainEvents();
        other.drainEvents();
      }
      if (i % (2 * TICKS_PER_HOUR) === 0) {
        const a = live.serialize();
        const b = other.serialize();
        if (hashState(a) !== hashState(b)) throw new Error(`diverged at tick ${live.state.tick}: ${diff(a, b).join('; ')}`);
        other = real!.createSimulation(JSON.parse(JSON.stringify(b)) as WorldState);
        expect(other.repairWarnings).toEqual([]);
      }
    }
    expect(live.faults()).toEqual([]);
    expect(live.checkInvariants()).toEqual([]);
  }, 240000);
});
