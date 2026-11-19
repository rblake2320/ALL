/**
 * PATHFINDING (SIM-SPATIAL) — pure functions over a Grid (see grid.ts for the step rules).
 *
 * Conventions:
 *  - Distance field: Dijkstra from one origin tile over the 8-neighbour step graph (grid.stepMask).
 *    Step cost = 1 (orthogonal) or sqrt(2) (diagonal), +0.25 when ENTERING a tile that has a blocking wall
 *    (solid or window, not a door) on one of its 4 edges — keeps zombies off the walls. The origin itself may be
 *    blocked (an agent standing inside furniture may step out). dist = Infinity for unreachable tiles; parent = -1
 *    for the origin and unreachable tiles. Computed in float64, published as Float32Array per the contract.
 *  - Single-target search (findPath on a field-cache miss): the SAME Dijkstra loop, stopped as soon as the target is
 *    settled. With positive step costs a settled tile's dist/parent never change again, so the chain is identical to
 *    the full field's — paths never depend on what happens to be cached. Its scratch result is never cached.
 *  - Paths: tile chain from the field's parent pointers, then greedy string pulling. Waypoints EXCLUDE the start
 *    position and END EXACTLY at the destination tile centre (x + 0.5, z + 0.5).
 *    A shortcut A->B is accepted only if a conservative supercover line-of-sight holds: every tile transition the
 *    segment crosses must be a legal canStep (a segment through a grid vertex is a diagonal step, so it needs both
 *    side tiles walkable and no wall at that corner). The test is "fat": the centre line plus two lines offset by
 *    BODY_RADIUS on either side must all pass (offset endpoints are clamped into the endpoint tiles, so an agent
 *    hugging a wall is checked from its own side). Consecutive tiles of the raw chain are always legal steps, so
 *    smoothing can never make a path invalid — only shorter.
 *  - nearestWalkable: the start tile if walkable; else the closest tile reachable by ONE legal step (never through a
 *    wall); else a scan within Chebyshev radius preferring tiles in the same room, then Euclidean distance to p,
 *    then tile index (deterministic). Off-lot points are clamped onto the lot first. NaN -> null.
 */
import type { DistanceField } from '../contracts';
import type { Vec2 } from '../types';
import { DIR_DX, DIR_DZ, gridCanStep, inGrid, SQRT2, type Grid } from './grid';

const SQRT2_COST = SQRT2;

export const WALL_HUG_PENALTY = 0.25;
/** Half-width used by the fat line-of-sight test (zombie shoulder radius + margin). */
export const BODY_RADIUS = 0.3;

/** Binary min-heap of (key, value) pairs on typed arrays; grows on demand. */
export class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;

  constructor(capacity = 1024) {
    this.keys = new Float64Array(Math.max(16, capacity));
    this.vals = new Int32Array(Math.max(16, capacity));
  }

  clear(): void {
    this.size = 0;
  }

  /** Backing key buffer with at least `min` capacity (used by the inlined Dijkstra loop). */
  keyBuf(min: number): Float64Array {
    while (this.keys.length < min) this.grow();
    return this.keys;
  }

  valBuf(min: number): Int32Array {
    while (this.vals.length < min) this.grow();
    return this.vals;
  }

  grow(): void {
    const k = new Float64Array(this.keys.length * 2);
    k.set(this.keys);
    const v = new Int32Array(this.vals.length * 2);
    v.set(this.vals);
    this.keys = k;
    this.vals = v;
  }

  push(key: number, val: number): void {
    if (this.size >= this.keys.length) this.grow();
    let i = this.size++;
    const keys = this.keys;
    const vals = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  peekKey(): number {
    return this.size > 0 ? this.keys[0] : Infinity;
  }

  /** Removes and returns the value with the smallest key (caller checks size > 0). */
  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n];
      const val = vals[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}

/** An all-unreachable field (invalid origin). */
export function emptyField(n: number, version: number): DistanceField {
  return { dist: new Float32Array(n).fill(Infinity), parent: new Int32Array(n).fill(-1), originIndex: -1, version };
}

