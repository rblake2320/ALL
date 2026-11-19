/**
 * TEST FIXTURE — a small but faithful SpatialAPI (open grid + wall edges + doors + catalog footprints/slots),
 * a minimal BuildService and a lot template, so engine tests never depend on the parallel SIM-SPATIAL module.
 * Production code always uses src/sim/spatial (createSpatial / createBuildService / createLotTemplate).
 */
import type {
  BuildCommand,
  BuildService,
  ContentRegistry,
  DistanceField,
  LotTemplate,
  PlacementResult,
  ResolvedSlot,
  SimContext,
  SpatialAPI,
} from '../../contracts';
import type { LotState, ObjectPlacement, ObjectState, Vec2, WorldState } from '../../types';
import { localToWorld, normalizeAngle, rotYaw, rotatedSize, dirToFacing } from '../../../shared/dimensions';
import type { Rot } from '../../../shared/dimensions';

const SQRT2 = Math.SQRT2;
const DIRS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

interface Grid {
  key: string;
  blocked: Uint8Array;
  /** Per tile: bit0 wall on -Z edge, bit1 +Z, bit2 -X, bit3 +X (doors don't block). */
  walls: Uint8Array;
  /** Per tile: bit k set when the step in direction DIRS[k] is allowed. */
  nbr: Uint8Array;
  room: Int32Array;
  rooms: { id: number; indoor: boolean; tiles: number[] }[];
}

/** Wall present on an edge and not a door. */
function wallBlocks(lot: LotState, state: WorldState, key: string): boolean {
  const seg = lot.walls[key];
  if (!seg) return false;
  if (seg.openingId) {
    const o = state.objects[seg.openingId];
    if (o && o.defId.startsWith('door')) return false;
  }
  return true;
}

function wallExists(lot: LotState, key: string): boolean {
  return !!lot.walls[key];
}

/** Edge between orthogonally adjacent tiles. */
function edgeBetweenTiles(ax: number, az: number, bx: number, bz: number): string | null {
  if (ax === bx && Math.abs(az - bz) === 1) return `h:${ax}:${Math.max(az, bz)}`;
  if (az === bz && Math.abs(ax - bx) === 1) return `v:${Math.max(ax, bx)}:${az}`;
  return null;
}

export function floorFootprintTiles(def: { footprint: { w: number; d: number } }, p: { x: number; z: number; rot: Rot }): { x: number; z: number }[] {
  const { w, d } = rotatedSize(def.footprint.w, def.footprint.d, p.rot);
  const out: { x: number; z: number }[] = [];
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) out.push({ x: p.x + x, z: p.z + z });
  return out;
}

