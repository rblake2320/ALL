/**
 * GAME CONTROLLER CONTRACT — the single object the UI talks to. Implemented in src/game/controller.ts.
 * The UI never imports the renderer/sim/persistence directly; it goes through GameController.
 *
 * Reactivity: the controller exposes `subscribe(fn)`; listeners fire at most ~12x/sec (throttled) and
 * immediately on discrete changes (screen/mode/selection/menu/dialog changes). UI components read
 * whatever they need from the controller/sim on each notification (use the `useGame()` hook in src/ui/hooks.ts).
 */
import type { SimulationAPI, MenuEntry, NewGameOptions, NewMemberSpec, BuildCommand, CommandResult } from '../sim/contracts';
import type { RendererAPI, WallMode, Perspective, ViewMode, AutoQualityLevel, QualitySetting, GraphicsInfo, PreviewStage } from '../render/contracts';
import type { AudioAPI, AudioVolumes } from '../audio/contracts';
import type { SaveSlotInfo, LoadResult, SaveResult } from '../persistence/contracts';
import type { Speed, AgentId, ObjectId, TargetRef, Notification, EdgeKey } from '../sim/types';
import type { Rot } from '../shared/dimensions';
import type { WorldRouteResult, WorldRouteTarget } from '../shared/world';
import type { SfxId } from '../shared/audioIds';

export type Screen = 'boot' | 'menu' | 'newGame' | 'caz' | 'loading' | 'game' | 'gameOver';

export interface Settings {
  /** 'auto' (default, W-039): GPU tier + first-run probe pick Low/Medium/High, downgraded at runtime when too slow. */
  quality: QualitySetting;
  /**
   * Level Auto settled on (persisted so later sessions skip the probe; 'unset' = probe on next start). Written by
   * the controller, not by the Settings UI; Reset Settings clears it (re-probe).
   */
  autoQuality: 'unset' | AutoQualityLevel;
  /** 0 = auto (devicePixelRatio, capped at 2). Any other value is explicit and overrides every quality preset (D-025). */
  pixelRatio: number;
  volumes: AudioVolumes;
  /**
   * W-150 (owner): music is OFF until the player turns it on (main menu or Settings → Audio). The music volume
   * slider keeps its value; while this is false the music channel is sent to the audio engine as 0.
   */
  musicEnabled: boolean;
  /**
   * One-key mute (M) and the HUD speaker: silences music, effects, ambience, UI sounds and the zombie voice at once without
   * touching the volume sliders. Stored per profile with the other settings, so it survives a reload.
   */
  muted: boolean;
  muteWhenUnfocused: boolean;
  pauseWhenUnfocused: boolean;
  autosaveMinutes: number; // real minutes; 0 = off
  edgeScroll: boolean;
  cameraSpeed: number; // 0.5..2
  invertZoom: boolean;
  uiScale: number; // 0.8..1.4
  reduceMotion: boolean;
  miniatureFocus: boolean; // tilt-shift "miniature set" look on high/ultra
  colorblindNeeds: boolean; // pattern+icon need bars
  showFps: boolean;
  autonomy: 'full' | 'limited' | 'off';
  autoPauseOnEvents: boolean;
  tutorialEnabled: boolean;
  /**
   * Home build rules (docs/contract-requests/home-build-system.md): a NEW game starts with snap points for the first 20
   * items, then Free Placement (working furniture stays on service points). Off = free placement as ever. Only read when a
   * new game is created; an existing world keeps what it was made with.
   */
  snapBuilding: boolean;
  language: 'en';
}

export interface Toast {
  id: number;
  kind: Notification['kind'];
  title: string;
  text: string;
  agentId: AgentId | null;
  objectId: ObjectId | null;
  createdAt: number; // performance.now()
}

export interface OpenMenu {
  actorId: AgentId;
  target: TargetRef;
  title: string;
  entries: MenuEntry[];
  /** CSS px relative to the viewport. */
  x: number;
  y: number;
}

export type BuildTool =
  | { kind: 'select' }
  | { kind: 'wall'; style: string }
  | { kind: 'room'; floor: string | null; wallStyle: string }
  | { kind: 'deleteWall' }
  | { kind: 'door'; defId: string }
  | { kind: 'window'; defId: string }
  | { kind: 'floor'; styleId: string | null }
  | { kind: 'paintWall'; styleId: string; wholeRoom: boolean }
  | { kind: 'eyedropper' };

