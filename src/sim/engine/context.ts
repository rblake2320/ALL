/** SimContext implementation (contracts.ts) — a thin facade over the engine modules. */
import { autoAllowance, recordAutoSpend } from '../../shared/autoBuy';
import type { ConditionRef, EffectContext, EffectRef, RequirementContext, RequirementRef, SimContext, SimEvent } from '../contracts';
import type { AgentState, ChoiceState, NotificationKind, ObjectState, Relationship } from '../types';
import { MAX_EVENTS_BUFFER, MAX_NOTIFICATIONS, MAX_TXLOG } from './constants';
import { createAgent, despawnAgent, isHouseholdAgent, isVisitorAgent, limbCount, onLotSorted, sendOffLot, spawnAgent } from './agents';
import { isIdleInteraction } from './content';
import { guardSystem, recordFault } from './faults';
import {
  addMoodlet,
  addXp,
  changeNeed,
  hasMoodlet,
  hasTrait,
  mood,
  needCap,
  removeMoodlet,
  skillLevel,
  traitMult,
} from './needs';
import { holdItem, markChanged, objectDefOf, placeItemNear, releaseHeld, removeObject, spawnObject, tryObjectDef } from './objects';
import { cancelItem, queueItem } from './queue';
import { requestCancel } from './runner';
import { buildMenu } from './menu';
import type { Engine } from './types';
import { isNum, str } from './util';
import { activeRegions, agentRegion, homeRegion, isRegionActive, lotOfRegion, scopeRegion, withRegion } from './regions';

const EMPTY_API: Record<string, (...args: any[]) => any> = Object.freeze({}) as Record<string, (...args: any[]) => any>;
const NOTIFY_KINDS = new Set<NotificationKind>(['info', 'good', 'bad', 'warning', 'money', 'career', 'social', 'decay', 'romance', 'skill']);

export function relKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function blankRelationship(a: string, b: string, tick: number): Relationship {
  const [x, y] = a < b ? [a, b] : [b, a];
  return { a: x, b: y, friendship: 0, romance: 0, met: false, partners: false, engaged: false, married: false, bestFriends: false, lastInteractionTick: tick, interactions: 0 };
}

/** Read-only relationship lookup (never creates a record). */
export function peekRel(eng: Engine, a: string, b: string): Relationship {
  return eng.state.relationships[relKey(a, b)] ?? blankRelationship(a, b, eng.state.tick);
}

function pushTx(eng: Engine, key: string | undefined): void {
  if (!key) return;
  const log = eng.state.household.txLog;
  log.push(key);
  if (log.length > MAX_TXLOG) log.splice(0, log.length - MAX_TXLOG);
}

function healFunds(eng: Engine): number {
  const h = eng.state.household;
  if (!isNum(h.funds) || h.funds < 0) h.funds = 0;
  else if (!Number.isInteger(h.funds)) h.funds = Math.floor(h.funds);
  if (!Array.isArray(h.txLog)) h.txLog = [];
  return h.funds;
}

/** W-124: queue params key that marks a household-job run (src/sim/systems/jobs). */
export const JOB_PARAM = 'jobId';

/** The run whose effects / hooks are executing right now is a household-job run. */
function spendingRunIsJob(eng: Engine): boolean {
  const isJob = (r: { params?: Record<string, unknown> } | null | undefined) => !!r && !!r.params && typeof r.params[JOB_PARAM] === 'string';
  if (eng.currentRunUid !== null && eng.currentRunUid !== undefined) {
    for (const id of eng.state.household.memberIds) {
      const a = eng.state.agents[id];
      if (a && a.active && a.active.uid === eng.currentRunUid) return isJob(a.active);
    }
  }
  const acting = eng.actingAgentId ? eng.state.agents[eng.actingAgentId] : undefined;
  return !!acting && isJob(acting.active);
}

/** Max events delivered to observers in one emit cascade (a feedback loop between observers can never hang the tick). */
const MAX_OBSERVED_CASCADE = 1024;

/**
 * SimSystem.onEvent delivery (contracts.ts): synchronous, in emit order, systems in tick order. An emit made while
 * observers run is queued behind the current event (FIFO, never recursive). Each call is behind the system barrier.
 */
