/**
 * HIERARCHICAL WORLD ROUTES (W-025 S3; docs/DESIGN_WORLD_LEVELS.md §1.7, contract `WorldRouteTarget` /
 * `WorldRouteResult` / `RouteFailReason` in world.ts).
 *
 * Grids are never merged (§1.1 measured why). A route is planned on a small PORTAL GRAPH:
 *  - nodes: the two sides of every portal (`<portalId>:a` / `<portalId>:b`), each standing on one representative tile
 *    pair of the portal's span (the cheapest usable pair, ties: nearest the span's centre, then lowest index);
 *  - crossing edge: side a ↔ side b, cost 1 (one step), skipped when the portal is locked (unless the planner is asked
 *    to ignore locks, which is how `locked` is told apart from `noPath`) or `oneWay` against its direction;
 *  - intra-region edges: the region's own local search (the caller's `legCost`, i.e. the existing 8-neighbour
 *    Dijkstra of that region's grid) between two nodes of the same region, evaluated lazily when a node is expanded;
 *  - start = the agent's tile, goal = the target tile.
 * Search = A* (heuristic: world Euclidean distance between tile centres, admissible because every grid step costs
 * ≥ its Euclidean length; ties: f, then g descending, then node key) with a hard node cap. The result is the ordered
 * list of portal crossings; the walker plans each local leg in its current region with the existing `findPath`.
 *
 * Classification (exactly one reason code per refusal, AC-14):
 *  1. malformed target / unknown region / tile outside the region → `noPath`;
 *  2. the target region is unfinished (§1.10) → `unfinished`; its district is locked → `locked`;
 *  3. a route with every rule applied → ok;
 *  4. else a route that exists only through a locked gate → `locked`;
 *  5. else a route that exists only through someone's private interior (resident mask) → `private`;
 *  6. else `noPath`.
 * Pure: every world fact comes from `RouteEnv`, so the same inputs always give the same answer (no RNG, no clock).
 */
import {
  type PortalDef,
  type RegionId,
  type RouteFailReason,
  type WorldMap,
  type WorldPoint,
  type WorldRegionDef,
  type WorldRouteResult,
  type WorldRouteTarget,
  REGION_MAX_TILES,
  lotToWorld,
  lotTileToWorldTile,
  placementWorldRect,
  worldTileToLotTile,
} from './world';

/** Player-facing text of a route refusal (the HUD's own strings are S11's `worldUi.*`; this is the sim's reason). */
export const ROUTE_REASON_TEXT: Record<RouteFailReason, string> = {
  noPath: "Can't get there",
  private: "That's someone's home",
  locked: "It's closed",
  unfinished: 'Under construction',
};

/** One tile pair of a portal opening: `a` in the side-a region, `b` in the side-b region (lot-local tiles). */
export interface PortalTilePair {
  a: WorldPoint;
  b: WorldPoint;
}

export interface PortalSpan {
  portal: PortalDef;
  /** World direction of a step from side a to side b (one unit axis vector). */
  dir: WorldPoint;
  /** `portal.width` pairs in increasing world coordinate along the shared edge (contract note 3, §1.18). */
  pairs: PortalTilePair[];
}

const DIRS: readonly WorldPoint[] = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

/** Resolve every portal's tile pairs through the world ↔ lot transforms. Malformed portals are left out. */
export function portalSpans(map: WorldMap): Map<string, PortalSpan> {
  const out = new Map<string, PortalSpan>();
  const byId = new Map(map.regions.map((r) => [r.id, r] as const));
  for (const p of map.portals) {
    const ra = byId.get(p.a.regionId);
    const rb = byId.get(p.b.regionId);
    if (!ra || !rb || !Number.isInteger(p.width) || p.width < 1 || p.width > REGION_MAX_TILES) continue;
    const wa = lotTileToWorldTile(ra.placement, p.a.x, p.a.z);
    const wb = lotTileToWorldTile(rb.placement, p.b.x, p.b.z);
    if (!wa || !wb) continue;
    const dir = DIRS.find((d) => wa.x + d.x === wb.x && wa.z + d.z === wb.z);
    if (!dir) continue;
    const along = dir.x !== 0 ? { x: 0, z: 1 } : { x: 1, z: 0 };
    const pairs: PortalTilePair[] = [];
    for (let i = 0; i < p.width; i++) {
      const la = worldTileToLotTile(ra.placement, wa.x + along.x * i, wa.z + along.z * i);
      const lb = worldTileToLotTile(rb.placement, wb.x + along.x * i, wb.z + along.z * i);
      if (!la || !lb) break;
      pairs.push({ a: la, b: lb });
    }
    if (pairs.length !== p.width) continue;
    out.set(p.id, { portal: p, dir, pairs });
  }
  return out;
}

