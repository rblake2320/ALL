/**
 * Quests SimSystem (docs/MONETIZATION.md §2). Deterministic and side-effect free outside WorldState.quests:
 *   - never uses ctx.rng, ctx.newId/newUid, ctx.notify, stats, needs, funds or the queue — a world with the quests
 *     system steps byte-identically to one without it (apart from `state.quests`); proven by tests/unit/quests;
 *   - EVENT objectives advance in onEvent (synchronous engine observer), STATE objectives once per game minute in tick;
 *   - completing a quest emits `questCompleted` with a stable grant id `<worldId>:<questId>:<instance>` and records the
 *     grant in `state.quests.grants` so the game layer can reconcile a grant whose event it never saw (crash between
 *     save and ledger write). The game layer's ledger refuses duplicate grant ids, so replay/reload/undo never double-pay.
 *
 * Offering: story quests start as soon as their prerequisites are complete (≤ MAX_STORY_ACTIVE at once, by `order`);
 * neighbourhood quests fill NEIGHBOURHOOD_SLOTS at each dayStart, chosen by a hash of (worldId, day, slot) among the
 * eligible ids (no RNG draw, so the sim's random stream is untouched).
 */
import type { QuestDef, QuestsView, QuestView, SimContext, SimEvent, SimSystem } from '../../contracts';
import type { QuestRewardGrant } from '../../../shared/economy';
import type { QuestArcLog, QuestInstanceState, QuestsState } from '../../types';
import { eventKey, eventMatches, evaluateObjectiveState, isEventKind, MAX_SEEN, objectiveFraction, objectiveTarget, observeObjectiveEvent, startObjective, wallCount, type ObjectiveWorld } from './objectives';
import { createQuestsState, fnv1a, grantIdOf, healQuestsState, MAX_GRANTS } from './state';

export const QUESTS_SYSTEM_ID = 'quests';
export const MAX_STORY_ACTIVE = 3;
export const NEIGHBOURHOOD_SLOTS = 2;
/** STATE objectives are re-read every this many ticks (1 game minute). */
export const STATE_EVAL_TICKS = 4;
const STATE_EVAL_MIN = 1;

const QUEST_EVENTS = new Set(['questStarted', 'questProgress', 'questCompleted']);

export interface QuestsSystemOptions {
  /** Override the system id (tests). */
  id?: string;
}

function worldOf(ctx: SimContext, q: QuestsState): ObjectiveWorld {
  return { state: ctx.state, content: ctx.content, spatial: ctx.spatial, worldId: q.worldId };
}

