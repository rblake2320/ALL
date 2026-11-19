/**
 * Objective predicate evaluator (docs/MONETIZATION.md §2) — PURE functions over (objective def, JSON progress, world
 * view, event). Used by the quests SimSystem inside the simulation AND by the game layer for profile-level daily tasks
 * on the drained event stream (same code, same semantics). Nothing here touches ctx.rng, ids, notifications, needs or
 * funds: evaluating an objective only ever writes its own ObjectiveProgress.
 *
 * Kinds (contracts.ts ObjectiveDef):
 *   EVENT  interaction · event                    — count matching SimEvents (de-duplicated by a stable event key)
 *   STATE  stat · friends · days · billsOnTime     — count growth since the objective started (baseline)
 *          skill · career · funds                  — absolute level/amount (latched maximum)
 *          own · roomEnv · walls                   — a predicate that must hold for `holdMin` game minutes
 * Progress of counting kinds never decreases; `done` latches.
 */
import type { ContentRegistry, ObjectiveDef, ObjectiveKind, RoomInfo, SimEvent } from '../../contracts';
import type { ObjectiveProgress, WorldState } from '../../types';
import { timeInfo } from '../../time';
import { homeRegionIdOf } from '../../../shared/town';

/** Read-only world access an objective needs (SimContext and SimulationAPI both satisfy it via objectiveWorldOf*). */
export interface ObjectiveWorld {
  readonly state: WorldState;
  readonly content?: Pick<ContentRegistry, 'interactions' | 'objects'> | null;
  readonly spatial?: { rooms(): RoomInfo[]; roomEnvironment(x: number, z: number): number; width(): number } | null;
  /** Baselines belong to this world (QuestsState.worldId). */
  readonly worldId: string;
}

export const EVENT_KINDS: ReadonlySet<ObjectiveKind> = new Set<ObjectiveKind>(['interaction', 'event']);
/** Kinds whose progress is measured against a baseline (or a start tick) captured when the objective starts. */
const BASELINE_KINDS: ReadonlySet<ObjectiveKind> = new Set<ObjectiveKind>(['stat', 'friends']);
/** Kinds that need a continuous hold. */
const HOLD_KINDS: ReadonlySet<ObjectiveKind> = new Set<ObjectiveKind>(['own', 'roomEnv', 'walls']);
/** Default hold (game minutes) for own/roomEnv: build mode pauses time, so an undone build never reaches it. */
export const DEFAULT_HOLD_MIN = 15;
/** De-duplication keys kept per objective (newest last). */
export const MAX_SEEN = 64;
export const DEFAULT_FRIEND_AT = 35;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonNeg = (v: unknown, d = 0): number => (isNum(v) && v >= 0 ? v : d);

export function isEventKind(kind: ObjectiveKind): boolean {
  return EVENT_KINDS.has(kind);
}

/** Target value the progress counts toward (≥ 1). */
export function objectiveTarget(o: ObjectiveDef): number {
  let t: number;
  switch (o.kind) {
    case 'skill':
    case 'career':
      t = o.level;
      break;
    case 'roomEnv':
    case 'funds':
      t = o.atLeast;
      break;
    default:
      t = o.count;
  }
  return isNum(t) && t >= 1 ? Math.floor(t) : 1;
}

/** Calendar day (1-based) of a tick — the world clock starts on day 1 at 09:00 (src/sim/time.ts). */
function dayOf(tick: number): number {
  return timeInfo(Math.floor(nonNeg(tick))).day;
}

function members(state: WorldState): string[] {
  const ids = state.household && Array.isArray(state.household.memberIds) ? state.household.memberIds : [];
  return ids.filter((id) => typeof id === 'string' && !!state.agents && !!state.agents[id]);
}

function counter(state: WorldState, key: string): number {
  const c = state.stats && state.stats.counters ? state.stats.counters[key] : 0;
  return isNum(c) ? c : 0;
}

function friendsCount(state: WorldState, atLeast: number): number {
  const m = new Set(members(state));
  let n = 0;
  const rels = state.relationships && typeof state.relationships === 'object' ? state.relationships : {};
  for (const key of Object.keys(rels)) {
    const r = rels[key];
    if (!r || !r.met || !isNum(r.friendship) || r.friendship < atLeast) continue;
    if (m.has(r.a) !== m.has(r.b)) n++;
  }
  return n;
}

