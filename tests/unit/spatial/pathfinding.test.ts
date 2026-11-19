import { describe, expect, it } from 'vitest';
import { createSpatial, rectEdges, type SpatialService } from '../../../src/sim/spatial';
import type { Vec2 } from '../../../src/sim/types';
import { addFloor, addObj, addWall, addWalls, blankLot, bump, makeContent, makeWorld, templateWorld, testRng } from './fixtures';

function setup(w = 14, d = 14) {
  const state = makeWorld(blankLot(w, d));
  const S = createSpatial(() => state, makeContent());
  return { state, S };
}

/**
 * Independent validity check of a returned path: walk every segment in small steps; consecutive sample tiles must be
 * equal or a legal canStep (a jump across a corner counts as a diagonal), and no sample may sit in a blocked tile
 * except inside the start tile.
 */
function assertPathValid(S: SpatialService, from: Vec2, path: Vec2[], to: { x: number; z: number }) {
  expect(path.length).toBeGreaterThan(0);
  const last = path[path.length - 1];
  expect(last).toEqual({ x: to.x + 0.5, z: to.z + 0.5 });
  const start = S.tileOf(from);
  let prev = { x: from.x, z: from.z };
  let prevTile = start;
  for (const wp of path) {
    const len = Math.hypot(wp.x - prev.x, wp.z - prev.z);
    const steps = Math.max(1, Math.ceil(len / 0.02));
    for (let i = 1; i <= steps; i++) {
      const p = { x: prev.x + ((wp.x - prev.x) * i) / steps, z: prev.z + ((wp.z - prev.z) * i) / steps };
      const t = { x: Math.floor(p.x), z: Math.floor(p.z) };
      if (t.x !== prevTile.x || t.z !== prevTile.z) {
        if (Math.abs(t.x - prevTile.x) > 1 || Math.abs(t.z - prevTile.z) > 1) throw new Error(`jump ${JSON.stringify(prevTile)}->${JSON.stringify(t)}`);
        if (!S.canStep(prevTile.x, prevTile.z, t.x, t.z)) throw new Error(`illegal step ${JSON.stringify(prevTile)}->${JSON.stringify(t)}`);
        if ((t.x !== start.x || t.z !== start.z) && !S.isWalkable(t.x, t.z)) throw new Error(`entered blocked ${JSON.stringify(t)}`);
        prevTile = t;
      }
    }
    prev = wp;
  }
}

