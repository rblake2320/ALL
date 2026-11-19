/**
 * Game side of the write-ahead command journal (persistence/journal.ts holds the storage format).
 *
 * WHAT is journaled — the audit behind "replay reproduces the run":
 *  - The sim only changes through `sim.step()` (frame loop) and `sim.dispatch(cmd)`; every dispatch in the game goes
 *    through `GameSession.dispatch`, which reports it here BEFORE applying it (write-ahead). Nothing else in src/game,
 *    src/ui or src/render writes `sim.state` (checked with grep; build previews / menus / views are read-only).
 *  - The sim consumes NO other non-deterministic input: no Math.random / Date.now / performance.now inside src/sim
 *    (enforced by src/sim/rng.ts' rule and the engine's determinism tests); RNG state lives in WorldState.rng; game
 *    speed only decides how many step() calls run per frame, so recording the tick each command was dispatched at
 *    is enough; drained events live outside WorldState.
 *  - Known non-serialized state: the BuildService undo/redo history. A snapshot taken mid build-session followed by an
 *    `undo` can replay differently — caught by the divergence check below (the replay stops just before it).
 *  So an entry is (tick, command, live ok) and, once per flush while time runs, a marker (tick, fingerprint).
 *
 * Divergence check: every command entry stores the live `ok`, every marker a fingerprint (RNG state, id counter,
 * funds). If a replayed result differs, the world is rebuilt from the snapshot and replayed only up to the entry
 * before the mismatch — a replay can lose the tail, never produce a world that did not exist.
 *
 * Cadence: ops are batched and flushed at most once per JOURNAL_FLUSH_MS (1 s) from the frame loop, and immediately
 * on tab hide / pagehide / beforeunload / desktop close / crash. Every successful save rebases the journal (truncate).
 *
 * Saves and the journal (W-119): a save first STAGES its epoch (stage(): the payload hash is computed exactly as the
 * SaveManager will, and the new epoch is durable before the snapshot write starts; every later flush writes it first),
 * then `committed()` promotes it — so a kill at any point between "snapshot serialized" and "rebase done" finds a
 * journal for whichever snapshot is in the slot. The anchor is idempotent: a save whose result is not the snapshot it
 * serialized (coalesced into a newer queued save of the same slot) never re-anchors the journal.
 *
 * Build history (W-119): the BuildService undo/redo stack is not saved, so a snapshot taken while it is non-empty
 * cannot replay an undo/redo that reaches back past it (the divergence check stops there). When such an undo/redo
 * succeeds, `onReplayHazard` asks for an immediate save so the journal is re-anchored on a snapshot that already
 * contains it; until that save lands, a kill keeps the verified prefix before the undo (build mode is paused).
 */
import type { Command, CommandResult, SimulationAPI } from '../sim/contracts';
import type { LoadResult, StorageBackend } from '../persistence/contracts';
import type { LockProvider } from '../persistence/locks';
import { JournalWriter, readJournal, type FlushOutcome, type JournalBase, type JournalEntry, type JournalOp, type RecoveredJournal } from '../persistence/journal';
import { savePayloadSha256 } from '../persistence/saveManager';
import type { GameEnv } from './env';
import type { GameSession, JournalSink } from './session';
import { autosaveSlotFor, withResponsiveTimeout, withTimeout } from './saves';
import { describeError } from './diagnostics';

export const JOURNAL_FLUSH_MS = 1000;
/** A batch holding at least one COMMAND is flushed this soon after its first command (player actions are rare and
 *  precious; pure time markers keep the 1 s cadence). */
export const JOURNAL_COMMAND_FLUSH_MS = 250;
/** Retry the cross-window journal lock this often while another window holds it. */
export const JOURNAL_LOCK_RETRY_MS = 3000;
/** Lock retry interval, and how long it applies, right after this session replaced one in the same window. */
export const JOURNAL_LOCK_FAST_RETRY_MS = 100;
export const JOURNAL_LOCK_FAST_RETRY_WINDOW_MS = 4000;
/** Give up replaying after this much wall time (the replayed prefix is kept; loading never hangs). */
export const REPLAY_BUDGET_MS = 20_000;
/** Yield to the UI after this much continuous replay work. */
export const REPLAY_SLICE_MS = 24;
/**
 * How long a load waits for the journal lock's answer, in RESPONSIVE time (withResponsiveTimeout): the request is
 * `ifAvailable`, so the lock manager answers at once — "granted" or "another window holds it". The only thing that
 * delays the answer is our own blocked main thread, which must never be mistaken for another window (W-134).
 */
