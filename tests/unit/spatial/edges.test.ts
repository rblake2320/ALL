import { describe, expect, it } from 'vitest';
import {
  edgeBetween,
  edgeKey,
  edgeMidpoint,
  edgeSides,
  normalizeEdge,
  openingFrame,
  parseEdge,
  rectEdges,
  wallLocalToWorld,
  wallRot,
} from '../../../src/sim/spatial';
import { edgesBetweenAligned, wallFrame } from '../../../src/sim/spatial/edges';
import { rotateDir } from '../../../src/shared/dimensions';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('edge keys', () => {
  it('builds canonical keys, rounding float noise and folding -0', () => {
    expect(edgeKey('h', 3, 7)).toBe('h:3:7');
    expect(edgeKey('v', 3.0000001, 6.9999999)).toBe('v:3:7');
    expect(edgeKey('h', -0, 0)).toBe('h:0:0');
    expect(edgeKey('v', -0.2, 2)).toBe('v:0:2');
  });

  it('parses valid keys and rejects junk', () => {
    expect(parseEdge('h:3:7')).toEqual({ kind: 'h', x: 3, z: 7 });
    expect(parseEdge('v:-2:30')).toEqual({ kind: 'v', x: -2, z: 30 });
    expect(parseEdge('h:-0:5')).toEqual({ kind: 'h', x: 0, z: 5 });
    for (const bad of ['', 'h', 'h:1', 'h:1:2:3', 'x:1:2', 'H:1:2', 'h:1.5:2', 'h:NaN:2', 'h: 1:2', 'h:1:2 ', 'h:1e3:2', 'hv:1:2']) {
      expect(parseEdge(bad), bad).toBeNull();
    }
    for (const bad of [null, undefined, 3, {}, [], true]) expect(parseEdge(bad as unknown)).toBeNull();
  });

  it('normalises any parseable key to its canonical form', () => {
    expect(normalizeEdge('h:-0:05')).toBe('h:0:5');
    expect(normalizeEdge('v:007:3')).toBe('v:7:3');
    expect(normalizeEdge('nope')).toBeNull();
    for (const k of ['h:0:0', 'v:29:4', 'h:-3:-4']) expect(normalizeEdge(normalizeEdge(k))).toBe(normalizeEdge(k));
  });
});

describe('movement crossings (edgeBetween)', () => {
  it('follows the documented crossing convention', () => {
    expect(edgeBetween(4, 5, 5, 5)).toBe('v:5:5'); // +X crosses v:(x+1):z
    expect(edgeBetween(4, 5, 3, 5)).toBe('v:4:5'); // -X crosses v:x:z
    expect(edgeBetween(4, 5, 4, 6)).toBe('h:4:6'); // +Z crosses h:x:(z+1)
    expect(edgeBetween(4, 5, 4, 4)).toBe('h:4:5'); // -Z crosses h:x:z
  });

  it('is symmetric and returns null for non-orthogonal neighbours or bad input', () => {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      expect(edgeBetween(10, 10, 10 + dx, 10 + dz)).toBe(edgeBetween(10 + dx, 10 + dz, 10, 10));
    }
    expect(edgeBetween(1, 1, 2, 2)).toBeNull();
    expect(edgeBetween(1, 1, 1, 1)).toBeNull();
    expect(edgeBetween(1, 1, 3, 1)).toBeNull();
    expect(edgeBetween(1.5, 1, 2.5, 1)).toBeNull();
    expect(edgeBetween(NaN, 1, 2, 1)).toBeNull();
    expect(edgeBetween(1, Infinity, 1, 2)).toBeNull();
  });

  it('edgeSides of a crossed edge are exactly the two tiles (side 0 = -X/-Z)', () => {
    for (let x = 0; x < 6; x++) {
      for (let z = 0; z < 6; z++) {
        for (const [dx, dz] of [
          [1, 0],
          [0, 1],
        ]) {
          const e = edgeBetween(x, z, x + dx, z + dz)!;
          const [s0, s1] = edgeSides(e);
          expect(s0).toEqual({ x, z });
          expect(s1).toEqual({ x: x + dx, z: z + dz });
        }
      }
    }
  });

  it('edgeSides on junk returns NaN tiles instead of throwing', () => {
    const [a, b] = edgeSides('garbage');
    expect(Number.isNaN(a.x) && Number.isNaN(a.z) && Number.isNaN(b.x) && Number.isNaN(b.z)).toBe(true);
  });
});

describe('rectEdges', () => {
  it('returns the 2(w+d) unique perimeter edges, each with exactly one side inside', () => {
    const edges = rectEdges(2, 3, 6, 5);
    expect(edges.length).toBe(2 * (4 + 2));
    expect(new Set(edges).size).toBe(edges.length);
    const inside = (t: { x: number; z: number }) => t.x >= 2 && t.x < 6 && t.z >= 3 && t.z < 5;
    for (const e of edges) {
      const [a, b] = edgeSides(e);
      expect(Number(inside(a)) + Number(inside(b))).toBe(1);
    }
  });

  it('accepts corners in any order and rejects empty / invalid / absurd rectangles', () => {
    expect(new Set(rectEdges(6, 5, 2, 3))).toEqual(new Set(rectEdges(2, 3, 6, 5)));
    expect(rectEdges(2, 3, 2, 9)).toEqual([]);
    expect(rectEdges(NaN, 0, 3, 3)).toEqual([]);
    expect(rectEdges(0, 0, Infinity, 3)).toEqual([]);
    expect(rectEdges(0, 0, 1e7, 1e7)).toEqual([]);
    expect(rectEdges(0, 0, 1, 1)).toEqual(['h:0:0', 'h:0:1', 'v:0:0', 'v:1:0']);
  });
});

