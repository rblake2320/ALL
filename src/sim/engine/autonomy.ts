/** Utility-AI autonomy + critical overrides (GDD §14, README §10). */
import type { DistanceField, InteractionDef, ObjectDef } from '../contracts';
import type { AgentState, NeedId, ObjectState, TargetRef } from '../types';
import { NEED_IDS } from '../types';
import { minutesToTicks } from '../time';
import { ENGINE_INTERACTIONS, PRIORITY } from '../vocabulary';
import {
  AUTONOMY_BACKOFF_MIN,
  AUTONOMY_DISTANCE_SCALE,
  AUTONOMY_IDLE_THRESHOLD,
  AUTONOMY_IN_USE_FACTOR,
  AUTONOMY_TOP_N,
  FERAL_CLEAR_HUNGER,
  FERAL_FALLBACK_TAG,
  FERAL_HUNGER,
  FERAL_HUNGER_WEIGHT,
  LIMITED_AUTONOMY_NEED,
  OFF_AUTONOMY_ENERGY,
  PASS_OUT_ENERGY,
  TRAIT_AD_CAP,
} from './constants';
import { ENGINE_MOODLETS } from './content';
import { isHouseholdAgent, isService, isWalkBy, limbCount, onLotSorted } from './agents';
import { behaviorOf, callHook } from './behaviors';
import { guardSystem } from './faults';
import { addMoodlet, hasMoodlet, isNeedId, needCap, removeMoodlet, traitMult } from './needs';
import { objectsById, resolveSlotsSafe, slotFree, tryObjectDef, objectCenter } from './objects';
import { queueItem, suspendActive } from './queue';
import { beginNext, checkStartable } from './runner';
import { socialGate } from './socialGate';
import { engagesTarget, targetBusyReason } from './socials';
import { applyRepetition, overDailyCap, picksToday, recentCompletions, recordPick, repetitionFactors } from './repetition';
import { costAt, distanceFieldSafe, stagePowerReason } from './stages';
import type { Engine } from './types';
import { autoAllowance } from '../../shared/autoBuy';
import { isNum, num } from './util';
import { agentRegion, objectRegion } from './regions';

type Role = 'household' | 'visitor';
type Mode = 'normal' | 'limited' | 'feral' | 'energy';

interface Candidate {
  def: InteractionDef;
  target: TargetRef;
  params: Record<string, string | number | boolean>;
  obj: ObjectState | null;
  other: AgentState | null;
}

interface Scored {
  c: Candidate;
  score: number;
  inUse: boolean;
}

const D = (v: number) => ((100 - v) * (100 - v)) / 100;
/** Minimum game minutes between autonomy evaluations after an idle pick. */
const IDLE_REPLAN_MIN = 1.5;

export function autonomyRole(eng: Engine, agent: AgentState): Role | null {
  if (agent.presence !== 'onLot') return null;
  if (isHouseholdAgent(eng, agent)) return 'household';
  if (isService(agent) || isWalkBy(agent) || agent.role !== 'townie') return null;
  if (agent.visit && agent.visit.leaving) return null;
  return 'visitor';
}

/** Promised need change (explicit advertise, social def, or derived from stages); cached per def+object def. */
const adCacheByDef = new WeakMap<InteractionDef, Map<ObjectDef | null, Partial<Record<NeedId, number>>>>();

