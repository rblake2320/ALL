/**
 * Quest save state (WorldState.quests): creation, the stable world id, and self-healing of loaded data.
 * Healing is a true no-op on a healthy state (decision #9): it only writes a field it actually has to fix.
 */
import type { QuestDef } from '../../contracts';
import type { ObjectiveProgress, QuestGrantRecord, QuestInstanceState, QuestsState, WorldState } from '../../types';
import { timeInfo } from '../../time';

export const QUESTS_VERSION = 1 as const;
export const MAX_GRANTS = 256;
export const MAX_ACTIVE = 16;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** FNV-1a 32-bit (deterministic, platform-independent). */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Stable world id, derived ONCE from the world itself (seed, RNG state, household, tick) and then stored. No clock or
 * randomness: replaying the same new game or re-loading the same old save always derives the same id, so a replayed
 * completion maps to the same grant id. Unmodified copies of a save slot share it on purpose. It is save data, so the
 * profile economy never trusts it for eligibility (src/economy/grantPolicy.ts — security review H-1).
 */
export function deriveWorldId(state: WorldState): string {
  const seed = (isNum(state.seed) ? state.seed : 0) >>> 0;
  const r = state.rng;
  const h = state.household;
  const names = (h && Array.isArray(h.memberIds) ? h.memberIds : [])
    .map((id) => {
      const a = state.agents ? state.agents[id] : undefined;
      return a ? `${id}=${a.firstName}/${a.lastName}` : id;
    })
    .join(',');
  const src = [seed, r ? `${r.a},${r.b},${r.c},${r.d}` : '', h ? h.name : '', names, state.tick, state.nextId].join('|');
  return `w${seed.toString(36)}-${fnv1a(src).toString(36)}${fnv1a(`${src}#2`).toString(36)}`;
}

export function createQuestsState(state: WorldState): QuestsState {
  return { version: QUESTS_VERSION, worldId: deriveWorldId(state), active: [], completions: {}, lastEndedDay: {}, grants: [], pinned: null };
}

export function grantIdOf(worldId: string, questId: string, instance: number): string {
  return `${worldId}:${questId}:${instance}`;
}

export function dayOfTick(tick: number): number {
  return timeInfo(Math.floor(isNum(tick) && tick > 0 ? tick : 0)).day;
}

function healProgress(p: unknown, tick: number, worldId: string): ObjectiveProgress | null {
  if (!isRec(p)) return null;
  const q = p as unknown as ObjectiveProgress;
  if (!isNum(q.progress) || q.progress < 0) q.progress = 0;
  if (!isNum(q.baseline)) q.baseline = 0;
  if (!isNum(q.heldMin) || q.heldMin < 0) q.heldMin = 0;
  if (!isNum(q.startTick)) q.startTick = tick;
  if (!isNum(q.startDay)) q.startDay = dayOfTick(q.startTick);
  if (!Array.isArray(q.seen) || q.seen.some((k) => typeof k !== 'string')) q.seen = Array.isArray(q.seen) ? q.seen.filter((k) => typeof k === 'string') : [];
  if (typeof q.worldId !== 'string') q.worldId = worldId;
  if (typeof q.done !== 'boolean') q.done = false;
  return q;
}

/**
 * Make `state.quests` structurally valid against the known quest defs. Returns a list of what was fixed (empty when
 * the state was healthy and nothing was written).
 */