export const LOCK_TIMEOUT_MS = 2000;
/** A save waits at most this long for its journal epoch to be staged (a stuck journal never blocks saving). */
export const JOURNAL_STAGE_TIMEOUT_MS = 2000;
/** Immediate retries of a failed staging write before the save goes ahead anyway. */
export const JOURNAL_STAGE_RETRIES = 8;

/**
 * Cheap fingerprint of the deterministic core (RNG state, id counter, funds). W-025 S4 (§1.11): once streaming has
 * brought any region besides the home live, an optional `|s<hash>` of the sorted active set is appended, so a replay
 * also verifies the derived region activations. A home-only world (and every pre-S4 journal) has no suffix.
 */
export function worldFingerprint(sim: SimulationAPI): string {
  try {
    const s = sim.state;
    const r = s.rng;
    const base = `${r.a},${r.b},${r.c},${r.d}|${s.nextId}|${Math.round((s.household?.funds ?? 0) * 100)}`;
    const active = s.town && s.town.stream && Array.isArray(s.town.stream.active) ? s.town.stream.active : null;
    return active && active.length > 1 ? `${base}|s${streamHash(active)}` : base;
  } catch {
    return 'x';
  }
}

function streamHash(active: readonly string[]): string {
  let h = 0x811c9dc5;
  const text = active.join(',');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16);
}

/** A recorded fingerprint without the stream suffix (an older journal) verifies against the base part only. */
export function fingerprintMatches(recorded: string, now: string): boolean {
  if (recorded === now) return true;
  return !recorded.includes('|s') && now.startsWith(`${recorded}|s`);
}

/** JSON-clean copy of a command (drops undefined, exactly what a replay will see). */
export function cloneCommand(cmd: Command): unknown {
  return JSON.parse(JSON.stringify(cmd)) as unknown;
}

export interface ReplayOptions {
  now(): number;
  budgetMs?: number;
  sliceMs?: number;
  /** Await between slices (e.g. a 0 ms timeout). Omit for a synchronous-ish replay (tests). */
  yieldFn?: () => Promise<void>;
  onProgress?(done: number, total: number): void;
  /** Compare live results / fingerprints (default true). */
  check?: boolean;
}

export interface ReplayResult {
  /** Entries fully applied (prefix length). */
  applied: number;
  /** Why the replay stopped before the end (null = all entries applied). */
  stopped: string | null;
  /** True when the stop was a divergence (the world already contains the diverged entry's effect). */
  diverged: boolean;
  ticks: number;
}

/**
 * Apply `entries` to `sim` (which must be the entries' snapshot): step to each entry's tick, dispatch its command,
 * verify. Never throws.
 */
export async function replayEntries(sim: SimulationAPI, entries: readonly JournalEntry[], opts: ReplayOptions): Promise<ReplayResult> {
  const budget = opts.budgetMs ?? REPLAY_BUDGET_MS;
  const slice = opts.sliceMs ?? REPLAY_SLICE_MS;
  const check = opts.check !== false;
  const t0 = opts.now();
  let sliceStart = t0;
  let ticks = 0;
  for (let k = 0; k < entries.length; k++) {
    const e = entries[k];
    while (sim.state.tick < e.t) {
      sim.step();
      ticks++;
      if ((ticks & 255) === 0) sim.drainEvents();
      if ((ticks & 15) === 0) {
        const now = opts.now();
        if (now - t0 > budget) return { applied: k, stopped: 'the replay ran out of time', diverged: false, ticks };
        if (opts.yieldFn && now - sliceStart > slice) {
          opts.onProgress?.(k, entries.length);
          await opts.yieldFn();
          sliceStart = opts.now();
        }
      }
    }
    if (sim.state.tick !== e.t) return { applied: k, stopped: `tick ${sim.state.tick} overshot entry ${k} (tick ${e.t})`, diverged: false, ticks };
    if (e.c !== undefined) {
      let r: CommandResult | null = null;
      try {
        r = sim.dispatch(e.c as Command);
      } catch {
        r = null;
      }
      const ok = !!r && r.ok === true;
      if (check && e.ok !== undefined && ok !== e.ok) return { applied: k, stopped: `command ${k} (${String((e.c as { type?: unknown }).type)}) replayed differently`, diverged: true, ticks };
    }
    if (check && e.fp !== undefined && !fingerprintMatches(e.fp, worldFingerprint(sim))) return { applied: k, stopped: `the world drifted at entry ${k}`, diverged: true, ticks };
  }
  sim.drainEvents();
  return { applied: entries.length, stopped: null, diverged: false, ticks };
}

