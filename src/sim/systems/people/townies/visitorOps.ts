/**
 * Visitor lifecycle operations shared by the townies supervisor, social outcomes, the phone and parties.
 *
 * Lifecycle: scheduleArrival (flag) → arriveNow (spawn at an entry point; visitors get `visit`, walk-bys get
 * `walkBy`) → visit_waitAtDoor (rings the doorbell outside the front door until welcomed) → welcomed: free
 * visitor autonomy (engine: visitorAllowed only) → sendVisitorHome (visit.leaving, visit_leave) → despawn offLot.
 */
import type { SimContext } from '../../../contracts';
import type { AgentId, AgentState, VisitState, Vec2 } from '../../../types';
import { PRIORITY } from '../../../vocabulary';
import { intactLimbs } from '../../../../shared/appearance';
import { MOODLET, STAT, VISIT_IDS } from '../../../content/people/ids';
import {
  cancelAll,
  clamp,
  compareIds,
  delFlag,
  distance,
  flagNum,
  flagStr,
  fullName,
  grantMoodlet,
  householdMembers,
  householdOnLot,
  isGuest,
  isNum,
  isWalker,
  minutesToTicks,
  num,
  pickOne,
  setFlag,
  TICKS_PER_HOUR,
} from '../util';
import { HOUSEHOLD_CAP } from '../social/gates';

export type ArrivalReason = 'invited' | 'dropIn' | 'party' | 'walkBy';
const ARRIVAL_REASONS: readonly ArrivalReason[] = ['invited', 'dropIn', 'party', 'walkBy'];

export const VISIT_MIN_MINUTES = 120;
export const VISIT_MAX_MINUTES = 240;
export const MAX_VISIT_EXTENSION_MIN = 8 * 60;

// ───────────────────────────── geometry ─────────────────────────────

function parseEdge(edge: unknown): { kind: 'h' | 'v'; x: number; z: number } | null {
  if (typeof edge !== 'string') return null;
  const m = /^([hv]):(-?\d+):(-?\d+)$/.exec(edge);
  if (!m) return null;
  return { kind: m[1] as 'h' | 'v', x: Number(m[2]), z: Number(m[3]) };
}

function safeIndoor(ctx: SimContext, x: number, z: number): boolean {
  try {
    return ctx.spatial.isIndoor(x, z);
  } catch {
    return false;
  }
}

function safeWalkableNear(ctx: SimContext, p: Vec2, r = 3): { x: number; z: number } | null {
  try {
    return ctx.spatial.nearestWalkable(p, r);
  } catch {
    return null;
  }
}

/** The outdoor tile in front of the front door (door closest to the street), else a front-yard tile. */
export function doorTile(ctx: SimContext): { x: number; z: number } {
  let best: { x: number; z: number; score: number } | null = null;
  for (const id of Object.keys(ctx.state.objects).sort(compareIds)) {
    const obj = ctx.state.objects[id];
    if (!obj || obj.placement.kind !== 'opening') continue;
    let tags: string[] = [];
    try {
      tags = ctx.objectDef(obj).tags ?? [];
    } catch {
      continue;
    }
    if (!tags.includes('door')) continue;
    const e = parseEdge(obj.placement.edge);
    if (!e) continue;
    const sides = e.kind === 'h' ? [{ x: e.x, z: e.z - 1 }, { x: e.x, z: e.z }] : [{ x: e.x - 1, z: e.z }, { x: e.x, z: e.z }];
    const outside = sides.find((t) => !safeIndoor(ctx, t.x, t.z)) ?? null;
    if (!outside) continue;
    const score = outside.z * 100 - Math.abs(outside.x - ctx.state.lot.width / 2);
    if (!best || score > best.score) best = { ...outside, score };
  }
  const lot = ctx.state.lot;
  const want = best ?? { x: Math.floor(num(lot?.width, 30) / 2), z: num(lot?.sidewalkZ, 28) - 2 };
  return safeWalkableNear(ctx, { x: want.x + 0.5, z: want.z + 0.5 }, 4) ?? { x: Math.floor(want.x), z: Math.floor(want.z) };
}

