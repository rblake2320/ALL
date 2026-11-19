/**
 * Screen lifecycle: boot → loading → menu (demo world) → newGame → caz → game ⇄ gameOver, plus save loading,
 * quitting, the crash path (fatalError + emergency save) and window-level handlers (visibility, focus, unload).
 * All transitions go through Core.transition (one at a time, never reject).
 */
import { NO_3D_FATAL } from '../shared/fatalKinds';
import type { Screen, Settings } from './contracts';
import { DEFAULT_SETTINGS } from './contracts';
import type { SimulationAPI } from '../sim/contracts';
import type { LoadResult, SaveSlotInfo } from '../persistence/contracts';
import type { Core } from './core';
import type { AutoQualityLevel } from '../render/contracts';
import { GameSession, type SessionOrigin } from './session';
import { storyFocus, storyIntroFor } from './storyIntro';
import { safeProfileLoad } from './profile';
import { SETTINGS_PROFILE_KEY, applySettingsPatch, changedSettings, effectivePixelRatio, effectiveVolumes, sanitizeSettings } from './settings';
import { TUTORIAL_PROFILE_KEY, parseTutorialProgress } from './hints';
import { buildCazCatalog } from './gddCatalog';
import { finalizeCaz } from './cazState';
import { initialCaz } from './randomZombie';
import { createDemoSim, houseCenter } from './demoWorld';
import { fatalMessage, installGlobalErrorHandlers } from './fatal';
import { describeError } from './diagnostics';
import { isValidSlotId, withResponsiveTimeout, withTimeout } from './saves';
import { disposePreviews, validateCaz } from './cazFlow';
import { freeTextNamesForBracket, isPresetHouseholdName } from './names';
import { readOwnData } from './settings';
import { checkPersistentStorage } from './storageGuard';
import { unownedPremiumBody } from './premiumAccess';

const SCREENS: readonly Screen[] = ['boot', 'menu', 'newGame', 'caz', 'loading', 'game', 'gameOver'];
export const ASSET_TIMEOUT_MS = 90_000;
/** Responsive time (withResponsiveTimeout): a main thread busy booting must not read as "no stored settings" (W-134). */
const PROFILE_TIMEOUT_MS = 5_000;
const QUIT_SAVE_TIMEOUT_MS = 10_000;
const NEW_GAME_SAVE_TIMEOUT_MS = 8_000;
export const QUIT_ANYWAY_WINDOW_MS = 30_000;

export function isScreen(v: unknown): v is Screen {
  return typeof v === 'string' && (SCREENS as readonly string[]).includes(v);
}

export function loadingLabelFor(p: number): string {
  if (p < 0.15) return 'Waking the dead…';
  if (p < 0.45) return 'Dusting off the furniture…';
  if (p < 0.75) return 'Stitching zombies together…';
  return 'Airing out the crypt…';
}

// ═════════════════════════════ boot ═════════════════════════════

/**
 * Idempotent: concurrent / repeated calls share ONE boot (the returned promise settles when that boot is done).
 * Every await is followed by a disposed check, so dispose() during boot (HMR, a test tearing down) never leaves
 * window/canvas listeners, the frame loop or timers behind.
 */
export function boot(c: Core, canvas: HTMLCanvasElement): Promise<void> {
  if (c.bootPromise) return c.bootPromise;
  if (c.disposed) return Promise.resolve();
  c.booted = true;
  c.bootPromise = runBoot(c, canvas).catch((e: unknown) => {
    // runBoot guards each step; this is the last fault barrier (boot() never rejects).
    c.report('boot', e);
    raiseFatal(c, e);
  });
  return c.bootPromise;
}

async function runBoot(c: Core, canvas: HTMLCanvasElement): Promise<void> {
  const win = c.env.window;
  if (win) c.uninstallers.push(installGlobalErrorHandlers(win, (err) => raiseFatal(c, err)));
  c.setScreen('loading');
  c.setLoading(0.02, 'Waking the dead…');
  await loadProfile(c);
  if (c.disposed) return;
  applySettings(c, null);
  try {
    const s = c.settings;
    await c.renderer.init(canvas, {
      quality: s.quality,
      pixelRatio: effectivePixelRatio(s.pixelRatio, c.env.devicePixelRatio()),
      pixelRatioExplicit: s.pixelRatio > 0,
      autoLevel: s.autoQuality === 'unset' ? null : s.autoQuality,
    });
  } catch (e) {
    if (c.disposed) return;
    raiseFatal(c, e, NO_3D_FATAL);
    return;
  }
  if (c.disposed) return;
  c.rendererReady = true;
  c.appliedPixelRatio = effectivePixelRatio(c.settings.pixelRatio, c.env.devicePixelRatio());
  resizeRenderer(c);
  installWindowHandlers(c);
  if (win) c.input.attach(canvas, win);
  c.driver.start();
  await waitForAssets(c);
  if (c.disposed || c.fatal) return;
  c.setLoading(0.92, 'Reading the lease…');
  await c.yieldToUi();
  if (c.disposed || c.fatal) return;
  loadContent(c);
  c.setLoading(1, 'Opening the crypt…');
  enterMenu(c);
}

