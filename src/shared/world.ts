/**
 * WORLD & LEVELS CONTRACT (docs/DESIGN_WORLD_LEVELS.md is the source of truth; D-068).
 *
 * A "level" is a district: lots (residential + community) with its own townies, quests, art and music. Since D-068 the
 * districts are laid out on ONE walkable, connected world (W-025): every lot, street segment and unfinished area is a
 * REGION placed on a grid of CELLS (`CELL_TILES` × `CELL_TILES` world tiles). Each region keeps its own lot-local tile
 * grid (the existing 30 × 30 `LotState` for lots) and a `LotPlacement` that maps lot-local coordinates to world
 * coordinates. Adjacent regions are joined by PORTALS (sidewalk ends, crosswalks, gates), so zombies walk from home to
 * a neighbour's lot or the Old Graveyard with no loading screen. Regions near the household are simulated every tick
 * (active); the rest are snapshots that catch up in closed form when they become active again.
 *
 * This file holds TYPES plus a few PURE helpers (coordinate transforms, seeded start pick). Nothing here is wired into
 * the sim, the renderer or saves yet: the runtime lands in the W-025 slices (docs/WORKBOARD.md). Shared online
 * multiplayer is out of scope (a separate design behind the COPPA / legal gate, W-095).
 */

export const LEVEL_IDS = ['wormwood', 'graveyard', 'rotrow', 'bayou', 'mausoleum', 'underneath', 'necropolis'] as const;
export type LevelId = (typeof LEVEL_IDS)[number];

export type LotKind = 'residential' | 'community' | 'workplace';

/** Community venue types (drive interactions, opening hours, townie routing). */
export type VenueKind =
  | 'graveyard' | 'pantry' | 'market' | 'gym' | 'library' | 'nightclub' | 'park' | 'office' | 'diner' | 'pond'
  | 'crypt' | 'museum' | 'salon' | 'clinic' | 'parlor'; // parlor = funeral parlour (D-049)

export interface LotDef {
  /** Globally unique, stable (saved): '<levelId>:<slug>'. Also the RegionId of the lot's region. */
  id: string;
  levelId: LevelId;
  kind: LotKind;
  name: string;
  /** Lot template id (spatial templates) used to build the lot the first time it is entered. */
  templateId: string;
  /** Grid size in tiles. */
  width: number;
  depth: number;
  /**
   * Position on the overview map (map units). Since D-068 this is ONLY the overview-map pin and the hearse-distance
   * input for far districts; where the lot physically sits in the walkable world is its `LotPlacement`.
   */
  mapX: number;
  mapZ: number;
  venue?: VenueKind;
  /** Game-hours open (community lots); undefined = always. */
  hours?: { open: number; close: number };
  /** Residential: purchase price of the empty/starter lot. */
  price?: number;
  /** Unlock requirement for the level/lot (null = available from start). */
  unlock?: { kind: 'none' | 'funds' | 'quest' | 'reputation' | 'day'; value?: number | string };
  /** Ambient/music theme ids (audio). */
  ambience?: string;
  music?: string;
}

export interface LevelDef {
  id: LevelId;
  name: string;
  blurb: string;
  /** Environment look: sky/fog/ground palette ids (render). */
  environment: string;
  lots: LotDef[];
  /** Townie pool size seeded for this level (deterministic from world seed + level id). */
  townies: number;
  unlock: { kind: 'none' | 'funds' | 'quest' | 'reputation' | 'day'; value?: number | string };
  /** Content module ids (objects, interactions, quests) this level contributes. */
  content: string[];
}

/**
 * @deprecated v1 contract ("one simulated lot at a time"), superseded by D-068 / `TownStateV2`. It was never written to
 * a save (no runtime implemented it), so no migration reads it. Kept only so older design docs still resolve.
 */
export interface TownState {
  homeLotId: string;
  activeLotId: string;
  unlockedLevels: LevelId[];
  /** Frozen lots keyed by LotDef.id. Shape = the sim's serialized LotState + objects + present agents. */
  snapshots: Record<string, { savedTick: number; data: unknown }>;
  /** In-progress trip: who travels where, departure tick (travel takes game time via carpool). */
  trip: null | { to: string; agents: string[]; departTick: number; arriveTick: number };
}

// ─────────────────────────────────────────── World grid & ids (D-068) ───────────────────────────────────────────

/** Edge of one world cell in tiles (1 tile = 1 world unit ≈ 1 m). A standard 30 × 30 lot is 3 × 3 cells; a street is 1 cell wide. */
export const CELL_TILES = 10;
/** Cells per world axis (hard bound, defensive against corrupt saves): 256 cells = 2,560 tiles. */
export const WORLD_MAX_CELLS = 256;
/** World tiles per axis (2,560). */
export const WORLD_SPAN_TILES = CELL_TILES * WORLD_MAX_CELLS;
/**
 * World coordinates are SIGNED (review fix, Sol on PR #57): world tile integers lie in [WORLD_MIN_TILE, WORLD_MAX_TILE)
 * = [−1280, 1280) on both axes, so districts can grow north (−Z) and west (−X) of the original Mildew Lane layout
 * without moving any placed region. The origin (0, 0) is just a point; nothing about it is special.
 */
