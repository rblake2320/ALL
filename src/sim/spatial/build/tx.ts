/**
 * BUILD TRANSACTIONS (SIM-SPATIAL) — records every mutation a build command makes so it can be rolled back on error
 * and undone / redone EXACTLY later.
 *
 * Model:
 *  - A Change is the net before/after of ONE entity: an object (by id), a wall segment (by canonical edge key) or a
 *    floor tile (by index). The first touch captures `before` (deep JSON clone); finalize() captures `after`.
 *    Entities whose before and after are identical are dropped.
 *  - group 0 = primary change (must still match for undo/redo to proceed); group > 0 = dependent change (items riding
 *    on a moved surface, items dropped when their surface is sold). Dependent groups are applied only if every change
 *    in the group still matches, otherwise they are left alone (e.g. the plate was eaten meanwhile).
 *  - Applying a target state: object null -> release users + ctx.removeObject (forced delete if it lingers);
 *    object missing -> insert the snapshot (same id, reservations cleared, rev bumped, objectAdded emitted);
 *    object present -> restore its placement only (live data such as dirt or servings is kept). Walls/floors are set
 *    verbatim.
 *  - Removal reasons reach the player: the engine reports them when a zombie's player-ordered interaction fails
 *    because its object vanished ("the drizzle shower was sold"), so they are full sentences, never codes.
 *  - Snapshot comparisons (placements, wall segments) are key-order-insensitive: a writer that rebuilds an object
 *    literal with its keys in another order is not "divergence".
 *  - Objects are never re-created under a new id by undo/redo, so later history entries keep referring to valid ids.
 */
import type { ObjectId, ObjectPlacement, ObjectState, WallSegment, EdgeKey, WorldState } from '../../types';
import type { BuildContext } from './context';
import { objectLabel, releaseUsers } from './carry';

export interface ObjChange {
  kind: 'obj';
  id: ObjectId;
  before: ObjectState | null;
  after: ObjectState | null;
  group: number;
}
export interface WallChange {
  kind: 'wall';
  edge: EdgeKey;
  before: WallSegment | null;
  after: WallSegment | null;
  group: number;
}
export interface FloorChange {
  kind: 'floor';
  index: number;
  before: string | null;
  after: string | null;
  group: number;
}
export type Change = ObjChange | WallChange | FloorChange;