/** What the planner may ask the world (implemented by the engine over live region grids). */
export interface RouteEnv {
  /** null when walkable; else why nobody may enter the region (unfinished area, locked district). */
  regionBlocked(id: RegionId): 'unfinished' | 'locked' | null;
  /** False when the region cannot be walked right now (not active: S4 activates regions ahead of walkers). */
  regionLive(id: RegionId): boolean;
  /** True when the portal's gate is locked (closed-but-unlocked gates open on approach). */
  portalLocked(portal: PortalDef): boolean;
  /** Can an agent stand on this tile (`resident` = the resident step mask)? */
  tileUsable(id: RegionId, x: number, z: number, resident: boolean): boolean;
  /** Extra cost of a tile (road +2), used only to choose a portal's representative tile pair. */
  tileCost(id: RegionId, x: number, z: number): number;
  /** Cheapest local walking cost between two tiles of one region (Infinity = unreachable). */
  legCost(id: RegionId, from: WorldPoint, to: WorldPoint, resident: boolean): number;
}

export interface RouteFrom {
  regionId: RegionId;
  x: number;
  z: number;
}

/** One portal crossing of a route: cross `portalId` from side `from` to the other side. */
export interface RouteCrossing {
  portalId: string;
  from: 'a' | 'b';
}

export interface PlannedRoute {
  crossings: RouteCrossing[];
  cost: number;
}

export interface PlanRules {
  /** Ignore gate locks (classification only). */
  ignoreLocks: boolean;
  /** Use the resident mask everywhere (classification only). */
  ignorePrivacy: boolean;
}

/** Hard bound on expanded nodes (design bound: 2,000 nodes world-wide, §1.7). */
export const ROUTE_NODE_CAP = 2000;

interface Node {
  key: string;
  regionId: RegionId;
  tile: WorldPoint;
  /** Portal + side this node stands on (null for start / goal). */
  portalId: string | null;
  side: 'a' | 'b' | null;
}

function regionOf(map: WorldMap, id: RegionId): WorldRegionDef | null {
  return map.regions.find((r) => r.id === id) ?? null;
}

function worldCentre(def: WorldRegionDef, t: WorldPoint): WorldPoint | null {
  return lotToWorld(def.placement, t.x + 0.5, t.z + 0.5);
}

/** Representative pair index of a span: usable on both sides, cheapest, nearest the centre, lowest index. -1 = none. */
export function representativePair(span: PortalSpan, env: RouteEnv, resident: (id: RegionId) => boolean): number {
  const p = span.portal;
  const mid = (span.pairs.length - 1) / 2;
  let best = -1;
  let bestKey: [number, number] = [Infinity, Infinity];
  for (let i = 0; i < span.pairs.length; i++) {
    const q = span.pairs[i];
    if (!env.tileUsable(p.a.regionId, q.a.x, q.a.z, resident(p.a.regionId))) continue;
    if (!env.tileUsable(p.b.regionId, q.b.x, q.b.z, resident(p.b.regionId))) continue;
    const c = env.tileCost(p.a.regionId, q.a.x, q.a.z) + env.tileCost(p.b.regionId, q.b.x, q.b.z);
    const k: [number, number] = [c, Math.abs(i - mid)];
    if (k[0] < bestKey[0] || (k[0] === bestKey[0] && k[1] < bestKey[1])) {
      best = i;
      bestKey = k;
    }
  }
  return best;
}

/**
 * A* over the portal graph from `from` to `to` under `rules`. `resident(regionId)` says whether the walker uses the
 * resident mask there (welcomed / resident); `rules.ignorePrivacy` forces it everywhere. null = no route.
 */
