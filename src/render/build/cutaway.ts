/**
 * Wall cutaway decision — pure and unit-tested.
 *
 *  'up'      every wall at full height
 *  'down'    every wall lowered to DIM.WALL_CUTAWAY_HEIGHT
 *  'cutaway' lower a wall when it faces the camera (|n·d| ≥ 0.25, d = horizontal view direction) AND the tile on
 *            its FAR side (away from the camera) is indoors (roomAt ≠ 0). Back walls — whose far side is the outside
 *            world — stay up, as do walls seen nearly edge-on.
 */
import { DIM } from '../../shared/dimensions';
import type { WallMode } from '../contracts';
import { edgeSideTile, type ParsedEdge } from './edges';

/** Minimum |n·d| for a wall to count as camera-facing. */
export const CUTAWAY_FACING_THRESHOLD = 0.25;

export type RoomLookup = (x: number, z: number) => number;

const tmpTile = { x: 0, z: 0 };

/** Safely evaluate a room lookup: exceptions / non-numbers / NaN count as outdoors (0). */
export function safeRoom(roomAt: RoomLookup | null | undefined, x: number, z: number): number {
  if (typeof roomAt !== 'function') return 0;
  try {
    const r = roomAt(x, z);
    return typeof r === 'number' && Number.isFinite(r) ? r : 0;
  } catch {
    return 0;
  }
}

/** Normalised horizontal view direction; garbage / zero-length input falls back to looking toward -Z. */
export function normalizeViewDir(dx: number, dz: number, out: { x: number; z: number }): { x: number; z: number } {
  const len = Math.hypot(dx, dz);
  if (!Number.isFinite(len) || len < 1e-6) {
    out.x = 0;
    out.z = -1;
    return out;
  }
  out.x = dx / len;
  out.z = dz / len;
  return out;
}

const tmpDir = { x: 0, z: -1 };

/**
 * Should this wall be lowered in 'cutaway' mode?
 * @param viewX,viewZ horizontal direction the camera looks along (camera → target); need not be normalised.
 */
export function shouldCutWall(edge: ParsedEdge, viewX: number, viewZ: number, roomAt: RoomLookup | null | undefined): boolean {
  const d = normalizeViewDir(viewX, viewZ, tmpDir);
  // n points to side 1: +Z for 'h', +X for 'v'.
  const dot = edge.kind === 'h' ? d.z : d.x;
  if (!(Math.abs(dot) >= CUTAWAY_FACING_THRESHOLD)) return false;
  // Looking along +n → the far side is side 1; along -n → side 0.
  const farSide: 0 | 1 = dot > 0 ? 1 : 0;
  edgeSideTile(edge, farSide, tmpTile);
  return safeRoom(roomAt, tmpTile.x, tmpTile.z) !== 0;
}

/** Whether a wall is lowered under a given mode. Unknown modes behave like 'up'. */
export function isWallLowered(mode: WallMode | string, edge: ParsedEdge, viewX: number, viewZ: number, roomAt: RoomLookup | null | undefined): boolean {
  if (mode === 'down') return true;
  if (mode === 'cutaway') return shouldCutWall(edge, viewX, viewZ, roomAt);
  return false;
}

/** Target height for a wall given its lowered flag. */
export function wallTargetHeight(lowered: boolean): number {
  return lowered ? DIM.WALL_CUTAWAY_HEIGHT : DIM.WALL_HEIGHT;
}

/**
 * Batch decision: writes 1 (lowered) / 0 (up) per edge into `out` (resized semantics: only the first
 * `edges.length` entries are written). Returns the number of lowered walls.
 */
export function computeCutaway(
  edges: readonly ParsedEdge[],
  mode: WallMode | string,
  viewX: number,
  viewZ: number,
  roomAt: RoomLookup | null | undefined,
  out: Uint8Array,
): number {
  let lowered = 0;
  const n = Math.min(edges.length, out.length);
  for (let i = 0; i < n; i++) {
    const low = isWallLowered(mode, edges[i], viewX, viewZ, roomAt);
    out[i] = low ? 1 : 0;
    if (low) lowered++;
  }
  return lowered;
}