export function advertiseOf(eng: Engine, def: InteractionDef, od: ObjectDef | null): Partial<Record<NeedId, number>> {
  let byObj = adCacheByDef.get(def);
  if (!byObj) {
    byObj = new Map();
    adCacheByDef.set(def, byObj);
  }
  const hit = byObj.get(od);
  if (hit) return hit;
  const ad: Partial<Record<NeedId, number>> = {};
  const add = (need: string, v: unknown) => {
    if (isNeedId(need) && isNum(v)) ad[need] = (ad[need] ?? 0) + v;
  };
  if (def.advertise && typeof def.advertise === 'object') {
    for (const [n, v] of Object.entries(def.advertise)) add(n, v);
  } else if (def.social) {
    add('social', def.social.social);
    if (isNum(def.social.fun)) add('fun', def.social.fun);
  } else {
    for (const st of eng.content.stagesOf(def.id)) {
      const hours = isNum(st.duration) && st.duration < 1e8 ? st.duration / 60 : 8;
      if (st.needsPerHour) {
        for (const [n, rate] of Object.entries(st.needsPerHour)) {
          let scale = 1;
          const pk = st.scaleByObjectParam ? st.scaleByObjectParam[n as NeedId] : undefined;
          if (pk && od && isNum(od.params[pk])) scale = od.params[pk] as number;
          if (isNum(rate)) add(n, rate * scale * hours);
        }
      }
      for (const eff of [...(st.effectsOnStart ?? []), ...(st.effectsOnComplete ?? [])]) {
        if (!eff || eff.id !== 'needs' || !eff.params) continue;
        const who = eff.params.who;
        if (who !== undefined && who !== 'actor' && who !== 'both') continue;
        const deltas = eff.params.deltas;
        if (deltas && typeof deltas === 'object') for (const [n, v] of Object.entries(deltas as Record<string, unknown>)) add(n, v);
      }
      if (st.stopWhen && isNeedId(st.stopWhen.need) && isNum(ad[st.stopWhen.need])) {
        ad[st.stopWhen.need] = Math.min(ad[st.stopWhen.need]!, num(st.stopWhen.atLeast, 100));
      }
    }
  }
  byObj.set(od, ad);
  return ad;
}

function autonomousFor(def: InteractionDef | undefined, role: Role): def is InteractionDef {
  if (!def || def.autonomous === false) return false;
  if (def.hidden && def.autonomous !== true) return false;
  if (role === 'visitor' && def.visitorAllowed !== true) return false;
  return true;
}

const agentDefCache = new WeakMap<object, Record<Role, InteractionDef[]>>();

/** Autonomous agent-target interactions per role (cached per registry). */
function agentTargetDefs(eng: Engine, role: Role): InteractionDef[] {
  let hit = agentDefCache.get(eng.content);
  if (!hit) {
    const all = Object.values(eng.content.interactions).filter((d) => d.targetKind === 'agent');
    hit = { household: all.filter((d) => autonomousFor(d, 'household')), visitor: all.filter((d) => autonomousFor(d, 'visitor')) };
    agentDefCache.set(eng.content, hit);
  }
  return hit[role];
}

function objectIndoor(eng: Engine, obj: ObjectState): boolean {
  const c = objectCenter(eng, obj);
  const t = eng.spatial.tileOf(c);
  return eng.spatial.inBounds(t.x, t.z) && eng.spatial.isIndoor(t.x, t.z);
}

interface PickCtx {
  eng: Engine;
  agent: AgentState;
  role: Role;
  mode: Mode;
  df: DistanceField | null;
  weights: Record<NeedId, number>;
  objCost: Map<string, { cost: number; full: boolean; partial: boolean }>;
  /** Completions per interaction id in the repetition window (backlog #13). */
  recent: ReadonlyMap<string, number>;
  /** Today's picks per non-essential interaction id (daily cap, GDD §14); empty in critical modes. */
  today: ReadonlyMap<string, number>;
  /** Feral second pass: ONLY last-resort (FERAL_FALLBACK_TAG) candidates; every other pass excludes them. */
  fallback: boolean;
  /** W-116 (D-063): $ autonomy may still spend today (Infinity = Unlimited, the classic behaviour). */
  allowance: number;
}

/**
 * Known $ an autonomous pick would spend (W-116): the interaction's own `cost` plus what its behaviour buys
 * (`autoCost` hook: groceries, a pizza). Only computed while a finite allowance applies.
 */
export function autoCostOf(eng: Engine, agent: AgentState, def: InteractionDef, target: TargetRef, params: Record<string, string | number | boolean>): number {
  let cost = isNum(def.cost) && def.cost > 0 ? Math.round(def.cost) : 0;
  const beh = behaviorOf(eng, def);
  if (beh && beh.autoCost) {
    const r = callHook(eng, def, 'autoCost', () => beh.autoCost!(eng.ctx, agent, def, target, params));
    if (!r.threw && isNum(r.value) && r.value > 0) cost += Math.round(r.value);
  }
  return cost;
}