function bestSkill(state: WorldState, skill: string | undefined): number {
  let best = 0;
  for (const id of members(state)) {
    const skills = state.agents[id].skills as Record<string, { level: number } | undefined> | undefined;
    if (!skills) continue;
    for (const k of skill ? [skill] : Object.keys(skills)) {
      const lv = skills[k]?.level;
      if (isNum(lv) && lv > best) best = lv;
    }
  }
  return best;
}

function bestCareer(state: WorldState): number {
  let best = 0;
  for (const id of members(state)) {
    const c = state.agents[id].career;
    if (c && isNum(c.level) && c.level > best) best = c.level;
  }
  return best;
}

function hasAnyTag(tags: readonly string[] | undefined, want: readonly string[] | undefined): boolean {
  if (!want || want.length === 0) return true;
  if (!Array.isArray(tags)) return false;
  return want.some((t) => tags.includes(t));
}

/** Numeric part of an object id ('o57' → 57; junk → -1). Ids come from WorldState.nextId, so they grow over time. */
function idNumber(id: string): number {
  const m = /^o(\d{1,15})$/.exec(id);
  return m ? Number(m[1]) : -1;
}

/** `own.fresh` baseline: objects created from now on get ids ≥ nextId (undo/redo restores ORIGINAL ids). */
function nextIdOf(state: WorldState): number {
  return isNum(state.nextId) ? state.nextId : 0;
}

function ownedCount(o: Extract<ObjectiveDef, { kind: 'own' }>, p: ObjectiveProgress, w: ObjectiveWorld): number {
  const objs = w.state.objects && typeof w.state.objects === 'object' ? w.state.objects : {};
  const fresh = o.fresh !== false;
  let n = 0;
  for (const id of Object.keys(objs)) {
    const ob = objs[id];
    if (!ob || !ob.placement || (ob.regionId ?? homeRegionIdOf(w.state)) !== homeRegionIdOf(w.state)) continue;
    const k = ob.placement.kind;
    if (k !== 'floor' && k !== 'wall' && k !== 'opening') continue;
    if (fresh && idNumber(id) < p.baseline) continue;
    if (o.defIds && o.defIds.length > 0 && !o.defIds.includes(ob.defId)) continue;
    if (o.tags && o.tags.length > 0) {
      const def = w.content?.objects?.[ob.defId];
      if (!def || !hasAnyTag(def.tags, o.tags)) continue;
    }
    n++;
  }
  return n;
}

/** Wall segments standing on the lot (doors/windows sit on segments and count as the segment). */
export function wallCount(state: WorldState): number {
  const walls = state.lot && state.lot.walls && typeof state.lot.walls === 'object' ? state.lot.walls : null;
  if (!walls) return 0;
  let n = 0;
  for (const k of Object.keys(walls)) if (walls[k] && typeof walls[k] === 'object') n++;
  return n;
}

function bestRoomEnv(w: ObjectiveWorld): number {
  const sp = w.spatial;
  if (!sp) return 0;
  let best = 0;
  const width = sp.width();
  for (const r of sp.rooms()) {
    if (!r || !r.indoor || !Array.isArray(r.tiles) || r.tiles.length === 0 || !(width > 0)) continue;
    const t = r.tiles[0];
    const env = sp.roomEnvironment(t % width, Math.floor(t / width));
    if (isNum(env) && env > best) best = env;
  }
  return best;
}

/** Current raw measurement for state kinds (counting kinds: before subtracting the baseline). */
function measure(o: ObjectiveDef, p: ObjectiveProgress, w: ObjectiveWorld): number {
  const s = w.state;
  switch (o.kind) {
    case 'stat':
      return counter(s, o.key);
    case 'friends':
      return friendsCount(s, isNum(o.atLeast) ? o.atLeast : DEFAULT_FRIEND_AT);
    case 'skill':
      return bestSkill(s, o.skill);
    case 'career':
      return bestCareer(s);
    case 'funds':
      return s.household && isNum(s.household.funds) ? s.household.funds : 0;
    case 'days':
      return dayOf(s.tick) - p.startDay;
    case 'own':
      return ownedCount(o, p, w);
    case 'roomEnv':
      return Math.floor(bestRoomEnv(w));
    case 'walls':
      return wallCount(s) - p.baseline;
    default:
      return 0;
  }
}

