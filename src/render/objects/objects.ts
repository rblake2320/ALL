/**
 * Object manager: keeps one model instance per ObjectState (create via models.create, sync by id + rev,
 * GPU-dispose on removal with resource ref-counting), transforms for every placement kind, per-frame visual
 * state → models.update, lamp light sources, opening cuts for the wall layer, persistent FX (fires, fly swarms
 * over old dishes, music notes over playing stereos), hover rim, hide-while-moving and picking.
 */
import * as THREE from 'three';
import type { ModelLibrary, ObjectVisualState } from '../contracts';
import type { EdgeKey, ObjectState, WorldState } from '../../sim/types';
import { TICKS_PER_HOUR } from '../../sim/types';
import type { PhysicalSpec } from '../../shared/catalog';
import { DIM } from '../../shared/dimensions';
import { placementTransform, placementSignature, createPlacementTransform } from './placement';
import { computeVisualState, createVisualState, isCandleLight, type VisualEnv } from './visualState';
import { ObjectHighlighter } from './highlight';
import type { SpecResolver } from '../core/specs';
import type { FxSystem, EmitterHandle } from '../fx/fx';
import type { WindowGlow } from '../lighting/windowGlow';
import type { LampSource } from '../lighting/lighting';
import type { OpeningCut } from '../build/wallGeometry';
import type { ThrottledWarn } from '../core/diagnostics';
import { normalizeTint } from '../thumbs/thumbKey';
import { hashString } from '../core/math';
import { rayAabb } from '../picking/rayMath';
import { StaticBatcher } from './staticBatch';
import { StaticChunks, chunkKeyAt, type ChunkMember } from './chunks';
import { frameToScene, type ContentFrameLookup, type RegionFrame } from '../world/worldFrame';

type Kind = ObjectState['placement']['kind'];

interface ObjEntry {
  id: string;
  defId: string;
  tint: string | null;
  holder: THREE.Group;
  instance: THREE.Object3D;
  spec: PhysicalSpec | null;
  rev: number;
  sig: number;
  kind: Kind;
  edge: string | null;
  placeVisible: boolean;
  visual: ObjectVisualState;
  box: THREE.Box3;
  localBox: THREE.Box3;
  boxValid: boolean;
  fire: EmitterHandle[] | null;
  flies: EmitterHandle | null;
  notes: EmitterHandle | null;
  resources: string[];
  seen: number;
  facing: number;
  lampColor: THREE.Color | null;
  seed: number;
  isDoor: boolean;
  /** Per-object static batch (null = not batched: placeholder model, nothing batchable). */
  batch: THREE.Mesh | null;
  /** Chunk membership of the batch (floor/loose objects are merged into lot chunks). */
  member: ChunkMember | null;
  /** W-025 S5: region frame the object is drawn in (null = the home lot). */
  frame: RegionFrame | null;
}

export interface ObjectsContext {
  state: WorldState;
  env: VisualEnv;
  timeSec: number;
  /** Current wall height at an edge (0 = no wall). */
  wallHeight: (edge: EdgeKey) => number;
  hasWall: (edge: EdgeKey) => boolean;
  /** Is a zombie passing through the doorway at (x,z)? Swings doors open (decision #14d). */
  doorTraffic?: (x: number, z: number) => boolean;
}

export interface ObjectPick {
  objectId: string;
  t: number;
  point: THREE.Vector3;
}

const FAIL_RETRY_SEC = 5;

