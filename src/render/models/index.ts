/**
 * ASSETS-OBJECTS model library (implements `ModelLibrary` from src/render/contracts.ts).
 *
 *   const models = createModelLibrary({ baseUrl: import.meta.env.BASE_URL + 'assets/' });
 *   await models.ready;                       // never rejects
 *   const chair = models.create('chair_creaky', '#4a3326');
 *   models.update(chair, visualState, timeSec); // per frame, allocation-free
 *
 * Loads `${baseUrl}manifest.objects.json`, then every GLB it lists (<= 6 concurrent). Instances clone the cached
 * prototype (geometry and materials shared). Tints recolour materials named 'Paint' through a shared variant cache.
 * Missing/broken assets and unknown ids get a procedural placeholder (sized from the catalog, front notch at +Z);
 * placeholders created while a model is still loading are upgraded in place once it arrives.
 * `release(instance)` unbinds an instance (the renderer then leaves resource ownership to the library: shared
 * geometry/materials live until `dispose()`).
 */
import * as THREE from 'three';
import type { ModelLibrary, ObjectVisualState } from '../contracts';
import { applyState, bindInstance, DEFAULT_VISUAL_STATE, partKindOf, sanitizeState, settleAnimations, type InstanceRig } from './dynamic';
import { defaultFetch, fetchBytes, fetchJson, parseGlb, TaskQueue, type FetchLike } from './loader';
import { joinUrl, MANIFEST_FILE, parseManifest, type ManifestEntry, type ObjectsManifest } from './manifest';
import { PlaceholderFactory } from './placeholder';
import { shapeOf } from './specs';
import { MaterialVariants, hasEmissive, normalizeTint } from './variants';

export { DEFAULT_VISUAL_STATE } from './dynamic';
export { allModelIds, shapeOf, ENV_DIMS } from './specs';
export { parseManifest, MANIFEST_FILE } from './manifest';
export type { FetchLike } from './loader';

export type ModelStatus = 'unknown' | 'pending' | 'loaded' | 'failed';

export interface ModelLibraryOptions {
  /** Asset root, e.g. `import.meta.env.BASE_URL + 'assets/'` (trailing slash optional). */
  baseUrl: string;
  /** Inject a fetch implementation (tests, Electron custom protocols). Defaults to globalThis.fetch. */
  fetch?: FetchLike;
  /** Concurrent GLB downloads (1..16, default 6). */
  concurrency?: number;
  /** Per-request timeout in ms (default 20000). */
  timeoutMs?: number;
  /** Warning sink (default console.warn, de-duplicated). */
  onWarning?: (message: string, error?: unknown) => void;
}

/** Extra, non-contract helpers (dev viewer, diagnostics, tests). */
export interface ModelLibraryExt extends ModelLibrary {
  status(modelId: string): ModelStatus;
  /** True when the instance is (still) a procedural placeholder. */
  isPlaceholder(instance: THREE.Object3D): boolean;
  /** Ids listed in the loaded manifest. */
  manifestIds(): string[];
  /** Number of shared material variants created so far. */
  variantCount(): number;
}

interface Proto {
  scene: THREE.Group;
  bounds: THREE.Box3;
}

const SHADOWLESS_PARTS: ReadonlySet<string> = new Set(['screen', 'glow', 'bulb', 'flame', 'water', 'frost', 'broken']);

function underPart(o: THREE.Object3D, root: THREE.Object3D, names: ReadonlySet<string>): boolean {
  let n: THREE.Object3D | null = o;
  while (n && n !== root) {
    if (names.has(n.name)) return true;
    n = n.parent;
  }
  return false;
}

function prepareScene(scene: THREE.Group): number {
  let meshes = 0;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const mat = m.material as THREE.Material | THREE.Material[];
    const mats = Array.isArray(mat) ? mat : [mat];
    const transparent = mats.some((x) => x && x.transparent);
    const emissive = mats.some((x) => hasEmissive(x));
    const dynamicLight = underPart(m, scene, SHADOWLESS_PARTS);
    m.castShadow = !(transparent || dynamicLight || emissive);
    m.receiveShadow = true;
  });
  return meshes;
}

function boundsOf(scene: THREE.Group, entry: ManifestEntry | undefined): THREE.Box3 {
  if (entry?.bounds) {
    const { min, max } = entry.bounds;
    return new THREE.Box3(new THREE.Vector3(min[0], min[1], min[2]), new THREE.Vector3(max[0], max[1], max[2]));
  }
  const box = new THREE.Box3();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !underPart(m, scene, new Set(['broken']))) box.expandByObject(m);
  });
  return box;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[];
    for (const x of Array.isArray(mat) ? mat : [mat]) x?.dispose();
  });
}