export const WORLD_MIN_TILE = -WORLD_SPAN_TILES / 2;
/** Exclusive upper bound of world tile coordinates (1280). */
export const WORLD_MAX_TILE = WORLD_SPAN_TILES / 2;
/** Largest lot-local grid edge a placement may declare (mirrors the spatial grid clamp `MAX_DIM`). */
export const REGION_MAX_TILES = 256;

/**
 * Stable region id (saved; never renamed): a lot region uses its `LotDef.id` ('<levelId>:<slug>'); a street segment
 * 'street:<streetSlug>:<n>'; an unfinished area 'unfinished:<slug>'. 'street' and 'unfinished' are not level ids, so the
 * three spaces cannot collide.
 */
export type RegionId = string;
/**
 * Packed cell id of the signed cell (cx, cz), cx = floor(wx / CELL_TILES) ∈ [−128, 128):
 * `(cz + 128) * WORLD_MAX_CELLS + (cx + 128)`, an integer in 0 .. WORLD_MAX_CELLS² − 1. See `cellIdOfWorldTile`.
 */
export type CellId = number;

export type RegionKind = 'lot' | 'street' | 'path' | 'unfinished';

/** Quarter turns. 0: lot front (+Z) faces world +Z · 1: faces world −X · 2: faces world −Z · 3: faces world +X. */
export type LotRot = 0 | 1 | 2 | 3;

/**
 * Where a region's lot-local grid sits in the world. Named for the lot case; street segments and unfinished areas use
 * the same transform. The region covers the world tile rectangle starting at (originX, originZ):
 * `width × depth` tiles for rot 0/2, `depth × width` for rot 1/3. All fields are integers.
 */
export interface LotPlacement {
  regionId: RegionId;
  /** World tile of the rectangle's min corner (signed; the whole footprint lies in [WORLD_MIN_TILE, WORLD_MAX_TILE)). */
  originX: number;
  originZ: number;
  rot: LotRot;
  /** Lot-local grid size (LotState.width / depth). 1 .. REGION_MAX_TILES. */
  width: number;
  depth: number;
}

export interface WorldPoint {
  x: number;
  z: number;
}

