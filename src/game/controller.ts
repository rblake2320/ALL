/**
 * GAME CONTROLLER — the single object the UI talks to (src/game/contracts.ts).
 *
 *   boot → loading (renderer init + asset progress) → menu (demo world) → newGame → caz → game ⇄ gameOver
 *
 * This file is the composition root + facade. Behaviour lives in focused modules operating on a shared Core:
 *   lifecycle.ts (screens, sessions, crash path, settings)  frame.ts (fixed-timestep loop body)
 *   gameplay.ts (speed/mode/selection/menu/dialogs/build)   saveFlow.ts + autosave.ts (saves)
 *   input/* (pointer, keyboard, camera, live, buy, build)  events.ts (sim events → audio/toasts/bubbles)
 *   cazFlow.ts / cazState.ts / randomZombie.ts (CAZ)       hints.ts, diagnostics.ts, demoWorld.ts, media.ts
 * Every external call sits behind a fault barrier; public async methods never reject.
 */
import type { StoryTarget } from '../shared/storyTarget';
import { questActionFor, questGo, type QuestGoResult, type QuestRowRef } from './questGo';
import { GO_HINT_HOLD_MS } from './hints';
import type { BuildTool, BuyState, CazState, DialogId, GameController, OpenMenu, Screen, Settings, Toast } from './contracts';
import type { BuildCommand, CommandResult, ContentRegistry, HomeCommand, JobCommand, LotTemplate, PetCommand, MenuEntry, NewMemberSpec, SimulationAPI } from '../sim/contracts';
import type { AgentId, EdgeKey, ObjectId, Speed, TargetRef } from '../sim/types';
import type { WorldRouteResult, WorldRouteTarget } from '../shared/world';
import type { GraphicsInfo, Perspective, PreviewStage, RendererAPI, ViewMode, WallMode } from '../render/contracts';
import type { AudioAPI } from '../audio/contracts';
import type { LoadResult, ProfileStore, SaveManager, SaveResult, SaveSlotInfo } from '../persistence/contracts';
import type { SfxId } from '../shared/audioIds';
import { createBrowserEnv, type GameEnv } from './env';
import type { SimModule } from './simTypes';
import { defaultSimModule } from './simModule';
import { Core } from './core';
import { Gameplay, type DialogOptions } from './gameplay';
import { freeTextNamesForBracket } from './names';
import { PET_VARIANTS_LIVE, petVariantId } from '../economy/catalog';
import { SaveFlow } from './saveFlow';
import { InputController } from './input/index';
import type { KeyAction, KeyEventLike } from './input/keyboard';
import { FrameDriver, minutesPerSecond } from './loop';
import { isSfxId, type RouterHost } from './events';
import { buildDiagnostics } from './diagnostics';
import { effectivePixelRatio } from './settings';
import type { CazCatalog } from './gddCatalog';
import type { CazIssue } from './cazState';
import { GAME_VERSION } from './version';
import type { Bubble } from './toasts';
import type { VisibleHint } from './hints';
import { STORY_INTRO_ID } from './storyIntro';
import { updateMusic } from './media';
import { frame, onRenderError } from './frame';
import * as life from './lifecycle';
import * as cazFlow from './cazFlow';
import type { EconomyService } from '../economy/service';
import { FeedbackService } from './feedback';
import { SessionLogService } from './sessionLog';

export interface GameControllerDeps {
  renderer: RendererAPI;
  audio: AudioAPI;
  saves: SaveManager;
  profile: ProfileStore;
  /** Simulation entry points (default: src/sim/index). */
  sim?: SimModule;
  /** Platform services (default: the browser). */
  env?: GameEnv;
  /** Profile economy (src/economy/index.ts createEconomy); optional — absent in tests/fallbacks. */
  economy?: EconomyService | null;
}

/** GameController plus bootstrap hooks and the data CAZ/new-game screens need (docs/contract-requests/game.md). */
export interface GameControllerImpl extends GameController {
  /** Bind to the canvas and start loading. Idempotent. */
  boot(canvas: HTMLCanvasElement): Promise<void>;
  dispose(): void;
  readonly gameOverReason: string | null;
  readonly content: ContentRegistry | null;
  readonly lotTemplates: readonly LotTemplate[];
  readonly cazCatalog: CazCatalog;
}

