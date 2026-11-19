/**
 * Pet rig loader (W-013 render part). Loads `${baseUrl}manifest.pets.json`, then each species GLB it lists
 * (tools/blender/pets: one skeleton, skinned meshes `Pet_normal` + `Pet_undead`, nine looping in-place clips).
 * `create(species, variant)` returns a PetRig: a SkeletonUtils clone with its own geometry and materials (so
 * dispose() releases exactly what the rig owns), one variant shown, an AnimationMixer with a 0.25 s crossfade, and a
 * pose setter that follows the agents' convention (root.position = (x, y, z), rotation.y = facing, front +Z).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { defaultFetch, fetchBytes, fetchJson, TaskQueue, type FetchLike } from '../models/loader';

export type { FetchLike };

export const PET_MANIFEST_FILE = 'manifest.pets.json';
export const PET_VARIANTS = ['normal', 'undead'] as const;
export type PetVariant = (typeof PET_VARIANTS)[number];
/** Pet states the sim may ask for. Every one maps to a clip of the same name in manifest.pets.json. */
export const PET_ANIM_STATES = ['idle', 'walk', 'run', 'sit', 'sleep', 'eat', 'play'] as const;
export type PetAnimState = (typeof PET_ANIM_STATES)[number];
/** Extra clips the art ships (strays begging / bolting); accepted by name, not required by the sim. */
const EXTRA_CLIPS = ['beg', 'flee'] as const;
const VARIANT_NODE: Record<PetVariant, string> = { normal: 'Pet_normal', undead: 'Pet_undead' };
export const PET_CROSSFADE_SEC = 0.25;
const TIMEOUT_MS = 30000;

/**
 * Release the GPU-side resources a loaded or cloned scene holds: geometries, materials and the skeletons' bone
 * textures. Each object is released once even when meshes share it.
 */
export function disposeSceneResources(root: THREE.Object3D): void {
  const done = new Set<unknown>();
  const once = (x: { dispose(): void } | null | undefined) => {
    if (x && !done.has(x)) {
      done.add(x);
      x.dispose();
    }
  };
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!(o as THREE.Mesh).isMesh) return;
    once(m.geometry);
    for (const mm of Array.isArray(m.material) ? m.material : [m.material]) once(mm);
    if (m.isSkinnedMesh) once(m.skeleton);
  });
}

export function isPetVariant(v: unknown): v is PetVariant {
  return v === 'normal' || v === 'undead';
}

/** Clip name for a sim anim state; anything unknown idles. */
export function petClipFor(state: unknown): string {
  if (typeof state !== 'string') return 'idle';
  if ((PET_ANIM_STATES as readonly string[]).includes(state)) return state;
  if ((EXTRA_CLIPS as readonly string[]).includes(state)) return state;
  return 'idle';
}

interface PetTemplate {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
}

export class PetRig {
  readonly root = new THREE.Group();
  readonly species: string;
  readonly variant: PetVariant;
  private readonly inner: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly clips: Map<string, THREE.AnimationClip>;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly owned: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; skeletons: THREE.Skeleton[] } = { geometries: [], materials: [], skeletons: [] };
  private current: THREE.AnimationAction | null = null;
  private clipName = '';
  private disposed = false;

  constructor(tpl: PetTemplate, species: string, variant: PetVariant) {
    this.species = species;
    this.variant = variant;
    this.clips = tpl.clips;
    this.inner = SkeletonUtils.clone(tpl.scene);
    for (const v of PET_VARIANTS) {
      const node = this.inner.getObjectByName(VARIANT_NODE[v]);
      if (node) node.visible = v === variant;
    }
    const matCache = new Map<THREE.Material, THREE.Material>();
    this.inner.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry = m.geometry.clone();
      this.owned.geometries.push(m.geometry);
      // SkeletonUtils.clone gave this mesh its own skeleton (own bones, own bone texture): the rig owns it
      const sk = (m as THREE.SkinnedMesh).isSkinnedMesh ? (m as THREE.SkinnedMesh).skeleton : null;
      if (sk && !this.owned.skeletons.includes(sk)) this.owned.skeletons.push(sk);
      const cloneMat = (src: THREE.Material): THREE.Material => {
        let c = matCache.get(src);
        if (!c) {
          c = src.clone();
          matCache.set(src, c);
          this.owned.materials.push(c);
        }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(cloneMat) : cloneMat(m.material);
      m.castShadow = true;
      m.frustumCulled = false; // skinned bounds lag the animation (same rule as the zombie rigs)
    });
    this.root.name = `pet:${species}:${variant}`;
    this.root.add(this.inner);
    this.mixer = new THREE.AnimationMixer(this.inner);
    this.play('idle');
  }

  get currentClip(): string {
    return this.clipName;
  }

  hasClip(name: string): boolean {
    return this.clips.has(name);
  }

  /** Play the clip for a sim anim state, crossfading from the current one. No-op if already playing it. */
  play(state: unknown): void {
    if (this.disposed) return;
    const name = petClipFor(state);
    if (name === this.clipName && this.current) return;
    const clip = this.clips.get(name) ?? this.clips.get('idle');
    if (!clip) return;
    let action = this.actions.get(clip.name);
    if (!action) {
      action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      this.actions.set(clip.name, action);
    }
    action.reset().setEffectiveWeight(1).play();
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, PET_CROSSFADE_SEC, false);
    this.current = action;
    this.clipName = clip.name;
  }

  setPose(x: number, y: number, z: number, facing: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.root.position.set(x, Number.isFinite(y) ? y : 0, z);
    if (Number.isFinite(facing)) this.root.rotation.y = facing;
  }

  update(dt: number): void {
    if (this.disposed || !(dt > 0) || !Number.isFinite(dt)) return;
    this.mixer.update(Math.min(dt, 0.25));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    for (const clip of this.clips.values()) this.mixer.uncacheClip(clip);
    this.mixer.uncacheRoot(this.inner);
    this.root.removeFromParent();
    for (const g of this.owned.geometries) g.dispose();
    for (const m of this.owned.materials) m.dispose();
    for (const s of this.owned.skeletons) s.dispose();
    this.owned.geometries.length = 0;
    this.owned.materials.length = 0;
    this.owned.skeletons.length = 0;
  }
}

