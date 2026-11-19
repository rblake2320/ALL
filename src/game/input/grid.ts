/**
 * Grid math for build/buy input (pure).
 *
 * Edge keys (src/sim/types.ts): 'h:x:z' = horizontal edge (x,z)→(x+1,z) on line z; 'v:x:z' = vertical edge
 * (x,z)→(x,z+1) on line x. Side 0 = the -Z tile (h) / -X tile (v); side 1 = the +Z / +X tile.
 * Kept local (instead of importing SIM-SPATIAL's helpers) so input works even while that module is mid-edit.
 */
import type { EdgeKey } from '../../sim/types';
import { localToWorld, rotatedSize, type Rot } from '../../shared/dimensions';
import type { PhysicalSpec } from '../../shared/catalog';

export interface ParsedEdge {
  dir: 'h' | 'v';
  x: number;
  z: number;
}

export interface TileXZ {
  x: number;
  z: number;
}

/** Longest wall run / widest rectangle a single drag may produce (the lot is 30×30). */
export const MAX_RUN = 64;
export const MAX_RECT = 64;

export function edgeKey(dir: 'h' | 'v', x: number, z: number): EdgeKey {
  return `${dir}:${x}:${z}`;
}

export function parseEdge(key: unknown): ParsedEdge | null {
  if (typeof key !== 'string') return null;
  const m = /^([hv]):(-?\d{1,6}):(-?\d{1,6})$/.exec(key);
  if (!m) return null;
  return { dir: m[1] as 'h' | 'v', x: Number(m[2]), z: Number(m[3]) };
}

/** Tile on a given side of an edge. */
export function edgeSideTile(e: ParsedEdge, side: 0 | 1): TileXZ {
  if (e.dir === 'h') return side === 0 ? { x: e.x, z: e.z - 1 } : { x: e.x, z: e.z };
  return side === 0 ? { x: e.x - 1, z: e.z } : { x: e.x, z: e.z };
}

/**
 * Continuous world position from renderer.pickGrid(). The render contract pins `fx`/`fz` as ABSOLUTE world tile
 * coordinates with x <= fx < x+1; values are clamped into the reported tile (float error at tile borders can never
 * shift a placement by a whole tile) and non-finite values fall back to the tile centre.
 */
export function gridPoint(g: { x: number; z: number; fx: number; fz: number }): { x: number; z: number } {
  const norm = (tile: number, f: number): number => {
    if (!Number.isFinite(f)) return tile + 0.5;
    return Math.min(tile + 1, Math.max(tile, f));
  };
  return { x: norm(g.x, g.fx), z: norm(g.z, g.fz) };
}

export function nearestVertex(p: { x: number; z: number }): TileXZ {
  return { x: Math.round(p.x), z: Math.round(p.z) };
}

/** Straight wall run between two grid vertices, snapped to the dominant axis. */
export function wallRun(a: TileXZ, b: TileXZ): EdgeKey[] {
  if (![a.x, a.z, b.x, b.z].every(Number.isFinite)) return [];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const out: EdgeKey[] = [];
  if (dx === 0 && dz === 0) return out;
  if (Math.abs(dx) >= Math.abs(dz)) {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.min(Math.max(a.x, b.x), x0 + MAX_RUN);
    for (let x = x0; x < x1; x++) out.push(edgeKey('h', x, a.z));
  } else {
    const z0 = Math.min(a.z, b.z);
    const z1 = Math.min(Math.max(a.z, b.z), z0 + MAX_RUN);
    for (let z = z0; z < z1; z++) out.push(edgeKey('v', a.x, z));
  }
  return out;
}

export interface TileRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Half-open rectangle covering both tiles (inclusive drag), bounded to MAX_RECT per side. */
export function tileRect(a: TileXZ, b: TileXZ): TileRect {
  const x0 = Math.min(a.x, b.x);
  const z0 = Math.min(a.z, b.z);
  const x1 = Math.min(Math.max(a.x, b.x) + 1, x0 + MAX_RECT);
  const z1 = Math.min(Math.max(a.z, b.z) + 1, z0 + MAX_RECT);
  return { x0, z0, x1, z1 };
}

export function rectTiles(r: TileRect): TileXZ[] {
  const out: TileXZ[] = [];
  for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) out.push({ x, z });
  return out;
}

export function rectArea(r: TileRect): number {
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.z1 - r.z0);
}