async function loadProfile(c: Core): Promise<void> {
  const raw = await withResponsiveTimeout(safeProfileLoad<unknown>(c.profile, SETTINGS_PROFILE_KEY, null, (e) => c.report('profile.settings', e)), PROFILE_TIMEOUT_MS, c.env, () => null);
  // Contract #17: with no saved choice (first run, or a profile from before the setting existed) reduceMotion
  // follows the OS "reduce motion" preference instead of the hard-coded default.
  const saved = readOwnData(raw, 'reduceMotion');
  const base: Settings = saved.ok && typeof saved.value === 'boolean' ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, reduceMotion: prefersReducedMotion(c) };
  c.settings = sanitizeSettings(raw, base);
  const tut = await withResponsiveTimeout(safeProfileLoad<unknown>(c.profile, TUTORIAL_PROFILE_KEY, null, (e) => c.report('profile.tutorial', e)), PROFILE_TIMEOUT_MS, c.env, () => null);
  c.hints = c.makeHints(parseTutorialProgress(tut));
}

function prefersReducedMotion(c: Core): boolean {
  try {
    return c.env.prefersReducedMotion() === true;
  } catch {
    return false;
  }
}

export function loadContent(c: Core): void {
  try {
    c.content = c.simModule.loadContent();
  } catch (e) {
    c.report('sim.loadContent', e);
    c.content = null;
  }
  try {
    const lots = c.simModule.LOT_TEMPLATES;
    c.lotTemplates = Array.isArray(lots) ? lots.filter((l) => l && (l.id === 'derelict' || l.id === 'starter' || l.id === 'empty')).map((l) => ({ ...l })) : [];
  } catch (e) {
    c.report('sim.LOT_TEMPLATES', e);
    c.lotTemplates = [];
  }
  c.catalog = buildCazCatalog(c.content, c.lotTemplates);
}

function waitForAssets(c: Core): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      c.assetsWaiter = null;
      c.env.clearTimeout(timer);
      resolve();
    };
    const timer = c.env.setTimeout(() => {
      c.report('boot.assets', new Error('Asset loading timed out; continuing with placeholders'));
      finish();
    }, ASSET_TIMEOUT_MS);
    c.assetsWaiter = finish;
    pollAssets(c);
  });
}

/** Called every frame while booting: mirrors renderer.loadProgress() into the loading screen. */
export function pollAssets(c: Core): void {
  if (!c.assetsWaiter) return;
  let p = 1;
  try {
    p = c.renderer.loadProgress();
  } catch {
    p = 1; // a broken progress probe must not block the game forever
  }
  if (!Number.isFinite(p)) p = 0;
  p = Math.min(1, Math.max(0, p));
  c.setLoading(0.05 + p * 0.85, loadingLabelFor(p));
  if (p >= 0.999) c.assetsWaiter();
}

// ═════════════════════════════ window handlers ═════════════════════════════

function installWindowHandlers(c: Core): void {
  const win = c.env.window;
  const doc = c.env.document;
  if (!win || !doc) return;
  const add = <T extends Event>(target: EventTarget, type: string, fn: (e: T) => void): void => {
    const h = (e: Event): void => {
      try {
        fn(e as T);
      } catch (err) {
        c.report(`window.${type}`, err);
      }
    };
    target.addEventListener(type, h);
    c.uninstallers.push(() => target.removeEventListener(type, h));
  };
  add(doc, 'visibilitychange', () => onVisibility(c, doc.visibilityState === 'hidden'));
  add(win, 'blur', () => onFocus(c, false));
  add(win, 'focus', () => onFocus(c, true));
  add(win, 'resize', () => resizeRenderer(c));
  add<BeforeUnloadEvent>(win, 'beforeunload', (e) => onBeforeUnload(c, e));
  add(win, 'pagehide', () => bestEffortSave(c, 'pagehide'));
  c.hidden = doc.visibilityState === 'hidden';
}

