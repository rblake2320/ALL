/**
 * CLIP-AUDIT geometry core: world-space triangle soups, a bounding-volume hierarchy, exact closest-point queries and
 * a fast generalized winding number (Barill et al. 2018, order-1 dipole far field) for robust inside/outside tests.
 *
 * Why winding numbers (not ray parity): furniture GLBs are built from many overlapping, often open primitives
 * (boxes with no bottom, cylinders without caps, cushions sunk into frames). Parity flips on every overlap and every
 * hole; the winding number degrades gracefully (open surfaces give fractional values, overlapping closed parts sum
 * to >= 1) and with per-component orientation repair it is immune to inverted normals.
 *
 * Everything is pure, deterministic and allocation-light; no three.js dependency (the harness converts meshes).
 */

export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

/** A labelled triangle soup in world space. `vLabel[i]` indexes `labels` (body part / object node name). */
export interface TriMesh {
  pos: Float64Array;
  tri: Uint32Array;
  vLabel: Int32Array;
  labels: string[];
}

export function emptyAabb(): Aabb {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function meshAabb(m: TriMesh, verts?: ArrayLike<number>): Aabb {
  const b = emptyAabb();
  const n = verts ? verts.length : m.pos.length / 3;
  for (let k = 0; k < n; k++) {
    const i = verts ? verts[k] : k;
    for (let a = 0; a < 3; a++) {
      const v = m.pos[i * 3 + a];
      if (v < b.min[a]) b.min[a] = v;
      if (v > b.max[a]) b.max[a] = v;
    }
  }
  return b;
}

export function expandAabb(b: Aabb, r: number): Aabb {
  return { min: [b.min[0] - r, b.min[1] - r, b.min[2] - r], max: [b.max[0] + r, b.max[1] + r, b.max[2] + r] };
}

export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] && a.min[1] <= b.max[1] && a.max[1] >= b.min[1] && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
}

export function inAabb(b: Aabb, x: number, y: number, z: number): boolean {
  return x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2];
}

/** Concatenate soups (labels merged by name). */
export function mergeMeshes(parts: TriMesh[]): TriMesh {
  let nv = 0;
  let nt = 0;
  for (const p of parts) {
    nv += p.pos.length / 3;
    nt += p.tri.length / 3;
  }
  const pos = new Float64Array(nv * 3);
  const tri = new Uint32Array(nt * 3);
  const vLabel = new Int32Array(nv);
  const labels: string[] = [];
  const idx = new Map<string, number>();
  let vo = 0;
  let to = 0;
  for (const p of parts) {
    pos.set(p.pos, vo * 3);
    for (let i = 0; i < p.tri.length; i++) tri[to * 3 + i] = p.tri[i] + vo;
    const map = p.labels.map((l) => {
      let k = idx.get(l);
      if (k === undefined) {
        k = labels.length;
        labels.push(l);
        idx.set(l, k);
      }
      return k;
    });
    for (let i = 0; i < p.vLabel.length; i++) vLabel[vo + i] = p.vLabel[i] < 0 ? -1 : map[p.vLabel[i]];
    vo += p.pos.length / 3;
    to += p.tri.length / 3;
  }
  return { pos, tri, vLabel, labels };
}

/** Triangles whose (majority) vertex label passes `keep` (vertex arrays are shared, not compacted). */
export function filterTriangles(m: TriMesh, keep: (label: string) => boolean): TriMesh {
  const out: number[] = [];
  const ok = m.labels.map(keep);
  for (let t = 0; t < m.tri.length; t += 3) {
    let votes = 0;
    for (let k = 0; k < 3; k++) {
      const l = m.vLabel[m.tri[t + k]];
      if (l >= 0 && ok[l]) votes++;
    }
    if (votes >= 2) out.push(m.tri[t], m.tri[t + 1], m.tri[t + 2]);
  }
  return { pos: m.pos, tri: Uint32Array.from(out), vLabel: m.vLabel, labels: m.labels };
}

// ───────────────────────────── orientation repair ─────────────────────────────

