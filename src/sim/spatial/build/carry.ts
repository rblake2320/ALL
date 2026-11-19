/**
 * SURFACE CARRYING + USER RELEASE (SIM-SPATIAL build) — shared by the planner (move / sell) and undo / redo.
 *
 * Surfaces:
 *  - A parent's surface frame is its floor placement (geometry.ts Frame) or, for a wall item, the mounted tile with
 *    wallRot (edges.ts) — exactly the frames surfacePoints() uses. Openings / loose / held objects have no frame.
 *  - Children = loose items whose placement.parentId names the parent (state order).
 *  - carriedPlacement(): a child with a valid surfaceIndex lands exactly on that surface point of the new frame
 *    (y = surface height); otherwise its world point is mapped old frame -> local -> new frame (y kept). Facing turns
 *    with the parent. A child whose position cannot be mapped (NaN) goes to the parent's first surface point, else the
 *    new frame centre — a child never stays floating where its parent used to be.
 *
 * Users (releaseUsers):
 *  - Users of an object = agents in its inUseBy, agents holding a slot reservation on it, and agents whose active
 *    run's stageTarget is the object (e.g. walking to a slot-less table). Each is ctx.interrupt()ed.
 *  - Afterwards inUseBy is cleared, and a reservation is kept ONLY while its holder's active run is still bound to that
 *    exact slot. The engine walks an interrupted run-phase agent out through a short 'exit' phase and releases the slot
 *    itself when that ends; clearing it early would break the engine invariant "run.slot is reserved by its runner"
 *    and let a second zombie book the slot meanwhile. Every other (stale) reservation is dropped.
 *  - ORDER MATTERS: interrupt BEFORE collecting children or changing a frame. The engine finishes non-run phases
 *    synchronously and an end() hook may put a carried plate down on the nearest free surface — the very surface
 *    being moved / sold — so children are gathered after the interrupts.
 */
import type { ContentRegistry } from '../../contracts';
import type { AgentState, ObjectId, ObjectPlacement, ObjectState, WorldState } from '../../types';
import type { BuildContext } from './context';
import { specOf } from '../defs';
import { floorFrame } from '../grid';
import { wallFrame } from '../edges';
import { frameCentre, frameLocalToWorld, frameWorldToLocal, rotDeltaYaw, wrapAngle, type Frame } from '../geometry';

