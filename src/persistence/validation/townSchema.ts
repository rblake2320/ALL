/**
 * Structural schema for `WorldState.town` (schema v2, `TownStateV2` in src/shared/world.ts; W-025 S2,
 * docs/DESIGN_WORLD_LEVELS.md §1.11) and the optional `regionId` of agents / objects.
 *
 * Rules:
 *  - `town` is OPTIONAL: absent stays absent with NO issue (a home-only world at the legacy placement). The v1 → v2
 *    migration always adds it, so only hand-made v2 payloads lack it.
 *  - a present town whose identity cannot be trusted (not an object, `v` ≠ 2, malformed `homeLotId`) is DROPPED with a
 *    note; the world then behaves as a home-only world (its lot / objects / agents are untouched either way);
 *  - leaves with a neutral value are repaired (lists de-duplicated, the home put back into `ownedLotIds`, `regions`,
 *    `stream.active`), broken region records / snapshots are dropped (an unvisited region is regenerated from the
 *    seed, §1.11), and unknown keys are kept (forward compatibility, §1.10);
 *  - snapshots reuse the world's own lot / object checks, so a region snapshot is held to the same standard as the
 *    home lot.
 */
import { LEVEL_IDS, type HearseTrip, type LevelId, type RegionRecord, type RegionSnapshot, type StartPick, type StreamState, type TownStateV2 } from '../../shared/world';
import type { LotState, ObjectState } from '../../sim/types';
import { type Check, INVALID, arr, bool, lit, nullable, num, obj, rec, str } from './core';

/** RegionId shapes (world.ts): '<levelId>:<slug>', 'street:<street>:<n>', 'unfinished:<slug>'. Lowercase, ≤ 96 chars. */
export const REGION_ID_RE = /^[a-z][a-z0-9_]{0,31}(:[a-z0-9_]{1,40}){1,2}$/;

export const TOWN_LIMITS = { maxRegions: 2000, maxOwned: 64, maxActive: 64, maxTripAgents: 16, maxDataKeys: 512 } as const;

const UINT32_MAX = 0xffffffff;
const regionId = str({ nonEmpty: true, max: 96, re: REGION_ID_RE });
const tick = num({ int: true, min: 0, def: 0 });

/** Optional field: absent stays absent silently; a broken value is dropped with a note (never fatal). */
export function optional<T>(check: Check<T>, what: string): Check<T | undefined> {
  return (v, ctx) => {
    if (v === undefined) return undefined;
    const r = check(v, ctx);
    if (r !== INVALID) return r;
    ctx.report('dropped', `${ctx.lastError.message}; ${what} reset`);
    return undefined;
  };
}

/** `regionId` of an agent / object: absent = home; a malformed id is dropped (the record falls back to the home). */
export const optionalRegionId: Check<string | undefined> = optional(regionId, 'region (back to the home region)');

/** W-025 S3: `AgentState.welcome` (welcomed into a neighbour's house until a tick); a malformed one is dropped. */
export const optionalWelcome: Check<{ regionId: string; untilTick: number } | undefined> = optional(
  obj<{ regionId: string; untilTick: number }>({ regionId, untilTick: num({ int: true, min: 0, strict: true }) }),
  'welcome',
);

const startPickSchema: Check<StartPick> = obj<StartPick>({
  genVersion: num({ int: true, min: 1, strict: true }),
  templateId: str({ nonEmpty: true, max: 64 }),
  slotId: str({ nonEmpty: true, max: 40, re: /^[a-z0-9_]+$/ }),
  variantSeed: num({ int: true, min: 0, max: UINT32_MAX, strict: true }),
  neighbourSeed: num({ int: true, min: 0, max: UINT32_MAX, strict: true }),
  attempt: num({ int: true, min: 0, max: 1000, strict: true }),
});

const jsonValue: Check<unknown> = (v) => v;

function snapshotSchema(lot: Check<LotState>, object: Check<ObjectState>): Check<RegionSnapshot> {
  return obj<RegionSnapshot>({
    savedTick: tick,
    lot: lot as Check<unknown>,
    objects: rec(object, { def: () => ({}), maxKeys: 50000 }) as Check<unknown>,
    data: rec(jsonValue, { def: () => ({}), maxKeys: TOWN_LIMITS.maxDataKeys }),
  });
}

function recordSchema(lot: Check<LotState>, object: Check<ObjectState>): Check<RegionRecord> {
  const snap = snapshotSchema(lot, object);
  return obj<RegionRecord>({
    id: regionId,
    snapshot: (v, ctx) => {
      if (v === null || v === undefined) {
        if (v === undefined) ctx.report('repaired', 'missing; set to null (regenerated from the seed)');
        return null;
      }
      const r = snap(v, ctx);
      if (r !== INVALID) return r;
      ctx.report('dropped', `${ctx.lastError.message}; snapshot dropped (the region is regenerated from the seed)`);
      return null;
    },
    caughtUpTick: tick,
    firstActiveTick: nullable(num({ int: true, min: 0 })),
  });
}

