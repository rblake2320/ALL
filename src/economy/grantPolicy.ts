/**
 * Profile-level grant eligibility (security review 2026-11-05, H-1 / D-1). PURE.
 *
 * The world grant ids built by grants.ts (`<worldId>:<questId>:<instance>`, `<worldKey>:milestone:…`) embed
 * `quests.worldId`, which is SAVE DATA: an edited or shared `.alsave` can carry any worldId (SHA-256 has no key, so
 * the file can be resealed). A ledger key built from it would let every re-keyed copy pay again. So the profile —
 * the same store as the Bones ledger — decides what is paid, never the save:
 *
 *  - ONE-TIME grants (one-off quests) are keyed per PROFILE: `profile:<questId>:1`. Completing the same story quest
 *    in a second world, a copy, or a forged world pays nothing more. Ledgers written before this rule keyed them
 *    `<worldId>:<questId>:1`; any such entry counts as already paid (migration without double pay).
 *  - REPEATABLE grants (repeatable quests, achievements) stay per world (`r:<world grant id>`; the unprefixed legacy
 *    key also counts as paid) and are CAPPED per profile per local calendar day across ALL worlds
 *    (REPEATABLE_BONES_PER_DAY), computed from the ledger itself under the ledger lock.
 *  - Reconciliation of a save's recorded grants (crash recovery) only runs for worlds this profile created
 *    (worldRegistry.ts, origin 'native'); imported / unknown worlds are never reconciled, and quest instances that
 *    were already in progress inside an imported file are not paid when they complete (only progress made after the
 *    import on this profile earns).
 *  - A save's `flags.cheated` can only make a world ineligible (a `true` is sticky in the profile registry); a
 *    `false` in the save is never evidence of eligibility.
 *
 * Offline limit: the profile store and the ledger are local, unkeyed data (M-1). This closes the cheap, SHAREABLE
 * exploit (a "free Bones save"); a user who edits their own profile storage can still forge Bones locally. The
 * future server (W-096/W-099) must never import local balances or grants as truth.
 */
import type { LedgerEntry, QuestRewardGrant } from '../shared/economy';
import type { QuestDef } from '../sim/contracts';
import { ALL_QUESTS } from '../sim/content/quests';
import { localDayKey } from './daily';
import { KEY_RE } from './ledger';

/** Profile-wide Bones/day ceiling for REPEATABLE world grants (repeatable quests + achievements), all worlds. */
export const REPEATABLE_BONES_PER_DAY = 600;
export const PROFILE_GRANT_PREFIX = 'profile:';
export const REPEATABLE_GRANT_PREFIX = 'r:';

const QUEST_DEFS: ReadonlyMap<string, QuestDef> = new Map(ALL_QUESTS.map((q) => [q.id, q]));
const QUEST_GRANT_RE = /^([A-Za-z0-9_.-]{1,96}):([A-Za-z0-9_.-]{1,64}):([1-9][0-9]{0,8})$/;

export type GrantClass = 'once' | 'repeatable';

export interface ProfileGrant {
  /** Ledger idempotency key (profile-scoped for one-time grants). */
  key: string;
  /** Keys written by older builds for the same grant: any of them present = already paid. */
  legacyKeys: readonly string[];
  /** For one-time quests: the quest id (legacy `<anyWorld>:<questId>:1` keys count as paid). */
  onceQuestId: string | null;
  cls: GrantClass;
  /** The world grant id the sim produced (`<worldId>:<questId>:<instance>` or an achievement id). */
  worldGrantId: string;
}

/** Parse a sim quest grant id; null for achievement ids and junk. */
export function parseQuestGrantId(id: string): { worldId: string; questId: string; instance: number } | null {
  const m = QUEST_GRANT_RE.exec(id);
  if (!m) return null;
  return { worldId: m[1], questId: m[2], instance: Number(m[3]) };
}

/**
 * Map a world grant to its profile ledger key. `isQuest` = it came from a questCompleted event / quest record
 * (achievement ids are never one-time). Unknown quest ids (not shipped content) are one-time when instance 1.
 */
export function profileGrantOf(g: Pick<QuestRewardGrant, 'grantId'>, isQuest: boolean): ProfileGrant | null {
  const id = g.grantId;
  if (typeof id !== 'string' || !KEY_RE.test(id)) return null;
  const q = isQuest ? parseQuestGrantId(id) : null;
  if (q) {
    const def = QUEST_DEFS.get(q.questId);
    const once = def ? !def.repeat : q.instance === 1;
    if (once) {
      if (q.instance !== 1) return null; // a one-off quest has exactly one instance
      const key = `${PROFILE_GRANT_PREFIX}${q.questId}:1`;
      return KEY_RE.test(key) ? { key, legacyKeys: [], onceQuestId: q.questId, cls: 'once', worldGrantId: id } : null;
    }
  }
  const key = `${REPEATABLE_GRANT_PREFIX}${id}`;
  if (!KEY_RE.test(key)) return null;
  return { key, legacyKeys: [id], onceQuestId: null, cls: 'repeatable', worldGrantId: id };
}

/** Whether the ledger (its key set) already paid this grant — under the new key or any key an older build used. */
export function alreadyPaid(keys: ReadonlySet<string>, g: ProfileGrant): boolean {
  if (keys.has(g.key)) return true;
  for (const k of g.legacyKeys) if (keys.has(k)) return true;
  if (g.onceQuestId) {
    const suffix = `:${g.onceQuestId}:1`;
    for (const k of keys) {
      // `<worldId>:<questId>:1` exactly (three segments): achievement keys have more segments and never match.
      if (k.endsWith(suffix) && k.indexOf(':') === k.length - suffix.length) return true;
    }
  }
  return false;
}

/** Bones already granted today (local calendar day of `nowMs`) by REPEATABLE world grants, from the ledger. */
export function repeatableBonesToday(entries: readonly LedgerEntry[], nowMs: number): number {
  const today = localDayKey(new Date(nowMs));
  let sum = 0;
  // Newest first; entries are appended in time order, so stop at the first older day (clock games aside).
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t)) continue;
    const day = localDayKey(new Date(t));
    if (day < today) break;
    if (day !== today) continue;
    if (e.kind === 'grant' && e.currency === 'bones' && e.key.startsWith(REPEATABLE_GRANT_PREFIX)) sum += e.amount;
  }
  return sum;
}

/** Whether a repeatable grant of `bones` still fits under today's profile cap. */
export function withinDailyCap(entries: readonly LedgerEntry[], nowMs: number, bones: number): boolean {
  return repeatableBonesToday(entries, nowMs) + Math.max(0, bones) <= REPEATABLE_BONES_PER_DAY;
}
