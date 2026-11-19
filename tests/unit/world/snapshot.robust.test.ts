/**
 * W-025 S4 snapshots under abuse (docs/DESIGN_WORLD_LEVELS.md §1.11, AC-12), real engine:
 *  - a corrupted snapshot is repaired or dropped with a note, never a crash: damaged lot (dropped → rebuilt), objects
 *    that are not a map, objects with unknown defs / bad placements / mismatched ids / ids already in the world,
 *    loose items whose surface is gone, NaN / future watermarks, damaged absent-resident data; and on LOAD, an active
 *    region whose live lot is damaged (set dormant with a repair warning);
 *  - planning over a dormant region sees its frozen objects (a frozen blocker still blocks the route);
 *  - the size budget under heavy use: a street stuffed with litter is trimmed to its 8 KB limit at freeze; every
 *    region of Mildew Lane + the graveyard visited and heavily furnished stays ≤ 2 MB; over the 4 MB cap the oldest
 *    never-modified snapshots go first (modified / home / owned never), deterministically;
 *  - A5: hashing the save payload (`savePayloadSha256`) at ≈ 0.35 / 2 / 4 MB, timed.
 */
import { describe, expect, it } from 'vitest';
import type { ObjectState } from '../../../src/sim/types';
import { MB, SAVE_BUDGET, SNAPSHOT_MODIFIED_KEY, capWorldSize, jsonBytes, measureWorld } from '../../../src/shared/worldBudget';
import { savePayloadSha256 } from '../../../src/persistence/saveManager';
import { createSimulation } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { freezeRegion, streamNotes, thawRegion } from '../../../src/sim/engine/streaming';
import { isRegionActive, planningServiceOf, planningSpatialOf, spatialOfRegion, withRegion } from '../../../src/sim/engine/regions';
import { spawnObject } from '../../../src/sim/engine/objects';
import { blockingDef } from './s3Fixtures';
import { HOME, N3, STREETS } from './s3Harness';
import { saveAndLoad, streamWorld, wire } from './s4Harness';

function frozenN3(): { sim: EngineSimulation; ids: string[] } {
  const { sim, eng } = streamWorld({ seed: 21 });
  sim.step();
  expect(isRegionActive(eng, N3)).toBe(true);
  expect(freezeRegion(eng, N3)).toBe(true);
  const ids = Object.keys(sim.state.town!.regions[N3].snapshot!.objects as object).sort();
  expect(ids.length).toBeGreaterThan(10);
  return { sim, ids };
}