export class ObjectManager {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, ObjEntry>();
  private readonly failed = new Map<string, number>();
  private gen = 0;
  private hiddenId: string | null = null;
  private hoverId: string | null = null;
  private readonly highlighter = new ObjectHighlighter();
  private readonly tf = createPlacementTransform();
  private readonly resources = new Map<string, { res: { dispose(): void }; n: number }>();
  // openings
  private openingsDirty = true;
  private readonly openingMap = new Map<EdgeKey, OpeningCut>();
  private openingSig = 0;
  // lamp sources (pooled objects, no per-frame allocation)
  private readonly lampPool: LampSource[] = [];
  lampCount = 0;
  private readonly tmpBox = new THREE.Box3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly hits: THREE.Intersection[] = [];
  private clock = 0;
  private readonly batcher = new StaticBatcher();
  private readonly chunks: StaticChunks;
  /** Static batching on/off (diagnostics; on by default). */
  batching = true;
  /** Merge floor/loose objects' batches into lot chunks (diagnostics; on by default). */
  chunking = true;
  /**
   * W-025 S5: where objects of other regions are drawn (null = every object is home content, the legacy behaviour).
   * Objects of a region whose contents are not drawn now (warm / cold) are not instanced. They never join the home's
   * lot chunks or the home's wall openings.
   */
  regionFrames: ContentFrameLookup | null = null;
  private readonly frameTmp = { x: 0, z: 0 };

  constructor(
    private readonly models: ModelLibrary,
    private readonly specs: SpecResolver,
    private readonly fx: FxSystem,
    private readonly glow: WindowGlow,
    private readonly warn: ThrottledWarn,
  ) {
    this.group.name = 'objects';
    // every batchable mesh is worth folding once objects are merged into chunks
    this.batcher.minMeshes = 1;
    this.chunks = new StaticChunks(this.batcher.material);
    this.group.add(this.chunks.group);
  }

  get lamps(): readonly LampSource[] {
    return this.lampPool;
  }

  openings(): ReadonlyMap<EdgeKey, OpeningCut> {
    return this.openingMap;
  }

  openingsSignature(): number {
    return this.openingSig;
  }

  setHidden(id: string | null): void {
    this.hiddenId = typeof id === 'string' ? id : null;
  }

  setHover(id: string | null): void {
    this.hoverId = typeof id === 'string' ? id : null;
    const e = this.hoverId ? this.entries.get(this.hoverId) : undefined;
    this.highlighter.set(e ? e.instance : null);
  }

  /** World centre of an object instance (for FX/focus); null if unknown. */
  centerOf(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (e.boxValid) return e.box.getCenter(out);
    return out.copy(e.holder.position);
  }

  /** Per-frame sync. Never throws (per-object faults are contained). */
  sync(ctx: ObjectsContext, dt: number): void {
    this.clock += Number.isFinite(dt) ? dt : 0;
    const gen = ++this.gen;
    const objects = ctx.state && ctx.state.objects && typeof ctx.state.objects === 'object' ? ctx.state.objects : {};
    this.lampCount = 0;
    for (const id in objects) {
      const o = objects[id];
      if (!o || typeof o !== 'object' || typeof o.defId !== 'string') continue;
      let frame: RegionFrame | null = null;
      if (this.regionFrames && typeof o.regionId === 'string') {
        const f = this.regionFrames(o.regionId);
        if (f === null) continue;
        if (f !== 'home') frame = f;
      }
      try {
        this.syncOne(id, o, ctx, gen, frame);
      } catch (e) {
        this.warn.warn('obj-sync', `object ${id} (${o.defId}) sync failed`, e);
      }
    }
    for (const [id, e] of this.entries) {
      if (e.seen !== gen) this.remove(id, e);
    }
    if (this.openingsDirty) this.rebuildOpenings();
    try {
      this.chunks.flush();
    } catch (err) {
      this.warn.warn('obj-chunks', 'chunk rebuild failed', err);
    }
  }