/** Fresh progress for an objective starting now (baselines captured from the world). */
export function startObjective(o: ObjectiveDef, w: ObjectiveWorld): ObjectiveProgress {
  const tick = isNum(w.state.tick) ? Math.floor(w.state.tick) : 0;
  const p: ObjectiveProgress = { progress: 0, baseline: 0, heldMin: 0, startTick: tick, startDay: dayOf(tick), seen: [], worldId: w.worldId, done: false };
  if (BASELINE_KINDS.has(o.kind)) p.baseline = measure(o, p, w);
  else if (o.kind === 'own') p.baseline = nextIdOf(w.state);
  else if (o.kind === 'walls') p.baseline = wallCount(w.state);
  return p;
}

/**
 * Objective progress moved to another world (game-layer daily tasks across saves): keep the progress, re-anchor the
 * baselines so only growth in the new world counts from here on.
 */
function rebase(o: ObjectiveDef, p: ObjectiveProgress, w: ObjectiveWorld): void {
  const tick = isNum(w.state.tick) ? Math.floor(w.state.tick) : 0;
  p.worldId = w.worldId;
  p.seen = [];
  p.heldMin = 0;
  p.startTick = tick;
  p.startDay = dayOf(tick) - (o.kind === 'days' ? p.progress : 0);
  if (BASELINE_KINDS.has(o.kind)) p.baseline = measure(o, p, w) - p.progress;
  else if (o.kind === 'own') p.baseline = nextIdOf(w.state);
  else if (o.kind === 'walls') p.baseline = wallCount(w.state);
}

function remember(p: ObjectiveProgress, key: string): boolean {
  if (p.seen.includes(key)) return false;
  p.seen.push(key);
  if (p.seen.length > MAX_SEEN) p.seen.splice(0, p.seen.length - MAX_SEEN);
  return true;
}

/** Stable de-duplication key for a countable event (null = not countable). */
export function eventKey(e: SimEvent, tick: number): string | null {
  switch (e.type) {
    case 'interactionCompleted':
      return isNum(e.uid) ? `ic:${e.uid}:${e.agentId}` : null;
    case 'skillUp':
      return `su:${e.agentId}:${e.skill}:${e.level}`;
    case 'promotion':
      return `pr:${e.agentId}:${e.level}:${tick}`;
    case 'milestone':
      return `ms:${e.agentId}:${e.aspirationId}:${e.milestoneId}`;
    default:
      return null;
  }
}

/** Whether `e` is an event the EVENT objective `o` counts (filters only — no de-duplication, no progress). */
export function eventMatches(o: ObjectiveDef, e: SimEvent, w: ObjectiveWorld): boolean {
  if (o.kind === 'interaction') {
    if (e.type !== 'interactionCompleted' || e.household !== true) return false;
    if (o.ids && o.ids.length > 0 && !o.ids.includes(e.interactionId)) return false;
    if (o.tags && o.tags.length > 0) {
      const def = w.content?.interactions?.[e.interactionId];
      if (!def || !hasAnyTag(def.tags, o.tags)) return false;
    }
    if (o.match) {
      const params = e.params && typeof e.params === 'object' ? e.params : {};
      for (const k of Object.keys(o.match)) if (params[k] !== o.match[k]) return false;
    }
    if (o.targetTags && o.targetTags.length > 0) {
      const ob = e.targetId ? w.state.objects?.[e.targetId] : undefined;
      const def = ob ? w.content?.objects?.[ob.defId] : undefined;
      if (!def || !hasAnyTag(def.tags, o.targetTags)) return false;
    }
    return true;
  }
  if (o.kind === 'event') {
    if (e.type !== o.event) return false;
    const agentId = (e as { agentId?: unknown }).agentId;
    if (typeof agentId !== 'string' || !members(w.state).includes(agentId)) return false;
    if (e.type === 'skillUp') {
      if (o.skill && e.skill !== o.skill) return false;
      if (isNum(o.minLevel) && !(isNum(e.level) && e.level >= o.minLevel)) return false;
    }
    return true;
  }
  return false;
}

