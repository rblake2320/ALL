/**
 * Integration backlog (docs/INTEGRATION_BACKLOG.md) — GAME-side acceptance tests.
 *
 *  #3  Loops stop with their emitter: `objectRemoved` stops EVERY tracked loop of that object and `agentDespawned`
 *      every loop of that zombie, at once (in the batch that carries the event, not at the next 500 ms refresh).
 *      Completion: build undo / redo re-insert objects under their old id while the sim still believes their loop
 *      plays (it never re-sends `on`), so a loop silenced by its object's removal resumes on that object's
 *      `objectAdded` — unless the sim switched it off meanwhile. Proven on the REAL simulation with a stereo.
 *  #7  validateCazDetailed() reports 'household' (lot / difficulty / member count) and 'appearance' (corrupt look).
 *  #11 The crash / emergency save passes { autosave: true, waitForLock: true }: with a REAL SaveManager whose
 *      cross-window lock another window holds and releases shortly after, the emergency save waits and lands.
 */
import { describe, expect, it, vi } from 'vitest';
import { EventRouter, MAX_SUSPENDED_LOOPS, MAX_TRACKED_LOOPS, type RouterHost } from '../../../src/game/events';
import { BubbleBoard, ToastCenter } from '../../../src/game/toasts';
import { createGameController } from '../../../src/game/controller';
import { SaveFlow, type SaveFlowHost } from '../../../src/game/saveFlow';
import { GameSession } from '../../../src/game/session';
import { EMERGENCY_SLOT, SAVE_JOB_TIMEOUT_MS } from '../../../src/game/saves';
import { DEFAULT_SETTINGS, type CazState } from '../../../src/game/contracts';
import type { SimModule } from '../../../src/game/simTypes';
import type { SimEvent } from '../../../src/sim/contracts';
import type { SaveManager, SaveMeta } from '../../../src/persistence/contracts';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { DEFAULT_LOCK_TIMEOUT_MS } from '../../../src/persistence/locks';
import { FakeLockManager, saveLockName, webLocksOver } from '../persistence/fakeWebLocks';
import { FakeAudio, FakeEnv, FakeProfile, FakeRenderer, FakeSaves, FakeSim, FakeSimModule, flush, makeObject, makeWorld, type SaveOpts } from './fakes';
import { FakeCanvas, FakeDocument, FakeWindow, createHarness, startedHarness } from './controllerHarness';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let real: SimModule | null = null;
let importError = '';
try {
  const mod = await import('../../../src/sim/index');
  real = { createNewWorld: mod.createNewWorld, createSimulation: mod.createSimulation, loadContent: mod.loadContent, LOT_TEMPLATES: mod.LOT_TEMPLATES };
} catch (e) {
  importError = e instanceof Error ? e.message : String(e);
}

// ═════════════════════════════ #3 — loops follow their emitter ═════════════════════════════

function routerHarness() {
  const audio = new FakeAudio();
  const sim = new FakeSim(makeWorld());
  sim.state.objects.o3 = makeObject('o3', 'sofa_moldy', { placement: { kind: 'floor', x: 12, z: 12, rot: 0 } });
  const log: string[] = [];
  let interactive = true;
  const host: RouterHost = {
    audio,
    renderer: new FakeRenderer(),
    viewport: () => ({ width: 1280, height: 720 }),
    now: () => 0,
    toasts: new ToastCenter(() => 0),
    bubbles: new BubbleBoard(),
    gameMinutesPerSecond: () => 1,
    interactive: () => interactive,
    isSelected: () => false,
    onChoice: () => undefined,
    onGameOver: () => undefined,
    onMusic: () => undefined,
    onAgentLeft: (id) => log.push(`left:${id}`),
    onObjectRemoved: (id) => log.push(`removed:${id}`),
    onLotChanged: () => undefined,
    onError: (where) => log.push(`error:${where}`),
  };
  const router = new EventRouter();
  const loopCalls = () => audio.named('loop').map((c) => ({ key: c.args[0] as string, on: c.args[2] as boolean, spatial: c.args[3] }));
  return {
    audio,
    sim,
    host,
    router,
    log,
    setInteractive: (v: boolean) => (interactive = v),
    route: (events: SimEvent[]) => router.route(sim, events, host),
    loopCalls,
    offs: () => loopCalls().filter((c) => !c.on).map((c) => c.key),
    lastFor: (key: string) => loopCalls().filter((c) => c.key === key).at(-1),
  };
}

