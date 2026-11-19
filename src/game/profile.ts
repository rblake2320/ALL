/**
 * Serialized, coalescing writes to the ProfileStore.
 *
 * Every `write(key, value)` snapshots the value immediately (later mutation by the caller cannot change what is
 * stored). Writes for the same key never overlap: while one is in flight, newer values replace each other in a
 * one-slot queue and only the latest is written next (last-writer-wins, no stale write can land after a newer
 * one). The returned promise resolves once the given value — or a newer one — has been handed to the store.
 * Errors are reported, never thrown (profile persistence is best-effort; the game keeps running).
 */
import type { ProfileStore } from '../persistence/contracts';

function snapshot<T>(value: T): T {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch {
    /* not cloneable: fall back to JSON */
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

export class ProfileWriter {
  private readonly queued = new Map<string, unknown>();
  private readonly active = new Map<string, Promise<void>>();
  /** Keys whose drain loop is currently running (set synchronously before the drain starts). */
  private readonly draining = new Set<string>();
  private failures = 0;

  constructor(
    private readonly store: ProfileStore,
    private readonly onError: (key: string, err: unknown) => void,
  ) {}

  get failureCount(): number {
    return this.failures;
  }

  /** True while any write is in flight. */
  get busy(): boolean {
    return this.active.size > 0;
  }

  write(key: string, value: unknown): Promise<void> {
    this.queued.set(key, snapshot(value));
    const running = this.active.get(key);
    if (running) return running;
    this.draining.add(key);
    const p = this.drain(key);
    // A store that throws (or settles) synchronously finishes the whole drain inside the call above. Registering
    // its promise afterwards would leave a stale "in flight" entry: every later write for the key would be dropped
    // and flush() would spin forever on an already-settled promise. Only a drain that is still running is tracked.
    if (this.draining.has(key)) this.active.set(key, p);
    return p;
  }

  /** Resolves when every pending write has been attempted. */
  async flush(): Promise<void> {
    while (this.active.size > 0) {
      await Promise.all(Array.from(this.active.values()));
    }
  }

  private async drain(key: string): Promise<void> {
    try {
      while (this.queued.has(key)) {
        const value = this.queued.get(key);
        this.queued.delete(key);
        try {
          await this.store.save(key, value);
        } catch (e) {
          this.failures++;
          this.onError(key, e);
        }
      }
    } finally {
      // Synchronously after the last queue check: any write() from now on starts a new drain.
      this.draining.delete(key);
      this.active.delete(key);
    }
  }
}

/** Load a profile key, tolerating a throwing/rejecting store. */
export async function safeProfileLoad<T>(store: ProfileStore, key: string, fallback: T, onError: (err: unknown) => void): Promise<T> {
  try {
    return await store.load<T>(key, fallback);
  } catch (e) {
    onError(e);
    return fallback;
  }
}
