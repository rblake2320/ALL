/**
 * Sim events → Bones grant candidates (docs/MONETIZATION.md §2). PURE.
 *
 *  - `questCompleted` (emitted by the sim `quests` system) carries `grant: QuestRewardGrant` with a stable WORLD grant
 *    id (`<worldId>:<questId>:<instance>`) and its reward. The event is read structurally (the sim adds it to the
 *    SimEvent union).
 *  - Achievements: aspiration milestones, promotions and skill levels map to grants keyed by the world identity
 *    (QuestsState.worldId, falling back to `w<seed>`) + the achievement, e.g. `w1a2b:milestone:a3:asp:m1`.
 *  - Worlds where a cheat was used (`state.flags.cheated`) earn no Bones.
 * Amounts are clamped (a corrupt or edited event can never mint more than MAX_QUEST_BONES at once).
 *
 * The world id is SAVE DATA (security review 2026-11-05, H-1 / D-1): an edited or shared save can carry any worldId
 * and `flags.cheated: false`, and its SHA-256 checksums can be recomputed. So these ids are NOT the ledger's
 * idempotency keys on their own and a save never decides eligibility: grantPolicy.ts maps them to PROFILE keys
 * (one-time quests once per profile; repeatable grants capped per profile per day) and the EconomyService only
 * reconciles recorded grants of worlds this profile created (worldRegistry.ts). An unmodified copy of a save shares
 * the worldId and pays nothing twice; a re-keyed copy is contained by the profile rules above.
 */
import type { QuestDef } from '../sim/contracts';
import type { QuestRewardGrant } from '../shared/economy';
import { ALL_QUESTS } from '../sim/content/quests';
import { dayOfTick } from '../sim/systems/quests/state';
import { ENTITLEMENT_RE, KEY_RE, cleanReason } from './ledger';

export const MAX_QUEST_BONES = 1000;
export const ACHIEVEMENT_BONES = { milestone: 25, promotion: 30, skill: 5 } as const;

/** Anything event-shaped (the SimEvent union is owned by the sim; we only read the fields we need). */
export type EventLike = { type?: unknown; [k: string]: unknown };

export interface WorldLike {
  seed?: unknown;
  flags?: Record<string, unknown>;
}

