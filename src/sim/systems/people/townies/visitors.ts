/**
 * Visitor supervisor + the `visit` behaviour (visit_walkBy / visit_linger / visit_waitAtDoor / visit_leave),
 * hourly walk-bys (07–22, 20 %/h while < 2 visitors) and drop-ins (friends ≥ 35, 4 %/h, 10–21), invitations.
 * The supervisor runs every tick for on-lot townies and repairs any stray state (never leaves a townie stuck).
 */
import type { InteractionBehavior, SimContext } from '../../../contracts';
import type { AgentId, AgentState } from '../../../types';
import { PRIORITY } from '../../../vocabulary';
import { SOCIAL_IDS, VISIT_IDS } from '../../../content/people/ids';
import {
  bubble,
  clamp,
  compareIds,
  delFlag,
  distance,
  firstName,
  flagNum,
  fullName,
  hasQueued,
  hasTrait,
  householdOnLot,
  isNum,
  minutesToTicks,
  num,
  peekRel,
  pickOne,
  safeMood,
  setFlag,
  sfx,
  TICKS_PER_HOUR,
  TICKS_PER_MINUTE,
  townies,
  voice,
} from '../util';
import {
  arriveNow,
  cancelArrival,
  LEAVE_STUCK_TICKS,
  pendingArrival,
  pendingArrivalIds,
  queueDoorWait,
  queueWalk,
  scheduleArrival,
  sendVisitorHome,
  visitorsOnLot,
} from './visitorOps';
import { addFriendship, FRIEND_THRESHOLD, writableRel } from '../social/relations';
import { partyActive } from './party';

export const WALKBY_FROM = 7;
export const WALKBY_TO = 22;
export const WALKBY_CHANCE = 0.2;
export const DROPIN_FROM = 10;
export const DROPIN_TO = 21;
export const DROPIN_CHANCE = 0.04;
export const CURFEW_FROM = 1;
export const CURFEW_TO = 6;
const WALKER_MAX_MIN = 90;
/** Acceptance chance for inviting a townie nobody in the house has met (HUD invite dialog lists everyone). */
export const COLD_CALL_CHANCE = 0.35;
const UNWELCOMED_LIMIT_MIN = { invited: 90, other: 60 };

function despawnTownie(ctx: SimContext, a: AgentState): void {
  a.walkBy = null;
  a.visit = null;
  delFlag(ctx, `leavingSince:${a.id}`);
  if (a.presence === 'onLot') ctx.despawnAgent(a.id, 'offLot');
}

function startLeaving(ctx: SimContext, a: AgentState, why: 'time' | 'curfew' | 'miserable' | 'unwelcomed'): void {
  if (!a.visit || a.visit.leaving) return;
  if (why === 'miserable') {
    ctx.notify({ kind: 'social', title: 'Guest left in a huff', text: `${fullName(a)} had a miserable time and stormed off.`, agentId: a.id });
    for (const m of householdOnLot(ctx)) addFriendship(writableRel(ctx, m.id, a.id), -3);
  } else if (why === 'unwelcomed') {
    ctx.notify({ kind: 'social', title: 'Left on the doorstep', text: `${fullName(a)} got tired of ringing the doorbell and went home.`, agentId: a.id });
    for (const m of householdOnLot(ctx)) {
      const r = writableRel(ctx, m.id, a.id);
      if (r.met) addFriendship(r, -3);
    }
  } else if (why === 'curfew') {
    bubble(ctx, a.id, 'zzz', 'thought');
  }
  sendVisitorHome(ctx, a, why);
}