export function entryPoints(ctx: SimContext): Vec2[] {
  const pts = Array.isArray(ctx.state.lot?.entryPoints) ? ctx.state.lot.entryPoints.filter((p) => p && isNum(p.x) && isNum(p.z)) : [];
  if (pts.length) return pts;
  const lot = ctx.state.lot;
  const z = num(lot?.sidewalkZ, 28) + 0.5;
  return [
    { x: 0.5, z },
    { x: num(lot?.width, 30) - 0.5, z },
  ];
}

// ───────────────────────────── pending arrivals ─────────────────────────────

export function pendingArrival(ctx: SimContext, id: AgentId): { tick: number; reason: ArrivalReason } | null {
  const tick = flagNum(ctx, `arrive:${id}`, NaN);
  if (!isNum(tick)) return null;
  const r = flagStr(ctx, `arriveWhy:${id}`);
  return { tick, reason: (ARRIVAL_REASONS as readonly string[]).includes(r ?? '') ? (r as ArrivalReason) : 'dropIn' };
}

export function scheduleArrival(ctx: SimContext, id: AgentId, inMinutes: number, reason: ArrivalReason): void {
  setFlag(ctx, `arrive:${id}`, ctx.state.tick + Math.max(0, minutesToTicks(inMinutes)));
  setFlag(ctx, `arriveWhy:${id}`, reason);
}

export function cancelArrival(ctx: SimContext, id: AgentId): void {
  delFlag(ctx, `arrive:${id}`);
  delFlag(ctx, `arriveWhy:${id}`);
}

/** Townie ids with a pending arrival (sorted). */
export function pendingArrivalIds(ctx: SimContext): AgentId[] {
  const out: AgentId[] = [];
  const flags = ctx.state.flags ?? {};
  for (const k of Object.keys(flags)) {
    const m = /^people:arrive:(.+)$/.exec(k);
    if (m) out.push(m[1]);
  }
  return out.sort(compareIds);
}

// ───────────────────────────── arrival ─────────────────────────────

/** Townies come back from town rested-ish and with their limbs re-attached. */
export function refreshForVisit(ctx: SimContext, a: AgentState): void {
  const r = () => 55 + Math.floor(ctx.rng.next() * 40);
  a.needs = {
    hunger: r(),
    energy: r(),
    preservation: Math.min(num(a.vitality, 100), 60 + Math.floor(ctx.rng.next() * 35)),
    social: r(),
    fun: r(),
    hygiene: r(),
  };
  a.limbs = intactLimbs();
  a.queue = [];
  a.moodlets = Array.isArray(a.moodlets) ? a.moodlets.filter((m) => m && (m.endTick === null || m.endTick > ctx.state.tick)) : [];
  if (a.status) {
    a.status.feral = false;
    a.status.passedOut = false;
    a.status.zeroPreservationMinutes = 0;
  }
}

function newVisit(ctx: SimContext, reason: VisitState['reason'], welcomed: boolean, leaveTick?: number): VisitState {
  const now = ctx.state.tick;
  const stay = VISIT_MIN_MINUTES + Math.floor(ctx.rng.next() * (VISIT_MAX_MINUTES - VISIT_MIN_MINUTES + 1));
  return { arrivedTick: now, leaveTick: isNum(leaveTick) ? leaveTick : now + minutesToTicks(stay), reason, welcomed, leaving: false };
}

/** Queue the door wait (or, with `greet`, a walk up to the door for pre-welcomed party guests). */
export function queueDoorWait(ctx: SimContext, a: AgentState): void {
  const t = doorTile(ctx);
  const greet = !!a.visit && a.visit.welcomed;
  ctx.queue(a, {
    interactionId: VISIT_IDS.waitAtDoor,
    target: { kind: 'tile', x: t.x, z: t.z },
    ...(greet ? { params: { greet: true } } : {}),
    source: 'system',
    priority: PRIORITY.system,
    front: true,
  });
}

