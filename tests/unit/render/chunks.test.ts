import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { StaticChunks, chunkKeyAt, CHUNK_TILES, type ChunkMember } from '../../../src/render/objects/chunks';
import { StaticBatcher } from '../../../src/render/objects/staticBatch';

const mat = new THREE.MeshStandardMaterial({ vertexColors: true });

/** A batch-like mesh (position/normal/colour/batchRM) inside a holder placed at (x, z) with a yaw. */
function member(x: number, z: number, yaw = 0, cast = true, color = 0.5): { holder: THREE.Group; m: ChunkMember } {
  const g = new THREE.BoxGeometry(0.5, 1, 0.5);
  g.translate(0, 0.5, 0);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(color), 3));
  g.setAttribute('batchRM', new THREE.BufferAttribute(new Float32Array(n * 2).fill(0.7), 2));
  const batch = new THREE.Mesh(g, mat);
  const holder = new THREE.Group();
  holder.position.set(x, 0, z);
  holder.rotation.y = yaw;
  holder.add(batch);
  holder.updateMatrixWorld(true);
  return { holder, m: { batch, castShadow: cast, chunk: -1 } };
}

describe('chunk keys', () => {
  it('tiles in the same CHUNK_TILES block share a key; neighbours differ', () => {
    expect(chunkKeyAt(0.5, 0.5)).toBe(chunkKeyAt(CHUNK_TILES - 0.01, CHUNK_TILES - 0.01));
    expect(chunkKeyAt(0.5, 0.5)).not.toBe(chunkKeyAt(CHUNK_TILES + 0.01, 0.5));
    expect(chunkKeyAt(0.5, 0.5)).not.toBe(chunkKeyAt(0.5, CHUNK_TILES + 0.01));
    // x and z never alias (1,0) vs (0,1)
    expect(chunkKeyAt(CHUNK_TILES, 0)).not.toBe(chunkKeyAt(0, CHUNK_TILES));
  });

  it('adversarial: negative coordinates are valid keys, NaN/Infinity/huge → -1, garbage size → default', () => {
    expect(chunkKeyAt(-0.5, -0.5)).toBeGreaterThanOrEqual(0);
    expect(chunkKeyAt(-0.5, -0.5)).not.toBe(chunkKeyAt(0.5, 0.5));
    for (const v of [NaN, Infinity, -Infinity, 1e9]) {
      expect(chunkKeyAt(v, 1)).toBe(-1);
      expect(chunkKeyAt(1, v)).toBe(-1);
    }
    expect(chunkKeyAt(9, 9, NaN)).toBe(chunkKeyAt(9, 9));
    expect(chunkKeyAt(9, 9, 0)).toBe(chunkKeyAt(9, 9));
  });
});

