/**
 * PROPERTY TESTS against independent oracles on randomized lots (walls, doors, windows, furniture, rugs, floor items,
 * fire, partially off-lot objects). Each oracle re-derives the rule from the brief / GDD §15 with naive code that
 * shares nothing with the implementation:
 *  - paths: reachability == BFS over canStep; every returned path is traversable when sampled every 0.005 tiles
 *    (corner crossings accepted exactly like the engine's movement), ends exactly at the target tile centre;
 *  - slots: approach tiles == catalog local tiles mapped through floor(localToWorld(lx+.5, lz+.5)), minus off-lot,
 *    own-footprint and wall-separated tiles; fixed-pose slots appear once, faceObject slots once per approach tile;
 *  - placement: checkPlace's verdict and reason == the GDD §15 rule table evaluated in its documented order.
 */
import { describe, expect, it } from 'vitest';
import { createSpatial, rectEdges, type SpatialService } from '../../../src/sim/spatial';
import { PHYSICAL_SPECS } from '../../../src/shared/catalog';
import { localToWorld, rotatedSize, type Rot } from '../../../src/shared/dimensions';
import type { Vec2, WorldState } from '../../../src/sim/types';
import { addFloor, addLoose, addObj, addWall, blankLot, makeContent, makeWorld, testRng } from './fixtures';

const content = makeContent();

function reachableFrom(S: SpatialService, start: { x: number; z: number }): Set<string> {
  const seen = new Set<string>([`${start.x},${start.z}`]);
  const queue = [start];
  while (queue.length > 0) {
    const c = queue.shift()!;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = { x: c.x + dx, z: c.z + dz };
        const key = `${n.x},${n.z}`;
        if ((dx || dz) && !seen.has(key) && S.canStep(c.x, c.z, n.x, n.z)) {
          seen.add(key);
          queue.push(n);
        }
      }
    }
  }
  return seen;
}

/** Engine-style traversal check (src/sim/engine/movement.ts canCross) of a sampled polyline; '' = fine. */
function traverse(S: SpatialService, from: Vec2, path: Vec2[]): string {
  let prev = { ...from };
  let pt = S.tileOf(from);
  for (const wp of path) {
    const steps = Math.max(1, Math.ceil(Math.hypot(wp.x - prev.x, wp.z - prev.z) / 0.005));
    for (let i = 1; i <= steps; i++) {
      const t = S.tileOf({ x: prev.x + ((wp.x - prev.x) * i) / steps, z: prev.z + ((wp.z - prev.z) * i) / steps });
      if (t.x === pt.x && t.z === pt.z) continue;
      const dx = t.x - pt.x;
      const dz = t.z - pt.z;
      if (Math.abs(dx) > 1 || Math.abs(dz) > 1) return 'jump';
      let ok: boolean;
      if (dx !== 0 && dz !== 0) {
        ok =
          S.canStep(pt.x, pt.z, t.x, t.z) ||
          (S.isWalkable(t.x, pt.z) && S.canStep(pt.x, pt.z, t.x, pt.z) && S.canStep(t.x, pt.z, t.x, t.z)) ||
          (S.isWalkable(pt.x, t.z) && S.canStep(pt.x, pt.z, pt.x, t.z) && S.canStep(pt.x, t.z, t.x, t.z));
      } else ok = S.canStep(pt.x, pt.z, t.x, t.z);
      if (!ok) return `illegal ${pt.x},${pt.z} -> ${t.x},${t.z}`;
      pt = t;
    }
    prev = wp;
  }
  return '';
}

function randomWalledLot(seed: number, w: number, d: number): WorldState {
  const rng = testRng(seed);
  const s = makeWorld(blankLot(w, d));
  for (let i = rng.int(10, 60); i > 0; i--) {
    const e = `${rng.chance(0.5) ? 'h' : 'v'}:${rng.int(1, w - 2)}:${rng.int(1, d - 2)}`;
    addWall(s, e);
    if (rng.chance(0.2)) addObj(s, rng.chance(0.6) ? 'door_splintered' : 'window_grimy', { kind: 'opening', edge: e });
  }
  for (let i = rng.int(5, 25); i > 0; i--) addFloor(s, 'chair_creaky', rng.int(0, w - 1), rng.int(0, d - 1), 0);
  if (rng.chance(0.5)) addLoose(s, 'item_fire', rng.int(0, w - 1) + 0.5, rng.int(0, d - 1) + 0.5);
  s.lot.version++;
  s.lot.wallVersion++;
  return s;
}