export function queueWalk(ctx: SimContext, a: AgentState): void {
  if (!a.walkBy) return;
  const to = a.walkBy.to;
  ctx.queue(a, {
    interactionId: VISIT_IDS.walkBy,
    target: { kind: 'tile', x: Math.floor(num(to.x, 0)), z: Math.floor(num(to.z, 0)) },
    source: 'system',
    priority: PRIORITY.system,
  });
}

/** Spawn a townie onto the lot now. Returns false (and changes nothing important) if they can't come. */
export function arriveNow(ctx: SimContext, a: AgentState, reason: ArrivalReason): boolean {
  cancelArrival(ctx, a.id);
  if (a.role !== 'townie' || a.presence !== 'offLot') return false;
  const pts = entryPoints(ctx);
  const from = pickOne(ctx, pts) ?? pts[0];
  refreshForVisit(ctx, a);
  a.visit = null;
  a.walkBy = null;
  if (reason === 'walkBy') {
    let to = pts[0];
    let far = -1;
    for (const p of pts) {
      const d = distance(p, from);
      if (d > far) {
        far = d;
        to = p;
      }
    }
    a.walkBy = { from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, startedTick: ctx.state.tick };
  } else {
    const party = ctx.state.party;
    const partyGuest = reason === 'party' && !!party && !party.ended;
    a.visit = newVisit(ctx, partyGuest ? 'party' : reason === 'invited' ? 'invited' : 'dropIn', partyGuest, partyGuest ? party!.endTick : undefined);
  }
  ctx.spawnAgent(a.id, { x: from.x, z: from.z });
  if ((a.presence as string) !== 'onLot') {
    // Spawn refused (engine fault barrier) — roll back so the supervisor never sees a ghost.
    a.visit = null;
    a.walkBy = null;
    return false;
  }
  setFlag(ctx, `lastVisit:${a.id}`, ctx.state.tick);
  if (reason === 'walkBy') {
    queueWalk(ctx, a);
    return true;
  }
  ctx.stat(STAT.townieVisits, 1, null);
  queueDoorWait(ctx, a);
  if (reason === 'invited') ctx.notify({ kind: 'social', title: 'Guest arriving', text: `${fullName(a)} is at the door.`, agentId: a.id });
  else if (reason === 'dropIn') ctx.notify({ kind: 'social', title: 'Someone’s at the door', text: `${fullName(a)} dropped by unannounced and is ringing the doorbell.`, agentId: a.id });
  return true;
}

// ───────────────────────────── transitions ─────────────────────────────

export function welcomeVisitor(ctx: SimContext, v: AgentState, by: AgentState | null): void {
  if (!v.visit) return;
  v.visit.welcomed = true;
  if (by) {
    const r = ctx.rel(by.id, v.id);
    r.met = true;
  }
}

/** Walk-by → visitor who approaches the front door and waits to be welcomed. */
export function convertWalker(ctx: SimContext, w: AgentState): boolean {
  if (!isWalker(w) || w.role !== 'townie') return false;
  w.walkBy = null;
  w.visit = newVisit(ctx, 'walkBy', false);
  cancelAll(ctx, w, VISIT_IDS.walkBy, 'Waved over');
  cancelAll(ctx, w, VISIT_IDS.linger, 'Waved over');
  queueDoorWait(ctx, w);
  ctx.stat(STAT.townieVisits, 1, null);
  return true;
}

/** Make a walker stop and wait (somebody is waving at them). */
export function lingerWalker(ctx: SimContext, w: AgentState): void {
  if (!isWalker(w)) return;
  if (w.active?.interactionId === VISIT_IDS.linger) return;
  cancelAll(ctx, w, VISIT_IDS.walkBy, 'Somebody waved');
  ctx.queue(w, { interactionId: VISIT_IDS.linger, target: { kind: 'self' }, source: 'system', priority: PRIORITY.system, front: true });
}

