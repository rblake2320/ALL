/**
 * Boundary crossing, gates, doors and curbs — W-025 S3 (docs/DESIGN_WORLD_LEVELS.md §1.5, §1.7), adversarial, on the
 * REAL engine: a portal blocked by a placed object (before planning and while walking), a gate locked mid-walk, a
 * neighbour's private interior (public / resident step masks, knock → welcome, expiry), an agent selected and
 * re-ordered in the middle of a crossing, and two agents crossing the same one-tile portal.
 */
import { describe, expect, it } from 'vitest';
import { TICKS_PER_HOUR } from '../../../src/sim/types';
import { GRAVEYARD, HOME, N3, goHere, laneWorld, runUntilIdle, tileOfAgent } from './s3Harness';
import { blockingDef, frontDoor, indoorTile } from './s3Fixtures';
import { agentRegion, isRegionActive, maskFor, spatialOfRegion, withRegion } from '../../../src/sim/engine/regions';
import { thawRegion } from '../../../src/sim/engine/streaming';
import { spawnObject } from '../../../src/sim/engine/objects';
import { gateObjectOf, worldOf } from '../../../src/sim/engine/worldMove';
import { setRegionResidents } from '../../../src/sim/engine/regionSetup';
import { ENGINE_INTERACTIONS } from '../../../src/sim/vocabulary';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import type { Engine } from '../../../src/sim/engine/types';
import { relKey } from '../../../src/sim/engine/context';

function block(eng: Engine, regionId: string, tiles: [number, number][]): void {
  const def = blockingDef(eng);
  // S4: streaming may have frozen the region meanwhile; wake it so the objects land in its grid (it freezes them later)
  if (!isRegionActive(eng, regionId)) expect(thawRegion(eng, regionId)).toBe(true);
  withRegion(eng, regionId, () => {
    for (const [x, z] of tiles) spawnObject(eng, def, { kind: 'floor', x, z, rot: 0 });
  });
}

function setHour(sim: EngineSimulation, hour: number): void {
  // jump the clock to the next `hour`:00 by stepping (the sim clock is never set directly)
  for (let i = 0; i < 24 * TICKS_PER_HOUR && sim.time().hour !== hour; i++) sim.step();
  sim.drainEvents();
}

/**
 * Someone who lives in (and stands in) region `id`. The townie homes and schedules are S6; until then the resident
 * list is supplied through the S6 seam (`setRegionResidents`) and the third household member stands in for the
 * neighbour (townies off their schedule are tidied away by the visitor systems, which is S6's business).
 */
function resident(sim: EngineSimulation, id: string, at: { x: number; z: number }): string {
  const eng = sim.engine;
  const t = sim.state.agents[sim.state.household.memberIds[2]];
  t.regionId = id;
  t.pos = { x: at.x + 0.5, z: at.z + 0.5 };
  t.prevPos = { ...t.pos };
  t.path = null;
  t.active = null;
  t.queue = [];
  expect(setRegionResidents(eng, id, () => [t.id])).toBe(true);
  return t.id;
}