export function resizeRenderer(c: Core): void {
  const vp = c.env.viewport();
  c.guard('renderer.resize', () => c.renderer.resize(vp.width, vp.height));
  // Moving the window to a monitor with another DPI (or browser zoom) changes devicePixelRatio; with "auto" pixel
  // ratio the renderer must follow, or the game turns blurry / needlessly expensive.
  if (!c.rendererReady) return;
  const pr = effectivePixelRatio(c.settings.pixelRatio, c.env.devicePixelRatio());
  if (pr !== c.appliedPixelRatio) {
    c.appliedPixelRatio = pr;
    c.guard('renderer.setPixelRatio', () => c.renderer.setPixelRatio(pr, c.settings.pixelRatio > 0));
  }
}

export function onVisibility(c: Core, hidden: boolean): void {
  c.hidden = hidden;
  if (hidden) {
    if (c.settings.pauseWhenUnfocused) c.play.hold('hidden');
    if (c.settings.muteWhenUnfocused) setFocusMute(c, true);
    bestEffortSave(c, 'hidden');
  } else {
    c.play.release('hidden');
    if (c.windowFocused) setFocusMute(c, false);
  }
  c.notifier.notifyNow();
}

export function onFocus(c: Core, focused: boolean): void {
  c.windowFocused = focused;
  if (!focused && c.settings.muteWhenUnfocused) setFocusMute(c, true);
  else if (focused && !c.hidden) setFocusMute(c, false);
}

function setFocusMute(c: Core, m: boolean): void {
  if (m === c.mutedForFocus) return;
  c.mutedForFocus = m;
  syncAudioMute(c);
}

/** The engine is muted while the window is unfocused OR the player has muted the game (Settings.muted); volumes are untouched. */
export function syncAudioMute(c: Core): void {
  const m = c.mutedForFocus || c.settings.muted === true;
  c.guard('audio.setMuted', () => c.audio.setMuted(m));
}

function bestEffortSave(c: Core, reason: string): void {
  // The journal first: a small write that lands even when the page dies before the full autosave does.
  if (c.session) void c.saveFlow.flushJournal();
  if (c.inGame()) void c.saveFlow.autosaveNow(reason);
  void c.profileWriter.flush();
}

function onBeforeUnload(c: Core, e: BeforeUnloadEvent): void {
  const dirty = c.inGame() && c.saveFlow.autosave.dirty();
  bestEffortSave(c, 'unload');
  // Browser-only "leave site?" guard while unsaved progress is being written. Never in Electron (it would silently
  // block closing the window) and never under automation (it would cancel test navigations).
  const automated = typeof navigator !== 'undefined' && (navigator as Navigator & { webdriver?: boolean }).webdriver === true;
  if (dirty && !c.env.native() && !automated) {
    e.preventDefault();
    e.returnValue = '';
  }
}

// ═════════════════════════════ menu / demo / sessions ═════════════════════════════

export function enterMenu(c: Core): void {
  c.caz = null;
  disposePreviews(c);
  startDemo(c);
  c.setScreen('menu');
}

export function startDemo(c: Core): void {
  if (c.demo || c.disposed) return;
  try {
    const demo = createDemoSim(c.simModule, c.catalog);
    c.demo = demo;
    c.demoStartedAt = c.env.now();
    c.demoRebuildPending = false;
    c.accumulator = 0;
    c.renderer.attach(demo);
    c.renderer.setViewMode('live');
    c.renderer.focus(houseCenter(demo), true);
    c.renderer.setCamera({ distance: 26, pitch: 0.62 }, true);
  } catch (e) {
    c.report('demo.start', e);
    c.demo = null;
    c.guard('renderer.attach', () => c.renderer.attach(null));
  }
}

export function stopDemo(c: Core, detach: boolean): void {
  if (!c.demo) return;
  c.demo = null;
  c.accumulator = 0;
  if (detach) c.guard('renderer.attach', () => c.renderer.attach(null));
}

