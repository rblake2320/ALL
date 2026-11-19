/** StageTarget resolution (README §7): picks the object/slot/tile a stage happens at. */
import type { DistanceField, InteractionDef, ResolvedSlot, StageDef, StageTarget } from '../contracts';
import type { ActiveInteraction, AgentState, ObjectState, TargetRef, Vec2 } from '../types';
import { dirToFacing } from '../../shared/dimensions';
import { recordFault } from './faults';
import { objectCenter, objectName, objectsById, resolveSlotsSafe, slotFree, tryObjectDef } from './objects';
import type { Engine } from './types';
import { capitalize, dist, humanize, isNum, tileCenter } from './util';
import { agentRegion, scopeLot, scopeRegion } from './regions';

export interface Pose {
  x: number;
  z: number;
  y: number;
  facing: number;
}

export type Resolution =
  | {
      ok: true;
      target: TargetRef;
      slot: number | null;
      goal: { x: number; z: number } | null;
      pose: Pose | null;
      kind: StageTarget['kind'];
      /** Object the stage uses (for inUse / power), if any. */
      objectId: string | null;
      /** Face toward this point on arrival when pose is null. */
      face: Vec2 | null;
      /**
       * The stage happens AT the queued object target without using it as the stage object (seat facing / near the
       * TV, tile near the stereo): that object is "watched" (in use, power-checked, must keep existing). False for
       * stages placed relative to the actor (eat at a seat near me), where the queued target no longer matters.
       */
      aboutTarget?: boolean;
    }
  | {
      ok: false;
      reason: string;
      /**
       * A `nearestTag` stage failed only because every matching object is merely reserved / in use by someone
       * else (or unpowered, with at least one in use): the runner waits for a slot instead of failing (backlog #5).
       */
      busy?: boolean;
    };

const FAIL = (reason: string): Resolution => ({ ok: false, reason });

export function distanceFieldSafe(eng: Engine, from: Vec2): DistanceField | null {
  try {
    return eng.spatial.distanceField(from);
  } catch (e) {
    recordFault(eng, 'spatial.distanceField', e);
    return null;
  }
}

export function costAt(eng: Engine, df: DistanceField, x: number, z: number): number {
  if (!eng.spatial.inBounds(x, z)) return Infinity;
  const c = df.dist[eng.spatial.tileIndex(x, z)];
  return isNum(c) ? c : Infinity;
}

/** Tiles other agents stand on or are routing to (so we don't stack zombies). */
export function occupiedTiles(eng: Engine, except: AgentState[]): Set<number> {
  const set = new Set<number>();
  const skip = new Set(except.map((a) => a.id));
  const here = scopeRegion(eng);
  for (const a of Object.values(eng.state.agents)) {
    if (a.presence !== 'onLot' || skip.has(a.id) || agentRegion(eng, a) !== here) continue;
    const t = eng.spatial.tileOf(a.pos);
    if (eng.spatial.inBounds(t.x, t.z)) set.add(eng.spatial.tileIndex(t.x, t.z));
    const g = a.active && a.active.routeGoal;
    if (g && eng.spatial.inBounds(g.x, g.z)) set.add(eng.spatial.tileIndex(g.x, g.z));
  }
  return set;
}

function poseFor(eng: Engine, obj: ObjectState, s: ResolvedSlot, tile: { x: number; z: number }): Pose {
  const def = tryObjectDef(eng, obj);
  const spec = def && Array.isArray(def.slots) ? def.slots[s.index] : undefined;
  if ((spec && spec.faceObject) || !s.pose || !isNum(s.pose.x) || !isNum(s.pose.z)) return facePose(eng, obj, tile);
  return { x: s.pose.x, z: s.pose.z, y: isNum(s.pose.y) ? s.pose.y : 0, facing: isNum(s.pose.facing) ? s.pose.facing : 0 };
}

function facePose(eng: Engine, obj: ObjectState, tile: { x: number; z: number }): Pose {
  const c = objectCenter(eng, obj);
  const tc = tileCenter(tile);
  let dx = c.x - tc.x;
  let dz = c.z - tc.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) {
    dx /= d;
    dz /= d;
  } else {
    dx = 0;
    dz = 1;
  }
  const step = Math.min(0.28, d);
  return { x: tc.x + dx * step, z: tc.z + dz * step, y: 0, facing: dirToFacing(dx, dz) };
}