function normalize(p: ObjectiveProgress): void {
  if (!isNum(p.progress) || p.progress < 0) p.progress = 0;
  if (!isNum(p.heldMin) || p.heldMin < 0) p.heldMin = 0;
  if (!Array.isArray(p.seen)) p.seen = [];
}

/**
 * Feed one event. Returns true when the progress changed. Only EVENT kinds react; a duplicate delivery of the same
 * event (same key) is ignored.
 */
export function observeObjectiveEvent(o: ObjectiveDef, p: ObjectiveProgress, e: SimEvent, w: ObjectiveWorld): boolean {
  if (p.done || !e || typeof e !== 'object' || !EVENT_KINDS.has(o.kind)) return false;
  normalize(p);
  if (p.worldId !== w.worldId) rebase(o, p, w);
  if (!eventMatches(o, e, w)) return false;
  const key = eventKey(e, isNum(w.state.tick) ? w.state.tick : 0);
  if (key === null || !remember(p, key)) return false;
  const target = objectiveTarget(o);
  p.progress = Math.min(target, p.progress + 1);
  if (p.progress >= target) p.done = true;
  return true;
}

/**
 * Re-read the world for STATE kinds. `elapsedMin` = game minutes since the previous evaluation (hold accrual).
 * Returns true when progress, hold or done changed.
 */
export function evaluateObjectiveState(o: ObjectiveDef, p: ObjectiveProgress, w: ObjectiveWorld, elapsedMin: number): boolean {
  if (p.done || EVENT_KINDS.has(o.kind)) return false;
  normalize(p);
  if (p.worldId !== w.worldId) rebase(o, p, w);
  const before = `${p.progress}|${p.heldMin}|${p.seen.length}`;
  const target = objectiveTarget(o);
  if (o.kind === 'billsOnTime') {
    const bills = w.state.household && Array.isArray(w.state.household.bills) ? w.state.household.bills : [];
    for (const b of bills) {
      if (!b || typeof b.id !== 'string' || !isNum(b.paidTick) || !isNum(b.dueTick)) continue;
      if (b.paidTick < p.startTick || b.paidTick > b.dueTick) continue;
      if (p.progress < target && remember(p, `bill:${b.id}`)) p.progress++;
    }
    if (p.progress >= target) p.done = true;
  } else if (HOLD_KINDS.has(o.kind)) {
    const cur = Math.max(0, Math.min(target, measure(o, p, w)));
    p.progress = cur;
    if (cur >= target) p.heldMin += nonNeg(elapsedMin);
    else p.heldMin = 0;
    const hold = nonNeg((o as { holdMin?: number }).holdMin, DEFAULT_HOLD_MIN);
    if (cur >= target && p.heldMin >= hold) p.done = true;
  } else {
    const raw = measure(o, p, w) - (BASELINE_KINDS.has(o.kind) ? p.baseline : 0);
    const cur = Math.max(0, Math.min(target, Math.floor(raw)));
    if (cur > p.progress) p.progress = cur;
    if (p.progress >= target) p.done = true;
  }
  return p.done || before !== `${p.progress}|${p.heldMin}|${p.seen.length}`;
}

/** 0..1 fraction for progress bars. */
export function objectiveFraction(o: ObjectiveDef, p: ObjectiveProgress): number {
  if (p.done) return 1;
  const t = objectiveTarget(o);
  return Math.max(0, Math.min(0.999, nonNeg(p.progress) / t));
}

/** ObjectiveWorld for a SimulationAPI-like object (game layer: daily tasks on the drained event stream). */
export function objectiveWorldOf(sim: {
  state: WorldState;
  content?: Pick<ContentRegistry, 'interactions' | 'objects'> | null;
  spatial?: ObjectiveWorld['spatial'];
}): ObjectiveWorld {
  const q = sim.state.quests;
  const worldId = q && typeof q.worldId === 'string' && q.worldId ? q.worldId : `seed:${(isNum(sim.state.seed) ? sim.state.seed : 0) >>> 0}`;
  return { state: sim.state, content: sim.content ?? null, spatial: sim.spatial ?? null, worldId };
}
