/**
 * CROSS-REGION MOVEMENT (W-025 S3; docs/DESIGN_WORLD_LEVELS.md §1.5 "Crossing a boundary", §1.7).
 *
 *  - The WorldMap is rebuilt from `town.map` (never saved) and cached per engine with its portal spans.
 *  - `routeFor` plans + classifies a request (shared/worldRoute.ts) against the LIVE region grids: local legs are the
 *    regions' own distance fields (public or resident step mask), crossings cost one step. S4: DORMANT regions are
 *    planned over too, with planning-only services over their snapshot (exact local costs, `planningServiceOf`);
 *    streaming activates them ahead of the walker, and a member who reaches a portal into a region that is still
 *    dormant activates it in that tick, before crossing (`regions.activateNow`).
 *  - A run whose target is in another region carries `params._wg` (target region). While the agent is not there,
 *    stage resolution returns a ROUTE LEG instead of the stage target: the goal is the portal tile of the next
 *    crossing (`data._route` = remaining crossings, `_xp` = 1 armed, `_xpi` = tile pair index). The leg's path ends
 *    with one waypoint past the portal tile, in the next region (outside this grid).
 *  - Movement crosses when the agent's position leaves its region's grid through that portal: `regionId` switches,
 *    `pos` / `prevPos` / `facing` / `prevFacing` / the path go through world coordinates, the remaining route is
 *    RE-PLANNED in the new region (so a gate that locked meanwhile, or a placed object, is seen at the next entry), all
 *    inside the movement phase of that tick: deterministic and save/load-safe (everything lives in the run's data).
 *  - Nothing here runs for a run without `_wg`, so a home-only world never reaches this file (AC-1).
 */
import type { InteractionDef, SpatialAPI } from '../contracts';
import type { ActiveInteraction, AgentState, ObjectState, Vec2 } from '../types';
import {
  type PortalDef,
  type RegionId,
  type RouteFailReason,
  type WorldMap,
  type WorldPoint,
  type WorldRegionDef,
  type WorldRouteResult,
  type WorldRouteTarget,
  lotFacingToWorld,
  lotToWorld,
  worldFacingToLot,
  worldTileToLotTile,
  worldToLot,
} from '../../shared/world';
import { buildWorldMap, streetTiles } from '../../shared/mildewLane';
import { assignStartNeighbours } from '../../shared/startNeighbours';
import { type ClassifiedRoute, type PortalSpan, type RouteEnv, ROUTE_REASON_TEXT, representativePair, cleanRouteTarget, decodeRoute, echoTarget, encodeRoute, portalSpans, routeWorld } from '../../shared/worldRoute';
import { homeRegionIdOf } from '../../shared/town';
import { agentRegion, isHomeRegion, isRegionActive, maskFor, objectRegion, planningServiceOf, planningSpatialOf, spatialOfRegion, withAgentRegion } from './regions';
import type { Resolution } from './stages';
import type { Engine } from './types';
import { agentSpeed } from './movement';
import { isNum, tileCenter } from './util';

export { ROUTE_REASON_TEXT };

interface WorldCache {
  key: string;
  map: WorldMap;
  spans: Map<string, PortalSpan>;
  streetCost: Map<RegionId, Float32Array | null>;
}

const caches = new WeakMap<Engine, WorldCache>();

/** The world map of this engine's world (null for a world without a town block: home-only, nothing to route). */
export function worldOf(eng: Engine): WorldCache | null {
  const t = eng.state.town;
  if (!t || typeof t !== 'object' || !t.map || typeof t.map !== 'object') return null;
  const home = homeRegionIdOf(eng.state);
  const templateId = t.start && typeof t.start.templateId === 'string' ? t.start.templateId : null;
  const key = `${t.map.genVersion}|${t.map.contentVersion}|${t.map.seed}|${home}|${templateId}|${t.start?.genVersion ?? 0}|${t.start?.neighbourSeed ?? 0}`;
  const c = caches.get(eng);
  if (c && c.key === key) return c;
  let map: WorldMap;
  try {
    map = buildWorldMap(t.map, { regionId: home, templateId });
    assignStartNeighbours(map, home, t.start);
  } catch {
    return null;
  }
  const next: WorldCache = { key, map, spans: portalSpans(map), streetCost: new Map() };
  caches.set(eng, next);
  return next;
}

