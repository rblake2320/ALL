/**
 * createSpatial(getState, content): SpatialAPI — the lot's geometry service.
 *
 * Caching (all derived data is rebuilt from WorldState; nothing here is saved):
 *  - The Grid (occupancy, walls, openings, step mask) is rebuilt when the state object, the lot object,
 *    lot.version, lot.wallVersion or the invalidate() counter changes. Once per new state.tick the cheap blocked-tile
 *    signature is re-derived; if it differs (e.g. fire spawned without a version bump) the Grid is rebuilt too.
 *    Every rebuild bumps an internal epoch and drops the distance-field cache.
 *  - Rooms are revalidated on every Grid rebuild by comparing wall presence (so a paint-only wallVersion bump reuses
 *    them, and a wall edit is picked up even when only lot.version was bumped).
 *  - Distance fields: LRU of 32 keyed by origin tile, valid for one epoch; DistanceField.version = lot.version.
 *    Returned fields are shared cache entries: treat them as read-only. findPath uses the cached field of its origin
 *    when present, else a single-target early-exit search (pathfinding.ts) that yields the identical chain without
 *    computing / caching a whole field.
 *  - Environment tables are recomputed lazily once per tick / epoch.
 * Inputs: tile-taking methods floor() their arguments; NaN / out-of-bounds input never throws (false / null / 0 / []).
 * Fault containment: every public method catches internal errors, records them (debugFaults()) and returns a safe
 * fallback, so a corrupt save can degrade behaviour but never crash the tick.
 */
import type {
  ContentRegistry,
  DistanceField,
  PlacementResult,
  ResolvedSlot,
  RoomInfo,
  SpatialAPI,
} from '../contracts';
import type { LotState, ObjectId, ObjectState, Vec2, WorldState } from '../types';
import type { Rot } from '../../shared/dimensions';
import { buildGrid, computeBlocked, gridBuildable, gridCanStep, gridWalkable, inGrid, lotDims, WALL_NONE, type Grid } from './grid';
import { computeRooms, type RoomData } from './rooms';
import { chainTo, dijkstra, emptyField, FieldCache, MinHeap, nearestWalkableTile, reconstruct, smoothPath } from './pathfinding';
import {
  freeSurfaceNear as freeSurfaceNearImpl,
  objectCenter as objectCenterImpl,
  objectTiles as objectTilesImpl,
  resolveSlots as resolveSlotsImpl,
  surfacePoints as surfacePointsImpl,
} from './slots';
import { computeEnvTables, outdoorScore, type EnvTables } from './environment';
import { applyHomeBuildRules, snapSpots } from './homeBuildRules';
import { FREE_PLACEMENT_AT, serviceOf } from '../../shared/homeBuild';
import { checkOpening as checkOpeningImpl, checkPlace as checkPlaceImpl, checkWallItem as checkWallItemImpl } from './placement';

export interface SpatialFault {
  where: string;
  message: string;
}

/** Non-contract extras (tests, debug overlay, build service). Structural superset of SpatialAPI. */
export interface SpatialDebug {
  debugFaults(): SpatialFault[];
  debugStats(): { epoch: number; rebuilds: number; fieldsCached: number; dijkstraRuns: number };
}

export type SpatialService = SpatialAPI & SpatialDebug;

interface Cache {
  state: WorldState | null;
  lot: LotState | null;
  version: unknown;
  wallVersion: unknown;
  invalidations: number;
  tick: unknown;
  grid: Grid;
  epoch: number;
  rooms: RoomData | null;
  /** Grid epoch the rooms were last validated against. */
  roomsEpoch: number;
  /** Wall presence (any segment) the rooms were computed from: wallH bits then wallV bits. */
  roomsWalls: Uint8Array | null;
  env: { tick: unknown; epoch: number; tables: EnvTables; outdoor: Map<number, number> } | null;
}

const MAX_FAULTS = 50;

