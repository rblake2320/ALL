/**
 * Region-aware engine core (W-025 S1, docs/DESIGN_WORLD_LEVELS.md §1.5).
 *
 * Every active region owns a SPATIAL SERVICE (grid, FieldCache(32), rooms) over its own lot-local `LotState`. The home
 * region's service is the engine's existing spatial service over `WorldState.lot` (unchanged object, unchanged
 * caches), so a home-only world steps byte-identically to the pre-world engine (AC-1).
 *
 * REGION SCOPE. Engine code reads `eng.spatial` (≈ 120 call sites) and the scope-aware lot (`scopeLot`). `eng.spatial`
 * is an accessor: it returns the spatial service of the region currently in scope. The step loop puts each agent's
 * region in scope while it updates that agent (`withRegion`), commands put the actor's region in scope, and
 * everything else (system ticks, views) runs in the home scope. With only the home region active the scope is always
 * the home, the accessor returns the very same service object, and nothing changes.
 *
 * Ownership rules (audit, §1.5 / §1.18):
 *  - agents and objects WITHOUT `regionId` are in the home region (old saves never carry the field);
 *  - a held object is in its holder's region; a dropped one takes that region;
 *  - the active set is the home plus every region with a registered service. S1/S2 never register one.
 *
 * Seams for later slices:
 *  - S4 (done): `registerRegion` / `unregisterRegion` are called by streaming (streaming.ts) when a region activates /
 *    goes dormant; a DORMANT region can still be planned over through `planningServiceOf` (services over its snapshot,
 *    never registered, never simulated).
 *  - S3 (done): boundary crossing and the route stage live in worldMove.ts; the public / resident step masks are the
 *    two spatial services of a private region (`maskFor`).
 */
import type { SpatialAPI } from '../contracts';
import type { AgentState, LotState, ObjectState } from '../types';
import type { RegionId } from '../../shared/world';
import { homeRegionIdOf } from '../../shared/town';
import type { Engine } from './types';

/** A non-home region's live services (S4 builds them on activation; S3: `activateRegion` in regionSetup.ts). */
export interface RegionService {
  id: RegionId;
  lot(): LotState;
  /** The RESIDENT step mask (every door works); the only mask of streets, community lots and vacant lots. */
  spatial: SpatialAPI;
  /**
   * W-025 S3: the PUBLIC step mask of a neighbour's residential lot (doors into the house are closed, §1.7 item 4).
   * Absent = the region has no private interior.
   */
  publicSpatial?: SpatialAPI;
  /**
   * W-025 S3: agents who live here (they always use the resident mask and answer the door). Derived, never saved:
   * S6 fills it from the townie schedules; until then a region has no residents unless a caller supplies them.
   */
  residents?: () => readonly string[];
}

/** Which step mask the region in scope is read with (§1.7 item 4). */
export type StepMask = 'resident' | 'public';

export interface RegionRegistry {
  /** The home region's spatial service (the engine's original one). */
  homeSpatial: SpatialAPI;
  /** Non-home active regions (empty until S4). */
  services: Map<RegionId, RegionService>;
  /** Region whose services `eng.spatial` / `scopeLot` resolve to; null = the home. */
  scope: RegionId | null;
  /** Step mask of the scoped region (only meaningful for a region with a `publicSpatial`). */
  mask: StepMask;
  /**
   * W-025 S4: planning-only services of a DORMANT region (streaming.ts installs it; null = the region cannot be
   * planned over: unfinished, blocked, or a world without a town). Never simulated, never registered.
   */
  planner?: (id: RegionId) => RegionService | null;
  /** W-025 S4: activate a dormant region right now for a household member about to cross into it (streaming.ts). */
  activateNow?: (id: RegionId, agentId: string) => boolean;
}

export function createRegionRegistry(homeSpatial: SpatialAPI): RegionRegistry {
  return { homeSpatial, services: new Map(), scope: null, mask: 'resident' };
}

/** The home region id: `town.homeLotId`, or the legacy slot for worlds without a town block. */
export function homeRegion(eng: Engine): RegionId {
  return homeRegionIdOf(eng.state);
}

export function isHomeRegion(eng: Engine, id: RegionId | null | undefined): boolean {
  return id === undefined || id === null || id === homeRegion(eng);
}

/** Region an agent stands in (absent `regionId` = home). */
export function agentRegion(eng: Engine, a: AgentState): RegionId {
  return typeof a.regionId === 'string' ? a.regionId : homeRegion(eng);
}

/** Region an object is in: a held item is in its holder's region; else `regionId`, absent = home. */
export function objectRegion(eng: Engine, o: ObjectState): RegionId {
  if (o.placement && o.placement.kind === 'held') {
    const holder = eng.state.agents[o.placement.agentId];
    if (holder) return agentRegion(eng, holder);
  }
  return typeof o.regionId === 'string' ? o.regionId : homeRegion(eng);
}

export function isRegionActive(eng: Engine, id: RegionId): boolean {
  return isHomeRegion(eng, id) || eng.regions.services.has(id);
}

/** True when the agent stands in an active region (always, for agents without `regionId`). */
export function isAgentInActiveRegion(eng: Engine, a: AgentState): boolean {
  return a.regionId === undefined || isRegionActive(eng, a.regionId);
}

/** Active regions, sorted ascending (deterministic order by RegionId, §1.4). */
export function activeRegions(eng: Engine): RegionId[] {
  return [homeRegion(eng), ...eng.regions.services.keys()].filter((v, i, all) => all.indexOf(v) === i).sort();
}

/** The spatial service of a region, or null when the region is not active. */
export function spatialOfRegion(eng: Engine, id: RegionId, mask: StepMask = 'resident'): SpatialAPI | null {
  if (isHomeRegion(eng, id)) return eng.regions.homeSpatial;
  const s = eng.regions.services.get(id);
  if (!s) return null;
  return mask === 'public' && s.publicSpatial ? s.publicSpatial : s.spatial;
}

