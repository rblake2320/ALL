/**
 * BUILD PLANNER (SIM-SPATIAL) — validates a BuildCommand against the current state WITHOUT mutating anything and
 * returns a Plan: { ok, reason, cost, edges, tiles, noop, run }. preview() returns the plan's summary; apply() charges
 * `cost` then executes `run` inside a Tx. Both use this same code path, so preview mirrors apply exactly.
 *
 * Money (integer dollars): `cost` > 0 is a charge, `cost` < 0 a refund (sell / delete walls).
 *  - buy*: def price. sell: floor(value x (1 - depreciation)) (content depreciation, default 0.15).
 *  - addWalls: WALL_SEGMENT_PRICE per NEW segment (existing ones skipped); new segments get automatic paint (sides
 *    facing a room after the change: DEFAULT_INTERIOR_WALL, other sides: DEFAULT_EXTERIOR_WALL) at no extra cost; an
 *    explicit `style` paints both sides of new segments for style price x 2 per segment.
 *  - removeWalls: refund WALL_SEGMENT_REFUND per segment + resale of every opening / wall item on those segments (they
 *    are removed with the wall).
 *  - room: perimeter walls (skip existing) + floor fill (default 'floor_planks_worn'; null = leave floors) at floor
 *    price per changed tile + optional `wallStyle` painted on every perimeter side facing the inside, style price per
 *    changed side. floor: floor price per changed tile (null = bare ground, free, no refund).
 *  - paintWall / paintRoom: style price per changed wall side.
 * Limits: 400 edges / wall sides and 900 tiles per command ("Too big — build it in smaller pieces").
 * Rectangles may be given corner-first in any order; coordinates are floored. Non-changes are `noop` (ok, cost 0).
 * Placement commands (buy / move / buyWallItem / moveWallItem) carry the placement check's non-fatal `blockedSlots`.
 * Users & items (see carry.ts): move / sell first interrupt the object's users and the users of items resting on it,
 * THEN gather those items (an engine end() hook may have just put a plate down there) — moved items ride along, sold
 * surfaces drop theirs via ctx.placeItemNear. Removal reasons are player-facing sentences ("the sofa was sold").
 * Corrupt walls: several raw keys naming the same edge are all removed by removeWalls, and every opening object on a
 * removed edge goes with it (never an orphaned door that a later wall would resurrect).
 */
import type { BuildCommand, ContentRegistry, SpatialAPI } from '../../contracts';
import type { EdgeKey, LotState, ObjectId, ObjectPlacement, ObjectState, WallSegment, WorldState } from '../../types';
import {
  DEFAULT_EXTERIOR_WALL,
  DEFAULT_INTERIOR_WALL,
  FLOOR_STYLE_BY_ID,
  WALL_SEGMENT_PRICE,
  WALL_SEGMENT_REFUND,
  WALL_STYLE_BY_ID,
  type FloorStyle,
  type WallStyle,
} from '../../../shared/styles';
import { edgeSides, normalizeEdge, parseEdge, rectEdges } from '../edges';
import { specOf, priceOf, resaleValue, sellableOf } from '../defs';
import { floorFrame, lotDims } from '../grid';
import { frameTiles, normalizeRot } from '../geometry';
import { computeRooms } from '../rooms';
import { REASONS } from '../placement';
import type { Tx } from './tx';
import type { BuildContext } from './context';
import { carriedPlacement, childrenOf, objectLabel, releaseUsers, releaseWithChildren, surfaceFrame } from './carry';
import { buildHomeObjects } from './region';

export { carriedPlacement, childrenOf } from './carry';

export const MAX_EDGES_PER_OP = 400;
export const MAX_TILES_PER_OP = 900;
export const DEFAULT_ROOM_FLOOR = 'floor_planks_worn';

export const BUILD_REASONS = {
  notEnoughMoney: 'Not enough money',
  gone: "That's no longer here",
  notForSale: 'Not for sale',
  cantSell: "Can't sell that",
  cantMove: "Can't move that",
  tooBig: 'Too big — build it in smaller pieces',
  tooSmall: 'Too small for a room',
  unknownStyle: 'Unknown style',
  badCommand: "Can't do that",
  busy: 'Still building — try again',
  failed: "Couldn't build that",
} as const;

export interface Plan {
  ok: boolean;
  reason?: string;
  cost: number;
  label: string;
  edges?: EdgeKey[];
  tiles?: { x: number; z: number }[];
  /** Non-fatal placement warning (buy / move / wall items): slot indices with every approach tile blocked. */
  blockedSlots?: number[];
  noop?: boolean;
  run?: (tx: Tx) => ObjectId | undefined;
}

