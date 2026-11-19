/**
 * Interaction state machine (README §7): begin → stage resolution → route → (wait) → run → next stage / end.
 * Every exit path goes through finishRun(), which releases reservations and calls behaviour.end exactly once.
 */
import type { EffectContext, EffectRef, InteractionDef, StageDef } from '../contracts';
import type { ActiveInteraction, AgentState, QueueItem, Vec2 } from '../types';
import { TICK_MINUTES } from '../types';
import { dirToFacing } from '../../shared/dimensions';
import { ENGINE_INTERACTIONS, PRIORITY } from '../vocabulary';
import {
  AUTONOMY_BACKOFF_MAX,
  AUTONOMY_BACKOFF_MIN,
  EXIT_PHASE_MIN,
  GROUP_FUN_PER_HOUR,
  GROUP_MAX_OTHERS,
  GROUP_SOCIAL_PER_HOUR,
  OPEN_ENDED_DURATION,
  OPEN_ENDED_SAFETY_MIN,
  ROUTE_MAX_FAILS,
  ROUTE_TIME_FACTOR,
  ROUTE_TIME_SLACK_MIN,
  SOCIAL_MAX_REROUTES,
  TAG_WAIT_MAX_MIN,
  TAG_WAIT_RECHECK_MIN,
  WAIT_TIMEOUT_MIN,
} from './constants';
import { behaviorOf, callHook } from './behaviors';
import { recordFault } from './faults';
import { recordCompletion } from './repetition';
import { addMoodlet, addXp, changeNeed, isNeedId, isSkillId, needCap } from './needs';
import { addInUse, objectName, releaseAllFor, releaseSlot, removeInUse, reserveSlot, tryObjectDef } from './objects';
import { requeueCopy } from './queue';
import { resolveStage, stagePowerReason, type Resolution } from './stages';
import { approachingMe, closeEnoughToTalk, engageOrWait, engagesTarget, partnerName, preparePair, targetBusyReason } from './socials';
import { socialGate } from './socialGate';
import { agentSpeed } from './movement';
import { interactionLabel } from './labels';
import type { Engine } from './types';
import { allSorted, isHouseholdAgent } from './agents';
import { isNum, num, tileCenter } from './util';
import { agentRegion, planningSpatialOf, scopeLot } from './regions';
import { legPath, worldLeg } from './worldMove';

export type Outcome = 'complete' | 'canceled' | 'failed';
export interface FinishOpts {
  silent?: boolean;
  partnerOutcome?: Outcome;
  partnerReason?: string;
}

const ENDED = '\u0000ended';

export function origUid(run: { uid: number; params: QueueItem['params'] }): number {
  return isNum(run.params._origUid) ? run.params._origUid : run.uid;
}

export function stageOf(eng: Engine, run: ActiveInteraction): StageDef | undefined {
  return eng.content.stagesOf(run.interactionId)[run.stage];
}

function findPathSafe(eng: Engine, from: Vec2, to: { x: number; z: number }): Vec2[] | null {
  try {
    const p = eng.spatial.findPath(from, to);
    return Array.isArray(p) ? p : null;
  } catch (e) {
    recordFault(eng, 'spatial.findPath', e);
    return null;
  }
}

export function effectContext(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef | null): EffectContext {
  const st = run.stageTarget;
  let targetObject = st && st.kind === 'object' ? eng.state.objects[st.id] ?? null : null;
  if (!targetObject && run.target.kind === 'object') targetObject = eng.state.objects[run.target.id] ?? null;
  let targetAgent = run.target.kind === 'agent' ? eng.state.agents[run.target.id] ?? null : null;
  if (!targetAgent && run.partnerId) targetAgent = eng.state.agents[run.partnerId] ?? null;
  return { actor: agent, run, def, stage: run.stage, targetAgent, targetObject };
}

/** ctx.failRun() requested a failure for this run: fail it now (returns true when the run ended). */
function failRequested(eng: Engine, agent: AgentState, run: ActiveInteraction): boolean {
  if (agent.active !== run) return true;
  const why = run.data._fail;
  if (typeof why !== 'string' || !why) return false;
  finishRun(eng, agent, 'failed', why);
  return true;
}

/** Runs a list of effects for a run; returns null, a failure reason, or ENDED when the run was ended by an effect. */
function runEffects(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef, list: EffectRef[] | undefined, phase: 's' | 'c'): string | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const prevKey = eng.effectKey;
  const prevRun = eng.currentRunUid;
  try {
    for (let i = 0; i < list.length; i++) {
      const ref = list[i];
      if (!ref || typeof ref.id !== 'string') continue;
      eng.effectKey = `run:${origUid(run)}:${run.stage}:${phase}:${i}`;
      eng.currentRunUid = run.uid;
      eng.ctx.runEffect(ref, effectContext(eng, agent, run, def));
      if (agent.active !== run) return ENDED;
      const fail = eng.pendingFail.get(run.uid);
      if (fail !== undefined) {
        eng.pendingFail.delete(run.uid);
        return fail;
      }
    }
  } finally {
    eng.effectKey = prevKey;
    eng.currentRunUid = prevRun;
  }
  return null;
}

// ─────────────────────────────── begin ───────────────────────────────

function targetValid(eng: Engine, agent: AgentState, def: InteractionDef, item: QueueItem): true | string {
  const t = item.target;
  switch (t.kind) {
    case 'object': {
      const o = eng.state.objects[t.id];
      if (!o) return "It's gone";
      if (o.placement.kind === 'held' && o.placement.agentId !== agent.id) return 'Someone else has it';
      return true;
    }
    case 'agent': {
      const a = eng.state.agents[t.id];
      if (!a) return 'They are gone';
      if (a.id === agent.id) return "Can't do that to yourself";
      if (a.presence !== 'onLot') return `${a.firstName} isn't here`;
      return true;
    }
    case 'tile': {
      // W-025 S3: a tile in another region is checked against that region's grid
      // (S4: a dormant region's tile is checked against its snapshot grid, the one the walk is planned over)
      const sp = typeof item.params._wg === 'string' ? planningSpatialOf(eng, item.params._wg) : eng.spatial;
      return sp && isNum(t.x) && isNum(t.z) && sp.inBounds(Math.floor(t.x), Math.floor(t.z)) ? true : "Can't go there";
    }
    case 'self':
      return true;
  }
}

