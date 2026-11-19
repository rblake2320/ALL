/**
 * ASSETS-CHARACTERS entry point: createCharacterFactory({ baseUrl }) -> CharacterFactory.
 *
 * Loads public/assets/models/characters/zombie.glb once; every create() returns a ZombieRig handle whose root
 * never changes. Until the GLB is ready (or if it fails) the handle drives a procedural capsule rig, then swaps
 * in the skinned GLB rig and replays its state. No method ever throws.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CharacterFactory, ZombieRig } from '../contracts';
import type { AnyAnimState, CarryItem, Expression, LimbState, ZombieAppearance } from '../../shared/appearance';
import type { BodyId } from '../../shared/cast';
import { isLocalAssetUrl } from '../../shared/assetOrigin';
import { parseCarryAnchors } from './anchors';
import { CarryLibrary } from './carry';
import { CastLibrary } from './cast';
import type { CastLibraryStats } from './cast';
import { CastParts, CastRig } from './castRig';
import { prepareClips } from './clips';
import { clamp01, finiteOr } from './colors';
import { DEFAULT_LID_CLOSURE } from './face';
import { CapsuleRig } from './fallback';
import type { FaceMorph } from './names';
import {
  bodyOf, sanitizeAnyAnim, sanitizeAppearance, sanitizeCarry, sanitizeExpression, sanitizeLimbs, sanitizeSpeed,
} from './plan';
import { GltfRig } from './rig';
import type { HighlightMode, RigImpl, RigStats, RigTemplate } from './rig';

export { sanitizeAppearance, sanitizeLimbs, visibilityPlan, resolveAnim, effectiveAnim, sanitizeAnyAnim, bodyOf, castHeightScale } from './plan';
export type { RigStats } from './rig';
export type { CastLibraryStats } from './cast';

export const ZOMBIE_GLB = 'models/characters/zombie.glb';

export interface CharacterFactoryOptions {
  baseUrl: string;
  /** Pre-parsed glTF (tests / tools) - skips network loading. */
  gltf?: GLTF | Promise<GLTF>;
  /** Custom loader (defaults to GLTFLoader.loadAsync). */
  load?: (url: string, onProgress: (fraction: number) => void) => Promise<GLTF>;
  /** Optional logger for recoverable problems (defaults to console.warn once per message). */
  warn?: (msg: string, err?: unknown) => void;
  /** Cast body GLB loader (tests / tools; defaults to GLTFLoader.loadAsync). */
  loadCast?: (url: string) => Promise<GLTF>;
  /** manifest.cast.json loader (defaults to fetch + JSON). */
  loadCastManifest?: (url: string) => Promise<unknown>;
  /** Which file a premium body loads (src/shared/premiumBodies.ts); default 'high'. */
  premiumDetail?: () => 'high' | 'low';
  /**
   * Network reachability (defaults to `navigator.onLine`, or always true when `baseUrl` is served from local files:
   * the desktop app's app:// protocol). While it reports false a cast body that is not loaded yet
   * is NOT fetched — no failed request, no console noise: the zombie keeps the classic body and the swap is retried
   * when the browser comes back online (W-050 offline play).
   */
  online?: () => boolean;
  /** Re-run a callback when connectivity returns (defaults to the window 'online' event). Returns an unsubscribe. */
  onOnline?: (fn: () => void) => () => void;
}

export interface ZombieRigDebug extends ZombieRig {
  /** 'gltf' once the skinned rig is live, 'fallback' while (or if) the capsule stands in, 'cast' for a cast body. */
  readonly kind: 'gltf' | 'fallback' | 'cast';
  /** Body the live implementation shows ('classic' for the procedural / capsule rigs). */
  readonly body: BodyId;
  /** Body the appearance asks for (differs from `body` while a cast GLB loads, or for good when it failed). */
  readonly wantedBody: BodyId;
  stats(): RigStats;
  readonly impl: RigImpl;
}