export function isFeralFallback(def: InteractionDef): boolean {
  return Array.isArray(def.tags) && def.tags.includes(FERAL_FALLBACK_TAG);
}

/** Soft cap of the summed positive trait bonuses (TRAIT_AD_CAP); vetoes (negative sums) pass through. */
export function capTraitBonus(raw: number): number {
  if (!(raw > 0)) return isNum(raw) ? raw : 0;
  return TRAIT_AD_CAP * (1 - Math.exp(-raw / TRAIT_AD_CAP));
}

function objectAccess(p: PickCtx, obj: ObjectState): { cost: number; full: boolean; partial: boolean } {
  const hit = p.objCost.get(obj.id);
  if (hit) return hit;
  const { eng, agent } = p;
  const df = p.df!;
  const slots = resolveSlotsSafe(eng, obj);
  let cost = Infinity;
  let free = 0;
  for (const s of slots) {
    const isFree = slotFree(eng, obj, s.index, agent.id);
    if (isFree) free++;
    if (!isFree) continue;
    for (const t of Array.isArray(s.approach) ? s.approach : []) {
      const c = costAt(eng, df, t.x, t.z);
      if (c < cost) cost = c;
    }
  }
  if (slots.length === 0) {
    const c = objectCenter(eng, obj);
    const t = eng.spatial.tileOf(c);
    for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1], [0, 0]] as const) cost = Math.min(cost, costAt(eng, df, t.x + dx, t.z + dz));
  }
  const res = { cost, full: slots.length > 0 && free === 0, partial: slots.length > 0 && free < slots.length };
  p.objCost.set(obj.id, res);
  return res;
}

function agentCost(p: PickCtx, other: AgentState): number {
  const t = p.eng.spatial.tileOf(other.pos);
  let best = Infinity;
  for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    best = Math.min(best, costAt(p.eng, p.df!, t.x + dx, t.z + dz));
  }
  return best;
}

/** Optimistic (never larger than the real) path cost to a candidate: straight-line distance minus reach. */
function lowerBoundCost(p: PickCtx, c: Candidate): number {
  const a = p.agent.pos;
  if (c.obj) {
    const od = tryObjectDef(p.eng, c.obj);
    const reach = (od ? Math.max(od.footprint.w, od.footprint.d) / 2 : 0.5) + 1.5;
    const ctr = objectCenter(p.eng, c.obj);
    return Math.max(0, Math.hypot(ctr.x - a.x, ctr.z - a.z) - reach);
  }
  if (c.other) return Math.max(0, Math.hypot(c.other.pos.x - a.x, c.other.pos.z - a.z) - 1.5);
  if (c.target.kind === 'tile') return Math.max(0, Math.hypot(c.target.x + 0.5 - a.x, c.target.z + 0.5 - a.z) - 1);
  return 0;
}