describe('findPath basics', () => {
  it('a clear straight line is one waypoint ending exactly at the tile centre', () => {
    const { S } = setup();
    const p = S.findPath({ x: 1.5, z: 1.5 }, { x: 10, z: 7 })!;
    expect(p).toEqual([{ x: 10.5, z: 7.5 }]);
  });

  it('same tile -> just the centre; start position off-centre is fine', () => {
    const { S } = setup();
    expect(S.findPath({ x: 3.1, z: 3.9 }, { x: 3, z: 3 })).toEqual([{ x: 3.5, z: 3.5 }]);
  });

  it('routes around a wall and through a door, never through a window', () => {
    const { state, S } = setup();
    addWalls(state, Array.from({ length: 14 }, (_, z) => `v:7:${z}`)); // full-height wall at x = 7
    expect(S.findPath({ x: 2.5, z: 2.5 }, { x: 10, z: 2 })).toBeNull();
    addObj(state, 'window_grimy', { kind: 'opening', edge: 'v:7:2' });
    bump(state);
    expect(S.findPath({ x: 2.5, z: 2.5 }, { x: 10, z: 2 })).toBeNull();
    addObj(state, 'door_splintered', { kind: 'opening', edge: 'v:7:10' });
    bump(state);
    const from = { x: 2.5, z: 2.5 };
    const p = S.findPath(from, { x: 10, z: 2 })!;
    expect(p).not.toBeNull();
    assertPathValid(S, from, p, { x: 10, z: 2 });
    // the path must actually cross x = 7 at the door row
    let crossed = false;
    let prev = from;
    for (const wp of p) {
      if ((prev.x < 7 && wp.x >= 7) || (prev.x >= 7 && wp.x < 7)) {
        const t = (7 - prev.x) / (wp.x - prev.x);
        const zc = prev.z + (wp.z - prev.z) * t;
        expect(Math.floor(zc)).toBe(10);
        crossed = true;
      }
      prev = wp;
    }
    expect(crossed).toBe(true);
  });

  it('unreachable, blocked target, NaN and out-of-bounds inputs return null without throwing', () => {
    const { state, S } = setup();
    addWalls(state, rectEdges(5, 5, 8, 8));
    addFloor(state, 'chair_creaky', 2, 2, 0);
    expect(S.findPath({ x: 1.5, z: 1.5 }, { x: 6, z: 6 })).toBeNull();
    expect(S.findPath({ x: 1.5, z: 1.5 }, { x: 2, z: 2 })).toBeNull();
    const bad: [Vec2, { x: number; z: number }][] = [
      [{ x: NaN, z: 1 }, { x: 3, z: 3 }],
      [{ x: 1, z: 1 }, { x: 3, z: Infinity }],
      [{ x: -1, z: 1 }, { x: 3, z: 3 }],
      [{ x: 1, z: 1 }, { x: 14, z: 3 }],
      [null as unknown as Vec2, { x: 3, z: 3 }],
      [{ x: 1, z: 1 }, undefined as unknown as Vec2],
      [{} as Vec2, { x: 3, z: 3 }],
    ];
    for (const [a, b] of bad) expect(S.findPath(a, b)).toBeNull();
    expect(S.debugFaults()).toEqual([]);
  });

  it('may start inside a blocked tile (step out of furniture)', () => {
    const { state, S } = setup();
    addFloor(state, 'sofa_moldy', 4, 4, 0);
    const from = { x: 4.55, z: 4.5 };
    const p = S.findPath(from, { x: 4, z: 9 })!;
    expect(p).not.toBeNull();
    assertPathValid(S, from, p, { x: 4, z: 9 });
  });

  it('never cuts the corner at a wall end', () => {
    const { state, S } = setup();
    addWalls(state, ['v:6:0', 'v:6:1', 'v:6:2', 'v:6:3', 'v:6:4']); // wall x=6 for z in [0,5)
    const from = { x: 5.5, z: 4.5 };
    const p = S.findPath(from, { x: 6, z: 4 })!;
    // must go down to row 5 and come back up: no diagonal past the wall end at point (6,5)
    assertPathValid(S, from, p, { x: 6, z: 4 });
    expect(p.length).toBeGreaterThanOrEqual(2);
    expect(p.some((w) => w.z > 5)).toBe(true);
  });

  it('squeezes only through legal gaps between furniture', () => {
    const { state, S } = setup();
    addFloor(state, 'chair_creaky', 5, 5, 0);
    addFloor(state, 'chair_creaky', 6, 6, 0); // diagonal pair: the gap between them is illegal
    const from = { x: 5.5, z: 6.5 };
    const p = S.findPath(from, { x: 6, z: 5 })!;
    assertPathValid(S, from, p, { x: 6, z: 5 });
    expect(p.length).toBeGreaterThanOrEqual(2);
  });
});