export interface PetLibrary {
  /** Loads every species and resolves when each has loaded or failed (never rejects). Getting it starts the load. */
  readonly ready: Promise<void>;
  species(): string[];
  /** Species whose GLB failed to load (logged; those pets are simply not drawn). */
  failed(): string[];
  /** Start loading one species (idempotent); resolves when it has loaded or failed. Nothing loads until asked. */
  load(species: string): Promise<void>;
  /** A rig for a LOADED species; for one that is not loaded yet it starts the load and returns null (try again later). */
  create(species: string, variant: PetVariant): PetRig | null;
  dispose(): void;
}

interface PetManifest {
  clips: string[];
  species: Map<string, string>;
}

export function parsePetManifest(json: unknown): PetManifest {
  const o = json as { clips?: unknown; species?: unknown } | null;
  if (!o || typeof o !== 'object' || !o.species || typeof o.species !== 'object') throw new Error('manifest.pets.json: missing species');
  const clips = Array.isArray(o.clips) ? o.clips.map((c) => (c as { name?: unknown }).name).filter((n): n is string => typeof n === 'string') : [];
  const species = new Map<string, string>();
  for (const [name, e] of Object.entries(o.species as Record<string, unknown>)) {
    const file = (e as { file?: unknown } | null)?.file;
    if (typeof file === 'string' && file.endsWith('.glb') && !file.includes('..')) species.set(name, file);
  }
  return { clips, species };
}

function joinUrl(base: string, file: string): string {
  if (!base) return file;
  return base.endsWith('/') ? base + file : `${base}/${file}`;
}

export function createPetLibrary(opts: { baseUrl: string; fetch?: FetchLike }): PetLibrary {
  const base = opts.baseUrl ?? '';
  const fetchFn = opts.fetch ?? defaultFetch();
  const templates = new Map<string, PetTemplate>();
  const failed: string[] = [];
  const queue = new TaskQueue(2);
  const loader = new GLTFLoader();
  let manifest: Promise<PetManifest | null> | null = null;
  const loading = new Map<string, Promise<void>>();
  let disposed = false;

  const getManifest = (): Promise<PetManifest | null> =>
    (manifest ??= (async () => {
      try {
        if (disposed) return null; // a disposed library fetches nothing
        if (!fetchFn) throw new Error('no fetch implementation');
        return parsePetManifest(await fetchJson(fetchFn, joinUrl(base, PET_MANIFEST_FILE), TIMEOUT_MS));
      } catch (e) {
        console.warn('[pets] manifest failed to load; pets will not be drawn', e);
        return null;
      }
    })());

  const load = (name: string): Promise<void> => {
    const have = loading.get(name);
    if (have) return have;
    const p = (async () => {
      if (disposed) return;
      const m = await getManifest();
      const file = m?.species.get(name);
      if (!file || !fetchFn || disposed) return;
      await queue.run(async () => {
        if (disposed) return;
        try {
          const bytes = await fetchBytes(fetchFn, joinUrl(base, file), TIMEOUT_MS);
          if (disposed) return; // disposed while the file was coming: do not even parse it
          const gltf = await loader.parseAsync(bytes, '');
          const clips = new Map<string, THREE.AnimationClip>();
          for (const c of gltf.animations ?? []) clips.set(c.name, c);
          // disposed while it was parsing: the finished scene belongs to nobody, release it
          if (disposed) disposeSceneResources(gltf.scene);
          else templates.set(name, { scene: gltf.scene, clips });
        } catch (e) {
          failed.push(name);
          console.warn(`[pets] ${name} failed to load`, e);
        }
      });
    })();
    loading.set(name, p);
    return p;
  };

  return {
    get ready() {
      return (async () => {
        const m = await getManifest();
        if (m) await Promise.all([...m.species.keys()].map(load));
      })();
    },
    species: () => [...templates.keys()],
    failed: () => [...failed],
    load,
    create(species, variant) {
      if (!isPetVariant(variant)) return null;
      const tpl = templates.get(species);
      if (!tpl) {
        if (!disposed && !failed.includes(species)) void load(species);
        return null;
      }
      return new PetRig(tpl, species, variant);
    },
    dispose() {
      disposed = true;
      for (const t of templates.values()) disposeSceneResources(t.scene);
      templates.clear();
      loading.clear();
      manifest = null;
    },
  };
}