function wire(c: Core): void {
  const env = c.env;
  c.play = new Gameplay({
    renderer: c.renderer,
    audio: c.audio,
    session: () => c.session,
    screen: () => c.screen,
    settings: () => c.settings,
    // Fails closed: no profile economy yet (boot), or an unanswered age question = preset names, like a child profile.
    freeTextNames: () => freeTextNamesForBracket(c.economy?.age?.bracket),
    petVariantAccess: (species) => (c.economy?.isUsable(petVariantId(species)) ? 'ok' : PET_VARIANTS_LIVE ? 'locked' : 'comingSoon'),
    toast: (k, t, x, o) => c.toast(k, t, x, o),
    sfx: (id) => c.sfx(id),
    report: (w, e) => c.report(w, e),
    changed: (d) => c.changed(d),
    onModeChanged: () => {
      c.input.sync();
      updateMusic(c);
    },
    onWorldEdited: () => refreshEditors(c),
  });
  c.saveFlow = new SaveFlow({
    freeTextNames: () => freeTextNamesForBracket(c.economy?.age?.bracket),
    env,
    renderer: c.renderer,
    saves: c.saves,
    session: () => c.session,
    screen: () => c.screen,
    settings: () => c.settings,
    choicePending: () => c.play.pendingChoices() > 0,
    toast: (k, t, x, o) => c.toast(k, t, x, o),
    sfx: (id) => c.sfx(id),
    report: (w, e) => c.report(w, e),
    changed: (d) => c.changed(d),
  });
  c.input = new InputController({
    renderer: c.renderer,
    env,
    sim: () => c.session?.sim ?? null,
    settings: () => c.settings,
    setHoverLabel: (l) => {
      if (l === c.play.hoverLabel) return;
      c.play.hoverLabel = l;
      c.notifier.markDirty();
    },
    setGridHover: (h) => {
      const cur = c.play.gridHover;
      if (h === cur || (h && cur && h.x === cur.x && h.z === cur.z && h.edge === cur.edge)) return;
      c.play.gridHover = h ? { x: h.x, z: h.z, edge: h.edge ?? null } : null;
      c.notifier.markDirty();
    },
    setBuildPreviewLabel: (l) => {
      if (l === c.play.buildPreviewLabel) return;
      c.play.buildPreviewLabel = l;
      c.notifier.markDirty();
    },
    toast: (k, t, x) => c.toast(k, t, x),
    sfx: (id) => c.sfx(id),
    changed: (d) => c.changed(d),
    selectedAgentId: () => c.play.selectedAgentId,
    walkTo: (id, target) => c.play.walkTo(id, target),
    selectAgent: (id, focus, byPlayer) => c.play.selectAgent(id, focus === true, byPlayer !== false),
    openMenuFor: (t, x, y) => c.play.openMenuFor(t, x, y, env.viewport()),
    openPetMenu: (k, id, x, y) => c.play.openPetMenu(k, id, x, y, env.viewport()),
    closeMenu: () => c.play.closeMenu(),
    isMenuOpen: () => c.play.menu !== null,
    applyBuild: (cmd) => applyBuild(c, cmd),
    placeCopy: (defId, tint) => startPlacing(c, defId, tint),
    screen: () => c.screen,
    mode: () => c.play.mode,
    blocked: () => c.screen !== 'game' || c.fatal !== null || c.play.dialog !== null || c.session?.gameOver === true,
    runAction: (a, e) => runAction(c, a, e),
    escape: () => escape(c),
    onError: (w, e) => c.report(w, e),
  });
  c.driver = new FrameDriver(env, (dt, now, info) => frame(c, dt, now, info.background), { onError: (e) => onRenderError(c, e) });
  c.gameRouterHost = routerHost(c, true);
  c.demoRouterHost = routerHost(c, false);
}

function refreshEditors(c: Core): void {
  c.guard('input.refresh', () => {
    c.input.buy.refresh();
    c.input.build.refresh();
    c.input.invalidateHover();
  });
}

