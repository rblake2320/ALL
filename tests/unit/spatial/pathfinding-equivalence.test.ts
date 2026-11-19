/**
 * findPath answers a field-cache miss with a single-target early-exit search instead of a whole distance field.
 * These tests pin the invariant that makes that safe: the chain (and therefore the smoothed path) is IDENTICAL to the
 * one read from the full Dijkstra field, so paths never depend on what happens to be cached (save/load determinism).
 */
import { describe, expect, it } from 'vitest';
import { createSpatial } from '../../../src/sim/spatial';
import { buildGrid } from '../../../src/sim/spatial/grid';
import { chainTo, dijkstra, MinHeap, reconstruct } from '../../../src/sim/spatial/pathfinding';
import type { WorldState } from '../../../src/sim/types';
import { addFloor, addObj, addWall, blankLot, makeContent, makeWorld, templateWorld, testRng } from './fixtures';

function randomLot(seed: number): WorldState {
  const rng = testRng(seed);
  const W = 10 + rng.int(0, 10);
  const D = 10 + rng.int(0, 10);
  const s = makeWorld(blankLot(W, D));
  for (let i = rng.int(10, 70); i > 0; i--) {
    const k = rng.chance(0.5) ? 'h' : 'v';
    const e = `${k}:${rng.int(1, W - 2)}:${rng.int(1, D - 2)}`;
    addWall(s, e);
    if (rng.chance(0.25)) addObj(s, rng.chance(0.6) ? 'door_splintered' : 'window_grimy', { kind: 'opening', edge: e });
  }
  for (let i = rng.int(4, 30); i > 0; i--) addFloor(s, rng.chance(0.5) ? 'chair_creaky' : 'lamp_skull', rng.int(0, W - 1), rng.int(0, D - 1), 0);
  return s;
}

describe('single-target search == full distance field', () => {
  it('chainTo(origin, target) equals reconstruct(dijkstra(origin), target) on 40 random lots (incl. unreachable)', () => {
    const content = makeContent();
    let compared = 0;
    let unreachable = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = randomLot(seed);
      const g = buildGrid(s, content);
      const heap = new MinHeap(64); // small on purpose: exercises heap growth inside the loop
      const dist = new Float64Array(g.n);
      const parent = new Int32Array(g.n);
      const rng = testRng(seed + 100);
      for (let q = 0; q < 60; q++) {
        const o = rng.int(0, g.n - 1);
        const t = rng.int(0, g.n - 1);
        const full = reconstruct(dijkstra(g, o, 1, heap, new Float64Array(g.n)), t);
        const fast = chainTo(g, o, t, heap, dist, parent);
        expect(fast, `seed ${seed} ${o}->${t}`).toEqual(full);
        compared++;
        if (full === null) unreachable++;
      }
    }
    expect(compared).toBe(2400);
    expect(unreachable).toBeGreaterThan(0);
  });

  it('findPath is identical with a cold cache (early exit) and a warm one (cached field), and the cold path caches nothing', () => {
    const content = makeContent();
    for (const state of [templateWorld('starter'), randomLot(7), randomLot(8)]) {
      const cold = createSpatial(() => state, content);
      const warm = createSpatial(() => state, content);
      const w = cold.width();
      const d = cold.depth();
      const rng = testRng(w * 31 + d);
      for (let i = 0; i < 150; i++) {
        const from = { x: rng.int(0, w - 1) + rng.next(), z: rng.int(0, d - 1) + rng.next() };
        const to = { x: rng.int(0, w - 1), z: rng.int(0, d - 1) };
        warm.distanceField(from);
        expect(cold.findPath(from, to)).toEqual(warm.findPath(from, to));
      }
      expect(cold.debugStats().fieldsCached).toBe(0);
      expect(cold.debugStats().dijkstraRuns).toBe(0);
    }
  });

  it('chainTo rejects junk indices and undersized scratch without throwing', () => {
    const s = makeWorld(blankLot(8, 8));
    const g = buildGrid(s, makeContent());
    const heap = new MinHeap();
    const dist = new Float64Array(g.n);
    const parent = new Int32Array(g.n);
    for (const [o, t] of [
      [-1, 3],
      [3, -1],
      [g.n, 3],
      [3, g.n],
      [NaN, 3],
      [3, NaN],
      [0.5, 3],
    ]) {
      expect(chainTo(g, o, t, heap, dist, parent)).toBeNull();
    }
    expect(chainTo(g, 0, 5, heap, new Float64Array(2), parent)).toBeNull();
    expect(chainTo(g, 9, 9, heap, dist, parent)).toEqual([9]);
    expect(dijkstra(g, NaN, 1, heap, dist).originIndex).toBe(-1);
    expect(Array.from(dijkstra(g, 1.5, 1, heap, dist).dist).every((v) => v === Infinity)).toBe(true);
  });
});
