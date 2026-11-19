/**
 * MILDEW LANE — the v1 world map as DATA (W-025 S2; docs/DESIGN_WORLD_LEVELS.md §1.2, §1.10).
 *
 * Generator version 1, content version 1. Every placement here is the table in DESIGN §1.2; portals are listed as
 * (side-a region, side-a lot-local tiles, side-b region) and their side-b tiles are DERIVED through the world ↔ lot
 * transforms of src/shared/world.ts, so the data can never disagree with the geometry. Pure, deterministic, no I/O:
 * the same inputs always give a byte-identical `WorldMap` (it is rebuilt on load, never saved; §1.11).
 *
 * Seams (not implemented here, by slice):
 *  - TODO(S7): neighbour lot templates come from `StartPick.neighbourSeed` (the start generator). Until then every
 *    non-home residential slot has `templateId: null` ("not generated yet").
 *  - TODO(S14): the Old Graveyard lot template (`old_graveyard`) and its gate object id (`gateObjectId`).
 *  - TODO(S8): the sign text keys below get their i18n strings + the in-world barrier / sign objects.
 */
import {
  type DistrictDef,
  type LotPlacement,
  type LotRot,
  type PortalDef,
  type RegionId,
  type UnfinishedArea,
  type WorldMap,
  type WorldPoint,
  type WorldRect,
  type WorldRegionDef,
  CELL_TILES,
  lotTileToWorldTile,
  placementWorldRect,
  worldTileToLotTile,
} from './world';

export const MILDEW_LANE_GEN_VERSION = 1;
/** Content version of the shipped district set (bumped by expansions, §1.10). */
export const WORLD_CONTENT_VERSION = 1;

/** The 8 residential street slots (home + 7 neighbours, §1.9). */
export const RESIDENTIAL_SLOTS = ['mildew_n1', 'mildew_n2', 'mildew_n3', 'mildew_n4', 'mildew_s1', 'mildew_s2', 'mildew_s3', 'mildew_s4'] as const;
export type ResidentialSlot = (typeof RESIDENTIAL_SLOTS)[number];
/** Slot an old (pre-world) save's home lot is placed at (LEGACY_HOME_LOT_ID = 'wormwood:' + this). */
export const LEGACY_HOME_SLOT: ResidentialSlot = 'mildew_n2';

export function slotRegionId(slot: string): RegionId {
  return `wormwood:${slot}`;
}

export function isResidentialSlot(v: unknown): v is ResidentialSlot {
  return typeof v === 'string' && (RESIDENTIAL_SLOTS as readonly string[]).includes(v);
}

/** Residential slot of a region id ('wormwood:mildew_n2' → 'mildew_n2'), or null. */
export function slotOfRegionId(id: unknown): ResidentialSlot | null {
  if (typeof id !== 'string' || !id.startsWith('wormwood:')) return null;
  const s = id.slice('wormwood:'.length);
  return isResidentialSlot(s) ? s : null;
}

/** Street region piece templates (S9 art kit / S3 tile costs read them). */
export const STREET_SEGMENT_TEMPLATE = 'street_segment';
export const STREET_END_TEMPLATE = 'street_end';
export const GRAVEYARD_TEMPLATE = 'old_graveyard';
export const CORNER_PARK_TEMPLATE = 'corner_park';

const LOT = 30;
const STREET_W = 30;
const STREET_D = CELL_TILES;

function placement(regionId: RegionId, originX: number, originZ: number, rot: LotRot, width: number, depth: number): LotPlacement {
  return { regionId, originX, originZ, rot, width, depth };
}

export const MILDEW_LANE_DISTRICTS: readonly DistrictDef[] = [
  { id: 'wormwood_mildew', levelId: 'wormwood', name: 'Mildew Lane', status: 'open' },
  { id: 'graveyard_old', levelId: 'graveyard', name: 'Old Graveyard', status: 'open' },
  { id: 'wormwood_north', levelId: 'wormwood', name: 'Wormwood North', status: 'unfinished' },
  { id: 'rotrow', levelId: 'rotrow', name: 'Downtown Rot Row', status: 'unfinished' },
  { id: 'bayou', levelId: 'bayou', name: 'Swampside Bayou', status: 'unfinished' },
  { id: 'mausoleum', levelId: 'mausoleum', name: 'Mausoleum Hills', status: 'unfinished' },
];

