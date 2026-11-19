/**
 * CLIP-AUDIT detector: interpenetration depth (both directions), inside fraction, worst part, and contact gaps
 * between two labelled solids (a posed character and furniture / a held item / another character / the floor).
 *
 *  A-in-B: every A vertex inside B's bounds is tested with B's winding number; depth = distance to B's surface.
 *  B-in-A: B's surface is sampled (vertices + barycentric grid, THRESHOLDS.sampleSpacing) inside A's bounds and
 *          each sample is tested against A. This direction catches thin geometry (a 5 mm board through a thigh has
 *          no thigh vertex inside the board, but the board's samples sit centimetres inside the thigh).
 *  Depth = max of both. The worst part is the A label with the most inside points (A vertices inside B plus B samples
 *  whose closest A surface point belongs to that label).
 */
import {
  TriBvh, expandAabb, inAabb, orientOutward, sampleSurface, visibleSurface, type Aabb, type ClosestHit, type TriMesh,
} from './geometry';
import { THRESHOLDS } from './thresholds';

export interface Solid {
  mesh: TriMesh;
  /** Inside test (winding number) over every shell. */
  bvh: TriBvh;
  /** Depth / gap queries: the visible outer surface (== bvh unless built with `visible`). */
  surf: TriBvh;
  /** Components flipped by the orientation repair (inverted normals). */
  flipped: number;
}

export interface SolidOptions {
  /** Repair inside-out components (default true). */
  orient?: boolean;
  /**
   * Measure depths to the visible outer surface only (drop faces buried inside other shells). Costs one winding
   * evaluation per (subdivided) triangle: meant for static furniture built once and queried thousands of times.
   */
  visible?: boolean;
}

export function makeSolid(mesh: TriMesh, opts: boolean | SolidOptions = true): Solid {
  const o: SolidOptions = typeof opts === 'boolean' ? { orient: opts } : opts;
  const r = o.orient === false ? { mesh, flipped: 0 } : orientOutward(mesh);
  const bvh = new TriBvh(r.mesh);
  const surf = o.visible ? new TriBvh(visibleSurface(r.mesh, bvh)) : bvh;
  return { mesh: r.mesh, bvh, surf, flipped: r.flipped };
}

/** Is (x,y,z) inside `S`? On true, `out` holds the closest VISIBLE surface point (out.tri indexes S.surf.mesh). */
export function insideDepth(S: Solid, x: number, y: number, z: number, out: ClosestHit): boolean {
  if (!inAabb(S.bvh.bounds, x, y, z)) return false;
  if (S.bvh.winding(x, y, z) <= THRESHOLDS.insideWinding) return false;
  S.surf.closest(x, y, z, MAX_DEPTH, out);
  if (out.tri < 0) {
    out.d = MAX_DEPTH;
    out.x = x;
    out.y = y;
    out.z = z;
  }
  return true;
}

export interface PartStat {
  inside: number;
  maxDepthMm: number;
}

export interface Deepest {
  /** World position of the deepest point. */
  at: [number, number, number];
  /** Label on A (body part) and on B (object node) at that point. */
  aLabel: string;
  bLabel: string;
  dir: 'AinB' | 'BinA';
}

export interface Penetration {
  maxDepthMm: number;
  /** A vertices inside B / A vertices tested (inside B's bounds) and / all A vertices. */
  aInside: number;
  aTested: number;
  aTotal: number;
  pctInside: number;
  bSamplesInside: number;
  bSamples: number;
  byPart: Record<string, PartStat>;
  worstPart: string | null;
  deepest: Deepest | null;
}

export interface PenOptions {
  /** Only these A labels take part (e.g. skip a prop bone); default all. */
  aFilter?: (label: string) => boolean;
  /** Only these B labels take part. */
  bFilter?: (label: string) => boolean;
  /** Skip the B-in-A sampling direction (cheaper; for closed thick B only). */
  oneWay?: boolean;
  spacing?: number;
}

const hit: ClosestHit = { d: Infinity, x: 0, y: 0, z: 0, tri: -1 };
/** Deepest penetration measured (m); anything deeper reads as outside (see TriBvh.inside). */
export const MAX_DEPTH = 0.35;

function triLabel(m: TriMesh, tri: number): number {
  return tri < 0 ? -1 : m.vLabel[m.tri[tri * 3]];
}

