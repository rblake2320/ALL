/**
 * GameController contract conformance (src/game/contracts.ts).
 *
 * Instantiates the REAL controller (createGameController) over fakes and checks that every member of the
 * GameController interface exists with the documented kind and behaves (minimally) as documented there, in the
 * resolved contract decisions (docs/CONTRACTS.md #16/#17/#19/#22) and in the behaviour the UI modules rely on
 * (docs/contract-requests/game.md §2, ui-shell.md "Behaviour the shell relies on").
 *
 * `MEMBERS` is typed `Record<keyof GameController, Kind>` with `satisfies`: a member added to (or removed from) the
 * contract without updating this list fails the typecheck. The UI only ever sees `GameController`, so every test
 * below talks to the controller through that type.
 */
import { describe, expect, it } from 'vitest';
import type { GameController } from '../../../src/game/contracts';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { createGameController } from '../../../src/game/controller';
import { HINT_ANCHORS } from '../../../src/game/hints';
import { GAME_VERSION } from '../../../src/persistence/version';
import type { MenuEntry } from '../../../src/sim/contracts';
import { FakeAudio, FakeEnv, FakeProfile, FakeRenderer, FakeSaves, FakeSimModule, flush, point } from './fakes';
import { FakeCanvas, FakeDocument, FakeWindow, adultEconomy, createHarness, startedHarness, type Harness } from './controllerHarness';

type Kind = 'value' | 'method' | 'async';

/** Every GameController member: 'value' = readonly property, 'method' = sync method, 'async' = returns a Promise. */
const MEMBERS = {
  version: 'value',
  appVersion: 'value',
  content: 'value',
  lotTemplates: 'value',
  gameOverReason: 'value',
  economy: 'value',
  feedback: 'value',
  sessionLog: 'value',
  boot: 'async',
  dispose: 'method',
  subscribe: 'method',
  screen: 'value',
  loadingProgress: 'value',
  loadingLabel: 'value',
  fatalError: 'value',
  goto: 'method',
  beginNewGame: 'method',
  caz: 'value',
  updateCaz: 'method',
  updateCazMember: 'method',
  addCazMember: 'method',
  removeCazMember: 'method',
  randomizeCazMember: 'method',
  validateCaz: 'method',
  validateCazDetailed: 'method',
  startGame: 'async',
  createCazPreview: 'method',
  listSaves: 'async',
  saveGame: 'async',
  saveSoon: 'method',
  loadGame: 'async',
  continueLatest: 'async',
  deleteSave: 'async',
  exportSave: 'async',
  importSave: 'async',
  lastSaveLabel: 'value',
  lastSavedAt: 'value',
  lastSaveFailed: 'value',
  saving: 'value',
  quitToMenu: 'async',
  quitApp: 'method',
  canQuitApp: 'value',
  sim: 'value',
  renderer: 'value',
  audio: 'value',
  mode: 'value',
  setMode: 'method',
  speed: 'value',
  setSpeed: 'method',
  togglePause: 'method',
  ultraAllowed: 'value',
  rotateCamera: 'method',
  focusObject: 'method',
  frameObject: 'method',
  setAutoPurchases: 'method',
  storyTarget: 'value',
  questAction: 'method',
  questGo: 'method',
  job: 'method',
  pet: 'method',
  home: 'method',
  buyReward: 'method',
  renameHousehold: 'method',
  markNotificationsRead: 'method',
  selectedAgentId: 'value',
  selectAgent: 'method',
  cycleSelection: 'method',
  wallMode: 'value',
  setWallMode: 'method',
  cycleWallMode: 'method',
  perspective: 'value',
  setPerspective: 'method',
  cyclePerspective: 'method',
  menu: 'value',
  openMenuFor: 'method',
  closeMenu: 'method',
  chooseMenuEntry: 'method',
  cancelQueueItem: 'method',
  walkTo: 'method',
  phone: 'method',
  buy: 'value',
  setBuyCategory: 'method',
  startPlacing: 'method',
  pickUpObject: 'method',
  rotatePlacement: 'method',
  setPlacementTint: 'method',
  cancelPlacement: 'method',
  finishPlacing: 'method',
  setKeepPlacing: 'method',
  sellObject: 'method',
  buildTool: 'value',
  setBuildTool: 'method',
  applyBuild: 'method',
  undo: 'method',
  redo: 'method',
  canUndo: 'value',
  canRedo: 'value',
  dialog: 'value',
  dialogOptions: 'value',
  openDialog: 'method',
  closeDialog: 'method',
  toasts: 'value',
  dismissToast: 'method',
  bubbles: 'value',
  buildPreviewLabel: 'value',
  placementAnnouncement: 'value',
  resolveChoice: 'method',
  hint: 'value',
  dismissHint: 'method',
  settings: 'value',
  graphics: 'value',
  updateSettings: 'method',
  resetSettings: 'method',
  playUi: 'method',
  fps: 'value',
  diagnostics: 'method',
  hoverLabel: 'value',
  gridHover: 'value',
} as const satisfies Record<keyof GameController, Kind>;

