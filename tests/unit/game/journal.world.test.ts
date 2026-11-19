/**
 * W-119 journal × the W-025 schema v2 boundary, on the REAL SaveFlow / JournalFlow / SaveManager / engine (the same
 * rig as journal.test.ts): a schema-v1 save + its v1 journal (written by the pre-world build) is loaded, migrated,
 * recovered, opened with the journaled `townExpand` (exactly the order lifecycle.loadGame uses), played on, saved as
 * schema v2 (two-phase rebase: mark → stage → committed) and killed — at two points:
 *   A. after the v2 save landed: the v2 snapshot + its journal replay byte-identically to the live world;
 *   B. before any v2 save landed: the v1 snapshot is migrated again and the journal — v1 entries, then `townExpand`,
 *      then the new commands — replays byte-identically, with the expansion at the same tick.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES } from '../../../src/sim/index';
import { SAVE_SCHEMA_VERSION } from '../../../src/sim/types';
import { createGameController } from '../../../src/game/controller';
import { FakeAudio, FakeProfile } from './fakes';
import { FakeCanvas, FakeDocument, FakeWindow } from './controllerHarness';
import type { SimulationAPI } from '../../../src/sim/contracts';
import type { SaveManager, StorageBackend } from '../../../src/persistence/contracts';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { noLocks } from '../../../src/persistence/locks';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { SaveFlow, type SaveFlowHost } from '../../../src/game/saveFlow';
import { GameSession } from '../../../src/game/session';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { FakeEnv, FakeRenderer, flush } from './fakes';
import { FakeLockManager } from '../persistence/fakeWebLocks';
import { ac1Command } from '../world/ac1Harness';
import { backendOf, fixture } from '../world/v1Fixtures';

const silent = { warn: () => undefined, error: () => undefined };
const hostNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function installLocks(): void {
  Object.defineProperty(globalThis, 'navigator', { value: { locks: new FakeLockManager() }, configurable: true, writable: true });
}
/** The page that held the locks is gone (killed tab): the browser frees its locks. */
const killPage = installLocks;
beforeEach(installLocks);
afterEach(() => {
  if (hostNavigator) Object.defineProperty(globalThis, 'navigator', hostNavigator);
  else delete (globalThis as { navigator?: unknown }).navigator;
});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mkSaves(backend: StorageBackend): SaveManager {
  return new SaveManagerImpl({ backend, compress: false, logger: silent, locks: noLocks, repair: engineRepairHook() });
}

/** One "page": a SaveFlow over real persistence whose session is set once the world is entered. */
function page(backend: StorageBackend, snapshotSaves?: SaveManager) {
  const env = new FakeEnv();
  const saves = mkSaves(backend);
  const reports: string[] = [];
  const toasts: string[] = [];
  let live: GameSession | null = null;
  const host: SaveFlowHost = {
    env,
    renderer: new FakeRenderer(),
    saves: snapshotSaves ?? saves,
    session: () => live,
    screen: () => 'game',
    settings: () => ({ ...DEFAULT_SETTINGS, autosaveMinutes: 0 }),
    choicePending: () => false,
    toast: (_k, t) => toasts.push(t),
    sfx: () => undefined,
    report: (w) => reports.push(w),
    changed: () => undefined,
  };
  const flow = new SaveFlow(host);
  return {
    env,
    saves,
    flow,
    reports,
    toasts,
    /** load → createSimulation → recoverJournal → enter (beginSession) → townExpand if pending: lifecycle.loadGame's order. */
    async open(slotId: string): Promise<{ session: GameSession; recovered: number; expanded: boolean; loadedTick: number }> {
      const res = await saves.load(slotId);
      if (!res.ok) throw new Error(res.error);
      expect(res.warnings).toEqual([]);
      const loadedTick = res.world.tick; // (createSimulation + replay advance res.world in place)
      const sim0 = createSimulation(res.world);
      const out = await flow.recoverJournal(res, sim0, (w) => createSimulation(w));
      if (out.recovered) expect(out.recovered.dropped).toBe(0);
      live = new GameSession(out.sim, { loadedFrom: slotId, playMinutesBase: res.info.playMinutes }, (w, e) => reports.push(`${w}: ${String(e)}`));
      flow.beginSession(res.info);
      let expanded = false;
      if (live.sim.state.town?.expandPending === true) expanded = live.dispatch({ type: 'townExpand' }).ok;
      return { session: live, recovered: out.recovered?.entries ?? 0, expanded, loadedTick };
    },
  };
}

