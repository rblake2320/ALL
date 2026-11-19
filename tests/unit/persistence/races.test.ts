/**
 * Interleavings the happy-path concurrency suite does not cover:
 *  - two imports at the same moment (same clock second) must land in two DIFFERENT slots — in one tab
 *    and across tabs sharing one storage (no silent overwrite / coalescing of different files);
 *  - coalescing a manual save with a later autosave must keep the manual save's "wait for the lock"
 *    policy (otherwise a manual save can fail with `busy` although manual saves wait up to 30 s);
 *  - loads and listings only write CACHE records (meta), so they must never block on another
 *    window's save lock;
 *  - latest() ("Continue") must never offer a slot that cannot be loaded.
 */
import { describe, expect, it } from 'vitest';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { StorageError } from '../../../src/persistence/errors';
import { Mutex, type LockOptions, type LockProvider } from '../../../src/persistence/locks';
import { FaultyBackend, makeMeta, makeWorld, silentLogger } from './fixtures';

const FIXED_NOW = Date.parse('2026-11-05T10:00:00.000Z');

async function exportOf(variant: number): Promise<Uint8Array> {
  const m = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silentLogger });
  expect((await m.save('src', `src ${variant}`, makeWorld(variant), makeMeta({ householdName: `House ${variant}` }))).ok).toBe(true);
  const e = await m.exportSlot('src');
  expect(e).not.toBeNull();
  return e!.data;
}

/** Records the options of every lock acquisition. */
function recordingLocks(log: (LockOptions | undefined)[]): LockProvider {
  return {
    kind: 'custom',
    run: (_name, fn, opts) => {
      log.push(opts);
      return fn();
    },
  };
}

/** One cross-window lock shared by several "tabs" (what navigator.locks provides in a browser). */
function sharedWebLock(): LockProvider {
  const m = new Mutex();
  return { kind: 'custom', run: (_name, fn) => m.run(fn) };
}

/** "Another window" holds the cross-tab lock until release(): waits block, ifAvailable fails fast. */
function heldElsewhere(): { locks: LockProvider; release(): void; waits: number } {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const state = {
    waits: 0,
    release: () => release(),
    locks: {
      kind: 'custom' as const,
      run: async <T>(_name: string, fn: () => Promise<T>, opts?: LockOptions): Promise<T> => {
        if (opts?.ifAvailable) throw new StorageError('busy', 'another window is saving');
        state.waits++;
        await gate;
        return fn();
      },
    },
  };
  return state;
}

describe('imports racing each other', () => {
  it('two imports started together (same second) get two different slots; both worlds survive', async () => {
    const [a, b] = await Promise.all([exportOf(1), exportOf(2)]);
    const backend = createMemoryBackend();
    const m = new SaveManagerImpl({ backend, logger: silentLogger, now: () => FIXED_NOW });
    const [ra, rb] = await Promise.all([m.importFile(a), m.importFile(b)]);
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    expect(ra.slotId).not.toBe(rb.slotId);
    const fresh = new SaveManagerImpl({ backend, logger: silentLogger });
    const la = await fresh.load(ra.slotId!);
    const lb = await fresh.load(rb.slotId!);
    expect(la.ok && canonicalJson(la.world)).toBe(canonicalJson(makeWorld(1)));
    expect(lb.ok && canonicalJson(lb.world)).toBe(canonicalJson(makeWorld(2)));
    expect((await fresh.listSlots()).length).toBe(2);
  });

  it('two TABS importing at the same second into one storage never overwrite each other', async () => {
    const [a, b] = await Promise.all([exportOf(3), exportOf(4)]);
    const backend = new FaultyBackend(createMemoryBackend());
    backend.delayMs = 2; // let the two tabs interleave between "list existing ids" and "write"
    const locks = sharedWebLock(); // separate in-process mutexes (separate tabs), one Web Lock
    const tab1 = new SaveManagerImpl({ backend, logger: silentLogger, now: () => FIXED_NOW, locks });
    const tab2 = new SaveManagerImpl({ backend: new FaultyBackend(backend.inner), logger: silentLogger, now: () => FIXED_NOW, locks });
    const [ra, rb] = await Promise.all([tab1.importFile(a), tab2.importFile(b)]);
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    expect(ra.slotId).not.toBe(rb.slotId);
    const fresh = new SaveManagerImpl({ backend: backend.inner, logger: silentLogger });
    const worlds = await Promise.all([fresh.load(ra.slotId!), fresh.load(rb.slotId!)]);
    expect(worlds.map((w) => w.ok && canonicalJson(w.world)).sort()).toEqual([canonicalJson(makeWorld(3)), canonicalJson(makeWorld(4))].sort());
  });

  it('an import never coalesces with an ordinary save that targets the same slot', async () => {
    const data = await exportOf(5);
    const backend = new FaultyBackend(createMemoryBackend());
    backend.delayMs = 3;
    const m = new SaveManagerImpl({ backend, logger: silentLogger });
    // keep the slot queue busy so both requests are queued (not started) at the same time
    const first = m.save('target', 'first', makeWorld(6), makeMeta());
    const imp = m.importFile(data, 'target');
    const later = m.save('target', 'later', makeWorld(7), makeMeta());
    const [r1, ri, r2] = await Promise.all([first, imp, later]);
    expect(r1.ok && ri.ok && r2.ok).toBe(true);
    // the import really ran (its own world was returned and stored at some point), and the final state
    // is the LAST request in call order
    expect(ri.ok && canonicalJson(ri.world)).toBe(canonicalJson(makeWorld(5)));
    const l = await new SaveManagerImpl({ backend: backend.inner, logger: silentLogger }).load('target');
    expect(l.ok && canonicalJson(l.world)).toBe(canonicalJson(makeWorld(7)));
    expect(l.ok && l.info.name).toBe('later');
  });
});

