/**
 * Roofs and ceilings, part 2: the GEOMETRY, as plain arrays (no three.js), so it is testable and cheap to turn into one
 * BufferGeometry per building:
 *   - ONE merged ceiling mesh per building: a quad per tile of every enclosed room, facing down, tinted by the room's wall
 *     style (plain plaster; beams only on the High quality tier);
 *   - ONE roof mesh per building: a low-pitched gable over a plain rectangle, a flat slab with a low rim over any other
 *     footprint (L-shapes, courtyards); dark shingle from the existing palette, no textures. E10+.
 * Coordinates are world metres on the lot grid (x right, z down, y up); a tile (x, z) covers [x, x+1] x [z, z+1].
 */
import { boundaryEdges, type Building } from './footprint';

export interface MeshArrays {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

export type Rgb = readonly [number, number, number];

export const ROOF = Object.freeze({
  /** Gable rise above the eaves (m): low-pitched, so the roof stays a calm shape. */
  pitch: 0.55,
  /** Eave overhang past the walls (m). */
  overhang: 0.2,
  /** Flat roof thickness and rim height above the wall top (m). */
  slab: 0.22,
  rim: 0.14,
  /** Ceiling sits a hair under the wall top so it never z-fights the roof slab. */
  ceilingDrop: 0.02,
  /** Beam spacing (tiles) and size (m) on High. */
  beamEvery: 1,
  beamW: 0.14,
  beamH: 0.16,
});

export const SHINGLE: Rgb = [0.227, 0.204, 0.251]; // #3a3440 (the palette's shingle)
export const SHINGLE_RIM: Rgb = [0.165, 0.149, 0.188];
export const BEAM: Rgb = [0.231, 0.165, 0.133]; // #3b2a22 (wood_ebony)

const empty = (): MeshArrays => ({ positions: [], normals: [], colors: [], indices: [] });

function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
}

const shade = (c: Rgb, k: number): Rgb => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

type V3 = readonly [number, number, number];

/** Does the triangle (a, b, c) wind counter-clockwise as seen from the side the normal `n` points to? */
function facesAlong(a: V3, b: V3, c: V3, n: V3): boolean {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] >= 0;
}

/** Add a quad p0..p3 (any winding: the indices are ordered so the face looks along the normal `n`). */
function quad(m: MeshArrays, p: readonly V3[], n: V3, c: Rgb): void {
  const base = m.positions.length / 3;
  for (const v of p) {
    m.positions.push(v[0], v[1], v[2]);
    m.normals.push(n[0], n[1], n[2]);
    m.colors.push(c[0], c[1], c[2]);
  }
  if (facesAlong(p[0], p[1], p[2], n)) m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else m.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

function tri(m: MeshArrays, p: readonly V3[], n: V3, c: Rgb): void {
  const base = m.positions.length / 3;
  for (const v of p) {
    m.positions.push(v[0], v[1], v[2]);
    m.normals.push(n[0], n[1], n[2]);
    m.colors.push(c[0], c[1], c[2]);
  }
  if (facesAlong(p[0], p[1], p[2], n)) m.indices.push(base, base + 1, base + 2);
  else m.indices.push(base, base + 2, base + 1);
}

/**
 * The ceiling of one building: a downward-facing quad per tile, coloured by that tile's room. `beams` adds a dark beam
 * across every tile row (High only). The wall height is where the ceiling sits (a hair below).
 */
export function buildCeilingArrays(b: Building, width: number, roomOf: ArrayLike<number>, wallHeight: number, colorOf: (room: number) => Rgb, beams = false, level = 0): MeshArrays {
  const m = empty();
  const w = Math.floor(width);
  const y = wallHeight * (level + 1) - ROOF.ceilingDrop; // the ceiling of level L is the top of storey L
  for (const i of b.cells) {
    const x = i % w;
    const z = (i - x) / w;
    const c = colorOf(roomOf[i] as number);
    // seen from below, counter-clockwise: (x,z) -> (x+1,z) -> (x+1,z+1) -> (x,z+1) has a downward normal
    quad(m, [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]], [0, -1, 0], c);
    if (beams && (x - b.minX) % ROOF.beamEvery === 0) {
      const bw = ROOF.beamW;
      const bh = ROOF.beamH;
      const cx = x + 0.5;
      const yb = y - 0.001;
      // a beam across the tile along z: its underside and two sides
      quad(m, [[cx - bw / 2, yb - bh, z], [cx + bw / 2, yb - bh, z], [cx + bw / 2, yb - bh, z + 1], [cx - bw / 2, yb - bh, z + 1]], [0, -1, 0], BEAM);
      quad(m, [[cx - bw / 2, yb, z + 1], [cx - bw / 2, yb - bh, z + 1], [cx - bw / 2, yb - bh, z], [cx - bw / 2, yb, z]], [-1, 0, 0], BEAM);
      quad(m, [[cx + bw / 2, yb, z], [cx + bw / 2, yb - bh, z], [cx + bw / 2, yb - bh, z + 1], [cx + bw / 2, yb, z + 1]], [1, 0, 0], BEAM);
    }
  }
  return m;
}

