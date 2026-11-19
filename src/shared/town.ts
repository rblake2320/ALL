/**
 * `TownStateV2` construction (W-025 S2; docs/DESIGN_WORLD_LEVELS.md §1.11, contract `TownStateV2` in world.ts).
 *
 * Pure and deterministic: no RNG, no clock. Used by the schema v1 → v2 migration (src/persistence/migrations.ts), by
 * new worlds (src/sim/engine/world.ts) and by the engine's `townExpand` command.
 */
import { type LevelId, type RegionId, type RegionRecord, type StartPick, type TownStateV2, LEGACY_HOME_LOT_ID, normalizeSeed } from './world';
import { LEGACY_HOME_SLOT, MILDEW_LANE_GEN_VERSION, WORLD_CONTENT_VERSION, isResidentialSlot, slotRegionId, slotOfRegionId } from './mildewLane';

/** Levels a fresh (or migrated) world starts with unlocked: Wormwood and the adjacent Old Graveyard (§2 table). */
export const START_UNLOCKED_LEVELS: readonly LevelId[] = ['wormwood', 'graveyard'];

function homeRecord(id: RegionId, tick: number): RegionRecord {
  return { id, snapshot: null, caughtUpTick: tick, firstActiveTick: 0 };
}

function intOr(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : d;
}

/**
 * The exact `town` block the v1 → v2 migration adds (the migration note on `TownStateV2`): home at the legacy slot,
 * `legacyHome`, streaming frozen until the journaled `townExpand` (`expandPending`). Defensive against a damaged v1
 * payload: a non-finite / missing seed maps to 0, a missing / negative tick to 0 (validation repairs those fields of
 * the world itself; the town only mirrors them).
 */
export function legacyTown(seed: unknown, tick: unknown): TownStateV2 {
  const s = typeof seed === 'number' ? normalizeSeed(seed) ?? 0 : 0;
  const t = intOr(tick, 0);
  const home = LEGACY_HOME_LOT_ID;
  return {
    v: 2,
    map: { genVersion: MILDEW_LANE_GEN_VERSION, contentVersion: WORLD_CONTENT_VERSION, seed: s },
    homeLotId: home,
    ownedLotIds: [home],
    start: null,
    legacyHome: true,
    expandPending: true,
    regions: { [home]: homeRecord(home, t) },
    stream: { active: [home], changedTick: { [home]: t }, lastEvalTick: t },
    unlockedLevels: [...START_UNLOCKED_LEVELS],
    trip: null,
  };
}

/**
 * The canonical start for a lot template: the template at the legacy slot `mildew_n2`, attempt 0, variation off
 * (sub-seeds 0). Tests, balance scenarios and e2e suites use it (§1.9 item 6), and so does every new world until the
 * S7 start generator exists. TODO(S7): New Game draws `pickStart(seed, spec, attempt)` and validates it instead.
 */
export function canonicalStartPick(templateId: string): StartPick {
  return { genVersion: MILDEW_LANE_GEN_VERSION, templateId, slotId: LEGACY_HOME_SLOT, variantSeed: 0, neighbourSeed: 0, attempt: 0 };
}

/** True when `p` is a well-formed StartPick whose slot is a Mildew Lane residential slot. */
export function isUsableStartPick(p: unknown): p is StartPick {
  if (!p || typeof p !== 'object') return false;
  const q = p as Partial<StartPick>;
  const u32 = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
  return (
    typeof q.templateId === 'string' &&
    q.templateId.length > 0 &&
    q.templateId.length <= 64 &&
    isResidentialSlot(q.slotId) &&
    typeof q.genVersion === 'number' &&
    Number.isInteger(q.genVersion) &&
    q.genVersion >= 1 &&
    u32(q.variantSeed) &&
    u32(q.neighbourSeed) &&
    typeof q.attempt === 'number' &&
    Number.isInteger(q.attempt) &&
    q.attempt >= 0
  );
}

/** `town` of a NEW world (tick 0): home at the pick's slot, streaming live from the start (`expandPending` false). */
export function newTown(seed: number, pick: StartPick): TownStateV2 {
  const s = normalizeSeed(seed) ?? 0;
  const home = slotRegionId(pick.slotId);
  return {
    v: 2,
    map: { genVersion: pick.genVersion, contentVersion: WORLD_CONTENT_VERSION, seed: s },
    homeLotId: home,
    ownedLotIds: [home],
    start: { ...pick },
    legacyHome: false,
    expandPending: false,
    regions: { [home]: homeRecord(home, 0) },
    stream: { active: [home], changedTick: { [home]: 0 }, lastEvalTick: 0 },
    unlockedLevels: [...START_UNLOCKED_LEVELS],
    trip: null,
  };
}

/** The home region id of a world: `town.homeLotId`, or the legacy slot for a world without a town block. */
export function homeRegionIdOf(world: { town?: { homeLotId?: unknown } | null } | null | undefined): RegionId {
  const id = world && world.town && typeof world.town === 'object' ? world.town.homeLotId : undefined;
  return typeof id === 'string' && id.length > 0 ? id : LEGACY_HOME_LOT_ID;
}

/** The residential slot of a world's home ('mildew_n2' for legacy worlds), or null for a non-slot home. */
export function homeSlotOf(world: { town?: { homeLotId?: unknown } | null } | null | undefined): string | null {
  return slotOfRegionId(homeRegionIdOf(world));
}