export function healQuestsState(state: WorldState, defs: ReadonlyMap<string, QuestDef>): string[] {
  const fixes: string[] = [];
  if (!isRec(state.quests)) {
    state.quests = createQuestsState(state);
    fixes.push('quest state created');
    return fixes;
  }
  const q = state.quests;
  const tick = isNum(state.tick) ? state.tick : 0;
  if (q.version !== QUESTS_VERSION) {
    q.version = QUESTS_VERSION;
    fixes.push('version');
  }
  if (typeof q.worldId !== 'string' || q.worldId.length === 0 || q.worldId.length > 96) {
    q.worldId = deriveWorldId(state);
    fixes.push('worldId');
  }
  if (!isRec(q.completions)) {
    q.completions = {};
    fixes.push('completions');
  }
  for (const k of Object.keys(q.completions)) {
    const v = q.completions[k];
    if (!isNum(v) || v < 0 || !Number.isInteger(v)) {
      delete q.completions[k];
      fixes.push(`completions.${k}`);
    }
  }
  if (!isRec(q.lastEndedDay)) {
    q.lastEndedDay = {};
    fixes.push('lastEndedDay');
  }
  for (const k of Object.keys(q.lastEndedDay)) {
    if (!isNum(q.lastEndedDay[k])) {
      delete q.lastEndedDay[k];
      fixes.push(`lastEndedDay.${k}`);
    }
  }
  if (!Array.isArray(q.grants)) {
    q.grants = [];
    fixes.push('grants');
  }
  const seenGrant = new Set<string>();
  const grants: QuestGrantRecord[] = [];
  for (const g of q.grants) {
    if (!isRec(g) || typeof g.grantId !== 'string' || typeof g.questId !== 'string' || !isNum(g.instance) || seenGrant.has(g.grantId)) {
      fixes.push('grants entry');
      continue;
    }
    if (!isNum(g.bones) || g.bones < 0) g.bones = 0;
    if (!isNum(g.tick)) g.tick = 0;
    if (!Array.isArray(g.entitlements)) g.entitlements = [];
    seenGrant.add(g.grantId);
    grants.push(g);
  }
  if (grants.length !== q.grants.length) q.grants = grants;
  if (q.grants.length > MAX_GRANTS) {
    q.grants.splice(0, q.grants.length - MAX_GRANTS);
    fixes.push('grants trimmed');
  }
  // A completion counter can never be below an instance that was already granted (the next instance would reuse a
  // grant id the ledger has already paid).
  for (const g of q.grants) {
    if ((own(q.completions, g.questId) ? q.completions[g.questId] : 0) < g.instance) {
      q.completions[g.questId] = g.instance;
      fixes.push(`completions.${g.questId} raised`);
    }
  }
  if (!Array.isArray(q.active)) {
    q.active = [];
    fixes.push('active');
  }
  const kept: QuestInstanceState[] = [];
  const ids = new Set<string>();
  for (const inst of q.active) {
    if (!isRec(inst) || typeof inst.questId !== 'string' || ids.has(inst.questId)) {
      fixes.push('active entry');
      continue;
    }
    const def = defs.get(inst.questId);
    if (!def || def.steps.length === 0) {
      fixes.push(`active ${inst.questId} (unknown quest) dropped`);
      continue;
    }
    const done = own(q.completions, inst.questId) ? q.completions[inst.questId] : 0;
    if (!def.repeat && done > 0) {
      fixes.push(`active ${inst.questId} (already completed) dropped`);
      continue;
    }
    if (!isNum(inst.instance) || !Number.isInteger(inst.instance) || inst.instance !== done + 1) {
      inst.instance = done + 1;
      fixes.push(`active ${inst.questId}.instance`);
    }
    if (!isNum(inst.startedTick)) {
      inst.startedTick = tick;
      fixes.push(`active ${inst.questId}.startedTick`);
    }
    if (!isNum(inst.stepIndex) || !Number.isInteger(inst.stepIndex) || inst.stepIndex < 0 || inst.stepIndex >= def.steps.length) {
      inst.stepIndex = Math.max(0, Math.min(def.steps.length - 1, isNum(inst.stepIndex) ? Math.floor(inst.stepIndex) : 0));
      fixes.push(`active ${inst.questId}.stepIndex`);
    }
    const before = JSON.stringify(inst.step);
    const p = healProgress(inst.step, tick, q.worldId);
    if (!p) {
      inst.step = { progress: 0, baseline: 0, heldMin: 0, startTick: tick, startDay: dayOfTick(tick), seen: [], worldId: q.worldId, done: false };
      fixes.push(`active ${inst.questId}.step reset`);
    } else if (JSON.stringify(p) !== before) fixes.push(`active ${inst.questId}.step`);
    ids.add(inst.questId);
    kept.push(inst);
  }
  if (kept.length > MAX_ACTIVE) {
    kept.length = MAX_ACTIVE;
    fixes.push('active trimmed');
  }
  if (kept.length !== q.active.length) q.active = kept;
  if (q.pinned !== null && (typeof q.pinned !== 'string' || !ids.has(q.pinned))) {
    q.pinned = null;
    fixes.push('pinned');
  }
  return fixes;
}
