/**
 * W-025 S2: the Mildew Lane world map as data (src/shared/mildewLane.ts) against DESIGN_WORLD_LEVELS §1.2 / §1.10:
 * placements, extent, no overlaps, cell alignment, every portal geometrically real (both tiles exist and are world
 * neighbours across the shared edge), the graveyard gate in the street band, street tile kinds, determinism.
 */
import { describe, expect, it } from 'vitest';
import {
  buildWorldMap,
  CORNER_PARK_TEMPLATE,
  GRAVEYARD_TEMPLATE,
  LEGACY_HOME_SLOT,
  MILDEW_LANE_UNFINISHED,
  RESIDENTIAL_SLOTS,
  regionDef,
  regionsExtent,
  slotOfRegionId,
  slotRegionId,
  STREET_END_TEMPLATE,
  STREET_SEGMENT_TEMPLATE,
  streetTiles,
} from '../../../src/shared/mildewLane';
import { CELL_TILES, LEGACY_HOME_LOT_ID, type PortalDef, type WorldMap, isValidPlacement, lotTileToWorldTile, lotToWorld, placementWorldRect } from '../../../src/shared/world';

const MAP: WorldMap = buildWorldMap({ genVersion: 1, contentVersion: 1, seed: 7 }, { regionId: LEGACY_HOME_LOT_ID, templateId: 'derelict' });

/** The §1.2 table, verbatim. */
const TABLE: [string, string, number, number, number, [number, number, number, number]][] = [
  ['wormwood:corner_park', 'lot', 0, 20, 3, [0, 20, 30, 50]],
  ['street:mildew:0', 'street', 30, 30, 0, [30, 30, 40, 40]],
  ...[1, 2, 3, 4].map((i) => [`wormwood:mildew_n${i}`, 'lot', 40 + 30 * (i - 1), 0, 0, [40 + 30 * (i - 1), 0, 70 + 30 * (i - 1), 30]] as [string, string, number, number, number, [number, number, number, number]]),
  ...[1, 2, 3, 4].map((i) => [`street:mildew:${i}`, 'street', 40 + 30 * (i - 1), 30, 0, [40 + 30 * (i - 1), 30, 70 + 30 * (i - 1), 40]] as [string, string, number, number, number, [number, number, number, number]]),
  ...[1, 2, 3, 4].map((i) => [`wormwood:mildew_s${i}`, 'lot', 40 + 30 * (i - 1), 40, 2, [40 + 30 * (i - 1), 40, 70 + 30 * (i - 1), 70]] as [string, string, number, number, number, [number, number, number, number]]),
  ['street:mildew:5', 'street', 160, 30, 0, [160, 30, 170, 40]],
  ['graveyard:old_graveyard', 'lot', 170, 20, 1, [170, 20, 200, 50]],
];

function worldTilesOfPortalSide(p: PortalDef, side: 'a' | 'b'): { x: number; z: number }[] {
  const end = p[side];
  const def = regionDef(MAP, end.regionId)!;
  const w = lotTileToWorldTile(def.placement, end.x, end.z)!;
  return [w];
}