export function enterSession(c: Core, sim: SimulationAPI, origin: SessionOrigin, info: SaveSlotInfo | null): void {
  // Built first: a broken world (throwing state) fails HERE, before the running game is torn down.
  const session = new GameSession(sim, origin, (w, e) => c.report(w, e));
  if (c.session) teardownSession(c);
  stopDemo(c, false);
  c.input.resetAll();
  c.accumulator = 0;
  c.alpha = 0;
  // Whatever screen we came from (CAZ, new game, menu), its transient state ends here.
  c.caz = null;
  disposePreviews(c);
  c.session = session;
  c.router.stopAll(c.audio);
  c.toastCenter.clear();
  c.bubbleBoard.clear();
  c.musicDirector.reset();
  c.play.beginSession();
  c.guard('renderer.attach', () => c.renderer.attach(sim));
  // W-113: a brand-new story-start world opens on a short narrative card, the camera framing the zombie and the shack.
  c.storyIntro = null;
  let intro: ReturnType<typeof storyIntroFor> = null;
  try {
    intro = storyIntroFor(sim.state, origin.loadedFrom);
  } catch {
    intro = null;
  }
  c.guard('camera.focus', () => {
    const house = houseCenter(sim);
    c.renderer.focus(intro ? storyFocus(sim, house) : house, true);
    c.renderer.setCamera(intro ? { distance: 24, pitch: 0.68 } : { distance: 20, pitch: 0.72 }, true);
  });
  if (intro) c.storyIntro = { hint: intro, shownAt: c.env.now() };
  // Only a real change is dispatched: an unchanged setting must not make a freshly loaded world "unsaved".
  let worldAutonomy: unknown = null;
  try {
    worldAutonomy = sim.state?.settings?.autonomy;
  } catch {
    worldAutonomy = null;
  }
  if (worldAutonomy !== c.settings.autonomy) session.dispatch({ type: 'setSettings', settings: { autonomy: c.settings.autonomy } });
  c.play.maintainSelection();
  c.saveFlow.beginSession(info);
  // beginSession() reset the speed holds: re-apply the ones that still hold (started / loaded in a hidden tab).
  if (c.hidden && c.settings.pauseWhenUnfocused) c.play.hold('hidden');
  if (c.play.pendingChoices() > 0) c.play.onChoiceEvent();
  if (session.gameOver) session.gameOverReason = 'Rest in Pieces';
  c.hints.hide(c.env.now());
  let durable = true;
  try {
    durable = c.saves.backend?.durable !== false;
  } catch {
    durable = true;
  }
  if (!durable) {
    c.toast('warning', 'Saves are temporary here', 'This browser is not keeping saves (private window or storage blocked). Export your save to keep it.', { mergeKey: 'volatileSaves' });
  } else void checkPersistentStorage(c);
}

/**
 * enterSession behind a fault barrier: if the new world blows up half way in, the half-entered session is torn
 * down, CAZ state and the menu diorama are restored, and false is returned (the caller restores its screen).
 */
function tryEnterSession(c: Core, sim: SimulationAPI, origin: SessionOrigin, info: SaveSlotInfo | null): boolean {
  const caz = c.caz;
  try {
    enterSession(c, sim, origin, info);
    return true;
  } catch (e) {
    c.report('enterSession', e);
    if (c.session && c.session.sim === sim) teardownSession(c);
    if (!c.session) {
      c.caz = caz;
      startDemo(c);
    }
    return false;
  }
}

export function teardownSession(c: Core): void {
  if (!c.session) return;
  c.session = null;
  c.storyIntro = null;
  c.router.stopAll(c.audio);
  c.input.resetAll();
  c.play.endSession();
  c.saveFlow.endSession();
  c.toastCenter.clear();
  c.bubbleBoard.clear();
  c.musicDirector.reset();
  c.hints.hide(c.env.now());
  c.guard('renderer.overlays', () => {
    c.renderer.setPlacementGhost(null);
    c.renderer.setBuildOverlay(null);
    c.renderer.setHiddenObject(null);
  });
  c.guard('renderer.attach', () => c.renderer.attach(null));
  c.accumulator = 0;
}

export function enterGameOver(c: Core, reason: string): void {
  const s = c.session;
  if (!s || c.screen !== 'game') return;
  if (c.play.mode !== 'live') c.play.setMode('live');
  s.gameOver = true;
  s.gameOverReason = reason;
  // The timeline is finished, not interrupted: its journal must never be replayed onto the last save.
  void c.saveFlow.journal.timelineEnded();
  c.play.closeMenu();
  c.play.closeAllDialogs();
  c.play.speed.set(0);
  c.play.syncAudioSpeed();
  c.router.stopAll(c.audio);
  c.setScreen('gameOver');
}

export function raiseFatal(c: Core, err: unknown, message?: string): void {
  c.errors.push('fatal', err);
  if (c.fatal !== null || c.disposed) return;
  c.fatal = message ?? fatalMessage(err);
  c.play.speed.set(0);
  c.play.syncAudioSpeed();
  c.play.closeMenu();
  c.router.stopAll(c.audio);
  void c.saveFlow.emergencySave();
  c.notifier.notifyNow();
}

/**
 * A crash is recoverable to the menu only when the game had fully started (renderer up, input + frame loop
 * running). After e.g. "no WebGL" a menu would be a dead screen whose world never ticks — reload is the only way.
 */
export function canRecover(c: Core): boolean {
  return c.fatal !== null && !c.disposed && c.rendererReady && c.driver.running;
}

