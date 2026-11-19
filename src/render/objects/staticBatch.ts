/**
 * Per-object static batching. GLB furniture arrives as one mesh per material (5–20 draw calls per object); the art
 * style uses flat colours, so the renderer folds an instance's meshes into a few vertex-coloured meshes that share
 * ONE material (per-vertex colour, roughness/metalness and emissive):
 *
 *  - root batch:   every opaque, untextured mesh that no dynamic part animates (incl. 'Paint' and static glowing
 *                  bits). Double-sided parts are baked as two opposite-facing copies so one single-pass draw renders
 *                  both faces (and casts like a DoubleSide material). Floor objects' root batches are merged further
 *                  into lot chunks (chunks.ts).
 *  - sub-batches:  opaque meshes under a dynamic node the library only MOVES or SHOWS/HIDES (door leaves, servings,
 *                  flags, pumps, water, frost — and per kid for speakers/broken bits) are merged per node and hang off
 *                  that node, so the library's animation still applies.
 *  - glass batch:  alpha-blended, untextured, non-glowing parts at the root (glass, cobwebs, smudges) → one
 *                  single-pass transparent mesh (vertex alpha) instead of two passes per double-sided pane.
 *
 * Never batched: anything under screen / glow / bulb / flame / canvas nodes (the library swaps their materials),
 * textured / alpha-tested / skinned / morphing meshes and the renderer's own window-glow glass.
 * 'Paint' meshes are batched: the library only SWAPS their material for immutable cached variants (tint / dirt levels,
 * decision #20), so the batch remembers the Paint materials it baked and `paintChanged()` tells the owner when to
 * `rebatch()`. Merged geometry is cached per (model, structure, materials) and reference-counted; the originals stay
 * in the tree (hidden) so picking and the library's update() keep working on them.
 */
import * as THREE from 'three';

/** Library part kinds whose materials are swapped per frame (emissive levels, canvas wash): never batch inside. */
const SWAP_KINDS = new Set(['screen', 'glow', 'bulb', 'flame', 'canvas']);
/** Part kinds whose direct children are scaled individually: batch per child group. */
const KID_KINDS = new Set(['speaker', 'broken']);
/** Part kinds animated only through the node's own transform / visibility: batch everything under the node. */
const NODE_KINDS = new Set(['door', 'flag', 'pump', 'water', 'frost', 'serving']);

function partKind(name: string): string | null {
  if (SWAP_KINDS.has(name) || KID_KINDS.has(name) || NODE_KINDS.has(name)) return name;
  if (/^serving_[0-3]$/.test(name)) return 'serving';
  return null;
}

/**
 * Where a mesh's batch hangs: the instance root, a dynamic node, or a kid of a per-kid node. null = never batch
 * (inside a material-swapping part, or a directly scaled kid). Pure; exported for tests.
 */
export function batchHost(m: THREE.Object3D, root: THREE.Object3D): THREE.Object3D | null {
  // a mesh that IS a dynamic part (e.g. a mesh named 'bulb' or 'serving_0') is animated itself: never batch it
  if (m !== root && partKind(m.name) !== null) return null;
  let host: THREE.Object3D | null = null;
  let prev: THREE.Object3D = m;
  let n: THREE.Object3D | null = m.parent;
  while (n) {
    const k = n === root ? null : partKind(n.name);
    if (k) {
      if (SWAP_KINDS.has(k)) return null;
      if (!host) {
        if (KID_KINDS.has(k)) {
          if (prev === m) return null;
          host = prev;
        } else host = n;
      }
    }
    if (n === root) return host ?? root;
    prev = n;
    n = n.parent;
  }
  return null; // not under root
}

/** Nodes from the mesh up to (excluding) its host must all be visible at batch time. */
function visibleBelow(m: THREE.Object3D, host: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = m;
  while (n && n !== host) {
    if (!n.visible) return false;
    n = n.parent;
  }
  return n === host;
}

function isPaintSlot(mat: THREE.Material): boolean {
  return mat.name === 'Paint';
}

export type BatchClass = 'opaque' | 'transparent';

