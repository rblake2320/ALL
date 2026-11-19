import { describe, expect, it } from 'vitest';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { Mutex, SlotQueue, webLocks, type LockProvider } from '../../../src/persistence/locks';
import { FaultyBackend, makeMeta, makeWorld, silentLogger } from './fixtures';

/** Minimal Web Locks implementation (exclusive, FIFO, AbortSignal) shared by fake "tabs". */
class FakeLockManager {
  private queues = new Map<string, Promise<void>>();
  private pendingByName = new Map<string, number>();
  holders = 0;
  maxHolders = 0;
  request<T>(name: string, options: { mode: 'exclusive'; signal?: AbortSignal; ifAvailable?: boolean }, cb: (lock: unknown) => Promise<T>): Promise<T> {
    if (options.ifAvailable && (this.pendingByName.get(name) ?? 0) > 0) return cb(null); // spec: callback gets null
    this.pendingByName.set(name, (this.pendingByName.get(name) ?? 0) + 1);
    const done = () => this.pendingByName.set(name, (this.pendingByName.get(name) ?? 1) - 1);
    const prev = this.queues.get(name) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.queues.set(name, prev.then(() => mine));
    return new Promise<T>((resolve, reject) => {
      let aborted = false;
      options.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      });
      prev.then(async () => {
        if (aborted) {
          done();
          release();
          return;
        }
        this.holders++;
        this.maxHolders = Math.max(this.maxHolders, this.holders);
        try {
          resolve(await cb({ name }));
        } catch (e) {
          reject(e);
        } finally {
          this.holders--;
          done();
          release();
        }
      });
    });
  }
}

describe('primitives', () => {
  it('Mutex is FIFO and survives throwing sections', async () => {
    const m = new Mutex();
    const order: number[] = [];
    const ps = [0, 1, 2, 3].map((i) =>
      m
        .run(async () => {
          await new Promise((r) => setTimeout(r, 5 - i));
          order.push(i);
          if (i === 1) throw new Error('x');
        })
        .catch(() => 'caught'),
    );
    await Promise.all(ps);
    expect(order).toEqual([0, 1, 2, 3]);
    expect(await m.run(() => 42)).toBe(42);
  });

  it('SlotQueue coalesces pending saves, never across a barrier', async () => {
    const ran: string[] = [];
    const q = new SlotQueue<string, string>(
      async (a) => {
        ran.push(a);
        await new Promise((r) => setTimeout(r, 10));
        return `done:${a}`;
      },
      () => 'error',
    );
    const p1 = q.save('a');
    await new Promise((r) => setTimeout(r, 1)); // 'a' is now RUNNING
    const p2 = q.save('b'); // pending
    const p3 = q.save('c'); // coalesces into pending
    const barrier = q.run(async () => ran.push('load'));
    const p4 = q.save('d'); // after the barrier: new pending
    const p5 = q.save('e'); // coalesces with d
    expect(await Promise.all([p1, p2, p3, barrier, p4, p5])).toEqual(['done:a', 'done:c', 'done:c', 3, 'done:e', 'done:e']);
    expect(ran).toEqual(['a', 'c', 'load', 'e']);
  });

  it('SlotQueue: saves issued in the same tick on an idle queue collapse into ONE save of the latest value', async () => {
    const ran: string[] = [];
    const q = new SlotQueue<string, string>(async (a) => (ran.push(a), `done:${a}`), () => 'error');
    expect(await Promise.all([q.save('a'), q.save('b'), q.save('c')])).toEqual(['done:c', 'done:c', 'done:c']);
    expect(ran).toEqual(['c']);
  });

  it('SlotQueue converts a throwing save into the error result', async () => {
    const q = new SlotQueue<number, string>(
      async () => {
        throw new Error('nope');
      },
      (e) => `err:${(e as Error).message}`,
    );
    expect(await q.save(1)).toBe('err:nope');
    expect(await q.save(2)).toBe('err:nope');
  });
});

