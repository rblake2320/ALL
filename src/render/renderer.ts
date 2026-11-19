/**
 * RendererAPI implementation — owns the WebGL renderer, scene graph and every render subsystem, and turns
 * simulation state + events into frames. frame() and consumeEvents() never throw.
 */
import * as THREE from 'three';
import type {
  BubbleAnchor,
  BuildOverlay,
  CameraState,
  CharacterFactory,
  ModelLibrary,
  PickResult,
  PlacementGhost,
  PreviewStage,
  AutoQualityStatus,
  GraphicsInfo,
  QualityLevel,
  QualitySetting,
  RendererAPI,
  ViewMode,
  WallMode,
} from './contracts';
import type { SimEvent, SimulationAPI } from '../sim/contracts';
import type { AgentId, EdgeKey, ObjectId, Vec2, WorldState } from '../sim/types';
import { TICK_MINUTES } from '../sim/types';
import { START_MINUTE_OF_DAY } from '../sim/time';
import { qualitySettings, effectivePixelRatio, internalResolution, isQualityLevel, type QualitySettings } from './core/quality';
import { AutoQualityGovernor, classifyGpu, isAutoLevel, minLevel as minLevelOf, type AutoLevel, type GpuClass } from './core/autoQuality';
import { ThrottledWarn, FpsMeter } from './core/diagnostics';
import { AgentMaterialWarmupGate } from './core/agentMaterialWarmup';
import { SpecResolver } from './core/specs';
import { PostPipeline } from './core/post';
import { dioramaStrength, focusTarget, smoothFocus } from './core/diorama';
import { CameraRig } from './camera/cameraRig';
import { viewDirection } from './camera/cameraMath';
import type { Perspective } from './camera/perspective';
import { Lighting, type LampSource } from './lighting/lighting';
import { fullMoonTonight } from './lighting/keyframes';
import { WindowGlow } from './lighting/windowGlow';
import { WorldDressing } from './world/dressing';
import { CarpoolHearse } from './world/carpool';
import { FloorLayer } from './build/floors';
import { WallLayer } from './build/walls';
import { RoofLayer } from './roofs/roofLayer';
import { ObjectManager, type ObjectsContext } from './objects/objects';
import { AgentManager, AGENT_FULL_DETAIL_MAX, AGENT_FULL_DETAIL_MAX_PHONE } from './agents/agents';
import { PetLayer, PET_VIEW_MARGIN, type PetLibrary } from './pets';
import { WildlifeLayer, WILDLIFE_VIEW_MARGIN, type WildlifeLibrary } from './wildlife';
import { FxSystem } from './fx/fx';
import { fxAnchor, type FxAnchorSources } from './fx/fxEvents';
import { SoulWisp } from './overlays/soulWisp';
import { markerReducedMotion, prefersReducedMotion, QuestMarker } from './overlays/questMarker';
import { storyTargetOf, type StoryTarget } from '../shared/storyTarget';
import { solveFocus } from '../shared/framing';
import { PlacementGhostView } from './overlays/ghost';
import { BuildOverlayView } from './overlays/buildOverlay';
import { GridOverlay } from './overlays/grid';
import { SnapMarkers } from './overlays/snapMarkers';
import { Picker } from './picking/picker';
import { gridPickAt } from './picking/gridPick';
import { resolvePick } from './picking/scenePick';
import { encodeSnapshot } from './core/snapshot';
import { ThumbnailRenderer } from './thumbs/thumbnails';
import { createPreviewStage } from './thumbs/previewStage';
import { clamp, finiteOr, safeReady, delay } from './core/math';
import { WorldView, type WorldViewStats } from './world/worldView';
import { followFrameOffset, type FollowOffset } from './camera/followFraming';
import type { FrameRect } from '../shared/framing';
import { HomeShellLibrary } from './world/homeShells';
import { rayPlaneY } from './picking/rayMath';
import { lotToWorld, type LotPlacement, type RegionId, type SelectedActorView, type SignView } from '../shared/world';
import type { ObjectVisualState } from './contracts';
import type { RenderStats, RendererDebug } from './core/stats';

export type { RenderStats, RendererDebug } from './core/stats';

export interface RendererDeps {
  models: ModelLibrary;
  characters: CharacterFactory;
  /** Asset root for the homes manifest (W-025 S5 neighbour shells); default 'assets/' (relative to the page). */
  assetBaseUrl?: string;
  /** Optional pet rig library (W-013): draws the world's optional `pets` / `strays` arrays; absent → no pets. */
  pets?: PetLibrary;
  /** Optional ambient-wildlife rig library (W-075); absent → no wildlife. */
  wildlife?: WildlifeLibrary;
}

/** Viewports whose short side is at most this (CSS px) use the phone render profile (§1.4 radii, no warm shadows). */
export const PHONE_PROFILE_MAX_SIDE = 500;

const ASSET_TIMEOUT_MS = 30000;
/** Agents beat furniture hits up to this much further along the ray (tiles). */
const AGENT_PICK_BIAS = 0.35;
/** ≈ 64 KB of base64 payload (platform SaveMeta.thumbnail limit). */
const SNAPSHOT_MAX_CHARS = 64 * 1024;
const WALL_MODES: readonly WallMode[] = ['up', 'cutaway', 'down'];
/** A close view whose zombie has had no rendered pose for this long returns to the overview. */
const PERSPECTIVE_LOST_SEC = 0.75;
const VIEW_MODES: readonly ViewMode[] = ['live', 'buy', 'build'];

export class Renderer implements RendererAPI, RendererDebug {
  private readonly models: ModelLibrary;
  private readonly characters: CharacterFactory;
  private readonly warn = new ThrottledWarn();
  private readonly fpsMeter = new FpsMeter();
  private readonly specs = new SpecResolver();
  private readonly glow = new WindowGlow();
  private gl: THREE.WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private sceneRoot: THREE.Scene | null = null;
  private cam = new CameraRig();
  private lighting: Lighting | null = null;
  private dressing: WorldDressing | null = null;
  private carpool: CarpoolHearse | null = null;
  private floors = new FloorLayer();
  private walls = new WallLayer();
  private roofs = new RoofLayer();
  private objects: ObjectManager | null = null;
  private agents: AgentManager | null = null;
  private readonly petLib: PetLibrary | null;
  private pets: PetLayer | null = null;
  private readonly wildLib: WildlifeLibrary | null;
  private wildlife: WildlifeLayer | null = null;
  private readonly viewFrustum = new THREE.Frustum();
  private readonly viewMatrix = new THREE.Matrix4();
  private readonly viewSphere = new THREE.Sphere();
  private fx: FxSystem | null = null;
  private snapMarkers: SnapMarkers | null = null;
  private wisp: SoulWisp | null = null;
  /** W-116: marker over the current Act 1 step's target (re-read 4× a second). */
  private marker: QuestMarker | null = null;
  private markerTarget: StoryTarget | null = null;
  private markerReadAt = -Infinity;
  /** Settings.reduceMotion as pushed by the controller (the OS preference is read alongside it). */
  private reduceMotionSetting = false;
  /** Settings.miniatureFocus (the tilt-shift look on high/ultra). */
  private miniatureSetting = true;
  private dioramaFocus = 0.5;
  private readonly tmpFocus = new THREE.Vector3();
  /** prefers-reduced-motion, re-read with the marker target (4× a second). */
  private osReducedMotion = false;
  private ghost: PlacementGhostView | null = null;
  private buildOverlay: BuildOverlayView | null = null;
  private grid: GridOverlay | null = null;
  private post: PostPipeline | null = null;
  private picker: Picker;
  private thumbs: ThumbnailRenderer;
  private readonly previews = new Set<PreviewStage>();
  private quality: QualitySettings = qualitySettings('high');
  private devicePixelRatio = 1;
  /** The player set Pixel Ratio: it wins over the preset window (D-025). */
  private pixelRatioExplicit = false;
  private pixelRatio = 1;
  /** Quality setting as given ('auto' or a level); `quality` is the resolved preset. */
  private qualitySetting: QualitySetting = 'high';
  /** Auto quality (W-039): created on first use of 'auto', kept across switches to a fixed level and back. */
  private autoGov: AutoQualityGovernor | null = null;
  private autoStored: AutoLevel | null = null;
  private gpu: GpuClass | null = null;
  private autoSampling = true;
  private autoLastAt = -1;
  private cssWidth = 1280;
  private cssHeight = 720;
  private viewMode: ViewMode = 'live';
  private wallMode: WallMode = 'cutaway';
  /** Rendered frames (monotonic) and the last frame's duration: RenderStats test hooks (W-115). */
  private frameSeq = 0;
  private lastFrameMs = 0;
  private sim: SimulationAPI | null = null;
  private roomAt: ((x: number, z: number) => number) | null = null;
  private assetsReady = false;
  private texturesReady = false;
  private contextLost = false;
  private disposed = false;
  private clock = 0;
  private lotKey = '';
  private sizedExplicitly = false;
  private lastFrameAt = 0;
  private thumbKick = 0;
  private lotW = NaN;
  private lotD = NaN;
  private lotS = NaN;
  private forceWalls = false;
  private forceFloors = false;
  private selectedId: AgentId | null = null;
  private pointer: { x: number; y: number; t: number } | null = null;
  private readonly pointerState = { x: 0, y: 0, t: 0 };
  private readonly lampList: LampSource[] = [];
  private streetLampSources: LampSource[] = [];
  private lampsAssigned = 0;
  private lastStats = { calls: 0, triangles: 0 };
  private readonly materialPrecompileStats = { calls: 0, ms: 0 };
  private timeOverride: { minute: number; moon: number } | null = null;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpDir = { x: 0, z: -1 };
  private readonly tmpCentre = { x: 0, z: 0 };
  /** W-136: the zombie a shoulder / first-person view is attached to (null in the overview). */
  private perspectiveAgent: AgentId | null = null;
  /** Seconds the perspective's zombie has had no rendered pose (left the lot, crumbled): past the limit → overview. */
  private perspectiveLost = 0;
  private readonly listeners: [string, EventListener][] = [];
  /** W-025 S5: the walkable world's other regions (off for a home-only world). */
  private world: WorldView | null = null;
  private worldOn = false;
  private worldBoundsKey = '';
  private readonly worldLampState: ObjectVisualState = { powered: true, inUse: false, broken: false, lit: false, servings: 0, progress: 0, flag: false, dirt: 0, burning: false };
  private readonly worldLampSources: LampSource[] = [];
  /** Scene rebuilds (attach / lot resize / world switch): AC-2 asserts a walk never adds one. */
  private sceneRebuilds = 0;
  private readonly lodFocus = { x: 15, z: 15 };
  /** HUD-aware follow framing (Sol P2): HUD panel rects provider (canvas CSS px), cached rects and the solved offset. */
  private frameAvoid: (() => FrameRect[]) | null = null;
  private avoidRects: FrameRect[] = [];
  private avoidReadAt = -Infinity;
  private followOff: FollowOffset = { x: 0, z: 0, overlap: 0 };
  private followOffKey = '';
  private readonly assetBaseUrl: string;