describe('Mildew Lane map data (§1.2)', () => {
  it('places every region exactly as the design table says', () => {
    for (const [id, kind, ox, oz, rot, rect] of TABLE) {
      const r = regionDef(MAP, id);
      expect(r, id).not.toBeNull();
      expect(r!.kind).toBe(kind);
      expect([r!.placement.originX, r!.placement.originZ, r!.placement.rot]).toEqual([ox, oz, rot]);
      const w = placementWorldRect(r!.placement)!;
      expect([w.x0, w.z0, w.x1, w.z1], id).toEqual(rect);
      if (kind === 'lot') expect(r!.lotId).toBe(id);
    }
    expect(MAP.regions.filter((r) => r.kind !== 'unfinished').length).toBe(TABLE.length);
  });

  it('has the 8 residential slots, the home at the legacy slot with its template, neighbours not generated yet (S7)', () => {
    expect(RESIDENTIAL_SLOTS.length).toBe(8);
    expect(slotRegionId(LEGACY_HOME_SLOT)).toBe(LEGACY_HOME_LOT_ID);
    for (const s of RESIDENTIAL_SLOTS) {
      const r = regionDef(MAP, slotRegionId(s))!;
      expect(slotOfRegionId(r.id)).toBe(s);
      expect(r.templateId).toBe(r.id === LEGACY_HOME_LOT_ID ? 'derelict' : null);
    }
    expect(regionDef(MAP, 'graveyard:old_graveyard')!.templateId).toBe(GRAVEYARD_TEMPLATE);
    expect(regionDef(MAP, 'wormwood:corner_park')!.templateId).toBe(CORNER_PARK_TEMPLATE);
    const other = buildWorldMap({ genVersion: 1, contentVersion: 1, seed: 7 }, { regionId: 'wormwood:mildew_s3', templateId: 'starter' });
    expect(regionDef(other, 'wormwood:mildew_s3')!.templateId).toBe('starter');
    expect(regionDef(other, LEGACY_HOME_LOT_ID)!.templateId).toBeNull();
  });

  it('regions are valid, cell-aligned, inside the world and never overlap; the extent is reported in cells', () => {
    const rects = MAP.regions.map((r) => ({ id: r.id, w: placementWorldRect(r.placement)! }));
    for (const r of MAP.regions) {
      expect(isValidPlacement(r.placement), r.id).toBe(true);
      const w = placementWorldRect(r.placement)!;
      for (const v of [w.x0, w.z0, w.x1, w.z1]) expect(Math.abs(v % CELL_TILES), r.id).toBe(0);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].w;
        const b = rects[j].w;
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
        expect(overlap, `${rects[i].id} overlaps ${rects[j].id}`).toBe(false);
      }
    expect(regionsExtent(MAP.regions)).toEqual({ x0: -30, z0: -30, x1: 230, z1: 100 });
    expect([MAP.widthCells, MAP.depthCells]).toEqual([26, 13]);
    expect(MAP.cellTiles).toBe(CELL_TILES);
  });

  it('the frontier is the four unfinished areas of §1.10 with signs inside their own regions', () => {
    const unf = MAP.regions.filter((r) => r.kind === 'unfinished');
    expect(unf.map((r) => r.id).sort()).toEqual(MILDEW_LANE_UNFINISHED.map((u) => u.id).sort());
    for (const r of unf) {
      expect(r.unfinished?.regionIds).toEqual([r.id]);
      for (const s of r.unfinished!.signs) {
        expect(s.regionId).toBe(r.id);
        expect(s.x >= 0 && s.x < r.placement.width && s.z >= 0 && s.z < r.placement.depth).toBe(true);
      }
      expect(r.templateId).toBeNull();
    }
    expect(MAP.districts.filter((d) => d.status === 'open').map((d) => d.id)).toEqual(['wormwood_mildew', 'graveyard_old']);
  });

  it('every portal joins two world-adjacent tiles of two different regions, never an unfinished one', () => {
    const byId = new Map(MAP.regions.map((r) => [r.id, r] as const));
    expect(new Set(MAP.portals.map((p) => p.id)).size).toBe(MAP.portals.length);
    for (const p of MAP.portals) {
      expect(p.a.regionId).not.toBe(p.b.regionId);
      for (const side of ['a', 'b'] as const) {
        const r = byId.get(p[side].regionId)!;
        expect(r.kind, p.id).not.toBe('unfinished');
        expect(p[side].x >= 0 && p[side].z >= 0 && p[side].x < r.placement.width && p[side].z < r.placement.depth, p.id).toBe(true);
      }
      const [wa] = worldTilesOfPortalSide(p, 'a');
      const [wb] = worldTilesOfPortalSide(p, 'b');
      expect(Math.abs(wa.x - wb.x) + Math.abs(wa.z - wb.z), p.id).toBe(1);
      expect(p.width).toBeGreaterThanOrEqual(1);
    }
    const kinds = (k: string) => MAP.portals.filter((p) => p.kind === k).length;
    expect(kinds('sidewalk')).toBe(6); // n1-n2-n3-n4 and s1-s2-s3-s4
    expect(kinds('crosswalk')).toBe(8 + 1 + 5); // 8 lot frontages + the park + 5 street-to-street joins
    expect(kinds('gate')).toBe(1);
    for (const p of MAP.portals.filter((q) => q.kind === 'crosswalk' && q.a.regionId.startsWith('wormwood:'))) expect(p.width).toBe(2);
    for (const p of MAP.portals.filter((q) => q.a.regionId.startsWith('street:'))) expect(p.width).toBe(10);
  });

  it('sidewalk portals continue the z = 28 pavement lot to lot; the north row meets at world z 28.5, the south at 41.5', () => {
    for (const p of MAP.portals.filter((q) => q.kind === 'sidewalk')) {
      const a = regionDef(MAP, p.a.regionId)!;
      const b = regionDef(MAP, p.b.regionId)!;
      expect(p.a.z).toBe(28);
      expect(p.b.z).toBe(28);
      const wa = lotToWorld(a.placement, p.a.x + 0.5, p.a.z + 0.5)!;
      const wb = lotToWorld(b.placement, p.b.x + 0.5, p.b.z + 0.5)!;
      expect(wa.z).toBe(wb.z);
      expect([28.5, 41.5]).toContain(wa.z);
      expect(Math.abs(wa.x - wb.x)).toBe(1);
    }
  });

  it("the Old Graveyard's main gate sits in the street band at the east street end (L2 §3: local x 14–15)", () => {
    const g = MAP.portals.find((p) => p.kind === 'gate')!;
    expect(g.a.regionId).toBe('graveyard:old_graveyard');
    expect(g.b.regionId).toBe('street:mildew:5');
    expect(g.gateObjectId).toBeNull(); // TODO(S14): the gate object of the built graveyard
    const gy = regionDef(MAP, 'graveyard:old_graveyard')!.placement;
    // the gate on the graveyard's sidewalk row: world (171.5, 34.5), inside the street band z 30..40
    expect(lotToWorld(gy, 14.5, 28.5)).toEqual({ x: 171.5, z: 34.5 });
    const w = lotTileToWorldTile(gy, g.a.x, g.a.z)!;
    expect(w.x).toBe(170);
    expect(w.z >= 30 && w.z + g.width <= 40).toBe(true);
  });

  it('street tiles: verge / curb / road rows, a 2-tile crosswalk per frontage, east-west crosswalks at the ends', () => {
    const seg = streetTiles(regionDef(MAP, 'street:mildew:2')!)!;
    expect(seg.length).toBe(30 * 10);
    const at = (t: string[], w: number, x: number, z: number) => t[z * w + x];
    for (let x = 0; x < 30; x++) {
      for (let z = 0; z <= 9; z++) expect(at(seg, 30, x, z)).toBe(x === 14 || x === 15 ? 'crosswalk' : z === 0 || z === 9 ? 'verge' : z === 1 || z === 8 ? 'curb' : 'road');
    }
    const end = streetTiles(regionDef(MAP, 'street:mildew:5')!)!;
    expect(end.length).toBe(100);
    for (let x = 0; x < 10; x++) for (const z of [4, 5]) expect(at(end, 10, x, z)).toBe('crosswalk');
    expect(at(end, 10, 3, 3)).toBe('road');
    expect(regionDef(MAP, 'street:mildew:0')!.templateId).toBe(STREET_END_TEMPLATE);
    expect(regionDef(MAP, 'street:mildew:3')!.templateId).toBe(STREET_SEGMENT_TEMPLATE);
    expect(streetTiles(regionDef(MAP, LEGACY_HOME_LOT_ID)!)).toBeNull();
    // every crosswalk portal into a segment lands on a crosswalk tile
    for (const p of MAP.portals.filter((q) => q.kind === 'crosswalk' && q.b.regionId.startsWith('street:') && !q.a.regionId.startsWith('street:'))) {
      const s = regionDef(MAP, p.b.regionId)!;
      const tiles = streetTiles(s)!;
      expect(tiles[p.b.z * s.placement.width + p.b.x], p.id).toBe('crosswalk');
    }
  });

  it('is pure and deterministic: rebuilt maps are deep-equal and survive a JSON round trip unchanged', () => {
    const again = buildWorldMap({ genVersion: 1, contentVersion: 1, seed: 7 }, { regionId: LEGACY_HOME_LOT_ID, templateId: 'derelict' });
    expect(again).toEqual(MAP);
    expect(JSON.parse(JSON.stringify(MAP))).toEqual(MAP);
    // the seed does not move anything in v1 (neighbour templates are S7)
    expect(buildWorldMap({ genVersion: 1, contentVersion: 1, seed: 99 }, { regionId: LEGACY_HOME_LOT_ID, templateId: 'derelict' }).regions).toEqual(MAP.regions);
  });
});
