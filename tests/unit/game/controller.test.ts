import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Never load the real engine graph in these tests: every test injects a FakeSimModule.
vi.mock('../../../src/game/simModule', () => ({ defaultSimModule: null }));

import { DEFAULT_SETTINGS, KEYMAP } from '../../../src/game/contracts';
import { DEMO_SEED } from '../../../src/game/demoWorld';
import { SELECT_ENTRY_ID } from '../../../src/game/gameplay';
import { adultEconomy, createHarness, startedHarness } from './controllerHarness';
import { DOC_ONLY_ACTIONS } from '../../../src/game/input/keyboard';
import { flush, makeWorld, point } from './fakes';

describe('boot → loading → menu', () => {
  it('initialises the renderer with settings, mirrors load progress, then shows the menu with a demo world', async () => {
    const h = await createHarness({ progressSteps: [0, 0.3, 0.6, 0.9, 1] });
    expect(h.game.screen).toBe('menu');
    const init = h.renderer.last('init')!;
    // W-039: Auto by default; first run has no stored Auto result (probe); Pixel Ratio unset -> not explicit (D-025)
    expect(init.args[1]).toEqual({ quality: 'auto', pixelRatio: 1.5, pixelRatioExplicit: false, autoLevel: null });
    expect(h.game.loadingProgress).toBe(1);
    // demo: fixed seed, 3 zombies, relaxed, full autonomy, attached and orbiting
    expect(h.simModule.worlds[0].seed).toBe(DEMO_SEED);
    expect(h.simModule.worlds[0].members.length).toBe(3);
    expect(h.simModule.worlds[0].difficulty).toBe('relaxed');
    const demo = h.simModule.sims[0];
    expect(demo.dispatched).toContainEqual({ type: 'setSettings', settings: { autonomy: 'full' } });
    expect(h.renderer.attached).toBe(demo);
    expect(h.game.sim).toBeNull(); // the demo is not the player's game
    const before = demo.steps;
    const orbits = h.renderer.count('orbit');
    await h.frames(62); // ~1 s at 1×
    expect(demo.steps - before).toBeGreaterThanOrEqual(3);
    expect(demo.steps - before).toBeLessThanOrEqual(5);
    expect(h.renderer.count('orbit')).toBeGreaterThan(orbits);
    expect(h.audio.named('music').map((c) => c.args[0])).toContain('menu');
    // the demo is silent
    demo.events.push({ type: 'sfx', id: 'eat' }, { type: 'voice', agentId: 'a1', emotion: 'happy', durationMs: 500 });
    await h.frames(2);
    expect(h.audio.sfxIds()).not.toContain('eat');
    expect(h.audio.named('voice')).toEqual([]);
    expect(h.renderer.consumed.flat().length).toBeGreaterThanOrEqual(2); // but the renderer still sees fx
  });

  it('a renderer that cannot start (no WebGL) produces a fatal error screen, not a crash', async () => {
    const h = await createHarness({ setup: ({ renderer }) => (renderer.failInit = true) });
    expect(h.game.fatalError).toMatch(/WebGL/);
    expect(h.game.screen).toBe('loading');
    expect(h.saves.saveCalls).toEqual([]); // nothing to save yet
    expect(h.game.diagnostics()).toContain('WebGL unavailable');
  });

  it('renders at ~4 fps behind the loading screen (assets get the main thread), full rate after', async () => {
    let polls = 0;
    let whileLoading = 0;
    const h = await createHarness({
      setup: ({ renderer }) => {
        renderer.loadProgress = () => (++polls < 60 ? 0 : 1);
        const orig = renderer.frame.bind(renderer);
        renderer.frame = (a, dt) => {
          if (polls < 60) whileLoading++;
          orig(a, dt);
        };
      },
    });
    expect(h.game.screen).toBe('menu');
    expect(whileLoading).toBeGreaterThanOrEqual(2);
    expect(whileLoading).toBeLessThanOrEqual(8); // ~60 loading frames → ~4 renders
    const before = h.renderer.frameCount;
    await h.frames(30);
    expect(h.renderer.frameCount - before).toBe(30);
  });

  it('NaN load progress never counts as loaded; the 90 s timeout still reaches the menu', async () => {
    const h = await createHarness({
      setup: ({ renderer, env }) => {
        renderer.loadProgress = () => {
          env.advance(1000); // each poll burns a second of fake time
          return NaN;
        };
      },
    });
    expect(h.game.screen).toBe('menu');
    expect(h.game.diagnostics()).toContain('Asset loading timed out');
  });

  it('adversarial persisted settings are sanitised and applied (audio volumes, renderer quality)', async () => {
    const h = await createHarness({ settings: { quality: 'low', musicEnabled: true, volumes: { music: 9, sfx: NaN }, __proto__: { x: 1 }, uiScale: 'big', autosaveMinutes: -5 } });
    expect(h.game.settings.quality).toBe('low');
    expect(h.game.settings.volumes.music).toBe(1);
    expect(h.game.settings.volumes.sfx).toBe(DEFAULT_SETTINGS.volumes.sfx);
    expect(h.game.settings.uiScale).toBe(1);
    expect(h.game.settings.autosaveMinutes).toBe(0);
    expect(h.audio.named('setVolumes')[0].args[0]).toMatchObject({ music: 1 });
    expect(h.renderer.last('init')!.args[1]).toMatchObject({ quality: 'low' });
  });

  it('content load failure falls back to the GDD catalog; CAZ still works', async () => {
    const h = await createHarness();
    expect(h.game.content).not.toBeNull();
    expect(h.game.lotTemplates.map((l) => l.id)).toEqual(['starter', 'empty']);
    expect(h.game.cazCatalog.fromContent).toBe(true);
  });
});