describe('crossing portals (S3)', () => {
  it('a portal blocked by a placed object: the plan avoids it; blocked while walking, the walker re-plans another way', () => {
    const { sim, eng, members } = laneWorld();
    const [a, b] = members;
    // home's own crosswalk (both tiles) blocked → the street is reached through the neighbour's sidewalk instead
    block(eng, HOME, [[14, 29], [15, 29]]);
    const r = sim.worldRoute!(a, { regionId: 'street:mildew:2', x: 15, z: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.portals).not.toContain('crosswalk:mildew_n2');
      expect(r.portals[0]).toMatch(/^sidewalk:mildew_n/);
    }
    expect(goHere(sim, a, { regionId: 'street:mildew:2', x: 15, z: 5 }).ok).toBe(true);
    const log = runUntilIdle(sim, a);
    expect(log.failed).toEqual([]);
    expect(tileOfAgent(eng, sim.state.agents[a])).toEqual({ regionId: 'street:mildew:2', x: 15, z: 5 });
    // mid-walk: b heads for the graveyard; when b is in the street, the next street join is blocked on every row
    expect(goHere(sim, b, { regionId: GRAVEYARD, x: 14, z: 20 }).ok).toBe(true);
    let blockedAt = -1;
    const log2 = runUntilIdle(sim, b, 4000, () => {
      if (blockedAt < 0 && agentRegion(eng, sim.state.agents[b]) === 'street:mildew:3') {
        blockedAt = sim.state.tick;
        // the whole 4→5 join on the street-5 side except one road row (4): still passable, only that row
        block(eng, 'street:mildew:5', [0, 1, 2, 3, 5, 6, 7, 8, 9].map((z) => [0, z] as [number, number]));
      }
    });
    expect(blockedAt).toBeGreaterThan(0);
    expect(log2.failed).toEqual([]);
    expect(tileOfAgent(eng, sim.state.agents[b])).toEqual({ regionId: GRAVEYARD, x: 14, z: 20 });
    const into5 = log2.crossings.find((c) => c.to === 'street:mildew:5')!;
    expect(into5.portalId).toBe('crosswalk:street_mildew_4-5');
    // and fully blocked: the graveyard is now unreachable → noPath, with the reason in the command result
    block(eng, 'street:mildew:5', [[0, 4]]);
    expect(sim.worldRoute!(a, { regionId: GRAVEYARD, x: 14, z: 20 })).toMatchObject({ ok: false, reason: 'noPath' });
    expect(sim.faults()).toEqual([]);
  });

  it('a gate locked while the walker is on the way: the walk stops at the gate with "It\'s closed"; unlocked, it goes through', () => {
    const { sim, eng, members } = laneWorld();
    const [a] = members;
    const gate = worldOf(eng)!.map.portals.find((p) => p.id === 'gate:old_graveyard')!;
    withRegion(eng, GRAVEYARD, () => spawnObject(eng, blockingDef(eng), { kind: 'floor', x: 2, z: 2, rot: 0 }, { data: { gatePortal: gate.id, closed: true, locked: false } }));
    const g = gateObjectOf(eng, gate)!;
    expect(goHere(sim, a, { regionId: GRAVEYARD, x: 14, z: 20 }).ok).toBe(true);
    const log = runUntilIdle(sim, a, 4000, () => {
      if (agentRegion(eng, sim.state.agents[a]) === 'street:mildew:5') g.data.locked = true;
    });
    expect(log.failed).toEqual(["It's closed"]);
    expect(agentRegion(eng, sim.state.agents[a])).toBe('street:mildew:5');
    expect(log.crossings.some((c) => c.portalId === gate.id)).toBe(false);
    expect(sim.checkInvariants()).toEqual([]);
    g.data.locked = false;
    expect(goHere(sim, a, { regionId: GRAVEYARD, x: 14, z: 20 }).ok).toBe(true);
    const log2 = runUntilIdle(sim, a);
    expect(log2.crossings.map((c) => c.portalId)).toEqual([gate.id]);
    expect(tileOfAgent(eng, sim.state.agents[a])).toEqual({ regionId: GRAVEYARD, x: 14, z: 20 });
  });

  it('door privacy: the house is closed in the public mask; knock → accepted → welcomed in for 2 h; refusals explain why', () => {
    const { sim, eng, members } = laneWorld();
    const [a, b] = members;
    const inside = indoorTile(eng, N3);
    const door = frontDoor(eng, N3);
    expect(sim.menu(a, { kind: 'object', id: door.id }).map((e) => e.interactionId)).toContain(ENGINE_INTERACTIONS.knock);
    // public mask: walk into the yard fine, the house refuses
    expect(sim.worldRoute!(a, { regionId: N3, ...inside })).toMatchObject({ ok: false, reason: 'private' });
    expect(spatialOfRegion(eng, N3, 'public')!.distanceField({ x: 5.5, z: 25.5 }).dist[spatialOfRegion(eng, N3)!.tileIndex(inside.x, inside.z)]).toBe(Infinity);
    // nobody home → "Nobody answered"
    setHour(sim, 10);
    const knock = (who: string) => sim.dispatch({ type: 'queue', actorId: who, interactionId: ENGINE_INTERACTIONS.knock, target: { kind: 'object', id: door.id } });
    const k0 = knock(a);
    expect(k0.ok).toBe(true);
    expect(k0.route && k0.route.ok).toBe(true); // walked there from home: the knock routes first
    runUntilIdle(sim, a);
    expect(sim.state.agents[a].welcome).toBeUndefined();
    expect(sim.state.notifications.some((n) => n.text === 'Nobody answered the door')).toBe(true);
    expect(agentRegion(eng, sim.state.agents[a])).toBe(N3);
    // a resident is home; b is disliked → refused; a is welcome
    const host = resident(sim, N3, { x: 8, z: 22 });
    sim.state.relationships[relKey(host, b)] = { ...(sim.state.relationships[relKey(host, b)] ?? { a: host < b ? host : b, b: host < b ? b : host, romance: 0, met: true, partners: false, engaged: false, married: false, bestFriends: false, lastInteractionTick: 0, interactions: 1 }), friendship: -40 };
    setHour(sim, 11);
    expect(knock(b).ok).toBe(true);
    runUntilIdle(sim, b);
    expect(sim.state.agents[b].welcome).toBeUndefined();
    expect(sim.state.notifications[sim.state.notifications.length - 1].text).toMatch(/won't let you in$/);
    expect(knock(a).ok).toBe(true);
    runUntilIdle(sim, a);
    const w = sim.state.agents[a].welcome!;
    expect(w.regionId).toBe(N3);
    expect(w.untilTick - sim.state.tick).toBeGreaterThan(TICKS_PER_HOUR * 1.9);
    expect(maskFor(eng, sim.state.agents[a], N3)).toBe('resident');
    expect(maskFor(eng, sim.state.agents[b], N3)).toBe('public');
    // welcomed: the interior is a route now, and a walks in
    expect(sim.worldRoute!(a, { regionId: N3, ...inside }).ok).toBe(true);
    expect(sim.worldRoute!(b, { regionId: N3, ...inside })).toMatchObject({ ok: false, reason: 'private' });
    expect(goHere(sim, a, { regionId: N3, ...inside }).ok).toBe(true);
    runUntilIdle(sim, a);
    expect(tileOfAgent(eng, sim.state.agents[a])).toEqual({ regionId: N3, ...inside });
    // the welcome runs out while inside: still the resident mask until a leaves (never trapped, never teleported)
    for (let i = 0; i < 2 * TICKS_PER_HOUR + 10; i++) sim.step();
    expect(sim.state.agents[a].welcome!.untilTick).toBeLessThan(sim.state.tick);
    expect(maskFor(eng, sim.state.agents[a], N3)).toBe('resident');
    expect(tileOfAgent(eng, sim.state.agents[a])).toEqual({ regionId: N3, ...inside });
    expect(goHere(sim, a, { regionId: HOME, x: 15, z: 20 }).ok).toBe(true);
    runUntilIdle(sim, a);
    expect(tileOfAgent(eng, sim.state.agents[a])).toEqual({ regionId: HOME, x: 15, z: 20 });
    expect(sim.worldRoute!(a, { regionId: N3, ...inside })).toMatchObject({ ok: false, reason: 'private' }); // expired
    // too late at night: refused even for a friend
    setHour(sim, 22);
    expect(knock(a).ok).toBe(true);
    runUntilIdle(sim, a);
    expect(sim.state.agents[a].welcome!.untilTick).toBeLessThan(sim.state.tick);
    expect(sim.state.notifications[sim.state.notifications.length - 1].text).toMatch(/^Too late to call/);
    expect(sim.faults()).toEqual([]);
    // the home's doors cannot be knocked on, and a knock needs a door
    const homeDoor = Object.values(sim.state.objects).find((o) => o.regionId === undefined && o.placement.kind === 'opening');
    if (homeDoor) expect(sim.dispatch({ type: 'queue', actorId: a, interactionId: ENGINE_INTERACTIONS.knock, target: { kind: 'object', id: homeDoor.id } }).ok).toBe(false);
  });

  it('an agent selected and re-ordered in the middle of a crossing keeps its identity, queue and a valid plan', () => {
    const { sim, eng, members } = laneWorld();
    const [a] = members;
    expect(goHere(sim, a, { regionId: N3, x: 5, z: 25 }).ok).toBe(true);
    expect(goHere(sim, a, { regionId: N3, x: 8, z: 25 }).ok).toBe(true); // queued behind
    let checked = false;
    const log = runUntilIdle(sim, a, 3000, (tick) => {
      if (checked) return;
      const ag = sim.state.agents[a];
      if (agentRegion(eng, ag) !== N3) return;
      checked = true;
      // the crossing tick: the selection views resolve, the queue is intact, the new region is reported
      expect(sim.engine.ctx.regionOf(a)).toBe(N3);
      expect(sim.summary(a)?.id).toBe(a);
      expect(sim.queueView(a).length).toBe(2);
      // a fresh order given right now plans from the new region (no portal needed to its own yard)
      const r = sim.worldRoute!(a, { regionId: N3, x: 3, z: 20 });
      expect(r).toMatchObject({ ok: true, portals: [] });
      const back = sim.worldRoute!(a, { regionId: HOME, x: 15, z: 20 });
      expect(back).toMatchObject({ ok: true, portals: ['sidewalk:mildew_n2-n3'] });
      void tick;
    });
    expect(checked).toBe(true);
    expect(tileOfAgent(eng, sim.state.agents[a])).toEqual({ regionId: N3, x: 8, z: 25 });
    expect(log.failed).toEqual([]);
  });

  it('two agents crossing the same one-tile portal at the same time both make it, in id order, deterministically', () => {
    const run = () => {
      const { sim, eng, members } = laneWorld();
      const [a, b] = members;
      expect(goHere(sim, a, { regionId: N3, x: 5, z: 25 }).ok).toBe(true);
      expect(goHere(sim, b, { regionId: N3, x: 6, z: 26 }).ok).toBe(true);
      const crossings: { tick: number; agentId: string; portalId: string }[] = [];
      for (let i = 0; i < 1500; i++) {
        sim.step();
        for (const e of sim.drainEvents()) if (e.type === 'regionCrossed') crossings.push({ tick: sim.state.tick, agentId: e.agentId, portalId: e.portalId });
        if (members.every((m) => !sim.state.agents[m].active && sim.state.agents[m].queue.length === 0)) break;
      }
      expect(tileOfAgent(eng, sim.state.agents[a])).toEqual({ regionId: N3, x: 5, z: 25 });
      expect(tileOfAgent(eng, sim.state.agents[b])).toEqual({ regionId: N3, x: 6, z: 26 });
      expect(sim.checkInvariants()).toEqual([]);
      expect(sim.faults()).toEqual([]);
      return crossings;
    };
    const c1 = run();
    expect(c1.map((c) => c.portalId)).toEqual(['sidewalk:mildew_n2-n3', 'sidewalk:mildew_n2-n3']);
    expect(new Set(c1.map((c) => c.agentId)).size).toBe(2);
    expect(run()).toEqual(c1);
  });
});