describe('distance fields', () => {
  it('origin 0, unreachable Infinity, parent chain consistent, version = lot.version', () => {
    const { state, S } = setup();
    addWalls(state, rectEdges(8, 8, 11, 11));
    const f = S.distanceField({ x: 1.5, z: 1.5 });
    const w = 14;
    expect(f.originIndex).toBe(1 * w + 1);
    expect(f.dist[f.originIndex]).toBe(0);
    expect(f.parent[f.originIndex]).toBe(-1);
    expect(f.dist[9 * w + 9]).toBe(Infinity);
    expect(f.version).toBe(state.lot.version);
    expect(f.dist[1 * w + 5]).toBeCloseTo(4, 5);
    expect(f.dist[5 * w + 5]).toBeCloseTo(4 * Math.SQRT2, 4);
    for (let i = 0; i < w * w; i++) {
      if (!Number.isFinite(f.dist[i]) || i === f.originIndex) continue;
      const p = f.parent[i];
      expect(p).toBeGreaterThanOrEqual(0);
      expect(f.dist[p]).toBeLessThan(f.dist[i]);
    }
  });

  it('penalises tiles next to blocking walls (+0.25) but not door frames', () => {
    const { state, S } = setup();
    addWall(state, 'h:5:4'); // between (5,3) and (5,4)
    const f = S.distanceField({ x: 1.5, z: 4.5 });
    expect(f.dist[4 * 14 + 5]).toBeCloseTo(4.25, 5);
    addObj(state, 'door_splintered', { kind: 'opening', edge: 'h:5:4' });
    bump(state);
    const g = S.distanceField({ x: 1.5, z: 4.5 });
    expect(g.dist[4 * 14 + 5]).toBeCloseTo(4, 5);
  });

  it('is cached per origin tile and invalidated by a version bump / invalidate()', () => {
    const { state, S } = setup();
    const a = S.distanceField({ x: 2.2, z: 2.7 });
    const runs = S.debugStats().dijkstraRuns;
    const b = S.distanceField({ x: 2.9, z: 2.1 }); // same tile
    expect(b).toBe(a);
    expect(S.debugStats().dijkstraRuns).toBe(runs);
    S.findPath({ x: 2.5, z: 2.5 }, { x: 9, z: 9 }); // reuses the cached field
    expect(S.debugStats().dijkstraRuns).toBe(runs);
    state.lot.version++;
    const c = S.distanceField({ x: 2.5, z: 2.5 });
    expect(c).not.toBe(a);
    S.invalidate();
    expect(S.distanceField({ x: 2.5, z: 2.5 })).not.toBe(c);
  });

  it('is an LRU of 32 origins', () => {
    const { S } = setup();
    const first = S.distanceField({ x: 0.5, z: 0.5 });
    for (let i = 1; i <= 32; i++) S.distanceField({ x: (i % 14) + 0.5, z: Math.floor(i / 14) + 0.5 });
    expect(S.debugStats().fieldsCached).toBe(32);
    expect(S.distanceField({ x: 0.5, z: 0.5 })).not.toBe(first); // evicted
  });

  it('invalid origins give an all-unreachable field instead of throwing', () => {
    const { S } = setup();
    for (const p of [{ x: NaN, z: 0 }, { x: -3, z: 2 }, { x: 99, z: 99 }, null as unknown as Vec2]) {
      const f = S.distanceField(p);
      expect(f.originIndex).toBe(-1);
      expect(Array.from(f.dist).every((v) => v === Infinity)).toBe(true);
    }
  });
});

describe('nearestWalkable', () => {
  it('returns the tile itself when walkable and a legal neighbour when not', () => {
    const { state, S } = setup();
    expect(S.nearestWalkable({ x: 3.2, z: 3.7 })).toEqual({ x: 3, z: 3 });
    addFloor(state, 'chair_creaky', 3, 3, 0);
    const t = S.nearestWalkable({ x: 3.9, z: 3.5 })!;
    expect(Math.abs(t.x - 3) + Math.abs(t.z - 3)).toBeLessThanOrEqual(2);
    expect(S.isWalkable(t.x, t.z)).toBe(true);
    expect(t).toEqual({ x: 4, z: 3 }); // closest to the query point
  });

  it('prefers stepping out on its own side of a wall', () => {
    const { state, S } = setup();
    addFloor(state, 'chair_creaky', 5, 5, 0);
    addWall(state, 'v:6:5'); // wall right of the chair
    const t = S.nearestWalkable({ x: 5.95, z: 5.5 })!; // nearest by distance would be (6,5) across the wall
    expect(t).not.toEqual({ x: 6, z: 5 });
    expect(S.canStep(5, 5, t.x, t.z)).toBe(true);
  });

  it('falls back to a same-room scan when boxed in by furniture, and handles junk input', () => {
    const { state, S } = setup();
    addFloor(state, 'sofa_velvet', 4, 6, 0); // (4..6, 6)
    addFloor(state, 'sofa_velvet', 4, 5, 0);
    addFloor(state, 'sofa_velvet', 4, 7, 0);
    const t = S.nearestWalkable({ x: 5.5, z: 6.5 })!;
    expect(S.isWalkable(t.x, t.z)).toBe(true);
    expect(Math.hypot(t.x + 0.5 - 5.5, t.z + 0.5 - 6.5)).toBeLessThanOrEqual(2.3);
    expect(S.nearestWalkable({ x: NaN, z: 1 })).toBeNull();
    expect(S.nearestWalkable({ x: -20, z: 3.5 })).toEqual({ x: 0, z: 3 }); // clamped onto the lot
    expect(S.nearestWalkable({ x: 5.5, z: 6.5 }, 0)).toBeNull();
  });
});