export interface RecoverySummary {
  /** Entries replayed. */
  entries: number;
  commands: number;
  /** Real seconds of play since the snapshot that were restored. */
  seconds: number;
  /** Entries stored past the replayed prefix (corrupt tail / divergence / budget). */
  dropped: number;
  stopped: string | null;
}

interface PendingLoad {
  sim: SimulationAPI;
  writer: JournalWriter | null;
  base: JournalBase | null;
  recovered: RecoverySummary | null;
}

export interface JournalMark {
  writer: JournalWriter;
  g: number;
  at: number;
  tick: number;
  /** BuildService undo/redo history was non-empty when the snapshot was taken (an undo after it cannot replay). */
  history: boolean;
  /** payloadSha256 of the serialized snapshot as the SaveManager computes it (set by stage(); null = unknown). */
  sha: string | null;
}

export interface JournalFlowHost {
  readonly env: GameEnv;
  backend(): StorageBackend | null;
  locks?: LockProvider;
  report(where: string, err: unknown): void;
  /** A world-changing command was dispatched (event-driven saves hook in here). */
  onCommand?(cmd: Command, ok: boolean): void;
  /** An undo/redo succeeded that the current journal anchor cannot replay: save as soon as possible. */
  onReplayHazard?(): void;
  logger?: { warn(...a: unknown[]): void };
}

function validBackend(b: unknown): b is StorageBackend {
  if (!b || typeof b !== 'object') return false;
  const s = b as StorageBackend;
  return typeof s.read === 'function' && typeof s.write === 'function' && typeof s.list === 'function' && typeof s.remove === 'function' && typeof s.id === 'string';
}

/** Owns the journal of the session being played (at most one writer per page at a time). */
export class JournalFlow {
  private writer: JournalWriter | null = null;
  private session: GameSession | null = null;
  private pending: PendingLoad | null = null;
  private lastFlushAt = Number.NEGATIVE_INFINITY;
  /** When the oldest unflushed command must be written (null = none pending). */
  private commandDueAt: number | null = null;
  private lastAcquireTry = Number.NEGATIVE_INFINITY;
  /**
   * Until this time the lock is retried every frame-ish (JOURNAL_LOCK_FAST_RETRY_MS) instead of every 3 s: set when
   * this session replaced one in the same window. Real Web Locks free a released lock asynchronously, so the one
   * try right after the old writer's dispose can still find it held.
   */
  private fastRetryUntil = Number.NEGATIVE_INFINITY;
  /** The previous session's writer while it is still letting go (final flush, then the lock release). */
  private ending: Promise<void> | null = null;
  private recoveredNow: RecoverySummary | null = null;
  /** Op serial of the save the journal is anchored on, and whether it was taken with build history (see header). */
  private anchorG = Number.NEGATIVE_INFINITY;
  private anchorTainted = false;
  private readonly log: { warn(...a: unknown[]): void };

  constructor(private readonly host: JournalFlowHost) {
    this.log = host.logger ?? console;
  }

  get active(): JournalWriter | null {
    return this.writer;
  }

  /** Recovery result of the session that was just begun (consumed by the caller). */
  takeRecovery(): RecoverySummary | null {
    const r = this.recoveredNow;
    this.recoveredNow = null;
    return r;
  }

  private backend(): StorageBackend | null {
    try {
      const b = this.host.backend();
      return validBackend(b) ? b : null;
    } catch {
      return null;
    }
  }

  private makeWriter(backend: StorageBackend, ns: string): JournalWriter | null {
    try {
      return new JournalWriter({ backend, ns, locks: this.host.locks, wallNow: () => this.host.env.wallNow(), logger: this.log });
    } catch (e) {
      this.host.report('journal.create', e);
      return null;
    }
  }

