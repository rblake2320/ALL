/**
 * OCCUPANCY + WALL GRID (SIM-SPATIAL) — a derived, rebuildable snapshot of the lot used by every spatial query.
 *
 * Built from WorldState (never mutates it). Conventions:
 *  - Tile index = z * width + x (row-major, same as LotState.floors). Out-of-bounds tiles are never walkable.
 *  - Wall arrays: wallH[z * w + x] holds the code of edge 'h:x:z' (z in [0,d]); wallV[z * (w + 1) + x] holds 'v:x:z'
 *    (x in [0,w]). Codes: WALL_NONE 0, WALL_SOLID 1, WALL_DOOR 2 (passable), WALL_WINDOW 3 (blocks; also used for an
 *    opening whose def is unknown). A wall blocks movement unless its opening is an object whose def placement is 'door'.
 *  - Opening resolution per wall: WallSegment.openingId when it names an existing object placed as an opening on that
 *    same edge; otherwise the first object (state.objects order) whose placement is { kind:'opening', edge } — so a
 *    template spawned without linking openingId still gets working doors.
 *  - Blocked tiles: tiles covered by non-passable, non-rug FLOOR objects, plus the tile of every non-passable LOOSE
 *    item (item_fire). Unknown defIds are ignored.
 *  - stepMask[i] bit k = canStep from tile i in direction k (DIR_DX/DIR_DZ). Rules:
 *      destination in bounds and walkable (the SOURCE may be blocked: "step out" of furniture is allowed);
 *      orthogonal: the crossed edge has no blocking wall (doors pass, windows block);
 *      diagonal: both orthogonal intermediate tiles in bounds + walkable AND none of the 4 edges meeting at the shared
 *      corner has ANY wall segment (doors and windows included) — no corner cutting past wall ends or through doorways.
 *  - doorAdj: both side tiles of every door edge. wallAdj: both side tiles of every blocking wall edge (path penalty).
 */
import type { WorldState, ObjectState, ObjectId, EdgeKey, WallSegment } from '../types';
import type { ContentRegistry } from '../contracts';
import { parseEdge, normalizeEdge, edgeKey } from './edges';
import { specOf, footprintOf, floorBlocks, looseBlocks, isRug, isDoor, type SpecLike } from './defs';
import { normalizeRot, frameTiles, type Frame } from './geometry';
import { computeRooms } from './rooms';
import { objectFilterOf, regionViewOf } from './view';

export const WALL_NONE = 0;
export const WALL_SOLID = 1;
export const WALL_DOOR = 2;
export const WALL_WINDOW = 3;
/**
 * W-025 S3: a door closed by the PUBLIC step mask of a neighbour's lot (a door into an indoor room). Blocks movement
 * like a window; only region views with `privacy` ever produce it, never the home grid.
 */
export const WALL_PRIVATE = 4;

/** 8-neighbour directions: E, W, S(+Z), N(-Z), then diagonals. */
export const DIR_DX: readonly number[] = [1, -1, 0, 0, 1, -1, 1, -1];
export const DIR_DZ: readonly number[] = [0, 0, 1, -1, 1, 1, -1, -1];
export const SQRT2 = Math.SQRT2;
export const DIR_COST: readonly number[] = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
/** Lots larger than this are clamped (defensive against corrupt saves). */
const MAX_DIM = 256;

export interface Grid {
  w: number;
  d: number;
  n: number;
  buildable: { x0: number; z0: number; x1: number; z1: number };
  sidewalkZ: number;
  blocked: Uint8Array;
  /** Subset of `blocked` caused by loose items (fire). */
  looseBlocked: Uint8Array;
  /** Non-rug floor objects per tile (state.objects order). */
  objAt: (ObjectId[] | null)[];
  /** Rugs per tile. */
  rugAt: (ObjectId[] | null)[];
  /** Loose items resting on the floor (parentId null) per tile. */
  floorItemsAt: (ObjectId[] | null)[];
  wallH: Uint8Array;
  wallV: Uint8Array;
  /** Resolved opening object per canonical edge key (only for edges that have a wall). */
  openingOf: Map<EdgeKey, ObjectId>;
  /** Wall items per `${edge}|${side}`. */
  wallItems: Map<string, ObjectId[]>;
  doorAdj: Uint8Array;
  wallAdj: Uint8Array;
  stepMask: Uint8Array;
  /** W-025 S3: extra cost per entered tile (street road / curb tiles), or null (always null on the home grid). */
  extraCost?: Float32Array | null;
}

function intOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
}

