/**
 * Autosave scheduling.
 *
 *  - Interval: every `intervalMs()` of REAL time (0 = off), only when `canAutosave()` (in game, no modal choice
 *    pending, not game over). A due save that is blocked simply waits until it is allowed.
 *  - Idempotent: a save is skipped when the world signature (sim tick + successful-command counter, so paused
 *    build-mode edits count as changes) equals the last successfully saved one — "same tick → no second write".
 *  - Coalescing: triggers that arrive while a save is in flight collapse into ONE follow-up run (which itself is
 *    skipped if nothing changed). Callers awaiting a coalesced trigger get the follow-up's outcome.
 *  - Failure backoff: retry after `retryMs`, doubling up to the interval.
 *  - Event triggers (quit / tab hidden / unload) bypass `canAutosave()` but not idempotency.
 *  - Sessions: `reset()` starts a new generation. A write that was in flight for the previous world may still
 *    settle afterwards (slow or hung disk); its result never touches the new generation's saved signature,
 *    failure count or schedule, and a follow-up the old world queued is resolved as 'skipped'.
 */
export type AutosaveOutcome = 'saved' | 'skipped' | 'failed';

/** `true`/`false`, or the outcome plus the signature the writer actually captured when it serialized. */
export type AutosaveWriteResult = boolean | { ok: boolean; signature: string | null };

export interface AutosaveDeps {
  now(): number;
  intervalMs(): number;
  canAutosave(): boolean;
  /** Identity of the current world state; null = nothing to save. */
  signature(): string | null;
  /** Perform the write (serialize synchronously first!). Resolve true on success. */
  write(reason: string): Promise<AutosaveWriteResult>;
  retryMs?: number;
}

interface Deferred {
  reason: string;
  promise: Promise<AutosaveOutcome>;
  resolve(o: AutosaveOutcome): void;
}

export class AutosaveScheduler {
  private lastSig: string | null = null;
  private nextDueAt: number;
  private inflight: Promise<AutosaveOutcome> | null = null;
  private followUp: Deferred | null = null;
  private failures = 0;
  private writes = 0;
  /** Bumped by reset(): results of runs started under an older generation are ignored. */
  private generation = 0;

  constructor(private readonly deps: AutosaveDeps) {
    this.nextDueAt = deps.now() + this.interval();
  }

  get busy(): boolean {
    return this.inflight !== null;
  }

  get writeCount(): number {
    return this.writes;
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  get dueAt(): number {
    return this.nextDueAt;
  }

  /** New session: forget the saved signature (or adopt one already persisted) and restart the interval. */
  reset(savedSignature: string | null = null): void {
    this.generation++;
    this.lastSig = savedSignature;
    this.failures = 0;
    this.nextDueAt = this.deps.now() + this.interval();
    // A follow-up queued for the previous world must not run against (or report on behalf of) the new one.
    const f = this.followUp;
    this.followUp = null;
    f?.resolve('skipped');
  }

  /** Mark the current world as persisted (e.g. a manual save into the autosave slot). */
  markSaved(signature: string | null): void {
    if (signature !== null) this.lastSig = signature;
  }

  /** The autosave copy is gone (slot deleted / overwritten): the next trigger must write even if nothing changed. */
  forget(): void {
    this.lastSig = null;
  }

  /** True when the world changed since the last successful save. */
  dirty(): boolean {
    const sig = this.deps.signature();
    return sig !== null && sig !== this.lastSig;
  }

  /** Interval changed in settings: re-anchor the next due time. */
  rescheduleFromNow(): void {
    this.nextDueAt = this.deps.now() + this.interval();
  }

  /** The scheduler's own gate (in game, no modal choice, not game over) — event-driven saves respect it too. */
  canAutosaveNow(): boolean {
    try {
      return this.deps.canAutosave();
    } catch {
      return false;
    }
  }

  /** Call every frame. */
  tick(): void {
    const interval = this.interval();
    if (!(interval > 0)) return;
    if (this.deps.now() < this.nextDueAt || this.inflight) return;
    if (!this.deps.canAutosave()) return;
    void this.trigger('interval');
  }

  trigger(reason: string): Promise<AutosaveOutcome> {
    if (this.inflight) {
      if (!this.followUp) {
        let resolve!: (o: AutosaveOutcome) => void;
        const promise = new Promise<AutosaveOutcome>((r) => (resolve = r));
        this.followUp = { reason, promise, resolve };
      }
      return this.followUp.promise;
    }
    return this.start(reason);
  }

  private interval(): number {
    const v = this.deps.intervalMs();
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  private start(reason: string): Promise<AutosaveOutcome> {
    let resolveOuter!: (o: AutosaveOutcome) => void;
    const outer = new Promise<AutosaveOutcome>((r) => (resolveOuter = r));
    // Mark in-flight BEFORE run() starts: write() executes synchronously up to its first await, and a re-entrant
    // trigger() from inside it must coalesce instead of starting a parallel write.
    this.inflight = outer;
    this.run(reason).then(
      (o) => resolveOuter(this.settle(o)),
      () => resolveOuter(this.settle('failed')),
    );
    return outer;
  }

  private settle(outcome: AutosaveOutcome): AutosaveOutcome {
    this.inflight = null;
    const f = this.followUp;
    this.followUp = null;
    if (f) void this.start(f.reason).then(f.resolve);
    return outcome;
  }

  private async run(reason: string): Promise<AutosaveOutcome> {
    const gen = this.generation;
    const sig = this.deps.signature();
    const interval = this.interval();
    if (sig === null) return 'skipped';
    if (sig === this.lastSig) {
      this.nextDueAt = this.deps.now() + interval;
      return 'skipped';
    }
    let ok = false;
    let savedSig: string | null = sig;
    try {
      this.writes++;
      const r = await this.deps.write(reason);
      if (typeof r === 'boolean') ok = r;
      else if (r && typeof r === 'object') {
        ok = r.ok === true;
        // The writer serializes when its job actually starts (possibly later than now, behind another save).
        if (typeof r.signature === 'string') savedSig = r.signature;
      }
    } catch {
      ok = false;
    }
    if (gen !== this.generation) return ok ? 'saved' : 'failed'; // a previous world's write: report, change nothing
    if (ok) {
      this.lastSig = savedSig;
      this.failures = 0;
      this.nextDueAt = this.deps.now() + interval;
      return 'saved';
    }
    this.failures++;
    const retry = this.deps.retryMs ?? 30_000;
    const backoff = retry * 2 ** Math.min(6, this.failures - 1);
    this.nextDueAt = this.deps.now() + (interval > 0 ? Math.min(interval, backoff) : backoff);
    return 'failed';
  }
}

/**
 * "Saved just now", "Saved 3 min ago", "Saved 2 h ago", "Saved 4 days ago"; "Save failed" when the latest attempt
 * failed; null when nothing was saved in this session. Uses wall-clock time (survives sleep/hibernate); a clock
 * that went backwards reads as "just now".
 */
export function formatSaveLabel(lastOkWallMs: number | null, nowWallMs: number, lastAttemptFailed: boolean): string | null {
  if (lastAttemptFailed) return 'Save failed';
  if (lastOkWallMs === null || !Number.isFinite(lastOkWallMs)) return null;
  const diff = Number.isFinite(nowWallMs) ? nowWallMs - lastOkWallMs : 0;
  if (!(diff >= 60_000)) return 'Saved just now';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `Saved ${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Saved ${h} h ago`;
  const d = Math.floor(h / 24);
  return `Saved ${d} ${d === 1 ? 'day' : 'days'} ago`;
}