  constructor(deps: RendererDeps) {
    this.models = deps.models;
    this.characters = deps.characters;
    this.assetBaseUrl = typeof deps.assetBaseUrl === 'string' ? deps.assetBaseUrl : 'assets/';
    this.petLib = deps.pets ?? null;
    this.wildLib = deps.wildlife ?? null;
    this.picker = new Picker(this.cam.camera, () => ({ width: this.cssWidth, height: this.cssHeight }));
    this.thumbs = new ThumbnailRenderer(this.models, this.warn);
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  async init(canvas: HTMLCanvasElement, opts: { quality: QualitySetting; pixelRatio: number; pixelRatioExplicit?: boolean; autoLevel?: AutoLevel | null }): Promise<void> {
    if (this.disposed) throw new Error('renderer disposed');
    if (this.gl) {
      this.warn.warn('init-twice', 'init() called twice; ignoring');
      return;
    }
    this.canvas = canvas;
    this.devicePixelRatio = finiteOr(opts?.pixelRatio, typeof window !== 'undefined' ? window.devicePixelRatio : 1);
    this.pixelRatioExplicit = opts?.pixelRatioExplicit === true;
    this.autoStored = isAutoLevel(opts?.autoLevel) ? opts.autoLevel : null;
    const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    this.gl = gl;
    // the GPU is only known once the context exists: resolve 'auto' before the first applyQuality()
    this.gpu = readGpu(gl);
    this.qualitySetting = opts?.quality === 'auto' || isQualityLevel(opts?.quality) ? opts.quality : 'high';
    this.quality = qualitySettings(this.resolveQualitySetting(this.qualitySetting));
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1;
    gl.info.autoReset = false;
    // W-025 S5: neighbour shells clip at 1 m in cutaway / walls-down (per-material clipping planes)
    gl.localClippingEnabled = true;
    gl.setClearColor(0x1d1726, 1);
    if (!this.sizedExplicitly) {
      this.cssWidth = Math.max(1, canvas.clientWidth || canvas.width || 1280);
      this.cssHeight = Math.max(1, canvas.clientHeight || canvas.height || 720);
    }
    this.listen(canvas, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.warn.warn('ctx-lost', 'WebGL context lost — waiting for restore');
    });
    this.listen(canvas, 'webglcontextrestored', () => this.onContextRestored());
    this.listen(canvas, 'pointermove', (e) => {
      const pe = e as PointerEvent;
      this.notePointer(pe.offsetX, pe.offsetY);
    });
    this.listen(canvas, 'pointerleave', () => {
      this.pointer = null;
    });
    this.buildScene(gl);
    this.applyQuality();
    // procedural atlases (a few hundred ms of canvas work)
    try {
      await this.floors.prepareAsync();
      await this.walls.prepareAsync();
    } catch (e) {
      this.warn.warn('atlas', 'texture atlas generation failed', e);
    }
    this.texturesReady = true;
    let libsReady = false;
    const libs = Promise.all([safeReady(this.models.ready), safeReady(this.characters.ready)]).then(() => {
      libsReady = true;
    });
    await Promise.race([libs, delay(ASSET_TIMEOUT_MS)]);
    this.assetsReady = true;
    this.rebuildLotScene(true);
    if (!libsReady) {
      // slow asset load: we proceeded with placeholders; once the real models land, rebuild what we instanced
      this.warn.warn('assets-slow', `asset libraries not ready after ${ASSET_TIMEOUT_MS / 1000}s — continuing with placeholders`);
      void libs.then(() => {
        if (this.disposed) return;
        try {
          this.dressing?.build(this.dressingDims(), true, this.worldBackdrop());
          this.world?.assetsChanged();
          this.objects?.clear(); // re-created next frame from the loaded prototypes (batched, glowing windows)
        } catch (e) {
          this.warn.warn('assets-late', 'late asset rebuild failed', e);
        }
      });
    }
  }

  /** Remember the cursor for zoom-toward-cursor (one reused object: pointer moves fire at input rate). */
  private notePointer(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const p = this.pointerState;
    p.x = x;
    p.y = y;
    p.t = performance.now();
    this.pointer = p;
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    const l = fn as EventListener;
    target.addEventListener(type, l, { passive: type !== 'webglcontextlost' } as AddEventListenerOptions);
    this.listeners.push([type, l]);
  }

  private buildScene(gl: THREE.WebGLRenderer): void {
    const scene = new THREE.Scene();
    scene.name = 'afterlife-lease';
    this.sceneRoot = scene;
    this.lighting = new Lighting(scene, this.warn);
    this.dressing = new WorldDressing(this.models, this.glow, this.warn, this.quality.anisotropy);
    this.carpool = new CarpoolHearse(this.models, this.warn);
    this.fx = new FxSystem(this.quality);
    this.objects = new ObjectManager(this.models, this.specs, this.fx, this.glow, this.warn);
    this.agents = new AgentManager(this.characters, this.fx, this.warn);
    this.wisp = new SoulWisp();
    this.marker = new QuestMarker();
    this.ghost = new PlacementGhostView(this.models, this.specs, this.warn);
    this.buildOverlay = new BuildOverlayView();
    this.grid = new GridOverlay();
    this.world = new WorldView(this.models, this.glow, this.warn, new HomeShellLibrary(this.assetBaseUrl, undefined, (k, m, e) => this.warn.warn(k, m, e)), this.quality.anisotropy);
    const lookup = (id: string) => (this.worldOn && this.world ? this.world.contentFrame(id) : 'home');
    this.agents.regionFrames = lookup;
    this.objects.regionFrames = lookup;
    scene.add(this.world.group);
    scene.add(this.dressing.group, this.carpool.group, this.floors.group, this.walls.group, this.roofs.group, this.objects.group, this.agents.group);
    if (this.petLib) {
      this.pets = new PetLayer(this.petLib);
      scene.add(this.pets.group);
    }
    if (this.wildLib) {
      this.wildlife = new WildlifeLayer(this.wildLib);
      scene.add(this.wildlife.group);
    }
    this.snapMarkers = new SnapMarkers();
    scene.add(this.snapMarkers.group);
    scene.add(this.grid.mesh, this.ghost.group, this.buildOverlay.group, this.wisp.group, this.marker.group, this.fx.mesh);
    scene.add(this.cam.camera);
    this.post = new PostPipeline(gl, scene, this.cam.camera);
  }