/** Per-tick lifecycle for one on-lot townie. */
export function superviseTownie(ctx: SimContext, a: AgentState): void {
  const now = ctx.state.tick;
  if (a.walkBy) {
    if (now - num(a.walkBy.startedTick, now) > minutesToTicks(WALKER_MAX_MIN)) return despawnTownie(ctx, a);
    if (!a.active && (!Array.isArray(a.queue) || a.queue.length === 0)) {
      if (distance(a.pos, a.walkBy.to) <= 1.5) return despawnTownie(ctx, a);
      queueWalk(ctx, a);
    }
    return;
  }
  const v = a.visit;
  if (!v) {
    // Stray townie on the lot (old save / interrupted lifecycle): give them a polite exit.
    if (!isNum(flagNum(ctx, `leavingSince:${a.id}`, NaN))) setFlag(ctx, `leavingSince:${a.id}`, now);
    if (!hasQueued(a, VISIT_IDS.leave)) ctx.queue(a, { interactionId: VISIT_IDS.leave, target: { kind: 'self' }, source: 'system', priority: PRIORITY.system, front: true });
    if (now - flagNum(ctx, `leavingSince:${a.id}`, now) > LEAVE_STUCK_TICKS) return despawnTownie(ctx, a);
    return;
  }
  if (!isNum(v.leaveTick)) v.leaveTick = now;
  if (!isNum(v.arrivedTick)) v.arrivedTick = now;
  if (v.leaving) {
    if (!isNum(flagNum(ctx, `leavingSince:${a.id}`, NaN))) setFlag(ctx, `leavingSince:${a.id}`, now);
    if (!hasQueued(a, VISIT_IDS.leave)) ctx.queue(a, { interactionId: VISIT_IDS.leave, target: { kind: 'self' }, source: 'system', priority: PRIORITY.system, front: true });
    if (now - flagNum(ctx, `leavingSince:${a.id}`, now) > LEAVE_STUCK_TICKS) despawnTownie(ctx, a);
    return;
  }
  const partyGuest = v.reason === 'party' && partyActive(ctx);
  const hour = ctx.time.hour;
  if (!partyGuest && now >= v.leaveTick) return startLeaving(ctx, a, 'time');
  if (!partyGuest && hour >= CURFEW_FROM && hour < CURFEW_TO) return startLeaving(ctx, a, 'curfew');
  if (v.welcomed && safeMood(ctx, a) <= -50) return startLeaving(ctx, a, 'miserable');
  if (!v.welcomed) {
    const limit = v.reason === 'invited' ? UNWELCOMED_LIMIT_MIN.invited : UNWELCOMED_LIMIT_MIN.other;
    if (now - v.arrivedTick > minutesToTicks(limit)) return startLeaving(ctx, a, 'unwelcomed');
    if (!a.active && (!Array.isArray(a.queue) || a.queue.length === 0)) queueDoorWait(ctx, a);
  }
}

/** Arrivals whose time has come (checked once per game minute). */
export function processArrivals(ctx: SimContext): void {
  const now = ctx.state.tick;
  for (const id of pendingArrivalIds(ctx)) {
    const p = pendingArrival(ctx, id);
    const a = ctx.state.agents[id];
    if (!p || !a || a.role !== 'townie') {
      cancelArrival(ctx, id);
      continue;
    }
    if (now < p.tick) continue;
    if (a.presence !== 'offLot') {
      cancelArrival(ctx, id);
      continue;
    }
    if (p.reason === 'party' && !partyActive(ctx)) {
      cancelArrival(ctx, id);
      continue;
    }
    if (p.reason === 'walkBy' && visitorsOnLot(ctx).length >= 2) {
      cancelArrival(ctx, id);
      continue;
    }
    arriveNow(ctx, a, p.reason);
  }
}

function freeTownies(ctx: SimContext, minGapHours: number): AgentState[] {
  const now = ctx.state.tick;
  return townies(ctx).filter(
    (t) => t.presence === 'offLot' && !pendingArrival(ctx, t.id) && now - flagNum(ctx, `lastVisit:${t.id}`, -1e12) >= minGapHours * TICKS_PER_HOUR,
  );
}

/** Hourly visitor generation. */
export function visitorsHour(ctx: SimContext, hour: number): void {
  if (ctx.state.settings?.visitorsEnabled === false) return;
  if (householdOnLot(ctx).length === 0) return;
  const pending = pendingArrivalIds(ctx).length;
  if (hour >= WALKBY_FROM && hour < WALKBY_TO && visitorsOnLot(ctx).length + pending < 2 && ctx.rng.chance(WALKBY_CHANCE)) {
    const who = pickOne(ctx, freeTownies(ctx, 6));
    if (who) scheduleArrival(ctx, who.id, Math.floor(ctx.rng.next() * 50), 'walkBy');
  }
  if (hour >= DROPIN_FROM && hour < DROPIN_TO && !partyActive(ctx)) {
    const guests = visitorsOnLot(ctx).filter((a) => !!a.visit).length;
    if (guests + pendingArrivalIds(ctx).length >= 3) return;
    const members = householdOnLot(ctx);
    const friends = freeTownies(ctx, 12).filter((t) => members.some((m) => {
      const r = peekRel(ctx, m.id, t.id);
      return r.met && (r.bestFriends || num(r.friendship, 0) >= FRIEND_THRESHOLD);
    }));
    for (const f of friends) {
      if (ctx.rng.chance(DROPIN_CHANCE)) {
        scheduleArrival(ctx, f.id, Math.floor(ctx.rng.next() * 40), 'dropIn');
        break;
      }
    }
  }
}

