/**
 * Write-ahead command journal — game level, on the REAL simulation and the REAL SaveManager:
 *  - replay determinism: 2 game days of random commands with autosaves (and their rebases) in between, then a
 *    "kill": snapshot + journal replay must be byte-identical (canonical JSON) to the uninterrupted world;
 *  - 10 000 commands replay fast (CPU-normalised; < 2 s with JOURNAL_PERF_STRICT=1); divergence (a replayed result differs) stops just before the bad entry;
 *  - corrupt tail, journal for the wrong snapshot, old saves without journals, storage cleared mid-session, quota;
 *  - the controller: kill the tab without unload → Continue → "Recovered N seconds of play" + immediate save;
 *    two windows (only the lock holder journals); the emergency crash-save path; hide/pagehide/unload flushes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, SimulationAPI } from '../../../src/sim/contracts';
import type { TargetRef } from '../../../src/sim/types';
import type { WorldState } from '../../../src/sim/types';
import type { SaveManager, StorageBackend } from '../../../src/persistence/contracts';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend, type MemoryBackend } from '../../../src/persistence/backends/memory';
import { noLocks } from '../../../src/persistence/locks';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { sha256HexSync } from '../../../src/persistence/sha256';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { StorageError } from '../../../src/persistence/errors';
import { JournalWriter, decodeChunk, encodeChunk, chainEntries, genesisHash, readJournal, type JournalBase } from '../../../src/persistence/journal';
import { SaveFlow, type SaveFlowHost } from '../../../src/game/saveFlow';
import { GameSession } from '../../../src/game/session';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { LOCK_TIMEOUT_MS, REPLAY_BUDGET_MS, replayEntries, worldFingerprint } from '../../../src/game/journal';
import { RESPONSIVE_SLICE_MS } from '../../../src/game/saves';
import { buildCazCatalog } from '../../../src/game/gddCatalog';
import { randomHousehold } from '../../../src/game/randomZombie';
import { createGameController, type GameControllerImpl } from '../../../src/game/controller';
import type { SimModule } from '../../../src/game/simTypes';
import { FakeAudio, FakeEnv, FakeProfile, FakeRenderer, flush } from './fakes';
import { FakeCanvas, FakeDocument, FakeWindow, adultEconomy } from './controllerHarness';
import { FakeLockManager } from '../persistence/fakeWebLocks';

type SimIndex = typeof import('../../../src/sim/index');
let real: SimIndex | null = null;
let loadError = '';
try {
  real = await import('../../../src/sim/index');
} catch (e) {
  loadError = e instanceof Error ? e.message : String(e);
}

const silent = { warn: () => undefined, error: () => undefined };

/*
 * Web Locks as the pages of ONE test see them. Every page here lives in this one Node process, and a "killed" page's
 * objects (its JournalWriter and the journal lock it holds) stay alive — but a real browser drops a page's locks the
 * moment that page dies. Without this, the tests depended on the HOST: Node 22 has no navigator.locks (the journal
 * silently fell back to noLocks, so locking was never exercised), while Node >= 24.5 ships a real, process-wide
 * navigator.locks — there the dead page kept the journal lock, the relaunched page correctly concluded "another
 * window plays this world" and loaded the snapshot only (recovered === null; 6 failures on Node 24, see
 * docs/INTEGRATION_BACKLOG.md). So each test gets its own lock manager, and killPage() models the browser
 * releasing the dead page's locks. The real webLocks() provider runs on top of it on every Node version.
 */
const hostNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let pageLocks = new FakeLockManager();
function installLocks(mgr: FakeLockManager): FakeLockManager {
  Object.defineProperty(globalThis, 'navigator', { value: { locks: mgr }, configurable: true, writable: true });
  return mgr;
}
/** The page that holds the journal lock is gone (tab killed / crashed): the browser frees its locks. */
function killPage(): void {
  pageLocks = installLocks(new FakeLockManager());
}
beforeEach(() => {
  pageLocks = installLocks(new FakeLockManager());
});
afterEach(() => {
  if (hostNavigator) Object.defineProperty(globalThis, 'navigator', hostNavigator);
  else delete (globalThis as { navigator?: unknown }).navigator;
});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function realModule(): SimModule {
  const m = real!;
  return { createNewWorld: m.createNewWorld, createSimulation: m.createSimulation, loadContent: m.loadContent, LOT_TEMPLATES: m.LOT_TEMPLATES };
}

function newWorld(seed: number, members = 2): WorldState {
  const m = real!;
  const catalog = buildCazCatalog(m.loadContent(), m.LOT_TEMPLATES);
  const h = randomHousehold(seed * 7919, catalog, members);
  return m.createNewWorld({ seed, householdName: h.householdName, members: h.members, lotTemplate: 'starter', difficulty: 'normal' });
}

function mkSaves(backend: StorageBackend): SaveManagerImpl {
  return new SaveManagerImpl({ backend, compress: false, logger: silent, locks: noLocks, repair: engineRepairHook() });
}

/** A random but legal-looking player command (failures are fine: they replay as failures). */
function randomCommand(sim: SimulationAPI, rnd: () => number): Command | null {
  const ids = sim.state.household.memberIds;
  if (ids.length === 0) return null;
  const actor = ids[Math.floor(rnd() * ids.length)];
  const r = rnd();
  if (r < 0.5) {
    const objs = Object.keys(sim.state.objects);
    const t = rnd();
    const target: TargetRef =
      t < 0.25 ? { kind: 'self' } : t < 0.5 ? { kind: 'tile', x: 2 + Math.floor(rnd() * 24), z: 2 + Math.floor(rnd() * 22) } : objs.length ? { kind: 'object', id: objs[Math.floor(rnd() * objs.length)] } : { kind: 'self' };
    const entries = sim.menu(actor, target).flatMap((e) => (e.children && e.children.length ? e.children : [e])).filter((e) => e.available);
    if (entries.length === 0) return null;
    const e = entries[Math.floor(rnd() * entries.length)];
    return { type: 'queue', actorId: actor, interactionId: e.interactionId, target, params: e.params };
  }
  if (r < 0.62) {
    const q = sim.queueView(actor);
    if (q.length === 0) return null;
    return { type: 'cancel', actorId: actor, uid: q[Math.floor(rnd() * q.length)].uid };
  }
  if (r < 0.68) return { type: 'setSettings', settings: { autonomy: (['full', 'limited', 'off'] as const)[Math.floor(rnd() * 3)] } };
  if (r < 0.72) return { type: 'markNotificationsRead' };
  if (r < 0.78) {
    const c = sim.state.choices[0];
    return c ? { type: 'choice', choiceId: c.id, option: Math.floor(rnd() * Math.max(1, c.options.length)) } : null;
  }
  if (r < 0.88) {
    const x = 2 + Math.floor(rnd() * 20);
    const z = 2 + Math.floor(rnd() * 20);
    return { type: 'build', cmd: { type: 'addWalls', edges: [`h:${x}:${z}`, `h:${x + 1}:${z}`], style: 'wall_plaster_bone' } };
  }
  if (r < 0.94) return { type: rnd() < 0.6 ? 'undo' : 'redo' };
  if (r < 0.97) return { type: 'renameHousehold', name: `House ${Math.floor(rnd() * 1000)}` };
  return { type: 'endBuildSession' }; // back to live mode: the undo history is dropped
}

/** A SaveFlow over real persistence, driven by hand (no controller): exactly the save + journal code the game runs. */
function rig(backend: StorageBackend, sim: SimulationAPI, env: FakeEnv = new FakeEnv(), opts: { blockEventSaves?: boolean } = {}) {
  const saves = mkSaves(backend);
  const session = new GameSession(sim, { loadedFrom: null, playMinutesBase: 0 }, () => undefined);
  const toasts: string[] = [];
  const reports: string[] = [];
  let live: GameSession | null = session;
  const host: SaveFlowHost = {
    env,
    renderer: new FakeRenderer(),
    saves,
    session: () => live,
    screen: () => 'game',
    settings: () => ({ ...DEFAULT_SETTINGS, autosaveMinutes: 0 }), // interval saves off: the test decides
    choicePending: () => opts.blockEventSaves === true, // a pending choice blocks interval/event autosaves
    toast: (_k, t) => toasts.push(t),
    sfx: () => undefined,
    report: (w) => reports.push(w),
    changed: () => undefined,
  };
  const flow = new SaveFlow(host);
  return {
    env,
    saves,
    session,
    flow,
    toasts,
    reports,
    end() {
      live = null;
      flow.endSession();
    },
  };
}