/** Requirements + behaviour.available + social/pair target availability. Shared with menus/autonomy/dispatch. */
export function checkStartable(eng: Engine, agent: AgentState, def: InteractionDef, item: Pick<QueueItem, 'target' | 'params'>): true | string {
  const targetAgent = item.target.kind === 'agent' ? eng.state.agents[item.target.id] ?? null : null;
  const targetObject = item.target.kind === 'object' ? eng.state.objects[item.target.id] ?? null : null;
  if (Array.isArray(def.requires)) {
    for (const req of def.requires) {
      if (!req || typeof req.id !== 'string') continue;
      const r = eng.ctx.checkRequirement(req, { actor: agent, def, target: item.target, targetAgent, targetObject, params: item.params });
      if (r !== true) return r;
    }
  }
  const beh = behaviorOf(eng, def);
  if (!beh) return 'Something went wrong';
  if (beh.available) {
    const r = callHook(eng, def, 'available', () => beh.available!(eng.ctx, agent, def, item.target));
    if (r.threw) return 'Something went wrong';
    if (r.value !== true && r.value !== undefined) return typeof r.value === 'string' && r.value ? r.value : 'Not available';
  }
  return true;
}

function reportFailure(eng: Engine, agent: AgentState, item: QueueItem, def: InteractionDef | undefined, reason: string): void {
  if (item.source === 'auto') {
    agent.status.autonomyFails = Math.min(20, num(agent.status.autonomyFails, 0) + 1);
    const mins = Math.min(AUTONOMY_BACKOFF_MAX, AUTONOMY_BACKOFF_MIN * Math.pow(2, agent.status.autonomyFails - 1));
    agent.status.autonomyCooldownUntil = eng.state.tick + Math.round(mins / TICK_MINUTES);
    return;
  }
  if (item.source !== 'player') return;
  const label = def ? interactionLabel(eng, agent, def, item.target, item.params) : 'do that';
  const lower = label.length > 0 ? label[0].toLowerCase() + label.slice(1) : label;
  eng.ctx.notify({
    kind: 'bad',
    title: `${agent.firstName} couldn't ${lower}`,
    text: reason,
    agentId: agent.id,
    objectId: item.target.kind === 'object' ? item.target.id : null,
  });
  eng.ctx.emit({ type: 'interactionFailed', agentId: agent.id, reason, uid: item.uid, interactionId: item.interactionId, source: item.source });
  eng.ctx.emit({ type: 'bubble', agentId: agent.id, icon: 'question', style: 'thought', positive: false });
}

/** Dequeue until something starts (bounded). Returns true if a run is active afterwards. */
export function beginNext(eng: Engine, agent: AgentState): boolean {
  let guardN = Math.min(agent.queue.length, 16);
  while (!agent.active && agent.queue.length > 0 && guardN-- > 0 && agent.presence === 'onLot') {
    const item = agent.queue.shift()!;
    tryBegin(eng, agent, item);
  }
  return !!agent.active;
}

function tryBegin(eng: Engine, agent: AgentState, item: QueueItem): void {
  const def = eng.content.interactions[item.interactionId];
  if (!def) {
    recordFault(eng, 'begin', `unknown interaction '${String(item.interactionId)}'`);
    reportFailure(eng, agent, item, undefined, 'Something went wrong');
    return;
  }
  const stages = eng.content.stagesOf(def.id);
  if (stages.length === 0) {
    recordFault(eng, 'begin', `interaction '${def.id}' has no stages`);
    reportFailure(eng, agent, item, def, 'Something went wrong');
    return;
  }
  let ok = targetValid(eng, agent, def, item);
  if (ok === true) ok = checkStartable(eng, agent, def, item);
  if (ok === true && def.social && item.target.kind === 'agent') {
    const t = eng.state.agents[item.target.id];
    const busy = !t ? 'They are gone' : engagesTarget(eng, def) ? targetBusyReason(eng, agent, t) : null;
    if (busy) ok = busy;
    else if (t) {
      const g = socialGate(eng, agent, t, def);
      if (!g.ok) ok = g.reason;
    }
  }
  if (ok !== true) {
    reportFailure(eng, agent, item, def, ok);
    return;
  }
  const run: ActiveInteraction = {
    uid: item.uid,
    interactionId: item.interactionId,
    target: { ...item.target },
    params: { ...item.params },
    source: item.source,
    priority: item.priority,
    queuedTick: item.queuedTick,
    phase: 'route',
    stage: 0,
    stageTarget: { ...item.target },
    slot: null,
    routeGoal: null,
    pose: null,
    startedRunTick: null,
    elapsed: 0,
    duration: 0,
    partnerId: null,
    routeFails: 0,
    waitMinutes: 0,
    data: {},
    canceled: false,
  };
  const partnerRef = typeof item.params.partnerOf === 'string' ? item.params.partnerOf : typeof item.params.partnerId === 'string' && def.id === ENGINE_INTERACTIONS.respond ? item.params.partnerId : null;
  if (partnerRef && eng.state.agents[partnerRef] && partnerRef !== agent.id) run.partnerId = partnerRef;
  agent.active = run;
  agent.path = null;
  agent.pathIndex = 0;
  const beh = behaviorOf(eng, def);
  if (beh && beh.begin) {
    const r = callHook(eng, def, 'begin', () => beh.begin!(eng.ctx, agent, run, def));
    if (agent.active !== run) return;
    if (r.threw) return void finishRun(eng, agent, 'failed', 'Something went wrong');
    if (typeof r.value === 'string' && r.value) return void finishRun(eng, agent, 'failed', r.value);
    if (failRequested(eng, agent, run)) return;
  }
  enterStage(eng, agent, run, def, 0);
}

