/**
 * Where a zombie may walk in the shared town, step 1: Mildew Lane's street, verge to verge.
 *
 * PURE. The area is read from the same map the game draws (src/shared/mildewLane.ts), so the server and every
 * browser agree on it. Positions are world tiles. The inside of every lot stays private: step 1 never lets a shared
 * zombie leave the street.
 */
import { buildWorldMap, MILDEW_LANE_GEN_VERSION, WORLD_CONTENT_VERSION, LEGACY_HOME_SLOT, slotRegionId } from '../mildewLane';
import type { WorldRect, WorldRegionDef } from '../world';

/** The shared town's world seed: every browser draws the same town. */
export const TOWN_SEED = 0x7031_a11e;
/** A zombie is kept this far (tiles) inside the edge of the walkable area. */
export const PLAYER_RADIUS = 0.3;

export interface WalkArea {
  rects: readonly WorldRect[];
  /** Regions the rects came from, in the same order (a browser needs the region to draw a zombie in it). */
  regions: readonly WorldRegionDef[];
}

const townMap = () => buildWorldMap({ genVersion: MILDEW_LANE_GEN_VERSION, contentVersion: WORLD_CONTENT_VERSION, seed: TOWN_SEED }, { regionId: slotRegionId(LEGACY_HOME_SLOT), templateId: 'starter' });

/**
 * World tile of the corner of the lot the shared town is drawn around. The renderer's scene is measured from this
 * corner, so a world position minus this is a scene position.
 */
export function townSceneOrigin(): { x: number; z: number } {
  const home = townMap().regions.find((r) => r.id === slotRegionId(LEGACY_HOME_SLOT));
  if (!home || home.placement.rot !== 0) throw new Error('the shared town expects its centre lot unrotated');
  return { x: home.placement.originX, z: home.placement.originZ };
}

/** The street regions of the shared town's map, west to east. */
export function townStreetArea(): WalkArea {
  const map = townMap();
  const regions = map.regions.filter((r) => r.kind === 'street' && !r.unfinished).sort((a, b) => a.placement.originX - b.placement.originX || a.placement.originZ - b.placement.originZ);
  const rects = regions.map((r) => {
    const p = r.placement;
    const turned = p.rot === 1 || p.rot === 3;
    return { x0: p.originX, z0: p.originZ, x1: p.originX + (turned ? p.depth : p.width), z1: p.originZ + (turned ? p.width : p.depth) };
  });
  return { rects, regions };
}

const inAny = (area: WalkArea, x: number, z: number): boolean => {
  for (const r of area.rects) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
  return false;
};

/** True when a zombie centred on (x, z) stands wholly inside the area. Not-a-number is never inside. */
export function canStand(area: WalkArea, x: number, z: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const r = PLAYER_RADIUS;
  return inAny(area, x - r, z - r) && inAny(area, x + r, z - r) && inAny(area, x - r, z + r) && inAny(area, x + r, z + r);
}

/** Index of the region a point is in (for drawing), or -1. A point on a shared edge belongs to the first region. */
export function regionIndexAt(area: WalkArea, x: number, z: number): number {
  for (let i = 0; i < area.rects.length; i++) {
    const r = area.rects[i];
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return i;
  }
  return -1;
}

/** Players who arrive together are placed in a block this many wide. */
const SPAWN_COLUMNS = 8;
const SPAWN_ROWS = 3;
const SPAWN_GAP = 1.6;

/**
 * Where player number `n` (0, 1, 2, ...) appears: a small block in the middle of the street, so people who join
 * find each other at once. The first 24 places are all different; later arrivals reuse them (zombies do not block
 * each other). Deterministic; always a place a zombie can stand.
 */
export function spawnPoint(area: WalkArea, n: number): { x: number; z: number } {
  const first = area.rects[0];
  const last = area.rects[area.rects.length - 1];
  const cx = (first.x0 + last.x1) / 2;
  const cz = (first.z0 + first.z1) / 2;
  const k = (Number.isFinite(n) ? Math.abs(Math.floor(n)) : 0) % (SPAWN_COLUMNS * SPAWN_ROWS);
  const col = k % SPAWN_COLUMNS;
  const row = Math.floor(k / SPAWN_COLUMNS);
  return { x: cx + (col - (SPAWN_COLUMNS - 1) / 2) * SPAWN_GAP, z: cz + (row - (SPAWN_ROWS - 1) / 2) * SPAWN_GAP };
}
