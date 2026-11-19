/**
 * Wall mesh builder (pure — no three.js; unit-testable). Produces one merged triangle soup for every wall
 * segment, opening cut and corner post, plus per-vertex animation data so the renderer can animate cutaway
 * heights in place without rebuilding:
 *
 *   rendered y = min(designY, h[slot]);  pieces whose bottom ≥ h collapse to a point (headers above doors).
 *   side-face v = vBase + y * vScale     (wallpaper isn't squashed when lowered).
 *
 * Posts sit at every wall vertex except straight-through joints; a post face that is coplanar with an
 * adjacent wall face continues that wall's paint (world-unit UVs line up), other post faces use trim.
 */
import { DIM } from '../../shared/dimensions';
import type { EdgeKey, WallSegment } from '../../sim/types';
import { parseEdgeKey, type ParsedEdge } from './edges';
import { wallStyleSlot, WALL_CAP_SLOT, WALL_TRIM_SLOT, type AtlasCell } from './atlasLayout';
import { rayAabb } from '../picking/rayMath';

export interface OpeningCut {
  kind: 'door' | 'window';
  /** Gap width along the edge (tiles). */
  width: number;
  /** Gap bottom (0 for doors, sill height for windows). */
  bottom: number;
  /** Gap top (door height / window top). */
  top: number;
}

export interface WallSegmentInfo {
  key: EdgeKey;
  edge: ParsedEdge;
  /** World extent along the edge tangent after post trimming. */
  s0: number;
  s1: number;
  opening: OpeningCut | null;
  /** Height slot (index into the heights array). */
  slot: number;
}

export interface WallPostInfo {
  x: number;
  z: number;
  slot: number;
  /** Segment indices meeting at this post. */
  arms: number[];
}

export interface WallMeshData {
  vertexCount: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  designY: Float32Array;
  pieceBottom: Float32Array;
  slotOf: Uint32Array;
  vBase: Float32Array;
  vScale: Float32Array;
  anchorX: Float32Array;
  anchorZ: Float32Array;
  segments: WallSegmentInfo[];
  posts: WallPostInfo[];
  slotCount: number;
}

export interface WallBuildOptions {
  height?: number;
  thickness?: number;
}

/** Sanitise an opening cut into a valid gap. */
export function sanitizeCut(cut: OpeningCut, wallHeight: number = DIM.WALL_HEIGHT): OpeningCut {
  const H = wallHeight;
  const width = Math.min(0.96, Math.max(0.2, Number.isFinite(cut.width) ? cut.width : 0.8));
  let bottom = cut.kind === 'door' ? 0 : Math.min(H - 0.4, Math.max(0, Number.isFinite(cut.bottom) ? cut.bottom : DIM.WINDOW_SILL));
  let top = Math.min(H - 0.05, Number.isFinite(cut.top) ? cut.top : bottom + 1);
  if (top < bottom + 0.2) top = Math.min(H - 0.05, bottom + 0.2);
  if (top <= bottom) bottom = Math.max(0, top - 0.2);
  return { kind: cut.kind === 'door' ? 'door' : 'window', width, bottom, top };
}

class Soup {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  dY: number[] = [];
  pB: number[] = [];
  slot: number[] = [];
  vb: number[] = [];
  vs: number[] = [];
  ax: number[] = [];
  az: number[] = [];