const streamSchema: Check<StreamState> = obj<StreamState>({
  active: arr(regionId, { def: () => [], max: TOWN_LIMITS.maxActive, unique: true }),
  changedTick: rec(num({ int: true, min: 0 }), { def: () => ({}), maxKeys: TOWN_LIMITS.maxRegions, keyRe: REGION_ID_RE }),
  lastEvalTick: tick,
});

const tripSchema: Check<HearseTrip> = obj<HearseTrip>({
  to: regionId,
  agents: arr(str({ nonEmpty: true, max: 96 }), { def: () => [], max: TOWN_LIMITS.maxTripAgents, unique: true }),
  departTick: num({ int: true, min: 0, strict: true }),
  arriveTick: num({ int: true, min: 0, strict: true }),
});

/** Build the town check around the world's own lot / object checks (worldSchema.ts passes them in). */
export function makeTownSchema(lot: Check<LotState>, object: Check<ObjectState>): Check<TownStateV2 | undefined> {
  const record = recordSchema(lot, object);
  const town = obj<TownStateV2>(
    {
      v: lit([2] as const) as Check<2>,
      map: obj<TownStateV2['map']>({
        genVersion: num({ int: true, min: 1, def: 1 }),
        contentVersion: num({ int: true, min: 1, def: 1 }),
        seed: num({ int: true, min: 0, max: UINT32_MAX, def: 0 }),
      }),
      homeLotId: regionId,
      ownedLotIds: arr(regionId, { def: () => [], max: TOWN_LIMITS.maxOwned, unique: true }),
      start: (v, ctx) => {
        if (v === null) return null;
        const r = startPickSchema(v, ctx);
        if (r !== INVALID) return r;
        ctx.report('repaired', `${ctx.lastError.message}; start pick cleared`);
        return null;
      },
      legacyHome: bool(false),
      expandPending: bool(false),
      regions: rec(record, { def: () => ({}), maxKeys: TOWN_LIMITS.maxRegions, keyRe: REGION_ID_RE }),
      stream: streamSchema,
      unlockedLevels: arr(lit(LEVEL_IDS as readonly LevelId[]), { def: () => ['wormwood', 'graveyard'], max: LEVEL_IDS.length, unique: true }),
      trip: (v, ctx) => {
        if (v === null || v === undefined) {
          if (v === undefined) ctx.report('repaired', 'missing; set to null');
          return null;
        }
        const r = tripSchema(v, ctx);
        if (r !== INVALID) return r;
        ctx.report('dropped', `${ctx.lastError.message}; trip cancelled`);
        return null;
      },
    },
    {
      post: (t, ctx) => {
        const home = t.homeLotId;
        // record keys are authoritative for identity
        for (const [key, r] of Object.entries(t.regions)) {
          if (r.id !== key) {
            ctx.report('repaired', `region record id ${JSON.stringify(r.id)} disagrees with its key; set to key`, `town.regions.${key}.id`);
            r.id = key;
          }
        }
        if (!t.ownedLotIds.includes(home)) {
          ctx.report('repaired', 'home missing from ownedLotIds; added', 'town.ownedLotIds');
          t.ownedLotIds = [home, ...t.ownedLotIds];
        }
        if (!Object.prototype.hasOwnProperty.call(t.regions, home)) {
          ctx.report('repaired', 'home region record missing; added', `town.regions.${home}`);
          t.regions[home] = { id: home, snapshot: null, caughtUpTick: t.stream.lastEvalTick, firstActiveTick: 0 };
        }
        const sorted = [...t.stream.active].sort();
        if (!sorted.includes(home)) {
          ctx.report('repaired', 'home missing from the active set; added', 'town.stream.active');
          sorted.push(home);
          sorted.sort();
        }
        if (sorted.join('\u0000') !== t.stream.active.join('\u0000')) {
          if (sorted.length === t.stream.active.length) ctx.report('repaired', 'active set not sorted; sorted', 'town.stream.active');
          t.stream = { ...t.stream, active: sorted };
        }
        if (t.trip && t.trip.arriveTick < t.trip.departTick) {
          ctx.report('repaired', 'trip arrives before it departs; cancelled', 'town.trip');
          t.trip = null;
        }
        return t;
      },
    },
  );
  return (v, ctx) => {
    if (v === undefined) return undefined;
    const r = town(v, ctx);
    if (r !== INVALID) return r;
    ctx.report('dropped', `${ctx.lastError.message}; neighbourhood data reset (the home lot is kept as is)`);
    return undefined;
  };
}