  private discardPending(): void {
    const p = this.pending;
    this.pending = null;
    if (p?.writer && p.writer !== this.writer) p.writer.release();
  }

  /** Release a staged load that was refused before a session could adopt it. */
  cancelRecovery(): void {
    this.discardPending();
  }

  /**
   * After loading `res` into `sim0` (nothing stepped yet): if a journal extends exactly that snapshot, replay it.
   * Returns the sim to use (a rebuilt one if the first replay diverged). Never throws, never blocks for long.
   */
  async recover(
    res: Extract<LoadResult, { ok: true }>,
    sim0: SimulationAPI,
    makeSim: (world: ReturnType<SimulationAPI['serialize']>) => SimulationAPI,
    onProgress?: (fraction: number) => void,
  ): Promise<{ sim: SimulationAPI; recovered: RecoverySummary | null }> {
    this.discardPending();
    const backend = this.backend();
    const sha = res.payloadSha256;
    let ns: string;
    let tick: number;
    try {
      ns = autosaveSlotFor(sim0.state);
      tick = sim0.state.tick;
    } catch {
      return { sim: sim0, recovered: null };
    }
    if (!backend || typeof sha !== 'string' || typeof res.info?.slotId !== 'string' || !Number.isSafeInteger(tick)) return { sim: sim0, recovered: null };
    const base: JournalBase = { slotId: res.info.slotId.toLowerCase(), payloadSha256: sha, tick };
    const writer = this.makeWriter(backend, ns);
    if (!writer) return { sim: sim0, recovered: null };
    this.pending = { sim: sim0, writer, base, recovered: null };
    let unanswered = false;
    const held = await withResponsiveTimeout(writer.acquire(), LOCK_TIMEOUT_MS, this.host.env, () => {
      unanswered = true;
      return false;
    });
    if (this.pending?.writer !== writer) return { sim: sim0, recovered: null };
    // Another window plays this world right now: it owns the journal; load the snapshot as is.
    if (!held) {
      // No answer at all is NOT "another window": say so, so a load without its last moments is never silent.
      if (unanswered) this.log.warn(`[journal] ${ns}: the journal lock did not answer; loading the last save without replaying later play`);
      return { sim: sim0, recovered: null };
    }
    let rec: RecoveredJournal | null = null;
    try {
      rec = await readJournal(backend, ns, base, { logger: this.log });
    } catch (e) {
      this.host.report('journal.read', e);
      rec = null;
    }
    if (!rec || rec.entries.length === 0 || this.pending?.writer !== writer) {
      if (rec && rec.stoppedBecause) this.log.warn(`[journal] ${ns}: nothing replayable (${rec.stoppedBecause})`);
      return { sim: sim0, recovered: null };
    }
    let pristine: ReturnType<SimulationAPI['serialize']>;
    try {
      pristine = sim0.serialize();
    } catch (e) {
      this.host.report('journal.pristine', e);
      return { sim: sim0, recovered: null };
    }
    const env = this.host.env;
    const ropts: ReplayOptions = {
      now: () => env.now(),
      yieldFn: () => new Promise<void>((r) => env.setTimeout(r, 0)),
      onProgress: (d, t) => onProgress?.(t > 0 ? d / t : 1),
    };
    let sim = sim0;
    let applied = 0;
    let stopped: string | null = null;
    try {
      const r = await replayEntries(sim, rec.entries, ropts);
      applied = r.applied;
      stopped = r.stopped;
      if (r.diverged) {
        // The diverged entry's effect is already in `sim`: rebuild from the snapshot and replay the safe prefix only.
        this.log.warn(`[journal] ${ns}: ${r.stopped}; replaying the ${r.applied} entries before it`);
        sim = makeSim(JSON.parse(JSON.stringify(pristine)) as typeof pristine);
        const r2 = await replayEntries(sim, rec.entries.slice(0, r.applied), { ...ropts, check: false });
        applied = r2.applied;
      }
    } catch (e) {
      this.host.report('journal.replay', e);
      try {
        sim = makeSim(JSON.parse(JSON.stringify(pristine)) as typeof pristine);
      } catch {
        return { sim: sim0, recovered: null };
      }
      applied = 0;
      stopped = `replay failed: ${describeError(e)}`;
    }
    if (this.pending?.writer !== writer) return { sim, recovered: null };
    // The journaled timeline ran into game over. A game over is never saved (by design), so that timeline is finished,
    // not interrupted: load the snapshot as it is and drop the journal — otherwise every later load of this save would
    // replay the death onto it again.
    let ended = false;
    try {
      ended = sim.state.gameOver === true && pristine.gameOver !== true;
    } catch {
      ended = false;
    }
    if (ended) {
      let fresh: SimulationAPI | null = null;
      try {
        fresh = makeSim(JSON.parse(JSON.stringify(pristine)) as typeof pristine);
      } catch (e) {
        this.host.report('journal.gameOver', e);
      }
      if (fresh) {
        await writer.clear();
        if (this.pending?.writer !== writer) return { sim: fresh, recovered: null };
        this.pending = { sim: fresh, writer, base, recovered: null };
        return { sim: fresh, recovered: null };
      }
    }
    const entries = rec.entries.slice(0, applied);
    const adopted: RecoveredJournal = {
      ...rec,
      entries,
      stoppedBecause: applied < rec.entries.length ? stopped ?? 'stopped' : rec.stoppedBecause,
      droppedEntries: rec.droppedEntries + (rec.entries.length - applied),
    };
    writer.adopt(adopted, env.now());
    const last = entries[entries.length - 1];
    const summary: RecoverySummary | null =
      entries.length > 0
        ? {
            entries: entries.length,
            commands: entries.filter((e) => e.c !== undefined).length,
            seconds: last ? Math.max(0, Math.round(last.at / 1000)) : 0,
            dropped: adopted.droppedEntries,
            stopped: adopted.stoppedBecause,
          }
        : null;
    this.pending = { sim, writer, base, recovered: summary };
    return { sim, recovered: summary };
  }

