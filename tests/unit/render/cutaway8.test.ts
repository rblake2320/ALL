/**
 * Cutaway correctness at all 8 camera rotations (the 45° steps rotateCamera() produces), for a two-room house with
 * exterior and interior walls. Property checked against an independent oracle: a wall is lowered iff it faces the
 * camera (|n·d| ≥ 0.25) and the tile on its far side is indoors — so every room interior is visible from every
 * rotation, back walls (far side outdoors) always stay up, and edge-on walls stay up.
 */
import { describe, it, expect } from 'vitest';
import { shouldCutWall, isWallLowered, computeCutaway, CUTAWAY_FACING_THRESHOLD } from '../../../src/render/build/cutaway';
import { parseEdgeKey, edgeSideTile, type ParsedEdge } from '../../../src/render/build/edges';
import { stepYaw, viewDirection, cameraOffset } from '../../../src/render/camera/cameraMath';
import { CameraRig } from '../../../src/render/camera/cameraRig';

/**
 * House: room 1 = x∈[2,6) z∈[2,6); room 2 = x∈[6,10) z∈[2,6) (shared interior wall on line x=6);
 * room 3 (a hallway) = x∈[2,10) z∈[6,8) south of both (interior walls on line z=6).
 */
function roomAt(x: number, z: number): number {
  if (z >= 2 && z < 6 && x >= 2 && x < 6) return 1;
  if (z >= 2 && z < 6 && x >= 6 && x < 10) return 2;
  if (z >= 6 && z < 8 && x >= 2 && x < 10) return 3;
  return 0;
}

const walls: ParsedEdge[] = [];
const kindOf = new Map<ParsedEdge, 'exterior' | 'interior'>();
function add(key: string, kind: 'exterior' | 'interior'): void {
  const e = parseEdgeKey(key)!;
  walls.push(e);
  kindOf.set(e, kind);
}
for (let x = 2; x < 10; x++) {
  add(`h:${x}:2`, 'exterior'); // north
  add(`h:${x}:8`, 'exterior'); // south (street side)
  add(`h:${x}:6`, 'interior'); // rooms ↔ hallway
}
for (let z = 2; z < 8; z++) {
  add(`v:2:${z}`, 'exterior'); // west
  add(`v:10:${z}`, 'exterior'); // east
}
for (let z = 2; z < 6; z++) add(`v:6:${z}`, 'interior'); // room 1 ↔ room 2

/** Independent oracle: far side = the side the view direction points to. */
function oracle(e: ParsedEdge, vx: number, vz: number): boolean {
  const len = Math.hypot(vx, vz);
  const dx = vx / len;
  const dz = vz / len;
  const dot = e.kind === 'h' ? dz : dx;
  if (Math.abs(dot) < CUTAWAY_FACING_THRESHOLD) return false;
  const far = edgeSideTile(e, dot > 0 ? 1 : 0);
  return roomAt(far.x, far.z) !== 0;
}

/** The eight yaws the rig visits from the default view by pressing rotate 8 times. */
function eightYaws(): number[] {
  const out: number[] = [];
  let yaw = Math.PI / 4;
  for (let i = 0; i < 8; i++) {
    out.push(yaw);
    yaw = stepYaw(yaw, 1);
  }
  return out;
}