export function regionDefOf(eng: Engine, id: RegionId): WorldRegionDef | null {
  const w = worldOf(eng);
  return w ? w.map.regions.find((r) => r.id === id) ?? null : null;
}

/** Per-tile extra cost of a street region (road and curb +2, verge and crosswalk 0), or null for other regions. */
export function streetCostOf(eng: Engine, id: RegionId): Float32Array | null {
  const w = worldOf(eng);
  if (!w) return null;
  if (w.streetCost.has(id)) return w.streetCost.get(id) ?? null;
  const def = w.map.regions.find((r) => r.id === id);
  const kinds = def ? streetTiles(def) : null;
  const out = kinds ? Float32Array.from(kinds, (k) => (k === 'road' || k === 'curb' ? 2 : 0)) : null;
  w.streetCost.set(id, out);
  return out;
}

/** The gate object of a portal: `gateObjectId` (S14 sets it), else an object in side a with `data.gatePortal` = id. */
export function gateObjectOf(eng: Engine, p: PortalDef): ObjectState | null {
  if (typeof p.gateObjectId === 'string') {
    const o = eng.state.objects[p.gateObjectId];
    if (o) return o;
  }
  for (const o of Object.values(eng.state.objects)) {
    if (o && o.data && o.data.gatePortal === p.id && objectRegion(eng, o) === p.a.regionId) return o;
  }
  return null;
}

/** A gate is impassable only while LOCKED (a closed gate opens on approach, like a door today; §1.7 item 4). */
export function portalLockedNow(eng: Engine, p: PortalDef): boolean {
  const g = gateObjectOf(eng, p);
  return !!g && g.data.locked === true;
}

/** Why nobody may enter a region now: unfinished (§1.10) or a district whose level is still locked. */
export function regionBlockedNow(eng: Engine, def: WorldRegionDef | null): 'unfinished' | 'locked' | null {
  if (!def) return 'unfinished';
  if (def.kind === 'unfinished' || def.unfinished) return 'unfinished';
  const w = worldOf(eng);
  const t = eng.state.town;
  const district = w ? w.map.districts.find((d) => d.id === def.districtId) : undefined;
  if (district && district.status === 'unfinished') return 'unfinished';
  if (district && t && Array.isArray(t.unlockedLevels) && !t.unlockedLevels.includes(district.levelId)) return 'locked';
  return null;
}

function tileIdx(sp: SpatialAPI, t: WorldPoint): number {
  return sp.tileIndex(t.x, t.z);
}

/** RouteEnv over the live engine for one walker. */
export function routeEnv(eng: Engine): RouteEnv {
  const w = worldOf(eng);
  const defs = new Map((w ? w.map.regions : []).map((r) => [r.id, r] as const));
  const blocked = new Map<RegionId, 'unfinished' | 'locked' | null>();
  const locks = new Map<string, boolean>();
  return {
    regionBlocked(id) {
      if (!blocked.has(id)) blocked.set(id, regionBlockedNow(eng, defs.get(id) ?? null));
      return blocked.get(id) ?? null;
    },
    regionLive(id) {
      // S4: active, or dormant but plannable (its snapshot / regenerated build); streaming activates it ahead
      return isRegionActive(eng, id) || planningServiceOf(eng, id) !== null;
    },
    portalLocked(p) {
      if (!locks.has(p.id)) locks.set(p.id, portalLockedNow(eng, p));
      return locks.get(p.id) === true;
    },
    tileUsable(id, x, z, resident) {
      const sp = planningSpatialOf(eng, id, resident ? 'resident' : 'public');
      return !!sp && sp.inBounds(x, z) && sp.isWalkable(x, z);
    },
    tileCost(id, x, z) {
      const c = streetCostOf(eng, id);
      const d = defs.get(id);
      return c && d && x >= 0 && z >= 0 && x < d.placement.width && z < d.placement.depth ? c[z * d.placement.width + x] : 0;
    },
    legCost(id, from, to, resident) {
      const sp = planningSpatialOf(eng, id, resident ? 'resident' : 'public');
      if (!sp || !sp.inBounds(from.x, from.z) || !sp.inBounds(to.x, to.z)) return Infinity;
      if (from.x === to.x && from.z === to.z) return sp.isWalkable(to.x, to.z) ? 0 : Infinity;
      try {
        const df = sp.distanceField(tileCenter(from));
        const c = df.dist[tileIdx(sp, to)];
        return isNum(c) ? c : Infinity;
      } catch {
        return Infinity;
      }
    },
  };
}

