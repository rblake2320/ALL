/**
 * RENDER CONTRACTS — seams between the renderer core, the asset libraries (furniture + characters)
 * and the game controller.
 *
 * Asset files (produced by tools/blender, served from public/assets):
 *   public/assets/models/objects/<modelId>.glb      one per PhysicalSpec id (+ ENV_MODELS ids)
 *   public/assets/models/characters/zombie.glb      skinned base character + all clothing/hair variants + animations
 *   public/assets/manifest.objects.json             { version, objects: {id: {file, bytes, sha256, tris, bounds}} }  (ASSETS-OBJECTS)
 *   public/assets/manifest.characters.json          { version, file, bytes, sha256, animations, morphs, nodes }   (ASSETS-CHARACTERS)
 * Every library MUST degrade gracefully: if a GLB is missing or fails to load, return a procedural
 * placeholder (never throw, never leave a hole in the scene).
 */
import type * as THREE from 'three';
import type { ZombieAppearance, LimbState, AnyAnimState, Expression, CarryItem } from '../shared/appearance';
import type { SimulationAPI } from '../sim/contracts';
import type { Vec2, AgentId, ObjectId, EdgeKey } from '../sim/types';
import type { Rot } from '../shared/dimensions';
import type { CameraFollowApi, RegionId, SelectedActorView, SignView, WorldPoint, WorldRouteTarget } from '../shared/world';

// ───────────────────────────── Furniture / props ─────────────────────────────

export interface ObjectVisualState {
  powered: boolean;
  inUse: boolean;
  broken: boolean;
  /** Night-time & lamp switched on (for 'bulb'/'flame'/'glow'). */
  lit: boolean;
  /** Remaining servings for meals (0..4). */
  servings: number;
  /** 0..1 progress (easel canvas). */
  progress: number;
  /** Mailbox flag up. */
  flag: boolean;
  /** 0..1 dirtiness tint. */
  dirt: number;
  burning: boolean;
}

export interface ModelLibrary {
  /** Resolves when every manifest model is loaded (or replaced by a placeholder). Never rejects. */
  ready: Promise<void>;
  /** Fraction 0..1 for the loading screen. */
  progress(): number;
  has(modelId: string): boolean;
  /**
   * A fresh instance (shared geometry/material where possible). Local space per DIM conventions:
   * footprint centred on origin, y up from floor, front +Z. Wall items: back at z=0 (after the renderer's
   * wall transform). Openings: centred on the wall plane.
   * `tint` recolours materials named 'Paint'.
   */
  create(modelId: string, tint?: string | null): THREE.Object3D;
  /** Toggle/animate dynamic parts by node name (screen, glow, bulb, flame, water, door, canvas, serving_N, flag, broken, frost, speaker, pump). */
  update(instance: THREE.Object3D, state: ObjectVisualState, timeSec: number): void;
  /** Local-space bounds of a model (for picking/thumbnails). */
  bounds(modelId: string): THREE.Box3;
  /** Optional explicit release of an instance created by create() (renderer otherwise ref-counts geometries). Materials stay library-owned and must not be mutated outside dynamic-part nodes / 'Paint' slots (the renderer statically batches the rest). */
  release?(instance: THREE.Object3D): void;
  dispose(): void;
}

// ───────────────────────────── Characters ─────────────────────────────

