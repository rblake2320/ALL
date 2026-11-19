/**
 * EDGE & WALL-FRAME HELPERS (SIM-SPATIAL) — pure functions, no state.
 *
 * Conventions (shared with the renderer and the build UI; see src/sim/types.ts `EdgeKey` / `WallSegment`
 * and src/shared/dimensions.ts):
 *  - World axes: X right, Z toward the street. Tile (x,z) spans [x,x+1] x [z,z+1].
 *  - 'h:x:z' = horizontal edge from point (x,z) to (x+1,z) — lies on the line Z = z.
 *      side 0 = tile (x, z-1) (the -Z tile), side 1 = tile (x, z) (the +Z tile).
 *  - 'v:x:z' = vertical edge from point (x,z) to (x,z+1) — lies on the line X = x.
 *      side 0 = tile (x-1, z) (the -X tile), side 1 = tile (x, z) (the +X tile).
 *  - Movement crossings: (x,z)->(x+1,z) crosses 'v:(x+1):z'; (x,z)->(x-1,z) crosses 'v:x:z';
 *    (x,z)->(x,z+1) crosses 'h:x:(z+1)'; (x,z)->(x,z-1) crosses 'h:x:z'.
 *  - Canonical keys use base-10 integers with no leading zeros and never "-0" ("h:0:5"). `normalizeEdge` canonicalises
 *    any parseable key; every key stored in LotState.walls should be canonical.
 *  - Invalid edges: helpers that must return coordinates (edgeSides / wallLocalToWorld / openingFrame) return NaN
 *    coordinates for unparseable keys (NaN tiles are out of bounds everywhere in the spatial API). Validate with
 *    parseEdge() first when you need to branch.
 *
 * Wall-item frame (catalog header: local x in [0,1] runs along the wall edge, z = 0 is the wall surface, +Z points into
 * the tile on the mounted side, local tile (0,0) is that tile):
 *  - Equivalent to a 1x1 floor footprint sitting on the mounted tile with rotation `wallRot(kind, side)`:
 *      h side 1 -> rot 0 (front +Z), h side 0 -> rot 2 (front -Z), v side 1 -> rot 3 (front +X), v side 0 -> rot 1 (front -X).
 *    i.e. the rotation whose local +Z is the inward normal. Local points map with dimensions.localToWorld(1,1,tile,rot,…),
 *    so the handedness (and therefore model mirroring) is identical to floor objects.
 *  - `wallLocalToWorld(...).facing` is the yaw of the item's local +Z (the inward normal): use it as Three.js rotation.y.
 *
 * Opening frame (doors/windows, catalog header: local x in [0,1] along the edge, model centred on the wall plane):
 *  - `openingFrame(edge)` = edge midpoint + yaw (Three.js rotation.y) such that local +X runs along the edge and
 *    local +Z points toward side 1: 'h' edges -> yaw 0 (local +X = world +X), 'v' edges -> yaw PI/2 (local +X = world -Z).
 */
import type { EdgeKey } from '../types';
import { localToWorld, type Rot } from '../../shared/dimensions';
import { worldFacing } from './geometry';

export type EdgeKind = 'h' | 'v';

export interface ParsedEdge {
  kind: EdgeKind;
  x: number;
  z: number;
}

export interface TileXZ {
  x: number;
  z: number;
}

const EDGE_RE = /^([hv]):(-?\d{1,7}):(-?\d{1,7})$/;
/** Refuse to enumerate absurd rectangles (bad UI input) — far above any lot size. */
const RECT_EDGE_CAP = 20000;

/** Canonical key for an edge. Coordinates are rounded to integers (tolerates float noise like 3.0000001). */
export function edgeKey(kind: EdgeKind, x: number, z: number): EdgeKey {
  return `${kind}:${Math.round(x)}:${Math.round(z)}`;
}

/** Parse 'h:x:z' / 'v:x:z'. Returns null for anything malformed (wrong kind, non-integer, junk). */
export function parseEdge(key: unknown): ParsedEdge | null {
  if (typeof key !== 'string') return null;
  const m = EDGE_RE.exec(key);
  if (!m) return null;
  const x = Number(m[2]) || 0; // `|| 0` folds -0 to 0
  const z = Number(m[3]) || 0;
  return { kind: m[1] as EdgeKind, x, z };
}

/** Canonical form of a parseable key ("h:-0:05" -> "h:0:5"), or null. */
export function normalizeEdge(key: unknown): EdgeKey | null {
  const e = parseEdge(key);
  return e ? edgeKey(e.kind, e.x, e.z) : null;
}

function isInt(v: number): boolean {
  return Number.isInteger(v);
}

/** The edge crossed when stepping between two ORTHOGONALLY adjacent tiles; null otherwise (diagonal, same, far, non-integer). */
export function edgeBetween(ax: number, az: number, bx: number, bz: number): EdgeKey | null {
  if (!isInt(ax) || !isInt(az) || !isInt(bx) || !isInt(bz)) return null;
  const dx = bx - ax;
  const dz = bz - az;
  if (dx === 1 && dz === 0) return edgeKey('v', ax + 1, az);
  if (dx === -1 && dz === 0) return edgeKey('v', ax, az);
  if (dx === 0 && dz === 1) return edgeKey('h', ax, az + 1);
  if (dx === 0 && dz === -1) return edgeKey('h', ax, az);
  return null;
}