/** The walker's resident mask per region (planning). */
function residentFn(eng: Engine, agent: AgentState): (id: RegionId) => boolean {
  return (id) => maskFor(eng, agent, id) === 'resident';
}

/** Where the walker stands, as a route origin (its region + tile). */
function originOf(eng: Engine, agent: AgentState): { regionId: RegionId; x: number; z: number } | null {
  const id = agentRegion(eng, agent);
  const sp = spatialOfRegion(eng, id);
  if (!sp || !agent.pos || !isNum(agent.pos.x) || !isNum(agent.pos.z)) return null;
  const t = sp.tileOf(agent.pos);
  return sp.inBounds(t.x, t.z) ? { regionId: id, x: t.x, z: t.z } : null;
}

/** A blocked target tile is moved to the nearest walkable tile within 3 (the local Go Here rule, stages.ts). */
function walkableTarget(eng: Engine, t: WorldRouteTarget): WorldRouteTarget {
  const sp = planningSpatialOf(eng, t.regionId);
  if (!sp || !sp.inBounds(t.x, t.z) || sp.isWalkable(t.x, t.z)) return t;
  const w = sp.nearestWalkable(tileCenter(t), 3);
  return w ? { regionId: t.regionId, x: w.x, z: w.z } : t;
}

/**
 * Plan + classify a walk of `agent` to `target` (contract `WorldRouteResult`). Pure with respect to the world: reads
 * only, changes nothing (spatial caches aside). The echoed target is the requested one.
 */
export function routeFor(eng: Engine, agent: AgentState | null | undefined, target: unknown): ClassifiedRoute {
  const clean = cleanRouteTarget(target);
  const fail = (reason: RouteFailReason): ClassifiedRoute => ({ result: { ok: false, target: clean ?? echoTarget(target), reason }, crossings: [] });
  if (!clean) return fail('noPath');
  const w = worldOf(eng);
  if (!agent || agent.presence !== 'onLot') return fail('noPath');
  const from = originOf(eng, agent);
  const env = routeEnv(eng);
  const planTo = w && (isRegionActive(eng, clean.regionId) || planningServiceOf(eng, clean.regionId)) ? walkableTarget(eng, clean) : clean;
  const r = routeWorld(w ? w.map : null, w ? w.spans : null, from, planTo, env, residentFn(eng, agent), agentSpeed(eng, agent));
  return r.result.ok ? { result: { ...r.result, target: clean }, crossings: r.crossings } : { result: { ...r.result, target: clean }, crossings: [] };
}

/** The region + tile a queued target refers to, for planning (null = not resolvable). */
export function planTargetOf(eng: Engine, run: { target: ActiveInteraction['target']; params: ActiveInteraction['params'] }): WorldRouteTarget | null {
  const wg = run.params._wg;
  if (typeof wg !== 'string') return null;
  const t = run.target;
  if (t.kind === 'tile') return isNum(t.x) && isNum(t.z) ? { regionId: wg, x: Math.floor(t.x), z: Math.floor(t.z) } : null;
  if (t.kind === 'object') {
    const o = eng.state.objects[t.id];
    return o ? objectPlanTile(eng, o) : null;
  }
  if (t.kind === 'agent') {
    const a = eng.state.agents[t.id];
    if (!a || a.presence !== 'onLot') return null;
    const id = agentRegion(eng, a);
    const sp = spatialOfRegion(eng, id);
    if (!sp) return null;
    const tt = sp.tileOf(a.pos);
    return sp.inBounds(tt.x, tt.z) ? { regionId: id, x: tt.x, z: tt.z } : null;
  }
  return null;
}

/**
 * The tile a walk toward an object aims at before the stage itself resolves: a door's OUTDOOR side (knocking happens
 * outside), otherwise the object's tile or the nearest walkable tile next to it (resident mask: an object inside a
 * neighbour's house is then `private` for a walker without a welcome).
 */