export function createFixtureSpatial(getState: () => WorldState, content: ContentRegistry): SpatialAPI {
  let grid: Grid | null = null;
  const dfCache = new Map<string, DistanceField>();
  let heapC = new Float64Array(0);
  let heapI = new Int32Array(0);
  let aG = new Float64Array(0);
  let aParent = new Int32Array(0);
  let aStamp = new Uint32Array(0);
  let aClosed = new Uint32Array(0);
  let aGen = 0;

  const lot = () => getState().lot;
  const W = () => lot().width;
  const D = () => lot().depth;
  const inBounds = (x: number, z: number) => Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < W() && z < D();
  const idx = (x: number, z: number) => z * W() + x;

  let keyTick = -1;
  let keyVersion = -1;
  let keyCache = '';
  function gridKey(): string {
    const s = getState();
    if (s.tick === keyTick && s.lot.version === keyVersion && keyCache) return keyCache;
    let n = 0;
    for (const _k in s.objects) n++;
    keyTick = s.tick;
    keyVersion = s.lot.version;
    keyCache = `${s.lot.version}:${s.lot.width}x${s.lot.depth}:${n}`;
    return keyCache;
  }

  function build(): Grid {
    const key = gridKey();
    if (grid && grid.key === key) return grid;
    const s = getState();
    const n = W() * D();
    const blocked = new Uint8Array(n);
    for (const o of Object.values(s.objects)) {
      const def = content.objects[o.defId];
      if (!def) continue;
      if (o.placement.kind === 'floor') {
        if (def.passable || def.layer === 'rug') continue;
        for (const t of floorFootprintTiles(def, o.placement)) if (inBounds(t.x, t.z)) blocked[idx(t.x, t.z)] = 1;
      } else if (o.placement.kind === 'loose' && def.passable === false) {
        const tx = Math.floor(o.placement.x);
        const tz = Math.floor(o.placement.z);
        if (inBounds(tx, tz)) blocked[idx(tx, tz)] = 1;
      }
    }
    // rooms: flood fill through edges without walls (doors still separate rooms)
    const room = new Int32Array(n).fill(-1);
    const rooms: Grid['rooms'] = [];
    let next = 1;
    for (let start = 0; start < n; start++) {
      if (room[start] !== -1) continue;
      const tiles: number[] = [];
      const stack = [start];
      room[start] = -2;
      let touchesBorder = false;
      while (stack.length) {
        const t = stack.pop()!;
        tiles.push(t);
        const x = t % W();
        const z = Math.floor(t / W());
        if (x === 0 || z === 0 || x === W() - 1 || z === D() - 1) touchesBorder = true;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (!inBounds(nx, nz)) continue;
          const ni = idx(nx, nz);
          if (room[ni] !== -1) continue;
          const e = edgeBetweenTiles(x, z, nx, nz);
          if (e && wallExists(s.lot, e)) continue;
          room[ni] = -2;
          stack.push(ni);
        }
      }
      const id = touchesBorder ? 0 : next++;
      for (const t of tiles) room[t] = id;
      if (id !== 0) rooms.push({ id, indoor: true, tiles });
      else {
        const out = rooms.find((r) => r.id === 0);
        if (out) out.tiles.push(...tiles);
        else rooms.push({ id: 0, indoor: false, tiles });
      }
    }
    const walls = new Uint8Array(n);
    for (const k of Object.keys(s.lot.walls)) {
      if (!wallBlocks(s.lot, s, k)) continue;
      const [kind, xs, zs] = k.split(':');
      const x = Number(xs);
      const z = Number(zs);
      if (kind === 'h') {
        if (inBounds(x, z)) walls[idx(x, z)] |= 1; // -Z side of (x,z)
        if (inBounds(x, z - 1)) walls[idx(x, z - 1)] |= 2; // +Z side of (x,z-1)
      } else {
        if (inBounds(x, z)) walls[idx(x, z)] |= 4; // -X side of (x,z)
        if (inBounds(x - 1, z)) walls[idx(x - 1, z)] |= 8; // +X side of (x-1,z)
      }
    }
    const g0: Grid = { key, blocked, walls, nbr: new Uint8Array(n), room, rooms };
    const w = W();
    const d = D();
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let k = 0; k < 8; k++) if (stepOn(g0, x, z, x + DIRS[k][0], z + DIRS[k][1], w, d)) m |= 1 << k;
        g0.nbr[z * w + x] = m;
      }
    }
    grid = g0;
    dfCache.clear();
    return grid;
  }

  const isWalkable = (x: number, z: number) => inBounds(x, z) && build().blocked[idx(x, z)] === 0;

  /** Fast step test against a prepared grid (no key checks). */
  function orthoOn(g: Grid, w: number, ax: number, az: number, bx: number, bz: number): boolean {
    if (g.blocked[bz * w + bx]) return false;
    const m = g.walls[az * w + ax];
    if (bz < az) return (m & 1) === 0;
    if (bz > az) return (m & 2) === 0;
    if (bx < ax) return (m & 4) === 0;
    return (m & 8) === 0;
  }

  function stepOn(g: Grid, fx: number, fz: number, tx: number, tz: number, w = W(), d = D()): boolean {
    if (tx < 0 || tz < 0 || tx >= w || tz >= d || fx < 0 || fz < 0 || fx >= w || fz >= d) return false;
    if (g.blocked[tz * w + tx]) return false;
    const dx = tx - fx;
    const dz = tz - fz;
    if (dx < -1 || dx > 1 || dz < -1 || dz > 1 || (dx === 0 && dz === 0)) return false;
    if (dx === 0 || dz === 0) return orthoOn(g, w, fx, fz, tx, tz);
    return orthoOn(g, w, fx, fz, tx, fz) && orthoOn(g, w, tx, fz, tx, tz) && orthoOn(g, w, fx, fz, fx, tz) && orthoOn(g, w, fx, tz, tx, tz);
  }

  function canStep(fx: number, fz: number, tx: number, tz: number): boolean {
    if (!Number.isInteger(fx) || !Number.isInteger(fz) || !Number.isInteger(tx) || !Number.isInteger(tz)) return false;
    if (!inBounds(fx, fz)) return false;
    const dx = tx - fx;
    const dz = tz - fz;
    for (let k = 0; k < 8; k++) if (DIRS[k][0] === dx && DIRS[k][1] === dz) return (build().nbr[idx(fx, fz)] & (1 << k)) !== 0;
    return false;
  }

  const tileOf = (p: Vec2) => ({ x: Math.floor(p.x), z: Math.floor(p.z) });

  function distanceField(from: Vec2): DistanceField {
    const g = build();
    const t0 = tileOf(from);
    const ox = Math.min(W() - 1, Math.max(0, t0.x));
    const oz = Math.min(D() - 1, Math.max(0, t0.z));
    const key = `${g.key}|${ox},${oz}`;
    const hit = dfCache.get(key);
    if (hit) return hit;
    const n = W() * D();
    const dist = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const origin = idx(ox, oz);
    dist[origin] = 0;
    // binary min-heap on typed arrays (lazy deletion); scratch buffers are reused across calls
    const w = W();
    const d = D();
    if (heapC.length < n * 8 + 16) {
      heapC = new Float64Array(n * 8 + 16);
      heapI = new Int32Array(n * 8 + 16);
    }
    let cap = heapC.length;
    let hc = heapC;
    let hi = heapI;
    let size = 0;
    const push = (c: number, i: number) => {
      if (size >= cap) {
        cap *= 2;
        const nc = new Float64Array(cap);
        nc.set(hc);
        hc = nc;
        const ni = new Int32Array(cap);
        ni.set(hi);
        hi = ni;
        heapC = hc;
        heapI = hi;
      }
      let k = size++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (hc[p] <= c) break;
        hc[k] = hc[p];
        hi[k] = hi[p];
        k = p;
      }
      hc[k] = c;
      hi[k] = i;
    };
    push(0, origin);
    while (size > 0) {
      const cc = hc[0];
      const ci = hi[0];
      size--;
      if (size > 0) {
        const lc = hc[size];
        const li = hi[size];
        let k = 0;
        for (;;) {
          const l = k * 2 + 1;
          if (l >= size) break;
          const r = l + 1;
          const m = r < size && hc[r] < hc[l] ? r : l;
          if (hc[m] >= lc) break;
          hc[k] = hc[m];
          hi[k] = hi[m];
          k = m;
        }
        hc[k] = lc;
        hi[k] = li;
      }
      if (cc > dist[ci] + 1e-5) continue; // dist is Float32: compare with tolerance
      const x = ci % w;
      const z = (ci - x) / w;
      const m = g.nbr[ci];
      for (let k = 0; k < 8; k++) {
        if ((m & (1 << k)) === 0) continue;
        const dx = DIRS[k][0];
        const dz = DIRS[k][1];
        const ni = (z + dz) * w + (x + dx);
        const nc = cc + (dx !== 0 && dz !== 0 ? SQRT2 : 1);
        if (nc < dist[ni] - 1e-5) {
          dist[ni] = nc;
          parent[ni] = ci;
          push(nc, ni);
        }
      }
    }
    const df: DistanceField = { dist, parent, originIndex: origin, version: lot().version };
    if (dfCache.size > 64) dfCache.clear();
    dfCache.set(key, df);
    return df;
  }

  /** A* with an octile heuristic on the prepared grid (tile-centre waypoints, origin excluded). */
  function findPath(from: Vec2, to: { x: number; z: number }): Vec2[] | null {
    if (!inBounds(to.x, to.z) || !isWalkable(to.x, to.z)) return null;
    const g = build();
    const w = W();
    const d = D();
    const t0 = tileOf(from);
    const ox = Math.min(w - 1, Math.max(0, t0.x));
    const oz = Math.min(d - 1, Math.max(0, t0.z));
    const origin = oz * w + ox;
    const goal = to.z * w + to.x;
    if (origin === goal) return [{ x: to.x + 0.5, z: to.z + 0.5 }];
    const n = w * d;
    if (aG.length < n) {
      aG = new Float64Array(n);
      aParent = new Int32Array(n);
      aStamp = new Uint32Array(n);
      aClosed = new Uint32Array(n);
      aGen = 0;
    }
    aGen++;
    const gen = aGen;
    const gOf = (i: number) => (aStamp[i] === gen ? aG[i] : Infinity);
    const hcost = (i: number) => {
      const x = i % w;
      const z = (i - x) / w;
      const dx = Math.abs(x - to.x);
      const dz = Math.abs(z - to.z);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    if (heapC.length < n * 8 + 16) {
      heapC = new Float64Array(n * 8 + 16);
      heapI = new Int32Array(n * 8 + 16);
    }
    let size = 0;
    const push = (f: number, i: number) => {
      if (size >= heapC.length) {
        const nc = new Float64Array(heapC.length * 2);
        nc.set(heapC);
        heapC = nc;
        const ni = new Int32Array(heapI.length * 2);
        ni.set(heapI);
        heapI = ni;
      }
      let k = size++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heapC[p] <= f) break;
        heapC[k] = heapC[p];
        heapI[k] = heapI[p];
        k = p;
      }
      heapC[k] = f;
      heapI[k] = i;
    };
    const pop = (): number => {
      const top = heapI[0];
      size--;
      if (size > 0) {
        const lc = heapC[size];
        const li = heapI[size];
        let k = 0;
        for (;;) {
          const l = k * 2 + 1;
          if (l >= size) break;
          const r = l + 1;
          const m = r < size && heapC[r] < heapC[l] ? r : l;
          if (heapC[m] >= lc) break;
          heapC[k] = heapC[m];
          heapI[k] = heapI[m];
          k = m;
        }
        heapC[k] = lc;
        heapI[k] = li;
      }
      return top;
    };
    aG[origin] = 0;
    aStamp[origin] = gen;
    aParent[origin] = -1;
    push(hcost(origin), origin);
    let found = false;
    while (size > 0) {
      const i = pop();
      if (aClosed[i] === gen) continue;
      aClosed[i] = gen;
      if (i === goal) {
        found = true;
        break;
      }
      const x = i % w;
      const z = (i - x) / w;
      const m = g.nbr[i];
      const gi = gOf(i);
      for (let k = 0; k < 8; k++) {
        if ((m & (1 << k)) === 0) continue;
        const dx = DIRS[k][0];
        const dz = DIRS[k][1];
        const ni = (z + dz) * w + (x + dx);
        if (aClosed[ni] === gen) continue;
        const ng = gi + (dx !== 0 && dz !== 0 ? SQRT2 : 1);
        if (ng < gOf(ni) - 1e-9) {
          aG[ni] = ng;
          aStamp[ni] = gen;
          aParent[ni] = i;
          push(ng + hcost(ni), ni);
        }
      }
    }
    if (!found) return null;
    const tiles: number[] = [];
    let cur = goal;
    let guard = n;
    while (cur !== -1 && cur !== origin && guard-- > 0) {
      tiles.push(cur);
      cur = aParent[cur];
    }
    tiles.reverse();
    return tiles.map((i) => ({ x: (i % w) + 0.5, z: Math.floor(i / w) + 0.5 }));
  }

  function nearestWalkable(p: Vec2, maxRadius = 10): { x: number; z: number } | null {
    const t = tileOf(p);
    const cx = Math.min(W() - 1, Math.max(0, Number.isFinite(t.x) ? t.x : 0));
    const cz = Math.min(D() - 1, Math.max(0, Number.isFinite(t.z) ? t.z : 0));
    for (let r = 0; r <= maxRadius; r++) {
      let best: { x: number; z: number; d: number } | null = null;
      for (let z = cz - r; z <= cz + r; z++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
          if (!isWalkable(x, z)) continue;
          const d = (x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2;
          if (!best || d < best.d) best = { x, z, d };
        }
      }
      if (best) return { x: best.x, z: best.z };
    }
    return null;
  }

  function frameOf(obj: ObjectState): { ox: number; oz: number; rot: Rot; w: number; d: number } | null {
    const def = content.objects[obj.defId];
    if (!def) return null;
    const p = obj.placement;
    if (p.kind === 'floor') return { ox: p.x, oz: p.z, rot: p.rot, w: def.footprint.w, d: def.footprint.d };
    if (p.kind === 'loose') return { ox: Math.floor(p.x), oz: Math.floor(p.z), rot: 0, w: 1, d: 1 };
    if (p.kind === 'wall') {
      const [k, xs, zs] = p.edge.split(':');
      const x = Number(xs);
      const z = Number(zs);
      if (k === 'h') return p.side === 1 ? { ox: x, oz: z, rot: 0, w: 1, d: 1 } : { ox: x, oz: z - 1, rot: 2, w: 1, d: 1 };
      return p.side === 1 ? { ox: x, oz: z, rot: 3, w: 1, d: 1 } : { ox: x - 1, oz: z, rot: 1, w: 1, d: 1 };
    }
    return null;
  }

  function objectCenter(obj: ObjectState): Vec2 {
    const p = obj.placement;
    if (p.kind === 'loose') return { x: p.x, z: p.z };
    if (p.kind === 'held') {
      const a = getState().agents[p.agentId];
      return a ? { x: a.pos.x, z: a.pos.z } : { x: 0, z: 0 };
    }
    if (p.kind === 'opening' || p.kind === 'wall') {
      const [k, xs, zs] = p.edge.split(':');
      const x = Number(xs);
      const z = Number(zs);
      const c = k === 'h' ? { x: x + 0.5, z } : { x, z: z + 0.5 };
      if (p.kind === 'wall') {
        if (k === 'h') c.z += p.side === 1 ? 0.1 : -0.1;
        else c.x += p.side === 1 ? 0.1 : -0.1;
      }
      return c;
    }
    const def = content.objects[obj.defId];
    const { w, d } = rotatedSize(def ? def.footprint.w : 1, def ? def.footprint.d : 1, p.rot);
    return { x: p.x + w / 2, z: p.z + d / 2 };
  }

  function resolveSlots(obj: ObjectState): ResolvedSlot[] {
    const def = content.objects[obj.defId];
    const f = frameOf(obj);
    if (!def || !f) return [];
    const out: ResolvedSlot[] = [];
    def.slots.forEach((s, index) => {
      const approach: { x: number; z: number }[] = [];
      for (const a of s.approach) {
        const wpt = localToWorld(f.w, f.d, f.ox, f.oz, f.rot, a.x + 0.5, a.z + 0.5);
        const t = { x: Math.floor(wpt.x), z: Math.floor(wpt.z) };
        if (inBounds(t.x, t.z)) approach.push(t);
      }
      let pose: ResolvedSlot['pose'];
      if (s.faceObject || !s.pose) {
        const c = objectCenter(obj);
        const t = approach[0] ?? tileOf(c);
        const tc = { x: t.x + 0.5, z: t.z + 0.5 };
        const dx = c.x - tc.x;
        const dz = c.z - tc.z;
        const len = Math.hypot(dx, dz) || 1;
        pose = { x: tc.x + (dx / len) * 0.28, z: tc.z + (dz / len) * 0.28, y: 0, facing: dirToFacing(dx, dz) };
      } else {
        const wp = localToWorld(f.w, f.d, f.ox, f.oz, f.rot, s.pose.x, s.pose.z);
        pose = { x: wp.x, z: wp.z, y: s.pose.y, facing: normalizeAngle((s.facing ?? 0) + rotYaw(f.rot)) };
      }
      out.push({ index, id: s.id, kind: s.kind, approach, pose });
    });
    return out;
  }

  function surfacePoints(obj: ObjectState): { index: number; x: number; y: number; z: number }[] {
    const def = content.objects[obj.defId];
    const f = frameOf(obj);
    if (!def || !f || !def.surfaces || obj.placement.kind !== 'floor') return [];
    return def.surfaces.map((s, index) => {
      const wp = localToWorld(f.w, f.d, f.ox, f.oz, f.rot, s.x, s.z);
      return { index, x: wp.x, y: s.y, z: wp.z };
    });
  }

  function freeSurfaceNear(p: Vec2, maxDist: number, preferObjectId?: ObjectId | null) {
    const s = getState();
    const occupied = new Set<string>();
    for (const o of Object.values(s.objects)) {
      if (o.placement.kind === 'loose' && o.placement.parentId) occupied.add(`${o.placement.parentId}#${o.placement.surfaceIndex}`);
    }
    let best: { objectId: string; index: number; x: number; y: number; z: number; d: number } | null = null;
    for (const o of Object.values(s.objects)) {
      for (const sp of surfacePoints(o)) {
        if (occupied.has(`${o.id}#${sp.index}`)) continue;
        const d = Math.hypot(sp.x - p.x, sp.z - p.z) - (preferObjectId && o.id === preferObjectId ? 1000 : 0);
        if (Math.hypot(sp.x - p.x, sp.z - p.z) > maxDist) continue;
        if (!best || d < best.d) best = { objectId: o.id, index: sp.index, x: sp.x, y: sp.y, z: sp.z, d };
      }
    }
    if (!best) return null;
    return { objectId: best.objectId, index: best.index, x: best.x, y: best.y, z: best.z };
  }

  function objectTiles(obj: ObjectState) {
    const def = content.objects[obj.defId];
    if (!def || obj.placement.kind !== 'floor') return [];
    return floorFootprintTiles(def, obj.placement);
  }

  function objectsAt(x: number, z: number): string[] {
    const out: string[] = [];
    for (const o of Object.values(getState().objects)) {
      const def = content.objects[o.defId];
      if (!def || o.placement.kind !== 'floor' || def.layer === 'rug') continue;
      if (floorFootprintTiles(def, o.placement).some((t) => t.x === x && t.z === z)) out.push(o.id);
    }
    return out;
  }

  function checkPlace(defId: string, x: number, z: number, rot: Rot, ignoreObjectId?: string | null): PlacementResult {
    const def = content.objects[defId];
    if (!def) return { ok: false, reason: 'Unknown object', tiles: [], blockedSlots: [], cost: 0 };
    const tiles = floorFootprintTiles(def, { x, z, rot });
    const b = lot().buildable;
    for (const t of tiles) {
      if (t.x < b.x0 || t.z < b.z0 || t.x >= b.x1 || t.z >= b.z1) return { ok: false, reason: 'Outside the lot', tiles, blockedSlots: [], cost: def.price };
      for (const id of objectsAt(t.x, t.z)) if (id !== ignoreObjectId) return { ok: false, reason: 'Something is in the way', tiles, blockedSlots: [], cost: def.price };
    }
    return { ok: true, tiles, blockedSlots: [], cost: def.price };
  }

  const api: SpatialAPI = {
    width: W,
    depth: D,
    inBounds,
    isBuildable: (x, z) => {
      const b = lot().buildable;
      return x >= b.x0 && z >= b.z0 && x < b.x1 && z < b.z1;
    },
    tileIndex: idx,
    tileOf,
    isWalkable,
    canStep,
    roomAt: (x, z) => (inBounds(x, z) ? Math.max(0, build().room[idx(x, z)]) : 0),
    rooms: () => build().rooms.map((r) => ({ ...r, tiles: r.tiles.slice() })),
    isIndoor: (x, z) => inBounds(x, z) && build().room[idx(x, z)] > 0,
    distanceField,
    findPath,
    nearestWalkable,
    objectTiles,
    objectsAt,
    resolveSlots,
    surfacePoints,
    freeSurfaceNear,
    objectCenter,
    roomEnvironment: (x, z) => {
      if (!inBounds(x, z)) return 0;
      const r = build().room[idx(x, z)];
      if (r <= 0) return 0;
      let env = 0;
      for (const o of Object.values(getState().objects)) {
        const c = objectCenter(o);
        const t = tileOf(c);
        if (inBounds(t.x, t.z) && build().room[idx(t.x, t.z)] === r) env += content.objects[o.defId]?.env ?? 0;
      }
      return Math.max(-10, Math.min(10, env));
    },
    checkPlace,
    checkWallItem: (defId) => ({ ok: !!content.objects[defId], tiles: [], blockedSlots: [], cost: content.objects[defId]?.price ?? 0 }),
    checkOpening: (defId) => ({ ok: !!content.objects[defId], tiles: [], blockedSlots: [], cost: content.objects[defId]?.price ?? 0 }),
    invalidate: () => {
      grid = null;
      dfCache.clear();
    },
  };
  return api;
}