function routerHost(c: Core, interactive: boolean): RouterHost {
  return {
    audio: c.audio,
    renderer: c.renderer,
    viewport: () => c.env.viewport(),
    now: () => c.env.now(),
    toasts: c.toastCenter,
    bubbles: c.bubbleBoard,
    gameMinutesPerSecond: () => minutesPerSecond(c.play.effectiveSpeed),
    interactive: () => interactive && c.screen === 'game' && c.fatal === null,
    isSelected: (id) => id === c.play.selectedAgentId,
    onSaveWorthy: (reason) => {
      if (interactive) c.saveFlow.saveSoon(reason);
    },
    onChoice: () => {
      if (!interactive) return;
      c.play.onChoiceEvent();
      c.notifier.notifyNow();
    },
    onGameOver: (reason) => {
      if (interactive) life.enterGameOver(c, reason);
      else c.demoRebuildPending = true;
    },
    onMusic: (mood) => {
      if (interactive) c.musicDirector.onEvent(mood, c.env.now());
    },
    onAgentLeft: () => {
      if (!interactive) return;
      c.play.maintainSelection();
      c.play.validateMenu();
    },
    onObjectRemoved: (id) => {
      if (!interactive) return;
      c.input.buy.objectRemoved(id);
      c.play.validateMenu();
    },
    onLotChanged: () => {
      if (interactive) refreshEditors(c);
    },
    onError: (w, e) => c.report(w, e),
  };
}

/**
 * Esc chain (KEYMAP ownership rule: Esc closes the innermost layer only). Open dialogs belong to the UI — its modals
 * close themselves (focus inside: panel handler; focus outside: their window fallback), including nested prompts the
 * controller cannot see — so the controller never touches them. Otherwise: interaction menu → active buy/build tool
 * → open the pause menu.
 */
function escape(c: Core): boolean {
  if (c.play.dialog !== null) return false;
  if (c.play.closeMenu()) return true;
  const h = c.input.activeHandler();
  if (h && h.escape()) return true;
  // W-136: Esc steps back out of a close view before it opens the pause menu
  if (c.inGame() && c.play.perspective !== 'overview') {
    c.play.setPerspective('overview');
    return true;
  }
  if (c.inGame()) {
    c.play.openDialog('pause');
    return true;
  }
  return false;
}

function startPlacing(c: Core, defId: string, tint?: string | null): void {
  if (!c.inGame()) return;
  // Catalogue tiers (docs/MONETIZATION.md §3): a locked item opens the store on it instead of being placed (also
  // covers the eyedropper "place a copy"); unlocked items still cost household $ through the sim as always.
  const econ = c.economy;
  if (econ && !econ.isUsable(defId)) {
    c.sessionLog?.locked('item');
    const lock = econ.buyLock(defId);
    if (lock.state === 'locked') econ.focusStore('items', `item:${defId}`, 'buyLock');
    if (lock.state === 'locked') c.play.openDialog('store');
    else c.sfx('uiError');
    return;
  }
  if (c.play.mode !== 'buy') c.play.setMode('buy');
  c.input.buy.startPlacing(defId, tint);
}

/** Session log (W-117): Ultra asked for but refused (someone awake) counts as a click on a locked control. */
function noteUltra(c: Core, requested: Speed): void {
  if (requested === 4 && c.inGame() && c.play.speed.chosen !== 4) c.sessionLog?.locked('ultra');
}

/**
 * Session log (W-117): wrap each mode handler's click so a click/tap on the world that changed nothing (no selection,
 * no menu, no command, no tool state) is counted as non-productive. The handlers themselves are untouched.
 */
function observeWorldClicks(c: Core): void {
  const handlers: [string, { click: (p: never, m: never) => void }][] = [
    ['live', c.input.live as never],
    ['buy', c.input.buy as never],
    ['build', c.input.build as never],
  ];
  for (const [mode, h] of handlers) {
    const orig = h.click.bind(h);
    h.click = (p: never, m: never) => {
      const log = c.sessionLog;
      let before = '';
      let reason = '';
      // the probe can never cost the click itself
      if (log) c.guard('sessionLog.click', () => ((before = SessionLogService.clickProbe(c)), (reason = SessionLogService.clickReason(c, mode))));
      orig(p, m);
      if (log) c.guard('sessionLog.click', () => log.worldClick(mode, SessionLogService.clickProbe(c) !== before, reason));
    };
  }
}

function applyBuild(c: Core, cmd: BuildCommand): boolean {
  if (!c.inGame() || c.play.mode === 'live') return false;
  return c.play.applyBuild(cmd);
}