/** Material/geometry eligibility (no tree checks). */
function batchClassOf(m: THREE.Mesh): BatchClass | null {
  if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh) return null;
  if (m.userData && (m.userData.staticBatch || m.userData.staticBatchPart || m.userData.__rimShell || m.userData.staticChunk)) return null;
  if (m.morphTargetInfluences && m.morphTargetInfluences.length > 0) return null;
  // hiding a batched original would also hide anything parented to it
  if (m.children.length > 0) return null;
  if (Array.isArray(m.material) || !m.material) return null;
  const mat = m.material as THREE.MeshStandardMaterial;
  if (!mat.isMeshStandardMaterial) return null;
  if (mat.userData?.windowGlow) return null;
  if (mat.alphaTest > 0) return null;
  if (mat.map || mat.emissiveMap || mat.alphaMap || mat.normalMap || mat.roughnessMap || mat.metalnessMap || mat.aoMap || mat.lightMap || mat.bumpMap || mat.displacementMap) return null;
  if (mat.vertexColors && !m.geometry?.getAttribute('color')) return null;
  const g = m.geometry;
  if (!g || !g.getAttribute('position') || !g.getAttribute('normal')) return null;
  return mat.transparent || mat.opacity < 0.99 ? 'transparent' : 'opaque';
}

/** Can this mesh be folded into the instance's ROOT opaque batch? (pure predicate, tests/diagnostics) */
export function isBatchable(m: THREE.Mesh, root: THREE.Object3D): boolean {
  if (batchClassOf(m) !== 'opaque') return false;
  const host = batchHost(m, root);
  return host === root && visibleBelow(m, root);
}

/** What a batch folded (kept on the instance root's userData.__staticBatch). */
export interface BatchInfo {
  key: string;
  /** Root opaque batch (null when nothing at the root was batchable). */
  root: THREE.Mesh | null;
  /** Sub-batches under dynamic nodes + the glass batch. */
  parts: THREE.Mesh[];
  /** Hidden originals (restored by unbatch()). */
  sources: THREE.Mesh[];
  /** Paint meshes and the material each had when baked. */
  paint: THREE.Mesh[];
  paintMats: THREE.Material[];
}

interface CachedSet {
  root: THREE.BufferGeometry | null;
  /** Per host (traversal index of the host node): opaque sub-batch geometry. */
  subs: { host: number; geo: THREE.BufferGeometry }[];
  glass: THREE.BufferGeometry | null;
  refs: number;
}

/** Zero-reference cached geometry sets kept around for reuse (beyond this they are disposed). */
const SPARE_LIMIT = 48;

function patchBatchShader(mat: THREE.Material, key: string): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 batchRM;\nattribute vec3 batchE;\nvarying vec2 vBatchRM;\nvarying vec3 vBatchE;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBatchRM = batchRM;\nvBatchE = batchE;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBatchRM;\nvarying vec3 vBatchE;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * vBatchRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * vBatchRM.y;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vBatchE;');
  };
  mat.customProgramCacheKey = () => key;
}