interface SlotPick {
  slot: ResolvedSlot | null;
  tile: { x: number; z: number };
  cost: number;
  pose: Pose;
}

/** Best free reachable slot on an object (or an adjacent tile when the object has no slots). */
export function bestSlotOn(
  eng: Engine,
  agent: AgentState,
  obj: ObjectState,
  df: DistanceField,
  opts: { slotIds?: string[]; kind?: ResolvedSlot['kind']; filter?: (s: ResolvedSlot) => boolean } = {},
): { pick: SlotPick | null; anyFree: boolean; hasSlots: boolean } {
  const slots = resolveSlotsSafe(eng, obj);
  let pick: SlotPick | null = null;
  let anyFree = false;
  let hasSlots = false;
  for (const s of slots) {
    if (opts.slotIds && opts.slotIds.length > 0 && !opts.slotIds.includes(s.id)) continue;
    if (opts.kind && s.kind !== opts.kind) continue;
    if (opts.filter && !opts.filter(s)) continue;
    hasSlots = true;
    if (!slotFree(eng, obj, s.index, agent.id)) continue;
    anyFree = true;
    for (const t of Array.isArray(s.approach) ? s.approach : []) {
      if (!t || !isNum(t.x) || !isNum(t.z)) continue;
      const c = costAt(eng, df, t.x, t.z);
      if (!Number.isFinite(c)) continue;
      if (!pick || c < pick.cost) pick = { slot: s, tile: { x: t.x, z: t.z }, cost: c, pose: poseFor(eng, obj, s, t) };
    }
  }
  if (!hasSlots && !opts.slotIds?.length && !opts.kind) {
    // Slot-less object: stand on the cheapest reachable tile around it, facing it.
    const around = tilesAround(eng, obj);
    for (const t of around) {
      const c = costAt(eng, df, t.x, t.z);
      if (!Number.isFinite(c)) continue;
      if (!pick || c < pick.cost) pick = { slot: null, tile: t, cost: c, pose: facePose(eng, obj, t) };
    }
    anyFree = true;
  }
  return { pick, anyFree, hasSlots };
}

function tilesAround(eng: Engine, obj: ObjectState): { x: number; z: number }[] {
  let tiles: { x: number; z: number }[] = [];
  try {
    tiles = obj.placement.kind === 'floor' ? eng.spatial.objectTiles(obj) : [eng.spatial.tileOf(objectCenter(eng, obj))];
  } catch (e) {
    recordFault(eng, 'spatial.objectTiles', e);
  }
  if (tiles.length === 0) tiles = [eng.spatial.tileOf(objectCenter(eng, obj))];
  const own = new Set(tiles.map((t) => `${t.x},${t.z}`));
  const out: { x: number; z: number }[] = [];
  const seen = new Set<string>();
  for (const t of tiles) {
    for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const x = t.x + dx;
      const z = t.z + dz;
      const k = `${x},${z}`;
      if (own.has(k) || seen.has(k)) continue;
      seen.add(k);
      if (eng.spatial.inBounds(x, z) && eng.spatial.isWalkable(x, z)) out.push({ x, z });
    }
  }
  return out;
}

export function stageNeedsPower(eng: Engine, st: StageDef, obj: ObjectState | null | undefined): boolean {
  if (typeof st.power === 'boolean') return st.power;
  const def = tryObjectDef(eng, obj ?? null);
  return !!(def && def.needsPower);
}

/** Power reason for running a stage on an object (null = fine). */
export function stagePowerReason(eng: Engine, st: StageDef, obj: ObjectState | null | undefined): string | null {
  if (!stageNeedsPower(eng, st, obj)) return null;
  const def = tryObjectDef(eng, obj ?? null);
  if (obj && def && def.needsPower && obj.condition.broken) return `${def.name} is broken`;
  if (!eng.state.household.utilitiesOn) return 'The power is out';
  return null;
}

function usableObject(obj: ObjectState, agent: AgentState): boolean {
  if (obj.condition.burning) return false;
  if (obj.placement.kind === 'held' && obj.placement.agentId !== agent.id) return false;
  return true;
}

