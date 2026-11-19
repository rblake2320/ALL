/**
 * Lot static chunks: the per-object static batches (staticBatch.ts) of every floor/loose object are merged, in world
 * space, into ONE mesh per CHUNK_TILES² block of the lot (plus a shadowless twin for rugs). A furnished lot then costs
 * a handful of draw calls (main + shadow pass) instead of one or two per object, and each chunk is still frustum
 * culled on its own. Members keep their per-object batch mesh (hidden while merged) so an object can leave a chunk
 * (moved, picked up, hidden in buy mode, deleted) and the chunk is rebuilt from the remaining members on the next
 * flush(). Pure bookkeeping + geometry merging: no per-frame allocation unless a chunk is actually rebuilt.
 */
import * as THREE from 'three';

/** Chunk edge length in tiles (a 30×30 lot → 4×4 chunks). */
export const CHUNK_TILES = 8;

/** Chunk key for a world position (stable for negative coordinates; NaN → -1 = "no chunk"). */
export function chunkKeyAt(x: number, z: number, size: number = CHUNK_TILES): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return -1;
  const s = Number.isFinite(size) && size >= 1 ? size : CHUNK_TILES;
  const cx = Math.floor(x / s);
  const cz = Math.floor(z / s);
  if (Math.abs(cx) > 4000 || Math.abs(cz) > 4000) return -1;
  // pack into one non-negative integer
  return (cz + 4096) * 8192 + (cx + 4096);
}