  private syncOne(id: string, o: ObjectState, ctx: ObjectsContext, gen: number, frame: RegionFrame | null = null): void {
    let e = this.entries.get(id);
    const tint = normalizeTint(o.tint);
    if (e && (e.defId !== o.defId || e.tint !== tint)) {
      this.remove(id, e);
      e = undefined;
    }
    if (!e) {
      const failedAt = this.failed.get(id);
      if (failedAt !== undefined && this.clock - failedAt < FAIL_RETRY_SEC) return;
      e = this.create(id, o, tint) ?? undefined;
      if (!e) {
        this.failed.set(id, this.clock);
        return;
      }
      this.failed.delete(id);
    }
    e.seen = gen;
    const sig = placementSignature(o.placement);
    let moved = false;
    if (e.frame !== frame) {
      if (e.kind === 'opening') this.openingsDirty = true;
      e.frame = frame;
      e.rev = NaN;
    }
    if (e.rev !== o.rev || e.sig !== sig) {
      const wasOpening = e.kind === 'opening';
      e.rev = o.rev;
      e.sig = sig;
      this.applyTransform(e, o);
      moved = true;
      if (wasOpening || e.kind === 'opening') this.openingsDirty = true;
    }
    // visibility: placement, hidden-while-moving, wall cutaway for wall items/openings
    let vis = e.placeVisible && id !== this.hiddenId;
    if (vis && !e.frame && e.edge && (e.kind === 'wall' || e.kind === 'opening') && ctx.hasWall(e.edge)) {
      const h = ctx.wallHeight(e.edge);
      vis = e.kind === 'wall' ? h >= 1.35 : h >= 1.05;
    }
    e.holder.visible = vis;
    // visual state → library (per frame: flames flicker, screens animate)
    computeVisualState(o, e.spec, ctx.env, e.visual);
    if (e.isDoor && !e.visual.inUse && ctx.doorTraffic && ctx.doorTraffic(e.holder.position.x, e.holder.position.z)) e.visual.inUse = true;
    if (vis) {
      // hidden objects (held, moved in buy mode, on lowered walls) skip their per-frame animation
      try {
        this.models.update(e.instance, e.visual, ctx.timeSec);
      } catch (err) {
        this.warn.warn('obj-update-' + o.defId, `models.update failed for ${o.defId}`, err);
      }
    }
    this.syncFx(e, o, ctx, vis);
    if (vis && e.visual.lit && e.spec?.light) this.pushLamp(e);
    this.syncChunk(e, vis, moved);
  }

  /** Keep the object's static batch current (Paint variant swaps) and merged into the right lot chunk. */
  private syncChunk(e: ObjEntry, vis: boolean, moved: boolean): void {
    if (this.batcher.paintChanged(e.instance)) {
      // the library swapped a Paint material (dirt level / burning): re-bake this object's colours
      const merged = this.batcher.rebatch(e.defId, e.instance);
      if (!merged) {
        if (e.member) this.chunks.remove(e.member);
        e.batch = null;
        e.member = null;
        return;
      }
      e.batch = merged;
      if (!e.member) e.member = { batch: merged, castShadow: merged.castShadow, chunk: -1 };
      e.member.batch = merged;
      e.member.castShadow = merged.castShadow;
      // the new mesh starts visible; the chunk rebuild hides it again
      if (e.member.chunk >= 0) this.chunks.touch(e.member);
    }
    if (!e.batch || !e.member) return;
    const want = this.chunking && vis && !e.frame && (e.kind === 'floor' || e.kind === 'loose') ? chunkKeyAt(e.holder.position.x, e.holder.position.z) : -1;
    if (want !== e.member.chunk) this.chunks.assign(e.member, want);
    else if (moved && want >= 0) this.chunks.touch(e.member);
  }