function recoverFromFatal(c: Core): void {
  if (!canRecover(c)) return;
  c.fatal = null;
  c.renderFailures = 0;
  c.stepFailFrames = 0;
  c.quitAnywayUntil = 0;
  teardownSession(c);
  // The crash may have come from the menu's demo world itself: never keep it.
  stopDemo(c, true);
  enterMenu(c);
  c.notifier.notifyNow();
}

export function dispose(c: Core): void {
  if (c.disposed) return;
  c.disposed = true;
  c.driver.stop();
  c.input.detach();
  for (const u of c.uninstallers.splice(0)) {
    try {
      u();
    } catch {
      /* ignore */
    }
  }
  // A boot still waiting for assets resolves now (and its 90 s timer is cleared).
  c.assetsWaiter?.();
  disposePreviews(c);
  c.router.stopAll(c.audio);
  void c.profileWriter.flush();
  // Final journal flush + release its cross-window lock (HMR / a second bootstrap must not keep it).
  c.guard('journal.end', () => c.saveFlow.journal.end());
  c.notifier.dispose();
  // Contract: dispose tears down the renderer too (HMR / second bootstraps must not leak GPU resources).
  c.guard('renderer.dispose', () => c.renderer.dispose());
  c.guard('audio.music', () => c.audio.music('none'));
}

// ═════════════════════════════ navigation ═════════════════════════════

function openCaz(c: Core, screen: 'newGame' | 'caz', fresh: boolean): void {
  if (fresh || !c.caz) c.caz = initialCaz(c.env.randomU32(), c.catalog);
  c.setScreen(screen);
}

export function goto(c: Core, target: Screen): void {
  if (!isScreen(target) || c.disposed) return;
  if (c.fatal !== null) {
    if (target === 'menu') recoverFromFatal(c); // no-op when the crash is not recoverable
    return;
  }
  const cur = c.screen;
  if (target === cur || cur === 'boot' || cur === 'loading') return;
  switch (target) {
    case 'menu':
      if (cur === 'game') void quitToMenu(c);
      else {
        if (cur === 'gameOver') teardownSession(c);
        enterMenu(c);
      }
      return;
    case 'newGame':
    case 'caz':
      if (cur === 'game') {
        void quitToMenu(c).then(() => {
          if (c.screen === 'menu') openCaz(c, target, true);
        });
        return;
      }
      if (cur === 'gameOver') {
        teardownSession(c);
        startDemo(c);
      }
      openCaz(c, target, false);
      return;
    case 'game':
      if (c.session && !c.session.gameOver) c.setScreen('game');
      return;
    default:
      return; // boot / loading / gameOver are entered by the controller only
  }
}

export function beginNewGame(c: Core): void {
  const cur = c.screen;
  if (cur === 'boot' || cur === 'loading' || c.fatal !== null || c.disposed) return;
  if (cur === 'game') {
    void quitToMenu(c).then(() => {
      if (c.screen === 'menu') openCaz(c, 'caz', true);
    });
    return;
  }
  if (cur === 'gameOver') {
    teardownSession(c);
    startDemo(c);
  }
  // Coming from the new-game screen keeps the lot/difficulty chosen there.
  openCaz(c, 'caz', cur !== 'newGame');
}