export interface ZombieRig {
  /** Root object: origin at feet (standing), facing +Z. The renderer positions/rotates it. */
  readonly root: THREE.Object3D;
  /** Incremented when an upgrade or limb change introduces new render materials. */
  readonly renderRevision?: number;
  setAppearance(app: ZombieAppearance): void;
  setLimbs(limbs: LimbState): void;
  /** 0 = fresh (preservation 100) .. 1 = rotting (preservation 0). Shifts skin tone, adds blotches. */
  setDecay(level: number): void;
  /**
   * Crossfades (~0.25s) into the state. One-shots (pickup, collapse, yawn, and the extra one-shots
   * EXTRA_ONE_SHOT_STATES) hold their last frame. Accepts every core and extra state (W-056): an extra state plays
   * its own clip when the loaded GLB has it, else its EXTRA_ANIM_FALLBACK core state; unknown strings play idle.
   */
  setAnim(state: AnyAnimState): void;
  setExpression(expr: Expression): void;
  /** Mouth flaps while true (synced to voice). */
  setTalking(on: boolean): void;
  setCarry(item: CarryItem | null): void;
  /** Ghostly highlight for selection/hover (rim tint). */
  setHighlight(mode: 'none' | 'hover' | 'selected'): void;
  /** Walk-cycle speed scale (1 = default shuffle at 1.3 tiles/game-minute at 1x). */
  setMoveSpeed(scale: number): void;
  update(dtSec: number): void;
  /** World position of the top of the head (bubbles anchor here). */
  headTop(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export interface CharacterFactory {
  ready: Promise<void>;
  progress(): number;
  create(app: ZombieAppearance, limbs: LimbState): ZombieRig;
  dispose(): void;
}

// ───────────────────────────── Renderer API (used by the game controller) ─────────────────────────────

export type WallMode = 'up' | 'cutaway' | 'down';
/** W-136 (docs/DESIGN_OPEN_WORLD.md §4.1): the orbit camera above the lot, behind a zombie, or through its eyes. */
export type Perspective = 'overview' | 'shoulder' | 'firstPerson';
export type ViewMode = 'live' | 'buy' | 'build';
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
/** A quality setting: a fixed level, or 'auto' (W-039: GPU tier + first-run probe + runtime downgrade). */
export type QualitySetting = QualityLevel | 'auto';

/**
 * Levels Auto may pick (W-039). Extension point for the strong-PC tier (W-107): once 'ultra' meets its perf budget,
 * add it here AND to AUTO_LEVELS (render/core/autoQuality.ts, ordered low -> high; a compile-time check keeps the two
 * in step) plus a GPU rule with tier 'ultra'. The governor, settings schema and UI derive everything else from it.
 */
export type AutoQualityLevel = 'low' | 'medium' | 'high';

/** Auto-quality state (W-039; see render/core/autoQuality.ts). */
export interface AutoQualityStatus {
  /** Level Auto renders at right now (never 'ultra' until W-107 adds it to AutoQualityLevel). */
  level: AutoQualityLevel;
  /** 'probe' = first-run frame-time probe running; 'watch' = settled, downgrading on a slow 10 s window. */
  phase: 'probe' | 'watch';
  /** GPU-tier ceiling from WEBGL_debug_renderer_info. */
  ceiling: AutoQualityLevel;
  gpuKind: 'software' | 'mobile' | 'integrated' | 'apple' | 'discrete' | 'unknown';
  /** Classified GPU string ('' when the browser hides it). */
  gpu: string;
  /** p95 frame time (ms) of the last judged probe / window; NaN before the first. */
  lastP95: number;
  downgrades: number;
}

/** What the Settings screen shows about the live renderer (W-039 / D-025). */
export interface GraphicsInfo {
  /** Level being rendered (the resolved level when the setting is 'auto'). */
  level: QualityLevel;
  /** Present while the quality setting is 'auto'. */
  auto: AutoQualityStatus | null;
  /** Render pixel ratio in use and the drawing-buffer size it gives. */
  pixelRatio: number;
  bufferWidth: number;
  bufferHeight: number;
  /** True when the preset raised the ratio above the display's (Ultra supersampling with an unset Pixel Ratio). */
  supersampled: boolean;
  /** True when the player set Pixel Ratio (it overrides every preset, D-025). */
  pixelRatioExplicit: boolean;
}

/**
 * Pick results. `point` is in SCENE coordinates (the home lot's lot-local frame, W-025 S5). Agents / objects that stand
 * in another region of the walkable world carry that `regionId` (absent = the home region). Ground or a house shell in
 * another region is a `worldTile`: a world route target (`WorldRouteTarget`, docs/DESIGN_WORLD_LEVELS.md §1.16) —
 * region id + lot-local tile — plus the world point. `tile` stays the HOME lot's tile, so existing home-only callers
 * never walk to another region's coordinates by mistake.
 */
export type PickResult =
  | { kind: 'agent'; agentId: AgentId; point: THREE.Vector3; regionId?: RegionId }
  | { kind: 'object'; objectId: ObjectId; point: THREE.Vector3; regionId?: RegionId }
  /** A stray or a household pet (W-013): `petId` is the id in WorldState.pets (strays 's…', pets 'p…'). */
  | { kind: 'pet'; petKind: 'stray' | 'pet'; petId: string; point: THREE.Vector3 }
  | { kind: 'wall'; edge: EdgeKey; side: 0 | 1; point: THREE.Vector3 }
  | { kind: 'tile'; x: number; z: number; point: THREE.Vector3 }
  | { kind: 'worldTile'; target: WorldRouteTarget; world: WorldPoint; what: 'ground' | 'structure'; point: THREE.Vector3 }
  | { kind: 'none' };

export interface PlacementGhost {
  defId: string;
  /** Floor placement (min corner of rotated footprint) */
  x?: number;
  z?: number;
  rot?: Rot;
  /** Wall/opening placement */
  edge?: EdgeKey;
  side?: 0 | 1;
  valid: boolean;
  tint?: string | null;
  /** Tiles to highlight (green/red) and blocked slot markers. */
  tiles: { x: number; z: number }[];
  blockedSlots?: { x: number; z: number }[];
}

export interface BuildOverlay {
  /** Wall edges previewed (being drawn or deleted). */
  edges?: EdgeKey[];
  edgeMode?: 'add' | 'remove';
  tiles?: { x: number; z: number }[];
  tileMode?: 'paint' | 'room' | 'remove';
  valid: boolean;
  /** Paint preview colour swatch id. */
  styleId?: string | null;
  /** Explicitly highlighted edge (else the renderer highlights the last pickGrid() edge in build mode). */
  hoverEdge?: EdgeKey | null;
  label?: string;
}

export interface BubbleAnchor {
  agentId: AgentId;
  /** CSS pixel position of the head top. */
  x: number;
  y: number;
  /** In front of the camera and inside the viewport. */
  visible: boolean;
  /** Distance-based scale 0.5..1.2 */
  scale: number;
}

export interface CameraState {
  target: Vec2;
  /** Yaw in radians (0 = looking from +Z toward -Z, i.e. from the street). */
  yaw: number;
  /** Distance from target. */
  distance: number;
  /** Pitch in radians (elevation). */
  pitch: number;
}

export interface PreviewStage {
  setAppearance(app: ZombieAppearance): void;
  setLimbs(limbs: LimbState): void;
  /** Same rules as ZombieRig.setAnim (core + extra states; extras fall back while their clip is missing). */
  setAnim(anim: AnyAnimState): void;
  setExpression(expr: Expression): void;
  /** Turntable rotation in radians (UI drag). */
  setYaw(yaw: number): void;
  resize(w: number, h: number): void;
  /**
   * W-130: whether the body the appearance asks for is what the turntable shows. 'loading' (fetching; the classic
   * body stands in), 'offline' (not cached and no network; classic until the connection returns), 'unavailable'
   * (failed to load; classic stays). Optional: stages without cast bodies are always 'ready'.
   */
  bodyStatus?(): PreviewBodyStatus;
  dispose(): void;
}

/** The camera-follow seam of the renderer (W-025 S5): `CameraFollowApi` from src/shared/world.ts. */
export type RendererCameraFollow = CameraFollowApi;
export type PreviewBodyStatus = 'ready' | 'loading' | 'offline' | 'unavailable';

export interface RendererAPI {
  /**
   * `pixelRatio` is the device ratio (auto) or the player's ratio when `pixelRatioExplicit` (D-025: an explicit ratio
   * overrides every preset, Ultra's supersampling included). `autoLevel` = the level a previous session's Auto
   * settled on (skips the first-run probe); used only with quality 'auto'.
   */
  init(canvas: HTMLCanvasElement, opts: { quality: QualitySetting; pixelRatio: number; pixelRatioExplicit?: boolean; autoLevel?: AutoQualityLevel | null }): Promise<void>;
  /** Asset loading progress 0..1 (models + characters + textures). */
  loadProgress(): number;
  /** Bind (or unbind with null) a simulation. Rebuilds the scene from its state. */
  attach(sim: SimulationAPI | null): void;
  /** Render a frame. `alpha` = interpolation factor between the previous and current sim tick. */
  frame(alpha: number, dtSec: number): void;
  /** Sim events drained by the controller each frame (fx, voice -> mouth flaps, lot changes, spawns). */
  consumeEvents(events: import('../sim/contracts').SimEvent[]): void;
  resize(width: number, height: number): void;
  /**
   * Effective device pixel ratio (the controller resolves 0/auto to min(devicePixelRatio, 2) first). `explicit` = the
   * player set it (D-025: wins over every preset window, Ultra's supersampling included); default false.
   */
  setPixelRatio(ratio: number, explicit?: boolean): void;
  /**
   * A fixed level, or 'auto'. For 'auto', `autoLevel` = the level a previous Auto run settled on (resume there, no
   * probe), null = probe afresh (first run / Reset Settings), omitted = keep the current Auto state.
   */
  setQuality(q: QualitySetting, autoLevel?: AutoQualityLevel | null): void;
  /** Live graphics state for the Settings screen (W-039 / D-025). Optional for mocks. */
  graphicsInfo?(): GraphicsInfo;
  /**
   * Whether rendered frames may feed the Auto-quality probe / watch (false behind loading screens, which render at a
   * throttled rate, and while hidden). Default true. Optional for mocks.
   */
  setAutoQualitySampling?(on: boolean): void;
  setViewMode(mode: ViewMode): void;
  setWallMode(mode: WallMode): void;
  getWallMode(): WallMode;
  /**
   * W-136: attach the view to a zombie (`shoulder` / `firstPerson`) or return to the orbit camera (`overview`).
   * A close view needs a zombie that is drawn now; without one the result is `overview`. The orbit camera state is
   * never changed by a close view, so returning shows the view the player left. While a close view is on: orbit /
   * pan drags look around, zoom moves the shoulder camera, panWorld does nothing, first person draws walls up and
   * hides that zombie's body. Returns the perspective in effect. Optional for mocks (absent = overview only).
   */
  setPerspective?(mode: Perspective, agentId: AgentId | null, instant?: boolean): Perspective;
  /** W-136: the perspective in effect (the renderer returns to `overview` by itself when the zombie stops being drawn). */
  getPerspective?(): Perspective;
  // camera
  /** +1 = camera orbits 45° clockwise seen from above (yaw decreases; camera offset = (sin yaw, cos yaw)); first step snaps onto the 45° grid. */
  rotateCamera(steps: number): void;
  orbit(deltaYaw: number, deltaPitch: number): void;
  /** 1 unit ≈ one mouse-wheel notch; positive = closer. */
  zoom(delta: number): void;
  pan(dxScreen: number, dyScreen: number): void; // in CSS pixels
  /** Camera-relative tiles: dx > 0 = screen right, dz < 0 = away from the viewer (W key). */
  panWorld(dx: number, dz: number): void;
  focus(target: Vec2 | AgentId, instant?: boolean): void;
  /** Follow an agent across regions (W-025 S5 `CameraFollowApi.follow`); a manual pan stops following. */
  follow(agentId: AgentId | null): void;
  /** W-025 S5 `CameraFollowApi.following`. Optional for mocks. */
  following?(): AgentId | null;
  /**
   * HUD panel rects (CSS px, canvas space) a followed / recentred actor is framed clear of (Sol P2; `hudPanelRects()`
   * from src/ui/hud/lib/storyFraming.ts). null = centre the actor. Optional for mocks.
   */
  setFrameAvoid?(fn: (() => { x: number; y: number; w: number; h: number }[]) | null): void;
  /** W-025 S5 `CameraFollowApi.recentre`: pan back to the followed (or selected) member; false = nobody to centre on. Optional for mocks. */
  recentre?(): boolean;
  /** W-025 S5: the selected member as the HUD / camera see it (§1.16 `SelectedActorView`); null without a selection. Optional for mocks. */
  selectedActor?(): SelectedActorView | null;
  /** W-025 S5: in-world sign texts, nearest to the camera focus first (§1.16 `SignView`, the DOM copy). Optional for mocks. */
  signs?(): SignView[];
  getCamera(): CameraState;
  /**
   * Where the view listens from (world sound volume, indoor / outdoor ambience): getCamera() in the overview; in a
   * close view the zombie it is attached to, at the close camera's distance. Optional for mocks (absent = getCamera()).
   */
  getListener?(): CameraState;
  setCamera(state: Partial<CameraState>, instant?: boolean): void;
  // picking & projection (clientX/Y relative to the canvas element)
  /** Walls always OCCLUDE: `walls: false` means "never return a wall" — a ray stopped by a visible wall yields {kind:'none'}
   *  rather than what is hidden behind it. Objects set into a wall (doors, windows, wall items) beat their wall. */
  pick(clientX: number, clientY: number, opts?: { agents?: boolean; objects?: boolean; walls?: boolean; tiles?: boolean }): PickResult;
  /** Tile + nearest edge under the cursor (build mode). `fx`/`fz` are ABSOLUTE continuous world coordinates (tile units) of the cursor on the ground plane (x <= fx < x+1). */
  pickGrid(clientX: number, clientY: number): { x: number; z: number; fx: number; fz: number; edge: EdgeKey | null; edgeSide: 0 | 1 } | null;
  worldToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean };
  /** W-116: the game's Reduce motion setting (the story marker stands still; prefers-reduced-motion too). */
  setReduceMotion?(on: boolean): void;
  /** Miniature look (tilt-shift focus + split-tone on high/ultra); the player's Settings → Miniature focus. */
  setMiniatureFocus?(on: boolean): void;
  /** W-116: the story-step marker as drawn (null when hidden). */
  storyMarker?(): { questId: string; stepId: string; objectId: string; tip: { x: number; y: number; z: number } } | null;
  /** W-116: bounds centre of a drawn object (null when not drawn). */
  objectPoint?(objectId: string): { x: number; y: number; z: number } | null;
  /** W-116: pan (same yaw / pitch / distance) so `world` lands on `screen`; false when unsolvable. */
  frameAt?(world: { x: number; y: number; z: number }, screen: { x: number; y: number }, instant?: boolean): boolean;
  bubbleAnchors(): BubbleAnchor[];
  // overlays
  setSelection(agentId: AgentId | null): void;
  setHover(target: { kind: 'agent'; id: AgentId } | { kind: 'object'; id: ObjectId } | null): void;
  setPlacementGhost(ghost: PlacementGhost | null): void;
  /** Home build rules: glowing snap-point markers for the item being placed (null / [] = none). Optional. */
  setSnapPoints?(points: { x: number; z: number; kind: string }[] | null): void;
  setBuildOverlay(overlay: BuildOverlay | null): void;
  /** Hide an object while it is being moved in buy mode. */
  setHiddenObject(objectId: ObjectId | null): void;
  /** Catalog thumbnail (PNG data URL, 128x128, transparent background). Cached. */
  thumbnail(modelId: string, tint?: string | null): Promise<string>;
  /** Turntable character preview for Create-a-Zombie. */
  createPreview(canvas: HTMLCanvasElement): PreviewStage;
  /** Screenshot of the current view (JPEG data URL, ≤ 64 KB; quality steps down to fit; '' without a GL context) for save thumbnails. */
  snapshot(width: number, height: number): string;
  /** Approximate frames per second (for the perf overlay / auto quality). */
  fps(): number;
  dispose(): void;
}