export interface BuyState {
  /** Catalog item being placed (null = hand tool / selecting existing objects). */
  placingDefId: string | null;
  /** Existing object picked up for moving. */
  movingObjectId: ObjectId | null;
  rot: Rot;
  tint: string | null;
  category: string;
  /** Placed object under the cursor in buy mode (offer Sell/Move on hover). */
  hoverObjectId: ObjectId | null;
  /**
   * W-116 (D-062): touch "Place another" toggle — while on, a placement keeps placing (like Shift+click on desktop).
   * Off by default: one click places ONE item and returns to the catalog.
   */
  keepPlacing: boolean;
  /** The catalog item last placed / picked (kept highlighted in the catalog after placement ends). */
  lastDefId: string | null;
}

export type DialogId =
  | 'settings'
  | 'saveLoad'
  | 'pause'
  | 'help'
  | 'phone'
  | 'careers'
  | 'invite'
  | 'rewards'
  | 'household'
  | 'confirmQuit'
  | 'credits'
  | 'diagnostics'
  /** Afterlife Store (src/ui/store; docs/MONETIZATION.md §3). Pauses like the other system dialogs. */
  | 'store'
  /** Report a bug / send feedback (src/ui/feedback; W-110). Pauses like the other system dialogs. */
  | 'feedback'
  /** Home services screens (Hearth, Wardrobe, Embalming, Crypt Vault; src/ui/hud/dialogs/HomeServiceDialog.tsx). Opened from the object's click menu; does not pause. */
  | 'homeService'
  | null;

export interface CazState {
  members: NewMemberSpec[];
  activeIndex: number;
  householdName: string;
  lotTemplate: NewGameOptions['lotTemplate'];
  difficulty: NewGameOptions['difficulty'];
}

export interface GameController {
  /** Change counter: increments on every notification (NOT the app version — see appVersion). */
  readonly version: number;
  /** Semver of the build (GAME_VERSION from src/persistence). */
  readonly appVersion: string;
  /** Loaded content registry, available from boot (before any simulation exists) for CAZ/catalog text. */
  readonly content: import('../sim/contracts').ContentRegistry | null;
  /** Lot templates (names, descriptions, starting funds) for the New Game screen, available before a sim exists. */
  readonly lotTemplates: readonly import('../sim/contracts').LotTemplate[];
  /** Reason from the sim 'gameOver' event (e.g. "Rest in Pieces"), null otherwise. */
  readonly gameOverReason: string | null;
  /**
   * Profile-level economy (Bones ledger, store, daily tasks, age gate — src/economy, docs/MONETIZATION.md). Optional:
   * null/undefined when the build or a test double has none (the store UI then renders nothing).
   */
  readonly economy?: import('../economy/facade').EconomyFacade | null;
  /**
   * Player bug reports + feedback (src/game/feedback.ts, W-110): capture → dialog → crash-safe outbox → .alreport
   * export. Optional: null/undefined in test doubles (the UI then offers no report entry points).
   */
  readonly feedback?: import('./feedback').FeedbackFacade | null;
  /**
   * Local playtest session log (src/game/sessionLog.ts, W-117): recorded on this device only, copy-to-clipboard export.
   * Optional: null/undefined in test doubles (the UI then offers no "Copy session log" entry).
   */
  readonly sessionLog?: import('./sessionLog').SessionLogFacade | null;
  /** Idempotent bootstrap: installs input handlers on the canvas, inits the renderer, waits for assets, enters the menu. */
  boot(canvas: HTMLCanvasElement): Promise<void>;
  /** Tear down listeners/loops/renderer (HMR, tests, second bootstraps). */
  dispose(): void;
  subscribe(fn: () => void): () => void;

  // Lifecycle / screens
  readonly screen: Screen;
  readonly loadingProgress: number;
  readonly loadingLabel: string;
  readonly fatalError: string | null;
  goto(screen: Screen): void;
  /** Start Create-a-Zombie for a new game. */
  beginNewGame(): void;
  readonly caz: CazState | null;
  updateCaz(patch: Partial<CazState>): void;
  updateCazMember(index: number, patch: Partial<NewMemberSpec>): void;
  addCazMember(): void;
  removeCazMember(index: number): void;
  randomizeCazMember(index: number, what?: 'all' | 'look' | 'traits' | 'name'): void;
  /** Validates CAZ (names, 3 traits, conflicts) and returns errors (empty = ok). */
  validateCaz(): string[];
  /** Same validation, mapped to member + field for inline errors. */
  validateCazDetailed(): {
    memberIndex: number | null;
    field: 'household' | 'householdName' | 'firstName' | 'lastName' | 'traits' | 'aspiration' | 'appearance';
    message: string;
  }[];
  startGame(): Promise<void>;
  createCazPreview(canvas: HTMLCanvasElement): PreviewStage;

