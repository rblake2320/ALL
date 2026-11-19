/**
 * "Save on quit" needs an EXPLICIT idle signal from the persistence layer.
 *
 * The desktop shell used to infer "the final save is done" from the storage IPC going quiet for 400 ms.
 * But a save is mostly CPU work BETWEEN storage calls (inspect the old primary, hash, gzip, decode the new
 * bytes again, validate) — on a big world or a slow laptop that gap exceeds 400 ms, the process exits
 * mid-save and the player's last progress is lost (old save kept: consistent, but stale).
 *
 * The ActivityTracker counts every persistence operation from the moment it is CALLED until it settles;
 * whenIdle() resolves once nothing has run for `quietMs` (measured from the call, so a save the game
 * starts a moment later — e.g. after capturing a thumbnail — is still awaited) or false on timeout.
 * createSaveManager/createProfileStore expose it to the Electron main process as a non-enumerable global.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityTracker, QUIT_HOOK_GLOBAL, installQuitHook, persistenceActivity } from '../../../src/persistence/activity';
import { createProfileStore, createSaveManager } from '../../../src/persistence';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { FaultyBackend, makeMeta, makeWorld, silentLogger } from './fixtures';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[QUIT_HOOK_GLOBAL];
});

describe('ActivityTracker', () => {
  it('idle: resolves true only after the quiet period, measured from the call', async () => {
    const t = new ActivityTracker();
    const t0 = Date.now();
    expect(await t.whenIdle({ quietMs: 120, timeoutMs: 2000 })).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
  });

  it('waits for an operation in flight, then for the quiet period after it', async () => {
    const t = new ActivityTracker();
    const end = t.begin();
    const t0 = Date.now();
    setTimeout(end, 300);
    expect(await t.whenIdle({ quietMs: 100, timeoutMs: 3000 })).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(390);
  });

  it('an operation that starts DURING the quiet period is awaited too (game starts its save late)', async () => {
    // Fake timers: under a loaded CI box a real 80 ms timer can fire after the 150 ms quiet period has
    // already elapsed, so the "late" save never overlapped the wait and the test measured nothing.
    vi.useFakeTimers();
    try {
      const t = new ActivityTracker();
      const t0 = Date.now();
      setTimeout(() => {
        const end = t.begin();
        setTimeout(end, 250);
      }, 80);
      let resolvedAt = -1;
      const idle = t.whenIdle({ quietMs: 150, timeoutMs: 3000 }).then((v) => ((resolvedAt = Date.now()), v));
      await vi.advanceTimersByTimeAsync(400); // op began at 80, still busy until 330
      expect(resolvedAt).toBe(-1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await idle).toBe(true);
      expect(resolvedAt - t0).toBeGreaterThanOrEqual(80 + 250 + 150);
      expect(resolvedAt - t0).toBeLessThan(80 + 250 + 150 + 200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out with false while something stays busy; end() is idempotent', async () => {
    const t = new ActivityTracker();
    const end = t.begin();
    expect(await t.whenIdle({ quietMs: 50, timeoutMs: 200 })).toBe(false);
    end();
    end(); // a double end must not make the counter negative (which would report idle while busy)
    const end2 = t.begin();
    expect(t.busy).toBe(1);
    end2();
    expect(t.busy).toBe(0);
  });

  it('clamps nonsense options instead of hanging or spinning', async () => {
    const t = new ActivityTracker();
    expect(await t.whenIdle({ quietMs: Number.NaN, timeoutMs: -5 })).toBe(true);
    expect(await t.whenIdle({ quietMs: 1e12, timeoutMs: 100 })).toBe(false);
  });
});

describe('SaveManager / ProfileStore report activity for their whole duration', () => {
  it('a save with long CPU/IO gaps keeps the tracker busy from call to result', async () => {
    const tracker = new ActivityTracker();
    const backend = new FaultyBackend(createMemoryBackend());
    backend.delayMs = 60; // every storage call takes a while (and there are ~5 of them)
    const m = new SaveManagerImpl({ backend, logger: silentLogger, activity: tracker });
    let saved = false;
    const p = m.save('slot1', 'quit', makeWorld(1), makeMeta()).then((r) => {
      saved = r.ok;
    });
    expect(tracker.busy).toBe(1); // counted synchronously at call time
    expect(await tracker.whenIdle({ quietMs: 50, timeoutMs: 5000 })).toBe(true);
    expect(saved).toBe(true);
    await p;
  });

  it('every public operation is tracked (load, list, remove, export, import, profile save)', async () => {
    const tracker = new ActivityTracker();
    const backend = createMemoryBackend();
    const m = new SaveManagerImpl({ backend, logger: silentLogger, activity: tracker });
    const seen: number[] = [];
    const probe = <T>(p: Promise<T>) => {
      seen.push(tracker.busy);
      return p;
    };
    await probe(m.save('a', 'a', makeWorld(1), makeMeta()));
    await probe(m.load('a'));
    await probe(m.listSlots());
    const exported = await probe(m.exportSlot('a'));
    await probe(m.importFile(exported!.data));
    await probe(m.latest());
    await probe(m.remove('a'));
    const profile = createProfileStore({ backend, activity: tracker, logger: silentLogger });
    await probe(profile.save('settings', { v: 1 }));
    expect(seen.every((n) => n >= 1)).toBe(true);
    expect(tracker.busy).toBe(0);
  });
});

describe('quit hook for the desktop shell', () => {
  it('createSaveManager installs a non-enumerable global whose whenIdle sees the shared tracker', async () => {
    await createSaveManager({ backend: createMemoryBackend(), logger: silentLogger });
    const g = globalThis as Record<string, unknown>;
    const hook = g[QUIT_HOOK_GLOBAL] as { whenIdle(o: { quietMs: number; timeoutMs: number }): Promise<boolean> } | undefined;
    expect(typeof hook?.whenIdle).toBe('function');
    expect(Object.keys(globalThis)).not.toContain(QUIT_HOOK_GLOBAL);
    const end = persistenceActivity.begin();
    expect(await hook!.whenIdle({ quietMs: 20, timeoutMs: 100 })).toBe(false);
    end();
    expect(await hook!.whenIdle({ quietMs: 20, timeoutMs: 1000 })).toBe(true);
  });

  it('installing twice (HMR, several managers) is harmless; a frozen/locked global never throws', () => {
    installQuitHook();
    installQuitHook();
    const locked = Object.freeze({}) as object;
    expect(() => installQuitHook(locked)).not.toThrow();
    const busyGetter = {};
    Object.defineProperty(busyGetter, QUIT_HOOK_GLOBAL, { value: 'taken', configurable: false, writable: false });
    expect(() => installQuitHook(busyGetter)).not.toThrow();
  });

  it('the hook is resilient to junk options from the caller', async () => {
    installQuitHook();
    const hook = (globalThis as Record<string, unknown>)[QUIT_HOOK_GLOBAL] as { whenIdle(o: unknown): Promise<boolean> };
    expect(await hook.whenIdle(undefined)).toBe(true);
    expect(await hook.whenIdle({ quietMs: 'x', timeoutMs: {} })).toBe(true);
    await sleep(1);
  });
});