describe('paths on the starter lot', () => {
  const state = templateWorld('starter');
  const S = createSpatial(() => state, makeContent());
  const walk: { x: number; z: number }[] = [];
  for (let z = 0; z < 30; z++) for (let x = 0; x < 30; x++) if (S.isWalkable(x, z)) walk.push({ x, z });

  it('every returned path is valid under an independent sampling check (300 random pairs)', () => {
    const rng = testRng(11);
    let found = 0;
    for (let i = 0; i < 300; i++) {
      const a = walk[rng.int(0, walk.length - 1)];
      const b = walk[rng.int(0, walk.length - 1)];
      const from = { x: a.x + 0.2 + rng.next() * 0.6, z: a.z + 0.2 + rng.next() * 0.6 };
      const p = S.findPath(from, b);
      if (!p) continue;
      found++;
      assertPathValid(S, from, p, b);
    }
    expect(found).toBe(300); // the starter lot is fully connected
  });

  it('smoothing never increases the waypoint count beyond the raw tile chain', () => {
    const f = S.distanceField({ x: 0.5, z: 28.5 });
    for (const t of [{ x: 10, z: 12 }, { x: 17, z: 11 }, { x: 18, z: 16 }]) {
      let n = 0;
      let i = t.z * 30 + t.x;
      while (i !== f.originIndex && i >= 0) {
        n++;
        i = f.parent[i];
      }
      const p = S.findPath({ x: 0.5, z: 28.5 }, t)!;
      expect(p.length).toBeLessThanOrEqual(n);
    }
  });

  it('performance: 2,000 findPath calls between random tiles take < 1.5 s', () => {
    const rng = testRng(5);
    const pairs = Array.from({ length: 2000 }, () => [walk[rng.int(0, walk.length - 1)], walk[rng.int(0, walk.length - 1)]]);
    // Best of 3 COLD runs (caches dropped each time): the budget is about the code, not about a shared CI box that
    // happens to be oversubscribed while the timer runs.
    let best = Infinity;
    for (let trial = 0; trial < 3 && best >= 1500; trial++) {
      S.invalidate();
      const t0 = performance.now();
      let ok = 0;
      for (const [a, b] of pairs) if (S.findPath({ x: a.x + 0.5, z: a.z + 0.5 }, b)) ok++;
      best = Math.min(best, performance.now() - t0);
      expect(ok).toBe(2000);
    }
    expect(best).toBeLessThan(1500);
  });

  it('is deterministic: identical inputs give identical paths across instances', () => {
    const S2 = createSpatial(() => state, makeContent());
    const rng = testRng(9);
    for (let i = 0; i < 50; i++) {
      const a = walk[rng.int(0, walk.length - 1)];
      const b = walk[rng.int(0, walk.length - 1)];
      expect(S2.findPath({ x: a.x + 0.5, z: a.z + 0.5 }, b)).toEqual(S.findPath({ x: a.x + 0.5, z: a.z + 0.5 }, b));
    }
  });
});