  /** A new session is live: attach its journal (adopting a recovery prepared for exactly this sim). */
  begin(session: GameSession): void {
    this.end();
    this.session = session;
    this.lastFlushAt = this.host.env.now();
    this.lastAcquireTry = Number.NEGATIVE_INFINITY;
    this.anchorG = Number.NEGATIVE_INFINITY;
    this.anchorTainted = false; // a loaded / new world has no build history
    const p = this.pending;
    this.pending = null;
    let writer: JournalWriter | null = null;
    if (p && p.sim === session.sim && p.writer) {
      writer = p.writer;
      this.recoveredNow = p.recovered;
      if (p.base && !p.recovered) {
        // Loaded, nothing to replay: the loaded snapshot is the base. Another epoch on this same snapshot is the
        // journal of a session this load replaced (a reload while playing): retired, or recovery could pick it.
        void writer.rebase(p.base, writer.mark(), this.host.env.now(), { purgeOthers: 'same-base' });
      }
    } else {
      if (p?.writer) p.writer.release();
      const backend = this.backend();
      let ns: string | null = null;
      try {
        ns = session.autosaveSlot;
      } catch {
        ns = null;
      }
      if (backend && ns) writer = this.makeWriter(backend, ns);
    }
    this.writer = writer;
    if (writer) {
      if (!writer.holder) {
        void this.tryAcquire(writer);
        // The session this one replaced in this window (a reload while playing) still holds the lock until its final
        // flush is done: take it right then, not at the next 3 s retry — until this writer holds it, the replaced
        // session's epoch is the only one on disk.
        const ending = this.ending;
        if (ending) {
          this.fastRetryUntil = this.host.env.now() + JOURNAL_LOCK_FAST_RETRY_WINDOW_MS;
          void ending.then(async () => {
            if (this.writer !== writer || writer.holder) return;
            await writer.acquire();
            if (this.writer === writer) void this.tryAcquire(writer);
          });
        }
      }
      const sink: JournalSink = {
        record: (cmd, tick) => {
          let op: JournalOp | null = null;
          try {
            const now = this.host.env.now();
            op = writer.record({ t: tick, atAbs: now, c: cloneCommand(cmd) });
            this.commandDueAt ??= now + JOURNAL_COMMAND_FLUSH_MS;
          } catch (e) {
            this.host.report('journal.record', e);
          }
          return (ok) => {
            if (op) op.ok = ok;
            this.afterCommand(cmd, ok);
            this.host.onCommand?.(cmd, ok);
          };
        },
      };
      session.setJournalSink(sink);
    } else {
      session.setJournalSink({ record: (cmd) => (ok) => this.host.onCommand?.(cmd, ok) });
    }
  }

