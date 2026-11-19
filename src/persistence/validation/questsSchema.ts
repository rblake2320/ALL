/**
 * Structural schema for WorldState.quests (src/sim/types.ts QuestsState; src/sim/systems/quests). The field is
 * OPTIONAL: a save without it (written before quests existed) validates with NO issue and stays without the key; the
 * quests system creates it on init. A present-but-broken quests block is dropped (reported) — the sim recreates it and
 * the profile ledger's grant-id de-duplication keeps already-paid rewards from being paid twice. Semantic healing
 * (unknown quest ids, instance numbering) is the quests system's job.
 */
import type { ObjectiveProgress, QuestArcLog, QuestGrantRecord, QuestInstanceState, QuestsState } from '../../sim/types';
import { type Check, INVALID, arr, bool, lit, nullable, num, obj, rec, str } from './core';

export const QUEST_LIMITS = { maxActive: 16, maxGrants: 256, maxSeen: 64, maxQuests: 1024, maxId: 160 } as const;

const qid = str({ nonEmpty: true, max: QUEST_LIMITS.maxId });
const tick = num({ def: 0 });

/** An OPTIONAL field (W-116): absent stays absent silently; a broken value is dropped with a note (never fatal). */
function optional<T>(check: Check<T>, what: string): Check<T | undefined> {
  return (v, ctx) => {
    if (v === undefined) return undefined;
    const r = check(v, ctx);
    if (r !== INVALID) return r;
    ctx.report('dropped', `${ctx.lastError.message}; ${what} reset`);
    return undefined;
  };
}

const progressSchema: Check<ObjectiveProgress> = obj<ObjectiveProgress>({
  progress: num({ min: 0, def: 0 }),
  baseline: num({ def: 0 }),
  heldMin: num({ min: 0, def: 0 }),
  startTick: tick,
  startDay: num({ int: true, min: 1, def: 1 }),
  seen: arr(str({ max: 200 }), { def: () => [], max: QUEST_LIMITS.maxSeen, keep: 'last' }),
  worldId: str({ max: QUEST_LIMITS.maxId, def: '' }),
  done: bool(false),
  credited: optional(num({ int: true, min: 0, max: 1000, strict: true }), 'credit note'),
}, {
  // obj() writes every shape key: an absent optional field stays ABSENT (canonical JSON rejects undefined; old saves
  // round-trip byte-identically)
  post: (p) => {
    if (p.credited === undefined) delete p.credited;
    return p;
  },
});

const arcLogSchema: Check<QuestArcLog> = obj<QuestArcLog>({
  arc: str({ nonEmpty: true, max: 32 }),
  startTick: num({ int: true, min: 0, strict: true }),
  walls: num({ int: true, min: 0, def: 0 }),
  nextId: num({ int: true, min: 0, def: 0 }),
  counts: rec(num({ int: true, min: 0, max: 1000 }), { def: () => ({}), maxKeys: QUEST_LIMITS.maxQuests }),
  seen: arr(str({ max: 200 }), { def: () => [], max: QUEST_LIMITS.maxSeen, keep: 'last' }),
});

const instanceSchema: Check<QuestInstanceState> = obj<QuestInstanceState>({
  questId: qid,
  instance: num({ int: true, min: 1, def: 1 }),
  startedTick: tick,
  stepIndex: num({ int: true, min: 0, def: 0 }),
  step: progressSchema,
});

const grantSchema: Check<QuestGrantRecord> = obj<QuestGrantRecord>({
  grantId: str({ nonEmpty: true, max: 400 }),
  questId: qid,
  instance: num({ int: true, min: 1, strict: true }),
  tick,
  bones: num({ int: true, min: 0, def: 0 }),
  entitlements: arr(str({ nonEmpty: true, max: 128 }), { def: () => [], max: 32, unique: true }),
});

const stateSchema: Check<QuestsState> = obj<QuestsState>({
  version: lit([1] as const),
  worldId: str({ nonEmpty: true, max: QUEST_LIMITS.maxId }),
  active: arr(instanceSchema, { def: () => [], max: QUEST_LIMITS.maxActive }),
  completions: rec(num({ int: true, min: 0 }), { def: () => ({}), maxKeys: QUEST_LIMITS.maxQuests }),
  lastEndedDay: rec(num({ int: true }), { def: () => ({}), maxKeys: QUEST_LIMITS.maxQuests }),
  grants: arr(grantSchema, { def: () => [], max: QUEST_LIMITS.maxGrants, keep: 'last' }),
  pinned: nullable(qid),
  arcLog: optional(arcLogSchema, 'story-arc credit log'),
}, {
  post: (q) => {
    if (q.arcLog === undefined) delete q.arcLog;
    return q;
  },
});

export const questsSchema: Check<QuestsState | undefined> = (v, ctx) => {
  if (v === undefined) return undefined; // pre-quests save: absent stays absent, silently
  const r = stateSchema(v, ctx);
  if (r !== INVALID) return r;
  ctx.report('dropped', `${ctx.lastError.message}; quest progress reset`);
  return undefined;
};