export function objectPlanTile(eng: Engine, o: ObjectState): WorldRouteTarget | null {
  const id = objectRegion(eng, o);
  const sp = spatialOfRegion(eng, id);
  if (!sp) return null;
  const p = o.placement;
  if (p.kind === 'opening') {
    const m = /^([hv]):(-?\d+):(-?\d+)$/.exec(p.edge);
    if (!m) return null;
    const x = Number(m[2]);
    const z = Number(m[3]);
    const sides = m[1] === 'h' ? [{ x, z: z - 1 }, { x, z }] : [{ x: x - 1, z }, { x, z }];
    const out = sides.filter((s) => sp.inBounds(s.x, s.z) && !sp.isIndoor(s.x, s.z));
    const pick = out[0] ?? sides.find((s) => sp.inBounds(s.x, s.z));
    return pick ? { regionId: id, x: pick.x, z: pick.z } : null;
  }
  const c = sp.objectCenter(o);
  const t = sp.tileOf(c);
  if (sp.inBounds(t.x, t.z) && sp.isWalkable(t.x, t.z)) return { regionId: id, x: t.x, z: t.z };
  const n = sp.nearestWalkable(c, 2);
  return n ? { regionId: id, x: n.x, z: n.z } : null;
}

const FAIL = (reason: string): Resolution => ({ ok: false, reason });

/**
 * The route leg of a run that targets another region (null = no leg: resolve the stage normally). Re-plans from the
 * agent's position every call (each region entry, each re-resolve), stores the crossings and arms the next one.
 */
export function worldLeg(eng: Engine, agent: AgentState, run: ActiveInteraction): Resolution | null {
  if (typeof run.params._wg !== 'string' || run.stage !== 0) return null;
  const target = planTargetOf(eng, run);
  if (!target) {
    clearLeg(run);
    return FAIL(ROUTE_REASON_TEXT.noPath);
  }
  const r = routeFor(eng, agent, target);
  if (!r.result.ok) {
    clearLeg(run);
    return FAIL(ROUTE_REASON_TEXT[r.result.reason]);
  }
  if (r.crossings.length === 0) {
    clearLeg(run);
    return null; // in the target region (or it is reachable locally): the stage resolves as usual
  }
  const next = r.crossings[0];
  const w = worldOf(eng);
  const span = w ? w.spans.get(next.portalId) : undefined;
  if (!span) return FAIL(ROUTE_REASON_TEXT.noPath);
  // where the walker heads after this crossing: the next crossing's tile, or the target itself
  let after: WorldPoint | null = null;
  if (r.crossings.length > 1) {
    const s2 = w ? w.spans.get(r.crossings[1].portalId) : undefined;
    const i2 = s2 ? representativePair(s2, routeEnv(eng), residentFn(eng, agent)) : -1;
    if (s2 && i2 >= 0) after = s2.pairs[i2][r.crossings[1].from];
  } else after = { x: target.x, z: target.z };
  const pick = pickPair(eng, agent, span, next.from, after);
  if (pick < 0) return FAIL(ROUTE_REASON_TEXT.noPath);
  run.data._route = encodeRoute(r.crossings);
  run.data._xp = 1;
  run.data._xpi = pick;
  const goal = span.pairs[pick][next.from];
  return { ok: true, target: { kind: 'self' }, slot: null, goal: { x: goal.x, z: goal.z }, pose: null, kind: 'target', objectId: null, face: null };
}

function clearLeg(run: ActiveInteraction): void {
  if (run.data._route !== undefined) run.data._route = null;
  if (run.data._xp !== undefined) run.data._xp = null;
  if (run.data._xpi !== undefined) run.data._xpi = null;
}

/**
 * The tile pair of a crossing the agent walks to: usable on both sides, cheapest walk from the agent to it plus from
 * the far tile on to where the walker heads next (`after`, in the far region), lowest index on ties.
 */