export function penetration(A: Solid, B: Solid, opts: PenOptions = {}): Penetration {
  const am = A.mesh;
  const bm = B.mesh;
  const aOk = am.labels.map((l) => (opts.aFilter ? opts.aFilter(l) : true));
  const bOk = bm.labels.map((l) => (opts.bFilter ? opts.bFilter(l) : true));
  const byPart: Record<string, PartStat> = {};
  const bump = (label: string, depthMm: number) => {
    const s = (byPart[label] ??= { inside: 0, maxDepthMm: 0 });
    s.inside++;
    if (depthMm > s.maxDepthMm) s.maxDepthMm = depthMm;
  };
  let maxDepth = 0;
  let deepest: Deepest | null = null;
  const nA = am.pos.length / 3;
  let aTested = 0;
  let aInside = 0;
  const bBox: Aabb = B.bvh.bounds;
  // only vertices referenced by a triangle count (unreferenced verts of hidden meshes are dropped upstream)
  for (let i = 0; i < nA; i++) {
    const la = am.vLabel[i];
    if (la >= 0 && !aOk[la]) continue;
    const x = am.pos[i * 3], y = am.pos[i * 3 + 1], z = am.pos[i * 3 + 2];
    if (!inAabb(bBox, x, y, z)) continue;
    aTested++;
    if (!insideDepth(B, x, y, z, hit)) continue;
    const lb = triLabel(B.surf.mesh, hit.tri);
    if (lb >= 0 && !bOk[lb]) continue;
    aInside++;
    const mm = hit.d * 1000;
    bump(la >= 0 ? am.labels[la] : '?', mm);
    if (mm > maxDepth) {
      maxDepth = mm;
      deepest = { at: [x, y, z], aLabel: la >= 0 ? am.labels[la] : '?', bLabel: lb >= 0 ? bm.labels[lb] : '?', dir: 'AinB' };
    }
  }
  let bSamples = 0;
  let bInside = 0;
  if (!opts.oneWay) {
    const aBox = expandAabb(A.bvh.bounds, 0);
    const tris = B.bvh.trianglesIn(aBox).filter((t) => {
      const l = triLabel(bm, t);
      return l < 0 || bOk[l];
    });
    const s = sampleSurface(bm, tris, opts.spacing ?? THRESHOLDS.sampleSpacing, aBox);
    bSamples = s.pts.length / 3;
    for (let k = 0; k < bSamples; k++) {
      const x = s.pts[k * 3], y = s.pts[k * 3 + 1], z = s.pts[k * 3 + 2];
      if (!insideDepth(A, x, y, z, hit)) continue;
      const la = triLabel(A.surf.mesh, hit.tri);
      if (la >= 0 && !aOk[la]) continue;
      bInside++;
      const mm = hit.d * 1000;
      bump(la >= 0 ? am.labels[la] : '?', mm);
      if (mm > maxDepth) {
        maxDepth = mm;
        const lb = s.label[k];
        deepest = { at: [x, y, z], aLabel: la >= 0 ? am.labels[la] : '?', bLabel: lb >= 0 ? bm.labels[lb] : '?', dir: 'BinA' };
      }
    }
  }
  // isolated inside points (numerical noise on coincident surfaces) do not make a part penetrate
  let worstPart: string | null = null;
  let worstN = 0;
  let depth = 0;
  for (const [l, st] of Object.entries(byPart)) {
    if (st.inside < THRESHOLDS.minInsideSamples) continue;
    depth = Math.max(depth, st.maxDepthMm);
    if (st.inside > worstN || (st.inside === worstN && worstPart !== null && l < worstPart)) {
      worstN = st.inside;
      worstPart = l;
    }
  }
  if (depth < maxDepth && deepest && (byPart[deepest.aLabel]?.inside ?? 0) < THRESHOLDS.minInsideSamples) deepest = null;
  return {
    maxDepthMm: round1(depth),
    aInside,
    aTested,
    aTotal: nA,
    pctInside: nA > 0 ? round2((100 * aInside) / nA) : 0,
    bSamplesInside: bInside,
    bSamples,
    byPart,
    worstPart,
    deepest,
  };
}

export interface Gap {
  /** Smallest signed distance between the selected A vertices and B (mm; negative = inside B by that much). */
  gapMm: number;
  /** Where on A (world) the closest point is. */
  at: [number, number, number] | null;
  label: string | null;
  count: number;
}

/**
 * Contact gap of the A vertices whose label passes `sel` against B. Inside vertices give a negative gap (their
 * depth). `maxSearch` bounds the closest-point search (gaps beyond it read as maxSearch).
 */
export function contactGap(A: Solid, B: Solid, sel: (label: string) => boolean, maxSearch = 1.0): Gap {
  const am = A.mesh;
  const ok = am.labels.map(sel);
  let best = Infinity;
  let at: [number, number, number] | null = null;
  let label: string | null = null;
  let count = 0;
  const box = expandAabb(B.bvh.bounds, maxSearch);
  for (let i = 0; i < am.pos.length / 3; i++) {
    const la = am.vLabel[i];
    if (la < 0 || !ok[la]) continue;
    count++;
    const x = am.pos[i * 3], y = am.pos[i * 3 + 1], z = am.pos[i * 3 + 2];
    if (!inAabb(box, x, y, z)) continue;
    B.surf.closest(x, y, z, Math.min(maxSearch, best > 0 ? best : maxSearch), hit);
    if (!Number.isFinite(hit.d)) continue;
    let d = hit.d;
    if (inAabb(B.bvh.bounds, x, y, z) && B.bvh.winding(x, y, z) > THRESHOLDS.insideWinding) d = -d;
    if (d < best) {
      best = d;
      at = [x, y, z];
      label = am.labels[la];
    }
  }
  return { gapMm: Number.isFinite(best) ? round1(best * 1000) : round1(maxSearch * 1000), at, label, count };
}

/** Lowest vertex height (world y) among A vertices passing `sel` (Infinity when none). */
export function lowestY(A: Solid, sel: (label: string) => boolean): { y: number; label: string | null } {
  const am = A.mesh;
  const ok = am.labels.map(sel);
  let y = Infinity;
  let label: string | null = null;
  for (let i = 0; i < am.pos.length / 3; i++) {
    const la = am.vLabel[i];
    if (la < 0 || !ok[la]) continue;
    const v = am.pos[i * 3 + 1];
    if (v < y) {
      y = v;
      label = am.labels[la];
    }
  }
  return { y, label };
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