describe('static chunks', () => {
  it('merges members in world space into one mesh per chunk and hides their own batches', () => {
    const chunks = new StaticChunks(mat);
    const a = member(2.5, 2.5, 0);
    const b = member(5.5, 3.5, Math.PI / 2);
    const far = member(20.5, 20.5);
    chunks.assign(a.m, chunkKeyAt(2.5, 2.5));
    chunks.assign(b.m, chunkKeyAt(5.5, 3.5));
    chunks.assign(far.m, chunkKeyAt(20.5, 20.5));
    // visible on their own until the flush merges them (never a frame without the object)
    expect(a.m.batch.visible).toBe(true);
    expect(chunks.flush()).toBe(2);
    expect(chunks.meshCount()).toBe(2);
    expect(a.m.batch.visible).toBe(false);
    expect(far.m.batch.visible).toBe(false);
    const meshes = chunks.group.children as THREE.Mesh[];
    const first = meshes.find((m) => m.geometry.getAttribute('position').count === 48)!;
    expect(first).toBeDefined();
    first.geometry.computeBoundingBox();
    const bb = first.geometry.boundingBox!;
    // a: x ∈ [2.25, 2.75]; b rotated 90° at 5.5: x ∈ [5.25, 5.75]
    expect(bb.min.x).toBeCloseTo(2.25, 5);
    expect(bb.max.x).toBeCloseTo(5.75, 5);
    expect(bb.min.y).toBeCloseTo(0, 5);
    expect(bb.max.y).toBeCloseTo(1, 5);
    // colours / roughness carried through
    expect(first.geometry.getAttribute('color').getX(0)).toBeCloseTo(0.5, 5);
    expect(first.geometry.getAttribute('batchRM').getX(0)).toBeCloseTo(0.7, 5);
    // chunk meshes are never raycast
    const hits: THREE.Intersection[] = [];
    first.raycast(new THREE.Raycaster(new THREE.Vector3(2.5, 5, 2.5), new THREE.Vector3(0, -1, 0)), hits);
    expect(hits.length).toBe(0);
    // nothing dirty → flush is free
    expect(chunks.flush()).toBe(0);
    chunks.dispose();
  });

  it('rotated members keep front-facing triangles (winding vs normals)', () => {
    const chunks = new StaticChunks(mat);
    const a = member(1.5, 1.5, 1.2);
    chunks.assign(a.m, chunkKeyAt(1.5, 1.5));
    chunks.flush();
    const mesh = chunks.group.children[0] as THREE.Mesh;
    const pos = mesh.geometry.getAttribute('position');
    const nor = mesh.geometry.getAttribute('normal');
    const idx = mesh.geometry.index!;
    for (let t = 0; t < idx.count; t += 3) {
      const v0 = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(t));
      const e1 = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(t + 1)).sub(v0);
      const e2 = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(t + 2)).sub(v0);
      expect(e1.cross(e2).dot(new THREE.Vector3().fromBufferAttribute(nor, idx.getX(t)))).toBeGreaterThan(0);
    }
    chunks.dispose();
  });

  it('rugs go into a shadowless twin; casters into the casting mesh', () => {
    const chunks = new StaticChunks(mat);
    const sofa = member(1.5, 1.5, 0, true);
    const rug = member(2.5, 2.5, 0, false);
    const key = chunkKeyAt(1.5, 1.5);
    chunks.assign(sofa.m, key);
    chunks.assign(rug.m, key);
    chunks.flush();
    const meshes = chunks.group.children as THREE.Mesh[];
    expect(meshes.length).toBe(2);
    expect(meshes.filter((m) => m.castShadow).length).toBe(1);
    expect(meshes.filter((m) => !m.castShadow).length).toBe(1);
    chunks.dispose();
  });

  it('leaving a chunk shows the member again and rebuilds (or drops) the chunk; moves re-merge', () => {
    const chunks = new StaticChunks(mat);
    const a = member(1.5, 1.5);
    const b = member(2.5, 1.5);
    const key = chunkKeyAt(1.5, 1.5);
    chunks.assign(a.m, key);
    chunks.assign(b.m, key);
    chunks.flush();
    expect(chunks.memberCount()).toBe(2);
    chunks.assign(a.m, -1);
    expect(a.m.batch.visible).toBe(true);
    expect(a.m.chunk).toBe(-1);
    chunks.flush();
    expect(chunks.memberCount()).toBe(1);
    expect((chunks.group.children[0] as THREE.Mesh).geometry.getAttribute('position').count).toBe(24);
    // move b within the chunk: touch → rebuilt at the new place
    b.holder.position.x = 4.5;
    b.holder.updateMatrixWorld(true);
    chunks.touch(b.m);
    expect(chunks.flush()).toBe(1);
    const mesh = chunks.group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.x).toBeCloseTo(4.25, 5);
    // last member leaves → chunk mesh disposed and removed
    let disposed = false;
    mesh.geometry.addEventListener('dispose', () => (disposed = true));
    chunks.remove(b.m);
    chunks.flush();
    expect(disposed).toBe(true);
    expect(chunks.meshCount()).toBe(0);
    expect(chunks.group.children.length).toBe(0);
    chunks.dispose();
  });

  it('assigning to the same chunk twice is a no-op; touch outside a chunk is a no-op', () => {
    const chunks = new StaticChunks(mat);
    const a = member(1.5, 1.5);
    const key = chunkKeyAt(1.5, 1.5);
    chunks.assign(a.m, key);
    chunks.flush();
    const rebuilds = chunks.rebuilds;
    chunks.assign(a.m, key);
    expect(chunks.flush()).toBe(0);
    const lone = member(9, 9);
    chunks.touch(lone.m);
    expect(chunks.flush()).toBe(0);
    expect(chunks.rebuilds).toBe(rebuilds);
    chunks.dispose();
  });

  it('adversarial: members without geometry attributes, huge counts of churn, clear() restores members', () => {
    const chunks = new StaticChunks(mat);
    const empty: ChunkMember = { batch: new THREE.Mesh(new THREE.BufferGeometry(), mat), castShadow: true, chunk: -1 };
    chunks.assign(empty, chunkKeyAt(1, 1));
    expect(() => chunks.flush()).not.toThrow();
    expect(chunks.meshCount()).toBe(0);
    // churn: 500 random assignments never leak meshes beyond the live chunk count
    const ms = Array.from({ length: 20 }, (_, i) => member((i * 7) % 30, (i * 13) % 30));
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 500; i++) {
      const m = ms[Math.floor(rnd() * ms.length)];
      chunks.assign(m.m, rnd() < 0.2 ? -1 : chunkKeyAt(rnd() * 30, rnd() * 30));
      if (i % 25 === 0) chunks.flush();
    }
    chunks.flush();
    const live = new Set(ms.filter((m) => m.m.chunk >= 0).map((m) => m.m.chunk));
    expect(chunks.meshCount()).toBe(live.size);
    for (const m of ms) expect(m.m.batch.visible).toBe(m.m.chunk < 0);
    chunks.clear();
    expect(chunks.meshCount()).toBe(0);
    for (const m of ms) {
      expect(m.m.chunk).toBe(-1);
      expect(m.m.batch.visible).toBe(true);
    }
    chunks.dispose();
  });

  it('works with real StaticBatcher batches (shared material, attributes line up)', () => {
    const batcher = new StaticBatcher();
    batcher.minMeshes = 1;
    const chunks = new StaticChunks(batcher.material);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ name: 'Wood', color: '#884422' })));
    const holder = new THREE.Group();
    holder.position.set(3.5, 0, 4.5);
    holder.add(root);
    const batch = batcher.batch('crate', root)!;
    holder.updateMatrixWorld(true);
    const m: ChunkMember = { batch, castShadow: batch.castShadow, chunk: -1 };
    chunks.assign(m, chunkKeyAt(3.5, 4.5));
    chunks.flush();
    const mesh = chunks.group.children[0] as THREE.Mesh;
    expect(mesh.material).toBe(batcher.material);
    expect(mesh.geometry.getAttribute('batchRM').count).toBe(mesh.geometry.getAttribute('position').count);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()).x).toBeCloseTo(3.5, 5);
    chunks.dispose();
    batcher.dispose();
  });
});
