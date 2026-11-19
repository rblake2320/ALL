/**
 * Profile registry of world identities (security review 2026-11-05, H-1). PURE data helpers; the EconomyService
 * keeps it in the ProfileStore under PROFILE_KEYS.worlds.
 *
 *  - 'native'   — this profile created the world (new game). Only native worlds have their recorded quest grants
 *                 reconciled (crash recovery), because only for them do we know the record was produced here.
 *  - 'imported' — the world arrived through the save importer (a file: possibly edited, possibly shared). Never
 *                 reconciled; the quest instances already in progress / recorded in the file at import (`pre`) are not
 *                 paid when they complete. Importing a file whose worldId matches a native world downgrades it.
 *  - unregistered — a slot this profile never saw created (saved before this registry existed, or a file dropped
 *                 into the saves folder): new progress earns, nothing is reconciled.
 * `cheated` is sticky: once the profile saw a world flagged `flags.cheated`, editing the save back to `false` does
 * not make it eligible again.
 *
 * The registry is local, unkeyed profile data like the ledger (M-1): it stops shared/forged save FILES, not a user
 * editing their own profile storage. Bounded (MAX_WORLDS, oldest evicted first; an evicted world simply becomes
 * unregistered, which only ever removes eligibility — fail closed).
 */
export const WORLD_REGISTRY_VERSION = 1;
export const MAX_WORLDS = 512;
export const MAX_PRE = 64;
const ID_RE = /^[A-Za-z0-9_.-]{1,96}$/;
const GRANT_RE = /^[A-Za-z0-9:_.-]{1,160}$/;

export type WorldOrigin = 'native' | 'imported';

export interface WorldRecord {
  origin: WorldOrigin;
  /** Sticky: the profile saw this world cheat. */
  cheated: boolean;
  /** Imported worlds: world grant ids that were in progress / recorded in the imported file (never paid). */
  pre: string[];
  /** ms when (re)registered — eviction order. */
  at: number;
}

export interface WorldRegistry {
  v: number;
  worlds: Record<string, WorldRecord>;
}

export function emptyRegistry(): WorldRegistry {
  return { v: WORLD_REGISTRY_VERSION, worlds: Object.create(null) as Record<string, WorldRecord> };
}

/** Sanitise a stored registry (junk entries dropped; never throws). */
export function sanitizeRegistry(raw: unknown): WorldRegistry {
  const out = emptyRegistry();
  const w = raw && typeof raw === 'object' ? (raw as { worlds?: unknown }).worlds : null;
  if (!w || typeof w !== 'object' || Array.isArray(w)) return out;
  for (const [id, r] of Object.entries(w as Record<string, unknown>).slice(0, MAX_WORLDS * 2)) {
    if (!ID_RE.test(id) || !r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    if (rec.origin !== 'native' && rec.origin !== 'imported') continue;
    const pre = Array.isArray(rec.pre) ? rec.pre.filter((x): x is string => typeof x === 'string' && GRANT_RE.test(x)).slice(0, MAX_PRE) : [];
    out.worlds[id] = { origin: rec.origin, cheated: rec.cheated === true, pre, at: typeof rec.at === 'number' && Number.isFinite(rec.at) ? rec.at : 0 };
  }
  return evict(out);
}

function evict(r: WorldRegistry): WorldRegistry {
  const ids = Object.keys(r.worlds);
  if (ids.length <= MAX_WORLDS) return r;
  ids.sort((a, b) => r.worlds[a].at - r.worlds[b].at || (a < b ? -1 : 1));
  for (const id of ids.slice(0, ids.length - MAX_WORLDS)) delete r.worlds[id];
  return r;
}

export function isWorldId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

/** A world this profile created. Never overrides an 'imported' or 'cheated' record (fail closed). */
export function registerNative(r: WorldRegistry, id: string, at: number): boolean {
  if (!isWorldId(id) || r.worlds[id]) return false;
  r.worlds[id] = { origin: 'native', cheated: false, pre: [], at };
  evict(r);
  return true;
}

/** A world that arrived through the importer: never reconciled; `pre` = grant ids contained in the file. */
export function registerImported(r: WorldRegistry, id: string, pre: readonly string[], at: number): boolean {
  if (!isWorldId(id)) return false;
  const prev = r.worlds[id];
  const merged = new Set([...(prev?.pre ?? []), ...pre.filter((x) => GRANT_RE.test(x))]);
  r.worlds[id] = { origin: 'imported', cheated: prev?.cheated === true, pre: [...merged].slice(-MAX_PRE), at };
  evict(r);
  return true;
}

export function markCheated(r: WorldRegistry, id: string, at: number): boolean {
  if (!isWorldId(id)) return false;
  const prev = r.worlds[id];
  if (prev?.cheated) return false;
  // Unknown world seen cheating: remember it (as imported = least trusted) so the flag sticks.
  r.worlds[id] = prev ? { ...prev, cheated: true } : { origin: 'imported', cheated: true, pre: [], at };
  evict(r);
  return true;
}

/** Recorded quest grants of this world may be reconciled (re-requested) — native, never cheated. */
export function mayReconcile(r: WorldRegistry, id: string | null): boolean {
  if (!id) return false;
  const rec = r.worlds[id];
  return !!rec && rec.origin === 'native' && !rec.cheated;
}

export function isCheated(r: WorldRegistry, id: string | null): boolean {
  return !!id && r.worlds[id]?.cheated === true;
}

/** The world grant id was already in progress / recorded in an imported file (not progress made here). */
export function isPreexisting(r: WorldRegistry, id: string | null, worldGrantId: string): boolean {
  if (!id) return false;
  const rec = r.worlds[id];
  return !!rec && rec.origin === 'imported' && rec.pre.includes(worldGrantId);
}

/** Grant ids an imported world already carries: active quest instances + recorded grants (bounded). */
export function grantIdsInWorld(world: unknown, worldId: string): string[] {
  const q = world && typeof world === 'object' ? (world as { quests?: unknown }).quests : null;
  if (!q || typeof q !== 'object') return [];
  const out: string[] = [];
  const qs = q as { active?: unknown; grants?: unknown };
  if (Array.isArray(qs.active)) {
    for (const a of qs.active.slice(0, MAX_PRE)) {
      const r = a as { questId?: unknown; instance?: unknown } | null;
      if (r && typeof r.questId === 'string' && Number.isSafeInteger(r.instance)) out.push(`${worldId}:${r.questId}:${r.instance as number}`);
    }
  }
  if (Array.isArray(qs.grants)) {
    for (const g of qs.grants.slice(-MAX_PRE)) {
      const r = g as { grantId?: unknown } | null;
      if (r && typeof r.grantId === 'string') out.push(r.grantId);
    }
  }
  return out.filter((x) => GRANT_RE.test(x)).slice(-MAX_PRE);
}