function fail(reason: string, cost = 0, extra: Partial<Plan> = {}): Plan {
  return { ok: false, reason, cost, label: 'build', ...extra };
}

function noop(label: string, extra: Partial<Plan> = {}): Plan {
  return { ok: true, cost: 0, label, noop: true, ...extra };
}

/** Own-property style lookups: ids like "__proto__" / "constructor" must never resolve to Object.prototype members. */
function wallStyleOf(id: unknown): WallStyle | null {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(WALL_STYLE_BY_ID, id) ? WALL_STYLE_BY_ID[id] : null;
}

function floorStyleOf(id: unknown): FloorStyle | null {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(FLOOR_STYLE_BY_ID, id) ? FLOOR_STYLE_BY_ID[id] : null;
}

function sanitizeTint(t: unknown): string | null {
  return typeof t === 'string' && /^#[0-9a-fA-F]{6}$/.test(t) ? t : null;
}

function fin(...v: unknown[]): boolean {
  return v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

// ───────────────────────────── state helpers ─────────────────────────────

export interface WallEntry {
  /** The record used for edits: the canonical key when present, else the first raw key naming the edge. */
  raw: string;
  seg: WallSegment;
  /** Every raw key naming this edge (more than one only in corrupt / hand-edited saves). */
  raws: string[];
}

/** canonical edge -> wall entry for every valid wall record. */
export function indexWalls(lot: LotState): Map<EdgeKey, WallEntry> {
  const m = new Map<EdgeKey, WallEntry>();
  const walls = lot.walls && typeof lot.walls === 'object' ? lot.walls : {};
  for (const raw in walls) {
    const seg = walls[raw];
    if (!seg || typeof seg !== 'object') continue;
    const e = normalizeEdge(raw);
    if (!e) continue;
    const cur = m.get(e);
    if (!cur) m.set(e, { raw, seg, raws: [raw] });
    else {
      cur.raws.push(raw);
      if (raw === e) {
        cur.raw = raw;
        cur.seg = seg;
      }
    }
  }
  return m;
}

/** Floor style of tile i (null for bare ground / a corrupt floors array). */
function floorAt(lot: LotState, i: number): string | null {
  const f = Array.isArray(lot.floors) ? lot.floors[i] : null;
  return typeof f === 'string' ? f : null;
}

function objectsOf(state: WorldState): Record<string, ObjectState> {
  return buildHomeObjects(state);
}

/** Own-property object lookup ("__proto__" / "constructor" are never objects). */
function objectById(state: WorldState, id: unknown): ObjectState | undefined {
  const objs = objectsOf(state);
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(objs, id)) return undefined;
  const o = objs[id];
  return o && typeof o === 'object' ? o : undefined;
}

/** Every opening object placed on a canonical edge (state order; normally zero or one). */
export function openingsOnEdge(state: WorldState, edge: EdgeKey): ObjectId[] {
  const out: ObjectId[] = [];
  const objs = objectsOf(state);
  for (const id in objs) {
    const p = objs[id] && objs[id].placement;
    if (p && p.kind === 'opening' && normalizeEdge(p.edge) === edge) out.push(id);
  }
  return out;
}

function wallItemsOnEdge(state: WorldState, edge: EdgeKey): ObjectId[] {
  const out: ObjectId[] = [];
  const objs = objectsOf(state);
  for (const id in objs) {
    const p = objs[id] && objs[id].placement;
    if (p && p.kind === 'wall' && normalizeEdge(p.edge) === edge) out.push(id);
  }
  return out;
}

function edgeBuildableVia(S: SpatialAPI, lot: LotState, e: EdgeKey): boolean {
  const [a, b] = edgeSides(e);
  if (!S.inBounds(a.x, a.z) || !S.inBounds(b.x, b.z)) return false;
  if (a.z === lot.sidewalkZ || b.z === lot.sidewalkZ) return false;
  return S.isBuildable(a.x, a.z) || S.isBuildable(b.x, b.z);
}

/** tile index -> floor objects (rugs included) covering it. */
function floorCoverage(state: WorldState, content: ContentRegistry, w: number, d: number): Map<number, Set<ObjectId>> {
  const m = new Map<number, Set<ObjectId>>();
  const objs = objectsOf(state);
  for (const id in objs) {
    const o = objs[id];
    if (!o || !o.placement || o.placement.kind !== 'floor') continue;
    const spec = specOf(content, o.defId);
    const f = spec ? floorFrame(o, spec) : null;
    if (!f) continue;
    for (const t of frameTiles(f)) {
      if (t.x < 0 || t.z < 0 || t.x >= w || t.z >= d) continue;
      const i = t.z * w + t.x;
      let s = m.get(i);
      if (!s) m.set(i, (s = new Set()));
      s.add(id);
    }
  }
  return m;
}

