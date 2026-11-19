/**
 * REGION ACTIVATION SEAM (W-025 S3; S4 streaming, streaming.ts, calls the same functions from its tier evaluation).
 *
 * A non-home region becomes walkable by registering its services (regions.ts) over a STABLE state view (spatial
 * caches key on object identity).
 *
 * STORAGE (single source of truth, S4; DESIGN_WORLD_LEVELS §1.20). Every datum of a non-home region lives in exactly
 * one place at any time:
 *  - its lot-local grid: ALWAYS `town.regions[id].snapshot.lot` (active or dormant; never copied anywhere else);
 *  - its objects: `state.objects` (with `regionId`) while ACTIVE, `snapshot.objects` while DORMANT. An active
 *    region's `snapshot.objects` is `{}`; a dormant region has no object in `state.objects` (held items travel with
 *    their holder and are never frozen);
 *  - its closed-form data (`snapshot.data`: `genHash`, `modifiedTick`, absent residents' needs): the record.
 * So the one world payload (§1.11) round-trips every region byte for byte. On load, `restoreActiveRegions`
 * re-registers every non-home region listed in `town.stream.active` that has a live lot.
 *
 * Street regions get a plain lot (no walls, nothing buildable) plus the per-tile extra cost of `streetTiles`
 * (road / curb +2, verge / crosswalk 0); the cost is derived from the map, never saved. Residential lots other than
 * the home get two services: resident (every door works) and public (doors into the house closed, §1.7 item 4).
 */
import type { ObjectPlacement, LotState, WorldState } from '../types';
import type { RegionId } from '../../shared/world';
import { slotOfRegionId, streetTiles } from '../../shared/mildewLane';
import { recordFault } from './faults';
import { spawnObject } from './objects';
import { isHomeRegion, isRegionActive, registerRegion, withRegion, type RegionService } from './regions';
import type { Engine } from './types';
import { regionDefOf, streetCostOf } from './worldMove';

export interface ActivateRegionOptions {
  /** The region's lot-local grid (a lot template's LotState; `streetLot(...)` for streets). Kept by reference. */
  lot: LotState;
  /** Objects spawned into the region on this (first) activation. */
  objects?: readonly { defId: string; placement: ObjectPlacement; tint?: string | null }[];
  /** Derived resident list (S6 schedules); never saved. */
  residents?: () => readonly string[];
}

/** A street region's lot: no walls, nothing buildable, no entry points (portals join it to its neighbours). */
export function streetLot(eng: Engine, id: RegionId): LotState | null {
  const def = regionDefOf(eng, id);
  if (!def || !streetTiles(def)) return null;
  const { width, depth } = def.placement;
  return {
    width,
    depth,
    buildable: { x0: 0, z0: 0, x1: 0, z1: 0 },
    sidewalkZ: -1,
    entryPoints: [],
    walls: {},
    floors: new Array<null>(width * depth).fill(null),
    version: 0,
    wallVersion: 0,
    floorVersion: 0,
  };
}

export function liveLot(eng: Engine, id: RegionId): LotState | null {
  const rec = eng.state.town && eng.state.town.regions ? eng.state.town.regions[id] : undefined;
  const lot = rec && rec.snapshot ? (rec.snapshot.lot as LotState | null) : null;
  return lot && typeof lot === 'object' && Number.isInteger(lot.width) && Number.isInteger(lot.depth) ? lot : null;
}

/** Private interior? Residential lots other than the home (§1.5 ownership table). Streets / community: no. */
function hasPrivateInterior(eng: Engine, id: RegionId): boolean {
  const def = regionDefOf(eng, id);
  return !!def && def.kind === 'lot' && slotOfRegionId(id) !== null && !isHomeRegion(eng, id);
}

/**
 * The services of a region over STABLE state views: `getLot` is the region's grid, `getObjects` (optional) the map
 * its objects are read from (absent = `state.objects`, for an active region). Planning over a DORMANT region
 * (streaming.ts) builds the same services over its snapshot; they are never registered.
 */
export function regionServices(
  eng: Engine,
  id: RegionId,
  getLot: () => LotState | null,
  getObjects?: () => WorldState['objects'],
  residents?: () => readonly string[],
): RegionService | null {
  const factory = eng.spatialFactory;
  if (!factory) return null;
  const stepCost = streetCostOf(eng, id);
  const view = (privacy: boolean): WorldState => {
    const desc = { id, privacy, stepCost };
    return new Proxy({} as WorldState, {
      get(_t, k) {
        if (k === 'regionView') return desc;
        if (k === 'lot') return getLot();
        if (k === 'objects' && getObjects) return getObjects();
        return (eng.state as unknown as Record<PropertyKey, unknown>)[k];
      },
      has(_t, k) {
        return k === 'regionView' || k in eng.state;
      },
    });
  };
  const residentView = view(false);
  const service: RegionService = {
    id,
    lot: () => getLot() as LotState,
    spatial: factory(() => residentView, eng.content),
    residents,
  };
  if (hasPrivateInterior(eng, id)) {
    const publicView = view(true);
    service.publicSpatial = factory(() => publicView, eng.content);
  }
  return service;
}

