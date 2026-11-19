/**
 * SLOTS, SURFACES & OBJECT GEOMETRY (SIM-SPATIAL).
 *
 * Every object gets a local->world Frame (geometry.ts):
 *  - floor items: their placement (min corner of the rotated footprint + rot);
 *  - wall items: the mounted tile with rot = wallRot(kind, side) (edges.ts) — local tile (0,0) is the mounted tile,
 *    local z = 0 is the wall surface, +Z points into the mounted tile;
 *  - loose items: the tile containing (x,z) with rot 0 (world-aligned), centred on the item's own position;
 *  - openings / held items: no slots, no surfaces.
 *
 * resolveSlots(obj) -> ResolvedSlot[]:
 *  - Approach tiles: local (lx,lz) -> world tile floor(local->world(lx + 0.5, lz + 0.5)). Kept only if in bounds, not
 *    inside a floor object's own footprint, and NOT wall-separated: when the approach tile shares a row/column with the
 *    nearest footprint tile (mounted tile for wall items), no wall segment (any kind) may lie between them — you can't
 *    use a fridge through a wall or watch TV through one. Blocked (non-walkable) tiles are kept; routing decides.
 *  - Fixed-pose slots: pose = local->world(slot.pose), y from the spec, facing = worldFacing(rot, slot.facing).
 *    One ResolvedSlot per spec slot (array position == slot index for objects without faceObject slots), even when
 *    no approach tile survives (approach = []).
 *  - faceObject slots (or slots without a pose): the pose depends on the approach tile, so the slot is EXPANDED into
 *    one ResolvedSlot per surviving approach tile — all entries share the spec slot `index` and `id` (reserve by
 *    index); pose = approach tile centre moved 0.28 toward the object centre (footprint centre / item position / wall
 *    point), facing that centre, y = 0. Route to the entry's single approach tile and use that entry's pose.
 * surfacePoints(obj): spec.surfaces through the frame (world x/z, y unchanged), index = surface index.
 * freeSurfaceNear(p, maxDist, prefer): nearest surface point within maxDist (Euclidean, x/z) not occupied by a loose
 *    item whose placement.parentId/surfaceIndex name it; burning objects are skipped; the preferred object wins when
 *    it has any free point in range; ties -> distance, then object id, then index.
 * objectCenter: floor -> footprint centre; wall -> 0.1 into the mounted tile from the wall midpoint; opening -> edge
 *    midpoint; loose -> (x,z); held -> the holder's position ((0,0) if the holder is missing).
 * objectTiles: floor -> footprint tiles (in bounds); loose -> its tile (in bounds); others -> [].
 */
import type { ContentRegistry, ResolvedSlot } from '../contracts';
import type { ObjectState, ObjectId, Vec2, WorldState } from '../types';
import type { SlotSpec } from '../../shared/catalog';
import { specOf, type SpecLike } from './defs';
import { edgesBetweenAligned, edgeMidpoint, wallFrame } from './edges';
import { edgeCode, floorFrame, inGrid, WALL_NONE, type Grid } from './grid';
import {
  faceObjectPose,
  frameCentre,
  frameLocalTile,
  frameLocalToWorld,
  frameTiles,
  worldFacing,
  type Frame,
  type Tile,
} from './geometry';
import { objectFilterOf } from './view';

export interface ObjectGeom {
  frame: Frame;
  /** Tiles that "are" the object for approach checks (footprint / mounted tile / item tile). */
  body: Tile[];
  /** Exclude approach tiles inside `body` (true for floor objects only). */
  solidBody: boolean;
  /** faceObject target. */
  centre: { x: number; z: number };
}

const SLOT_KINDS = new Set(['stand', 'sit', 'lie', 'bath']);

export function geomFor(obj: ObjectState, spec: SpecLike): ObjectGeom | null {
  const p = obj.placement;
  if (!p) return null;
  if (p.kind === 'floor') {
    const frame = floorFrame(obj, spec);
    if (!frame) return null;
    return { frame, body: frameTiles(frame), solidBody: true, centre: frameCentre(frame) };
  }
  if (p.kind === 'wall') {
    const wf = wallFrame(p.edge, p.side);
    if (!wf) return null;
    const frame: Frame = { w: 1, d: 1, ox: wf.tile.x, oz: wf.tile.z, rot: wf.rot };
    return { frame, body: [wf.tile], solidBody: false, centre: frameLocalToWorld(frame, 0.5, 0) };
  }
  if (p.kind === 'loose') {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
    const tile = { x: Math.floor(p.x), z: Math.floor(p.z) };
    const frame: Frame = { w: 1, d: 1, ox: tile.x, oz: tile.z, rot: 0 };
    return { frame, body: [tile], solidBody: false, centre: { x: p.x, z: p.z } };
  }
  return null;
}