const stereoOn = (id: string, pos = { x: 12.5, z: 12.5 }): SimEvent => ({ type: 'sfxLoop', id: 'stereoMusic', key: `stereo:${id}`, on: true, objectId: id, pos });

describe('backlog #3: loops stop with their emitter (EventRouter)', () => {
  it('objectRemoved stops EVERY loop of that object at once — and nothing else', () => {
    const s = routerHarness();
    s.route([
      stereoOn('o1', { x: 5.5, z: 5.5 }),
      { type: 'sfxLoop', id: 'fireLoop', key: 'fire:o1', on: true, objectId: 'o1', pos: { x: 5.5, z: 5.5 } },
      stereoOn('o3'),
      { type: 'sfxLoop', id: 'tvChatter', key: 'run:7', on: true, agentId: 'a1', pos: { x: 10.5, z: 10.5 } },
    ]);
    expect(s.router.activeLoopCount).toBe(4);
    expect(s.offs()).toEqual([]);
    delete s.sim.state.objects.o1; // the engine deletes the object, then emits objectRemoved
    s.route([{ type: 'objectRemoved', objectId: 'o1' }]);
    expect(s.offs().sort()).toEqual(['fire:o1', 'stereo:o1']); // in this very batch — no refreshLoops needed
    expect(s.router.activeLoopCount).toBe(2);
    expect(s.log).toEqual(['removed:o1']);
    // The periodic refresh neither stops them twice nor touches the survivors.
    s.router.refreshLoops(s.sim, s.host);
    expect(s.offs().sort()).toEqual(['fire:o1', 'stereo:o1']);
    expect(s.lastFor('stereo:o3')?.on).toBe(true);
    expect(s.lastFor('run:7')?.on).toBe(true);
  });

  it("agentDespawned stops that zombie's loops at once — even when it is back on the lot by routing time", () => {
    const s = routerHarness();
    s.route([
      { type: 'sfxLoop', id: 'snore', key: 'run:7', on: true, agentId: 'a1', pos: { x: 10.5, z: 10.5 } },
      { type: 'sfxLoop', id: 'shower', key: 'run:8', on: true, agentId: 'a2', pos: { x: 11.5, z: 10.5 } },
      stereoOn('o3'),
    ]);
    // a1 left and came straight back within one long frame: the presence fallback would never notice.
    s.route([
      { type: 'agentDespawned', agentId: 'a1' },
      { type: 'agentSpawned', agentId: 'a1' },
    ]);
    expect(s.offs()).toEqual(['run:7']);
    expect(s.router.activeLoopCount).toBe(2);
    expect(s.router.suspendedLoopCount).toBe(0); // a zombie's loops are not remembered: its runs ended
    expect(s.log).toEqual(['left:a1']);
    s.route([{ type: 'objectAdded', objectId: 'o3' }]);
    expect(s.offs()).toEqual(['run:7']);
  });

  it('a loop silenced by its object’s removal resumes when build undo re-inserts the object under its id', () => {
    const s = routerHarness();
    s.route([stereoOn('o3')]);
    const stereo = s.sim.state.objects.o3;
    delete s.sim.state.objects.o3; // sold in buy mode
    s.route([{ type: 'objectRemoved', objectId: 'o3' }]);
    expect(s.lastFor('stereo:o3')?.on).toBe(false);
    expect(s.router.suspendedLoopCount).toBe(1);
    s.sim.state.objects.o3 = stereo; // undo: same id, still switched on — the sim will NOT re-send `on`
    s.route([{ type: 'objectAdded', objectId: 'o3' }]);
    const resumed = s.lastFor('stereo:o3')!;
    expect(resumed.on).toBe(true);
    expect(resumed.spatial).toBeDefined(); // positioned, not a centred full-volume loop
    expect(s.router.activeLoopCount).toBe(1);
    expect(s.router.suspendedLoopCount).toBe(0);
    // Removed and re-added inside ONE batch (a rolled-back build command): ends up playing.
    s.route([{ type: 'objectRemoved', objectId: 'o3' }, { type: 'objectAdded', objectId: 'o3' }]);
    expect(s.lastFor('stereo:o3')?.on).toBe(true);
    expect(s.router.activeLoopCount).toBe(1);
  });

  it("the sim's own `off` while the object is away wins: nothing resumes on its return", () => {
    const s = routerHarness();
    s.route([stereoOn('o3')]);
    const stereo = s.sim.state.objects.o3;
    delete s.sim.state.objects.o3;
    s.route([{ type: 'objectRemoved', objectId: 'o3' }]);
    s.route([{ type: 'sfxLoop', id: 'stereoMusic', key: 'stereo:o3', on: false, objectId: 'o3' }]); // the sim's reconcile
    expect(s.router.suspendedLoopCount).toBe(0);
    s.sim.state.objects.o3 = stereo;
    s.route([{ type: 'objectAdded', objectId: 'o3' }]);
    expect(s.lastFor('stereo:o3')?.on).toBe(false);
    expect(s.router.activeLoopCount).toBe(0);
  });

  it('the refresh fallback and a late `on` for a vanished object also remember the loop until the object returns', () => {
    const s = routerHarness();
    s.route([stereoOn('o3')]);
    const stereo = s.sim.state.objects.o3;
    delete s.sim.state.objects.o3; // gone without an event (defence in depth)
    s.router.refreshLoops(s.sim, s.host);
    expect(s.lastFor('stereo:o3')?.on).toBe(false);
    expect(s.router.suspendedLoopCount).toBe(1);
    s.route([stereoOn('o3')]); // an `on` routed after its object vanished never starts a loop...
    expect(s.lastFor('stereo:o3')?.on).toBe(false);
    expect(s.router.suspendedLoopCount).toBe(1); // ...but is remembered (latest wins)
    s.sim.state.objects.o3 = stereo;
    s.route([{ type: 'objectAdded', objectId: 'o3' }]);
    expect(s.lastFor('stereo:o3')?.on).toBe(true);
  });

  it('remembered loops are bounded and dropped on teardown; the menu demo never resumes; junk is harmless', () => {
    const s = routerHarness();
    const ids = Array.from({ length: 40 }, (_, i) => `o${100 + i}`);
    for (const id of ids) s.sim.state.objects[id] = makeObject(id, 'sofa_moldy');
    for (let start = 0; start < ids.length; start += MAX_TRACKED_LOOPS) {
      const batch = ids.slice(start, start + MAX_TRACKED_LOOPS);
      s.route(batch.map((id) => stereoOn(id)));
      for (const id of batch) delete s.sim.state.objects[id];
      s.route(batch.map((id): SimEvent => ({ type: 'objectRemoved', objectId: id })));
    }
    expect(s.router.activeLoopCount).toBe(0);
    expect(s.router.suspendedLoopCount).toBe(MAX_SUSPENDED_LOOPS);
    for (const id of ids) s.sim.state.objects[id] = makeObject(id, 'sofa_moldy');
    s.route([{ type: 'objectAdded', objectId: ids[0] }]); // the oldest were dropped
    expect(s.lastFor(`stereo:${ids[0]}`)?.on).toBe(false);
    s.setInteractive(false); // e.g. the crash screen / menu demo: no audio
    s.route([{ type: 'objectAdded', objectId: ids[39] }]);
    expect(s.lastFor(`stereo:${ids[39]}`)?.on).toBe(false);
    s.setInteractive(true);
    s.route([
      { type: 'objectRemoved', objectId: 5 as never },
      { type: 'objectAdded', objectId: null as never },
      { type: 'agentDespawned', agentId: {} as never },
      { type: 'objectAdded' } as never,
    ]);
    expect(s.log.filter((l) => l.startsWith('error'))).toEqual([]);
    s.router.stopAll(s.audio);
    expect(s.router.suspendedLoopCount).toBe(0);
    s.route([{ type: 'objectAdded', objectId: ids[39] }]);
    expect(s.lastFor(`stereo:${ids[39]}`)?.on).toBe(false);
  });
});

