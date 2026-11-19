import { describe, it, expect } from 'vitest';
import { placementTransform, createPlacementTransform, normalizeRot, floorCenter, sanitizeDim, placementSignature, yawForRot } from '../../../src/render/objects/placement';
import { localToWorld, rotYaw, rotatedSize, type Rot } from '../../../src/shared/dimensions';
import { DIM } from '../../../src/shared/dimensions';
import type { ObjectPlacement } from '../../../src/sim/types';

const ROTS: Rot[] = [0, 1, 2, 3];
const FOOTPRINTS = [
  { w: 1, d: 1 },
  { w: 2, d: 1 },
  { w: 3, d: 1 },
  { w: 1, d: 2 },
  { w: 2, d: 2 },
  { w: 3, d: 2 },
];

/** Three.js rotation.y applied to a local (x,z) vector. */
function rotY(yaw: number, x: number, z: number): { x: number; z: number } {
  return { x: x * Math.cos(yaw) + z * Math.sin(yaw), z: -x * Math.sin(yaw) + z * Math.cos(yaw) };
}

describe('floor placement transforms', () => {
  it('centre matches localToWorld(w,d,ox,oz,rot,w/2,d/2) and yaw matches rotYaw for every rotation', () => {
    for (const fp of FOOTPRINTS) {
      for (const r of ROTS) {
        const out = placementTransform({ kind: 'floor', x: 7, z: 11, rot: r }, fp, createPlacementTransform());
        const ref = localToWorld(fp.w, fp.d, 7, 11, r, fp.w / 2, fp.d / 2);
        expect(out.visible).toBe(true);
        expect(out.x).toBeCloseTo(ref.x, 12);
        expect(out.z).toBeCloseTo(ref.z, 12);
        expect(out.yaw).toBeCloseTo(rotYaw(r), 12);
        expect(out.y).toBe(0);
      }
    }
  });

  it('the model-local footprint corners land exactly on the rotated footprint in world space', () => {
    for (const fp of FOOTPRINTS) {
      for (const r of ROTS) {
        const ox = 4;
        const oz = 9;
        const out = placementTransform({ kind: 'floor', x: ox, z: oz, rot: r }, fp, createPlacementTransform());
        const rs = rotatedSize(fp.w, fp.d, r);
        // model local is centred: corners at ±w/2, ±d/2
        for (const [lx, lz] of [
          [-fp.w / 2, -fp.d / 2],
          [fp.w / 2, -fp.d / 2],
          [fp.w / 2, fp.d / 2],
          [-fp.w / 2, fp.d / 2],
        ]) {
          const v = rotY(out.yaw, lx, lz);
          const wx = out.x + v.x;
          const wz = out.z + v.z;
          expect(wx).toBeGreaterThanOrEqual(ox - 1e-9);
          expect(wx).toBeLessThanOrEqual(ox + rs.w + 1e-9);
          expect(wz).toBeGreaterThanOrEqual(oz - 1e-9);
          expect(wz).toBeLessThanOrEqual(oz + rs.d + 1e-9);
          // and equals localToWorld of the corresponding footprint-space point
          const ref = localToWorld(fp.w, fp.d, ox, oz, r, lx + fp.w / 2, lz + fp.d / 2);
          expect(wx).toBeCloseTo(ref.x, 9);
          expect(wz).toBeCloseTo(ref.z, 9);
        }
      }
    }
  });

  it('floorCenter agrees with localToWorld on fractional origins', () => {
    for (const r of ROTS) {
      const a = floorCenter(3, 2, 1.25, -4.5, r, { x: 0, z: 0 });
      const b = localToWorld(3, 2, 1.25, -4.5, r, 1.5, 1);
      expect(a.x).toBeCloseTo(b.x, 12);
      expect(a.z).toBeCloseTo(b.z, 12);
    }
  });

  it('yawForRot equals rotYaw', () => {
    for (const r of ROTS) expect(yawForRot(r)).toBe(rotYaw(r));
  });
});