export function startGame(c: Core): Promise<void> {
  return c.transition(
    'startGame',
    async () => {
      const caz = c.caz;
      const from = c.screen;
      if (!caz || (from !== 'caz' && from !== 'newGame') || c.fatal !== null) return;
      const errors = validateCaz(c);
      if (errors.length > 0) {
        c.toast('warning', "Your household isn't ready", errors[0], { mergeKey: 'cazInvalid' });
        c.sfx('uiError');
        return;
      }
      // Typed names (D-3): a child or unanswered profile picks from the preset pools. The UI enforces it; so does the
      // game layer, because the controller API (window.__afterlife.game) can set CAZ names directly.
      if (!freeTextNamesForBracket(c.economy?.age?.bracket)) {
        const okLast = (n: string) => c.catalog.lastNames.includes(n.trim()) || isPresetHouseholdName(n);
        const okFirst = (n: string) => c.catalog.firstNames.some((f) => n.trim() === f || n.trim().startsWith(`${f} `));
        if (!okLast(caz.householdName) || caz.members.some((m) => !okFirst(m.firstName) || !okLast(m.lastName))) {
          c.toast('warning', "Your household isn't ready", 'Pick names from the lists.', { mergeKey: 'cazInvalid' });
          c.sfx('uiError');
          return;
        }
      }
      const opts = finalizeCaz(caz, c.env.randomU32());
      c.setScreen('loading');
      c.setLoading(0.1, 'Digging the foundations…');
      await c.yieldToUi();
      // Entitlements can change while the loading screen yields to the event loop.
      const afterYieldErrors = validateCaz(c);
      if (afterYieldErrors.length > 0) {
        c.setScreen(from);
        c.toast('warning', "Your household isn't ready", afterYieldErrors[0], { mergeKey: 'cazInvalid' });
        return;
      }
      let sim: SimulationAPI;
      try {
        const world = c.simModule.createNewWorld(c.settings.snapBuilding ? { ...opts, homeBuild: true } : opts);
        if (unownedPremiumBody(world, c.economy)) throw new Error('A generated premium body is not owned by this profile.');
        c.setLoading(0.45, 'Furnishing the crypt…');
        sim = c.simModule.createSimulation(world);
        if (unownedPremiumBody(sim.state, c.economy)) throw new Error('A generated premium body is not owned by this profile.');
        // The profile economy only ever reconciles recorded grants of worlds created HERE (security review H-1).
        const created = sim;
        if (c.economy) c.guard('economy.registerWorld', () => c.economy?.registerNewWorld(created.state));
      } catch (e) {
        c.report('startGame', e);
        c.toast('bad', "Couldn't create the world", describeError(e), { mergeKey: 'startFail' });
        c.setScreen(from);
        return;
      }
      c.setLoading(0.7, 'Unpacking the coffins…');
      if (!tryEnterSession(c, sim, { loadedFrom: null, playMinutesBase: 0 }, null)) {
        c.toast('bad', "Couldn't start the game", 'The new world could not be opened. Please try again.', { mergeKey: 'startFail' });
        c.sfx('uiError');
        c.setScreen(from);
        return;
      }
      c.setLoading(0.85, 'Signing the lease…');
      await withTimeout(c.saveFlow.autosaveNow('newGame'), NEW_GAME_SAVE_TIMEOUT_MS, c.env, () => 'failed' as const);
      c.caz = null;
      disposePreviews(c);
      c.setLoading(1, 'Welcome home');
      c.setScreen(c.session?.gameOver ? 'gameOver' : 'game');
    },
    () => undefined,
  );
}

function restoreScreen(c: Core, from: Screen): void {
  if (c.session) c.setScreen(c.session.gameOver ? 'gameOver' : 'game');
  else if (from === 'menu' || from === 'newGame' || from === 'caz') c.setScreen(from);
  else enterMenu(c);
}

/**
 * W-025 S2 (docs/DESIGN_WORLD_LEVELS.md §1.11): a save migrated from schema v1 arrives with its walkable world frozen
 * (`town.expandPending`), so its schema-v1 journal replayed onto exactly the world it was recorded on. Only now, AFTER
 * journal recovery and with the session's journal attached, is the neighbourhood opened — by the journaled
 * `townExpand` command, so a later kill + replay applies it at the same tick. Never throws.
 */
export function expandTownIfPending(c: Core): void {
  const s = c.session;
  if (!s) return;
  c.guard('townExpand', () => {
    if (s.sim.state.town?.expandPending === true) s.dispatch({ type: 'townExpand' });
  });
}