  // Saves
  listSaves(): Promise<SaveSlotInfo[]>;
  /** slotId omitted = the world's default manual slot (quick-save). UI may pass ANY valid fresh id (^[a-z0-9_-]{1,40}$, not a Windows device name) for "New save", or an existing row's id to overwrite (autosave slots are not overwritable from the UI). */
  saveGame(slotId?: string, name?: string): Promise<SaveResult>;
  /**
   * Ask for an event-driven autosave soon (store purchase / unlock, anything precious). Debounced, never more than one
   * autosave per 10 s, skipped when nothing changed. Safe to call any time (no-op outside a live game).
   */
  saveSoon?(reason: string): void;
  loadGame(slotId: string): Promise<LoadResult>;
  continueLatest(): Promise<boolean>;
  deleteSave(slotId: string): Promise<void>;
  exportSave(slotId: string): Promise<void>; // triggers download
  importSave(file: File): Promise<LoadResult>;
  /** COMPLETE player-facing phrase ("Saved just now", "Saved 12 min ago", "Save failed") — show verbatim. */
  readonly lastSaveLabel: string | null;
  /** Epoch ms of the last successful save of the current world (for localisable/relative formatting), null if none. */
  readonly lastSavedAt: number | null;
  readonly lastSaveFailed: boolean;
  readonly saving: boolean;
  quitToMenu(): Promise<void>;
  quitApp(): void;
  readonly canQuitApp: boolean;

  // In-game state
  readonly sim: SimulationAPI | null;
  readonly renderer: RendererAPI;
  readonly audio: AudioAPI;
  readonly mode: ViewMode;
  setMode(mode: ViewMode): void;
  readonly speed: Speed;
  setSpeed(speed: Speed): void;
  togglePause(): void;
  /** Ultra speed (4) currently permitted (every on-lot household zombie asleep/passed out; at work/crumbled count as ok). UI and hotkeys both use this. */
  readonly ultraAllowed: boolean;
  /** Animated 45° camera step (wraps renderer.rotateCamera). */
  rotateCamera(dir: 1 | -1): void;
  /** Focus the camera on an object (toasts about objects, "Show Mailbox"). */
  focusObject(id: ObjectId): void;
  /**
   * W-116: frame an object so it lands on `screen` (viewport CSS px — a spot clear of the HUD, from
   * shared/framing.ts pickFramePoint) keeping yaw / pitch / distance; without `screen` it just centres it. Smooth
   * unless `instant`. Returns false when there is no such object or no game.
   */
  frameObject(id: ObjectId, opts?: { screen?: { x: number; y: number }; instant?: boolean }): boolean;
  /** W-116: the object the running Act 1 step points at (shared/storyTarget.ts), null when none. */
  readonly storyTarget: import('../shared/storyTarget').StoryTarget | null;
  /**
   * W-123 (D-070): what "Go" on a quest / daily-task / weekly-challenge row would do right now (read-only, cached per
   * world change): queue an interaction, switch mode, "Needs an easel" (Buy filter) or a blocked reason.
   */
  questAction(ref: import('./questGo').QuestRowRef): import('./questGo').QuestGoResult;
  /**
   * W-123: carry a row's Go out — queue the action for the selected (or best available) zombie through the ordinary
   * queue command (never twice), or open Build / Buy / the careers dialog; toasts what happens and logs `quest.go`.
   * `frame: false` = the caller frames the camera itself (the HUD frames the target clear of its panels).
   */
  questGo(ref: import('./questGo').QuestRowRef, opts?: { frame?: boolean }): import('./questGo').QuestGoResult;
  /**
   * W-124 (D-071) household jobs: assign / cancel / pause / resume / priority / move — one ordinary journaled `job`
   * command (the sim validates it; "coming later" categories are refused). Read the list with `sim.jobs()`.
   */
  job(cmd: import('../sim/contracts').JobCommand): CommandResult;
  /** W-013 strays and pets: one ordinary journaled `pet` command (Feed / Play / Cuddle, or a stray action); the pets system validates it. */
  pet(cmd: import('../sim/contracts').PetCommand): CommandResult;
  /** Home services (Hearth upgrades, Wardrobe, Embalming respec, Crypt Vault): one ordinary journaled `home` command; the homeServices system validates it. */
  home(cmd: import('../sim/contracts').HomeCommand): CommandResult;
  /** Command wrappers so the UI never dispatches to the sim directly. */
  buyReward(agentId: AgentId, rewardId: string): CommandResult;
  renameHousehold(name: string): CommandResult;
  /** W-116 (D-063): household "Autonomous purchases": 'off', 'unlimited' or a daily cap in $. */
  setAutoPurchases(value: 'off' | 'unlimited' | number): CommandResult;
  markNotificationsRead(): void;
  readonly selectedAgentId: AgentId | null;
  selectAgent(id: AgentId | null, focusCamera?: boolean): void;
  cycleSelection(dir: 1 | -1): void;
  readonly wallMode: WallMode;
  setWallMode(mode: WallMode): void;
  cycleWallMode(): void;
  /**
   * W-136 (docs/DESIGN_OPEN_WORLD.md §4.1): how the selected zombie is looked at — `overview` (the camera above the
   * lot), `shoulder` (behind it) or `firstPerson` (through its eyes). The close views exist in Live mode only and
   * need a selected zombie that is at home; otherwise the perspective stays / returns to `overview` (Buy / Build,
   * the zombie leaving or crumbling, Esc). The overview camera is kept as the player left it.
   */
  readonly perspective: Perspective;
  setPerspective(perspective: Perspective): void;
  cyclePerspective(): void;

