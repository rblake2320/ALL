/**
 * Roofs and ceilings, part 1: WHICH tiles are under a roof. PURE (no three.js, no sim state): the footprint of every
 * building on a lot, from the room grid the sim already computes (`roomOf`: 0 = outdoors or open to the outdoors, 1..n =
 * an enclosed room; src/sim/spatial/rooms.ts, where doors and windows count as walls).
 *
 *  - A ceiling goes over every tile of an enclosed room and nowhere else: a room with a gap to the outside is room 0 and
 *    gets none, and open yard never does.
 *  - A building is a group of enclosed tiles that touch each other (4-neighbour, walls ignored): the rooms of one house.
 *    Two houses are separate buildings when a tile of outdoors lies between them.
 *  - Ids are stable for a given grid: buildings are ordered by their lowest tile index.
 */
export interface Building {
  id: number;
  /** Tile indices (z * width + x), ascending. */
  cells: number[];
  /** The enclosed room ids inside it, ascending. */
  rooms: number[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Every tile of its bounding box is part of it (a plain rectangle: it can take a pitched roof). */
  rect: boolean;
  /** Storeys. Always 1 today (the sim has no storeys yet); the roof sits on the top one and ceilings are per level. */
  levels: number;
}

export function findBuildings(width: number, depth: number, roomOf: ArrayLike<number>): Building[] {
  const w = Math.max(0, Math.floor(width));
  const d = Math.max(0, Math.floor(depth));
  const n = w * d;
  const seen = new Uint8Array(n);
  const indoor = (i: number): boolean => i >= 0 && i < n && (roomOf[i] as number) > 0;
  const out: Building[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || !indoor(start)) continue;
    const cells: number[] = [];
    const rooms = new Set<number>();
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      cells.push(i);
      rooms.add(roomOf[i] as number);
      const x = i % w;
      const z = (i - x) / w;
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, z > 0 ? i - w : -1, z < d - 1 ? i + w : -1];
      for (const j of next) {
        if (j >= 0 && !seen[j] && indoor(j)) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    cells.sort((a, b) => a - b);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const i of cells) {
      const x = i % w;
      const z = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    out.push({ id: out.length, cells, rooms: [...rooms].sort((a, b) => a - b), minX, maxX, minZ, maxZ, rect: cells.length === (maxX - minX + 1) * (maxZ - minZ + 1), levels: 1 });
  }
  return out;
}

/** Which building a tile (or a world point) is in, or -1 for outdoors. */
export function buildingAt(buildings: readonly Building[], width: number, x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return -1;
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (tx < 0 || tz < 0 || tx >= width) return -1;
  const i = tz * Math.floor(width) + tx;
  for (const b of buildings) if (tx >= b.minX && tx <= b.maxX && tz >= b.minZ && tz <= b.maxZ && binarySearch(b.cells, i)) return b.id;
  return -1;
}

function binarySearch(a: readonly number[], v: number): boolean {
  let lo = 0;
  let hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] === v) return true;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

export interface BoundaryEdge {
  /** Directed along the outline with the building on the right-hand side (x to the right, z down): x0,z0 -> x1,z1 on tile corners. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Outward unit normal in the x/z plane. */
  nx: number;
  nz: number;
}

/** The outline of a building: every tile edge that has no tile of the same building on its other side. Deterministic order. */
export function boundaryEdges(b: Building, width: number): BoundaryEdge[] {
  const w = Math.floor(width);
  const has = new Set(b.cells);
  const out: BoundaryEdge[] = [];
  for (const i of b.cells) {
    const x = i % w;
    const z = (i - x) / w;
    if (!has.has(i - w) || z === 0) out.push({ x0: x, z0: z, x1: x + 1, z1: z, nx: 0, nz: -1 }); // north edge
    if (x === w - 1 || !has.has(i + 1)) out.push({ x0: x + 1, z0: z, x1: x + 1, z1: z + 1, nx: 1, nz: 0 }); // east
    if (!has.has(i + w)) out.push({ x0: x + 1, z0: z + 1, x1: x, z1: z + 1, nx: 0, nz: 1 }); // south
    if (x === 0 || !has.has(i - 1)) out.push({ x0: x, z0: z + 1, x1: x, z1: z, nx: -1, nz: 0 }); // west
  }
  return out;
}