describe('oracle: paths', () => {
  it('reachability matches BFS over canStep and every path is traversable (25 lots x 80 queries)', () => {
    const offsets = [0, 0.001, 0.3, 0.5, 0.7, 0.999];
    let paths = 0;
    let nulls = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const rng = testRng(seed * 7);
      const w = 12 + rng.int(0, 6);
      const d = 12 + rng.int(0, 6);
      const s = randomWalledLot(seed, w, d);
      const S = createSpatial(() => s, content);
      for (let q = 0; q < 80; q++) {
        const from = { x: rng.int(0, w - 1) + offsets[rng.int(0, 5)], z: rng.int(0, d - 1) + offsets[rng.int(0, 5)] };
        const to = { x: rng.int(0, w - 1), z: rng.int(0, d - 1) };
        const path = S.findPath(from, to);
        const reachable = S.isWalkable(to.x, to.z) && reachableFrom(S, S.tileOf(from)).has(`${to.x},${to.z}`);
        const where = `seed ${seed} ${JSON.stringify(from)} -> ${to.x},${to.z}`;
        expect(path !== null, where).toBe(reachable);
        if (!path) {
          nulls++;
          continue;
        }
        paths++;
        expect(path[path.length - 1], where).toEqual({ x: to.x + 0.5, z: to.z + 0.5 });
        expect(traverse(S, from, path), where).toBe('');
      }
    }
    expect(paths).toBeGreaterThan(1200);
    expect(nulls).toBeGreaterThan(20);
  });
});