describe('backlog #3: through the controller', () => {
  it('a sim objectRemoved stops the loop within the same frame; agentDespawned likewise', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    sim.events.push(
      { type: 'sfxLoop', id: 'stereoMusic', key: 'stereo:o1', on: true, objectId: 'o1', pos: { x: 5.5, z: 5.5 } },
      { type: 'sfxLoop', id: 'shower', key: 'run:4', on: true, agentId: 'a2', pos: { x: 11.5, z: 10.5 } },
    );
    await h.frames(1);
    const offsFor = (key: string) => h.audio.named('loop').filter((c) => c.args[0] === key && c.args[2] === false).length;
    delete sim.state.objects.o1;
    sim.events.push({ type: 'objectRemoved', objectId: 'o1' });
    sim.state.agents.a2.presence = 'atWork';
    sim.events.push({ type: 'agentDespawned', agentId: 'a2' });
    await h.frames(1);
    expect(offsFor('stereo:o1')).toBe(1);
    expect(offsFor('run:4')).toBe(1);
    await h.frames(40); // slow ticks (refreshLoops) run: no second stop, no restart
    expect(offsFor('stereo:o1')).toBe(1);
    expect(offsFor('run:4')).toBe(1);
    expect(h.audio.named('loop').filter((c) => c.args[2] === true && (c.args[0] === 'stereo:o1' || c.args[0] === 'run:4')).length).toBe(2);
  });
});

