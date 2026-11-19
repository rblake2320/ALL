/**
 * Adversarial save-pipeline tests (independent hardening pass): hung storage, cross-session completions, idempotency
 * holes, deleting the live autosave, snapshot consistency, duplicate requests, sync-throwing profile stores and
 * Windows export names. Each test names the failure it guards against.
 */
import { describe, expect, it } from 'vitest';
import { AutosaveScheduler } from '../../../src/game/autosave';
import { ProfileWriter } from '../../../src/game/profile';
import { SAVE_JOB_TIMEOUT_MS, SerialQueue, sanitizeFilename } from '../../../src/game/saves';
import type { ProfileStore } from '../../../src/persistence/contracts';
import { timeInfo } from '../../../src/sim/time';
import { createHarness, startedHarness } from './controllerHarness';
import { flush } from './fakes';

/** Advance the fake clock in big steps (frames keep the driver + timers running). */
async function elapse(h: { frames(n: number, ms?: number): Promise<void> }, ms: number): Promise<void> {
  const step = 250;
  await h.frames(Math.ceil(ms / step), step);
}

describe('AutosaveScheduler — a completion from a previous session never leaks into the next', () => {
  it('a write that settles after reset() does not mark the new session as saved', async () => {
    let now = 0;
    let sig = 'A:40';
    let release!: (ok: boolean) => void;
    const s = new AutosaveScheduler({
      now: () => now,
      intervalMs: () => 60_000,
      canAutosave: () => true,
      signature: () => sig,
      write: () => new Promise<boolean>((r) => (release = r)),
    });
    const first = s.trigger('quit');
    await flush();
    s.reset(null); // new session begins while the old write is still in flight
    sig = 'A:40'; // identical-looking signature in the new world
    now = 5_000;
    release(true);
    expect(await first).toBe('saved');
    await flush();
    expect(s.dirty()).toBe(true); // the new world was never written
  });

  it('a follow-up queued by the old session is dropped on reset (the new session schedules its own)', async () => {
    let release!: (ok: boolean) => void;
    let writes = 0;
    const s = new AutosaveScheduler({
      now: () => 0,
      intervalMs: () => 60_000,
      canAutosave: () => true,
      signature: () => 'x',
      write: () => {
        writes++;
        return new Promise<boolean>((r) => (release = r));
      },
    });
    void s.trigger('a');
    const follow = s.trigger('b'); // coalesced follow-up of the OLD session
    s.reset(null);
    expect(await follow).toBe('skipped');
    release(true);
    await flush();
    expect(writes).toBe(1);
  });
});

