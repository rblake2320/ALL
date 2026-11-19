/** Social + pair choreography (README §8). Outcome math belongs to the social system's behaviour. */
import type { InteractionDef } from '../contracts';
import type { ActiveInteraction, AgentState, TargetRef } from '../types';
import { dirToFacing } from '../../shared/dimensions';
import { ENGINE_INTERACTIONS, PRIORITY } from '../vocabulary';
import { SOCIAL_MAX_REROUTES } from './constants';
import { isSleepingRun } from './needs';
import { queueItem, suspendActive } from './queue';
import { beginNext, finishRun, reroute, startRunPhase } from './runner';
import type { Engine } from './types';
import { compareIds } from './util';

export function partnerName(eng: Engine, run: ActiveInteraction): string {
  const id = run.partnerId ?? (run.target.kind === 'agent' ? run.target.id : typeof run.params.partnerId === 'string' ? run.params.partnerId : null);
  const a = id ? eng.state.agents[id] : undefined;
  return a ? a.firstName : 'They';
}

/**
 * Does this social walk up to the target and engage it (engine_respond)? Socials whose first stage targets a tile
 * near the agent (decision #12, e.g. waving at a walk-by) run without engaging and skip busy checks.
 */
export function engagesTarget(eng: Engine, def: InteractionDef): boolean {
  if (!def.social) return false;
  const st = eng.content.stagesOf(def.id)[0];
  const k = st && st.target ? st.target.kind : 'agentAdjacent';
  return k === 'agentAdjacent' || k === 'target';
}

/** Why `target` can't be engaged by `actor` right now (null = available). */
export function targetBusyReason(eng: Engine, actor: AgentState, target: AgentState): string | null {
  if (target.presence !== 'onLot') return target.presence === 'atWork' ? `${target.firstName} is at work` : `${target.firstName} isn't here`;
  if (target.status && target.status.passedOut) return `${target.firstName} is passed out`;
  // A feral zombie hunts for food (critical override): chatting would only interrupt the meal it is fetching.
  if (target.status && target.status.feral) return `${target.firstName} is too hungry to talk`;
  // Something critical is already waiting (a Fight Fire call, a feral meal): it preempts the respond half within the
  // minute, the actor re-picks the same social, and the pair loops — dozens of 1-minute socials per hour while the
  // fire burns (balance pass, docs/BALANCE.md).
  if (Array.isArray(target.queue) && target.queue.some((q) => q && q.priority >= PRIORITY.critical)) return `${target.firstName} is busy`;
  const a = target.active;
  if (!a) return null;
  if (a.partnerId && a.partnerId !== actor.id) return `${target.firstName} is busy`;
  // The respond / partner half runs at system priority: it must never suspend something more urgent.
  if (a.priority > PRIORITY.system) return `${target.firstName} is busy`;
  if (a.interactionId === ENGINE_INTERACTIONS.exitLot) return `${target.firstName} is leaving`;
  if (isSleepingRun(eng, target)) return `${target.firstName} is asleep`;
  const def = eng.content.interactions[a.interactionId];
  if (def && def.interruptible === false && a.phase === 'run') return `${target.firstName} is busy`;
  return null;
}

function faceEachOther(a: AgentState, b: AgentState): void {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  if (Math.abs(dx) + Math.abs(dz) < 1e-6) return;
  a.facing = dirToFacing(dx, dz);
  b.facing = dirToFacing(-dx, -dz);
}

function tileGap(eng: Engine, a: AgentState, b: AgentState): number {
  const ta = eng.spatial.tileOf(a.pos);
  const tb = eng.spatial.tileOf(b.pos);
  return Math.max(Math.abs(ta.x - tb.x), Math.abs(ta.z - tb.z));
}

/** On a neighbouring tile with nothing (wall / corner) between us. */
export function closeEnoughToTalk(eng: Engine, a: AgentState, b: AgentState): boolean {
  if (tileGap(eng, a, b) !== 1) return false;
  const ta = eng.spatial.tileOf(a.pos);
  const tb = eng.spatial.tileOf(b.pos);
  if (!eng.spatial.inBounds(ta.x, ta.z) || !eng.spatial.inBounds(tb.x, tb.z)) return false;
  if (!eng.spatial.isWalkable(ta.x, ta.z)) return false;
  // a seated/lying target sits inside a blocked tile: adjacency is enough
  if (!eng.spatial.isWalkable(tb.x, tb.z)) return true;
  return eng.spatial.canStep(ta.x, ta.z, tb.x, tb.z);
}

/** `b` is walking over to start its own social/pair with `a` (the higher id waits for the lower one). */
export function approachingMe(eng: Engine, a: AgentState, b: AgentState): boolean {
  const r = b.active;
  if (!r || r.phase !== 'route' || r.target.kind !== 'agent' || r.target.id !== a.id) return false;
  const d = eng.content.interactions[r.interactionId];
  if (!d || !(d.social || d.pair)) return false;
  return compareIds(a.id, b.id) > 0;
}

function dropStale(target: AgentState, interactionId: string, key: string, actorId: string): void {
  target.queue = target.queue.filter((q) => !(q.interactionId === interactionId && q.params[key] === actorId));
}

