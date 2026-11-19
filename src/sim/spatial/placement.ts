/**
 * PLACEMENT RULES (SIM-SPATIAL) — GDD §15. Pure functions over a Grid + room table; nothing is mutated.
 *
 * checkPlace(defId, x, z, rot, ignore) — floor objects. Checks in this order (first failure wins):
 *   1. def known and placement 'floor'           -> "That isn't in the catalog" / "Needs a wall" / "Can't place that here"
 *   2. rot integer, x/z finite (floored)          -> "Can't place that here" / "Outside your lot"
 *   3. every footprint tile buildable             -> "Outside your lot"   (buildable rect, never the sidewalk row)
 *   4. no wall segment (any kind) on an edge INSIDE the footprint -> "Can't straddle a wall" (rugs too)
 *   5. overlap: rugs collide only with other rugs; everything else collides with other non-rug floor objects, with
 *      loose items lying on the floor (parentId null or dangling) and with fire -> "Something's in the way"
 *      (agents never block: the build service relocates them)
 *   6. a blocking object may not cover a side tile of a door -> "Blocks a doorway"
 *   7. outdoorOnly / indoorOnly against the current rooms -> "Must be placed outdoors" / "Must be placed indoors"
 *   8. ok; blockedSlots = spec slot indices with no usable approach tile that would be walkable after placement
 *      (non-fatal warning). `ignore` (the object being moved) is treated as absent everywhere.
 * checkWallItem(defId, edge, side, ignore): def placement 'wall'; parseable edge & side; mounted tile buildable; a wall
 *   exists ("Needs a wall"); the wall has no door/window and no other wall item on that side ("Something's in the way");
 *   outdoorOnly/indoorOnly by the mounted tile's room. tiles = [mounted tile].
 * checkOpening(defId, edge, ignore): def placement 'door' | 'window'; edge buildable ("Outside your lot"); a wall
 *   exists ("Needs a wall"); no other opening and no wall items on either side ("Something's in the way"); doors need
 *   both side tiles walkable ("Something's in the way"). tiles = the two side tiles.
 * cost = def price in every result (also on failure, for UI display).
 */
import type { ContentRegistry, PlacementResult } from '../contracts';
import type { ObjectId, WorldState } from '../types';
import type { Rot } from '../../shared/dimensions';
import { specOf, priceOf, isRug, floorBlocks, footprintOf, type SpecLike } from './defs';
import { normalizeEdge, edgeSides, parseEdge, wallRot } from './edges';
import { edgeBuildable, gridBuildable, hCode, inGrid, vCode, WALL_DOOR, WALL_NONE, WALL_WINDOW, type Grid } from './grid';
import { frameCentre, frameLocalToWorld, frameSize, frameTiles, normalizeRot, type Frame, type Tile } from './geometry';
import { approachUsable, resolveSlotsFor, type ObjectGeom } from './slots';
import { objectFilterOf } from './view';

export const REASONS = {
  unknown: "That isn't in the catalog",
  needsWall: 'Needs a wall',
  cantPlace: "Can't place that here",
  outside: 'Outside your lot',
  straddle: "Can't straddle a wall",
  inTheWay: "Something's in the way",
  doorway: 'Blocks a doorway',
  outdoors: 'Must be placed outdoors',
  indoors: 'Must be placed indoors',
  notWallItem: "That doesn't hang on a wall",
  notOpening: "That isn't a door or window",
} as const;

function fail(reason: string, cost: number, tiles: Tile[] = []): PlacementResult {
  return { ok: false, reason, tiles, blockedSlots: [], cost };
}

/** Is tile i blocked by something other than `ignore`? (fire always counts) */
function blockedIgnoring(g: Grid, content: ContentRegistry, state: WorldState, i: number, ignore: ObjectId | null): boolean {
  if (g.blocked[i] === 0) return false;
  if (g.looseBlocked[i]) return true;
  const list = g.objAt[i];
  if (!list) return false;
  for (const id of list) {
    if (id === ignore) continue;
    const o = state.objects[id];
    const s = o ? specOf(content, o.defId) : null;
    if (s && floorBlocks(s)) return true;
  }
  return false;
}