describe('cutaway at all 8 rotations', () => {
  const yaws = eightYaws();

  it('the rig visits 8 distinct 45° headings and returns home', () => {
    const wrapped = yaws.map((y) => Math.round(((((y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4))) % 8);
    expect(new Set(wrapped).size).toBe(8);
    expect(Math.cos(stepYaw(yaws[7], 1) - yaws[0])).toBeCloseTo(1, 9);
  });

  for (let i = 0; i < 8; i++) {
    it(`rotation ${i}: matches the oracle; every room is opened; back walls stay up`, () => {
      const v = viewDirection(yaws[i], { x: 0, z: 0 });
      const flags = new Uint8Array(walls.length);
      computeCutaway(walls, 'cutaway', v.x, v.z, roomAt, flags);
      for (let k = 0; k < walls.length; k++) {
        const e = walls[k];
        expect(flags[k] === 1, `${e.kind}:${e.x}:${e.z}`).toBe(oracle(e, v.x, v.z));
        expect(shouldCutWall(e, v.x, v.z, roomAt)).toBe(flags[k] === 1);
      }
      // the camera-facing exterior wall of every room is lowered (each interior visible)
      for (const room of [1, 2, 3]) {
        const lowered = walls.filter((e, k) => {
          if (flags[k] !== 1) return false;
          const len = Math.hypot(v.x, v.z);
          const dot = (e.kind === 'h' ? v.z : v.x) / len;
          const far = edgeSideTile(e, dot > 0 ? 1 : 0);
          return roomAt(far.x, far.z) === room;
        });
        expect(lowered.length, `room ${room} opened`).toBeGreaterThan(0);
      }
      // back walls: an exterior wall whose far side is outdoors is never lowered
      for (let k = 0; k < walls.length; k++) {
        const e = walls[k];
        if (kindOf.get(e) !== 'exterior') continue;
        const len = Math.hypot(v.x, v.z);
        const dot = (e.kind === 'h' ? v.z : v.x) / len;
        const far = edgeSideTile(e, dot > 0 ? 1 : 0);
        if (roomAt(far.x, far.z) === 0) expect(flags[k]).toBe(0);
      }
      // diagonal views lower walls on two sides; axis views never lower edge-on walls
      const diag = Math.abs(Math.abs(v.x) - Math.abs(v.z)) < 1e-6;
      if (!diag)
        for (let k = 0; k < walls.length; k++) {
          const e = walls[k];
          const along = e.kind === 'h' ? Math.abs(v.z) : Math.abs(v.x);
          if (along < CUTAWAY_FACING_THRESHOLD) expect(flags[k]).toBe(0);
        }
    });
  }

  it('interior walls drop from every rotation that faces them (rooms behind rooms are visible)', () => {
    const shared = walls.filter((e) => kindOf.get(e) === 'interior');
    for (const yaw of yaws) {
      const v = viewDirection(yaw, { x: 0, z: 0 });
      for (const e of shared) {
        const facing = Math.abs(e.kind === 'h' ? v.z : v.x) / Math.hypot(v.x, v.z) >= CUTAWAY_FACING_THRESHOLD;
        // both sides of an interior wall are indoors → lowered exactly when it faces the camera
        expect(isWallLowered('cutaway', e, v.x, v.z, roomAt)).toBe(facing);
      }
    }
  });

  it('the real CameraRig view direction agrees with viewDirection(yaw) after each rotate()', () => {
    const rig = new CameraRig(16 / 9);
    rig.setBounds({ width: 30, depth: 30 }, true);
    for (let i = 0; i < 8; i++) {
      rig.rotate(1);
      for (let f = 0; f < 240; f++) rig.update(1 / 60, null);
      const cam = rig.camera;
      const fwd = cam.getWorldDirection(cam.position.clone());
      const v = viewDirection(rig.current.yaw, { x: 0, z: 0 });
      const h = Math.hypot(fwd.x, fwd.z);
      expect(fwd.x / h).toBeCloseTo(v.x, 4);
      expect(fwd.z / h).toBeCloseTo(v.z, 4);
      // and the camera sits on the opposite side of the target from where it looks
      const off = cameraOffset(rig.current.yaw, rig.current.pitch, rig.current.distance, { x: 0, y: 0, z: 0 });
      expect(off.x * v.x + off.z * v.z).toBeLessThan(0);
    }
  });

  it("'up' and 'down' ignore rotation entirely", () => {
    for (const yaw of yaws) {
      const v = viewDirection(yaw, { x: 0, z: 0 });
      for (const e of walls) {
        expect(isWallLowered('up', e, v.x, v.z, roomAt)).toBe(false);
        expect(isWallLowered('down', e, v.x, v.z, roomAt)).toBe(true);
      }
    }
  });
});