function pickPair(eng: Engine, agent: AgentState, span: PortalSpan, from: 'a' | 'b', after: WorldPoint | null): number {
  const p = span.portal;
  const here = from === 'a' ? p.a.regionId : p.b.regionId;
  const there = from === 'a' ? p.b.regionId : p.a.regionId;
  const to = from === 'a' ? 'b' : 'a';
  const spHere = eng.spatial;
  const spThere = planningSpatialOf(eng, there, maskFor(eng, agent, there));
  if (!spThere || agentRegion(eng, agent) !== here) return -1;
  let df: ReturnType<SpatialAPI['distanceField']> | null = null;
  try {
    df = spHere.distanceField(agent.pos);
  } catch {
    df = null;
  }
  if (!df) return -1;
  let onward: ReturnType<SpatialAPI['distanceField']> | null = null;
  if (after && spThere.inBounds(after.x, after.z)) {
    try {
      onward = spThere.distanceField(tileCenter(after));
    } catch {
      onward = null;
    }
  }
  let best = -1;
  let bestCost = Infinity;
  for (let i = 0; i < span.pairs.length; i++) {
    const a = span.pairs[i][from];
    const b = span.pairs[i][to];
    if (!spHere.inBounds(a.x, a.z) || !spHere.isWalkable(a.x, a.z)) continue;
    if (!spThere.inBounds(b.x, b.z) || !spThere.isWalkable(b.x, b.z)) continue;
    const near = df.dist[spHere.tileIndex(a.x, a.z)];
    const far = onward ? onward.dist[spThere.tileIndex(b.x, b.z)] : 0;
    const c = near + (isNum(far) && Number.isFinite(far) ? far : onward ? Infinity : 0);
    if (isNum(c) && Number.isFinite(c) && c < bestCost) {
      best = i;
      bestCost = c;
    }
  }
  return best;
}

interface ArmedCrossing {
  span: PortalSpan;
  from: 'a' | 'b';
  index: number;
  here: RegionId;
  there: RegionId;
}

function armed(eng: Engine, agent: AgentState, run: ActiveInteraction | null): ArmedCrossing | null {
  if (!run || run.data._xp !== 1 || !isNum(run.data._xpi)) return null;
  const route = decodeRoute(run.data._route);
  const w = worldOf(eng);
  if (!route || route.length === 0 || !w) return null;
  const span = w.spans.get(route[0].portalId);
  if (!span || run.data._xpi < 0 || run.data._xpi >= span.pairs.length) return null;
  const from = route[0].from;
  const here = from === 'a' ? span.portal.a.regionId : span.portal.b.regionId;
  const there = from === 'a' ? span.portal.b.regionId : span.portal.a.regionId;
  if (agentRegion(eng, agent) !== here) return null;
  return { span, from, index: run.data._xpi, here, there };
}

function placementOf(eng: Engine, id: RegionId) {
  const d = regionDefOf(eng, id);
  return d ? d.placement : null;
}

/** Lot-local point of region `from` → lot-local point of region `to` (through world coordinates). */
function transfer(eng: Engine, from: RegionId, to: RegionId, p: Vec2): Vec2 | null {
  const w = lotToWorld(placementOf(eng, from), p.x, p.z);
  return w ? worldToLot(placementOf(eng, to), w.x, w.z) : null;
}

/** The path of a route leg: the local path to the portal tile, then one waypoint past it (the far tile's centre). */
export function legPath(eng: Engine, agent: AgentState, run: ActiveInteraction, local: Vec2[] | null): Vec2[] | null {
  if (run.data._xp !== 1) return local;
  const x = armed(eng, agent, run);
  if (!x || !local) return null;
  const far = x.span.pairs[x.index][x.from === 'a' ? 'b' : 'a'];
  const p = transfer(eng, x.there, x.here, tileCenter(far));
  return p ? [...local, p] : null;
}

/**
 * movement.ts: may this step leave the grid? Only the last waypoint of an armed leg, from the portal tile, onto the
 * far tile when that tile is walkable in the next region right now (an object placed there blocks the crossing and
 * the run re-plans).
 */
export function crossingStepAllowed(eng: Engine, agent: AgentState, fromTile: { x: number; z: number }): boolean {
  const run = agent.active;
  const path = agent.path;
  if (!run || !path || agent.pathIndex !== path.length - 1) return false;
  const x = armed(eng, agent, run);
  if (!x) return false;
  const a = x.span.pairs[x.index][x.from];
  if (a.x !== fromTile.x || a.z !== fromTile.z) return false;
  const b = x.span.pairs[x.index][x.from === 'a' ? 'b' : 'a'];
  const sp = planningSpatialOf(eng, x.there, maskFor(eng, agent, x.there));
  return !!sp && sp.inBounds(b.x, b.z) && sp.isWalkable(b.x, b.z) && !(x.span.portal.oneWay && x.from === 'b');
}