/** Need-based score before distance/validation (0 = not worth considering). */
function preScore(p: PickCtx, c: Candidate): number {
  const { eng, agent, mode } = p;
  const od = c.obj ? tryObjectDef(eng, c.obj) : null;
  const ad = advertiseOf(eng, c.def, od);
  if (mode === 'feral' && !(num(ad.hunger, 0) > 0)) return 0;
  if (mode === 'energy' && !(num(ad.energy, 0) > 0)) return 0;
  if (isNum(c.def.cost) && c.def.cost > eng.state.household.funds) return 0;
  if (p.allowance !== Infinity && autoCostOf(eng, agent, c.def, c.target, c.params) > p.allowance) return 0;
  if (p.today.size > 0 && overDailyCap(eng, c.def, p.today)) return 0;
  let needScore = 0;
  for (const need of NEED_IDS) {
    const a = ad[need];
    if (!isNum(a) || a === 0) continue;
    if (mode === 'feral' && need !== 'hunger') continue;
    if (mode === 'energy' && need !== 'energy') continue;
    const v = num(agent.needs[need], 50);
    if (mode === 'limited' && v >= LIMITED_AUTONOMY_NEED) continue;
    const cap = needCap(agent, need);
    needScore += p.weights[need] * (D(Math.min(v, cap)) - D(Math.max(0, Math.min(cap, v + a))));
  }
  if (mode === 'feral') return needScore * FERAL_HUNGER_WEIGHT;
  if (mode === 'energy') return needScore;
  if (mode === 'limited' && needScore <= 0) return 0;
  let bonus = 0;
  if (c.def.traitAd) for (const t of [...agent.traits, ...agent.rewardTraits]) bonus += num(c.def.traitAd[t], 0);
  if (Array.isArray(c.def.tags) && c.def.tags.length > 0) {
    for (const ids of [agent.traits, agent.rewardTraits]) {
      for (let i = 0; i < ids.length; i++) {
        const td = eng.content.traits[ids[i]];
        if (!td || !td.tagAd) continue;
        for (const tag of c.def.tags) bonus += num(td.tagAd[tag], 0);
      }
    }
  }
  const extras = num(c.def.adBonus, 0) + capTraitBonus(bonus);
  const score = needScore + extras;
  return score > 0 ? applyRepetition(needScore, extras, repetitionFactors(eng, c.def, p.recent)) : score;
}

/** Full validation (requirements, availability, social gates, power). */
function valid(p: PickCtx, c: Candidate): boolean {
  const { eng, agent } = p;
  if (c.other) {
    if (c.other.presence !== 'onLot') return false;
    if (c.def.social) {
      if (engagesTarget(eng, c.def) && targetBusyReason(eng, agent, c.other)) return false;
      if (socialGate(eng, agent, c.other, c.def).ok !== true) return false;
    }
  }
  if (c.obj) {
    const st = eng.content.stagesOf(c.def.id)[0];
    if (st && st.target && st.target.kind === 'target' && stagePowerReason(eng, st, c.obj)) return false;
  }
  return checkStartable(eng, agent, c.def, { target: c.target, params: c.params }) === true;
}