/**
 * Wait for real async persistence (WebCrypto, 0 ms timers) on a DETERMINISTIC signal, never on a wall-clock budget:
 * no save job queued or running, no autosave (or its coalesced follow-up) pending, and no journal write in flight —
 * seen on 3 consecutive event-loop turns (a follow-up flush / save starts in a later turn than the one that ended).
 * W-119: the old version gave up after a fixed number of turns; under CPU contention a save was then still in
 * flight while the test advanced the FAKE clock by game-seconds, so which saves (day rollover, …) fired — and so
 * the final snapshot — depended on machine load. Throws if the queue never drains (a hung write is a bug here).
 */
async function settle(flow: SaveFlow, minRounds = 3): Promise<void> {
  let quiet = 0;
  const t0 = performance.now();
  for (let i = 0; quiet < 3 || i < minRounds; i++) {
    await flush(4);
    await sleep(0);
    const w = flow.journal.active;
    const busy = flow.saving || flow.autosave.busy || (!!w && w.busy);
    quiet = busy ? 0 : quiet + 1;
    if (performance.now() - t0 > 60_000) throw new Error('settle: the save / journal write queue never drained');
  }
}

const canon = (sim: SimulationAPI) => canonicalJson(sim.serialize());

/**
 * CPU calibration for the replay perf guard (W-119): a FIXED workload made of the primitives a journal replay spends
 * its time in, at the 10k-command scale — canonical JSON + pure-JS SHA-256 of 10 000 small entries (chunk decode +
 * hash-chain verification), a JSON round trip of the encoded text (chunk parse) and 200 sim steps + 10 000 cheap
 * dispatches (the replay itself) on a scratch copy of `world`. Returns ms. It shares no code with the journal reader
 * or replayEntries, so a regression there moves the replay time but not this one.
 */
function calibrate(world: WorldState): number {
  const t0 = performance.now();
  let prev = '0'.repeat(64);
  const parts: string[] = [];
  for (let i = 0; i < 10_000; i++) {
    const text = canonicalJson({ i, t: i >> 4, at: i * 3, c: { type: 'markNotificationsRead' }, ok: true, p: prev });
    prev = sha256HexSync(`${prev}|${text}`);
    parts.push(text);
  }
  const joined = `[${parts.join(',')}]`;
  sha256HexSync(canonicalJson(JSON.parse(joined) as unknown));
  const sim = real!.createSimulation(JSON.parse(JSON.stringify(world)) as WorldState);
  for (let i = 0; i < 10_000; i++) {
    sim.dispatch({ type: 'markNotificationsRead' });
    if (i % 50 === 0) sim.step();
  }
  return performance.now() - t0;
}