/** World point the queued target refers to (object centre, agent position, tile centre, actor). */
export function targetCenter(eng: Engine, agent: AgentState, t: TargetRef): Vec2 {
  switch (t.kind) {
    case 'object': {
      const o = eng.state.objects[t.id];
      return o ? objectCenter(eng, o) : { x: agent.pos.x, z: agent.pos.z };
    }
    case 'agent': {
      const a = eng.state.agents[t.id];
      return a ? { x: a.pos.x, z: a.pos.z } : { x: agent.pos.x, z: agent.pos.z };
    }
    case 'tile':
      return tileCenter(t);
    case 'self':
      return { x: agent.pos.x, z: agent.pos.z };
  }
}

function here(agent: AgentState, run: ActiveInteraction): Resolution {
  const t: TargetRef = run.target.kind === 'self' || run.target.kind === 'tile' ? { kind: 'self' } : { ...run.target };
  return { ok: true, target: t, slot: null, goal: null, pose: null, kind: 'here', objectId: null, face: null };
}

function resolveObjectTarget(eng: Engine, agent: AgentState, obj: ObjectState, df: DistanceField, slotIds?: string[]): Resolution {
  const name = objectName(eng, obj);
  if (obj.placement.kind === 'held') {
    if (obj.placement.agentId === agent.id) {
      return { ok: true, target: { kind: 'object', id: obj.id }, slot: null, goal: null, pose: null, kind: 'target', objectId: obj.id, face: null };
    }
    return FAIL('Someone else has it');
  }
  if (obj.condition.burning) return FAIL(`The ${name.toLowerCase()} is on fire!`);
  const r = bestSlotOn(eng, agent, obj, df, { slotIds });
  if (r.pick) {
    return {
      ok: true,
      target: { kind: 'object', id: obj.id },
      slot: r.pick.slot ? r.pick.slot.index : null,
      goal: r.pick.tile,
      pose: r.pick.pose,
      kind: 'target',
      objectId: obj.id,
      face: null,
    };
  }
  if (r.hasSlots && !r.anyFree) return FAIL(`${capitalize(name)} is in use`);
  return FAIL(`Can't reach the ${name.toLowerCase()}`);
}

export function resolveAdjacent(eng: Engine, agent: AgentState, targetId: string, df: DistanceField): Resolution {
  const t = eng.state.agents[targetId];
  if (!t || t.presence !== 'onLot') return FAIL(`${t ? t.firstName : 'They'} isn't here`);
  if (t.id === agent.id) return FAIL("Can't do that to yourself");
  const tt = eng.spatial.tileOf(t.pos);
  const occupied = occupiedTiles(eng, [agent, t]);
  const targetWalkable = eng.spatial.inBounds(tt.x, tt.z) && eng.spatial.isWalkable(tt.x, tt.z);
  let best: { x: number; z: number; cost: number } | null = null;
  for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x = tt.x + dx;
    const z = tt.z + dz;
    if (!eng.spatial.inBounds(x, z) || !eng.spatial.isWalkable(x, z)) continue;
    if (occupied.has(eng.spatial.tileIndex(x, z))) continue;
    if (targetWalkable && !eng.spatial.canStep(x, z, tt.x, tt.z)) continue;
    let c = costAt(eng, df, x, z);
    if (!Number.isFinite(c)) continue;
    if (dx !== 0 && dz !== 0) c += 0.5;
    if (!best || c < best.cost) best = { x, z, cost: c };
  }
  if (!best) return FAIL(`Can't get to ${t.firstName}`);
  const c = tileCenter(best);
  const facing = dirToFacing(t.pos.x - c.x, t.pos.z - c.z);
  return {
    ok: true,
    target: { kind: 'agent', id: t.id },
    slot: null,
    goal: { x: best.x, z: best.z },
    pose: { x: c.x, z: c.z, y: 0, facing },
    kind: 'agentAdjacent',
    objectId: null,
    face: null,
  };
}