describe('oracle: slots', () => {
  it('approach tiles of every slotted floor spec, any rotation, near random walls / the lot edge (300 cases)', () => {
    const specs = PHYSICAL_SPECS.filter((s) => s.placement === 'floor' && s.slots.length > 0);
    let checked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rng = testRng(seed);
      const s = makeWorld(blankLot(12, 12));
      const S = createSpatial(() => s, content);
      for (let i = rng.int(0, 25); i > 0; i--) addWall(s, `${rng.chance(0.5) ? 'h' : 'v'}:${rng.int(0, 12)}:${rng.int(0, 12)}`);
      const spec = specs[rng.int(0, specs.length - 1)];
      const rot = rng.int(0, 3) as Rot;
      const size = rotatedSize(spec.footprint.w, spec.footprint.d, rot);
      const ox = rng.int(-1, 13 - size.w);
      const oz = rng.int(-1, 13 - size.d);
      const obj = addFloor(s, spec.id, ox, oz, rot);
      s.lot.wallVersion++;
      const own: { x: number; z: number }[] = [];
      for (let z = 0; z < size.d; z++) for (let x = 0; x < size.w; x++) own.push({ x: ox + x, z: oz + z });
      const resolved = S.resolveSlots(obj);
      spec.slots.forEach((slot, index) => {
        const expected = new Set<string>();
        for (const a of slot.approach) {
          const p = localToWorld(spec.footprint.w, spec.footprint.d, ox, oz, rot, a.x + 0.5, a.z + 0.5);
          const t = { x: Math.floor(p.x), z: Math.floor(p.z) };
          if (t.x < 0 || t.z < 0 || t.x >= 12 || t.z >= 12 || own.some((o) => o.x === t.x && o.z === t.z)) continue;
          let best = own[0];
          for (const o of own) if (Math.abs(o.x - t.x) + Math.abs(o.z - t.z) < Math.abs(best.x - t.x) + Math.abs(best.z - t.z)) best = o;
          let cut = false;
          if (best.x === t.x) for (let z = Math.min(best.z, t.z) + 1; z <= Math.max(best.z, t.z); z++) cut = cut || !!s.lot.walls[`h:${t.x}:${z}`];
          else if (best.z === t.z) for (let x = Math.min(best.x, t.x) + 1; x <= Math.max(best.x, t.x); x++) cut = cut || !!s.lot.walls[`v:${x}:${t.z}`];
          if (!cut) expected.add(`${t.x},${t.z}`);
        }
        const entries = resolved.filter((r) => r.index === index);
        const got = new Set(entries.flatMap((r) => r.approach.map((t) => `${t.x},${t.z}`)));
        const where = `seed ${seed} ${spec.id} rot ${rot} at ${ox},${oz} slot ${index}`;
        expect([...got].sort(), where).toEqual([...expected].sort());
        expect(entries.length, where).toBe(slot.faceObject || !slot.pose ? got.size : 1);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe('oracle: placement rule table (GDD §15)', () => {
  it('checkPlace verdicts and reasons on 60 furnished lots x 100 random placements', () => {
    const specs = PHYSICAL_SPECS.filter((s) => s.placement === 'floor');
    const seenReasons = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const rng = testRng(seed + 500);
      const s = makeWorld(blankLot());
      const S = createSpatial(() => s, content);
      const rx = rng.int(2, 15);
      const rz = rng.int(2, 15);
      for (const e of rectEdges(rx, rz, rx + rng.int(3, 8), rz + rng.int(3, 8))) addWall(s, e);
      const walls = Object.keys(s.lot.walls);
      const doorEdge = walls[rng.int(0, walls.length - 1)];
      addObj(s, 'door_splintered', { kind: 'opening', edge: doorEdge });
      for (let i = rng.int(0, 10); i > 0; i--) addWall(s, `${rng.chance(0.5) ? 'h' : 'v'}:${rng.int(1, 28)}:${rng.int(1, 26)}`);
      for (let i = rng.int(3, 12); i > 0; i--) {
        const spec = specs[rng.int(0, specs.length - 1)];
        const rot = rng.int(0, 3) as Rot;
        const x = rng.int(1, 27);
        const z = rng.int(1, 25);
        if (S.checkPlace(spec.id, x, z, rot).ok) addFloor(s, spec.id, x, z, rot);
      }
      for (let i = rng.int(0, 4); i > 0; i--) addLoose(s, rng.chance(0.3) ? 'item_fire' : 'item_dish', rng.int(1, 27) + 0.5, rng.int(1, 25) + 0.5);
      s.lot.version++;
      s.lot.wallVersion++;

      const occupied = new Map<string, boolean[]>(); // tile -> rug flags of the floor objects on it
      for (const o of Object.values(s.objects)) {
        if (o.placement.kind !== 'floor') continue;
        const def = content.objects[o.defId];
        const size = rotatedSize(def.footprint.w, def.footprint.d, o.placement.rot);
        for (let dz = 0; dz < size.d; dz++) {
          for (let dx = 0; dx < size.w; dx++) {
            const k = `${o.placement.x + dx},${o.placement.z + dz}`;
            occupied.set(k, [...(occupied.get(k) ?? []), def.layer === 'rug']);
          }
        }
      }
      const fire = new Set<string>();
      const floorItems = new Set<string>();
      for (const o of Object.values(s.objects)) {
        if (o.placement.kind !== 'loose') continue;
        const k = `${Math.floor(o.placement.x)},${Math.floor(o.placement.z)}`;
        if (o.defId === 'item_fire') fire.add(k);
        else if (o.placement.parentId === null) floorItems.add(k);
      }
      const [dk, dxs, dzs] = doorEdge.split(':');
      const doorSides = dk === 'h' ? [`${+dxs},${+dzs - 1}`, `${+dxs},${+dzs}`] : [`${+dxs - 1},${+dzs}`, `${+dxs},${+dzs}`];

      for (let q = 0; q < 100; q++) {
        const spec = specs[rng.int(0, specs.length - 1)];
        const rot = rng.int(0, 3) as Rot;
        const x = rng.int(-1, 29);
        const z = rng.int(-1, 29);
        const size = rotatedSize(spec.footprint.w, spec.footprint.d, rot);
        const tiles: { x: number; z: number; k: string }[] = [];
        for (let dz = 0; dz < size.d; dz++) for (let dx = 0; dx < size.w; dx++) tiles.push({ x: x + dx, z: z + dz, k: `${x + dx},${z + dz}` });
        const rug = spec.layer === 'rug';
        let straddle = false;
        for (let dz = 0; dz < size.d; dz++) for (let dx = 1; dx < size.w; dx++) straddle = straddle || !!s.lot.walls[`v:${x + dx}:${z + dz}`];
        for (let dz = 1; dz < size.d; dz++) for (let dx = 0; dx < size.w; dx++) straddle = straddle || !!s.lot.walls[`h:${x + dx}:${z + dz}`];
        let expected: string | undefined;
        if (tiles.some((t) => !(t.x >= 1 && t.x < 29 && t.z >= 1 && t.z < 27))) expected = 'Outside your lot';
        else if (straddle) expected = "Can't straddle a wall";
        else if (tiles.some((t) => (occupied.get(t.k) ?? []).some((r) => r === rug))) expected = "Something's in the way";
        else if (!rug && tiles.some((t) => fire.has(t.k) || floorItems.has(t.k))) expected = "Something's in the way";
        else if (!rug && spec.passable !== true && tiles.some((t) => doorSides.includes(t.k))) expected = 'Blocks a doorway';
        else if (spec.outdoorOnly && tiles.some((t) => S.roomAt(t.x, t.z) !== 0)) expected = 'Must be placed outdoors';
        else if (spec.indoorOnly && tiles.some((t) => S.roomAt(t.x, t.z) === 0)) expected = 'Must be placed indoors';
        const r = S.checkPlace(spec.id, x, z, rot);
        expect(r.ok ? undefined : r.reason, `seed ${seed} ${spec.id} at ${x},${z} rot ${rot}`).toBe(expected);
        expect(r.cost).toBe(spec.price);
        seenReasons.add(expected ?? 'ok');
      }
    }
    for (const reason of ['ok', 'Outside your lot', "Something's in the way", "Can't straddle a wall", 'Blocks a doorway', 'Must be placed outdoors']) {
      expect(seenReasons.has(reason), `the generator exercised "${reason}"`).toBe(true);
    }
  });
});