  /**
   * Add a quad with corners c (4×xyz, any order around the perimeter) and outward normal n.
   * uvs: 4×uv matching the corners. Winding is fixed up from the normal.
   */
  quad(c: number[], n: [number, number, number], uvs: number[], slot: number, bottom: number, vBase: number, vScale: number, anchorX: number, anchorZ: number): void {
    const e1x = c[3] - c[0];
    const e1y = c[4] - c[1];
    const e1z = c[5] - c[2];
    const e2x = c[6] - c[0];
    const e2y = c[7] - c[1];
    const e2z = c[8] - c[2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const order = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const base = this.pos.length / 3;
    for (const k of order) {
      this.pos.push(c[k * 3], c[k * 3 + 1], c[k * 3 + 2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uvs[k * 2], uvs[k * 2 + 1]);
      this.dY.push(c[k * 3 + 1]);
      this.pB.push(bottom);
      this.slot.push(slot);
      this.vb.push(vBase);
      this.vs.push(vScale);
      this.ax.push(anchorX);
      this.az.push(anchorZ);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** Local edge frame → world. 'h': (s, n) → (x=s, z=L+n); 'v': (s, n) → (x=L+n, z=s). */
function world(e: ParsedEdge, s: number, n: number, y: number, out: number[]): void {
  if (e.kind === 'h') out.push(s, y, e.z + n);
  else out.push(e.x + n, y, s);
}

function nAxis(e: ParsedEdge, sign: number): [number, number, number] {
  return e.kind === 'h' ? [0, 0, sign] : [sign, 0, 0];
}

function sAxis(e: ParsedEdge, sign: number): [number, number, number] {
  return e.kind === 'h' ? [sign, 0, 0] : [0, 0, sign];
}

/** Side faces whose u runs against the viewer's right get mirrored so patterns read correctly from each side. */
export function sideMirrored(kind: 'h' | 'v', side: 0 | 1): boolean {
  return kind === 'h' ? side === 0 : side === 1;
}

function cellMid(cell: AtlasCell): [number, number] {
  return [(cell.u0 + cell.u1) / 2, (cell.v0 + cell.v1) / 2];
}

interface VertexArms {
  x: number;
  z: number;
  px: number; // segment going +X (h:x:z)
  nx: number; // segment going -X (h:x-1:z)
  pz: number; // segment going +Z (v:x:z)
  nz: number; // segment going -Z (v:x:z-1)
}

function vkey(x: number, z: number): number {
  return (x + 50000) * 131072 + (z + 50000);
}

/** Does a vertex need a corner post? Everything except an isolated straight-through pair. */
export function vertexNeedsPost(v: Pick<VertexArms, 'px' | 'nx' | 'pz' | 'nz'>): boolean {
  const deg = (v.px >= 0 ? 1 : 0) + (v.nx >= 0 ? 1 : 0) + (v.pz >= 0 ? 1 : 0) + (v.nz >= 0 ? 1 : 0);
  if (deg === 0) return false;
  if (deg === 2 && ((v.px >= 0 && v.nx >= 0) || (v.pz >= 0 && v.nz >= 0))) return false;
  return true;
}

/**
 * Build the merged wall mesh.
 * @param walls   lot.walls
 * @param openingFor  cut for an edge (null = solid)
 * @param cells   wall atlas cells by slot (styles, then trim, then cap)
 */
export function buildWallMesh(
  walls: Record<EdgeKey, WallSegment> | null | undefined,
  openingFor: (key: EdgeKey) => OpeningCut | null,
  cells: readonly AtlasCell[],
  opts: WallBuildOptions = {},
): WallMeshData {
  const H = opts.height && opts.height > 0 ? opts.height : DIM.WALL_HEIGHT;
  const T = opts.thickness && opts.thickness > 0 ? opts.thickness : DIM.WALL_THICKNESS;
  const half = T / 2;
  const soup = new Soup();
  const segments: WallSegmentInfo[] = [];
  const paints: [number, number][] = [];

  // 1. collect valid segments (sorted for deterministic output)
  const keys = walls && typeof walls === 'object' ? Object.keys(walls).sort() : [];
  for (const key of keys) {
    const e = parseEdgeKey(key);
    if (!e) continue;
    const seg = walls![key];
    const paint = seg && Array.isArray(seg.paint) ? seg.paint : [];
    let cut: OpeningCut | null = null;
    try {
      const c = openingFor(key);
      cut = c ? sanitizeCut(c, H) : null;
    } catch {
      cut = null;
    }
    segments.push({ key, edge: e, s0: e.kind === 'h' ? e.x : e.z, s1: (e.kind === 'h' ? e.x : e.z) + 1, opening: cut, slot: segments.length });
    paints.push([wallStyleSlot(paint[0]), wallStyleSlot(paint[1])]);
  }

  // 2. vertex adjacency
  const verts = new Map<number, VertexArms>();
  const vertex = (x: number, z: number): VertexArms => {
    const k = vkey(x, z);
    let v = verts.get(k);
    if (!v) {
      v = { x, z, px: -1, nx: -1, pz: -1, nz: -1 };
      verts.set(k, v);
    }
    return v;
  };
  segments.forEach((sg, i) => {
    const e = sg.edge;
    if (e.kind === 'h') {
      vertex(e.x, e.z).px = i;
      vertex(e.x + 1, e.z).nx = i;
    } else {
      vertex(e.x, e.z).pz = i;
      vertex(e.x, e.z + 1).nz = i;
    }
  });
  const postAt = (x: number, z: number): boolean => {
    const v = verts.get(vkey(x, z));
    return !!v && vertexNeedsPost(v);
  };

  // 3. trim segment extents at posts
  for (const sg of segments) {
    const e = sg.edge;
    const sx = e.x;
    const sz = e.z;
    const ex = e.kind === 'h' ? e.x + 1 : e.x;
    const ez = e.kind === 'h' ? e.z : e.z + 1;
    if (postAt(sx, sz)) sg.s0 += half;
    if (postAt(ex, ez)) sg.s1 -= half;
  }

  const trim = cells[WALL_TRIM_SLOT] ?? cells[0];
  const cap = cells[WALL_CAP_SLOT] ?? cells[0];
  const trimUV = cellMid(trim);
  const capUV = cellMid(cap);
  const c: number[] = [];

  /** Painted side face of a segment piece spanning [a,b] × [y0,y1] on `side`. */
  const sideFace = (sg: WallSegmentInfo, side: 0 | 1, styleSlot: number, a: number, b: number, y0: number, y1: number, slot: number, bottom: number, axw: number, azw: number) => {
    const e = sg.edge;
    const cell = cells[styleSlot] ?? cells[0];
    const base = e.kind === 'h' ? e.x : e.z;
    const n = side === 1 ? half : -half;
    c.length = 0;
    world(e, a, n, y0, c);
    world(e, b, n, y0, c);
    world(e, b, n, y1, c);
    world(e, a, n, y1, c);
    const mir = sideMirrored(e.kind, side);
    const du = cell.u1 - cell.u0;
    const ua = cell.u0 + (mir ? 1 - (a - base) : a - base) * du;
    const ub = cell.u0 + (mir ? 1 - (b - base) : b - base) * du;
    const vScale = (cell.v1 - cell.v0) / H;
    const va = cell.v0 + y0 * vScale;
    const vb = cell.v0 + y1 * vScale;
    soup.quad(c, nAxis(e, side === 1 ? 1 : -1), [ua, va, ub, va, ub, vb, ua, vb], slot, bottom, cell.v0, vScale, axw, azw);
  };

  const flatFace = (e: ParsedEdge, a: number, b: number, y: number, up: boolean, uv: [number, number], slot: number, bottom: number, axw: number, azw: number) => {
    c.length = 0;
    world(e, a, -half, y, c);
    world(e, b, -half, y, c);
    world(e, b, half, y, c);
    world(e, a, half, y, c);
    soup.quad(c, [0, up ? 1 : -1, 0], [uv[0], uv[1], uv[0], uv[1], uv[0], uv[1], uv[0], uv[1]], slot, bottom, 0, 0, axw, azw);
  };

  const endFace = (e: ParsedEdge, s: number, sign: number, y0: number, y1: number, slot: number, bottom: number, axw: number, azw: number) => {
    c.length = 0;
    world(e, s, -half, y0, c);
    world(e, s, half, y0, c);
    world(e, s, half, y1, c);
    world(e, s, -half, y1, c);
    soup.quad(c, sAxis(e, sign), [trimUV[0], trimUV[1], trimUV[0], trimUV[1], trimUV[0], trimUV[1], trimUV[0], trimUV[1]], slot, bottom, 0, 0, axw, azw);
  };

  const anchor = (e: ParsedEdge, s: number): [number, number] => (e.kind === 'h' ? [s, e.z] : [e.x, s]);

  /** A full piece [a,b] × [y0,y1] with optional faces. */
  const piece = (
    sg: WallSegmentInfo,
    pi: [number, number],
    a: number,
    b: number,
    y0: number,
    y1: number,
    faces: { top: 'cap' | 'none'; bottom: boolean; endA: [number, number] | null; endB: [number, number] | null },
  ) => {
    if (b - a < 0.004 || y1 - y0 < 0.004) return;
    const e = sg.edge;
    const [axw, azw] = anchor(e, (a + b) / 2);
    const bottom = y0;
    sideFace(sg, 1, pi[1], a, b, y0, y1, sg.slot, bottom, axw, azw);
    sideFace(sg, 0, pi[0], a, b, y0, y1, sg.slot, bottom, axw, azw);
    if (faces.top === 'cap') flatFace(e, a, b, y1, true, capUV, sg.slot, bottom, axw, azw);
    if (faces.bottom && y0 > 0) flatFace(e, a, b, y0, false, trimUV, sg.slot, bottom, axw, azw);
    if (faces.endA) endFace(e, a, -1, faces.endA[0], faces.endA[1], sg.slot, bottom, axw, azw);
    if (faces.endB) endFace(e, b, 1, faces.endB[0], faces.endB[1], sg.slot, bottom, axw, azw);
  };

  // 4. segment pieces
  segments.forEach((sg, i) => {
    const pi = paints[i];
    const base = sg.edge.kind === 'h' ? sg.edge.x : sg.edge.z;
    const cut = sg.opening;
    if (!cut) {
      piece(sg, pi, sg.s0, sg.s1, 0, H, { top: 'cap', bottom: false, endA: [0, H], endB: [0, H] });
      return;
    }
    const g0 = Math.max(sg.s0 + 0.005, base + 0.5 - cut.width / 2);
    const g1 = Math.min(sg.s1 - 0.005, base + 0.5 + cut.width / 2);
    // jambs: outer ends full height, gap-side reveal only across the opening
    piece(sg, pi, sg.s0, g0, 0, H, { top: 'cap', bottom: false, endA: [0, H], endB: [cut.bottom, cut.top] });
    piece(sg, pi, g1, sg.s1, 0, H, { top: 'cap', bottom: false, endA: [cut.bottom, cut.top], endB: [0, H] });
    // header above the gap (collapses when the wall is lowered below it)
    piece(sg, pi, g0, g1, cut.top, H, { top: 'cap', bottom: true, endA: null, endB: null });
    // sill below a window
    if (cut.bottom > 0.01) piece(sg, pi, g0, g1, 0, cut.bottom, { top: 'cap', bottom: false, endA: null, endB: null });
  });

  // 5. posts
  const posts: WallPostInfo[] = [];
  let slotCount = segments.length;
  const sortedVerts = [...verts.values()].sort((p, q) => p.x - q.x || p.z - q.z);
  for (const v of sortedVerts) {
    if (!vertexNeedsPost(v)) continue;
    const slot = slotCount++;
    const arms = [v.px, v.nx, v.pz, v.nz].filter((s) => s >= 0);
    posts.push({ x: v.x, z: v.z, slot, arms });
    const x0 = v.x - half;
    const x1 = v.x + half;
    const z0 = v.z - half;
    const z1 = v.z + half;
    const axw = v.x;
    const azw = v.z;
    /**
     * Face perpendicular to X at x = fx (sign ±1): continues side (sign>0 ? 1 : 0) of an adjacent 'v' arm
     * (they share that plane) unless the face is covered by an X arm.
     */
    const xFace = (fx: number, sign: 1 | -1, covered: boolean) => {
      c.length = 0;
      c.push(fx, 0, z0, fx, 0, z1, fx, H, z1, fx, H, z0);
      const armIdx = v.pz >= 0 ? v.pz : v.nz;
      if (!covered && armIdx >= 0) {
        const sg = segments[armIdx];
        const side: 0 | 1 = sign > 0 ? 1 : 0;
        const cell = cells[paints[armIdx][side]] ?? cells[0];
        const base = sg.edge.z;
        const mir = sideMirrored('v', side);
        const du = cell.u1 - cell.u0;
        const u0 = cell.u0 + (mir ? 1 - (z0 - base) : z0 - base) * du;
        const u1 = cell.u0 + (mir ? 1 - (z1 - base) : z1 - base) * du;
        const vScale = (cell.v1 - cell.v0) / H;
        soup.quad(c, [sign, 0, 0], [u0, cell.v0, u1, cell.v0, u1, cell.v0 + H * vScale, u0, cell.v0 + H * vScale], slot, 0, cell.v0, vScale, axw, azw);
      } else {
        soup.quad(c, [sign, 0, 0], [trimUV[0], trimUV[1], trimUV[0], trimUV[1], trimUV[0], trimUV[1], trimUV[0], trimUV[1]], slot, 0, 0, 0, axw, azw);
      }
    };
    const zFace = (fz: number, sign: 1 | -1, covered: boolean) => {
      c.length = 0;
      c.push(x0, 0, fz, x1, 0, fz, x1, H, fz, x0, H, fz);
      const armIdx = v.px >= 0 ? v.px : v.nx;
      if (!covered && armIdx >= 0) {
        const sg = segments[armIdx];
        const side: 0 | 1 = sign > 0 ? 1 : 0;
        const cell = cells[paints[armIdx][side]] ?? cells[0];
        const base = sg.edge.x;
        const mir = sideMirrored('h', side);
        const du = cell.u1 - cell.u0;
        const u0 = cell.u0 + (mir ? 1 - (x0 - base) : x0 - base) * du;
        const u1 = cell.u0 + (mir ? 1 - (x1 - base) : x1 - base) * du;
        const vScale = (cell.v1 - cell.v0) / H;
        soup.quad(c, [0, 0, sign], [u0, cell.v0, u1, cell.v0, u1, cell.v0 + H * vScale, u0, cell.v0 + H * vScale], slot, 0, cell.v0, vScale, axw, azw);
      } else {
        soup.quad(c, [0, 0, sign], [trimUV[0], trimUV[1], trimUV[0], trimUV[1], trimUV[0], trimUV[1], trimUV[0], trimUV[1]], slot, 0, 0, 0, axw, azw);
      }
    };
    xFace(x1, 1, v.px >= 0);
    xFace(x0, -1, v.nx >= 0);
    zFace(z1, 1, v.pz >= 0);
    zFace(z0, -1, v.nz >= 0);
    c.length = 0;
    c.push(x0, H, z0, x1, H, z0, x1, H, z1, x0, H, z1);
    soup.quad(c, [0, 1, 0], [capUV[0], capUV[1], capUV[0], capUV[1], capUV[0], capUV[1], capUV[0], capUV[1]], slot, 0, 0, 0, axw, azw);
  }

  const vc = soup.pos.length / 3;
  return {
    vertexCount: vc,
    positions: new Float32Array(soup.pos),
    normals: new Float32Array(soup.nor),
    uvs: new Float32Array(soup.uv),
    indices: new Uint32Array(soup.idx),
    designY: new Float32Array(soup.dY),
    pieceBottom: new Float32Array(soup.pB),
    slotOf: new Uint32Array(soup.slot),
    vBase: new Float32Array(soup.vb),
    vScale: new Float32Array(soup.vs),
    anchorX: new Float32Array(soup.ax),
    anchorZ: new Float32Array(soup.az),
    segments,
    posts,
    slotCount,
  };
}

/** Post heights follow their tallest arm. */
export function updatePostHeights(data: Pick<WallMeshData, 'posts'>, heights: Float32Array): void {
  for (const p of data.posts) {
    let h = 0;
    for (const a of p.arms) if (heights[a] > h) h = heights[a];
    heights[p.slot] = h;
  }
}

/**
 * Apply animated heights to a position/uv buffer pair (in place, allocation free).
 * Vertices of pieces whose bottom is at/above the height collapse onto their anchor.
 */
export function applyWallHeights(data: WallMeshData, heights: Float32Array, positions: Float32Array, uvs: Float32Array): void {
  const n = data.vertexCount;
  const dY = data.designY;
  const pB = data.pieceBottom;
  const so = data.slotOf;
  const vb = data.vBase;
  const vs = data.vScale;
  const ax = data.anchorX;
  const az = data.anchorZ;
  const src = data.positions;
  for (let i = 0; i < n; i++) {
    const h = heights[so[i]];
    const b = pB[i];
    const i3 = i * 3;
    if (b > 0 && h <= b + 0.02) {
      // collapse onto the piece anchor at the current wall height → zero-area triangles, tight bounds
      positions[i3] = ax[i];
      positions[i3 + 1] = h;
      positions[i3 + 2] = az[i];
      continue;
    }
    positions[i3] = src[i3];
    positions[i3 + 2] = src[i3 + 2];
    const y = dY[i] < h ? dY[i] : h;
    positions[i3 + 1] = y;
    const s = vs[i];
    if (s !== 0) uvs[i * 2 + 1] = vb[i] + y * s;
  }
}

export interface WallRayHit {
  segment: WallSegmentInfo;
  /** Ray parameter of the entry point (units of |d|). */
  t: number;
  /** The side of the wall the ray comes from. */
  side: 0 | 1;
}

/**
 * Nearest wall hit of a ray against every segment's current-height box (half depth = half the wall thickness plus a
 * small grab margin). Rays entering through a door/window gap pass through, so the room behind an open doorway
 * stays clickable. Pure; non-finite input or no hit → null.
 */
export function rayWalls(
  segments: readonly WallSegmentInfo[],
  heights: ArrayLike<number>,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  halfDepth: number = DIM.WALL_THICKNESS / 2 + 0.02,
): WallRayHit | null {
  if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite) || !Array.isArray(segments)) return null;
  const half = Number.isFinite(halfDepth) && halfDepth > 0 ? halfDepth : DIM.WALL_THICKNESS / 2;
  let best: WallRayHit | null = null;
  for (const s of segments) {
    if (!s || !s.edge) continue;
    const h = Number(heights[s.slot]);
    if (!(h > 0.01)) continue;
    const e = s.edge;
    const t =
      e.kind === 'h'
        ? rayAabb(ox, oy, oz, dx, dy, dz, e.x, 0, e.z - half, e.x + 1, h, e.z + half)
        : rayAabb(ox, oy, oz, dx, dy, dz, e.x - half, 0, e.z, e.x + half, h, e.z + 1);
    if (t === Infinity || (best && t >= best.t)) continue;
    const px = ox + dx * t;
    const py = oy + dy * t;
    const pz = oz + dz * t;
    const op = s.opening;
    if (op) {
      // entering through the gap (centred on the edge): the ray passes through the doorway / window
      // (a wall lowered below the gap top leaves the gap open to the box top: entering through the top passes too)
      const u = (e.kind === 'h' ? px - e.x : pz - e.z) - 0.5;
      const openToTop = op.top >= h - 1e-4;
      if (Math.abs(u) < op.width / 2 && py > op.bottom + 1e-6 && (openToTop || py < op.top - 1e-6)) continue;
    }
    const side: 0 | 1 = e.kind === 'h' ? (oz > e.z || pz > e.z ? 1 : 0) : ox > e.x || px > e.x ? 1 : 0;
    best = { segment: s, t, side };
  }
  return best;
}