/**
 * Core Dijkstra loop shared by the full field and the single-target search (identical pop order by construction).
 * Fills `dist` (float64, length >= n) and `parent` (length >= n); stops early once `target` (>= 0) is settled.
 * Returns true if the target was settled (always false for target < 0).
 */
function runDijkstra(g: Grid, origin: number, target: number, heap: MinHeap, dist: Float64Array, parent: Int32Array): boolean {
  const n = g.n;
  const w = g.w;
  dist.fill(Infinity, 0, n);
  parent.fill(-1, 0, n);
  const mask = g.stepMask;
  const pen = g.wallAdj;
  const ext = g.extraCost ?? null; // W-025 S3: street road/curb cost; always null on the home grid
  const D = SQRT2_COST;
  const P = WALL_HUG_PENALTY;
  // Inlined binary heap (keys/vals typed arrays borrowed from `heap`).
  let keys = heap.keyBuf(n * 4 + 16);
  let vals = heap.valBuf(n * 4 + 16);
  let size = 0;
  dist[origin] = 0;
  keys[0] = 0;
  vals[0] = origin;
  size = 1;
  while (size > 0) {
    const d = keys[0];
    const i = vals[0];
    const last = --size;
    if (last > 0) {
      const key = keys[last];
      const val = vals[last];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        if (l >= last) break;
        const r = l + 1;
        const c = r < last && keys[r] < keys[l] ? r : l;
        if (keys[c] >= key) break;
        keys[k] = keys[c];
        vals[k] = vals[c];
        k = c;
      }
      keys[k] = key;
      vals[k] = val;
    }
    if (d > dist[i]) continue;
    if (i === target) return true;
    const m = mask[i];
    if (m === 0) continue;
    for (let b = 0; b < 8; b++) {
      if ((m & (1 << b)) === 0) continue;
      let j: number;
      let nd: number;
      switch (b) {
        case 0: j = i + 1; nd = d + 1; break;
        case 1: j = i - 1; nd = d + 1; break;
        case 2: j = i + w; nd = d + 1; break;
        case 3: j = i - w; nd = d + 1; break;
        case 4: j = i + 1 + w; nd = d + D; break;
        case 5: j = i - 1 + w; nd = d + D; break;
        case 6: j = i + 1 - w; nd = d + D; break;
        default: j = i - 1 - w; nd = d + D; break;
      }
      if (pen[j]) nd += P;
      if (ext !== null) nd += ext[j];
      if (!(nd < dist[j])) continue;
      dist[j] = nd;
      parent[j] = i;
      // push (sift up)
      if (size >= keys.length) {
        heap.grow();
        keys = heap.keyBuf(0);
        vals = heap.valBuf(0);
      }
      let h = size++;
      while (h > 0) {
        const ph = (h - 1) >> 1;
        if (keys[ph] <= nd) break;
        keys[h] = keys[ph];
        vals[h] = vals[ph];
        h = ph;
      }
      keys[h] = nd;
      vals[h] = j;
    }
  }
  return false;
}

export function dijkstra(g: Grid, origin: number, version: number, heap: MinHeap, scratch: Float64Array): DistanceField {
  const n = g.n;
  if (!Number.isInteger(origin) || origin < 0 || origin >= n) return emptyField(n, version);
  const dist = scratch.length >= n ? scratch : new Float64Array(n);
  const parent = new Int32Array(n);
  runDijkstra(g, origin, -1, heap, dist, parent);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dist[i];
  return { dist: out, parent, originIndex: origin, version };
}

/**
 * Tile chain origin..target via the early-exit search (see header); null when unreachable / bad indices.
 * `dist` / `parent` are caller scratch of length >= n.
 */