export function createQuestsSystem(defList: readonly QuestDef[], opts: QuestsSystemOptions = {}): SimSystem {
  const defs = new Map<string, QuestDef>();
  for (const d of defList) if (d && typeof d.id === 'string' && !defs.has(d.id) && Array.isArray(d.steps) && d.steps.length > 0) defs.set(d.id, d);
  const story = [...defs.values()].filter((d) => d.category === 'story').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1));
  const neighbourhood = [...defs.values()].filter((d) => d.category === 'neighbourhood').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  /** Quest state, created/healed lazily (a system added to an old save, or a state replaced by a system). */
  function qs(ctx: SimContext): QuestsState {
    const s = ctx.state;
    if (!s.quests || typeof s.quests !== 'object') s.quests = createQuestsState(s);
    return s.quests;
  }

  const completed = (q: QuestsState, id: string) => (Object.prototype.hasOwnProperty.call(q.completions, id) ? q.completions[id] : 0);
  const isActive = (q: QuestsState, id: string) => q.active.some((a) => a.questId === id);

  // ── story arcs (W-113) ── `arc|classicId` → the arc quest that replaces it in that arc.
  const supersededBy = new Map<string, string>();
  for (const d of defs.values()) if (d.arc) for (const sId of d.supersedes ?? []) if (!supersededBy.has(`${d.arc}|${sId}`)) supersededBy.set(`${d.arc}|${sId}`, d.id);
  /** The world's story arc: `flags.storyArc`, written once at world creation (absent = classic chain, e.g. old saves). */
  const arcOf = (ctx: SimContext): string | null => {
    const f = ctx.state.flags;
    const v = f && typeof f === 'object' ? (f as Record<string, unknown>).storyArc : undefined;
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  /** Whether a quest runs in a world on `arc`: arc quests only on their arc; classic ones unless superseded there. */
  const offered = (d: QuestDef, arc: string | null) => (d.arc ? d.arc === arc : !(arc && supersededBy.has(`${arc}|${d.id}`)));
  /** A prerequisite is met when it was completed — or, in an arc world, when the arc quest replacing it was. */
  const reqDone = (q: QuestsState, r: string, arc: string | null) => {
    if (completed(q, r) > 0) return true;
    const by = arc ? supersededBy.get(`${arc}|${r}`) : undefined;
    return !!by && completed(q, by) > 0;
  };
  const prereqsMet = (q: QuestsState, d: QuestDef, arc: string | null = null) => !d.requires || d.requires.every((r) => reqDone(q, r, arc));

  // ── arc credit (W-116, D-061) ── qualifying actions done since the arc began count for an arc step when it starts.
  /** EVENT-kind steps of arc quests, per arc (the only steps the arc log counts events for). */
  const arcEventSteps = new Map<string, { def: QuestDef; stepIndex: number; key: string }[]>();
  for (const d of story) {
    if (!d.arc) continue;
    const list = arcEventSteps.get(d.arc) ?? [];
    d.steps.forEach((st, i) => {
      if (isEventKind(st.objective.kind)) list.push({ def: d, stepIndex: i, key: `${d.id}#${st.id}` });
    });
    arcEventSteps.set(d.arc, list);
  }
  /** The arc log of this world's arc, created (arc start = now) when missing. Null for classic worlds. */
  function arcLog(ctx: SimContext, q: QuestsState): QuestArcLog | null {
    const arc = arcOf(ctx);
    if (!arc || !arcEventSteps.has(arc)) return null;
    if (!q.arcLog || q.arcLog.arc !== arc) {
      const s = ctx.state;
      q.arcLog = { arc, startTick: s.tick, walls: wallCount(s), nextId: typeof s.nextId === 'number' && Number.isFinite(s.nextId) ? s.nextId : 0, counts: {}, seen: [] };
    }
    return q.arcLog;
  }
  /** Log an event for every arc EVENT step that is not running yet (not started, or a later step of a running quest). */
  function logArcEvent(ctx: SimContext, q: QuestsState, e: SimEvent): void {
    const log = arcLog(ctx, q);
    if (!log) return;
    const key = eventKey(e, ctx.state.tick);
    if (key === null || log.seen.includes(key)) return;
    const w = worldOf(ctx, q);
    let hit = false;
    for (const s of arcEventSteps.get(log.arc) ?? []) {
      if (completed(q, s.def.id) > 0) continue;
      const inst = q.active.find((a) => a.questId === s.def.id);
      if (inst && inst.stepIndex >= s.stepIndex) continue; // running (it counted the event itself) or already passed
      const o = s.def.steps[s.stepIndex].objective;
      if (!eventMatches(o, e, w)) continue;
      const target = objectiveTarget(o);
      const cur = Object.prototype.hasOwnProperty.call(log.counts, s.key) ? log.counts[s.key] : 0;
      if (cur < target) log.counts[s.key] = cur + 1;
      hit = true;
    }
    if (!hit) return;
    log.seen.push(key);
    if (log.seen.length > MAX_SEEN) log.seen.splice(0, log.seen.length - MAX_SEEN);
  }
  /**
   * A step of an arc quest just started: credit what the player already did since the arc began. EVENT steps take the
   * logged count (consumed, so it never counts twice); `walls` / `own.fresh` count what was built or bought since the
   * arc began (the hold still runs from now); `billsOnTime` counts bills paid on time since the arc began.
   */
  function creditFromArc(q: QuestsState, inst: QuestInstanceState, def: QuestDef): number {
    const log = q.arcLog;
    if (!def.arc || !log || log.arc !== def.arc) return 0;
    const step = def.steps[inst.stepIndex];
    if (!step) return 0;
    const o = step.objective;
    if (isEventKind(o.kind)) {
      const key = `${def.id}#${step.id}`;
      const n = Math.min(objectiveTarget(o), Object.prototype.hasOwnProperty.call(log.counts, key) ? log.counts[key] : 0);
      delete log.counts[key];
      if (n <= 0) return 0;
      inst.step.progress = n;
      inst.step.credited = n;
      if (n >= objectiveTarget(o)) inst.step.done = true;
      return n;
    }
    if (o.kind === 'walls') inst.step.baseline = Math.min(inst.step.baseline, log.walls);
    else if (o.kind === 'own' && o.fresh !== false) inst.step.baseline = Math.min(inst.step.baseline, log.nextId);
    else if (o.kind === 'billsOnTime') inst.step.startTick = Math.min(inst.step.startTick, log.startTick);
    return 0;
  }
  /** Drop the logged counts of a finished arc quest (bounded save data). */
  function pruneArc(q: QuestsState, def: QuestDef): void {
    const log = q.arcLog;
    if (!def.arc || !log) return;
    for (const st of def.steps) delete log.counts[`${def.id}#${st.id}`];
  }

  function emitProgress(ctx: SimContext, q: QuestsState, inst: QuestInstanceState, def: QuestDef): void {
    const step = def.steps[inst.stepIndex];
    if (!step) return;
    ctx.emit({
      type: 'questProgress',
      questId: def.id,
      instance: inst.instance,
      grantId: grantIdOf(q.worldId, def.id, inst.instance),
      stepIndex: inst.stepIndex,
      stepId: step.id,
      progress: inst.step.progress,
      target: objectiveTarget(step.objective),
      stepDone: inst.step.done,
      ...(inst.step.credited ? { credited: inst.step.credited } : {}),
    });
  }

  function complete(ctx: SimContext, q: QuestsState, inst: QuestInstanceState, def: QuestDef): void {
    const i = q.active.indexOf(inst);
    if (i >= 0) q.active.splice(i, 1);
    if (q.pinned === def.id) q.pinned = null;
    pruneArc(q, def);
    const grantId = grantIdOf(q.worldId, def.id, inst.instance);
    q.lastEndedDay[def.id] = ctx.time.day;
    // Defensive idempotency: an instance that was already granted (corrupted counter) is never granted again.
    if (q.grants.some((g) => g.grantId === grantId)) {
      q.completions[def.id] = Math.max(completed(q, def.id), inst.instance);
      return;
    }
    q.completions[def.id] = Math.max(completed(q, def.id), inst.instance);
    const bones = Math.max(0, Math.floor(def.reward.bones));
    const entitlements = Array.isArray(def.reward.entitlements) ? def.reward.entitlements.slice() : [];
    q.grants.push({ grantId, questId: def.id, instance: inst.instance, tick: ctx.state.tick, bones, entitlements });
    if (q.grants.length > MAX_GRANTS) q.grants.splice(0, q.grants.length - MAX_GRANTS);
    const grant: QuestRewardGrant = { grantId, bones, reason: `Quest: ${def.title}` };
    if (entitlements.length) grant.entitlements = entitlements.slice();
    ctx.emit({ type: 'questCompleted', questId: def.id, instance: inst.instance, grantId, title: def.title, grant });
    if (def.category === 'story') startStory(ctx, q);
  }

  /** Move past every finished step (several can finish at once); completes the quest after the last one. */
  function advance(ctx: SimContext, q: QuestsState, inst: QuestInstanceState, def: QuestDef): void {
    for (let guard = 0; guard <= def.steps.length && inst.step.done; guard++) {
      emitProgress(ctx, q, inst, def);
      if (inst.stepIndex + 1 >= def.steps.length) {
        complete(ctx, q, inst, def);
        return;
      }
      inst.stepIndex++;
      const next = def.steps[inst.stepIndex];
      inst.step = startObjective(next.objective, worldOf(ctx, q));
      const credited = creditFromArc(q, inst, def);
      evaluateObjectiveState(next.objective, inst.step, worldOf(ctx, q), 0);
      if (credited > 0 && !inst.step.done) emitProgress(ctx, q, inst, def);
    }
  }

  function start(ctx: SimContext, q: QuestsState, def: QuestDef): void {
    // the arc begins with its first quest (a new Act 1 world: act1_claim at creation)
    if (def.arc) arcLog(ctx, q);
    const instance = completed(q, def.id) + 1;
    const inst: QuestInstanceState = {
      questId: def.id,
      instance,
      startedTick: ctx.state.tick,
      stepIndex: 0,
      step: startObjective(def.steps[0].objective, worldOf(ctx, q)),
    };
    q.active.push(inst);
    ctx.emit({ type: 'questStarted', questId: def.id, instance, grantId: grantIdOf(q.worldId, def.id, instance), title: def.title });
    const credited = creditFromArc(q, inst, def);
    evaluateObjectiveState(def.steps[0].objective, inst.step, worldOf(ctx, q), 0);
    if (inst.step.done) advance(ctx, q, inst, def);
    else if (credited > 0) emitProgress(ctx, q, inst, def);
  }

  function startStory(ctx: SimContext, q: QuestsState): void {
    const arc = arcOf(ctx);
    for (const d of story) {
      if (q.active.filter((a) => defs.get(a.questId)?.category === 'story').length >= MAX_STORY_ACTIVE) return;
      if (!offered(d, arc) || completed(q, d.id) > 0 || isActive(q, d.id) || !prereqsMet(q, d, arc)) continue;
      start(ctx, q, d);
    }
  }

  function eligibleNeighbourhood(q: QuestsState, day: number, arcQ: string | null): QuestDef[] {
    return neighbourhood.filter((d) => {
      if (isActive(q, d.id) || !prereqsMet(q, d, arcQ)) return false;
      if (!d.repeat) return completed(q, d.id) === 0;
      const last = Object.prototype.hasOwnProperty.call(q.lastEndedDay, d.id) ? q.lastEndedDay[d.id] : null;
      return last === null || day - last >= Math.max(0, d.repeat.cooldownDays);
    });
  }

  function offerNeighbourhood(ctx: SimContext, q: QuestsState): void {
    const day = ctx.time.day;
    for (let slot = 0; slot < NEIGHBOURHOOD_SLOTS; slot++) {
      if (q.active.filter((a) => defs.get(a.questId)?.category === 'neighbourhood').length >= NEIGHBOURHOOD_SLOTS) return;
      const pool = eligibleNeighbourhood(q, day, arcOf(ctx));
      if (pool.length === 0) return;
      start(ctx, q, pool[fnv1a(`${q.worldId}|${day}|${slot}`) % pool.length]);
    }
  }

  function evaluateAll(ctx: SimContext, q: QuestsState, elapsed: number): void {
    for (const inst of q.active.slice()) {
      const def = defs.get(inst.questId);
      const step = def?.steps[inst.stepIndex];
      if (!def || !step || isEventKind(step.objective.kind)) continue;
      const before = inst.step.progress;
      if (!evaluateObjectiveState(step.objective, inst.step, worldOf(ctx, q), elapsed)) continue;
      if (inst.step.done) advance(ctx, q, inst, def);
      else if (inst.step.progress !== before) emitProgress(ctx, q, inst, def);
    }
  }

  function viewOf(ctx: SimContext, q: QuestsState, inst: QuestInstanceState, def: QuestDef): QuestView {
    const steps = def.steps.map((s, i) => {
      const target = objectiveTarget(s.objective);
      const done = i < inst.stepIndex || (i === inst.stepIndex && inst.step.done);
      const progress = i < inst.stepIndex ? target : i === inst.stepIndex ? Math.min(target, inst.step.progress) : 0;
      const sv: QuestView['steps'][number] = { id: s.id, label: s.label, progress, target, done, current: i === inst.stepIndex };
      if (i === inst.stepIndex && inst.step.credited) sv.credited = true;
      return sv;
    });
    const cur = def.steps[inst.stepIndex];
    const frac = (inst.stepIndex + (cur ? objectiveFraction(cur.objective, inst.step) : 0)) / def.steps.length;
    const view: QuestView = {
      questId: def.id,
      instance: inst.instance,
      grantId: grantIdOf(q.worldId, def.id, inst.instance),
      title: def.title,
      description: def.description,
      category: def.category,
      icon: def.icon,
      steps,
      stepIndex: inst.stepIndex,
      progress: Math.max(0, Math.min(1, frac)),
      reward: { bones: def.reward.bones, entitlements: (def.reward.entitlements ?? []).slice() },
      pinned: q.pinned === def.id,
      abandonable: def.category === 'story' ? "Story quests can't be abandoned" : true,
    };
    if (def.arc) view.arc = def.arc;
    return view;
  }

  const sys: SimSystem = {
    id: opts.id ?? QUESTS_SYSTEM_ID,
    init(ctx, loaded) {
      healQuestsState(ctx.state, defs);
      const q = qs(ctx);
      // A healthy loaded world already started every eligible story quest when it became eligible: no-op there.
      startStory(ctx, q);
      if (!loaded) offerNeighbourhood(ctx, q);
    },
    tick(ctx) {
      if (ctx.state.tick % STATE_EVAL_TICKS !== 0) return;
      evaluateAll(ctx, qs(ctx), STATE_EVAL_MIN);
    },
    dayStart(ctx) {
      const q = qs(ctx);
      startStory(ctx, q);
      offerNeighbourhood(ctx, q);
    },
    onEvent(ctx: SimContext, e: SimEvent) {
      if (!e || typeof e !== 'object' || QUEST_EVENTS.has(e.type)) return;
      if (e.type !== 'interactionCompleted' && e.type !== 'skillUp' && e.type !== 'promotion' && e.type !== 'milestone') return;
      const q = qs(ctx);
      for (const inst of q.active.slice()) {
        const def = defs.get(inst.questId);
        const step = def?.steps[inst.stepIndex];
        if (!def || !step || !isEventKind(step.objective.kind)) continue;
        if (!observeObjectiveEvent(step.objective, inst.step, e, worldOf(ctx, q))) continue;
        if (inst.step.done) advance(ctx, q, inst, def);
        else emitProgress(ctx, q, inst, def);
      }
      // after the running steps (an event that finishes a step never also credits the step it starts)
      if (e.type === 'interactionCompleted') logArcEvent(ctx, q, e);
    },
    api: {
      view(ctx: SimContext): QuestsView {
        const q = ctx.state.quests;
        if (!q || !Array.isArray(q.active)) return { active: [], story: { done: 0, total: story.filter((d) => offered(d, arcOf(ctx))).length }, recent: [], pinned: null };
        const active: QuestView[] = [];
        for (const inst of q.active) {
          const def = defs.get(inst.questId);
          if (def) active.push(viewOf(ctx, q, inst, def));
        }
        active.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.category === b.category ? 0 : a.category === 'story' ? -1 : 1));
        const recent = (Array.isArray(q.grants) ? q.grants : [])
          .slice(-10)
          .reverse()
          .map((g) => ({ questId: g.questId, title: defs.get(g.questId)?.title ?? g.questId, grantId: g.grantId, tick: g.tick, bones: g.bones, entitlements: g.entitlements.slice() }));
        const arc = arcOf(ctx);
        const chain = story.filter((d) => offered(d, arc));
        const storyDone = chain.filter((d) => (q.completions && q.completions[d.id] ? q.completions[d.id] : 0) > 0).length;
        return { active, story: { done: storyDone, total: chain.length }, recent, pinned: typeof q.pinned === 'string' ? q.pinned : null };
      },
      grants(ctx: SimContext): QuestRewardGrant[] {
        const q = ctx.state.quests;
        if (!q || !Array.isArray(q.grants)) return [];
        return q.grants.map((g) => {
          const out: QuestRewardGrant = { grantId: g.grantId, bones: g.bones, reason: `Quest: ${defs.get(g.questId)?.title ?? g.questId}` };
          if (g.entitlements.length) out.entitlements = g.entitlements.slice();
          return out;
        });
      },
      command(...args: unknown[]): true | string {
        // binding rule #1: the invoking SimContext is always the LAST argument (tolerate missing caller args)
        const ctx = args[args.length - 1] as SimContext;
        const action = args.length >= 3 ? args[0] : undefined;
        const questId = args.length >= 3 ? args[1] : undefined;
        const q = qs(ctx);
        if (typeof questId !== 'string') return 'Unknown quest';
        const inst = q.active.find((a) => a.questId === questId);
        const def = defs.get(questId);
        if (action === 'unpin') {
          if (q.pinned === questId) q.pinned = null;
          return true;
        }
        if (!inst || !def) return 'That quest is not active';
        if (action === 'pin') {
          q.pinned = questId;
          return true;
        }
        if (action === 'abandon') {
          if (def.category === 'story') return "Story quests can't be abandoned";
          q.active.splice(q.active.indexOf(inst), 1);
          q.lastEndedDay[questId] = ctx.time.day;
          if (q.pinned === questId) q.pinned = null;
          return true;
        }
        return 'Unknown quest action';
      },
    },
  };
  return sys;
}