describe.skipIf(real === null)(`backlog #3 on the real simulation${importError ? ` (skipped: ${importError})` : ''}`, () => {
  it('a playing stereo sold in buy mode goes silent at once, comes back with the undo, and stays off once really sold', async () => {
    const h = await startedHarness({ realSim: real! });
    const sim = h.game.sim!;
    h.game.updateSettings({ autonomy: 'off' }); // nobody walks up and switches the stereo off meanwhile
    const lastOn = (key: string) => h.audio.named('loop').filter((c) => c.args[0] === key).at(-1)?.args[2] as boolean | undefined;
    // Buy a boombox on the first free tile.
    h.game.setMode('buy');
    let spot: { x: number; z: number } | null = null;
    for (let z = 3; z < 26 && !spot; z++) for (let x = 2; x < 28 && !spot; x++) if (sim.spatial.checkPlace('stereo_boombox', x, z, 0).ok) spot = { x, z };
    expect(spot).not.toBeNull();
    const before = new Set(Object.keys(sim.state.objects));
    expect(h.game.applyBuild({ type: 'buy', defId: 'stereo_boombox', x: spot!.x, z: spot!.z, rot: 0 })).toBe(true);
    const id = Object.keys(sim.state.objects).find((k) => !before.has(k) && sim.state.objects[k].defId === 'stereo_boombox')!;
    expect(id).toBeDefined();
    const key = `stereo:${id}`;
    h.game.setMode('live');
    // Switch it on (what the stereo toggle does) and let the sim start its loop.
    sim.state.objects[id].data.playing = true;
    await h.until(() => lastOn(key) === true, 240);
    // Buy mode (paused): sell it → the loop stops in the next frame.
    h.game.setMode('buy');
    h.game.sellObject(id);
    await h.frames(1);
    expect(sim.object(id)).toBeUndefined();
    expect(lastOn(key)).toBe(false);
    // Undo → same id, still switched on; the sim never re-sends `on` (its loop flag never changed) → GAME resumes it.
    h.game.undo();
    await h.frames(1);
    expect(sim.object(id)?.data.playing).toBe(true);
    expect(lastOn(key)).toBe(true);
    h.game.setMode('live');
    await h.frames(90); // the sim ticks again and still considers it audible: no off
    expect(lastOn(key)).toBe(true);
    // Sold for good (leaving buy mode ends the build session): the sim confirms with its own off; nothing resumes it.
    h.game.setMode('buy');
    h.game.sellObject(id);
    h.game.setMode('live');
    await h.frames(90);
    expect(sim.object(id)).toBeUndefined();
    expect(lastOn(key)).toBe(false);
    expect(h.game.fatalError).toBeNull();
  });
});

// ═════════════════════════════ #7 — CAZ field union ═════════════════════════════