const HIGHLIGHT_MODES: readonly HighlightMode[] = ['none', 'hover', 'selected'];

function makeWarn(custom?: (m: string, e?: unknown) => void): (m: string, e?: unknown) => void {
  if (custom) return custom;
  const seen = new Set<string>();
  return (m, e) => {
    if (seen.has(m)) return;
    seen.add(m);
    console.warn(`[characters] ${m}`, e ?? '');
  };
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v && typeof v === 'object') return v as T;
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Build the shared template from a parsed glTF (throws on structurally unusable assets). */
export function prepareTemplate(gltf: GLTF, carry: CarryLibrary): RigTemplate {
  const scene = gltf.scene;
  const rig = scene.getObjectByName('Rig');
  if (!rig || !scene.getObjectByName('pelvis') || !scene.getObjectByName('head')) {
    throw new Error('zombie.glb has no Rig/pelvis/head');
  }
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material;
    // skin shader reads `_rot`; give skin meshes without the mask a zero attribute
    if (mat && mat.name === 'Skin' && !mesh.geometry.getAttribute('_rot')) {
      const n = mesh.geometry.getAttribute('position').count;
      mesh.geometry.setAttribute('_rot', new THREE.BufferAttribute(new Float32Array(n), 1));
    }
  });
  const carryPoseRaw = parseJson<Record<string, number[]>>(rig.userData.carryPose, {});
  const carryPose = new Map<string, THREE.Quaternion>();
  for (const [bone, q] of Object.entries(carryPoseRaw)) {
    if (Array.isArray(q) && q.length === 4 && q.every((x) => Number.isFinite(x))) {
      carryPose.set(bone, new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize());
    }
  }
  const lidClosure = parseJson<Partial<Record<FaceMorph, number>>>(rig.userData.lidClosure, DEFAULT_LID_CLOSURE);
  const anchors = parseCarryAnchors(rig.userData.carryAnchors);
  return { scene, clips: prepareClips(gltf.animations), mirrored: new Map(), carryPose, anchors, lidClosure, carry };
}

/**
 * Release the GPU-side resources of a parsed glTF that will never be used (factory disposed, or mid-load).
 * Shared materials / skeletons are disposed exactly once.
 */
export function disposeGltf(gltf: GLTF | null | undefined): void {
  const done = new Set<{ dispose(): void }>();
  const once = (x: { dispose(): void } | null | undefined) => {
    if (!x || done.has(x)) return;
    done.add(x);
    x.dispose();
  };
  gltf?.scene?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    once(m.geometry);
    const mat = m.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) mat.forEach(once);
    else once(mat);
    once((m as THREE.SkinnedMesh).skeleton);
  });
}

class ZombieRigHandle implements ZombieRigDebug {
  readonly root = new THREE.Group();
  private _impl: RigImpl;
  private app: ZombieAppearance;
  private limbs: LimbState;
  private decay = 0;
  private anim: AnyAnimState = 'idle';
  private expr: Expression = 'neutral';
  private talking = false;
  private carry: CarryItem | null = null;
  private highlight: HighlightMode = 'none';
  private speed = 1;
  private disposed = false;
  private _renderRevision = 0;

  constructor(
    impl: RigImpl,
    app: ZombieAppearance,
    limbs: LimbState,
    private readonly warn: (m: string, e?: unknown) => void,
    private readonly onDispose: (h: ZombieRigHandle) => void,
    /** Called when the appearance asks for a body the live implementation does not show. */
    private readonly onBody: (h: ZombieRigHandle) => void = () => undefined,
  ) {
    this.root.name = 'ZombieRig';
    this.app = app;
    this.limbs = limbs;
    this._impl = impl;
    this.root.add(impl.object);
    this.replay();
  }

  get kind(): 'gltf' | 'fallback' | 'cast' {
    return this._impl.kind;
  }

  get renderRevision(): number {
    return this._renderRevision;
  }