// ─────────────────────────────── stages & routing ───────────────────────────────

function releaseStage(eng: Engine, agent: AgentState, run: ActiveInteraction): void {
  if (run.stageTarget.kind === 'object') {
    const o = eng.state.objects[run.stageTarget.id];
    releaseSlot(o, run.slot, agent.id);
    removeInUse(o, agent.id);
  }
  const uo = typeof run.data._uo === 'string' ? eng.state.objects[run.data._uo] : undefined;
  if (uo) removeInUse(uo, agent.id);
  const ut = typeof run.data._ut === 'string' ? eng.state.objects[run.data._ut] : undefined;
  if (ut) removeInUse(ut, agent.id);
  run.data._ut = null;
  run.slot = null;
}

/**
 * Is the current stage placed AT the queued object target without using it as its own object (watch TV from a
 * seat facing it, dance near the stereo)? Then that object is "watched": in use, power-checked, must keep existing.
 * Stages placed relative to the actor (eat at a seat near me) don't care about the queued target any more.
 */
export function watchesTarget(run: ActiveInteraction): boolean {
  if (run.target.kind !== 'object') return false;
  if (isNum(run.data._at)) return run.data._at === 1;
  return run.data._rk === 'seat' || run.data._rk === 'tileNear'; // runs saved before `_at` existed
}

/** Object whose power/broken state matters for the current stage (the watched TV, else the used object). */
function powerObject(eng: Engine, run: ActiveInteraction) {
  if (typeof run.data._ut === 'string' && eng.state.objects[run.data._ut]) return eng.state.objects[run.data._ut];
  if (typeof run.data._uo === 'string') return eng.state.objects[run.data._uo];
  return run.stageTarget.kind === 'object' ? eng.state.objects[run.stageTarget.id] : undefined;
}

/** Shared object for joinable group bonus: the queued target when the stage happens near/facing it. */
function sharedObjectId(run: ActiveInteraction): string | null {
  if (typeof run.data._ut === 'string') return run.data._ut;
  return typeof run.data._uo === 'string' ? run.data._uo : null;
}

function stopLoop(eng: Engine, agent: AgentState, run: ActiveInteraction): void {
  if (run.data._loop) {
    eng.ctx.emit({ type: 'sfxLoop', id: run.data._loop as never, key: `run:${run.uid}`, on: false, agentId: agent.id });
    run.data._loop = null;
  }
}

/** Leave a seat/bed: snap back to the approach tile (or nearest walkable). */
export function standUp(eng: Engine, agent: AgentState, run: ActiveInteraction | null): void {
  if (agent.presence !== 'onLot') return;
  let blocked = false;
  try {
    const t = eng.spatial.tileOf(agent.pos);
    blocked = !eng.spatial.inBounds(t.x, t.z) || !eng.spatial.isWalkable(t.x, t.z);
  } catch {
    blocked = true;
  }
  if (!blocked && agent.posY <= 0.01) return;
  let p: Vec2 | null = null;
  const g = run ? run.routeGoal : null;
  if (blocked && g && eng.spatial.inBounds(g.x, g.z) && eng.spatial.isWalkable(g.x, g.z)) p = tileCenter(g);
  if (blocked && !p) {
    try {
      const w = eng.spatial.nearestWalkable(agent.pos, 8);
      if (w) p = tileCenter(w);
    } catch (e) {
      recordFault(eng, 'spatial.nearestWalkable', e);
    }
  }
  if (p) agent.pos = p;
  agent.posY = 0;
}

function applyResolution(eng: Engine, agent: AgentState, run: ActiveInteraction, res: Extract<Resolution, { ok: true }>): void {
  run.stageTarget = res.target;
  run.slot = res.slot;
  run.routeGoal = res.goal ? { x: res.goal.x, z: res.goal.z } : null;
  run.pose = res.pose ? { ...res.pose } : null;
  run.data._uo = res.objectId;
  run.data._rk = res.kind;
  run.data._ut = null;
  run.data._adj = res.kind === 'agentAdjacent' || (res.kind === 'target' && res.target.kind === 'agent') ? 1 : 0;
  run.data._at = res.aboutTarget ? 1 : 0;
  if (res.face) {
    run.data._fx = res.face.x;
    run.data._fz = res.face.z;
  } else {
    run.data._fx = null;
    run.data._fz = null;
  }
  if (res.objectId) {
    const o = eng.state.objects[res.objectId];
    if (o) {
      run.data._on = objectName(eng, o);
      if (res.slot !== null) reserveSlot(o, res.slot, agent.id);
    }
  }
  if (run.data._adj === 1 && run.target.kind === 'agent') {
    const t = eng.state.agents[run.target.id];
    // W-025 S3: the partner walked into another region; positions are not comparable across grids
    if (t && agentRegion(eng, t) !== agentRegion(eng, agent)) return void finishRun(eng, agent, 'failed', `${t.firstName} wandered off`);
    if (t) {
      run.data._tx = t.pos.x;
      run.data._tz = t.pos.z;
    }
  }
}

function resolveWithFallback(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef, st: StageDef): Resolution {
  // W-025 S3: a run whose target is in another region walks a route leg (to the next portal) first
  const leg = worldLeg(eng, agent, run);
  if (leg) return leg;
  const res = resolveStage(eng, agent, run, def, st, st.target);
  if (res.ok || !st.fallback) return res;
  const fb = resolveStage(eng, agent, run, def, st, st.fallback);
  if (fb.ok) return fb;
  // The primary's reason is reported; either side being merely busy makes the stage worth waiting for.
  return fb.busy && !res.busy ? { ok: false, reason: res.reason, busy: true } : res;
}