/**
 * Weld coincident vertices (GLB meshes split vertices on UV / normal seams) and return, per triangle, its connected
 * component id. Components are what we orient independently.
 */
export function triangleComponents(m: TriMesh, weldEps = 1e-5): { comp: Int32Array; count: number } {
  const nv = m.pos.length / 3;
  const canon = new Int32Array(nv);
  const grid = new Map<string, number>();
  const q = 1 / weldEps;
  for (let i = 0; i < nv; i++) {
    const key = `${Math.round(m.pos[i * 3] * q)},${Math.round(m.pos[i * 3 + 1] * q)},${Math.round(m.pos[i * 3 + 2] * q)}`;
    const c = grid.get(key);
    if (c === undefined) {
      grid.set(key, i);
      canon[i] = i;
    } else canon[i] = c;
  }
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let t = 0; t < m.tri.length; t += 3) {
    unite(canon[m.tri[t]], canon[m.tri[t + 1]]);
    unite(canon[m.tri[t]], canon[m.tri[t + 2]]);
  }
  const ids = new Map<number, number>();
  const comp = new Int32Array(m.tri.length / 3);
  for (let t = 0; t < m.tri.length; t += 3) {
    const r = find(canon[m.tri[t]]);
    let id = ids.get(r);
    if (id === undefined) {
      id = ids.size;
      ids.set(r, id);
    }
    comp[t / 3] = id;
  }
  return { comp, count: ids.size };
}

/**
 * Flip every connected component whose signed volume is negative (inside-out authored / mirrored-scale nodes), so
 * the winding number reads +1 inside every closed part. Returns a new soup and how many components were flipped.
 */