describe.skipIf(real === null)(`journal × real simulation${loadError ? ` (skipped: ${loadError})` : ''}`, () => {
  async function twoDays(midwaySaves: boolean): Promise<void> {
    const backend = createMemoryBackend();
    const sim = real!.createSimulation(newWorld(11));
    const gate = { blockEventSaves: !midwaySaves };
    const r = rig(backend, sim, new FakeEnv(), gate);
    r.flow.beginSession(null);
    expect(await r.flow.autosaveNow('newGame')).toBe('saved');
    await settle(r.flow);
    const rnd = prng(424242);
    const TICKS = 2 * 24 * 60 * 4; // 2 game days at 0.25 min/tick
    const TAIL = 720; // the last 3 game hours: saves blocked, so the kill has a long journal tail to replay
    let commands = 0;
    let pendingSave: Promise<unknown> | null = null;
    let pendingUntil = -1;
    // W-119: every save starts AND lands at a deterministic tick (the fake clock never runs ahead of a save in flight),
    // so which saves fire — and the final snapshot — no longer depend on CPU load.
    const saveQuiet = async () => {
      if (!pendingSave && (r.flow.saving || r.flow.autosave.busy)) await settle(r.flow);
    };
    for (let i = 0; i < TICKS; i++) {
      if (i === TICKS - TAIL) {
        await settle(r.flow);
        // Leave the build session (as the game does when returning to live mode): later undos only reach edits the
        // journal holds. Then no more saves: everything from here on comes back from the journal alone.
        r.session.dispatch({ type: 'endBuildSession' });
        commands++;
        gate.blockEventSaves = true;
      }
      if (rnd() < 0.03) {
        const c = randomCommand(sim, rnd);
        if (c) {
          r.session.dispatch(c);
          commands++;
          // An undo/redo that reaches back past a mid-build-session snapshot asks for an immediate save (W-119).
          if (c.type === 'undo' || c.type === 'redo') {
            await flush(2);
            await saveQuiet();
          }
        }
      }
      sim.step();
      if ((i & 63) === 0) sim.drainEvents();
      if (i % 30 === 0) {
        r.env.advance(250); // 120 ticks per real second (ultra speed)
        r.flow.tick();
        await saveQuiet();
      }
      // Autosaves while commands keep coming: serialized at call time, the write lands 150 ticks later (no await in
      // between lets it progress).
      if (midwaySaves && (i === 3000 || i === 9000)) {
        pendingSave = r.flow.autosaveNow(`mid${i}`);
        pendingUntil = i + 150;
      }
      if (pendingSave && i >= pendingUntil) {
        await pendingSave;
        pendingSave = null;
        await settle(r.flow);
      }
      if (i % 500 === 0) await flush(2);
    }
    // The last batch reaches storage (≤ 1 s cadence) — then the tab is killed: no unload, no save.
    r.env.advance(1000);
    r.flow.tick();
    await settle(r.flow);
    const expected = canon(sim);
    expect(commands).toBeGreaterThan(150);
    expect(r.reports).toEqual([]); // no watchdog timeouts, no failed saves
    if (midwaySaves) expect(r.flow.autosave.writeCount).toBeGreaterThan(3); // mid saves + day rollovers + re-anchors

    // ── relaunch ──
    expect(pageLocks.busy(`afterlife-lease:journal:${backend.id}:${r.session.autosaveSlot}`)).toBe(true); // locking is really in play
    killPage();
    const saves2 = mkSaves(backend);
    const latest = await saves2.latest();
    expect(latest?.slotId).toBe(r.session.autosaveSlot);
    const res = await saves2.load(latest!.slotId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const snapTick = res.world.tick;
    expect(snapTick).toBeLessThan(sim.state.tick); // the snapshot is older than the live world
    const sim0 = real!.createSimulation(res.world);
    const r2 = rig(backend, sim0);
    const t0 = performance.now();
    const out = await r2.flow.recoverJournal(res, sim0, (w) => real!.createSimulation(w));
    const took = performance.now() - t0;
    if (out.recovered?.stopped) console.info('[journal] stopped early:', out.recovered.stopped);
    expect(out.recovered).not.toBeNull();
    expect(out.recovered!.dropped).toBe(0);
    expect(out.recovered!.seconds).toBeGreaterThan(0);
    expect(out.sim.state.tick).toBe(sim.state.tick);
    expect(canon(out.sim)).toBe(expected);
    if (!midwaySaves) expect(out.recovered!.commands).toBe(commands); // the whole 2 days came back from the journal
    console.info(`[journal] replayed ${out.recovered!.entries} entries (${out.recovered!.commands} commands, ${out.recovered!.seconds} s of play, ${sim.state.tick - snapTick} ticks) in ${took.toFixed(0)} ms`);
  }

  it('2 game days of random commands, NO save after the new game, then a kill: replay is byte-identical to the uninterrupted run', () => twoDays(false), 180_000);

  it('2 game days of random commands with autosaves (and event saves) landing mid-play, then a kill: byte-identical too', () => twoDays(true), 180_000);

  /*
   * Perf guard (W-119). The old `took < 2000` was a wall-clock assertion: with 4 copies of this file on 4 cores it read
   * 2133–3797 ms and failed, while the replay itself had not changed. Now:
   *  - CPU-normalised: replay time / a calibration workload of the same primitives (see calibrate()), measured right
   *    before and after (the larger one counts, so steady load cancels out); best of up to 3 attempts, since contention
   *    can only ADD time. Idle the ratio is ≈ 1.0–1.7 and stayed ≤ 2.5 with 8 copies on 4 cores; the cap of 4 still
   *    catches what this guard is for — an algorithmic regression (per-entry re-encode, quadratic chain checks: 10×+).
   *  - JOURNAL_PERF_STRICT=1 (a quiet perf runner) additionally enforces the product target: < 2 s wall clock.
   *  - Always: under the replay's own time budget (REPLAY_BUDGET_MS, past which loading gives up on the journal).
   */
  it('10 000 commands: replay (read + verify + dispatch) stays fast — CPU-normalised (strict < 2 s with JOURNAL_PERF_STRICT=1)', async () => {
    const backend = createMemoryBackend();
    const sim = real!.createSimulation(newWorld(12, 1));
    const r = rig(backend, sim);
    r.flow.beginSession(null);
    await r.flow.autosaveNow('newGame');
    await settle(r.flow);
    const ids = sim.state.household.memberIds;
    for (let i = 0; i < 10_000; i++) {
      const c: Command = i % 3 === 0 ? { type: 'markNotificationsRead' } : i % 3 === 1 ? { type: 'setSettings', settings: { autonomy: i % 2 ? 'off' : 'full' } } : { type: 'cancel', actorId: ids[0], uid: 999_999 };
      r.session.dispatch(c);
      if (i % 50 === 0) sim.step();
      if (i % 1000 === 0) {
        r.env.advance(1000);
        r.flow.tick();
        await settle(r.flow, 4);
      }
    }
    r.env.advance(1000);
    r.flow.tick();
    await settle(r.flow);
    const expected = canon(sim);
    const res = await mkSaves(backend).load(r.session.autosaveSlot);
    if (!res.ok) throw new Error(res.error);
    const snapshot = JSON.parse(JSON.stringify(res.world)) as WorldState;
    let best = { took: Infinity, cal: 1, ratio: Infinity };
    for (let attempt = 0; attempt < 3 && best.ratio >= 4; attempt++) {
      killPage();
      const calBefore = calibrate(snapshot);
      const world = JSON.parse(JSON.stringify(snapshot)) as WorldState;
      const sim0 = real!.createSimulation(world);
      const r2 = rig(backend, sim0);
      const t0 = performance.now();
      const out = await r2.flow.recoverJournal({ ...res, world }, sim0, (w) => real!.createSimulation(w));
      const took = performance.now() - t0;
      const cal = Math.max(calBefore, calibrate(snapshot));
      expect(out.recovered!.commands).toBe(10_000);
      expect(out.recovered!.dropped).toBe(0);
      expect(canon(out.sim)).toBe(expected);
      r2.flow.journal.end(); // release this attempt's journal lock before the next one
      console.info(`[journal] 10k-command replay #${attempt + 1}: ${took.toFixed(0)} ms; calibration ${cal.toFixed(0)} ms; ratio ${(took / cal).toFixed(2)}`);
      if (took / cal < best.ratio) best = { took, cal, ratio: took / cal };
    }
    expect(best.ratio).toBeLessThan(4);
    expect(best.took).toBeLessThan(REPLAY_BUDGET_MS);
    if (process.env.JOURNAL_PERF_STRICT === '1') expect(best.took).toBeLessThan(2000);
  }, 120_000);

  it('divergence: a replayed result that differs from the live one stops the replay right before it', async () => {
    const world = newWorld(13, 1);
    const sim = real!.createSimulation(JSON.parse(JSON.stringify(world)) as WorldState);
    const ids = sim.state.household.memberIds;
    const backend = createMemoryBackend();
    const base: JournalBase = { slotId: 'auto-0000000d', payloadSha256: 'a'.repeat(64), tick: sim.state.tick };
    const w = new JournalWriter({ backend, ns: 'auto-0000000d', locks: noLocks, logger: silent });
    await w.acquire();
    await w.rebase(base, w.mark(), 0);
    const cmds: Command[] = [{ type: 'markNotificationsRead' }, { type: 'renameHousehold', name: 'Rotters' }, { type: 'cancel', actorId: ids[0], uid: 424242 }, { type: 'renameHousehold', name: 'Later' }];
    cmds.forEach((c, i) => w.record({ t: sim.state.tick + i, atAbs: i * 100, c, ok: i === 2 ? true : true })); // #2 really fails: "ok: true" is a lie
    await w.flush();
    const rec = (await readJournal(backend, 'auto-0000000d', base))!;
    const replay = real!.createSimulation(JSON.parse(JSON.stringify(world)) as WorldState);
    const out = await replayEntries(replay, rec.entries, { now: () => performance.now() });
    expect(out.diverged).toBe(true);
    expect(out.applied).toBe(2);
    // Through the game path the world is rebuilt and only the safe prefix applied.
    const res = { ok: true as const, world: JSON.parse(JSON.stringify(world)) as WorldState, info: { slotId: 'auto-0000000d' } as never, warnings: [], payloadSha256: base.payloadSha256 };
    const sim0 = real!.createSimulation(res.world);
    const r = rig(backend, sim0);
    const got = await r.flow.recoverJournal(res, sim0, (wd) => real!.createSimulation(wd));
    expect(got.recovered!.entries).toBe(2);
    expect(got.sim.state.household.name).toBe('Rotters');
    expect(got.sim).not.toBe(sim0); // rebuilt from the snapshot, not patched
    // A marker fingerprint mismatch is a divergence too.
    // W-025 S4: an optional `|s<hex>` stream suffix once streaming brought regions live
    expect(worldFingerprint(got.sim)).toMatch(/^\d+,\d+,\d+,\d+\|\d+\|-?\d+(\|s[0-9a-f]+)?$/);
  });

  /** A journal of two renames on top of `world`, written by a page that then died (its lock is gone). */
  async function crashedJournal(world: WorldState, backend: StorageBackend) {
    const sim = real!.createSimulation(JSON.parse(JSON.stringify(world)) as WorldState);
    const base: JournalBase = { slotId: 'auto-0000000d', payloadSha256: 'b'.repeat(64), tick: sim.state.tick };
    const w = new JournalWriter({ backend, ns: 'auto-0000000d', locks: noLocks, logger: silent });
    await w.acquire();
    await w.rebase(base, w.mark(), 0);
    const cmds: Command[] = [{ type: 'renameHousehold', name: 'Rotters' }, { type: 'renameHousehold', name: 'Last Moments' }];
    cmds.forEach((c, i) => w.record({ t: sim.state.tick + i, atAbs: i * 100, c, ok: true }));
    await w.flush();
    const res = { ok: true as const, world: JSON.parse(JSON.stringify(world)) as WorldState, info: { slotId: 'auto-0000000d' } as never, warnings: [], payloadSha256: base.payloadSha256 };
    return { res, sim0: real!.createSimulation(res.world) };
  }
  /** Drive the fake clock in ordinary 100 ms turns until `p` settles (real async persistence runs in between). */
  async function turnUntil<T>(env: FakeEnv, p: Promise<T>, maxTurns = 400): Promise<T> {
    let done = false;
    let out!: T;
    void p.then((v) => ((out = v), (done = true)));
    for (let i = 0; i < maxTurns && !done; i++) {
      env.advance(RESPONSIVE_SLICE_MS);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    expect(done).toBe(true);
    return out;
  }

  it('W-134: a main thread blocked for 12 s while the journal lock answers does NOT drop the crash recovery', async () => {
    const backend = createMemoryBackend();
    const { res, sim0 } = await crashedJournal(newWorld(13, 1), backend);
    // The lock manager answers "granted" — but the answer is queued behind a 12 s task (asset decode, shader compile,
    // a software-rendered frame), i.e. it reaches the page only after `deliver()`.
    const inner = new FakeLockManager();
    let deliver!: () => void;
    const queued = new Promise<void>((r) => (deliver = r));
    installLocks({ request: (name: string, o: never, cb: never) => queued.then(() => inner.request(name, o, cb)) } as never);
    const env = new FakeEnv();
    const r = rig(backend, sim0, env);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const p = r.flow.recoverJournal(res, sim0, (wd) => real!.createSimulation(wd));
      await flush();
      // One long task: the clock jumps 12 s and only the timers already due run, once (the old wall-clock 2 s
      // timeout fired right here and the recovery was silently skipped).
      const t = env.t;
      env.advance(RESPONSIVE_SLICE_MS); // the armed slice fires…
      env.t = t + 12_000; // …12 s late
      deliver();
      const got = await turnUntil(env, p);
      expect(got.recovered).not.toBeNull();
      expect(got.recovered!.commands).toBe(2);
      expect(got.sim.state.household.name).toBe('Last Moments');
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/did not answer/);
      expect(r.reports).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('W-134: another window really holding the lock still means "snapshot only", decided at once and without a warning', async () => {
    const backend = createMemoryBackend();
    const { res, sim0 } = await crashedJournal(newWorld(13, 1), backend);
    const other = new JournalWriter({ backend, ns: 'auto-0000000d', logger: silent }); // the other window (web locks)
    expect(await other.acquire()).toBe(true);
    const env = new FakeEnv();
    const r = rig(backend, sim0, env);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const t0 = env.t;
      const got = await turnUntil(env, r.flow.recoverJournal(res, sim0, (wd) => real!.createSimulation(wd)));
      expect(got.recovered).toBeNull();
      expect(got.sim).toBe(sim0);
      expect(env.t - t0).toBeLessThan(LOCK_TIMEOUT_MS); // a definitive answer, not a timeout
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/did not answer/);
    } finally {
      warn.mockRestore();
      other.release();
    }
  });

  it('W-134: a lock manager that never answers gives up after the budget, loads the snapshot and SAYS so', async () => {
    const backend = createMemoryBackend();
    const { res, sim0 } = await crashedJournal(newWorld(13, 1), backend);
    installLocks({ request: () => new Promise(() => undefined) } as never);
    const env = new FakeEnv();
    const r = rig(backend, sim0, env);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const t0 = env.t;
      const got = await turnUntil(env, r.flow.recoverJournal(res, sim0, (wd) => real!.createSimulation(wd)));
      expect(got.recovered).toBeNull();
      expect(got.sim).toBe(sim0);
      expect(env.t - t0).toBeGreaterThanOrEqual(LOCK_TIMEOUT_MS);
      expect(env.t - t0).toBeLessThanOrEqual(LOCK_TIMEOUT_MS + 2 * RESPONSIVE_SLICE_MS); // loading never hangs
      expect(warn.mock.calls.flat().join(' ')).toMatch(/journal lock did not answer/);
    } finally {
      warn.mockRestore();
    }
  });

  it('corrupt tail (torn last chunk) → the verified prefix is replayed; journal for another snapshot → snapshot only', async () => {
    const backend = createMemoryBackend();
    const sim = real!.createSimulation(newWorld(14, 1));
    const r = rig(backend, sim);
    r.flow.beginSession(null);
    await r.flow.autosaveNow('newGame');
    await settle(r.flow);
    for (let batch = 0; batch < 3; batch++) {
      r.session.dispatch({ type: 'renameHousehold', name: `Name ${batch}` });
      for (let i = 0; i < 40; i++) sim.step();
      r.env.advance(1000);
      r.flow.tick();
      await settle(r.flow);
    }
    const keys = (await backend.list('journal:')).sort();
    expect(keys.length).toBe(3);
    const last = keys[keys.length - 1];
    const bytes = (await backend.read(last))!;
    await backend.write(last, bytes.slice(0, bytes.length - 7)); // torn write
    killPage();
    const res = await mkSaves(backend).load(r.session.autosaveSlot);
    if (!res.ok) throw new Error(res.error);
    const sim0 = real!.createSimulation(res.world);
    const r2 = rig(backend, sim0);
    const out = await r2.flow.recoverJournal(res, sim0, (w) => real!.createSimulation(w));
    expect(out.sim.state.household.name).toBe('Name 1');
    // The adopted chain is compacted at once: the torn chunk is gone after the next flush.
    r2.flow.beginSession(null);
    void r2.flow.flushJournal();
    await settle(r2.flow);

    // Wrong snapshot: same slot, different payload → nothing replayed, nothing thrown.
    const other = { ...res, payloadSha256: 'f'.repeat(64) };
    const simX = real!.createSimulation(JSON.parse(JSON.stringify(res.world)) as WorldState);
    const r3 = rig(createMemoryBackend(), simX);
    const none = await r3.flow.recoverJournal(other, simX, (w) => real!.createSimulation(w));
    expect(none.recovered).toBeNull();
    expect(none.sim).toBe(simX);
  });

  it('old saves without any journal (and fakes without payloadSha256) load exactly as before', async () => {
    const backend = createMemoryBackend();
    const saves = mkSaves(backend);
    const sim = real!.createSimulation(newWorld(15, 1));
    const meta = { householdName: 'x', memberNames: [], day: 1, timeLabel: '', funds: 0, lotValue: 0, thumbnail: null };
    expect((await saves.save('save-legacy', 'Legacy', sim.serialize(), meta)).ok).toBe(true);
    const res = await saves.load('save-legacy');
    if (!res.ok) throw new Error(res.error);
    const sim0 = real!.createSimulation(res.world);
    const r = rig(backend, sim0);
    const out = await r.flow.recoverJournal(res, sim0, (w) => real!.createSimulation(w));
    expect(out.recovered).toBeNull();
    expect(out.sim).toBe(sim0);
    const { payloadSha256: _omit, ...noSha } = res;
    expect((await r.flow.recoverJournal(noSha, sim0, (w) => real!.createSimulation(w))).recovered).toBeNull();
    expect(r.reports).toEqual([]);
  });

  it('storage cleared mid-session and quota exceeded: no crash, no toast spam; the next save re-anchors the journal', async () => {
    let quotaFull = false;
    const inner = createMemoryBackend();
    const backend: StorageBackend = {
      ...inner,
      read: (k) => inner.read(k),
      list: (p) => inner.list(p),
      remove: (k) => inner.remove(k),
      quota: () => inner.quota(),
      available: () => inner.available(),
      async write(k, d) {
        if (quotaFull && k.startsWith('journal:')) throw new StorageError('quota', 'storage full');
        return inner.write(k, d);
      },
    };
    const sim = real!.createSimulation(newWorld(16, 1));
    const r = rig(backend, sim);
    r.flow.beginSession(null);
    await r.flow.autosaveNow('newGame');
    await settle(r.flow);
    r.session.dispatch({ type: 'renameHousehold', name: 'Before clear' });
    r.env.advance(1000);
    r.flow.tick();
    await settle(r.flow);
    inner.store.clear(); // the player cleared site data in another tab
    quotaFull = true;
    for (let i = 0; i < 5; i++) {
      r.session.dispatch({ type: 'renameHousehold', name: `Full ${i}` });
      sim.step();
      r.env.advance(1000);
      r.flow.tick();
      await settle(r.flow);
    }
    expect(r.toasts).toEqual([]); // the journal is best effort: no toasts for its own failures
    quotaFull = false;
    expect(await r.flow.autosaveNow('afterClear')).toBe('saved');
    await settle(r.flow);
    r.session.dispatch({ type: 'renameHousehold', name: 'After' });
    sim.step();
    r.env.advance(1000);
    r.flow.tick();
    await settle(r.flow);
    const expected = canon(sim);
    const res = await mkSaves(backend).load(r.session.autosaveSlot);
    if (!res.ok) throw new Error(res.error);
    killPage();
    const sim0 = real!.createSimulation(res.world);
    const out = await rig(backend, sim0).flow.recoverJournal(res, sim0, (w) => real!.createSimulation(w));
    expect(out.recovered).not.toBeNull();
    expect(canon(out.sim)).toBe(expected);
  });
});

