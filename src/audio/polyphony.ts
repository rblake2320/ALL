/**
 * Pure voice-allocation logic (no WebAudio): fixed-capacity pool with oldest-voice stealing, plus a
 * per-key rate limiter so spammed one-shots (20 footsteps in one frame) cannot flam into a roar.
 * Storage is preallocated; add/prune never allocate.
 */

export interface PoolHooks<T> {
  /** Voice forcibly cut (stolen or group-stopped): fade it out quickly. */
  steal(item: T): void;
  /** Voice finished naturally: release resources. */
  expire(item: T): void;
}

export class VoicePool<T> {
  readonly capacity: number;
  private readonly items: (T | null)[];
  private readonly starts: Float64Array;
  private readonly ends: Float64Array;
  private readonly groups: Float64Array;
  private readonly order: Float64Array;
  private seq = 0;
  private count = 0;

  constructor(capacity: number, private readonly hooks: PoolHooks<T>) {
    const cap = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : 1;
    this.capacity = cap;
    this.items = new Array<T | null>(cap).fill(null);
    this.starts = new Float64Array(cap);
    this.ends = new Float64Array(cap);
    this.groups = new Float64Array(cap).fill(NaN);
    this.order = new Float64Array(cap);
  }

  get size(): number {
    return this.count;
  }

  /** Expire voices whose end time is <= now. Returns how many expired. */
  prune(now: number): number {
    if (this.count === 0) return 0;
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const it = this.items[i];
      if (it !== null && this.ends[i] <= now) {
        this.items[i] = null;
        this.groups[i] = NaN;
        this.count--;
        n++;
        this.safe(this.hooks.expire, it);
      }
    }
    return n;
  }

  /**
   * Register a voice. If the pool is full the oldest voice (earliest start, then earliest insertion) is
   * stolen first. Returns the stolen item, or null.
   */
  add(item: T, start: number, end: number, group: number = NaN): T | null {
    const s = Number.isFinite(start) ? start : 0;
    const e = Number.isFinite(end) ? Math.max(end, s) : s;
    this.prune(s);
    let slot = -1;
    let stolen: T | null = null;
    for (let i = 0; i < this.capacity; i++) {
      if (this.items[i] === null) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      slot = this.oldestSlot();
      stolen = this.items[slot];
      this.items[slot] = null;
      this.count--;
      if (stolen !== null) this.safe(this.hooks.steal, stolen);
    }
    this.items[slot] = item;
    this.starts[slot] = s;
    this.ends[slot] = e;
    this.groups[slot] = typeof group === 'number' ? group : NaN;
    this.order[slot] = this.seq++;
    this.count++;
    return stolen;
  }

  /** Cut every voice of a group (e.g. the previous utterance of the same zombie). Returns count. */
  stopGroup(group: number): number {
    if (typeof group !== 'number' || Number.isNaN(group) || this.count === 0) return 0;
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const it = this.items[i];
      if (it !== null && this.groups[i] === group) {
        this.items[i] = null;
        this.groups[i] = NaN;
        this.count--;
        n++;
        this.safe(this.hooks.steal, it);
      }
    }
    return n;
  }

  /** Remove everything; `cut` decides whether hooks.steal (true) or hooks.expire (false) runs. */
  clear(cut: boolean): void {
    for (let i = 0; i < this.capacity; i++) {
      const it = this.items[i];
      if (it !== null) {
        this.items[i] = null;
        this.groups[i] = NaN;
        this.safe(cut ? this.hooks.steal : this.hooks.expire, it);
      }
    }
    this.count = 0;
  }

  /** Visit live voices (debug/stats). */
  forEach(fn: (item: T, start: number, end: number) => void): void {
    for (let i = 0; i < this.capacity; i++) {
      const it = this.items[i];
      if (it !== null) fn(it, this.starts[i], this.ends[i]);
    }
  }

  private oldestSlot(): number {
    let best = 0;
    for (let i = 1; i < this.capacity; i++) {
      if (this.starts[i] < this.starts[best] || (this.starts[i] === this.starts[best] && this.order[i] < this.order[best])) {
        best = i;
      }
    }
    return best;
  }

  private safe(fn: (item: T) => void, item: T): void {
    try {
      fn(item);
    } catch {
      /* hooks must never break allocation */
    }
  }
}

/**
 * Allows at most `maxPerWindow` events per key inside a sliding `windowSec`. Ring buffer per key.
 * Time going backwards (new context) resets that key.
 */
export class RateLimiter {
  private readonly stamps: Float64Array;
  private readonly heads: Int32Array;
  readonly keys: number;
  readonly maxPerWindow: number;
  readonly windowSec: number;

  constructor(keys: number, maxPerWindow: number, windowSec: number) {
    this.keys = Math.max(1, Math.floor(Number.isFinite(keys) ? keys : 1));
    this.maxPerWindow = Math.max(1, Math.floor(Number.isFinite(maxPerWindow) ? maxPerWindow : 1));
    this.windowSec = Number.isFinite(windowSec) && windowSec > 0 ? windowSec : 0.05;
    this.stamps = new Float64Array(this.keys * this.maxPerWindow).fill(-Infinity);
    this.heads = new Int32Array(this.keys);
  }

  allow(key: number, now: number): boolean {
    if (!(key >= 0 && key < this.keys) || !Number.isFinite(now)) return true;
    const k = Math.floor(key);
    const base = k * this.maxPerWindow;
    const head = this.heads[k];
    // slot `head` holds the oldest of the last N stamps
    const oldest = this.stamps[base + head];
    const newest = this.stamps[base + ((head + this.maxPerWindow - 1) % this.maxPerWindow)];
    if (newest > now) {
      // clock went backwards: forget history for this key
      for (let i = 0; i < this.maxPerWindow; i++) this.stamps[base + i] = -Infinity;
    } else if (now - oldest < this.windowSec) {
      return false;
    }
    this.stamps[base + this.heads[k]] = now;
    this.heads[k] = (this.heads[k] + 1) % this.maxPerWindow;
    return true;
  }

  reset(): void {
    this.stamps.fill(-Infinity);
    this.heads.fill(0);
  }
}