export function lotDims(state: WorldState | null | undefined): { w: number; d: number } {
  const lot = state && state.lot;
  if (!lot) return { w: 0, d: 0 };
  const w = Math.max(0, Math.min(MAX_DIM, intOr(lot.width, 0)));
  const d = Math.max(0, Math.min(MAX_DIM, intOr(lot.depth, 0)));
  return { w, d };
}

export function inGrid(g: Grid, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < g.w && z < g.d;
}

/** Code of edge 'h:x:z' (0 when outside the arrays). */
export function hCode(g: Grid, x: number, z: number): number {
  if (x < 0 || x >= g.w || z < 0 || z > g.d) return WALL_NONE;
  return g.wallH[z * g.w + x];
}

/** Code of edge 'v:x:z'. */
export function vCode(g: Grid, x: number, z: number): number {
  if (x < 0 || x > g.w || z < 0 || z >= g.d) return WALL_NONE;
  return g.wallV[z * (g.w + 1) + x];
}

export function edgeCode(g: Grid, edge: EdgeKey): number {
  const e = parseEdge(edge);
  if (!e) return WALL_NONE;
  return e.kind === 'h' ? hCode(g, e.x, e.z) : vCode(g, e.x, e.z);
}

export function blocksMovement(code: number): boolean {
  return code === WALL_SOLID || code === WALL_WINDOW || code === WALL_PRIVATE;
}

/** Code of the edge crossed by an orthogonal step from (x,z) by (dx,dz). */
export function crossedCode(g: Grid, x: number, z: number, dx: number, dz: number): number {
  if (dx === 1) return vCode(g, x + 1, z);
  if (dx === -1) return vCode(g, x, z);
  if (dz === 1) return hCode(g, x, z + 1);
  return hCode(g, x, z);
}

/** Any wall segment on one of the 4 edges meeting at grid point (cx,cz)? */
export function cornerHasWall(g: Grid, cx: number, cz: number): boolean {
  return (
    hCode(g, cx - 1, cz) !== WALL_NONE ||
    hCode(g, cx, cz) !== WALL_NONE ||
    vCode(g, cx, cz - 1) !== WALL_NONE ||
    vCode(g, cx, cz) !== WALL_NONE
  );
}

/** The full step rule (used to build stepMask; see header). Integer, in-grid source assumed. */
function computeStep(g: Grid, x: number, z: number, k: number): boolean {
  const dx = DIR_DX[k];
  const dz = DIR_DZ[k];
  const tx = x + dx;
  const tz = z + dz;
  if (!inGrid(g, tx, tz)) return false;
  if (g.blocked[tz * g.w + tx]) return false;
  if (dx === 0 || dz === 0) return !blocksMovement(crossedCode(g, x, z, dx, dz));
  if (g.blocked[z * g.w + tx] || g.blocked[tz * g.w + x]) return false;
  const cx = x + (dx > 0 ? 1 : 0);
  const cz = z + (dz > 0 ? 1 : 0);
  return !cornerHasWall(g, cx, cz);
}

/** Frame of a floor-placed object, or null when the placement / def is unusable. */
export function floorFrame(obj: ObjectState, spec: SpecLike): Frame | null {
  const p = obj.placement;
  if (!p || p.kind !== 'floor') return null;
  if (!Number.isInteger(p.x) || !Number.isInteger(p.z)) return null;
  const rot = normalizeRot(p.rot);
  if (rot === null) return null;
  const fp = footprintOf(spec);
  return { w: fp.w, d: fp.d, ox: p.x, oz: p.z, rot };
}

function pushAt(arr: (ObjectId[] | null)[], i: number, id: ObjectId): void {
  const cur = arr[i];
  if (cur) cur.push(id);
  else arr[i] = [id];
}

function objectsOf(state: WorldState): Record<string, ObjectState> {
  const o = state.objects;
  return o && typeof o === 'object' ? o : {};
}

/** Fill `out` (length w*d) with the blocked flags only — the cheap per-tick change detector. */
export function computeBlocked(state: WorldState, content: ContentRegistry, w: number, d: number, out: Uint8Array): void {
  out.fill(0);
  const objs = objectsOf(state);
  const own = objectFilterOf(state);
  for (const id in objs) {
    const obj = objs[id];
    if (!obj || typeof obj !== 'object' || !obj.placement || !own(obj)) continue;
    const spec = specOf(content, obj.defId);
    if (!spec) continue;
    const p = obj.placement;
    if (p.kind === 'floor') {
      if (!floorBlocks(spec)) continue;
      const f = floorFrame(obj, spec);
      if (!f) continue;
      for (const t of frameTiles(f)) if (t.x >= 0 && t.z >= 0 && t.x < w && t.z < d) out[t.z * w + t.x] = 1;
    } else if (p.kind === 'loose') {
      if (!looseBlocks(spec)) continue;
      const tx = Math.floor(p.x);
      const tz = Math.floor(p.z);
      if (tx >= 0 && tz >= 0 && tx < w && tz < d) out[tz * w + tx] = 1;
    }
  }
}