/** Spec slot indices whose every usable approach tile is non-walkable (hypothetical placement). */
export function computeBlockedSlots(
  g: Grid,
  content: ContentRegistry,
  state: WorldState,
  spec: SpecLike,
  geom: ObjectGeom,
  newlyBlocked: Set<number>,
  ignore: ObjectId | null,
): number[] {
  const slots = Array.isArray(spec.slots) ? spec.slots : [];
  if (slots.length === 0) return [];
  const resolved = resolveSlotsFor(g, spec, geom);
  const ok = new Array<boolean>(slots.length).fill(false);
  for (const r of resolved) {
    if (ok[r.index]) continue;
    for (const t of r.approach) {
      if (!approachUsable(g, t, geom)) continue;
      const i = t.z * g.w + t.x;
      if (newlyBlocked.has(i)) continue;
      if (blockedIgnoring(g, content, state, i, ignore)) continue;
      ok[r.index] = true;
      break;
    }
  }
  const out: number[] = [];
  for (let i = 0; i < slots.length; i++) if (slots[i] && !ok[i]) out.push(i);
  return out;
}

/** Wall segments on edges strictly inside a rotated footprint rectangle. */
function straddlesWall(g: Grid, f: Frame): boolean {
  const s = frameSize(f);
  for (let j = 0; j < s.d; j++) for (let i = 1; i < s.w; i++) if (vCode(g, f.ox + i, f.oz + j) !== WALL_NONE) return true;
  for (let j = 1; j < s.d; j++) for (let i = 0; i < s.w; i++) if (hCode(g, f.ox + i, f.oz + j) !== WALL_NONE) return true;
  return false;
}

/** Tiles holding loose items that rest on the floor (or on a missing parent), excluding `ignore`'s own items. */
function floorItemTiles(g: Grid, state: WorldState, ignore: ObjectId | null): Set<number> {
  const set = new Set<number>();
  const objs = state.objects || {};
  const own = objectFilterOf(state);
  for (const id in objs) {
    const o = objs[id];
    const p = o && o.placement;
    if (!p || p.kind !== 'loose' || id === ignore || !own(o)) continue;
    const parent = typeof p.parentId === 'string' ? p.parentId : null;
    if (parent !== null && (parent === ignore || objs[parent])) continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const tx = Math.floor(p.x);
    const tz = Math.floor(p.z);
    if (inGrid(g, tx, tz)) set.add(tz * g.w + tx);
  }
  return set;
}

export function checkPlace(
  g: Grid,
  content: ContentRegistry,
  state: WorldState,
  roomOf: Int32Array,
  defId: string,
  x: number,
  z: number,
  rot: Rot,
  ignoreObjectId: ObjectId | null | undefined,
): PlacementResult {
  const spec = specOf(content, defId);
  if (!spec) return fail(REASONS.unknown, 0);
  const cost = priceOf(spec);
  if (spec.placement !== 'floor') {
    const wallish = spec.placement === 'wall' || spec.placement === 'door' || spec.placement === 'window';
    return fail(wallish ? REASONS.needsWall : REASONS.cantPlace, cost);
  }
  const r = normalizeRot(rot);
  if (r === null) return fail(REASONS.cantPlace, cost);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return fail(REASONS.outside, cost);
  const ignore = ignoreObjectId ?? null;
  const fp = footprintOf(spec);
  const frame: Frame = { w: fp.w, d: fp.d, ox: Math.floor(x), oz: Math.floor(z), rot: r };
  const tiles = frameTiles(frame);
  for (const t of tiles) if (!gridBuildable(g, t.x, t.z)) return fail(REASONS.outside, cost, tiles);
  if (straddlesWall(g, frame)) return fail(REASONS.straddle, cost, tiles);

  const rug = isRug(spec);
  const idx = tiles.map((t) => t.z * g.w + t.x);
  for (const i of idx) {
    const list = rug ? g.rugAt[i] : g.objAt[i];
    if (list && list.some((id) => id !== ignore)) return fail(REASONS.inTheWay, cost, tiles);
  }
  if (!rug) {
    for (const i of idx) if (g.looseBlocked[i]) return fail(REASONS.inTheWay, cost, tiles);
    const items = floorItemTiles(g, state, ignore);
    for (const i of idx) if (items.has(i)) return fail(REASONS.inTheWay, cost, tiles);
  }
  const blocks = floorBlocks(spec);
  if (blocks) for (const i of idx) if (g.doorAdj[i]) return fail(REASONS.doorway, cost, tiles);
  for (const i of idx) {
    const room = roomOf[i];
    if (spec.outdoorOnly && room !== 0) return fail(REASONS.outdoors, cost, tiles);
    if (spec.indoorOnly && room === 0) return fail(REASONS.indoors, cost, tiles);
  }
  const geom: ObjectGeom = { frame, body: tiles, solidBody: true, centre: frameCentre(frame) };
  const newly = new Set<number>(blocks ? idx : []);
  const blockedSlots = computeBlockedSlots(g, content, state, spec, geom, newly, ignore);
  return { ok: true, tiles, blockedSlots, cost };
}