  get body(): BodyId {
    const i = this._impl;
    return i instanceof CastRig ? i.body : 'classic';
  }

  get wantedBody(): BodyId {
    return bodyOf(this.app);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get impl(): RigImpl {
    return this._impl;
  }

  private safe(label: string, fn: () => void): void {
    if (this.disposed) return;
    try {
      fn();
    } catch (e) {
      this.warn(`${label} failed`, e);
    }
  }

  private replay(): void {
    const i = this._impl;
    this.safe('replay', () => {
      i.setAppearance(this.app);
      i.setLimbs(this.limbs);
      i.setDecay(this.decay);
      i.setAnim(this.anim);
      i.setExpression(this.expr);
      i.setTalking(this.talking);
      i.setCarry(this.carry);
      i.setHighlight(this.highlight);
      i.setMoveSpeed(this.speed);
      i.update(0);
    });
  }

  /** Swap in another implementation (capsule -> GLB, classic <-> cast body) keeping the same root and state. */
  upgrade(next: RigImpl): void {
    if (this.disposed) {
      next.dispose();
      return;
    }
    const old = this._impl;
    this._impl = next;
    this._renderRevision++;
    this.root.add(next.object);
    this.replay();
    this.safe('dispose previous rig', () => old.dispose());
  }

  setAppearance(app: ZombieAppearance): void {
    const nextAppearance = sanitizeAppearance(app);
    // Any appearance field can introduce or replace materials (including optional
    // body accessories added by content branches), so body identity alone is not
    // a sufficient warm-up invalidation key.
    if (JSON.stringify(nextAppearance) !== JSON.stringify(this.app)) this._renderRevision++;
    this.app = nextAppearance;
    if (this.wantedBody !== this.body) this.safe('body switch', () => this.onBody(this));
    this.safe('setAppearance', () => this._impl.setAppearance(this.app));
  }

  setLimbs(limbs: LimbState): void {
    this.limbs = sanitizeLimbs(limbs);
    this._renderRevision++;
    this.safe('setLimbs', () => this._impl.setLimbs(this.limbs));
  }

  setDecay(level: number): void {
    this.decay = clamp01(finiteOr(level, 0));
    this.safe('setDecay', () => this._impl.setDecay(this.decay));
  }

  setAnim(state: AnyAnimState): void {
    this.anim = sanitizeAnyAnim(state);
    this.safe('setAnim', () => this._impl.setAnim(this.anim));
  }

  setExpression(expr: Expression): void {
    this.expr = sanitizeExpression(expr);
    this.safe('setExpression', () => this._impl.setExpression(this.expr));
  }

  setTalking(on: boolean): void {
    this.talking = on === true;
    this.safe('setTalking', () => this._impl.setTalking(this.talking));
  }

  setCarry(item: CarryItem | null): void {
    this.carry = sanitizeCarry(item);
    this.safe('setCarry', () => this._impl.setCarry(this.carry));
  }

  setHighlight(mode: 'none' | 'hover' | 'selected'): void {
    this.highlight = HIGHLIGHT_MODES.includes(mode) ? mode : 'none';
    this.safe('setHighlight', () => this._impl.setHighlight(this.highlight));
  }

  setMoveSpeed(scale: number): void {
    this.speed = sanitizeSpeed(scale);
    this.safe('setMoveSpeed', () => this._impl.setMoveSpeed(this.speed));
  }

  update(dtSec: number): void {
    if (this.disposed) return;
    const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
    try {
      this._impl.update(dt); // hot path: no closure allocation
    } catch (e) {
      this.warn('update failed', e);
    }
  }

  headTop(out: THREE.Vector3): THREE.Vector3 {
    try {
      if (!this.disposed) {
        this._impl.headTop(out);
        if (Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)) return out;
      }
    } catch (e) {
      this.warn('headTop failed', e);
    }
    this.root.updateWorldMatrix(true, false);
    return out.set(0, 1.78, 0).applyMatrix4(this.root.matrixWorld);
  }

