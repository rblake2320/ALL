/**
 * Adversarial lifecycle tests: dispose/boot races (HMR), fatal recovery paths, per-session leaks over many
 * start/quit cycles, and the contract behaviours the first pass missed (reduced-motion seeding, full-moon ambience).
 */
import { describe, expect, it } from 'vitest';
import { createGameController } from '../../../src/game/controller';
import { FakeCanvas, FakeDocument, FakeWindow, createHarness, startedHarness } from './controllerHarness';
import { FakeAudio, FakeEnv, FakeProfile, FakeRenderer, FakeSaves, FakeSimModule, flush } from './fakes';

class GatedRenderer extends FakeRenderer {
  private open!: () => void;
  readonly gate = new Promise<void>((r) => (this.open = r));
  release(): void {
    this.open();
  }
  override async init(canvas: HTMLCanvasElement, opts: { quality: 'low' | 'medium' | 'high' | 'ultra'; pixelRatio: number }): Promise<void> {
    await super.init(canvas, opts);
    await this.gate;
  }
}

function rig() {
  const env = new FakeEnv();
  const win = new FakeWindow();
  const doc = new FakeDocument();
  env.window = win as unknown as Window;
  env.document = doc as unknown as Document;
  const renderer = new GatedRenderer();
  const audio = new FakeAudio();
  const saves = new FakeSaves();
  const profile = new FakeProfile();
  const simModule = new FakeSimModule();
  const canvas = new FakeCanvas();
  const game = createGameController({ renderer, audio, saves, profile, sim: simModule, env });
  return { env, win, doc, renderer, audio, saves, profile, simModule, canvas, game };
}

describe('boot / dispose races', () => {
  it('dispose() while the renderer is still initialising leaves no listeners, loop or timers behind', async () => {
    const r = rig();
    const booting = r.game.boot(r.canvas as unknown as HTMLCanvasElement);
    await flush();
    r.game.dispose();
    r.renderer.release();
    await booting;
    await flush();
    for (let i = 0; i < 5; i++) r.env.frame(16);
    expect(r.win.listenerCount).toBe(0);
    expect(r.doc.listenerCount).toBe(0);
    expect(r.canvas.listenerCount).toBe(0);
    expect(r.env.frames.size).toBe(0);
    expect(r.renderer.frameCount).toBe(0);
    expect(r.game.screen).not.toBe('menu');
  });

  it('a second concurrent boot() resolves only when the first boot has finished', async () => {
    const r = rig();
    const a = r.game.boot(r.canvas as unknown as HTMLCanvasElement);
    let bDone = false;
    const b = r.game.boot(r.canvas as unknown as HTMLCanvasElement).then(() => (bDone = true));
    await flush();
    expect(bDone).toBe(false);
    r.renderer.release();
    for (let i = 0; i < 40 && r.game.screen !== 'menu'; i++) {
      r.env.frame(16);
      await flush(6);
    }
    await Promise.all([a, b]);
    expect(r.game.screen).toBe('menu');
    expect(r.renderer.count('init')).toBe(1);
  });

  it('boot after dispose is a no-op', async () => {
    const r = rig();
    r.game.dispose();
    r.renderer.release();
    await r.game.boot(r.canvas as unknown as HTMLCanvasElement);
    expect(r.renderer.count('init')).toBe(0);
    expect(r.win.listenerCount).toBe(0);
  });
});

describe('fatal recovery', () => {
  it('after a renderer that could not start, "menu" does not open a dead menu (reload is the only way out)', async () => {
    const h = await createHarness({ setup: ({ renderer }) => (renderer.failInit = true) });
    expect(h.game.fatalError).not.toBeNull();
    h.game.goto('menu');
    expect(h.game.fatalError).not.toBeNull();
    expect(h.game.screen).not.toBe('menu');
    await h.game.quitToMenu();
    expect(h.game.fatalError).not.toBeNull();
  });

  it('recovering from a crash on the menu rebuilds the demo world instead of keeping the crashed one', async () => {
    const h = await createHarness();
    const before = h.renderer.attached;
    h.win.dispatchEvent(Object.assign(new Event('error'), { error: new Error('boom'), message: 'boom' }));
    expect(h.game.fatalError).not.toBeNull();
    h.game.goto('menu');
    expect(h.game.fatalError).toBeNull();
    expect(h.game.screen).toBe('menu');
    expect(h.renderer.attached).not.toBeNull();
    expect(h.renderer.attached).not.toBe(before);
  });

  it('quitToMenu from the crash screen of a recoverable crash behaves like "back to menu"', async () => {
    const h = await startedHarness();
    h.win.dispatchEvent(Object.assign(new Event('error'), { error: new Error('ui exploded'), message: 'ui exploded' }));
    await h.frames(2);
    expect(h.game.fatalError).not.toBeNull();
    await h.game.quitToMenu();
    expect(h.game.fatalError).toBeNull();
    expect(h.game.screen).toBe('menu');
    expect(h.game.sim).toBeNull();
  });
});

