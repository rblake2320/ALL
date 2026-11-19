/**
 * AC-14 (route results are explained) and AC-11 (routing part: no route ever enters an unfinished region) — W-025 S3,
 * docs/DESIGN_WORLD_LEVELS.md §1.15 / §1.16, on the REAL engine. Every request returns either a route or exactly one
 * reason code (`noPath` / `private` / `locked` / `unfinished`), never throws, never changes the world, and the queue
 * command carries the same result (never a silent failure). The shape matches what Sol's S11 components accept
 * (`routeFeedback` on desktop/sol-world-a11y: target echoed with the requested region, integer local tile, string
 * portal ids, finite non-negative length / ETA).
 */
import { describe, expect, it } from 'vitest';
import type { WorldRouteResult } from '../../../src/shared/world';
import { REGION_MAX_TILES } from '../../../src/shared/world';
import { ROUTE_REASON_TEXT, cleanRouteTarget, decodeRoute, encodeRoute } from '../../../src/shared/worldRoute';
import { GRAVEYARD, HOME, N3, S2, goHere, laneWorld, stateHash } from './s3Harness';
import { gateObjectOf, regionDefOf, worldOf } from '../../../src/sim/engine/worldMove';
import { spatialOfRegion, withRegion } from '../../../src/sim/engine/regions';
import { spawnObject } from '../../../src/sim/engine/objects';
import type { Engine } from '../../../src/sim/engine/types';
import { blockingDef, indoorTile } from './s3Fixtures';

/** The S11 acceptance rule for a controller reply (mirrors `routeFeedback` in src/ui/world/interaction.ts of PR #59). */
function s11Accepts(r: WorldRouteResult, requestedRegion: string): boolean {
  const t = r.target;
  if (!t || typeof t.regionId !== 'string' || t.regionId !== requestedRegion) return false;
  if (!Number.isInteger(t.x) || !Number.isInteger(t.z) || t.x < 0 || t.z < 0 || t.x >= REGION_MAX_TILES || t.z >= REGION_MAX_TILES) return false;
  if (r.ok === false) return ['noPath', 'private', 'locked', 'unfinished'].includes(r.reason);
  return Array.isArray(r.portals) && r.portals.every((p) => typeof p === 'string' && p.length > 0) && Number.isFinite(r.lengthTiles) && r.lengthTiles >= 0 && Number.isFinite(r.etaGameMin) && r.etaGameMin >= 0;
}

function lockGate(eng: Engine, locked: boolean): void {
  const w = worldOf(eng)!;
  const p = w.map.portals.find((x) => x.id === 'gate:old_graveyard')!;
  const g = gateObjectOf(eng, p);
  if (g) {
    g.data.locked = locked;
    return;
  }
  withRegion(eng, GRAVEYARD, () => spawnObject(eng, blockingDef(eng), { kind: 'floor', x: 2, z: 2, rot: 0 }, { data: { gatePortal: p.id, locked, closed: true } }));
}