  stats(): RigStats {
    try {
      return this._impl.stats();
    } catch {
      return { drawCalls: 0, triangles: 0, visibleNodes: [], clip: this.anim };
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.safe('dispose', () => this._impl.dispose());
    this.disposed = true;
    this.root.removeFromParent();
    this.onDispose(this);
  }
}

export function createCharacterFactory(opts: CharacterFactoryOptions): CharacterFactory & {
  /** Template once loaded (null while loading / after failure). */
  template(): RigTemplate | null;
  /** True when the GLB failed and rigs use the capsule fallback permanently. */
  failed(): boolean;
  /** Cast body cache state (loaded / idle / ref counts / failed). */
  castStats(): CastLibraryStats;
  /** Resolves when every cast body requested so far has loaded or failed (tests / dev harness). */
  castSettled(): Promise<void>;
  /** W-130: can `body` be shown right now? (classic is always ready) */
  bodyStatus(body: string): 'ready' | 'loading' | 'offline' | 'unavailable';
} {
  const warn = makeWarn(opts?.warn);
  const base = typeof opts?.baseUrl === 'string' ? opts.baseUrl : 'assets/';
  const url = (base.endsWith('/') ? base : base + '/') + ZOMBIE_GLB;
  const carry = new CarryLibrary();
  const live = new Set<ZombieRigHandle>();
  let tpl: RigTemplate | null = null;
  let failed = false;
  let disposed = false;
  let progress = 0;

  const load = async (): Promise<GLTF> => {
    if (opts?.gltf) return opts.gltf;
    if (opts?.load) return opts.load(url, (f) => (progress = clamp01(f)));
    const loader = new GLTFLoader();
    return loader.loadAsync(url, (ev) => {
      if (ev && ev.total > 0) progress = clamp01(ev.loaded / ev.total) * 0.98;
    });
  };

  let resolveBody: (h: ZombieRigHandle) => void = () => undefined;
  const ready: Promise<void> = (async () => {
    try {
      const gltf = await load();
      if (disposed) {
        disposeGltf(gltf);
        return;
      }
      tpl = prepareTemplate(gltf, carry);
      for (const h of [...live]) if (h.kind === 'fallback') resolveBody(h);
    } catch (e) {
      failed = true;
      warn(`could not load ${url}; using procedural fallback rigs`, e);
    } finally {
      progress = 1;
    }
  })();

  // ── network reachability: never start a cast download while offline (it could only fail, loudly)
  // (assets served from local files — the desktop app's app:// protocol — need no network and are never gated)
  const localAssets = isLocalAssetUrl(base);
  const online = opts?.online ?? ((): boolean => localAssets || typeof navigator === 'undefined' || navigator.onLine !== false);
  const onOnline =
    opts?.onOnline ??
    ((fn: () => void): (() => void) => {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => undefined;
      window.addEventListener('online', fn);
      return () => window.removeEventListener('online', fn);
    });
  let offlineWait: (() => void) | null = null;
  /** Retry every handle still waiting for a cast body once the network is back (one listener, removed after use). */
  const retryWhenOnline = (): void => {
    if (offlineWait || disposed) return;
    offlineWait = onOnline(() => {
      offlineWait?.();
      offlineWait = null;
      for (const x of [...live]) if (x.wantedBody !== x.body) resolveBody(x);
    });
  };

  // ── cast bodies: lazy per-body GLBs, ref-counted templates, swapped in place when they arrive
  const parts = new CastParts();
  const pending = new Set<Promise<unknown>>();
  const cast = new CastLibrary({
    baseUrl: base,
    after: ready,
    classic: () => tpl,
    warn,
    online,
    premiumDetail: opts?.premiumDetail,
    loadGlb: opts?.loadCast ?? ((u) => new GLTFLoader().loadAsync(u)),
    loadManifest: opts?.loadCastManifest ?? (async (u) => {
      if (typeof fetch !== 'function') throw new Error('fetch unavailable');
      const r = await fetch(u);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
  });
  /** Best classic implementation available right now (default look: the handle replays its state). */
  const classicImpl = (): RigImpl => {
    const a = sanitizeAppearance(undefined);
    const l = sanitizeLimbs(undefined);
    if (tpl && !disposed) {
      try {
        return new GltfRig(tpl, a, l);
      } catch (e) {
        warn('GLB rig creation failed; using fallback', e);
      }
    }
    return new CapsuleRig(a, l, carry);
  };
  const castImpl = (want: BodyId, a: ZombieAppearance, l: LimbState): RigImpl | null => {
    if (want === 'classic' || disposed) return null;
    const t = cast.get(want);
    if (!t) return null;
    try {
      return new CastRig(t, cast, carry, parts, a, l);
    } catch (e) {
      warn(`cast body '${want}' rig creation failed; keeping the classic body`, e);
      return null;
    }
  };
  /**
   * Bring a handle's implementation in line with what its appearance asks for: a ready cast body is swapped in at
   * once; a body still loading is requested (the current rig stays until it arrives, then this runs again); a
   * failed body or 'classic' gets the best classic rig (capsule -> GLB upgrade included).
   */
  resolveBody = (h: ZombieRigHandle): void => {
    if (disposed || h.isDisposed) return;
    const want = h.wantedBody;
    if (want !== 'classic') {
      if (h.body === want) return;
      const next = castImpl(want, sanitizeAppearance(undefined), sanitizeLimbs(undefined));
      if (next) {
        h.upgrade(next);
        return;
      }
      // (a ready template whose rig cannot be built counts as failed: never re-request it in a loop)
      if (!cast.get(want) && cast.state(want) === 'idle' && !cast.isDisposed && !online()) {
        // offline and not cached: degrade silently to the classic body; swap when the network returns
        retryWhenOnline();
      } else if (!cast.get(want) && cast.state(want) !== 'failed' && !cast.isDisposed) {
        const p = cast.request(want).then(() => resolveBody(h));
        pending.add(p);
        void p.finally(() => pending.delete(p));
        // while it loads keep the current body - but a capsule still gets the classic GLB when that is ready
        if (h.kind !== 'fallback' || !tpl) return;
      }
    }
    if (h.body !== 'classic' || (h.kind === 'fallback' && tpl)) h.upgrade(classicImpl());
  };

  return {
    ready,
    progress: () => progress,
    template: () => tpl,
    failed: () => failed,
    castStats: () => cast.stats(),
    bodyStatus(body: string) {
      if (!body || body === 'classic' || cast.get(body as never)) return 'ready';
      if (cast.isDisposed || cast.state(body as never) === 'failed') return 'unavailable';
      if (!online()) return 'offline';
      return 'loading';
    },
    async castSettled(): Promise<void> {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    create(app: ZombieAppearance, limbs: LimbState): ZombieRig {
      const a = sanitizeAppearance(app);
      const l = sanitizeLimbs(limbs);
      let impl: RigImpl | null = castImpl(bodyOf(a), a, l);
      if (!impl) {
        try {
          impl = tpl && !disposed ? new GltfRig(tpl, a, l) : new CapsuleRig(a, l, carry);
        } catch (e) {
          warn('GLB rig creation failed; using fallback', e);
          impl = new CapsuleRig(a, l, carry);
        }
      }
      const h: ZombieRigHandle = new ZombieRigHandle(impl, a, l, warn, (x) => live.delete(x), (x) => resolveBody(x));
      if (!disposed) {
        live.add(h);
        if (h.wantedBody !== h.body) resolveBody(h);
      }
      return h;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      offlineWait?.();
      offlineWait = null;
      for (const h of [...live]) h.dispose();
      live.clear();
      if (tpl) disposeGltf({ scene: tpl.scene } as GLTF);
      cast.dispose();
      parts.dispose();
      carry.dispose();
      tpl = null;
    },
  };
}
