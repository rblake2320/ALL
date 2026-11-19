/**
 * Ambient wildlife renderer (W-075 render part). The sim recomputes the lot's critters from the seed and the clock
 * (src/sim/systems/wildlife, nothing is saved); this layer reads that list a few times a second and draws it with the
 * wildlife rigs (songbird, pigeon, squirrel, bat, frog; fireflies have no model). Like the pets, a species' model is
 * only fetched when one of its critters is inside the camera's view, and everything is released on dispose.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ambientWildlife, type Critter } from '../../sim/systems/wildlife';
import { defaultFetch, fetchBytes, fetchJson, TaskQueue, type FetchLike } from '../models/loader';
import { disposeSceneResources } from '../pets/rig';

export const WILDLIFE_MANIFEST_FILE = 'manifest.wildlife.json';
const TIMEOUT_MS = 30000;
const CROSSFADE_SEC = 0.2;
/** One-shot clips (they hold their last pose): everything else loops. */
const ONE_SHOT = new Set(['land', 'takeoff']);
const FALLBACK_CLIPS = ['idle', 'idle-tail', 'perch-idle', 'fly', 'walk'];
const READ_EVERY_SEC = 0.1;
const EASE_PER_SEC = 14;
const SNAP_TILES = 6;
export const WILDLIFE_VIEW_MARGIN = 3;

interface Template {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
}

