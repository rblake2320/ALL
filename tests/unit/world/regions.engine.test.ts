/**
 * W-025 S1: the region-aware engine core (src/sim/engine/regions.ts) on the engine fixtures — ownership rules, the
 * active set, the region scope behind `eng.spatial`, `ctx.regionOf / lotOf / homeRegionId`, commands and repair.
 * Home-only equivalence (AC-1) is proven separately against the pre-world engine (homeOnly.determinism*.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { SpatialAPI } from '../../../src/sim/contracts';
import type { LotState, WorldState } from '../../../src/sim/types';
import { fixtureRegistry, fixtureSim, member, newFixtureWorld, place, steps } from '../../../src/sim/engine/fixtures/world';
import { createFixtureLot, createFixtureSpatial } from '../../../src/sim/engine/fixtures/spatial';
import { activeRegions, agentRegion, isAgentInActiveRegion, objectRegion, registerRegion, unregisterRegion } from '../../../src/sim/engine/regions';
import { repairWorld } from '../../../src/sim/engine/repair';
import { canonicalStartPick, legacyTown, newTown } from '../../../src/shared/town';
import { LEGACY_HOME_LOT_ID } from '../../../src/shared/world';

function world(): WorldState {
  return newFixtureWorld({ seed: 31, lotTemplate: 'starter', members: [member('Mort'), member('Ghoulia')] });
}

/** The S1 registry mechanics with streaming frozen (S4 streaming would otherwise manage the active set itself). */
function frozenWorld(): WorldState {
  const w = world();
  w.town!.expandPending = true;
  return w;
}

/** A second region's services over its own lot and object map (stable view object, as S4 will build it). */
function secondRegion(state: () => WorldState, id: string) {
  const lot: LotState = createFixtureLot('empty').lot;
  const view = { get tick() { return state().tick; }, lot, objects: {}, agents: {} } as unknown as WorldState;
  const base = createFixtureSpatial(() => view, fixtureRegistry());
  let calls = 0;
  const spatial = new Proxy(base, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      return typeof v === 'function' ? (...a: unknown[]) => { calls++; return (v as (...x: unknown[]) => unknown).apply(t, a); } : v;
    },
  }) as SpatialAPI;
  return { service: { id, lot: () => lot, spatial }, calls: () => calls, lot };
}