type ObjectId = string;

/** Minimal build service: buy / sell / addWalls / removeWalls with exact undo/redo. */
export function createFixtureBuildService(ctx: SimContext): BuildService {
  type Op = { undo: () => void; redo: () => void };
  const undoStack: Op[] = [];
  const redoStack: Op[] = [];
  const bump = () => {
    ctx.state.lot.version++;
    ctx.state.lot.wallVersion++;
    ctx.spatial.invalidate();
  };
  function apply(cmd: BuildCommand): { ok: boolean; reason?: string; cost: number; objectId?: string } {
    switch (cmd.type) {
      case 'buy': {
        const def = ctx.content.objects[cmd.defId];
        if (!def || !def.buyable) return { ok: false, reason: 'Not for sale', cost: 0 };
        const chk = ctx.spatial.checkPlace(cmd.defId, cmd.x, cmd.z, cmd.rot);
        if (!chk.ok) return { ok: false, reason: chk.reason, cost: def.price };
        if (!ctx.spend(def.price, `Bought ${def.name}`)) return { ok: false, reason: 'Not enough money', cost: def.price };
        let obj = ctx.spawnObject(cmd.defId, { kind: 'floor', x: cmd.x, z: cmd.z, rot: cmd.rot }, { value: def.price, tint: cmd.tint ?? null });
        const placement: ObjectPlacement = { ...obj.placement };
        const op: Op = {
          undo: () => {
            ctx.removeObject(obj.id, 'undo');
            ctx.earn(def.price, 'Undo purchase');
          },
          redo: () => {
            ctx.spend(def.price, `Bought ${def.name}`);
            obj = ctx.spawnObject(cmd.defId, placement, { value: def.price });
          },
        };
        undoStack.push(op);
        redoStack.length = 0;
        return { ok: true, cost: def.price, objectId: obj.id };
      }
      case 'sell': {
        const o = ctx.object(cmd.objectId);
        if (!o) return { ok: false, reason: "It's gone", cost: 0 };
        const def = ctx.objectDef(o);
        if (!def.sellable) return { ok: false, reason: "Can't sell that", cost: 0 };
        const refund = Math.round(o.value * (1 - def.depreciation));
        const snap = JSON.parse(JSON.stringify(o)) as ObjectState;
        ctx.removeObject(o.id, 'sold');
        ctx.earn(refund, `Sold ${def.name}`);
        let cur = snap;
        undoStack.push({
          undo: () => {
            ctx.spend(refund, 'Undo sale');
            cur = ctx.spawnObject(snap.defId, snap.placement, { value: snap.value });
          },
          redo: () => {
            ctx.removeObject(cur.id, 'sold');
            ctx.earn(refund, 'Sold');
          },
        });
        redoStack.length = 0;
        return { ok: true, cost: -refund };
      }
      case 'addWalls': {
        const fresh = cmd.edges.filter((e) => typeof e === 'string' && !ctx.state.lot.walls[e]);
        const cost = fresh.length * 15;
        if (fresh.length === 0) return { ok: false, reason: 'Nothing to build', cost: 0 };
        if (!ctx.spend(cost, 'Walls')) return { ok: false, reason: 'Not enough money', cost };
        const add = () => {
          for (const e of fresh) ctx.state.lot.walls[e] = { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: null };
          bump();
        };
        const remove = () => {
          for (const e of fresh) delete ctx.state.lot.walls[e];
          bump();
        };
        add();
        undoStack.push({
          undo: () => {
            remove();
            ctx.earn(cost, 'Undo walls');
          },
          redo: () => {
            ctx.spend(cost, 'Walls');
            add();
          },
        });
        redoStack.length = 0;
        return { ok: true, cost };
      }
      case 'removeWalls': {
        const gone = cmd.edges.filter((e) => ctx.state.lot.walls[e]);
        const snaps = gone.map((e) => [e, ctx.state.lot.walls[e]] as const);
        for (const e of gone) delete ctx.state.lot.walls[e];
        bump();
        undoStack.push({
          undo: () => {
            for (const [e, seg] of snaps) ctx.state.lot.walls[e] = seg;
            bump();
          },
          redo: () => {
            for (const e of gone) delete ctx.state.lot.walls[e];
            bump();
          },
        });
        redoStack.length = 0;
        return { ok: true, cost: 0 };
      }
      default:
        return { ok: false, reason: 'Not supported by the fixture build service', cost: 0 };
    }
  }
  return {
    preview: (cmd) => {
      if (cmd.type === 'buy') {
        const r = ctx.spatial.checkPlace(cmd.defId, cmd.x, cmd.z, cmd.rot);
        return { ok: r.ok, reason: r.reason, cost: r.cost, tiles: r.tiles };
      }
      return { ok: true, cost: 0 };
    },
    apply,
    undo: () => {
      const op = undoStack.pop();
      if (!op) return false;
      op.undo();
      redoStack.push(op);
      return true;
    },
    redo: () => {
      const op = redoStack.pop();
      if (!op) return false;
      op.redo();
      undoStack.push(op);
      return true;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clearHistory: () => {
      undoStack.length = 0;
      redoStack.length = 0;
    },
  };
}

export const FIXTURE_TEMPLATE_INFO: LotTemplate[] = [
  { id: 'starter', name: 'Fixture Fixer-Upper', description: 'Test lot with a small house.', startingFunds: 6500 },
  { id: 'empty', name: 'Fixture Empty Plot', description: 'Open test lot.', startingFunds: 22000 },
];

/** 30x30 lot; 'starter' has a 7x6 room (x 4..11, z 4..10) with a door on its south wall. */
/** 'derelict' (no fixture of its own) builds the same small house as 'starter'. */
export function createFixtureLot(id: 'derelict' | 'starter' | 'empty'): { lot: LotState; objects: { defId: string; placement: ObjectPlacement; tint?: string | null }[] } {
  const width = 30;
  const depth = 30;
  const lot: LotState = {
    width,
    depth,
    buildable: { x0: 1, z0: 1, x1: 29, z1: 27 },
    sidewalkZ: 28,
    entryPoints: [
      { x: 0.5, z: 28.5 },
      { x: 29.5, z: 28.5 },
    ],
    walls: {},
    floors: new Array(width * depth).fill(null),
    version: 1,
    wallVersion: 1,
    floorVersion: 1,
  };
  const objects: { defId: string; placement: ObjectPlacement; tint?: string | null }[] = [];
  if (id === 'starter' || id === 'derelict') {
    const x0 = 4;
    const z0 = 4;
    const x1 = 11;
    const z1 = 10;
    for (let x = x0; x < x1; x++) {
      lot.walls[`h:${x}:${z0}`] = { paint: ['wall_exterior_siding', 'wall_plaster_bone'], openingId: null };
      lot.walls[`h:${x}:${z1}`] = { paint: ['wall_plaster_bone', 'wall_exterior_siding'], openingId: null };
    }
    for (let z = z0; z < z1; z++) {
      lot.walls[`v:${x0}:${z}`] = { paint: ['wall_exterior_siding', 'wall_plaster_bone'], openingId: null };
      lot.walls[`v:${x1}:${z}`] = { paint: ['wall_plaster_bone', 'wall_exterior_siding'], openingId: null };
    }
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) lot.floors[z * width + x] = 'floor_planks_worn';
    objects.push({ defId: 'door_splintered', placement: { kind: 'opening', edge: `h:7:${z1}` } });
    objects.push({ defId: 'fridge_humming', placement: { kind: 'floor', x: 5, z: 4, rot: 0 } });
    objects.push({ defId: 'coffin_pine', placement: { kind: 'floor', x: 10, z: 4, rot: 0 } });
    objects.push({ defId: 'table_rickety', placement: { kind: 'floor', x: 7, z: 6, rot: 0 } });
    objects.push({ defId: 'chair_creaky', placement: { kind: 'floor', x: 7, z: 5, rot: 0 } });
  }
  return { lot, objects };
}