// ═════════════════════════════ the controller (fake renderer/audio, real sim + persistence) ═════════════════════════════

interface Window2 {
  game: GameControllerImpl;
  env: FakeEnv;
  win: FakeWindow;
  doc: FakeDocument;
  frame(): Promise<void>;
  until(pred: () => boolean, max?: number): Promise<void>;
  frames(n: number): Promise<void>;
}

async function openWindow(saves: SaveManager): Promise<Window2> {
  const economy = await adultEconomy(); // the journal tests rename the household with typed names
  const env = new FakeEnv();
  const win = new FakeWindow();
  const doc = new FakeDocument();
  env.window = win as unknown as Window;
  env.document = doc as unknown as Document;
  const game = createGameController({ renderer: new FakeRenderer(), audio: new FakeAudio(), saves, profile: new FakeProfile(), sim: realModule(), env, economy });
  const frame = async () => {
    env.frame(16);
    await flush(4);
    await sleep(0);
  };
  const until = async (pred: () => boolean, max = 1500) => {
    for (let i = 0; i < max && !pred(); i++) await frame();
    if (!pred()) throw new Error(`not reached; screen=${game.screen} fatal=${game.fatalError}`);
  };
  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) await frame();
  };
  void game.boot(new FakeCanvas() as unknown as HTMLCanvasElement);
  await until(() => game.screen === 'menu');
  return { game, env, win, doc, frame, until, frames };
}

