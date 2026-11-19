/**
 * Core: the shared state + infrastructure of one GameController instance. The facade (controller.ts) and the
 * feature modules (lifecycle.ts, frame.ts, media.ts, cazFlow.ts) all operate on this object; sub-systems
 * (Gameplay, SaveFlow, InputController, FrameDriver) are wired in by controller.ts right after construction.
 */
import type { CazState, Screen, Settings } from './contracts';
import { DEFAULT_SETTINGS } from './contracts';
import type { ContentRegistry, LotTemplate, SimulationAPI } from '../sim/contracts';
import type { AgentId, NotificationKind } from '../sim/types';
import type { PreviewStage, RendererAPI } from '../render/contracts';
import type { AudioAPI } from '../audio/contracts';
import type { ProfileStore, SaveManager } from '../persistence/contracts';
import type { SfxId } from '../shared/audioIds';
import type { GameEnv } from './env';
import type { SimModule } from './simTypes';
import type { Gameplay } from './gameplay';
import type { SaveFlow } from './saveFlow';
import type { InputController } from './input/index';
import type { FrameDriver } from './loop';
import type { RouterHost } from './events';
import type { GameSession } from './session';
import type { EconomyService } from '../economy/service';
import { Notifier } from './notifier';
import { ErrorRing } from './diagnostics';
import { EventTrail } from '../feedback/trail';
import type { FeedbackService } from './feedback';
import type { SessionLogService } from './sessionLog';
import { BubbleBoard, ToastCenter } from './toasts';
import { EventRouter } from './events';
import { MusicDirector } from './music';
import { ProfileWriter } from './profile';
import { HintEngine, TUTORIAL_PROFILE_KEY } from './hints';
import { buildCazCatalog, type CazCatalog } from './gddCatalog';
import { cloneSettings } from './settings';
import { updateMusic } from './media';

export const NOTIFY_INTERVAL_MS = 1000 / 12;

export interface CoreDeps {
  renderer: RendererAPI;
  audio: AudioAPI;
  saves: SaveManager;
  profile: ProfileStore;
  sim: SimModule;
  env: GameEnv;
}

export class Core {
  readonly renderer: RendererAPI;
  readonly audio: AudioAPI;
  readonly saves: SaveManager;
  readonly profile: ProfileStore;
  readonly simModule: SimModule;
  readonly env: GameEnv;
  readonly notifier: Notifier;
  readonly errors: ErrorRing;
  /** Last 50 UI/sim events (closed vocabulary) + FPS summary for feedback reports (W-110). */
  readonly trail: EventTrail;
  /** Bug reports / feedback (wired by controller.ts). */
  feedback: FeedbackService | null = null;
  /** Local playtest session log (W-117; wired by controller.ts). Read-only observer of the game. */
  sessionLog: SessionLogService | null = null;
  readonly toastCenter: ToastCenter;
  readonly bubbleBoard = new BubbleBoard();
  readonly router = new EventRouter();
  readonly musicDirector = new MusicDirector();
  readonly profileWriter: ProfileWriter;
  /** Profile economy (src/economy): fed the played world's events/frames by frame.ts; null when absent. */
  economy: EconomyService | null = null;
  hints: HintEngine;
  /** W-113 story-start intro card (shown through the hint callout), null when none is up. */
  storyIntro: import('./storyIntro').StoryIntroState | null = null;

  // Wired by controller.ts immediately after construction.
  play!: Gameplay;
  saveFlow!: SaveFlow;
  input!: InputController;
  driver!: FrameDriver;
  gameRouterHost!: RouterHost;
  demoRouterHost!: RouterHost;

