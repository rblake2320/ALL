/**
 * Adversarial odds and ends: CPU-budget accounting, devicePixelRatio changes, diagnostics with a hostile audio
 * probe, stable hint identity, renderer teardown on dispose, buy-mode pick-ups interrupted by mode hotkeys, a sim
 * that throws while a session is being entered, and a profile from an older version (missing keys).
 */
import { describe, expect, it } from 'vitest';
import { createHarness, startedHarness } from './controllerHarness';
import { point } from './fakes';

describe('loop accounting', () => {
  it('ticks cut by the per-frame CPU budget are counted as dropped (diagnostics stay honest)', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.setSpeed(3);
    sim.stepImpl = () => {
      h.env.t += 5; // every tick costs 5 ms of CPU
    };
    await h.frames(10, 250);
    const report = h.game.diagnostics();
    const dropped = Number(/droppedTicks: (\d+)/.exec(report)?.[1] ?? '0');
    const over = Number(/overBudgetFrames: (\d+)/.exec(report)?.[1] ?? '0');
    expect(over).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThan(0);
  });
});

describe('display', () => {
  it('auto pixel ratio follows a devicePixelRatio change on resize (moving to another monitor)', async () => {
    const h = await startedHarness();
    h.env.devicePixelRatio = () => 1.0;
    h.win.dispatchEvent(new Event('resize'));
    expect(h.renderer.last('setPixelRatio')!.args[0]).toBe(1);
    const n = h.renderer.count('setPixelRatio');
    h.win.dispatchEvent(new Event('resize')); // same DPR: no redundant call
    expect(h.renderer.count('setPixelRatio')).toBe(n);
    h.game.updateSettings({ pixelRatio: 2 }); // explicit ratio wins over DPR
    h.env.devicePixelRatio = () => 3;
    h.win.dispatchEvent(new Event('resize'));
    expect(h.renderer.last('setPixelRatio')!.args[0]).toBe(2);
  });
});

describe('diagnostics', () => {
  it('includes audio stats when available and survives a throwing / junk stats() probe', async () => {
    const h = await startedHarness();
    (h.audio as unknown as { stats: () => unknown }).stats = () => ({ context: 'running', voices: 2 });
    expect(h.game.diagnostics()).toMatch(/Audio:\n {2}context: running\n {2}voices: 2/);
    (h.audio as unknown as { stats: () => unknown }).stats = () => {
      throw new Error('audio dead');
    };
    expect(() => h.game.diagnostics()).not.toThrow();
    (h.audio as unknown as { stats: () => unknown }).stats = () => null;
    expect(() => h.game.diagnostics()).not.toThrow();
  });
});

describe('UI-facing identity', () => {
  it('the visible hint object keeps its identity between reads (cheap memoisation)', async () => {
    const h = await startedHarness();
    await h.frames(40);
    const a = h.game.hint;
    expect(a).not.toBeNull();
    expect(h.game.hint).toBe(a);
  });
});

describe('dispose', () => {
  it('tears down the renderer and silences music (contract: listeners/loops/renderer)', async () => {
    const h = await startedHarness();
    let disposed = 0;
    h.renderer.dispose = () => {
      disposed++;
    };
    h.game.dispose();
    h.game.dispose(); // idempotent
    expect(disposed).toBe(1);
    expect(h.audio.named('music').at(-1)!.args[0]).toBe('none');
  });
});

describe('buy mode interrupted', () => {
  it('a picked-up object reappears when a mode hotkey switches away mid-move', async () => {
    const h = await startedHarness();
    h.game.setMode('buy');
    h.renderer.pickResult = { kind: 'object', objectId: 'o1', point: point() };
    h.pointer('pointerdown', 300, 300);
    h.pointer('pointerup', 300, 300);
    expect(h.game.buy.movingObjectId).toBe('o1');
    expect(h.renderer.hidden).toBe('o1');
    h.key('keydown', 'F3'); // build mode
    expect(h.game.mode).toBe('build');
    expect(h.renderer.hidden).toBeNull();
    expect(h.game.buy.movingObjectId).toBeNull();
    expect(h.renderer.ghost).toBeNull();
  });

  it('a picked-up object reappears when a game over interrupts the move', async () => {
    const h = await startedHarness();
    h.game.pickUpObject('o1');
    expect(h.renderer.hidden).toBe('o1');
    h.gameSim().events.push({ type: 'gameOver', reason: 'Rest in Pieces' });
    await h.frames(1);
    expect(h.game.screen).toBe('gameOver');
    expect(h.renderer.hidden).toBeNull();
  });
});