const EXCUSES = [
  'they’re washing their shroud',
  'their cat is haunting the neighbours again',
  'they promised to help a friend dig a plot',
  'it’s choir night at St. Mildew’s',
  'their left leg is at the repair shop',
  'they’re waiting in for a coffin delivery',
];

/** Phone: invite a met townie over. The townie may decline (friendship-based). */
export function inviteTownie(ctx: SimContext, actorId: AgentId, townieId: unknown): true | string {
  const actor = typeof actorId === 'string' ? ctx.agent(actorId) : undefined;
  if (!actor) return 'Unknown zombie';
  if (typeof townieId !== 'string' || !townieId) return 'Pick someone to invite';
  const t = ctx.agent(townieId);
  if (!t || t.role !== 'townie') return 'They don’t live in Wormwood Heights';
  if (t.presence === 'onLot') return `${firstName(t)} is already here`;
  if (t.presence !== 'offLot') return `${firstName(t)} can’t come`;
  if (pendingArrival(ctx, t.id)) return `${firstName(t)} is already on the way`;
  const rel = peekRel(ctx, actor.id, t.id);
  const hour = ctx.time.hour;
  if (hour >= 23 || hour < 7) {
    ctx.notify({ kind: 'social', title: 'Too late to call', text: `${firstName(t)} answered in a sleepy groan: “Do you know what time it is?”`, agentId: actor.id });
    return true;
  }
  // Friends usually say yes; a cold call to a stranger from the phone book is a long shot.
  let p = rel.met ? 0.55 + num(rel.friendship, 0) / 150 : COLD_CALL_CHANCE;
  if (hasTrait(ctx, t, 'loner')) p -= 0.15;
  if (hasTrait(ctx, t, 'socialButterfly')) p += 0.1;
  if (ctx.rng.chance(clamp(p, 0.2, 0.95))) {
    const delay = 20 + Math.floor(ctx.rng.next() * 41);
    scheduleArrival(ctx, t.id, delay, 'invited');
    const text = rel.met
      ? `${fullName(t)} is on their way over. Tidy up the bones.`
      : `${fullName(t)} has never heard of ${firstName(actor)}, but free snacks are free snacks. They’re coming over.`;
    ctx.notify({ kind: 'social', title: 'Invitation accepted', text, agentId: actor.id });
  } else if (!rel.met) {
    ctx.notify({ kind: 'social', title: 'Invitation declined', text: `${fullName(t)} said “Who is this?” and hung up.`, agentId: actor.id });
  } else {
    const excuse = EXCUSES[Math.floor(ctx.rng.next() * EXCUSES.length)] ?? EXCUSES[0];
    ctx.notify({ kind: 'social', title: 'Invitation declined', text: `${fullName(t)} can’t make it — ${excuse}.`, agentId: actor.id });
  }
  return true;
}

// ───────────────────────────── `visit` behaviour ─────────────────────────────

function kindOf(def: { params?: Record<string, string | number | boolean> }): string {
  return typeof def.params?.kind === 'string' ? def.params.kind : '';
}

/** Flag key holding the tick of a visitor's latest doorbell ring (survives a door wait restarted after a social). */
export const BELL_FLAG = (id: AgentId) => `bell:${id}`;

/**
 * Ring the doorbell if this visit's ring schedule allows it: at most `maxRings` rings, `ringEveryMin` apart, all
 * within the first `maxRings × ringEveryMin` minutes of the visit. The schedule lives in a flag (not run.data), so
 * a door wait suspended by a social and re-queued by the engine neither rings early nor resets the cap.
 */
export function maybeRingDoorbell(ctx: SimContext, a: AgentState, def: { params?: Record<string, string | number | boolean> }): boolean {
  const v = a.visit;
  if (!v || v.leaving) return false;
  const now = ctx.state.tick;
  const every = Math.max(1, minutesToTicks(num(def.params?.ringEveryMin, 20)));
  const maxRings = Math.max(1, Math.floor(num(def.params?.maxRings, 3)));
  const arrived = num(v.arrivedTick, now);
  const last = flagNum(ctx, BELL_FLAG(a.id), NaN);
  const rangThisVisit = isNum(last) && last >= arrived;
  if (rangThisVisit && now - last < every) return false;
  if (rangThisVisit && now - arrived >= maxRings * every) return false;
  setFlag(ctx, BELL_FLAG(a.id), now);
  sfx(ctx, 'doorbell', { agentId: a.id, pos: { x: a.pos.x, z: a.pos.z } });
  bubble(ctx, a.id, 'house', 'thought');
  voice(ctx, a.id, 'question', 1000);
  return true;
}