  // Live-mode interaction menu
  readonly menu: OpenMenu | null;
  openMenuFor(target: TargetRef, x: number, y: number): void;
  closeMenu(): void;
  chooseMenuEntry(entry: MenuEntry, child?: MenuEntry): void;
  cancelQueueItem(uid: number): void;
  /**
   * W-025 S3: walk a household member to a region-local tile anywhere in the world (map pin / keyboard / S5 tap).
   * Always returns the authoritative `WorldRouteResult` (route, or one reason code; refusals are also toasted).
   */
  walkTo?(actorId: AgentId, target: WorldRouteTarget): WorldRouteResult;
  /** Run a phone action for the selected zombie (queues the phone interaction). */
  phone(action: string, params?: Record<string, string | number | boolean>): void;

  // Buy mode
  readonly buy: BuyState;
  setBuyCategory(category: string): void;
  startPlacing(defId: string, tint?: string | null): void;
  pickUpObject(objectId: ObjectId): void;
  rotatePlacement(dir: 1 | -1): void;
  setPlacementTint(tint: string | null): void;
  cancelPlacement(): void;
  /** W-116: the placement bar's "Done" — stop placing and return to the catalog (same as Esc). */
  finishPlacing(): void;
  /** W-116: the placement bar's touch "Place another" toggle (keep placing after each placement). */
  setKeepPlacing(on: boolean): void;
  sellObject(objectId: ObjectId): void;