describe('wall-item frame (wallLocalToWorld)', () => {
  const cases: { edge: string; side: 0 | 1; tile: { x: number; z: number }; normal: { x: number; z: number }; rot: number }[] = [
    { edge: 'h:5:8', side: 1, tile: { x: 5, z: 8 }, normal: { x: 0, z: 1 }, rot: 0 },
    { edge: 'h:5:8', side: 0, tile: { x: 5, z: 7 }, normal: { x: 0, z: -1 }, rot: 2 },
    { edge: 'v:5:8', side: 1, tile: { x: 5, z: 8 }, normal: { x: 1, z: 0 }, rot: 3 },
    { edge: 'v:5:8', side: 0, tile: { x: 4, z: 8 }, normal: { x: -1, z: 0 }, rot: 1 },
  ];

  for (const c of cases) {
    it(`${c.edge} side ${c.side}: origin on the wall, +Z into the mounted tile, front = inward normal`, () => {
      expect(wallRot(c.edge[0] as 'h' | 'v', c.side)).toBe(c.rot);
      const mid = edgeMidpoint(c.edge);
      const p0 = wallLocalToWorld(c.edge, c.side, 0.5, 0);
      expect(close(p0.x, mid.x) && close(p0.z, mid.z)).toBe(true);
      // a point 0.62 out from the wall lies inside the mounted tile, along the normal
      const p1 = wallLocalToWorld(c.edge, c.side, 0.5, 0.62);
      expect(Math.floor(p1.x)).toBe(c.tile.x);
      expect(Math.floor(p1.z)).toBe(c.tile.z);
      expect(close(p1.x - p0.x, c.normal.x * 0.62) && close(p1.z - p0.z, c.normal.z * 0.62)).toBe(true);
      // facing is the yaw of the inward normal
      expect(close(Math.sin(p0.facing), c.normal.x) && close(Math.cos(p0.facing), c.normal.z)).toBe(true);
      // local x in [0,1] spans exactly the edge
      const a = wallLocalToWorld(c.edge, c.side, 0, 0);
      const b = wallLocalToWorld(c.edge, c.side, 1, 0);
      expect(close(Math.hypot(b.x - a.x, b.z - a.z), 1)).toBe(true);
      expect(close((a.x + b.x) / 2, mid.x) && close((a.z + b.z) / 2, mid.z)).toBe(true);
      // handedness matches floor objects: local +X axis == rotateDir(rot, 1, 0)
      const ax = rotateDir(c.rot as 0 | 1 | 2 | 3, 1, 0);
      expect(close(b.x - a.x, ax.x) && close(b.z - a.z, ax.z)).toBe(true);
      expect(wallFrame(c.edge, c.side)!.tile).toEqual(c.tile);
    });
  }

  it('returns NaN coordinates for invalid edges / sides / points', () => {
    for (const r of [
      wallLocalToWorld('bad', 0, 0.5, 0),
      wallLocalToWorld('h:1:1', 2 as 0, 0.5, 0),
      wallLocalToWorld('h:1:1', 0, NaN, 0),
    ]) {
      expect(Number.isNaN(r.x) && Number.isNaN(r.z)).toBe(true);
      expect(r.facing).toBe(0);
    }
  });
});

describe('openingFrame', () => {
  it('centres on the edge with local +X along the edge and local +Z toward side 1', () => {
    for (const edge of ['h:3:9', 'v:3:9']) {
      const f = openingFrame(edge);
      const mid = edgeMidpoint(edge);
      expect(close(f.x, mid.x) && close(f.z, mid.z)).toBe(true);
      // Three.js rotation.y: local +X -> (cos, -sin), local +Z -> (sin, cos)
      const lx = { x: Math.cos(f.yaw), z: -Math.sin(f.yaw) };
      const lz = { x: Math.sin(f.yaw), z: Math.cos(f.yaw) };
      const [s0, s1] = edgeSides(edge);
      const toSide1 = { x: s1.x - s0.x, z: s1.z - s0.z };
      expect(close(lz.x, toSide1.x) && close(lz.z, toSide1.z)).toBe(true);
      expect(close(lx.x * toSide1.x + lx.z * toSide1.z, 0)).toBe(true);
    }
    expect(openingFrame('h:3:9').yaw).toBe(0);
    expect(openingFrame('v:3:9').yaw).toBeCloseTo(Math.PI / 2);
    const bad = openingFrame('v:3');
    expect(Number.isNaN(bad.x) && Number.isNaN(bad.z)).toBe(true);
  });
});

describe('edgesBetweenAligned', () => {
  it('lists crossed edges between aligned tiles only', () => {
    expect(edgesBetweenAligned({ x: 2, z: 2 }, { x: 2, z: 5 })).toEqual(['h:2:3', 'h:2:4', 'h:2:5']);
    expect(edgesBetweenAligned({ x: 5, z: 1 }, { x: 3, z: 1 })).toEqual(['v:4:1', 'v:5:1']);
    expect(edgesBetweenAligned({ x: 1, z: 1 }, { x: 2, z: 2 })).toEqual([]);
    expect(edgesBetweenAligned({ x: 1, z: 1 }, { x: 1, z: 1 })).toEqual([]);
  });
});