/** Bind the resolved stage target (+ the pair partner for stage 0) and start walking. */
function proceedStage(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef, res: Extract<Resolution, { ok: true }>): void {
  applyResolution(eng, agent, run, res);
  if (run.stage === 0 && def.pair && !run.data._pq) {
    const r = preparePair(eng, agent, run, def);
    if (agent.active !== run) return;
    if (r !== true) return void finishRun(eng, agent, 'failed', r);
  }
  startRoute(eng, agent, run, def);
}

/**
 * May this run wait for a busy `nearestTag` object (backlog #5)? Socials and pair halves keep their own 'wait'
 * semantics (engage / start together), so they never enter the tag wait.
 */
function canTagWait(run: ActiveInteraction, def: InteractionDef): boolean {
  return !def.social && typeof run.params.partnerOf !== 'string' && def.id !== ENGINE_INTERACTIONS.respond;
}

/**
 * Tag wait: stand where we are (phase 'wait', `_tw` = 1) bound to NO object — removing or selling one of the busy
 * candidates never fails the waiting run, the next re-check simply sees what is left.
 */
function beginTagWait(eng: Engine, agent: AgentState, run: ActiveInteraction, reason: string): void {
  releaseStage(eng, agent, run);
  run.phase = 'wait';
  run.waitMinutes = 0;
  run.stageTarget = { kind: 'self' };
  run.slot = null;
  run.routeGoal = null;
  run.pose = null;
  for (const k of ['_uo', '_ut', '_rk', '_at', '_adj', '_fx', '_fz', '_on', '_tx', '_tz']) run.data[k] = null;
  run.data._tw = 1;
  run.data._twr = reason;
  agent.path = null;
  agent.pathIndex = 0;
  agent.anim = 'idle';
  eng.ctx.emit({ type: 'bubble', agentId: agent.id, icon: 'clock', style: 'thought' });
}

/** Tag-wait driver: re-resolve once per game minute; route as soon as a slot frees, fail on timeout / hard failure. */
function tickTagWait(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef, dt: number): void {
  agent.anim = 'idle';
  const step = (m: number) => Math.floor(m / TAG_WAIT_RECHECK_MIN + 1e-9);
  const timedOut = run.waitMinutes >= TAG_WAIT_MAX_MIN - 1e-9;
  if (!timedOut && step(run.waitMinutes) === step(run.waitMinutes - dt)) return;
  const st = stageOf(eng, run);
  if (!st) return void finishRun(eng, agent, 'failed', 'Something went wrong');
  const res = resolveWithFallback(eng, agent, run, def, st);
  if (!res.ok) {
    if (!res.busy || timedOut) return void finishRun(eng, agent, 'failed', res.reason);
    run.data._twr = res.reason;
    return;
  }
  run.data._tw = null;
  run.data._twr = null;
  run.phase = 'route';
  run.waitMinutes = 0;
  run.routeFails = 0;
  run.data._rs = eng.state.tick;
  run.data._rr = 0;
  proceedStage(eng, agent, run, def, res);
}

function enterStage(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef, idx: number): void {
  const st = eng.content.stagesOf(def.id)[idx];
  if (!st) return void finishRun(eng, agent, 'failed', 'Something went wrong');
  releaseStage(eng, agent, run);
  run.stage = idx;
  run.phase = 'route';
  run.elapsed = 0;
  run.duration = isNum(st.duration) && st.duration >= 0 ? st.duration : 0;
  run.pose = null;
  run.routeGoal = null;
  run.waitMinutes = 0;
  run.startedRunTick = null;
  run.routeFails = 0;
  run.data._rs = eng.state.tick;
  run.data._rr = 0;
  const res = resolveWithFallback(eng, agent, run, def, st);
  if (!res.ok) {
    if (res.busy && canTagWait(run, def)) return void beginTagWait(eng, agent, run, res.reason);
    return void finishRun(eng, agent, 'failed', res.reason);
  }
  proceedStage(eng, agent, run, def, res);
}

