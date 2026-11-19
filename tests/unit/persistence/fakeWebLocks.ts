/**
 * In-memory Web Locks API (`navigator.locks`) shared by fake "windows" of the game: exclusive, FIFO per lock
 * name, `ifAvailable` (the callback receives null when the lock is taken, per spec) and `signal` (a waiting
 * request rejects with an AbortError and leaves the queue). `webLocksOver()` builds PLATFORM's REAL webLocks()
 * provider on top of it, so tests exercise the production timeout / ifAvailable code path.
 */
import { webLocks, type LockProvider } from '../../../src/persistence/locks';

interface RequestOptions {
  mode: 'exclusive';
  signal?: AbortSignal;
  ifAvailable?: boolean;
}

interface Waiter {
  grant: () => void;
}

export class FakeLockManager {
  private readonly held = new Set<string>();
  private readonly queues = new Map<string, Waiter[]>();
  /** Requests granted / refused at once (ifAvailable) / aborted while waiting. */
  grants = 0;
  refusedFast = 0;
  aborts = 0;

  /** True while `name` is held or has waiters (what `ifAvailable` sees). */
  busy(name: string): boolean {
    return this.held.has(name) || this.waiting(name) > 0;
  }

  /** Requests queued for `name` (not yet granted). */
  waiting(name: string): number {
    return this.queues.get(name)?.length ?? 0;
  }

  request<T>(name: string, options: RequestOptions, cb: (lock: unknown) => Promise<T>): Promise<T> {
    if (options.ifAvailable && this.busy(name)) {
      this.refusedFast++;
      return Promise.resolve().then(() => cb(null));
    }
    return new Promise<T>((resolve, reject) => {
      let waiting = true;
      const run = (): void => {
        waiting = false;
        this.held.add(name);
        this.grants++;
        Promise.resolve()
          .then(() => cb({ name, mode: 'exclusive' }))
          .then(resolve, reject)
          .finally(() => this.releaseLock(name));
      };
      if (!this.busy(name)) {
        run();
        return;
      }
      const waiter: Waiter = { grant: run };
      const q = this.queues.get(name) ?? [];
      q.push(waiter);
      this.queues.set(name, q);
      options.signal?.addEventListener('abort', () => {
        if (!waiting) return;
        waiting = false;
        const list = this.queues.get(name) ?? [];
        const i = list.indexOf(waiter);
        if (i >= 0) list.splice(i, 1);
        this.aborts++;
        reject(new DOMException('The lock request was aborted', 'AbortError'));
      });
    });
  }

  /**
   * "Another window" takes the lock (waiting its turn) and keeps it until `release()`. `granted` settles once it
   * actually holds the lock; `done` once it let go.
   */
  hold(name: string): { granted: Promise<void>; done: Promise<void>; release(): void } {
    let release!: () => void;
    let onGranted!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const granted = new Promise<void>((r) => (onGranted = r));
    const done = this.request(name, { mode: 'exclusive' }, async () => {
      onGranted();
      await gate;
    });
    return { granted, done, release: () => release() };
  }

  private releaseLock(name: string): void {
    this.held.delete(name);
    const q = this.queues.get(name);
    const next = q?.shift();
    if (q && q.length === 0) this.queues.delete(name);
    next?.grant();
  }
}

/**
 * PLATFORM's real `webLocks()` provider bound to `manager` (navigator.locks is faked only while the provider is
 * created — it captures the manager — so nothing else in the test process sees the fake navigator).
 */
export function webLocksOver(manager: FakeLockManager, timeoutMs?: number): LockProvider {
  const g = globalThis as { navigator?: unknown };
  const had = Object.prototype.hasOwnProperty.call(g, 'navigator');
  const prev = Object.getOwnPropertyDescriptor(g, 'navigator');
  Object.defineProperty(g, 'navigator', { value: { locks: manager }, configurable: true, writable: true });
  try {
    const p = timeoutMs === undefined ? webLocks() : webLocks(timeoutMs);
    if (!p) throw new Error('webLocks() did not pick up navigator.locks');
    return p;
  } finally {
    if (had && prev) Object.defineProperty(g, 'navigator', prev);
    else delete g.navigator;
  }
}

/** The cross-window save lock name SaveManagerImpl uses for a backend. */
export function saveLockName(backendId: string): string {
  return `afterlife-lease:saves:${backendId}`;
}