describe('screens & CAZ', () => {
  it('beginNewGame → caz with a valid random household; newGame screen keeps its lot/difficulty', async () => {
    const h = await createHarness();
    h.game.goto('newGame');
    expect(h.game.screen).toBe('newGame');
    h.game.updateCaz({ lotTemplate: 'empty', difficulty: 'grim' });
    h.game.beginNewGame();
    expect(h.game.screen).toBe('caz');
    expect(h.game.caz).toMatchObject({ lotTemplate: 'empty', difficulty: 'grim' });
    expect(h.game.validateCaz()).toEqual([]);
    h.game.goto('menu');
    expect(h.game.screen).toBe('menu');
    expect(h.game.caz).toBeNull();
  });

  it('member add/remove/randomize/update with validation feedback', async () => {
    const h = await createHarness();
    h.game.beginNewGame();
    for (let i = 0; i < 6; i++) h.game.addCazMember();
    expect(h.game.caz!.members.length).toBe(4);
    const names = h.game.caz!.members.map((m) => m.firstName.toLowerCase());
    expect(new Set(names).size).toBe(4);
    expect(new Set(h.game.caz!.members.map((m) => m.lastName)).size).toBe(1);
    h.game.removeCazMember(0);
    expect(h.game.caz!.members.length).toBe(3);
    h.game.updateCazMember(0, { firstName: '' });
    expect(h.game.validateCaz().length).toBeGreaterThan(0);
    h.game.randomizeCazMember(0, 'name');
    expect(h.game.validateCaz()).toEqual([]);
    h.game.randomizeCazMember(1, 'bogus' as never);
    h.game.randomizeCazMember(99, 'all');
    expect(h.game.validateCaz()).toEqual([]);
  });

  it('startGame: seed from crypto, trimmed names, attach, focus the house, autosave immediately, then game', async () => {
    const h = await createHarness();
    h.game.beginNewGame();
    h.game.updateCazMember(0, { firstName: '  Edna  ' });
    h.game.updateCaz({ householdName: ' Graves ' });
    h.env.randoms.push(0x1234abcd);
    const p = h.game.startGame();
    const p2 = h.game.startGame(); // double click
    await h.until(() => h.game.screen === 'game');
    await Promise.all([p, p2]);
    const opts = h.simModule.worlds.at(-1)!;
    expect(h.simModule.worlds.length).toBe(2); // demo + exactly one game
    expect(opts.seed).toBe(0x1234abcd);
    expect(opts.householdName).toBe('Graves');
    expect(opts.members[0].firstName).toBe('Edna');
    const game = h.gameSim();
    expect(h.renderer.attached).toBe(game);
    expect(h.renderer.calls.some((c) => c.name === 'focus' && typeof c.args[0] === 'object' && (c.args[0] as { x: number }).x === 9)).toBe(true);
    expect(h.saves.saveCalls[0]).toMatchObject({ slotId: 'auto-1234abcd', opts: { autosave: true } });
    expect(h.game.selectedAgentId).toBe('a1');
    expect(h.game.caz).toBeNull();
    expect(h.game.lastSaveLabel).toBe('Saved just now');
    // The world already runs at the player's autonomy ('full'): no redundant setSettings (it would mark the new
    // world unsaved). A different setting is pushed — see hardening.misc.test.ts.
    expect(game.dispatched.some((c) => c.type === 'setSettings')).toBe(false);
  });

  it('startGame with an invalid household stays on CAZ with a toast', async () => {
    const h = await createHarness();
    h.game.beginNewGame();
    h.game.updateCazMember(0, { traits: ['cheerful'] });
    await h.game.startGame();
    expect(h.game.screen).toBe('caz');
    expect(h.game.toasts.map((t) => t.title)).toContain("Your household isn't ready");
  });

  it('startGame when world creation throws returns to CAZ (no half-built session)', async () => {
    const h = await createHarness();
    h.game.beginNewGame();
    h.simModule.failCreateWorld = true;
    const p = h.game.startGame();
    await h.frames(3);
    await p;
    expect(h.game.screen).toBe('caz');
    expect(h.game.sim).toBeNull();
    expect(h.game.toasts.map((t) => t.title)).toContain("Couldn't create the world");
  });

  it('createCazPreview is guarded and disposed when leaving CAZ', async () => {
    const h = await createHarness();
    h.game.beginNewGame();
    const stage = h.game.createCazPreview({} as HTMLCanvasElement);
    expect(h.renderer.count('preview.setAppearance')).toBe(1);
    h.game.goto('menu');
    expect(h.renderer.count('preview.dispose')).toBe(1);
    stage.dispose(); // idempotent after the controller disposed it
    stage.setAppearance(h.game.cazCatalog as never);
    expect(h.renderer.count('preview.dispose')).toBe(1);
    h.renderer.createPreview = () => {
      throw new Error('too many WebGL contexts');
    };
    expect(() => h.game.createCazPreview({} as HTMLCanvasElement).setYaw(1)).not.toThrow();
  });
});