export function planRoute(
  map: WorldMap,
  spans: ReadonlyMap<string, PortalSpan>,
  from: RouteFrom,
  to: WorldRouteTarget,
  env: RouteEnv,
  resident: (id: RegionId) => boolean,
  rules: PlanRules,
): PlannedRoute | null {
  const res = (id: RegionId) => rules.ignorePrivacy || resident(id);
  const goalDef = regionOf(map, to.regionId);
  const startDef = regionOf(map, from.regionId);
  if (!goalDef || !startDef) return null;
  const goalW = worldCentre(goalDef, to);
  if (!goalW) return null;
  // same region: the local search decides when it can (the home's paths stay exactly the local ones)
  if (from.regionId === to.regionId && Number.isFinite(env.legCost(from.regionId, from, to, res(from.regionId)))) {
    return { crossings: [], cost: env.legCost(from.regionId, from, to, res(from.regionId)) };
  }
  // nodes per region
  const sideNodes = new Map<RegionId, Node[]>();
  const allNodes = new Map<string, Node>();
  const ids = [...spans.keys()].sort();
  for (const id of ids) {
    const span = spans.get(id)!;
    const p = span.portal;
    if (env.regionBlocked(p.a.regionId) || env.regionBlocked(p.b.regionId)) continue;
    if (!env.regionLive(p.a.regionId) || !env.regionLive(p.b.regionId)) continue;
    const i = representativePair(span, env, res);
    if (i < 0) continue;
    for (const side of ['a', 'b'] as const) {
      const regionId = side === 'a' ? p.a.regionId : p.b.regionId;
      const n: Node = { key: `${id}:${side}`, regionId, tile: span.pairs[i][side], portalId: id, side };
      allNodes.set(n.key, n);
      const list = sideNodes.get(regionId);
      if (list) list.push(n);
      else sideNodes.set(regionId, [n]);
    }
  }
  const start: Node = { key: '\u0000start', regionId: from.regionId, tile: { x: from.x, z: from.z }, portalId: null, side: null };
  const goal: Node = { key: '\u0000goal', regionId: to.regionId, tile: { x: to.x, z: to.z }, portalId: null, side: null };
  const defs = new Map<RegionId, WorldRegionDef>();
  const defOf = (id: RegionId) => {
    let d = defs.get(id);
    if (!d) {
      d = regionOf(map, id) ?? undefined;
      if (d) defs.set(id, d);
    }
    return d ?? null;
  };
  const h = (n: Node) => {
    const d = defOf(n.regionId);
    const w = d ? worldCentre(d, n.tile) : null;
    return w ? Math.hypot(w.x - goalW.x, w.z - goalW.z) : 0;
  };
  const g = new Map<string, number>([[start.key, 0]]);
  const prev = new Map<string, { from: string; crossing: RouteCrossing | null }>();
  const closed = new Set<string>();
  const open: { key: string; f: number; g: number }[] = [{ key: start.key, f: h(start), g: 0 }];
  const nodeOf = (k: string) => (k === start.key ? start : k === goal.key ? goal : allNodes.get(k)!);
  let expanded = 0;
  while (open.length > 0) {
    // pop the best open entry (f, then larger g, then key) — the open list is small (≤ a few hundred)
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i];
      const b = open[bi];
      if (a.f < b.f || (a.f === b.f && (a.g > b.g || (a.g === b.g && a.key < b.key)))) bi = i;
    }
    const cur = open.splice(bi, 1)[0];
    if (closed.has(cur.key) || cur.g !== g.get(cur.key)) continue;
    if (cur.key === goal.key) break;
    closed.add(cur.key);
    if (++expanded > ROUTE_NODE_CAP) return null;
    const n = nodeOf(cur.key);
    const relax = (to2: Node, cost: number, crossing: RouteCrossing | null) => {
      if (!Number.isFinite(cost) || closed.has(to2.key)) return;
      const ng = cur.g + cost;
      const old = g.get(to2.key);
      if (old !== undefined && !(ng < old)) return;
      g.set(to2.key, ng);
      prev.set(to2.key, { from: cur.key, crossing });
      open.push({ key: to2.key, f: ng + h(to2), g: ng });
    };
    // crossing edge
    if (n.portalId !== null && n.side !== null) {
      const span = spans.get(n.portalId)!;
      const p = span.portal;
      const other = allNodes.get(`${n.portalId}:${n.side === 'a' ? 'b' : 'a'}`);
      const allowedDir = !p.oneWay || n.side === 'a';
      const locked = !rules.ignoreLocks && env.portalLocked(p);
      // a node reached by crossing never crosses straight back (that would be a no-op loop)
      const via = prev.get(n.key);
      const justCrossed = !!(via && via.crossing && via.crossing.portalId === n.portalId);
      if (other && allowedDir && !locked && !justCrossed) relax(other, 1, { portalId: n.portalId, from: n.side });
    }
    // intra-region edges (and the goal)
    const r = res(n.regionId);
    if (n.regionId === goal.regionId) relax(goal, env.legCost(n.regionId, n.tile, goal.tile, r), null);
    for (const m of sideNodes.get(n.regionId) ?? []) {
      if (m.key === n.key) continue;
      relax(m, env.legCost(n.regionId, n.tile, m.tile, r), null);
    }
  }
  if (!g.has(goal.key)) return null;
  const crossings: RouteCrossing[] = [];
  let k = goal.key;
  for (let guard = 0; guard < ROUTE_NODE_CAP * 4 && k !== start.key; guard++) {
    const p = prev.get(k);
    if (!p) return null;
    if (p.crossing) crossings.push(p.crossing);
    k = p.from;
  }
  if (k !== start.key) return null;
  crossings.reverse();
  return { crossings, cost: g.get(goal.key)! };
}

