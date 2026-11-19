/** Object lifecycle: spawn/remove/place/hold/release + slot/reservation helpers (README §12). */
import type { ObjectDef, ResolvedSlot } from '../contracts';
import type { AgentState, ObjectDefId, ObjectId, ObjectPlacement, ObjectState, Vec2 } from '../types';
import type { CarryItem } from '../../shared/appearance';
import { recordFault } from './faults';
import type { Engine } from './types';
import { compareIds, isNum, tileCenter } from './util';
import { failRunsUsingObject } from './runner';
import { objectRegion, regionIdForNewObject, scopeLot, scopeRegion, withAgentRegion, withRegion } from './regions';
import { dropQueued } from './orders';

export function objectDefOf(eng: Engine, obj: ObjectState | ObjectDefId): ObjectDef {
  const id = typeof obj === 'string' ? obj : obj.defId;
  const def = eng.content.objects[id];
  if (!def) throw new Error(`unknown object def '${String(id)}'`);
  return def;
}

export function tryObjectDef(eng: Engine, obj: ObjectState | ObjectDefId | null | undefined): ObjectDef | null {
  if (!obj) return null;
  const id = typeof obj === 'string' ? obj : obj.defId;
  return eng.content.objects[id] ?? null;
}

export function objectName(eng: Engine, obj: ObjectState | null | undefined): string {
  const def = tryObjectDef(eng, obj);
  return def ? def.name : 'object';
}

/**
 * Objects in canonical id order (o1, o2, …, o10). Every engine loop that can break a tie (cheapest slot, equal
 * autonomy scores) uses it, so the outcome never depends on JSON key order — saves are written with sorted keys
 * ('o10' < 'o9') and build undo re-inserts old ids at the end (decision #9 / backlog #6).
 */
export function objectsById(eng: Engine): ObjectState[] {
  const objs = eng.state.objects;
  const out: ObjectState[] = [];
  // W-025 S3: only the objects of the region in scope (every object, in a home-only world)
  const here = scopeRegion(eng);
  for (const id of Object.keys(objs).sort(compareIds)) if (objs[id] && objectRegion(eng, objs[id]) === here) out.push(objs[id]);
  return out;
}

export function markChanged(obj: ObjectState): void {
  obj.rev = (isNum(obj.rev) ? obj.rev : 0) + 1;
}

export function isOnLotObject(obj: ObjectState): boolean {
  return obj.placement.kind !== 'held';
}

/** Visual carry item implied by an object's tags. */
export function carryFor(def: ObjectDef | null): CarryItem | null {
  if (!def) return null;
  const tags = def.tags;
  if (tags.includes('pizza')) return 'pizza';
  if (tags.includes('meal')) return 'plate';
  if (tags.includes('dish')) return 'dish';
  if (tags.includes('limb')) return 'limb';
  if (tags.includes('book')) return 'book';
  return null;
}

function validPlacement(eng: Engine, p: ObjectPlacement): boolean {
  if (!p || typeof p !== 'object') return false;
  switch (p.kind) {
    case 'floor':
      return isNum(p.x) && isNum(p.z) && (p.rot === 0 || p.rot === 1 || p.rot === 2 || p.rot === 3);
    case 'wall':
      return typeof p.edge === 'string' && (p.side === 0 || p.side === 1);
    case 'opening':
      return typeof p.edge === 'string';
    case 'loose':
      return isNum(p.x) && isNum(p.z) && isNum(p.y) && isNum(p.facing);
    case 'held':
      return typeof p.agentId === 'string' && !!eng.state.agents[p.agentId];
    default:
      return false;
  }
}

function structural(p: ObjectPlacement): boolean {
  return p.kind === 'floor' || p.kind === 'opening';
}

/** Bump the structural version of the lot IN SCOPE (W-025: the object's region; the home lot in a home-only world). */
function bumpLot(eng: Engine): void {
  const lot = scopeLot(eng);
  lot.version = (isNum(lot.version) ? lot.version : 0) + 1;
  try {
    eng.spatial.invalidate();
  } catch (e) {
    recordFault(eng, 'spatial.invalidate', e);
  }
}