function setPath(eng: Engine, agent: AgentState, run: ActiveInteraction, path: Vec2[]): void {
  agent.path = path.filter((p) => p && isNum(p.x) && isNum(p.z)).map((p) => ({ x: p.x, z: p.z }));
  agent.pathIndex = 0;
  let len = 0;
  let prev = agent.pos;
  for (const p of agent.path) {
    len += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  const speed = Math.max(0.05, agentSpeed(eng, agent));
  const sofar = (eng.state.tick - num(run.data._rs, eng.state.tick)) * TICK_MINUTES;
  run.data._re = sofar / ROUTE_TIME_FACTOR + len / speed;
  run.data._v = scopeLot(eng).version;
  run.data._blk = null;
  run.phase = 'route';
}

function startRoute(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  const goal = run.routeGoal;
  if (!goal) return void arrive(eng, agent, run, def);
  const here = eng.spatial.tileOf(agent.pos);
  if (here.x === goal.x && here.z === goal.z && run.data._xp !== 1) return void arrive(eng, agent, run, def);
  const path = legPath(eng, agent, run, findPathSafe(eng, agent.pos, goal));
  if (!path || path.length === 0) {
    run.routeFails++;
    if (run.routeFails >= ROUTE_MAX_FAILS) return void finishRun(eng, agent, 'failed', "Can't get there");
    agent.path = null;
    run.data._v = -1; // force a re-resolve next tick
    return;
  }
  setPath(eng, agent, run, path);
}

/** Re-pick the stage target (another slot/tile) and route again (also: W-025 S3 re-plan after a region crossing). */
export function reResolve(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  const st = stageOf(eng, run);
  if (!st) return void finishRun(eng, agent, 'failed', 'Something went wrong');
  releaseStage(eng, agent, run);
  const res = resolveWithFallback(eng, agent, run, def, st);
  if (!res.ok) {
    run.routeFails++;
    if (run.routeFails >= ROUTE_MAX_FAILS) return void finishRun(eng, agent, 'failed', res.reason);
    run.data._v = -1;
    return;
  }
  applyResolution(eng, agent, run, res);
  startRoute(eng, agent, run, def);
}

/** Social target moved: route again (max reroutes). Returns false if the run ended. */
export function reroute(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef, maxReroutes: number): boolean {
  run.data._rr = num(run.data._rr, 0) + 1;
  if (num(run.data._rr, 0) > maxReroutes) {
    finishRun(eng, agent, 'failed', `${partnerName(eng, run)} wandered off`);
    return false;
  }
  reResolve(eng, agent, run, def);
  return agent.active === run;
}

function remainingPath(agent: AgentState): number {
  const path = agent.path;
  if (!path) return 0;
  let len = 0;
  let prev = agent.pos;
  for (let i = agent.pathIndex; i < path.length; i++) {
    len += Math.hypot(path[i].x - prev.x, path[i].z - prev.z);
    prev = path[i];
  }
  return len;
}

/** Stop where we are (facing the target) and go to the wait/engage step. */
function arriveHere(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef, target: AgentState): void {
  const facing = dirToFacing(target.pos.x - agent.pos.x, target.pos.z - agent.pos.z);
  run.pose = { x: agent.pos.x, z: agent.pos.z, y: 0, facing };
  const t = eng.spatial.tileOf(agent.pos);
  run.routeGoal = { x: t.x, z: t.z };
  arrive(eng, agent, run, def);
}

function tickRoute(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  if (run.data._adj === 1 && run.target.kind === 'agent') {
    const t = eng.state.agents[run.target.id];
    if (t) {
      if (closeEnoughToTalk(eng, agent, t) || approachingMe(eng, agent, t)) return void arriveHere(eng, agent, run, def, t);
      const moved = Math.hypot(t.pos.x - num(run.data._tx, t.pos.x), t.pos.z - num(run.data._tz, t.pos.z));
      if ((moved > 1.5 && remainingPath(agent) <= 3) || moved > 6) {
        if (!reroute(eng, agent, run, def, SOCIAL_MAX_REROUTES)) return;
      }
    }
  }
  if (run.data._v !== scopeLot(eng).version || run.data._blk) {
    const goal = run.routeGoal;
    const path = goal && run.data._v !== -1 ? legPath(eng, agent, run, findPathSafe(eng, agent.pos, goal)) : null;
    if (path && path.length > 0) setPath(eng, agent, run, path);
    else {
      run.routeFails++;
      if (run.routeFails >= ROUTE_MAX_FAILS) return void finishRun(eng, agent, 'failed', "Can't get there");
      reResolve(eng, agent, run, def);
      if (agent.active !== run) return;
    }
  }
  if (run.phase !== 'route') return;
  const elapsed = (eng.state.tick - num(run.data._rs, eng.state.tick)) * TICK_MINUTES;
  if (elapsed > ROUTE_TIME_FACTOR * num(run.data._re, 1) + ROUTE_TIME_SLACK_MIN) return void finishRun(eng, agent, 'failed', "Can't get there");
  if (!agent.path && run.routeGoal) startRoute(eng, agent, run, def);
}

function needsWait(run: ActiveInteraction, def: InteractionDef): boolean {
  if (def.social && run.data._adj === 1 && run.target.kind === 'agent') return true;
  if (run.stage === 0 && (def.pair || typeof run.params.partnerOf === 'string') && run.partnerId) return true;
  return false;
}

export function arrive(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  agent.path = null;
  agent.pathIndex = 0;
  if (run.pose) {
    agent.pos = { x: run.pose.x, z: run.pose.z };
    agent.posY = isNum(run.pose.y) ? run.pose.y : 0;
    if (isNum(run.pose.facing)) agent.facing = run.pose.facing;
  } else if (isNum(run.data._fx) && isNum(run.data._fz)) {
    const dx = run.data._fx - agent.pos.x;
    const dz = run.data._fz - agent.pos.z;
    if (Math.abs(dx) + Math.abs(dz) > 1e-6) agent.facing = dirToFacing(dx, dz);
  }
  if (needsWait(run, def)) {
    run.phase = 'wait';
    run.waitMinutes = 0;
    agent.anim = 'idle';
    engageOrWait(eng, agent, run, def);
    return;
  }
  startRunPhase(eng, agent, run, def);
}

// ─────────────────────────────── run phase ───────────────────────────────

export function startRunPhase(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  const st = stageOf(eng, run);
  if (!st) return void finishRun(eng, agent, 'failed', 'Something went wrong');
  run.phase = 'run';
  run.elapsed = 0;
  run.startedRunTick = eng.state.tick;
  run.duration = isNum(st.duration) && st.duration >= 0 ? st.duration : 0;
  if (!run.data._c) {
    const cost = isNum(def.cost) ? Math.round(def.cost) : 0;
    if (cost > 0 && !run.params._costPaid) {
      if (!eng.ctx.spend(cost, def.label, `cost:${origUid(run)}`, { autonomous: run.source === 'auto' })) return void finishRun(eng, agent, 'failed', "Can't afford");
    }
    run.data._c = 1;
  }
  const obj = typeof run.data._uo === 'string' ? eng.state.objects[run.data._uo] : undefined;
  if (watchesTarget(run) && run.target.kind === 'object') {
    const tgt = eng.state.objects[run.target.id];
    if (tgt && tgt.id !== run.data._uo && tgt.placement.kind !== 'held') run.data._ut = tgt.id;
  }
  const pr = stagePowerReason(eng, st, powerObject(eng, run) ?? null);
  if (pr) return void finishRun(eng, agent, 'failed', pr);
  if (obj) addInUse(obj, agent.id);
  if (typeof run.data._ut === 'string' && eng.state.objects[run.data._ut]) addInUse(eng.state.objects[run.data._ut], agent.id);
  agent.anim = st.anim ?? 'idle';
  agent.expression = st.expression ?? 'neutral';
  if (st.carry !== undefined) agent.carrying = st.carry;
  if (st.bubble) eng.ctx.emit({ type: 'bubble', agentId: agent.id, icon: st.bubble, style: 'thought' });
  if (st.voice) eng.ctx.emit({ type: 'voice', agentId: agent.id, emotion: st.voice, durationMs: 1200 });
  if (st.sfxStart) eng.ctx.emit({ type: 'sfx', id: st.sfxStart, agentId: agent.id, pos: { x: agent.pos.x, z: agent.pos.z } });
  if (st.sfxLoop) {
    run.data._loop = st.sfxLoop;
    eng.ctx.emit({ type: 'sfxLoop', id: st.sfxLoop, key: `run:${run.uid}`, on: true, agentId: agent.id, pos: { x: agent.pos.x, z: agent.pos.z } });
  }
  if (st.stopWhen && isNeedId(st.stopWhen.need)) run.data._sv = num(agent.needs[st.stopWhen.need], 0);
  const r = runEffects(eng, agent, run, def, st.effectsOnStart, 's');
  if (r === ENDED) return;
  if (r) return void finishRun(eng, agent, 'failed', r);
  const beh = behaviorOf(eng, def);
  if (beh && beh.startStage) {
    const res = callHook(eng, def, 'startStage', () => beh.startStage!(eng.ctx, agent, run, def, run.stage));
    if (agent.active !== run) return;
    if (res.threw) return void finishRun(eng, agent, 'failed', 'Something went wrong');
    if (typeof res.value === 'string' && res.value) return void finishRun(eng, agent, 'failed', res.value);
    if (failRequested(eng, agent, run)) return;
  }
  if (run.duration <= 0) completeStage(eng, agent, run, def);
}

function tickRun(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef, dt: number): void {
  if (run.startedRunTick === eng.state.tick) return; // started this tick
  const st = stageOf(eng, run);
  if (!st) return void finishRun(eng, agent, 'failed', 'Something went wrong');
  const obj = typeof run.data._uo === 'string' ? eng.state.objects[run.data._uo] : undefined;
  const od = obj ? tryObjectDef(eng, obj) : null;
  const hours = dt / 60;
  if (st.needsPerHour) {
    for (const need in st.needsPerHour) {
      const rate = st.needsPerHour[need as keyof typeof st.needsPerHour];
      if (!isNeedId(need) || !isNum(rate) || rate === 0) continue;
      let scale = 1;
      const key = st.scaleByObjectParam ? st.scaleByObjectParam[need] : undefined;
      if (key && od) {
        const v = od.params[key];
        if (isNum(v)) scale = v;
      }
      changeNeed(eng, agent, need, rate * scale * hours);
    }
  }
  const shared = def.joinable ? sharedObjectId(run) : null;
  const sharedObj = shared ? eng.state.objects[shared] : undefined;
  if (sharedObj) {
    let others = 0;
    for (const id of sharedObj.inUseBy) {
      if (id === agent.id) continue;
      const o = eng.state.agents[id];
      if (o && o.active && o.active.interactionId === def.id && o.active.phase === 'run' && sharedObjectId(o.active) === shared) others++;
    }
    if (others > 0) {
      const n = Math.min(GROUP_MAX_OTHERS, others);
      changeNeed(eng, agent, 'social', GROUP_SOCIAL_PER_HOUR * n * hours);
      changeNeed(eng, agent, 'fun', GROUP_FUN_PER_HOUR * n * hours);
    }
  }
  if (st.skillXpPerHour) {
    for (const skill in st.skillXpPerHour) {
      const rate = st.skillXpPerHour[skill as keyof typeof st.skillXpPerHour];
      if (isSkillId(skill) && isNum(rate) && rate > 0) addXp(eng, agent, skill, rate * hours);
    }
  }
  const beh = behaviorOf(eng, def);
  if (beh && beh.tick) {
    const res = callHook(eng, def, 'tick', () => beh.tick!(eng.ctx, agent, run, def, dt));
    if (agent.active !== run) return;
    if (res.threw) return void finishRun(eng, agent, 'failed', 'Something went wrong');
    if (failRequested(eng, agent, run)) return;
    if (res.value === 'done') return void completeStage(eng, agent, run, def);
  }
  if (st.stopWhen && isNeedId(st.stopWhen.need)) {
    const need = st.stopWhen.need;
    const thr = Math.min(num(st.stopWhen.atLeast, 100), needCap(agent, need));
    if (num(agent.needs[need], 0) >= thr - 1e-9) return void completeStage(eng, agent, run, def);
  }
  run.elapsed += dt;
  if (run.elapsed >= run.duration - 1e-9) return void completeStage(eng, agent, run, def);
  if (run.duration >= OPEN_ENDED_DURATION && run.elapsed >= OPEN_ENDED_SAFETY_MIN) completeStage(eng, agent, run, def);
}

function completeStage(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  const st = stageOf(eng, run);
  if (!st) return void finishRun(eng, agent, 'failed', 'Something went wrong');
  const r = runEffects(eng, agent, run, def, st.effectsOnComplete, 'c');
  if (r === ENDED) return;
  if (r) return void finishRun(eng, agent, 'failed', r);
  const beh = behaviorOf(eng, def);
  if (beh && beh.completeStage) {
    const res = callHook(eng, def, 'completeStage', () => beh.completeStage!(eng.ctx, agent, run, def, run.stage));
    if (agent.active !== run) return;
    if (res.threw) return void finishRun(eng, agent, 'failed', 'Something went wrong');
    if (failRequested(eng, agent, run)) return;
  }
  const stages = eng.content.stagesOf(def.id);
  const next = run.stage + 1;
  if (next < stages.length) {
    stopLoop(eng, agent, run);
    releaseStage(eng, agent, run);
    standUp(eng, agent, run);
    enterStage(eng, agent, run, def, next);
    return;
  }
  finishRun(eng, agent, 'complete');
}

// ─────────────────────────────── cancel / finish ───────────────────────────────

/** Graceful cancel: route/wait end now; run gets a short exit phase. */
export function requestCancel(eng: Engine, agent: AgentState, reason: string): void {
  const run = agent.active;
  if (!run) return;
  run.canceled = true;
  if (run.phase === 'exit') return;
  if (run.phase === 'run') {
    stopLoop(eng, agent, run);
    run.phase = 'exit';
    run.elapsed = 0;
    run.duration = EXIT_PHASE_MIN;
    run.data._why = reason;
    agent.anim = 'idle';
    return;
  }
  finishRun(eng, agent, 'canceled', reason);
}

/** 'interactionCompleted' event (contracts.ts) — observed by the quests system; carries public scalars only. */
function emitCompleted(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  const params: Record<string, string | number | boolean> = {};
  const copy = (src: unknown) => {
    if (!src || typeof src !== 'object') return;
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (k.startsWith('_') || k === '__proto__') continue;
      if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) params[k] = v;
    }
  };
  copy(run.params);
  copy(run.data);
  const t = run.target;
  eng.ctx.emit({
    type: 'interactionCompleted',
    uid: run.uid,
    agentId: agent.id,
    interactionId: def.id,
    targetId: t && (t.kind === 'object' || t.kind === 'agent') && typeof t.id === 'string' ? t.id : null,
    source: run.source,
    household: isHouseholdAgent(eng, agent),
    params,
  });
}