export function loadGame(c: Core, slotId: string): Promise<LoadResult> {
  const busy = (): LoadResult => ({ ok: false, error: 'Busy — try again in a moment', code: 'io' });
  if (!isValidSlotId(slotId)) {
    // Refused before any screen change or storage access (path tricks, device names, junk from the UI).
    const bad: LoadResult = { ok: false, error: 'That save slot name is not valid.', code: 'not_found' };
    c.toast('bad', "Couldn't load that save", bad.error, { mergeKey: 'loadFail' });
    return Promise.resolve(bad);
  }
  return c.transition(
    `load:${String(slotId)}`,
    async () => {
      const from = c.screen;
      if (from === 'boot' || from === 'loading' || c.fatal !== null || c.disposed) return busy();
      c.setScreen('loading');
      c.setLoading(0.15, 'Exhuming your save…');
      const res = await c.saveFlow.load(slotId);
      if (!res.ok) {
        restoreScreen(c, from);
        c.toast('bad', "Couldn't load that save", res.error, { mergeKey: 'loadFail' });
        c.sfx('uiError');
        return res;
      }
      const denyUnowned = (): LoadResult => {
        restoreScreen(c, from);
        const fail: LoadResult = { ok: false, error: 'This save contains a premium body that this profile does not own. The save was not changed.', code: 'invalid' };
        c.toast('warning', "Couldn't load that save", fail.error, { mergeKey: 'loadFail' });
        return fail;
      };
      if (unownedPremiumBody(res.world, c.economy)) return denyUnowned();
      c.setLoading(0.6, 'Shaking off the grave dirt…');
      let sim: SimulationAPI;
      try {
        sim = c.simModule.createSimulation(res.world);
      } catch (e) {
        c.report('loadGame.createSimulation', e);
        restoreScreen(c, from);
        const fail: LoadResult = { ok: false, error: `The save could not be opened: ${describeError(e)}`, code: 'invalid' };
        c.toast('bad', "Couldn't load that save", fail.error, { mergeKey: 'loadFail' });
        return fail;
      }
      // Write-ahead journal: replay what happened after this snapshot (crash / killed tab) before entering the world.
      const replayed = await c.saveFlow.recoverJournal(res, sim, (w) => c.simModule.createSimulation(w), (f) => c.setLoading(0.62 + 0.3 * f, 'Replaying your last moments…'));
      sim = replayed.sim;
      if (c.disposed) return busy();
      if (unownedPremiumBody(sim.state, c.economy)) {
        c.saveFlow.cancelRecovery();
        return denyUnowned();
      }
      if (!tryEnterSession(c, sim, { loadedFrom: res.info.slotId, playMinutesBase: res.info.playMinutes }, res.info)) {
        restoreScreen(c, from);
        const fail: LoadResult = { ok: false, error: 'The save could not be opened.', code: 'invalid' };
        c.toast('bad', "Couldn't load that save", fail.error, { mergeKey: 'loadFail' });
        return fail;
      }
      expandTownIfPending(c);
      const warnings = Array.isArray(res.warnings) ? res.warnings : [];
      for (const w of warnings.slice(0, 3)) c.toast('warning', 'Save recovered', String(w));
      if (res.info.recoveredFromBackup && warnings.length === 0) c.toast('warning', 'Save recovered', 'The latest save was damaged, so its backup was loaded.');
      // A save from an older version of the game, upgraded on load: say so plainly, once, and not as a warning.
      if (Array.isArray(res.migrated) && res.migrated.length > 0) {
        c.toast('info', 'Save updated', 'This save came from an earlier version of the game. It now works with this one.', { mergeKey: 'saveMigrated' });
      }
      // The engine repaired structural problems while loading (details are in the fault log / diagnostics).
      let repaired = 0;
      try {
        repaired = Array.isArray(sim.repairWarnings) ? sim.repairWarnings.length : 0;
      } catch {
        repaired = 0;
      }
      if (repaired > 0) {
        c.toast('warning', 'Save repaired', `${repaired} problem${repaired === 1 ? ' was' : 's were'} found in this save and fixed automatically.`, { mergeKey: 'repaired' });
      }
      c.setLoading(1, 'Welcome back');
      c.setScreen(c.session?.gameOver ? 'gameOver' : 'game');
      return res;
    },
    busy,
  );
}

export async function continueLatest(c: Core): Promise<boolean> {
  const info = await c.saveFlow.latest();
  if (!info) {
    c.toast('info', 'No saves yet', 'Start a new game — it autosaves as you play.', { mergeKey: 'noSaves' });
    return false;
  }
  const r = await loadGame(c, info.slotId);
  return r.ok;
}

export function quitToMenu(c: Core): Promise<void> {
  if (c.fatal !== null) {
    // From the crash screen "quit to menu" means "back to menu" (only if that is possible at all).
    recoverFromFatal(c);
    return Promise.resolve();
  }
  return c.transition(
    'quit',
    async () => {
      const s = c.session;
      if (!s) {
        if (c.screen === 'newGame' || c.screen === 'caz' || c.screen === 'gameOver') enterMenu(c);
        return;
      }
      if (c.inGame()) {
        const anyway = c.env.now() < c.quitAnywayUntil;
        if (!anyway) {
          c.play.hold('transition');
          const outcome = await withTimeout(c.saveFlow.autosaveNow('quit'), QUIT_SAVE_TIMEOUT_MS, c.env, () => 'failed' as const);
          c.play.release('transition');
          if (outcome === 'failed') {
            // Never silently lose progress, never trap the player: a second quit within the window leaves anyway.
            c.quitAnywayUntil = c.env.now() + QUIT_ANYWAY_WINDOW_MS;
            c.toast('bad', "Couldn't save before quitting", 'Your game is still open. Quit again within 30 seconds to leave without saving, or export your save first.', { mergeKey: 'quitFail' });
            c.sfx('uiError');
            return;
          }
        }
      }
      if (c.session !== s) return;
      c.quitAnywayUntil = 0;
      teardownSession(c);
      enterMenu(c);
    },
    () => undefined,
  );
}