export function orientOutward(m: TriMesh): { mesh: TriMesh; flipped: number; components: number } {
  const { comp, count } = triangleComponents(m);
  const vol = new Float64Array(count);
  const p = m.pos;
  // reference point per component: its bounding-box centre (exact for closed parts, stable for open shells)
  const lo = new Float64Array(count * 3).fill(Infinity);
  const hi = new Float64Array(count * 3).fill(-Infinity);
  for (let t = 0; t < m.tri.length; t += 3) {
    const k = comp[t / 3];
    for (let j = 0; j < 3; j++) {
      const v = m.tri[t + j] * 3;
      for (let a = 0; a < 3; a++) {
        if (p[v + a] < lo[k * 3 + a]) lo[k * 3 + a] = p[v + a];
        if (p[v + a] > hi[k * 3 + a]) hi[k * 3 + a] = p[v + a];
      }
    }
  }
  for (let t = 0; t < m.tri.length; t += 3) {
    const k = comp[t / 3];
    const ox = (lo[k * 3] + hi[k * 3]) / 2, oy = (lo[k * 3 + 1] + hi[k * 3 + 1]) / 2, oz = (lo[k * 3 + 2] + hi[k * 3 + 2]) / 2;
    const a = m.tri[t] * 3;
    const b = m.tri[t + 1] * 3;
    const c = m.tri[t + 2] * 3;
    const ax = p[a] - ox, ay = p[a + 1] - oy, az = p[a + 2] - oz;
    const bx = p[b] - ox, by = p[b + 1] - oy, bz = p[b + 2] - oz;
    const cx = p[c] - ox, cy = p[c + 1] - oy, cz = p[c + 2] - oz;
    vol[k] += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  const tri = Uint32Array.from(m.tri);
  let flipped = 0;
  const flip = new Uint8Array(count);
  for (let k = 0; k < count; k++) if (vol[k] < -1e-12) {
    flip[k] = 1;
    flipped++;
  }
  for (let t = 0; t < tri.length; t += 3) {
    if (!flip[comp[t / 3]]) continue;
    const s = tri[t + 1];
    tri[t + 1] = tri[t + 2];
    tri[t + 2] = s;
  }
  return { mesh: { pos: m.pos, tri, vLabel: m.vLabel, labels: m.labels }, flipped, components: count };
}

// ───────────────────────────── BVH ─────────────────────────────

const LEAF = 6;
const BETA = 2.3;
const FOUR_PI = 4 * Math.PI;

/** Static BVH over a soup's triangles with per-node dipole data for the fast winding number. */
export class TriBvh {
  readonly mesh: TriMesh;
  readonly triCount: number;
  /** Triangle order (leaves reference contiguous ranges). */
  private readonly order: Uint32Array;
  // node arrays
  private nMin: Float64Array;
  private nMax: Float64Array;
  private nLeft: Int32Array;
  private nRight: Int32Array;
  private nStart: Int32Array;
  private nCount: Int32Array;
  private nN: Float64Array; // area-weighted normal sum (x2: cross product, not halved)
  private nC: Float64Array; // area-weighted centroid
  private nR: Float64Array; // radius about centroid
  private nodes = 0;
  readonly bounds: Aabb;

  constructor(mesh: TriMesh) {
    this.mesh = mesh;
    const nt = mesh.tri.length / 3;
    this.triCount = nt;
    this.order = new Uint32Array(nt);
    for (let i = 0; i < nt; i++) this.order[i] = i;
    const cap = Math.max(1, 2 * Math.ceil(nt / 2) + 1) * 2;
    this.nMin = new Float64Array(cap * 3);
    this.nMax = new Float64Array(cap * 3);
    this.nLeft = new Int32Array(cap).fill(-1);
    this.nRight = new Int32Array(cap).fill(-1);
    this.nStart = new Int32Array(cap);
    this.nCount = new Int32Array(cap);
    this.nN = new Float64Array(cap * 3);
    this.nC = new Float64Array(cap * 3);
    this.nR = new Float64Array(cap);
    const cen = new Float64Array(nt * 3);
    const p = mesh.pos;
    for (let t = 0; t < nt; t++) {
      for (let a = 0; a < 3; a++) cen[t * 3 + a] = (p[mesh.tri[t * 3] * 3 + a] + p[mesh.tri[t * 3 + 1] * 3 + a] + p[mesh.tri[t * 3 + 2] * 3 + a]) / 3;
    }
    if (nt > 0) this.build(0, nt, cen);
    else {
      this.nodes = 1;
      this.nMin.fill(Infinity, 0, 3);
      this.nMax.fill(-Infinity, 0, 3);
    }
    this.bounds = { min: [this.nMin[0], this.nMin[1], this.nMin[2]], max: [this.nMax[0], this.nMax[1], this.nMax[2]] };
  }

  private build(start: number, count: number, cen: Float64Array): number {
    const node = this.nodes++;
    const m = this.mesh;
    const p = m.pos;
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    let cmnx = Infinity, cmny = Infinity, cmnz = Infinity, cmxx = -Infinity, cmxy = -Infinity, cmxz = -Infinity;
    let Nx = 0, Ny = 0, Nz = 0, Ax = 0, Ay = 0, Az = 0, A = 0;
    for (let i = start; i < start + count; i++) {
      const t = this.order[i];
      const ia = m.tri[t * 3] * 3, ib = m.tri[t * 3 + 1] * 3, ic = m.tri[t * 3 + 2] * 3;
      for (const v of [ia, ib, ic]) {
        if (p[v] < mnx) mnx = p[v];
        if (p[v + 1] < mny) mny = p[v + 1];
        if (p[v + 2] < mnz) mnz = p[v + 2];
        if (p[v] > mxx) mxx = p[v];
        if (p[v + 1] > mxy) mxy = p[v + 1];
        if (p[v + 2] > mxz) mxz = p[v + 2];
      }
      const cx = cen[t * 3], cy = cen[t * 3 + 1], cz = cen[t * 3 + 2];
      if (cx < cmnx) cmnx = cx;
      if (cy < cmny) cmny = cy;
      if (cz < cmnz) cmnz = cz;
      if (cx > cmxx) cmxx = cx;
      if (cy > cmxy) cmxy = cy;
      if (cz > cmxz) cmxz = cz;
      const e1x = p[ib] - p[ia], e1y = p[ib + 1] - p[ia + 1], e1z = p[ib + 2] - p[ia + 2];
      const e2x = p[ic] - p[ia], e2y = p[ic + 1] - p[ia + 1], e2z = p[ic + 2] - p[ia + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      Nx += nx;
      Ny += ny;
      Nz += nz;
      const a = Math.hypot(nx, ny, nz);
      A += a;
      Ax += a * cx;
      Ay += a * cy;
      Az += a * cz;
    }
    this.nMin[node * 3] = mnx; this.nMin[node * 3 + 1] = mny; this.nMin[node * 3 + 2] = mnz;
    this.nMax[node * 3] = mxx; this.nMax[node * 3 + 1] = mxy; this.nMax[node * 3 + 2] = mxz;
    this.nN[node * 3] = Nx * 0.5; this.nN[node * 3 + 1] = Ny * 0.5; this.nN[node * 3 + 2] = Nz * 0.5;
    const ccx = A > 0 ? Ax / A : (mnx + mxx) / 2, ccy = A > 0 ? Ay / A : (mny + mxy) / 2, ccz = A > 0 ? Az / A : (mnz + mxz) / 2;
    this.nC[node * 3] = ccx; this.nC[node * 3 + 1] = ccy; this.nC[node * 3 + 2] = ccz;
    // radius: farthest box corner from the centroid (conservative)
    this.nR[node] = Math.hypot(Math.max(ccx - mnx, mxx - ccx), Math.max(ccy - mny, mxy - ccy), Math.max(ccz - mnz, mxz - ccz));
    this.nStart[node] = start;
    this.nCount[node] = count;
    if (count <= LEAF) return node;
    const ex = cmxx - cmnx, ey = cmxy - cmny, ez = cmxz - cmnz;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const mid = axis === 0 ? (cmnx + cmxx) / 2 : axis === 1 ? (cmny + cmxy) / 2 : (cmnz + cmxz) / 2;
    let i = start;
    let j = start + count - 1;
    while (i <= j) {
      if (cen[this.order[i] * 3 + axis] < mid) i++;
      else {
        const s = this.order[i];
        this.order[i] = this.order[j];
        this.order[j] = s;
        j--;
      }
    }
    let split = i - start;
    if (split === 0 || split === count) {
      // degenerate (all centroids equal on the axis): median split by index
      split = count >> 1;
    }
    this.nLeft[node] = this.build(start, split, cen);
    this.nRight[node] = this.build(start + split, count - split, cen);
    return node;
  }

  /** Generalized winding number at (x,y,z): ~1 inside closed outward surfaces, ~0 outside. */
  winding(x: number, y: number, z: number): number {
    if (this.triCount === 0) return 0;
    return this.windNode(0, x, y, z) / FOUR_PI;
  }

  private windNode(node: number, x: number, y: number, z: number): number {
    const cx = this.nC[node * 3] - x, cy = this.nC[node * 3 + 1] - y, cz = this.nC[node * 3 + 2] - z;
    const d = Math.hypot(cx, cy, cz);
    if (d > BETA * this.nR[node]) {
      // far field: dipole of the node's area-weighted normal
      return (this.nN[node * 3] * cx + this.nN[node * 3 + 1] * cy + this.nN[node * 3 + 2] * cz) / (d * d * d);
    }
    if (this.nLeft[node] < 0) {
      let s = 0;
      const m = this.mesh;
      const p = m.pos;
      for (let i = this.nStart[node]; i < this.nStart[node] + this.nCount[node]; i++) {
        const t = this.order[i];
        s += solidAngle(p, m.tri[t * 3] * 3, m.tri[t * 3 + 1] * 3, m.tri[t * 3 + 2] * 3, x, y, z);
      }
      return s;
    }
    return this.windNode(this.nLeft[node], x, y, z) + this.windNode(this.nRight[node], x, y, z);
  }

  /**
   * Inside test + depth in one query: inside = winding number > 0.5 (exact near the surface, dipole far field),
   * depth = distance to the closest surface point (`out`). The shortcut "closest face is front-facing -> outside" is
   * deliberately NOT used: furniture is built from overlapping shells (a cushion sunk into its frame), where a point
   * deep inside the cushion is closest to the frame's outward face (measured: 30 % of the true inside points on
   * armchair_tattered would be dropped). Depths beyond `maxDepth` are clamped to it.
   */
  inside(x: number, y: number, z: number, maxDepth: number, out: ClosestHit): boolean {
    if (!inAabb(this.bounds, x, y, z)) return false;
    if (this.winding(x, y, z) <= 0.5) return false;
    this.closest(x, y, z, maxDepth, out);
    if (out.tri < 0) {
      out.d = maxDepth;
      out.x = x;
      out.y = y;
      out.z = z;
    }
    return true;
  }

  /** Closest point on the surface: distance + point + triangle index (Infinity / -1 when empty or beyond maxDist). */
  closest(x: number, y: number, z: number, maxDist = Infinity, out: ClosestHit = { d: Infinity, x: 0, y: 0, z: 0, tri: -1 }): ClosestHit {
    out.d = maxDist;
    out.tri = -1;
    if (this.triCount > 0) this.closestNode(0, x, y, z, out);
    if (out.tri < 0) out.d = Infinity;
    return out;
  }

  private boxDist2(node: number, x: number, y: number, z: number): number {
    let s = 0;
    for (let a = 0; a < 3; a++) {
      const v = a === 0 ? x : a === 1 ? y : z;
      const lo = this.nMin[node * 3 + a];
      const hi = this.nMax[node * 3 + a];
      if (v < lo) s += (lo - v) * (lo - v);
      else if (v > hi) s += (v - hi) * (v - hi);
    }
    return s;
  }

  private closestNode(node: number, x: number, y: number, z: number, out: ClosestHit): void {
    if (this.boxDist2(node, x, y, z) >= out.d * out.d) return;
    if (this.nLeft[node] < 0) {
      const m = this.mesh;
      for (let i = this.nStart[node]; i < this.nStart[node] + this.nCount[node]; i++) {
        const t = this.order[i];
        closestOnTri(m.pos, m.tri[t * 3] * 3, m.tri[t * 3 + 1] * 3, m.tri[t * 3 + 2] * 3, x, y, z, TMP);
        const d = Math.sqrt(TMP[3]);
        if (d < out.d) {
          out.d = d;
          out.x = TMP[0];
          out.y = TMP[1];
          out.z = TMP[2];
          out.tri = t;
          out.face = TMP[4] === 0;
        }
      }
      return;
    }
    const l = this.nLeft[node];
    const r = this.nRight[node];
    const dl = this.boxDist2(l, x, y, z);
    const dr = this.boxDist2(r, x, y, z);
    if (dl <= dr) {
      this.closestNode(l, x, y, z, out);
      this.closestNode(r, x, y, z, out);
    } else {
      this.closestNode(r, x, y, z, out);
      this.closestNode(l, x, y, z, out);
    }
  }

  /** Nearest ray hit distance (both triangle sides), Infinity when none within `far`. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far = Infinity): number {
    if (this.triCount === 0) return Infinity;
    const st = { best: far };
    this.rayNode(0, ox, oy, oz, dx, dy, dz, 1 / dx, 1 / dy, 1 / dz, st);
    return st.best < far ? st.best : Infinity;
  }

  private rayNode(node: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ix: number, iy: number, iz: number, st: { best: number }): void {
    let t0 = 0;
    let t1 = st.best;
    const o = [ox, oy, oz];
    const inv = [ix, iy, iz];
    for (let a = 0; a < 3; a++) {
      let ta = (this.nMin[node * 3 + a] - o[a]) * inv[a];
      let tb = (this.nMax[node * 3 + a] - o[a]) * inv[a];
      if (Number.isNaN(ta) || Number.isNaN(tb)) {
        // ray parallel to the slab and on its boundary
        if (o[a] < this.nMin[node * 3 + a] || o[a] > this.nMax[node * 3 + a]) return;
        continue;
      }
      if (ta > tb) {
        const s = ta;
        ta = tb;
        tb = s;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return;
    }
    if (this.nLeft[node] < 0) {
      const m = this.mesh;
      for (let i = this.nStart[node]; i < this.nStart[node] + this.nCount[node]; i++) {
        const t = this.order[i];
        const h = rayTri(m.pos, m.tri[t * 3] * 3, m.tri[t * 3 + 1] * 3, m.tri[t * 3 + 2] * 3, ox, oy, oz, dx, dy, dz);
        if (h >= 0 && h < st.best) st.best = h;
      }
      return;
    }
    this.rayNode(this.nLeft[node], ox, oy, oz, dx, dy, dz, ix, iy, iz, st);
    this.rayNode(this.nRight[node], ox, oy, oz, dx, dy, dz, ix, iy, iz, st);
  }

  /** Triangles whose box overlaps `box` (for surface sampling). */
  trianglesIn(box: Aabb): number[] {
    const out: number[] = [];
    if (this.triCount === 0) return out;
    const stack = [0];
    while (stack.length) {
      const n = stack.pop()!;
      const nb: Aabb = {
        min: [this.nMin[n * 3], this.nMin[n * 3 + 1], this.nMin[n * 3 + 2]],
        max: [this.nMax[n * 3], this.nMax[n * 3 + 1], this.nMax[n * 3 + 2]],
      };
      if (!aabbOverlap(nb, box)) continue;
      if (this.nLeft[n] < 0) {
        for (let i = this.nStart[n]; i < this.nStart[n] + this.nCount[n]; i++) out.push(this.order[i]);
      } else stack.push(this.nLeft[n], this.nRight[n]);
    }
    return out.sort((a, b) => a - b);
  }
}

export interface ClosestHit {
  d: number;
  x: number;
  y: number;
  z: number;
  tri: number;
  /** Closest point lies in the triangle's interior (not on an edge / vertex). */
  face?: boolean;
}

const TMP = new Float64Array(5);

/** Signed solid angle of triangle (a,b,c) seen from q (van Oosterom & Strackee). */
export function solidAngle(p: ArrayLike<number>, a: number, b: number, c: number, x: number, y: number, z: number): number {
  const ax = p[a] - x, ay = p[a + 1] - y, az = p[a + 2] - z;
  const bx = p[b] - x, by = p[b + 1] - y, bz = p[b + 2] - z;
  const cx = p[c] - x, cy = p[c + 1] - y, cz = p[c + 2] - z;
  const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
  const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
  return 2 * Math.atan2(det, den);
}

/** Closest point on triangle (Ericson, RTCD 5.1.5) -> out[0..2] point, out[3] squared distance, out[4] 0 = face interior. */
export function closestOnTri(p: ArrayLike<number>, a: number, b: number, c: number, x: number, y: number, z: number, out: Float64Array): void {
  const ax = p[a], ay = p[a + 1], az = p[a + 2];
  const abx = p[b] - ax, aby = p[b + 1] - ay, abz = p[b + 2] - az;
  const acx = p[c] - ax, acy = p[c + 1] - ay, acz = p[c + 2] - az;
  const apx = x - ax, apy = y - ay, apz = z - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let rx: number, ry: number, rz: number;
  if (d1 <= 0 && d2 <= 0) {
    rx = ax; ry = ay; rz = az;
  } else {
    const bpx = x - p[b], bpy = y - p[b + 1], bpz = z - p[b + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) {
      rx = p[b]; ry = p[b + 1]; rz = p[b + 2];
    } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        rx = ax + abx * v; ry = ay + aby * v; rz = az + abz * v;
      } else {
        const cpx = x - p[c], cpy = y - p[c + 1], cpz = z - p[c + 2];
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) {
          rx = p[c]; ry = p[c + 1]; rz = p[c + 2];
        } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            rx = ax + acx * w; ry = ay + acy * w; rz = az + acz * w;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              rx = p[b] + (p[c] - p[b]) * w; ry = p[b + 1] + (p[c + 1] - p[b + 1]) * w; rz = p[b + 2] + (p[c + 2] - p[b + 2]) * w;
            } else {
              const den = 1 / (va + vb + vc);
              const v = vb * den;
              const w = vc * den;
              rx = ax + abx * v + acx * w; ry = ay + aby * v + acy * w; rz = az + abz * v + acz * w;
              out[4] = 0;
              out[0] = rx;
              out[1] = ry;
              out[2] = rz;
              out[3] = (x - rx) * (x - rx) + (y - ry) * (y - ry) + (z - rz) * (z - rz);
              return;
            }
          }
        }
      }
    }
  }
  out[0] = rx;
  out[1] = ry;
  out[2] = rz;
  out[3] = (x - rx) * (x - rx) + (y - ry) * (y - ry) + (z - rz) * (z - rz);
  out[4] = 1;
}

