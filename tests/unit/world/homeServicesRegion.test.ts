/** Cross-region integration acceptance for #105 plus W-025; real content/engine, no mocked system. */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim';
import type { EngineSimulation } from '../../../src/sim/engine';
import type { ObjectState } from '../../../src/sim/types';
import { defaultAppearance } from '../../../src/shared/appearance';
import { thawRegion } from '../../../src/sim/engine/streaming';
import { homeRegionIdOf } from '../../../src/shared/town';
import { placedItems } from '../../../src/sim/spatial/homeBuildRules';
import { homeBonusOf, homeBonusesLive } from '../../../src/sim/engine/homeBonus';
import { buildChangeBlocked, creditEssence } from '../../../src/sim/systems/homeServices';
import { hearthView } from '../../../src/game/homeView';
import { homeMenuEntries } from '../../../src/game/homeMenu';

const FOREIGN = 'wormwood:mildew_n3';
function fresh(neighbour = true): EngineSimulation {
  const sim = createSimulation(createNewWorld({ seed: 7, householdName: 'Home scope', lotTemplate: 'empty', difficulty: 'normal', members: [
    { firstName: 'Mort', lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null },
  ] })) as unknown as EngineSimulation;
  if (neighbour) expect(thawRegion(sim.engine, FOREIGN)).toBe(true);
  return sim;
}
function put(sim: EngineSimulation, defId: string, foreign: boolean): ObjectState {
  let obj: ObjectState | undefined;
  const spawn = () => { obj = sim.engine.ctx.spawnObject(defId, { kind: 'floor', x: 1, z: 1, rot: 0 }); };
  if (foreign) sim.engine.ctx.withRegion!(FOREIGN, spawn); else spawn();
  expect(obj).toBeDefined();
  expect(obj!.regionId ?? homeRegionIdOf(sim.state)).toBe(foreign ? FOREIGN : homeRegionIdOf(sim.state));
  return obj!;
}
const actor = (sim: EngineSimulation) => sim.state.agents[sim.state.household.memberIds[0]];

describe('home services in a real streamed neighbourhood', () => {
  it('furnished neighbours never count toward the household caps or sets', () => {
    const sim = fresh(false), before = placedItems(sim.state);
    expect(thawRegion(sim.engine, FOREIGN)).toBe(true);
    expect(Object.values(sim.state.objects).some(o => o.regionId === FOREIGN && o.placement.kind === 'floor')).toBe(true);
    expect(placedItems(sim.state)).toEqual(before);
  });

  for (const foreign of [true, false]) it(`${foreign ? 'foreign' : 'home'} Hearth controls the household bonus activation and UI`, () => {
    const sim = fresh();
    put(sim, 'hearth_stone', foreign);
    expect(homeBonusesLive(sim.state)).toBe(!foreign);
    expect(hearthView(sim.state).placed).toBe(!foreign);
    if (foreign) expect(homeBonusOf(sim.state)).toEqual({});
  });

  for (const foreign of [true, false]) it(`${foreign ? 'foreign' : 'home'} Hearth controls actual daily essence`, () => {
    const sim = fresh();
    put(sim, 'hearth_stone', foreign);
    sim.state.household.utilitiesOn = true;
    creditEssence(sim.engine.ctx, 2);
    if (foreign) expect(sim.state.homeServices!.hearth.essence).toBe(0);
    else {
      const control = fresh(false);
      put(control, 'hearth_stone', false);
      control.state.household.utilitiesOn = true;
      creditEssence(control.engine.ctx, 2);
      expect(control.state.homeServices!.hearth.essence).toBeGreaterThan(0);
      expect(sim.state.homeServices!.hearth.essence).toBe(control.state.homeServices!.hearth.essence);
    }
    const before = JSON.stringify(sim.state.homeServices);
    creditEssence(sim.engine.ctx, 2);
    expect(JSON.stringify(sim.state.homeServices)).toBe(before);
  });

  for (const foreign of [true, false]) it(`${foreign ? 'foreign' : 'home'} Vault controls the actual stash command and its menu`, () => {
    const sim = fresh(), vault = put(sim, 'vault_crypt', foreign);
    const before = JSON.stringify(sim.serialize());
    const result = sim.dispatch({ type: 'home', action: 'stashPut', material: 'bone', units: 1 });
    expect(result.ok).toBe(!foreign);
    expect(homeMenuEntries(sim.state, vault.id).length).toBe(foreign ? 0 : 1);
    if (foreign) expect(JSON.stringify(sim.serialize())).toBe(before);
    else expect(sim.state.homeServices!.stash.bone).toBe(1);
  });

  for (const foreign of [true, false]) it(`${foreign ? 'foreign' : 'home'} actor cannot use a home-only Embalming Station remotely`, () => {
    const sim = fresh();
    put(sim, 'station_embalming', false);
    const member = actor(sim);
    if (foreign) member.regionId = FOREIGN;
    const before = JSON.stringify(sim.serialize());
    expect(sim.dispatch({ type: 'home', action: 'respec', agentId: member.id }).ok).toBe(!foreign);
    if (foreign) expect(JSON.stringify(sim.serialize())).toBe(before);
    else expect(sim.state.homeServices!.respecDay[member.id]).toBeDefined();
  });

  for (const foreign of [true, false]) it(`${foreign ? 'foreign' : 'home'} fire blocks only its own household home service`, () => {
    const sim = fresh();
    const spawn = () => sim.engine.ctx.spawnObject('item_fire', { kind: 'loose', x: 1.5, z: 1.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 });
    if (foreign) sim.engine.ctx.withRegion!(FOREIGN, spawn); else spawn();
    const reason = buildChangeBlocked(sim.engine.ctx, actor(sim));
    if (foreign) expect(reason).toBeNull(); else expect(reason).toMatch(/fire/i);
  });
});
