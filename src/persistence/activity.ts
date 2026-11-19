/**
 * Persistence activity tracking — the EXPLICIT "all saves have landed" signal for quitting.
 *
 * Every SaveManager / ProfileStore operation is counted from the moment it is CALLED until it settles
 * (CPU work included: hashing, gzip, verification). whenIdle() resolves `true` once nothing has run for
 * `quietMs` — measured from the later of the call and the last operation's end, so a save the game starts
 * a moment after the request (e.g. after capturing a thumbnail) is still awaited — or `false` when
 * `timeoutMs` passes first.
 *
 * The desktop shell (electron/main.ts) closes the window by dispatching `beforeunload` and then awaiting
 * `globalThis[QUIT_HOOK_GLOBAL].whenIdle(...)` through executeJavaScript, instead of guessing from storage
 * IPC silence (a big save can spend > 1 s computing between two storage calls). installQuitHook() defines
 * that global (non-enumerable, idempotent, never throws).
 */

export interface IdleOptions {
  /** Required silence before reporting idle (default 500 ms, clamped to 0..10 000). */
  quietMs?: number;
  /** Give up and resolve false after this long (default 5 000 ms, clamped to 1..60 000). */
  timeoutMs?: number;
}

export const QUIT_HOOK_GLOBAL = '__afterlifeLeasePersistence';
export const DEFAULT_QUIET_MS = 500;
export const DEFAULT_IDLE_TIMEOUT_MS = 5_000;
const POLL_MS = 25;

function clampOpt(v: unknown, def: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

export class ActivityTracker {
  private active = 0;
  private lastChange = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Number of operations in flight. */
  get busy(): number {
    return this.active;
  }

  /** Mark an operation as started; the returned function ends it (idempotent). */
  begin(): () => void {
    this.active++;
    this.lastChange = this.now();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.active = Math.max(0, this.active - 1);
      this.lastChange = this.now();
    };
  }

  /** Track a promise-returning operation for its whole lifetime. */
  async track<T>(fn: () => Promise<T>): Promise<T> {
    const end = this.begin();
    try {
      return await fn();
    } finally {
      end();
    }
  }

  whenIdle(opts: IdleOptions = {}): Promise<boolean> {
    const o = opts !== null && typeof opts === 'object' ? opts : {};
    const quietMs = clampOpt(o.quietMs, DEFAULT_QUIET_MS, 0, 10_000);
    const timeoutMs = typeof o.timeoutMs === 'number' && Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? Math.min(60_000, o.timeoutMs) : DEFAULT_IDLE_TIMEOUT_MS;
    const start = this.now();
    return new Promise<boolean>((resolve) => {
      const check = () => {
        const t = this.now();
        if (this.active === 0 && t - Math.max(this.lastChange, start) >= quietMs) return resolve(true);
        if (t - start >= timeoutMs) return resolve(false);
        setTimeout(check, Math.max(1, Math.min(POLL_MS, quietMs || POLL_MS)));
      };
      check();
    });
  }
}

/** Shared by every SaveManager/ProfileStore created through src/persistence/index.ts. */
export const persistenceActivity = new ActivityTracker();

/**
 * Expose `{ whenIdle }` as a non-enumerable global for the desktop shell's quit flow. Safe to call any
 * number of times; a frozen or non-configurable target is left alone (the shell then falls back to its
 * storage-IPC heuristic).
 */
export function installQuitHook(target: object = globalThis, tracker: ActivityTracker = persistenceActivity): void {
  try {
    const existing = Object.getOwnPropertyDescriptor(target, QUIT_HOOK_GLOBAL);
    if (existing && !existing.configurable) return;
    Object.defineProperty(target, QUIT_HOOK_GLOBAL, {
      value: Object.freeze({ whenIdle: (o?: unknown) => tracker.whenIdle((o ?? {}) as IdleOptions) }),
      enumerable: false,
      configurable: true,
      writable: false,
    });
  } catch {
    // frozen/sealed global or exotic host object: the shell falls back to its IPC heuristic
  }
}