describe('other placement kinds', () => {
  it('wall items: on the wall surface, facing into the mounted tile', () => {
    const out = placementTransform({ kind: 'wall', edge: 'h:5:8', side: 0 }, { w: 1, d: 1 }, createPlacementTransform());
    expect(out.visible).toBe(true);
    expect(out.x).toBeCloseTo(5.5);
    expect(out.z).toBeCloseTo(8 - DIM.WALL_THICKNESS / 2);
    expect(Math.cos(out.yaw)).toBeCloseTo(-1); // facing -Z (into tile (5,7))
    const v = placementTransform({ kind: 'wall', edge: 'v:5:8', side: 1 }, null, createPlacementTransform());
    expect(v.x).toBeCloseTo(5 + DIM.WALL_THICKNESS / 2);
    expect(v.z).toBeCloseTo(8.5);
    expect(Math.sin(v.yaw)).toBeCloseTo(1); // facing +X
  });

  it('openings: centred on the wall plane', () => {
    const out = placementTransform({ kind: 'opening', edge: 'v:3:4' }, { w: 1, d: 1 }, createPlacementTransform());
    expect([out.x, out.z, out.visible]).toEqual([3, 4.5, true]);
  });

  it('loose items: exact position, height and facing', () => {
    const out = placementTransform({ kind: 'loose', x: 3.3, z: 4.4, y: 0.76, parentId: null, surfaceIndex: null, facing: 1.2 }, null, createPlacementTransform());
    expect([out.x, out.y, out.z, out.yaw, out.visible]).toEqual([3.3, 0.76, 4.4, 1.2, true]);
  });

  it('held items are hidden', () => {
    expect(placementTransform({ kind: 'held', agentId: 'a1' }, null, createPlacementTransform()).visible).toBe(false);
  });
});

describe('adversarial placements', () => {
  it('rotation garbage normalises into 0..3', () => {
    expect(normalizeRot(5)).toBe(1);
    expect(normalizeRot(-1)).toBe(3);
    expect(normalizeRot(-6)).toBe(2);
    expect(normalizeRot(2.4)).toBe(2);
    for (const g of [NaN, Infinity, '2', null, undefined, {}]) expect(normalizeRot(g)).toBe(0);
  });

  it('NaN / missing coordinates hide instead of throwing', () => {
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'floor',
      {},
      { kind: 'floor', x: NaN, z: 1, rot: 0 },
      { kind: 'floor', x: 1, z: Infinity, rot: 0 },
      { kind: 'loose', x: 'a', z: 1, y: 0, facing: 0 },
      { kind: 'wall', edge: 'nope', side: 1 },
      { kind: 'wall', edge: 12, side: 1 },
      { kind: 'opening', edge: null },
      { kind: 'teleport', x: 1, z: 1 },
    ];
    for (const p of bad) {
      const out = placementTransform(p as ObjectPlacement, { w: 1, d: 1 }, createPlacementTransform());
      expect(out.visible).toBe(false);
    }
  });

  it('garbage footprints fall back to 1×1, loose garbage height/facing to 0', () => {
    const out = placementTransform({ kind: 'floor', x: 2, z: 2, rot: 0 }, { w: NaN, d: -3 }, createPlacementTransform());
    expect([out.x, out.z]).toEqual([2.5, 2.5]);
    expect(sanitizeDim(0)).toBe(1);
    expect(sanitizeDim(1e9)).toBe(1);
    const l = placementTransform({ kind: 'loose', x: 1, z: 1, y: NaN, parentId: null, surfaceIndex: null, facing: Infinity } as ObjectPlacement, null, createPlacementTransform());
    expect([l.y, l.yaw]).toEqual([0, 0]);
  });

  it('wall item side garbage defaults to side 0', () => {
    const out = placementTransform({ kind: 'wall', edge: 'h:1:1', side: 7 as unknown as 0 }, null, createPlacementTransform());
    expect(out.z).toBeCloseTo(1 - DIM.WALL_THICKNESS / 2);
  });

  it('placement signatures change when the placement moves and stay finite on garbage', () => {
    const a = placementSignature({ kind: 'floor', x: 1, z: 2, rot: 0 });
    const b = placementSignature({ kind: 'floor', x: 1, z: 2, rot: 1 });
    const c = placementSignature({ kind: 'floor', x: 2, z: 1, rot: 0 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(placementSignature({ kind: 'wall', edge: 'h:1:1', side: 0 })).not.toBe(placementSignature({ kind: 'wall', edge: 'h:1:1', side: 1 }));
    expect(Number.isFinite(placementSignature({ kind: 'floor', x: NaN, z: NaN, rot: NaN } as unknown as ObjectPlacement))).toBe(true);
    expect(placementSignature(null)).toBe(-1);
  });
});