describe('in game: loop, speed, modes', () => {
  it('fixed timestep: ~4 ticks per second at 1×, none while paused or behind a system dialog', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    let before = sim.steps;
    await h.frames(63);
    expect(sim.steps - before).toBeGreaterThanOrEqual(3);
    expect(sim.steps - before).toBeLessThanOrEqual(5);
    h.game.setSpeed(0);
    before = sim.steps;
    await h.frames(60);
    expect(sim.steps).toBe(before);
    h.game.setSpeed(3);
    h.game.openDialog('pause');
    expect(h.game.speed).toBe(0);
    await h.frames(30);
    expect(sim.steps).toBe(before);
    h.game.closeDialog();
    expect(h.game.speed).toBe(3);
    await h.frames(63);
    expect(sim.steps - before).toBeGreaterThanOrEqual(30); // 8 min/s = 32 ticks/s
  });

  it('ultra is clamped to 3 while anyone at home is awake, allowed when all sleep, dropped when someone wakes', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.setSpeed(4);
    expect(h.game.speed).toBe(3);
    expect(h.game.toasts.map((t) => t.title)).toContain('Ultra speed unavailable');
    for (const id of sim.state.household.memberIds) sim.state.agents[id].anim = 'sleep';
    h.game.setSpeed(4);
    expect(h.game.speed).toBe(4);
    sim.state.agents.a1.anim = 'idle';
    await h.frames(40); // slow tick runs every 500 ms
    expect(h.game.speed).toBe(3);
    sim.state.agents.a1.presence = 'atWork';
    h.game.setSpeed(4);
    expect(h.game.speed).toBe(4);
  });

  it('togglePause and hotkeys (Space toggles on release, digits set speed, ctrl+S quicksaves)', async () => {
    const h = await startedHarness();
    h.key('keydown', 'Digit2');
    expect(h.game.speed).toBe(2);
    const down = h.key('keydown', 'Space');
    expect(down.defaultPrevented).toBe(true);
    expect(h.game.speed).toBe(2); // toggles on release
    h.key('keyup', 'Space');
    expect(h.game.speed).toBe(0);
    h.game.togglePause();
    expect(h.game.speed).toBe(2);
    const saves = h.saves.saveCalls.length;
    const f5 = h.key('keydown', 'F5');
    expect(f5.defaultPrevented).toBe(true); // never reload the page
    await h.frames(2);
    expect(h.saves.saveCalls.length).toBe(saves + 1);
    expect(h.saves.saveCalls.at(-1)!.slotId).toBe('save-00c0ffee');
    // repeat events don't re-fire discrete actions
    h.key('keydown', 'KeyC', { repeat: true });
    expect(h.game.wallMode).toBe('cutaway');
    h.key('keydown', 'KeyC');
    expect(h.game.wallMode).toBe('down');
  });

  it('buy/build: entering pauses, leaving ends the build session and resumes', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.setSpeed(2);
    h.game.setMode('buy');
    expect(h.game.mode).toBe('buy');
    expect(h.game.speed).toBe(0);
    expect(h.renderer.last('setViewMode')!.args[0]).toBe('buy');
    await h.frames(35);
    expect(h.audio.named('music').at(-1)!.args[0]).toBe('build');
    h.game.setMode('build'); // buy → build keeps the session
    expect(sim.dispatched.filter((c) => c.type === 'endBuildSession').length).toBe(0);
    h.game.setMode('live');
    expect(sim.dispatched.filter((c) => c.type === 'endBuildSession').length).toBe(1);
    expect(h.game.speed).toBe(2);
  });

  it('applyBuild / sellObject only outside live mode; undo/redo dispatch in build mode', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    expect(h.game.applyBuild({ type: 'addWalls', edges: ['h:1:1'] })).toBe(false);
    h.game.setMode('build');
    expect(h.game.applyBuild({ type: 'addWalls', edges: ['h:1:1'] })).toBe(true);
    sim.undoable = true;
    expect(h.game.canUndo).toBe(true);
    h.key('keydown', 'KeyZ', { ctrlKey: true });
    expect(sim.dispatched.at(-1)).toEqual({ type: 'undo' });
    sim.redoable = true;
    h.key('keydown', 'KeyZ', { ctrlKey: true, shiftKey: true });
    expect(sim.dispatched.at(-1)).toEqual({ type: 'redo' });
    sim.dispatchImpl = () => ({ ok: false, reason: 'Not enough money' });
    expect(h.game.applyBuild({ type: 'addWalls', edges: ['h:2:1'] })).toBe(false);
    expect(h.game.toasts.map((t) => t.text)).toContain('Not enough money');
  });

  it('a build command changes the autosave signature even while paused (no lost edits)', async () => {
    const h = await startedHarness({ settings: { autosaveMinutes: 1 } });
    h.game.setMode('build');
    const writes = h.saves.saveCalls.length;
    h.game.applyBuild({ type: 'addWalls', edges: ['h:3:3'] });
    h.env.advance(61_000);
    await h.frames(2);
    expect(h.saves.saveCalls.length).toBe(writes + 1);
  });
});