describe('SerialQueue / SaveFlow — hung storage can never block saving forever', () => {
  it('a job that never settles is abandoned after the watchdog and later jobs still run', async () => {
    const timers: { at: number; cb: () => void }[] = [];
    let now = 0;
    const q = new SerialQueue({
      setTimeout: (cb, ms) => {
        const t = { at: now + ms, cb };
        timers.push(t);
        return t;
      },
      clearTimeout: (h) => {
        const i = timers.indexOf(h as (typeof timers)[number]);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    const hung = q.run(() => new Promise<string>(() => undefined), () => 'timed out');
    const next = q.run(async () => 'ran');
    now += SAVE_JOB_TIMEOUT_MS + 1;
    for (const t of timers.splice(0)) if (t.at <= now) t.cb();
    expect(await hung).toBe('timed out');
    expect(await next).toBe('ran');
    expect(q.busy).toBe(false);
  });

  it('in game: one hung write does not stop the next manual save from completing', async () => {
    const h = await startedHarness();
    h.saves.hangSaves = 1;
    h.gameSim().state.tick += 50;
    const first = h.game.saveGame();
    let firstResult: Awaited<typeof first> | null = null;
    void first.then((r) => (firstResult = r));
    await elapse(h, SAVE_JOB_TIMEOUT_MS + 1000);
    expect(firstResult).not.toBeNull();
    expect(firstResult!.ok).toBe(false);
    h.gameSim().state.tick += 50;
    const second = await h.game.saveGame();
    expect(second.ok).toBe(true);
    expect(h.game.saving).toBe(false);
  });

  it('a thumbnail re-encode that never resolves cannot hold the save (saved without a thumbnail)', async () => {
    const h = await startedHarness();
    h.renderer.snapshotValue = `data:image/png;base64,${'A'.repeat(70_000)}`;
    h.env.reencode = () => new Promise<string | null>(() => undefined);
    h.gameSim().state.tick += 10;
    let res: Awaited<ReturnType<typeof h.game.saveGame>> | null = null;
    void h.game.saveGame().then((r) => (res = r));
    await elapse(h, 6_000);
    expect(res).not.toBeNull();
    expect(res!.ok).toBe(true);
    expect(h.saves.saveCalls.at(-1)!.meta.thumbnail).toBeNull();
  });
});

describe('autosave across sessions — no data loss after a hung save and a forced quit', () => {
  it('a hung save from game A that completes during game B does not make B "already saved"', async () => {
    const h = await startedHarness();
    const simA = h.gameSim();
    simA.state.tick = 40;
    h.saves.hangSaves = 0;
    const releaseA = h.saves.hold(); // A's quit save hangs (slow disk)
    void h.game.quitToMenu();
    await elapse(h, 11_000); // quit save times out → game stays open
    expect(h.game.screen).toBe('game');
    void h.game.quitToMenu(); // second quit within 30 s leaves without saving
    await h.until(() => h.game.screen === 'menu');
    h.game.beginNewGame();
    h.env.randoms.push(0xbeef);
    void h.game.startGame();
    await elapse(h, 9_000); // B's start-of-game save is stuck behind A's write
    await h.until(() => h.game.screen === 'game');
    const simB = h.gameSim();
    expect(simB).not.toBe(simA);
    simB.state.tick = 40; // the very tick/mutation count A's stuck save captured
    releaseA(); // A's write finally lands
    await h.frames(5);
    await h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    expect(h.saves.slots.has('auto-0000beef')).toBe(true); // game B was written somewhere
  });
});

describe('idempotency holes', () => {
  it('deleting the live autosave slot makes the world dirty again: quitting re-creates it', async () => {
    const h = await startedHarness();
    expect(h.saves.slots.has('auto-00c0ffee')).toBe(true);
    await h.game.deleteSave('auto-00c0ffee');
    await h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    expect(h.saves.slots.has('auto-00c0ffee')).toBe(true);
  });

  it('toggling buy mode (endBuildSession) does not count as a world change', async () => {
    const h = await startedHarness();
    const n = h.saves.saveCalls.length;
    h.game.setMode('buy');
    h.game.setMode('live');
    h.game.setMode('build');
    h.game.setMode('live');
    await h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    expect(h.saves.saveCalls.length).toBe(n);
  });

  it('"Continue" from the autosave and quitting at once does not rewrite it; loading another slot does', async () => {
    const h = await startedHarness();
    h.gameSim().state.tick += 20;
    await h.game.saveGame('manual-one');
    await h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    const n = h.saves.saveCalls.length;
    expect((await h.game.loadGame('auto-00c0ffee')).ok).toBe(true);
    await h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    expect(h.saves.saveCalls.length).toBe(n); // unchanged world loaded from its own autosave
    expect((await h.game.loadGame('manual-one')).ok).toBe(true);
    await h.game.quitToMenu();
    await h.until(() => h.game.screen === 'menu');
    expect(h.saves.saveCalls.length).toBe(n + 1); // the autosave now mirrors what was last played
  });

  it('two identical manual save requests in flight are coalesced into one write', async () => {
    const h = await startedHarness();
    h.gameSim().state.tick += 30;
    const n = h.saves.saveCalls.length;
    const release = h.saves.hold();
    const a = h.game.saveGame();
    const b = h.game.saveGame();
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.ok && rb.ok).toBe(true);
    expect(h.saves.saveCalls.length).toBe(n + 1);
  });
});

describe('snapshot consistency', () => {
  it('SaveMeta describes the same moment as the saved world even when the thumbnail encode is slow', async () => {
    const h = await startedHarness();
    const sim = h.gameSim();
    sim.state.tick = 480;
    h.renderer.snapshotValue = `data:image/png;base64,${'A'.repeat(70_000)}`;
    h.env.reencode = async () => {
      sim.state.tick += 600; // the world keeps ticking while the thumbnail is encoded
      return 'data:image/jpeg;base64,AAAA';
    };
    const r = await h.game.saveGame();
    expect(r.ok).toBe(true);
    const call = h.saves.saveCalls.at(-1)!;
    expect(call.tick).toBe(480);
    expect(call.meta.timeLabel).toBe(timeInfo(480).label);
  });
});

describe('ProfileWriter — a ProfileStore that throws synchronously', () => {
  it('later writes still reach the store and the writer goes idle (flush terminates)', async () => {
    let calls = 0;
    let mode: 'throw' | 'ok' = 'throw';
    const store = {
      load: async () => null,
      save: (): Promise<void> => {
        calls++;
        if (mode === 'throw') throw new Error('sync boom');
        return Promise.resolve();
      },
    } as unknown as ProfileStore;
    const errors: unknown[] = [];
    const w = new ProfileWriter(store, (_k, e) => errors.push(e));
    await w.write('settings', { a: 1 });
    expect(errors.length).toBe(1);
    expect(w.busy).toBe(false);
    mode = 'ok';
    await w.write('settings', { a: 2 });
    expect(calls).toBe(2);
    expect(w.busy).toBe(false);
    await w.flush();
  });

  it('in the controller: a sync-throwing store never freezes hide/unload (flush resolves)', async () => {
    const h = await createHarness({
      setup: ({ profile }) => {
        profile.save = (() => {
          throw new Error('quota exceeded (sync)');
        }) as typeof profile.save;
      },
    });
    h.game.updateSettings({ showFps: true });
    h.game.updateSettings({ showFps: false });
    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await h.frames(3);
    expect(h.game.settings.showFps).toBe(false);
    expect(h.game.fatalError).toBeNull();
  });
});

describe('export filenames keep the save format extension (Windows-safe)', () => {
  it('.alsave names from PLATFORM are not turned into ".alsave.json"', () => {
    expect(sanitizeFilename('afterlife-rotwell-day3.alsave')).toBe('afterlife-rotwell-day3.alsave');
    expect(sanitizeFilename('CON.alsave')).toBe('_CON.alsave');
    expect(sanitizeFilename('my save.json')).toBe('my save.json');
    expect(sanitizeFilename('weird name. . ')).toBe('weird name.alsave');
    expect(sanitizeFilename('..\\..\\evil:stream.alsave')).toBe('_.._evil_stream.alsave');
    expect(sanitizeFilename('')).toBe('afterlife-lease-save.alsave');
  });

  it('in game: exporting a slot downloads the PLATFORM name with a binary-safe mime type', async () => {
    const h = await startedHarness();
    h.saves.exportSlot = async () => ({ filename: 'afterlife-rotwell-day3.alsave', data: new Uint8Array([123, 125]) });
    await h.game.exportSave('auto-00c0ffee');
    const d = h.env.downloads.at(-1)!;
    expect(d.filename).toBe('afterlife-rotwell-day3.alsave');
    expect(d.mime).toBe('application/octet-stream');
  });

  it('path-traversal / device-name slot ids are refused before touching storage', async () => {
    const h = await startedHarness();
    let loads = 0;
    const realLoad = h.saves.load.bind(h.saves);
    h.saves.load = async (id) => {
      loads++;
      return realLoad(id);
    };
    for (const bad of ['../auto-00c0ffee', 'con', 'NUL', 'a/b', 'x'.repeat(41), '']) {
      const r = await h.game.loadGame(bad);
      expect(r.ok).toBe(false);
    }
    expect(loads).toBe(0);
    expect(h.game.screen).toBe('game');
  });
});