describe('SaveManager concurrency', () => {
  it('concurrent saves to one slot serialize and coalesce to the latest world (idempotent)', async () => {
    const backend = new FaultyBackend();
    backend.delayMs = 2;
    const mgr = new SaveManagerImpl({ backend, logger: silentLogger });
    const worlds = Array.from({ length: 12 }, (_, i) => makeWorld(i));
    const first = mgr.save('slot1', 's0', worlds[0], makeMeta());
    while (backend.log.length === 0) await new Promise((r) => setTimeout(r, 0)); // first save is running
    const rest = worlds.slice(1).map((w, i) => mgr.save('slot1', `s${i + 1}`, w, makeMeta()));
    const results = await Promise.all([first, ...rest]);
    expect(results.every((r) => r.ok)).toBe(true);
    const primaryWrites = backend.log.filter((l) => l === 'write slot:slot1:primary').length;
    expect(primaryWrites).toBe(2); // the running save + ONE coalesced save carrying the latest world
    // Every coalesced caller got the same (latest) result.
    const infos = results.map((r) => (r.ok ? r.info.name : ''));
    expect(infos[0]).toBe('s0');
    expect(new Set(infos.slice(1))).toEqual(new Set(['s11']));
    const l = await mgr.load('slot1');
    expect(l.ok && canonicalJson(l.world)).toBe(canonicalJson(worlds[11]));
    expect(backend.maxActive).toBe(1);
  });

  it('saves to different slots never overlap storage operations (global lock)', async () => {
    const backend = new FaultyBackend();
    backend.delayMs = 1;
    const mgr = new SaveManagerImpl({ backend, logger: silentLogger });
    const rs = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id, i) => mgr.save(id, id, makeWorld(i), makeMeta())));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(backend.maxActive).toBe(1);
    expect((await mgr.listSlots()).length).toBe(5);
  });

  it('two managers on the same backend share the in-process lock', async () => {
    const backend = new FaultyBackend();
    backend.delayMs = 1;
    const m1 = new SaveManagerImpl({ backend, logger: silentLogger });
    const m2 = new SaveManagerImpl({ backend, logger: silentLogger });
    await Promise.all([m1.save('x', '1', makeWorld(1), makeMeta()), m2.save('x', '2', makeWorld(2), makeMeta()), m1.save('y', '3', makeWorld(3), makeMeta())]);
    expect(backend.maxActive).toBe(1);
    const l = await m1.load('x');
    expect(l.ok).toBe(true);
  });

  it('operation order is preserved: save A, load, save B -> load sees A, final is B', async () => {
    const backend = new FaultyBackend();
    backend.delayMs = 1;
    const mgr = new SaveManagerImpl({ backend, logger: silentLogger });
    const pA = mgr.save('s', 'A', makeWorld(1), makeMeta());
    const pL = mgr.load('s');
    const pB = mgr.save('s', 'B', makeWorld(2), makeMeta());
    const [a, l, b] = await Promise.all([pA, pL, pB]);
    expect(a.ok && b.ok).toBe(true);
    expect(l.ok && l.world.seed).toBe(makeWorld(1).seed);
    const final = await mgr.load('s');
    expect(final.ok && final.world.seed).toBe(makeWorld(2).seed);
  });

  it('save then remove then save (concurrently) ends with the last save', async () => {
    const backend = new FaultyBackend();
    backend.delayMs = 1;
    const mgr = new SaveManagerImpl({ backend, logger: silentLogger });
    await Promise.all([mgr.save('s', 'A', makeWorld(1), makeMeta()), mgr.remove('s'), mgr.save('s', 'B', makeWorld(2), makeMeta())]);
    const l = await mgr.load('s');
    expect(l.ok && l.world.seed).toBe(makeWorld(2).seed);
    expect(backend.inner.store.has('slot:s:backup')).toBe(false); // removed between the saves
  });

  it('cross-tab: two "tabs" (separate in-process locks) are serialized by Web Locks', async () => {
    const inner = createMemoryBackend();
    const locks = new FakeLockManager();
    const provider: LockProvider = {
      kind: 'custom',
      run: (name, fn) => locks.request(name, { mode: 'exclusive' }, fn),
    };
    const tab1 = new FaultyBackend(inner);
    const tab2 = new FaultyBackend(inner);
    tab1.delayMs = tab2.delayMs = 1;
    let active = 0;
    let maxActive = 0;
    for (const t of [tab1, tab2]) {
      const orig = t.write.bind(t);
      t.write = async (k, d) => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await orig(k, d);
        } finally {
          active--;
        }
      };
    }
    const m1 = new SaveManagerImpl({ backend: tab1, logger: silentLogger, locks: provider });
    const m2 = new SaveManagerImpl({ backend: tab2, logger: silentLogger, locks: provider });
    const rs = await Promise.all([1, 2, 3, 4].map((i) => (i % 2 ? m1 : m2).save('shared', `t${i}`, makeWorld(i), makeMeta())));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(locks.maxHolders).toBe(1);
    expect(maxActive).toBe(1);
    // Integrity after cross-tab interleaving: primary and backup are both loadable worlds.
    const l = await new SaveManagerImpl({ backend: inner, logger: silentLogger }).load('shared');
    expect(l.ok).toBe(true);
  });

  it('cross-tab: an autosave never waits for another window (busy at once); a manual save waits and succeeds', async () => {
    const inner = createMemoryBackend();
    const nav = (globalThis as { navigator?: unknown }).navigator;
    const fake = new FakeLockManager();
    Object.defineProperty(globalThis, 'navigator', { value: { locks: fake }, configurable: true, writable: true });
    try {
      const provider = webLocks(5_000)!;
      const tab1 = new SaveManagerImpl({ backend: new FaultyBackend(inner), logger: silentLogger, locks: provider });
      const tab2 = new SaveManagerImpl({ backend: new FaultyBackend(inner), logger: silentLogger, locks: provider });
      expect((await tab1.save('s', 'first', makeWorld(1), makeMeta())).ok).toBe(true);
      // tab1 holds the cross-window lock for a while (e.g. a long save on a starved main thread)
      let release!: () => void;
      const held = provider.run('afterlife-lease:saves:memory', () => new Promise<void>((r) => (release = r)));
      await new Promise((r) => setTimeout(r, 5));
      const t0 = Date.now();
      const auto = await tab2.save('autosave', 'Autosave', makeWorld(2), makeMeta(), { autosave: true });
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(!auto.ok && auto.code).toBe('busy');
      if (!auto.ok) expect(auto.error).toMatch(/another window/);
      const manual = tab2.save('s', 'manual', makeWorld(3), makeMeta());
      await new Promise((r) => setTimeout(r, 30));
      release();
      await held;
      expect((await manual).ok).toBe(true);
      const l = await tab1.load('s');
      expect(l.ok && l.world.seed).toBe(makeWorld(3).seed);
      // ...and once the lock is free, the autosave retry succeeds.
      expect((await tab2.save('autosave', 'Autosave', makeWorld(2), makeMeta(), { autosave: true })).ok).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    }
  });

  it('webLocks(): uses navigator.locks when present and maps lock timeouts to busy', async () => {
    const nav = (globalThis as { navigator?: unknown }).navigator;
    const fake = new FakeLockManager();
    Object.defineProperty(globalThis, 'navigator', { value: { locks: fake }, configurable: true, writable: true });
    try {
      const p = webLocks(30);
      expect(p?.kind).toBe('web-locks');
      let releaseHolder!: () => void;
      const holder = p!.run('L', () => new Promise<void>((r) => (releaseHolder = r)));
      await new Promise((r) => setTimeout(r, 5));
      await expect(p!.run('L', async () => 'never')).rejects.toMatchObject({ code: 'busy' });
      releaseHolder();
      await holder;
      expect(await p!.run('L', async () => 'ok')).toBe('ok');
      // Errors thrown inside the critical section propagate unchanged.
      await expect(p!.run('L', async () => Promise.reject(new Error('inner')))).rejects.toThrow('inner');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    }
    // Back on the runtime's own navigator: Node < 24 has no navigator.locks, Node >= 24 ships a real LockManager.
    const native = typeof (nav as { locks?: { request?: unknown } } | undefined)?.locks?.request === 'function';
    expect(webLocks()?.kind ?? null).toBe(native ? 'web-locks' : null);
  });
});