function resourceDir(url: string): string {
  const i = url.lastIndexOf('/');
  return i >= 0 ? url.slice(0, i + 1) : '';
}

function normalizeBase(b: string): string {
  if (typeof b !== 'string') return '';
  return b === '' || b.endsWith('/') ? b : `${b}/`;
}

export function createModelLibrary(opts: ModelLibraryOptions): ModelLibraryExt {
  const base = normalizeBase(opts?.baseUrl ?? '');
  const fetchFn: FetchLike | null = opts?.fetch ?? defaultFetch();
  const concurrency = Math.max(1, Math.min(16, Math.floor(Number(opts?.concurrency) || 6)));
  const timeoutMs = Number.isFinite(opts?.timeoutMs) && (opts.timeoutMs as number) > 0 ? (opts.timeoutMs as number) : 20000;
  const queue = new TaskQueue(concurrency);
  const protos = new Map<string, Proto>();
  const status = new Map<string, ModelStatus>();
  const variants = new MaterialVariants();
  const placeholders = new PlaceholderFactory();
  const rigs = new WeakMap<THREE.Object3D, InstanceRig>();
  const upgrades = new Map<string, Set<WeakRef<THREE.Group> | THREE.Group>>();
  const scratch: ObjectVisualState = { ...DEFAULT_VISUAL_STATE };
  const warned = new Set<string>();
  let manifest: ObjectsManifest = { version: 0, objects: {} };
  let manifestDone = false;
  let total = 0;
  let settled = 0;
  let disposed = false;

  const warn = (key: string, message: string, err?: unknown): void => {
    if (warned.has(key)) return;
    warned.add(key);
    try {
      if (opts?.onWarning) opts.onWarning(message, err);
      else console.warn(`[models] ${message}`, err ?? '');
    } catch {
      /* a broken warning sink must never break loading */
    }
  };

  const trackPlaceholder = (id: string, g: THREE.Group): void => {
    // upgrade later if the model is still loading, or if the manifest itself has not arrived yet
    if (manifestDone ? status.get(id) !== 'pending' : false) return;
    let set = upgrades.get(id);
    if (!set) {
      set = new Set();
      upgrades.set(id, set);
    }
    set.add(typeof WeakRef === 'function' ? new WeakRef(g) : g);
  };

  const upgradePlaceholders = (id: string, proto: Proto): void => {
    const set = upgrades.get(id);
    upgrades.delete(id);
    if (!set) return;
    for (const ref of set) {
      const g = ref instanceof THREE.Object3D ? ref : ref.deref();
      if (!g) continue;
      const rig = rigs.get(g);
      if (!rig || !rig.placeholder) continue;
      try {
        const real = proto.scene.clone(true);
        while (g.children.length) g.remove(g.children[0]);
        for (const c of [...real.children]) g.add(c);
        g.userData.placeholder = false;
        const fresh = bindInstance(g, id, rig.tint, false);
        rigs.set(g, fresh);
        sanitizeState(DEFAULT_VISUAL_STATE, scratch);
        settleAnimations(fresh, scratch);
        applyState(fresh, scratch, Number.isFinite(rig.lastT) ? rig.lastT : 0, variants);
      } catch (e) {
        warn(`upgrade-${id}`, `could not upgrade placeholder for ${id}`, e);
      }
    }
  };

  const loadOne = async (id: string, entry: ManifestEntry): Promise<void> => {
    try {
      if (!fetchFn) throw new Error('no fetch implementation');
      const url = joinUrl(base, entry.file);
      const scene = await queue.run(async () => {
        const bytes = await fetchBytes(fetchFn, url, timeoutMs);
        if (disposed) return null;
        return parseGlb(bytes, resourceDir(url));
      });
      if (!scene) return;
      if (disposed) {
        disposeTree(scene);
        return;
      }
      if (prepareScene(scene) === 0) throw new Error('GLB contains no meshes');
      scene.name = id;
      const proto: Proto = { scene, bounds: boundsOf(scene, entry) };
      protos.set(id, proto);
      status.set(id, 'loaded');
      upgradePlaceholders(id, proto);
    } catch (e) {
      status.set(id, 'failed');
      upgrades.delete(id);
      warn(`load-${id}`, `model ${id} failed to load; using a placeholder`, e);
    } finally {
      settled++;
    }
  };

  const ready: Promise<void> = (async () => {
    try {
      if (!fetchFn) throw new Error('no fetch implementation');
      manifest = parseManifest(await fetchJson(fetchFn, joinUrl(base, MANIFEST_FILE), timeoutMs));
    } catch (e) {
      warn('manifest', 'objects manifest unavailable; every model will be a placeholder', e);
      manifest = { version: 0, objects: {} };
    }
    const entries = Object.entries(manifest.objects);
    total = entries.length;
    for (const [id] of entries) if (!status.has(id)) status.set(id, 'pending');
    manifestDone = true;
    // placeholders requested before the manifest arrived: drop the ones that can never be upgraded
    for (const id of [...upgrades.keys()]) if (status.get(id) !== 'pending') upgrades.delete(id);
    await Promise.all(entries.map(([id, e]) => loadOne(id, e)));
  })().catch((e: unknown) => {
    warn('init', 'model library initialisation failed', e);
    manifestDone = true;
  });

  const lib: ModelLibraryExt = {
    ready,

    progress(): number {
      if (!manifestDone) return 0;
      if (total === 0) return 1;
      return Math.min(1, settled / total);
    },

    has(modelId: string): boolean {
      return protos.has(modelId);
    },

    status(modelId: string): ModelStatus {
      return protos.has(modelId) ? 'loaded' : status.get(modelId) ?? 'unknown';
    },

    isPlaceholder(instance: THREE.Object3D): boolean {
      return rigs.get(instance)?.placeholder ?? false;
    },

    manifestIds(): string[] {
      return Object.keys(manifest.objects);
    },

    variantCount(): number {
      return variants.size;
    },

    create(modelId: string, tint?: string | null): THREE.Object3D {
      const id = typeof modelId === 'string' ? modelId : String(modelId);
      try {
        if (disposed) {
          const g = new THREE.Group();
          g.name = id;
          return g;
        }
        const t = normalizeTint(tint);
        const proto = protos.get(id);
        let inst: THREE.Group;
        let placeholder = false;
        if (proto) {
          inst = proto.scene.clone(true);
        } else {
          inst = placeholders.create(shapeOf(id));
          placeholder = true;
        }
        inst.name = id;
        inst.userData.modelId = id;
        const rig = bindInstance(inst, id, t, placeholder);
        rigs.set(inst, rig);
        sanitizeState(DEFAULT_VISUAL_STATE, scratch);
        settleAnimations(rig, scratch);
        applyState(rig, scratch, 0, variants);
        if (placeholder) trackPlaceholder(id, inst);
        return inst;
      } catch (e) {
        warn(`create-${id}`, `create(${id}) failed; returning an empty group`, e);
        const g = new THREE.Group();
        g.name = id;
        return g;
      }
    },

    update(instance: THREE.Object3D, state: ObjectVisualState, timeSec: number): void {
      if (!instance) return;
      const rig = rigs.get(instance);
      if (!rig) return;
      try {
        sanitizeState(state, scratch);
        applyState(rig, scratch, timeSec, variants);
      } catch (e) {
        warn(`update-${rig.id}`, `update(${rig.id}) failed`, e);
      }
    },

    bounds(modelId: string): THREE.Box3 {
      const p = protos.get(modelId);
      if (p) return p.bounds.clone();
      const e = manifest.objects[modelId];
      if (e?.bounds && status.get(modelId) === 'pending') {
        const { min, max } = e.bounds;
        return new THREE.Box3(new THREE.Vector3(min[0], min[1], min[2]), new THREE.Vector3(max[0], max[1], max[2]));
      }
      return placeholders.bounds(shapeOf(modelId));
    },

    release(instance: THREE.Object3D): void {
      // Geometry and materials are shared and library-owned (prototype + variant caches, freed by dispose());
      // releasing only unbinds the instance so the library keeps no reference to it.
      if (!instance) return;
      try {
        const rig = rigs.get(instance);
        if (!rig) return;
        rigs.delete(instance);
        const set = upgrades.get(rig.id);
        if (set) {
          for (const ref of [...set]) {
            const g = ref instanceof THREE.Object3D ? ref : ref.deref();
            if (!g || g === instance) set.delete(ref);
          }
          if (set.size === 0) upgrades.delete(rig.id);
        }
      } catch (e) {
        warn('release', 'release() failed', e);
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const p of protos.values()) disposeTree(p.scene);
      protos.clear();
      upgrades.clear();
      variants.dispose();
      placeholders.dispose();
    },
  };
  return lib;
}

/** True when `name` is a dynamic-part node name understood by the library (for tooling/tests). */
export function isDynamicPartName(name: string): boolean {
  return partKindOf(name) !== null;
}