  private afterCommand(cmd: Command, ok: boolean): void {
    if (cmd.type === 'endBuildSession') this.anchorTainted = false; // history cleared: nothing reaches back past the anchor
    else if (ok && this.anchorTainted && (cmd.type === 'undo' || cmd.type === 'redo')) {
      // After the dispatch has fully returned (never re-enter the sim from inside its own dispatch).
      void Promise.resolve().then(() => this.host.onReplayHazard?.());
    }
  }

  private async tryAcquire(writer: JournalWriter): Promise<void> {
    this.lastAcquireTry = this.host.env.now();
    const ok = await writer.acquire();
    if (ok && this.writer === writer) void writer.flush();
  }

  /**
   * The live timeline ended in game over. A game over is never saved (by design), so its journal must never be
   * replayed onto the last save — including the commands after the last flush, which recover() cannot see as a
   * game over. Stop recording and delete this world's journal; loading the last save then loads it as it is.
   */
  timelineEnded(): Promise<void> {
    const w = this.writer;
    if (!w) return Promise.resolve();
    if (this.session) {
      try {
        this.session.setJournalSink(null);
      } catch {
        /* ignore */
      }
    }
    this.commandDueAt = null;
    return w.clear().catch((e: unknown) => this.host.report('journal.gameOver', e));
  }

  /** Session over: final flush + release the lock (async, best effort). */
  end(): void {
    const w = this.writer;
    this.writer = null;
    if (this.session) {
      try {
        this.session.setJournalSink(null);
      } catch {
        /* ignore */
      }
    }
    this.session = null;
    this.recoveredNow = null;
    if (w) {
      const done = w.dispose().catch((e: unknown) => this.host.report('journal.dispose', e));
      this.ending = done;
      void done.then(() => {
        if (this.ending === done) this.ending = null;
      });
    }
  }

  /**
   * A world's autosave slot was deleted: drop its journal too (nothing can replay onto a snapshot that is gone, and
   * stale chunks would only use up storage keys). Skipped for the live world and when another window holds it.
   */
  async discard(slotId: string): Promise<void> {
    const ns = typeof slotId === 'string' ? slotId.toLowerCase() : '';
    if (!/^auto-[0-9a-f]{8}$/.test(ns) || this.writer?.ns === ns || this.pending?.writer?.ns === ns) return;
    const backend = this.backend();
    if (!backend) return;
    const w = this.makeWriter(backend, ns);
    if (!w) return;
    try {
      if (await withResponsiveTimeout(w.acquire(), LOCK_TIMEOUT_MS, this.host.env, () => false)) await w.clear();
    } catch (e) {
      this.host.report('journal.discard', e);
    } finally {
      w.release();
    }
  }

  /** Called by a save job right when it serializes the world (synchronously). */
  mark(session: GameSession): JournalMark | null {
    const w = this.writer;
    if (!w || this.session !== session) return null;
    let tick = -1;
    try {
      tick = session.sim.state.tick;
    } catch {
      return null;
    }
    let history = false;
    try {
      const b = session.sim.build;
      history = !!b && (b.canUndo() === true || b.canRedo() === true);
    } catch {
      history = false;
    }
    return { writer: w, g: w.mark(), at: this.host.env.now(), tick, history, sha: null };
  }

