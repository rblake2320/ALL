/**
 * Change notification for the UI (GameController.subscribe).
 *
 *  - `notifyNow()`  — discrete changes (screen/mode/selection/menu/dialog): listeners run synchronously.
 *  - `markDirty()`  — continuous changes (clock, needs, fps): coalesced, flushed at most every `minIntervalMs`
 *                     (≈12×/s) either by the frame loop (`pump`) or by a fallback timer when frames stop.
 *
 * Fault barrier: a throwing listener is reported and never prevents the others from running.
 * Re-entrancy: a listener that triggers another notification schedules one extra pass instead of recursing.
 */
import type { TimerHandle } from './env';

export interface NotifierOptions {
  minIntervalMs: number;
  now(): number;
  setTimeout(cb: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
  onListenerError(err: unknown): void;
}

const MAX_PASSES = 4;

export class Notifier {
  private readonly listeners = new Set<() => void>();
  private versionCounter = 0;
  private dirtyFlag = false;
  private lastFlushAt = Number.NEGATIVE_INFINITY;
  private timer: TimerHandle | null = null;
  private flushing = false;
  private again = false;
  private disposed = false;

  constructor(private readonly opts: NotifierOptions) {}

  /** Bumped once per flush; UI hooks may use it as an external-store snapshot. */
  get version(): number {
    return this.versionCounter;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  subscribe(fn: () => void): () => void {
    if (typeof fn !== 'function' || this.disposed) return () => undefined;
    // A unique wrapper per subscription: subscribing the same function twice yields two independent handles.
    const entry = (): void => fn();
    this.listeners.add(entry);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(entry);
    };
  }

  notifyNow(): void {
    if (this.disposed) return;
    this.dirtyFlag = false;
    this.cancelTimer();
    if (this.flushing) {
      this.again = true;
      return;
    }
    this.flushing = true;
    let passes = 0;
    try {
      do {
        this.again = false;
        this.versionCounter++;
        this.lastFlushAt = this.opts.now();
        for (const l of Array.from(this.listeners)) {
          if (!this.listeners.has(l)) continue; // unsubscribed earlier in this pass
          try {
            l();
          } catch (e) {
            this.opts.onListenerError(e);
          }
        }
        passes++;
      } while (this.again && passes < MAX_PASSES);
    } finally {
      this.flushing = false;
    }
    if (this.again) {
      // Listeners keep re-notifying: defer the rest instead of spinning.
      this.again = false;
      this.markDirty();
    }
  }

  markDirty(): void {
    if (this.disposed) return;
    this.dirtyFlag = true;
    if (this.timer === null) {
      const elapsed = this.opts.now() - this.lastFlushAt;
      const wait = Number.isFinite(elapsed) ? Math.max(0, this.opts.minIntervalMs - elapsed) : 0;
      this.timer = this.opts.setTimeout(() => {
        this.timer = null;
        if (this.dirtyFlag) this.notifyNow();
      }, Math.max(wait, 1));
    }
  }

  /** Frame-synchronous flush (keeps UI updates aligned with rendered frames). */
  pump(nowMs: number): void {
    if (!this.dirtyFlag || this.disposed) return;
    if (nowMs - this.lastFlushAt >= this.opts.minIntervalMs) this.notifyNow();
  }

  get isDirty(): boolean {
    return this.dirtyFlag;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.listeners.clear();
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.opts.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