/** Is the approach tile usable for this object geometry (see header)? */
export function approachUsable(g: Grid, t: Tile, geom: ObjectGeom): boolean {
  if (!inGrid(g, t.x, t.z)) return false;
  let best: Tile | null = null;
  let bestD = Infinity;
  for (const b of geom.body) {
    if (b.x === t.x && b.z === t.z) {
      if (geom.solidBody) return false;
      return true;
    }
    const dd = Math.abs(b.x - t.x) + Math.abs(b.z - t.z);
    if (dd < bestD) {
      bestD = dd;
      best = b;
    }
  }
  if (!best) return true;
  for (const e of edgesBetweenAligned(t, best)) if (edgeCode(g, e) !== WALL_NONE) return false;
  return true;
}

function slotKind(s: SlotSpec): ResolvedSlot['kind'] {
  return SLOT_KINDS.has(s.kind) ? s.kind : 'stand';
}

function finiteOr(v: unknown, f: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : f;
}

/** Resolve slots for an object geometry (also used by placement previews on hypothetical frames). */
export function resolveSlotsFor(g: Grid, spec: SpecLike, geom: ObjectGeom): ResolvedSlot[] {
  const out: ResolvedSlot[] = [];
  const slots = Array.isArray(spec.slots) ? spec.slots : [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s || typeof s !== 'object') continue;
    const approachSpec = Array.isArray(s.approach) ? s.approach : [];
    const kind = slotKind(s);
    const id = typeof s.id === 'string' ? s.id : `slot${i}`;
    if (s.faceObject || !s.pose) {
      const seen = new Set<string>();
      for (const a of approachSpec) {
        if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z)) continue;
        const t = frameLocalTile(geom.frame, Math.floor(a.x), Math.floor(a.z));
        const key = `${t.x},${t.z}`;
        if (seen.has(key) || !approachUsable(g, t, geom)) continue;
        seen.add(key);
        const pose = faceObjectPose(t, geom.centre);
        out.push({ index: i, id, kind, approach: [t], pose: { x: pose.x, z: pose.z, y: 0, facing: pose.facing } });
      }
      continue;
    }
    const approach: Tile[] = [];
    const seen = new Set<string>();
    for (const a of approachSpec) {
      if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z)) continue;
      const t = frameLocalTile(geom.frame, Math.floor(a.x), Math.floor(a.z));
      const key = `${t.x},${t.z}`;
      if (seen.has(key) || !approachUsable(g, t, geom)) continue;
      seen.add(key);
      approach.push(t);
    }
    const p = frameLocalToWorld(geom.frame, finiteOr(s.pose.x, 0.5), finiteOr(s.pose.z, 0.5));
    out.push({
      index: i,
      id,
      kind,
      approach,
      pose: { x: p.x, z: p.z, y: finiteOr(s.pose.y, 0), facing: worldFacing(geom.frame.rot, finiteOr(s.facing, 0)) },
    });
  }
  return out;
}

export function resolveSlots(g: Grid, content: ContentRegistry, obj: ObjectState): ResolvedSlot[] {
  if (!obj || typeof obj !== 'object') return [];
  const spec = specOf(content, obj.defId);
  if (!spec || !obj.placement || obj.placement.kind === 'opening' || obj.placement.kind === 'held') return [];
  const geom = geomFor(obj, spec);
  return geom ? resolveSlotsFor(g, spec, geom) : [];
}

export function surfacePoints(content: ContentRegistry, obj: ObjectState): { index: number; x: number; y: number; z: number }[] {
  if (!obj || typeof obj !== 'object' || !obj.placement) return [];
  const k = obj.placement.kind;
  if (k !== 'floor' && k !== 'wall') return [];
  const spec = specOf(content, obj.defId);
  if (!spec || !Array.isArray(spec.surfaces) || spec.surfaces.length === 0) return [];
  const geom = geomFor(obj, spec);
  if (!geom) return [];
  const out: { index: number; x: number; y: number; z: number }[] = [];
  spec.surfaces.forEach((s, index) => {
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) return;
    const p = frameLocalToWorld(geom.frame, s.x, s.z);
    out.push({ index, x: p.x, y: finiteOr(s.y, 0), z: p.z });
  });
  return out;
}