/** Wait phase driver for both socials (engage target) and pairs (start together). */
export function engageOrWait(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  if (def.social && run.target.kind === 'agent') {
    engageSocial(eng, agent, run, def);
    return;
  }
  const p = run.partnerId ? eng.state.agents[run.partnerId] : undefined;
  if (!p || !p.active || p.active.partnerId !== agent.id) {
    finishRun(eng, agent, 'failed', `${p ? p.firstName : 'They'} couldn't join`);
    return;
  }
  const pr = p.active;
  if (pr.phase === 'run') {
    startRunPhase(eng, agent, run, def);
    return;
  }
  if (pr.phase === 'wait' && pr.stage === 0) {
    const pdef = eng.content.interactions[pr.interactionId];
    startRunPhase(eng, agent, run, def);
    if (pdef && p.active === pr && pr.phase === 'wait' && agent.active === run) startRunPhase(eng, p, pr, pdef);
  }
}

function engageSocial(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  const t = eng.state.agents[(run.target as Extract<TargetRef, { kind: 'agent' }>).id];
  if (!t || t.presence !== 'onLot') return void finishRun(eng, agent, 'failed', `${t ? t.firstName : 'They'} left`);
  const ta = t.active;
  if (ta && ta.interactionId === ENGINE_INTERACTIONS.respond && ta.partnerId === agent.id) {
    if (ta.phase === 'run') {
      run.partnerId = t.id;
      faceEachOther(agent, t);
      startRunPhase(eng, agent, run, def);
    }
    return;
  }
  const tr = t.active;
  if (tr && tr.phase === 'route' && tr.target.kind === 'agent' && tr.target.id === agent.id) {
    const td = eng.content.interactions[tr.interactionId];
    if (td && (td.social || td.pair) && compareIds(agent.id, t.id) > 0) return; // they are coming to us
  }
  if (!closeEnoughToTalk(eng, agent, t)) {
    reroute(eng, agent, run, def, SOCIAL_MAX_REROUTES);
    return;
  }
  const busy = targetBusyReason(eng, agent, t);
  if (busy) {
    // asleep / away / leaving are final; ordinary busy-ness waits (until the wait timeout).
    if (t.presence !== 'onLot' || t.status.passedOut || isSleepingRun(eng, t) || (ta && ta.interactionId === ENGINE_INTERACTIONS.exitLot)) {
      finishRun(eng, agent, 'failed', busy);
    }
    return;
  }
  suspendActive(eng, t, `${agent.firstName} wants a word`, true);
  dropStale(t, ENGINE_INTERACTIONS.respond, 'partnerId', agent.id);
  const qi = queueItem(eng, t, {
    interactionId: ENGINE_INTERACTIONS.respond,
    target: { kind: 'agent', id: agent.id },
    params: { partnerId: agent.id, socialId: def.id },
    source: 'system',
    priority: PRIORITY.system,
    front: true,
  });
  if (!qi) return void finishRun(eng, agent, 'failed', `${t.firstName} is busy`);
  // Make sure our respond is the next thing the target does.
  t.queue = [qi, ...t.queue.filter((q) => q.uid !== qi.uid)];
  beginNext(eng, t);
  const nt = t.active;
  if (nt && nt.uid === qi.uid && nt.phase === 'run') {
    run.partnerId = t.id;
    faceEachOther(agent, t);
    startRunPhase(eng, agent, run, def);
  }
}

/** Queue the pair partner's half right after the actor's stage 0 resolved. */
export function preparePair(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef): true | string {
  const pair = def.pair;
  if (!pair) return true;
  const pid = run.target.kind === 'agent' ? run.target.id : typeof run.params.partnerId === 'string' ? run.params.partnerId : null;
  const p = pid ? eng.state.agents[pid] : undefined;
  if (!p || p.id === agent.id) return 'Nobody to do that with';
  if (p.presence !== 'onLot') return `${p.firstName} isn't here`;
  const busy = targetBusyReason(eng, agent, p);
  if (busy) return busy;
  if (!eng.content.interactions[pair.partnerInteraction]) return 'Something went wrong';
  let ptarget: TargetRef | null = null;
  if (pair.partnerTarget === 'actor') ptarget = { kind: 'agent', id: agent.id };
  else if (run.stageTarget.kind === 'object') ptarget = { kind: 'object', id: run.stageTarget.id };
  else if (run.target.kind === 'object') ptarget = { kind: 'object', id: run.target.id };
  if (!ptarget) return 'Nowhere to do that together';
  suspendActive(eng, p, `${agent.firstName} needs ${p.firstName}`, true);
  dropStale(p, pair.partnerInteraction, 'partnerOf', agent.id);
  const qi = queueItem(eng, p, {
    interactionId: pair.partnerInteraction,
    target: ptarget,
    params: { partnerOf: agent.id },
    source: 'system',
    priority: PRIORITY.system,
    front: true,
  });
  if (!qi) return `${p.firstName} is busy`;
  p.queue = [qi, ...p.queue.filter((q) => q.uid !== qi.uid)];
  run.data._pq = 1;
  run.partnerId = p.id;
  beginNext(eng, p);
  if (!p.active || p.active.uid !== qi.uid || p.active.partnerId !== agent.id) {
    run.partnerId = null;
    return `${p.firstName} couldn't join`;
  }
  return true;
}