/** Unfinished frontier around Mildew Lane (§1.10). Facing: radians, 0 = +Z (atan2(x, z)). */
export const MILDEW_LANE_UNFINISHED: readonly UnfinishedArea[] = [
  {
    id: 'unfinished:wormwood_north',
    kind: 'underConstruction',
    regionIds: ['unfinished:wormwood_north'],
    signTextKey: 'world.unfinished.wormwoodNorth',
    signs: [{ regionId: 'unfinished:wormwood_north', x: 100.5, z: 29.5, facing: 0 }],
    plannedLevel: 'wormwood',
    sinceContentVersion: 1,
  },
  {
    id: 'unfinished:rotrow_tram',
    kind: 'underConstruction',
    regionIds: ['unfinished:rotrow_tram'],
    signTextKey: 'world.unfinished.rotrowTram',
    signs: [{ regionId: 'unfinished:rotrow_tram', x: 29.5, z: 35.5, facing: Math.PI / 2 }],
    plannedLevel: 'rotrow',
    sinceContentVersion: 1,
  },
  {
    id: 'unfinished:bayou_road',
    kind: 'unexplored',
    regionIds: ['unfinished:bayou_road'],
    signTextKey: 'world.unfinished.bayouRoad',
    signs: [{ regionId: 'unfinished:bayou_road', x: 100.5, z: 0.5, facing: Math.PI }],
    plannedLevel: 'bayou',
    sinceContentVersion: 1,
  },
  {
    id: 'unfinished:mausoleum_hills',
    kind: 'unexplored',
    regionIds: ['unfinished:mausoleum_hills'],
    signTextKey: 'world.unfinished.mausoleumHills',
    signs: [{ regionId: 'unfinished:mausoleum_hills', x: 0.5, z: 35.5, facing: -Math.PI / 2 }],
    plannedLevel: 'mausoleum',
    sinceContentVersion: 1,
  },
];

interface RegionSeed {
  id: RegionId;
  kind: WorldRegionDef['kind'];
  districtId: string;
  p: LotPlacement;
  templateId: string | null;
}

function regionSeeds(): RegionSeed[] {
  const out: RegionSeed[] = [];
  out.push({ id: 'wormwood:corner_park', kind: 'lot', districtId: 'wormwood_mildew', p: placement('wormwood:corner_park', 0, 20, 3, LOT, LOT), templateId: CORNER_PARK_TEMPLATE });
  out.push({ id: 'street:mildew:0', kind: 'street', districtId: 'wormwood_mildew', p: placement('street:mildew:0', 30, 30, 0, STREET_D, STREET_D), templateId: STREET_END_TEMPLATE });
  for (let i = 0; i < 4; i++) {
    const ox = 40 + 30 * i;
    const n = `wormwood:mildew_n${i + 1}`;
    const s = `wormwood:mildew_s${i + 1}`;
    const st = `street:mildew:${i + 1}`;
    out.push({ id: n, kind: 'lot', districtId: 'wormwood_mildew', p: placement(n, ox, 0, 0, LOT, LOT), templateId: null });
    out.push({ id: st, kind: 'street', districtId: 'wormwood_mildew', p: placement(st, ox, 30, 0, STREET_W, STREET_D), templateId: STREET_SEGMENT_TEMPLATE });
    out.push({ id: s, kind: 'lot', districtId: 'wormwood_mildew', p: placement(s, ox, 40, 2, LOT, LOT), templateId: null });
  }
  out.push({ id: 'street:mildew:5', kind: 'street', districtId: 'wormwood_mildew', p: placement('street:mildew:5', 160, 30, 0, STREET_D, STREET_D), templateId: STREET_END_TEMPLATE });
  out.push({ id: 'graveyard:old_graveyard', kind: 'lot', districtId: 'graveyard_old', p: placement('graveyard:old_graveyard', 170, 20, 1, LOT, LOT), templateId: GRAVEYARD_TEMPLATE });
  const frontier: [RegionId, string, number, number, number, number][] = [
    ['unfinished:wormwood_north', 'wormwood_north', 0, -30, 200, 30],
    ['unfinished:rotrow_tram', 'rotrow', -30, 0, 30, 70],
    ['unfinished:bayou_road', 'bayou', 0, 70, 200, 30],
    ['unfinished:mausoleum_hills', 'mausoleum', 200, 0, 30, 70],
  ];
  for (const [id, district, ox, oz, w, d] of frontier) out.push({ id, kind: 'unfinished', districtId: district, p: placement(id, ox, oz, 0, w, d), templateId: null });
  return out;
}

/** Portal spec: side-a lot-local tiles (one per tile of the opening) + the region on the other side. */
interface PortalSeed {
  id: string;
  kind: PortalDef['kind'];
  a: RegionId;
  tiles: [number, number][];
  b: RegionId;
}

