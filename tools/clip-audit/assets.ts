/**
 * CLIP-AUDIT asset access in Node (no DOM, no WebGL): GLBs are parsed with three's GLTFLoader after stripping
 * images/textures (geometry, skins, animations and extras are untouched), and three.js meshes are converted into
 * world-space labelled triangle soups for the detector.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { TriMesh } from './geometry';

export const ROOT = resolve(__dirname, '../..');
export const ASSETS = resolve(ROOT, 'public/assets');

export function assetPath(rel: string): string {
  return resolve(ASSETS, rel.replace(/^\/?assets\//, '').replace(/^\//, ''));
}

/** Re-pack a GLB with every image / texture / sampler reference removed (Node has no image decoder). */
export function stripTextures(buf: Uint8Array): ArrayBuffer {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12;
  let json: Record<string, unknown> | null = null;
  let bin: Uint8Array | null = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)) as Record<string, unknown>;
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!json) throw new Error('GLB without JSON');
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of (json.materials as Record<string, unknown>[] | undefined) ?? []) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    const ext = m.extensions as Record<string, unknown> | undefined;
    if (ext) for (const k of Object.keys(ext)) if (/texture/i.test(JSON.stringify(ext[k]))) delete ext[k];
    const pbr = m.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) {
      delete pbr.baseColorTexture;
      delete pbr.metallicRoughnessTexture;
    }
  }
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = (enc.length + 3) & ~3;
  const binLen = bin ? (bin.byteLength + 3) & ~3 : 0;
  const total = 12 + 8 + jsonLen + (bin ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true);
  o.setUint32(4, 2, true);
  o.setUint32(8, total, true);
  o.setUint32(12, jsonLen, true);
  o.setUint32(16, 0x4e4f534a, true);
  out.set(enc, 20);
  for (let i = enc.length; i < jsonLen; i++) out[20 + i] = 0x20;
  if (bin) {
    const b = 20 + jsonLen;
    o.setUint32(b, binLen, true);
    o.setUint32(b + 4, 0x004e4942, true);
    out.set(bin, b + 8);
  }
  return out.buffer;
}

export function parseGlb(buf: Uint8Array): Promise<GLTF> {
  const ab = stripTextures(buf);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

const gltfCache = new Map<string, Promise<GLTF>>();

/** Parse a public/assets GLB (cached; callers must not mutate the shared result - clone the scene). */
export function loadGlb(rel: string): Promise<GLTF> {
  let p = gltfCache.get(rel);
  if (!p) {
    p = parseGlb(readFileSync(assetPath(rel)));
    gltfCache.set(rel, p);
  }
  return p;
}

export function readJson<T = unknown>(rel: string): T {
  return JSON.parse(readFileSync(assetPath(rel), 'utf8')) as T;
}

export function hasAsset(rel: string): boolean {
  return existsSync(assetPath(rel));
}

// ───────────────────────────── three.js -> TriMesh ─────────────────────────────

function visibleChain(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export interface ExtractOptions {
  /** Skip meshes (and their subtrees) for which this returns true. */
  skip?: (o: THREE.Object3D) => boolean;
  /** Label for a static mesh's vertices (default: the mesh name). */
  label?: (mesh: THREE.Mesh) => string;
  /** Label skinned vertices by their dominant bone (default true). */
  boneLabels?: boolean;
  /** Drop triangle groups drawn with these materials (open glass shells that bound no solid volume). */
  skipMaterial?: (m: THREE.Material) => boolean;
}

/**
 * World-space soup of every visible mesh under `root` (call root.updateMatrixWorld(true) first). Skinned meshes are
 * CPU-skinned with SkinnedMesh.getVertexPosition (bones + morph targets, exactly what the GPU does).
 */
export function extractMeshes(root: THREE.Object3D, opts: ExtractOptions = {}): TriMesh {
  const pos: number[] = [];
  const tri: number[] = [];
  const vLabel: number[] = [];
  const labels: string[] = [];
  const lid = new Map<string, number>();
  const labelId = (s: string) => {
    let k = lid.get(s);
    if (k === undefined) {
      k = labels.length;
      labels.push(s);
      lid.set(s, k);
    }
    return k;
  };
  const v = new THREE.Vector3();
  const skipped = new Set<THREE.Object3D>();
  root.traverse((o) => {
    if (o.parent && skipped.has(o.parent)) {
      skipped.add(o);
      return;
    }
    if (opts.skip && opts.skip(o)) {
      skipped.add(o);
      return;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !visibleChain(mesh)) return;
    const g = mesh.geometry as THREE.BufferGeometry;
    const pa = g.attributes.position as THREE.BufferAttribute | undefined;
    if (!pa) return;
    const base = pos.length / 3;
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh) : null;
    const si = skinned ? (g.attributes.skinIndex as THREE.BufferAttribute) : null;
    const sw = skinned ? (g.attributes.skinWeight as THREE.BufferAttribute) : null;
    const byBone = !!(skinned && si && sw && opts.boneLabels !== false);
    const fixed = byBone ? -1 : labelId(opts.label ? opts.label(mesh) : mesh.name || 'mesh');
    for (let i = 0; i < pa.count; i++) {
      if (skinned) {
        skinned.getVertexPosition(i, v);
        v.applyMatrix4(skinned.matrixWorld);
      } else v.fromBufferAttribute(pa, i).applyMatrix4(mesh.matrixWorld);
      pos.push(v.x, v.y, v.z);
      if (byBone && skinned && si && sw) {
        let bw = -1;
        let bi = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i, k);
          if (w > bw) {
            bw = w;
            bi = si.getComponent(i, k);
          }
        }
        const bone = skinned.skeleton.bones[bi];
        vLabel.push(labelId(bone ? bone.name : 'bone?'));
      } else vLabel.push(fixed);
    }
    const idx = g.index;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : pa.count, materialIndex: 0 }];
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0] ?? mats[0];
      if (mat && mat.visible === false) continue;
      if (mat && opts.skipMaterial && opts.skipMaterial(mat)) continue;
      const end = Math.min(gr.start + gr.count, idx ? idx.count : pa.count);
      for (let k = gr.start; k + 2 < end; k += 3) {
        const a = idx ? idx.getX(k) : k;
        const b = idx ? idx.getX(k + 1) : k + 1;
        const c = idx ? idx.getX(k + 2) : k + 2;
        tri.push(base + a, base + b, base + c);
      }
    }
    // (a mirroring world matrix flips winding; makeSolid's per-component orientation repair restores it)
  });
  return { pos: Float64Array.from(pos), tri: Uint32Array.from(tri), vLabel: Int32Array.from(vLabel), labels };
}