/** A controller that has NOT been booted yet (createHarness boots immediately). */
function unbooted() {
  const env = new FakeEnv();
  const win = new FakeWindow();
  const doc = new FakeDocument();
  env.window = win as unknown as Window;
  env.document = doc as unknown as Document;
  const renderer = new FakeRenderer();
  const audio = new FakeAudio();
  const saves = new FakeSaves();
  const game: GameController = createGameController({ renderer, audio, saves, profile: new FakeProfile(), sim: new FakeSimModule(), env });
  const canvas = new FakeCanvas() as unknown as HTMLCanvasElement;
  const until = async (pred: () => boolean, max = 400): Promise<void> => {
    for (let i = 0; i < max && !pred(); i++) {
      env.frame(16);
      await flush(6);
    }
    if (!pred()) throw new Error(`not reached; screen=${game.screen}`);
  };
  return { env, renderer, audio, saves, game, canvas, until };
}

const g = (h: Harness): GameController => h.game;

describe('GameController contract: member inventory', () => {
  it('every contract member exists with the documented kind (getters are values, methods are functions)', () => {
    const { game } = unbooted();
    const missing: string[] = [];
    const wrongKind: string[] = [];
    for (const [name, kind] of Object.entries(MEMBERS) as [keyof GameController, Kind][]) {
      if (!(name in game)) {
        missing.push(name);
        continue;
      }
      const isFn = typeof (game as unknown as Record<string, unknown>)[name] === 'function';
      if (isFn !== (kind !== 'value')) wrongKind.push(`${name} (${kind})`);
    }
    expect(missing).toEqual([]);
    expect(wrongKind).toEqual([]);
    expect(Object.keys(MEMBERS).length).toBe(118); // world walkTo plus home services; exhaustive via satisfies
  });
});

describe('GameController contract: bootstrap, reactivity, teardown', () => {
  it('boot is idempotent: loading → menu; version/appVersion/content/lotTemplates are there before any simulation', async () => {
    const t = unbooted();
    const game = t.game;
    expect(game.screen).toBe('boot');
    expect([game.sim, game.caz, game.fatalError, game.gameOverReason, game.menu, game.dialog]).toEqual([null, null, null, null, null, null]);
    t.renderer.progress = 0.5; // assets still streaming
    const p1 = game.boot(t.canvas);
    const p2 = game.boot(t.canvas);
    expect(p1).toBeInstanceOf(Promise);
    expect(game.screen).toBe('loading');
    expect(game.loadingProgress).toBeGreaterThanOrEqual(0);
    expect(game.loadingProgress).toBeLessThanOrEqual(1);
    expect(game.loadingLabel.length).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) {
      t.env.frame(16);
      await flush(6);
    }
    expect(game.screen).toBe('loading'); // waits for assets
    expect(game.loadingProgress).toBeLessThan(1);
    expect((t.canvas as unknown as FakeCanvas).listenerCount).toBeGreaterThan(0); // input handlers on the canvas
    t.renderer.progress = 1;
    await t.until(() => game.screen === 'menu');
    await Promise.all([p1, p2]);
    expect(t.renderer.count('init')).toBe(1); // one bootstrap, however often boot() is called
    expect(game.loadingProgress).toBe(1);
    expect(typeof game.version).toBe('number'); // a change counter, NOT the app version
    expect(game.appVersion).toBe(GAME_VERSION);
    expect(game.content && Object.keys(game.content.traits).length).toBeGreaterThan(0);
    expect(game.lotTemplates.map((l) => l.id).sort()).toEqual(['empty', 'starter']);
    for (const l of game.lotTemplates) expect(Number.isFinite(l.startingFunds) && l.name.length > 0).toBe(true);
    expect(game.sim).toBeNull(); // the menu diorama is the controller's own demo world
    expect(game.renderer).toBe(t.renderer);
    expect(game.audio).toBe(t.audio);
    await game.boot(t.canvas); // a third call after boot finished is still a no-op
    expect(t.renderer.count('init')).toBe(1);
  });

  it('subscribe: discrete changes notify synchronously, version counts flushes, unsubscribe is idempotent, a throwing listener is contained', async () => {
    const h = await createHarness();
    const game = g(h);
    let a = 0;
    let b = 0;
    const offA = game.subscribe(() => a++);
    game.subscribe(() => {
      throw new Error('bad component');
    });
    const offB = game.subscribe(() => b++);
    const v0 = game.version;
    game.goto('newGame');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(game.version).toBeGreaterThan(v0);
    offA();
    offA();
    const a1 = a;
    const b1 = b;
    game.goto('menu');
    expect(a).toBe(a1);
    expect(b).toBeGreaterThan(b1);
    // Continuous changes (the menu diorama ticking) are throttled to ~12 notifications per second.
    const b2 = b;
    await h.frames(60); // ≈ 0.96 s
    expect(b - b2).toBeGreaterThan(0);
    expect(b - b2).toBeLessThanOrEqual(13);
    offB();
    expect(game.fatalError).toBeNull();
  });

  it('dispose tears down DOM listeners, the frame loop and the renderer; it is idempotent', async () => {
    const h = await startedHarness();
    const game = g(h);
    let rendererDisposed = 0;
    h.renderer.dispose = () => void rendererDisposed++;
    const sim = h.gameSim();
    const stops = h.audio.named('stopAllLoops').length;
    game.dispose();
    game.dispose();
    expect(rendererDisposed).toBe(1);
    expect(h.audio.named('stopAllLoops').length).toBe(stops + 1); // loops silenced
    expect([h.win.listenerCount, h.doc.listenerCount, h.canvas.listenerCount]).toEqual([0, 0, 0]);
    const steps = sim.steps;
    await h.frames(30);
    expect(sim.steps).toBe(steps);
  });
});