describe('corrupted snapshots are repaired or dropped with a note, never a crash', () => {
  it('damaged objects: each one dropped / repaired with its own note; the region thaws and works', () => {
    const { sim, ids } = frozenN3();
    const eng = sim.engine;
    const rec = sim.state.town!.regions[N3];
    const objs = rec.snapshot!.objects as Record<string, unknown>;
    const [o1, o2, o3, o4, o5] = ids;
    (objs[o1] as ObjectState).defId = 'no_such_def';
    (objs[o2] as ObjectState).placement = { kind: 'floor', x: 99, z: -3, rot: 7 } as unknown as ObjectState['placement'];
    objs[o3] = 'garbage';
    (objs[o4] as ObjectState).id = 'o_not_me';
    // an id clash with an object already in the world (e.g. a hand-edited save)
    sim.state.objects[o5] = { ...(objs[o5] as ObjectState), regionId: undefined };
    delete (sim.state.objects[o5] as Partial<ObjectState>).regionId;
    // damaged bookkeeping
    rec.caughtUpTick = NaN;
    rec.snapshot!.savedTick = -4;
    rec.snapshot!.data.residents = 'nope' as unknown as Record<string, unknown>;
    const survivors = ids.filter((k) => ![o1, o2, o3, o4, o5].includes(k));
    expect(() => thawRegion(eng, N3)).not.toThrow();
    expect(isRegionActive(eng, N3)).toBe(true);
    for (const k of survivors) expect(sim.state.objects[k]?.regionId).toBe(N3);
    for (const k of [o1, o2, o3, o4]) expect(sim.state.objects[k]).toBeUndefined();
    expect(sim.state.objects[o5].regionId).toBeUndefined(); // the world's own object is untouched
    const notes = streamNotes(eng).join('\n');
    for (const want of [`object ${o1} dropped (unknown def`, `object ${o2} dropped (bad placement)`, `object ${o3} dropped (not an object)`, `object ${o4} dropped (id does not match`, `object ${o5} dropped (its id is already used`, 'watermark', 'savedTick', "absent residents' needs dropped"]) expect(notes).toContain(want);
    expect(sim.faults()).toEqual([]);
    for (let i = 0; i < 40; i++) sim.step();
    expect(sim.faults()).toEqual([]);
  });

  it('a damaged lot or a non-map object list: the snapshot is dropped and the region is rebuilt from the seed', () => {
    for (const damage of ['lot', 'objects'] as const) {
      const { sim } = frozenN3();
      const eng = sim.engine;
      const rec = sim.state.town!.regions[N3];
      if (damage === 'lot') (rec.snapshot as { lot: unknown }).lot = { width: 30, depth: 'x' };
      else (rec.snapshot as { objects: unknown }).objects = [1, 2, 3];
      expect(() => thawRegion(eng, N3)).not.toThrow();
      expect(isRegionActive(eng, N3)).toBe(true);
      expect(spatialOfRegion(eng, N3)!.isWalkable(14, 28)).toBe(true);
      expect(streamNotes(eng).join('\n')).toContain(damage === 'lot' ? 'snapshot lot is damaged; snapshot dropped' : 'snapshot objects were not a map');
      expect(sim.faults()).toEqual([]);
    }
  });

  it('a loose item whose surface is gone falls to the floor (note), instead of floating', () => {
    const { sim } = frozenN3();
    const objs = sim.state.town!.regions[N3].snapshot!.objects as Record<string, ObjectState>;
    objs.o_plate = { ...Object.values(objs)[0], id: 'o_plate', defId: 'item_dish', placement: { kind: 'loose', x: 5.5, z: 25.5, y: 0.8, parentId: 'o_gone', surfaceIndex: 0, facing: 0 } };
    expect(thawRegion(sim.engine, N3)).toBe(true);
    expect(sim.state.objects.o_plate.placement).toMatchObject({ kind: 'loose', parentId: null, y: 0 });
    expect(streamNotes(sim.engine).join('\n')).toContain('o_plate lost its surface');
  });

  it('on load: an active region with a damaged live lot is set dormant with a repair warning (and rebuilt later)', async () => {
    const { sim } = streamWorld({ seed: 22 });
    for (let i = 0; i < 4; i++) sim.step();
    expect(sim.state.town!.stream.active).toContain(N3);
    const world = JSON.parse(JSON.stringify(sim.state));
    // a hand-damaged save that still passes the structural schema: the lot's floors are short
    world.town.regions[N3].snapshot.lot.floors = world.town.regions[N3].snapshot.lot.floors.slice(0, 10);
    const direct = wire(createSimulation(world) as unknown as EngineSimulation);
    expect(direct.state.town!.stream.active).not.toContain(N3);
    expect(direct.repairWarnings.join('\n')).toContain(`${N3}: listed active but its lot is missing or damaged`);
    expect(Object.values(direct.state.objects).some((o) => o.regionId === N3)).toBe(false);
    for (let i = 0; i < 4 * 40; i++) direct.step(); // past the dwell of its last tier change
    expect(isRegionActive(direct.engine, N3)).toBe(true); // rebuilt by streaming (still within 45 tiles)
    expect(direct.faults()).toEqual([]);
    // through the real SaveManager as well: never a crash, the world loads
    const loaded = await saveAndLoad(world);
    expect(loaded.sim.faults()).toEqual([]);
  });

  it('privacy holds while dormant: a frozen neighbour house is never a through-route; its interior is `private`', () => {
    const { sim } = streamWorld({ seed: 27 });
    const eng = sim.engine;
    sim.step();
    expect(freezeRegion(eng, N3)).toBe(true);
    const [a] = sim.state.household.memberIds;
    const svc = planningServiceOf(eng, N3)!;
    expect(svc.publicSpatial).toBeDefined(); // the dormant house carries the public mask too
    // an indoor tile of the frozen house: refused as private (the yard right outside is fine)
    let inside: { x: number; z: number } | null = null;
    for (let z = 0; z < 30 && !inside; z++) for (let x = 0; x < 30 && !inside; x++) if (svc.spatial.isIndoor(x, z) && svc.spatial.isWalkable(x, z)) inside = { x, z };
    expect(inside).not.toBeNull();
    expect(sim.worldRoute!(a, { regionId: N3, ...inside! })).toMatchObject({ ok: false, reason: 'private' });
    expect(sim.worldRoute!(a, { regionId: N3, x: 5, z: 25 })).toMatchObject({ ok: true });
    // every planned through-route crossing n3 stays outdoors: walk the public mask's leg tiles of a route past n3
    const pub = svc.publicSpatial!;
    for (let z = 0; z < 30; z++) for (let x = 0; x < 30; x++) if (pub.isIndoor(x, z)) expect(pub.isWalkable(x, z) && pub.distanceField({ x: 14.5, z: 28.5 }).dist[pub.tileIndex(x, z)] < Infinity).toBe(false);
  });

  it('planning over a dormant region sees its frozen objects', () => {
    const { sim } = streamWorld({ seed: 23 });
    const eng = sim.engine;
    sim.step();
    withRegion(eng, N3, () => spawnObject(eng, blockingDef(eng), { kind: 'floor', x: 2, z: 28, rot: 0 }));
    expect(freezeRegion(eng, N3)).toBe(true);
    const plan = planningSpatialOf(eng, N3)!;
    expect(plan).not.toBeNull();
    expect(plan.isWalkable(2, 28)).toBe(false);
    expect(plan.isWalkable(5, 28)).toBe(true);
    // a never-built far region is plannable too (its regenerated grid), but owns no world object
    expect(planningSpatialOf(eng, 'wormwood:corner_park')!.isWalkable(15, 28)).toBe(true);
    expect(planningSpatialOf(eng, 'unfinished:wormwood_north')).toBeNull();
  });
});