function gather(p: PickCtx): Scored[] {
  const { eng, agent, role } = p;
  const pre: { c: Candidate; s0: number }[] = [];
  const welcomed = role === 'household' || !!(agent.visit && agent.visit.welcomed);
  const here = agentRegion(eng, agent);
  const consider = (c: Candidate) => {
    if (isFeralFallback(c.def) !== p.fallback) return;
    // W-025 S3: autonomy never reaches across a region boundary (objects and partners of the agent's own region only)
    if ((c.obj && objectRegion(eng, c.obj) !== here) || (c.other && agentRegion(eng, c.other) !== here)) return;
    const s0 = preScore(p, c);
    if (s0 > 0) pre.push({ c, s0 });
  };
  for (const obj of objectsById(eng)) {
    if (obj.placement.kind === 'held' || obj.condition.burning) continue;
    const od = tryObjectDef(eng, obj);
    if (!od || od.interactions.length === 0) continue;
    if (!welcomed && objectIndoor(eng, obj)) continue;
    for (const iid of od.interactions) {
      const def = eng.content.interactions[iid];
      if (!autonomousFor(def, role) || def.targetKind !== 'object') continue;
      consider({ def, target: { kind: 'object', id: obj.id }, params: {}, obj, other: null });
    }
  }
  const agentDefs = agentTargetDefs(eng, role);
  if (agentDefs.length > 0) {
    for (const other of onLotSorted(eng)) {
      if (other.id === agent.id || isService(other)) continue;
      for (const def of agentDefs) consider({ def, target: { kind: 'agent', id: other.id }, params: {}, obj: null, other });
    }
  }
  for (const entry of eng.systems) {
    const fn = entry.sys.autonomyCandidates;
    if (!fn || entry.disabled) continue;
    guardSystem(eng, entry, 'autonomyCandidates', () => {
      const list = fn.call(entry.sys, eng.ctx, agent);
      if (!Array.isArray(list)) return;
      for (const raw of list) {
        if (!raw || typeof raw.interactionId !== 'string') continue;
        const def = eng.content.interactions[raw.interactionId];
        if (!def || (role === 'visitor' && def.visitorAllowed !== true)) continue;
        const t = raw.target as TargetRef;
        const obj = t && t.kind === 'object' ? eng.state.objects[t.id] ?? null : null;
        const other = t && t.kind === 'agent' ? eng.state.agents[t.id] ?? null : null;
        if (t && t.kind === 'object' && !obj) continue;
        if (t && t.kind === 'agent' && (!other || other.id === agent.id)) continue;
        const params: Record<string, string | number | boolean> = {};
        if (raw.params && typeof raw.params === 'object') {
          for (const [k, v] of Object.entries(raw.params)) if (typeof v === 'string' || typeof v === 'boolean' || isNum(v)) params[k] = v as string | number | boolean;
        }
        consider({ def, target: t && typeof t === 'object' ? t : { kind: 'self' }, params, obj, other });
      }
    });
  }
  if (pre.length === 0) return [];
  // Distance attenuation only shrinks scores, and a path is never shorter than the straight line: if no candidate's
  // optimistic score can beat the idle threshold, skip pathfinding entirely (the common case for content zombies).
  if (p.mode === 'normal' || p.mode === 'limited') {
    let best = 0;
    for (const x of pre) {
      const ub = x.s0 / (1 + lowerBoundCost(p, x.c) / AUTONOMY_DISTANCE_SCALE);
      if (ub > best) best = ub;
      if (best >= AUTONOMY_IDLE_THRESHOLD) break;
    }
    if (best < AUTONOMY_IDLE_THRESHOLD) return [];
  }
  p.df = distanceFieldSafe(eng, agent.pos);
  if (!p.df) return [];
  const out: Scored[] = [];
  for (const { c, s0 } of pre) {
    let cost = 0;
    let inUse = false;
    if (c.obj) {
      const acc = objectAccess(p, c.obj);
      if (acc.full || !Number.isFinite(acc.cost)) continue;
      cost = acc.cost;
      inUse = acc.partial && !c.def.joinable;
    } else if (c.other) {
      cost = agentCost(p, c.other);
      if (!Number.isFinite(cost)) continue;
    } else if (c.target.kind === 'tile') {
      cost = costAt(eng, p.df, Math.floor(c.target.x), Math.floor(c.target.z));
      if (!Number.isFinite(cost)) continue;
    }
    let sc = s0 / (1 + cost / AUTONOMY_DISTANCE_SCALE);
    if (inUse) sc *= AUTONOMY_IN_USE_FACTOR;
    out.push({ c, score: sc, inUse });
  }
  return out;
}

/**
 * Choose a candidate (weighted among the top 3 valid ones) or null. Feral: real food first; only when nothing is
 * valid, a second pass over the last-resort candidates (FERAL_FALLBACK_TAG — the feral nibble).
 */
function choose(eng: Engine, agent: AgentState, role: Role, mode: Mode): Candidate | null {
  const pick = chooseIn(eng, agent, role, mode, false);
  return pick || mode !== 'feral' ? pick : chooseIn(eng, agent, role, mode, true);
}