  private applyQuality(): void {
    const gl = this.gl;
    if (!gl) return;
    const q = this.quality;
    gl.shadowMap.enabled = q.shadows;
    gl.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    gl.shadowMap.needsUpdate = true;
    this.pixelRatio = effectivePixelRatio(q.level, this.devicePixelRatio, this.cssWidth, this.cssHeight, this.pixelRatioExplicit);
    gl.setPixelRatio(this.pixelRatio);
    gl.setSize(this.cssWidth, this.cssHeight, false);
    this.cam.setAspect(this.cssWidth / this.cssHeight);
    this.lighting?.configure(q);
    this.fx?.configure(q);
    const aniso = Math.min(q.anisotropy, gl.capabilities.getMaxAnisotropy());
    this.floors.setAnisotropy(aniso);
    this.walls.setAnisotropy(aniso);
    this.dressing?.setAnisotropy(aniso);
    this.post?.configure(q, this.cssWidth, this.cssHeight, this.pixelRatio);
    // shadow/light-count changes need program rebuilds once
    this.sceneRoot?.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  }

  /**
   * three.js re-creates every GPU resource lazily in the restored context (fresh internal property maps): buffers,
   * textures, programs and render targets come back on first use, so nothing is rebuilt or disposed here — disposing
   * old-context objects would only make their stale listeners delete foreign GL names. Only RENDERED content is lost:
   * the PMREM environment map (re-baked next frame) and the thumbnail studio's environment.
   */
  private onContextRestored(): void {
    this.contextLost = false;
    try {
      this.sceneRoot?.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const mat of Array.isArray(m) ? m : [m]) {
          for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).needsUpdate = true;
          mat.needsUpdate = true;
        }
      });
      this.lighting?.invalidateEnvironment();
      this.thumbs.invalidate();
      this.warn.warn('ctx-restored', 'WebGL context restored — GPU resources re-created');
    } catch (e) {
      this.warn.warn('ctx-restore-fail', 'context restore failed', e);
    }
  }

  loadProgress(): number {
    const p = (f: () => number) => {
      try {
        const v = f();
        return Number.isFinite(v) ? clamp(v, 0, 1) : 0;
      } catch {
        return 0;
      }
    };
    if (this.assetsReady) return 1;
    return clamp(0.15 * (this.texturesReady ? 1 : 0) + 0.5 * p(() => this.models.progress()) + 0.35 * p(() => this.characters.progress()), 0, 0.99);
  }

  attach(sim: SimulationAPI | null): void {
    try {
      this.sim = sim && typeof sim === 'object' ? sim : null;
      // another world: no close view survives it, and only walls drawn at full height stop the shoulder camera
      this.setPerspective('overview', null, true);
      this.cam.wallProbe = (kind, x, z) => {
        if (this.drawnWallMode() !== 'up') return false;
        const walls = this.currentState()?.lot?.walls;
        return !!walls && Object.prototype.hasOwnProperty.call(walls, `${kind}:${x}:${z}`);
      };
      this.specs.setSim(this.sim);
      this.agents?.setSim(this.sim);
      this.objects?.clear();
      this.agents?.clear();
      this.fx?.clear();
      const s = this.sim;
      this.roomAt = s
        ? (x: number, z: number) => {
            const sp = s.spatial;
            return sp ? sp.roomAt(x, z) : 0;
          }
        : null;
      this.lotKey = '';
      this.forceWalls = true;
      this.roofs.invalidate();
      this.forceFloors = true;
      this.worldOn = false;
      this.world?.sync(null);
      this.rebuildLotScene(true);
    } catch (e) {
      this.warn.warn('attach', 'attach failed', e);
    }
  }

  private currentState(): WorldState | null {
    try {
      const st = this.sim ? this.sim.state : null;
      return st && typeof st === 'object' && st.lot && typeof st.lot === 'object' ? st : null;
    } catch {
      return null;
    }
  }

  private dressingDims(): { width: number; depth: number; sidewalkZ: number } {
    const lot = this.currentState()?.lot;
    const width = lot && Number.isFinite(lot.width) && lot.width > 0 ? lot.width : 30;
    const depth = lot && Number.isFinite(lot.depth) && lot.depth > 0 ? lot.depth : 30;
    return { width, depth, sidewalkZ: lot && Number.isFinite(lot.sidewalkZ) ? lot.sidewalkZ : depth - 2 };
  }

  /** W-025 S5: the dressing's world backdrop (null = legacy single-lot dressing). */
  private worldBackdrop(): { extent: { x0: number; z0: number; x1: number; z1: number } } | null {
    if (!this.worldOn || !this.world) return null;
    const ext = this.world.sceneExtent();
    return ext ? { extent: ext } : null;
  }

  /** (Re)fit camera bounds, grid, shadows and dressing to the attached lot's dimensions. */
  private rebuildLotScene(resetCamera: boolean): void {
    this.sceneRebuilds++;
    const st = this.currentState();
    this.worldOn = this.world ? this.world.sync(st) : false;
    if (!this.worldOn) {
      this.cam.setPanRect(null);
      this.worldBoundsKey = '';
    }
    const lot = st?.lot;
    const width = lot && Number.isFinite(lot.width) && lot.width > 0 ? lot.width : 30;
    const depth = lot && Number.isFinite(lot.depth) && lot.depth > 0 ? lot.depth : 30;
    const sidewalkZ = lot && Number.isFinite(lot.sidewalkZ) ? lot.sidewalkZ : depth - 2;
    const key = `${width}|${depth}|${sidewalkZ}`;
    const changed = key !== this.lotKey;
    this.lotKey = key;
    this.lotW = lot ? lot.width : NaN;
    this.lotD = lot ? lot.depth : NaN;
    this.lotS = lot ? lot.sidewalkZ : NaN;
    if (changed || resetCamera) this.cam.setBounds({ width, depth }, resetCamera || changed);
    this.grid?.setLot(width, depth, lot?.buildable ?? null);
    this.lighting?.fitToLot(width, depth);
    if (this.assetsReady && this.dressing) {
      this.dressing.build({ width, depth, sidewalkZ }, false, this.worldBackdrop());
      this.streetLampSources = this.dressing.lamps.map((l, i) => ({
        x: l.x,
        y: l.y,
        z: l.z,
        bias: 9,
        color: new THREE.Color('#ffd59a'),
        intensity: 9,
        distance: 11,
        flicker: false,
        seed: i,
      }));
    }
  }

  // ───────────────────────────── per frame ─────────────────────────────

  frame(alpha: number, dtSec: number): void {
    if (this.disposed || !this.gl || !this.sceneRoot || this.contextLost) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    try {
      this.frameInner(alpha, dtSec);
    } catch (e) {
      this.warn.warn('frame', 'frame failed', e);
    }
    this.frameSeq++;
    this.lastFrameMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  }

  private frameInner(alpha: number, dtSec: number): void {
    const gl = this.gl!;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    this.lastFrameAt = now;
    this.fpsMeter.tick(now);
    this.sampleAutoQuality(now);
    const dt = Number.isFinite(dtSec) ? clamp(dtSec, 0, 0.25) : 1 / 60;
    this.clock += dt;
    const t = this.clock;
    const a = Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
    const state = this.currentState();
    if (state) {
      const lot = state.lot;
      if (lot.width !== this.lotW || lot.depth !== this.lotD || lot.sidewalkZ !== this.lotS) this.rebuildLotScene(false);
      // W-025 S5: the world switched on (townExpand) or changed (a new world bound to the same sim object)
      else if (this.world && this.world.sync(state) !== this.worldOn) this.rebuildLotScene(false);
    }
    // time of day
    let minute = 12 * 60;
    let moon = 0;
    if (this.timeOverride) {
      minute = this.timeOverride.minute;
      moon = this.timeOverride.moon;
    } else if (state && Number.isFinite(state.tick)) {
      const ticks = Math.max(0, state.tick - 1 + a);
      const total = START_MINUTE_OF_DAY + ticks * TICK_MINUTES;
      minute = total % 1440;
      moon = fullMoonTonight(total);
    }
    const lighting = this.lighting!;
    const sample = lighting.update(minute, moon, this.cam.camera, this.cam.viewYaw(), this.cam.viewDistance(), t);
    gl.toneMappingExposure = sample.exposure;
    this.glow.setLevel(sample.windowGlow);
    this.post?.setBloomStrength(0.2 + 0.12 * sample.night);
    this.dressing?.update(t, lighting.lampsOn);
    if (state && this.assetsReady && this.carpool) {
      const until = state.flags ? state.flags['people:carpool:until'] : undefined;
      const entry = state.lot.entryPoints && state.lot.entryPoints[0];
      // world mode: the street region's road starts 1 m further out (1 m verge, §1.2 cross-section)
      this.carpool.update(dt, t, typeof until === 'number' && until > state.tick, lighting.lampsOn, entry ? entry.x : 0.5, state.lot.depth + (this.worldOn ? 1 : 0));
    }
    if (this.worldOn && this.world) this.world.updateLamps(lighting.lampsOn, t, this.worldLampState);
    // lot content
    const objects = this.objects!;
    const agents = this.agents!;
    if (state && this.texturesReady) {
      try {
        this.floors.sync(state.lot, this.forceFloors);
        this.forceFloors = false;
      } catch (e) {
        this.warn.warn('floors', 'floor sync failed', e);
      }
    }
    if (state && this.assetsReady) {
      const hh = state.household;
      let billsOut = false;
      if (hh && Array.isArray(hh.bills)) for (let i = 0; i < hh.bills.length; i++) if (hh.bills[i] && hh.bills[i].paidTick === null) billsOut = true;
      const ctx = this.objCtx;
      ctx.state = state;
      ctx.env.utilitiesOn = !hh || hh.utilitiesOn !== false;
      ctx.env.lampsOn = lighting.lampsOn;
      ctx.env.billsOutstanding = billsOut;
      ctx.timeSec = t;
      objects.sync(ctx, dt);
      // W-025 S5 agent LOD: other-region agents far from the camera focus become capsules (home agents never do)
      agents.lodCenter = this.worldOn ? this.lodFocus : null;
      agents.keepFull = this.cam.followId;
      agents.fullCap = Math.min(this.cssWidth, this.cssHeight) <= PHONE_PROFILE_MAX_SIDE ? AGENT_FULL_DETAIL_MAX_PHONE : AGENT_FULL_DETAIL_MAX;
      this.lodFocus.x = this.cam.current.targetX;
      this.lodFocus.z = this.cam.current.targetZ;
      agents.sync(state, a, dt);
      if (this.pets || this.wildlife) {
        try {
          // animals only get a rig (and only fetch their model) while they are inside the camera's view
          const cam = this.cam.camera;
          cam.updateMatrixWorld();
          this.viewMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
          this.viewFrustum.setFromProjectionMatrix(this.viewMatrix);
          const seeing = (margin: number) => (x: number, z: number) => this.viewFrustum.intersectsSphere(this.viewSphere.set(this.tmpV2.set(x, 0.5, z), margin));
          this.pets?.sync(state, dt, seeing(PET_VIEW_MARGIN));
          const roomAt = this.roomAt;
          this.wildlife?.sync(state, t, dt, seeing(WILDLIFE_VIEW_MARGIN), roomAt ? (x: number, z: number) => roomAt(Math.floor(x), Math.floor(z)) > 0 : undefined);
        } catch (e) {
          this.warn.warn('pets', 'pet / wildlife sync failed', e);
        }
      }
    }
    if (state && this.texturesReady) {
      try {
        this.walls.sync(state.lot, objects.openings(), objects.openingsSignature(), this.forceWalls);
        this.forceWalls = false;
      } catch (e) {
        this.warn.warn('walls', 'wall sync failed', e);
      }
    }
    // cutaway
    viewDirection(this.cam.viewYaw(), this.tmpDir);
    try {
      this.walls.update(dt, this.drawnWallMode(), this.tmpDir.x, this.tmpDir.z, this.roomAt, state ? state.lot.version : 0);
    } catch (e) {
      this.warn.warn('walls-update', 'wall cutaway update failed', e);
    }
    // roofs and ceilings: render-only, fade by view (src/render/roofs)
    try {
      this.roofs.setBeams(this.quality.level === 'high' || this.quality.level === 'ultra');
      if (state) this.roofs.sync(state.lot, this.roomAt);
      const who = this.perspectiveAgent ?? this.selectedId;
      const at = who ? agents.positionOf(who) : null;
      this.roofs.update(dt, this.viewMode, this.cam.getPerspective(), at ? at.x : null, at ? at.z : null);
    } catch (e) {
      this.warn.warn('roofs', 'roof update failed', e);
    }
    // camera (follow)
    // (across regions: the followed agent's drawn position, else its sim position mapped into the scene)
    const followAt = this.cam.followId ? agents.positionOf(this.cam.followId) ?? (this.worldOn ? this.agentScenePos(this.cam.followId) : null) : null;
    // frame the followed actor on a spot no HUD panel covers (a constant world offset per camera pose)
    const off = followAt ? this.followOffset(now) : null;
    const follow = followAt && off ? { x: followAt.x + off.x, z: followAt.z + off.z } : followAt;
    const subject = this.perspectiveAgent ? agents.poseOf(this.perspectiveAgent) : null;
    this.cam.reduceMotion = markerReducedMotion(this.reduceMotionSetting, this.osReducedMotion);
    this.cam.update(dt, follow, subject);
    if (this.worldOn) this.updateWorld(state);
    if (this.perspectiveAgent) {
      // a zombie that walked off the lot or crumbled cannot carry the camera: hand the view back (OW-4)
      this.perspectiveLost = subject ? 0 : this.perspectiveLost + (Number.isFinite(dt) && dt > 0 ? dt : 0);
      if (this.perspectiveLost > PERSPECTIVE_LOST_SEC) this.setPerspective('overview', null);
    }
    agents.setHidden(this.cam.insideSubject() ? this.perspectiveAgent : null);
    agents.cull(this.cam.camera, this.quality.shadows ? lighting.keyDirection : null);
    // lamp lights
    this.lampList.length = 0;
    for (let i = 0; i < objects.lampCount; i++) this.lampList.push(objects.lamps[i]);
    if (lighting.lampsOn) for (const s of this.streetLampSources) this.lampList.push(s);
    if (lighting.lampsOn && this.worldOn) for (const s of this.worldLampSources) this.lampList.push(s);
    const centre = this.cam.viewCentre(this.tmpCentre);
    this.lampsAssigned = lighting.assignLamps(this.lampList, this.lampList.length, centre.x, centre.z, t);
    // overlays
    let head: THREE.Vector3 | null = null;
    let feet: { x: number; y: number; z: number } | null = null;
    if (this.selectedId) {
      // looking out of the selected zombie's eyes, its own selection marker would sit on the lens
      head = this.cam.insideSubject() && this.selectedId === this.perspectiveAgent ? null : agents.headOf(this.selectedId, this.tmpV);
      feet = agents.positionOf(this.selectedId);
    }
    this.wisp!.update(t, dt, head, feet);
    this.updateMarker(state, t, dt);
    this.ghost!.update(t);
    this.buildOverlay!.update(t);
    this.grid!.update(dt, this.cam.current.distance);
    this.snapMarkers?.update(t);
    this.updateDiorama(dt, feet);
    this.fx!.setView(this.cam.camera.fov, this.cssHeight);
    this.fx!.update(dt, t);
    lighting.updateEnvironment(gl);
    if (this.sceneRoot) {
      this.warmupMaterials(this.agentMaterialWarmup, agents.materialRevision, gl, agents.group, 'agent');
      if (this.pets) this.warmupMaterials(this.petMaterialWarmup, this.pets.materialRevision, gl, this.pets.group, 'pet');
      if (this.wildlife) this.warmupMaterials(this.wildlifeMaterialWarmup, this.wildlife.materialRevision, gl, this.wildlife.group, 'wildlife');
    }
    try {
      this.thumbs.process(gl, 2);
    } catch (e) {
      this.warn.warn('thumbs', 'thumbnail processing failed', e);
    }
    this.render(dt);
  }

  /** W-025 S5 per frame: render tiers from the camera focus, camera pan bounds, shadow centre, street lamps, profile. */
  private updateWorld(state: WorldState | null): void {
    const w = this.world;
    if (!w) return;
    try {
      w.setProfile(Math.min(this.cssWidth, this.cssHeight) <= PHONE_PROFILE_MAX_SIDE ? 'phone' : 'desktop');
      w.setWallMode(this.wallMode);
      const fx = this.cam.current.targetX;
      const fz = this.cam.current.targetZ;
      const active = state?.town?.stream && Array.isArray(state.town.stream.active) ? state.town.stream.active : null;
      w.update(fx, fz, active, this.cam.camera.position);
      w.syncFarAgents(state?.agents, fx, fz, this.agents?.farAgents);
      const b = w.sceneBounds();
      const key = b ? `${b.x0},${b.z0},${b.x1},${b.z1}` : '';
      if (key !== this.worldBoundsKey) {
        this.worldBoundsKey = key;
        this.cam.setPanRect(b);
      }
      // the shadow box follows the lot-sized region under the camera (the home lot otherwise)
      const at = w.regionAtScene(fx, fz);
      const rect = at && at.kind === 'lot' && at.regionId !== w.homeRegionId() ? w.sceneRectOf(at.regionId) : null;
      if (rect) this.lighting?.setShadowCenter((rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2);
      else if (!at || at.kind === 'lot') this.lighting?.setShadowCenter(Number.isFinite(this.lotW) ? this.lotW / 2 : 15, Number.isFinite(this.lotD) ? this.lotD / 2 : 15);
      // street lamps of drawn street regions (pooled sources)
      const lamps = w.lamps();
      for (let i = 0; i < lamps.length; i++) {
        let src = this.worldLampSources[i];
        if (!src) {
          src = { x: 0, y: 0, z: 0, bias: 9, color: WORLD_LAMP_COLOR, intensity: 9, distance: 11, flicker: false, seed: 100 + i };
          this.worldLampSources.push(src);
        }
        src.x = lamps[i].x;
        src.y = lamps[i].y;
        src.z = lamps[i].z;
      }
      this.worldLampSources.length = lamps.length;
    } catch (e) {
      this.warn.warn('world-frame', 'world view frame failed', e);
    }
  }

  /** Scene position of an agent from its sim state (lot-local to its region → scene); null when unknown. */
  private agentScenePos(id: AgentId): { x: number; z: number } | null {
    const ag = this.currentState()?.agents?.[id];
    if (!ag || !ag.pos || !Number.isFinite(ag.pos.x) || !Number.isFinite(ag.pos.z)) return null;
    if (typeof ag.regionId === 'string' && this.worldOn && this.world && ag.regionId !== this.world.homeRegionId()) {
      return this.world.toScene(ag.regionId, ag.pos.x, ag.pos.z);
    }
    return { x: ag.pos.x, z: ag.pos.z };
  }

  private readonly objCtx: ObjectsContext = {
    state: null as unknown as WorldState,
    env: { utilitiesOn: true, lampsOn: false, billsOutstanding: false },
    timeSec: 0,
    wallHeight: (edge: EdgeKey): number => this.walls.heightOf(edge),
    hasWall: (edge: EdgeKey): boolean => this.walls.hasWall(edge),
    doorTraffic: (x: number, z: number): boolean => (this.agents ? this.agents.doorTraffic(x, z) : false),
  };
  private readonly agentMaterialWarmup = new AgentMaterialWarmupGate();
  private readonly petMaterialWarmup = new AgentMaterialWarmupGate();
  private readonly wildlifeMaterialWarmup = new AgentMaterialWarmupGate();

  private warmupMaterials(
    gate: AgentMaterialWarmupGate,
    revision: string,
    gl: THREE.WebGLRenderer,
    objects: THREE.Object3D,
    kind: string,
  ): void {
    if (objects.children.length === 0) {
      gate.shouldCompile('');
      return;
    }
    if (gate.shouldCompile(revision)) this.precompileMaterials(gl, objects, kind);
  }

  private precompileMaterials(gl: THREE.WebGLRenderer, objects: THREE.Object3D, kind: string): void {
    const startedAt = performance.now();
    this.materialPrecompileStats.calls++;
    try {
      // Compile new render materials against the live scene's lights/environment before their first draw.
      gl.compile(objects, this.cam.camera, this.sceneRoot!);
    } catch (e) {
      this.warn.warn(`${kind}-material-warmup`, `${kind} material precompile failed`, e);
    } finally {
      const elapsed = performance.now() - startedAt;
      if (Number.isFinite(elapsed) && elapsed >= 0) this.materialPrecompileStats.ms += elapsed;
    }
  }

  private render(dt: number): void {
    const gl = this.gl!;
    gl.info.reset();
    if (this.post && this.post.enabled) this.post.render(dt);
    else gl.render(this.sceneRoot!, this.cam.camera);
    this.lastStats.calls = gl.info.render.calls;
    this.lastStats.triangles = gl.info.render.triangles;
  }

  consumeEvents(events: SimEvent[]): void {
    if (!Array.isArray(events)) return;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev || typeof ev !== 'object') continue;
      try {
        switch (ev.type) {
          case 'fx':
            this.handleFx(ev);
            break;
          case 'voice':
            this.agents?.talk(ev.agentId, ev.durationMs);
            break;
          case 'lot':
            if (ev.what === 'walls' || ev.what === 'all') {
              this.forceWalls = true;
              this.roofs.invalidate();
            }
            if (ev.what === 'floors' || ev.what === 'all') this.forceFloors = true;
            break;
          default:
            // spawns/despawns/object add+remove are picked up by the per-frame sync
            break;
        }
      } catch (e) {
        this.warn.warn('event-' + String((ev as { type?: unknown }).type), 'event handling failed', e);
      }
    }
  }

  private handleFx(ev: Extract<SimEvent, { type: 'fx' }>): void {
    if (this.fx && fxAnchor(ev, this.fxSources, this.fxAt)) this.fx.burst(ev.kind, this.fxAt.x, this.fxAt.y, this.fxAt.z);
  }

  private readonly fxAt = { x: 0, y: 0, z: 0 };
  private readonly fxSources: FxAnchorSources = {
    agentPos: (id) => this.agents?.positionOf(id) ?? null,
    agentSimPos: (id) => {
      const ag = this.currentState()?.agents?.[id];
      return ag && ag.pos ? { x: ag.pos.x, y: finiteOr(ag.posY, 0), z: ag.pos.z } : null;
    },
    objectBounds: (id) => this.objects?.boundsOf(id) ?? null,
  };

  // ───────────────────────────── settings ─────────────────────────────

  resize(width: number, height: number): void {
    try {
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      this.cssWidth = Math.max(1, Math.floor(width));
      this.cssHeight = Math.max(1, Math.floor(height));
      this.sizedExplicitly = true;
      const gl = this.gl;
      if (!gl) return;
      this.pixelRatio = effectivePixelRatio(this.quality.level, this.devicePixelRatio, this.cssWidth, this.cssHeight, this.pixelRatioExplicit);
      gl.setPixelRatio(this.pixelRatio);
      gl.setSize(this.cssWidth, this.cssHeight, false);
      this.cam.setAspect(this.cssWidth / this.cssHeight);
      this.post?.setSize(this.cssWidth, this.cssHeight, this.pixelRatio);
    } catch (e) {
      this.warn.warn('resize', 'resize failed', e);
    }
  }

  setPixelRatio(ratio: number, explicit = false): void {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const r = Math.min(4, Math.max(0.5, ratio));
    const ex = explicit === true;
    if (r === this.devicePixelRatio && ex === this.pixelRatioExplicit) return;
    this.devicePixelRatio = r;
    this.pixelRatioExplicit = ex;
    this.resize(this.cssWidth, this.cssHeight);
  }

  setQuality(q: QualitySetting, autoLevel?: AutoLevel | null): void {
    if (q !== 'auto' && !isQualityLevel(q)) return;
    if (q === 'auto' && autoLevel !== undefined) {
      const stored = isAutoLevel(autoLevel) ? autoLevel : null;
      const st = this.autoGov?.state();
      // our own persisted result coming back (same level, settled): keep the running governor
      const same = st !== undefined && stored !== null && st.phase === 'watch' && st.level === minLevelOf(stored, st.ceiling);
      if (!same) this.autoGov = null;
      this.autoStored = stored;
    }
    this.qualitySetting = q;
    this.applyLevel(this.resolveQualitySetting(q));
  }

  /** Level for a setting; 'auto' creates (once) / resumes the governor. */
  private resolveQualitySetting(q: QualitySetting): QualityLevel {
    if (q !== 'auto') return q;
    if (!this.autoGov) {
      const g = this.gpu ?? classifyGpu('', '');
      this.autoGov = new AutoQualityGovernor(g.tier, this.autoStored);
    } else {
      this.autoGov.interrupt(); // frames rendered at a fixed level meanwhile say nothing about this one
    }
    this.autoLastAt = -1;
    return this.autoGov.current;
  }

  private applyLevel(level: QualityLevel): void {
    if (level === this.quality.level) return;
    this.quality = qualitySettings(level);
    try {
      this.applyQuality();
    } catch (e) {
      this.warn.warn('quality', 'quality change failed', e);
    }
  }

  setAutoQualitySampling(on: boolean): void {
    const next = on !== false;
    if (next === this.autoSampling) return;
    this.autoSampling = next;
    this.autoLastAt = -1;
    if (!next) this.autoGov?.interrupt();
  }

  /** Feed the interval since the previous rendered frame to the Auto governor (W-039). */
  private sampleAutoQuality(now: number): void {
    const gov = this.autoGov;
    if (!gov || this.qualitySetting !== 'auto' || !this.autoSampling) {
      this.autoLastAt = -1;
      return;
    }
    const prev = this.autoLastAt;
    this.autoLastAt = now;
    if (prev < 0) return;
    const next = gov.sample(now - prev);
    if (next && next !== this.quality.level) {
      this.warn.warn(`auto-quality-${next}`, `Auto quality: ${this.quality.level} -> ${next} (p95 ${gov.state().lastP95.toFixed(1)} ms)`);
      this.applyLevel(next);
      this.autoLastAt = -1; // the quality switch itself (program rebuilds) is not a frame of the new level
    }
  }

  graphicsInfo(): GraphicsInfo {
    const res = internalResolution(this.cssWidth, this.cssHeight, this.pixelRatio);
    let auto: AutoQualityStatus | null = null;
    if (this.qualitySetting === 'auto' && this.autoGov) {
      const st = this.autoGov.state();
      const g = this.gpu ?? classifyGpu('', '');
      auto = { level: st.level, phase: st.phase, ceiling: st.ceiling, gpuKind: g.kind, gpu: g.gpu, lastP95: st.lastP95, downgrades: st.downgrades };
    }
    return {
      level: this.quality.level,
      auto,
      pixelRatio: this.pixelRatio,
      bufferWidth: res.width,
      bufferHeight: res.height,
      supersampled: !this.pixelRatioExplicit && this.pixelRatio > this.devicePixelRatio + 1e-6,
      pixelRatioExplicit: this.pixelRatioExplicit,
    };
  }

  setViewMode(mode: ViewMode): void {
    if (!VIEW_MODES.includes(mode)) return;
    this.viewMode = mode;
    this.grid?.setActive(mode !== 'live');
    if (mode !== 'build') this.buildOverlay?.setHoverEdge(null);
  }

  setWallMode(mode: WallMode): void {
    if (WALL_MODES.includes(mode)) this.wallMode = mode;
    this.world?.setWallMode(this.wallMode);
  }

  getWallMode(): WallMode {
    return this.wallMode;
  }

  /** Walls as drawn: first person stands inside the rooms, so every wall is up whatever the player's wall view. */
  private drawnWallMode(): WallMode {
    return this.cam.getPerspective() === 'firstPerson' ? 'up' : this.wallMode;
  }

  // ───────────────────────────── perspectives (W-136) ─────────────────────────────

  /**
   * `overview` (the orbit camera), `shoulder` or `firstPerson` attached to `agentId`. A close view needs a zombie
   * that is drawn right now; otherwise the result is `overview`. Returns the perspective in effect.
   */
  setPerspective(mode: Perspective, agentId: AgentId | null, instant?: boolean): Perspective {
    try {
      const id = typeof agentId === 'string' ? agentId : null;
      const subject = mode !== 'overview' && id ? (this.agents?.poseOf(id) ?? null) : null;
      const now = this.cam.setPerspective(mode, subject, instant === true);
      this.perspectiveAgent = now === 'overview' ? null : id;
      this.perspectiveLost = 0;
      return now;
    } catch (e) {
      this.warn.warn('perspective', 'perspective change failed', e);
      this.perspectiveAgent = null;
      return this.cam.setPerspective('overview', null, true);
    }
  }

  getPerspective(): Perspective {
    return this.cam.getPerspective();
  }

  // ───────────────────────────── camera ─────────────────────────────

  rotateCamera(steps: number): void {
    this.cam.rotate(steps);
  }

  orbit(deltaYaw: number, deltaPitch: number): void {
    this.cam.orbit(deltaYaw, deltaPitch);
  }

  zoom(delta: number): void {
    let anchor: { x: number; z: number } | null = null;
    const p = this.pointer;
    if (p && performance.now() - p.t < 2000) {
      const g = this.picker.ground(p.x, p.y, this.tmpV2);
      if (g) anchor = { x: g.x, z: g.z };
    }
    this.cam.zoom(delta, anchor);
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.cam.pan(dxScreen, dyScreen, this.cssHeight);
  }

  panWorld(dx: number, dz: number): void {
    this.cam.panWorld(dx, dz);
  }

  focus(target: Vec2 | AgentId, instant?: boolean): void {
    try {
      if (typeof target === 'string') {
        const p = this.agents?.positionOf(target);
        if (p) this.cam.focus(p.x, p.z, !!instant);
        else {
          const sp = this.agentScenePos(target);
          if (sp) this.cam.focus(sp.x, sp.z, !!instant);
        }
      } else if (target && typeof target === 'object') this.cam.focus(target.x, target.z, !!instant);
    } catch (e) {
      this.warn.warn('focus', 'focus failed', e);
    }
  }

  follow(agentId: AgentId | null): void {
    this.cam.followId = typeof agentId === 'string' ? agentId : null;
  }

  /**
   * Sol P2 fix: the HUD panel rects (CSS px relative to the canvas) the followed / recentred actor must stay clear
   * of. The game passes `hudPanelRects()`; null = centre the actor (the legacy behaviour). Read at most 4× a second.
   */
  setFrameAvoid(fn: (() => FrameRect[]) | null): void {
    this.frameAvoid = typeof fn === 'function' ? fn : null;
    this.avoidReadAt = -Infinity;
    this.followOffKey = '';
  }

  /** Focus offset for the followed actor (re-solved when the pose, viewport or HUD rects change). */
  private followOffset(now: number): FollowOffset | null {
    if (!this.frameAvoid) return null;
    if (now - this.avoidReadAt > 250 || now < this.avoidReadAt) {
      this.avoidReadAt = now;
      try {
        const r = this.frameAvoid();
        this.avoidRects = Array.isArray(r) ? r.filter((x) => x && [x.x, x.y, x.w, x.h].every(Number.isFinite)) : [];
      } catch {
        this.avoidRects = [];
      }
    }
    const g = this.cam.goal;
    const key = `${g.yaw.toFixed(3)}|${g.pitch.toFixed(3)}|${g.distance.toFixed(2)}|${this.cssWidth}x${this.cssHeight}|${this.avoidRects.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`).join(';')}`;
    if (key !== this.followOffKey) {
      this.followOffKey = key;
      try {
        this.followOff = followFrameOffset(this.cam, { w: this.cssWidth, h: this.cssHeight }, this.avoidRects) ?? { x: 0, z: 0, overlap: 0 };
      } catch (e) {
        this.warn.warn('follow-frame', 'follow framing failed', e);
        this.followOff = { x: 0, z: 0, overlap: 0 };
      }
    }
    return this.followOff;
  }

  /** W-025 S5 `CameraFollowApi.following()`: the followed agent (null after a manual pan / follow(null)). */
  following(): AgentId | null {
    return this.cam.followId;
  }

  /**
   * W-025 S5 `CameraFollowApi.recentre()`: pan back to the followed member, else the selected one (and follow them).
   * Glides like every camera move; snaps under Reduce motion (setting or prefers-reduced-motion). False when there is
   * nobody to centre on (no follow / selection, or the agent is not on a lot).
   */
  recentre(): boolean {
    try {
      const id = this.cam.followId ?? this.selectedId;
      if (!id) return false;
      const p = this.agents?.positionOf(id) ?? this.agentScenePos(id);
      if (!p) return false;
      this.cam.followId = id;
      const snap = markerReducedMotion(this.reduceMotionSetting, prefersReducedMotion());
      const off = this.followOffset(performance.now());
      this.cam.focus(p.x + (off?.x ?? 0), p.z + (off?.z ?? 0), snap);
      return true;
    } catch (e) {
      this.warn.warn('recentre', 'recentre failed', e);
      return false;
    }
  }

  /** W-025 S5 `SelectedActorView`: the selected member's region, world + lot-local position and render tier. */
  selectedActor(): SelectedActorView | null {
    try {
      const id = this.selectedId;
      const ag = id ? this.currentState()?.agents?.[id] : null;
      if (!id || !ag || !ag.pos || ag.presence !== 'onLot') return null;
      const w = this.world;
      const st = this.currentState();
      const homeId: RegionId = (this.worldOn && w?.homeRegionId()) || homeRegionIdFallback(st);
      const regionId = typeof ag.regionId === 'string' ? ag.regionId : homeId;
      const local = { x: ag.pos.x, z: ag.pos.z };
      const drawn = this.agents?.positionOf(id);
      const sp = drawn ? { x: drawn.x, z: drawn.z } : this.agentScenePos(id);
      const home: LotPlacement | null = this.worldOn && w ? w.homePlacement() : LEGACY_HOME;
      const wp = sp && home ? lotToWorld(home, sp.x, sp.z) : null;
      const tier = this.worldOn && w ? w.tierOf(regionId) : 'active';
      return { agentId: id, regionId, world: wp ?? local, local, renderTier: tier };
    } catch {
      return null;
    }
  }

  /** W-025 S5: in-world sign texts nearest to the camera focus first (empty for a home-only world). */
  signs(): SignView[] {
    if (!this.worldOn || !this.world) return [];
    return this.world.signs({ x: this.cam.current.targetX, z: this.cam.current.targetZ });
  }

  getCamera(): CameraState {
    return this.cam.getState();
  }

  getListener(): CameraState {
    return this.cam.listenerState();
  }

  setCamera(state: Partial<CameraState>, instant?: boolean): void {
    this.cam.setState(state, !!instant);
  }

  // ───────────────────────────── picking & projection ─────────────────────────────

  pick(clientX: number, clientY: number, opts?: { agents?: boolean; objects?: boolean; walls?: boolean; tiles?: boolean }): PickResult {
    try {
      this.notePointer(clientX, clientY);
      const ray = this.picker.ray(clientX, clientY);
      if (!ray) return { kind: 'none' };
      const st = this.currentState();
      const lot = st?.lot;
      const res = resolvePick(ray, {
        agents: opts?.agents !== false && this.agents ? (r) => this.agents!.pick(r) : null,
        objects: opts?.objects !== false && this.objects ? (r, maxT) => this.objects!.pick(r, maxT) : null,
        pets: opts?.agents !== false && this.pets ? (r) => { const h = this.pets!.pick(r); return h ? { id: h.id, kind: h.kind, t: h.t, point: h.point } : null; } : null,
        // walls always occlude (no clicking zombies / furniture / floor through a visible wall); `walls: false` only
        // means a wall is never the result
        walls: (o, d) => this.walls.pick(o, d),
        wallResults: opts?.walls !== false,
        lot: opts?.tiles !== false ? { width: lot?.width ?? 30, depth: lot?.depth ?? 30 } : null,
      });
      if (!this.worldOn || !this.world) return res;
      return this.worldPick(res, ray, st, opts?.tiles !== false);
    } catch (e) {
      this.warn.warn('pick', 'pick failed', e);
      return { kind: 'none' };
    }
  }

  /**
   * W-025 S5 picking across regions: agents / objects of another region carry its `regionId`; a house shell in front
   * of the home's ground wins over it; ground (or a shell) outside the home lot is a `worldTile` route target.
   */
  private worldPick(res: PickResult, ray: THREE.Ray, st: WorldState | null, tiles: boolean): PickResult {
    const w = this.world!;
    const home = w.homeRegionId();
    if (res.kind === 'agent') {
      const r = st?.agents?.[res.agentId]?.regionId;
      return typeof r === 'string' && r !== home ? { ...res, regionId: r } : res;
    }
    if (res.kind === 'object') {
      const r = st?.objects?.[res.objectId]?.regionId;
      return typeof r === 'string' && r !== home ? { ...res, regionId: r } : res;
    }
    if (res.kind === 'wall' || !tiles) return res;
    const groundT = rayPlaneY(ray.origin.y, ray.direction.y, 0);
    const shell = w.pick(ray);
    if (shell && shell.t < groundT) return this.worldTileAt(shell.point.x, shell.point.z, shell.point, 'structure', shell.regionId) ?? res;
    if (res.kind === 'tile' || groundT === Infinity) return res;
    const p = ray.at(groundT, new THREE.Vector3());
    return this.worldTileAt(p.x, p.z, p, 'ground', null) ?? res;
  }

  private worldTileAt(sx: number, sz: number, point: THREE.Vector3, what: 'ground' | 'structure', prefer: RegionId | null): PickResult | null {
    const w = this.world!;
    let at = w.regionAtScene(sx, sz);
    if (prefer && (!at || at.regionId !== prefer)) {
      // a shell hit on its overhang: clamp into the shell's own region
      const r = w.sceneRectOf(prefer);
      if (r) at = w.regionAtScene(Math.min(Math.max(sx, r.x0 + 0.01), r.x1 - 0.01), Math.min(Math.max(sz, r.z0 + 0.01), r.z1 - 0.01));
    }
    if (!at || at.regionId === w.homeRegionId()) return null;
    const def = w.worldMap()?.regions.find((r) => r.id === at!.regionId);
    const pw = def?.placement.width ?? 30;
    const pd = def?.placement.depth ?? 30;
    const x = Math.min(pw - 1, Math.max(0, Math.floor(at.local.x)));
    const z = Math.min(pd - 1, Math.max(0, Math.floor(at.local.z)));
    return { kind: 'worldTile', target: { regionId: at.regionId, x, z }, world: { x: at.world.x, z: at.world.z }, what, point };
  }

  pickGrid(clientX: number, clientY: number): { x: number; z: number; fx: number; fz: number; edge: EdgeKey | null; edgeSide: 0 | 1 } | null {
    try {
      this.notePointer(clientX, clientY);
      const g = this.picker.ground(clientX, clientY, this.tmpV2);
      if (!g) return null;
      const lot = this.currentState()?.lot;
      const r = gridPickAt(g.x, g.z, lot?.width ?? 30, lot?.depth ?? 30);
      this.grid?.setFocus(g.x, g.z);
      if (this.viewMode === 'build') this.buildOverlay?.setHoverEdge(r ? r.edge : null);
      return r;
    } catch (e) {
      this.warn.warn('pickGrid', 'pickGrid failed', e);
      return null;
    }
  }

  /** W-116: the story-step marker (pure helper → object → bobbing arrow). Live mode only; never touches the sim. */
  private updateMarker(state: WorldState | null, t: number, dt: number): void {
    const m = this.marker;
    if (!m) return;
    try {
      if (t - this.markerReadAt >= 0.25 || t < this.markerReadAt) {
        this.markerReadAt = t;
        this.osReducedMotion = prefersReducedMotion();
        const content = this.sim?.content?.objects;
        this.markerTarget = state && content ? storyTargetOf(state, (d) => content[d]?.tags) : null;
      }
      const target = this.viewMode === 'live' ? this.markerTarget : null;
      const b = target && this.assetsReady ? this.objects?.boundsOf(target.objectId) ?? null : null;
      if (!target || !b || b.isEmpty()) return void m.update(t, dt, null, null);
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      m.update(t, dt, { x: cx, y: b.max.y, z: cz }, { x: cx, z: cz }, markerReducedMotion(this.reduceMotionSetting, this.osReducedMotion));
    } catch (e) {
      this.warn.warn('marker', 'story marker failed', e);
      m.update(t, dt, null, null);
    }
  }

  /** Miniature look: the focus line follows the selected zombie (centre under Reduce motion); yields to build mode. */
  private updateDiorama(dt: number, feet: { x: number; y: number; z: number } | null): void {
    const post = this.post;
    if (!post || !post.dioramaActive) return;
    let y01: number | null = null;
    if (feet && !markerReducedMotion(this.reduceMotionSetting, this.osReducedMotion)) {
      const v = this.tmpFocus.set(feet.x, feet.y + 0.9, feet.z).project(this.cam.camera);
      if (v.z > -1 && v.z < 1) y01 = v.y * 0.5 + 0.5;
    }
    this.dioramaFocus = smoothFocus(this.dioramaFocus, focusTarget(y01), dt);
    // the miniature look belongs to the view from above: it fades out as the camera comes down to a zombie
    post.setDiorama(this.dioramaFocus, dioramaStrength(this.miniatureSetting, this.grid ? this.grid.activeLevel : 0) * (1 - this.cam.closeness()));
  }

  /** Settings → Miniature focus. */
  setMiniatureFocus(on: boolean): void {
    this.miniatureSetting = on === true;
    this.post?.setMiniature(this.miniatureSetting);
  }

  /** W-116: the game's Reduce motion setting (the story marker stands still; prefers-reduced-motion does too). */
  setReduceMotion(on: boolean): void {
    this.reduceMotionSetting = on === true;
  }

  /** W-116: the story marker as drawn (null when hidden): its target and tip (world) — tests / e2e / the HUD. */
  storyMarker(): { questId: string; stepId: string; objectId: string; tip: { x: number; y: number; z: number } } | null {
    const m = this.marker;
    const tg = this.markerTarget;
    if (!m || !m.visible || !tg) return null;
    return { questId: tg.questId, stepId: tg.stepId, objectId: tg.objectId, tip: { x: m.tip.x, y: m.tip.y, z: m.tip.z } };
  }

  /** World point of a placed object for framing: its bounds centre (null when it is not drawn). */
  objectPoint(objectId: string): { x: number; y: number; z: number } | null {
    const b = this.objects?.boundsOf(objectId) ?? null;
    if (!b || b.isEmpty()) return null;
    return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
  }

  /**
   * W-116: move the camera (keeping yaw / pitch / distance) so `world` lands on `screen` (CSS px, canvas space).
   * Solved against the camera's GOAL pose, so it is exact even mid-pan. Returns false when it cannot be solved.
   */
  frameAt(world: { x: number; y: number; z: number }, screen: { x: number; y: number }, instant?: boolean): boolean {
    try {
      const goal = this.cam.getState();
      const project = (fx: number, fz: number) =>
        this.cam.probe(fx, fz, () => {
          const p = this.picker.project(world.x, world.y, world.z);
          return Number.isFinite(p.depth) ? { x: p.x, y: p.y } : null;
        });
      const r = solveFocus(project, goal.target, screen);
      if (!r) return false;
      this.cam.focus(r.x, r.z, !!instant);
      return true;
    } catch (e) {
      this.warn.warn('frameAt', 'framing failed', e);
      return false;
    }
  }

  worldToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const p = this.picker.project(x, y, z);
    return { x: p.x, y: p.y, visible: p.visible };
  }

  bubbleAnchors(): BubbleAnchor[] {
    const out: BubbleAnchor[] = [];
    try {
      this.agents?.forEachHead((id, head) => {
        const p = this.picker.project(head.x, head.y + 0.05, head.z);
        const scale = clamp(22 / Math.max(1, p.depth), 0.5, 1.2);
        out.push({ agentId: id, x: p.x, y: p.y, visible: p.visible, scale });
      });
    } catch (e) {
      this.warn.warn('bubbles', 'bubbleAnchors failed', e);
    }
    return out;
  }

  // ───────────────────────────── overlays ─────────────────────────────

  setSelection(agentId: AgentId | null): void {
    this.selectedId = typeof agentId === 'string' ? agentId : null;
    this.agents?.setSelection(this.selectedId);
  }

  setHover(target: { kind: 'agent'; id: AgentId } | { kind: 'object'; id: ObjectId } | null): void {
    try {
      this.agents?.setHover(target && target.kind === 'agent' ? target.id : null);
      this.objects?.setHover(target && target.kind === 'object' ? target.id : null);
    } catch (e) {
      this.warn.warn('hover', 'setHover failed', e);
    }
  }

  setPlacementGhost(ghost: PlacementGhost | null): void {
    try {
      this.ghost?.set(ghost);
      // an edge ghost (door / window / wall item) holds its wall up: what it shows is what the click leaves visible
      this.walls?.setRaised(ghost && typeof ghost.edge === 'string' ? ghost.edge : null);
    } catch (e) {
      this.warn.warn('ghost', 'setPlacementGhost failed', e);
    }
  }

  setSnapPoints(points: { x: number; z: number; kind: string }[] | null): void {
    try {
      this.snapMarkers?.set(points);
    } catch (e) {
      this.warn.warn('snap', 'setSnapPoints failed', e);
    }
  }

  setBuildOverlay(overlay: BuildOverlay | null): void {
    try {
      this.buildOverlay?.set(overlay);
    } catch (e) {
      this.warn.warn('overlay', 'setBuildOverlay failed', e);
    }
  }

  setHiddenObject(objectId: ObjectId | null): void {
    this.objects?.setHidden(objectId);
  }

  thumbnail(modelId: string, tint?: string | null): Promise<string> {
    const p = this.thumbs.request(modelId, tint);
    // watchdog: frame() drains the queue while frames run; the timer drains it when they stop (menus, hidden view)
    if (!this.thumbKick && this.gl && !this.disposed && this.thumbs.pending() > 0) this.thumbKick = window.setTimeout(() => this.kickThumbs(), 30);
    return p;
  }

  private kickThumbs(): void {
    this.thumbKick = 0;
    const gl = this.gl;
    if (!gl || this.disposed || this.thumbs.pending() === 0) return;
    const framesRunning = performance.now() - this.lastFrameAt <= 250;
    const before = this.thumbs.pending();
    if (!framesRunning && !this.contextLost) {
      try {
        this.thumbs.process(gl, 4);
      } catch (e) {
        this.warn.warn('thumbs', 'thumbnail processing failed', e);
      }
    }
    const left = this.thumbs.pending();
    // keep watching while anything is pending: fast while draining, slow while frames run / models still load
    if (left > 0) this.thumbKick = window.setTimeout(() => this.kickThumbs(), !framesRunning && left < before ? 30 : 250);
  }

  createPreview(canvas: HTMLCanvasElement): PreviewStage {
    const stage = createPreviewStage(canvas, this.characters, this.warn, this.devicePixelRatio);
    const previews = this.previews;
    const wrapped: PreviewStage & { renderNow(): void } = {
      renderNow: () => stage.renderNow(),
      setAppearance: (a) => stage.setAppearance(a),
      setLimbs: (l) => stage.setLimbs(l),
      setAnim: (a) => stage.setAnim(a),
      setExpression: (e) => stage.setExpression(e),
      setYaw: (y) => stage.setYaw(y),
      resize: (w, h) => stage.resize(w, h),
      dispose: () => {
        previews.delete(wrapped);
        stage.dispose();
      },
    };
    previews.add(wrapped);
    return wrapped;
  }

  snapshot(width: number, height: number): string {
    try {
      const gl = this.gl;
      if (!gl || !this.sceneRoot || this.contextLost) return '';
      this.render(0);
      // same task as the render → the drawing buffer is intact without preserveDrawingBuffer
      return encodeSnapshot(gl.domElement, width, height);
    } catch (e) {
      this.warn.warn('snapshot', 'snapshot failed', e);
      return '';
    }
  }

  fps(): number {
    return this.fpsMeter.fps();
  }

  // ───────────────────────────── debug ─────────────────────────────

  stats(): RenderStats {
    const gl = this.gl;
    return {
      fps: this.fps(),
      drawCalls: this.lastStats.calls,
      triangles: this.lastStats.triangles,
      geometries: gl ? gl.info.memory.geometries : 0,
      textures: gl ? gl.info.memory.textures : 0,
      programs: gl?.info.programs?.length ?? 0,
      precompileCalls: this.materialPrecompileStats.calls,
      precompileMs: this.materialPrecompileStats.ms,
      objects: this.objects?.count() ?? 0,
      agents: this.agents?.count() ?? 0,
      agentsCulled: this.agents?.culled ?? 0,
      chunks: this.objects?.chunkMeshes() ?? 0,
      particles: this.fx?.count() ?? 0,
      lampsLit: this.lampList.length,
      lampLights: this.lampsAssigned,
      wallSegments: this.walls.segmentCount(),
      quality: this.quality.level,
      pixelRatio: this.pixelRatio,
      contextLost: this.contextLost,
      thumbnailsPending: this.thumbs.pending(),
      sceneRebuilds: this.sceneRebuilds,
      world: this.worldStats(),
      frames: this.frameSeq,
      lastFrameMs: this.lastFrameMs,
      wallsSettled: this.walls.isSettled(this.drawnWallMode()),
      // W-136: what the view is attached to and where the camera was put (tests / e2e)
      perspective: this.cam.getPerspective(),
      perspectiveAgent: this.perspectiveAgent,
      perspectiveBodyHidden: this.cam.insideSubject(),
      drawnWallMode: this.drawnWallMode(),
      viewPose: { ...this.cam.appliedPose() },
    };
  }

  /** W-025 S5 world view counters (tiers, built regions, streaming totals). */
  worldStats(): WorldViewStats | null {
    return this.world ? this.world.stats() : null;
  }

  /** The world view (tests / dev tools). */
  worldView(): WorldView | null {
    return this.world;
  }

  scene(): THREE.Scene | null {
    return this.sceneRoot;
  }

  camera(): THREE.PerspectiveCamera {
    return this.cam.camera;
  }

  webgl(): THREE.WebGLRenderer | null {
    return this.gl;
  }

  debugPerf(opts: { batching?: boolean; chunking?: boolean; cullAgents?: boolean }): void {
    const o = this.objects;
    if (o) {
      if (typeof opts.batching === 'boolean') o.batching = opts.batching;
      if (typeof opts.chunking === 'boolean') o.chunking = opts.chunking;
      o.clear();
    }
    if (this.agents && typeof opts.cullAgents === 'boolean') this.agents.cullEnabled = opts.cullAgents;
  }

  debugTime(minuteOfDay: number | null, fullMoon = 0): void {
    this.timeOverride = minuteOfDay === null || !Number.isFinite(minuteOfDay) ? null : { minute: minuteOfDay, moon: clamp(finiteOr(fullMoon, 0), 0, 1) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.thumbKick) clearTimeout(this.thumbKick);
    this.thumbKick = 0;
    try {
      for (const p of [...this.previews]) p.dispose();
      this.thumbs.dispose();
      this.objects?.dispose();
      this.agents?.dispose();
      this.pets?.dispose();
      this.wildlife?.dispose();
      this.petLib?.dispose();
      this.wildLib?.dispose();
      this.fx?.dispose();
      this.wisp?.dispose();
      this.marker?.dispose();
      this.ghost?.dispose();
      this.buildOverlay?.dispose();
      this.grid?.dispose();
      this.snapMarkers?.dispose();
      this.floors.dispose();
      this.walls.dispose();
      this.roofs.dispose();
      this.dressing?.dispose();
      this.world?.dispose();
      this.carpool?.dispose();
      this.lighting?.dispose();
      this.glow.dispose();
      this.post?.dispose();
      if (this.canvas) for (const [type, l] of this.listeners) this.canvas.removeEventListener(type, l);
      this.listeners.length = 0;
      this.gl?.dispose();
    } catch (e) {
      this.warn.warn('dispose', 'dispose failed', e);
    }
    this.gl = null;
    this.sceneRoot = null;
    this.sim = null;
  }
}

const WORLD_LAMP_COLOR = new THREE.Color('#ffd59a');
/** The legacy home placement (a world without `town`): wormwood:mildew_n2 at (70, 0), rot 0 (§1.3). */
const LEGACY_HOME: LotPlacement = { regionId: 'wormwood:mildew_n2', originX: 70, originZ: 0, rot: 0, width: 30, depth: 30 };

function homeRegionIdFallback(st: WorldState | null): RegionId {
  const id = st?.town?.homeLotId;
  return typeof id === 'string' && id ? id : LEGACY_HOME.regionId;
}

/** GPU strings: WEBGL_debug_renderer_info when exposed (Chrome, Edge, Firefox, Safari 17+), else the masked ones. */
function readGpu(gl: THREE.WebGLRenderer): GpuClass {
  try {
    const ctx = gl.getContext();
    const ext = ctx.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number; UNMASKED_VENDOR_WEBGL: number } | null;
    const renderer = ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER);
    const vendor = ext ? ctx.getParameter(ext.UNMASKED_VENDOR_WEBGL) : ctx.getParameter(ctx.VENDOR);
    return classifyGpu(renderer, vendor);
  } catch {
    return classifyGpu('', '');
  }
}