export function spawnObject(
  eng: Engine,
  defId: ObjectDefId,
  placement: ObjectPlacement,
  opts?: { value?: number; data?: ObjectState['data']; tint?: string | null },
): ObjectState {
  const def = eng.content.objects[defId];
  if (!def) throw new Error(`spawnObject: unknown object def '${String(defId)}'`);
  if (!validPlacement(eng, placement)) throw new Error(`spawnObject: invalid placement for '${defId}'`);
  const id = eng.ctx.newId('o');
  const data: ObjectState['data'] = {};
  if (opts && opts.data && typeof opts.data === 'object') {
    for (const [k, v] of Object.entries(opts.data)) {
      if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) data[k] = v;
    }
  }
  const obj: ObjectState = {
    id,
    defId,
    placement: { ...placement } as ObjectPlacement,
    // W-025: created in the region in scope; the field stays ABSENT for the home (and for held items: holder's region)
    ...(placement.kind !== 'held' && regionIdForNewObject(eng) !== undefined ? { regionId: regionIdForNewObject(eng) } : {}),
    value: opts && isNum(opts.value) ? Math.max(0, Math.round(opts.value)) : 0,
    purchasedTick: eng.state.tick,
    tint: opts && typeof opts.tint === 'string' ? opts.tint : null,
    condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 },
    data,
    reservedBy: {},
    inUseBy: [],
    rev: 0,
  };
  if (placement.kind === 'held') {
    const holder = eng.state.agents[placement.agentId];
    if (holder.carryObjectId && holder.carryObjectId !== id) releaseHeld(eng, holder, 'floor');
    holder.carryObjectId = id;
    holder.carrying = carryFor(def) ?? holder.carrying ?? null;
  }
  if (placement.kind === 'opening') {
    const seg = scopeLot(eng).walls[placement.edge];
    if (seg) seg.openingId = id;
  }
  eng.state.objects[id] = obj;
  eng.ctx.emit({ type: 'objectAdded', objectId: id });
  if (structural(placement)) {
    bumpLot(eng);
    eng.ctx.emit({ type: 'lot', what: 'objects' });
  }
  return obj;
}

export function removeObject(eng: Engine, id: ObjectId, reason?: string): void {
  const obj = eng.state.objects[id];
  if (!obj) return;
  withRegion(eng, objectRegion(eng, obj), () => removeObjectIn(eng, obj, id, reason));
}

function removeObjectIn(eng: Engine, obj: ObjectState, id: ObjectId, reason?: string): void {
  const name = objectName(eng, obj);
  // Interrupt runs using it (except the run whose own effect removes it) and drop queue items targeting it.
  failRunsUsingObject(eng, id, reason ?? `The ${name.toLowerCase()} is gone`);
  for (const a of Object.values(eng.state.agents)) {
    if (a.queue && a.queue.length) dropQueued(eng, a, (q) => q.target.kind === 'object' && q.target.id === id, 'targetGone', reason ?? `The ${name.toLowerCase()} is gone`);
    if (a.carryObjectId === id) {
      a.carryObjectId = null;
      a.carrying = null;
    }
  }
  // Items resting on it drop to the floor where they are.
  for (const other of Object.values(eng.state.objects)) {
    const p = other.placement;
    if (p.kind === 'loose' && p.parentId === id) {
      other.placement = { kind: 'loose', x: p.x, z: p.z, y: 0, parentId: null, surfaceIndex: null, facing: p.facing };
      markChanged(other);
    }
  }
  if (obj.placement.kind === 'opening') {
    const seg = scopeLot(eng).walls[obj.placement.edge];
    if (seg && seg.openingId === id) seg.openingId = null;
  }
  const wasStructural = structural(obj.placement);
  delete eng.state.objects[id];
  eng.ctx.emit({ type: 'objectRemoved', objectId: id });
  if (wasStructural) {
    bumpLot(eng);
    eng.ctx.emit({ type: 'lot', what: 'objects' });
  }
}

/** Count loose floor items already on a tile (to fan out new drops a little). */
function looseOnTile(eng: Engine, tx: number, tz: number): number {
  let n = 0;
  const here = scopeRegion(eng);
  for (const o of Object.values(eng.state.objects)) {
    const p = o.placement;
    if (p.kind === 'loose' && p.parentId === null && Math.floor(p.x) === tx && Math.floor(p.z) === tz && objectRegion(eng, o) === here) n++;
  }
  return n;
}

const FAN: Vec2[] = [
  { x: 0, z: 0 },
  { x: 0.22, z: 0.1 },
  { x: -0.2, z: -0.12 },
  { x: 0.12, z: -0.22 },
  { x: -0.14, z: 0.22 },
];