/** `${parentId}|${surfaceIndex}` for every occupied surface point. */
export function occupiedSurfaces(state: WorldState): Set<string> {
  const set = new Set<string>();
  const objs = state.objects || {};
  const own = objectFilterOf(state);
  for (const id in objs) {
    const o = objs[id];
    const p = o && o.placement;
    if (p && p.kind === 'loose' && typeof p.parentId === 'string' && typeof p.surfaceIndex === 'number' && own(o)) {
      set.add(`${p.parentId}|${p.surfaceIndex}`);
    }
  }
  return set;
}

export function freeSurfaceNear(
  state: WorldState,
  content: ContentRegistry,
  p: Vec2,
  maxDist: number,
  preferObjectId: ObjectId | null | undefined,
): { objectId: ObjectId; index: number; x: number; y: number; z: number } | null {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || !(maxDist >= 0)) return null;
  const occupied = occupiedSurfaces(state);
  const objs = state.objects || {};
  const own = objectFilterOf(state);
  let best: { objectId: ObjectId; index: number; x: number; y: number; z: number } | null = null;
  let bestD = Infinity;
  let bestPref = false;
  for (const id in objs) {
    const o = objs[id];
    if (!o || typeof o !== 'object' || (o.condition && o.condition.burning) || !own(o)) continue;
    const pts = surfacePoints(content, o);
    if (pts.length === 0) continue;
    const pref = preferObjectId != null && id === preferObjectId;
    for (const s of pts) {
      if (occupied.has(`${id}|${s.index}`)) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (!(d <= maxDist)) continue;
      let better = false;
      if (!best) better = true;
      else if (pref !== bestPref) better = pref;
      else if (d < bestD - 1e-9) better = true;
      else if (Math.abs(d - bestD) <= 1e-9) {
        if (id < best.objectId) better = true;
        else if (id === best.objectId && s.index < best.index) better = true;
      }
      if (better) {
        best = { objectId: id, index: s.index, x: s.x, y: s.y, z: s.z };
        bestD = d;
        bestPref = pref;
      }
    }
  }
  return best;
}

export function objectCenter(state: WorldState, content: ContentRegistry, obj: ObjectState): Vec2 {
  const p = obj && obj.placement;
  if (!p) return { x: 0, z: 0 };
  switch (p.kind) {
    case 'floor': {
      const spec = specOf(content, obj.defId);
      const f = spec ? floorFrame(obj, spec) : null;
      if (f) return frameCentre(f);
      return Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x + 0.5, z: p.z + 0.5 } : { x: 0, z: 0 };
    }
    case 'wall': {
      const wf = wallFrame(p.edge, p.side);
      if (!wf) return { x: 0, z: 0 };
      return frameLocalToWorld({ w: 1, d: 1, ox: wf.tile.x, oz: wf.tile.z, rot: wf.rot }, 0.5, 0.1);
    }
    case 'opening': {
      const m = edgeMidpoint(p.edge);
      return Number.isFinite(m.x) ? m : { x: 0, z: 0 };
    }
    case 'loose':
      return Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, z: p.z } : { x: 0, z: 0 };
    case 'held': {
      const a = state.agents ? state.agents[p.agentId] : undefined;
      return a && a.pos && Number.isFinite(a.pos.x) && Number.isFinite(a.pos.z) ? { x: a.pos.x, z: a.pos.z } : { x: 0, z: 0 };
    }
    default:
      return { x: 0, z: 0 };
  }
}

export function objectTiles(g: Grid, content: ContentRegistry, obj: ObjectState): Tile[] {
  const p = obj && obj.placement;
  if (!p) return [];
  if (p.kind === 'floor') {
    const spec = specOf(content, obj.defId);
    const f = spec ? floorFrame(obj, spec) : null;
    return f ? frameTiles(f).filter((t) => inGrid(g, t.x, t.z)) : [];
  }
  if (p.kind === 'loose') {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return [];
    const t = { x: Math.floor(p.x), z: Math.floor(p.z) };
    return inGrid(g, t.x, t.z) ? [t] : [];
  }
  return [];
}