/** Moller-Trumbore, double sided; returns t >= 0 or -1. */
export function rayTri(p: ArrayLike<number>, a: number, b: number, c: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
  const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det;
  const tx = ox - p[a], ty = oy - p[a + 1], tz = oz - p[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t >= 0 ? t : -1;
}

/**
 * Deterministic surface samples of the triangles in `tris` (vertices + a barycentric grid with roughly `spacing`
 * between samples), each tagged with its triangle's first-vertex label. Only samples inside `clip` are kept.
 */
export function sampleSurface(m: TriMesh, tris: number[], spacing: number, clip: Aabb): { pts: Float64Array; label: Int32Array } {
  const pts: number[] = [];
  const lab: number[] = [];
  const p = m.pos;
  for (const t of tris) {
    const ia = m.tri[t * 3] * 3, ib = m.tri[t * 3 + 1] * 3, ic = m.tri[t * 3 + 2] * 3;
    const lab0 = m.vLabel[m.tri[t * 3]];
    const push = (u: number, v: number) => {
      const w = 1 - u - v;
      const x = p[ia] * w + p[ib] * u + p[ic] * v;
      const y = p[ia + 1] * w + p[ib + 1] * u + p[ic + 1] * v;
      const z = p[ia + 2] * w + p[ib + 2] * u + p[ic + 2] * v;
      if (!inAabb(clip, x, y, z)) return;
      pts.push(x, y, z);
      lab.push(lab0);
    };
    // edges (vertices included) at `spacing`: slivers are covered along their length
    const edges: [number, number, number, number][] = [[0, 0, 1, 0], [1, 0, 0, 1], [0, 1, 0, 0]];
    const L = [
      Math.hypot(p[ib] - p[ia], p[ib + 1] - p[ia + 1], p[ib + 2] - p[ia + 2]),
      Math.hypot(p[ic] - p[ib], p[ic + 1] - p[ib + 1], p[ic + 2] - p[ib + 2]),
      Math.hypot(p[ia] - p[ic], p[ia + 1] - p[ic + 1], p[ia + 2] - p[ic + 2]),
    ];
    edges.forEach(([u0, v0, u1, v1], k) => {
      const n = Math.min(400, Math.max(1, Math.ceil(L[k] / spacing)));
      for (let i = 0; i < n; i++) push(u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * i) / n);
    });
    // interior: R2 low-discrepancy points, ~1 per spacing^2 of area (deterministic)
    const ex = p[ib] - p[ia], ey = p[ib + 1] - p[ia + 1], ez = p[ib + 2] - p[ia + 2];
    const fx = p[ic] - p[ia], fy = p[ic + 1] - p[ia + 1], fz = p[ic + 2] - p[ia + 2];
    const area = 0.5 * Math.hypot(ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx);
    const k = Math.min(40000, Math.floor(area / (spacing * spacing)));
    for (let i = 1; i <= k; i++) {
      let u = (0.5 + i * 0.7548776662466927) % 1;
      let v = (0.5 + i * 0.5698402909980532) % 1;
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      push(u, v);
    }
  }
  return { pts: Float64Array.from(pts), label: Int32Array.from(lab) };
}

