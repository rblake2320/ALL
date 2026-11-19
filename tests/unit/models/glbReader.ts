/**
 * Independent (TypeScript) binary glTF reader for the model tests: JSON + BIN chunks, node hierarchy with TRS
 * world matrices, world-space vertex positions and normals per node. Mirrors nothing from the Python side on
 * purpose, so the two implementations cross-check each other.
 */
import { readFileSync } from 'node:fs';

export interface GltfJson {
  asset?: unknown;
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  materials?: GltfMaterial[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}
export interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
  extras?: Record<string, unknown>;
}
export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}
export interface GltfMaterial {
  name?: string;
  emissiveFactor?: number[];
  alphaMode?: string;
  doubleSided?: boolean;
  extensions?: Record<string, { emissiveStrength?: number }>;
  pbrMetallicRoughness?: { baseColorFactor?: number[]; metallicFactor?: number; roughnessFactor?: number };
}
export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  min?: number[];
  max?: number[];
}

export interface NodeGeo {
  name: string;
  index: number;
  parent: number | null;
  world: Float64Array;
  /** world-space positions, xyz interleaved */
  positions: Float64Array;
  /** world-space (unnormalised sum direction) normals, xyz interleaved */
  normals: Float64Array;
  tris: number;
  materials: string[];
  /** triangle vertex indices into `positions` (per vertex, not per float) */
  indices: Uint32Array;
}

export interface Glb {
  json: GltfJson;
  bin: Uint8Array;
  nodes: NodeGeo[];
  byName: Map<string, NodeGeo>;
  tris: number;
  /** Is node `i` inside the subtree of a node named `name`? */
  under(i: number, name: string): boolean;
}