describe('GameController contract: screens and Create-a-Zombie', () => {
  it('screen flow: newGame creates CAZ, caz keeps lot/difficulty, menu clears it; controller-owned screens are refused', async () => {
    const h = await createHarness();
    const game = g(h);
    for (const s of ['game', 'loading', 'boot', 'gameOver', 'nonsense'] as const) {
      game.goto(s as never);
      expect(game.screen).toBe('menu');
    }
    game.goto('newGame');
    expect(game.screen).toBe('newGame');
    expect(game.caz).not.toBeNull(); // updateCaz works on the new-game screen
    game.updateCaz({ lotTemplate: 'empty', difficulty: 'grim' });
    game.goto('caz');
    expect(game.screen).toBe('caz');
    expect([game.caz!.lotTemplate, game.caz!.difficulty]).toEqual(['empty', 'grim']);
    game.goto('newGame');
    game.beginNewGame(); // from 'newGame' keeps the choices made there
    expect(game.screen).toBe('caz');
    expect([game.caz!.lotTemplate, game.caz!.difficulty]).toEqual(['empty', 'grim']);
    game.goto('menu');
    expect(game.screen).toBe('menu');
    expect(game.caz).toBeNull();
    game.beginNewGame(); // from the menu: a fresh, valid random household
    expect(game.screen).toBe('caz');
    expect(game.caz!.members.length).toBeGreaterThanOrEqual(1);
    expect(game.validateCaz()).toEqual([]);
  });

  it('CAZ edits are validated; add/remove respect 1–4 members; randomize keeps the household valid', async () => {
    const h = await createHarness();
    const game = g(h);
    game.beginNewGame();
    game.updateCaz({ householdName: 'Graves' });
    expect(game.caz!.householdName).toBe('Graves');
    game.updateCazMember(0, { firstName: 'Mortimer' });
    expect(game.caz!.members[0].firstName).toBe('Mortimer');
    for (let i = 0; i < 6; i++) game.addCazMember();
    expect(game.caz!.members.length).toBe(4);
    for (let i = 0; i < 6; i++) game.removeCazMember(game.caz!.members.length - 1);
    expect(game.caz!.members.length).toBe(1);
    const seed = game.caz!.members[0].voiceSeed;
    game.randomizeCazMember(0, 'name'); // re-rolling a part keeps the CAZ voice (contract #17)
    expect(game.caz!.members[0].voiceSeed).toBe(seed);
    game.randomizeCazMember(0);
    expect(game.validateCaz()).toEqual([]);
    game.updateCazMember(0, { firstName: '' });
    const errors = game.validateCaz();
    const detailed = game.validateCazDetailed();
    expect(errors.length).toBeGreaterThan(0);
    expect(detailed.map((d) => d.message)).toEqual(errors); // same validation, mapped to member + field
    expect(detailed).toContainEqual({ memberIndex: 0, field: 'firstName', message: expect.any(String) });
    const union = ['household', 'householdName', 'firstName', 'lastName', 'traits', 'aspiration', 'appearance'];
    for (const d of detailed) expect(union).toContain(d.field);
  });

  it('createCazPreview returns a guarded PreviewStage that is disposed when CAZ is left', async () => {
    const h = await createHarness();
    const game = g(h);
    game.beginNewGame();
    const stage = game.createCazPreview(new FakeCanvas() as unknown as HTMLCanvasElement);
    for (const m of ['setAppearance', 'setLimbs', 'setAnim', 'setExpression', 'setYaw', 'resize', 'dispose'] as const) expect(typeof stage[m]).toBe('function');
    expect(h.renderer.previewsCreated).toBe(1);
    expect(h.renderer.last('preview.setAppearance')!.args[0]).toEqual(game.caz!.members[0].appearance); // shows the active zombie
    game.goto('menu');
    expect(h.renderer.calls.filter((c) => c.name === 'preview.dispose').length).toBe(1);
    stage.dispose(); // already disposed: a no-op
    stage.setYaw(1);
    expect(h.renderer.calls.filter((c) => c.name === 'preview.dispose').length).toBe(1);
  });

  it('startGame: an invalid household stays on CAZ (no throw); a valid one enters the game and autosaves at once', async () => {
    const h = await createHarness();
    const game = g(h);
    game.beginNewGame();
    game.updateCazMember(0, { firstName: '' });
    await expect(game.startGame()).resolves.toBeUndefined();
    expect(game.screen).toBe('caz');
    expect(game.sim).toBeNull();
    game.updateCazMember(0, { firstName: 'Edna' });
    const p = game.startGame();
    await h.until(() => game.screen === 'game');
    await p;
    expect(game.sim?.state.household.memberIds.length).toBe(1);
    expect(game.caz).toBeNull();
    expect(h.saves.saveCalls[0]).toMatchObject({ slotId: expect.stringMatching(/^auto-[0-9a-f]{8}$/), opts: { autosave: true } });
    expect(game.lastSaveLabel).toBe('Saved just now'); // a complete phrase
    expect(typeof game.lastSavedAt).toBe('number');
    expect(game.lastSaveFailed).toBe(false);
    expect(game.saving).toBe(false);
    expect(game.gameOverReason).toBeNull();
  });
});