/** Transform a soup by a column-major 4x4 matrix (three.js Matrix4.elements layout). */
export function transformMesh(m: TriMesh, e: ArrayLike<number>): TriMesh {
  const pos = new Float64Array(m.pos.length);
  for (let i = 0; i < m.pos.length; i += 3) {
    const x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2];
    pos[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    pos[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    pos[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  // a mirroring transform flips triangle orientation: keep outward winding
  const det = e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2]);
  let tri = m.tri;
  if (det < 0) {
    tri = Uint32Array.from(m.tri);
    for (let t = 0; t < tri.length; t += 3) {
      const s = tri[t + 1];
      tri[t + 1] = tri[t + 2];
      tri[t + 2] = s;
    }
  }
  return { pos, tri, vLabel: m.vLabel, labels: m.labels };
}

/**
 * Split every triangle whose longest edge exceeds `maxEdge` (longest-edge bisection, deterministic) so that a
 * per-triangle classification (buried / visible) has enough resolution on big flat furniture faces.
 */
export function subdivide(m: TriMesh, maxEdge: number): TriMesh {
  const pos: number[] = Array.from(m.pos);
  const lab: number[] = Array.from(m.vLabel);
  const out: number[] = [];
  const mid = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    let i = mid.get(k);
    if (i === undefined) {
      i = pos.length / 3;
      pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
      lab.push(lab[a]);
      mid.set(k, i);
    }
    return i;
  };
  const len2 = (a: number, b: number) => (pos[a * 3] - pos[b * 3]) ** 2 + (pos[a * 3 + 1] - pos[b * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[b * 3 + 2]) ** 2;
  const lim = maxEdge * maxEdge;
  const stack: [number, number, number, number][] = [];
  for (let t = 0; t < m.tri.length; t += 3) {
    stack.push([m.tri[t], m.tri[t + 1], m.tri[t + 2], 0]);
    while (stack.length) {
      const [a, b, c, depth] = stack.pop()!;
      const ab = len2(a, b), bc = len2(b, c), ca = len2(c, a);
      const mx = Math.max(ab, bc, ca);
      if (mx <= lim || depth > 14) {
        out.push(a, b, c);
        continue;
      }
      if (mx === ab) {
        const d = midpoint(a, b);
        stack.push([a, d, c, depth + 1], [d, b, c, depth + 1]);
      } else if (mx === bc) {
        const d = midpoint(b, c);
        stack.push([a, b, d, depth + 1], [a, d, c, depth + 1]);
      } else {
        const d = midpoint(c, a);
        stack.push([a, b, d, depth + 1], [d, b, c, depth + 1]);
      }
    }
  }
  return { pos: Float64Array.from(pos), tri: Uint32Array.from(out), vLabel: Int32Array.from(lab), labels: m.labels };
}

/**
 * The visible (outer) surface of a union of overlapping shells: triangles whose centroid, nudged 0.2 mm off the
 * front face, lies inside the solid (winding > 0.5) are buried in another part (a cushion's underside inside its
 * frame) and dropped. Penetration depth is measured to what remains, i.e. to the surface you can see.
 */
export function visibleSurface(m: TriMesh, solid: TriBvh, maxEdge = 0.06): TriMesh {
  const s = subdivide(m, maxEdge);
  const keep: number[] = [];
  const p = s.pos;
  for (let t = 0; t < s.tri.length; t += 3) {
    const a = s.tri[t] * 3, b = s.tri[t + 1] * 3, c = s.tri[t + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 0)) continue;
    const k = 2e-4 / nl;
    const cx = (p[a] + p[b] + p[c]) / 3 + nx * k, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3 + ny * k, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 + nz * k;
    if (solid.winding(cx, cy, cz) > 0.5) continue;
    keep.push(s.tri[t], s.tri[t + 1], s.tri[t + 2]);
  }
  return { pos: s.pos, tri: Uint32Array.from(keep), vLabel: s.vLabel, labels: s.labels };
}