function floorSpotNear(eng: Engine, near: Vec2): { x: number; z: number } | null {
  let t: { x: number; z: number } | null = null;
  try {
    t = eng.spatial.nearestWalkable(near, 6);
  } catch (e) {
    recordFault(eng, 'spatial.nearestWalkable', e);
  }
  if (!t) return null;
  const off = FAN[looseOnTile(eng, t.x, t.z) % FAN.length];
  const c = tileCenter(t);
  return { x: c.x + off.x, z: c.z + off.z };
}

export function placeItemNear(
  eng: Engine,
  defId: ObjectDefId,
  near: Vec2,
  opts?: { data?: ObjectState['data']; preferSurfaceOf?: ObjectId | null; surfaceOnly?: boolean },
): ObjectState | null {
  if (!eng.content.objects[defId]) {
    recordFault(eng, 'placeItemNear', `unknown object def '${String(defId)}'`);
    return null;
  }
  if (!near || !isNum(near.x) || !isNum(near.z)) return null;
  let surf: ReturnType<typeof eng.spatial.freeSurfaceNear> = null;
  try {
    surf = eng.spatial.freeSurfaceNear(near, 3, opts?.preferSurfaceOf ?? null);
  } catch (e) {
    recordFault(eng, 'spatial.freeSurfaceNear', e);
  }
  if (surf && eng.state.objects[surf.objectId]) {
    return spawnObject(
      eng,
      defId,
      { kind: 'loose', x: surf.x, z: surf.z, y: surf.y, parentId: surf.objectId, surfaceIndex: surf.index, facing: 0 },
      { data: opts?.data },
    );
  }
  if (opts?.surfaceOnly) return null;
  const spot = floorSpotNear(eng, near);
  if (!spot) return null;
  return spawnObject(eng, defId, { kind: 'loose', x: spot.x, z: spot.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 }, { data: opts?.data });
}

export function holdItem(eng: Engine, agent: AgentState, obj: ObjectState): void {
  if (!obj || !eng.state.objects[obj.id]) return;
  const p = obj.placement;
  if (p.kind === 'held' && p.agentId === agent.id) {
    agent.carryObjectId = obj.id;
    return;
  }
  if (p.kind === 'floor' || p.kind === 'wall' || p.kind === 'opening') {
    recordFault(eng, 'holdItem', `cannot hold placed object '${obj.id}'`);
    return;
  }
  if (p.kind === 'held') {
    const other = eng.state.agents[p.agentId];
    if (other && other.carryObjectId === obj.id) {
      other.carryObjectId = null;
      other.carrying = null;
    }
  }
  if (agent.carryObjectId && agent.carryObjectId !== obj.id) releaseHeld(eng, agent, 'floor');
  // Anyone else walking to (or using) this item loses it now — never leave their run bound to a slot it lost.
  failRunsUsingObject(eng, obj.id, 'Someone else took it', agent.id);
  healUse(obj);
  for (const [slot, who] of Object.entries(obj.reservedBy)) if (who !== agent.id) delete obj.reservedBy[slot];
  obj.placement = { kind: 'held', agentId: agent.id };
  agent.carryObjectId = obj.id;
  agent.carrying = carryFor(tryObjectDef(eng, obj)) ?? agent.carrying ?? null;
  markChanged(obj);
}

export function releaseHeld(eng: Engine, agent: AgentState, to: 'destroy' | 'floor' | 'surface'): ObjectState | null {
  return withAgentRegion(eng, agent, () => releaseHeldIn(eng, agent, to));
}

/** A dropped item takes its holder's region (W-025 §1.5); for the home the field stays absent. */
function takeHolderRegion(obj: ObjectState, agent: AgentState): void {
  if (agent.regionId !== undefined) obj.regionId = agent.regionId;
  else if (obj.regionId !== undefined) delete obj.regionId;
}

function releaseHeldIn(eng: Engine, agent: AgentState, to: 'destroy' | 'floor' | 'surface'): ObjectState | null {
  const id = agent.carryObjectId;
  agent.carryObjectId = null;
  agent.carrying = null;
  if (!id) return null;
  const obj = eng.state.objects[id];
  if (!obj) return null;
  if (to === 'destroy') {
    removeObject(eng, id);
    return null;
  }
  if (to === 'surface') {
    let s: ReturnType<typeof eng.spatial.freeSurfaceNear> = null;
    try {
      s = eng.spatial.freeSurfaceNear(agent.pos, 3, null);
    } catch (e) {
      recordFault(eng, 'spatial.freeSurfaceNear', e);
    }
    if (s && eng.state.objects[s.objectId]) {
      obj.placement = { kind: 'loose', x: s.x, z: s.z, y: s.y, parentId: s.objectId, surfaceIndex: s.index, facing: agent.facing };
      takeHolderRegion(obj, agent);
      markChanged(obj);
      return obj;
    }
  }
  const spot = floorSpotNear(eng, agent.pos) ?? { x: agent.pos.x, z: agent.pos.z };
  obj.placement = { kind: 'loose', x: spot.x, z: spot.z, y: 0, parentId: null, surfaceIndex: null, facing: isNum(agent.facing) ? agent.facing : 0 };
  takeHolderRegion(obj, agent);
  markChanged(obj);
  return obj;
}