describe('GameController contract: saves and quitting', () => {
  it('saveGame / listSaves / saving / lastSaveFailed / deleteSave / exportSave / importSave', async () => {
    const h = await startedHarness();
    const game = g(h);
    expect((await game.listSaves()).map((s) => s.slotId)).toEqual([expect.stringMatching(/^auto-/)]);
    const release = h.saves.hold();
    const quick = game.saveGame(); // default = the world's manual slot (quick-save)
    expect(game.saving).toBe(true);
    release();
    const r = await quick;
    expect(r.ok && r.info.slotId).toMatch(/^save-[0-9a-f]{8}$/);
    expect(game.saving).toBe(false);
    const fresh = await game.saveGame('My-Castle', 'My Castle'); // a UI-minted fresh id ("New save")
    expect(fresh.ok && fresh.info.slotId).toBe('my-castle');
    expect(game.lastSavedAt).toBe(h.env.wallNow()); // epoch ms of the last good save of this world
    expect(await game.saveGame('auto-00c0ffee')).toMatchObject({ ok: false, code: 'invalid' }); // autosaves are not overwritable
    for (const bad of ['bad slot!', 'con', 'x'.repeat(41)]) expect(await game.saveGame(bad)).toMatchObject({ ok: false, code: 'invalid' });
    h.saves.failSaves = 1;
    expect((await game.saveGame()).ok).toBe(false);
    expect([game.lastSaveFailed, game.lastSaveLabel]).toEqual([true, 'Save failed']);
    expect((await game.saveGame()).ok).toBe(true);
    expect(game.lastSaveFailed).toBe(false);
    const downloads = h.env.downloads.length;
    await game.exportSave('my-castle');
    expect(h.env.downloads.length).toBe(downloads + 1);
    await game.deleteSave('my-castle');
    expect((await game.listSaves()).some((s) => s.slotId === 'my-castle')).toBe(false);
    const file = new File([JSON.stringify(game.sim!.state)], 'castle.alsave');
    const imported = await game.importSave(file);
    expect(imported.ok).toBe(true);
    expect(game.screen).toBe('game'); // importing does not switch worlds by itself
  });

  it('loadGame / continueLatest switch to the game screen themselves; quitToMenu autosaves first', async () => {
    const h = await startedHarness();
    const game = g(h);
    const saved = await game.saveGame(undefined, 'Before');
    expect(saved.ok).toBe(true);
    const first = game.sim;
    const res = await game.loadGame(saved.ok ? saved.info.slotId : '');
    expect(res.ok).toBe(true);
    expect(game.screen).toBe('game');
    expect(game.sim).not.toBe(first);
    expect(game.lastSavedAt).not.toBeNull(); // the save it was loaded from
    expect(await game.loadGame('../etc/passwd')).toMatchObject({ ok: false });
    expect(game.screen).toBe('game');
    const calls = h.saves.saveCalls.length;
    await game.quitToMenu();
    expect(game.screen).toBe('menu');
    expect(game.sim).toBeNull();
    expect(h.saves.saveCalls.slice(calls).map((c) => c.slotId)).toEqual([expect.stringMatching(/^auto-/)]);
    expect([game.lastSaveLabel, game.lastSavedAt]).toEqual([null, null]); // no world, no label
    expect(await game.continueLatest()).toBe(true);
    expect(game.screen).toBe('game');
    const none = await createHarness();
    expect(await none.game.continueLatest()).toBe(false);
    expect(none.game.screen).toBe('menu');
  });

  it('quit safety: a failed save keeps the game open (toast); a second quitToMenu within 30 s leaves anyway', async () => {
    const h = await startedHarness();
    const game = g(h);
    h.gameSim().state.tick += 10; // unsaved progress
    h.saves.failSaves = 1;
    await game.quitToMenu();
    expect(game.screen).toBe('game');
    expect(game.toasts.map((t) => t.title)).toContain("Couldn't save before quitting");
    await game.quitToMenu();
    expect(game.screen).toBe('menu');
  });

  it('quitApp / canQuitApp: a toast in the browser; save + native quit on the desktop', async () => {
    const h = await startedHarness();
    const game = g(h);
    expect(game.canQuitApp).toBe(false);
    game.quitApp();
    expect(game.toasts.map((t) => t.title)).toContain('Close the tab to quit');
    let quits = 0;
    h.env.nativeBridge = { platform: 'win32', version: '1.0.0', quit: () => void quits++ } as never;
    expect(game.canQuitApp).toBe(true);
    game.quitApp();
    game.quitApp(); // double click: one quit
    await h.until(() => quits > 0, 50);
    await h.frames(5);
    expect(quits).toBe(1);
  });
});