function runAction(c: Core, action: KeyAction, e: KeyEventLike): boolean {
  const p = c.play;
  c.trail.push('key', action);
  const buyMode = p.mode === 'buy';
  switch (action) {
    case 'pause':
      p.togglePause();
      return true;
    case 'speed1':
    case 'speed2':
    case 'speed3':
    case 'speedUltra':
      p.setSpeed(action === 'speed1' ? 1 : action === 'speed2' ? 2 : action === 'speed3' ? 3 : 4, true);
      noteUltra(c, action === 'speedUltra' ? 4 : 1);
      return true;
    case 'modeLive':
    case 'modeBuy':
    case 'modeBuild':
      p.setMode(action === 'modeLive' ? 'live' : action === 'modeBuy' ? 'buy' : 'build');
      return true;
    case 'rotateCamLeft':
    case 'rotateCamRight':
      rotateCamera(c, action === 'rotateCamLeft' ? -1 : 1);
      return true;
    case 'wallMode':
      p.cycleWallMode();
      return true;
    case 'perspective':
      p.cyclePerspective();
      return true;
    case 'rotateObject':
      if (buyMode) c.input.buy.rotate(e.shiftKey ? -1 : 1);
      return buyMode;
    case 'sell':
      if (buyMode) c.input.buy.sellCurrent();
      return buyMode;
    case 'undo':
      p.undo();
      return true;
    case 'redo':
      p.redo();
      return true;
    case 'cycleZombie':
      p.cycleSelection(e.shiftKey ? -1 : 1);
      return true;
    case 'focusSelected':
      if (p.selectedAgentId) {
        p.selectAgent(p.selectedAgentId, true, true);
        // W-025 S5 (CameraFollowApi): F recentres AND keeps following the member across regions until the player pans
        try {
          c.renderer.follow(p.selectedAgentId);
          c.renderer.recentre?.();
        } catch {
          /* a renderer fault never breaks the hotkey */
        }
      }
      return true;
    case 'help':
      p.openDialog('help');
      return true;
    case 'quickSave':
      void saveGame(c);
      return true;
    case 'mute': {
      const muted = c.settings.muted !== true;
      life.updateSettings(c, { muted });
      c.toast('info', muted ? 'Sound off' : 'Sound on', muted ? 'Press M to turn sound back on.' : 'Press M to mute.', { mergeKey: muted ? 'mute:off' : 'mute:on' });
      return true;
    }
    case 'store':
      if (!c.economy || !c.inGame()) return false;
      c.economy.focusStore('featured', null, 'hotkey');
      c.play.openDialog('store');
      return true;
    case 'feedback':
      // W-110: the screenshot is taken BEFORE the dialog exists (capture renders + encodes synchronously).
      if (!c.feedback || !c.inGame()) return false;
      c.feedback.capture('hotkey');
      p.openDialog('feedback');
      return true;
    case 'menu':
      return escape(c);
    default:
      return false;
  }
}

function rotateCamera(c: Core, dir: 1 | -1): void {
  if (!c.inGame()) return;
  c.input.camera.rotate(dir === -1 ? -1 : 1);
  c.input.invalidateHover();
}

function saveGame(c: Core, slotId?: string, name?: string): Promise<SaveResult> {
  const s = c.session;
  if (!s) return Promise.resolve({ ok: false, error: 'No game in progress', code: 'invalid' });
  if (s.gameOver) return Promise.resolve({ ok: false, error: 'This household is gone — there is nothing to save.', code: 'invalid' });
  return c.saveFlow.saveGame(slotId, name);
}