function chooseIn(eng: Engine, agent: AgentState, role: Role, mode: Mode, fallback: boolean): Candidate | null {
  const weights = {} as Record<NeedId, number>;
  for (const n of NEED_IDS) weights[n] = traitMult(eng, agent, `needWeight:${n}`);
  const recent = mode === 'normal' || mode === 'limited' ? recentCompletions(eng, agent) : new Map<string, number>();
  const today = mode === 'normal' || mode === 'limited' ? picksToday(eng, agent) : new Map<string, number>();
  const p: PickCtx = { eng, agent, role, mode, df: null, weights, objCost: new Map(), recent, today, fallback, allowance: autoAllowance(eng.state) };
  const scored = gather(p);
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const validated: Scored[] = [];
  for (const s of scored) {
    if (validated.length >= AUTONOMY_TOP_N * 2) break;
    if (!valid(p, s.c)) continue;
    const beh = behaviorOf(eng, s.c.def);
    if (beh && beh.adjustScore) {
      const r = callHook(eng, s.c.def, 'adjustScore', () => beh.adjustScore!(eng.ctx, agent, s.c.def, s.c.target, s.score));
      if (!r.threw && isNum(r.value)) s.score = r.value;
    }
    if (s.score > 0) validated.push(s);
  }
  if (validated.length === 0) return null;
  validated.sort((a, b) => b.score - a.score);
  const critical = mode === 'feral' || mode === 'energy';
  if (!critical && validated[0].score < AUTONOMY_IDLE_THRESHOLD) return null;
  // GDD §14: below the idle threshold nothing is worth doing — that holds inside the weighted top-3 draw too, else a
  // repetition-penalised hobby (backlog #13) would still win a share of every pick next to one good candidate.
  const top = (critical ? validated : validated.filter((s) => s.score >= AUTONOMY_IDLE_THRESHOLD)).slice(0, AUTONOMY_TOP_N);
  const i = eng.rng.weighted(top.map((s) => s.score));
  return (top[i] ?? top[0]).c;
}

function queuePick(eng: Engine, agent: AgentState, c: Candidate, priority: number, front: boolean): boolean {
  const qi = queueItem(eng, agent, { interactionId: c.def.id, target: c.target, params: c.params, source: 'auto', priority, front });
  if (!qi) return false;
  beginNext(eng, agent);
  return true;
}

function queueIdle(eng: Engine, agent: AgentState, role: Role, mode: Mode): void {
  const ids = [
    ENGINE_INTERACTIONS.idleStretch,
    ENGINE_INTERACTIONS.idleGroan,
    ENGINE_INTERACTIONS.idleWander,
    ENGINE_INTERACTIONS.idlePhone,
    ENGINE_INTERACTIONS.idleYawn,
  ];
  const energy = num(agent.needs.energy, 50);
  let w = [2, 2, 3, limbCount(agent, 'arm') >= 1 ? 1.5 : 0, energy < 50 ? 3 : 0.5];
  if (mode === 'feral') w = [0, 1, 4, 0, 0];
  if (role === 'visitor') {
    w[4] = 0.5;
    if (!(agent.visit && agent.visit.welcomed)) w[2] = 0;
  }
  const i = eng.rng.weighted(w);
  const iid = ids[i] ?? ENGINE_INTERACTIONS.idleStretch;
  const qi = queueItem(eng, agent, { interactionId: iid, target: { kind: 'self' }, source: 'auto' });
  if (qi) beginNext(eng, agent);
}

function setCooldown(eng: Engine, agent: AgentState, minutes: number): void {
  agent.status.autonomyCooldownUntil = eng.state.tick + minutesToTicks(minutes);
}

/** Free will for an idle on-lot agent. */
export function runAutonomy(eng: Engine, agent: AgentState): void {
  const role = autonomyRole(eng, agent);
  if (!role || agent.active || agent.queue.length > 0 || agent.status.passedOut) return;
  if (eng.state.tick < num(agent.status.autonomyCooldownUntil, 0)) return;
  const setting = eng.state.settings.autonomy;
  let mode: Mode = 'normal';
  if (role === 'household') {
    if (agent.status.feral) mode = 'feral';
    else if (setting === 'off') {
      if (num(agent.needs.energy, 50) <= OFF_AUTONOMY_ENERGY) mode = 'energy';
      else return;
    } else if (setting === 'limited') mode = 'limited';
  }
  const pick = choose(eng, agent, role, mode);
  const priority = mode === 'feral' || mode === 'energy' ? PRIORITY.critical : PRIORITY.auto;
  if (pick && queuePick(eng, agent, pick, priority, false)) {
    if (mode === 'normal' || mode === 'limited') recordPick(eng, agent, pick.def);
    return;
  }
  if (mode === 'energy') return setCooldown(eng, agent, AUTONOMY_BACKOFF_MIN);
  queueIdle(eng, agent, role, mode);
  // Nothing worth doing: re-plan after a short pause instead of after every tiny idle animation.
  setCooldown(eng, agent, IDLE_REPLAN_MIN);
}