describe('GameController contract: in game', () => {
  it('sim / mode / speed / togglePause / ultraAllowed', async () => {
    const h = await startedHarness();
    const game = g(h);
    const sim = h.gameSim();
    expect(game.sim).toBe(sim);
    expect([game.mode, game.speed]).toEqual(['live', 1]);
    game.setMode('buy'); // buy/build pause the world
    expect([game.mode, game.speed]).toEqual(['buy', 0]);
    game.setMode('nonsense' as never);
    expect(game.mode).toBe('buy');
    game.setMode('live'); // leaving ends the build session and resumes
    expect([game.mode, game.speed]).toEqual(['live', 1]);
    expect(sim.dispatched).toContainEqual({ type: 'endBuildSession' });
    game.setSpeed(2);
    expect(game.speed).toBe(2);
    game.togglePause();
    expect(game.speed).toBe(0);
    game.togglePause();
    expect(game.speed).toBe(2);
    expect(game.ultraAllowed).toBe(false);
    game.setSpeed(4); // clamped to 3 (with a toast) while someone at home is awake
    expect(game.speed).toBe(3);
    for (const id of sim.state.household.memberIds) sim.state.agents[id].anim = 'sleep';
    expect(game.ultraAllowed).toBe(true);
    game.setSpeed(4);
    expect(game.speed).toBe(4);
    sim.state.agents.a1.anim = 'idle'; // someone wakes up → back to 3 automatically
    await h.frames(1);
    expect(game.speed).toBe(3);
    sim.state.agents.a1.presence = 'atWork'; // away at work counts as ok
    expect(game.ultraAllowed).toBe(true);
  });

  it('rotateCamera / focusObject / command wrappers (buyReward, renameHousehold, markNotificationsRead)', async () => {
    const h = await startedHarness({ economy: await adultEconomy() }); // typed names need an answered 13+ profile
    const game = g(h);
    const sim = h.gameSim();
    game.rotateCamera(1);
    expect(h.renderer.last('rotateCamera')!.args).toEqual([1]);
    game.focusObject('o1');
    expect(h.renderer.last('focus')!.args[0]).toEqual({ x: 5.5, z: 5.5 });
    expect(game.buyReward('a1', 'wellPreserved')).toEqual({ ok: true });
    expect(sim.dispatched.at(-1)).toEqual({ type: 'buyReward', agentId: 'a1', rewardId: 'wellPreserved' });
    expect(game.renameHousehold('  The Graves ')).toEqual({ ok: true });
    expect(sim.dispatched.at(-1)).toEqual({ type: 'renameHousehold', name: 'The Graves' });
    expect(game.renameHousehold('').ok).toBe(false);
    const n = sim.dispatched.length;
    game.markNotificationsRead(); // nothing unread → no command
    expect(sim.dispatched.length).toBe(n);
    sim.state.notifications.push({ id: 9, tick: 0, kind: 'info', title: 't', text: 'x', agentId: null, objectId: null, read: false });
    game.markNotificationsRead();
    expect(sim.dispatched.at(-1)).toEqual({ type: 'markNotificationsRead' });
  });

  it('selection and wall mode', async () => {
    const h = await startedHarness();
    const game = g(h);
    expect(game.selectedAgentId).toBe('a1');
    game.selectAgent('a2', true);
    expect(game.selectedAgentId).toBe('a2');
    expect(h.renderer.last('setSelection')!.args).toEqual(['a2']);
    expect(h.renderer.last('focus')!.args[0]).toBe('a2');
    game.selectAgent('a99'); // a visitor is not selectable
    expect(game.selectedAgentId).toBe('a2');
    game.cycleSelection(1);
    expect(game.selectedAgentId).toBe('a1');
    game.cycleSelection(-1);
    expect(game.selectedAgentId).toBe('a2');
    game.selectAgent(null);
    expect(game.selectedAgentId).toBeNull();
    expect(game.wallMode).toBe('cutaway');
    game.setWallMode('up');
    expect(game.wallMode).toBe('up');
    expect(h.renderer.last('setWallMode')!.args).toEqual(['up']);
    game.cycleWallMode();
    expect(game.wallMode).toBe('cutaway');
    game.setWallMode('sideways' as never);
    expect(game.wallMode).toBe('cutaway');
  });

  it('interaction menu: open / choose (queues) / close; tile menus offer Go Here; other members offer "Control"', async () => {
    const h = await startedHarness();
    const game = g(h);
    const sim = h.gameSim();
    game.openMenuFor({ kind: 'object', id: 'o1' }, 100, 120);
    const menu = game.menu!;
    expect(menu).toMatchObject({ actorId: 'a1', target: { kind: 'object', id: 'o1' }, x: 100, y: 120, title: expect.any(String) });
    expect(menu.entries.map((e) => e.interactionId)).toEqual(['home_fridge_snack']);
    game.chooseMenuEntry(menu.entries[0]);
    expect(sim.dispatched.at(-1)).toEqual({ type: 'queue', actorId: 'a1', interactionId: 'home_fridge_snack', target: { kind: 'object', id: 'o1' }, params: {} });
    expect(game.menu).toBeNull();
    sim.menuEntries = [];
    game.openMenuFor({ kind: 'tile', x: 3, z: 4 }, 10, 10);
    expect(game.menu!.entries.map((e) => e.interactionId)).toEqual(['engine_goHere']);
    game.closeMenu();
    expect(game.menu).toBeNull();
    game.openMenuFor({ kind: 'agent', id: 'a2' }, 10, 10);
    const select = game.menu!.entries[0];
    expect(select.interactionId).toBe('__game_select');
    game.chooseMenuEntry(select);
    expect(game.selectedAgentId).toBe('a2');
    expect(game.menu).toBeNull();
    const forged: MenuEntry = { interactionId: 'home_fridge_snack', label: 'x', group: null, icon: 'fridge', available: true, reason: null, cost: null, params: {} };
    const n = sim.dispatched.length;
    game.chooseMenuEntry(forged); // no open menu: refused
    expect(sim.dispatched.length).toBe(n);
    // Entries with children need the child; params merge (entry, then child). Menu positions are viewport px (clamped).
    const child: MenuEntry = { interactionId: 'phone_findJob', label: 'Necro-Tech', group: null, icon: 'phone', available: true, reason: null, cost: null, params: { careerId: 'necroTech' } };
    sim.menuEntries = [{ interactionId: 'phone_findJob', label: 'Find a Job', group: 'Phone', icon: 'phone', available: true, reason: null, cost: null, params: { via: 'menu' }, children: [child] }];
    game.selectAgent('a1');
    game.openMenuFor({ kind: 'self' }, 5000, -50);
    expect([game.menu!.x, game.menu!.y]).toEqual([1280, 0]);
    game.chooseMenuEntry(game.menu!.entries[0]); // no child yet: the UI shows the child list
    expect(sim.dispatched.length).toBe(n);
    game.chooseMenuEntry(game.menu!.entries[0], child);
    expect(sim.dispatched.at(-1)).toEqual({ type: 'queue', actorId: 'a1', interactionId: 'phone_findJob', target: { kind: 'self' }, params: { via: 'menu', careerId: 'necroTech' } });
  });

  it('walkTo (W-025 S3): plans, dispatches Go Here with the region, and always returns a WorldRouteResult (refusals toast)', async () => {
    const h = await startedHarness();
    const game = g(h);
    const sim = h.gameSim() as ReturnType<typeof h.gameSim> & { worldRoute?: unknown };
    const target = { regionId: 'graveyard:old_graveyard', x: 14, z: 20 };
    // a sim without the route query (or a foreign actor): one noPath, a toast, nothing dispatched
    const n0 = sim.dispatched.length;
    expect(game.walkTo!('a1', target)).toEqual({ ok: false, target, reason: 'noPath' });
    expect(game.walkTo!('nobody', target)).toEqual({ ok: false, target, reason: 'noPath' });
    expect(sim.dispatched.length).toBe(n0);
    expect(game.toasts.some((t) => t.text === "Can't get there")).toBe(true);
    // refused by the planner: the reason comes back as is
    sim.worldRoute = () => ({ ok: false, target, reason: 'locked' });
    expect(game.walkTo!('a1', target)).toEqual({ ok: false, target, reason: 'locked' });
    expect(game.toasts.some((t) => t.text === "It's closed")).toBe(true);
    expect(sim.dispatched.length).toBe(n0);
    // a route: Go Here is queued with the region-local tile and the region id
    const route = { ok: true, target, portals: ['crosswalk:mildew_n2', 'gate:old_graveyard'], lengthTiles: 80, etaGameMin: 61.5 };
    sim.worldRoute = () => route;
    expect(game.walkTo!('a1', target)).toEqual(route);
    expect(sim.dispatched.at(-1)).toEqual({ type: 'queue', actorId: 'a1', interactionId: 'engine_goHere', target: { kind: 'tile', x: 14, z: 20 }, params: { regionId: target.regionId } });
  });

  it('cancelQueueItem cancels on the owning zombie; phone() resolves HUD vocabulary to phone_* interactions', async () => {
    const h = await startedHarness();
    const game = g(h);
    const sim = h.gameSim();
    sim.state.agents.a2.queue = [{ uid: 77, interactionId: 'home_fridge_snack', target: { kind: 'object', id: 'o1' }, params: {}, source: 'player', priority: 200, queuedTick: 0 }];
    game.cancelQueueItem(77);
    expect(sim.dispatched.at(-1)).toEqual({ type: 'cancel', actorId: 'a2', uid: 77 });
    game.phone('pizza');
    expect(sim.dispatched.at(-1)).toEqual({ type: 'queue', actorId: 'a1', interactionId: 'phone_orderPizza', target: { kind: 'self' }, params: {} });
    game.phone('findJob', { careerId: 'necroTech', __proto__: 'x' } as never);
    expect(sim.dispatched.at(-1)).toMatchObject({ interactionId: 'phone_findJob', params: { careerId: 'necroTech' } });
    const n = sim.dispatched.length;
    game.phone('teleport');
    expect(sim.dispatched.length).toBe(n);
  });
});

