/**
 * ROTATION / FOOTPRINT GEOMETRY (SIM-SPATIAL) — pure functions, no state.
 *
 * Conventions (src/shared/dimensions.ts + the header of src/shared/catalog.ts):
 *  - LOCAL space (pre-rotation): footprint tiles x in [0,w), z in [0,d); continuous points in [0,w] x [0,d];
 *    FRONT = local +Z. Facing angles: 0 = +Z, PI/2 = +X, PI = -Z, -PI/2 = -X (Three.js rotation.y).
 *  - Floor placement (x,z) = min corner of the ROTATED footprint; rotated size = rotatedSize(w,d,rot).
 *  - Local continuous point (px,pz) -> world: localToWorld(w, d, ox, oz, rot, px, pz) using the UNROTATED w,d.
 *  - Local integer tile (lx,lz) (may lie outside the footprint, e.g. approach tiles) -> world tile
 *    floor(localToWorld(w, d, ox, oz, rot, lx + 0.5, lz + 0.5)).
 *  - Local facing f -> world facing = atan2 of rotateDir(rot, sin f, cos f) (dirToFacing), with near-zero
 *    components snapped so world -Z is always +PI (never -PI). Equivalent to normalizeAngle(f + rotYaw(rot)).
 *  - A `Frame` is any object's local->world transform: floor objects use their placement, wall items use the
 *    mounted tile + wallRot (see edges.ts), loose items use their tile with rot 0.
 */
import { localToWorld, rotateDir, dirToFacing, rotatedSize, type Rot } from '../../shared/dimensions';

export interface Frame {
  /** UNROTATED footprint size (spec.footprint). */
  w: number;
  d: number;
  /** Min corner of the rotated footprint (world tile). */
  ox: number;
  oz: number;
  rot: Rot;
}

export interface Tile {
  x: number;
  z: number;
}

const EPS = 1e-9;

function snap(v: number): number {
  return Math.abs(v) < EPS ? 0 : v;
}

/** Integer rotation 0..3 (any integer is wrapped), or null for non-integers / NaN. */
export function normalizeRot(r: unknown): Rot | null {
  if (typeof r !== 'number' || !Number.isInteger(r)) return null;
  return ((((r % 4) + 4) % 4) as Rot);
}

/** Positive integer footprint dimension (bad data -> 1). */
export function sanitizeDim(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(64, Math.floor(v)));
}

/** World facing (yaw) for a local facing under rotation `rot`. Non-finite input is treated as 0. */
export function worldFacing(rot: Rot, f: number): number {
  const lf = Number.isFinite(f) ? f : 0;
  const v = rotateDir(rot, Math.sin(lf), Math.cos(lf));
  return dirToFacing(snap(v.x), snap(v.z));
}

/** Facing that points from (fx,fz) toward (tx,tz); 0 when the points coincide. */
export function facingToward(fx: number, fz: number, tx: number, tz: number): number {
  const dx = tx - fx;
  const dz = tz - fz;
  if (Math.abs(dx) < EPS && Math.abs(dz) < EPS) return 0;
  return dirToFacing(snap(dx), snap(dz));
}

export function frameSize(f: Frame): { w: number; d: number } {
  return rotatedSize(f.w, f.d, f.rot);
}

export function frameLocalToWorld(f: Frame, px: number, pz: number): { x: number; z: number } {
  return localToWorld(f.w, f.d, f.ox, f.oz, f.rot, px, pz);
}

/** Inverse of frameLocalToWorld. */
export function frameWorldToLocal(f: Frame, x: number, z: number): { x: number; z: number } {
  const rx = x - f.ox;
  const rz = z - f.oz;
  switch (f.rot) {
    case 0:
      return { x: rx, z: rz };
    case 1:
      return { x: rz, z: f.d - rx };
    case 2:
      return { x: f.w - rx, z: f.d - rz };
    case 3:
      return { x: f.w - rz, z: rx };
  }
}

/** World tile for a local integer tile (approach tiles etc.). */
export function frameLocalTile(f: Frame, lx: number, lz: number): Tile {
  const p = frameLocalToWorld(f, lx + 0.5, lz + 0.5);
  return { x: Math.floor(p.x), z: Math.floor(p.z) };
}

/** World tiles covered by the footprint, row-major (z then x). */
export function frameTiles(f: Frame): Tile[] {
  const s = frameSize(f);
  const out: Tile[] = [];
  for (let z = 0; z < s.d; z++) for (let x = 0; x < s.w; x++) out.push({ x: f.ox + x, z: f.oz + z });
  return out;
}

/** World centre of the footprint. */
export function frameCentre(f: Frame): { x: number; z: number } {
  const s = frameSize(f);
  return { x: f.ox + s.w / 2, z: f.oz + s.d / 2 };
}

/** Rotation delta (radians, Three.js yaw) between two rotations. */
export function rotDeltaYaw(from: Rot, to: Rot): number {
  return (-(to - from) * Math.PI) / 2;
}

/**
 * Catalog `faceObject` pose: approach tile centre moved 0.28 toward `centre`, facing `centre`.
 * Degenerate (tile centre == centre) -> tile centre, facing 0.
 */
export function faceObjectPose(tile: Tile, centre: { x: number; z: number }): { x: number; z: number; facing: number } {
  const cx = tile.x + 0.5;
  const cz = tile.z + 0.5;
  const dx = centre.x - cx;
  const dz = centre.z - cz;
  const len = Math.hypot(dx, dz);
  if (!(len > EPS)) return { x: cx, z: cz, facing: 0 };
  const ux = dx / len;
  const uz = dz / len;
  return { x: cx + ux * 0.28, z: cz + uz * 0.28, facing: dirToFacing(snap(ux), snap(uz)) };
}

/** Angle wrap to (-PI, PI]. */
export function wrapAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  let r = a % (Math.PI * 2);
  if (r <= -Math.PI) r += Math.PI * 2;
  if (r > Math.PI) r -= Math.PI * 2;
  return r;
}