/** Would a wall on this edge cut through a single object's footprint? */
function edgeCutsObject(cov: Map<number, Set<ObjectId>>, w: number, d: number, e: EdgeKey): boolean {
  const [a, b] = edgeSides(e);
  if (a.x < 0 || a.z < 0 || b.x < 0 || b.z < 0 || a.x >= w || b.x >= w || a.z >= d || b.z >= d) return false;
  const sa = cov.get(a.z * w + a.x);
  const sb = cov.get(b.z * w + b.x);
  if (!sa || !sb) return false;
  for (const id of sa) if (sb.has(id)) return true;
  return false;
}

/** Room id per tile after adding/removing the given edges (any wall segment separates rooms). */
function roomsWith(lot: LotState, w: number, d: number, add: Iterable<EdgeKey>): Int32Array {
  const H = new Uint8Array(w * (d + 1));
  const V = new Uint8Array((w + 1) * d);
  const set = (key: string) => {
    const e = parseEdge(key);
    if (!e) return;
    if (e.kind === 'h' && e.x >= 0 && e.x < w && e.z >= 0 && e.z <= d) H[e.z * w + e.x] = 1;
    if (e.kind === 'v' && e.x >= 0 && e.x <= w && e.z >= 0 && e.z < d) V[e.z * (w + 1) + e.x] = 1;
  };
  for (const raw in lot.walls || {}) if (lot.walls[raw] && typeof lot.walls[raw] === 'object') set(raw);
  for (const e of add) set(e);
  return computeRooms(w, d, (x, z) => H[z * w + x] === 1, (x, z) => V[z * (w + 1) + x] === 1).roomOf;
}

function autoPaint(roomOf: Int32Array, w: number, d: number, e: EdgeKey): [string, string] {
  const sides = edgeSides(e);
  const pick = (t: { x: number; z: number }) =>
    t.x >= 0 && t.z >= 0 && t.x < w && t.z < d && roomOf[t.z * w + t.x] > 0 ? DEFAULT_INTERIOR_WALL : DEFAULT_EXTERIOR_WALL;
  return [pick(sides[0]), pick(sides[1])];
}

function normRect(x0: number, z0: number, x1: number, z1: number): { x0: number; z0: number; x1: number; z1: number } {
  let ax = Math.floor(x0);
  let bx = Math.floor(x1);
  let az = Math.floor(z0);
  let bz = Math.floor(z1);
  if (ax > bx) [ax, bx] = [bx, ax];
  if (az > bz) [az, bz] = [bz, az];
  return { x0: ax, z0: az, x1: bx, z1: bz };
}

function rectTiles(r: { x0: number; z0: number; x1: number; z1: number }): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) out.push({ x, z });
  return out;
}