export function cloneJson<T>(v: T): T {
  return v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/** JSON text with object keys sorted (arrays keep their order). */
function canonical(v: unknown): string {
  if (v === undefined || v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Deep JSON equality, insensitive to object key order (null == undefined). */
export function jsonEq(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function objectsOf(state: WorldState): Record<string, ObjectState> {
  if (!state.objects || typeof state.objects !== 'object') (state as { objects: Record<string, ObjectState> }).objects = {};
  return state.objects;
}

export { releaseUsers } from './carry';

/** Default player-facing reason for an object taken away in build mode (undo of a purchase, rollback, ...). */
export function removedReason(ctx: BuildContext, obj: ObjectState | null | undefined): string {
  const label = objectLabel(ctx.content, obj);
  return `The ${label} was removed`;
}

function hardRemove(ctx: BuildContext, id: ObjectId, reason?: string): void {
  const objs = objectsOf(ctx.state);
  const obj = objs[id];
  if (!obj) return;
  const why = reason || removedReason(ctx, obj);
  releaseUsers(ctx, obj, why);
  ctx.removeObject(id, why);
  if (objs[id]) {
    delete objs[id];
    ctx.emit({ type: 'objectRemoved', objectId: id });
  }
}

function insertSnapshot(ctx: BuildContext, snap: ObjectState): void {
  const objs = objectsOf(ctx.state);
  const o = cloneJson(snap);
  o.reservedBy = {};
  o.inUseBy = [];
  o.rev = (typeof o.rev === 'number' && Number.isFinite(o.rev) ? o.rev : 0) + 1;
  objs[o.id] = o;
  ctx.emit({ type: 'objectAdded', objectId: o.id });
}

export class Tx {
  private objs = new Map<ObjectId, ObjChange>();
  private walls = new Map<EdgeKey, WallChange>();
  private floors = new Map<number, FloorChange>();
  private nextGroup = 1;

  constructor(private readonly ctx: BuildContext) {
    const lot = ctx.state.lot;
    if (lot && (!lot.walls || typeof lot.walls !== 'object')) lot.walls = {};
    if (lot && !Array.isArray(lot.floors)) lot.floors = [];
  }

  newGroup(): number {
    return this.nextGroup++;
  }

  private get state(): WorldState {
    return this.ctx.state;
  }

  touchObj(id: ObjectId, group = 0): void {
    if (this.objs.has(id)) return;
    const cur = objectsOf(this.state)[id];
    this.objs.set(id, { kind: 'obj', id, before: cur ? cloneJson(cur) : null, after: null, group });
  }

  touchWall(edge: EdgeKey): void {
    if (this.walls.has(edge)) return;
    const cur = this.state.lot.walls[edge];
    this.walls.set(edge, { kind: 'wall', edge, before: cur ? cloneJson(cur) : null, after: null, group: 0 });
  }

  touchFloor(index: number): void {
    if (this.floors.has(index)) return;
    const cur = this.state.lot.floors[index];
    this.floors.set(index, { kind: 'floor', index, before: cur ?? null, after: null, group: 0 });
  }

  setWall(edge: EdgeKey, seg: WallSegment | null): void {
    this.touchWall(edge);
    if (seg === null) delete this.state.lot.walls[edge];
    else this.state.lot.walls[edge] = cloneJson(seg);
  }

  setPaint(edge: EdgeKey, side: 0 | 1, style: string): void {
    const cur = this.state.lot.walls[edge];
    if (!cur) return;
    const next = cloneJson(cur);
    const paint: [string, string] = Array.isArray(next.paint) ? [String(next.paint[0]), String(next.paint[1])] : [style, style];
    paint[side] = style;
    next.paint = paint;
    this.setWall(edge, next);
  }

  setFloor(index: number, style: string | null): void {
    this.touchFloor(index);
    this.state.lot.floors[index] = style;
  }

  /** New object through the engine (ctx.spawnObject). */
  spawn(defId: string, placement: ObjectPlacement, opts: { value: number; tint: string | null }): ObjectState {
    const obj = this.ctx.spawnObject(defId, cloneJson(placement), { value: opts.value, tint: opts.tint });
    const objs = objectsOf(this.state);
    if (!objs[obj.id]) objs[obj.id] = obj;
    if (!this.objs.has(obj.id)) this.objs.set(obj.id, { kind: 'obj', id: obj.id, before: null, after: null, group: 0 });
    return objs[obj.id];
  }

  /** Track an object created by someone else during this transaction (ctx.placeItemNear). */
  adopt(obj: ObjectState, group: number): void {
    const objs = objectsOf(this.state);
    if (!objs[obj.id]) objs[obj.id] = obj;
    if (!this.objs.has(obj.id)) this.objs.set(obj.id, { kind: 'obj', id: obj.id, before: null, after: null, group });
  }

  /** Remove through ctx.removeObject; `reason` is player-facing (see header). */
  remove(id: ObjectId, group = 0, reason?: string): void {
    this.touchObj(id, group);
    hardRemove(this.ctx, id, reason);
  }

  /** Re-insert a snapshot (used when an item could not be re-created by placeItemNear). */
  insert(snap: ObjectState, group = 0): void {
    this.touchObj(snap.id, group);
    insertSnapshot(this.ctx, snap);
  }

  setPlacement(id: ObjectId, placement: ObjectPlacement, group = 0): void {
    const obj = objectsOf(this.state)[id];
    if (!obj) return;
    this.touchObj(id, group);
    obj.placement = cloneJson(placement);
    this.ctx.markChanged(obj);
  }

  /** Net changes (after captured now). Entities that ended where they started are dropped. */
  finalize(): Change[] {
    const out: Change[] = [];
    const objs = objectsOf(this.state);
    for (const c of this.walls.values()) {
      const cur = this.state.lot.walls[c.edge];
      c.after = cur ? cloneJson(cur) : null;
      if (!jsonEq(c.before, c.after)) out.push(c);
    }
    for (const c of this.floors.values()) {
      c.after = this.state.lot.floors[c.index] ?? null;
      if (c.before !== c.after) out.push(c);
    }
    for (const c of this.objs.values()) {
      const cur = objs[c.id];
      c.after = cur ? cloneJson(cur) : null;
      if (c.before === null && c.after === null) continue;
      if (c.before && c.after && jsonEq(c.before.placement, c.after.placement) && c.before.defId === c.after.defId) continue;
      out.push(c);
    }
    return out;
  }

  /** Best-effort revert of everything touched so far (exception path). */
  rollback(): void {
    const changes: Change[] = [];
    const objs = objectsOf(this.state);
    for (const c of this.walls.values()) changes.push({ ...c, after: this.state.lot.walls[c.edge] ? cloneJson(this.state.lot.walls[c.edge]) : null });
    for (const c of this.floors.values()) changes.push({ ...c, after: this.state.lot.floors[c.index] ?? null });
    for (const c of this.objs.values()) changes.push({ ...c, after: objs[c.id] ? cloneJson(objs[c.id]) : null });
    applyChanges(this.ctx, changes, 'before');
  }
}

/** Does the live state of a change's entity equal its `which` state? */
export function changeMatches(ctx: BuildContext, c: Change, which: 'before' | 'after'): boolean {
  const state = ctx.state;
  if (c.kind === 'wall') return jsonEq(state.lot.walls[c.edge] ?? null, c[which]);
  if (c.kind === 'floor') return (state.lot.floors[c.index] ?? null) === c[which];
  const cur = (state.objects || {})[c.id] ?? null;
  const want = c[which];
  if (want === null) return cur === null;
  if (cur === null) return false;
  return cur.defId === want.defId && jsonEq(cur.placement, want.placement);
}

/**
 * Select the changes to apply when moving from `from` to the other side: primary changes must all match (else
 * null = conflict); dependent groups are kept only when every member matches.
 */
export function selectApplicable(ctx: BuildContext, changes: Change[], from: 'before' | 'after'): Change[] | null {
  for (const c of changes) if (c.group === 0 && !changeMatches(ctx, c, from)) return null;
  const okGroup = new Map<number, boolean>();
  for (const c of changes) {
    if (c.group === 0) continue;
    const prev = okGroup.get(c.group);
    okGroup.set(c.group, (prev === undefined ? true : prev) && changeMatches(ctx, c, from));
  }
  return changes.filter((c) => c.group === 0 || okGroup.get(c.group) === true);
}

/** Drive every listed entity to its `to` state (reverse order when going back to `before`). */
export function applyChanges(ctx: BuildContext, changes: Change[], to: 'before' | 'after'): void {
  const list = to === 'before' ? changes.slice().reverse() : changes;
  const state = ctx.state;
  const objs = objectsOf(state);
  for (const c of list) {
    if (c.kind === 'wall') {
      const t = c[to];
      if (t === null) delete state.lot.walls[c.edge];
      else state.lot.walls[c.edge] = cloneJson(t);
    } else if (c.kind === 'floor') {
      state.lot.floors[c.index] = c[to];
    } else {
      const t = c[to];
      const cur = objs[c.id];
      if (t === null) {
        if (cur) hardRemove(ctx, c.id);
      } else if (!cur) {
        insertSnapshot(ctx, t);
      } else {
        cur.placement = cloneJson(t.placement);
        ctx.markChanged(cur);
      }
    }
  }
}