describe('GameController contract: buy and build', () => {
  it('BuyState + placement / pick-up / sell (refused in live mode); buildPreviewLabel / gridHover follow the cursor', async () => {
    const h = await startedHarness();
    const game = g(h);
    const sim = h.gameSim();
    expect(game.buy).toEqual({ placingDefId: null, movingObjectId: null, rot: 0, tint: null, category: 'seating', hoverObjectId: null, keepPlacing: false, lastDefId: null });
    game.setBuyCategory('kitchen');
    expect(game.buy.category).toBe('kitchen');
    game.startPlacing('chair_creaky');
    expect([game.mode, game.buy.placingDefId]).toEqual(['buy', 'chair_creaky']);
    game.rotatePlacement(1);
    expect(game.buy.rot).toBe(1);
    game.setPlacementTint('#112233');
    expect(game.buy.tint).toBe('#112233');
    h.renderer.gridResult = { x: 6, z: 6, fx: 6.5, fz: 6.5, edge: null, edgeSide: 0 };
    h.pointer('pointermove', 300, 300);
    await h.frames(1);
    expect(typeof game.buildPreviewLabel).toBe('string');
    expect(game.gridHover).toEqual({ x: 6, z: 6, edge: null });
    game.cancelPlacement();
    expect(game.buy.placingDefId).toBeNull();
    expect(game.buildPreviewLabel).toBeNull();
    game.pickUpObject('o1');
    expect(game.buy.movingObjectId).toBe('o1');
    expect(h.renderer.hidden).toBe('o1'); // the picked-up original is hidden until placed / cancelled
    game.cancelPlacement();
    expect(game.buy.movingObjectId).toBeNull();
    expect(h.renderer.hidden).toBeNull();
    game.sellObject('o1');
    expect(sim.dispatched.at(-1)).toEqual({ type: 'build', cmd: { type: 'sell', objectId: 'o1' } });
    game.setMode('live');
    const n = sim.dispatched.length;
    game.sellObject('o1'); // refused in live mode
    expect(sim.dispatched.length).toBe(n);
  });

  it('buildTool / setBuildTool / applyBuild / undo / redo / canUndo / canRedo', async () => {
    const h = await startedHarness();
    const game = g(h);
    const sim = h.gameSim();
    expect(game.buildTool).toEqual({ kind: 'select' });
    expect(game.applyBuild({ type: 'addWalls', edges: ['h:3:3'], style: 'wall_plaster_bone' })).toBe(false); // live mode
    game.setBuildTool({ kind: 'wall', style: 'wall_plaster_bone' });
    expect(game.mode).toBe('build');
    expect(game.buildTool).toEqual({ kind: 'wall', style: 'wall_plaster_bone' });
    game.setBuildTool({ kind: 'laser' } as never);
    expect(game.buildTool.kind).toBe('wall');
    expect(game.applyBuild({ type: 'addWalls', edges: ['h:3:3'], style: 'wall_plaster_bone' })).toBe(true);
    expect(sim.dispatched.at(-1)).toEqual({ type: 'build', cmd: { type: 'addWalls', edges: ['h:3:3'], style: 'wall_plaster_bone' } });
    expect([game.canUndo, game.canRedo]).toEqual([false, false]);
    sim.undoable = true;
    sim.redoable = true;
    expect([game.canUndo, game.canRedo]).toEqual([true, true]);
    game.undo();
    expect(sim.dispatched.at(-1)).toEqual({ type: 'undo' });
    game.redo();
    expect(sim.dispatched.at(-1)).toEqual({ type: 'redo' });
    game.setMode('live');
    expect([game.canUndo, game.canRedo]).toEqual([false, false]); // history belongs to the build session
  });
});