export function finishRun(eng: Engine, agent: AgentState, outcome: Outcome, reason?: string, opts: FinishOpts = {}): void {
  const run = agent.active;
  if (!run || eng.finishing.has(run.uid)) return;
  eng.finishing.add(run.uid);
  // A run that is already walking out of a cancel (exit phase) ends as canceled whatever stops it during that minute:
  // the player chose to stop it, so it is never reported as a failure.
  if (outcome === 'failed' && run.phase === 'exit') outcome = 'canceled';
  const def = eng.content.interactions[run.interactionId];
  let endCalled = false;
  const callEnd = () => {
    if (endCalled || !def) return;
    endCalled = true;
    const beh = behaviorOf(eng, def);
    if (beh && beh.end) callHook(eng, def, 'end', () => beh.end!(eng.ctx, agent, run, def, outcome));
  };
  // Cleanup steps are individually guarded so a corrupted object/agent field can never skip behaviour.end().
  const guarded = (where: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      recordFault(eng, `finish:${agent.id}.${where}`, e);
    }
  };
  try {
    guarded('sfx', () => stopLoop(eng, agent, run));
    guarded('release', () => releaseStage(eng, agent, run));
    // sweep any stray reservation this agent still holds (robustness)
    guarded('sweep', () => releaseAllFor(eng, agent.id));
    guarded('standUp', () => standUp(eng, agent, run));
    agent.path = null;
    agent.pathIndex = 0;
    if (outcome === 'complete' && def && Array.isArray(def.moodletsOnComplete)) {
      guarded('moodlets', () => {
        const ta = run.target.kind === 'agent' ? eng.state.agents[run.target.id] : run.partnerId ? eng.state.agents[run.partnerId] : undefined;
        for (const g of def.moodletsOnComplete!) {
          if (!g || typeof g.id !== 'string') continue;
          if (isNum(g.chance) && g.chance < 1 && !eng.rng.chance(g.chance)) continue;
          const to = g.to ?? 'actor';
          const src = run.target.kind === 'object' || run.target.kind === 'agent' ? run.target.id : null;
          if (to === 'actor' || to === 'both') addMoodlet(eng, agent, g.id, { sourceId: src });
          if ((to === 'target' || to === 'both') && ta) addMoodlet(eng, ta, g.id, { sourceId: agent.id });
        }
      });
    }
    callEnd();
    if (outcome === 'complete') guarded('repetition', () => recordCompletion(eng, agent, def));
    if (outcome === 'complete' && def) guarded('completedEvent', () => emitCompleted(eng, agent, run, def));
    if (agent.active === run) agent.active = null;
    if (!agent.active) {
      agent.anim = 'idle';
      agent.expression = 'neutral';
      if (!agent.carryObjectId) agent.carrying = null;
      agent.posY = 0;
    }
    if (outcome === 'complete' && run.source === 'auto') agent.status.autonomyFails = 0;
    // partner: either ending ends both
    if (run.partnerId) {
      const p = eng.state.agents[run.partnerId];
      if (p && p.active && p.active.partnerId === agent.id && !eng.finishing.has(p.active.uid)) {
        const setupFailed = outcome === 'failed' && (run.phase === 'route' || run.phase === 'wait');
        const po: Outcome = opts.partnerOutcome ?? (outcome === 'complete' ? 'complete' : setupFailed ? 'failed' : 'canceled');
        const prsn = opts.partnerReason ?? (outcome === 'complete' ? undefined : setupFailed ? `${agent.firstName} couldn't join` : `${agent.firstName} stopped`);
        finishRun(eng, p, po, prsn, { silent: po !== 'failed' });
      }
    }
    if (outcome === 'failed' && !opts.silent) reportFailure(eng, agent, run, def, reason ?? 'Something went wrong');
    else if (outcome === 'failed' && run.source === 'auto') reportFailure(eng, agent, run, def, reason ?? '');
  } catch (e) {
    recordFault(eng, `finish:${agent.id}`, e);
    guarded('end', callEnd); // "end is called exactly once" holds on this path too
    if (agent.active === run) agent.active = null;
    guarded('releaseAll', () => releaseAllFor(eng, agent.id));
  } finally {
    eng.finishing.delete(run.uid);
    eng.pendingFail.delete(run.uid);
  }
}