export function chainTo(g: Grid, origin: number, target: number, heap: MinHeap, dist: Float64Array, parent: Int32Array): number[] | null {
  const n = g.n;
  if (!Number.isInteger(origin) || !Number.isInteger(target)) return null;
  if (origin < 0 || origin >= n || target < 0 || target >= n || dist.length < n || parent.length < n) return null;
  if (!runDijkstra(g, origin, target, heap, dist, parent)) return null;
  const out: number[] = [];
  let cur = target;
  for (let guard = 0; guard <= n; guard++) {
    out.push(cur);
    if (cur === origin) return out.reverse();
    cur = parent[cur];
    if (cur < 0) return null;
  }
  return null;
}

/** Tile indices origin..target from parent pointers; null if target unreachable / corrupt chain. */
export function reconstruct(field: DistanceField, target: number): number[] | null {
  const n = field.parent.length;
  if (target < 0 || target >= n || field.originIndex < 0) return null;
  if (!Number.isFinite(field.dist[target])) return null;
  const out: number[] = [];
  let cur = target;
  for (let guard = 0; guard <= n; guard++) {
    out.push(cur);
    if (cur === field.originIndex) return out.reverse();
    cur = field.parent[cur];
    if (cur < 0) return null;
  }
  return null;
}

/** Supercover traversal of one segment; every crossed transition must be a legal step. */
export function losLine(g: Grid, x0: number, z0: number, x1: number, z1: number): boolean {
  if (!Number.isFinite(x0) || !Number.isFinite(z0) || !Number.isFinite(x1) || !Number.isFinite(z1)) return false;
  let cx = Math.floor(x0);
  let cz = Math.floor(z0);
  const ex = Math.floor(x1);
  const ez = Math.floor(z1);
  if (!inGrid(g, cx, cz) || !inGrid(g, ex, ez)) return false;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdz = sz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (cx + 1 - x0) / dx : sx < 0 ? (x0 - cx) / -dx : Infinity;
  let tmz = sz > 0 ? (cz + 1 - z0) / dz : sz < 0 ? (z0 - cz) / -dz : Infinity;
  let guard = Math.abs(ex - cx) + Math.abs(ez - cz) + 4;
  while (cx !== ex || cz !== ez) {
    if (guard-- <= 0) return false;
    const diff = tmx - tmz;
    if (Math.abs(diff) < 1e-9) {
      if (!gridCanStep(g, cx, cz, cx + sx, cz + sz)) return false;
      cx += sx;
      cz += sz;
      tmx += tdx;
      tmz += tdz;
    } else if (diff < 0) {
      if (!gridCanStep(g, cx, cz, cx + sx, cz)) return false;
      cx += sx;
      tmx += tdx;
    } else {
      if (!gridCanStep(g, cx, cz, cx, cz + sz)) return false;
      cz += sz;
      tmz += tdz;
    }
  }
  return true;
}

/** Keep a coordinate inside tile [t, t+1) (small margin) so an offset line never starts across a wall. */
function clampInto(v: number, t: number): number {
  return Math.min(t + 0.999, Math.max(t + 0.001, v));
}

/**
 * Centre line + two parallel lines offset by `r` on either side (clearance for the zombie's body). The offset lines'
 * endpoints are clamped into the endpoint tiles, so a start position hugging a wall is checked from its own side.
 */
export function losFat(g: Grid, ax: number, az: number, bx: number, bz: number, r = BODY_RADIUS): boolean {
  if (!losLine(g, ax, az, bx, bz)) return false;
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-9)) return true;
  const ox = (-dz / len) * r;
  const oz = (dx / len) * r;
  const tax = Math.floor(ax);
  const taz = Math.floor(az);
  const tbx = Math.floor(bx);
  const tbz = Math.floor(bz);
  for (const s of [1, -1]) {
    const x0 = clampInto(ax + s * ox, tax);
    const z0 = clampInto(az + s * oz, taz);
    const x1 = clampInto(bx + s * ox, tbx);
    const z1 = clampInto(bz + s * oz, tbz);
    if (!losLine(g, x0, z0, x1, z1)) return false;
  }
  return true;
}

function centreOf(g: Grid, i: number): Vec2 {
  const x = i % g.w;
  return { x: x + 0.5, z: (i - x) / g.w + 0.5 };
}

