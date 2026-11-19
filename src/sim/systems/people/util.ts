/**
 * Shared helpers for the people systems: defensive number handling, namespaced flags, agent classification,
 * relationship peeking (without creating records), presentation events and time math.
 * Everything here is deterministic and never throws on bad input.
 */
import type { BubbleIcon, FxKind, SimContext, TraitDef } from '../../contracts';
import type { AgentId, AgentState, MoodletId, Relationship, TraitId, Vec2 } from '../../types';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICK_MINUTES } from '../../types';
import type { SfxId, VoiceEmotion } from '../../../shared/audioIds';
import { FLAG_PREFIX } from '../../content/people/ids';

export const TICKS_PER_MINUTE = Math.round(1 / TICK_MINUTES); // 4
export { TICKS_PER_DAY, TICKS_PER_HOUR };

// ───────────────────────────── numbers ─────────────────────────────

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

export function minutesToTicks(min: number): number {
  return Math.round(num(min, 0) * TICKS_PER_MINUTE);
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// ───────────────────────────── ids ─────────────────────────────

export function idNumber(id: string): number {
  const m = /^[a-z]+(\d+)$/i.exec(id);
  return m ? Number(m[1]) : NaN;
}

/** Deterministic id ordering (numeric suffix, then string). */
export function compareIds(a: string, b: string): number {
  const na = idNumber(a);
  const nb = idNumber(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function relKey(a: AgentId, b: AgentId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ───────────────────────────── flags (namespaced persistent scratch) ─────────────────────────────

function flagsOf(ctx: SimContext): Record<string, string | number | boolean> {
  const st = ctx.state as { flags?: Record<string, string | number | boolean> };
  if (!st.flags || typeof st.flags !== 'object') st.flags = {};
  return st.flags;
}

export function flagNum(ctx: SimContext, key: string, fallback: number): number {
  const v = flagsOf(ctx)[FLAG_PREFIX + key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function flagStr(ctx: SimContext, key: string): string | null {
  const v = flagsOf(ctx)[FLAG_PREFIX + key];
  return typeof v === 'string' ? v : null;
}

export function flagBool(ctx: SimContext, key: string): boolean {
  return flagsOf(ctx)[FLAG_PREFIX + key] === true;
}

export function setFlag(ctx: SimContext, key: string, value: string | number | boolean): void {
  if (typeof value === 'number' && !Number.isFinite(value)) return;
  flagsOf(ctx)[FLAG_PREFIX + key] = value;
}

export function delFlag(ctx: SimContext, key: string): void {
  delete flagsOf(ctx)[FLAG_PREFIX + key];
}

/** All flag keys (without prefix) that start with `sub`. Sorted for determinism. */
export function flagKeys(ctx: SimContext, sub: string): string[] {
  const p = FLAG_PREFIX + sub;
  return Object.keys(flagsOf(ctx))
    .filter((k) => k.startsWith(p))
    .map((k) => k.slice(FLAG_PREFIX.length))
    .sort();
}

// ───────────────────────────── agents ─────────────────────────────

export function fullName(a: AgentState | null | undefined): string {
  if (!a) return 'Someone';
  const f = typeof a.firstName === 'string' && a.firstName ? a.firstName : 'Someone';
  const l = typeof a.lastName === 'string' ? a.lastName : '';
  return l ? `${f} ${l}` : f;
}

export function firstName(a: AgentState | null | undefined): string {
  return a && typeof a.firstName === 'string' && a.firstName ? a.firstName : 'Someone';
}

export function traitIds(a: AgentState): TraitId[] {
  const t = Array.isArray(a.traits) ? a.traits : [];
  const r = Array.isArray(a.rewardTraits) ? a.rewardTraits : [];
  return [...t, ...r];
}

export function hasTrait(ctx: SimContext, a: AgentState, id: TraitId): boolean {
  try {
    if (typeof ctx.hasTrait === 'function') return ctx.hasTrait(a, id);
  } catch {
    /* fall through */
  }
  return traitIds(a).includes(id);
}

export function traitDefsOf(ctx: SimContext, a: AgentState): TraitDef[] {
  const out: TraitDef[] = [];
  for (const id of traitIds(a)) {
    const d = ctx.content.traits[id];
    if (d) out.push(d);
  }
  return out;
}

/** Product of a trait multiplier (ctx.traitMult when present). */
export function traitMult(ctx: SimContext, a: AgentState, key: string): number {
  try {
    const v = ctx.traitMult(a, key);
    if (isNum(v)) return v;
  } catch {
    /* fall through */
  }
  let m = 1;
  for (const d of traitDefsOf(ctx, a)) {
    const v = d.mult?.[key];
    if (isNum(v)) m *= v;
  }
  return m;
}

export function isHousehold(ctx: SimContext, a: AgentState): boolean {
  if (a.role !== 'household') return false;
  const ids = ctx.state.household?.memberIds;
  return Array.isArray(ids) ? ids.includes(a.id) : true;
}

export function isWalker(a: AgentState): boolean {
  return a.presence === 'onLot' && a.walkBy !== null && a.walkBy !== undefined;
}

/** A townie physically visiting (not a walk-by). */
export function isGuest(a: AgentState): boolean {
  return a.role === 'townie' && a.presence === 'onLot' && !!a.visit && !isWalker(a);
}

export function householdMembers(ctx: SimContext): AgentState[] {
  const ids = Array.isArray(ctx.state.household?.memberIds) ? ctx.state.household.memberIds : [];
  const out: AgentState[] = [];
  for (const id of ids) {
    const a = ctx.state.agents[id];
    if (a) out.push(a);
  }
  return out;
}

export function householdOnLot(ctx: SimContext): AgentState[] {
  return householdMembers(ctx).filter((a) => a.presence === 'onLot');
}

export function townies(ctx: SimContext): AgentState[] {
  return Object.keys(ctx.state.agents)
    .sort(compareIds)
    .map((id) => ctx.state.agents[id])
    .filter((a): a is AgentState => !!a && a.role === 'townie');
}

export function onLotAgents(ctx: SimContext): AgentState[] {
  return Object.keys(ctx.state.agents)
    .sort(compareIds)
    .map((id) => ctx.state.agents[id])
    .filter((a): a is AgentState => !!a && a.presence === 'onLot');
}

export function safeMood(ctx: SimContext, a: AgentState): number {
  try {
    return clamp(num(ctx.mood(a), 0), -100, 100);
  } catch {
    return 0;
  }
}

export function safeSkill(ctx: SimContext, a: AgentState, skill: Parameters<SimContext['skillLevel']>[1]): number {
  try {
    const v = ctx.skillLevel(a, skill);
    if (isNum(v)) return clamp(v, 0, 10);
  } catch {
    /* fall through */
  }
  return clamp(num(a.skills?.[skill]?.level, 0), 0, 10);
}

export function needOf(a: AgentState, need: keyof AgentState['needs']): number {
  return clamp(num(a.needs?.[need], 50), 0, 100);
}

/** Is the agent asleep / passed out right now (active run with sleep tag or sleep anim)? */
export function isSleeping(ctx: SimContext, a: AgentState): boolean {
  if (a.status?.passedOut) return true;
  const run = a.active;
  if (!run) return false;
  if (a.anim === 'sleep') return true;
  const def = ctx.content.interactions[run.interactionId];
  return !!def && Array.isArray(def.tags) && def.tags.includes('sleep');
}

export function hasQueued(a: AgentState, interactionId: string): boolean {
  if (a.active && a.active.interactionId === interactionId) return true;
  return Array.isArray(a.queue) && a.queue.some((q) => q && q.interactionId === interactionId);
}

/** Cancel every queued/active item with the given interaction id. */
export function cancelAll(ctx: SimContext, a: AgentState, interactionId: string, reason: string): void {
  if (Array.isArray(a.queue)) {
    for (const q of a.queue.slice()) if (q && q.interactionId === interactionId) ctx.cancel(a, q.uid, reason);
  }
  if (a.active && a.active.interactionId === interactionId) ctx.cancel(a, a.active.uid, reason);
}

// ───────────────────────────── relationships ─────────────────────────────

const NO_REL: Readonly<Relationship> = Object.freeze({
  a: '',
  b: '',
  friendship: 0,
  romance: 0,
  met: false,
  partners: false,
  engaged: false,
  married: false,
  bestFriends: false,
  lastInteractionTick: -1,
  interactions: 0,
});

/** Read-only view of a relationship without creating a record. */
export function peekRel(ctx: SimContext, a: AgentId, b: AgentId): Readonly<Relationship> {
  const r = ctx.state.relationships?.[relKey(a, b)];
  return r ?? NO_REL;
}

/** Relationship records involving `id` (stable order). */
export function relsOf(ctx: SimContext, id: AgentId): { other: AgentId; rel: Relationship }[] {
  const out: { other: AgentId; rel: Relationship }[] = [];
  const all = ctx.state.relationships ?? {};
  for (const key of Object.keys(all).sort()) {
    const r = all[key];
    if (!r) continue;
    if (r.a === id) out.push({ other: r.b, rel: r });
    else if (r.b === id) out.push({ other: r.a, rel: r });
  }
  return out;
}

export function isCouple(r: Readonly<Relationship>): boolean {
  return !!(r.partners || r.engaged || r.married);
}

/** The agent's current partner/fiancé(e)/spouse, if any (first by id order). */
export function partnerOf(ctx: SimContext, id: AgentId): AgentId | null {
  for (const { other, rel } of relsOf(ctx, id)) if (isCouple(rel) && ctx.state.agents[other]) return other;
  return null;
}

// ───────────────────────────── presentation ─────────────────────────────

export function bubble(ctx: SimContext, agentId: AgentId, icon: BubbleIcon, style: 'thought' | 'speech' | 'shout' = 'speech', positive?: boolean): void {
  ctx.emit({ type: 'bubble', agentId, icon, style, ...(positive === undefined ? {} : { positive }) });
}

export function voice(ctx: SimContext, agentId: AgentId, emotion: VoiceEmotion, durationMs = 1200): void {
  ctx.emit({ type: 'voice', agentId, emotion, durationMs });
}

export function sfx(ctx: SimContext, id: SfxId, opts: { pos?: Vec2; agentId?: AgentId; volume?: number } = {}): void {
  ctx.emit({ type: 'sfx', id, ...opts });
}

export function fx(ctx: SimContext, kind: FxKind, opts: { pos?: Vec2; agentId?: AgentId } = {}): void {
  ctx.emit({ type: 'fx', kind, ...opts });
}

/** Add a moodlet only if it is registered (unknown ids would only produce engine faults). */
export function grantMoodlet(ctx: SimContext, a: AgentState | null | undefined, id: MoodletId, opts?: { sourceId?: string | null; durationMin?: number }): void {
  if (!a || !ctx.content.moodlets[id]) return;
  ctx.addMoodlet(a, id, opts);
}

export function dropMoodlet(ctx: SimContext, a: AgentState | null | undefined, id: MoodletId): void {
  if (!a) return;
  if (Array.isArray(a.moodlets) && a.moodlets.some((m) => m && m.id === id)) ctx.removeMoodlet(a, id);
}

// ───────────────────────────── system api binding ─────────────────────────────

/** Duck-type check for the SimContext the engine appends to every `ctx.sys(id)` api call. */
export function isSimContext(v: unknown): v is SimContext {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<SimContext>;
  return typeof c.sys === 'function' && typeof c.emit === 'function' && !!c.state && typeof c.state === 'object' && !!c.content;
}

export interface ApiMethod {
  fn: (ctx: SimContext, ...args: any[]) => unknown;
  /** Returned when no context is available or the method throws (factory, so callers never share arrays). */
  fallback: () => unknown;
}

/**
 * Build a SimSystem.api whose methods resolve their SimContext from the trailing argument the engine appends
 * (CONTRACTS.md resolved decision #1), falling back to the context bound by the system's last hook call.
 * Every method is fault-contained: a throw returns the fallback.
 */
export function makeApi(current: () => SimContext | null, methods: Record<string, ApiMethod>): Record<string, (...args: any[]) => any> {
  const api: Record<string, (...args: any[]) => any> = {};
  for (const [name, m] of Object.entries(methods)) {
    api[name] = (...args: unknown[]) => {
      let ctx: SimContext | null = null;
      if (args.length > 0 && isSimContext(args[args.length - 1])) ctx = args.pop() as SimContext;
      ctx = ctx ?? current();
      if (!ctx) return m.fallback();
      try {
        return m.fn(ctx, ...args);
      } catch {
        return m.fallback();
      }
    };
  }
  return api;
}

// ───────────────────────────── rng helpers ─────────────────────────────

export function pickOne<T>(ctx: SimContext, arr: readonly T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.min(arr.length - 1, Math.floor(ctx.rng.next() * arr.length))] ?? null;
}

/** Hour window test that wraps midnight; from === to means always. */
export function hourInWindow(hour: number, from: number, to: number): boolean {
  if (!isNum(hour) || !isNum(from) || !isNum(to)) return false;
  if (from === to) return true;
  if (from < to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}

export function distance(a: Vec2, b: Vec2): number {
  const dx = num(a?.x, 0) - num(b?.x, 0);
  const dz = num(a?.z, 0) - num(b?.z, 0);
  return Math.sqrt(dx * dx + dz * dz);
}

export function difficultyDecay(ctx: SimContext): number {
  const d = ctx.state.settings?.difficulty;
  return d === 'relaxed' ? 0.7 : d === 'grim' ? 1.3 : 1;
}

export function difficultyPreservation(ctx: SimContext): number {
  const d = ctx.state.settings?.difficulty;
  return d === 'relaxed' ? 0.6 : d === 'grim' ? 1.4 : 1;
}