function seatFilter(eng: Engine, agent: AgentState, run: ActiveInteraction, st: Extract<StageTarget, { kind: 'seat' }>) {
  const origin = st.near === 'target' ? targetCenter(eng, agent, run.target) : { x: agent.pos.x, z: agent.pos.z };
  const focus = targetCenter(eng, agent, run.target);
  const radius = isNum(st.radius) && st.radius > 0 ? st.radius : 8;
  return (s: ResolvedSlot) => {
    if (!s.pose || !isNum(s.pose.x) || !isNum(s.pose.z)) return false;
    if (dist(s.pose, origin) > radius + 1e-6) return false;
    if (st.facingTarget) {
      const dx = focus.x - s.pose.x;
      const dz = focus.z - s.pose.z;
      const d = Math.hypot(dx, dz);
      if (d > radius + 1e-6 || d < 1e-6) return false;
      const fx = Math.sin(s.pose.facing);
      const fz = Math.cos(s.pose.facing);
      const cos = (fx * dx + fz * dz) / d;
      if (cos < Math.cos((60 * Math.PI) / 180)) return false;
    }
    return true;
  };
}

function seatHasTable(eng: Engine, s: ResolvedSlot): boolean {
  if (!s.pose) return false;
  const fx = s.pose.x + Math.sin(s.pose.facing) * 0.8;
  const fz = s.pose.z + Math.cos(s.pose.facing) * 0.8;
  const t = eng.spatial.tileOf({ x: fx, z: fz });
  if (!eng.spatial.inBounds(t.x, t.z)) return false;
  for (const id of eng.spatial.objectsAt(t.x, t.z)) {
    const o = eng.state.objects[id];
    const d = o ? tryObjectDef(eng, o) : null;
    if (d && (d.tags.includes('table') || d.tags.includes('desk') || d.tags.includes('surface'))) return true;
  }
  return false;
}

/**
 * Bounded BFS (octile costs) around the agent using canStep — reachability for short hops (wandering)
 * without a full-lot distance field. Returns tile index -> cost for tiles within `radius` (Chebyshev).
 */
export function localReach(eng: Engine, from: Vec2, radius: number): Map<number, number> {
  const out = new Map<number, number>();
  const o = eng.spatial.tileOf(from);
  if (!eng.spatial.inBounds(o.x, o.z)) return out;
  // Dijkstra-lite over the (2r+1)^2 window with octile costs; window-local typed arrays.
  const size = radius * 2 + 1;
  const cost = new Float64Array(size * size).fill(Infinity);
  const local = (x: number, z: number) => (z - o.z + radius) * size + (x - o.x + radius);
  cost[local(o.x, o.z)] = 0;
  out.set(eng.spatial.tileIndex(o.x, o.z), 0);
  let frontier: number[] = [o.x, o.z];
  for (let ring = 0; ring < size * 2 && frontier.length > 0; ring++) {
    const next: number[] = [];
    for (let f = 0; f < frontier.length; f += 2) {
      const fx = frontier[f];
      const fz = frontier[f + 1];
      const fc = cost[local(fx, fz)];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const x = fx + dx;
          const z = fz + dz;
          if (x < o.x - radius || x > o.x + radius || z < o.z - radius || z > o.z + radius) continue;
          const c = fc + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
          const li = local(x, z);
          if (cost[li] <= c + 1e-9) continue;
          if (!eng.spatial.canStep(fx, fz, x, z)) continue;
          cost[li] = c;
          out.set(eng.spatial.tileIndex(x, z), c);
          next.push(x, z);
        }
      }
    }
    frontier = next;
  }
  return out;
}

function resolveWander(eng: Engine, agent: AgentState, run: ActiveInteraction, radius: number): Resolution {
  const reach = localReach(eng, agent.pos, Math.ceil(radius));
  const occupied = occupiedTiles(eng, [agent]);
  const own = eng.spatial.tileOf(agent.pos);
  const ownIdx = eng.spatial.inBounds(own.x, own.z) ? eng.spatial.tileIndex(own.x, own.z) : -1;
  const cands: { x: number; z: number }[] = [];
  const w = eng.spatial.width();
  for (const [i] of reach) {
    if (i === ownIdx || occupied.has(i)) continue;
    const x = i % w;
    const z = (i - x) / w;
    if (dist(tileCenter({ x, z }), agent.pos) > radius + 0.5) continue;
    cands.push({ x, z });
  }
  if (cands.length === 0) return FAIL('No room nearby');
  cands.sort((a, b) => a.z - b.z || a.x - b.x);
  const pick = cands[Math.floor(eng.rng.next() * cands.length) % cands.length];
  const t: TargetRef = run.target.kind === 'object' || run.target.kind === 'agent' ? { ...run.target } : { kind: 'tile', x: pick.x, z: pick.z };
  return { ok: true, target: t, slot: null, goal: pick, pose: null, kind: 'tileNear', objectId: null, face: null };
}