  private create(id: string, o: ObjectState, tint: string | null): ObjEntry | null {
    let instance: THREE.Object3D;
    try {
      instance = this.models.create(o.defId, tint);
    } catch (err) {
      this.warn.warn('obj-create-' + o.defId, `models.create failed for ${o.defId}`, err);
      return null;
    }
    if (!instance || !(instance as THREE.Object3D).isObject3D) {
      this.warn.warn('obj-create-' + o.defId, `models.create returned no Object3D for ${o.defId}`);
      return null;
    }
    const spec = this.specs.get(o.defId);
    const holder = new THREE.Group();
    holder.name = `obj:${id}`;
    holder.userData.objectId = id;
    holder.add(instance);
    const isRug = spec?.layer === 'rug';
    const isOpening = spec?.placement === 'door' || spec?.placement === 'window';
    if (isOpening || o.placement?.kind === 'opening') this.glow.apply(instance, 'lot', 1);
    applyShadowFlags(instance, isRug);
    // what is actually drawn, measured before batching hides the originals (guards picking against stale manifests)
    const drawnBox = visibleLocalBox(instance, new THREE.Box3());
    // only batch real (loaded) models: placeholders are upgraded in place by the library later
    const batch = this.batching && safeHas(this.models, o.defId) ? this.batcher.batch(o.defId, instance) : null;
    // libraries with release() own instance resources; otherwise we ref-count geometries ourselves
    const resources = typeof this.models.release === 'function' ? [] : this.retain(instance);
    let localBox: THREE.Box3;
    try {
      const b = this.models.bounds(o.defId);
      localBox = b && !b.isEmpty() && Number.isFinite(b.min.x) ? b.clone() : this.fallbackBox(spec);
    } catch {
      localBox = this.fallbackBox(spec);
    }
    if (!drawnBox.isEmpty() && Number.isFinite(drawnBox.min.x) && Number.isFinite(drawnBox.max.y)) localBox.union(drawnBox);
    const e: ObjEntry = {
      id,
      defId: o.defId,
      tint,
      holder,
      instance,
      spec,
      rev: NaN,
      sig: NaN,
      kind: o.placement?.kind ?? 'held',
      edge: null,
      placeVisible: false,
      visual: createVisualState(),
      box: new THREE.Box3(),
      localBox,
      boxValid: false,
      fire: null,
      flies: null,
      notes: null,
      resources,
      seen: 0,
      facing: 0,
      lampColor: spec?.light ? safeColor(spec.light.color) : null,
      seed: (hashString(id) % 1000) / 100,
      isDoor: spec?.placement === 'door',
      batch,
      member: batch ? { batch, castShadow: batch.castShadow, chunk: -1 } : null,
      frame: null,
    };
    this.entries.set(id, e);
    this.group.add(holder);
    if (id === this.hoverId) this.highlighter.set(instance);
    return e;
  }

