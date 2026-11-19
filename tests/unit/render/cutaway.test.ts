import { describe, it, expect } from 'vitest';
import { shouldCutWall, isWallLowered, computeCutaway, wallTargetHeight, safeRoom, normalizeViewDir, CUTAWAY_FACING_THRESHOLD } from '../../../src/render/build/cutaway';
import { parseEdgeKey, type ParsedEdge } from '../../../src/render/build/edges';
import { DIM } from '../../../src/shared/dimensions';

/** A 4×4 room occupying tiles x∈[2,6), z∈[2,6) (room id 1); everything else outdoors. */
function roomAt(x: number, z: number): number {
  return x >= 2 && x < 6 && z >= 2 && z < 6 ? 1 : 0;
}

const E = (k: string): ParsedEdge => {
  const e = parseEdgeKey(k);
  if (!e) throw new Error('bad edge ' + k);
  return e;
};

// Room walls
const front = E('h:3:6'); // line z=6, between room tile (3,5) [side 0] and outside (3,6) [side 1]
const back = E('h:3:2'); // line z=2, outside (3,1) [side 0], room (3,2) [side 1]
const left = E('v:2:3'); // line x=2, outside (1,3) [side 0], room (2,3) [side 1]
const right = E('v:6:3'); // line x=6, room (5,3) [side 0], outside (6,3) [side 1]
const interior = E('v:4:3'); // inside the room: both sides indoor

describe('cutaway decision', () => {
  // Camera on the street side (+Z) looking toward -Z.
  const vx = 0;
  const vz = -1;

  it('lowers the front wall whose far side is the room interior', () => {
    expect(shouldCutWall(front, vx, vz, roomAt)).toBe(true);
  });

  it('keeps the back wall up (far side is outdoors)', () => {
    expect(shouldCutWall(back, vx, vz, roomAt)).toBe(false);
  });

  it('keeps edge-on side walls up when |n·d| < threshold', () => {
    expect(shouldCutWall(left, vx, vz, roomAt)).toBe(false);
    expect(shouldCutWall(right, vx, vz, roomAt)).toBe(false);
  });

  it('lowers interior walls facing the camera, keeps them edge-on', () => {
    // interior v-wall seen from +X (camera looks toward -X)
    expect(shouldCutWall(interior, -1, 0, roomAt)).toBe(true);
    // seen edge-on from +Z
    expect(shouldCutWall(interior, 0, -1, roomAt)).toBe(false);
  });

  it('flips which walls drop when the camera moves to the back (-Z looking +Z)', () => {
    expect(shouldCutWall(back, 0, 1, roomAt)).toBe(true);
    expect(shouldCutWall(front, 0, 1, roomAt)).toBe(false);
  });

  it('diagonal 3/4 view lowers the two camera-facing walls only', () => {
    // camera at +X+Z looking toward -X-Z
    const d = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
    expect(shouldCutWall(front, d.x, d.z, roomAt)).toBe(true);
    expect(shouldCutWall(right, d.x, d.z, roomAt)).toBe(true);
    expect(shouldCutWall(back, d.x, d.z, roomAt)).toBe(false);
    expect(shouldCutWall(left, d.x, d.z, roomAt)).toBe(false);
  });

  it('threshold boundary: exactly 0.25 counts as facing; just below does not', () => {
    const t = CUTAWAY_FACING_THRESHOLD;
    const along = Math.sqrt(1 - t * t);
    expect(shouldCutWall(front, along, -t, roomAt)).toBe(true);
    const t2 = t - 0.01;
    expect(shouldCutWall(front, Math.sqrt(1 - t2 * t2), -t2, roomAt)).toBe(false);
  });

  it('view direction need not be normalised', () => {
    expect(shouldCutWall(front, 0, -250, roomAt)).toBe(true);
  });

  it('modes: up never lowers, down always lowers, unknown behaves like up', () => {
    for (const e of [front, back, left, right, interior]) {
      expect(isWallLowered('up', e, vx, vz, roomAt)).toBe(false);
      expect(isWallLowered('down', e, vx, vz, roomAt)).toBe(true);
      expect(isWallLowered('sideways', e, vx, vz, roomAt)).toBe(false);
    }
  });

  it('batch computeCutaway writes flags and counts lowered walls', () => {
    const edges = [front, back, left, right];
    const out = new Uint8Array(4);
    expect(computeCutaway(edges, 'cutaway', vx, vz, roomAt, out)).toBe(1);
    expect([...out]).toEqual([1, 0, 0, 0]);
    expect(computeCutaway(edges, 'down', vx, vz, roomAt, out)).toBe(4);
    // short output buffer: no overflow
    const small = new Uint8Array(2);
    expect(computeCutaway(edges, 'down', vx, vz, roomAt, small)).toBe(2);
  });

  it('target heights', () => {
    expect(wallTargetHeight(true)).toBe(DIM.WALL_CUTAWAY_HEIGHT);
    expect(wallTargetHeight(false)).toBe(DIM.WALL_HEIGHT);
  });

  describe('adversarial', () => {
    it('NaN / zero view directions fall back to looking toward -Z', () => {
      expect(normalizeViewDir(NaN, NaN, { x: 0, z: 0 })).toEqual({ x: 0, z: -1 });
      expect(normalizeViewDir(0, 0, { x: 0, z: 0 })).toEqual({ x: 0, z: -1 });
      expect(normalizeViewDir(Infinity, 1, { x: 0, z: 0 })).toEqual({ x: 0, z: -1 });
      expect(shouldCutWall(front, NaN, NaN, roomAt)).toBe(true); // same as default (-Z)
    });

    it('throwing / garbage room lookups count as outdoors', () => {
      const throwing = () => {
        throw new Error('spatial not ready');
      };
      expect(shouldCutWall(front, vx, vz, throwing)).toBe(false);
      expect(shouldCutWall(front, vx, vz, () => NaN)).toBe(false);
      expect(shouldCutWall(front, vx, vz, (() => 'kitchen') as unknown as (x: number, z: number) => number)).toBe(false);
      expect(shouldCutWall(front, vx, vz, null)).toBe(false);
      expect(safeRoom(undefined, 1, 1)).toBe(0);
      expect(safeRoom(() => Infinity, 1, 1)).toBe(0);
    });

    it('negative / huge coordinates do not throw', () => {
      expect(() => shouldCutWall({ kind: 'h', x: -99999, z: 99999 }, vx, vz, roomAt)).not.toThrow();
      expect(shouldCutWall({ kind: 'v', x: -5, z: -5 }, -1, 0, roomAt)).toBe(false);
    });
  });
});