/** Build and register the services of an active region whose live lot is in the town record. */
function registerServices(eng: Engine, id: RegionId, residents?: () => readonly string[]): boolean {
  if (!liveLot(eng, id)) return false;
  const service = regionServices(eng, id, () => liveLot(eng, id), undefined, residents);
  if (!service) return false;
  registerRegion(eng, service);
  return true;
}

/**
 * Re-activate a region whose record already holds its live lot (S4: a dormant region thawed by streaming, after its
 * objects went back into `state.objects`). Lists it in `town.stream.active` and registers its services.
 */
export function registerActiveRegion(eng: Engine, id: RegionId, residents?: () => readonly string[], opts: { restore?: boolean } = {}): boolean {
  const t = eng.state.town;
  if (!t || isHomeRegion(eng, id) || isRegionActive(eng, id)) return false;
  if (!registerServices(eng, id, residents)) return false;
  // a load only re-registers: the saved stream state (active list, dwell bookkeeping) is kept byte for byte
  if (opts.restore) return true;
  if (!t.stream.active.includes(id)) t.stream.active = [...t.stream.active, id].sort();
  t.stream.changedTick[id] = eng.state.tick;
  return true;
}

/**
 * Activate a region (S3 seam; S4 calls it from streaming). Refused (false, nothing changed) for the home, an
 * unknown / unfinished region, an already active one, or a world without a town. Deterministic: no RNG.
 */
export function activateRegion(eng: Engine, id: RegionId, opts: ActivateRegionOptions): { ok: true } | { ok: false; reason: string } {
  const t = eng.state.town;
  if (!t || typeof t !== 'object') return { ok: false, reason: 'no town' };
  if (isHomeRegion(eng, id)) return { ok: false, reason: 'the home is always active' };
  if (isRegionActive(eng, id)) return { ok: false, reason: 'already active' };
  const def = regionDefOf(eng, id);
  if (!def || def.kind === 'unfinished' || def.unfinished) return { ok: false, reason: 'not an open region' };
  if (!opts || !opts.lot || opts.lot.width !== def.placement.width || opts.lot.depth !== def.placement.depth) return { ok: false, reason: 'lot size does not match the region' };
  const tick = eng.state.tick;
  const prev = t.regions[id];
  t.regions[id] = {
    id,
    snapshot: { savedTick: tick, lot: opts.lot, objects: {}, data: {} },
    caughtUpTick: tick,
    firstActiveTick: prev && typeof prev.firstActiveTick === 'number' ? prev.firstActiveTick : tick,
  };
  if (!t.stream.active.includes(id)) t.stream.active = [...t.stream.active, id].sort();
  t.stream.changedTick[id] = tick;
  if (!registerServices(eng, id, opts.residents)) return { ok: false, reason: 'no spatial factory' };
  withRegion(eng, id, () => {
    for (const o of opts.objects ?? []) {
      try {
        spawnObject(eng, o.defId, JSON.parse(JSON.stringify(o.placement)) as ObjectPlacement, { value: eng.content.objects[o.defId]?.price ?? 0, tint: o.tint ?? null });
      } catch (e) {
        recordFault(eng, `region:${id}`, e);
      }
    }
  });
  return { ok: true };
}

/** On load / engine creation: re-register the active non-home regions saved in `town.stream.active`. */
export function restoreActiveRegions(eng: Engine, residents?: (id: RegionId) => (() => readonly string[]) | undefined): void {
  const t = eng.state.town;
  if (!t || !t.stream || !Array.isArray(t.stream.active)) return;
  for (const id of t.stream.active) {
    if (isHomeRegion(eng, id) || isRegionActive(eng, id) || !liveLot(eng, id)) continue;
    const def = regionDefOf(eng, id);
    if (!def || def.kind === 'unfinished' || def.unfinished) continue;
    registerServices(eng, id, residents ? residents(id) : undefined);
  }
}

/** Set (or replace) the derived resident list of an active region (S6 seam; tests). */
export function setRegionResidents(eng: Engine, id: RegionId, residents: () => readonly string[]): boolean {
  const s = eng.regions.services.get(id);
  if (!s) return false;
  s.residents = residents;
  return true;
}
