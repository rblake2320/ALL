/**
 * Backlog #11 (docs/INTEGRATION_BACKLOG.md) — `SaveManager.save(..., { waitForLock: true })`.
 *
 * Ordinary autosaves never wait for another window's cross-window save lock (Web Locks `ifAvailable`: they fail
 * 'busy' at once and the caller retries). The crash / emergency save is ALSO flagged as an autosave (it is listed as
 * one) but may be the only copy of the session, so with `waitForLock` it WAITS — at most 30 s — like a manual save.
 *
 * Every case runs PLATFORM's real webLocks() provider over a shared fake navigator.locks; "windows" are separate
 * SaveManagerImpl instances (separate in-process mutexes) over one storage.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { DEFAULT_LOCK_TIMEOUT_MS, type LockOptions, type LockProvider } from '../../../src/persistence/locks';
import { FaultyBackend, makeMeta, makeWorld, silentLogger } from './fixtures';
import { FakeLockManager, saveLockName, webLocksOver } from './fakeWebLocks';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Two windows of the game sharing one storage and one (fake) navigator.locks. */
function twoWindows(timeoutMs?: number) {
  const storage = createMemoryBackend();
  const manager = new FakeLockManager();
  const locks = webLocksOver(manager, timeoutMs);
  const crashed = new SaveManagerImpl({ backend: new FaultyBackend(storage), logger: silentLogger, locks });
  const other = new SaveManagerImpl({ backend: new FaultyBackend(storage), logger: silentLogger, locks });
  return { storage, manager, crashed, other, lockName: saveLockName(storage.id) };
}

/** Lock provider that records the options of every acquisition (and takes no real lock). */
function recordingLocks(log: (LockOptions | undefined)[]): LockProvider {
  return {
    kind: 'custom',
    run: (_name, fn, opts) => {
      log.push(opts);
      return fn();
    },
  };
}