const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NCOMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(path: string): Glb {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${path}: bad magic`);
  if (dv.getUint32(4, true) !== 2) throw new Error(`${path}: not glTF 2`);
  let off = 12;
  let json: GltfJson | null = null;
  let bin = new Uint8Array(0);
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as GltfJson;
    else if (type === 0x004e4942) bin = new Uint8Array(chunk);
    off += 8 + len;
  }
  if (!json) throw new Error(`${path}: no JSON chunk`);
  return build(json, bin);
}

function readAccessor(json: GltfJson, bin: Uint8Array, idx: number): Float64Array {
  const acc = json.accessors![idx];
  const view = json.bufferViews![acc.bufferView ?? 0];
  const n = NCOMP[acc.type];
  const size = COMP_SIZE[acc.componentType];
  const stride = view.byteStride ?? n * size;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float64Array(acc.count * n);
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < n; k++) {
      const p = base + i * stride + k * size;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = dv.getFloat32(p, true); break;
        case 5125: v = dv.getUint32(p, true); break;
        case 5123: v = dv.getUint16(p, true); if (acc.normalized) v /= 65535; break;
        case 5122: v = dv.getInt16(p, true); if (acc.normalized) v = Math.max(v / 32767, -1); break;
        case 5121: v = dv.getUint8(p); if (acc.normalized) v /= 255; break;
        case 5120: v = dv.getInt8(p); if (acc.normalized) v = Math.max(v / 127, -1); break;
        default: throw new Error(`component type ${acc.componentType}`);
      }
      out[i * n + k] = v;
    }
  }
  return out;
}

/** Column-major 4x4 from TRS (glTF convention). */
function trs(node: GltfNode): Float64Array {
  if (node.matrix) return Float64Array.from(node.matrix);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return Float64Array.from([
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

function mul(a: Float64Array, b: Float64Array): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

function build(json: GltfJson, bin: Uint8Array): Glb {
  const nodes = json.nodes ?? [];
  const parent: (number | null)[] = nodes.map(() => null);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  const world: Float64Array[] = [];
  const getWorld = (i: number): Float64Array => {
    if (world[i]) return world[i];
    const p = parent[i];
    world[i] = p === null ? trs(nodes[i]) : mul(getWorld(p), trs(nodes[i]));
    return world[i];
  };
  let total = 0;
  const geos: NodeGeo[] = nodes.map((n, i) => {
    const m = getWorld(i);
    const pos: number[] = [];
    const nrm: number[] = [];
    const idx: number[] = [];
    let tris = 0;
    const mats: string[] = [];
    if (n.mesh !== undefined) {
      for (const prim of json.meshes![n.mesh].primitives) {
        const p = readAccessor(json, bin, prim.attributes.POSITION);
        const first = pos.length / 3;
        if (prim.indices !== undefined) for (const v of readAccessor(json, bin, prim.indices)) idx.push(first + v);
        else for (let v = 0; v < p.length / 3; v++) idx.push(first + v);
        const nn = prim.attributes.NORMAL !== undefined ? readAccessor(json, bin, prim.attributes.NORMAL) : null;
        const ncomp = nn ? nn.length / (p.length / 3) : 3;
        for (let v = 0; v < p.length / 3; v++) {
          const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
          pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
          if (nn) {
            const a = nn[v * ncomp], b = nn[v * ncomp + 1], c = nn[v * ncomp + 2];
            nrm.push(m[0] * a + m[4] * b + m[8] * c, m[1] * a + m[5] * b + m[9] * c, m[2] * a + m[6] * b + m[10] * c);
          }
        }
        const count = prim.indices !== undefined ? json.accessors![prim.indices].count : p.length / 3;
        if ((prim.mode ?? 4) === 4) tris += count / 3;
        if (prim.material !== undefined) mats.push(json.materials?.[prim.material]?.name ?? '');
      }
    }
    total += tris;
    return { name: n.name ?? `node${i}`, index: i, parent: parent[i], world: m, positions: Float64Array.from(pos),
      normals: Float64Array.from(nrm), tris, materials: mats, indices: Uint32Array.from(idx) };
  });
  const byName = new Map(geos.map((g) => [g.name, g]));
  const under = (i: number, name: string): boolean => {
    let p: number | null = i;
    while (p !== null) {
      if (nodes[p].name === name) return true;
      p = parent[p];
    }
    return false;
  };
  return { json, bin, nodes: geos, byName, tris: total, under };
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** Bounds of all meshes except those under the named subtrees. */
export function boundsOf(g: Glb, exclude: string[] = ['broken']): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const n of g.nodes) {
    if (exclude.some((e) => g.under(n.index, e))) continue;
    const p = n.positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    }
  }
  return { min, max };
}

/** Mean of the vertex normals of a node (and its descendants when `deep`). */
export function meanNormal(g: Glb, name: string, deep = true): [number, number, number] | null {
  const root = g.byName.get(name);
  if (!root) return null;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const node of g.nodes) {
    if (deep ? !g.under(node.index, name) : node.index !== root.index) continue;
    const a = node.normals;
    for (let i = 0; i < a.length; i += 3) {
      sx += a[i]; sy += a[i + 1]; sz += a[i + 2]; n++;
    }
  }
  return n ? [sx / n, sy / n, sz / n] : null;
}

/** Centroid of all vertices above a height (Y) — e.g. a backrest. */
export function centroidAbove(g: Glb, y: number, exclude: string[] = ['broken']): [number, number, number] | null {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const node of g.nodes) {
    if (exclude.some((e) => g.under(node.index, e))) continue;
    const p = node.positions;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] <= y) continue;
      sx += p[i]; sy += p[i + 1]; sz += p[i + 2]; n++;
    }
  }
  return n ? [sx / n, sy / n, sz / n] : null;
}

export function emissiveStrengths(g: Glb, nodeName: string): number[] {
  const out: number[] = [];
  for (const node of g.nodes) {
    if (!g.under(node.index, nodeName)) continue;
    const n = g.json.nodes![node.index];
    if (n.mesh === undefined) continue;
    for (const prim of g.json.meshes![n.mesh].primitives) {
      if (prim.material === undefined) continue;
      const mat = g.json.materials![prim.material];
      const ef = mat.emissiveFactor ?? [0, 0, 0];
      const peak = Math.max(...ef);
      if (peak <= 0) continue;
      out.push((mat.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1) * peak);
    }
  }
  return out;
}

/** Highest surface Y (below `maxY`) hit by a vertical ray at (x, z) — e.g. the seat top under a slot. */
export function heightAt(g: Glb, x: number, z: number, maxY = Infinity, exclude: string[] = ['broken']): number {
  let best = -Infinity;
  for (const node of g.nodes) {
    if (exclude.some((e) => g.under(node.index, e))) continue;
    const p = node.positions;
    const ix = node.indices;
    for (let t = 0; t + 2 < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const ax = p[a], az = p[a + 2], bx = p[b], bz = p[b + 2], cx = p[c], cz = p[c + 2];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const y = l1 * p[a + 1] + l2 * p[b + 1] + l3 * p[c + 1];
      if (y < maxY && y > best) best = y;
    }
  }
  return best;
}

/** Lowest surface Y strictly above `minY` hit by a vertical ray at (x, z) (Infinity when open sky). */
export function surfaceAbove(g: Glb, x: number, z: number, minY: number, exclude: string[] = ['broken']): number {
  let best = Infinity;
  for (const node of g.nodes) {
    if (exclude.some((e) => g.under(node.index, e))) continue;
    const p = node.positions;
    const ix = node.indices;
    for (let t = 0; t + 2 < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const ax = p[a], az = p[a + 2], bx = p[b], bz = p[b + 2], cx = p[c], cz = p[c + 2];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const y = l1 * p[a + 1] + l2 * p[b + 1] + l3 * p[c + 1];
      if (y > minY && y < best) best = y;
    }
  }
  return best;
}

export interface PrimInfo {
  node: string;
  material: string;
  /** world-space positions, xyz interleaved */
  positions: Float64Array;
  /** COLOR_0 red channel per vertex (AO multiplier) or null when absent */
  ao: Float64Array | null;
  /** number of vertices whose packed attributes (position, normal, colour) repeat an earlier vertex */
  duplicates: number;
}

/** Per-primitive view (material, world positions, AO, duplicate-vertex count) for fine-grained asset checks. */
export function primitives(g: Glb): PrimInfo[] {
  const out: PrimInfo[] = [];
  for (const node of g.nodes) {
    const n = g.json.nodes![node.index];
    if (n.mesh === undefined) continue;
    const m = node.world;
    for (const prim of g.json.meshes![n.mesh].primitives) {
      const p = accessorValues(g, prim.attributes.POSITION);
      const nrm = prim.attributes.NORMAL !== undefined ? accessorValues(g, prim.attributes.NORMAL) : null;
      const col = prim.attributes.COLOR_0 !== undefined ? accessorValues(g, prim.attributes.COLOR_0) : null;
      const count = g.json.accessors![prim.attributes.POSITION].count;
      const nc = nrm ? nrm.length / count : 0;
      const cc = col ? col.length / count : 0;
      const pos = new Float64Array(count * 3);
      const ao = col ? new Float64Array(count) : null;
      const seen = new Set<string>();
      let dup = 0;
      for (let v = 0; v < count; v++) {
        const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
        pos[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        pos[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        pos[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (ao && col) ao[v] = col[v * cc];
        const key = [x, y, z, ...(nrm ? Array.from(nrm.subarray(v * nc, v * nc + nc)) : []),
          ...(col ? Array.from(col.subarray(v * cc, v * cc + cc)) : [])].join(',');
        if (seen.has(key)) dup++;
        else seen.add(key);
      }
      const material = prim.material !== undefined ? g.json.materials?.[prim.material]?.name ?? '' : '';
      out.push({ node: node.name, material, positions: pos, ao, duplicates: dup });
    }
  }
  return out;
}

function accessorValues(g: Glb, idx: number): Float64Array {
  const json = g.json;
  const acc = json.accessors![idx];
  const view = json.bufferViews![acc.bufferView ?? 0];
  const n = NCOMP[acc.type];
  const size = COMP_SIZE[acc.componentType];
  const stride = view.byteStride ?? n * size;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset, g.bin.byteLength);
  const out = new Float64Array(acc.count * n);
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < n; k++) {
      const q = base + i * stride + k * size;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = dv.getFloat32(q, true); break;
        case 5123: v = dv.getUint16(q, true); if (acc.normalized) v /= 65535; break;
        case 5121: v = dv.getUint8(q); if (acc.normalized) v /= 255; break;
        case 5120: v = dv.getInt8(q); if (acc.normalized) v = Math.max(v / 127, -1); break;
        case 5122: v = dv.getInt16(q, true); if (acc.normalized) v = Math.max(v / 32767, -1); break;
        default: v = dv.getUint32(q, true);
      }
      out[i * n + k] = v;
    }
  }
  return out;
}