export function quitApp(c: Core): void {
  const native = c.env.native();
  if (!native) {
    c.toast('info', 'Close the tab to quit', 'Your progress is saved automatically.', { mergeKey: 'quitApp' });
    return;
  }
  if (c.quittingApp) return; // double-clicked "Quit": one save, one quit
  c.quittingApp = true;
  void (async () => {
    try {
      if (c.inGame()) await withTimeout(c.saveFlow.autosaveNow('quitApp'), QUIT_SAVE_TIMEOUT_MS, c.env, () => 'failed' as const);
      await withTimeout(c.profileWriter.flush().then(() => true), 2000, c.env, () => false);
      native.quit();
    } catch (e) {
      c.report('native.quit', e);
      c.quittingApp = false; // let the player try again
    }
  })();
}

// ═════════════════════════════ settings ═════════════════════════════

export function updateSettings(c: Core, patch: Partial<Settings>): void {
  const prev = c.settings;
  const next = applySettingsPatch(prev, patch);
  if (changedSettings(prev, next).length === 0) return;
  c.settings = next;
  applySettings(c, prev);
  void c.profileWriter.write(SETTINGS_PROFILE_KEY, next);
  c.notifier.notifyNow();
}

export function resetSettings(c: Core): void {
  const prev = c.settings;
  c.settings = sanitizeSettings(DEFAULT_SETTINGS);
  applySettings(c, prev);
  void c.profileWriter.write(SETTINGS_PROFILE_KEY, c.settings);
  c.notifier.notifyNow();
}

/** Push settings to renderer / audio / sim. `prev` null = apply everything. */
export function applySettings(c: Core, prev: Settings | null): void {
  const s = c.settings;
  const changed = new Set(prev ? changedSettings(prev, s) : (Object.keys(s) as (keyof Settings)[]));
  if (changed.has('volumes') || changed.has('musicEnabled')) c.guard('audio.setVolumes', () => c.audio.setVolumes(effectiveVolumes(s)));
  if (changed.has('muted')) syncAudioMute(c);
  // Auto (W-039): a new 'auto' choice resumes from the stored result, or probes afresh when there is none (first
  // run / Reset Settings). The controller's own write-back of the settled level (syncAutoQuality) changes only
  // autoQuality to the level already running, so it never restarts the probe.
  const reprobe = changed.has('autoQuality') && s.quality === 'auto' && s.autoQuality === 'unset';
  if (c.rendererReady && (changed.has('quality') || reprobe)) {
    c.guard('renderer.setQuality', () => c.renderer.setQuality(s.quality, s.autoQuality === 'unset' ? null : s.autoQuality));
  }
  if (c.rendererReady && changed.has('pixelRatio')) {
    // The renderer takes the EFFECTIVE ratio: 0 (auto) is resolved to min(devicePixelRatio, 2) here, as for init().
    // Any other value is the player's explicit choice and wins over the preset windows (D-025).
    const pr = effectivePixelRatio(s.pixelRatio, c.env.devicePixelRatio());
    c.appliedPixelRatio = pr;
    c.guard('renderer.setPixelRatio', () => c.renderer.setPixelRatio(pr, s.pixelRatio > 0));
  }
  if (changed.has('miniatureFocus')) c.guard('renderer.setMiniatureFocus', () => c.renderer.setMiniatureFocus?.(s.miniatureFocus));
  if (changed.has('reduceMotion')) c.guard('renderer.setReduceMotion', () => c.renderer.setReduceMotion?.(s.reduceMotion));
  if (changed.has('autonomy') && c.session) c.session.dispatch({ type: 'setSettings', settings: { autonomy: s.autonomy } });
  if (changed.has('autosaveMinutes')) c.saveFlow.autosave.rescheduleFromNow();
  if (changed.has('muteWhenUnfocused') && !s.muteWhenUnfocused) setFocusMute(c, false);
  if (changed.has('pauseWhenUnfocused') && !s.pauseWhenUnfocused) c.play.release('hidden');
  if (changed.has('autoPauseOnEvents') && !s.autoPauseOnEvents) c.play.release('choice');
  if (changed.has('tutorialEnabled') && !s.tutorialEnabled) c.hints.hide(c.env.now());
}

/**
 * W-039: persist the level Auto settled on (probe result or a runtime downgrade) so the next session starts there
 * without probing. Called from the slow tick; a no-op unless quality is 'auto' and the probe has finished.
 */
export function syncAutoQuality(c: Core): void {
  if (!c.rendererReady || c.settings.quality !== 'auto') return;
  let level: AutoQualityLevel | null = null;
  c.guard('renderer.graphicsInfo', () => {
    const st = c.renderer.graphicsInfo?.()?.auto;
    if (st && st.phase === 'watch') level = st.level;
  });
  if (level !== null && level !== c.settings.autoQuality) updateSettings(c, { autoQuality: level });
}