  private fallbackBox(spec: PhysicalSpec | null): THREE.Box3 {
    const w = spec?.footprint?.w ?? 1;
    const d = spec?.footprint?.d ?? 1;
    const h = spec?.height ?? 1;
    return new THREE.Box3(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, Math.max(0.05, h), d / 2));
  }

  private applyTransform(e: ObjEntry, o: ObjectState): void {
    const p = o.placement;
    e.kind = p && typeof p === 'object' ? p.kind : 'held';
    e.edge = p && (p.kind === 'wall' || p.kind === 'opening') && typeof p.edge === 'string' ? p.edge : null;
    placementTransform(p, e.spec?.footprint ?? null, this.tf);
    e.placeVisible = this.tf.visible;
    if (!this.tf.visible) {
      e.boxValid = false;
      return;
    }
    if (e.frame) {
      // W-025 S5: lot-local to its region → the region's place in the scene
      frameToScene(e.frame, this.tf.x, this.tf.z, this.frameTmp);
      e.holder.position.set(this.frameTmp.x, this.tf.y, this.frameTmp.z);
      e.holder.rotation.set(0, this.tf.yaw + e.frame.yaw, 0);
      e.facing = this.tf.yaw + e.frame.yaw;
    } else {
      e.holder.position.set(this.tf.x, this.tf.y, this.tf.z);
      e.holder.rotation.set(0, this.tf.yaw, 0);
      e.facing = this.tf.yaw;
    }
    e.holder.updateMatrixWorld(true);
    e.box.copy(e.localBox).applyMatrix4(e.holder.matrixWorld);
    e.boxValid = !e.box.isEmpty();
  }

  private pushLamp(e: ObjEntry): void {
    const light = e.spec!.light!;
    let src = this.lampPool[this.lampCount];
    if (!src) {
      src = { x: 0, y: 0, z: 0, bias: 0, color: new THREE.Color(), intensity: 0, distance: 0, flicker: false, seed: 0 };
      this.lampPool.push(src);
    }
    this.lampCount++;
    const h = Number.isFinite(light.height) ? light.height : 1.4;
    if (e.kind === 'wall') {
      // sconces: a little in front of the wall surface
      src.x = e.holder.position.x + Math.sin(e.facing) * 0.22;
      src.z = e.holder.position.z + Math.cos(e.facing) * 0.22;
      src.y = h;
    } else {
      src.x = e.holder.position.x;
      src.z = e.holder.position.z;
      src.y = e.holder.position.y + h;
    }
    src.bias = 0;
    if (e.lampColor) src.color.copy(e.lampColor);
    else src.color.setRGB(1, 0.76, 0.48);
    src.intensity = Number.isFinite(light.intensity) ? light.intensity : 4;
    src.distance = Number.isFinite(light.distance) ? light.distance : 5;
    src.flicker = isCandleLight(e.spec);
    src.seed = e.seed;
  }

  private syncFx(e: ObjEntry, o: ObjectState, ctx: ObjectsContext, visible: boolean): void {
    const spec = e.spec;
    const tags = spec?.tags ?? [];
    // fire: the fire item itself, or anything burning
    const burning = visible && (o.defId === 'item_fire' || e.visual.burning);
    if (burning) {
      if (!e.fire) e.fire = [this.fx.acquire('fireEmbers'), this.fx.acquire('fireFlames'), this.fx.acquire('fireSmoke')];
      const x = e.boxValid ? (e.box.min.x + e.box.max.x) / 2 : e.holder.position.x;
      const z = e.boxValid ? (e.box.min.z + e.box.max.z) / 2 : e.holder.position.z;
      const y = o.defId === 'item_fire' ? e.holder.position.y : e.boxValid ? Math.max(0.1, e.box.max.y * 0.55) : 0.4;
      for (const h of e.fire) {
        h.active = true;
        h.x = x;
        h.y = y;
        h.z = z;
      }
    } else if (e.fire) {
      for (const h of e.fire) this.fx.release(h);
      e.fire = null;
    }
    // Flies follow the SIM's flies flag (upkeep/mess.ts): dishes left out, spoiled food, full trash, rotten limbs —
    // and a nearby Fly Zapper clears it, so zapped swarms disappear here too. (This used to recompute "dish older than
    // 6 h" on its own and ignored zappers: owner report "flies stay next to my zapper".)
    const flies = visible && o.data?.flies === true;
    if (flies) {
      if (!e.flies) e.flies = this.fx.acquire('flySwarm');
      e.flies.active = true;
      e.flies.x = e.holder.position.x;
      e.flies.y = e.holder.position.y + 0.3;
      e.flies.z = e.holder.position.z;
    } else if (e.flies) {
      this.fx.release(e.flies);
      e.flies = null;
    }
    // music notes over a playing stereo
    const playing = visible && tags.includes('stereo') && (e.visual.inUse || o.data?.on === true || o.data?.playing === true) && e.visual.powered;
    if (playing) {
      if (!e.notes) e.notes = this.fx.acquire('musicNotes');
      e.notes.active = true;
      e.notes.x = e.holder.position.x;
      e.notes.y = (spec?.height ?? 1) + e.holder.position.y;
      e.notes.z = e.holder.position.z;
    } else if (e.notes) {
      this.fx.release(e.notes);
      e.notes = null;
    }
  }

  private rebuildOpenings(): void {
    this.openingsDirty = false;
    this.openingMap.clear();
    let sig = 0;
    for (const e of this.entries.values()) {
      if (e.kind !== 'opening' || !e.edge || e.frame) continue;
      const cut = openingCutFor(e.spec);
      this.openingMap.set(e.edge, cut);
      sig = (sig + hashString(e.edge) * 3 + hashString(e.defId)) % 2147483647;
    }
    this.openingSig = sig;
  }

  private retain(root: THREE.Object3D): string[] {
    const keys: string[] = [];
    const add = (r: { uuid: string; dispose(): void; userData?: Record<string, unknown> }) => {
      if (r.userData && (r.userData.windowGlow === true || r.userData.staticBatch === true)) return;
      const k = r.uuid;
      const slot = this.resources.get(k);
      if (slot) slot.n++;
      else this.resources.set(k, { res: r, n: 1 });
      keys.push(k);
    };
    root.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      // geometry only: materials belong to the library (shared tint/dirt variant cache) and are tiny
      if (m.geometry) add(m.geometry as unknown as { uuid: string; dispose(): void });
    });
    return keys;
  }

  private release(keys: string[]): void {
    for (const k of keys) {
      const slot = this.resources.get(k);
      if (!slot) continue;
      if (--slot.n <= 0) {
        this.resources.delete(k);
        try {
          slot.res.dispose();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private remove(id: string, e: ObjEntry): void {
    this.entries.delete(id);
    if (this.highlighter.current() === e.instance) this.highlighter.clear();
    this.group.remove(e.holder);
    if (e.member) this.chunks.remove(e.member);
    this.batcher.unbatch(e.instance);
    e.batch = null;
    e.member = null;
    if (e.fire) for (const h of e.fire) this.fx.release(h);
    if (e.flies) this.fx.release(e.flies);
    if (e.notes) this.fx.release(e.notes);
    if (typeof this.models.release === 'function') {
      try {
        this.models.release(e.instance);
      } catch (err) {
        this.warn.warn('obj-release', `models.release failed for ${e.defId}`, err);
      }
    } else this.release(e.resources);
    if (e.kind === 'opening') this.openingsDirty = true;
  }

  /** Nearest object hit: world-AABB prefilter then precise mesh raycast. */
  pick(ray: THREE.Ray, maxT = Infinity): ObjectPick | null {
    let best: ObjectPick | null = null;
    const o = ray.origin;
    const d = ray.direction;
    for (const e of this.entries.values()) {
      if (!e.holder.visible || !e.boxValid) continue;
      const b = e.box;
      const tb = rayAabb(o.x, o.y, o.z, d.x, d.y, d.z, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
      if (tb === Infinity || tb > maxT || (best && tb > best.t)) continue;
      this.raycaster.ray.copy(ray);
      this.raycaster.near = 0;
      this.raycaster.far = best ? best.t : maxT;
      this.hits.length = 0;
      let hitT = Infinity;
      let point: THREE.Vector3 | null = null;
      try {
        // only what is actually drawn: hidden parts (broken debris, eaten servings, off water) must not catch the
        // cursor — but the batcher's hidden originals stand for their (visible) merged copies
        const info = this.batcher.info(e.instance);
        this.raycastVisible(e.instance, info ? info.sources : null);
        if (this.hits.length > 0) {
          this.hits.sort(byDistance);
          hitT = this.hits[0].distance;
          point = this.hits[0].point.clone();
        }
      } catch {
        // fall back to the bounds hit
      }
      if (hitT === Infinity && !hasMeshes(e.instance)) {
        hitT = tb;
        point = ray.at(tb, new THREE.Vector3());
      }
      if (hitT < (best ? best.t : maxT) && point) best = { objectId: e.id, t: hitT, point };
    }
    return best;
  }

  private raycastVisible(o: THREE.Object3D, batched: readonly THREE.Mesh[] | null): void {
    if (!o.visible && !(batched && (o as THREE.Mesh).isMesh && batched.includes(o as THREE.Mesh))) return;
    if ((o as THREE.Mesh).isMesh && !o.userData.__rimShell) o.raycast(this.raycaster, this.hits);
    const kids = o.children;
    for (let i = 0; i < kids.length; i++) this.raycastVisible(kids[i], batched);
  }

  /** World AABB of an object (picking / thumbnails / focus). */
  boundsOf(id: string): THREE.Box3 | null {
    const e = this.entries.get(id);
    return e && e.boxValid ? e.box : null;
  }

  count(): number {
    return this.entries.size;
  }

  clear(): void {
    this.chunks.clear();
    for (const [id, e] of this.entries) this.remove(id, e);
    this.chunks.flush();
    this.failed.clear();
    this.openingsDirty = true;
    this.rebuildOpenings();
  }

  /** Live lot-chunk meshes (diagnostics). */
  chunkMeshes(): number {
    return this.chunks.meshCount();
  }

  dispose(): void {
    this.clear();
    this.chunks.dispose();
    this.highlighter.dispose();
    this.batcher.dispose();
    for (const slot of this.resources.values()) {
      try {
        slot.res.dispose();
      } catch {
        /* ignore */
      }
    }
    this.resources.clear();
  }
}

/**
 * Respect the library's shadow flags when it set any (it knows glass/emissive parts); otherwise apply a
 * heuristic. Rugs never cast; everything receives.
 */
export function applyShadowFlags(root: THREE.Object3D, isRug: boolean): void {
  let anyCasts = false;
  root.traverse((n) => {
    if ((n as THREE.Mesh).isMesh && n.castShadow) anyCasts = true;
  });
  root.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    m.receiveShadow = true;
    if (isRug) m.castShadow = false;
    else if (!anyCasts) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const glowy = mats.some((x) => {
        const s = x as THREE.MeshStandardMaterial;
        return !!x && (x.transparent || (s.emissive && s.emissiveIntensity > 0 && s.emissive.getHex() !== 0));
      });
      m.castShadow = !glowy;
    }
    // tiny parts (eyes, knobs, buttons) add shadow-pass draw calls but no visible shadow
    if (m.castShadow && m.geometry) {
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const r = m.geometry.boundingSphere ? m.geometry.boundingSphere.radius : 1;
      if (Number.isFinite(r) && r * maxScale(m) < SHADOW_MIN_RADIUS) m.castShadow = false;
    }
  });
}

/** Meshes smaller than this (bounding radius, metres) never cast shadows. */
export const SHADOW_MIN_RADIUS = 0.06;

function maxScale(o: THREE.Object3D): number {
  let s = 1;
  let n: THREE.Object3D | null = o;
  while (n) {
    s *= Math.max(Math.abs(n.scale.x), Math.abs(n.scale.y), Math.abs(n.scale.z));
    n = n.parent;
  }
  return s;
}

function safeHas(models: ModelLibrary, id: string): boolean {
  try {
    return models.has(id) === true;
  } catch {
    return false;
  }
}

function safeColor(c: unknown): THREE.Color {
  try {
    return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? new THREE.Color(c) : new THREE.Color('#ffc27a');
  } catch {
    return new THREE.Color('#ffc27a');
  }
}

const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();
const _gb = new THREE.Box3();

/** Instance-local box of the meshes that are currently drawn (hidden subtrees skipped). */
export function visibleLocalBox(root: THREE.Object3D, out: THREE.Box3): THREE.Box3 {
  out.makeEmpty();
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry && !m.userData.__rimShell) {
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox && !g.boundingBox.isEmpty()) {
        _rel.multiplyMatrices(_inv, m.matrixWorld);
        out.union(_gb.copy(g.boundingBox).applyMatrix4(_rel));
      }
    }
    for (const c of o.children) walk(c);
  };
  for (const c of root.children) walk(c);
  return out;
}

function byDistance(a: THREE.Intersection, b: THREE.Intersection): number {
  return a.distance - b.distance;
}

function hasMeshes(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) found = true;
  });
  return found;
}

/** Wall cut for an opening def: doors span 0..DOOR_HEIGHT, windows sit on the sill. */
export function openingCutFor(spec: Pick<PhysicalSpec, 'placement' | 'height' | 'tags'> | null | undefined): OpeningCut {
  const isDoor = spec?.placement === 'door' || (!!spec?.tags && spec.tags.includes('door'));
  const h = spec && Number.isFinite(spec.height) && spec.height > 0 ? spec.height : isDoor ? DIM.DOOR_HEIGHT : DIM.WINDOW_HEIGHT;
  if (isDoor) return { kind: 'door', width: DIM.DOOR_WIDTH, bottom: 0, top: Math.min(h, DIM.WALL_HEIGHT - 0.12) };
  return { kind: 'window', width: DIM.WINDOW_WIDTH, bottom: DIM.WINDOW_SILL, top: Math.min(DIM.WINDOW_SILL + h, DIM.WALL_HEIGHT - 0.1) };
}