describe('in game: interaction menu, selection, choices, phone', () => {
  it('canvas click on an object opens the sim menu at the cursor; choosing queues with merged params', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    sim.menuEntries = [
      {
        interactionId: 'home_cook',
        label: 'Cook…',
        group: null,
        icon: 'fridge',
        available: true,
        reason: null,
        cost: null,
        params: { a: 1 },
        children: [{ interactionId: 'home_cook', label: 'Stew', group: null, icon: 'fridge', available: true, reason: null, cost: 20, params: { recipe: 'stew' } }],
      },
    ];
    h.renderer.pickFn = () => ({ kind: 'object', objectId: 'o1', point: point() });
    h.pointer('pointerdown', 300, 200);
    h.pointer('pointerup', 300, 200);
    const menu = h.game.menu!;
    expect(menu).toMatchObject({ actorId: 'a1', target: { kind: 'object', id: 'o1' }, x: 300, y: 200 });
    expect(menu.title).toBe(sim.objectView('o1')!.name);
    h.game.chooseMenuEntry(menu.entries[0]); // has children: needs a child
    expect(h.game.menu).not.toBeNull();
    h.game.chooseMenuEntry(menu.entries[0], menu.entries[0].children![0]);
    expect(sim.dispatched.at(-1)).toEqual({ type: 'queue', actorId: 'a1', interactionId: 'home_cook', target: { kind: 'object', id: 'o1' }, params: { a: 1, recipe: 'stew' } });
    expect(h.game.menu).toBeNull();
  });

  it('tile menus always offer Go Here; another household member offers "Control"', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    sim.menuEntries = [];
    h.game.openMenuFor({ kind: 'tile', x: 3, z: 3 }, 10, 10);
    expect(h.game.menu!.entries[0]).toMatchObject({ interactionId: 'engine_goHere', label: 'Go Here' });
    h.game.closeMenu();
    h.game.openMenuFor({ kind: 'agent', id: 'a2' }, 10, 10);
    const control = h.game.menu!.entries.find((e) => e.interactionId === SELECT_ENTRY_ID)!;
    h.game.chooseMenuEntry(control);
    expect(h.game.selectedAgentId).toBe('a2');
    expect(sim.dispatched.some((c) => c.type === 'queue' && c.interactionId === SELECT_ENTRY_ID)).toBe(false);
  });

  it('unavailable entries toast their reason; empty menus toast instead of opening', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    sim.menuEntries = [{ interactionId: 'x', label: 'Watch TV', group: null, icon: 'tv', available: false, reason: 'The power is out', cost: null, params: {} }];
    h.game.openMenuFor({ kind: 'object', id: 'o1' }, 0, 0);
    h.game.chooseMenuEntry(h.game.menu!.entries[0]);
    expect(h.game.toasts.map((t) => t.text)).toContain('The power is out');
    sim.menuEntries = [];
    h.game.openMenuFor({ kind: 'object', id: 'o1' }, 0, 0);
    expect(h.game.menu).toBeNull();
  });

  it('the menu closes when its target vanishes or the actor leaves', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.openMenuFor({ kind: 'object', id: 'o1' }, 0, 0);
    delete sim.state.objects.o1;
    sim.events.push({ type: 'objectRemoved', objectId: 'o1' });
    await h.frames(1);
    expect(h.game.menu).toBeNull();
  });

  it('Tab cycles household members; crumbled members are skipped and selection self-heals', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.key('keydown', 'Tab');
    expect(h.game.selectedAgentId).toBe('a2');
    h.key('keydown', 'Tab', { shiftKey: true });
    expect(h.game.selectedAgentId).toBe('a1');
    sim.state.agents.a1.presence = 'crumbled';
    await h.frames(35);
    expect(h.game.selectedAgentId).toBe('a2');
    h.game.selectAgent('a99'); // a visitor is not selectable
    expect(h.game.selectedAgentId).toBe('a2');
  });

  it('choice events auto-pause (setting on); resolving the last choice resumes', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.setSpeed(2);
    sim.state.choices.push({ id: 'c1', tick: 0, title: 'Work drama', text: '?', agentId: 'a1', options: [], expiresTick: 9999, defaultOption: 0 });
    sim.events.push({ type: 'choice', choiceId: 'c1' });
    await h.frames(1);
    expect(h.game.speed).toBe(0);
    sim.dispatchImpl = (cmd) => {
      if (cmd.type === 'choice') sim.state.choices = [];
      return { ok: true };
    };
    h.game.resolveChoice('c1', 1);
    expect(sim.dispatched.at(-1)).toEqual({ type: 'choice', choiceId: 'c1', option: 1 });
    expect(h.game.speed).toBe(2);
  });

  it('choices do not pause when autoPauseOnEvents is off', async () => {
    const h = await startedHarness({ settings: { autoPauseOnEvents: false } });
    const sim = h.gameSim();
    sim.events.push({ type: 'choice', choiceId: 'c1' });
    await h.frames(1);
    expect(h.game.speed).toBe(1);
  });

  it('phone actions resolve HUD action names to phone_* interactions', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.phone('pizza');
    expect(sim.dispatched.at(-1)).toMatchObject({ type: 'queue', interactionId: 'phone_orderPizza', target: { kind: 'self' } });
    h.game.phone('phone_inviteOver', { townieId: 'a99', bad: NaN, ['__proto__' as string]: 1 } as never);
    expect(sim.dispatched.at(-1)).toMatchObject({ interactionId: 'phone_inviteOver', params: { townieId: 'a99' } });
    h.game.phone('orderPizza');
    expect(sim.dispatched.at(-1)).toMatchObject({ interactionId: 'phone_orderPizza' });
    const n = sim.dispatched.length;
    h.game.phone('summonDemon');
    expect(sim.dispatched.length).toBe(n);
    expect(h.game.toasts.map((t) => t.title)).toContain('No signal');
  });

  it('cancelQueueItem finds the owning zombie', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    sim.state.agents.a2.queue.push({ uid: 77, interactionId: 'x', target: { kind: 'self' }, params: {}, source: 'player', priority: 200, queuedTick: 0 });
    h.game.cancelQueueItem(77);
    expect(sim.dispatched.at(-1)).toEqual({ type: 'cancel', actorId: 'a2', uid: 77 });
  });

  it('Escape chain: menu → buy placement → pause menu; open dialogs are left to the UI', async () => {
    const h = await startedHarness();
    h.game.openMenuFor({ kind: 'object', id: 'o1' }, 0, 0);
    const first = h.key('keydown', 'Escape');
    expect(first.defaultPrevented).toBe(true);
    expect(h.game.menu).toBeNull();
    h.key('keydown', 'Escape');
    expect(h.game.dialog).toBe('pause');
    h.key('keydown', 'Digit3'); // blocked while a dialog is open
    expect(h.game.speed).toBe(0);
    const inDialog = h.key('keydown', 'Escape');
    expect(h.game.dialog).toBe('pause'); // the UI's modal closes itself (innermost layer)…
    expect(inDialog.defaultPrevented).toBe(false); // …and its fallback handler still sees the key
    h.game.closeDialog();
    expect(h.game.dialog).toBeNull();
    h.game.startPlacing('chair_creaky');
    expect(h.game.mode).toBe('buy');
    expect(h.game.buy.placingDefId).toBe('chair_creaky');
    h.key('keydown', 'Escape');
    expect(h.game.buy.placingDefId).toBeNull();
  });
});