/** Quiet = no save job and no journal write in flight (journalOnly: ignore snapshot saves that never land). */
async function settle(flow: SaveFlow, journalOnly = false): Promise<void> {
  let quiet = 0;
  const t0 = performance.now();
  for (let i = 0; quiet < 3 || i < 3; i++) {
    await flush(4);
    await sleep(0);
    const w = flow.journal.active;
    const busy = (!journalOnly && (flow.saving || flow.autosave.busy)) || (!!w && w.busy);
    quiet = busy ? 0 : quiet + 1;
    if (performance.now() - t0 > 60_000) throw new Error('settle: the write queue never drained');
  }
}

/** Play `ticks` with the AC-1 scripted player through the session (journaled), flushing at the game's cadence. */
async function play(p: ReturnType<typeof page>, sim: SimulationAPI, session: GameSession, ticks: number, journalOnly = false): Promise<number> {
  let commands = 0;
  for (let i = 0; i < ticks; i++) {
    const c = ac1Command(sim, sim.state.tick + 13); // offset: a different slice of the script than the fixture's
    if (c && c.type !== 'renameHousehold') {
      session.dispatch(c);
      commands++;
    }
    if (i % 97 === 50) {
      session.dispatch({ type: 'queue', actorId: sim.state.household.memberIds[0], interactionId: 'engine_goHere', target: { kind: 'tile', x: 3 + (i % 20), z: 22 } });
      commands++;
    }
    sim.step();
    if ((i & 63) === 0) sim.drainEvents();
    if (i % 30 === 0) {
      p.env.advance(250);
      p.flow.tick();
      await flush(2);
    }
  }
  p.env.advance(1000);
  p.flow.tick();
  await settle(p.flow, journalOnly);
  return commands;
}

