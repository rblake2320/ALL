/** Owner/Fable ORDER: cap new adoptions at three; never delete an existing fourth pet. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import type { StrayState, WorldState } from '../../../src/sim/types';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { noLocks } from '../../../src/persistence/locks';
import { makeMeta, silentLogger } from '../persistence/fixtures';
import { householdCentre } from '../../../src/sim/systems/pets/motion';
import { petMenuFor } from '../../../src/game/petMenu';
import { opts } from '../quests/helpers';
import { homeRegionIdOf } from '../../../src/shared/town';

const oldWorld = JSON.parse(readFileSync(new URL('../../fixtures/world-batch-pets/pets-four-v2-world.json', import.meta.url), 'utf8')) as WorldState;
// The accepted pet-look contract adds only this normal cosmetic default to older animals.
const migratedPets = { ...oldWorld.pets!, pets: oldWorld.pets!.pets.map(p => ({ ...p, variant: 'normal' as const })) };
const exported = () => new Uint8Array(readFileSync(new URL('../../fixtures/world-batch-pets/pets-four-v2.alsave', import.meta.url)));
const manager = () => new SaveManagerImpl({ backend: createMemoryBackend(), locks: noLocks, logger: silentLogger, repair: engineRepairHook() });
async function loadLegacy() {
  const sm = manager();
  const loaded = await sm.importFile(exported(), 'legacy-pets');
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) throw Error(loaded.error);
  expect(loaded.warnings).toEqual([]);
  return { sm, sim: createSimulation(loaded.world) as EngineSimulation };
}

describe('four legacy pets under the three-new-adoption limit', () => {
  it('migrates/imports, initializes, re-saves and reloads without dropping or changing any pet', async () => {
    expect(oldWorld.schemaVersion).toBe(2);
    expect(oldWorld.pets!.pets).toHaveLength(4);
    const { sm, sim } = await loadLegacy();
    expect(sim.state.pets).toEqual(migratedPets);
    expect((await sm.save('again', 'Four retained pets', sim.serialize(), makeMeta())).ok).toBe(true);
    const loaded = await sm.load('again');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw Error(loaded.error);
    expect(loaded.warnings).toEqual([]);
    expect(createSimulation(loaded.world).state.pets).toEqual(migratedPets);
  });

  for (const count of [2, 3, 4]) it(`${count} existing pets: adoption ${count < 3 ? 'works' : 'is refused without changing animals or money'}`, async () => {
    const { sim } = await loadLegacy();
    const ps = sim.state.pets!;
    ps.pets = ps.pets.slice(0, count); // setup below/at/over the adoption boundary; loading retention tested separately
    const p = oldWorld.pets!.pets[0];
    const s: StrayState = {
      id: 's900', species: p.species, name: p.name, trait: p.trait, place: 'street', trust: 100,
      calmTick: 0, chaseCoolTick: 0, arrivedTick: sim.state.tick, pos: { ...p.pos }, facing: p.facing,
      anim: 'idle', goal: null, slot: -1, busyUntil: 0,
    };
    ps.strays.push(s);
    ps.nextId = 901;
    const a = sim.state.agents[sim.state.household.memberIds[0]];
    a.pos = { ...s.pos };
    const before = JSON.stringify(ps);
    const funds = sim.state.household.funds;
    const menu = petMenuFor(sim.state, 'stray', s.id);
    expect.soft(menu?.entries.find(e => e.params?.action === 'adopt')?.available).toBe(count < 3);
    const result = sim.dispatch({ type: 'pet', action: 'adopt', agentId: a.id, strayId: s.id });
    expect.soft(result.ok).toBe(count < 3);
    expect(sim.state.household.funds).toBe(funds);
    if (count >= 3) expect(JSON.stringify(ps)).toBe(before);
    else {
      expect(ps.pets).toHaveLength(3);
      expect(ps.pets.some(x => x.id === 'p900')).toBe(true);
      expect(ps.strays.some(x => x.id === 's900')).toBe(false);
    }
  });
});

describe('home animals in a connected world', () => {
  it('does not average a foreign actor local position into the home pet centre', async () => {
    const { sim } = await loadLegacy();
    const [home, away] = sim.state.household.memberIds.map(id => sim.state.agents[id]);
    expect(away).toBeDefined();
    home.pos = { x: 10, z: 12 };
    away.pos = { x: 2, z: 3 };
    away.regionId = 'street:mildew:2';
    expect(sim.engine.ctx.regionOf(away.id)).toBe('street:mildew:2');
    expect(householdCentre(sim.engine.ctx)).toEqual(home.pos);
  });

  it('refuses remote pet care even when the foreign-local coordinates overlap the animal', async () => {
    const { sim } = await loadLegacy();
    const pet = sim.state.pets!.pets[0];
    const actor = sim.state.agents[sim.state.household.memberIds[0]];
    actor.pos = { ...pet.pos };
    actor.regionId = 'street:mildew:2';
    const before = JSON.stringify(sim.state.pets);
    const funds = sim.state.household.funds;
    const result = sim.dispatch({ type: 'pet', action: 'feed', agentId: actor.id, petId: pet.id });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(sim.state.pets)).toBe(before);
    expect(sim.state.household.funds).toBe(funds);
  });

  it('cancels a pending home-animal errand after crossing before any local-coordinate overlap can complete it', async () => {
    const { sim } = await loadLegacy();
    sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off', visitorsEnabled: false } });
    const pet = sim.state.pets!.pets[0];
    pet.pos = { x: 13.5, z: 28.5 };
    pet.needs.appetite = 20;
    const actor = sim.state.agents[sim.state.household.memberIds[0]];
    actor.pos = { x: 3.5, z: 28.5 };
    expect(sim.dispatch({ type: 'pet', action: 'feed', agentId: actor.id, petId: pet.id }).ok).toBe(true);
    expect(sim.state.pets!.pending).toHaveLength(1);
    actor.regionId = 'street:mildew:2';
    actor.pos = { ...pet.pos };
    const funds = sim.state.household.funds;
    sim.step();
    expect(sim.state.pets!.pending).toEqual([]);
    expect(pet.needs.appetite).toBeLessThan(20);
    expect(sim.state.household.funds).toBe(funds);
    expect(sim.faults()).toEqual([]);
  });

  it('still lets a home member care for every grandfathered pet', async () => {
    const { sim } = await loadLegacy();
    const actor = sim.state.agents[sim.state.household.memberIds[0]];
    for (const pet of sim.state.pets!.pets) {
      actor.pos = { ...pet.pos };
      pet.needs.appetite = 20;
      expect(sim.dispatch({ type: 'pet', action: 'feed', agentId: actor.id, petId: pet.id }).ok).toBe(true);
      expect(pet.needs.appetite).toBeGreaterThan(20);
    }
    expect(sim.state.pets!.pets).toHaveLength(4);
  });

  it('walks to a real furnished neighbour, reloads away, returns home and completes the pet-care walk', async () => {
    let sim = createSimulation(createNewWorld(opts(7, 1))) as EngineSimulation;
    sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off', visitorsEnabled: false } });
    const actorId = sim.state.household.memberIds[0];
    const home = homeRegionIdOf(sim.state);
    const away = 'wormwood:mildew_n3';
    const stray = sim.state.pets!.strays[0];
    stray.trust = 100; // trusted-animal fixture; earning trust/adopting four is recorded independently
    sim.state.agents[actorId].pos = { ...stray.pos };
    expect(sim.dispatch({ type: 'pet', action: 'adopt', agentId: actorId, strayId: stray.id }).ok).toBe(true);
    const petId = sim.state.pets!.pets[0].id;
    const walk = (regionId: string) => {
      expect(sim.dispatch({ type: 'queue', actorId, interactionId: 'engine_goHere', target: { kind: 'tile', x: 14, z: 28 }, params: { regionId } }).ok).toBe(true);
      for (let i = 0; i < 3000; i++) {
        sim.step();
        const actor = sim.state.agents[actorId];
        if ((actor.regionId ?? home) === regionId && Math.floor(actor.pos.x) === 14 && Math.floor(actor.pos.z) === 28 && !actor.active) return;
      }
      throw Error(`Did not walk to ${regionId}`);
    };
    walk(away);
    const sm = manager();
    const petsBeforeReload = structuredClone(sim.state.pets);
    expect((await sm.save('away', 'Away from home pet', sim.serialize(), makeMeta())).ok).toBe(true);
    const loaded = await sm.load('away');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw Error(loaded.error);
    sim = createSimulation(loaded.world) as EngineSimulation;
    expect(sim.state.pets).toEqual(petsBeforeReload);
    expect(sim.dispatch({ type: 'pet', action: 'feed', agentId: actorId, petId }).ok).toBe(false);
    walk(home);
    const pet = sim.state.pets!.pets.find(p => p.id === petId)!;
    pet.needs.appetite = 20;
    expect(sim.dispatch({ type: 'pet', action: 'feed', agentId: actorId, petId }).ok).toBe(true);
    for (let i = 0; i < 1500 && pet.needs.appetite <= 20; i++) sim.step();
    expect(pet.needs.appetite).toBeGreaterThan(20);
    expect(sim.state.pets!.pending).toEqual([]);
    expect(sim.faults()).toEqual([]);
  });
});
