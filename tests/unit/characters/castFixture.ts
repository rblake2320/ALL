/**
 * Synthetic cast-body GLB for the runtime tests, generated in-test with three's GLTFExporter (binary) and parsed back
 * with GLTFLoader - the same path a real public/assets/models/characters/cast/<id>.glb takes.
 *
 * The body copies zombie.glb's bone names, hierarchy and rest TRS (optionally stretched by `scale`, as a taller or
 * shorter sculpt would be), and skins one box per bone segment into a single mesh 'Body' (material 'CastSkin', plus
 * an optional second material 'CastEyes' on a small eye block -> 2 primitives). Optionally bakes some zombie clips.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stripClip } from '../../../src/render/characters/clips';
import { loadGltf } from './helpers';

/** Node has Blob but no FileReader (GLTFExporter's binary path needs it). */
function polyfillFileReader(): void {
  const g = globalThis as unknown as { FileReader?: unknown };
  if (g.FileReader) return;
  class FR {
    result: ArrayBuffer | string | null = null;
    onload: ((ev: unknown) => void) | null = null;
    onloadend: ((ev: unknown) => void) | null = null;
    readAsArrayBuffer(b: Blob): void {
      void b.arrayBuffer().then((ab) => {
        this.result = ab;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
    readAsDataURL(b: Blob): void {
      void b.arrayBuffer().then((ab) => {
        this.result = `data:${b.type || 'application/octet-stream'};base64,${Buffer.from(ab).toString('base64')}`;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
  }
  g.FileReader = FR;
}

export interface CastFixtureOptions {
  /** Uniform stretch of the skeleton (1 = zombie.glb proportions). */
  scale?: number;
  /** Zombie clip names to bake into the GLB. */
  bake?: string[];
  /** Add a second material 'CastEyes'. */
  eyes?: boolean;
  /** Leave out these bones (e.g. 'jaw', 'prop_R'). */
  omitBones?: string[];
  /** Body colour. */
  color?: string;
  /** Exported as the Rig node's glTF extras (pelvisRest, headTop, carryAnchors...). */
  rigExtras?: Record<string, unknown>;
}

const cache = new Map<string, Promise<ArrayBuffer>>();

/** Binary GLB bytes of a synthetic cast body (cached per option set). */
export function castGlbBytes(opts: CastFixtureOptions = {}): Promise<ArrayBuffer> {
  const key = JSON.stringify(opts);
  let p = cache.get(key);
  if (!p) {
    p = build(opts);
    cache.set(key, p);
  }
  return p;
}

/** Fresh parse of a synthetic cast GLB (every call returns new, independently disposable resources). */
export async function castGltf(opts: CastFixtureOptions = {}): Promise<GLTF> {
  const ab = await castGlbBytes(opts);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(ab.slice(0), '', res, rej));
}

async function build(opts: CastFixtureOptions): Promise<ArrayBuffer> {
  polyfillFileReader();
  const k = opts.scale ?? 1;
  const omit = new Set(opts.omitBones ?? []);
  const zombie = await loadGltf();
  const zroot = zombie.scene.getObjectByName('root');
  if (!zroot) throw new Error('zombie.glb has no root bone');
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  rig.name = 'Rig';
  if (opts.rigExtras) rig.userData = { ...opts.rigExtras };
  scene.add(rig);
  const bones: THREE.Bone[] = [];
  const copy = (src: THREE.Object3D, parent: THREE.Object3D) => {
    if (!(src as THREE.Bone).isBone) return;
    if (omit.has(src.name)) return;
    const b = new THREE.Bone();
    b.name = src.name;
    b.position.copy(src.position).multiplyScalar(k);
    b.quaternion.copy(src.quaternion);
    parent.add(b);
    bones.push(b);
    for (const c of src.children) copy(c, b);
  };
  copy(zroot, rig);
  scene.updateMatrixWorld(true);
  // one box per bone -> child segment, rigidly weighted to the bone
  const pos: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const index: number[] = [];
  const groups: { start: number; count: number; mat: number }[] = [];
  const box = (a: THREE.Vector3, b: THREE.Vector3, r: number, boneIdx: number) => {
    const base = pos.length / 3;
    const min = new THREE.Vector3(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r);
    const max = new THREE.Vector3(Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r);
    for (let i = 0; i < 8; i++) {
      pos.push(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
      skinIndex.push(boneIdx, 0, 0, 0);
      skinWeight.push(1, 0, 0, 0);
    }
    const f = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
    for (const i of f) index.push(base + i);
  };
  const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const start0 = index.length;
  bones.forEach((b, i) => {
    const kids = b.children.filter((c) => (c as THREE.Bone).isBone && !c.name.startsWith('prop_'));
    const a = wp(b);
    if (b.name === 'head') box(a, a.clone().add(new THREE.Vector3(0, 0.22 * k, 0)), 0.1 * k, i);
    else if (kids.length) for (const c of kids) box(a, wp(c), 0.05 * k, i);
    else if (b.name.startsWith('foot_')) box(a, a.clone().add(new THREE.Vector3(0, -0.05 * k, 0.15 * k)), 0.04 * k, i);
    else if (b.name.startsWith('hand_')) box(a, a.clone().add(new THREE.Vector3(0, -0.12 * k, 0)), 0.035 * k, i);
  });
  groups.push({ start: start0, count: index.length - start0, mat: 0 });
  if (opts.eyes) {
    const head = bones.find((b) => b.name === 'head')!;
    const h = wp(head);
    const s1 = index.length;
    box(h.clone().add(new THREE.Vector3(-0.05, 0.12, 0.1).multiplyScalar(k)), h.clone().add(new THREE.Vector3(0.05, 0.13, 0.11).multiplyScalar(k)), 0.012 * k, bones.indexOf(head));
    groups.push({ start: s1, count: index.length - s1, mat: 1 });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geo.setIndex(index);
  geo.computeVertexNormals();
  for (const g of groups) geo.addGroup(g.start, g.count, g.mat);
  const skin = new THREE.MeshStandardMaterial({ color: opts.color ?? '#9a8f7a', roughness: 0.8 });
  skin.name = 'CastSkin';
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 });
  eyeMat.name = 'CastEyes';
  const mesh = new THREE.SkinnedMesh(geo, opts.eyes ? [skin, eyeMat] : skin);
  mesh.name = 'Body';
  rig.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  const animations: THREE.AnimationClip[] = [];
  const have = new Set(bones.map((b) => b.name));
  for (const name of opts.bake ?? []) {
    const c = zombie.animations.find((a) => a.name === name);
    if (!c) continue;
    const s = stripClip(c);
    s.tracks = s.tracks.filter((t) => have.has(t.name.slice(0, t.name.lastIndexOf('.'))));
    animations.push(s);
  }
  const exporter = new GLTFExporter();
  const out = await exporter.parseAsync(scene, { binary: true, animations });
  geo.dispose();
  skin.dispose();
  eyeMat.dispose();
  if (!(out instanceof ArrayBuffer)) throw new Error('exporter did not return a GLB');
  return out;
}

/**
 * Real published cast GLB, parsed in Node: textures need a DOM, so image / texture / sampler entries and every
 * material texture slot are removed from the JSON chunk first (geometry, skin, nodes, extras and materials kept).
 */
export function parseGlbWithoutTextures(buf: Uint8Array): Promise<GLTF> {
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
    const b0 = 20 + jsonLen;
    o.setUint32(b0, binLen, true);
    o.setUint32(b0 + 4, 0x004e4942, true);
    out.set(bin, b0 + 8);
  }
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(out.buffer, '', res, rej));
}