export function createSpatial(getState: () => WorldState, content: ContentRegistry): SpatialService {
  let invalidations = 0;
  let rebuilds = 0;
  let dijkstraRuns = 0;
  const faults: SpatialFault[] = [];
  const fields = new FieldCache(32);
  const heap = new MinHeap(4096);
  let scratch = new Float64Array(0);
  let parentScratch = new Int32Array(0);
  let blockedScratch = new Uint8Array(0);
  const emptyGrid = buildGrid({ lot: { width: 0, depth: 0 } } as unknown as WorldState, content);
  const cache: Cache = {
    state: null,
    lot: null,
    version: undefined,
    wallVersion: undefined,
    invalidations: -1,
    tick: undefined,
    grid: emptyGrid,
    epoch: 0,
    rooms: null,
    roomsEpoch: -1,
    roomsWalls: null,
    env: null,
  };

  function fault(where: string, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    faults.push({ where, message });
    if (faults.length > MAX_FAULTS) faults.splice(0, faults.length - MAX_FAULTS);
  }

  function rebuild(s: WorldState): void {
    cache.grid = buildGrid(s, content);
    cache.epoch++;
    rebuilds++;
    fields.clear();
    cache.env = null;
    if (scratch.length < cache.grid.n) scratch = new Float64Array(cache.grid.n);
    if (parentScratch.length < cache.grid.n) parentScratch = new Int32Array(cache.grid.n);
  }

  function sync(): Cache {
    const s = getState();
    const lot = s ? s.lot : null;
    if (!s || !lot || typeof lot !== 'object') {
      if (cache.state !== null || cache.grid !== emptyGrid) {
        cache.state = null;
        cache.lot = null;
        cache.grid = emptyGrid;
        cache.epoch++;
        fields.clear();
        cache.rooms = null;
        cache.roomsWalls = null;
        cache.env = null;
      }
      return cache;
    }
    const structural =
      s !== cache.state ||
      lot !== cache.lot ||
      !Object.is(lot.version, cache.version) ||
      !Object.is(lot.wallVersion, cache.wallVersion) ||
      invalidations !== cache.invalidations;
    if (structural) {
      cache.state = s;
      cache.lot = lot;
      cache.version = lot.version;
      cache.wallVersion = lot.wallVersion;
      cache.invalidations = invalidations;
      cache.tick = s.tick;
      rebuild(s);
    } else if (!Object.is(s.tick, cache.tick)) {
      cache.tick = s.tick;
      const { w, d } = lotDims(s);
      if (w * d === cache.grid.n) {
        if (blockedScratch.length !== w * d) blockedScratch = new Uint8Array(w * d);
        computeBlocked(s, content, w, d, blockedScratch);
        const cur = cache.grid.blocked;
        let same = true;
        for (let i = 0; i < cur.length; i++) {
          if (cur[i] !== blockedScratch[i]) {
            same = false;
            break;
          }
        }
        if (!same) rebuild(s);
      } else rebuild(s);
    }
    return cache;
  }

  /**
   * Rooms depend only on where wall segments are. They are revalidated whenever the grid is rebuilt (any version /
   * wallVersion / invalidate change) by comparing wall presence, so paint-only changes reuse them and wall edits are
   * picked up even if a writer forgot to bump wallVersion.
   */
  function roomsOf(c: Cache): RoomData {
    if (c.rooms && c.roomsEpoch === c.epoch) return c.rooms;
    const g = c.grid;
    const presence = new Uint8Array(g.wallH.length + g.wallV.length);
    for (let i = 0; i < g.wallH.length; i++) presence[i] = g.wallH[i] !== WALL_NONE ? 1 : 0;
    for (let i = 0; i < g.wallV.length; i++) presence[g.wallH.length + i] = g.wallV[i] !== WALL_NONE ? 1 : 0;
    const prev = c.roomsWalls;
    let same = !!c.rooms && !!prev && prev.length === presence.length && c.rooms.roomOf.length === g.n;
    if (same && prev) {
      for (let i = 0; i < presence.length; i++) {
        if (prev[i] !== presence[i]) {
          same = false;
          break;
        }
      }
    }
    if (!same || !c.rooms) {
      c.rooms = computeRooms(
        g.w,
        g.d,
        (x, z) => g.wallH[z * g.w + x] !== WALL_NONE,
        (x, z) => g.wallV[z * (g.w + 1) + x] !== WALL_NONE,
      );
      c.roomsWalls = presence;
    }
    c.roomsEpoch = c.epoch;
    return c.rooms;
  }

  function fieldFor(c: Cache, origin: number): DistanceField {
    const version = c.lot && typeof c.lot.version === 'number' ? c.lot.version : 0;
    const hit = fields.get(origin);
    if (hit) return hit;
    dijkstraRuns++;
    const f = dijkstra(c.grid, origin, version, heap, scratch);
    fields.set(origin, f);
    return f;
  }

  function envTables(c: Cache): { tables: EnvTables; outdoor: Map<number, number> } {
    const s = c.state as WorldState;
    if (c.env && Object.is(c.env.tick, s.tick) && c.env.epoch === c.epoch) return c.env;
    const rd = roomsOf(c);
    const sizes = rd.rooms.map((r) => r.tiles.length);
    c.env = { tick: s.tick, epoch: c.epoch, tables: computeEnvTables(s, content, c.grid, rd.roomOf, sizes), outdoor: new Map() };
    return c.env;
  }

  const fin = Number.isFinite;

  const api: SpatialService = {
    width() {
      try {
        return sync().grid.w;
      } catch (e) {
        fault('width', e);
        return 0;
      }
    },
    depth() {
      try {
        return sync().grid.d;
      } catch (e) {
        fault('depth', e);
        return 0;
      }
    },
    inBounds(x, z) {
      try {
        if (!fin(x) || !fin(z)) return false;
        return inGrid(sync().grid, Math.floor(x), Math.floor(z));
      } catch (e) {
        fault('inBounds', e);
        return false;
      }
    },
    isBuildable(x, z) {
      try {
        if (!fin(x) || !fin(z)) return false;
        return gridBuildable(sync().grid, Math.floor(x), Math.floor(z));
      } catch (e) {
        fault('isBuildable', e);
        return false;
      }
    },
    tileIndex(x, z) {
      try {
        if (!fin(x) || !fin(z)) return -1;
        const g = sync().grid;
        const tx = Math.floor(x);
        const tz = Math.floor(z);
        return inGrid(g, tx, tz) ? tz * g.w + tx : -1;
      } catch (e) {
        fault('tileIndex', e);
        return -1;
      }
    },
    tileOf(p) {
      if (!p || typeof p !== 'object') return { x: NaN, z: NaN };
      return { x: Math.floor(p.x), z: Math.floor(p.z) };
    },
    isWalkable(x, z) {
      try {
        if (!fin(x) || !fin(z)) return false;
        return gridWalkable(sync().grid, Math.floor(x), Math.floor(z));
      } catch (e) {
        fault('isWalkable', e);
        return false;
      }
    },
    canStep(fx, fz, tx, tz) {
      try {
        if (!fin(fx) || !fin(fz) || !fin(tx) || !fin(tz)) return false;
        return gridCanStep(sync().grid, Math.floor(fx), Math.floor(fz), Math.floor(tx), Math.floor(tz));
      } catch (e) {
        fault('canStep', e);
        return false;
      }
    },
    roomAt(x, z) {
      try {
        if (!fin(x) || !fin(z)) return 0;
        const c = sync();
        const tx = Math.floor(x);
        const tz = Math.floor(z);
        if (!inGrid(c.grid, tx, tz)) return 0;
        return roomsOf(c).roomOf[tz * c.grid.w + tx];
      } catch (e) {
        fault('roomAt', e);
        return 0;
      }
    },
    rooms(): RoomInfo[] {
      try {
        return roomsOf(sync()).rooms.map((r) => ({ id: r.id, indoor: r.indoor, tiles: r.tiles.slice() }));
      } catch (e) {
        fault('rooms', e);
        return [];
      }
    },
    isIndoor(x, z) {
      return api.roomAt(x, z) > 0;
    },
    distanceField(from) {
      try {
        const c = sync();
        const g = c.grid;
        const version = c.lot && typeof c.lot.version === 'number' ? c.lot.version : 0;
        if (!from || !fin(from.x) || !fin(from.z)) return emptyField(g.n, version);
        const tx = Math.floor(from.x);
        const tz = Math.floor(from.z);
        if (!inGrid(g, tx, tz)) return emptyField(g.n, version);
        return fieldFor(c, tz * g.w + tx);
      } catch (e) {
        fault('distanceField', e);
        return emptyField(0, 0);
      }
    },
    findPath(from, to) {
      try {
        if (!from || !to || !fin(from.x) || !fin(from.z) || !fin(to.x) || !fin(to.z)) return null;
        const c = sync();
        const g = c.grid;
        const fx = Math.floor(from.x);
        const fz = Math.floor(from.z);
        const tx = Math.floor(to.x);
        const tz = Math.floor(to.z);
        if (!inGrid(g, fx, fz) || !inGrid(g, tx, tz)) return null;
        const ti = tz * g.w + tx;
        if (g.blocked[ti]) return null;
        if (fx === tx && fz === tz) return [{ x: tx + 0.5, z: tz + 0.5 }];
        const origin = fz * g.w + fx;
        const cached = fields.get(origin);
        const chain = cached ? reconstruct(cached, ti) : chainTo(g, origin, ti, heap, scratch, parentScratch);
        if (!chain) return null;
        return smoothPath(g, { x: from.x, z: from.z }, chain);
      } catch (e) {
        fault('findPath', e);
        return null;
      }
    },
    nearestWalkable(p, maxRadius) {
      try {
        const c = sync();
        if (c.grid.n === 0) return null;
        return nearestWalkableTile(c.grid, p, maxRadius, roomsOf(c).roomOf);
      } catch (e) {
        fault('nearestWalkable', e);
        return null;
      }
    },
    objectTiles(obj) {
      try {
        return objectTilesImpl(sync().grid, content, obj);
      } catch (e) {
        fault('objectTiles', e);
        return [];
      }
    },
    objectsAt(x, z): ObjectId[] {
      try {
        if (!fin(x) || !fin(z)) return [];
        const g = sync().grid;
        const tx = Math.floor(x);
        const tz = Math.floor(z);
        if (!inGrid(g, tx, tz)) return [];
        const list = g.objAt[tz * g.w + tx];
        return list ? list.slice() : [];
      } catch (e) {
        fault('objectsAt', e);
        return [];
      }
    },
    resolveSlots(obj): ResolvedSlot[] {
      try {
        return resolveSlotsImpl(sync().grid, content, obj);
      } catch (e) {
        fault('resolveSlots', e);
        return [];
      }
    },
    surfacePoints(obj) {
      try {
        return surfacePointsImpl(content, obj);
      } catch (e) {
        fault('surfacePoints', e);
        return [];
      }
    },
    freeSurfaceNear(p, maxDist, preferObjectId) {
      try {
        const c = sync();
        if (!c.state) return null;
        return freeSurfaceNearImpl(c.state, content, p, maxDist, preferObjectId);
      } catch (e) {
        fault('freeSurfaceNear', e);
        return null;
      }
    },
    objectCenter(obj: ObjectState): Vec2 {
      try {
        const c = sync();
        return objectCenterImpl(c.state || getState(), content, obj);
      } catch (e) {
        fault('objectCenter', e);
        return { x: 0, z: 0 };
      }
    },
    roomEnvironment(x, z) {
      try {
        if (!fin(x) || !fin(z)) return 0;
        const c = sync();
        const g = c.grid;
        const tx = Math.floor(x);
        const tz = Math.floor(z);
        if (!inGrid(g, tx, tz) || !c.state) return 0;
        const rd = roomsOf(c);
        const i = tz * g.w + tx;
        const room = rd.roomOf[i];
        const env = envTables(c);
        if (room > 0) return env.tables.roomScore[room] || 0;
        const hit = env.outdoor.get(i);
        if (hit !== undefined) return hit;
        const v = outdoorScore(g, rd.roomOf, env.tables, tx, tz);
        env.outdoor.set(i, v);
        return v;
      } catch (e) {
        fault('roomEnvironment', e);
        return 0;
      }
    },
    checkPlace(defId: string, x: number, z: number, rot: Rot, ignoreObjectId?: ObjectId | null): PlacementResult {
      try {
        const c = sync();
        if (!c.state) return { ok: false, reason: 'Outside your lot', tiles: [], blockedSlots: [], cost: 0 };
        const base = checkPlaceImpl(c.grid, content, c.state, roomsOf(c).roomOf, defId, x, z, rot, ignoreObjectId);
        return applyHomeBuildRules(c.state, base, defId, { x, z }, ignoreObjectId);
      } catch (e) {
        fault('checkPlace', e);
        return { ok: false, reason: "Can't place that here", tiles: [], blockedSlots: [], cost: 0 };
      }
    },
    checkWallItem(defId, edge, side, ignoreObjectId) {
      try {
        const c = sync();
        if (!c.state) return { ok: false, reason: 'Outside your lot', tiles: [], blockedSlots: [], cost: 0 };
        const base = checkWallItemImpl(c.grid, content, c.state, roomsOf(c).roomOf, defId, edge, side, ignoreObjectId);
        return applyHomeBuildRules(c.state, base, defId, { edge }, ignoreObjectId);
      } catch (e) {
        fault('checkWallItem', e);
        return { ok: false, reason: "Can't place that here", tiles: [], blockedSlots: [], cost: 0 };
      }
    },
    snapPoints(defId) {
      try {
        const c = sync();
        if (!c.state || !c.state.homeBuild) return [];
        const st = c.state;
        // only while the first-20 snap mode is on: after that Free Placement needs no markers
        const hb = st.homeBuild!;
        // (service furniture stays on points for good, so its markers stay)
        if ((hb.freePlacement || hb.placedEver >= FREE_PLACEMENT_AT) && !serviceOf(defId)) return [];
        return snapSpots(
          st,
          defId,
          (x, z) => applyHomeBuildRules(st, checkPlaceImpl(c.grid, content, st, roomsOf(c).roomOf, defId, x, z, 0, null), defId, { x, z }, null),
          (edge, side) => applyHomeBuildRules(st, checkWallItemImpl(c.grid, content, st, roomsOf(c).roomOf, defId, edge, side, null), defId, { edge }, null),
        );
      } catch (e) {
        fault('snapPoints', e);
        return [];
      }
    },
    checkOpening(defId, edge, ignoreObjectId) {
      try {
        const c = sync();
        if (!c.state) return { ok: false, reason: 'Outside your lot', tiles: [], blockedSlots: [], cost: 0 };
        return checkOpeningImpl(c.grid, content, c.state, defId, edge, ignoreObjectId);
      } catch (e) {
        fault('checkOpening', e);
        return { ok: false, reason: "Can't place that here", tiles: [], blockedSlots: [], cost: 0 };
      }
    },
    invalidate() {
      invalidations++;
    },
    debugFaults() {
      return faults.slice();
    },
    debugStats() {
      return { epoch: cache.epoch, rebuilds, fieldsCached: fields.size, dijkstraRuns };
    },
  };
  return api;
}