describe('events → UI', () => {
  it('sim notifications become toasts; bubbles expire; skillUp makes one toast + one sound', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    sim.state.notifications.push({ id: 9, tick: 0, kind: 'warning', title: 'Final notice', text: 'Pay up', agentId: null, objectId: null, read: false });
    sim.events.push({ type: 'notify', id: 9 }, { type: 'bubble', agentId: 'a1', icon: 'brain', style: 'thought', durationMin: 2 });
    await h.frames(1);
    expect(h.game.toasts.map((t) => t.title)).toContain('Final notice');
    expect(h.game.bubbles.length).toBe(1);
    await h.frames(200);
    expect(h.game.bubbles.length).toBe(0);
  });

  it('gameOver → gameOver screen (speed 0, every dialog layer closed); menu from there restores the demo', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.openDialog('pause');
    h.game.openDialog('settings', { returnTo: 'pause' });
    sim.events.push({ type: 'gameOver', reason: 'Rest in Pieces' });
    await h.frames(1);
    expect(h.game.screen).toBe('gameOver');
    expect(h.game.dialog).toBeNull();
    expect(h.game.gameOverReason).toBe('Rest in Pieces');
    expect(h.game.speed).toBe(0);
    expect((await h.game.saveGame()).ok).toBe(false);
    h.game.goto('menu');
    expect(h.game.screen).toBe('menu');
    expect(h.game.sim).toBeNull();
    expect(h.renderer.attached).toBe(h.simModule.sims.at(-1));
  });
});

describe('saves & quitting', () => {
  it('quitToMenu autosaves first (idempotent), tears down and restores the demo', async () => {
    const h = await startedHarness();
    h.gameSim().state.tick += 40; // world changed since the start-of-game autosave
    const n = h.saves.saveCalls.length;
    const p = h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    await p;
    expect(h.saves.saveCalls.length).toBe(n + 1);
    expect(h.saves.saveCalls.at(-1)!.slotId).toBe('auto-00c0ffee');
    expect(h.audio.named('stopAllLoops').length).toBeGreaterThan(0);
    expect(h.game.sim).toBeNull();
  });

  it('quitting an unchanged world does not write again (idempotent per tick)', async () => {
    const h = await startedHarness();
    const n = h.saves.saveCalls.length;
    const p = h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    await p;
    expect(h.saves.saveCalls.length).toBe(n);
  });

  it('a failed save on quit keeps the game open; quitting again within 30 s leaves anyway', async () => {
    const h = await startedHarness();
    h.gameSim().state.tick += 40;
    h.saves.failSaves = 5;
    await h.game.quitToMenu();
    expect(h.game.screen).toBe('game');
    expect(h.game.toasts.map((t) => t.title)).toContain("Couldn't save before quitting");
    const p = h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    await p;
  });

  it('loadGame: success switches worlds; failure keeps the current game; warnings become toasts', async () => {
    const h = await startedHarness();
    const first = h.gameSim();
    const other = makeWorld({ seed: 0x777, householdName: 'Graves', members: ['Edna'] });
    h.saves.slots.set('save-graves', {
      world: other,
      info: { slotId: 'save-graves', name: 'Graves', savedAt: new Date(h.env.wallNow() - 600_000).toISOString(), createdAt: '', playMinutes: 30, meta: { householdName: 'Graves', memberNames: [], day: 1, timeLabel: '', funds: 0, lotValue: 0, thumbnail: null }, isAutosave: false, recoveredFromBackup: true, bytes: 1 },
    });
    const bad = await h.game.loadGame('missing');
    expect(bad.ok).toBe(false);
    expect(h.game.screen).toBe('game');
    expect(h.game.sim).toBe(first);
    const p = h.game.loadGame('save-graves');
    await h.until(() => h.game.sim !== first);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(h.game.sim!.state.household.name).toBe('Graves');
    expect(h.game.lastSaveLabel).toBe('Saved 10 min ago');
    expect(h.game.toasts.map((t) => t.title)).toContain('Save recovered');
    // manual save goes back to the slot it was loaded from
    await h.game.saveGame();
    expect(h.saves.saveCalls.at(-1)!.slotId).toBe('save-graves');
  });

  it('a save upgraded from an older version says so once, as information: never "Save recovered", never a warning', async () => {
    const h = await createHarness();
    const info = { slotId: 'old', name: 'x', savedAt: '', createdAt: '', playMinutes: 0, meta: {} as never, isAutosave: false, recoveredFromBackup: false, bytes: 1 };
    h.saves.slots.set('old', { world: makeWorld(), info, migrated: ['v1->v2 (household jobs)'] });
    const p = h.game.loadGame('old');
    await h.until(() => h.game.screen === 'game');
    expect((await p).ok).toBe(true);
    const updated = h.game.toasts.filter((t) => t.title === 'Save updated');
    expect(updated.length).toBe(1);
    expect(updated[0].kind).toBe('info');
    expect(updated[0].text).not.toMatch(/schema|v1|->/); // player words, not migration ids
    expect(h.game.toasts.filter((t) => t.kind === 'warning' || t.kind === 'bad')).toEqual([]);
    expect(h.game.toasts.map((t) => t.title)).not.toContain('Save recovered');
  });

  it('a current save loads with no "Save updated" notice (absent and empty `migrated` alike)', async () => {
    for (const migrated of [undefined, []] as const) {
      const h = await createHarness();
      const info = { slotId: 'cur', name: 'x', savedAt: '', createdAt: '', playMinutes: 0, meta: {} as never, isAutosave: false, recoveredFromBackup: false, bytes: 1 };
      h.saves.slots.set('cur', { world: makeWorld(), info, ...(migrated ? { migrated: [...migrated] } : {}) });
      const p = h.game.loadGame('cur');
      await h.until(() => h.game.screen === 'game');
      expect((await p).ok).toBe(true);
      expect(h.game.toasts.map((t) => t.title)).not.toContain('Save updated');
    }
  });

  it('a save the engine had to repair loads with one summarising toast', async () => {
    const h = await createHarness();
    h.saves.slots.set('fixme', { world: makeWorld(), info: { slotId: 'fixme', name: 'x', savedAt: '', createdAt: '', playMinutes: 0, meta: {} as never, isAutosave: false, recoveredFromBackup: false, bytes: 1 } });
    h.simModule.configure = (sim) => (sim.repairWarnings = ['agent a7 had NaN needs', 'object o9 was off-lot', 'dangling reservation']);
    const p = h.game.loadGame('fixme');
    await h.until(() => h.game.screen === 'game');
    expect((await p).ok).toBe(true);
    const repaired = h.game.toasts.filter((t) => t.title === 'Save repaired');
    expect(repaired.length).toBe(1);
    expect(repaired[0].text).toMatch(/^3 problems were found/);
  });

  it('a save that the sim refuses to open is reported as invalid, current state untouched', async () => {
    const h = await createHarness();
    h.saves.slots.set('x', { world: makeWorld(), info: { slotId: 'x', name: 'x', savedAt: '', createdAt: '', playMinutes: 0, meta: {} as never, isAutosave: false, recoveredFromBackup: false, bytes: 1 } });
    h.simModule.failCreateSim = true;
    const p = h.game.loadGame('x');
    await h.frames(3);
    const r = await p;
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
    expect(h.game.screen).toBe('menu');
  });

  it('continueLatest with no saves returns false and explains', async () => {
    const h = await createHarness();
    expect(await h.game.continueLatest()).toBe(false);
    expect(h.game.toasts.map((t) => t.title)).toContain('No saves yet');
  });

  it('visibility hidden pauses (setting), mutes, and autosaves best-effort; visible restores', async () => {
    const h = await startedHarness();
    h.gameSim().state.tick += 40;
    h.game.setSpeed(2);
    const n = h.saves.saveCalls.length;
    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(h.game.speed).toBe(0);
    expect(h.audio.named('setMuted').at(-1)!.args[0]).toBe(true);
    expect(h.saves.saveCalls.length).toBe(n + 1);
    h.doc.visibilityState = 'visible';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.game.speed).toBe(2);
    expect(h.audio.named('setMuted').at(-1)!.args[0]).toBe(false);
  });

  it('quitApp is a no-op toast in the browser and saves + quits in Electron', async () => {
    const h = await startedHarness();
    expect(h.game.canQuitApp).toBe(false);
    h.game.quitApp();
    expect(h.game.toasts.map((t) => t.title)).toContain('Close the tab to quit');
    let quit = 0;
    h.env.nativeBridge = { platform: 'win32', version: '1.0.0', quit: () => quit++ } as never;
    await h.frames(3);
    h.game.quitApp();
    await h.until(() => quit === 1, 50);
    expect(h.game.canQuitApp).toBe(true);
  });
});