export function sendVisitorHome(ctx: SimContext, v: AgentState, _reason: string): void {
  if (v.presence !== 'onLot') return;
  if (v.visit) {
    if (!v.visit.leaving) setFlag(ctx, `leavingSince:${v.id}`, ctx.state.tick);
    v.visit.leaving = true;
    v.visit.leaveTick = Math.min(num(v.visit.leaveTick, ctx.state.tick), ctx.state.tick);
  }
  cancelAll(ctx, v, VISIT_IDS.waitAtDoor, 'Leaving');
  if (v.active?.interactionId === VISIT_IDS.leave || v.queue?.some((q) => q.interactionId === VISIT_IDS.leave)) return;
  ctx.queue(v, { interactionId: VISIT_IDS.leave, target: { kind: 'self' }, source: 'system', priority: PRIORITY.system, front: true });
}

export function extendVisit(ctx: SimContext, v: AgentState, minutes: number): void {
  if (!v.visit || v.visit.leaving) return;
  const now = ctx.state.tick;
  const next = Math.max(num(v.visit.leaveTick, now), now) + minutesToTicks(clamp(num(minutes, 0), 0, MAX_VISIT_EXTENSION_MIN));
  v.visit.leaveTick = Math.min(next, now + minutesToTicks(MAX_VISIT_EXTENSION_MIN));
}

/** Townie becomes a household member (moveIn / marriage). Returns true or a reason. */
export function joinHousehold(ctx: SimContext, t: AgentState, inviter: AgentState | null): true | string {
  if (t.role !== 'townie') return `${t.firstName} can’t move in`;
  const hh = ctx.state.household;
  if (!hh || !Array.isArray(hh.memberIds)) return 'No household';
  if (hh.memberIds.includes(t.id)) return `${t.firstName} already lives here`;
  const living = householdMembers(ctx).filter((m) => m.presence !== 'gone').length;
  if (living >= HOUSEHOLD_CAP) return `The crypt is full (${HOUSEHOLD_CAP} max)`;

  for (const id of [VISIT_IDS.waitAtDoor, VISIT_IDS.leave, VISIT_IDS.walkBy, VISIT_IDS.linger]) cancelAll(ctx, t, id, 'Moved in');
  t.role = 'household';
  hh.memberIds.push(t.id);
  t.visit = null;
  t.walkBy = null;
  cancelArrival(ctx, t.id);
  delFlag(ctx, `leave:${t.id}`);
  delFlag(ctx, `leavingSince:${t.id}`);
  delFlag(ctx, `bell:${t.id}`);
  if (!Array.isArray(t.rewardTraits)) t.rewardTraits = [];
  if (!Array.isArray(t.aspirationMilestones)) t.aspirationMilestones = [];
  if (!isNum(t.aspirationPoints)) t.aspirationPoints = 0;
  if (!t.aspiration || !ctx.content.aspirations[t.aspiration]) {
    const ids = Object.keys(ctx.content.aspirations).sort();
    t.aspiration = pickOne(ctx, ids);
  }
  const party = ctx.state.party;
  if (party && Array.isArray(party.guestIds)) party.guestIds = party.guestIds.filter((g) => g !== t.id);

  grantMoodlet(ctx, t, MOODLET.movedIn, { sourceId: inviter?.id ?? null });
  for (const m of householdOnLot(ctx)) if (m.id !== t.id) grantMoodlet(ctx, m, MOODLET.newRoommate, { sourceId: t.id });
  ctx.stat(STAT.movedIn, 1, null);
  ctx.notify({ kind: 'social', title: 'New housemate!', text: `${fullName(t)} moved in, bringing three suitcases of grave dirt and a houseplant that bites.`, agentId: t.id });
  return true;
}

export function visitorsOnLot(ctx: SimContext): AgentState[] {
  return Object.keys(ctx.state.agents)
    .sort(compareIds)
    .map((id) => ctx.state.agents[id])
    .filter((a): a is AgentState => !!a && (isGuest(a) || (a.role === 'townie' && isWalker(a))));
}

export const LEAVE_STUCK_TICKS = TICKS_PER_HOUR;