/** Normalised, de-duplicated edge list or a failure reason. */
function normEdges(raw: unknown): EdgeKey[] | string {
  if (!Array.isArray(raw)) return BUILD_REASONS.badCommand;
  if (raw.length > MAX_EDGES_PER_OP * 4) return BUILD_REASONS.tooBig;
  const seen = new Set<EdgeKey>();
  const out: EdgeKey[] = [];
  for (const k of raw) {
    const e = normalizeEdge(k);
    if (!e) return REASONS.outside;
    if (!seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  if (out.length > MAX_EDGES_PER_OP) return BUILD_REASONS.tooBig;
  return out;
}

// ───────────────────────────── the planner ─────────────────────────────

export function planCommand(ctx: BuildContext, cmd: BuildCommand): Plan {
  if (!cmd || typeof cmd !== 'object') return fail(BUILD_REASONS.badCommand);
  const state = ctx.state;
  const content = ctx.content;
  const S = ctx.spatial;
  const lot = state.lot;
  if (!lot || typeof lot !== 'object') return fail(REASONS.outside);
  const { w, d } = lotDims(state);

  switch (cmd.type) {
    case 'buy': {
      const spec = specOf(content, cmd.defId);
      if (!spec) return fail(REASONS.unknown);
      const price = priceOf(spec);
      if (spec.buyable === false || spec.placement === 'item') return fail(BUILD_REASONS.notForSale, price);
      if (spec.placement !== 'floor') return fail(REASONS.needsWall, price);
      const rot = normalizeRot(cmd.rot);
      if (rot === null) return fail(REASONS.cantPlace, price);
      if (!fin(cmd.x, cmd.z)) return fail(REASONS.outside, price);
      const pr = S.checkPlace(cmd.defId, cmd.x, cmd.z, rot, null);
      if (!pr.ok) return fail(pr.reason || REASONS.cantPlace, price, { tiles: pr.tiles });
      const x = Math.floor(cmd.x);
      const z = Math.floor(cmd.z);
      const tint = sanitizeTint(cmd.tint);
      const defId = cmd.defId;
      return {
        ok: true,
        cost: price,
        label: `Bought ${spec.name}`,
        tiles: pr.tiles,
        blockedSlots: pr.blockedSlots.slice(),
        run: (tx) => tx.spawn(defId, { kind: 'floor', x, z, rot }, { value: price, tint }).id,
      };
    }

    case 'buyWallItem': {
      const spec = specOf(content, cmd.defId);
      if (!spec) return fail(REASONS.unknown);
      const price = priceOf(spec);
      if (spec.buyable === false || spec.placement === 'item') return fail(BUILD_REASONS.notForSale, price);
      const edge = normalizeEdge(cmd.edge);
      const side = cmd.side;
      if (!edge || (side !== 0 && side !== 1)) return fail(REASONS.needsWall, price);
      const pr = S.checkWallItem(cmd.defId, edge, side, null);
      if (!pr.ok) return fail(pr.reason || REASONS.needsWall, price, { tiles: pr.tiles, edges: [edge] });
      const tint = sanitizeTint(cmd.tint);
      const defId = cmd.defId;
      return {
        ok: true,
        cost: price,
        label: `Bought ${spec.name}`,
        edges: [edge],
        tiles: pr.tiles,
        blockedSlots: pr.blockedSlots.slice(),
        run: (tx) => tx.spawn(defId, { kind: 'wall', edge, side }, { value: price, tint }).id,
      };
    }

    case 'buyOpening': {
      const spec = specOf(content, cmd.defId);
      if (!spec) return fail(REASONS.unknown);
      const price = priceOf(spec);
      if (spec.buyable === false || spec.placement === 'item') return fail(BUILD_REASONS.notForSale, price);
      const edge = normalizeEdge(cmd.edge);
      if (!edge) return fail(REASONS.needsWall, price);
      const pr = S.checkOpening(cmd.defId, edge, null);
      if (!pr.ok) return fail(pr.reason || REASONS.needsWall, price, { tiles: pr.tiles, edges: [edge] });
      const entry = indexWalls(lot).get(edge);
      if (!entry) return fail(REASONS.needsWall, price, { edges: [edge] });
      const tint = sanitizeTint(cmd.tint);
      const defId = cmd.defId;
      const raw = entry.raw;
      return {
        ok: true,
        cost: price,
        label: `Bought ${spec.name}`,
        edges: [edge],
        tiles: pr.tiles,
        run: (tx) => {
          tx.touchWall(raw);
          const obj = tx.spawn(defId, { kind: 'opening', edge }, { value: price, tint });
          const seg = ctx.state.lot.walls[raw];
          if (!seg) throw new Error('wall vanished');
          tx.setWall(raw, { paint: seg.paint, openingId: obj.id });
          return obj.id;
        },
      };
    }

    case 'move': {
      const obj = objectById(state, cmd.objectId);
      if (!obj) return fail(BUILD_REASONS.gone);
      const spec = specOf(content, obj.defId);
      if (!spec || !obj.placement || obj.placement.kind !== 'floor') return fail(BUILD_REASONS.cantMove);
      const rot = normalizeRot(cmd.rot);
      if (rot === null) return fail(REASONS.cantPlace);
      if (!fin(cmd.x, cmd.z)) return fail(REASONS.outside);
      const x = Math.floor(cmd.x);
      const z = Math.floor(cmd.z);
      const p = obj.placement;
      if (p.x === x && p.z === z && normalizeRot(p.rot) === rot) return noop('Move');
      const pr = S.checkPlace(obj.defId, x, z, rot, obj.id);
      if (!pr.ok) return fail(pr.reason || REASONS.cantPlace, 0, { tiles: pr.tiles });
      const id = obj.id;
      return {
        ok: true,
        cost: 0,
        label: `Moved ${spec.name}`,
        tiles: pr.tiles,
        blockedSlots: pr.blockedSlots.slice(),
        run: (tx) => moveWithChildren(ctx, tx, id, { kind: 'floor', x, z, rot }),
      };
    }

    case 'moveWallItem': {
      const obj = objectById(state, cmd.objectId);
      if (!obj) return fail(BUILD_REASONS.gone);
      const spec = specOf(content, obj.defId);
      if (!spec || !obj.placement || obj.placement.kind !== 'wall') return fail(BUILD_REASONS.cantMove);
      const edge = normalizeEdge(cmd.edge);
      const side = cmd.side;
      if (!edge || (side !== 0 && side !== 1)) return fail(REASONS.needsWall);
      if (normalizeEdge(obj.placement.edge) === edge && obj.placement.side === side) return noop('Move');
      const pr = S.checkWallItem(obj.defId, edge, side, obj.id);
      if (!pr.ok) return fail(pr.reason || REASONS.needsWall, 0, { tiles: pr.tiles, edges: [edge] });
      const id = obj.id;
      return {
        ok: true,
        cost: 0,
        label: `Moved ${spec.name}`,
        edges: [edge],
        tiles: pr.tiles,
        blockedSlots: pr.blockedSlots.slice(),
        run: (tx) => moveWithChildren(ctx, tx, id, { kind: 'wall', edge, side }),
      };
    }

    case 'moveOpening': {
      const obj = objectById(state, cmd.objectId);
      if (!obj) return fail(BUILD_REASONS.gone);
      const spec = specOf(content, obj.defId);
      if (!spec || !obj.placement || obj.placement.kind !== 'opening') return fail(BUILD_REASONS.cantMove);
      const edge = normalizeEdge(cmd.edge);
      if (!edge) return fail(REASONS.needsWall);
      const oldEdge = normalizeEdge(obj.placement.edge);
      if (oldEdge === edge) return noop('Move');
      const pr = S.checkOpening(obj.defId, edge, obj.id);
      if (!pr.ok) return fail(pr.reason || REASONS.needsWall, 0, { tiles: pr.tiles, edges: [edge] });
      const walls = indexWalls(lot);
      const target = walls.get(edge);
      if (!target) return fail(REASONS.needsWall, 0, { edges: [edge] });
      const old = oldEdge ? walls.get(oldEdge) : undefined;
      const id = obj.id;
      return {
        ok: true,
        cost: 0,
        label: `Moved ${spec.name}`,
        edges: oldEdge ? [oldEdge, edge] : [edge],
        tiles: pr.tiles,
        run: (tx) => {
          const cur = objectsOf(ctx.state)[id];
          if (!cur) throw new Error('object vanished');
          tx.touchObj(id, 0);
          releaseUsers(ctx, cur, MOVED_WHY);
          if (old) {
            const seg = ctx.state.lot.walls[old.raw];
            if (seg && seg.openingId === id) tx.setWall(old.raw, { paint: seg.paint, openingId: null });
          }
          const seg = ctx.state.lot.walls[target.raw];
          if (!seg) throw new Error('wall vanished');
          tx.setWall(target.raw, { paint: seg.paint, openingId: id });
          tx.setPlacement(id, { kind: 'opening', edge }, 0);
          return id;
        },
      };
    }

    case 'sell': {
      const obj = objectById(state, cmd.objectId);
      if (!obj) return fail(BUILD_REASONS.gone);
      const k = obj.placement && obj.placement.kind;
      if (k !== 'floor' && k !== 'wall' && k !== 'opening') return fail(BUILD_REASONS.cantSell);
      const spec = specOf(content, obj.defId);
      if (!sellableOf(spec)) return fail(BUILD_REASONS.cantSell);
      const refund = resaleValue(obj.value, spec);
      const id = obj.id;
      const tiles = S.objectTiles(obj);
      const edges = obj.placement.kind === 'wall' || obj.placement.kind === 'opening' ? [normalizeEdge(obj.placement.edge)].filter((e): e is string => !!e) : undefined;
      return {
        ok: true,
        cost: refund > 0 ? -refund : 0,
        label: `Sold ${spec ? spec.name : obj.defId}`,
        tiles,
        edges,
        run: (tx) => {
          sellObject(ctx, tx, id);
          return id;
        },
      };
    }

    case 'addWalls': {
      const edges = normEdges(cmd.edges);
      if (typeof edges === 'string') return fail(edges);
      for (const e of edges) if (!edgeBuildableVia(S, lot, e)) return fail(REASONS.outside, 0, { edges });
      const styleDef = cmd.style === undefined || cmd.style === null ? null : wallStyleOf(cmd.style);
      if (styleDef === null && cmd.style !== undefined && cmd.style !== null) return fail(BUILD_REASONS.unknownStyle, 0, { edges });
      const style = styleDef ? styleDef.id : null;
      const walls = indexWalls(lot);
      const fresh = edges.filter((e) => !walls.has(e));
      if (fresh.length === 0) return noop('Walls', { edges });
      const cov = floorCoverage(state, content, w, d);
      for (const e of fresh) if (edgeCutsObject(cov, w, d, e)) return fail(REASONS.inTheWay, 0, { edges });
      const roomOf = roomsWith(lot, w, d, fresh);
      const segs = fresh.map((e) => ({ e, paint: style ? ([style, style] as [string, string]) : autoPaint(roomOf, w, d, e) }));
      const cost = WALL_SEGMENT_PRICE * fresh.length + (styleDef ? styleDef.price * 2 * fresh.length : 0);
      return {
        ok: true,
        cost,
        label: fresh.length === 1 ? 'Built a wall' : `Built ${fresh.length} walls`,
        edges,
        run: (tx) => {
          for (const s of segs) tx.setWall(s.e, { paint: s.paint, openingId: null });
          return undefined;
        },
      };
    }

    case 'removeWalls': {
      const edges = normEdges(cmd.edges);
      if (typeof edges === 'string') return fail(edges);
      for (const e of edges) if (!edgeBuildableVia(S, lot, e)) return fail(REASONS.outside, 0, { edges });
      const walls = indexWalls(lot);
      const doomed = edges.filter((e) => walls.has(e));
      if (doomed.length === 0) return noop('Walls', { edges });
      const removeIds: ObjectId[] = [];
      const seen = new Set<ObjectId>();
      let refund = WALL_SEGMENT_REFUND * doomed.length;
      const objs = objectsOf(state);
      for (const e of doomed) {
        for (const id of [...wallItemsOnEdge(state, e), ...openingsOnEdge(state, e)]) {
          if (seen.has(id)) continue;
          seen.add(id);
          removeIds.push(id);
          refund += resaleValue(objs[id].value, specOf(content, objs[id].defId));
        }
      }
      const raws: string[] = [];
      for (const e of doomed) for (const raw of walls.get(e)!.raws) raws.push(raw);
      return {
        ok: true,
        cost: refund > 0 ? -refund : 0,
        label: doomed.length === 1 ? 'Removed a wall' : `Removed ${doomed.length} walls`,
        edges,
        run: (tx) => {
          // Touch walls first so their `before` keeps the opening links even if removeObject edits them.
          for (const raw of raws) tx.touchWall(raw);
          for (const id of removeIds) {
            const o = objectsOf(ctx.state)[id];
            if (o) tx.remove(id, 0, `The ${objectLabel(content, o)} came down with the wall`);
          }
          for (const raw of raws) tx.setWall(raw, null);
          return undefined;
        },
      };
    }

    case 'room': {
      if (!fin(cmd.x0, cmd.z0, cmd.x1, cmd.z1)) return fail(REASONS.outside);
      const r = normRect(cmd.x0, cmd.z0, cmd.x1, cmd.z1);
      const rw = r.x1 - r.x0;
      const rd = r.z1 - r.z0;
      if (rw < 1 || rd < 1) return fail(BUILD_REASONS.tooSmall);
      if (rw * rd > MAX_TILES_PER_OP || 2 * (rw + rd) > MAX_EDGES_PER_OP) return fail(BUILD_REASONS.tooBig);
      const tiles = rectTiles(r);
      const perimeter = rectEdges(r.x0, r.z0, r.x1, r.z1);
      for (const t of tiles) if (!S.isBuildable(t.x, t.z)) return fail(REASONS.outside, 0, { tiles, edges: perimeter });
      const floorDef = cmd.floor === null ? null : floorStyleOf(cmd.floor === undefined ? DEFAULT_ROOM_FLOOR : cmd.floor);
      if (floorDef === null && cmd.floor !== null) return fail(BUILD_REASONS.unknownStyle, 0, { tiles, edges: perimeter });
      const floorStyle = floorDef ? floorDef.id : null;
      const wallDef = cmd.wallStyle === undefined || cmd.wallStyle === null ? null : wallStyleOf(cmd.wallStyle);
      if (wallDef === null && cmd.wallStyle !== undefined && cmd.wallStyle !== null) return fail(BUILD_REASONS.unknownStyle, 0, { tiles, edges: perimeter });
      const wallStyle = wallDef ? wallDef.id : null;
      const walls = indexWalls(lot);
      const fresh = perimeter.filter((e) => !walls.has(e));
      for (const e of fresh) if (!edgeBuildableVia(S, lot, e)) return fail(REASONS.outside, 0, { tiles, edges: perimeter });
      const cov = floorCoverage(state, content, w, d);
      for (const e of fresh) if (edgeCutsObject(cov, w, d, e)) return fail(REASONS.inTheWay, 0, { tiles, edges: perimeter });
      const roomOf = roomsWith(lot, w, d, fresh);
      const insideSide = (e: EdgeKey): 0 | 1 => {
        const pe = parseEdge(e)!;
        if (pe.kind === 'h') return pe.z === r.z0 ? 1 : 0;
        return pe.x === r.x0 ? 1 : 0;
      };
      let cost = WALL_SEGMENT_PRICE * fresh.length;
      const newSegs: { e: EdgeKey; paint: [string, string] }[] = [];
      for (const e of fresh) {
        const paint = autoPaint(roomOf, w, d, e);
        if (wallStyle) {
          const s = insideSide(e);
          if (paint[s] !== wallStyle) {
            paint[s] = wallStyle;
            cost += wallDef!.price;
          }
        }
        newSegs.push({ e, paint });
      }
      const repaint: { raw: string; side: 0 | 1 }[] = [];
      if (wallStyle) {
        for (const e of perimeter) {
          const ent = walls.get(e);
          if (!ent) continue;
          const s = insideSide(e);
          const cur = Array.isArray(ent.seg.paint) ? ent.seg.paint[s] : null;
          if (cur !== wallStyle) {
            repaint.push({ raw: ent.raw, side: s });
            cost += wallDef!.price;
          }
        }
      }
      const floorChanges: number[] = [];
      if (floorStyle !== null) {
        for (const t of tiles) {
          const i = t.z * w + t.x;
          if (floorAt(lot, i) !== floorStyle) floorChanges.push(i);
        }
        cost += floorDef!.price * floorChanges.length;
      }
      if (newSegs.length === 0 && repaint.length === 0 && floorChanges.length === 0) return noop('Room', { tiles, edges: perimeter });
      return {
        ok: true,
        cost,
        label: 'Built a room',
        tiles,
        edges: perimeter,
        run: (tx) => {
          for (const s of newSegs) tx.setWall(s.e, { paint: s.paint, openingId: null });
          for (const p of repaint) tx.setPaint(p.raw, p.side, wallStyle as string);
          for (const i of floorChanges) tx.setFloor(i, floorStyle);
          return undefined;
        },
      };
    }

    case 'floor': {
      if (!fin(cmd.x0, cmd.z0, cmd.x1, cmd.z1)) return fail(REASONS.outside);
      const r = normRect(cmd.x0, cmd.z0, cmd.x1, cmd.z1);
      const rw = r.x1 - r.x0;
      const rd = r.z1 - r.z0;
      if (rw < 1 || rd < 1) return noop('Floor');
      if (rw * rd > MAX_TILES_PER_OP) return fail(BUILD_REASONS.tooBig);
      const tiles = rectTiles(r);
      for (const t of tiles) if (!S.isBuildable(t.x, t.z)) return fail(REASONS.outside, 0, { tiles });
      const styleDef = cmd.styleId === null || cmd.styleId === undefined ? null : floorStyleOf(cmd.styleId);
      if (styleDef === null && cmd.styleId !== null && cmd.styleId !== undefined) return fail(BUILD_REASONS.unknownStyle, 0, { tiles });
      const style = styleDef ? styleDef.id : null;
      const changes = tiles.map((t) => t.z * w + t.x).filter((i) => floorAt(lot, i) !== style);
      if (changes.length === 0) return noop('Floor', { tiles });
      const cost = styleDef ? styleDef.price * changes.length : 0;
      return {
        ok: true,
        cost,
        label: style ? 'Laid flooring' : 'Removed flooring',
        tiles,
        run: (tx) => {
          for (const i of changes) tx.setFloor(i, style);
          return undefined;
        },
      };
    }

    case 'paintWall': {
      const edge = normalizeEdge(cmd.edge);
      if (!edge) return fail(REASONS.needsWall);
      const side = cmd.side;
      if (side !== 0 && side !== 1) return fail(BUILD_REASONS.badCommand);
      const style = wallStyleOf(cmd.styleId);
      if (!style) return fail(BUILD_REASONS.unknownStyle, 0, { edges: [edge] });
      const ent = indexWalls(lot).get(edge);
      if (!ent) return fail(REASONS.needsWall, style.price, { edges: [edge] });
      const t = edgeSides(edge)[side];
      if (!S.inBounds(t.x, t.z)) return fail(REASONS.outside, style.price, { edges: [edge] });
      if (Array.isArray(ent.seg.paint) && ent.seg.paint[side] === style.id) return noop('Paint', { edges: [edge] });
      const raw = ent.raw;
      return {
        ok: true,
        cost: style.price,
        label: `Painted ${style.name}`,
        edges: [edge],
        run: (tx) => {
          tx.setPaint(raw, side, style.id);
          return undefined;
        },
      };
    }

    case 'paintRoom': {
      if (!fin(cmd.x, cmd.z)) return fail(REASONS.outside);
      const x = Math.floor(cmd.x);
      const z = Math.floor(cmd.z);
      if (!S.inBounds(x, z)) return fail(REASONS.outside);
      const style = wallStyleOf(cmd.styleId);
      if (!style) return fail(BUILD_REASONS.unknownStyle);
      const room = S.roomAt(x, z);
      const sides: { raw: string; side: 0 | 1; e: EdgeKey }[] = [];
      for (const [e, ent] of indexWalls(lot)) {
        const st = edgeSides(e);
        for (const s of [0, 1] as const) {
          const t = st[s];
          if (!S.inBounds(t.x, t.z) || S.roomAt(t.x, t.z) !== room) continue;
          const cur = Array.isArray(ent.seg.paint) ? ent.seg.paint[s] : null;
          if (cur !== style.id) sides.push({ raw: ent.raw, side: s, e });
        }
      }
      if (sides.length > MAX_EDGES_PER_OP) return fail(BUILD_REASONS.tooBig);
      const edges = Array.from(new Set(sides.map((s) => s.e)));
      if (sides.length === 0) return noop('Paint', { edges });
      return {
        ok: true,
        cost: style.price * sides.length,
        label: `Painted the room ${style.name}`,
        edges,
        run: (tx) => {
          for (const s of sides) tx.setPaint(s.raw, s.side, style.id);
          return undefined;
        },
      };
    }

    default:
      return fail(BUILD_REASONS.badCommand);
  }
}

const MOVED_WHY = 'Moved in build mode';

/**
 * Move an object (floor or wall item) and everything resting on it. Users of the object and of its items are
 * interrupted FIRST and the items gathered afterwards (carry.ts header: an end() hook may set a plate down on this very
 * surface). Each item is its own dependent group so a later divergence (plate eaten) never blocks undo of the move.
 */
function moveWithChildren(ctx: BuildContext, tx: Tx, id: ObjectId, target: ObjectPlacement): ObjectId {
  const cur = objectsOf(ctx.state)[id];
  if (!cur) throw new Error('object vanished');
  tx.touchObj(id, 0);
  releaseWithChildren(ctx, cur, MOVED_WHY);
  if (objectsOf(ctx.state)[id] !== cur) throw new Error('object vanished while its users were interrupted'); // atomic: roll back
  const oldFrame = surfaceFrame(ctx.content, cur);
  const newFrame = surfaceFrame(ctx.content, { defId: cur.defId, placement: target });
  for (const child of childrenOf(ctx.state, id)) {
    const g = tx.newGroup();
    tx.touchObj(child.id, g);
    const np = oldFrame && newFrame ? carriedPlacement(ctx.content, cur, oldFrame, newFrame, child) : null;
    if (np) tx.setPlacement(child.id, np, g);
  }
  tx.setPlacement(id, target, 0);
  return id;
}

/**
 * Sell: interrupt users (of the object and its items) first, then take every item off its surfaces (dependent
 * groups), unlink an opening from its wall, remove it, and drop each item via ctx.placeItemNear (fallback: the same
 * item on the floor where it was).
 */
function sellObject(ctx: BuildContext, tx: Tx, id: ObjectId): void {
  const obj = objectsOf(ctx.state)[id];
  if (!obj) throw new Error('object vanished');
  const why = `The ${objectLabel(ctx.content, obj)} was sold`;
  releaseWithChildren(ctx, obj, why);
  if (objectsOf(ctx.state)[id] !== obj) throw new Error('object vanished while its users were interrupted'); // atomic: roll back
  const kids = childrenOf(ctx.state, id).map((c) => ({ snap: JSON.parse(JSON.stringify(c)) as ObjectState, group: tx.newGroup() }));
  for (const k of kids) tx.remove(k.snap.id, k.group, why);
  if (obj.placement.kind === 'opening') {
    const e = normalizeEdge(obj.placement.edge);
    const ent = e ? indexWalls(ctx.state.lot).get(e) : undefined;
    if (ent) for (const raw of ent.raws) {
      const seg = ctx.state.lot.walls[raw];
      if (seg && seg.openingId === id) tx.setWall(raw, { paint: seg.paint, openingId: null });
    }
  }
  tx.remove(id, 0, why);
  for (const k of kids) {
    const p = k.snap.placement;
    if (p.kind !== 'loose') continue;
    const near = { x: p.x, z: p.z };
    const data = JSON.parse(JSON.stringify(k.snap.data || {})) as ObjectState['data'];
    const item = ctx.placeItemNear(k.snap.defId, near, { data });
    if (item) tx.adopt(item, k.group);
    else tx.insert({ ...k.snap, placement: { kind: 'loose', x: p.x, z: p.z, y: 0, parentId: null, surfaceIndex: null, facing: p.facing } }, k.group);
  }
}