describe('backlog #7: validateCazDetailed emits household / appearance (through the controller)', () => {
  it('household-level problems use "household", a corrupt look "appearance"; validateCaz mirrors the messages', async () => {
    const h = await createHarness();
    // On the menu nobody is being created: a household-level problem with no input of its own.
    expect(h.game.validateCazDetailed()).toEqual([{ memberIndex: null, field: 'household', message: 'Create a household first.' }]);
    expect(h.game.validateCaz()).toEqual(['Create a household first.']);
    h.game.beginNewGame();
    expect(h.game.validateCazDetailed()).toEqual([]);
    // The UI API cannot corrupt CAZ state (patches are validated field by field)...
    h.game.updateCaz({ lotTemplate: 'moonbase' as never, difficulty: 'impossible' as never });
    h.game.updateCazMember(0, { appearance: { ...h.game.caz!.members[0].appearance, hairStyle: 'mohawk-of-doom' as never } });
    expect(h.game.validateCazDetailed()).toEqual([]);
    // ...but corrupt state (stale UI object mutated in place, bad data) is reported against the right fields.
    const caz = h.game.caz as CazState;
    (caz as { lotTemplate: string }).lotTemplate = 'moonbase';
    (caz as { difficulty: string }).difficulty = 'impossible';
    (caz.members[0].appearance as unknown as { hairStyle: string }).hairStyle = 'mohawk-of-doom';
    const issues = h.game.validateCazDetailed();
    expect(issues).toEqual([
      { memberIndex: null, field: 'household', message: 'Choose a lot to move into.' },
      { memberIndex: null, field: 'household', message: 'Choose a difficulty.' },
      { memberIndex: 0, field: 'appearance', message: expect.stringMatching(/invalid appearance \(hairStyle\)/) },
    ]);
    expect(h.game.validateCaz()).toEqual(issues.map((i) => i.message));
    // Member count problems are household-level too.
    const members = caz.members.slice();
    caz.members.length = 0;
    expect(h.game.validateCazDetailed()).toContainEqual({ memberIndex: null, field: 'household', message: 'Add at least one zombie.' });
    caz.members.push(...members, ...members, ...members, ...members, ...members);
    expect(h.game.validateCazDetailed()).toContainEqual({ memberIndex: null, field: 'household', message: 'A household can have at most 4 zombies.' });
    // An invalid household never starts (the shell disables Start; the controller refuses anyway, without throwing).
    await h.game.startGame();
    expect(h.game.screen).toBe('caz');
    expect(h.game.sim).toBeNull();
  });
});

// ═════════════════════════════ #11 — the emergency save waits for the lock ═════════════════════════════

const META: SaveMeta = { householdName: 'Probe', memberNames: [], day: 1, timeLabel: 'Mon 9:00 AM', funds: 0, lotValue: 0, thumbnail: null };

function crash(win: FakeWindow, message = 'kaboom'): void {
  const e = new Event('error');
  Object.assign(e, { error: new Error(message), message, filename: 'http://localhost/index.js' });
  win.dispatchEvent(e);
}

/** A controller over a REAL SaveManager (fake renderer / audio / sim), booted into a game. */
async function gameWithSaves(saves: SaveManager) {
  const env = new FakeEnv();
  const win = new FakeWindow();
  const doc = new FakeDocument();
  env.window = win as unknown as Window;
  env.document = doc as unknown as Document;
  const game = createGameController({ renderer: new FakeRenderer(), audio: new FakeAudio(), saves, profile: new FakeProfile(), sim: new FakeSimModule(), env });
  // Real persistence does real async work (WebCrypto, gzip): yield to the event loop between frames.
  const frame = async () => {
    env.frame(16);
    await flush(4);
    await sleep(0);
  };
  // > 500 frames: even if the new-game autosave were still writing, its 8 s (game time) wait ends and the game starts.
  const until = async (pred: () => boolean, max = 800) => {
    for (let i = 0; i < max && !pred(); i++) await frame();
    if (!pred()) throw new Error(`not reached; screen=${game.screen} fatal=${game.fatalError}`);
  };
  void game.boot(new FakeCanvas() as unknown as HTMLCanvasElement);
  await until(() => game.screen === 'menu');
  game.beginNewGame();
  const started = game.startGame();
  await until(() => game.screen === 'game');
  await started;
  return { game, env, win };
}

