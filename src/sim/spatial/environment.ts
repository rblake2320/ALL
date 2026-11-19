/**
 * ROOM ENVIRONMENT (SIM-SPATIAL) — GDD §3 ("room environment") / §5 ("dirty dishes: -1 environment each in room").
 *
 * Contribution of one object (floor, wall and loose placements; openings and held items never count):
 *  ContentRegistry.objects[defId].env (default 0) - 2 x condition.dirt (dirt clamped to 0..1). Spawned items are no
 *  exception: the content def is the single source of every env number (backlog #4 — SIM-HOME ships dish -1,
 *  ash -3, fire -5, limbs -2, bone pile -3), so tuning a mess penalty never needs a spatial change.
 * Location: floor objects -> the tile under their footprint centre; wall items -> the mounted tile; loose -> its tile.
 * Indoor room score = clamp(-10, 10, sum / sqrt(roomTileCount) x 2) over objects located in that room.
 * Outdoors (room 0) score for a tile = same formula over OUTDOOR objects whose centre lies within 4 tiles of the tile
 *    centre, with tileCount = outdoor tiles whose centres lie within those 4 tiles.
 * Out-of-bounds / NaN tiles -> 0.
 */
import type { ContentRegistry } from '../contracts';
import type { ObjectState, WorldState } from '../types';
import { specOf, envOf } from './defs';
import { floorFrame, inGrid, type Grid } from './grid';
import { frameCentre } from './geometry';
import { objectCenter } from './slots';
import { wallFrame } from './edges';
import { objectFilterOf } from './view';

export const OUTDOOR_RADIUS = 4;

export function clampEnv(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-10, Math.min(10, v));
}

export function envContribution(content: ContentRegistry, obj: ObjectState): number {
  const base = envOf(specOf(content, obj.defId));
  const dirtRaw = obj.condition ? obj.condition.dirt : 0;
  const dirt = typeof dirtRaw === 'number' && Number.isFinite(dirtRaw) ? Math.max(0, Math.min(1, dirtRaw)) : 0;
  return base - 2 * dirt;
}

/** Tile that decides which room an object belongs to (null = doesn't count). */
export function envTile(g: Grid, content: ContentRegistry, obj: ObjectState): { x: number; z: number } | null {
  const p = obj.placement;
  if (!p) return null;
  let t: { x: number; z: number } | null = null;
  if (p.kind === 'floor') {
    const spec = specOf(content, obj.defId);
    const f = spec ? floorFrame(obj, spec) : null;
    if (!f) return null;
    const c = frameCentre(f);
    t = { x: Math.floor(c.x), z: Math.floor(c.z) };
  } else if (p.kind === 'wall') {
    const wf = wallFrame(p.edge, p.side);
    t = wf ? wf.tile : null;
  } else if (p.kind === 'loose') {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
    t = { x: Math.floor(p.x), z: Math.floor(p.z) };
  }
  return t && inGrid(g, t.x, t.z) ? t : null;
}

export interface EnvTables {
  /** Indoor score per room id (index 0 unused). */
  roomScore: Float64Array;
  /** Outdoor contributors (world centre + contribution). */
  outdoor: { x: number; z: number; c: number }[];
}

export function computeEnvTables(state: WorldState, content: ContentRegistry, g: Grid, roomOf: Int32Array, roomSizes: number[]): EnvTables {
  const sums = new Float64Array(roomSizes.length);
  const outdoor: { x: number; z: number; c: number }[] = [];
  const objs = state.objects || {};
  const own = objectFilterOf(state);
  for (const id in objs) {
    const o = objs[id];
    if (!o || typeof o !== 'object' || !own(o)) continue;
    const t = envTile(g, content, o);
    if (!t) continue;
    const c = envContribution(content, o);
    if (c === 0) continue;
    const room = roomOf[t.z * g.w + t.x];
    if (room > 0) sums[room] += c;
    else {
      const ctr = objectCenter(state, content, o);
      outdoor.push({ x: ctr.x, z: ctr.z, c });
    }
  }
  const roomScore = new Float64Array(roomSizes.length);
  for (let r = 1; r < roomSizes.length; r++) {
    const n = Math.max(1, roomSizes[r]);
    roomScore[r] = clampEnv((sums[r] / Math.sqrt(n)) * 2);
  }
  return { roomScore, outdoor };
}

export function outdoorScore(g: Grid, roomOf: Int32Array, tables: EnvTables, x: number, z: number): number {
  const cx = x + 0.5;
  const cz = z + 0.5;
  const r2 = OUTDOOR_RADIUS * OUTDOOR_RADIUS;
  let sum = 0;
  for (const o of tables.outdoor) if ((o.x - cx) ** 2 + (o.z - cz) ** 2 <= r2 + 1e-9) sum += o.c;
  if (sum === 0) return 0;
  let count = 0;
  for (let tz = Math.max(0, z - OUTDOOR_RADIUS); tz <= Math.min(g.d - 1, z + OUTDOOR_RADIUS); tz++) {
    for (let tx = Math.max(0, x - OUTDOOR_RADIUS); tx <= Math.min(g.w - 1, x + OUTDOOR_RADIUS); tx++) {
      if ((tx - x) ** 2 + (tz - z) ** 2 > r2) continue;
      if (roomOf[tz * g.w + tx] === 0) count++;
    }
  }
  return clampEnv((sum / Math.sqrt(Math.max(1, count))) * 2);
}