/** Floor placement: min corner of the rotated footprint such that the cursor sits at its centre. */
export function floorOrigin(footprint: { w: number; d: number }, rot: Rot, cursor: { x: number; z: number }): TileXZ {
  const w = Math.max(1, Math.floor(footprint.w || 1));
  const d = Math.max(1, Math.floor(footprint.d || 1));
  const size = rotatedSize(w, d, rot);
  return { x: Math.round(cursor.x - size.w / 2), z: Math.round(cursor.z - size.d / 2) };
}

/** World tiles marking the approach spots of blocked slots (for the placement ghost). */
export function slotMarkerTiles(spec: Pick<PhysicalSpec, 'footprint' | 'slots'>, ox: number, oz: number, rot: Rot, blocked: readonly number[]): TileXZ[] {
  const out: TileXZ[] = [];
  const seen = new Set<string>();
  const w = spec.footprint.w;
  const d = spec.footprint.d;
  for (const i of blocked) {
    const slot = Number.isInteger(i) ? spec.slots[i] : undefined;
    if (!slot) continue;
    for (const ap of slot.approach) {
      const p = localToWorld(w, d, ox, oz, rot, ap.x + 0.5, ap.z + 0.5);
      const t = { x: Math.floor(p.x), z: Math.floor(p.z) };
      const k = `${t.x},${t.z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

export function normalizeRot(r: number): Rot {
  const n = Number.isFinite(r) ? ((Math.round(r) % 4) + 4) % 4 : 0;
  return n as Rot;
}

/** Screen direction of a keyboard placement step (arrow keys). */
export type ScreenDir = 'up' | 'down' | 'left' | 'right';

/**
 * Grid step for an arrow key, relative to the camera so ↑ always moves the ghost "up the screen" (away from the
 * viewer). Camera contract (render/contracts.ts): the camera sits at target + (sin yaw, cos yaw), so "away" is
 * (−sin yaw, −cos yaw) and "screen right" is (cos yaw, −sin yaw). Near a diagonal view (45° steps) the step is
 * diagonal, which keeps ↑ and → perpendicular on screen; otherwise it snaps to the dominant axis.
 */
export function gridStepForScreen(yaw: number, dir: ScreenDir): TileXZ {
  const y = Number.isFinite(yaw) ? yaw : 0;
  const away = { x: -Math.sin(y), z: -Math.cos(y) };
  const right = { x: Math.cos(y), z: -Math.sin(y) };
  const v = dir === 'up' ? away : dir === 'down' ? { x: -away.x, z: -away.z } : dir === 'right' ? right : { x: -right.x, z: -right.z };
  const ax = Math.abs(v.x);
  const az = Math.abs(v.z);
  // within ±22.5° of a diagonal (sin 22.5° ≈ 0.383) → diagonal step
  const DIAG = 0.383;
  const sx = ax >= DIAG ? Math.sign(v.x) : 0;
  const sz = az >= DIAG ? Math.sign(v.z) : 0;
  return { x: sx + 0, z: sz + 0 };
}

/**
 * The edge of tile (x, z) a keyboard-placed wall item / door / window uses, picked by the placement rotation
 * (R cycles it): 0 = the tile's −Z edge, 1 = +X, 2 = +Z, 3 = −X. `side` is the side of that edge the tile is on,
 * so a wall item faces into the tile the cursor marks.
 */
export function tileEdge(x: number, z: number, rot: Rot): { edge: EdgeKey; side: 0 | 1 } {
  switch (normalizeRot(rot)) {
    case 0:
      return { edge: edgeKey('h', x, z), side: 1 };
    case 1:
      return { edge: edgeKey('v', x + 1, z), side: 0 };
    case 2:
      return { edge: edgeKey('h', x, z + 1), side: 0 };
    default:
      return { edge: edgeKey('v', x, z), side: 1 };
  }
}

/** Clamp a tile into a w × d lot (0-based). */
export function clampTile(t: TileXZ, w: number, d: number): TileXZ {
  const W = Number.isFinite(w) && w >= 1 ? Math.floor(w) : 1;
  const D = Number.isFinite(d) && d >= 1 ? Math.floor(d) : 1;
  const cx = Number.isFinite(t.x) ? Math.round(t.x) : 0;
  const cz = Number.isFinite(t.z) ? Math.round(t.z) : 0;
  return { x: Math.min(W - 1, Math.max(0, cx)), z: Math.min(D - 1, Math.max(0, cz)) };
}
