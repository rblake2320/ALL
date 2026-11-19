/**
 * Concurrency primitives for the save system.
 *
 *  - Mutex: FIFO async mutex; a throwing critical section never wedges the lock.
 *  - SlotQueue: per-slot FIFO of operations with SAVE COALESCING — while a save runs, further saves
 *    of the same slot collapse into ONE pending save carrying the latest world; every caller of a
 *    coalesced save receives that save's result. Any non-save operation queued in between (load,
 *    remove, export) is a barrier: later saves never coalesce across it, so call order is preserved.
 *  - LockProvider: cross-process exclusion. In browsers this is the Web Locks API (two tabs of the
 *    game saving into the same IndexedDB serialize; autosaves use `ifAvailable` and fail fast with
 *    'busy' instead of waiting, manual saves — and autosaves saved with `waitForLock`, i.e. the crash
 *    save — wait up to 30 s); elsewhere a no-op (Electron relies on
 *    app.requestSingleInstanceLock + per-key file mutexes in the main process).
 */
import { StorageError } from './errors';

export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  private depth = 0;

  get locked(): boolean {
    return this.depth > 0;
  }

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    this.depth++;
    return prev.then(async () => {
      try {
        return await fn();
      } finally {
        this.depth--;
        release();
      }
    });
  }
}

interface PendingSave<A, R> {
  args: A;
  promise: Promise<R>;
  started: boolean;
}

/**
 * How a newer save request folds into a queued one: return the merged request, or null when the two must
 * NOT be coalesced (the newer one is then queued separately, after it). Default: the newer one replaces.
 */
export type CoalesceFn<A> = (pending: A, next: A) => A | null;

export class SlotQueue<A, R> {
  private tail: Promise<void> = Promise.resolve();
  private pending: PendingSave<A, R> | null = null;
  private inFlight = 0;

  constructor(
    private readonly runSave: (args: A) => Promise<R>,
    private readonly onError: (e: unknown) => R,
    private readonly coalesce: CoalesceFn<A> = (_pending, next) => next,
  ) {}

  get busy(): boolean {
    return this.inFlight > 0;
  }

  /** Queue a save; coalesces into a queued-but-not-started save if one exists (and `coalesce` agrees). */
  save(args: A): Promise<R> {
    if (this.pending && !this.pending.started) {
      const merged = this.coalesce(this.pending.args, args);
      if (merged !== null) {
        this.pending.args = merged;
        return this.pending.promise;
      }
    }
    let resolve!: (r: R) => void;
    const entry: PendingSave<A, R> = { args, promise: new Promise<R>((r) => (resolve = r)), started: false };
    this.pending = entry;
    this.chain(async () => {
      entry.started = true;
      if (this.pending === entry) this.pending = null;
      let result: R;
      try {
        result = await this.runSave(entry.args);
      } catch (e) {
        result = this.onError(e);
      }
      resolve(result);
    });
    return entry.promise;
  }

  /** Queue any other operation; acts as a coalescing barrier. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    this.pending = null;
    return new Promise<T>((resolve, reject) => {
      this.chain(async () => {
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  private chain(step: () => Promise<void>): void {
    this.inFlight++;
    this.tail = this.tail
      .then(step)
      .catch(() => undefined)
      .finally(() => {
        this.inFlight--;
      });
  }
}

export interface LockOptions {
  /** Do not wait: if another window holds the lock, fail at once with StorageError('busy') (autosaves). */
  ifAvailable?: boolean;
  /** Maximum wait before failing with StorageError('busy') (default 30 s). */
  timeoutMs?: number;
}

export interface LockProvider {
  readonly kind: 'web-locks' | 'none' | 'custom';
  run<T>(name: string, fn: () => Promise<T>, opts?: LockOptions): Promise<T>;
}

export const noLocks: LockProvider = { kind: 'none', run: (_name, fn) => fn() };

interface WebLockManager {
  request<T>(name: string, options: { mode: 'exclusive'; signal?: AbortSignal; ifAvailable?: boolean }, cb: (lock: unknown) => Promise<T>): Promise<T>;
}

export const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

/**
 * Web Locks API provider (null when unavailable). Waits are bounded (default 30 s, manual saves);
 * `ifAvailable` never waits (autosaves: the caller retries later instead of stalling the game).
 */
export function webLocks(defaultTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS): LockProvider | null {
  let mgr: WebLockManager | undefined;
  try {
    mgr = (globalThis as { navigator?: { locks?: WebLockManager } }).navigator?.locks;
  } catch {
    mgr = undefined;
  }
  if (!mgr || typeof mgr.request !== 'function') return null;
  const locks = mgr;
  return {
    kind: 'web-locks',
    async run<T>(name: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
      if (opts.ifAvailable) {
        return locks.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
          if (!lock) throw new StorageError('busy', 'another window of the game is saving right now; try again shortly');
          return fn();
        });
      }
      const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      let granted = false;
      const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
      try {
        return await locks.request(name, { mode: 'exclusive', ...(ac ? { signal: ac.signal } : {}) }, async () => {
          granted = true;
          if (timer) clearTimeout(timer);
          return fn();
        });
      } catch (e) {
        if (!granted && (e as { name?: unknown })?.name === 'AbortError') {
          throw new StorageError('busy', `another window of the game kept the save lock for over ${Math.round(timeoutMs / 1000)} s; try again in a moment`, e);
        }
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