/** One static-batch geometry (position/normal/color/batchRM) placed by a world matrix. */
export interface BatchPart {
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();

/**
 * Merge static-batch geometries into one world-space geometry with the same attribute layout (so it draws with the
 * shared static-batch material). Missing colour / batchRM / normal attributes get neutral defaults; mirrored matrices
 * keep triangles front-facing. Returns null when there is nothing to merge.
 */
export function mergeBatchParts(parts: readonly BatchPart[]): THREE.BufferGeometry | null {
  let vCount = 0;
  let iCount = 0;
  for (const part of parts) {
    const g = part.geometry;
    const p = g ? g.getAttribute('position') : undefined;
    if (!p) continue;
    vCount += p.count;
    iCount += g.index ? g.index.count : p.count;
  }
  if (vCount === 0) return null;
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const rm = new Float32Array(vCount * 2);
  const em = new Float32Array(vCount * 3);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0;
  let io = 0;
  for (const part of parts) {
    const g = part.geometry;
    const p = (g ? g.getAttribute('position') : undefined) as THREE.BufferAttribute | undefined;
    if (!p) continue;
    const n = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const cl = g.getAttribute('color') as THREE.BufferAttribute | undefined;
    const r = g.getAttribute('batchRM') as THREE.BufferAttribute | undefined;
    const e = g.getAttribute('batchE') as THREE.BufferAttribute | undefined;
    _m.copy(part.matrix);
    _n.getNormalMatrix(_m);
    const flip = _m.determinant() < 0;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(_m);
      pos[(vo + i) * 3] = _v.x;
      pos[(vo + i) * 3 + 1] = _v.y;
      pos[(vo + i) * 3 + 2] = _v.z;
      if (n) _v.fromBufferAttribute(n, i).applyMatrix3(_n).normalize();
      else _v.set(0, 1, 0);
      nor[(vo + i) * 3] = _v.x;
      nor[(vo + i) * 3 + 1] = _v.y;
      nor[(vo + i) * 3 + 2] = _v.z;
      col[(vo + i) * 3] = cl ? cl.getX(i) : 1;
      col[(vo + i) * 3 + 1] = cl ? cl.getY(i) : 1;
      col[(vo + i) * 3 + 2] = cl ? cl.getZ(i) : 1;
      rm[(vo + i) * 2] = r ? r.getX(i) : 0.8;
      rm[(vo + i) * 2 + 1] = r ? r.getY(i) : 0;
      if (e) {
        em[(vo + i) * 3] = e.getX(i);
        em[(vo + i) * 3 + 1] = e.getY(i);
        em[(vo + i) * 3 + 2] = e.getZ(i);
      }
    }
    if (g.index) {
      const gi = g.index;
      for (let k = 0; k + 2 < gi.count; k += 3) {
        idx[io + k] = gi.getX(k) + vo;
        idx[io + k + 1] = (flip ? gi.getX(k + 2) : gi.getX(k + 1)) + vo;
        idx[io + k + 2] = (flip ? gi.getX(k + 1) : gi.getX(k + 2)) + vo;
      }
      io += gi.count;
    } else {
      for (let k = 0; k + 2 < p.count; k += 3) {
        idx[io + k] = vo + k;
        idx[io + k + 1] = vo + (flip ? k + 2 : k + 1);
        idx[io + k + 2] = vo + (flip ? k + 1 : k + 2);
      }
      io += p.count;
    }
    vo += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('batchRM', new THREE.BufferAttribute(rm, 2));
  geo.setAttribute('batchE', new THREE.BufferAttribute(em, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

export interface ChunkMember {
  /** The member's merged per-object batch mesh (static-batch material, vertex colours + batchRM). */
  batch: THREE.Mesh;
  /** Whether the member casts shadows (rugs don't). */
  castShadow: boolean;
  /** Chunk key the member currently belongs to (-1 = none). Managed by StaticChunks. */
  chunk: number;
}

interface Chunk {
  key: number;
  members: Set<ChunkMember>;
  dirty: boolean;
  cast: THREE.Mesh | null;
  noCast: THREE.Mesh | null;
}

export class StaticChunks {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, Chunk>();
  private dirtyCount = 0;
  /** Rebuilds performed (diagnostics / tests). */
  rebuilds = 0;

  constructor(private readonly material: THREE.Material) {
    this.group.name = 'object-chunks';
  }

  /**
   * Put a member into chunk `key` (or take it out with -1). The member's own batch mesh is shown while it is not
   * merged and hidden once a chunk containing it has been (re)built.
   */
  assign(member: ChunkMember, key: number): void {
    if (member.chunk === key) return;
    if (member.chunk >= 0) {
      const old = this.chunks.get(member.chunk);
      if (old) {
        old.members.delete(member);
        this.markDirty(old);
      }
    }
    member.chunk = key;
    // visible on its own until a rebuild merges it (no frame without the object)
    member.batch.visible = true;
    if (key < 0) return;
    let c = this.chunks.get(key);
    if (!c) {
      c = { key, members: new Set(), dirty: false, cast: null, noCast: null };
      this.chunks.set(key, c);
    }
    c.members.add(member);
    this.markDirty(c);
  }

  /** The member's geometry, transform or shadow flag changed: rebuild its chunk on the next flush(). */
  touch(member: ChunkMember): void {
    if (member.chunk < 0) return;
    const c = this.chunks.get(member.chunk);
    if (c) this.markDirty(c);
  }

  remove(member: ChunkMember): void {
    this.assign(member, -1);
  }

  private markDirty(c: Chunk): void {
    if (c.dirty) return;
    c.dirty = true;
    this.dirtyCount++;
  }

  /** Rebuild every dirty chunk. Returns how many were rebuilt. Never throws (a failed chunk falls back to members). */
  flush(): number {
    if (this.dirtyCount === 0) return 0;
    let n = 0;
    for (const c of this.chunks.values()) {
      if (!c.dirty) continue;
      c.dirty = false;
      n++;
      this.rebuild(c);
      if (c.members.size === 0 && !c.cast && !c.noCast) this.chunks.delete(c.key);
    }
    this.dirtyCount = 0;
    this.rebuilds += n;
    return n;
  }

  private rebuild(c: Chunk): void {
    this.dropMeshes(c);
    if (c.members.size === 0) return;
    try {
      const cast: ChunkMember[] = [];
      const noCast: ChunkMember[] = [];
      for (const m of c.members) (m.castShadow ? cast : noCast).push(m);
      c.cast = this.build(cast, true, c.key);
      c.noCast = this.build(noCast, false, c.key);
      for (const m of c.members) m.batch.visible = false;
    } catch {
      // keep the members drawing themselves
      this.dropMeshes(c);
      for (const m of c.members) m.batch.visible = true;
    }
  }

  private build(members: ChunkMember[], castShadow: boolean, key: number): THREE.Mesh | null {
    if (members.length === 0) return null;
    const parts: BatchPart[] = [];
    for (const m of members) {
      m.batch.updateWorldMatrix(true, false);
      parts.push({ geometry: m.batch.geometry, matrix: m.batch.matrixWorld });
    }
    const geo = mergeBatchParts(parts);
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = `chunk:${key}${castShadow ? '' : ':flat'}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.userData.staticChunk = true;
    // picking uses the members' precise meshes, never the merged chunk
    mesh.raycast = () => undefined;
    this.group.add(mesh);
    return mesh;
  }

  private dropMeshes(c: Chunk): void {
    for (const mesh of [c.cast, c.noCast]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    c.cast = null;
    c.noCast = null;
  }

  /** Number of live chunk meshes (diagnostics / tests). */
  meshCount(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += (c.cast ? 1 : 0) + (c.noCast ? 1 : 0);
    return n;
  }

  /** Members currently merged into chunks (diagnostics / tests). */
  memberCount(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.members.size;
    return n;
  }

  clear(): void {
    for (const c of this.chunks.values()) {
      this.dropMeshes(c);
      for (const m of c.members) {
        m.chunk = -1;
        m.batch.visible = true;
      }
      c.members.clear();
    }
    this.chunks.clear();
    this.dirtyCount = 0;
  }

  dispose(): void {
    this.clear();
  }
}