describe('crash path', () => {
  it('an uncaught window error → fatalError + emergency save + sim stops', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    const e = new Event('error');
    Object.assign(e, { error: new Error('kaboom'), message: 'kaboom', filename: 'http://localhost/index.js' });
    h.win.dispatchEvent(e);
    await flush();
    expect(h.game.fatalError).toMatch(/kaboom/);
    expect(h.saves.saveCalls.some((s) => s.slotId === 'emergency')).toBe(true);
    const steps = sim.steps;
    await h.frames(60);
    expect(sim.steps).toBe(steps);
    expect(h.game.diagnostics()).toContain('kaboom');
    h.game.goto('menu'); // recover
    expect(h.game.fatalError).toBeNull();
    expect(h.game.screen).toBe('menu');
  });

  it('benign ResizeObserver noise is ignored', async () => {
    const h = await startedHarness();
    const e = new Event('error');
    Object.assign(e, { error: null, message: 'ResizeObserver loop limit exceeded' });
    h.win.dispatchEvent(e);
    expect(h.game.fatalError).toBeNull();
  });

  it('an unhandled promise rejection is fatal too', async () => {
    const h = await startedHarness();
    const e = new Event('unhandledrejection');
    Object.assign(e, { reason: new Error('async boom') });
    h.win.dispatchEvent(e);
    expect(h.game.fatalError).toMatch(/async boom/);
  });

  it('a renderer that keeps failing escalates to fatal after ~2 s; a single failure does not', async () => {
    const h = await startedHarness();
    h.renderer.failFrame = true;
    await h.frames(5);
    expect(h.game.fatalError).toBeNull();
    await h.frames(130);
    expect(h.game.fatalError).toMatch(/renderer stopped working/);
  });

  it('a sim.step that throws every frame escalates to fatal; occasional throws are contained', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    let n = 0;
    sim.stepImpl = () => {
      if (++n % 50 === 0) throw new Error('rare');
    };
    await h.frames(100);
    expect(h.game.fatalError).toBeNull();
    sim.stepImpl = () => {
      throw new Error('always');
    };
    h.game.setSpeed(3);
    await h.frames(60);
    expect(h.game.fatalError).toMatch(/simulation keeps failing/);
    expect(h.saves.saveCalls.some((s) => s.slotId === 'emergency')).toBe(true);
  });

  it('a throwing UI listener never breaks the controller', async () => {
    const h = await startedHarness();
    h.game.subscribe(() => {
      throw new Error('bad component');
    });
    h.game.setSpeed(2);
    expect(h.game.speed).toBe(2);
    expect(h.game.fatalError).toBeNull();
  });
});