async function newGame(w: Window2): Promise<void> {
  w.game.beginNewGame();
  w.game.addCazMember();
  w.env.randoms.push(0xc0ffee);
  const p = w.game.startGame();
  await w.until(() => w.game.screen === 'game');
  await p;
  await w.until(() => !w.game.saving);
}

function journalKeys(b: MemoryBackend): string[] {
  return [...b.store.keys()].filter((k) => k.startsWith('journal:'));
}

describe.skipIf(real === null)('journal × controller', () => {

  it('kill the tab well after the last autosave (no unload) → Continue restores the last actions, toasts once, saves at once', async () => {
    const backend = createMemoryBackend();
    const a = await openWindow(mkSaves(backend));
    await newGame(a);
    const sim = a.game.sim!;
    const autosaveSlot = `auto-00c0ffee`;
    a.game.setSpeed(3);
    await a.frames(120); // ~2 s of play
    a.game.renameHousehold('The Recovered');
    a.game.setMode('build');
    expect(a.game.applyBuild({ type: 'addWalls', edges: ['h:3:3', 'h:4:3'], style: 'wall_plaster_bone' })).toBeTypeOf('boolean');
    a.game.setMode('live');
    await a.frames(90); // ≤ 1 s cadence → the batch is durable
    const lastTick = sim.state.tick;
    const lastName = sim.state.household.name;
    expect(lastName).toBe('The Recovered');
    const saved = await mkSaves(backend).load(autosaveSlot);
    if (!saved.ok) throw new Error(saved.error);
    // KILL: the window is gone without beforeunload / pagehide / dispose. (Whatever saves were in flight are dropped.)
    a.game.setSpeed(0);
    a.env.frames.clear();
    expect(pageLocks.busy(`afterlife-lease:journal:${backend.id}:${autosaveSlot}`)).toBe(true); // A held the journal lock
    killPage();

    const b = await openWindow(mkSaves(backend));
    expect(await b.game.continueLatest()).toBe(true);
    await b.until(() => b.game.screen === 'game');
    const sim2 = b.game.sim!;
    expect(sim2.state.household.name).toBe(lastName);
    // Loss window: the time that ran after the last flushed batch (≤ JOURNAL_FLUSH_MS of real time).
    const lostTicks = lastTick - sim2.state.tick;
    const ticksPerSec = 8 / 0.25; // speed 3 = 8 game-min per real second
    console.info(`[journal] kill test: snapshot tick ${saved.world.tick}, live tick ${lastTick}, recovered tick ${sim2.state.tick} → lost ${lostTicks} ticks ≈ ${(lostTicks / ticksPerSec).toFixed(2)} s of real play`);
    expect(lostTicks).toBeGreaterThanOrEqual(0);
    expect(lostTicks / ticksPerSec).toBeLessThanOrEqual(1.1);
    expect(sim2.state.tick).toBeGreaterThan(saved.world.tick);
    const t = b.game.toasts.find((x) => /^Recovered/.test(x.title));
    expect(t?.title).toMatch(/^Recovered (\d+ seconds?|your last moments) of play$/);
    expect(b.game.toasts.filter((x) => /^Recovered/.test(x.title)).length).toBe(1);
    // …and the recovered world is saved immediately (the journal is rebased onto it).
    await b.until(() => !b.game.saving);
    const after = await mkSaves(backend).load(autosaveSlot);
    if (!after.ok) throw new Error(after.error);
    expect(after.world.household.name).toBe(lastName);
    expect(after.world.tick).toBeGreaterThan(saved.world.tick);
  }, 120_000);

  for (const ev of ['pagehide', 'beforeunload', 'hidden'] as const) {
    it(`${ev} flushes the journal at once — even when the autosave it also starts never lands (page killed)`, async () => {
      const backend = createMemoryBackend();
      const real = mkSaves(backend);
      let hang = false;
      const saves: SaveManager = Object.assign(Object.create(real) as SaveManager, {
        save: (...a: Parameters<SaveManager['save']>) => (hang ? new Promise<never>(() => undefined) : real.save(...a)),
      });
      const a = await openWindow(saves);
      await newGame(a);
      a.game.setSpeed(0);
      await a.frames(5);
      hang = true; // from now on no snapshot ever lands
      a.game.renameHousehold('Flush me');
      if (ev === 'hidden') {
        Object.defineProperty(a.doc, 'visibilityState', { value: 'hidden', configurable: true });
        a.doc.dispatchEvent(new Event('visibilitychange'));
      } else a.win.dispatchEvent(new Event(ev, { cancelable: true }));
      // No frames: only the event handler ran. Let the storage write settle.
      for (let i = 0; i < 20; i++) {
        await flush(4);
        await sleep(0);
      }
      let found = false;
      for (const k of journalKeys(backend)) {
        const d = decodeChunk((await backend.read(k))!, k);
        if (d.ok && d.chunk.entries.some((e) => (e.c as { name?: string } | undefined)?.name === 'Flush me')) found = true;
      }
      expect(found).toBe(true);
      // The page is killed after the event; relaunch → Continue → the rename is back.
      killPage();
      const b = await openWindow(mkSaves(backend));
      expect(await b.game.continueLatest()).toBe(true);
      expect(b.game.sim!.state.household.name).toBe('Flush me');
    }, 60_000);
  }

  it('two windows on the same world: only the lock holder journals; the other one never writes journal keys', async () => {
    const mgr = pageLocks; // both windows share the browser's lock manager (neither is killed here)
    const backend = createMemoryBackend();
    const a = await openWindow(mkSaves(backend));
    await newGame(a);
    a.game.setSpeed(3);
    await a.frames(80);
    expect(journalKeys(backend).length).toBeGreaterThan(0);
    const lockName = `afterlife-lease:journal:memory:auto-00c0ffee`;
    expect(mgr.busy(lockName)).toBe(true);
    const keysA = new Set(journalKeys(backend).map((k) => k.split(':')[2]));
    // Window B loads the same world's autosave while A is still playing it.
    const b = await openWindow(mkSaves(backend));
    expect(await b.game.loadGame('auto-00c0ffee').then((r) => r.ok)).toBe(true);
    expect(b.game.toasts.some((x) => /^Recovered/.test(x.title))).toBe(false); // A is live: B must not replay A's journal
    b.game.setSpeed(3);
    b.game.renameHousehold('Window B');
    await b.frames(80);
    const namesInJournal = async () => {
      const names: string[] = [];
      for (const k of journalKeys(backend)) {
        const d = decodeChunk((await backend.read(k))!, k);
        if (d.ok) for (const e of d.chunk.entries) if (typeof (e.c as { name?: unknown } | undefined)?.name === 'string') names.push((e.c as { name: string }).name);
      }
      return names;
    };
    expect(await namesInJournal()).not.toContain('Window B');
    // A closes (dispose releases its lock); B takes over within its retry period and journals from then on.
    a.game.dispose();
    await b.frames(260); // > JOURNAL_LOCK_RETRY_MS of game-env time
    expect(mgr.busy(lockName)).toBe(true);
    b.game.renameHousehold('Window B again');
    await b.frames(90);
    expect(await namesInJournal()).toContain('Window B again');
    // …and A's epochs? B loaded the very snapshot A's journal is anchored on, so B's first flush as the holder purges
    // them (same base); journals of other snapshots stay until B's next save.
    void keysA;
  }, 120_000);

  it('emergency crash save: the journal is flushed first and then rebased onto the emergency slot', async () => {
    const backend = createMemoryBackend();
    const a = await openWindow(mkSaves(backend));
    await newGame(a);
    a.game.setSpeed(3);
    await a.frames(30);
    a.game.renameHousehold('Crashed');
    const e = new Event('error');
    Object.assign(e, { error: new Error('kaboom'), message: 'kaboom', filename: 'http://localhost/index.js' });
    a.win.dispatchEvent(e);
    expect(a.game.fatalError).toMatch(/kaboom/);
    for (let i = 0; i < 60 && (a.game.saving || !backend.store.has('slot:emergency:primary')); i++) {
      await flush(4);
      await sleep(0);
    }
    expect(backend.store.has('slot:emergency:primary')).toBe(true);
    for (let i = 0; i < 20; i++) {
      await flush(4);
      await sleep(0);
    }
    const em = await mkSaves(backend).load('emergency');
    if (!em.ok) throw new Error(em.error);
    expect(em.world.household.name).toBe('Crashed');
    // The live journal now extends the emergency snapshot (or holds nothing yet): never an older base.
    const bases = new Set<string>();
    for (const k of journalKeys(backend)) {
      const d = decodeChunk((await backend.read(k))!, k);
      if (d.ok) bases.add(d.chunk.base.slotId);
    }
    expect([...bases].every((s) => s === 'emergency')).toBe(true);
  }, 60_000);

  it('game over, then Main menu → Continue: the last save is loaded as it is — the dead timeline is not replayed onto it', async () => {
    const backend = createMemoryBackend();
    const autosaveSlot = `auto-00c0ffee`;
    const lockName = `afterlife-lease:journal:${backend.id}:${autosaveSlot}`;
    const a = await openWindow(mkSaves(backend));
    await newGame(a);
    a.game.setSpeed(0);
    await a.frames(5);
    // Doom the household INSIDE the snapshot (a journal only replays what follows from its own snapshot): with every
    // member gone, the sim's own housekeeping ends the game on the first tick played after this save.
    a.game.renameHousehold('Doomed'); // a world-changing command, so the quit autosave below is not skipped as "unchanged"
    const doomed = a.game.sim!;
    for (const id of doomed.state.household.memberIds) doomed.state.agents[id].presence = 'gone';
    const quit1 = a.game.quitToMenu(); // autosaves: this is save A, the last save before the death
    await a.until(() => a.game.screen === 'menu');
    await quit1;
    await a.until(() => !a.game.saving);
    const saveA = await mkSaves(backend).load(autosaveSlot);
    if (!saveA.ok) throw new Error(saveA.error);
    expect(saveA.world.household.name).toBe('Doomed');
    expect(saveA.world.gameOver).toBe(false);
    // Continue from A and let the household die: game over (no save is ever written at game over, by design).
    expect(await a.game.continueLatest()).toBe(true);
    expect(a.game.screen).toBe('game');
    a.game.setSpeed(1);
    await a.until(() => a.game.screen === 'gameOver');
    await a.frames(90); // the game-over screen keeps pumping the journal (≤ 1 s cadence): the death tick is durable
    const quit2 = a.game.quitToMenu(); // "Main menu" on the game-over screen
    await a.until(() => a.game.screen === 'menu');
    await quit2;
    await a.frames(5); // the dead session is torn down: its journal lock is free again
    expect(pageLocks.busy(lockName)).toBe(false);
    const stillA = await mkSaves(backend).load(autosaveSlot);
    if (!stillA.ok) throw new Error(stillA.error);
    expect(stillA.payloadSha256).toBe(saveA.payloadSha256); // the slot still holds save A
    // Continue again: the player must get save A back, not "Rest in Pieces" replayed on top of it.
    expect(await a.game.continueLatest()).toBe(true);
    expect(a.game.screen).toBe('game');
    expect(a.game.sim!.state.gameOver).toBe(false);
    expect(a.game.sim!.state.tick).toBe(saveA.world.tick);
    expect(a.game.toasts.some((x) => /^Recovered/.test(x.title))).toBe(false); // nothing "closed unexpectedly"
  }, 120_000);

  it('game over with the death NOT yet flushed, then a kill: Continue loads the last save as it is, not the doomed tail', async () => {
    // recover() can only see a game over that reached the journal. A death after the last flush leaves a journal whose
    // replay ends just before it: without the game-over clear, Continue "recovers" the player into a doomed world.
    const backend = createMemoryBackend();
    const autosaveSlot = `auto-00c0ffee`;
    const a = await openWindow(mkSaves(backend));
    await newGame(a);
    a.game.setSpeed(0);
    await a.frames(5);
    a.game.renameHousehold('Doomed');
    const doomed = a.game.sim!;
    for (const id of doomed.state.household.memberIds) doomed.state.agents[id].presence = 'gone';
    const quit1 = a.game.quitToMenu(); // save A
    await a.until(() => a.game.screen === 'menu');
    await quit1;
    await a.until(() => !a.game.saving);
    const saveA = await mkSaves(backend).load(autosaveSlot);
    if (!saveA.ok) throw new Error(saveA.error);
    expect(await a.game.continueLatest()).toBe(true);
    a.game.setSpeed(0);
    a.game.renameHousehold('Late'); // a journaled command after save A ...
    await a.frames(30); // ... flushed (past the 250 ms command flush)
    expect(journalKeys(backend).length).toBeGreaterThan(0);
    a.game.setSpeed(1);
    await a.until(() => a.game.screen === 'gameOver');
    await a.frames(1);
    // KILL right at the game-over screen: no unload, no save, no further journal pump.
    a.game.setSpeed(0);
    a.env.frames.clear();
    killPage();
    expect(journalKeys(backend)).toEqual([]); // the finished timeline left no journal behind

    const b = await openWindow(mkSaves(backend));
    expect(await b.game.continueLatest()).toBe(true);
    await b.until(() => b.game.screen === 'game');
    expect(b.game.sim!.state.household.name).toBe('Doomed');
    expect(b.game.sim!.state.tick).toBe(saveA.world.tick);
    expect(b.game.toasts.some((x) => /^Recovered/.test(x.title))).toBe(false);
  }, 120_000);

  it('game over while a journal chunk write is still in flight: the clear must not be overtaken by it', async () => {
    const inner = createMemoryBackend();
    let gate: Promise<void> | null = null;
    let open: () => void = () => undefined;
    const backend: MemoryBackend = Object.assign(Object.create(inner) as MemoryBackend, {
      async write(k: string, d: Uint8Array) {
        const g = k.startsWith('journal:') ? gate : null;
        if (g) await g;
        return inner.write(k, d);
      },
    });
    const autosaveSlot = `auto-00c0ffee`;
    const a = await openWindow(mkSaves(backend));
    await newGame(a);
    a.game.setSpeed(0);
    await a.frames(5);
    a.game.renameHousehold('Doomed');
    const doomed = a.game.sim!;
    for (const id of doomed.state.household.memberIds) doomed.state.agents[id].presence = 'gone';
    const quit1 = a.game.quitToMenu(); // save A
    await a.until(() => a.game.screen === 'menu');
    await quit1;
    await a.until(() => !a.game.saving);
    const saveA = await mkSaves(backend).load(autosaveSlot);
    if (!saveA.ok) throw new Error(saveA.error);
    expect(await a.game.continueLatest()).toBe(true);
    a.game.setSpeed(0);
    await a.frames(30);
    gate = new Promise<void>((r) => (open = r)); // storage is slow from here on
    a.game.renameHousehold('Late'); // a journaled command after save A: its chunk write starts and stalls
    await a.frames(30);
    a.game.setSpeed(1);
    await a.until(() => a.game.screen === 'gameOver'); // the clear runs while that write is in flight
    await a.frames(5);
    gate = null;
    open(); // the stalled write lands now
    await a.frames(5);
    a.game.setSpeed(0);
    a.env.frames.clear();
    killPage();
    expect(journalKeys(inner)).toEqual([]); // the finished timeline left no journal behind

    const b = await openWindow(mkSaves(inner));
    expect(await b.game.continueLatest()).toBe(true);
    await b.until(() => b.game.screen === 'game');
    expect(b.game.sim!.state.household.name).toBe('Doomed');
    expect(b.game.sim!.state.tick).toBe(saveA.world.tick);
  }, 120_000);

  it('…also when the player leaves the game-over screen at once (inside the 1 s journal cadence): the death itself is durable', async () => {
    const backend = createMemoryBackend();
    const autosaveSlot = `auto-00c0ffee`;
    const a = await openWindow(mkSaves(backend));
    await newGame(a);
    a.game.setSpeed(0);
    await a.frames(5);
    a.game.renameHousehold('Doomed');
    const doomed = a.game.sim!;
    for (const id of doomed.state.household.memberIds) doomed.state.agents[id].presence = 'gone';
    const quit1 = a.game.quitToMenu(); // save A: the last save before the death
    await a.until(() => a.game.screen === 'menu');
    await quit1;
    await a.until(() => !a.game.saving);
    const saveA = await mkSaves(backend).load(autosaveSlot);
    if (!saveA.ok) throw new Error(saveA.error);
    expect(await a.game.continueLatest()).toBe(true);
    expect(a.game.screen).toBe('game');
    // One command on save A's tick, flushed by the 250 ms command flush: the journal now holds an entry BEFORE the death.
    a.game.renameHousehold('Last words');
    await a.frames(20);
    a.game.setSpeed(3);
    let n = 0;
    while (a.game.screen !== 'gameOver' && n < 1500) {
      await a.frame();
      n++;
    }
    expect(a.game.screen).toBe('gameOver');
    expect(n).toBeLessThan(45); // the death lands inside one 1 s journal cadence after that flush
    const quit2 = a.game.quitToMenu(); // "Main menu" right away
    await a.until(() => a.game.screen === 'menu');
    await quit2;
    await a.frames(5);
    expect(await a.game.continueLatest()).toBe(true);
    expect(a.game.screen).toBe('game');
    expect(a.game.sim!.state.gameOver).toBe(false);
    expect(a.game.sim!.state.tick).toBe(saveA.world.tick);
    expect(a.game.sim!.state.household.name).toBe('Doomed');
    expect(a.game.toasts.some((x) => /^Recovered/.test(x.title))).toBe(false);
  }, 120_000);

  it('reloading the anchor save in the same window, then a kill: Continue restores the play after the reload, not the abandoned timeline', async () => {
    const backend = createMemoryBackend();
    const autosaveSlot = `auto-00c0ffee`;
    const a = await openWindow(mkSaves(backend));
    await newGame(a); // autosave A; the journal is anchored on it
    a.game.setSpeed(3);
    a.game.renameHousehold('OLD');
    await a.frames(600); // ~10 s on the timeline the player is about to abandon (the rename + one marker per second)
    // The player reloads the autosave from the pause menu: same window, so the replaced session still holds the lock.
    expect((await a.game.loadGame(autosaveSlot)).ok).toBe(true);
    await a.until(() => a.game.screen === 'game');
    expect(a.game.sim!.state.household.name).not.toBe('OLD'); // back on save A
    a.game.setSpeed(3);
    a.game.renameHousehold('NEW');
    await a.frames(300); // ~5 s: past JOURNAL_LOCK_RETRY_MS (the new session journals), but shorter than the old timeline
    expect(a.game.sim!.state.household.name).toBe('NEW');
    // KILL: no unload, no save.
    a.game.setSpeed(0);
    a.env.frames.clear();
    expect(pageLocks.busy(`afterlife-lease:journal:${backend.id}:${autosaveSlot}`)).toBe(true);
    killPage();

    const b = await openWindow(mkSaves(backend));
    expect(await b.game.continueLatest()).toBe(true);
    await b.until(() => b.game.screen === 'game');
    expect(b.game.sim!.state.household.name).toBe('NEW');
  }, 120_000);

  it('…and a kill within a second of that reload (before the 3 s lock retry) does not bring the abandoned timeline back either', async () => {
    const backend = createMemoryBackend();
    const autosaveSlot = `auto-00c0ffee`;
    const a = await openWindow(mkSaves(backend));
    await newGame(a);
    a.game.setSpeed(3);
    a.game.renameHousehold('OLD');
    await a.frames(300); // ~5 s on the timeline about to be abandoned
    expect((await a.game.loadGame(autosaveSlot)).ok).toBe(true);
    await a.until(() => a.game.screen === 'game');
    a.game.setSpeed(3);
    a.game.renameHousehold('NEW');
    await a.frames(40); // ~0.6 s: far inside JOURNAL_LOCK_RETRY_MS, past the 250 ms command flush
    // KILL: no unload, no save.
    a.game.setSpeed(0);
    a.env.frames.clear();
    killPage();

    const b = await openWindow(mkSaves(backend));
    expect(await b.game.continueLatest()).toBe(true);
    await b.until(() => b.game.screen === 'game');
    expect(b.game.sim!.state.household.name).toBe('NEW');
  }, 120_000);

  it('…also when the lock manager answers a refused request late (a real browser: a cross-process round trip), so the eager try is still in flight at the hand-off', async () => {
    pageLocks = installLocks(new SlowRefusalLocks());
    const backend = createMemoryBackend();
    const autosaveSlot = `auto-00c0ffee`;
    const a = await openWindow(mkSaves(backend));
    await newGame(a);
    a.game.setSpeed(3);
    a.game.renameHousehold('OLD');
    await a.frames(300); // ~5 s on the timeline about to be abandoned
    const refusedBefore = pageLocks.refusedFast;
    expect((await a.game.loadGame(autosaveSlot)).ok).toBe(true);
    await a.until(() => a.game.screen === 'game');
    a.game.setSpeed(3);
    a.game.renameHousehold('NEW');
    await a.frames(40); // ~0.6 s: far inside JOURNAL_LOCK_RETRY_MS, past the 250 ms command flush
    expect(pageLocks.refusedFast).toBeGreaterThan(refusedBefore); // the eager try did meet the replaced session's lock
    // KILL: no unload, no save.
    a.game.setSpeed(0);
    a.env.frames.clear();
    killPage();

    const b = await openWindow(mkSaves(backend));
    expect(await b.game.continueLatest()).toBe(true);
    await b.until(() => b.game.screen === 'game');
    expect(b.game.sim!.state.household.name).toBe('NEW');
  }, 120_000);
  it('the old lock is let go only after the 4 s fast-retry window, while a 3 s retry is still waiting for its refusal: the hand-off is not swallowed', async () => {
    const locks = new GatedLocks();
    pageLocks = installLocks(locks);
    const backend = createMemoryBackend();
    const autosaveSlot = `auto-00c0ffee`;
    const a = await openWindow(mkSaves(backend));
    await newGame(a);
    a.game.setSpeed(3);
    a.game.renameHousehold('OLD');
    await a.frames(300); // ~5 s on the timeline about to be abandoned
    const releaseOld = locks.stallRelease(); // the browser frees the replaced session's lock slowly
    expect((await a.game.loadGame(autosaveSlot)).ok).toBe(true);
    await a.until(() => a.game.screen === 'game');
    a.game.setSpeed(3);
    a.game.renameHousehold('NEW');
    await a.frames(300); // ~4.8 s: past JOURNAL_LOCK_FAST_RETRY_WINDOW_MS; every retry so far was refused
    const answerRefusals = locks.holdRefusals();
    const before = locks.refusedFast;
    for (let i = 0; i < 400 && locks.refusedFast === before; i++) await a.frame(); // a 3 s retry is now in flight
    expect(locks.refusedFast).toBeGreaterThan(before);
    releaseOld(); // the old lock is free now: the hand-off fires
    await a.frames(3);
    answerRefusals(); // ... and only then the in-flight retry's (stale) refusal arrives
    await a.frames(60); // ~1 s: far less than the 3 s retry interval
    a.game.setSpeed(0);
    a.env.frames.clear();
    killPage();

    const b = await openWindow(mkSaves(backend));
    expect(await b.game.continueLatest()).toBe(true);
    await b.until(() => b.game.screen === 'game');
    expect(b.game.sim!.state.household.name).toBe('NEW');
  }, 120_000);
});