function portalSeeds(): PortalSeed[] {
  const out: PortalSeed[] = [];
  const sidewalkZ = 28;
  const frontRow = LOT - 1; // the lot row that touches its street (local z 29)
  // sidewalk portals: the row z = 28 continues lot to lot (north row west → east; south row east → west)
  for (let i = 1; i < 4; i++) {
    out.push({ id: `sidewalk:mildew_n${i}-n${i + 1}`, kind: 'sidewalk', a: `wormwood:mildew_n${i}`, tiles: [[LOT - 1, sidewalkZ]], b: `wormwood:mildew_n${i + 1}` });
    out.push({ id: `sidewalk:mildew_s${i}-s${i + 1}`, kind: 'sidewalk', a: `wormwood:mildew_s${i}`, tiles: [[0, sidewalkZ]], b: `wormwood:mildew_s${i + 1}` });
  }
  // crosswalk portals: one per lot frontage at local x 14–15 (the front-path column of the shipped templates)
  for (let i = 1; i <= 4; i++) {
    out.push({ id: `crosswalk:mildew_n${i}`, kind: 'crosswalk', a: `wormwood:mildew_n${i}`, tiles: [[14, frontRow], [15, frontRow]], b: `street:mildew:${i}` });
    out.push({ id: `crosswalk:mildew_s${i}`, kind: 'crosswalk', a: `wormwood:mildew_s${i}`, tiles: [[14, frontRow], [15, frontRow]], b: `street:mildew:${i}` });
  }
  out.push({ id: 'crosswalk:corner_park', kind: 'crosswalk', a: 'wormwood:corner_park', tiles: [[14, frontRow], [15, frontRow]], b: 'street:mildew:0' });
  // street ↔ street: the whole 10-tile cross-section
  for (let i = 0; i < 5; i++) {
    const w = i === 0 ? STREET_D : STREET_W;
    const rows: [number, number][] = Array.from({ length: STREET_D }, (_, z) => [w - 1, z]);
    out.push({ id: `crosswalk:street_mildew_${i}-${i + 1}`, kind: 'crosswalk', a: `street:mildew:${i}`, tiles: rows, b: `street:mildew:${i + 1}` });
  }
  // the Old Graveyard's main gate (L2 §3): local x 14–15 at its street edge; world (170, 34..35) ↔ street end 5
  out.push({ id: 'gate:old_graveyard', kind: 'gate', a: 'graveyard:old_graveyard', tiles: [[14, frontRow], [15, frontRow]], b: 'street:mildew:5' });
  return out;
}

const DIRS: readonly WorldPoint[] = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

function inRect(r: WorldRect, x: number, z: number): boolean {
  return x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1;
}

/**
 * Resolve a portal seed: every side-a tile must have exactly one world neighbour in region b, all in the same
 * direction. `a`/`b` are the tiles with the smallest world coordinate of the span (S3 walks `width` tiles along the
 * shared edge from there, in increasing world coordinate). Throws on inconsistent data (caught by the unit test).
 */
function resolvePortal(seed: PortalSeed, byId: Map<RegionId, LotPlacement>): PortalDef {
  const pa = byId.get(seed.a);
  const pb = byId.get(seed.b);
  if (!pa || !pb) throw new Error(`portal ${seed.id}: unknown region`);
  const rb = placementWorldRect(pb);
  if (!rb) throw new Error(`portal ${seed.id}: bad placement`);
  const pairs: { wa: WorldPoint; la: WorldPoint; lb: WorldPoint }[] = [];
  let dir: WorldPoint | null = null;
  for (const [tx, tz] of seed.tiles) {
    const wa = lotTileToWorldTile(pa, tx, tz);
    if (!wa) throw new Error(`portal ${seed.id}: tile ${tx},${tz} outside ${seed.a}`);
    const hits = DIRS.filter((d) => inRect(rb, wa.x + d.x, wa.z + d.z));
    if (hits.length !== 1) throw new Error(`portal ${seed.id}: tile ${tx},${tz} is not on the edge shared with ${seed.b}`);
    if (dir && (dir.x !== hits[0].x || dir.z !== hits[0].z)) throw new Error(`portal ${seed.id}: tiles cross different edges`);
    dir = hits[0];
    const lb = worldTileToLotTile(pb, wa.x + dir.x, wa.z + dir.z);
    if (!lb) throw new Error(`portal ${seed.id}: no side-b tile`);
    pairs.push({ wa, la: { x: tx, z: tz }, lb });
  }
  pairs.sort((p, q) => p.wa.x - q.wa.x || p.wa.z - q.wa.z);
  const first = pairs[0];
  return { id: seed.id, kind: seed.kind, a: { regionId: seed.a, x: first.la.x, z: first.la.z }, b: { regionId: seed.b, x: first.lb.x, z: first.lb.z }, width: pairs.length, gateObjectId: seed.kind === 'gate' ? null : undefined };
}