export interface WorldRect {
  /** Inclusive min, exclusive max, world tiles. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A connection between two regions: an agent standing on `a` may step to `b` (and back unless `oneWay`). */
export interface PortalDef {
  id: string;
  kind: 'sidewalk' | 'crosswalk' | 'gate' | 'path' | 'stairs';
  /** Lot-local tile on each side (tile coordinates, not centres). */
  a: { regionId: RegionId; x: number; z: number };
  b: { regionId: RegionId; x: number; z: number };
  /** Tiles side by side the portal spans (sidewalk 1, crosswalk 2–3, gate 2). */
  width: number;
  oneWay?: boolean;
  /** Gate portals: the opening object id on the lot side whose open/locked state gates the crossing. */
  gateObjectId?: string | null;
}

/** An area the world honestly shows as not built yet (fenced, signed, not walkable). */
export interface UnfinishedArea {
  id: string;
  kind: 'underConstruction' | 'unexplored';
  /** Regions it covers (each a `RegionKind 'unfinished'` region, or a lot whose content has not shipped). */
  regionIds: RegionId[];
  /** i18n key of the in-world sign ("Under construction — the Rot Row tram is coming"). */
  signTextKey: string;
  /** Sign posts: lot-local position in the region that shows them, facing in radians (0 = +Z). */
  signs: { regionId: RegionId; x: number; z: number; facing: number }[];
  /** What will open here, when known (shown on the sign + overview map). */
  plannedLevel?: LevelId;
  plannedPackId?: string;
  /** World-map content version that introduced this area (expansion bookkeeping). */
  sinceContentVersion: number;
}

export interface WorldRegionDef {
  id: RegionId;
  kind: RegionKind;
  placement: LotPlacement;
  districtId: string;
  /** Lot regions: the LotDef id (equal to `id`). */
  lotId?: string;
  /** Template the region is built from on first activation (lots: spatial lot template; streets: street kit piece). */
  templateId: string | null;
  /** Present while the region is unfinished (fenced / signed / not walkable). */
  unfinished?: UnfinishedArea;
}

export interface DistrictDef {
  id: string;
  levelId: LevelId;
  name: string;
  status: 'open' | 'unfinished';
}

/**
 * The static layout of a world: content + generator output, rebuilt deterministically from (content version,
 * generator version, world seed). NOT saved; the save keeps only per-region state (`TownStateV2.regions`).
 */
export interface WorldMap {
  /** Generator version: changing the generator never changes an existing world's map (saved in TownStateV2.map). */
  genVersion: number;
  /** Content version of the district set (bumped when a pack opens unfinished areas or appends regions). */
  contentVersion: number;
  cellTiles: number;
  /** World extent in cells (≤ WORLD_MAX_CELLS). */
  widthCells: number;
  depthCells: number;
  districts: DistrictDef[];
  regions: WorldRegionDef[];
  portals: PortalDef[];
}

// ─────────────────────────────────────────── Streaming ───────────────────────────────────────────

/** Sim tier (deterministic, device-independent): active = simulated every tick; dormant = snapshot + catch-up. */
export type SimTier = 'active' | 'dormant';
/** Render tier (device- and camera-dependent, never read by the sim): full detail / low-detail shell / not drawn. */
export type RenderTier = 'active' | 'warm' | 'cold';

/** Saved part of streaming (the sim's tiers depend on history because of hysteresis, so they are state, not view). */
export interface StreamState {
  /** Sorted ascending. The home region is always in it. */
  active: RegionId[];
  /** Tick each region last changed tier (minimum-dwell bookkeeping). */
  changedTick: Record<RegionId, number>;
  /** Tick of the last tier evaluation (evaluated every STREAM_EVAL_TICKS). */
  lastEvalTick: number;
}

// ─────────────────────────────────────────── Saved world (v2) ───────────────────────────────────────────

/** A dormant region's frozen state. JSON only; written by the sim when the region leaves the active set. */
export interface RegionSnapshot {
  /** Tick the region went dormant. */
  savedTick: number;
  /** Serialized LotState of the region's grid. */
  lot: unknown;
  /** Serialized objects of the region (ObjectState records, region-local placements). */
  objects: unknown;
  /** Region-specific closed-form state (mound cooldowns, item ages, dirt, garden stages, ...). */
  data: Record<string, unknown>;
}

export interface RegionRecord {
  id: RegionId;
  /** null until the region was first activated (it is then built from `WorldRegionDef.templateId` and the seed). */
  snapshot: RegionSnapshot | null;
  /** Catch-up watermark: closed-form catch-up has been applied up to this tick (idempotency). */
  caughtUpTick: number;
  /** First activation tick (null = never entered; such regions cost nothing in the save). */
  firstActiveTick: number | null;
}

/** Deterministic start choice for a new world (output of `pickStart`, then validated by the start generator). */
export interface StartPick {
  genVersion: number;
  templateId: string;
  /** Street slot id of the home lot ('mildew_n2', 'mildew_s3', ...); the home's RegionId is '<levelId>:<slotId>'. */
  slotId: string;
  /** Sub-seed for footprint / terrain / shell / object jitter (uint32). */
  variantSeed: number;
  /** Sub-seed for which templates fill the neighbouring slots (uint32). */
  neighbourSeed: number;
  /** Attempt index that passed validation (0 = first try). */
  attempt: number;
}

export interface StartTemplateOption {
  templateId: string;
  /** Integer 1..1000. Entries with any other weight are ignored. */
  weight: number;
}

export interface StartGenSpec {
  /** Bump to change starts for NEW worlds; existing worlds keep their saved StartPick. */
  genVersion: number;
  pool: readonly StartTemplateOption[];
  /** Street slots a home may occupy. */
  slots: readonly string[];
  /** Procedural variation bounds (applied by the runtime generator from `variantSeed`). */
  variation: {
    /** Max tiles the buildable rectangle may shrink per side (0..3). */
    buildableInsetMax: number;
    shellVariants: number;
    terrainVariants: number;
    /** Templates the neighbouring residential slots are drawn from. */
    neighbourPool: readonly string[];
  };
  constraints: {
    /** Object tags every start must contain, reachable from both sidewalk entries (Act 1, D-060). */
    requiredReachableTags: readonly string[];
    /** Exact starting funds (fairness: every generated start is identical in money). */
    startingFunds: number;
    /** Max walking distance (tiles) from the home's front door to the Old Graveyard gate. */
    maxGraveyardWalkTiles: number;
    /** Attempts before the canonical fallback is used. */
    maxAttempts: number;
  };
  /** Used when every attempt fails validation (always playable: the shipped `derelict` template at a fixed slot). */
  fallback: { templateId: string; slotId: string };
}

/** Household trip by hearse (far districts only; adjacent areas are walked). */
export interface HearseTrip {
  to: RegionId;
  agents: string[];
  departTick: number;
  arriveTick: number;
}

/**
 * Saved world state v2 (`WorldState.town`, schema v2). MIGRATION NOTE: schema-v1 saves have no `town` key; the v1→v2
 * migration (pure, in src/persistence/migrations.ts when the runtime lands) adds
 * `{ v: 2, map: {genVersion: 1, contentVersion: 1, seed: <world seed>}, homeLotId: LEGACY_HOME_LOT_ID, ownedLotIds: [same],
 *    start: null, legacyHome: true, expandPending: true, regions: { [home]: { id, snapshot: null, caughtUpTick: tick, firstActiveTick: 0 } },
 *    stream: { active: [home], changedTick: { [home]: tick }, lastEvalTick: tick }, unlockedLevels: ['wormwood','graveyard'],
 *    trip: null }`
 * and leaves `WorldState.lot` / `objects` / `agents` untouched (the home lot stays where it is; objects and agents
 * without a `regionId` belong to the home). Zero repair warnings. The never-shipped v1 `TownState` is not read.
 */
export interface TownStateV2 {
  v: 2;
  /** Inputs that rebuild the WorldMap. */
  map: { genVersion: number; contentVersion: number; seed: number };
  homeLotId: string;
  /** Lots the household may build/buy on (v1 runtime: just the home). */
  ownedLotIds: string[];
  /** null for migrated saves (`legacyHome`), else the pick the start generator validated. */
  start: StartPick | null;
  /** True when the home came from a pre-world save (placed at the legacy slot, its lot kept byte-for-byte). */
  legacyHome: boolean;
  /**
   * Migrated saves start with `true`: streaming is frozen to the home region (the world behaves exactly like the
   * pre-world engine) until the game dispatches the journaled `townExpand` command AFTER journal recovery, so a
   * schema-v1 journal replays onto its migrated snapshot without divergence (W-119). New worlds start with `false`.
   */
  expandPending: boolean;
  /** Only regions that were ever activated (unvisited regions are regenerated from the seed, not stored). */
  regions: Record<RegionId, RegionRecord>;
  stream: StreamState;
  unlockedLevels: LevelId[];
  trip: HearseTrip | null;
}

/** Region id an old save's home lot gets: the fixed legacy slot (its LotState is kept byte-for-byte; D-068). */
export const LEGACY_HOME_LOT_ID = 'wormwood:mildew_n2';

// ─────────────────────────────────────────── Pure helpers ───────────────────────────────────────────

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** +0 for −0 so transformed coordinates serialize and compare identically. */
function nz(v: number): number {
  return v === 0 ? 0 : v;
}

/** True when the placement is well-formed and its whole footprint lies inside the world. */
export function isValidPlacement(p: LotPlacement | null | undefined): p is LotPlacement {
  if (!p || typeof p !== 'object') return false;
  const { originX, originZ, rot, width, depth } = p;
  if (!isInt(originX) || !isInt(originZ) || !isInt(width) || !isInt(depth)) return false;
  if (rot !== 0 && rot !== 1 && rot !== 2 && rot !== 3) return false;
  if (width < 1 || depth < 1 || width > REGION_MAX_TILES || depth > REGION_MAX_TILES) return false;
  if (originX < WORLD_MIN_TILE || originZ < WORLD_MIN_TILE) return false;
  const spanX = rot % 2 === 0 ? width : depth;
  const spanZ = rot % 2 === 0 ? depth : width;
  return originX + spanX <= WORLD_MAX_TILE && originZ + spanZ <= WORLD_MAX_TILE;
}

/** World tile rectangle a placement covers, or null when the placement is invalid. */
export function placementWorldRect(p: LotPlacement | null | undefined): WorldRect | null {
  if (!isValidPlacement(p)) return null;
  const spanX = p.rot % 2 === 0 ? p.width : p.depth;
  const spanZ = p.rot % 2 === 0 ? p.depth : p.width;
  return { x0: p.originX, z0: p.originZ, x1: p.originX + spanX, z1: p.originZ + spanZ };
}

/**
 * Lot-local continuous point (tile units; tile (x,z) spans [x,x+1]×[z,z+1]) → world point. Points outside the lot
 * rectangle are transformed too (an agent stepping across a portal is briefly outside). null for an invalid placement
 * or a non-finite coordinate. Exact for integer and half-integer inputs.
 */
export function lotToWorld(p: LotPlacement | null | undefined, x: number, z: number): WorldPoint | null {
  if (!isValidPlacement(p) || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const { originX: ox, originZ: oz, width: W, depth: D } = p;
  switch (p.rot) {
    case 0:
      return { x: nz(ox + x), z: nz(oz + z) };
    case 1:
      return { x: nz(ox + D - z), z: nz(oz + x) };
    case 2:
      return { x: nz(ox + W - x), z: nz(oz + D - z) };
    default:
      return { x: nz(ox + z), z: nz(oz + W - x) };
  }
}

/** Inverse of `lotToWorld`. null for an invalid placement or a non-finite coordinate. */
export function worldToLot(p: LotPlacement | null | undefined, wx: number, wz: number): WorldPoint | null {
  if (!isValidPlacement(p) || !Number.isFinite(wx) || !Number.isFinite(wz)) return null;
  const { originX: ox, originZ: oz, width: W, depth: D } = p;
  const dx = wx - ox;
  const dz = wz - oz;
  switch (p.rot) {
    case 0:
      return { x: nz(dx), z: nz(dz) };
    case 1:
      return { x: nz(dz), z: nz(D - dx) };
    case 2:
      return { x: nz(W - dx), z: nz(D - dz) };
    default:
      return { x: nz(W - dz), z: nz(dx) };
  }
}

/** Lot-local tile (integer) → world tile (integer), via the tile centre. null when invalid or outside the lot grid. */
export function lotTileToWorldTile(p: LotPlacement | null | undefined, tx: number, tz: number): WorldPoint | null {
  if (!isValidPlacement(p) || !isInt(tx) || !isInt(tz)) return null;
  if (tx < 0 || tz < 0 || tx >= p.width || tz >= p.depth) return null;
  const c = lotToWorld(p, tx + 0.5, tz + 0.5);
  return c ? { x: Math.floor(c.x), z: Math.floor(c.z) } : null;
}

/** World tile (integer) → lot-local tile, or null when invalid or the tile is not inside this region. */
export function worldTileToLotTile(p: LotPlacement | null | undefined, wx: number, wz: number): WorldPoint | null {
  if (!isValidPlacement(p) || !isInt(wx) || !isInt(wz)) return null;
  const c = worldToLot(p, wx + 0.5, wz + 0.5);
  if (!c) return null;
  const tx = Math.floor(c.x);
  const tz = Math.floor(c.z);
  return tx >= 0 && tz >= 0 && tx < p.width && tz < p.depth ? { x: tx, z: tz } : null;
}

/** Facing (radians, 0 = +Z, atan2(x, z)) from lot-local to world, normalised to (−π, π]. NaN in → NaN out. */
export function lotFacingToWorld(p: LotPlacement | null | undefined, facing: number): number {
  if (!isValidPlacement(p) || !Number.isFinite(facing)) return NaN;
  return normalizeAngle(facing - (p.rot * Math.PI) / 2);
}

/** Inverse of `lotFacingToWorld`. */
export function worldFacingToLot(p: LotPlacement | null | undefined, facing: number): number {
  if (!isValidPlacement(p) || !Number.isFinite(facing)) return NaN;
  return normalizeAngle(facing + (p.rot * Math.PI) / 2);
}

function normalizeAngle(a: number): number {
  const TAU = Math.PI * 2;
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return nz(r);
}

/** Packed cell id of a world tile, or null when the tile is not an integer inside the world. */
export function cellIdOfWorldTile(wx: number, wz: number): CellId | null {
  if (!isInt(wx) || !isInt(wz) || wx < WORLD_MIN_TILE || wz < WORLD_MIN_TILE || wx >= WORLD_MAX_TILE || wz >= WORLD_MAX_TILE) return null;
  const half = WORLD_MAX_CELLS / 2;
  return (Math.floor(wz / CELL_TILES) + half) * WORLD_MAX_CELLS + (Math.floor(wx / CELL_TILES) + half);
}

/** Seed normalisation used by every world generator: finite → uint32 (truncate, wrap mod 2³²); NaN / ±Infinity → null. */
export function normalizeSeed(seed: number): number | null {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return null;
  // ToUint32 of the truncated value: deterministic for every finite double (wraps modulo 2^32, negatives included).
  return Math.trunc(seed) >>> 0;
}

/**
 * 32-bit avalanche hash (splitmix32 finaliser). FROZEN: saved worlds depend on its exact output (pinned by golden
 * values in tests/unit/shared/world.test.ts). Never change it; add a new function and bump `genVersion` instead.
 */
export function mix32(a: number): number {
  let z = (a + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** Hash of several uint32 parts (order-sensitive). */
export function hash32(...parts: number[]): number {
  let h = 0x2545f491;
  for (const p of parts) h = mix32((h ^ (p >>> 0)) >>> 0);
  return h;
}

/** Salts that separate the independent draws of one pick (frozen). */
const SALT_TEMPLATE = 0x7e4d1;
const SALT_SLOT = 0x510f;
const SALT_VARIANT = 0x1ab3;
const SALT_NEIGHBOUR = 0xe16b;

/**
 * Deterministic start pick for a new world: (seed, spec, attempt) → template (weighted), street slot and sub-seeds.
 * Pure; the runtime start generator builds the lot from it, validates it (Act 1 reachability, funds, walk distance)
 * and on failure calls again with attempt + 1, up to `constraints.maxAttempts`, then uses `spec.fallback`.
 * Returns null for a non-finite seed, a negative / non-integer attempt, or a spec with no usable template or slot.
 */
export function pickStart(seed: number, spec: StartGenSpec | null | undefined, attempt = 0): StartPick | null {
  const s = normalizeSeed(seed);
  if (s === null || !isInt(attempt) || attempt < 0 || !spec || typeof spec !== 'object') return null;
  if (!isInt(spec.genVersion) || spec.genVersion < 1) return null;
  const pool = Array.isArray(spec.pool)
    ? spec.pool.filter((o) => o && typeof o.templateId === 'string' && o.templateId.length > 0 && isInt(o.weight) && o.weight >= 1 && o.weight <= 1000)
    : [];
  const slots = Array.isArray(spec.slots) ? spec.slots.filter((x) => typeof x === 'string' && x.length > 0) : [];
  if (pool.length === 0 || slots.length === 0) return null;
  const a = attempt >>> 0;
  const v = spec.genVersion >>> 0;
  const total = pool.reduce((t, o) => t + o.weight, 0);
  let r = hash32(s, v, a, SALT_TEMPLATE) % total;
  let templateId = pool[pool.length - 1].templateId;
  for (const o of pool) {
    if (r < o.weight) {
      templateId = o.templateId;
      break;
    }
    r -= o.weight;
  }
  return {
    genVersion: spec.genVersion,
    templateId,
    slotId: slots[hash32(s, v, a, SALT_SLOT) % slots.length],
    variantSeed: hash32(s, v, a, SALT_VARIANT),
    neighbourSeed: hash32(s, v, a, SALT_NEIGHBOUR),
    attempt,
  };
}

// ─────────────────────────────────────────── Live-region admission (review fix, Sol) ───────────────────────────────────────────

/** Non-household lot regions the surroundings may add when the household is together (home included in the count). */
export const LIVE_LOT_BUDGET = 6;
/** Street / path regions admitted from the surroundings. */
export const LIVE_STREET_BUDGET = 8;
/** Household cap (GDD §9). */
export const HOUSEHOLD_MAX = 8;
/**
 * Worst-case live LOT regions: the home + one distinct lot per household member (8 members split over 8 other lots).
 * Surroundings then add none. With the household together the count is ≤ LIVE_LOT_BUDGET.
 */
export const LIVE_LOT_WORST_CASE = 1 + HOUSEHOLD_MAX;

export interface LiveCandidate {
  regionId: RegionId;
  kind: RegionKind;
  /** Chebyshev world distance (tiles) from the region rect to the nearest household member; already passed hysteresis. */
  distance: number;
}

export interface LiveRegionInput {
  homeRegionId: RegionId;
  /** Region each household member stands in (one entry per member; duplicates allowed). */
  memberRegions: readonly { regionId: RegionId; kind: RegionKind }[];
  /** Surrounding regions that qualify by radius + hysteresis (S4 computes them). */
  candidates: readonly LiveCandidate[];
}

export interface LiveRegionResult {
  /** All live regions, sorted ascending (deterministic). */
  live: RegionId[];
  /** Live lot regions held by the home or a household member (never dropped). */
  required: RegionId[];
  /** Number of live lot regions (≤ LIVE_LOT_WORST_CASE). */
  lotCount: number;
}

/**
 * The household-split rule (D-068 review fix): every region a household member stands in is ALWAYS live, as is the
 * home. A member is never frozen, and selecting any member is never refused. Surroundings fill what is left of the lot
 * budget: `max(0, LIVE_LOT_BUDGET − required lots)` lots and up to LIVE_STREET_BUDGET streets/paths, nearest first
 * (ties: RegionId). Unfinished regions are never live. Pure and deterministic; malformed entries are ignored.
 */
export function selectLiveRegions(input: LiveRegionInput | null | undefined): LiveRegionResult | null {
  if (!input || typeof input.homeRegionId !== 'string' || input.homeRegionId.length === 0) return null;
  const isLotKind = (k: unknown) => k === 'lot';
  const isWalkKind = (k: unknown) => k === 'street' || k === 'path';
  const requiredLots = new Set<RegionId>([input.homeRegionId]);
  const requiredStreets = new Set<RegionId>();
  const members = Array.isArray(input.memberRegions) ? input.memberRegions.slice(0, HOUSEHOLD_MAX) : [];
  for (const m of members) {
    if (!m || typeof m.regionId !== 'string' || m.regionId.length === 0) continue;
    if (isLotKind(m.kind)) requiredLots.add(m.regionId);
    else if (isWalkKind(m.kind)) requiredStreets.add(m.regionId);
  }
  const cands = (Array.isArray(input.candidates) ? input.candidates : [])
    .filter((c) => c && typeof c.regionId === 'string' && c.regionId.length > 0 && typeof c.distance === 'number' && Number.isFinite(c.distance) && c.distance >= 0)
    .slice()
    .sort((a, b) => a.distance - b.distance || (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));
  const lots = new Set(requiredLots);
  const walks = new Set(requiredStreets);
  let lotRoom = Math.max(0, LIVE_LOT_BUDGET - requiredLots.size);
  let walkRoom = LIVE_STREET_BUDGET;
  for (const c of cands) {
    if (isLotKind(c.kind)) {
      if (lots.has(c.regionId) || lotRoom <= 0 || walks.has(c.regionId)) continue;
      lots.add(c.regionId);
      lotRoom--;
    } else if (isWalkKind(c.kind)) {
      if (walks.has(c.regionId) || walkRoom <= 0 || lots.has(c.regionId)) continue;
      walks.add(c.regionId);
      walkRoom--;
    }
  }
  const sortIds = (s: Iterable<RegionId>) => [...s].sort();
  return { live: sortIds(new Set([...lots, ...walks])), required: sortIds(requiredLots), lotCount: lots.size };
}

// ─────────────────────────────────────────── View / controller seams (S5 / S11 / S13) ───────────────────────────────────────────

/** Why a world route was refused (stable codes; UI maps them to text: "Can't get there", "That's private", ...). */
export type RouteFailReason = 'noPath' | 'private' | 'locked' | 'unfinished';

/** Where the player asked a member to go: a lot-local tile in a region (the UI resolves picks / map pins to this). */
export interface WorldRouteTarget {
  regionId: RegionId;
  x: number;
  z: number;
}

export type WorldRouteResult =
  | { ok: true; target: WorldRouteTarget; portals: string[]; lengthTiles: number; etaGameMin: number }
  | { ok: false; target: WorldRouteTarget; reason: RouteFailReason };

/** The selected member as the HUD / camera see it. Updated every frame; stable across region transitions. */
export interface SelectedActorView {
  agentId: string;
  regionId: RegionId;
  /** Interpolated world position (tile units) and lot-local position. */
  world: WorldPoint;
  local: WorldPoint;
  renderTier: RenderTier;
}

/** Camera follow seam (S5): follow a member across regions; recentre on demand (keyboard + button, never gesture-only). */
export interface CameraFollowApi {
  follow(agentId: string | null): void;
  following(): string | null;
  /** Pan back to the followed (or selected) member; returns false when there is nobody to recentre on. */
  recentre(): boolean;
}

export type MapPinStatus = 'open' | 'closed' | 'locked' | 'unfinished';

/** Overview-map pin (S13): a stable id, a readable label and status, no colour-only meaning. */
export interface MapPinView {
  regionId: RegionId;
  label: string;
  status: MapPinStatus;
  /** Plain text for the status ("Open until 22:00", "Opens day 3", "Under construction"). */
  statusText: string;
  world: WorldPoint;
  /** Household members currently there (ids, for "who is where"). */
  memberIds: string[];
}

/**
 * In-world sign text exposed to the DOM HUD (S11): the renderer never owns the only copy. Screen readers and keyboard
 * users read the nearest signs from a list; no 3D text, hover or pointer is needed to read them.
 */
export interface SignView {
  id: string;
  regionId: RegionId;
  textKey: string;
  /** Resolved, localised plain text. */
  text: string;
  world: WorldPoint;
}

export type PointerGesture = 'tap' | 'longPress' | 'pan' | 'pinch' | 'none';

export interface PointerSample {
  /** Pointer id (multi-touch). */
  id: number;
  /** Milliseconds (monotonic) and CSS pixels. */
  t: number;
  x: number;
  y: number;
  type: 'down' | 'move' | 'up' | 'cancel';
}

/** Gesture thresholds: a tap moves ≤ 10 CSS px and lasts ≤ 350 ms; long press ≥ 500 ms still; a tap within 300 ms after a pinch/pan ends is ignored. */
export const TAP_MAX_MOVE_PX = 10;
export const TAP_MAX_MS = 350;
export const LONG_PRESS_MS = 500;
export const POST_GESTURE_GUARD_MS = 300;

/**
 * Classify one pointer sequence (first `down` to the last pointer's `up`). ONLY 'tap' may enqueue a walk command (S11):
 * any second pointer ⇒ 'pinch'; movement beyond TAP_MAX_MOVE_PX ⇒ 'pan'; a cancel, a missing up, out-of-order or
 * non-finite samples ⇒ 'none'; `lastGestureEndT` within POST_GESTURE_GUARD_MS of the down ⇒ 'none' (the finger lifting
 * off a pinch is not a tap). Pure.
 */
export function classifyPointerGesture(samples: readonly PointerSample[] | null | undefined, lastGestureEndT: number | null = null): PointerGesture {
  if (!Array.isArray(samples) || samples.length < 2) return 'none';
  const ids = new Set<number>();
  let prevT = -Infinity;
  for (const s of samples) {
    if (!s || !Number.isFinite(s.t) || !Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.id)) return 'none';
    if (s.t < prevT) return 'none';
    prevT = s.t;
    ids.add(s.id);
  }
  if (ids.size > 1) return 'pinch';
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first.type !== 'down') return 'none';
  if (samples.some((s) => s.type === 'cancel')) return 'none';
  if (last.type !== 'up' || samples.slice(1, -1).some((s) => s.type !== 'move')) return 'none';
  let maxMove = 0;
  for (const s of samples) maxMove = Math.max(maxMove, Math.hypot(s.x - first.x, s.y - first.y));
  if (maxMove > TAP_MAX_MOVE_PX) return 'pan';
  if (lastGestureEndT !== null && Number.isFinite(lastGestureEndT) && first.t - lastGestureEndT < POST_GESTURE_GUARD_MS) return 'none';
  const dur = last.t - first.t;
  if (dur >= LONG_PRESS_MS) return 'longPress';
  return dur <= TAP_MAX_MS ? 'tap' : 'none';
}

// ─────────────────────────────────────────── Start diversity (AC-6, review fix, Sol) ───────────────────────────────────────────

/**
 * The ACTUAL generated layout of a start, read from the built world (never from `StartPick` seed fields), so the
 * diversity gate measures what the player sees. S7 fills it from the generated LotState / objects / world map.
 */
export interface StartGeometry {
  slotId: string;
  rot: LotRot;
  /** Generated buildable rectangle (lot-local). */
  buildable: { x0: number; z0: number; x1: number; z1: number };
  /** Canonical wall edge keys of the generated house ('h:x:z' / 'v:x:z'); order does not matter. */
  shellEdges: readonly string[];
  /** Openings as '<defId>@<edge>'; order does not matter. */
  openings: readonly string[];
  /** Generated ground / floor style per tile, row-major (LotState.floors incl. terrain patches; null = grass). */
  terrain: readonly (string | null)[];
  /** Neighbour lots in slot order: '<slotId>=<templateId>' (+ '~m' when mirrored). */
  neighbours: readonly string[];
  /** True when every attempt failed and the canonical fallback was used. */
  fallback: boolean;
}

export const START_SIGNATURE_PARTS = ['slot', 'rot', 'footprint', 'shell', 'terrain', 'neighbours'] as const;
export type StartSignaturePart = (typeof START_SIGNATURE_PARTS)[number];

export interface StartSignature {
  /** All parts joined: equal keys ⇔ identical geometry signature. */
  key: string;
  parts: Record<StartSignaturePart, string>;
  fallback: boolean;
}

/**
 * The AC-6 gate over 50 seeds (justification in DESIGN_WORLD_LEVELS §1.9): ≥ 48 distinct signatures, ≤ 2 fallbacks
 * (4 %, under the 5 % bound), and every pair of non-fallback starts differing in ≥ 2 of the 6 parts.
 */
export const START_DIVERSITY = { seeds: 50, minDistinct: 48, maxFallbacks: 2, minPairwiseDistance: 2 } as const;

function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = mix32((h ^ s.charCodeAt(i)) >>> 0);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const strList = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null);

/** Signature of a generated start, or null for malformed geometry. Pure; order-independent for edges and openings. */
export function startGeometrySignature(g: StartGeometry | null | undefined): StartSignature | null {
  if (!g || typeof g !== 'object' || typeof g.slotId !== 'string' || g.slotId.length === 0) return null;
  if (g.rot !== 0 && g.rot !== 1 && g.rot !== 2 && g.rot !== 3) return null;
  const b = g.buildable;
  if (!b || ![b.x0, b.z0, b.x1, b.z1].every(isInt) || b.x1 <= b.x0 || b.z1 <= b.z0) return null;
  const edges = strList(g.shellEdges);
  const openings = strList(g.openings);
  const neighbours = strList(g.neighbours);
  const terrain = Array.isArray(g.terrain) && g.terrain.every((t) => t === null || typeof t === 'string') ? g.terrain : null;
  if (!edges || !openings || !neighbours || !terrain) return null;
  const parts: Record<StartSignaturePart, string> = {
    slot: g.slotId,
    rot: String(g.rot),
    footprint: `${b.x0},${b.z0},${b.x1},${b.z1}`,
    shell: hashString([...new Set(edges)].sort().join(';') + '|' + [...new Set(openings)].sort().join(';')),
    terrain: hashString(terrain.map((t) => (t === null ? '.' : t)).join(',')),
    neighbours: hashString(neighbours.join(';')),
  };
  return { key: START_SIGNATURE_PARTS.map((p) => parts[p]).join('/'), parts, fallback: g.fallback === true };
}

/** Number of signature parts (0..6) in which two starts differ. */
export function signatureDistance(a: StartSignature, b: StartSignature): number {
  let d = 0;
  for (const p of START_SIGNATURE_PARTS) if (a.parts[p] !== b.parts[p]) d++;
  return d;
}

export interface StartDiversityReport {
  seeds: number;
  distinct: number;
  fallbacks: number;
  /** Smallest distance between two non-fallback starts (6 when fewer than two). */
  minPairwiseDistance: number;
  pass: boolean;
}

/** Evaluate the AC-6 gate. Null entries (a start whose geometry was malformed) count as failures. */
export function evaluateStartDiversity(
  sigs: readonly (StartSignature | null)[],
  gate: { seeds: number; minDistinct: number; maxFallbacks: number; minPairwiseDistance: number } = START_DIVERSITY,
): StartDiversityReport {
  const list = Array.isArray(sigs) ? sigs : [];
  const ok = list.filter((s): s is StartSignature => !!s);
  const fallbacks = ok.filter((s) => s.fallback).length;
  const distinct = new Set(ok.map((s) => s.key)).size;
  const live = ok.filter((s) => !s.fallback);
  let minPair: number = START_SIGNATURE_PARTS.length;
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) minPair = Math.min(minPair, signatureDistance(live[i], live[j]));
  const pass = list.length >= gate.seeds && ok.length === list.length && distinct >= gate.minDistinct && fallbacks <= gate.maxFallbacks && minPair >= gate.minPairwiseDistance;
  return { seeds: list.length, distinct, fallbacks, minPairwiseDistance: minPair, pass };
}