/** Journal-lock release that can be stalled, and ifAvailable refusals that can be held back (both: a slow lock manager). */
class GatedLocks extends FakeLockManager {
  private releaseGate: Promise<void> | null = null;
  private refusalGate: Promise<void> | null = null;
  stallRelease(): () => void {
    let open!: () => void;
    this.releaseGate = new Promise<void>((r) => (open = r));
    return () => {
      this.releaseGate = null;
      open();
    };
  }
  holdRefusals(): () => void {
    let open!: () => void;
    this.refusalGate = new Promise<void>((r) => (open = r));
    return () => {
      this.refusalGate = null;
      open();
    };
  }
  override request<T>(name: string, options: { mode: 'exclusive'; signal?: AbortSignal; ifAvailable?: boolean }, cb: (lock: unknown) => Promise<T>): Promise<T> {
    if (options.ifAvailable && this.busy(name)) {
      this.refusedFast++;
      const gate = this.refusalGate;
      return (async () => {
        await Promise.resolve();
        if (gate) await gate;
        return cb(null);
      })();
    }
    if (!name.startsWith('afterlife-lease:journal:')) return super.request(name, options, cb);
    return super.request(name, options, async (l) => {
      const r = await cb(l);
      const g = this.releaseGate;
      if (g) await g;
      return r;
    });
  }
}