const seg = (v: unknown): string => String(v ?? '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40) || '_';

export function worldKey(world: WorldLike | null | undefined): string | null {
  // The sim's world id (QuestsState.worldId — derived once, shared by unmodified copies; editable save data, see header).
  const q = (world as { quests?: { worldId?: unknown } } | null | undefined)?.quests?.worldId;
  if (typeof q === 'string' && /^[A-Za-z0-9_.-]{1,96}$/.test(q)) return q;
  const s = world?.seed;
  if (typeof s !== 'number' || !Number.isFinite(s)) return null;
  return `w${(s >>> 0).toString(36)}`;
}

export function worldCheated(world: WorldLike | null | undefined): boolean {
  return world?.flags?.cheated === true;
}

function clampBones(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(MAX_QUEST_BONES, Math.floor(v)) : 0;
}

/** Read the Bones reward of a questCompleted event (accepts `bones`, `rewards.bones` or `reward.bones`). */
function questBones(e: EventLike): number {
  const direct = clampBones(e.bones);
  if (direct > 0) return direct;
  for (const k of ['rewards', 'reward']) {
    const r = e[k];
    if (r && typeof r === 'object') {
      const b = clampBones((r as Record<string, unknown>).bones);
      if (b > 0) return b;
    }
  }
  return 0;
}

function questEntitlements(e: EventLike): string[] | undefined {
  for (const src of [e.entitlements, (e.rewards as Record<string, unknown> | undefined)?.entitlements]) {
    if (Array.isArray(src)) {
      const ok = src.filter((x): x is string => typeof x === 'string' && ENTITLEMENT_RE.test(x)).slice(0, 16);
      if (ok.length > 0) return ok;
    }
  }
  return undefined;
}

/** Convert one batch of sim events into grants (order preserved, duplicates inside the batch removed). */
export function grantsFromEvents(events: readonly unknown[], world: WorldLike | null | undefined): QuestRewardGrant[] {
  if (!Array.isArray(events) || events.length === 0 || worldCheated(world)) return [];
  const wk = worldKey(world);
  const out: QuestRewardGrant[] = [];
  const seen = new Set<string>();
  const push = (g: QuestRewardGrant) => {
    if (!KEY_RE.test(g.grantId) || seen.has(g.grantId)) return;
    if (g.bones <= 0 && !(g.entitlements && g.entitlements.length)) return;
    seen.add(g.grantId);
    out.push(g);
  };
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as EventLike;
    try {
      switch (e.type) {
        case 'questCompleted': {
          // Contract (src/sim/contracts.ts): { questId, instance, grantId, title, grant: QuestRewardGrant }.
          const g = e.grant && typeof e.grant === 'object' ? (e.grant as EventLike) : null;
          const grantId = typeof g?.grantId === 'string' ? g.grantId : typeof e.grantId === 'string' ? e.grantId : null;
          if (!grantId) break;
          const title = typeof e.title === 'string' ? e.title : typeof e.questId === 'string' ? e.questId : 'Quest';
          const ents = (g && questEntitlements(g)) ?? questEntitlements(e);
          const bones = (g && questBones(g)) || questBones(e);
          push({ grantId, bones, ...(ents ? { entitlements: ents } : {}), reason: cleanReason(`Quest complete: ${title}`) });
          break;
        }
        case 'milestone':
          if (!wk) break;
          push({ grantId: `${wk}:milestone:${seg(e.agentId)}:${seg(e.aspirationId)}:${seg(e.milestoneId)}`, bones: ACHIEVEMENT_BONES.milestone, reason: 'Aspiration milestone' });
          break;
        case 'promotion':
          if (!wk || !Number.isInteger(e.level)) break;
          push({ grantId: `${wk}:promotion:${seg(e.agentId)}:${seg(e.level)}`, bones: ACHIEVEMENT_BONES.promotion, reason: cleanReason(`Promotion: ${typeof e.title === 'string' ? e.title : 'new job title'}`) });
          break;
        case 'skillUp':
          if (!wk || !Number.isInteger(e.level)) break;
          push({ grantId: `${wk}:skill:${seg(e.agentId)}:${seg(e.skill)}:${seg(e.level)}`, bones: ACHIEVEMENT_BONES.skill, reason: 'Skill level up' });
          break;
        default:
          break;
      }
    } catch {
      /* malformed event: skipped (fault barrier) */
    }
  }
  return out;
}

const QUEST_DEFS: ReadonlyMap<string, QuestDef> = new Map(ALL_QUESTS.map((q) => [q.id, q]));

/**
 * Grants to re-request from a loaded world's `quests.grants` record (a completion whose event was lost to a crash).
 * The record is SAVE DATA — user-editable — so it is never trusted for amounts or entitlements: each record must name
 * a shipped quest, carry exactly the grant id the sim would have produced (`<worldId>:<questId>:<instance>`), use
 * instance 1 for one-off quests and a plausible instance for repeatable ones (≤ one per cooldown since day 0), and is
 * paid the quest DEFINITION's reward. Anything else is ignored (never paid). Pure.
 */
export function reconcileGrants(world: (WorldLike & { tick?: unknown; quests?: { grants?: unknown } }) | null | undefined): QuestRewardGrant[] {
  if (!world || worldCheated(world)) return [];
  const wk = worldKey(world);
  const records = world.quests?.grants;
  if (!wk || !Array.isArray(records)) return [];
  const day = dayOfTick(typeof world.tick === 'number' ? world.tick : 0);
  const out: QuestRewardGrant[] = [];
  const seen = new Set<string>();
  for (const raw of records.slice(-256)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const def = typeof r.questId === 'string' ? QUEST_DEFS.get(r.questId) : undefined;
    const inst = r.instance;
    if (!def || typeof inst !== 'number' || !Number.isSafeInteger(inst) || inst < 1) continue;
    if (!def.repeat ? inst !== 1 : inst > Math.floor(day / Math.max(1, def.repeat.cooldownDays)) + 1) continue;
    const grantId = `${wk}:${def.id}:${inst}`;
    if (r.grantId !== grantId || seen.has(grantId) || !KEY_RE.test(grantId)) continue;
    seen.add(grantId);
    const ents = (def.reward.entitlements ?? []).filter((e) => ENTITLEMENT_RE.test(e));
    out.push({ grantId, bones: clampBones(def.reward.bones), ...(ents.length ? { entitlements: ents } : {}), reason: cleanReason(`Quest complete: ${def.title}`) });
  }
  return out;
}