export class StaticBatcher {
  /** Shared opaque batch material (also used by lot chunks and the neighbourhood). */
  readonly material: THREE.MeshStandardMaterial;
  /** Shared single-pass transparent material for glass batches (vertex alpha). */
  readonly glassMaterial: THREE.MeshStandardMaterial;
  private readonly cache = new Map<string, CachedSet>();
  private readonly spare: string[] = [];
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpInv = new THREE.Matrix4();
  private readonly tmpN = new THREE.Matrix3();
  private readonly v = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly c2 = new THREE.Color();
  /** Minimum batchable root meshes for a root batch to be worth it. */
  minMeshes = 2;

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ name: 'static-batch', vertexColors: true, roughness: 1, metalness: 1 });
    patchBatchShader(mat, 'afterlife-static-batch-v2');
    this.material = mat;
    const glass = new THREE.MeshStandardMaterial({ name: 'static-batch-glass', vertexColors: true, roughness: 1, metalness: 1, transparent: true, depthWrite: false });
    patchBatchShader(glass, 'afterlife-static-batch-glass-v2');
    this.glassMaterial = glass;
  }

  /**
   * Batch an instance in place (see the module comment). Returns the ROOT opaque batch mesh (null when there is
   * none — sub-batches / glass may still have been made). Batching twice is a no-op. Never throws.
   */
  batch(modelId: string, root: THREE.Object3D): THREE.Mesh | null {
    try {
      if (!root || root.userData.__staticBatch) return null;
      root.updateMatrixWorld(true);
      // classify every mesh
      const rootOpaque: THREE.Mesh[] = [];
      const glass: THREE.Mesh[] = [];
      const subs = new Map<THREE.Object3D, THREE.Mesh[]>();
      const order = new Map<THREE.Object3D, number>();
      let idx = 0;
      root.traverse((o) => {
        order.set(o, idx++);
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const cls = batchClassOf(m);
        if (!cls) return;
        const host = batchHost(m, root);
        if (!host || !visibleBelow(m, host)) return;
        if (cls === 'transparent') {
          if (host === root) glass.push(m);
          return;
        }
        if (host === root) rootOpaque.push(m);
        else {
          const list = subs.get(host) ?? [];
          list.push(m);
          subs.set(host, list);
        }
      });
      const doRoot = rootOpaque.length >= Math.max(1, this.minMeshes);
      const subList = [...subs.entries()].filter(([, l]) => l.length >= 2);
      if (!doRoot && subList.length === 0 && glass.length === 0) return null;
      // key by model + structure + baked materials so a placeholder, a hot-swapped model or another tint/dirt variant
      // never reuses another batch
      let verts = 0;
      let mh = 0;
      const all: THREE.Mesh[] = [];
      if (doRoot) all.push(...rootOpaque);
      for (const [, l] of subList) all.push(...l);
      all.push(...glass);
      for (const m of all) {
        verts += m.geometry.getAttribute('position').count;
        mh = (mh * 31 + hashUuid((m.material as THREE.Material).uuid)) % 2147483647;
      }
      const key = `${modelId}|${doRoot ? rootOpaque.length : 0}|${subList.length}|${glass.length}|${all.length}|${verts}|${mh}`;
      let set = this.cache.get(key);
      if (!set) {
        set = {
          root: doRoot ? this.merge(rootOpaque, root, false) : null,
          subs: subList.map(([host, l]) => ({ host: order.get(host) ?? -1, geo: this.merge(l, host, false)! })).filter((s) => s.geo),
          glass: glass.length > 0 ? this.merge(glass, root, true) : null,
          refs: 0,
        };
        this.cache.set(key, set);
      }
      const spareAt = this.spare.indexOf(key);
      if (spareAt >= 0) this.spare.splice(spareAt, 1);
      set.refs++;
      const info: BatchInfo = { key, root: null, parts: [], sources: [], paint: [], paintMats: [] };
      const hide = (list: THREE.Mesh[]) => {
        for (const m of list) {
          m.visible = false;
          info.sources.push(m);
          if (isPaintSlot(m.material as THREE.Material)) {
            info.paint.push(m);
            info.paintMats.push(m.material as THREE.Material);
          }
        }
      };
      if (set.root) {
        const merged = this.makeMesh(set.root, this.material, rootOpaque.some((m) => m.castShadow), 'static-batch');
        merged.userData.staticBatch = true;
        root.add(merged);
        info.root = merged;
        hide(rootOpaque);
      }
      const byOrder = new Map<number, THREE.Object3D>();
      for (const [host] of subList) byOrder.set(order.get(host) ?? -1, host);
      for (const s of set.subs) {
        const host = byOrder.get(s.host);
        const list = host ? subs.get(host) : undefined;
        if (!host || !list) continue;
        const part = this.makeMesh(s.geo, this.material, list.some((m) => m.castShadow), 'static-batch-part');
        part.userData.staticBatchPart = true;
        host.add(part);
        info.parts.push(part);
        hide(list);
      }
      if (set.glass) {
        const part = this.makeMesh(set.glass, this.glassMaterial, false, 'static-batch-glass');
        part.userData.staticBatchPart = true;
        part.renderOrder = Math.max(...glass.map((m) => m.renderOrder));
        root.add(part);
        info.parts.push(part);
        hide(glass);
      }
      root.userData.__staticBatch = info;
      return info.root;
    } catch {
      return null;
    }
  }

  private makeMesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast: boolean, name: string): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    // picking raycasts the (hidden) originals precisely; merged copies would only double the work
    m.raycast = () => undefined;
    return m;
  }

  /** The batch bookkeeping of an instance (null if not batched). */
  info(root: THREE.Object3D | null | undefined): BatchInfo | null {
    const info = root?.userData?.__staticBatch as BatchInfo | undefined;
    return info ?? null;
  }

  /** Undo batch(): remove the merged meshes, show the originals again, release the cached geometry. */
  unbatch(root: THREE.Object3D | null | undefined): void {
    const info = this.info(root);
    if (!info || !root) return;
    info.root?.parent?.remove(info.root);
    for (const p of info.parts) p.parent?.remove(p);
    for (const m of info.sources) m.visible = true;
    root.userData.__staticBatch = undefined;
    this.releaseKey(info.key);
  }

  /** Did the library swap a baked Paint material (tint/dirt variant) since the batch was made? */
  paintChanged(root: THREE.Object3D | null | undefined): boolean {
    const info = this.info(root);
    if (!info) return false;
    for (let i = 0; i < info.paint.length; i++) if (info.paint[i].material !== info.paintMats[i]) return true;
    return false;
  }

  /** Rebuild an instance's batch from its current materials (after paintChanged()). */
  rebatch(modelId: string, root: THREE.Object3D): THREE.Mesh | null {
    this.unbatch(root);
    return this.batch(modelId, root);
  }

  private releaseKey(key: string): void {
    const set = this.cache.get(key);
    if (!set) return;
    set.refs = Math.max(0, set.refs - 1);
    if (set.refs > 0) return;
    this.spare.push(key);
    while (this.spare.length > SPARE_LIMIT) {
      const k = this.spare.shift()!;
      const s = this.cache.get(k);
      if (s && s.refs === 0) {
        disposeSet(s);
        this.cache.delete(k);
      }
    }
  }

  /** Cached merged geometry sets (diagnostics / tests). */
  cacheSize(): number {
    return this.cache.size;
  }

  /**
   * Merge meshes into `host`-local space: position, normal, colour (rgb or rgba), batchRM (roughness, metalness),
   * batchE (emissive radiance). Double-sided sources get a second, reversed copy of their triangles.
   */
  private merge(meshes: THREE.Mesh[], host: THREE.Object3D, alpha: boolean): THREE.BufferGeometry | null {
    this.tmpInv.copy(host.matrixWorld).invert();
    let vCount = 0;
    let iCount = 0;
    for (const m of meshes) {
      const p = m.geometry.getAttribute('position');
      const twice = (m.material as THREE.Material).side === THREE.DoubleSide ? 2 : 1;
      vCount += p.count * twice;
      iCount += (m.geometry.index ? m.geometry.index.count : p.count) * twice;
    }
    if (vCount === 0 || vCount > 2_000_000) return null;
    const cs = alpha ? 4 : 3;
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * cs);
    const rm = new Float32Array(vCount * 2);
    const em = new Float32Array(vCount * 3);
    const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
    // transparent batches emulate three's two-pass DoubleSide order: every reversed (far-side) copy is drawn before
    // any forward copy, so a glass dome's far wall is blended first and its near wall on top
    const back = alpha ? new Uint32Array(iCount) : null;
    let bo = 0;
    let vo = 0;
    let io = 0;
    for (const m of meshes) {
      const g = m.geometry;
      const mat = m.material as THREE.MeshStandardMaterial;
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      const vc = mat.vertexColors ? (g.getAttribute('color') as THREE.BufferAttribute | undefined) : undefined;
      this.tmpM.multiplyMatrices(this.tmpInv, m.matrixWorld);
      this.tmpN.getNormalMatrix(this.tmpM);
      const mirrored = this.tmpM.determinant() < 0;
      const copies = mat.side === THREE.DoubleSide ? 2 : 1;
      const er = mat.emissive ? mat.emissive.r * mat.emissiveIntensity : 0;
      const eg = mat.emissive ? mat.emissive.g * mat.emissiveIntensity : 0;
      const eb = mat.emissive ? mat.emissive.b * mat.emissiveIntensity : 0;
      const a = Math.min(1, Math.max(0, mat.opacity));
      for (let copy = 0; copy < copies; copy++) {
        // copy 1 of a double-sided part faces the other way; a BackSide material is baked reversed
        const reverse = (copy === 1) !== (mat.side === THREE.BackSide);
        const flip = mirrored !== reverse;
        const ns = reverse ? -1 : 1;
        for (let i = 0; i < p.count; i++) {
          this.v.fromBufferAttribute(p, i).applyMatrix4(this.tmpM);
          const o = vo + i;
          pos[o * 3] = this.v.x;
          pos[o * 3 + 1] = this.v.y;
          pos[o * 3 + 2] = this.v.z;
          this.v.fromBufferAttribute(n, i).applyMatrix3(this.tmpN).normalize();
          nor[o * 3] = this.v.x * ns;
          nor[o * 3 + 1] = this.v.y * ns;
          nor[o * 3 + 2] = this.v.z * ns;
          this.c.copy(mat.color);
          if (vc) this.c.multiply(this.c2.setRGB(vc.getX(i), vc.getY(i), vc.getZ(i)));
          col[o * cs] = this.c.r;
          col[o * cs + 1] = this.c.g;
          col[o * cs + 2] = this.c.b;
          if (alpha) col[o * cs + 3] = vc && vc.itemSize === 4 ? a * vc.getW(i) : a;
          rm[o * 2] = Math.min(1, Math.max(0.02, mat.roughness));
          rm[o * 2 + 1] = Math.min(1, Math.max(0, mat.metalness));
          em[o * 3] = er;
          em[o * 3 + 1] = eg;
          em[o * 3 + 2] = eb;
        }
        const toBack = back !== null && copy === 1;
        const dst: Uint32Array | Uint16Array = toBack ? back! : idx;
        let at = toBack ? bo : io;
        if (g.index) {
          const gi = g.index;
          for (let k = 0; k + 2 < gi.count; k += 3) {
            const ia = gi.getX(k) + vo;
            const ib = gi.getX(k + 1) + vo;
            const ic = gi.getX(k + 2) + vo;
            dst[at + k] = ia;
            dst[at + k + 1] = flip ? ic : ib;
            dst[at + k + 2] = flip ? ib : ic;
          }
          at += gi.count;
        } else {
          for (let k = 0; k + 2 < p.count; k += 3) {
            dst[at + k] = vo + k;
            dst[at + k + 1] = vo + (flip ? k + 2 : k + 1);
            dst[at + k + 2] = vo + (flip ? k + 1 : k + 2);
          }
          at += p.count;
        }
        if (toBack) bo = at;
        else io = at;
        vo += p.count;
      }
    }
    if (back && bo > 0) {
      // [far-side copies][forward copies]
      idx.copyWithin(bo, 0, io);
      idx.set(back.subarray(0, bo), 0);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, cs));
    out.setAttribute('batchRM', new THREE.BufferAttribute(rm, 2));
    out.setAttribute('batchE', new THREE.BufferAttribute(em, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    out.userData.staticBatch = true;
    return out;
  }

  /** Drop cached geometry (e.g. when the library hot-swaps models). */
  clear(): void {
    for (const s of this.cache.values()) disposeSet(s);
    this.cache.clear();
    this.spare.length = 0;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.glassMaterial.dispose();
  }
}

function disposeSet(s: CachedSet): void {
  s.root?.dispose();
  for (const x of s.subs) x.geo.dispose();
  s.glass?.dispose();
}

/** The root merged batch mesh directly under `root` (null if not batched). */
export function findBatch(root: THREE.Object3D | null | undefined): THREE.Mesh | null {
  if (!root) return null;
  for (const c of root.children) if ((c as THREE.Mesh).isMesh && c.userData.staticBatch === true) return c as THREE.Mesh;
  return null;
}

function hashUuid(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) % 1000003;
  return h;
}