function doorWaitReason(a: AgentState, greet: boolean): string | null {
  if (!a.visit || a.visit.leaving) return 'Not visiting';
  // A visitor who was welcomed while their door wait was suspended (e.g. by the welcome social itself) must not
  // walk back out to ring again. Pre-welcomed party guests still walk up to the door once (params.greet).
  if (a.visit.welcomed && !greet) return 'Already inside';
  return null;
}

export const visitBehavior: InteractionBehavior = {
  available(_ctx, a, def) {
    const k = kindOf(def);
    if ((k === 'walkBy' || k === 'linger') && !a.walkBy) return 'Not out for a stroll';
    if (k === 'waitAtDoor' && (!a.visit || a.visit.leaving)) return 'Not visiting';
    return true;
  },
  begin(_ctx, a, run, def) {
    const k = kindOf(def);
    if ((k === 'walkBy' || k === 'linger') && !a.walkBy) return 'Not out for a stroll';
    if (k === 'waitAtDoor') return doorWaitReason(a, run.params?.greet === true);
    return null;
  },
  startStage(ctx, a, run, def) {
    if (kindOf(def) === 'waitAtDoor') {
      const why = doorWaitReason(a, run.params?.greet === true);
      if (why) return why;
      maybeRingDoorbell(ctx, a, def);
    }
    return null;
  },
  tick(ctx, a, run, def) {
    const k = kindOf(def);
    if (k === 'waitAtDoor') {
      if (!a.visit || a.visit.welcomed || a.visit.leaving) return 'done';
      maybeRingDoorbell(ctx, a, def);
      return undefined;
    }
    if (k === 'linger') {
      if (!a.walkBy) return 'done';
      if (someoneWavingAt(ctx, a.id)) run.data.lastWave = ctx.state.tick;
      else if (ctx.state.tick - num(run.data.lastWave, run.startedRunTick ?? ctx.state.tick) >= TICKS_PER_MINUTE * 1) return 'done';
    }
    return undefined;
  },
  end(ctx, a, _run, def, outcome) {
    const k = kindOf(def);
    if (k === 'walkBy') {
      if (outcome === 'complete' && a.walkBy && a.presence === 'onLot') despawnTownie(ctx, a);
      return;
    }
    if (k === 'leave') {
      // Complete (reached the exit) or failed (exit unreachable): either way, go home. Canceled = moved in etc.
      if (outcome !== 'canceled' && a.presence === 'onLot' && a.role === 'townie') despawnTownie(ctx, a);
      return;
    }
    if (k === 'waitAtDoor' && outcome === 'complete' && a.visit?.welcomed) {
      bubble(ctx, a.id, 'happy', 'speech', true);
      voice(ctx, a.id, 'happy', 1000);
    }
  },
};

/** Is any on-lot agent currently doing (or about to do) Wave Over at `walkerId`? */
export function someoneWavingAt(ctx: SimContext, walkerId: AgentId): boolean {
  const waving = (q: { interactionId: string; target: { kind: string; id?: string } } | null | undefined) =>
    !!q && q.interactionId === SOCIAL_IDS.waveOver && q.target.kind === 'agent' && q.target.id === walkerId;
  for (const id of Object.keys(ctx.state.agents)) {
    const o = ctx.state.agents[id];
    if (!o || o.presence !== 'onLot' || o.id === walkerId) continue;
    if (waving(o.active) || (Array.isArray(o.queue) && o.queue.some(waving))) return true;
  }
  return false;
}

/** Household autonomy nudge: welcome visitors who have waited ≥ 10 min (adds a second welcome candidate). */
export function welcomeCandidates(ctx: SimContext, agent: AgentState): { interactionId: string; target: { kind: 'agent'; id: AgentId } }[] {
  if (agent.role !== 'household' || agent.presence !== 'onLot') return [];
  const out: { interactionId: string; target: { kind: 'agent'; id: AgentId } }[] = [];
  const now = ctx.state.tick;
  for (const v of visitorsOnLot(ctx).sort((x, y) => compareIds(x.id, y.id))) {
    if (!v.visit || v.visit.welcomed || v.visit.leaving) continue;
    if (now - num(v.visit.arrivedTick, now) >= 10 * TICKS_PER_MINUTE) out.push({ interactionId: SOCIAL_IDS.welcome, target: { kind: 'agent', id: v.id } });
  }
  return out;
}

