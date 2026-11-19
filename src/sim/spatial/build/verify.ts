/**
 * POST-RESTORE VERIFICATION (SIM-SPATIAL build) — undo/redo replay exact snapshots, but gameplay may have changed the
 * lot meanwhile (a fire started, a system spawned furniture). After an undo/redo has been applied, every PRIMARY floor
 * object it inserted or moved is checked against the live lot:
 *  - its footprint must stay on the lot and must not straddle a wall segment;
 *  - it must not overlap another object of its layer (rug vs rug, furniture vs furniture) or a fire.
 * Any violation -> the caller reverts the step and reports a conflict. Loose items lying on the floor inside a
 * restored furniture footprint (dishes, limbs) are nudged to the nearest walkable tile instead of blocking the undo.
 * Coverage only indexes on-lot tiles (an off-lot corrupt object never aliases another tile's index).
 */
import type { ObjectId, ObjectState } from '../../types';
import type { BuildContext } from './context';
import type { Change } from './tx';
import { specOf, isRug, looseBlocks, floorBlocks } from '../defs';
import { floorFrame, lotDims } from '../grid';
import { frameSize, frameTiles } from '../geometry';
import { edgeKey } from '../edges';
import { indexWalls } from './plan';
import { buildHomeObjects } from './region';

function objectsOf(ctx: BuildContext): Record<string, ObjectState> {
  return buildHomeObjects(ctx.state);
}

/** Returns true when the restored state is NOT acceptable. Nudges loose items as a side effect. */
export function restoredConflicts(ctx: BuildContext, changes: Change[], to: 'before' | 'after'): boolean {
  const state = ctx.state;
  const content = ctx.content;
  const { w, d } = lotDims(state);
  const ids: ObjectId[] = [];
  for (const c of changes) {
    if (c.kind !== 'obj' || c.group !== 0) continue;
    const t = c[to];
    if (t && t.placement && t.placement.kind === 'floor') ids.push(c.id);
  }
  if (ids.length === 0) return false;
  const objs = objectsOf(ctx);
  const walls = indexWalls(state.lot);
  // coverage of every floor object: tile -> ids (rugs and furniture separately)
  const furn = new Map<number, ObjectId[]>();
  const rugs = new Map<number, ObjectId[]>();
  for (const id in objs) {
    const o = objs[id];
    if (!o || !o.placement || o.placement.kind !== 'floor') continue;
    const spec = specOf(content, o.defId);
    const f = spec ? floorFrame(o, spec) : null;
    if (!spec || !f) continue;
    const m = isRug(spec) ? rugs : furn;
    for (const t of frameTiles(f)) {
      if (t.x < 0 || t.z < 0 || t.x >= w || t.z >= d) continue;
      const i = t.z * w + t.x;
      const list = m.get(i);
      if (list) list.push(id);
      else m.set(i, [id]);
    }
  }
  const fire = new Set<number>();
  const looseOnFloor = new Map<number, ObjectState[]>();
  for (const id in objs) {
    const o = objs[id];
    const p = o && o.placement;
    if (!p || p.kind !== 'loose' || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const lx = Math.floor(p.x);
    const lz = Math.floor(p.z);
    if (lx < 0 || lz < 0 || lx >= w || lz >= d) continue;
    const i = lz * w + lx;
    const spec = specOf(content, o.defId);
    if (spec && looseBlocks(spec)) fire.add(i);
    else if (p.parentId === null || !objs[p.parentId]) {
      const list = looseOnFloor.get(i);
      if (list) list.push(o);
      else looseOnFloor.set(i, [o]);
    }
  }
  const toNudge: ObjectState[] = [];
  for (const id of ids) {
    const o = objs[id];
    if (!o) continue;
    const spec = specOf(content, o.defId);
    const f = spec ? floorFrame(o, spec) : null;
    if (!spec || !f) return true;
    const tiles = frameTiles(f);
    for (const t of tiles) if (t.x < 0 || t.z < 0 || t.x >= w || t.z >= d) return true;
    const s = frameSize(f);
    for (let j = 0; j < s.d; j++) for (let i = 1; i < s.w; i++) if (walls.has(edgeKey('v', f.ox + i, f.oz + j))) return true;
    for (let j = 1; j < s.d; j++) for (let i = 0; i < s.w; i++) if (walls.has(edgeKey('h', f.ox + i, f.oz + j))) return true;
    const layer = isRug(spec) ? rugs : furn;
    for (const t of tiles) {
      const i = t.z * w + t.x;
      if ((layer.get(i) || []).some((other) => other !== id)) return true;
      if (!isRug(spec) && fire.has(i)) return true;
      if (!isRug(spec) && floorBlocks(spec)) for (const item of looseOnFloor.get(i) || []) toNudge.push(item);
    }
  }
  if (toNudge.length > 0) {
    ctx.spatial.invalidate();
    for (const item of toNudge) {
      const p = item.placement;
      if (p.kind !== 'loose') continue;
      const dest = ctx.spatial.nearestWalkable({ x: p.x, z: p.z });
      if (!dest) continue;
      item.placement = { kind: 'loose', x: dest.x + 0.5, z: dest.z + 0.5, y: 0, parentId: null, surfaceIndex: null, facing: p.facing };
      ctx.markChanged(item);
    }
  }
  return false;
}
