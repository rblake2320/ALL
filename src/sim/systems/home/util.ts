/**
 * Defensive helpers shared by the home systems. Nothing here throws on missing / malformed state: lookups return
 * null, numbers are sanitised, and iteration order is deterministic (sorted ids).
 */
import type { BubbleIcon, FxKind, InteractionDef, ObjectDef, SimContext } from '../../contracts';
import type { SfxId, VoiceEmotion } from '../../../shared/audioIds';
import type { ActiveInteraction, AgentState, ObjectState, Presence, TargetRef, Vec2 } from '../../types';
import { TICK_MINUTES } from '../../types';
import { homeRegionIdOf } from '../../../shared/town';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

export function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Safe dt in minutes (NaN / negative / absurd values become 0). */
export function safeDt(dt: unknown): number {
  const d = num(dt, 0);
  return d > 0 && d <= 60 ? d : 0;
}

export function idNumber(id: string): number {
  const m = /^[a-z]+(\d+)$/i.exec(id);
  return m ? Number(m[1]) : NaN;
}

export function compareIds(a: string, b: string): number {
  const na = idNumber(a);
  const nb = idNumber(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ─────────────────────────────── lookups ───────────────────────────────

export function getAgent(ctx: SimContext, id: unknown): AgentState | null {
  if (typeof id !== 'string' || !id) return null;
  return ctx.state.agents[id] ?? null;
}

export function getObj(ctx: SimContext, id: unknown): ObjectState | null {
  if (typeof id !== 'string' || !id) return null;
  return ctx.state.objects[id] ?? null;
}

/** ObjectDef without throwing (ctx.objectDef throws on unknown ids). */
export function defOf(ctx: SimContext, obj: ObjectState | string | null | undefined): ObjectDef | null {
  if (!obj) return null;
  const id = typeof obj === 'string' ? obj : obj.defId;
  return ctx.content.objects[id] ?? null;
}

export function interactionDef(ctx: SimContext, id: unknown): InteractionDef | null {
  if (typeof id !== 'string') return null;
  return ctx.content.interactions[id] ?? null;
}

export function hasTag(ctx: SimContext, obj: ObjectState | null | undefined, tag: string): boolean {
  const def = defOf(ctx, obj);
  return !!def && Array.isArray(def.tags) && def.tags.includes(tag);
}

export function objParam(ctx: SimContext, obj: ObjectState | null | undefined, key: string, fallback: number): number {
  const def = defOf(ctx, obj);
  return def ? num(def.params?.[key], fallback) : fallback;
}

export function objParamBool(ctx: SimContext, obj: ObjectState | null | undefined, key: string): boolean {
  const def = defOf(ctx, obj);
  return !!def && def.params?.[key] === true;
}

/** Matches the spatial scope; held objects follow their holder. Legacy contexts use the home scope. */
export function objectInScope(ctx: SimContext, obj: ObjectState): boolean {
  const home = homeRegionIdOf(ctx.state);
  const holder = obj.placement?.kind === 'held' ? ctx.state.agents[obj.placement.agentId] : undefined;
  const region = holder ? holder.regionId ?? home : obj.regionId ?? home;
  return region === (ctx.currentRegionId?.() ?? home);
}

/** Local geometry must never compare positions belonging to different region frames. */
export function agentInScope(ctx: SimContext, agent: AgentState): boolean {
  const home = homeRegionIdOf(ctx.state);
  return (agent.regionId ?? home) === (ctx.currentRegionId?.() ?? home);
}

/** Environment lifecycle only: household-wide billing/jobs/quests must not be repeated per region. */
export function inActiveRegions(ctx: SimContext, callback: () => void): void {
  if (!ctx.withRegion || !ctx.activeRegionIds) { callback(); return; }
  for (const id of ctx.activeRegionIds()) ctx.withRegion(id, callback);
}

/** Keep the original global agent order while evaluating each on-lot agent in its own spatial frame. */
export function inAgentRegion(ctx: SimContext, agent: AgentState, callback: () => void): void {
  if (!ctx.withRegion || agent.presence !== 'onLot') { callback(); return; }
  const id = agent.regionId ?? homeRegionIdOf(ctx.state);
  if (ctx.activeRegionIds && !ctx.activeRegionIds().includes(id)) return;
  ctx.withRegion(id, callback);
}

/** Objects in the spatial scope, sorted by id (deterministic). */
export function sortedObjects(ctx: SimContext): ObjectState[] {
  const list = Object.values(ctx.state.objects ?? {}).filter((o): o is ObjectState => !!o && typeof o.id === 'string' && objectInScope(ctx, o));
  list.sort((a, b) => compareIds(a.id, b.id));
  return list;
}

/** Objects matching `pred`, sorted by id — filters first so hot paths (fires each tick) stay cheap. */
export function objectsWhere(ctx: SimContext, pred: (o: ObjectState) => boolean): ObjectState[] {
  const out: ObjectState[] = [];
  for (const o of Object.values(ctx.state.objects ?? {})) if (o && typeof o.id === 'string' && objectInScope(ctx, o) && pred(o)) out.push(o);
  if (out.length > 1) out.sort((a, b) => compareIds(a.id, b.id));
  return out;
}

export function objectsWithTag(ctx: SimContext, tag: string): ObjectState[] {
  return objectsWhere(ctx, (o) => hasTag(ctx, o, tag));
}

export function objectsOfDef(ctx: SimContext, defId: string): ObjectState[] {
  return objectsWhere(ctx, (o) => o.defId === defId);
}

export function sortedAgents(ctx: SimContext): AgentState[] {
  const list = Object.values(ctx.state.agents ?? {}).filter((a): a is AgentState => !!a && typeof a.id === 'string');
  list.sort((a, b) => compareIds(a.id, b.id));
  return list;
}

export function onLotAgents(ctx: SimContext): AgentState[] {
  return sortedAgents(ctx).filter((a) => a.presence === 'onLot');
}

export function isHouseholdId(ctx: SimContext, id: string): boolean {
  return Array.isArray(ctx.state.household?.memberIds) && ctx.state.household.memberIds.includes(id);
}

export function isMember(ctx: SimContext, agent: AgentState | null | undefined): boolean {
  return !!agent && (agent.role === 'household' || isHouseholdId(ctx, agent.id));
}

export function isAlivePresence(p: Presence): boolean {
  return p === 'onLot' || p === 'offLot' || p === 'atWork';
}

/** Household members (by memberIds, falling back to role) in deterministic order. */
export function members(ctx: SimContext): AgentState[] {
  const ids = Array.isArray(ctx.state.household?.memberIds) ? ctx.state.household.memberIds : [];
  const out: AgentState[] = [];
  for (const id of ids) {
    const a = getAgent(ctx, id);
    if (a && !out.includes(a)) out.push(a);
  }
  out.sort((a, b) => compareIds(a.id, b.id));
  return out;
}

export function livingMembers(ctx: SimContext): AgentState[] {
  return members(ctx).filter((a) => isAlivePresence(a.presence));
}

/** Zombies the decay model applies to: anyone except service NPCs. */
export function isZombie(agent: AgentState | null | undefined): boolean {
  return !!agent && agent.role !== 'service';
}

export function fullName(agent: AgentState | null | undefined): string {
  if (!agent) return 'Someone';
  return `${agent.firstName ?? ''} ${agent.lastName ?? ''}`.trim() || 'Someone';
}

export function firstName(agent: AgentState | null | undefined): string {
  return (agent && typeof agent.firstName === 'string' && agent.firstName) || 'Someone';
}

export function objName(ctx: SimContext, obj: ObjectState | null | undefined): string {
  return defOf(ctx, obj)?.name ?? 'object';
}

// ─────────────────────────────── geometry ───────────────────────────────

/** World centre of an object; never throws (falls back to the placement). */
export function centerOf(ctx: SimContext, obj: ObjectState): Vec2 {
  try {
    const c = ctx.spatial.objectCenter(obj);
    if (c && isNum(c.x) && isNum(c.z)) return { x: c.x, z: c.z };
  } catch {
    /* fall through */
  }
  const p = obj.placement;
  switch (p.kind) {
    case 'loose':
      return { x: num(p.x, 0), z: num(p.z, 0) };
    case 'floor': {
      const def = defOf(ctx, obj);
      const w = def ? def.footprint.w : 1;
      const d = def ? def.footprint.d : 1;
      const rw = p.rot % 2 === 0 ? w : d;
      const rd = p.rot % 2 === 0 ? d : w;
      return { x: num(p.x, 0) + rw / 2, z: num(p.z, 0) + rd / 2 };
    }
    case 'held': {
      const a = getAgent(ctx, p.agentId);
      return a ? { x: a.pos.x, z: a.pos.z } : { x: 0, z: 0 };
    }
    default:
      return { x: 0, z: 0 };
  }
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function tileOf(ctx: SimContext, p: Vec2): { x: number; z: number } {
  try {
    return ctx.spatial.tileOf(p);
  } catch {
    return { x: Math.floor(num(p.x, 0)), z: Math.floor(num(p.z, 0)) };
  }
}

export function roomOf(ctx: SimContext, p: Vec2): number {
  const t = tileOf(ctx, p);
  try {
    return num(ctx.spatial.roomAt(t.x, t.z), 0);
  } catch {
    return 0;
  }
}

export function isIndoorAt(ctx: SimContext, p: Vec2): boolean {
  const t = tileOf(ctx, p);
  try {
    return !!ctx.spatial.isIndoor(t.x, t.z);
  } catch {
    return false;
  }
}

/**
 * "Can perceive": within `radius` and in the same room (room 0 = outdoors counts as one space).
 * Keeps limb-loss witnesses, stench and mess checks local without line-of-sight raycasts.
 */
export function nearAndSameRoom(ctx: SimContext, a: Vec2, b: Vec2, radius: number): boolean {
  if (dist(a, b) > radius) return false;
  return roomOf(ctx, a) === roomOf(ctx, b);
}

// ─────────────────────────────── runs ───────────────────────────────

export function activeDef(ctx: SimContext, agent: AgentState): InteractionDef | null {
  const run = agent.active;
  return run ? interactionDef(ctx, run.interactionId) : null;
}

export function runHasTag(ctx: SimContext, agent: AgentState, tag: string): boolean {
  const def = activeDef(ctx, agent);
  return !!def && Array.isArray(def.tags) && def.tags.includes(tag);
}

export function isRunning(agent: AgentState): boolean {
  return !!agent.active && agent.active.phase === 'run';
}

/** Asleep = running a sleep-tagged interaction (or passed out on the floor). */
export function isAsleep(ctx: SimContext, agent: AgentState): boolean {
  if (agent.status?.passedOut) return true;
  return isRunning(agent) && runHasTag(ctx, agent, 'sleep');
}

export function isStrenuous(ctx: SimContext, agent: AgentState): boolean {
  return isRunning(agent) && runHasTag(ctx, agent, 'strenuous');
}

export function targetObject(ctx: SimContext, ref: TargetRef | null | undefined): ObjectState | null {
  return ref && ref.kind === 'object' ? getObj(ctx, ref.id) : null;
}

export function targetAgent(ctx: SimContext, ref: TargetRef | null | undefined): AgentState | null {
  return ref && ref.kind === 'agent' ? getAgent(ctx, ref.id) : null;
}

export function stageObject(ctx: SimContext, run: ActiveInteraction | null | undefined): ObjectState | null {
  return run ? targetObject(ctx, run.stageTarget) : null;
}

export function queuedObject(ctx: SimContext, run: ActiveInteraction | null | undefined): ObjectState | null {
  return run ? targetObject(ctx, run.target) : null;
}

/** The slot kind the run reserved on its stage object ('sit' when seated). */
export function runSlotKind(ctx: SimContext, run: ActiveInteraction): string | null {
  const obj = stageObject(ctx, run);
  const def = defOf(ctx, obj);
  if (!obj || !def || run.slot === null || run.slot === undefined) return null;
  const slot = def.slots?.[run.slot];
  return slot ? slot.kind : null;
}

/** Stable run id for idempotency keys: the engine keeps `params._origUid` on suspended/re-queued copies. */
export function runKeyUid(run: ActiveInteraction): number {
  const o = run.params?._origUid;
  return typeof o === 'number' && Number.isFinite(o) ? o : run.uid;
}

export function runData(run: ActiveInteraction): Record<string, string | number | boolean | null> {
  if (!run.data || typeof run.data !== 'object') run.data = {};
  return run.data;
}

/** Minutes elapsed since a tick (0 for bad input). */
export function minutesSince(ctx: SimContext, tick: unknown): number {
  const t = num(tick, ctx.state.tick);
  return Math.max(0, (ctx.state.tick - t) * TICK_MINUTES);
}

export function absHour(ctx: SimContext): number {
  return Math.floor(num(ctx.time?.totalMinutes, 0) / 60);
}

/** True roughly every `everyMin` game minutes (tick-aligned, deterministic). */
export function every(ctx: SimContext, everyMin: number): boolean {
  const ticks = Math.max(1, Math.round(everyMin / TICK_MINUTES));
  return ctx.state.tick % ticks === 0;
}

// ─────────────────────────────── object data ───────────────────────────────

export function dataNum(obj: ObjectState | null | undefined, key: string, fallback: number): number {
  return obj ? num(obj.data?.[key], fallback) : fallback;
}

export function dataBool(obj: ObjectState | null | undefined, key: string, fallback: boolean): boolean {
  return obj ? bool(obj.data?.[key], fallback) : fallback;
}

export function dataStr(obj: ObjectState | null | undefined, key: string, fallback: string): string {
  return obj ? str(obj.data?.[key], fallback) : fallback;
}

/** Set object data; marks the object changed only when the value actually changes. */
export function setData(ctx: SimContext, obj: ObjectState, key: string, value: string | number | boolean | null): void {
  if (!obj.data || typeof obj.data !== 'object') obj.data = {};
  if (typeof value === 'number' && !Number.isFinite(value)) value = 0;
  if (obj.data[key] === value) return;
  obj.data[key] = value;
  ctx.markChanged(obj);
}

// ─────────────────────────────── flags ───────────────────────────────

export function flagNum(ctx: SimContext, key: string, fallback: number): number {
  return num(ctx.state.flags?.[key], fallback);
}

export function flagStr(ctx: SimContext, key: string, fallback: string): string {
  return str(ctx.state.flags?.[key], fallback);
}

export function setFlag(ctx: SimContext, key: string, value: string | number | boolean): void {
  if (!ctx.state.flags || typeof ctx.state.flags !== 'object') ctx.state.flags = {};
  ctx.state.flags[key] = value;
}

export function clearFlag(ctx: SimContext, key: string): void {
  if (ctx.state.flags && key in ctx.state.flags) delete ctx.state.flags[key];
}

// ─────────────────────────────── systems & output ───────────────────────────────

/** ctx.sys(id) that never throws and always returns an object. */
export function sysApi(ctx: SimContext, id: string): Record<string, (...args: any[]) => any> {
  try {
    const api = ctx.sys(id);
    return api && typeof api === 'object' ? api : {};
  } catch {
    return {};
  }
}

export function sfxAt(ctx: SimContext, id: SfxId, opts?: { pos?: Vec2; agentId?: string; objectId?: string; volume?: number }): void {
  ctx.emit({ type: 'sfx', id, ...(opts ?? {}) });
}

export function fxAt(ctx: SimContext, kind: FxKind, opts?: { pos?: Vec2; y?: number; agentId?: string; objectId?: string }): void {
  ctx.emit({ type: 'fx', kind, ...(opts ?? {}) });
}

export function bubble(ctx: SimContext, agent: AgentState, icon: BubbleIcon, style: 'thought' | 'speech' | 'shout' = 'thought', positive?: boolean): void {
  ctx.emit({ type: 'bubble', agentId: agent.id, icon, style, ...(positive === undefined ? {} : { positive }) });
}

export function voice(ctx: SimContext, agent: AgentState, emotion: VoiceEmotion, durationMs = 1200): void {
  ctx.emit({ type: 'voice', agentId: agent.id, emotion, durationMs });
}

export function moodletOnce(ctx: SimContext, agent: AgentState, id: string, opts?: { sourceId?: string | null; durationMin?: number }): boolean {
  if (ctx.hasMoodlet(agent, id)) return false;
  ctx.addMoodlet(agent, id, opts);
  return true;
}

/** Add or remove a system-managed (durationless) moodlet so it matches `on`. */
export function syncMoodlet(ctx: SimContext, agent: AgentState, id: string, on: boolean, sourceId?: string | null): void {
  const has = ctx.hasMoodlet(agent, id);
  if (on && !has) ctx.addMoodlet(agent, id, sourceId !== undefined ? { sourceId } : undefined);
  else if (!on && has) ctx.removeMoodlet(agent, id);
}

/** "$1,234" — formatted by hand: notification text is saved state, so it must not depend on the host's ICU data. */
export function moneyLabel(n: number): string {
  const v = Math.max(0, Math.round(num(n, 0)));
  return `$${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** Deterministic pick from a pool using ctx.rng; empty pool → fallback. */
export function pickLine(ctx: SimContext, pool: readonly string[], fallback = ''): string {
  if (!Array.isArray(pool) || pool.length === 0) return fallback;
  return pool[ctx.rng.int(0, pool.length - 1)] ?? fallback;
}