function diagnostics(c: Core): string {
  const s = c.session;
  const sim: SimulationAPI | null = s?.sim ?? c.demo;
  return buildDiagnostics({
    userAgent: () => c.env.userAgent(),
    platform: () => {
      const n = c.env.native();
      return n ? `${n.platform} ${n.version}` : null;
    },
    screen: () => c.screen + (c.fatal ? ' (fatal)' : ''),
    mode: () => c.play.mode,
    speed: () => `${c.play.effectiveSpeed} (chosen ${c.play.speed.chosen}; holds: ${c.play.speed.holdList.join(', ') || 'none'})`,
    fps: () => c.renderer.fps(),
    renderer: () => ({
      ready: c.rendererReady,
      quality: c.settings.quality,
      pixelRatio: effectivePixelRatio(c.settings.pixelRatio, c.env.devicePixelRatio()),
      loadProgress: Math.round(c.renderer.loadProgress() * 100) / 100,
      wallMode: c.play.wallMode,
      perspective: c.play.perspective,
    }),
    sim: () => {
      if (!sim) return null;
      const st = sim.state;
      const agents = Object.values(st.agents ?? {});
      let t = 'unknown';
      try {
        const ti = sim.time();
        t = `day ${ti.day} ${ti.label}`;
      } catch {
        /* keep */
      }
      return {
        world: s ? 'game' : 'menu demo',
        tick: st.tick,
        time: t,
        seed: st.seed,
        household: st.household?.name ?? null,
        householdSize: st.household?.memberIds?.length ?? 0,
        agents: agents.length,
        onLot: agents.filter((a) => a.presence === 'onLot').length,
        visitors: agents.filter((a) => a.presence === 'onLot' && a.visit !== null).length,
        objects: Object.keys(st.objects ?? {}).length,
        funds: st.household?.funds ?? null,
        choicesPending: Array.isArray(st.choices) ? st.choices.length : 0,
        gameOver: st.gameOver === true,
        autosaveSlot: s?.autosaveSlot ?? null,
        playMinutes: s?.playMinutes() ?? 0,
      };
    },
    faults: () => sim?.faults() ?? [],
    errors: () => c.errors.list(),
    settings: () => c.settings,
    storage: () => ({
      backend: c.saves.backend?.id ?? 'unknown',
      durable: c.saves.backend?.durable ?? false,
      lastSave: c.saveFlow.label(),
      saving: c.saveFlow.saving,
      autosaveWrites: c.saveFlow.autosave.writeCount,
      autosaveFailures: c.saveFlow.autosave.consecutiveFailures,
      profileWriteFailures: c.profileWriter.failureCount,
    }),
    loop: () => ({
      frames: c.stats.frames,
      ticks: c.stats.ticks,
      droppedTicks: c.stats.dropped,
      overBudgetFrames: c.stats.overBudget,
      accumulator: Math.round(c.accumulator * 1000) / 1000,
      hidden: c.hidden,
    }),
    audio: () => (typeof c.audio.stats === 'function' ? c.audio.stats() : null),
    wallNow: () => c.env.wallNow(),
  });
}

function createFeedback(c: Core): FeedbackService {
  return new FeedbackService({
    env: c.env,
    renderer: c.renderer,
    rendererReady: () => c.rendererReady,
    profile: c.profile,
    backend: () => c.saves.backend ?? null,
    trail: c.trail,
    screen: () => c.screen + (c.fatal ? '-fatal' : ''),
    mode: () => c.play.mode,
    dialog: () => c.play.dialog,
    tool: () => {
      if (c.play.mode === 'build') return `build:${c.input.build.tool.kind}`;
      if (c.play.mode === 'buy') return c.input.buy.view().placingDefId ? 'buy:placing' : 'buy:hand';
      return 'live';
    },
    fps: () => c.fps,
    settings: () => c.settings,
    ageBracket: () => c.economy?.age?.bracket ?? 'unknown',
    sim: () => (c.session && !c.session.gameOver ? c.session.sim : null),
    anySim: () => c.session?.sim ?? c.demo,
    caz: () => c.caz,
    saveNames: async () => {
      const slots = await c.saves.listSlots();
      return slots.flatMap((s) => [s.name, s.meta?.householdName, ...(Array.isArray(s.meta?.memberNames) ? s.meta.memberNames : [])].filter((x): x is string => typeof x === 'string'));
    },
    errors: () => c.errors.list(),
    diagnosticsText: () => diagnostics(c),
    version: GAME_VERSION,
    report: (w, e) => c.report(w, e),
  });
}

/** The facade: getters read Core, methods delegate. */
class Controller implements GameControllerImpl {
  constructor(private readonly c: Core) {}

  get version(): number {
    return this.c.notifier.version;
  }
  get appVersion(): string {
    return GAME_VERSION;
  }
  subscribe(fn: () => void): () => void {
    return this.c.notifier.subscribe(fn);
  }
  boot(canvas: HTMLCanvasElement): Promise<void> {
    return life.boot(this.c, canvas);
  }
  dispose(): void {
    life.dispose(this.c);
  }