describe('region-aware engine (S1)', () => {
  it('home-only: every agent and object is in the home region; ctx.regionOf / lotOf / homeRegionId', () => {
    const { sim } = fixtureSim(world());
    const ctx = sim.engine.ctx;
    const [a] = sim.state.household.memberIds;
    expect(ctx.homeRegionId()).toBe(LEGACY_HOME_LOT_ID);
    expect(ctx.regionOf(a)).toBe(LEGACY_HOME_LOT_ID);
    expect(ctx.regionOf('nobody')).toBeNull();
    expect(ctx.lotOf(LEGACY_HOME_LOT_ID)).toBe(sim.state.lot);
    expect(ctx.lotOf('wormwood:mildew_n3')).toBeNull();
    expect(activeRegions(sim.engine)).toEqual([LEGACY_HOME_LOT_ID]);
    for (const o of Object.values(sim.state.objects)) {
      expect(o.regionId).toBeUndefined();
      expect(objectRegion(sim.engine, o)).toBe(LEGACY_HOME_LOT_ID);
    }
    for (const ag of Object.values(sim.state.agents)) expect(ag.regionId).toBeUndefined();
    steps(sim, 400);
    for (const ag of Object.values(sim.state.agents)) expect('regionId' in ag).toBe(false);
    for (const o of Object.values(sim.state.objects)) expect('regionId' in o).toBe(false);
    expect(sim.engine.regions.scope).toBeNull();
    expect(sim.engine.spatial).toBe(sim.engine.regions.homeSpatial);
  });

  it('the home region follows town.homeLotId (a start pick at another slot); worlds without town use the legacy slot', () => {
    const w = newFixtureWorld({ seed: 5, lotTemplate: 'empty', startPick: { ...canonicalStartPick('empty'), slotId: 'mildew_s3' } });
    expect(w.town?.homeLotId).toBe('wormwood:mildew_s3');
    expect(w.town?.start?.slotId).toBe('mildew_s3');
    const { sim } = fixtureSim(w);
    expect(sim.engine.ctx.homeRegionId()).toBe('wormwood:mildew_s3');
    expect(sim.engine.ctx.regionOf(sim.state.household.memberIds[0])).toBe('wormwood:mildew_s3');
    const bare = world() as WorldState & { town?: unknown };
    delete bare.town;
    expect(fixtureSim(bare).sim.engine.ctx.homeRegionId()).toBe(LEGACY_HOME_LOT_ID);
  });

  it('an agent standing in a DORMANT region is not simulated, not on the lot list, and cannot be ordered', () => {
    const { sim } = fixtureSim(frozenWorld());
    const [a, b] = sim.state.household.memberIds;
    const away = sim.state.agents[b];
    away.regionId = 'wormwood:mildew_n3';
    const before = JSON.stringify(away);
    steps(sim, 240);
    expect(JSON.stringify(sim.state.agents[b])).toBe(before); // frozen (dormant regions are snapshots, §1.4)
    expect(sim.engine.ctx.agentsOnLot().map((x) => x.id)).toEqual([a]);
    expect(isAgentInActiveRegion(sim.engine, away)).toBe(false);
    const r = sim.dispatch({ type: 'queue', actorId: b, interactionId: 'engine_goHere', target: { kind: 'tile', x: 3, z: 3 } });
    expect(r).toEqual({ ok: false, reason: `${away.firstName} isn't here` });
    // a social with a partner in a DORMANT region is refused (S3 routes only through live regions; S4 streams them)
    const s = sim.dispatch({ type: 'queue', actorId: a, interactionId: 'fx_chat', target: { kind: 'agent', id: b } });
    expect(s.ok).toBe(false);
    // S4: with streaming live, a member is never left in a dormant region: the next tier evaluation brings it live
    sim.state.town!.expandPending = false;
    steps(sim, 4);
    expect(isAgentInActiveRegion(sim.engine, away)).toBe(true);
    expect(activeRegions(sim.engine)).toContain('wormwood:mildew_n3');
  });

  it('a registered region gets its own spatial service: its agents step there, the scope is restored after', () => {
    const { sim } = fixtureSim(frozenWorld());
    const eng = sim.engine;
    const [, b] = sim.state.household.memberIds;
    const R = 'wormwood:mildew_n3';
    const second = secondRegion(() => sim.state, R);
    registerRegion(eng, second.service);
    expect(activeRegions(eng)).toEqual([R, LEGACY_HOME_LOT_ID].sort());
    const ag = sim.state.agents[b];
    ag.regionId = R;
    ag.pos = { x: 15.5, z: 20.5 };
    ag.path = null;
    expect(sim.engine.ctx.lotOf(R)).toBe(second.lot);
    const ok = sim.dispatch({ type: 'queue', actorId: b, interactionId: 'engine_goHere', target: { kind: 'tile', x: 25, z: 5 } });
    expect(ok.ok).toBe(true);
    const callsAfterQueue = second.calls();
    expect(callsAfterQueue).toBeGreaterThan(0); // the command resolved in the actor's region
    for (let i = 0; i < 400 && !(Math.floor(ag.pos.x) === 25 && Math.floor(ag.pos.z) === 5); i++) sim.step();
    expect([Math.floor(ag.pos.x), Math.floor(ag.pos.z)]).toEqual([25, 5]); // walked on the second region's grid
    expect(second.calls()).toBeGreaterThan(callsAfterQueue);
    expect(eng.regions.scope).toBeNull();
    expect(agentRegion(eng, ag)).toBe(R);
    // an item spawned while that agent's region is in scope belongs to it; held items follow the holder
    const item = place(sim, 'chair_creaky', 3, 3);
    expect(item.regionId).toBeUndefined(); // spawned in the home scope (no field)
    unregisterRegion(eng, R);
    expect(activeRegions(eng)).toEqual([LEGACY_HOME_LOT_ID]);
    expect(isAgentInActiveRegion(eng, ag)).toBe(false);
  });

  it('a dropped item takes its holder\'s region; dropped at home it has no regionId; spawning clears a stale regionId', () => {
    const { sim } = fixtureSim(world());
    const eng = sim.engine;
    const ctx = eng.ctx;
    const [a, b] = sim.state.household.memberIds;
    const R = 'wormwood:mildew_s1';
    registerRegion(eng, secondRegion(() => sim.state, R).service);
    const holder = sim.state.agents[b];
    holder.regionId = R;
    holder.pos = { x: 10.5, z: 20.5 };
    const meal = ctx.spawnObject('item_meal', { kind: 'held', agentId: b });
    expect(meal.regionId).toBeUndefined();
    expect(objectRegion(eng, meal)).toBe(R); // held: the holder's region
    ctx.releaseHeld(holder, 'floor');
    expect(meal.placement.kind).toBe('loose');
    expect(meal.regionId).toBe(R);
    const homeItem = ctx.spawnObject('item_dish', { kind: 'held', agentId: a });
    ctx.releaseHeld(sim.state.agents[a], 'floor');
    expect('regionId' in homeItem).toBe(false);
    // despawn + spawn: the agent comes back onto the HOME lot (its sidewalk entry), the stale region is cleared
    ctx.despawnAgent(b, 'offLot');
    holder.regionId = R;
    ctx.spawnAgent(b);
    expect('regionId' in holder).toBe(false);
    expect(holder.pos.z).toBeGreaterThan(27);
  });

  it('repair: malformed regionId / town are removed with a warning; healthy schema-v2 worlds get zero warnings', () => {
    const healthy = world();
    expect(repairWorld(healthy, fixtureRegistry())).toEqual([]);
    const legacy = world();
    legacy.town = legacyTown(legacy.seed, legacy.tick);
    expect(repairWorld(legacy, fixtureRegistry())).toEqual([]);
    const bad = world() as WorldState & Record<string, unknown>;
    const [a] = bad.household.memberIds;
    (bad.agents[a] as unknown as Record<string, unknown>).regionId = 42;
    const oid = Object.keys(bad.objects)[0];
    (bad.objects[oid] as unknown as Record<string, unknown>).regionId = '';
    (bad as Record<string, unknown>).town = { v: 2, homeLotId: null };
    const w = repairWorld(bad, fixtureRegistry());
    expect(w).toEqual(expect.arrayContaining([expect.stringMatching(/neighbourhood data unreadable/), expect.stringMatching(new RegExp(`agent ${a}: invalid region`)), expect.stringMatching(new RegExp(`object ${oid}: invalid region`))]));
    expect('town' in bad).toBe(false);
    expect('regionId' in bad.agents[a]).toBe(false);
  });

  it('townExpand: refused without a town and on an open world; opens a migrated world exactly once', () => {
    const { sim } = fixtureSim(world());
    expect(sim.state.town?.expandPending).toBe(false);
    expect(sim.dispatch({ type: 'townExpand' })).toEqual({ ok: false, reason: 'The neighbourhood is already open' });
    const mig = world();
    mig.town = legacyTown(mig.seed, mig.tick);
    const m = fixtureSim(mig).sim;
    expect(m.dispatch({ type: 'townExpand' })).toEqual({ ok: true });
    expect(m.state.town?.expandPending).toBe(false);
    expect({ ...m.state.town, expandPending: true }).toEqual(legacyTown(mig.seed, mig.tick)); // nothing else changed
    expect(m.dispatch({ type: 'townExpand' }).ok).toBe(false);
    const bare = world() as WorldState & { town?: unknown };
    delete bare.town;
    expect(fixtureSim(bare).sim.dispatch({ type: 'townExpand' })).toEqual({ ok: false, reason: 'This world has no neighbourhood map' });
  });

  it('new worlds: town = newTown(seed, canonical pick); an unusable start pick is ignored; town creation draws no RNG', () => {
    const w = world();
    expect(w.town).toEqual(newTown(31, canonicalStartPick('starter')));
    const junk = newFixtureWorld({ seed: 31, lotTemplate: 'starter', members: [member('Mort'), member('Ghoulia')], startPick: { genVersion: 1, templateId: 'starter', slotId: 'mildew_x9', variantSeed: 0, neighbourSeed: 0, attempt: 0 } });
    expect(junk.town?.homeLotId).toBe(LEGACY_HOME_LOT_ID);
    const unknownTpl = newFixtureWorld({ seed: 31, lotTemplate: 'empty', startPick: { ...canonicalStartPick('mansion'), slotId: 'mildew_n4' } });
    expect(unknownTpl.town?.homeLotId).toBe(LEGACY_HOME_LOT_ID); // the pick names no shipped template: canonical
    expect(unknownTpl.town?.start?.templateId).toBe('empty');
    // the pick changes WHERE the lot is, never what is on it: same RNG, same household, same lot
    const moved = newFixtureWorld({ seed: 31, lotTemplate: 'starter', members: [member('Mort'), member('Ghoulia')], startPick: { ...canonicalStartPick('starter'), slotId: 'mildew_s2' } });
    const strip = (x: WorldState) => {
      const c = JSON.parse(JSON.stringify(x)) as WorldState & { town?: unknown };
      delete c.town;
      return c;
    };
    expect(moved.town?.homeLotId).toBe('wormwood:mildew_s2');
    expect(strip(moved)).toEqual(strip(w));
  });
});