  /**
   * Phase 1 (before the snapshot write starts): hash `world` (the snapshot serialized at `mark`) exactly as the
   * SaveManager will and open its journal epoch. Returns a promise to await before writing the snapshot when ops were
   * recorded since the mark (they must be durable in the new epoch first; bounded by JOURNAL_STAGE_TIMEOUT_MS), or
   * null when there is nothing to wait for (every later flush writes the staged epoch first). Never throws/rejects.
   */
  stage(mark: JournalMark | null, slotId: string, world: unknown): Promise<void> | null {
    if (!mark || mark.writer !== this.writer || mark.tick < 0) return null;
    const w = mark.writer;
    let p: Promise<FlushOutcome>;
    let wait: boolean;
    try {
      mark.sha = savePayloadSha256(world as Parameters<typeof savePayloadSha256>[0]);
      wait = w.hasOpsSince(mark.g);
      p = w.stage({ slotId: slotId.toLowerCase(), payloadSha256: mark.sha, tick: mark.tick }, mark.g, mark.at);
    } catch (e) {
      this.host.report('journal.stage', e);
      return null;
    }
    if (!wait) {
      void p.catch((e: unknown) => this.host.report('journal.stage', e));
      return null;
    }
    // Ops recorded since the mark are durable in the OLD epoch only until this lands: a transient write error must
    // not let the snapshot overtake them, so retry a few times (still bounded by the timeout: saving never waits on
    // a broken journal for long — past it the save goes ahead, the documented degraded mode).
    const settled = (async () => {
      let out = await p;
      for (let i = 0; i < JOURNAL_STAGE_RETRIES && out === 'failed' && this.writer === w; i++) out = await w.flush();
    })().catch((e: unknown) => this.host.report('journal.stage', e));
    return withTimeout(settled, JOURNAL_STAGE_TIMEOUT_MS, this.host.env, () => undefined);
  }

  /** That save failed: drop its staged epoch. */
  abandoned(mark: JournalMark | null): void {
    if (mark) mark.writer.unstage(mark.g);
  }

  /** That save is durable: rebase the journal onto it (phase 2: promotes the staged epoch; truncates the old one). */
  committed(mark: JournalMark | null, slotId: string, payloadSha256: string | undefined): void {
    if (!mark || typeof payloadSha256 !== 'string' || mark.writer !== this.writer || mark.tick < 0) return;
    if (mark.sha !== null && mark.sha !== payloadSha256) {
      // The slot holds a DIFFERENT snapshot than the one serialized at this mark (the request was coalesced into a
      // newer queued save of the same slot): anchoring here would pair that snapshot with the wrong ops.
      mark.writer.unstage(mark.g);
      return;
    }
    if (mark.g >= this.anchorG) {
      this.anchorG = mark.g;
      this.anchorTainted = mark.history;
    }
    void mark.writer.rebase({ slotId: slotId.toLowerCase(), payloadSha256, tick: mark.tick }, mark.g, mark.at).catch((e: unknown) => this.host.report('journal.rebase', e));
  }

  private recordMarker(now: number): void {
    const w = this.writer;
    const s = this.session;
    if (!w || !s) return;
    let tick: number;
    try {
      tick = s.sim.state.tick;
    } catch {
      return;
    }
    const last = w.lastOp?.t ?? w.currentBase?.tick ?? -1;
    if (!(tick > last)) return;
    w.record({ t: tick, atAbs: now, fp: worldFingerprint(s.sim) });
  }

  /** Every frame: ≤ 1 flush per second (marker + batched commands), lock retries. */
  pump(now: number): void {
    const w = this.writer;
    if (!w || !this.session) return;
    if (!w.holder) {
      const every = now < this.fastRetryUntil ? JOURNAL_LOCK_FAST_RETRY_MS : JOURNAL_LOCK_RETRY_MS;
      if (now - this.lastAcquireTry >= every) void this.tryAcquire(w);
    }
    const commandDue = this.commandDueAt !== null && now >= this.commandDueAt;
    if (!commandDue && now - this.lastFlushAt < JOURNAL_FLUSH_MS) return;
    this.lastFlushAt = now;
    if (!w.currentBase && w.stagedCount === 0) return; // nothing to anchor to until the first save
    this.commandDueAt = null;
    this.recordMarker(now);
    // flush() coalesces with one in flight (a follow-up runs right after it), so a batch never waits a whole extra second.
    if (w.holder && w.pendingCount > 0) void w.flush();
  }

  /** Flush now (tab hidden / pagehide / beforeunload / quit / crash). */
  flushNow(): Promise<void> {
    const w = this.writer;
    if (!w || !this.session || (!w.currentBase && w.stagedCount === 0)) return Promise.resolve();
    const now = this.host.env.now();
    this.recordMarker(now);
    this.lastFlushAt = now;
    this.commandDueAt = null;
    return w.flush().then(
      () => undefined,
      () => undefined,
    );
  }
}