describe('W-119 journal across the schema v1 → v2 save boundary', () => {
  it('A: v1 save + v1 journal → migrate, recover, townExpand, play, v2 save (rebase), play, kill → byte-identical recovery', async () => {
    const f = fixture('starter+journal');
    const backend = backendOf(f);
    // after the mid-play v2 save no snapshot lands any more (the last stretch comes back from the journal alone)
    const real = mkSaves(backend);
    let hang = false;
    const gated: SaveManager = Object.assign(Object.create(real) as SaveManager, {
      save: (...args: Parameters<SaveManager['save']>) => (hang ? new Promise<never>(() => undefined) : real.save(...args)),
    });
    const a = page(backend, gated);
    const { session, recovered, expanded } = await a.open(f.slotId);
    expect(recovered).toBeGreaterThan(0); // the v1 journal replayed
    expect(expanded).toBe(true);
    const sim = session.sim;
    expect(sim.state.tick).toBe(f.journal!.endTick);
    await settle(a.flow); // the "recovered" autosave (beginSession) lands: the slot now holds a v2 snapshot
    const mid = await mkSaves(backend).load(f.slotId);
    if (!mid.ok) throw new Error(mid.error);
    expect(mid.world.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    let commands = await play(a, sim, session, 600);
    expect(await a.flow.autosaveNow('mid')).toBe('saved'); // explicit v2 save in the middle of play
    await settle(a.flow);
    hang = true;
    commands += await play(a, sim, session, 900, true);
    expect(commands).toBeGreaterThan(10);
    expect(a.reports).toEqual([]);
    const expected = canonicalJson(sim.serialize());
    expect(sim.state.town?.expandPending).toBe(false);

    killPage();
    const b = page(backend);
    const reopened = await b.open(f.slotId);
    expect(reopened.loadedTick).toBeLessThan(sim.state.tick); // an older v2 snapshot + the journal
    expect(reopened.recovered).toBeGreaterThan(0);
    expect(reopened.expanded).toBe(false); // already open in the v2 snapshot: no second townExpand
    expect(canonicalJson(reopened.session.sim.serialize())).toBe(expected);
    expect(b.reports).toEqual([]);
  }, 180_000);

  it('B: killed before any v2 save landed → the v1 snapshot migrates again and the journal (v1 entries, townExpand, new commands) replays exactly', async () => {
    const f = fixture('derelict+journal');
    const backend = backendOf(f);
    // block every snapshot write from this page (the kill happens before a v2 snapshot exists)
    const real = mkSaves(backend);
    const blocked: SaveManager = Object.assign(Object.create(real) as SaveManager, { save: () => new Promise<never>(() => undefined) });
    const a = page(backend, blocked);
    const { session, expanded } = await a.open(f.slotId);
    expect(expanded).toBe(true);
    const sim = session.sim;
    const expandTick = sim.state.tick;
    const commands = await play(a, sim, session, 900, true);
    expect(commands).toBeGreaterThan(5);
    const expected = canonicalJson(sim.serialize());
    const still = await real.load(f.slotId);
    expect(still.ok && still.world.tick).toBe(f.snapshotTick); // still the v1 snapshot (migrated on load)

    killPage();
    const b = page(backend);
    const res = await b.saves.load(f.slotId);
    if (!res.ok) throw new Error(res.error);
    expect(res.world.town?.expandPending).toBe(true);
    const sim0 = createSimulation(res.world);
    const out = await b.flow.recoverJournal(res, sim0, (w) => createSimulation(w));
    expect(out.recovered).not.toBeNull();
    expect(out.recovered!.dropped).toBe(0);
    expect(out.recovered!.stopped).toBeNull();
    expect(out.sim.state.town?.expandPending).toBe(false); // townExpand came back from the journal...
    expect(canonicalJson(out.sim.serialize())).toBe(expected); // ...at the same tick: byte-identical
    expect(expandTick).toBe(f.journal!.endTick);
  }, 180_000);

  it('the real game path: Continue on a v1 save + journal → migrated, recovered, opened by the journaled townExpand, no "Save recovered" warning', async () => {
    const f = fixture('empty+journal');
    const backend = backendOf(f);
    const env = new FakeEnv();
    const win = new FakeWindow();
    env.window = win as unknown as Window;
    env.document = new FakeDocument() as unknown as Document;
    const game = createGameController({ renderer: new FakeRenderer(), audio: new FakeAudio(), saves: mkSaves(backend), profile: new FakeProfile(), sim: { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES }, env });
    const frame = async () => {
      env.frame(16);
      await flush(4);
      await sleep(0);
    };
    const until = async (pred: () => boolean) => {
      for (let i = 0; i < 1500 && !pred(); i++) await frame();
      if (!pred()) throw new Error(`not reached; screen=${game.screen} fatal=${game.fatalError}`);
    };
    void game.boot(new FakeCanvas() as unknown as HTMLCanvasElement);
    await until(() => game.screen === 'menu');
    expect(await game.continueLatest()).toBe(true);
    await until(() => game.screen === 'game');
    const sim = game.sim!;
    expect(sim.state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(sim.state.town?.homeLotId).toBe('wormwood:mildew_n2');
    expect(sim.state.town?.expandPending).toBe(false); // opened right after recovery
    expect(sim.state.tick).toBe(f.journal!.endTick); // the v1 journal came back
    expect(game.toasts.filter((t) => /Save recovered|Save repaired/.test(t.title))).toEqual([]);
    expect(game.toasts.filter((t) => /^Recovered/.test(t.title)).length).toBe(1);
    await until(() => !game.saving);
    for (let i = 0; i < 40; i++) await frame();
    const saved = await mkSaves(backend).load(f.slotId);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.world.schemaVersion).toBe(SAVE_SCHEMA_VERSION); // current snapshot, journal rebased
    expect(game.fatalError).toBeNull();
  }, 120_000);
});