function wallItemsOn(g: Grid, edge: string, side: 0 | 1, ignore: ObjectId | null): ObjectId[] {
  return (g.wallItems.get(`${edge}|${side}`) || []).filter((id) => id !== ignore);
}

export function checkWallItem(
  g: Grid,
  content: ContentRegistry,
  state: WorldState,
  roomOf: Int32Array,
  defId: string,
  edge: string,
  side: 0 | 1,
  ignoreObjectId: ObjectId | null | undefined,
): PlacementResult {
  const spec = specOf(content, defId);
  if (!spec) return fail(REASONS.unknown, 0);
  const cost = priceOf(spec);
  if (spec.placement !== 'wall') return fail(REASONS.notWallItem, cost);
  const e = normalizeEdge(edge);
  if (!e || (side !== 0 && side !== 1)) return fail(REASONS.needsWall, cost);
  const ignore = ignoreObjectId ?? null;
  const mounted = edgeSides(e)[side];
  const tiles = [mounted];
  if (!gridBuildable(g, mounted.x, mounted.z)) return fail(REASONS.outside, cost, inGrid(g, mounted.x, mounted.z) ? tiles : []);
  const pe = parseEdge(e);
  const code = pe ? (pe.kind === 'h' ? hCode(g, pe.x, pe.z) : vCode(g, pe.x, pe.z)) : WALL_NONE;
  if (code === WALL_NONE) return fail(REASONS.needsWall, cost, tiles);
  if (code === WALL_DOOR || code === WALL_WINDOW) return fail(REASONS.inTheWay, cost, tiles);
  if (wallItemsOn(g, e, side, ignore).length > 0) return fail(REASONS.inTheWay, cost, tiles);
  const room = roomOf[mounted.z * g.w + mounted.x];
  if (spec.outdoorOnly && room !== 0) return fail(REASONS.outdoors, cost, tiles);
  if (spec.indoorOnly && room === 0) return fail(REASONS.indoors, cost, tiles);
  const frame: Frame = { w: 1, d: 1, ox: mounted.x, oz: mounted.z, rot: wallRot(pe!.kind, side) };
  const geom: ObjectGeom = { frame, body: [mounted], solidBody: false, centre: frameLocalToWorld(frame, 0.5, 0) };
  const blockedSlots = computeBlockedSlots(g, content, state, spec, geom, new Set(), ignore);
  return { ok: true, tiles, blockedSlots, cost };
}

export function checkOpening(
  g: Grid,
  content: ContentRegistry,
  state: WorldState,
  defId: string,
  edge: string,
  ignoreObjectId: ObjectId | null | undefined,
): PlacementResult {
  const spec = specOf(content, defId);
  if (!spec) return fail(REASONS.unknown, 0);
  const cost = priceOf(spec);
  if (spec.placement !== 'door' && spec.placement !== 'window') return fail(REASONS.notOpening, cost);
  const e = normalizeEdge(edge);
  if (!e) return fail(REASONS.needsWall, cost);
  const ignore = ignoreObjectId ?? null;
  const sides = edgeSides(e);
  const tiles = sides.filter((t) => inGrid(g, t.x, t.z));
  if (!edgeBuildable(g, e)) return fail(REASONS.outside, cost, tiles);
  const pe = parseEdge(e)!;
  const code = pe.kind === 'h' ? hCode(g, pe.x, pe.z) : vCode(g, pe.x, pe.z);
  if (code === WALL_NONE) return fail(REASONS.needsWall, cost, tiles);
  const existing = g.openingOf.get(e);
  if (existing !== undefined && existing !== ignore) return fail(REASONS.inTheWay, cost, tiles);
  if (wallItemsOn(g, e, 0, ignore).length > 0 || wallItemsOn(g, e, 1, ignore).length > 0) return fail(REASONS.inTheWay, cost, tiles);
  if (spec.placement === 'door') {
    for (const t of sides) {
      if (!inGrid(g, t.x, t.z)) return fail(REASONS.outside, cost, tiles);
      if (blockedIgnoring(g, content, state, t.z * g.w + t.x, ignore)) return fail(REASONS.inTheWay, cost, tiles);
    }
  }
  return { ok: true, tiles, blockedSlots: [], cost };
}
