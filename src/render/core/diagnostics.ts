/**
 * Throttled console warnings + a frame-rate meter. Per-frame code paths catch everything and report through
 * `warn` so a misbehaving model or bad state cannot flood the console or crash the loop.
 */

export class ThrottledWarn {
  private readonly last = new Map<string, number>();
  private readonly counts = new Map<string, number>();
  constructor(
    private readonly intervalMs = 5000,
    private readonly now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  ) {}

  /** Log at most once per interval per key; returns true when it actually logged. */
  warn(key: string, message: string, err?: unknown): boolean {
    const t = this.now();
    const prev = this.last.get(key);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    if (prev !== undefined && t - prev < this.intervalMs) return false;
    this.last.set(key, t);
    const n = this.counts.get(key) ?? 1;
    this.counts.set(key, 0);
    const suffix = n > 1 ? ` (×${n} since last report)` : '';
    try {
      if (err !== undefined) console.warn(`[render] ${message}${suffix}`, err);
      else console.warn(`[render] ${message}${suffix}`);
    } catch {
      /* console unavailable */
    }
    if (this.last.size > 512) this.last.clear();
    return true;
  }
}

/** Exponentially smoothed FPS from frame timestamps (ms). */
export class FpsMeter {
  private lastMs = -1;
  private avgDt = 1 / 60;
  private samples = 0;

  tick(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    if (this.lastMs >= 0) {
      const dt = (nowMs - this.lastMs) / 1000;
      if (dt > 0 && dt < 2) {
        const k = this.samples < 10 ? 0.5 : 0.08;
        this.avgDt += (dt - this.avgDt) * k;
        this.samples++;
      }
    }
    this.lastMs = nowMs;
  }

  fps(): number {
    if (this.samples === 0) return 0;
    const f = 1 / this.avgDt;
    return Number.isFinite(f) ? Math.round(f * 10) / 10 : 0;
  }
}