describe('no per-session leaks over many start → quit cycles', () => {
  it('30 cycles keep DOM listeners, timers, loops, previews and toasts bounded', async () => {
    const h = await createHarness();
    const base = { win: h.win.listenerCount, doc: h.doc.listenerCount, canvas: h.canvas.listenerCount, timers: h.env.pendingTimers };
    for (let i = 0; i < 30; i++) {
      h.game.beginNewGame();
      const preview = h.game.createCazPreview({} as HTMLCanvasElement);
      void preview;
      h.env.randoms.push(0x1000 + i);
      const p = h.game.startGame();
      await h.until(() => h.game.screen === 'game');
      await p;
      const sim = h.gameSim();
      sim.events.push({ type: 'sfxLoop', id: 'shower', key: `shower:o${i}`, on: true, objectId: 'o1' });
      sim.events.push({ type: 'bubble', agentId: 'a1', icon: 'brain', style: 'thought' });
      sim.state.tick += 10;
      await h.frames(2);
      await h.game.quitToMenu();
      await h.until(() => h.game.screen === 'menu');
    }
    expect(h.win.listenerCount).toBe(base.win);
    expect(h.doc.listenerCount).toBe(base.doc);
    expect(h.canvas.listenerCount).toBe(base.canvas);
    expect(h.env.pendingTimers).toBeLessThanOrEqual(base.timers + 2);
    expect(h.game.toasts.length).toBe(0);
    expect(h.game.bubbles.length).toBe(0);
    expect(h.renderer.previewsCreated).toBe(30);
    expect(h.renderer.count('preview.dispose')).toBe(30);
    expect(h.renderer.attached).toBe(h.simModule.sims.at(-1)); // the menu demo, not a stale game
    expect(h.audio.named('stopAllLoops').length).toBeGreaterThanOrEqual(30);
  });
});

describe('screen flow edge cases', () => {
  it('loading a save from the CAZ screen releases CAZ state and its previews', async () => {
    const h = await startedHarness();
    await h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    h.game.beginNewGame();
    h.game.createCazPreview({} as HTMLCanvasElement);
    expect(h.game.caz).not.toBeNull();
    const r = await h.game.loadGame('auto-00c0ffee');
    expect(r.ok).toBe(true);
    expect(h.game.screen).toBe('game');
    expect(h.game.caz).toBeNull();
    expect(h.renderer.count('preview.dispose')).toBe(1);
  });

  it('quitApp is re-entrant safe: double clicks save once and quit once', async () => {
    const h = await startedHarness();
    let quits = 0;
    h.env.nativeBridge = { platform: 'win32', version: '1.0.0', quit: () => quits++ } as never;
    h.gameSim().state.tick += 5;
    h.game.quitApp();
    h.game.quitApp();
    await h.frames(5);
    expect(quits).toBe(1);
  });

  it('turning autoPauseOnEvents off while a choice holds the game resumes time', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    sim.state.choices.push({ id: 'c1', tick: 0, title: 'Work event', text: '?', agentId: 'a1', options: [], expiresTick: 999, defaultOption: 0 });
    sim.events.push({ type: 'choice', choiceId: 'c1' });
    await h.frames(1);
    expect(h.game.speed).toBe(0);
    h.game.updateSettings({ autoPauseOnEvents: false });
    expect(h.game.speed).toBe(1);
  });
});

describe('contract behaviours (docs/CONTRACTS.md #15, #17)', () => {
  it('first run (no saved profile) seeds reduceMotion from prefers-reduced-motion', async () => {
    const h = await createHarness({ setup: ({ env }) => (env.reducedMotion = true) });
    expect(h.game.settings.reduceMotion).toBe(true);
  });

  it('a saved profile wins over the OS preference', async () => {
    const h = await createHarness({ settings: { reduceMotion: false }, setup: ({ env }) => (env.reducedMotion = true) });
    expect(h.game.settings.reduceMotion).toBe(false);
  });

  it('full-moon nights ask the audio engine for the moon ambience layer', async () => {
    const h = await startedHarness();
    h.gameSim().timeOverride = { isNight: true, fullMoon: true };
    await h.frames(40);
    const last = h.audio.named('setAmbience').at(-1)!.args[0] as { night: boolean; moon?: boolean };
    expect(last.night).toBe(true);
    expect(last.moon).toBe(true);
  });

  it('reduceMotion stops the slow menu camera orbit', async () => {
    const h = await createHarness();
    h.game.updateSettings({ reduceMotion: true });
    const before = h.renderer.count('orbit');
    await h.frames(30);
    expect(h.renderer.count('orbit')).toBe(before);
  });
});

describe('holds survive session changes', () => {
  it('a game started while the tab is hidden stays paused (pauseWhenUnfocused) until it is visible', async () => {
    const h = await createHarness();
    h.game.beginNewGame();
    h.env.randoms.push(0x5151);
    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    const p = h.game.startGame();
    await h.until(() => h.game.screen === 'game');
    await p;
    expect(h.game.speed).toBe(0);
    const t0 = h.gameSim().state.tick;
    await h.frames(30);
    expect(h.gameSim().state.tick).toBe(t0);
    h.doc.visibilityState = 'visible';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.game.speed).toBe(1);
  });
});