describe('AC-12 size budget under heavy use', () => {
  it('a street stuffed with litter is trimmed to its 8 KB limit when it freezes (note)', () => {
    const { sim } = streamWorld({ seed: 24 });
    const eng = sim.engine;
    sim.step();
    const st = STREETS[1];
    expect(isRegionActive(eng, st)).toBe(true);
    withRegion(eng, st, () => {
      for (let i = 0; i < 120; i++) spawnObject(eng, 'item_dish', { kind: 'loose', x: 1.5 + (i % 28), z: 1.5 + Math.floor(i / 28) * 0.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 });
    });
    expect(freezeRegion(eng, st)).toBe(true);
    const snap = sim.state.town!.regions[st].snapshot!;
    expect(jsonBytes(snap)).toBeLessThanOrEqual(SAVE_BUDGET.streetMax);
    expect(streamNotes(eng).join('\n')).toMatch(/street:mildew:1: snapshot over its 8192-byte limit; \d+ loose item\(s\) cleared/);
    expect(snap.data[SNAPSHOT_MODIFIED_KEY]).toBe(sim.state.tick); // the player changed it (litter): modified
  });

  it('every live region heavily furnished, then frozen: ≤ 2 MB, snapshots within limits; the cap drops never-modified first', () => {
    const { sim } = streamWorld({ seed: 25 });
    const eng = sim.engine;
    sim.step();
    const town = sim.state.town!;
    const lots = Object.keys(town.regions).filter((id) => id !== HOME && id.includes(':mildew_'));
    // furnish every live neighbour heavily, then freeze everything non-home
    for (const id of [...town.stream.active].filter((r) => r !== HOME)) {
      if (!lots.includes(id)) continue;
      withRegion(eng, id, () => {
        for (let x = 2; x < 27; x += 2) for (let z = 2; z < 26; z += 3) {
          try {
            spawnObject(eng, 'chair_creaky', { kind: 'floor', x, z, rot: 0 });
          } catch {
            /* occupied */
          }
        }
      });
    }
    for (const id of [...town.stream.active].filter((r) => r !== HOME).sort()) expect(freezeRegion(eng, id)).toBe(true);
    const m = measureWorld(sim.state as never);
    expect(m.total).toBeLessThanOrEqual(2 * MB);
    for (const [id, b] of Object.entries(m.snapshots)) expect({ id, ok: b <= SAVE_BUDGET.lotResidentialMax }).toEqual({ id, ok: true });
    const furnished = lots.filter((id) => typeof town.regions[id]?.snapshot?.data[SNAPSHOT_MODIFIED_KEY] === 'number');
    expect(furnished.length).toBeGreaterThan(0);
    // the cap order on this streamed world (S2 rule, wired at every freeze): squeeze it 1 byte under its size
    const before = Object.keys(m.snapshots).filter((id) => !furnished.includes(id)).sort();
    const dropped = capWorldSize(sim.state as never, m.total - 1);
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped[0]).toBe(before[0]); // all froze on one tick: oldest = lowest id among the never-modified
    for (const id of dropped) expect(furnished.includes(id) || id === HOME).toBe(false);
    // eslint-disable-next-line no-console
    console.log(`[AC-12 heavy] ${Object.keys(m.snapshots).length} snapshots, world ${(m.total / 1024).toFixed(0)} KB, ${furnished.length} modified`);
  });

  it('A5: savePayloadSha256 at ≈ 0.35 / 2 / 4 MB (timed)', () => {
    const { sim } = streamWorld({ seed: 26 });
    const base = JSON.parse(JSON.stringify(sim.state));
    const out: string[] = [];
    for (const target of [0.35 * MB, 2 * MB, 4 * MB]) {
      const w = JSON.parse(JSON.stringify(base));
      w.flags = { ...(w.flags ?? {}), pad: 'x'.repeat(Math.max(0, target - jsonBytes(base))) };
      const t0 = performance.now();
      const h = savePayloadSha256(w);
      const ms = performance.now() - t0;
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      out.push(`${(jsonBytes(w) / MB).toFixed(2)} MB: ${ms.toFixed(1)} ms`);
    }
    // eslint-disable-next-line no-console
    console.log(`[A5] savePayloadSha256 ${out.join(', ')}`);
  });
});