  // Build mode
  readonly buildTool: BuildTool;
  setBuildTool(tool: BuildTool): void;
  applyBuild(cmd: BuildCommand): boolean;
  undo(): void;
  redo(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;

  // Dialogs, toasts, choices
  readonly dialog: DialogId;
  /** Options of the open dialog (returnTo parent, saveLoad tab). */
  readonly dialogOptions: { returnTo?: DialogId; mode?: 'save' | 'load'; service?: import('../shared/homeServices').HomeDialogService } | null;
  openDialog(d: DialogId, opts?: { returnTo?: DialogId; mode?: 'save' | 'load'; service?: import('../shared/homeServices').HomeDialogService }): void;
  closeDialog(): void;
  /**
   * Toast ownership: on the 'game' screen the HUD owns visible lifetime (~6 s unhovered, hover pauses, max 5); on every
   * other screen the shell hosts them (max 3). Both call dismissToast on expiry. The controller's own TTL is only a
   * ≥ 60 s safety net (and caps the list at 20).
   */
  readonly toasts: Toast[];
  dismissToast(id: number): void;
  /** Transient thought/speech bubbles from sim 'bubble' events (HUD positions them via renderer.bubbleAnchors()). */
  readonly bubbles: { key: number; agentId: AgentId; icon: string; style: 'thought' | 'speech' | 'shout'; positive: boolean; until: number }[];
  /** Build/buy cursor label, e.g. "$45 · 3 walls" or "Can't place over a wall". */
  readonly buildPreviewLabel: string | null;
  /**
   * Screen-reader announcement for keyboard placement in Buy mode (W-064): position, validity / refusal reason,
   * placed, rotated, cancelled. `seq` increases with every announcement so the HUD's live region can repeat a text.
   * Optional so UI harness mocks need not implement it.
   */
  readonly placementAnnouncement?: { seq: number; text: string } | null;
  /** Active choice popups from the sim (work events, life events). */
  resolveChoice(choiceId: string, option: number): void;

  // Tutorial hints
  readonly hint: { id: string; title: string; text: string; anchor: string | null } | null;
  dismissHint(id: string, never?: boolean): void;

  // Settings
  readonly settings: Settings;
  /** Live renderer graphics state for Settings ("Auto — currently Medium", Ultra's internal resolution). Optional for mocks. */
  readonly graphics?: GraphicsInfo | null;
  updateSettings(patch: Partial<Settings>): void;
  resetSettings(): void;

  // Misc
  playUi(id: SfxId): void;
  readonly fps: number;
  diagnostics(): string;
  /** Input routing (canvas pointer/keyboard) is owned by the controller; UI elements call these. */
  readonly hoverLabel: string | null;
  readonly gridHover: { x: number; z: number; edge: EdgeKey | null } | null;
}

export const DEFAULT_SETTINGS: Settings = {
  // W-039: was 'high' (below 30 fps on integrated GPUs, Sol W-022). Stored profiles keep their explicit level.
  quality: 'auto',
  autoQuality: 'unset',
  pixelRatio: 0,
  volumes: { master: 0.8, music: 0.55, sfx: 0.8, voice: 0.75, ambient: 0.5, ui: 0.6 },
  musicEnabled: false,
  muted: false,
  muteWhenUnfocused: true,
  pauseWhenUnfocused: true,
  autosaveMinutes: 5,
  edgeScroll: false,
  cameraSpeed: 1,
  invertZoom: false,
  uiScale: 1,
  reduceMotion: false,
  miniatureFocus: true,
  colorblindNeeds: false,
  showFps: false,
  autonomy: 'full',
  autoPauseOnEvents: true,
  tutorialEnabled: true,
  snapBuilding: false,
  language: 'en',
};

/**
 * Keyboard map (documented in the Help dialog; controller implements).
 * Ownership rule: controller hotkeys MUST ignore events that are `defaultPrevented`, or whose target is editable
 * (input/textarea/select/contenteditable) or inside `[role="menu"]` / `[role="dialog"]` — UI widgets handle their own
 * keys there (Esc closes the innermost UI layer only; arrows navigate menus instead of panning).
 */
export const KEYMAP = {
  pause: ['Space', 'Digit0', 'Backquote'],
  speed1: ['Digit1'],
  speed2: ['Digit2'],
  speed3: ['Digit3'],
  speedUltra: ['Digit4'],
  modeLive: ['F1', 'KeyL'],
  modeBuy: ['F2', 'KeyB'],
  modeBuild: ['F3', 'KeyU'],
  rotateCamLeft: ['KeyQ', 'Comma'],
  rotateCamRight: ['KeyE', 'Period'],
  panUp: ['KeyW', 'ArrowUp'],
  panDown: ['KeyS', 'ArrowDown'],
  panLeft: ['KeyA', 'ArrowLeft'],
  panRight: ['KeyD', 'ArrowRight'],
  zoomIn: ['Equal', 'NumpadAdd', 'KeyZ'],
  zoomOut: ['Minus', 'NumpadSubtract', 'KeyX'],
  wallMode: ['KeyC', 'PageUp'],
  /** W-136: overview → over the shoulder → first person → overview. */
  perspective: ['KeyV'],
  rotateObject: ['KeyR'],
  sell: ['Delete', 'Backspace'],
  undo: ['ctrl+KeyZ'],
  redo: ['ctrl+KeyY', 'ctrl+shift+KeyZ'],
  cycleZombie: ['Tab'],
  /**
   * DOCUMENTATION-ONLY (shown in Help): the HUD owns F6 / Shift+F6 (region cycling, src/ui/hud/parts/keynav.ts).
   * The controller never binds it — see `DOC_ONLY_ACTIONS` in src/game/input/keyboard.ts.
   */
  focusHud: ['F6', 'shift+F6'],
  focusSelected: ['KeyF'],
  help: ['F10', 'shift+Slash'],
  quickSave: ['F5', 'ctrl+KeyS'],
  /** Mute or unmute all sound (Settings.muted); works in the menus and in the game. */
  mute: ['KeyM'],
  /** Open the Afterlife Store (in game; the store UI opens it from the menu itself). */
  store: ['KeyG'],
  /** Report a bug / send feedback (W-110): screenshot first, then the dialog. */
  feedback: ['F8'],
  menu: ['Escape'],
} as const;