/**
 * Web Locks answering like a real browser's lock manager: an `ifAvailable` request is decided when it arrives (lock
 * taken → refused), but the refusal reaches the page a few event-loop turns later, not in the same microtask.
 */
class SlowRefusalLocks extends FakeLockManager {
  override request<T>(name: string, options: { mode: 'exclusive'; signal?: AbortSignal; ifAvailable?: boolean }, cb: (lock: unknown) => Promise<T>): Promise<T> {
    if (options.ifAvailable && this.busy(name)) {
      this.refusedFast++;
      return (async () => {
        for (let i = 0; i < 8; i++) await sleep(0);
        return cb(null);
      })();
    }
    return super.request(name, options, cb);
  }
}

describe('journal: event-driven saves', () => {
  it('saveSoon is debounced, spaced ≥ 10 s from the previous autosave, and fires for build-mode exit / purchases / day rollover', async () => {
    const { FakeSaves, FakeSim, makeWorld } = await import('./fakes');
    const saves = new FakeSaves();
    const env = new FakeEnv();
    const sim = new FakeSim(makeWorld({ seed: 0xbeef }));
    const session = new GameSession(sim, { loadedFrom: null, playMinutesBase: 0 }, () => undefined);
    const host: SaveFlowHost = {
      env,
      renderer: new FakeRenderer(),
      saves,
      session: () => session,
      screen: () => 'game',
      settings: () => ({ ...DEFAULT_SETTINGS, autosaveMinutes: 0 }),
      choicePending: () => false,
      toast: () => undefined,
      sfx: () => undefined,
      report: () => undefined,
      changed: () => undefined,
    };
    const flow = new SaveFlow(host);
    flow.beginSession(null);
    const run = async (ms: number) => {
      for (let t = 0; t < ms; t += 100) {
        env.advance(100);
        flow.tick();
        await flush(6);
      }
    };
    expect(await flow.autosaveNow('newGame')).toBe('saved');
    const n0 = saves.saveCalls.length;
    // A burst of events right after a save: ONE save, not before 10 s after the previous one.
    sim.state.tick++;
    flow.saveSoon('purchase');
    flow.saveSoon('quest');
    flow.saveSoon('caz');
    await run(9_000);
    expect(saves.saveCalls.length).toBe(n0);
    await run(1_500);
    expect(saves.saveCalls.length).toBe(n0 + 1);
    // Build-mode exit (endBuildSession) → a save after the debounce.
    await run(10_000);
    sim.state.tick++;
    session.dispatch({ type: 'endBuildSession' });
    await run(1_000);
    expect(saves.saveCalls.length).toBe(n0 + 1);
    await run(1_000);
    expect(saves.saveCalls.length).toBe(n0 + 2);
    // Nothing changed → the event save is skipped (idempotent), no write.
    await run(10_000);
    flow.saveSoon('purchase');
    await run(3_000);
    expect(saves.saveCalls.length).toBe(n0 + 2);
    // Day rollover.
    await run(10_000);
    sim.state.tick += 24 * 60 * 4;
    await run(3_000);
    expect(saves.saveCalls.length).toBe(n0 + 3);
    // Purchases (buyReward ok) through the session.
    await run(10_000);
    sim.dispatch = (() => ({ ok: true })) as typeof sim.dispatch;
    session.dispatch({ type: 'buyReward', agentId: 'a1', rewardId: 'r1' });
    await run(3_000);
    expect(saves.saveCalls.length).toBe(n0 + 4);
    // Hammering saveSoon for a minute: at most one save per 10 s.
    const before = saves.saveCalls.length;
    for (let s = 0; s < 60; s++) {
      sim.state.tick++;
      flow.saveSoon('spam');
      await run(1_000);
    }
    expect(saves.saveCalls.length - before).toBeLessThanOrEqual(6);
    expect(saves.saveCalls.length - before).toBeGreaterThanOrEqual(5);
  });

  it('the controller exposes saveSoon(reason) and the router turns questCompleted into one', async () => {
    const { startedHarness } = await import('./controllerHarness');
    const h = await startedHarness();
    const n0 = h.saves.saveCalls.length;
    expect(typeof h.game.saveSoon).toBe('function');
    h.gameSim().state.tick++;
    h.game.saveSoon!('purchase');
    await h.frames(800); // 12.8 s
    expect(h.saves.saveCalls.length).toBe(n0 + 1);
    h.gameSim().state.tick++;
    h.gameSim().events.push({ type: 'questCompleted', questId: 'q', instance: 1, grantId: 'g', title: 'Done', grant: {} as never });
    await h.frames(800);
    expect(h.saves.saveCalls.length).toBe(n0 + 2);
    expect(h.saves.saveCalls[h.saves.saveCalls.length - 1].opts?.autosave).toBe(true);
  });
});