describe('backlog #11: the crash / emergency save waits for the cross-window lock', () => {
  it('GAME passes { autosave: true, waitForLock: true } for the crash save only — ordinary autosaves stay fail-fast', async () => {
    const h = await startedHarness();
    crash(h.win);
    await flush();
    expect(h.game.fatalError).toMatch(/kaboom/);
    const em = h.saves.saveCalls.find((c) => c.slotId === EMERGENCY_SLOT);
    expect(em?.opts).toMatchObject({ autosave: true, waitForLock: true });
    expect(Number.isFinite(em?.opts?.playMinutes)).toBe(true);
    const autos = h.saves.saveCalls.filter((c) => c.slotId !== EMERGENCY_SLOT && c.opts?.autosave === true);
    expect(autos.length).toBeGreaterThan(0); // the new-game autosave
    for (const a of autos) expect(a.opts?.waitForLock).not.toBe(true);
    // GAME's own watchdog never cuts the crash save off before PLATFORM's lock wait (≤ 30 s) is over.
    expect(SAVE_JOB_TIMEOUT_MS).toBeGreaterThan(DEFAULT_LOCK_TIMEOUT_MS);
  });

  it('another window holds the save lock at the crash and releases it shortly after → the emergency save waits and lands', async () => {
    const backend = createMemoryBackend();
    const manager = new FakeLockManager();
    const saves = new SaveManagerImpl({ backend, logger: { warn: () => undefined, error: () => undefined }, locks: webLocksOver(manager) });
    const h = await gameWithSaves(saves);
    const sim = h.game.sim!;
    // The new-game autosave goes through first (the lock is still free).
    await vi.waitFor(async () => expect((await saves.listSlots()).some((s) => s.isAutosave)).toBe(true), { timeout: 15_000, interval: 10 });
    const other = manager.hold(saveLockName(backend.id)); // the other window starts a long save
    await other.granted;
    // Contrast: an ordinary autosave right now fails fast with 'busy' (its caller retries later).
    const probe = await saves.save('auto-probe', 'probe', sim.serialize(), META, { autosave: true });
    expect(!probe.ok && probe.code).toBe('busy');
    crash(h.win);
    expect(h.game.fatalError).toMatch(/kaboom/);
    await sleep(40);
    expect(h.game.saving).toBe(true); // the crash save is WAITING for the lock, not failed
    expect(backend.store.has(`slot:${EMERGENCY_SLOT}:primary`)).toBe(false);
    setTimeout(() => other.release(), 10); // the other holder releases the lock after a short delay
    await vi.waitFor(() => expect(backend.store.has(`slot:${EMERGENCY_SLOT}:primary`)).toBe(true), { timeout: 15_000, interval: 5 });
    await vi.waitFor(() => expect(h.game.saving).toBe(false), { timeout: 15_000, interval: 5 });
    const listed = (await saves.listSlots()).find((s) => s.slotId === EMERGENCY_SLOT);
    expect(listed?.isAutosave).toBe(true); // still listed as an autosave
    const loaded = await saves.load(EMERGENCY_SLOT);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.world.seed).toBe(sim.state.seed);
      expect(loaded.world.tick).toBe(sim.state.tick);
    }
    await other.done;
  });

  it('a crash save that still finds the lock taken (busy after the wait) fails quietly and may be tried again', async () => {
    const saves = new FakeSaves();
    const opts: (SaveOpts | undefined)[] = [];
    const realSave = saves.save.bind(saves);
    let busy = 1;
    saves.save = async (slotId, name, world, meta, o) => {
      opts.push(o);
      if (busy-- > 0) return { ok: false, error: 'another window of the game kept the save lock for over 30 s', code: 'busy' };
      return realSave(slotId, name, world, meta, o);
    };
    const env = new FakeEnv();
    const sim = new FakeSim(makeWorld({ seed: 0xbeef }));
    const session = new GameSession(sim, { loadedFrom: null, playMinutesBase: 3 }, () => undefined);
    const reports: string[] = [];
    const host: SaveFlowHost = {
      env,
      renderer: new FakeRenderer(),
      saves,
      session: () => session,
      screen: () => 'game',
      settings: () => DEFAULT_SETTINGS,
      choicePending: () => false,
      toast: () => undefined,
      sfx: () => undefined,
      report: (w) => reports.push(w),
      changed: () => undefined,
    };
    const flow = new SaveFlow(host);
    await expect(flow.emergencySave()).resolves.toBe(false);
    expect(flow.saving).toBe(false);
    await expect(flow.emergencySave()).resolves.toBe(true); // not marked done: a retry is allowed
    await expect(flow.emergencySave()).resolves.toBe(false); // ...and once it landed, never again this session
    expect(opts.length).toBe(2);
    for (const o of opts) expect(o).toMatchObject({ autosave: true, waitForLock: true, playMinutes: 3 });
    expect(reports).toEqual([]);
  });
});