export interface WorldMapInputs {
  genVersion: number;
  contentVersion: number;
  seed: number;
}

/**
 * The Mildew Lane `WorldMap` for a world. `home` names the home region and the template its lot was built from (the
 * only residential slot whose template is known before S7). Unknown generator / content versions (a newer build's
 * world) fall back to this layout: §1.10 forbids an expansion from moving an open region, so the v1 regions stay valid.
 */
export function buildWorldMap(inputs: WorldMapInputs, home: { regionId: RegionId; templateId: string | null }): WorldMap {
  const seeds = regionSeeds();
  const byId = new Map(seeds.map((s) => [s.id, s.p] as const));
  const unfinishedById = new Map(MILDEW_LANE_UNFINISHED.map((u) => [u.id, u] as const));
  const regions: WorldRegionDef[] = seeds.map((s) => {
    const def: WorldRegionDef = { id: s.id, kind: s.kind, placement: { ...s.p }, districtId: s.districtId, templateId: s.id === home.regionId ? home.templateId : s.templateId };
    if (s.kind === 'lot') def.lotId = s.id;
    const u = unfinishedById.get(s.id);
    if (u) def.unfinished = { ...u, regionIds: [...u.regionIds], signs: u.signs.map((g) => ({ ...g })) };
    return def;
  });
  const portals = portalSeeds().map((p) => {
    const d = resolvePortal(p, byId);
    if (d.gateObjectId === undefined) delete d.gateObjectId;
    return d;
  });
  const ext = regionsExtent(regions);
  return {
    genVersion: inputs.genVersion,
    contentVersion: inputs.contentVersion,
    cellTiles: CELL_TILES,
    widthCells: ext ? (ext.x1 - ext.x0) / CELL_TILES : 0,
    depthCells: ext ? (ext.z1 - ext.z0) / CELL_TILES : 0,
    districts: MILDEW_LANE_DISTRICTS.map((d) => ({ ...d })),
    regions,
    portals,
  };
}

/**
 * World-tile bounding box of a set of regions (the extent `WorldMap.widthCells/depthCells` measure). `WorldMap` has
 * no origin field (contract), so consumers that need the extent's corner call this.
 */
export function regionsExtent(regions: readonly WorldRegionDef[]): WorldRect | null {
  let r: WorldRect | null = null;
  for (const g of regions) {
    const w = placementWorldRect(g.placement);
    if (!w) continue;
    r = r ? { x0: Math.min(r.x0, w.x0), z0: Math.min(r.z0, w.z0), x1: Math.max(r.x1, w.x1), z1: Math.max(r.z1, w.z1) } : w;
  }
  return r;
}

// ─────────────────────────────── street tiles (road / curb / verge / crosswalk) ───────────────────────────────

export type StreetTileKind = 'verge' | 'curb' | 'road' | 'crosswalk';

/**
 * Tile kinds of a street region, row-major (index = z * width + x), lot-local. Cross-section across the 10-tile street
 * (§1.2: 1 m verge + 0.25 m curb + 7.5 m road + 0.25 m curb + 1 m verge): row 0 / 9 verge, row 1 / 8 curb (the tile
 * holding the 0.25 m curb and 0.75 m of road; the curb itself is cosmetic, §1.7), rows 2–7 road. Segments carry a
 * 2-tile crosswalk at local x 14–15 across the whole street, verge to verge (the curb ramps of both frontages, where
 * the lot crosswalk portals land); street ends carry an east-west crosswalk across rows 4–5 (the corner park and
 * graveyard gate portals). Road and curb tiles cost +2 per step in S3; verge and crosswalk cost 1.
 * Returns null for a region that is not a Mildew Lane street.
 */
export function streetTiles(region: Pick<WorldRegionDef, 'kind' | 'templateId' | 'placement'>): StreetTileKind[] | null {
  if (region.kind !== 'street') return null;
  const { width, depth } = region.placement;
  if (depth !== STREET_D || (width !== STREET_W && width !== STREET_D)) return null;
  const end = region.templateId === STREET_END_TEMPLATE;
  if (!end && region.templateId !== STREET_SEGMENT_TEMPLATE) return null;
  const out: StreetTileKind[] = [];
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const base: StreetTileKind = z === 0 || z === depth - 1 ? 'verge' : z === 1 || z === depth - 2 ? 'curb' : 'road';
      const cross = end ? z === 4 || z === 5 : x === 14 || x === 15;
      out.push(cross ? 'crosswalk' : base);
    }
  }
  return out;
}

/** The region record of a map by id. */
export function regionDef(map: WorldMap, id: RegionId): WorldRegionDef | null {
  return map.regions.find((r) => r.id === id) ?? null;
}