export class WildRig {
  readonly root = new THREE.Group();
  private readonly inner: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly owned: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; skeletons: THREE.Skeleton[] } = { geometries: [], materials: [], skeletons: [] };
  private current: THREE.AnimationAction | null = null;
  private clipName = '';
  private disposed = false;

  constructor(
    private readonly tpl: Template,
    readonly species: string,
  ) {
    this.inner = SkeletonUtils.clone(tpl.scene);
    const matCache = new Map<THREE.Material, THREE.Material>();
    this.inner.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.name.startsWith('Wild_lod1')) m.visible = false; // LOD0 only (a handful of animals, close camera)
      m.geometry = m.geometry.clone();
      this.owned.geometries.push(m.geometry);
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
      m.frustumCulled = false;
    });
    this.root.name = `wildlife:${species}`;
    this.root.add(this.inner);
    this.mixer = new THREE.AnimationMixer(this.inner);
  }

  hasClip(name: string): boolean {
    return this.tpl.clips.has(name);
  }

  get currentClip(): string {
    return this.clipName;
  }

  play(state: string): void {
    if (this.disposed) return;
    const name = this.tpl.clips.has(state) ? state : (FALLBACK_CLIPS.find((c) => this.tpl.clips.has(c)) ?? [...this.tpl.clips.keys()][0]);
    if (!name || (name === this.clipName && this.current)) return;
    const clip = this.tpl.clips.get(name);
    if (!clip) return;
    let action = this.actions.get(name);
    if (!action) {
      action = this.mixer.clipAction(clip);
      if (ONE_SHOT.has(name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else action.setLoop(THREE.LoopRepeat, Infinity);
      this.actions.set(name, action);
    }
    action.reset().setEffectiveWeight(1).play();
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, CROSSFADE_SEC, false);
    this.current = action;
    this.clipName = name;
  }

  setPose(x: number, y: number, z: number, facing: number): void {
    if (![x, y, z].every(Number.isFinite)) return;
    this.root.position.set(x, y, z);
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
    for (const clip of this.tpl.clips.values()) this.mixer.uncacheClip(clip);
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

export interface WildlifeLibrary {
  /** Start loading one species (idempotent); nothing loads until asked. */
  load(species: string): Promise<void>;
  /** A rig for a LOADED species; otherwise starts the load and returns null. */
  create(species: string): WildRig | null;
  species(): string[];
  dispose(): void;
}

export function parseWildlifeManifest(json: unknown): Map<string, string> {
  const o = json as { species?: unknown } | null;
  if (!o || typeof o !== 'object' || !o.species || typeof o.species !== 'object') throw new Error('manifest.wildlife.json: missing species');
  const out = new Map<string, string>();
  for (const [name, e] of Object.entries(o.species as Record<string, unknown>)) {
    const file = (e as { file?: unknown } | null)?.file;
    if (typeof file === 'string' && file.endsWith('.glb') && !file.includes('..')) out.set(name, file);
  }
  return out;
}

export function createWildlifeLibrary(opts: { baseUrl: string; fetch?: FetchLike }): WildlifeLibrary {
  const base = opts.baseUrl ?? '';
  const join = (f: string) => (!base ? f : base.endsWith('/') ? base + f : `${base}/${f}`);
  const fetchFn = opts.fetch ?? defaultFetch();
  const templates = new Map<string, Template>();
  const failed = new Set<string>();
  const loading = new Map<string, Promise<void>>();
  const queue = new TaskQueue(2);
  const loader = new GLTFLoader();
  let manifest: Promise<Map<string, string> | null> | null = null;
  let disposed = false;
  const getManifest = () =>
    (manifest ??= (async () => {
      try {
        if (disposed) return null; // a disposed library fetches nothing
        if (!fetchFn) throw new Error('no fetch implementation');
        return parseWildlifeManifest(await fetchJson(fetchFn, join(WILDLIFE_MANIFEST_FILE), TIMEOUT_MS));
      } catch (e) {
        console.warn('[wildlife] manifest failed to load; wildlife will not be drawn', e);
        return null;
      }
    })());
  const load = (name: string): Promise<void> => {
    const have = loading.get(name);
    if (have) return have;
    const p = (async () => {
      if (disposed) return;
      const file = (await getManifest())?.get(name);
      if (!file || !fetchFn || disposed) return;
      await queue.run(async () => {
        if (disposed) return;
        try {
          const bytes = await fetchBytes(fetchFn, join(file), TIMEOUT_MS);
          if (disposed) return; // disposed while the file was coming: do not even parse it
          const gltf = await loader.parseAsync(bytes, '');
          const clips = new Map<string, THREE.AnimationClip>();
          for (const c of gltf.animations ?? []) clips.set(c.name, c);
          // disposed while it was parsing: the finished scene belongs to nobody, release it
          if (disposed) disposeSceneResources(gltf.scene);
          else templates.set(name, { scene: gltf.scene, clips });
        } catch (e) {
          failed.add(name);
          console.warn(`[wildlife] ${name} failed to load`, e);
        }
      });
    })();
    loading.set(name, p);
    return p;
  };
  return {
    load,
    create(species) {
      const tpl = templates.get(species);
      if (!tpl) {
        if (!disposed && !failed.has(species)) void load(species);
        return null;
      }
      return new WildRig(tpl, species);
    },
    species: () => [...templates.keys()],
    dispose() {
      disposed = true;
      for (const t of templates.values()) disposeSceneResources(t.scene);
      templates.clear();
      loading.clear();
      manifest = null;
    },
  };
}

interface Live {
  rig: WildRig;
  x: number;
  y: number;
  z: number;
  facing: number;
}

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class WildlifeLayer {
  readonly group = new THREE.Group();
  private readonly live = new Map<string, Live>();
  private critters: readonly Critter[] = [];
  private readAt = -Infinity;
  private readTick = -1;
  private renderRevision = 0;

  constructor(private readonly lib: WildlifeLibrary) {
    this.group.name = 'wildlife';
  }

  get count(): number {
    return this.live.size;
  }

  get materialRevision(): string {
    return this.live.size ? String(this.renderRevision) : '';
  }

  /** `world`: { seed, tick, lot: { width, depth } }; `timeSec`: the renderer's clock; `inView`: the camera test. */
  sync(
    world: { seed: number; tick: number; lot: { width: number; depth: number } },
    timeSec: number,
    dt: number,
    inView?: (x: number, z: number) => boolean,
    indoor?: (x: number, z: number) => boolean,
  ): void {
    if (this.readTick !== world.tick && (timeSec - this.readAt >= READ_EVERY_SEC || timeSec < this.readAt)) {
      this.readAt = timeSec;
      this.readTick = world.tick;
      this.critters = ambientWildlife(world.seed, 'home', world.tick, { width: world.lot.width, depth: world.lot.depth, indoor });
    }
    const k = 1 - Math.exp(-EASE_PER_SEC * Math.min(Math.max(dt, 0), 0.25));
    const seen = new Set<string>();
    for (const c of this.critters) {
      if (c.species === 'firefly') continue; // swarms are a particle effect, not a model
      seen.add(c.id);
      let l = this.live.get(c.id);
      if (!l) {
        if (inView && !inView(c.pos.x, c.pos.z)) continue;
        const rig = this.lib.create(c.species);
        if (!rig) continue;
        l = { rig, x: c.pos.x, y: c.pos.y, z: c.pos.z, facing: c.facing };
        this.live.set(c.id, l);
        this.renderRevision++;
        this.group.add(rig.root);
      }
      if (Math.hypot(c.pos.x - l.x, c.pos.z - l.z) > SNAP_TILES) {
        l.x = c.pos.x;
        l.y = c.pos.y;
        l.z = c.pos.z;
        l.facing = c.facing;
      } else {
        l.x += (c.pos.x - l.x) * k;
        l.y += (c.pos.y - l.y) * k;
        l.z += (c.pos.z - l.z) * k;
        l.facing += angleDiff(c.facing, l.facing) * k;
      }
      l.rig.setPose(l.x, l.y, l.z, l.facing);
      l.rig.play(c.anim);
      l.rig.update(dt);
    }
    for (const [id, l] of this.live) {
      if (seen.has(id)) continue;
      l.rig.dispose();
      this.live.delete(id);
      this.renderRevision++;
    }
  }

  dispose(): void {
    for (const l of this.live.values()) l.rig.dispose();
    this.live.clear();
    this.group.removeFromParent();
  }
}