describe('contract additions', () => {
  it('appVersion is the build version (package.json via PLATFORM define); version is a change counter', async () => {
    const h = await createHarness();
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as { version: string };
    expect(h.game.appVersion).toBe(pkg.version);
    expect(typeof h.game.version).toBe('number');
  });

  it('content is available from boot (before any simulation) for CAZ / catalog text', async () => {
    const h = await createHarness();
    expect(h.game.sim).toBeNull();
    expect(h.game.content?.traits.cheerful.name).toBe('Cheerful');
  });

  it('validateCazDetailed maps problems to member + field', async () => {
    const h = await createHarness();
    h.game.beginNewGame();
    expect(h.game.validateCazDetailed()).toEqual([]);
    h.game.updateCazMember(0, { traits: ['cheerful', 'grumpy', 'vain'] });
    expect(h.game.validateCazDetailed()).toEqual([{ memberIndex: 0, field: 'traits', message: expect.stringMatching(/can't be combined/) }]);
  });

  it('ultraAllowed mirrors the gate (and is false outside the game)', async () => {
    const h = await createHarness();
    expect(h.game.ultraAllowed).toBe(false);
    const g = await startedHarness();
    expect(g.game.ultraAllowed).toBe(false);
    for (const id of g.gameSim().state.household.memberIds) g.gameSim().state.agents[id].anim = 'sleep';
    expect(g.game.ultraAllowed).toBe(true);
  });

  it('rotateCamera steps the renderer in game only; Q/E use it', async () => {
    const h = await createHarness();
    h.game.rotateCamera(1);
    expect(h.renderer.count('rotateCamera')).toBe(0);
    const g = await startedHarness();
    g.game.rotateCamera(-1);
    expect(g.renderer.last('rotateCamera')!.args).toEqual([-1]);
    g.key('keydown', 'KeyE');
    expect(g.renderer.last('rotateCamera')!.args).toEqual([1]);
    g.game.rotateCamera(7 as never);
    expect(g.renderer.last('rotateCamera')!.args).toEqual([1]);
  });

  it('focusObject: placed objects by centre, held items follow the carrier, unknown ids ignored', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.focusObject('o1');
    expect(h.renderer.last('focus')!.args[0]).toEqual({ x: 5.5, z: 5.5 });
    sim.state.objects.o3 = { ...sim.state.objects.o1, id: 'o3', placement: { kind: 'held', agentId: 'a2' } };
    h.game.focusObject('o3');
    expect(h.renderer.last('focus')!.args[0]).toBe('a2');
    const n = h.renderer.count('focus');
    h.game.focusObject('nope');
    h.game.focusObject(42 as never);
    expect(h.renderer.count('focus')).toBe(n);
  });

  it('buyReward / renameHousehold / markNotificationsRead dispatch commands (validated, never throw)', async () => {
    const menu = await createHarness();
    expect(menu.game.buyReward('a1', 'wellPreserved')).toEqual({ ok: false, reason: 'No game in progress' });
    const h = await startedHarness({ economy: await adultEconomy() }); // typed names need an answered 13+ profile
    const sim = h.gameSim();
    expect(h.game.buyReward('a1', 'wellPreserved').ok).toBe(true);
    expect(sim.dispatched.at(-1)).toEqual({ type: 'buyReward', agentId: 'a1', rewardId: 'wellPreserved' });
    expect(h.game.buyReward('a1', '').ok).toBe(false);
    expect(h.game.renameHousehold('  The Graves  ').ok).toBe(true);
    expect(sim.dispatched.at(-1)).toEqual({ type: 'renameHousehold', name: 'The Graves' });
    const n = sim.dispatched.length;
    for (const bad of ['', '   ', 'x'.repeat(25), 'bad\u0000name', 7 as never]) expect(h.game.renameHousehold(bad).ok).toBe(false);
    expect(sim.dispatched.length).toBe(n);
    h.game.markNotificationsRead(); // nothing unread → no command
    expect(sim.dispatched.length).toBe(n);
    sim.state.notifications.push({ id: 1, tick: 0, kind: 'info', title: 't', text: 'x', agentId: null, objectId: null, read: false });
    h.game.markNotificationsRead();
    expect(sim.dispatched.at(-1)).toEqual({ type: 'markNotificationsRead' });
    sim.dispatchImpl = () => {
      throw new Error('engine bug');
    };
    expect(h.game.buyReward('a1', 'x')).toMatchObject({ ok: false, reason: 'engine bug' });
  });

  it('dialogOptions: returnTo reopens the parent on close; save/load mode; junk options dropped', async () => {
    const h = await startedHarness();
    h.game.openDialog('pause');
    h.game.openDialog('saveLoad', { returnTo: 'pause', mode: 'load' });
    expect(h.game.dialogOptions).toEqual({ returnTo: 'pause', mode: 'load' });
    expect(h.game.speed).toBe(0);
    h.game.closeDialog();
    expect(h.game.dialog).toBe('pause');
    expect(h.game.dialogOptions).toBeNull();
    h.game.closeDialog();
    expect(h.game.dialog).toBeNull();
    expect(h.game.speed).toBe(1);
    h.game.openDialog('settings', { returnTo: 'settings', mode: 'nuke' } as never);
    expect(h.game.dialogOptions).toBeNull();
    h.game.closeDialog();
    expect(h.game.dialog).toBeNull();
  });

  it('BuyState.hoverObjectId tracks the placed object under the cursor in buy mode', async () => {
    const h = await startedHarness();
    h.game.setMode('buy');
    h.renderer.pickFn = (_x, _y, o) => (o?.objects ? { kind: 'object', objectId: 'o1', point: point() } : { kind: 'none' });
    h.pointer('pointermove', 200, 200);
    await h.frames(1);
    expect(h.game.buy.hoverObjectId).toBe('o1');
    h.renderer.pickFn = () => ({ kind: 'none' });
    h.pointer('pointermove', 220, 200);
    await h.frames(1);
    expect(h.game.buy.hoverObjectId).toBeNull();
  });

  it('hotkeys ignore events a UI widget already handled, or that come from menus/dialogs', async () => {
    const h = await startedHarness();
    const handled = new Event('keydown', { cancelable: true });
    Object.assign(handled, { code: 'Digit3', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
    handled.preventDefault();
    h.win.dispatchEvent(handled);
    expect(h.game.speed).toBe(1);
    const inDialog = new EventTarget() as EventTarget & { closest: (s: string) => unknown };
    inDialog.closest = (sel: string) => (sel.includes('role="dialog"') ? {} : null);
    const e = new Event('keydown', { cancelable: true });
    Object.assign(e, { code: 'Digit3', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
    Object.defineProperty(e, 'target', { value: inDialog }); // focus is inside an open [role="dialog"]
    h.win.dispatchEvent(e);
    expect(h.game.speed).toBe(1);
    h.key('keydown', 'Digit3');
    expect(h.game.speed).toBe(3);
  });
});

describe('settings, hints, diagnostics', () => {
  it('updateSettings applies to audio/renderer/sim and persists a sanitised copy', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.updateSettings({ volumes: { ...DEFAULT_SETTINGS.volumes, music: 0.2 }, quality: 'medium', autonomy: 'limited' });
    // W-150: music is off until turned on — the slider value is kept, the engine gets 0
    expect(h.game.settings.volumes.music).toBe(0.2);
    expect(h.audio.named('setVolumes').at(-1)!.args[0]).toMatchObject({ music: 0, sfx: DEFAULT_SETTINGS.volumes.sfx });
    h.game.updateSettings({ musicEnabled: true });
    expect(h.audio.named('setVolumes').at(-1)!.args[0]).toMatchObject({ music: 0.2 });
    h.game.updateSettings({ musicEnabled: false });
    expect(h.audio.named('setVolumes').at(-1)!.args[0]).toMatchObject({ music: 0 });
    expect(h.renderer.last('setQuality')!.args[0]).toBe('medium');
    h.game.updateSettings({ pixelRatio: 2.5 });
    expect(h.renderer.last('setPixelRatio')!.args).toEqual([2.5]);
    h.game.updateSettings({ pixelRatio: 0 }); // auto → resolved before the call (fake devicePixelRatio 1.5)
    expect(h.renderer.last('setPixelRatio')!.args).toEqual([1.5]);
    expect(sim.dispatched).toContainEqual({ type: 'setSettings', settings: { autonomy: 'limited' } });
    await flush();
    expect(h.profile.data.get('settings')).toMatchObject({ quality: 'medium', autonomy: 'limited' });
    const before = h.profile.saves.length;
    h.game.updateSettings({ quality: 'medium' }); // no-op
    h.game.updateSettings({ quality: 'potato' as never }); // invalid
    await flush();
    expect(h.profile.saves.length).toBe(before);
    h.game.resetSettings();
    expect(h.game.settings).toEqual(DEFAULT_SETTINGS);
    expect(h.game.settings).not.toBe(DEFAULT_SETTINGS);
  });

  it('tutorial hints appear in game; "never show again" disables the tutorial and persists', async () => {
    const h = await startedHarness();
    await h.frames(40);
    expect(h.game.hint?.id).toBe('select');
    expect(h.game.hint?.anchor).toBe('household-portraits');
    h.game.dismissHint('select', true);
    expect(h.game.hint).toBeNull();
    expect(h.game.settings.tutorialEnabled).toBe(false);
    await flush();
    expect(h.profile.data.get('tutorial')).toMatchObject({ seen: ['select'] });
    expect(h.profile.data.get('settings')).toMatchObject({ tutorialEnabled: false });
  });

  it('corrupt tutorial progress is tolerated', async () => {
    const h = await startedHarness({ tutorial: { seen: 'everything' } });
    await h.frames(40);
    expect(h.game.hint?.id).toBe('select');
  });

  it('diagnostics is a copyable report of the live state', async () => {
    const h = await startedHarness();
    await h.frames(30);
    const d = h.game.diagnostics();
    const household = h.game.sim!.state.household.name;
    for (const needle of ['Afterlife Lease 1.0.0', 'vitest-fake-agent', 'Screen: game', 'tick:', `household: ${household}`, 'householdSize: 2', 'backend: memory', 'Settings: {']) expect(d).toContain(needle);
  });

  it('every KEYMAP action is handled somewhere (no dead bindings)', () => {
    const handled = new Set(['pause', 'speed1', 'speed2', 'speed3', 'speedUltra', 'modeLive', 'modeBuy', 'modeBuild', 'rotateCamLeft', 'rotateCamRight', 'panUp', 'panDown', 'panLeft', 'panRight', 'zoomIn', 'zoomOut', 'wallMode', 'perspective', 'rotateObject', 'sell', 'undo', 'redo', 'cycleZombie', 'focusSelected', 'help', 'quickSave', 'mute', 'store', 'feedback', 'menu']);
    // Documentation-only entries (focusHud = the HUD's F6) are owned elsewhere and never bound by the controller.
    expect(Object.keys(KEYMAP).filter((k) => !handled.has(k) && !DOC_ONLY_ACTIONS.has(k as never))).toEqual([]);
    for (const k of DOC_ONLY_ACTIONS) expect(handled.has(k), k).toBe(false);
  });

  it('subscribe notifies on discrete changes and version increments', async () => {
    const h = await startedHarness();
    const v = h.game.version;
    const n = h.notifications;
    h.game.setMode('buy');
    expect(h.notifications).toBeGreaterThan(n);
    expect(h.game.version).toBeGreaterThan(v);
  });

  it('dispose stops the loop and detaches DOM listeners', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    h.game.dispose();
    const steps = sim.steps;
    await h.frames(60);
    expect(sim.steps).toBe(steps);
    h.key('keydown', 'Digit3');
    expect(h.game.speed).not.toBe(3);
  });
});
