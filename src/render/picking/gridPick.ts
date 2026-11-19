/**
 * Ground-point → build grid query (tile, fractional coords, nearest edge within a radius, cursor side).
 * Pure; unit-tested.
 */
import type { EdgeKey } from '../../sim/types';

export interface GridPick {
  x: number;
  z: number;
  fx: number;
  fz: number;
  edge: EdgeKey | null;
  edgeSide: 0 | 1;
}

/** Max distance (tiles) from a tile edge for it to count as "hovered". */
export const EDGE_PICK_RADIUS = 0.3;

/**
 * Resolve a world ground point (fx, fz) into the grid. Returns null for non-finite input or points outside the
 * lot rectangle [0,width) × [0,depth).
 *
 * Edge choice: the closest of the tile's four edges within `radius` (ties resolved left, right, top, bottom).
 * edgeSide is the side of that edge the cursor is on (side 0 = -X/-Z tile, side 1 = +X/+Z tile).
 * When no edge is near, edge = null and edgeSide = 0.
 */
export function gridPickAt(fx: number, fz: number, width: number, depth: number, radius: number = EDGE_PICK_RADIUS): GridPick | null {
  if (!Number.isFinite(fx) || !Number.isFinite(fz)) return null;
  const w = Number.isFinite(width) && width > 0 ? Math.floor(width) : 0;
  const d = Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 0;
  if (fx < 0 || fz < 0 || fx >= w || fz >= d) return null;
  const x = Math.floor(fx);
  const z = Math.floor(fz);
  const r = Number.isFinite(radius) && radius >= 0 ? Math.min(radius, 0.5) : EDGE_PICK_RADIUS;

  const dl = fx - x; // to the left edge (line x)
  const dr = x + 1 - fx; // to the right edge (line x+1)
  const dt = fz - z; // to the top edge (line z)
  const db = z + 1 - fz; // to the bottom edge (line z+1)

  let best = Infinity;
  let which = -1;
  const ds = [dl, dr, dt, db];
  for (let i = 0; i < 4; i++) {
    const di = ds[i];
    if (di <= r && di < best) {
      best = di;
      which = i;
    }
  }
  let edge: EdgeKey | null = null;
  let side: 0 | 1 = 0;
  switch (which) {
    case 0:
      edge = `v:${x}:${z}`;
      side = 1; // cursor's tile is on the +X side of line x
      break;
    case 1:
      edge = `v:${x + 1}:${z}`;
      side = 0;
      break;
    case 2:
      edge = `h:${x}:${z}`;
      side = 1; // +Z side of line z
      break;
    case 3:
      edge = `h:${x}:${z + 1}`;
      side = 0;
      break;
  }
  return { x, z, fx, fz, edge, edgeSide: side };
}