function observeEvent(eng: Engine, e: SimEvent): void {
  if (eng.observing) {
    if (eng.observing.length < MAX_OBSERVED_CASCADE) eng.observing.push(e);
    return;
  }
  let any = false;
  for (const entry of eng.systems) if (typeof entry.sys.onEvent === 'function' && !entry.disabled) any = true;
  if (!any) return;
  const queue: SimEvent[] = [e];
  eng.observing = queue;
  try {
    for (let i = 0; i < queue.length; i++) {
      const ev = queue[i];
      for (const entry of eng.systems) {
        const fn = entry.sys.onEvent;
        if (typeof fn === 'function') guardSystem(eng, entry, 'onEvent', () => fn.call(entry.sys, eng.ctx, ev));
      }
    }
  } finally {
    eng.observing = null;
  }
}

export function createContext(eng: Engine): SimContext {
  const state = () => eng.state;
  const apiWrappers = new Map<string, Record<string, (...args: any[]) => any>>();
  const ctx: SimContext = {
    get state() {
      return eng.state;
    },
    get content() {
      return eng.content;
    },
    get rng() {
      return eng.rng;
    },
    get spatial() {
      return eng.spatial;
    },
    get time() {
      return eng.time;
    },
    emit(e: SimEvent) {
      if (!e || typeof e !== 'object') return;
      eng.events.push(e);
      if (eng.events.length > MAX_EVENTS_BUFFER) eng.events.splice(0, eng.events.length - MAX_EVENTS_BUFFER / 2);
      observeEvent(eng, e);
    },
    notify(n) {
      const s = state();
      const id = ctx.newUid();
      s.notifications.push({
        id,
        tick: s.tick,
        kind: NOTIFY_KINDS.has(n.kind) ? n.kind : 'info',
        title: str(n.title, 'Notice').slice(0, 140),
        text: str(n.text, '').slice(0, 400),
        agentId: typeof n.agentId === 'string' ? n.agentId : null,
        objectId: typeof n.objectId === 'string' ? n.objectId : null,
        read: false,
      });
      if (s.notifications.length > MAX_NOTIFICATIONS) s.notifications.splice(0, s.notifications.length - MAX_NOTIFICATIONS);
      ctx.emit({ type: 'notify', id });
    },
    newId(prefix) {
      const s = state();
      if (!isNum(s.nextId) || s.nextId < 1) s.nextId = 1;
      const p = prefix === 'a' ? 'a' : 'o';
      let id = `${p}${s.nextId++}`;
      // never collide, even with a corrupted counter
      while ((p === 'a' ? s.agents[id] : s.objects[id]) !== undefined) id = `${p}${s.nextId++}`;
      return id;
    },
    newUid() {
      const s = state();
      if (!isNum(s.nextId) || s.nextId < 1) s.nextId = 1;
      return s.nextId++;
    },

    agent: (id) => (typeof id === 'string' ? eng.state.agents[id] : undefined),
    object: (id) => (typeof id === 'string' ? eng.state.objects[id] : undefined),
    objectDef: (obj) => objectDefOf(eng, obj),
    householdMembers() {
      const out: AgentState[] = [];
      for (const id of eng.state.household.memberIds) {
        const a = eng.state.agents[id];
        if (a) out.push(a);
      }
      return out;
    },
    agentsOnLot() {
      return onLotSorted(eng); // id order: systems iterating it must not depend on JSON key order
    },
    regionOf(agentId) {
      const a = typeof agentId === 'string' ? eng.state.agents[agentId] : undefined;
      return a ? agentRegion(eng, a) : null;
    },
    lotOf: (regionId) => (typeof regionId === 'string' ? lotOfRegion(eng, regionId) : null),
    homeRegionId: () => homeRegion(eng),
    currentRegionId: () => scopeRegion(eng),
    activeRegionIds: () => [homeRegion(eng), ...activeRegions(eng).filter(id => id !== homeRegion(eng))],
    withRegion: (id, callback) => {
      if (!isRegionActive(eng, id)) throw new Error(`Region is not active: ${id}`);
      return withRegion(eng, id, callback);
    },
    isHousehold: (a) => !!a && isHouseholdAgent(eng, a),
    isVisitor: (a) => !!a && isVisitorAgent(a) && !isHouseholdAgent(eng, a),

    changeNeed: (agent, need, delta, opts) => changeNeed(eng, agent, need, delta, !!(opts && opts.raw)),
    needCap: (agent, need) => needCap(agent, need),
    addMoodlet: (agent, id, opts) => addMoodlet(eng, agent, id, opts),
    removeMoodlet: (agent, id) => removeMoodlet(agent, id),
    hasMoodlet: (agent, id) => hasMoodlet(agent, id),
    addXp: (agent, skill, xp) => addXp(eng, agent, skill, xp),
    skillLevel: (agent, skill) => skillLevel(agent, skill),
    mood: (agent) => mood(eng, agent),
    hasTrait: (agent, t) => hasTrait(agent, t),
    traitMult: (agent, key) => traitMult(eng, agent, key),
    limbCount: (agent, kind) => limbCount(agent, kind),

    spend(amount, reason, key, opts) {
      const funds = healFunds(eng);
      if (!isNum(amount) || amount < 0) return false;
      const amt = Math.round(amount);
      if (key && eng.state.household.txLog.includes(key)) return true;
      if (amt === 0) return true;
      // W-124 (D-071): household jobs never spend money — whatever a job run's effects or behaviour hooks try to buy
      if (spendingRunIsJob(eng)) return false;
      if (funds < amt) return false;
      const auto = !!(opts && opts.autonomous === true);
      if (auto && amt > autoAllowance(eng.state)) return false;
      if (auto) recordAutoSpend(eng.state, amt);
      eng.state.household.funds = funds - amt;
      pushTx(eng, key);
      ctx.emit({ type: 'funds', delta: -amt, reason: str(reason, 'Purchase') });
      ctx.stat('moneySpent', amt);
      return true;
    },
    earn(amount, reason, key) {
      const funds = healFunds(eng);
      if (!isNum(amount) || amount <= 0) return;
      const amt = Math.round(amount);
      if (amt <= 0) return;
      if (key && eng.state.household.txLog.includes(key)) return;
      eng.state.household.funds = Math.min(Number.MAX_SAFE_INTEGER, funds + amt);
      pushTx(eng, key);
      ctx.emit({ type: 'funds', delta: amt, reason: str(reason, 'Income') });
      ctx.stat('moneyEarned', amt);
    },

    queue: (agent, item) => queueItem(eng, agent, item),
    menu: (actorId, target) => buildMenu(eng, actorId, target),
    cancel(agent, uid, reason) {
      if (agent) cancelItem(eng, agent, uid, reason, false);
    },
    interrupt(agent, reason) {
      if (agent && agent.active) requestCancel(eng, agent, reason ?? 'Interrupted');
    },
    failRun(agent, reason) {
      const run = agent && agent.active;
      if (!run) return;
      const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : 'Something went wrong';
      // Persisted (engine-reserved key) so a save between the request and the next safe point keeps it.
      run.data._fail = why;
      if (eng.currentRunUid === run.uid) eng.pendingFail.set(run.uid, why);
    },
    isBusy(agent) {
      if (!agent) return false;
      if (agent.active && !isIdleInteraction(agent.active.interactionId)) return true;
      return agent.queue.some((q) => q.source !== 'auto');
    },

    spawnObject: (defId, placement, opts) => spawnObject(eng, defId, placement, opts),
    removeObject: (id, reason) => removeObject(eng, id, reason),
    markChanged: (obj) => markChanged(obj),
    placeItemNear: (defId, near, opts) => placeItemNear(eng, defId, near, opts),
    holdItem: (agent, obj) => holdItem(eng, agent, obj),
    releaseHeld: (agent, to) => releaseHeld(eng, agent, to),

    spawnAgent: (id, at) => spawnAgent(eng, id, at),
    despawnAgent: (id, presence) => despawnAgent(eng, id, presence),
    createAgent: (spec) => createAgent(eng, spec),
    sendOffLot: (agent, presence, reason) => sendOffLot(eng, agent, presence, reason),

    rel(a, b) {
      const s = state();
      if (typeof a !== 'string' || typeof b !== 'string' || !a || !b || a === b || !s.agents[a] || !s.agents[b]) {
        return blankRelationship(String(a), String(b), s.tick); // transient, never stored
      }
      const key = relKey(a, b);
      let r = s.relationships[key];
      if (!r) {
        r = blankRelationship(a, b, s.tick);
        s.relationships[key] = r;
      }
      return r;
    },

    stat(key, amount = 1, agentId = null) {
      if (typeof key !== 'string' || !key || !isNum(amount)) return;
      const st = state().stats;
      if (agentId) {
        const m = st.agent[agentId] ?? (st.agent[agentId] = {});
        m[key] = (isNum(m[key]) ? m[key] : 0) + amount;
      } else st.counters[key] = (isNum(st.counters[key]) ? st.counters[key] : 0) + amount;
    },
    statValue(key, agentId = null) {
      const st = state().stats;
      const v = agentId ? st.agent[agentId]?.[key] : st.counters[key];
      return isNum(v) ? v : 0;
    },

    runEffect(ref: EffectRef, ec: EffectContext) {
      if (!ref || typeof ref.id !== 'string') return;
      const fn = eng.effects[ref.id];
      if (!fn) {
        recordFault(eng, `effect:${String(ref.id)}`, `unknown effect '${String(ref.id)}'`);
        return;
      }
      try {
        fn(ctx, ec, (ref.params ?? {}) as Record<string, any>);
      } catch (e) {
        recordFault(eng, `effect:${ref.id}`, e);
        if (ec && ec.run) eng.pendingFail.set(ec.run.uid, 'Something went wrong');
      }
    },
    checkRequirement(ref: RequirementRef, rc: RequirementContext) {
      if (!ref || typeof ref.id !== 'string') return 'Something went wrong';
      const fn = eng.requirements[ref.id];
      if (!fn) {
        recordFault(eng, `requirement:${String(ref.id)}`, `unknown requirement '${String(ref.id)}'`);
        return 'Something went wrong';
      }
      try {
        const r = fn(ctx, rc, (ref.params ?? {}) as Record<string, any>);
        if (r === true) return true;
        return typeof r === 'string' && r ? r : 'Not available';
      } catch (e) {
        recordFault(eng, `requirement:${ref.id}`, e);
        return 'Something went wrong';
      }
    },
    evalCondition(cond: ConditionRef, agent) {
      if (!cond || typeof cond.kind !== 'string') return false;
      const fn = eng.conditions[cond.kind];
      if (!fn) {
        recordFault(eng, `condition:${String(cond.kind)}`, `unknown condition '${String(cond.kind)}'`);
        return false;
      }
      try {
        return !!fn(ctx, agent ?? null, (cond.params ?? {}) as Record<string, any>);
      } catch (e) {
        recordFault(eng, `condition:${cond.kind}`, e);
        return false;
      }
    },

    offerChoice(choice: Omit<ChoiceState, 'id' | 'tick'>) {
      const s = state();
      const id = `c${ctx.newUid()}`;
      const options = Array.isArray(choice?.options) ? choice.options.filter((o) => o && typeof o.effect === 'string') : [];
      const def = isNum(choice?.defaultOption) ? Math.floor(choice.defaultOption) : 0;
      s.choices.push({
        id,
        tick: s.tick,
        title: str(choice?.title, 'A choice'),
        text: str(choice?.text, ''),
        agentId: typeof choice?.agentId === 'string' ? choice.agentId : null,
        options: options.map((o) => ({ label: str(o.label, 'OK'), effect: o.effect, params: { ...(o.params ?? {}) }, tooltip: typeof o.tooltip === 'string' ? o.tooltip : null })),
        expiresTick: isNum(choice?.expiresTick) ? choice.expiresTick : s.tick + 480,
        defaultOption: options.length === 0 ? 0 : Math.max(0, Math.min(options.length - 1, def)),
      });
      ctx.emit({ type: 'choice', choiceId: id });
      return id;
    },
    powered(obj?: ObjectState | null) {
      if (obj) {
        const def = tryObjectDef(eng, obj);
        if (def && !def.needsPower) return true;
        if (obj.condition && obj.condition.broken) return false;
      }
      return !!eng.state.household.utilitiesOn;
    },
    sys(id: string) {
      // Binding decision #1: a per-simulation wrapper appending this SimContext as the LAST argument of every call.
      const cached = apiWrappers.get(id);
      if (cached) return cached;
      const entry = eng.systems.find((e) => e.sys.id === id);
      const api = entry && entry.sys.api && typeof entry.sys.api === 'object' ? entry.sys.api : null;
      if (!api) return EMPTY_API;
      const w: Record<string, (...args: any[]) => any> = {};
      for (const name of Object.keys(api)) {
        const fn = api[name];
        if (typeof fn === 'function') w[name] = (...args: unknown[]) => fn.apply(api, [...args, ctx]);
      }
      Object.freeze(w);
      apiWrappers.set(id, w);
      return w;
    },
  };
  return ctx;
}