/** removeObject / holdItem hook: fail runs whose current stage uses the object (not the run removing it). */
export function failRunsUsingObject(eng: Engine, objectId: string, reason: string, exceptAgentId: string | null = null): void {
  // id order: behaviour end() hooks may roll the RNG, so the order must not depend on JSON key order (decision #9)
  for (const a of allSorted(eng)) {
    const run = a.active;
    if (!run || run.uid === eng.currentRunUid || a.id === exceptAgentId) continue;
    const near = watchesTarget(run) && run.target.kind === 'object' && run.target.id === objectId;
    const uses = (run.stageTarget.kind === 'object' && run.stageTarget.id === objectId) || run.data._uo === objectId || run.data._ut === objectId || near;
    if (uses) finishRun(eng, a, 'failed', reason);
  }
}

/** Abort after a fault in the agent update (always succeeds, never throws). */
export function abortRun(eng: Engine, agent: AgentState): void {
  try {
    if (!agent || !agent.active) return;
    try {
      finishRun(eng, agent, 'failed', 'Something went wrong');
    } catch (e) {
      recordFault(eng, `abort:${agent.id}`, e);
    }
    if (agent.active && !eng.finishing.has(agent.active.uid)) agent.active = null;
    releaseAllFor(eng, agent.id);
  } catch (e) {
    recordFault(eng, 'abort', e);
  }
}