  screen: Screen = 'boot';
  loadingProgress = 0;
  loadingLabel = '';
  fatal: string | null = null;
  caz: CazState | null = null;
  content: ContentRegistry | null = null;
  lotTemplates: LotTemplate[] = [];
  catalog: CazCatalog = buildCazCatalog(null, null);
  session: GameSession | null = null;
  demo: SimulationAPI | null = null;
  demoStartedAt = 0;
  demoRebuildPending = false;
  settings: Settings = cloneSettings(DEFAULT_SETTINGS);
  fps = 0;
  accumulator = 0;
  alpha = 0;
  booted = false;
  /** The one in-flight / finished boot (boot() is idempotent and shares it). */
  bootPromise: Promise<void> | null = null;
  disposed = false;
  rendererReady = false;
  /** Effective pixel ratio last handed to the renderer (auto mode follows devicePixelRatio changes). */
  appliedPixelRatio = 0;
  /** quitApp() in progress (double clicks must not save + quit twice). */
  quittingApp = false;
  readonly uninstallers: (() => void)[] = [];
  readonly previews = new Set<PreviewStage>();
  assetsWaiter: (() => void) | null = null;
  renderFailures = 0;
  stepFailFrames = 0;
  readonly stats = { frames: 0, ticks: 0, dropped: 0, overBudget: 0 };
  nextSlowAt = 0;
  lastRenderAt = Number.NEGATIVE_INFINITY;
  hidden = false;
  windowFocused = true;
  mutedForFocus = false;
  lastAmbience = '';
  lastSaveLabelSeen: string | null = null;
  activeTransition: { key: string; promise: Promise<unknown> } | null = null;
  quitAnywayUntil = 0;

  constructor(deps: CoreDeps) {
    this.renderer = deps.renderer;
    this.audio = deps.audio;
    this.saves = deps.saves;
    this.profile = deps.profile;
    this.simModule = deps.sim;
    const env = (this.env = deps.env);
    this.errors = new ErrorRing(30, () => env.wallNow());
    this.trail = new EventTrail(() => env.now());
    this.notifier = new Notifier({
      minIntervalMs: NOTIFY_INTERVAL_MS,
      now: () => env.now(),
      setTimeout: (cb, ms) => env.setTimeout(cb, ms),
      clearTimeout: (h) => env.clearTimeout(h),
      onListenerError: (e) => this.report('ui.listener', e),
    });
    this.toastCenter = new ToastCenter(() => env.now());
    this.profileWriter = new ProfileWriter(deps.profile, (key, e) => this.report(`profile:${key}`, e));
    this.hints = this.makeHints([]);
  }

  report(where: string, err: unknown): void {
    this.errors.push(where, err);
    this.trail.push('error', where);
  }

  changed(discrete: boolean): void {
    if (discrete) this.notifier.notifyNow();
    else this.notifier.markDirty();
  }

  toast(kind: NotificationKind, title: string, text: string, opts: { agentId?: AgentId | null; mergeKey?: string } = {}): void {
    if (this.toastCenter.push({ kind, title, text, agentId: opts.agentId ?? null, mergeKey: opts.mergeKey })) this.notifier.markDirty();
  }

  sfx(id: SfxId): void {
    try {
      this.audio.sfx(id);
    } catch (e) {
      this.report('audio.sfx', e);
    }
  }

  guard(where: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.report(where, e);
    }
  }

  makeHints(seen: Iterable<string>): HintEngine {
    return new HintEngine(seen, (ids) => void this.profileWriter.write(TUTORIAL_PROFILE_KEY, { v: 1, seen: ids }));
  }

  /** True while a live (not game-over) world is on screen and nothing has crashed. */
  inGame(): boolean {
    return this.screen === 'game' && !!this.session && !this.session.gameOver && this.fatal === null;
  }

  setScreen(s: Screen): void {
    if (this.screen === s) return;
    this.screen = s;
    this.trail.push('screen', s);
    this.input.sync();
    updateMusic(this);
    this.notifier.notifyNow();
  }

  setLoading(progress: number, label?: string): void {
    const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    const changed = p !== this.loadingProgress || (label !== undefined && label !== this.loadingLabel);
    this.loadingProgress = p;
    if (label !== undefined) this.loadingLabel = label;
    if (changed) this.notifier.markDirty();
  }

  yieldToUi(): Promise<void> {
    return new Promise((r) => this.env.setTimeout(r, 0));
  }

  /** One in-flight lifecycle transition at a time; identical concurrent calls share the promise. Never rejects. */
  transition<T>(key: string, fn: () => Promise<T>, busy: () => T): Promise<T> {
    const active = this.activeTransition;
    if (active) return active.key === key ? (active.promise as Promise<T>) : Promise.resolve(busy());
    const promise = (async () => {
      try {
        return await fn();
      } catch (e) {
        this.report(`transition:${key}`, e);
        return busy();
      } finally {
        this.activeTransition = null;
      }
    })();
    this.activeTransition = { key, promise };
    return promise;
  }
}