export function buildGrid(state: WorldState, content: ContentRegistry): Grid {
  const { w, d } = lotDims(state);
  const n = w * d;
  const lot = state.lot;
  const b = (lot && lot.buildable) || { x0: 0, z0: 0, x1: 0, z1: 0 };
  const g: Grid = {
    w,
    d,
    n,
    buildable: { x0: intOr(b.x0, 0), z0: intOr(b.z0, 0), x1: intOr(b.x1, 0), z1: intOr(b.z1, 0) },
    sidewalkZ: intOr(lot && lot.sidewalkZ, -1),
    blocked: new Uint8Array(n),
    looseBlocked: new Uint8Array(n),
    objAt: new Array<ObjectId[] | null>(n).fill(null),
    rugAt: new Array<ObjectId[] | null>(n).fill(null),
    floorItemsAt: new Array<ObjectId[] | null>(n).fill(null),
    wallH: new Uint8Array(w * (d + 1)),
    wallV: new Uint8Array((w + 1) * d),
    openingOf: new Map(),
    wallItems: new Map(),
    doorAdj: new Uint8Array(n),
    wallAdj: new Uint8Array(n),
    stepMask: new Uint8Array(n),
    extraCost: null,
  };
  if (n === 0) return g;

  const view = regionViewOf(state);
  const objs = objectsOf(state);
  const own = objectFilterOf(state);
  const openingsByEdge = new Map<EdgeKey, ObjectId>();

  // ── objects: occupancy, openings, wall items ──
  for (const id in objs) {
    const obj = objs[id];
    if (!obj || typeof obj !== 'object' || !obj.placement || !own(obj)) continue;
    const p = obj.placement;
    if (p.kind === 'opening') {
      const e = normalizeEdge(p.edge);
      if (e && !openingsByEdge.has(e)) openingsByEdge.set(e, id);
      continue;
    }
    if (p.kind === 'wall') {
      const e = normalizeEdge(p.edge);
      if (e && (p.side === 0 || p.side === 1)) {
        const key = `${e}|${p.side}`;
        const list = g.wallItems.get(key);
        if (list) list.push(id);
        else g.wallItems.set(key, [id]);
      }
      continue;
    }
    const spec = specOf(content, obj.defId);
    if (!spec) continue;
    if (p.kind === 'floor') {
      const f = floorFrame(obj, spec);
      if (!f) continue;
      const rug = isRug(spec);
      const blocks = floorBlocks(spec);
      for (const t of frameTiles(f)) {
        if (!inGrid(g, t.x, t.z)) continue;
        const i = t.z * w + t.x;
        pushAt(rug ? g.rugAt : g.objAt, i, id);
        if (blocks) g.blocked[i] = 1;
      }
    } else if (p.kind === 'loose') {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      const tx = Math.floor(p.x);
      const tz = Math.floor(p.z);
      if (!inGrid(g, tx, tz)) continue;
      const i = tz * w + tx;
      if (p.parentId === null || p.parentId === undefined) pushAt(g.floorItemsAt, i, id);
      if (looseBlocks(spec)) {
        g.blocked[i] = 1;
        g.looseBlocked[i] = 1;
      }
    }
  }

  // ── walls ──
  const walls = (lot && lot.walls) || {};
  for (const rawKey in walls) {
    const seg = walls[rawKey] as WallSegment | null | undefined;
    if (!seg || typeof seg !== 'object') continue;
    const e = parseEdge(rawKey);
    if (!e) continue;
    const key = edgeKey(e.kind, e.x, e.z);
    let openingId: ObjectId | null = null;
    const linked = typeof seg.openingId === 'string' ? objs[seg.openingId] : undefined;
    if (linked && own(linked) && linked.placement && linked.placement.kind === 'opening' && normalizeEdge(linked.placement.edge) === key) {
      openingId = seg.openingId;
    } else {
      openingId = openingsByEdge.get(key) ?? null;
    }
    let code = WALL_SOLID;
    if (openingId !== null) {
      g.openingOf.set(key, openingId);
      code = isDoor(specOf(content, objs[openingId].defId)) ? WALL_DOOR : WALL_WINDOW;
    }
    if (e.kind === 'h') {
      if (e.x >= 0 && e.x < w && e.z >= 0 && e.z <= d) g.wallH[e.z * w + e.x] = code;
    } else if (e.x >= 0 && e.x <= w && e.z >= 0 && e.z < d) {
      g.wallV[e.z * (w + 1) + e.x] = code;
    }
  }

  // ── W-025 S3: public step mask (privacy) and per-tile extra cost (region views only, never the home) ──
  if (view && view.privacy) closePrivateDoors(g);
  if (view && view.stepCost && view.stepCost.length === n) {
    const ec = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = view.stepCost[i];
      ec[i] = typeof c === 'number' && Number.isFinite(c) && c > 0 ? c : 0;
    }
    g.extraCost = ec;
  }

  // ── door / wall adjacency ──
  const mark = (arr: Uint8Array, x: number, z: number) => {
    if (inGrid(g, x, z)) arr[z * w + x] = 1;
  };
  for (let z = 0; z <= d; z++) {
    for (let x = 0; x < w; x++) {
      const c = g.wallH[z * w + x];
      if (c === WALL_NONE) continue;
      const arr = c === WALL_DOOR ? g.doorAdj : g.wallAdj;
      mark(arr, x, z - 1);
      mark(arr, x, z);
    }
  }
  for (let z = 0; z < d; z++) {
    for (let x = 0; x <= w; x++) {
      const c = g.wallV[z * (w + 1) + x];
      if (c === WALL_NONE) continue;
      const arr = c === WALL_DOOR ? g.doorAdj : g.wallAdj;
      mark(arr, x - 1, z);
      mark(arr, x, z);
    }
  }

  // ── step mask ──
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = 0; k < 8; k++) if (computeStep(g, x, z, k)) m |= 1 << k;
      g.stepMask[z * w + x] = m;
    }
  }
  return g;
}