describe('a broken simulation while entering a session', () => {
  it('startGame with a sim whose state getter throws returns to CAZ instead of hanging on "loading"', async () => {
    const h = await createHarness();
    h.simModule.configure = (sim) => {
      Object.defineProperty(sim, 'state', {
        get() {
          throw new Error('state exploded');
        },
      });
    };
    h.game.beginNewGame();
    h.env.randoms.push(0x42);
    const p = h.game.startGame();
    await h.frames(5); // the fake clock only moves with frames (startGame yields to the UI once)
    await p;
    expect(h.game.screen).toBe('caz');
    expect(h.game.sim).toBeNull();
    expect(h.game.fatalError).toBeNull();
    expect(h.game.toasts.some((t) => /Couldn't/.test(t.title))).toBe(true);
  });
});

describe('profiles from older versions', () => {
  it('missing keys come from defaults (and reduceMotion from the OS), present keys are kept', async () => {
    const h = await createHarness({ settings: { quality: 'low', volumes: { music: 0.1 } }, setup: ({ env }) => (env.reducedMotion = true) });
    expect(h.game.settings.quality).toBe('low');
    expect(h.game.settings.volumes.music).toBe(0.1);
    expect(h.game.settings.volumes.sfx).toBe(0.8);
    expect(h.game.settings.reduceMotion).toBe(true);
    expect(h.game.settings.autosaveMinutes).toBe(5);
  });
});

describe('autonomy setting on session start', () => {
  it('is pushed to the sim only when the world differs from the player\'s setting', async () => {
    const h = await createHarness({ settings: { autonomy: 'limited' } });
    h.game.beginNewGame();
    h.env.randoms.push(0x777);
    const p = h.game.startGame();
    await h.until(() => h.game.screen === 'game');
    await p;
    expect(h.gameSim().dispatched).toContainEqual({ type: 'setSettings', settings: { autonomy: 'limited' } });
  });
});

describe('save status for the UI (contract #22: lastSavedAt / lastSaveFailed)', () => {
  it('lastSavedAt is the wall-clock time of the last good save; lastSaveFailed tracks the latest attempt', async () => {
    const h = await startedHarness();
    expect(h.env.wall - h.game.lastSavedAt!).toBeLessThan(1000); // the start-of-game autosave, frames ago
    expect(h.game.lastSaveFailed).toBe(false);
    h.env.advance(120_000);
    h.saves.failSaves = 1;
    h.gameSim().state.tick += 3;
    const before = h.game.lastSavedAt;
    expect((await h.game.saveGame()).ok).toBe(false);
    expect(h.game.lastSaveFailed).toBe(true);
    expect(h.game.lastSavedAt).toBe(before);
    expect(h.game.lastSaveLabel).toBe('Save failed');
    expect((await h.game.saveGame()).ok).toBe(true);
    expect(h.game.lastSaveFailed).toBe(false);
    expect(h.game.lastSavedAt).toBe(h.env.wall);
    await h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    expect(h.game.lastSavedAt).toBeNull();
  });

  it('a loaded world reports the time it was saved', async () => {
    const h = await startedHarness();
    await h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    const info = (await h.game.listSaves()).find((s) => s.slotId === 'auto-00c0ffee')!;
    expect((await h.game.loadGame('auto-00c0ffee')).ok).toBe(true);
    expect(h.game.lastSavedAt).toBe(Date.parse(info.savedAt));
  });
});

describe('manual saves never overwrite controller-owned slots', () => {
  it('autosave / emergency / legacy autosave ids are refused; UI-minted fresh ids work and are lower-cased', async () => {
    const h = await startedHarness();
    const n = h.saves.saveCalls.length;
    for (const id of ['auto-00c0ffee', 'AUTO-00C0FFEE', 'emergency', 'Emergency', 'autosave', 'autosave-3']) {
      const r = await h.game.saveGame(id, 'mine');
      expect(r.ok).toBe(false);
    }
    expect(h.saves.saveCalls.length).toBe(n);
    const r = await h.game.saveGame('Save-KXYZ12', 'New save');
    expect(r.ok).toBe(true);
    expect(h.saves.saveCalls.at(-1)!.slotId).toBe('save-kxyz12');
  });
});

describe('loop under tab-hide and huge gaps', () => {
  it('hidden tab with "pause when unfocused" off keeps simulating from the fallback timer at real-time pace', async () => {
    const h = await startedHarness({ settings: { pauseWhenUnfocused: false } });
    const sim = h.gameSim();
    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    const t0 = sim.state.tick;
    h.env.advance(60_000); // no animation frames at all while hidden, only timers
    const ticks = sim.state.tick - t0;
    expect(ticks).toBeGreaterThan(150); // ~240 at 1× (4 ticks per real second)
    expect(ticks).toBeLessThanOrEqual(250);
  });

  it('hidden tab with "pause when unfocused" on does not advance the world at all', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    const t0 = sim.state.tick;
    h.env.advance(60_000);
    expect(sim.state.tick).toBe(t0);
    h.doc.visibilityState = 'visible';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.game.speed).toBe(1);
  });

  it('one frame after a 10-minute blocked main thread runs at most one second of game time (no avalanche)', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.setSpeed(4 as never); // clamped to 3 (someone is awake) — 32 ticks/s
    const t0 = sim.state.tick;
    h.env.t += 10 * 60_000; // the clock jumps; no timer or frame callback ran meanwhile (debugger, hibernation)
    h.env.wall += 10 * 60_000;
    await h.frames(1, 16);
    expect(sim.state.tick - t0).toBeLessThanOrEqual(33);
  });
});

describe('autosave scheduling vs choices and concurrent requests', () => {
  it('a pending choice holds back interval autosaves, but quitting still saves', async () => {
    const h = await startedHarness({ settings: { autosaveMinutes: 1, autoPauseOnEvents: false } });
    const sim = h.gameSim();
    sim.state.choices.push({ id: 'c1', tick: 0, title: 't', text: 'x', agentId: 'a1', options: [], expiresTick: 1e9, defaultOption: 0 });
    const n = h.saves.saveCalls.length;
    await h.frames(70, 1000); // > 1 minute of real time, world ticking
    expect(h.saves.saveCalls.length).toBe(n);
    await h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    expect(h.saves.saveCalls.length).toBe(n + 1);
  });

  it('manual save + tab-hide autosave + quit + export burst: the storage never sees two writes at once', async () => {
    const h = await startedHarness();
    h.gameSim().state.tick += 10;
    const release = h.saves.hold();
    const a = h.game.saveGame();
    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    h.gameSim().state.tick += 10;
    const b = h.game.saveGame('another-slot');
    const q = h.game.quitToMenu();
    release();
    await Promise.all([a, b]);
    await h.frames(10);
    await q;
    expect(h.saves.maxConcurrent).toBe(1);
  });
});