function settledFlag<T>(p: Promise<T>): { p: Promise<T>; settled: () => boolean } {
  let done = false;
  const q = p.finally(() => {
    done = true;
  });
  return { p: q, settled: () => done };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('backlog #11: emergency save waits for the cross-window lock', () => {
  it('another window holds the lock briefly → the autosave-flagged save with waitForLock WAITS, then succeeds', async () => {
    const w = twoWindows();
    const holder = w.manager.hold(w.lockName); // e.g. the other window's long save on a starved main thread
    await holder.granted;
    const save = settledFlag(w.crashed.save('emergency', 'Emergency save', makeWorld(2), makeMeta(), { autosave: true, waitForLock: true, playMinutes: 77 }));
    await sleep(40);
    expect(save.settled()).toBe(false); // waiting for the lock — not failed fast
    expect(w.storage.store.has('slot:emergency:primary')).toBe(false);
    setTimeout(() => holder.release(), 10); // the other holder lets go after a short delay
    const r = await save.p;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.info.isAutosave).toBe(true); // still listed as an autosave
    expect(r.info.playMinutes).toBe(77);
    expect(w.manager.refusedFast).toBe(0);
    // The other window reads exactly the crash snapshot, listed as an autosave.
    const l = await w.other.load('emergency');
    expect(l.ok && canonicalJson(l.world)).toBe(canonicalJson(makeWorld(2)));
    expect((await w.other.listSlots()).find((s) => s.slotId === 'emergency')?.isAutosave).toBe(true);
    await holder.done;
  });

  it('a REAL save in the other window holding the lock: the emergency save queues behind it and both land', async () => {
    const storage = createMemoryBackend();
    const manager = new FakeLockManager();
    const locks = webLocksOver(manager);
    const slowBackend = new FaultyBackend(storage);
    slowBackend.delayMs = 15; // every storage call of the other window takes 15 ms
    const other = new SaveManagerImpl({ backend: slowBackend, logger: silentLogger, locks });
    const crashed = new SaveManagerImpl({ backend: new FaultyBackend(storage), logger: silentLogger, locks });
    const otherSave = other.save('their-slot', 'Their save', makeWorld(5), makeMeta());
    for (let i = 0; i < 50 && !manager.busy(saveLockName(storage.id)); i++) await sleep(1);
    expect(manager.busy(saveLockName(storage.id))).toBe(true);
    const emergency = crashed.save('emergency', 'Emergency save', makeWorld(6), makeMeta(), { autosave: true, waitForLock: true });
    const [ro, re] = await Promise.all([otherSave, emergency]);
    expect(ro.ok).toBe(true);
    expect(re.ok).toBe(true);
    expect(Date.parse(re.ok ? re.info.savedAt : '')).toBeGreaterThanOrEqual(Date.parse(ro.ok ? ro.info.savedAt : ''));
    const fresh = new SaveManagerImpl({ backend: storage, logger: silentLogger });
    const le = await fresh.load('emergency');
    const lo = await fresh.load('their-slot');
    expect(le.ok && canonicalJson(le.world)).toBe(canonicalJson(makeWorld(6)));
    expect(lo.ok && canonicalJson(lo.world)).toBe(canonicalJson(makeWorld(5)));
  });

  it('contrast: the same autosave WITHOUT waitForLock (or with junk) fails busy at once and writes nothing', async () => {
    const w = twoWindows();
    const holder = w.manager.hold(w.lockName);
    await holder.granted;
    for (const opts of [{ autosave: true }, { autosave: true, waitForLock: false }, { autosave: true, waitForLock: 'yes' as never }]) {
      const t0 = Date.now();
      const r = await w.crashed.save('emergency', 'Emergency save', makeWorld(3), makeMeta(), opts);
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(!r.ok && r.code).toBe('busy');
      if (!r.ok) expect(r.error).toMatch(/another window/);
    }
    expect(w.storage.store.has('slot:emergency:primary')).toBe(false);
    holder.release();
    await holder.done;
    // ...and once the lock is free the fail-fast autosave goes through.
    expect((await w.crashed.save('emergency', 'Emergency save', makeWorld(3), makeMeta(), { autosave: true })).ok).toBe(true);
  });

  it('a manual save keeps waiting even with waitForLock: false (the option only strengthens autosaves)', async () => {
    const w = twoWindows();
    const holder = w.manager.hold(w.lockName);
    await holder.granted;
    const save = settledFlag(w.crashed.save('manual-1', 'Manual', makeWorld(4), makeMeta(), { waitForLock: false }));
    await sleep(30);
    expect(save.settled()).toBe(false);
    holder.release();
    const r = await save.p;
    expect(r.ok && r.info.isAutosave).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('the wait is bounded: a lock never released fails busy after 30 s — not before — and nothing is written', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const w = twoWindows(); // default lock timeout (DEFAULT_LOCK_TIMEOUT_MS)
    expect(DEFAULT_LOCK_TIMEOUT_MS).toBe(30_000);
    const holder = w.manager.hold(w.lockName);
    await holder.granted;
    const save = settledFlag(w.crashed.save('emergency', 'Emergency save', makeWorld(7), makeMeta(), { autosave: true, waitForLock: true }));
    // Everything up to the lock request is promise plumbing: let it queue (and arm its 30 s timer) at fake time 0.
    for (let i = 0; i < 200 && w.manager.waiting(w.lockName) === 0; i++) await Promise.resolve();
    expect(w.manager.waiting(w.lockName)).toBe(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_LOCK_TIMEOUT_MS - 1);
    expect(save.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const r = await save.p;
    expect(!r.ok && r.code).toBe('busy');
    if (!r.ok) expect(r.error).toMatch(/30 s/);
    expect(w.manager.aborts).toBe(1); // the waiting request left the lock queue
    expect(w.storage.store.has('slot:emergency:primary')).toBe(false);
    holder.release();
    await holder.done;
    vi.useRealTimers();
    // The game may retry: with the lock free the emergency save lands.
    expect((await w.crashed.save('emergency', 'Emergency save', makeWorld(7), makeMeta(), { autosave: true, waitForLock: true })).ok).toBe(true);
  });

  it('coalescing keeps the wait: an emergency save folded with a queued plain autosave of the same slot still waits', async () => {
    for (const order of ['plain-first', 'urgent-first'] as const) {
      const opts: (LockOptions | undefined)[] = [];
      const backend = new FaultyBackend(createMemoryBackend());
      backend.delayMs = 2;
      const m = new SaveManagerImpl({ backend, logger: silentLogger, locks: recordingLocks(opts) });
      const running = m.save('emergency', 'running', makeWorld(1), makeMeta(), { autosave: true });
      await sleep(1); // the first save is now RUNNING (no longer coalescable)
      const plain = () => m.save('emergency', 'plain', makeWorld(2), makeMeta(), { autosave: true });
      const urgent = () => m.save('emergency', 'urgent', makeWorld(3), makeMeta(), { autosave: true, waitForLock: true });
      const [a, b] = order === 'plain-first' ? [plain(), urgent()] : [urgent(), plain()];
      expect(await a).toBe(await b); // one coalesced save, one shared result
      await running;
      expect(opts.map((o) => o?.ifAvailable === true)).toEqual([true, false]); // running: fail-fast; coalesced: waits
      const l = await m.load('emergency');
      expect(l.ok && canonicalJson(l.world)).toBe(canonicalJson(makeWorld(order === 'plain-first' ? 3 : 2))); // latest wins
      expect(l.ok && l.info.isAutosave).toBe(true);
    }
  });
});