describe.skipIf(real === null)('journal: slot deletion', () => {
  it("deleting a world's autosave slot drops that world's journal (but never the live world's)", async () => {
    const backend = createMemoryBackend();
    const simA = real!.createSimulation(newWorld(21, 1));
    const a = rig(backend, simA);
    a.flow.beginSession(null);
    await a.flow.autosaveNow('newGame');
    await settle(a.flow);
    a.session.dispatch({ type: 'renameHousehold', name: 'A' });
    a.env.advance(1000);
    a.flow.tick();
    await settle(a.flow);
    const nsA = a.session.autosaveSlot;
    expect((await backend.list(`journal:${nsA}:`)).length).toBeGreaterThan(0);
    // Deleting the LIVE world's autosave keeps its journal (it still extends the in-memory chain).
    await a.flow.remove(nsA);
    await settle(a.flow);
    expect((await backend.list(`journal:${nsA}:`)).length).toBeGreaterThan(0);
    a.end();
    await settle(a.flow);
    // From another session (world B), deleting world A's autosave removes A's journal.
    const simB = real!.createSimulation(newWorld(22, 1));
    const b = rig(backend, simB);
    b.flow.beginSession(null);
    await b.flow.remove(nsA);
    for (let i = 0; i < 20; i++) await settle(b.flow, 2);
    expect(await backend.list(`journal:${nsA}:`)).toEqual([]);
  });
});

// keep helpers referenced (tsc noUnusedLocals in tests)
void encodeChunk;
void chainEntries;
void genesisHash;
void vi;