  // lifecycle / screens
  get screen(): Screen {
    return this.c.screen;
  }
  get loadingProgress(): number {
    return this.c.loadingProgress;
  }
  get loadingLabel(): string {
    return this.c.loadingLabel;
  }
  get fatalError(): string | null {
    return this.c.fatal;
  }
  get economy(): EconomyService | null {
    return this.c.economy;
  }
  get feedback(): FeedbackService | null {
    return this.c.feedback;
  }
  get sessionLog(): SessionLogService | null {
    return this.c.sessionLog;
  }
  get gameOverReason(): string | null {
    return this.c.session?.gameOverReason ?? null;
  }
  get content(): ContentRegistry | null {
    return this.c.content;
  }
  get lotTemplates(): readonly LotTemplate[] {
    return this.c.lotTemplates;
  }
  get cazCatalog(): CazCatalog {
    return this.c.catalog;
  }
  goto(screen: Screen): void {
    life.goto(this.c, screen);
  }
  beginNewGame(): void {
    life.beginNewGame(this.c);
  }
  get caz(): CazState | null {
    return this.c.caz;
  }
  updateCaz(patch: Partial<CazState>): void {
    cazFlow.updateCaz(this.c, patch);
  }
  updateCazMember(index: number, patch: Partial<NewMemberSpec>): void {
    cazFlow.updateCazMember(this.c, index, patch);
  }
  addCazMember(): void {
    cazFlow.addCazMember(this.c);
  }
  removeCazMember(index: number): void {
    cazFlow.removeCazMember(this.c, index);
  }
  randomizeCazMember(index: number, what?: 'all' | 'look' | 'traits' | 'name'): void {
    cazFlow.randomizeCazMember(this.c, index, what ?? 'all');
  }
  validateCaz(): string[] {
    return cazFlow.validateCaz(this.c);
  }
  validateCazDetailed(): CazIssue[] {
    return cazFlow.validateCazDetailed(this.c);
  }
  startGame(): Promise<void> {
    return life.startGame(this.c);
  }
  createCazPreview(canvas: HTMLCanvasElement): PreviewStage {
    return cazFlow.createCazPreview(this.c, canvas);
  }

  // saves
  listSaves(): Promise<SaveSlotInfo[]> {
    return this.c.saveFlow.list();
  }
  saveGame(slotId?: string, name?: string): Promise<SaveResult> {
    return saveGame(this.c, slotId, name);
  }
  saveSoon(reason: string): void {
    this.c.saveFlow.saveSoon(reason);
  }
  loadGame(slotId: string): Promise<LoadResult> {
    return life.loadGame(this.c, slotId);
  }
  continueLatest(): Promise<boolean> {
    return life.continueLatest(this.c);
  }
  deleteSave(slotId: string): Promise<void> {
    return this.c.saveFlow.remove(slotId);
  }
  exportSave(slotId: string): Promise<void> {
    return this.c.saveFlow.exportSlot(slotId);
  }
  importSave(file: File): Promise<LoadResult> {
    return this.c.saveFlow.importFile(file).then((r) => {
      // An imported file is untrusted for the economy (security review H-1): never reconciled, and the progress it
      // already contains is not paid. Recorded by world id in the profile before the slot can be loaded.
      if (r && r.ok && this.c.economy) {
        const world = r.world;
        this.c.guard('economy.importedWorld', () => this.c.economy?.noteImportedWorld(world as never));
      }
      return r;
    });
  }
  get lastSaveLabel(): string | null {
    return this.c.saveFlow.label();
  }
  get lastSavedAt(): number | null {
    return this.c.saveFlow.lastSavedAt;
  }
  get lastSaveFailed(): boolean {
    return this.c.saveFlow.lastSaveFailed;
  }
  get saving(): boolean {
    return this.c.saveFlow.saving;
  }
  quitToMenu(): Promise<void> {
    return life.quitToMenu(this.c);
  }
  quitApp(): void {
    life.quitApp(this.c);
  }
  get canQuitApp(): boolean {
    return this.c.env.native() !== null;
  }