// ─────────────────────────────── slots / reservations ───────────────────────────────

export function resolveSlotsSafe(eng: Engine, obj: ObjectState): ResolvedSlot[] {
  try {
    const s = eng.spatial.resolveSlots(obj);
    return Array.isArray(s) ? s : [];
  } catch (e) {
    recordFault(eng, 'spatial.resolveSlots', e);
    return [];
  }
}

/**
 * Self-heal the bookkeeping fields a buggy system may have clobbered (null / non-array), so reservation code never
 * throws mid-tick. Healthy objects are untouched.
 */
export function healUse(obj: ObjectState): void {
  if (!obj.reservedBy || typeof obj.reservedBy !== 'object' || Array.isArray(obj.reservedBy)) obj.reservedBy = {};
  if (!Array.isArray(obj.inUseBy)) obj.inUseBy = [];
}

/** Is `slot` on `obj` free for `agentId` (stale reservations by agents no longer using it count as free)? */
export function slotFree(eng: Engine, obj: ObjectState, slot: number, agentId: string): boolean {
  healUse(obj);
  const who = obj.reservedBy[String(slot)];
  if (who === undefined || who === agentId) return true;
  const other = eng.state.agents[who];
  if (!other || other.presence !== 'onLot' || !other.active) return true;
  const r = other.active;
  if (r.stageTarget.kind === 'object' && r.stageTarget.id === obj.id && r.slot === slot) return false;
  return true;
}

export function reserveSlot(obj: ObjectState, slot: number, agentId: string): void {
  healUse(obj);
  obj.reservedBy[String(slot)] = agentId;
  markChanged(obj);
}

export function releaseSlot(obj: ObjectState | undefined, slot: number | null, agentId: string): void {
  if (!obj || slot === null) return;
  healUse(obj);
  const key = String(slot);
  if (obj.reservedBy[key] === agentId) {
    delete obj.reservedBy[key];
    markChanged(obj);
  }
}

export function addInUse(obj: ObjectState, agentId: string): void {
  healUse(obj);
  if (!obj.inUseBy.includes(agentId)) {
    obj.inUseBy.push(agentId);
    markChanged(obj);
  }
}

export function removeInUse(obj: ObjectState | undefined, agentId: string): void {
  if (!obj) return;
  healUse(obj);
  const i = obj.inUseBy.indexOf(agentId);
  if (i >= 0) {
    obj.inUseBy.splice(i, 1);
    markChanged(obj);
  }
}

/** Remove every reservation / in-use entry held by an agent (robust sweep). */
export function releaseAllFor(eng: Engine, agentId: string): void {
  const objs = eng.state.objects;
  for (const oid in objs) {
    const obj = objs[oid];
    if (!obj || typeof obj !== 'object') continue;
    healUse(obj);
    let changed = false;
    for (const k in obj.reservedBy) {
      if (obj.reservedBy[k] === agentId) {
        delete obj.reservedBy[k];
        changed = true;
      }
    }
    const i = obj.inUseBy.indexOf(agentId);
    if (i >= 0) {
      obj.inUseBy.splice(i, 1);
      changed = true;
    }
    if (changed) markChanged(obj);
  }
}

/** Object world centre (any placement) with a safe fallback. */
export function objectCenter(eng: Engine, obj: ObjectState): Vec2 {
  if (obj.placement.kind === 'held') {
    const a = eng.state.agents[obj.placement.agentId];
    if (a) return { x: a.pos.x, z: a.pos.z };
  }
  if (obj.placement.kind === 'loose') return { x: obj.placement.x, z: obj.placement.z };
  try {
    const c = eng.spatial.objectCenter(obj);
    if (c && isNum(c.x) && isNum(c.z)) return c;
  } catch (e) {
    recordFault(eng, 'spatial.objectCenter', e);
  }
  if (obj.placement.kind === 'floor') return { x: obj.placement.x + 0.5, z: obj.placement.z + 0.5 };
  return { x: 0.5, z: 0.5 };
}