/**
 * W-025 S4: the services a ROUTE may use for a region: the active ones, else the planning-only services of a dormant
 * region (its snapshot, or its regenerated build). null = not plannable.
 */
export function planningServiceOf(eng: Engine, id: RegionId): RegionService | null {
  const s = eng.regions.services.get(id);
  if (s) return s;
  const p = eng.regions.planner;
  if (!p || isHomeRegion(eng, id)) return null;
  try {
    return p(id);
  } catch {
    return null;
  }
}

/** `spatialOfRegion` for planning: active regions, then dormant ones (streaming.ts). */
export function planningSpatialOf(eng: Engine, id: RegionId, mask: StepMask = 'resident'): SpatialAPI | null {
  if (isHomeRegion(eng, id)) return eng.regions.homeSpatial;
  const s = planningServiceOf(eng, id);
  if (!s) return null;
  return mask === 'public' && s.publicSpatial ? s.publicSpatial : s.spatial;
}

/** The lot-local grid of a region, or null when the region is not active (`WorldState.lot` for the home). */
export function lotOfRegion(eng: Engine, id: RegionId): LotState | null {
  if (isHomeRegion(eng, id)) return eng.state.lot;
  const s = eng.regions.services.get(id);
  return s ? s.lot() : null;
}

/** Spatial service of the region in scope (the `eng.spatial` accessor). Unknown scope → home (never throws). */
export function scopeSpatial(eng: Engine): SpatialAPI {
  const r = eng.regions;
  if (r.scope === null) return r.homeSpatial;
  const s = r.services.get(r.scope);
  if (!s) return r.homeSpatial;
  return r.mask === 'public' && s.publicSpatial ? s.publicSpatial : s.spatial;
}

/** Lot of the region in scope (`WorldState.lot` in the home scope). */
export function scopeLot(eng: Engine): LotState {
  const r = eng.regions;
  if (r.scope === null) return eng.state.lot;
  const s = r.services.get(r.scope);
  return s ? s.lot() : eng.state.lot;
}

/** Region in scope. */
export function scopeRegion(eng: Engine): RegionId {
  return eng.regions.scope ?? homeRegion(eng);
}

/**
 * Run `fn` with `id` in scope (restored afterwards, also on throw). The home (or an inactive region) is the null
 * scope, so a home-only world never changes the scope at all.
 */
export function withRegion<T>(eng: Engine, id: RegionId | undefined, fn: () => T, mask: StepMask = 'resident'): T {
  const r = eng.regions;
  const next = id === undefined || isHomeRegion(eng, id) || !r.services.has(id) ? null : id;
  const nextMask: StepMask = next === null ? 'resident' : mask;
  if (next === r.scope && nextMask === r.mask) return fn();
  const prev = r.scope;
  const prevMask = r.mask;
  r.scope = next;
  r.mask = nextMask;
  try {
    return fn();
  } finally {
    r.scope = prev;
    r.mask = prevMask;
  }
}

/**
 * The step mask an agent walks a region with (§1.5 ownership, §1.7 item 4): the resident mask when the region has
 * no private interior, the agent lives there, was welcomed in (`AgentState.welcome`, until its tick) or stands
 * inside right now (so a visitor whose welcome ran out can still walk out); else the public mask.
 */
export function maskFor(eng: Engine, a: AgentState, id: RegionId): StepMask {
  if (isHomeRegion(eng, id)) return 'resident';
  // S4: a dormant neighbour's house is private too (its planning services carry the same public mask)
  const s = planningServiceOf(eng, id);
  if (!s || !s.publicSpatial) return 'resident';
  if (isWelcomed(eng, a, id)) return 'resident';
  try {
    if (s.residents && s.residents().includes(a.id)) return 'resident';
  } catch {
    /* a faulty resident list never opens a door */
  }
  if (agentRegion(eng, a) === id && a.pos) {
    const t = s.spatial.tileOf(a.pos);
    if (s.spatial.inBounds(t.x, t.z) && s.spatial.isIndoor(t.x, t.z)) return 'resident';
  }
  return 'public';
}

/** True while `a` holds a welcome into region `id` (knock → accepted, §1.5). */
export function isWelcomed(eng: Engine, a: AgentState, id: RegionId): boolean {
  const w = a.welcome;
  return !!w && w.regionId === id && typeof w.untilTick === 'number' && w.untilTick > eng.state.tick;
}

/** `withRegion` for an agent's region, with that agent's step mask. */
export function withAgentRegion<T>(eng: Engine, a: AgentState, fn: () => T): T {
  if (a.regionId === undefined && eng.regions.scope === null) return fn();
  const id = a.regionId;
  return withRegion(eng, id, fn, id === undefined ? 'resident' : maskFor(eng, a, id));
}

/**
 * `regionId` to stamp on an object created in the current scope: undefined in the home scope (the field stays absent,
 * byte-identical to the pre-world engine), else the scoped region.
 */
export function regionIdForNewObject(eng: Engine): RegionId | undefined {
  return eng.regions.scope === null ? undefined : eng.regions.scope;
}

/** Streaming (S4) registers a region's services when it becomes active. */
export function registerRegion(eng: Engine, service: RegionService): void {
  if (isHomeRegion(eng, service.id)) return;
  eng.regions.services.set(service.id, service);
}

/** Streaming (S4) unregisters a region's services when it goes dormant. */
export function unregisterRegion(eng: Engine, id: RegionId): void {
  eng.regions.services.delete(id);
  if (eng.regions.scope === id) {
    eng.regions.scope = null;
    eng.regions.mask = 'resident';
  }
}
