/**
 * World save SIZE BUDGET (W-025 S2; docs/DESIGN_WORLD_LEVELS.md §1.11 table, AC-12). Pure and deterministic.
 *
 * Sizes are bytes of UTF-8 JSON with sorted keys and no whitespace — byte for byte the canonical JSON the
 * SaveManager hashes and stores (src/persistence/canonicalJson.ts), computed here without depending on persistence.
 *
 * | Item                                    | Hard limit                          |
 * |-----------------------------------------|-------------------------------------|
 * | lot snapshot, furnished residential      | 200 KB                              |
 * | lot snapshot, community (park, venues)   | 120 KB                              |
 * | street snapshot (dropped items only)     | 8 KB                                |
 * | whole world                              | target ≤ 2 MB, hard cap 4 MB        |
 *
 * Over the 4 MB cap the OLDEST NEVER-MODIFIED neighbour snapshots are dropped (they regenerate from the seed):
 * `capWorldSize`. Wiring (S4): streaming (src/sim/engine/streaming.ts) calls it each time a region goes dormant (the
 * only time a snapshot is written), after trimming that snapshot to its own hard limit.
 */
import type { RegionId, RegionKind, RegionSnapshot, TownStateV2 } from './world';

export const KB = 1024;
export const MB = 1024 * KB;

export const SAVE_BUDGET = {
  lotResidentialMax: 200 * KB,
  lotCommunityMax: 120 * KB,
  streetMax: 8 * KB,
  worldTarget: 2 * MB,
  worldHardCap: 4 * MB,
} as const;

/** Community lot regions of the v1 map (the rest of the lot regions are residential). */
export const COMMUNITY_REGION_IDS: readonly RegionId[] = ['wormwood:corner_park', 'graveyard:old_graveyard'];

/** `RegionSnapshot.data` key S4 sets when the player changed the region (such a snapshot is never dropped). */
export const SNAPSHOT_MODIFIED_KEY = 'modifiedTick';

const enc = new TextEncoder();

/** Canonical JSON text (sorted keys, no whitespace; the bytes `jsonBytes` counts). */
export function sortedJson(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    const s = JSON.stringify(v);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : sortedJson(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedJson(o[k])}`).join(',')}}`;
}

/** Canonical JSON byte length of any JSON value. */
export function jsonBytes(v: unknown): number {
  return enc.encode(sortedJson(v)).byteLength;
}

/** Hard size limit of one region snapshot. */
export function regionSnapshotLimit(id: RegionId, kind: RegionKind): number {
  if (kind === 'street' || kind === 'path') return SAVE_BUDGET.streetMax;
  return COMMUNITY_REGION_IDS.includes(id) ? SAVE_BUDGET.lotCommunityMax : SAVE_BUDGET.lotResidentialMax;
}

export interface WorldSizeReport {
  /** Canonical JSON bytes of the whole world (what the save stores before gzip). */
  total: number;
  /** Bytes of `town` (null when absent). */
  town: number | null;
  /** Canonical bytes of each stored region snapshot. */
  snapshots: Record<RegionId, number>;
  withinTarget: boolean;
  withinHardCap: boolean;
}

export function measureWorld(world: { town?: TownStateV2 | null } & Record<string, unknown>): WorldSizeReport {
  const total = jsonBytes(world);
  const t = world.town;
  const snapshots: Record<RegionId, number> = {};
  if (t && typeof t === 'object' && t.regions) for (const [id, r] of Object.entries(t.regions)) if (r && r.snapshot) snapshots[id] = jsonBytes(r.snapshot);
  return { total, town: t ? jsonBytes(t) : null, snapshots, withinTarget: total <= SAVE_BUDGET.worldTarget, withinHardCap: total <= SAVE_BUDGET.worldHardCap };
}

/** Regions whose snapshot exceeds its hard limit (sorted by id). `kindOf` maps a region id to its kind. */
export function oversizedSnapshots(town: TownStateV2, kindOf: (id: RegionId) => RegionKind): { id: RegionId; bytes: number; limit: number }[] {
  const out: { id: RegionId; bytes: number; limit: number }[] = [];
  for (const id of Object.keys(town.regions).sort()) {
    const snap = town.regions[id]?.snapshot;
    if (!snap) continue;
    const bytes = jsonBytes(snap);
    const limit = regionSnapshotLimit(id, kindOf(id));
    if (bytes > limit) out.push({ id, bytes, limit });
  }
  return out;
}

function modified(s: RegionSnapshot): boolean {
  const v = s.data ? s.data[SNAPSHOT_MODIFIED_KEY] : undefined;
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Enforce the hard cap: while the world is larger than `cap`, drop (set to null, keeping the record and its
 * watermark) the snapshot of the oldest never-modified neighbour — never the home, an owned lot or a modified region.
 * Order: `savedTick` ascending, then RegionId: deterministic and independent of key order. Mutates `world.town`;
 * returns the dropped ids in drop order. A world already within the cap is not touched.
 */
export function capWorldSize(world: { town?: TownStateV2 | null } & Record<string, unknown>, cap: number = SAVE_BUDGET.worldHardCap): RegionId[] {
  const t = world.town;
  if (!t || typeof t !== 'object' || !t.regions) return [];
  let total = jsonBytes(world);
  if (total <= cap) return [];
  const keep = new Set<RegionId>([t.homeLotId, ...(Array.isArray(t.ownedLotIds) ? t.ownedLotIds : [])]);
  const candidates = Object.entries(t.regions)
    .filter(([id, r]) => r && r.snapshot && !keep.has(id) && !modified(r.snapshot))
    .map(([id, r]) => ({ id, savedTick: r.snapshot!.savedTick, bytes: jsonBytes(r.snapshot) }))
    .sort((a, b) => a.savedTick - b.savedTick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const dropped: RegionId[] = [];
  for (const c of candidates) {
    if (total <= cap) break;
    t.regions[c.id].snapshot = null;
    // the snapshot's bytes are replaced by the 4 bytes of `null`
    total -= c.bytes - 4;
    dropped.push(c.id);
  }
  return dropped;
}