/** [side0Tile, side1Tile] — see the side rule above. NaN tiles for an invalid key. */
export function edgeSides(edge: EdgeKey): [TileXZ, TileXZ] {
  const e = parseEdge(edge);
  if (!e) return [{ x: NaN, z: NaN }, { x: NaN, z: NaN }];
  return e.kind === 'h'
    ? [
        { x: e.x, z: e.z - 1 },
        { x: e.x, z: e.z },
      ]
    : [
        { x: e.x - 1, z: e.z },
        { x: e.x, z: e.z },
      ];
}

/**
 * Perimeter edges of the tile rectangle [x0,x1) x [z0,z1). Corners may be given in either order (they are sorted);
 * coordinates are floored. Order: top row (h on z0, x ascending), bottom row (h on z1), left column (v on x0, z
 * ascending), right column (v on x1). Empty for empty/invalid rectangles or absurd sizes (> 20k edges).
 */
export function rectEdges(x0: number, z0: number, x1: number, z1: number): EdgeKey[] {
  if (![x0, z0, x1, z1].every(Number.isFinite)) return [];
  let ax = Math.floor(x0);
  let bx = Math.floor(x1);
  let az = Math.floor(z0);
  let bz = Math.floor(z1);
  if (ax > bx) [ax, bx] = [bx, ax];
  if (az > bz) [az, bz] = [bz, az];
  const w = bx - ax;
  const d = bz - az;
  if (w <= 0 || d <= 0) return [];
  if (2 * (w + d) > RECT_EDGE_CAP) return [];
  const out: EdgeKey[] = [];
  for (let x = ax; x < bx; x++) out.push(edgeKey('h', x, az));
  for (let x = ax; x < bx; x++) out.push(edgeKey('h', x, bz));
  for (let z = az; z < bz; z++) out.push(edgeKey('v', ax, z));
  for (let z = az; z < bz; z++) out.push(edgeKey('v', bx, z));
  return out;
}

/** Rotation of the wall-item frame for a mounted side (its local +Z = inward normal). */
export function wallRot(kind: EdgeKind, side: 0 | 1): Rot {
  if (kind === 'h') return side === 1 ? 0 : 2;
  return side === 1 ? 3 : 1;
}

/** Mounted tile + frame rotation of a wall item; null for an invalid edge/side. */
export function wallFrame(edge: EdgeKey, side: number): { tile: TileXZ; rot: Rot; kind: EdgeKind } | null {
  const e = parseEdge(edge);
  if (!e || (side !== 0 && side !== 1)) return null;
  const tile = edgeSides(edge)[side];
  return { tile, rot: wallRot(e.kind, side), kind: e.kind };
}

/**
 * Wall-item local point -> world. (px,pz): local continuous coords (x along the edge in [0,1], z = distance from the
 * wall into the mounted tile). `facing` = world yaw of the item's front (inward normal). NaN for invalid input.
 */
export function wallLocalToWorld(edge: EdgeKey, side: 0 | 1, px: number, pz: number): { x: number; z: number; facing: number } {
  const f = wallFrame(edge, side);
  if (!f || !Number.isFinite(px) || !Number.isFinite(pz)) return { x: NaN, z: NaN, facing: 0 };
  const p = localToWorld(1, 1, f.tile.x, f.tile.z, f.rot, px, pz);
  return { x: p.x, z: p.z, facing: worldFacing(f.rot, 0) };
}

/** Midpoint of an edge (NaN for an invalid key). */
export function edgeMidpoint(edge: EdgeKey): { x: number; z: number } {
  const e = parseEdge(edge);
  if (!e) return { x: NaN, z: NaN };
  return e.kind === 'h' ? { x: e.x + 0.5, z: e.z } : { x: e.x, z: e.z + 0.5 };
}

/** Door/window placement frame: edge centre + yaw so local +X runs along the edge and local +Z points to side 1. */
export function openingFrame(edge: EdgeKey): { x: number; z: number; yaw: number } {
  const e = parseEdge(edge);
  if (!e) return { x: NaN, z: NaN, yaw: 0 };
  const m = edgeMidpoint(edge);
  return { x: m.x, z: m.z, yaw: e.kind === 'h' ? 0 : Math.PI / 2 };
}

/**
 * Edges crossed walking in a straight orthogonal line between two tiles that share a row or column
 * (exclusive of the tiles themselves). Empty when not aligned or identical.
 */
export function edgesBetweenAligned(a: TileXZ, b: TileXZ): EdgeKey[] {
  const out: EdgeKey[] = [];
  if (a.x === b.x && a.z !== b.z) {
    const lo = Math.min(a.z, b.z);
    const hi = Math.max(a.z, b.z);
    for (let z = lo + 1; z <= hi; z++) out.push(edgeKey('h', a.x, z));
  } else if (a.z === b.z && a.x !== b.x) {
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    for (let x = lo + 1; x <= hi; x++) out.push(edgeKey('v', x, a.z));
  }
  return out;
}