  // in-game state
  get sim(): SimulationAPI | null {
    return this.c.session?.sim ?? null;
  }
  get renderer(): RendererAPI {
    return this.c.renderer;
  }
  get audio(): AudioAPI {
    return this.c.audio;
  }
  get mode(): ViewMode {
    return this.c.play.mode;
  }
  setMode(mode: ViewMode): void {
    this.c.trail.push('mode', mode);
    this.c.play.setMode(mode);
  }
  get speed(): Speed {
    return this.c.play.effectiveSpeed;
  }
  setSpeed(speed: Speed): void {
    this.c.trail.push('speed', speed);
    this.c.play.setSpeed(speed, true);
    noteUltra(this.c, speed);
  }
  togglePause(): void {
    this.c.play.togglePause();
  }
  get ultraAllowed(): boolean {
    return this.c.inGame() && this.c.play.isUltraAllowed();
  }
  rotateCamera(dir: 1 | -1): void {
    rotateCamera(this.c, dir);
  }
  focusObject(id: ObjectId): void {
    this.c.play.focusObject(id);
  }
  frameObject(id: ObjectId, opts?: { screen?: { x: number; y: number }; instant?: boolean }): boolean {
    return this.c.play.frameObject(id, opts);
  }
  get storyTarget(): StoryTarget | null {
    return this.c.inGame() ? this.c.play.storyTarget() : null;
  }
  questAction(ref: QuestRowRef): QuestGoResult {
    return questActionFor(this.c, ref);
  }
  questGo(ref: QuestRowRef, opts?: { frame?: boolean }): QuestGoResult {
    const r = questGo(this.c, ref, opts ?? {});
    // W-129: a zombie heading off to the target: keep new tutorial tips from covering it while the walk starts
    if (r.kind === 'queue') this.c.hints.hold(this.c.env.now() + GO_HINT_HOLD_MS);
    return r;
  }
  job(cmd: JobCommand): CommandResult {
    return this.c.play.job(cmd);
  }
  pet(cmd: PetCommand): CommandResult {
    return this.c.play.pet(cmd);
  }
  home(cmd: HomeCommand): CommandResult {
    return this.c.play.home(cmd);
  }
  buyReward(agentId: AgentId, rewardId: string): CommandResult {
    return this.c.play.buyReward(agentId, rewardId);
  }
  setAutoPurchases(value: 'off' | 'unlimited' | number): CommandResult {
    return this.c.play.setAutoPurchases(value);
  }
  renameHousehold(name: string): CommandResult {
    return this.c.play.renameHousehold(name);
  }
  markNotificationsRead(): void {
    this.c.play.markNotificationsRead();
  }
  get selectedAgentId(): AgentId | null {
    return this.c.play.selectedAgentId;
  }
  selectAgent(id: AgentId | null, focusCamera?: boolean): void {
    this.c.play.selectAgent(id, focusCamera === true, true);
  }
  cycleSelection(dir: 1 | -1): void {
    this.c.play.cycleSelection(dir);
  }
  get wallMode(): WallMode {
    return this.c.play.wallMode;
  }
  setWallMode(mode: WallMode): void {
    this.c.play.setWallMode(mode);
  }
  cycleWallMode(): void {
    this.c.play.cycleWallMode();
  }
  get perspective(): Perspective {
    return this.c.play.perspective;
  }
  setPerspective(perspective: Perspective): void {
    this.c.play.setPerspective(perspective);
  }
  cyclePerspective(): void {
    this.c.play.cyclePerspective();
  }

  // live-mode menu
  get menu(): OpenMenu | null {
    return this.c.play.menu;
  }
  openMenuFor(target: TargetRef, x: number, y: number): void {
    this.c.play.openMenuFor(target, x, y, this.c.env.viewport());
  }
  closeMenu(): void {
    this.c.play.closeMenu();
  }
  chooseMenuEntry(entry: MenuEntry, child?: MenuEntry): void {
    this.c.play.chooseMenuEntry(entry, child);
  }
  cancelQueueItem(uid: number): void {
    this.c.play.cancelQueueItem(uid);
  }
  walkTo(actorId: AgentId, target: WorldRouteTarget): WorldRouteResult {
    return this.c.play.walkTo(actorId, target);
  }
  phone(action: string, params?: Record<string, string | number | boolean>): void {
    this.c.play.phone(action, params ?? {});
  }

  // buy
  get buy(): BuyState {
    return this.c.input.buy.view();
  }
  setBuyCategory(category: string): void {
    this.c.input.buy.setCategory(category);
  }
  startPlacing(defId: string, tint?: string | null): void {
    startPlacing(this.c, defId, tint);
  }
  pickUpObject(objectId: ObjectId): void {
    if (!this.c.inGame()) return;
    if (this.c.play.mode !== 'buy') this.c.play.setMode('buy');
    this.c.input.buy.pickUp(objectId);
  }
  rotatePlacement(dir: 1 | -1): void {
    this.c.input.buy.rotate(dir);
  }
  setPlacementTint(tint: string | null): void {
    this.c.input.buy.setTint(tint);
  }
  cancelPlacement(): void {
    this.c.input.buy.cancel();
  }
  finishPlacing(): void {
    this.c.input.buy.done();
  }
  setKeepPlacing(on: boolean): void {
    this.c.input.buy.setKeepPlacing(on);
  }
  sellObject(objectId: ObjectId): void {
    if (!this.c.inGame() || this.c.play.mode === 'live') return;
    this.c.input.buy.sell(objectId);
  }