describe('coalescing keeps the strongest lock policy', () => {
  it('manual save + later autosave of the same slot (coalesced) still WAITS for the lock', async () => {
    const opts: (LockOptions | undefined)[] = [];
    const backend = new FaultyBackend(createMemoryBackend());
    backend.delayMs = 2;
    const m = new SaveManagerImpl({ backend, logger: silentLogger, locks: recordingLocks(opts) });
    const inFlight = m.save('slot1', 'running', makeWorld(1), makeMeta());
    await new Promise((r) => setTimeout(r, 1)); // the first save is now RUNNING (not coalescable)
    const manual = m.save('slot1', 'manual', makeWorld(2), makeMeta());
    const auto = m.save('slot1', 'auto', makeWorld(3), makeMeta(), { autosave: true });
    expect(await manual).toBe(await auto); // one coalesced save, one result
    await inFlight;
    expect(opts.length).toBe(2); // in-flight save + ONE coalesced save
    expect(opts[1]?.ifAvailable ?? false).toBe(false);
    const l = await m.load('slot1');
    expect(l.ok && canonicalJson(l.world)).toBe(canonicalJson(makeWorld(3))); // latest world wins
  });

  it('autosave + autosave coalesced stays fail-fast', async () => {
    const opts: (LockOptions | undefined)[] = [];
    const backend = new FaultyBackend(createMemoryBackend());
    backend.delayMs = 2;
    const m = new SaveManagerImpl({ backend, logger: silentLogger, locks: recordingLocks(opts) });
    const inFlight = m.save('autosave', 'a', makeWorld(1), makeMeta());
    await new Promise((r) => setTimeout(r, 1));
    const p2 = m.save('autosave', 'b', makeWorld(2), makeMeta());
    const p3 = m.save('autosave', 'c', makeWorld(3), makeMeta());
    await Promise.all([inFlight, p2, p3]);
    expect(opts.map((o) => o?.ifAvailable === true)).toEqual([true, true]);
  });
});

describe('cache writes never wait for another window', () => {
  it('load() of a slot whose listing record is stale returns without waiting for the cross-tab lock', async () => {
    const backend = createMemoryBackend();
    const writer = new SaveManagerImpl({ backend, logger: silentLogger });
    expect((await writer.save('slot1', 'a', makeWorld(1), makeMeta())).ok).toBe(true);
    backend.store.delete('slot:slot1:meta'); // stale/missing cache -> load wants to rewrite it
    const other = heldElsewhere();
    const reader = new SaveManagerImpl({ backend, logger: silentLogger, locks: other.locks });
    const result = await Promise.race([reader.load('slot1'), new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 500))]);
    other.release();
    expect(result).not.toBe('blocked');
    expect(result !== 'blocked' && result.ok).toBe(true);
  });

  it('listSlots() rebuilding a missing listing record does not block on another window either', async () => {
    const backend = createMemoryBackend();
    const writer = new SaveManagerImpl({ backend, logger: silentLogger });
    expect((await writer.save('slot1', 'a', makeWorld(1), makeMeta())).ok).toBe(true);
    backend.store.delete('slot:slot1:meta');
    const other = heldElsewhere();
    const reader = new SaveManagerImpl({ backend, logger: silentLogger, locks: other.locks });
    const result = await Promise.race([reader.listSlots(), new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 500))]);
    other.release();
    expect(result).not.toBe('blocked');
    expect(result !== 'blocked' && result.map((s) => s.slotId)).toEqual(['slot1']);
  });
});

describe('latest() only offers loadable slots', () => {
  it('a damaged-only storage has no "Continue"; a damaged slot never shadows a good one', async () => {
    const backend = createMemoryBackend();
    const m = new SaveManagerImpl({ backend, logger: silentLogger });
    backend.store.set('slot:broken:primary', new TextEncoder().encode('{"format":"afterlife-lease-save", garbage'));
    expect((await m.listSlots()).map((s) => s.slotId)).toEqual(['broken']); // still listed (deletable)
    expect(await m.latest()).toBeNull();
    expect((await m.save('good', 'good', makeWorld(1), makeMeta())).ok).toBe(true);
    expect((await m.latest())?.slotId).toBe('good');
  });
});