describe('GameController contract: dialogs, toasts, bubbles, choices, hints', () => {
  it('system dialogs pause (HUD dialogs do not); returnTo / save-load mode; closeDialog returns to the parent', async () => {
    const h = await startedHarness();
    const game = g(h);
    expect([game.dialog, game.dialogOptions]).toEqual([null, null]);
    game.openDialog('phone');
    expect([game.dialog, game.speed]).toEqual(['phone', 1]);
    game.openDialog('pause');
    expect([game.dialog, game.speed]).toEqual(['pause', 0]);
    game.openDialog('saveLoad', { returnTo: 'pause', mode: 'save' });
    expect(game.dialogOptions).toEqual({ returnTo: 'pause', mode: 'save' });
    game.closeDialog();
    expect([game.dialog, game.dialogOptions]).toEqual(['pause', null]);
    game.closeDialog();
    expect([game.dialog, game.speed]).toEqual([null, 1]);
    game.openDialog('settings');
    game.openDialog(null); // null closes
    expect(game.dialog).toBeNull();
  });

  it('toasts from sim notifications (dismissable); bubbles from sim bubble events; resolveChoice dispatches', async () => {
    const h = await startedHarness();
    const game = g(h);
    const sim = h.gameSim();
    sim.state.notifications.push({ id: 31, tick: 0, kind: 'bad', title: 'Power cut', text: 'Pay your bills', agentId: null, objectId: null, read: false });
    sim.events.push({ type: 'notify', id: 31 }, { type: 'bubble', agentId: 'a1', icon: 'brain', style: 'thought' });
    await h.frames(1);
    const toast = game.toasts.find((t) => t.title === 'Power cut')!;
    expect(toast).toMatchObject({ kind: 'bad', text: 'Pay your bills', agentId: null, objectId: null });
    expect(Number.isFinite(toast.id) && Number.isFinite(toast.createdAt)).toBe(true);
    game.dismissToast(toast.id);
    expect(game.toasts.some((t) => t.id === toast.id)).toBe(false);
    expect(game.bubbles).toEqual([expect.objectContaining({ agentId: 'a1', icon: 'brain', style: 'thought', positive: true })]);
    game.resolveChoice('c1', 0);
    expect(sim.dispatched.at(-1)).toEqual({ type: 'choice', choiceId: 'c1', option: 0 });
    const n = sim.dispatched.length;
    game.resolveChoice('c1', -1);
    expect(sim.dispatched.length).toBe(n);
    // The controller keeps at most 20 toasts (the UI owns visible lifetime).
    for (let i = 0; i < 25; i++) {
      sim.state.notifications.push({ id: 100 + i, tick: 0, kind: 'info', title: `Note ${i}`, text: 'x', agentId: null, objectId: null, read: false });
      sim.events.push({ type: 'notify', id: 100 + i });
    }
    await h.frames(1);
    expect(game.toasts.length).toBeLessThanOrEqual(20);
    expect(game.toasts.at(-1)?.title).toBe('Note 24');
  });

  it('hint appears in game with an anchor; dismissHint hides it ("never" turns the tutorial off)', async () => {
    const h = await startedHarness();
    const game = g(h);
    await h.frames(40);
    const hint = game.hint!;
    expect(hint).toMatchObject({ id: expect.any(String), title: expect.any(String), text: expect.any(String) });
    expect(hint.anchor === null || (Object.values(HINT_ANCHORS) as string[]).includes(hint.anchor)).toBe(true);
    game.dismissHint(hint.id, true);
    expect(game.hint).toBeNull();
    expect(game.settings.tutorialEnabled).toBe(false);
  });
});

