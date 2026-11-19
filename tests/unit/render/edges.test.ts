import { describe, it, expect } from 'vitest';
import {
  parseEdgeKey,
  edgeKeyOf,
  edgeFrame,
  edgeSideTile,
  sideNormal,
  wallItemTransform,
  openingTransform,
  normalizeSide,
  signedDistanceToEdgeLine,
  tileEdges,
  type EdgeTransform,
} from '../../../src/render/build/edges';
import { DIM } from '../../../src/shared/dimensions';

const T = (): EdgeTransform => ({ x: 0, y: 0, z: 0, yaw: 0 });
/** Local +Z direction after a Three.js rotation.y = yaw. */
const front = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

describe('edge parsing', () => {
  it('parses both kinds and round-trips', () => {
    expect(parseEdgeKey('h:3:4')).toEqual({ kind: 'h', x: 3, z: 4 });
    expect(parseEdgeKey('v:0:12')).toEqual({ kind: 'v', x: 0, z: 12 });
    expect(parseEdgeKey('h:-2:7')).toEqual({ kind: 'h', x: -2, z: 7 });
    expect(edgeKeyOf('v', 5, 6)).toBe('v:5:6');
    const e = parseEdgeKey(edgeKeyOf('h', 9, 1))!;
    expect(e).toEqual({ kind: 'h', x: 9, z: 1 });
  });

  it('rejects malformed keys', () => {
    for (const bad of [
      '',
      'h',
      'h:1',
      'h:1:2:3',
      'x:1:2',
      'H:1:2',
      'h:1.5:2',
      'h:a:b',
      'h:NaN:2',
      'h:1e3:2',
      'h: 1:2',
      'h:999999999:1',
      'v:1:2:',
      'h:1:2'.padEnd(40, ' '),
    ]) {
      expect(parseEdgeKey(bad), bad).toBeNull();
    }
    for (const bad of [null, undefined, 42, {}, [], true]) expect(parseEdgeKey(bad)).toBeNull();
  });
});

describe('edge frames', () => {
  it("'h:x:z' runs along +X on line z with normal +Z", () => {
    const f = edgeFrame({ kind: 'h', x: 3, z: 4 });
    expect([f.startX, f.startZ, f.endX, f.endZ]).toEqual([3, 4, 4, 4]);
    expect([f.midX, f.midZ]).toEqual([3.5, 4]);
    expect([f.tanX, f.tanZ, f.nX, f.nZ]).toEqual([1, 0, 0, 1]);
  });

  it("'v:x:z' runs along +Z on line x with normal +X", () => {
    const f = edgeFrame({ kind: 'v', x: 3, z: 4 });
    expect([f.startX, f.startZ, f.endX, f.endZ]).toEqual([3, 4, 3, 5]);
    expect([f.midX, f.midZ]).toEqual([3, 4.5]);
    expect([f.tanX, f.tanZ, f.nX, f.nZ]).toEqual([0, 1, 1, 0]);
  });

  it('side tiles follow src/sim/types.ts (side 0 = -Z / -X tile)', () => {
    expect(edgeSideTile({ kind: 'h', x: 3, z: 4 }, 0)).toEqual({ x: 3, z: 3 });
    expect(edgeSideTile({ kind: 'h', x: 3, z: 4 }, 1)).toEqual({ x: 3, z: 4 });
    expect(edgeSideTile({ kind: 'v', x: 3, z: 4 }, 0)).toEqual({ x: 2, z: 4 });
    expect(edgeSideTile({ kind: 'v', x: 3, z: 4 }, 1)).toEqual({ x: 3, z: 4 });
  });

  it('side normals point from the wall into the side tile', () => {
    for (const kind of ['h', 'v'] as const) {
      for (const side of [0, 1] as const) {
        const e = { kind, x: 5, z: 5 };
        const n = sideNormal(e, side);
        const f = edgeFrame(e);
        const tile = edgeSideTile(e, side);
        // tile centre minus edge midpoint points along the side normal
        const dx = tile.x + 0.5 - f.midX;
        const dz = tile.z + 0.5 - f.midZ;
        expect(Math.sign(dx * n.x + dz * n.z)).toBe(1);
      }
    }
  });

  it('signed distance is positive on side 1', () => {
    expect(signedDistanceToEdgeLine({ kind: 'h', x: 0, z: 4 }, 0.5, 4.2)).toBeCloseTo(0.2);
    expect(signedDistanceToEdgeLine({ kind: 'v', x: 4, z: 0 }, 3.7, 0.5)).toBeCloseTo(-0.3);
  });

  it('tileEdges lists the four bounding edges', () => {
    expect(tileEdges(2, 3)).toEqual({ top: 'h:2:3', bottom: 'h:2:4', left: 'v:2:3', right: 'v:3:3' });
  });
});

describe('wall item & opening transforms', () => {
  it('wall items sit on the wall surface of their side, facing into that tile', () => {
    for (const kind of ['h', 'v'] as const) {
      for (const side of [0, 1] as const) {
        const e = { kind, x: 4, z: 7 };
        const t = wallItemTransform(e, side, T());
        const f = edgeFrame(e);
        const n = sideNormal(e, side);
        // offset from the centre line by half the wall thickness, along the side normal
        expect(t.x - f.midX).toBeCloseTo(n.x * DIM.WALL_THICKNESS * 0.5, 9);
        expect(t.z - f.midZ).toBeCloseTo(n.z * DIM.WALL_THICKNESS * 0.5, 9);
        const fr = front(t.yaw);
        expect(fr.x).toBeCloseTo(n.x, 9);
        expect(fr.z).toBeCloseTo(n.z, 9);
        expect(t.y).toBe(0);
      }
    }
  });

  it('custom / garbage thickness', () => {
    const e = { kind: 'h' as const, x: 0, z: 0 };
    expect(wallItemTransform(e, 1, T(), 0.4).z).toBeCloseTo(0.2);
    expect(wallItemTransform(e, 1, T(), NaN).z).toBeCloseTo(DIM.WALL_THICKNESS / 2);
    expect(wallItemTransform(e, 1, T(), -3).z).toBeCloseTo(DIM.WALL_THICKNESS / 2);
  });

  it('openings are centred on the wall plane facing side 1', () => {
    const h = openingTransform({ kind: 'h', x: 2, z: 9 }, T());
    expect([h.x, h.z]).toEqual([2.5, 9]);
    expect(front(h.yaw).z).toBeCloseTo(1);
    const v = openingTransform({ kind: 'v', x: 2, z: 9 }, T());
    expect([v.x, v.z]).toEqual([2, 9.5]);
    expect(front(v.yaw).x).toBeCloseTo(1);
    // local +X runs along the edge (either direction is fine for symmetric frames)
    const alongX = { x: Math.cos(v.yaw), z: -Math.sin(v.yaw) };
    expect(Math.abs(alongX.z)).toBeCloseTo(1);
  });

  it('normalizeSide coerces garbage to 0', () => {
    expect(normalizeSide(1)).toBe(1);
    expect(normalizeSide('1')).toBe(1);
    expect(normalizeSide(0)).toBe(0);
    for (const g of [2, -1, NaN, null, undefined, 'x', {}]) expect(normalizeSide(g)).toBe(0);
  });
});