function advertisesHunger(eng: Engine, agent: AgentState): boolean {
  const run = agent.active;
  if (!run) return false;
  const def = eng.content.interactions[run.interactionId];
  if (!def) return false;
  const obj = run.stageTarget.kind === 'object' ? eng.state.objects[run.stageTarget.id] : run.target.kind === 'object' ? eng.state.objects[run.target.id] : undefined;
  return num(advertiseOf(eng, def, obj ? tryObjectDef(eng, obj) : null).hunger, 0) > 0;
}

/** Feral hunger and passing out (household only; any autonomy setting). */
export function criticalOverrides(eng: Engine, agent: AgentState): void {
  if (agent.presence !== 'onLot' || !isHouseholdAgent(eng, agent)) return;
  const hunger = num(agent.needs.hunger, 50);
  const energy = num(agent.needs.energy, 50);
  const st = agent.status;
  if (!st.feral && hunger <= FERAL_HUNGER) {
    st.feral = true;
    addMoodlet(eng, agent, ENGINE_MOODLETS.feralHunger);
    eng.ctx.emit({ type: 'bubble', agentId: agent.id, icon: 'brain', style: 'shout', positive: false });
    eng.ctx.emit({ type: 'voice', agentId: agent.id, emotion: 'groan', durationMs: 1600 });
    eng.ctx.notify({ kind: 'warning', title: `${agent.firstName} has gone feral!`, text: `${agent.firstName} is starving and will hunt for food on their own.`, agentId: agent.id });
  } else if (st.feral && hunger >= FERAL_CLEAR_HUNGER) {
    st.feral = false;
    removeMoodlet(agent, ENGINE_MOODLETS.feralHunger);
  } else if (!st.feral && hasMoodlet(agent, ENGINE_MOODLETS.feralHunger)) {
    // The (indefinite) moodlet belongs to the feral state: a system that resets status.feral directly (e.g. a
    // reanimation) must not leave a permanent -10 behind.
    removeMoodlet(agent, ENGINE_MOODLETS.feralHunger);
  }
  const run = agent.active;
  if (energy <= PASS_OUT_ENERGY && !st.passedOut) {
    const def = run ? eng.content.interactions[run.interactionId] : undefined;
    const sleepish = !!(run && (run.interactionId === ENGINE_INTERACTIONS.passOut || (def && def.tags && def.tags.includes('sleep'))));
    const queued = agent.queue.some((q) => q.interactionId === ENGINE_INTERACTIONS.passOut);
    if (!sleepish && !queued) {
      if (run && def && def.interruptible === false && run.phase === 'run') return;
      if (run) suspendActive(eng, agent, 'Collapsed from exhaustion', false);
      const qi = queueItem(eng, agent, { interactionId: ENGINE_INTERACTIONS.passOut, target: { kind: 'self' }, source: 'system', priority: PRIORITY.critical, front: true });
      if (qi) beginNext(eng, agent);
      return;
    }
  }
  if (!st.feral || eng.state.tick < num(st.autonomyCooldownUntil, 0)) return;
  // A critical item is already waiting (e.g. the feral meal a social suspended): preempt() hands over to it.
  // Picking yet another one would strand the waiting copy in the queue every time it happens.
  if (agent.queue.length > 0 && agent.queue[0].priority >= PRIORITY.critical) return;
  if (run) {
    if (advertisesHunger(eng, agent) || run.priority >= PRIORITY.critical || run.phase === 'exit') return;
    const def = eng.content.interactions[run.interactionId];
    if (def && def.interruptible === false && run.phase === 'run') return;
  }
  const pick = choose(eng, agent, 'household', 'feral');
  if (!pick) return setCooldown(eng, agent, AUTONOMY_BACKOFF_MIN);
  if (run) suspendActive(eng, agent, 'Feral hunger', false);
  queuePick(eng, agent, pick, PRIORITY.critical, true);
}