// ─────────────────────────────── per-tick driver ───────────────────────────────

function validateRun(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef | undefined): def is InteractionDef {
  if (!def) {
    recordFault(eng, 'run', `unknown interaction '${run.interactionId}'`);
    finishRun(eng, agent, 'failed', 'Something went wrong');
    return false;
  }
  if (run.stageTarget.kind === 'object') {
    const o = eng.state.objects[run.stageTarget.id];
    if (!o) {
      finishRun(eng, agent, 'failed', `The ${typeof run.data._on === 'string' ? run.data._on.toLowerCase() : 'object'} is gone`);
      return false;
    }
    if (o.placement.kind === 'held' && o.placement.agentId !== agent.id) {
      finishRun(eng, agent, 'failed', 'Someone else took it');
      return false;
    }
  }
  if (typeof run.data._uo === 'string' && !eng.state.objects[run.data._uo]) {
    finishRun(eng, agent, 'failed', `The ${String(run.data._on ?? 'object').toLowerCase()} is gone`);
    return false;
  }
  if (watchesTarget(run) && run.target.kind === 'object' && !eng.state.objects[run.target.id]) {
    finishRun(eng, agent, 'failed', "It's gone");
    return false;
  }
  if (run.target.kind === 'agent' && def.id !== ENGINE_INTERACTIONS.respond) {
    const t = eng.state.agents[run.target.id];
    if (!t || t.presence !== 'onLot') {
      finishRun(eng, agent, 'failed', `${t ? t.firstName : 'They'} left`);
      return false;
    }
  }
  if (run.partnerId && def.id !== ENGINE_INTERACTIONS.respond && (run.phase === 'run' || run.phase === 'wait')) {
    const p = eng.state.agents[run.partnerId];
    const linked = !!(p && p.presence === 'onLot' && p.active && p.active.partnerId === agent.id);
    if (!linked) {
      finishRun(eng, agent, 'failed', `${p ? p.firstName : 'They'} stopped`, { silent: run.phase === 'run' });
      return false;
    }
  }
  return true;
}

/** One state-machine step for an on-lot agent (movement + arrival handled by the caller). */
export function tickInteraction(eng: Engine, agent: AgentState, dt: number): void {
  if (!agent.active) beginNext(eng, agent);
  const run = agent.active;
  if (!run) return;
  const def = eng.content.interactions[run.interactionId];
  if (!validateRun(eng, agent, run, def)) return;
  if (failRequested(eng, agent, run)) return;
  switch (run.phase) {
    case 'route':
      tickRoute(eng, agent, run, def);
      break;
    case 'wait':
      run.waitMinutes += dt;
      if (run.data._tw === 1) {
        tickTagWait(eng, agent, run, def, dt);
        break;
      }
      if (run.waitMinutes > WAIT_TIMEOUT_MIN) {
        finishRun(eng, agent, 'failed', `${partnerName(eng, run)} didn't respond`);
        break;
      }
      engageOrWait(eng, agent, run, def);
      break;
    case 'run':
      tickRun(eng, agent, run, def, dt);
      break;
    case 'exit':
      run.elapsed += dt;
      agent.anim = 'idle';
      if (run.elapsed >= run.duration - 1e-9) finishRun(eng, agent, 'canceled', typeof run.data._why === 'string' ? run.data._why : 'Canceled');
      break;
    default:
      finishRun(eng, agent, 'failed', 'Something went wrong');
  }
}

/** Hourly / power-cut check of running stages. */
export function powerCheck(eng: Engine, agent: AgentState): void {
  const run = agent.active;
  if (!run || run.phase !== 'run') return;
  const st = stageOf(eng, run);
  if (!st) return;
  const pr = stagePowerReason(eng, st, powerObject(eng, run) ?? null);
  if (pr) finishRun(eng, agent, 'failed', pr);
}

/** Preemption: a higher-priority queue head suspends/cancels an interruptible active run. */
export function preempt(eng: Engine, agent: AgentState): void {
  const run = agent.active;
  const head = agent.queue[0];
  if (!run || !head || head.priority <= run.priority || run.phase === 'exit') return;
  const def = eng.content.interactions[run.interactionId];
  if (def && def.interruptible === false && run.phase === 'run') return;
  // Owner report: "the zombie moves the item and then it reappears". A zombie carrying the very item its run is about
  // (a dirty dish on its way to the sink) used to drop it where it stood for any higher-priority need, so the dish
  // popped back onto the floor and the clean was redone later. Finish what you are carrying first; only a critical
  // item (pass out, feral, fire) may interrupt. The player's own Cancel is a different path and still works.
  if (head.priority < PRIORITY.critical && run.target.kind === 'object' && agent.carryObjectId === run.target.id) return;
  if (run.source !== 'auto') requeueCopy(eng, agent, run);
  requestCancel(eng, agent, 'Interrupted');
}

export { ENDED };