/** A target as the contract shapes it, or null when it is malformed (UI garbage, forged commands). */
export function cleanRouteTarget(t: unknown): WorldRouteTarget | null {
  if (!t || typeof t !== 'object') return null;
  const q = t as Partial<WorldRouteTarget>;
  if (typeof q.regionId !== 'string' || q.regionId.length === 0 || q.regionId.length > 128) return null;
  if (!Number.isInteger(q.x) || !Number.isInteger(q.z)) return null;
  const x = q.x as number;
  const z = q.z as number;
  if (x < 0 || z < 0 || x >= REGION_MAX_TILES || z >= REGION_MAX_TILES) return null;
  return { regionId: q.regionId, x, z };
}

/** The echo a refusal of a malformed request carries (always a well-formed WorldRouteTarget). */
export function echoTarget(t: unknown): WorldRouteTarget {
  const q = (t && typeof t === 'object' ? t : {}) as Partial<WorldRouteTarget>;
  const regionId = typeof q.regionId === 'string' ? q.regionId.slice(0, 128) : '';
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < REGION_MAX_TILES ? v : 0);
  return { regionId, x: int(q.x), z: int(q.z) };
}

export interface ClassifiedRoute {
  result: WorldRouteResult;
  /** The crossings of an ok route (the walker stores them on its run). */
  crossings: RouteCrossing[];
}

/**
 * Plan + classify one request (see the header). `speed` = walking tiles per game minute of this agent (ETA).
 * Never throws for garbage; the result always echoes a well-formed target.
 */
export function routeWorld(
  map: WorldMap | null,
  spans: ReadonlyMap<string, PortalSpan> | null,
  from: RouteFrom | null,
  target: unknown,
  env: RouteEnv,
  resident: (id: RegionId) => boolean,
  speed: number,
): ClassifiedRoute {
  const fail = (t: WorldRouteTarget, reason: RouteFailReason): ClassifiedRoute => ({ result: { ok: false, target: t, reason }, crossings: [] });
  const to = cleanRouteTarget(target);
  if (!to) return fail(echoTarget(target), 'noPath');
  if (!map || !spans || !from) return fail(to, 'noPath');
  const def = regionOf(map, to.regionId);
  if (!def) return fail(to, 'noPath');
  if (def.kind === 'unfinished' || def.unfinished) return fail(to, 'unfinished');
  const rect = placementWorldRect(def.placement);
  if (!rect || to.x >= def.placement.width || to.z >= def.placement.depth) return fail(to, 'noPath');
  const blocked = env.regionBlocked(to.regionId);
  if (blocked) return fail(to, blocked);
  if (!regionOf(map, from.regionId)) return fail(to, 'noPath');
  const strict = planRoute(map, spans, from, to, env, resident, { ignoreLocks: false, ignorePrivacy: false });
  if (strict) {
    const v = Number.isFinite(speed) && speed > 0 ? speed : 1;
    const len = Math.round(strict.cost * 100) / 100;
    return {
      result: { ok: true, target: to, portals: strict.crossings.map((c) => c.portalId), lengthTiles: len, etaGameMin: Math.round((len / v) * 100) / 100 },
      crossings: strict.crossings,
    };
  }
  if (planRoute(map, spans, from, to, env, resident, { ignoreLocks: true, ignorePrivacy: false })) return fail(to, 'locked');
  if (planRoute(map, spans, from, to, env, resident, { ignoreLocks: true, ignorePrivacy: true })) return fail(to, 'private');
  return fail(to, 'noPath');
}

/** Encode / decode the crossings stored on a run (`run.data._route`: JSON scalars only, so a compact string). */
export function encodeRoute(c: readonly RouteCrossing[]): string {
  return c.map((x) => `${x.portalId}@${x.from}`).join('|');
}

export function decodeRoute(s: unknown): RouteCrossing[] | null {
  if (typeof s !== 'string') return null;
  if (s.length === 0) return [];
  const out: RouteCrossing[] = [];
  for (const part of s.split('|')) {
    const at = part.lastIndexOf('@');
    if (at <= 0) return null;
    const side = part.slice(at + 1);
    if (side !== 'a' && side !== 'b') return null;
    out.push({ portalId: part.slice(0, at), from: side });
  }
  return out;
}