describe('GameController contract: settings and misc', () => {
  it('settings / updateSettings (sanitised, persisted) / resetSettings', async () => {
    const h = await startedHarness();
    const game = g(h);
    expect(game.settings).toEqual(DEFAULT_SETTINGS);
    game.updateSettings({ showFps: true, uiScale: 99 });
    expect(game.settings.showFps).toBe(true);
    expect(game.settings.uiScale).toBeGreaterThanOrEqual(0.8);
    expect(game.settings.uiScale).toBeLessThanOrEqual(1.4);
    await flush();
    expect(h.profile.data.get('settings')).toMatchObject({ showFps: true });
    game.resetSettings();
    expect(game.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('playUi / fps / diagnostics / hoverLabel / gridHover', async () => {
    const h = await startedHarness();
    const game = g(h);
    game.playUi('uiClick');
    expect(h.audio.sfxIds().at(-1)).toBe('uiClick');
    const n = h.audio.sfxIds().length;
    game.playUi('laserBeam' as never);
    expect(h.audio.sfxIds().length).toBe(n);
    await h.frames(2);
    expect(Number.isFinite(game.fps)).toBe(true);
    const d = game.diagnostics();
    expect(d).toContain('Afterlife Lease');
    expect(d).toContain('Screen: game');
    expect(game.hoverLabel).toBeNull();
    h.renderer.pickFn = (_x, _y, o) => (o?.objects ? { kind: 'object', objectId: 'o1', point: point() } : { kind: 'none' });
    h.pointer('pointermove', 200, 200);
    await h.frames(1);
    expect(game.hoverLabel).toMatch(/\S/);
    game.setBuildTool({ kind: 'floor', styleId: 'floor_planks_worn' });
    h.renderer.gridResult = { x: 4, z: 7, fx: 4.5, fz: 7.5, edge: 'h:4:7', edgeSide: 1 };
    h.pointer('pointermove', 210, 200);
    await h.frames(1);
    expect(game.gridHover).toEqual({ x: 4, z: 7, edge: 'h:4:7' });
  });
});

describe('GameController contract: crash and game over', () => {
  it('fatalError: the sim stops; saveGame still works from the crash screen; goto("menu") recovers', async () => {
    const h = await startedHarness();
    const game = g(h);
    const sim = h.gameSim();
    const e = new Event('error');
    Object.assign(e, { error: new Error('kaboom'), message: 'kaboom', filename: 'http://localhost/index.js' });
    h.win.dispatchEvent(e);
    expect(game.fatalError).toMatch(/kaboom/);
    const steps = sim.steps;
    await h.frames(20);
    expect(sim.steps).toBe(steps);
    const rescue = await game.saveGame(undefined, 'Rescue'); // the crash screen's "Try emergency save"
    expect(rescue.ok).toBe(true);
    game.goto('menu');
    expect([game.fatalError, game.screen, game.sim]).toEqual([null, 'menu', null]);
  });

  it('gameOverReason comes from the sim gameOver event; the gameOver screen is controller-owned; menu leaves it', async () => {
    const h = await startedHarness();
    const game = g(h);
    h.gameSim().events.push({ type: 'gameOver', reason: 'Rest in Pieces' });
    await h.frames(1);
    expect([game.screen, game.gameOverReason, game.speed]).toEqual(['gameOver', 'Rest in Pieces', 0]);
    expect((await game.saveGame()).ok).toBe(false); // nothing left to save
    game.goto('menu');
    expect([game.screen, game.gameOverReason, game.sim]).toEqual(['menu', null, null]);
  });

  it('KEYMAP ownership: hotkeys act, but never on events a UI widget already handled', async () => {
    const h = await startedHarness();
    const game = g(h);
    const handled = new Event('keydown', { cancelable: true });
    Object.assign(handled, { code: 'Digit2', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false });
    handled.preventDefault();
    h.win.dispatchEvent(handled);
    expect(game.speed).toBe(1);
    h.key('keydown', 'Digit2');
    expect(game.speed).toBe(2);
  });
});