/** Greedy string pulling over a legal tile chain (tiles[0] contains `from`). */
export function smoothPath(g: Grid, from: Vec2, tiles: number[]): Vec2[] {
  const out: Vec2[] = [];
  const n = tiles.length;
  if (n === 0) return out;
  if (n === 1) return [centreOf(g, tiles[0])];
  // W-025 S3: on a grid with per-tile costs (streets) a straight shortcut could cut across costly road tiles the
  // search avoided, so the tile chain is kept as is (never the case on a lot grid: extraCost is null there).
  if (g.extraCost) {
    for (let k = 1; k < n; k++) out.push(centreOf(g, tiles[k]));
    return out;
  }
  let ax = from.x;
  let az = from.z;
  let i = 0;
  while (i < n - 1) {
    let j = i + 1;
    for (let k = i + 2; k < n; k++) {
      const c = centreOf(g, tiles[k]);
      if (!losFat(g, ax, az, c.x, c.z)) break;
      j = k;
    }
    const c = centreOf(g, tiles[j]);
    out.push(c);
    ax = c.x;
    az = c.z;
    i = j;
  }
  return out;
}

/** See header. `roomOf` (optional) enables the same-room preference of the fallback scan. */
export function nearestWalkableTile(g: Grid, p: Vec2, maxRadius: number | undefined, roomOf: Int32Array | null): { x: number; z: number } | null {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || g.n === 0) return null;
  const sx = Math.max(0, Math.min(g.w - 1, Math.floor(p.x)));
  const sz = Math.max(0, Math.min(g.d - 1, Math.floor(p.z)));
  const limit = Math.max(g.w, g.d);
  const R = maxRadius === undefined || !Number.isFinite(maxRadius) ? limit : Math.max(0, Math.min(limit, Math.floor(maxRadius)));
  const si = sz * g.w + sx;
  if (g.blocked[si] === 0) return { x: sx, z: sz };
  const d2 = (x: number, z: number) => (x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2;

  // 1) one legal step out (respects walls / doors / corner rules)
  if (R >= 1) {
    let best = -1;
    let bestD = Infinity;
    const m = g.stepMask[si];
    for (let k = 0; k < 8; k++) {
      if ((m & (1 << k)) === 0) continue;
      const x = sx + DIR_DX[k];
      const z = sz + DIR_DZ[k];
      const dd = d2(x, z);
      const idx = z * g.w + x;
      if (dd < bestD - 1e-12 || (Math.abs(dd - bestD) <= 1e-12 && idx < best)) {
        bestD = dd;
        best = idx;
      }
    }
    if (best >= 0) return { x: best % g.w, z: Math.floor(best / g.w) };
  }

  // 2) scan the square of radius R
  const room = roomOf ? roomOf[si] : -1;
  let best = -1;
  let bestRank = Infinity;
  let bestD = Infinity;
  for (let z = Math.max(0, sz - R); z <= Math.min(g.d - 1, sz + R); z++) {
    for (let x = Math.max(0, sx - R); x <= Math.min(g.w - 1, sx + R); x++) {
      const idx = z * g.w + x;
      if (g.blocked[idx] !== 0) continue;
      const rank = roomOf && roomOf[idx] === room ? 0 : 1;
      const dd = d2(x, z);
      if (rank < bestRank || (rank === bestRank && (dd < bestD - 1e-12 || (Math.abs(dd - bestD) <= 1e-12 && idx < best)))) {
        bestRank = rank;
        bestD = dd;
        best = idx;
      }
    }
  }
  return best >= 0 ? { x: best % g.w, z: Math.floor(best / g.w) } : null;
}

/** Fixed-capacity LRU of distance fields keyed by origin tile index. */
export class FieldCache {
  private map = new Map<number, DistanceField>();

  constructor(private readonly capacity = 32) {}

  get(origin: number): DistanceField | undefined {
    const f = this.map.get(origin);
    if (f) {
      this.map.delete(origin);
      this.map.set(origin, f);
    }
    return f;
  }

  set(origin: number, f: DistanceField): void {
    this.map.delete(origin);
    this.map.set(origin, f);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as number;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