/** True when the agent's position has left its region's grid on an armed leg (the crossing happens now). */
export function crossingDue(eng: Engine, agent: AgentState): boolean {
  const run = agent.active;
  if (!run || run.data._xp !== 1) return false;
  const t = eng.spatial.tileOf(agent.pos);
  return !eng.spatial.inBounds(t.x, t.z);
}

/**
 * Cross the armed portal (called inside the movement phase, in the old region's scope). Returns true when the agent
 * is now in the next region; `afterCross` then re-plans there (runner.reResolve under the new scope).
 */
export function crossPortal(eng: Engine, agent: AgentState, run: ActiveInteraction, def: InteractionDef, afterCross: (eng: Engine, a: AgentState, r: ActiveInteraction, d: InteractionDef) => void): boolean {
  const x = armed(eng, agent, run);
  if (!x || regionBlockedNow(eng, regionDefOf(eng, x.there)) || portalLockedNow(eng, x.span.portal)) return false;
  // S4: a member never stands in a frozen region: the region past the portal activates now, before the crossing
  // (streaming normally did it ahead, PREACTIVATE_TILES before the portal). Others do not wake regions (S6 seam).
  if (!isRegionActive(eng, x.there)) {
    const now = eng.regions.activateNow;
    if (!now || !now(x.there, agent.id) || !isRegionActive(eng, x.there)) return false;
  }
  const pos = transfer(eng, x.here, x.there, agent.pos);
  const prev = transfer(eng, x.here, x.there, agent.prevPos ?? agent.pos);
  const pa = placementOf(eng, x.here);
  const pb = placementOf(eng, x.there);
  if (!pos || !prev || !pa || !pb) return false;
  // the new position must lie on the far tile's grid (it just stepped over the shared edge)
  const spThere = spatialOfRegion(eng, x.there);
  if (!spThere) return false;
  const t = spThere.tileOf(pos);
  if (!spThere.inBounds(t.x, t.z)) return false;
  const turn = (f: number) => {
    const v = worldFacingToLot(pb, lotFacingToWorld(pa, f));
    return Number.isFinite(v) ? v : f;
  };
  const route = decodeRoute(run.data._route) ?? [];
  agent.pos = pos;
  agent.prevPos = prev;
  agent.facing = turn(agent.facing);
  agent.prevFacing = turn(isNum(agent.prevFacing) ? agent.prevFacing : agent.facing);
  if (agent.path) {
    const moved: Vec2[] = [];
    for (let i = agent.pathIndex; i < agent.path.length; i++) {
      const q = transfer(eng, x.here, x.there, agent.path[i]);
      if (q) moved.push(q);
    }
    agent.path = moved;
    agent.pathIndex = 0;
  }
  if (isHomeRegion(eng, x.there)) delete agent.regionId;
  else agent.regionId = x.there;
  run.data._route = encodeRoute(route.slice(1));
  run.data._xp = null;
  run.data._xpi = null;
  eng.ctx.emit({ type: 'regionCrossed', agentId: agent.id, from: x.here, to: x.there, portalId: x.span.portal.id });
  withAgentRegion(eng, agent, () => afterCross(eng, agent, run, def));
  return true;
}

/** World tile → (region, lot-local tile) on the map, preferring open regions (null = outside every region). */
export function regionAtWorldTile(eng: Engine, wx: number, wz: number): WorldRouteTarget | null {
  const w = worldOf(eng);
  if (!w || !Number.isInteger(wx) || !Number.isInteger(wz)) return null;
  for (const r of w.map.regions) {
    const t = worldTileToLotTile(r.placement, wx, wz);
    if (t) return { regionId: r.id, x: t.x, z: t.z };
  }
  return null;
}

/** The public `sim.worldRoute(actorId, target)` query (S11 / S13 controller seam). */
export function worldRouteQuery(eng: Engine, actorId: unknown, target: unknown): WorldRouteResult {
  const a = typeof actorId === 'string' ? eng.state.agents[actorId] : undefined;
  if (!a) return routeFor(eng, null, target).result;
  return withAgentRegion(eng, a, () => routeFor(eng, a, target).result);
}