  // build
  get buildTool(): BuildTool {
    return this.c.input.build.tool;
  }
  setBuildTool(tool: BuildTool): void {
    if (!this.c.inGame()) return;
    if (this.c.play.mode !== 'build') this.c.play.setMode('build');
    this.c.input.build.setTool(tool);
  }
  applyBuild(cmd: BuildCommand): boolean {
    return applyBuild(this.c, cmd);
  }
  undo(): void {
    this.c.play.undo();
  }
  redo(): void {
    this.c.play.redo();
  }
  get canUndo(): boolean {
    return this.c.play.canUndo;
  }
  get canRedo(): boolean {
    return this.c.play.canRedo;
  }

  // dialogs / feedback
  get dialog(): DialogId {
    return this.c.play.dialog;
  }
  get dialogOptions(): DialogOptions | null {
    return this.c.play.dialogOptions;
  }
  openDialog(d: DialogId, opts?: DialogOptions): void {
    this.c.trail.push('dialog', d);
    this.c.play.openDialog(d, opts);
  }
  closeDialog(): void {
    this.c.trail.push('close', this.c.play.dialog);
    this.c.play.closeDialog();
  }
  get toasts(): Toast[] {
    return this.c.toastCenter.list();
  }
  dismissToast(id: number): void {
    if (this.c.toastCenter.dismiss(id)) this.c.notifier.notifyNow();
  }
  get bubbles(): Bubble[] {
    return this.c.bubbleBoard.list();
  }
  get buildPreviewLabel(): string | null {
    return this.c.play.buildPreviewLabel;
  }
  get placementAnnouncement(): { seq: number; text: string } | null {
    return this.c.input?.buy.announcement ?? null;
  }
  resolveChoice(choiceId: string, option: number): void {
    this.c.play.resolveChoice(choiceId, option);
  }

  // hints
  get hint(): VisibleHint | null {
    if (this.c.screen !== 'game') return null;
    // W-113 story intro first (not a tutorial tip: shows with tips off too); tutorial tips wait until it is gone.
    if (this.c.storyIntro) return this.c.storyIntro.hint;
    return this.c.settings.tutorialEnabled ? this.c.hints.current : null;
  }
  dismissHint(id: string, never?: boolean): void {
    if (id === STORY_INTRO_ID) {
      // Skipping the story card never turns the tutorial off.
      if (this.c.storyIntro) this.c.storyIntro = null;
      this.c.notifier.notifyNow();
      return;
    }
    this.c.hints.dismiss(id, this.c.env.now());
    if (never === true) life.updateSettings(this.c, { tutorialEnabled: false });
    this.c.notifier.notifyNow();
  }

  // settings
  get settings(): Settings {
    return this.c.settings;
  }
  get graphics(): GraphicsInfo | null {
    if (!this.c.rendererReady) return null;
    try {
      return this.c.renderer.graphicsInfo?.() ?? null;
    } catch {
      return null;
    }
  }
  updateSettings(patch: Partial<Settings>): void {
    life.updateSettings(this.c, patch);
  }
  resetSettings(): void {
    life.resetSettings(this.c);
  }

  // misc
  playUi(id: SfxId): void {
    if (isSfxId(id)) this.c.sfx(id);
  }
  get fps(): number {
    return this.c.fps;
  }
  diagnostics(): string {
    return diagnostics(this.c);
  }
  get hoverLabel(): string | null {
    return this.c.play.hoverLabel;
  }
  get gridHover(): { x: number; z: number; edge: EdgeKey | null } | null {
    return this.c.play.gridHover;
  }
}

export function createGameController(deps: GameControllerDeps): GameControllerImpl {
  const core = new Core({
    renderer: deps.renderer,
    audio: deps.audio,
    saves: deps.saves,
    profile: deps.profile,
    sim: deps.sim ?? defaultSimModule,
    env: deps.env ?? createBrowserEnv(),
  });
  core.economy = deps.economy ?? null;
  wire(core);
  core.feedback = createFeedback(core);
  const log = (core.sessionLog = new SessionLogService(core));
  observeWorldClicks(core);
  core.uninstallers.push(log.attach(core.env.window, core.env.document), () => log.flush('dispose'));
  void log.init();
  return new Controller(core);
}