export function resolveStage(
  eng: Engine,
  agent: AgentState,
  run: ActiveInteraction,
  def: InteractionDef,
  st: StageDef,
  target: StageTarget,
): Resolution {
  if (!target || typeof target !== 'object') return FAIL('Nowhere to do that');
  if (target.kind === 'here') return here(agent, run);
  if (target.kind === 'tileNear' && target.of === 'actor' && isNum(target.radius) && target.radius > 0 && target.radius <= 8) {
    return resolveWander(eng, agent, run, target.radius);
  }
  const df = distanceFieldSafe(eng, agent.pos);
  if (!df) return FAIL("Can't get there");
  switch (target.kind) {
    case 'target': {
      const t = run.target;
      if (t.kind === 'self') return here(agent, run);
      if (t.kind === 'agent') return resolveAdjacent(eng, agent, t.id, df);
      if (t.kind === 'tile') {
        if (!isNum(t.x) || !isNum(t.z) || !eng.spatial.inBounds(Math.floor(t.x), Math.floor(t.z))) return FAIL("Can't go there");
        let tile = { x: Math.floor(t.x), z: Math.floor(t.z) };
        if (!eng.spatial.isWalkable(tile.x, tile.z)) {
          const w = eng.spatial.nearestWalkable(tileCenter(tile), 3);
          if (!w) return FAIL("Can't go there");
          tile = w;
        }
        if (!Number.isFinite(costAt(eng, df, tile.x, tile.z))) return FAIL("Can't get there");
        return { ok: true, target: { kind: 'tile', x: tile.x, z: tile.z }, slot: null, goal: tile, pose: null, kind: 'target', objectId: null, face: null };
      }
      const obj = eng.state.objects[t.id];
      if (!obj) return FAIL("It's gone");
      return resolveObjectTarget(eng, agent, obj, df, target.slots);
    }
    case 'agentAdjacent': {
      if (run.target.kind !== 'agent') return FAIL('Nobody to talk to');
      return resolveAdjacent(eng, agent, run.target.id, df);
    }
    case 'nearestTag': {
      const tag = String(target.tag ?? '');
      let found = 0;
      let busy = 0;
      let reserved = 0; // objects whose (matching) slots all exist and are all taken: worth waiting for
      let unpowered = 0;
      let best: { obj: ObjectState; pick: SlotPick } | null = null;
      for (const obj of objectsById(eng)) {
        const od = tryObjectDef(eng, obj);
        if (!od || !od.tags.includes(tag)) continue;
        if (obj.condition.broken || !usableObject(obj, agent)) continue;
        found++;
        if (stagePowerReason(eng, st, obj) !== null) {
          unpowered++;
          continue;
        }
        if (obj.placement.kind === 'held') {
          // held by the actor: use it in hand
          return { ok: true, target: { kind: 'object', id: obj.id }, slot: null, goal: null, pose: null, kind: 'nearestTag', objectId: obj.id, face: null };
        }
        const r = bestSlotOn(eng, agent, obj, df, { slotIds: target.slots });
        if (!r.anyFree) busy++;
        if (r.hasSlots && !r.anyFree) reserved++;
        if (r.pick && (!best || r.pick.cost < best.pick.cost)) best = { obj, pick: r.pick };
      }
      if (best) {
        return {
          ok: true,
          target: { kind: 'object', id: best.obj.id },
          slot: best.pick.slot ? best.pick.slot.index : null,
          goal: best.pick.tile,
          pose: best.pick.pose,
          kind: 'nearestTag',
          objectId: best.obj.id,
          face: null,
        };
      }
      const noun = humanize(tag);
      if (found === 0) return FAIL(`No working ${noun} here`);
      if (unpowered === found) return FAIL(eng.state.household.utilitiesOn ? `The ${noun} is broken` : 'The power is out');
      if (busy + unpowered >= found) return { ok: false, reason: `The ${noun} is in use`, busy: reserved > 0 };
      return FAIL(`Can't reach the ${noun}`);
    }
    case 'seat': {
      const filter = seatFilter(eng, agent, run, target);
      let best: { obj: ObjectState; pick: SlotPick; tier: number } | null = null;
      for (const obj of objectsById(eng)) {
        if (obj.placement.kind !== 'floor' || obj.condition.burning) continue;
        const od = tryObjectDef(eng, obj);
        if (!od || !od.slots.some((s) => s.kind === 'sit')) continue;
        const r = bestSlotOn(eng, agent, obj, df, { kind: 'sit', filter });
        if (!r.pick || !r.pick.slot) continue;
        const tier = target.preferTable ? (seatHasTable(eng, r.pick.slot) ? 0 : 1) : 0;
        if (!best || tier < best.tier || (tier === best.tier && r.pick.cost < best.pick.cost)) best = { obj, pick: r.pick, tier };
      }
      if (!best) return FAIL('No free seat nearby');
      return {
        ok: true,
        target: { kind: 'object', id: best.obj.id },
        slot: best.pick.slot ? best.pick.slot.index : null,
        goal: best.pick.tile,
        pose: best.pick.pose,
        kind: 'seat',
        objectId: best.obj.id,
        face: null,
        aboutTarget: target.near === 'target' || target.facingTarget === true,
      };
    }
    case 'tileNear': {
      const center = target.of === 'actor' ? { x: agent.pos.x, z: agent.pos.z } : targetCenter(eng, agent, run.target);
      const radius = isNum(target.radius) && target.radius > 0 ? Math.min(target.radius, 12) : 3;
      const occupied = occupiedTiles(eng, [agent]);
      const own = eng.spatial.tileOf(agent.pos);
      const cands: { x: number; z: number; cost: number }[] = [];
      const cx = Math.floor(center.x);
      const cz = Math.floor(center.z);
      const r = Math.ceil(radius);
      for (let z = cz - r; z <= cz + r; z++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (!eng.spatial.inBounds(x, z) || !eng.spatial.isWalkable(x, z)) continue;
          const d = dist(tileCenter({ x, z }), center);
          if (d > radius + 1e-6) continue;
          if (target.of === 'target' && d < 0.9) continue;
          if (target.of === 'actor' && x === own.x && z === own.z) continue;
          if (occupied.has(eng.spatial.tileIndex(x, z))) continue;
          const c = costAt(eng, df, x, z);
          if (!Number.isFinite(c)) continue;
          cands.push({ x, z, cost: c });
        }
      }
      if (cands.length === 0) return FAIL('No room nearby');
      let pick: { x: number; z: number; cost: number };
      if (target.of === 'actor') pick = cands[Math.floor(eng.rng.next() * cands.length) % cands.length];
      else pick = cands.reduce((a, b) => (b.cost < a.cost ? b : a));
      const c = tileCenter(pick);
      const face = target.of === 'target' ? center : null;
      const facing = face ? dirToFacing(face.x - c.x, face.z - c.z) : agent.facing;
      return {
        ok: true,
        target: run.target.kind === 'object' || run.target.kind === 'agent' ? { ...run.target } : { kind: 'tile', x: pick.x, z: pick.z },
        slot: null,
        goal: { x: pick.x, z: pick.z },
        pose: face ? { x: c.x, z: c.z, y: 0, facing } : null,
        kind: 'tileNear',
        objectId: null,
        face,
        aboutTarget: target.of === 'target',
      };
    }
    case 'exit': {
      const lot = scopeLot(eng);
      const eps = Array.isArray(lot.entryPoints) ? lot.entryPoints : [];
      let best: { x: number; z: number; cost: number } | null = null;
      for (const ep of eps) {
        if (!ep || !isNum(ep.x) || !isNum(ep.z)) continue;
        let t = eng.spatial.tileOf(ep);
        if (!eng.spatial.inBounds(t.x, t.z) || !eng.spatial.isWalkable(t.x, t.z)) {
          const w = eng.spatial.nearestWalkable(ep, 4);
          if (!w) continue;
          t = w;
        }
        const c = costAt(eng, df, t.x, t.z);
        if (Number.isFinite(c) && (!best || c < best.cost)) best = { x: t.x, z: t.z, cost: c };
      }
      if (!best) return FAIL("Can't find the way out");
      return { ok: true, target: { kind: 'self' }, slot: null, goal: { x: best.x, z: best.z }, pose: null, kind: 'exit', objectId: null, face: null };
    }
    default:
      return FAIL('Nowhere to do that');
  }
}
