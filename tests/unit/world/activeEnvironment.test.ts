import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim';
import type { EngineSimulation } from '../../../src/sim/engine';
import { defaultAppearance } from '../../../src/shared/appearance';
import { freezeRegion, thawRegion } from '../../../src/sim/engine/streaming';
import { withRegion } from '../../../src/sim/engine/regions';
import { DATA, FLAG, MOOD } from '../../../src/sim/content/home/ids';
import { readLeftovers } from '../../../src/sim/systems/home/food/leftovers';
import { FIRE_BURN_MINUTES, fireItems, startFire } from '../../../src/sim/systems/home/upkeep/fire';
import { syncStereoLoops } from '../../../src/sim/systems/home/upkeep/loops';

const AWAY = 'wormwood:mildew_n3';
function fresh(): EngineSimulation {
  const sim = createSimulation(createNewWorld({ seed: 7, householdName: 'Environment', lotTemplate: 'starter', difficulty: 'normal', members: [0, 1].map(i => ({ firstName: `Mort${i}`, lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null })) })) as unknown as EngineSimulation;
  sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off', visitorsEnabled: false } });
  expect(thawRegion(sim.engine, AWAY)).toBe(true);
  // A review fixture pins one member in the public yard so the region stays active. No travel claim is made here.
  const a = sim.state.agents[sim.state.household.memberIds[1]];
  a.regionId = AWAY;
  a.pos = { x: 14.5, z: 28.5 };
  a.prevPos = { ...a.pos };
  return sim;
}
const step = (sim: EngineSimulation, n: number) => { for (let i = 0; i < n; i++) sim.step(); };

describe('environment lifecycle in continuously active furnished regions', () => {
  it('scoped callbacks restore on throw, refuse dormant regions and keep both stereo loop sets', () => {
    const sim = fresh(), ctx = sim.engine.ctx, home = ctx.homeRegionId();
    const ids = ctx.activeRegionIds!();
    expect(ids[0]).toBe(home);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => ctx.withRegion!(AWAY, () => { throw new Error('scope control'); })).toThrow('scope control');
    expect(ctx.currentRegionId!()).toBe(home);
    expect(() => ctx.withRegion!('not:active', () => { throw new Error('must not run'); })).toThrow('Region is not active');
    const make = () => ctx.spawnObject('stereo_boombox', { kind: 'floor', x: 1, z: 1, rot: 0 }, { data: { [DATA.playing]: true } });
    const homeStereo = make(), awayStereo = ctx.withRegion!(AWAY, make);
    syncStereoLoops(ctx);
    ctx.withRegion!(AWAY, () => syncStereoLoops(ctx));
    const flags = JSON.parse(JSON.stringify(sim.state.flags));
    sim.drainEvents();
    syncStereoLoops(ctx);
    ctx.withRegion!(AWAY, () => syncStereoLoops(ctx));
    expect(sim.state.flags).toEqual(flags);
    expect(sim.drainEvents().filter(e => e.type === 'sfxLoop' && [homeStereo.id, awayStereo.id].includes(e.objectId ?? ''))).toEqual([]);
    expect(String(flags[FLAG.stereoLoops])).toContain(homeStereo.id);
    expect(String(flags[`${FLAG.stereoLoops}:${AWAY}`])).toContain(awayStereo.id);
    expect(ctx.currentRegionId!()).toBe(home);
    delete sim.state.agents[sim.state.household.memberIds[1]].regionId;
    expect(freezeRegion(sim.engine, AWAY)).toBe(true);
    syncStereoLoops(ctx);
    const stopped = sim.drainEvents().filter(e => e.type === 'sfxLoop');
    expect(stopped.filter(e => e.objectId === awayStereo.id && !e.on)).toHaveLength(1);
    expect(stopped.some(e => e.objectId === homeStereo.id)).toBe(false);
    syncStereoLoops(ctx);
    expect(sim.drainEvents().filter(e => e.type === 'sfxLoop')).toEqual([]);
    expect(thawRegion(sim.engine, AWAY)).toBe(true);
    ctx.withRegion!(AWAY, () => syncStereoLoops(ctx));
    expect(sim.drainEvents().filter(e => e.type === 'sfxLoop' && e.objectId === awayStereo.id && e.on)).toHaveLength(1);
  });

  it('home and neighbour food age equally through real ticks and save/reload', () => {
    const sim = fresh();
    const fridge = (away: boolean) => Object.values(sim.state.objects).find(o => (o.regionId === AWAY) === away && sim.content.objects[o.defId].tags.includes('fridge'))!;
    const home = fridge(false), away = fridge(true);
    for (const f of [home, away]) f.data[DATA.leftovers] = JSON.stringify([{ s: 1, q: 2, r: 'brainLoaf', a: 0 }]);
    step(sim, 240);
    expect(sim.state.town!.stream.active).toContain(AWAY);
    expect(readLeftovers(home)[0].a).toBe(60);
    expect(readLeftovers(away)[0].a).toBe(60);
    const loaded = createSimulation(JSON.parse(JSON.stringify(sim.serialize()))) as unknown as EngineSimulation;
    step(loaded, 240);
    expect(readLeftovers(loaded.state.objects[home.id])[0].a).toBe(120);
    expect(readLeftovers(loaded.state.objects[away.id])[0].a).toBe(120);
    expect(loaded.faults()).toEqual([]);
  });

  it('foreign fire progresses, retains condition/counters, affects only local agents and burns out', () => {
    const sim = fresh(), ctx = sim.engine.ctx;
    const target = Object.values(sim.state.objects).find(o => o.regionId === AWAY && o.defId === 'coffin_chillrest')!;
    expect(target).toBeDefined();
    const fire = withRegion(sim.engine, AWAY, () => startFire(ctx, target, { quiet: true }))!;
    expect(fire).toBeTruthy();
    const p = fire.placement;
    if (p.kind !== 'loose') throw new Error('Expected real loose fire');
    const [homeActor, awayActor] = sim.state.household.memberIds.map(id => sim.state.agents[id]);
    for (const a of [homeActor, awayActor]) { a.pos = { x: p.x, z: p.z }; a.prevPos = { ...a.pos }; }
    const stamp = FLAG.fireCalledPrefix + 'control';
    sim.state.flags[stamp] = sim.state.tick;
    expect(fireItems(ctx)).toEqual([]); // positive home-no-fire control while the foreign fire is live
    step(sim, 20);
    expect.soft(fire.data[DATA.burnMin]).toBe(5);
    expect.soft(target.condition.burning).toBe(true);
    expect.soft(target.condition.burnMinutes).toBe(5);
    expect.soft(sim.state.flags[stamp]).toBeDefined();
    expect(ctx.hasMoodlet(homeActor, MOOD.panicking)).toBe(false);
    expect(ctx.hasMoodlet(awayActor, MOOD.panicking)).toBe(true);
    step(sim, FIRE_BURN_MINUTES * 4);
    expect(sim.state.objects[fire.id]).toBeUndefined();
    expect(sim.state.objects[target.id]).toBeUndefined();
    expect(sim.faults()).toEqual([]);
  });
});