/** Public mask: every door edge with an indoor room on either side becomes WALL_PRIVATE (yard gates stay open). */
function closePrivateDoors(g: Grid): void {
  const { w, d } = g;
  const rooms = computeRooms(
    w,
    d,
    (x, z) => g.wallH[z * w + x] !== WALL_NONE,
    (x, z) => g.wallV[z * (w + 1) + x] !== WALL_NONE,
  );
  const indoor = (x: number, z: number) => inGrid(g, x, z) && rooms.roomOf[z * w + x] > 0;
  for (let z = 0; z <= d; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      if (g.wallH[i] === WALL_DOOR && (indoor(x, z - 1) || indoor(x, z))) g.wallH[i] = WALL_PRIVATE;
    }
  }
  for (let z = 0; z < d; z++) {
    for (let x = 0; x <= w; x++) {
      const i = z * (w + 1) + x;
      if (g.wallV[i] === WALL_DOOR && (indoor(x - 1, z) || indoor(x, z))) g.wallV[i] = WALL_PRIVATE;
    }
  }
}

/** Direction index for a unit step, or -1. */
export function dirIndex(dx: number, dz: number): number {
  for (let k = 0; k < 8; k++) if (DIR_DX[k] === dx && DIR_DZ[k] === dz) return k;
  return -1;
}

/** canStep on integer in-grid coordinates via the precomputed mask. */
export function gridCanStep(g: Grid, fx: number, fz: number, tx: number, tz: number): boolean {
  if (!inGrid(g, fx, fz) || !inGrid(g, tx, tz)) return false;
  const k = dirIndex(tx - fx, tz - fz);
  if (k < 0) return false;
  return (g.stepMask[fz * g.w + fx] & (1 << k)) !== 0;
}

export function gridWalkable(g: Grid, x: number, z: number): boolean {
  return inGrid(g, x, z) && g.blocked[z * g.w + x] === 0;
}

export function gridBuildable(g: Grid, x: number, z: number): boolean {
  if (!inGrid(g, x, z)) return false;
  const b = g.buildable;
  return x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1 && z !== g.sidewalkZ;
}

/**
 * Can a wall exist on this edge? Both side tiles in bounds, neither on the sidewalk row, and at least one side
 * buildable — i.e. the edge lies inside or on the border of the buildable rectangle.
 */
export function edgeBuildable(g: Grid, edge: EdgeKey): boolean {
  const e = parseEdge(edge);
  if (!e) return false;
  const a = e.kind === 'h' ? { x: e.x, z: e.z - 1 } : { x: e.x - 1, z: e.z };
  const bTile = { x: e.x, z: e.z };
  if (!inGrid(g, a.x, a.z) || !inGrid(g, bTile.x, bTile.z)) return false;
  if (a.z === g.sidewalkZ || bTile.z === g.sidewalkZ) return false;
  return gridBuildable(g, a.x, a.z) || gridBuildable(g, bTile.x, bTile.z);
}
