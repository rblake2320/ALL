/**
 * Boots a real GameController against fakes + a minimal EventTarget-based DOM (window, document, canvas) so the
 * controller's own DOM wiring (keyboard, pointer, visibility, global error handlers) runs in Node.
 */
import { createGameController, type GameControllerImpl } from '../../../src/game/controller';
import type { Settings } from '../../../src/game/contracts';
import type { SimModule } from '../../../src/game/simTypes';
import { FakeAudio, FakeEnv, FakeProfile, FakeRenderer, FakeSaves, FakeSim, FakeSimModule, flush } from './fakes';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { EconomyService } from '../../../src/economy/service';

/** EventTarget that counts live listeners (leak checks). */
export class CountingTarget extends EventTarget {
  listenerCount = 0;
  override addEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: AddEventListenerOptions | boolean): void {
    if (cb) this.listenerCount++;
    super.addEventListener(type, cb, opts);
  }
  override removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: EventListenerOptions | boolean): void {
    if (cb) this.listenerCount--;
    super.removeEventListener(type, cb, opts);
  }
}

export class FakeWindow extends CountingTarget {
  innerWidth = 1280;
  innerHeight = 720;
  devicePixelRatio = 1;
}

export class FakeDocument extends CountingTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
  activeElement: unknown = null;
}

export class FakeCanvas extends CountingTarget {
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720, x: 0, y: 0 };
  }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false;
  }
}

export interface Harness {
  game: GameControllerImpl;
  env: FakeEnv;
  renderer: FakeRenderer;
  audio: FakeAudio;
  saves: FakeSaves;
  profile: FakeProfile;
  simModule: FakeSimModule;
  win: FakeWindow;
  doc: FakeDocument;
  canvas: FakeCanvas;
  /** Run frames (16 ms each) + microtasks. */
  frames(n: number, ms?: number): Promise<void>;
  until(pred: () => boolean, maxFrames?: number): Promise<void>;
  key(type: 'keydown' | 'keyup', code: string, mods?: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; repeat?: boolean }): Event;
  pointer(type: string, x: number, y: number, extra?: Record<string, unknown>): Event;
  gameSim(): FakeSim;
  notifications: number;
}

export async function createHarness(
  opts: {
    settings?: unknown;
    tutorial?: unknown;
    progressSteps?: number[];
    setup?: (h: { renderer: FakeRenderer; saves: FakeSaves; profile: FakeProfile; simModule: FakeSimModule; env: FakeEnv }) => void;
    /** Use a real SimModule (integration tests) instead of the fake. */
    realSim?: SimModule;
    /** Profile economy double (security wiring tests). */
    economy?: unknown;
  } = {},
): Promise<Harness> {
  const env = new FakeEnv();
  const win = new FakeWindow();
  const doc = new FakeDocument();
  env.window = win as unknown as Window;
  env.document = doc as unknown as Document;
  const renderer = new FakeRenderer();
  const steps = opts.progressSteps ? opts.progressSteps.slice() : null;
  if (steps) renderer.loadProgress = () => (steps.length > 1 ? steps.shift()! : steps[0]);
  const audio = new FakeAudio();
  const saves = new FakeSaves();
  const profile = new FakeProfile();
  if (opts.settings !== undefined) profile.data.set('settings', opts.settings);
  if (opts.tutorial !== undefined) profile.data.set('tutorial', opts.tutorial);
  const simModule = new FakeSimModule();
  opts.setup?.({ renderer, saves, profile, simModule, env });
  const game = createGameController({ renderer, audio, saves, profile, sim: opts.realSim ?? simModule, env, ...(opts.economy ? { economy: opts.economy as never } : {}) });
  const canvas = new FakeCanvas();
  const h: Harness = {
    game,
    env,
    renderer,
    audio,
    saves,
    profile,
    simModule,
    win,
    doc,
    canvas,
    notifications: 0,
    async frames(n: number, ms = 16) {
      for (let i = 0; i < n; i++) {
        env.frame(ms);
        await flush(4);
      }
    },
    async until(pred, maxFrames = 400) {
      for (let i = 0; i < maxFrames && !pred(); i++) {
        env.frame(16);
        await flush(6);
      }
      if (!pred()) throw new Error(`condition not reached; screen=${game.screen} fatal=${game.fatalError}`);
    },
    key(type, code, mods = {}) {
      const e = new Event(type, { cancelable: true });
      Object.assign(e, { code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false, ...mods });
      win.dispatchEvent(e);
      return e;
    },
    pointer(type, x, y, extra = {}) {
      const e = new Event(type, { cancelable: true });
      Object.assign(e, { pointerId: 1, button: 0, clientX: x, clientY: y, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, pointerType: 'mouse', deltaY: 0, deltaMode: 0, ...extra });
      canvas.dispatchEvent(e);
      return e;
    },
    gameSim() {
      const s = game.sim;
      if (!s) throw new Error('no game sim');
      return s as unknown as FakeSim; // only meaningful with the fake module
    },
  };
  game.subscribe(() => h.notifications++);
  void game.boot(canvas as unknown as HTMLCanvasElement);
  await h.until(() => game.screen === 'menu' || game.fatalError !== null);
  return h;
}

/** Boot → CAZ → game with the default random household (plus optional settings). */
export async function startedHarness(
  opts: { settings?: Partial<Settings>; seed?: number; tutorial?: unknown; realSim?: SimModule; economy?: unknown; setup?: Parameters<typeof createHarness>[0] extends infer O ? (O extends { setup?: infer S } ? S : never) : never } = {},
): Promise<Harness> {
  const h = await createHarness({ settings: opts.settings, tutorial: opts.tutorial ?? { v: 1, seen: [] }, realSim: opts.realSim, economy: opts.economy, setup: opts.setup });
  h.game.beginNewGame();
  h.game.addCazMember(); // two zombies: a1 + a2
  h.env.randoms.push(opts.seed ?? 0xc0ffee);
  const p = h.game.startGame();
  await h.until(() => h.game.screen === 'game' || h.game.screen === 'gameOver');
  await p;
  await h.frames(1);
  return h;
}

/**
 * A real profile economy for an ANSWERED adult profile. Typed names (household rename) need one: with no economy, or an
 * unanswered / child profile, the game layer accepts preset names only (D-3, fails closed).
 */
export async function adultEconomy(): Promise<EconomyService> {
  const now = () => Date.parse('2026-11-12T12:00:00Z');
  const b = createMemoryBackend();
  const profile = new ProfileStoreImpl(() => Promise.resolve(b), { logger: { warn: () => undefined }, now });
  const econ = new EconomyService({ backend: () => Promise.resolve(b), profile, now, logger: { warn: () => undefined }, broadcast: false });
  await econ.init();
  if (econ.answerAgeGate(new Date(now()).getUTCFullYear() - 30) !== 'ok') throw new Error('age gate refused the adult answer');
  return econ;
}