/** The roof of one building. Rectangles get a low gable along the longer side; every other footprint a flat slab with a rim. */
export function buildRoofArrays(b: Building, width: number, wallHeight: number): MeshArrays {
  const top = wallHeight * Math.max(1, b.levels); // the roof sits on the TOP level
  return b.rect ? gable(b, top) : flat(b, width, top);
}

function gable(b: Building, h: number): MeshArrays {
  const m = empty();
  const o = ROOF.overhang;
  const x0 = b.minX - o;
  const x1 = b.maxX + 1 + o;
  const z0 = b.minZ - o;
  const z1 = b.maxZ + 1 + o;
  const ridgeY = h + ROOF.pitch;
  const eaveY = h - 0.04;
  const ridgeAlongX = x1 - x0 >= z1 - z0;
  const k = (s: number) => 0.92 + 0.16 * hash01(b.id * 31 + s, b.cells.length);
  if (ridgeAlongX) {
    const zm = (z0 + z1) / 2;
    const rise = ROOF.pitch / ((z1 - z0) / 2);
    // north slope (faces up and toward -z), south slope (up and +z)
    quad(m, [[x0, eaveY, z0], [x1, eaveY, z0], [x1, ridgeY, zm], [x0, ridgeY, zm]], norm(0, 1, -rise), shade(SHINGLE, k(1)));
    quad(m, [[x0, ridgeY, zm], [x1, ridgeY, zm], [x1, eaveY, z1], [x0, eaveY, z1]], norm(0, 1, rise), shade(SHINGLE, k(2)));
    // gable ends (triangles at x0 and x1)
    tri(m, [[x0, eaveY, z1], [x0, ridgeY, zm], [x0, eaveY, z0]], [-1, 0, 0], shade(SHINGLE_RIM, k(3)));
    tri(m, [[x1, eaveY, z0], [x1, ridgeY, zm], [x1, eaveY, z1]], [1, 0, 0], shade(SHINGLE_RIM, k(4)));
  } else {
    const xm = (x0 + x1) / 2;
    const rise = ROOF.pitch / ((x1 - x0) / 2);
    quad(m, [[x0, eaveY, z1], [x0, eaveY, z0], [xm, ridgeY, z0], [xm, ridgeY, z1]], norm(-rise, 1, 0), shade(SHINGLE, k(1)));
    quad(m, [[xm, ridgeY, z1], [xm, ridgeY, z0], [x1, eaveY, z0], [x1, eaveY, z1]], norm(rise, 1, 0), shade(SHINGLE, k(2)));
    tri(m, [[x0, eaveY, z0], [xm, ridgeY, z0], [x1, eaveY, z0]], [0, 0, -1], shade(SHINGLE_RIM, k(3)));
    tri(m, [[x1, eaveY, z1], [xm, ridgeY, z1], [x0, eaveY, z1]], [0, 0, 1], shade(SHINGLE_RIM, k(4)));
  }
  return m;
}

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function flat(b: Building, width: number, h: number): MeshArrays {
  const m = empty();
  const w = Math.floor(width);
  const top = h + ROOF.slab;
  for (const i of b.cells) {
    const x = i % w;
    const z = (i - x) / w;
    const c = shade(SHINGLE, 0.94 + 0.12 * hash01(x * 131 + b.id, z));
    // up-facing: the reverse of the ceiling's winding
    quad(m, [[x, top, z], [x, top, z + 1], [x + 1, top, z + 1], [x + 1, top, z]], [0, 1, 0], c);
  }
  // skirt down to the wall top and a low rim above the slab, along every boundary edge
  const rimTop = top + ROOF.rim;
  for (const e of boundaryEdges(b, width)) {
    const n: [number, number, number] = [e.nx, 0, e.nz];
    const c = shade(SHINGLE_RIM, 0.95 + 0.1 * hash01(Math.round(e.x0 * 7 + e.z0 * 13), b.id));
    quad(m, [[e.x0, h, e.z0], [e.x1, h, e.z1], [e.x1, top, e.z1], [e.x0, top, e.z0]], n, c);
    // rim: outer face
    quad(m, [[e.x0, top, e.z0], [e.x1, top, e.z1], [e.x1, rimTop, e.z1], [e.x0, rimTop, e.z0]], n, c);
    // rim: top edge, a thin strip
    const t = 0.06;
    const ox = -e.nx * t;
    const oz = -e.nz * t;
    quad(m, [[e.x0, rimTop, e.z0], [e.x1, rimTop, e.z1], [e.x1 + ox, rimTop, e.z1 + oz], [e.x0 + ox, rimTop, e.z0 + oz]], [0, 1, 0], c);
  }
  return m;
}

/** Counts for tests and the draw-count report. */
export const triangles = (m: MeshArrays): number => m.indices.length / 3;