function fin(...v: unknown[]): boolean {
  return v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function objectsOf(state: WorldState): Record<string, ObjectState> {
  return state.objects && typeof state.objects === 'object' ? state.objects : {};
}

/** Loose items resting on a surface of `parentId` (state order). */
export function childrenOf(state: WorldState, parentId: ObjectId): ObjectState[] {
  const out: ObjectState[] = [];
  const objs = objectsOf(state);
  for (const id in objs) {
    const o = objs[id];
    if (o && o.placement && o.placement.kind === 'loose' && o.placement.parentId === parentId) out.push(o);
  }
  return out;
}

/** Surface frame of a floor object or wall item (null for anything else / unusable data). */
export function surfaceFrame(content: ContentRegistry, obj: Pick<ObjectState, 'defId' | 'placement'> | null | undefined): Frame | null {
  if (!obj || !obj.placement) return null;
  const p = obj.placement;
  if (p.kind === 'floor') {
    const spec = specOf(content, obj.defId);
    return spec ? floorFrame(obj as ObjectState, spec) : null;
  }
  if (p.kind === 'wall') {
    const wf = wallFrame(p.edge, p.side);
    return wf ? { w: 1, d: 1, ox: wf.tile.x, oz: wf.tile.z, rot: wf.rot } : null;
  }
  return null;
}

/** New placement of a loose child when its parent's frame changes from `oldFrame` to `newFrame` (null: not loose). */
export function carriedPlacement(
  content: ContentRegistry,
  parent: Pick<ObjectState, 'defId'>,
  oldFrame: Frame,
  newFrame: Frame,
  child: ObjectState,
): ObjectPlacement | null {
  const p = child.placement;
  if (!p || p.kind !== 'loose') return null;
  const spec = specOf(content, parent.defId);
  const surfaces = spec && Array.isArray(spec.surfaces) ? spec.surfaces : [];
  const si = p.surfaceIndex;
  let x: number;
  let z: number;
  let y = fin(p.y) ? p.y : 0;
  const onSurface = typeof si === 'number' && Number.isInteger(si) && si >= 0 && !!surfaces[si] && fin(surfaces[si].x, surfaces[si].z);
  if (onSurface) {
    const s = surfaces[si as number];
    const w = frameLocalToWorld(newFrame, s.x, s.z);
    x = w.x;
    z = w.z;
    if (fin(s.y)) y = s.y;
  } else if (fin(p.x, p.z)) {
    const local = frameWorldToLocal(oldFrame, p.x, p.z);
    const w = frameLocalToWorld(newFrame, local.x, local.z);
    x = w.x;
    z = w.z;
  } else {
    // Unmappable (corrupt) position: first surface point, else the footprint centre — never left behind.
    const s = surfaces.find((q) => q && fin(q.x, q.z));
    const w = s ? frameLocalToWorld(newFrame, s.x, s.z) : frameCentre(newFrame);
    x = w.x;
    z = w.z;
    if (s && fin(s.y)) y = s.y;
  }
  const facing = wrapAngle((fin(p.facing) ? p.facing : 0) + rotDeltaYaw(oldFrame.rot, newFrame.rot));
  return { kind: 'loose', x, z, y, parentId: p.parentId, surfaceIndex: p.surfaceIndex, facing };
}

/** Is `agent`'s active run still bound to slot `slot` of object `objectId`? */
function boundToSlot(agent: AgentState | undefined, objectId: ObjectId, slot: string): boolean {
  const run = agent && agent.active;
  if (!run || !run.stageTarget || run.stageTarget.kind !== 'object' || run.stageTarget.id !== objectId) return false;
  return run.slot !== null && run.slot !== undefined && String(run.slot) === slot;
}

function stagedOn(agent: AgentState | undefined, objectId: ObjectId): boolean {
  const run = agent && agent.active;
  return !!run && !!run.stageTarget && run.stageTarget.kind === 'object' && run.stageTarget.id === objectId;
}

/** Interrupt every user of `obj`, then clear in-use marks and every reservation no active run still holds (header). */
export function releaseUsers(ctx: BuildContext, obj: ObjectState, reason: string): void {
  const all: Record<string, AgentState> = ctx.state.agents && typeof ctx.state.agents === 'object' ? ctx.state.agents : {};
  // Own-property lookups only: a corrupt reservation naming "__proto__" must never reach ctx.interrupt.
  const agentOf = (id: string): AgentState | undefined => (Object.prototype.hasOwnProperty.call(all, id) ? all[id] : undefined);
  const agents = all;
  const ids = new Set<string>();
  if (Array.isArray(obj.inUseBy)) for (const a of obj.inUseBy) if (typeof a === 'string') ids.add(a);
  const res = obj.reservedBy && typeof obj.reservedBy === 'object' ? obj.reservedBy : {};
  for (const k in res) if (typeof res[k] === 'string') ids.add(res[k]);
  for (const id in agents) if (stagedOn(agents[id], obj.id)) ids.add(id);
  for (const id of ids) {
    const agent = agentOf(id);
    if (agent && typeof agent === 'object') ctx.interrupt(agent, reason);
  }
  const kept: Record<string, string> = {};
  const cur = obj.reservedBy && typeof obj.reservedBy === 'object' ? obj.reservedBy : {};
  for (const k in cur) if (typeof cur[k] === 'string' && boundToSlot(agentOf(cur[k]), obj.id, k)) kept[k] = cur[k];
  obj.reservedBy = kept;
  obj.inUseBy = [];
}

/** releaseUsers on an object and on everything resting on it (interrupts first — see header). */
export function releaseWithChildren(ctx: BuildContext, obj: ObjectState, reason: string): void {
  releaseUsers(ctx, obj, reason);
  for (const child of childrenOf(ctx.state, obj.id)) releaseUsers(ctx, child, reason);
}

/** Lower-case display name for player-facing reasons ("the drizzle shower was sold"). */
export function objectLabel(content: ContentRegistry, obj: Pick<ObjectState, 'defId'> | null | undefined): string {
  const spec = obj ? specOf(content, obj.defId) : null;
  const name = spec && typeof spec.name === 'string' && spec.name.length > 0 ? spec.name : 'object';
  return name.toLowerCase();
}