describe('route results (AC-14) on the real engine', () => {
  it('ok: a route with portals, length and ETA, accepted by the S11 rule; the queue command carries the same route', () => {
    const { sim, members } = laneWorld();
    const [a] = members;
    const r = sim.worldRoute!(a, { regionId: GRAVEYARD, x: 14, z: 20 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.portals[r.portals.length - 1]).toBe('gate:old_graveyard');
    expect(r.lengthTiles).toBeGreaterThan(60);
    expect(r.etaGameMin).toBeCloseTo(r.lengthTiles / 1.3, 1);
    expect(s11Accepts(r, GRAVEYARD)).toBe(true);
    const c = goHere(sim, a, { regionId: GRAVEYARD, x: 14, z: 20 });
    expect(c.ok).toBe(true);
    expect(c.route).toEqual(r);
    // same region: an ordinary local walk (no params, no route field: the pre-world path, byte for byte)
    const local = sim.dispatch({ type: 'queue', actorId: members[1], interactionId: 'engine_goHere', target: { kind: 'tile', x: 10, z: 20 } });
    expect(local.ok).toBe(true);
    expect(local.route).toBeUndefined();
  });

  it('private: a tile inside a neighbour\'s house without a welcome; the yard right outside is fine', () => {
    const { sim, eng, members } = laneWorld();
    const [a] = members;
    const inside = indoorTile(eng, N3);
    const r = sim.worldRoute!(a, { regionId: N3, ...inside });
    expect(r).toEqual({ ok: false, target: { regionId: N3, ...inside }, reason: 'private' });
    const c = goHere(sim, a, { regionId: N3, ...inside });
    expect(c).toEqual({ ok: false, reason: ROUTE_REASON_TEXT.private, route: r });
    expect(sim.state.agents[a].queue.length + (sim.state.agents[a].active ? 1 : 0)).toBe(0);
    expect(sim.worldRoute!(a, { regionId: N3, x: 5, z: 25 }).ok).toBe(true);
  });

  it('locked: the graveyard gate locked (a closed but unlocked gate is fine); a locked district', () => {
    const { sim, eng, members } = laneWorld();
    const [a] = members;
    const t = { regionId: GRAVEYARD, x: 14, z: 20 };
    lockGate(eng, false);
    expect(sim.worldRoute!(a, t).ok).toBe(true); // closed gates open on approach
    lockGate(eng, true);
    expect(sim.worldRoute!(a, t)).toEqual({ ok: false, target: t, reason: 'locked' });
    expect(goHere(sim, a, t)).toMatchObject({ ok: false, reason: ROUTE_REASON_TEXT.locked });
    lockGate(eng, false);
    expect(sim.worldRoute!(a, t).ok).toBe(true);
    // the Old Graveyard's level not unlocked yet → the whole district is locked
    sim.state.town!.unlockedLevels = ['wormwood'];
    expect(sim.worldRoute!(a, t)).toEqual({ ok: false, target: t, reason: 'locked' });
  });

  it('unfinished: every unfinished area, whatever tile', () => {
    const { sim, members } = laneWorld();
    const [a] = members;
    for (const id of ['unfinished:wormwood_north', 'unfinished:rotrow_tram', 'unfinished:bayou_road', 'unfinished:mausoleum_hills']) {
      const r = sim.worldRoute!(a, { regionId: id, x: 3, z: 3 });
      expect(r).toEqual({ ok: false, target: { regionId: id, x: 3, z: 3 }, reason: 'unfinished' });
      expect(goHere(sim, a, { regionId: id, x: 3, z: 3 })).toMatchObject({ ok: false, reason: 'Under construction' });
    }
    // a world tile inside one (params.wx / wz) resolves to the same answer
    const c = sim.dispatch({ type: 'queue', actorId: a, interactionId: 'engine_goHere', target: { kind: 'tile', x: 0, z: 0 }, params: { wx: 100, wz: -10 } });
    expect(c).toMatchObject({ ok: false, route: { ok: false, reason: 'unfinished', target: { regionId: 'unfinished:wormwood_north' } } });
  });

  it('noPath: an island (an active lot with its only exits blocked), a dormant region, a tile outside the region', () => {
    const { sim, eng, members } = laneWorld();
    const [a] = members;
    // S2 is active; block its crosswalk tiles and its sidewalk portal tile to s1 (s3 side is dormant anyway)
    const def = blockingDef(eng);
    withRegion(eng, S2, () => {
      for (const [x, z] of [[14, 29], [15, 29], [0, 28], [29, 28]]) spawnObject(eng, def, { kind: 'floor', x, z, rot: 0 });
    });
    expect(spatialOfRegion(eng, S2)!.isWalkable(14, 29)).toBe(false);
    expect(sim.worldRoute!(a, { regionId: S2, x: 10, z: 20 })).toEqual({ ok: false, target: { regionId: S2, x: 10, z: 20 }, reason: 'noPath' });
    // S4: DORMANT regions are planned over (their snapshot / regenerated grid) and activate as the walker approaches,
    // so the corner park and the far south lot are routes now (S3 answered noPath here)
    expect(sim.worldRoute!(a, { regionId: 'wormwood:corner_park', x: 10, z: 10 })).toMatchObject({ ok: true });
    expect(sim.worldRoute!(a, { regionId: 'wormwood:mildew_s4', x: 10, z: 10 })).toMatchObject({ ok: true });
    // outside the region's own grid (a street is 10 deep)
    expect(sim.worldRoute!(a, { regionId: 'street:mildew:2', x: 3, z: 12 })).toMatchObject({ ok: false, reason: 'noPath' });
    const c = goHere(sim, a, { regionId: S2, x: 10, z: 20 });
    expect(c).toMatchObject({ ok: false, reason: "Can't get there", route: { ok: false, reason: 'noPath' } });
  });

  it('garbage input: never throws, never changes the world, always one well-formed noPath', () => {
    const { sim, members } = laneWorld();
    const [a] = members;
    const before = stateHash(sim.state);
    const junk: unknown[] = [
      null, undefined, 0, 'x', [], {}, { regionId: 5, x: 1, z: 1 }, { regionId: '', x: 1, z: 1 }, { regionId: HOME, x: 1.5, z: 1 },
      { regionId: HOME, x: NaN, z: 1 }, { regionId: HOME, x: -1, z: 1 }, { regionId: HOME, x: 1e9, z: 1 }, { regionId: HOME, x: Infinity, z: 1 },
      { regionId: 'nowhere:at_all', x: 1, z: 1 }, { regionId: '__proto__', x: 1, z: 1 }, { regionId: 'x'.repeat(5000), x: 1, z: 1 },
      { regionId: HOME, x: '1', z: '1' }, Object.create(null), { regionId: HOME }, { x: 1, z: 1 },
    ];
    for (const t of junk) {
      const r = sim.worldRoute!(a, t as never);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('noPath');
      expect(typeof r.target.regionId).toBe('string');
      expect(Number.isInteger(r.target.x) && Number.isInteger(r.target.z)).toBe(true);
    }
    // unknown / non-member / garbage actors
    for (const who of ['nobody', '', 42, null]) expect(sim.worldRoute!(who as never, { regionId: GRAVEYARD, x: 14, z: 20 })).toMatchObject({ ok: false, reason: 'noPath' });
    // garbage queue params
    const bad: Record<string, unknown>[] = [{ regionId: 42 }, { regionId: '' }, { wx: NaN, wz: 1 }, { wx: 1e12, wz: 1e12 }, { regionId: 'nowhere:x' }, { regionId: GRAVEYARD, _wg: HOME }];
    for (const params of bad) {
      const r = sim.dispatch({ type: 'queue', actorId: a, interactionId: 'engine_goHere', target: { kind: 'tile', x: 3, z: 3 }, params: params as never });
      expect(typeof r.ok).toBe('boolean');
      if (!r.ok) expect(typeof r.reason).toBe('string');
    }
    // the {regionId: 42} / '' / NaN params are ignored (a local walk); nowhere:x refused with a route result
    expect(sim.dispatch({ type: 'queue', actorId: a, interactionId: 'engine_goHere', target: { kind: 'tile', x: 3, z: 3 }, params: { regionId: 'nowhere:x' } })).toMatchObject({ ok: false, route: { reason: 'noPath' } });
    sim.dispatch({ type: 'cancel', actorId: a, uid: sim.state.agents[a].active?.uid ?? -1 });
    expect(sim.faults()).toEqual([]);
    // route codec rejects garbage
    for (const s of [5, 'a@c', '@a', 'x', 'p@a|', null]) expect(decodeRoute(s)).toBeNull();
    expect(decodeRoute(encodeRoute([{ portalId: 'gate:old_graveyard', from: 'b' }]))).toEqual([{ portalId: 'gate:old_graveyard', from: 'b' }]);
    expect(cleanRouteTarget({ regionId: HOME, x: 255, z: 0 })).toEqual({ regionId: HOME, x: 255, z: 0 });
    expect(cleanRouteTarget({ regionId: HOME, x: 256, z: 0 })).toBeNull();
  });

  it('a pure query: planning changes nothing in the saved world', () => {
    const { sim, members } = laneWorld();
    const before = stateHash(sim.state);
    for (const t of [{ regionId: GRAVEYARD, x: 14, z: 20 }, { regionId: N3, x: 5, z: 25 }, { regionId: S2, x: 4, z: 4 }, { regionId: 'unfinished:bayou_road', x: 1, z: 1 }]) sim.worldRoute!(members[0], t);
    expect(stateHash(sim.state)).toBe(before);
  });

  it('AC-11 routing: 1,000 random targets — every unfinished one is refused as unfinished, no route ever enters one, every reply passes the S11 rule', () => {
    const { sim, eng, members } = laneWorld();
    const [a] = members;
    const w = worldOf(eng)!;
    const unfinished = new Set(w.map.regions.filter((r) => r.kind === 'unfinished').map((r) => r.id));
    // portals never touch an unfinished region in the shipped map
    for (const p of w.map.portals) expect(unfinished.has(p.a.regionId) || unfinished.has(p.b.regionId)).toBe(false);
    let seed = 0x5eed;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const def = w.map.regions[rnd(w.map.regions.length)];
      const t = { regionId: def.id, x: rnd(def.placement.width), z: rnd(def.placement.depth) };
      const r = sim.worldRoute!(a, t);
      expect(s11Accepts(r, def.id)).toBe(true);
      const key = r.ok ? 'ok' : r.reason;
      counts[key] = (counts[key] ?? 0) + 1;
      if (unfinished.has(def.id)) expect(r).toMatchObject({ ok: false, reason: 'unfinished' });
      if (r.ok) for (const pid of r.portals) {
        const p = w.map.portals.find((x) => x.id === pid)!;
        expect(unfinished.has(p.a.regionId) || unfinished.has(p.b.regionId)).toBe(false);
      }
      expect(regionDefOf(eng, t.regionId)).not.toBeNull();
    }
    // eslint-disable-next-line no-console
    console.log(`[AC-11] 1000 random targets: ${JSON.stringify(counts)}`);
    expect(counts.ok).toBeGreaterThan(100);
    expect(counts.unfinished).toBeGreaterThan(50);
  });
});
