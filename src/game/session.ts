/**
 * GameSession: everything tied to ONE played world — the SimulationAPI, its save slots, real play time, the
 * world-change signature used for idempotent autosaves, and player "facts" for tutorial hints.
 *
 * All world mutation from the controller goes through `dispatch()`: a fault barrier (a throwing dispatch becomes
 * { ok: false }) that also counts successful commands, so edits made while paused (build mode) change the
 * signature even though the tick does not.
 */
import type { Command, CommandResult, SimulationAPI } from '../sim/contracts';
import { autosaveSlotFor, manualSlotFor } from './saves';
import { describeError } from './diagnostics';

export interface SessionOrigin {
  /** Slot the world was loaded from (null for a new game). */
  loadedFrom: string | null;
  /** Play time already recorded in that save. */
  playMinutesBase: number;
}

export interface PlayerFacts {
  playerSelected: boolean;
  menuOpened: boolean;
  queuedAction: boolean;
  speedChanged: boolean;
  enteredBuy: boolean;
  enteredBuild: boolean;
}

/**
 * Commands that never change the saved world. `endBuildSession` only clears the in-memory undo history; counting it
 * would mark the world "unsaved" every time the player peeks into buy mode (extra writes + a "leave site?" prompt).
 */
const NON_MUTATING: ReadonlySet<Command['type']> = new Set<Command['type']>(['endBuildSession']);

/**
 * Write-ahead hook (command journal, journal.ts): `record` runs BEFORE the command is applied and returns a callback
 * that receives the live result.
 */
export interface JournalSink {
  record(cmd: Command, tick: number): (ok: boolean) => void;
}

/**
 * Read-only command observer (W-117 playtest session log): called BEFORE the command is applied (it may read state)
 * and returns a callback that receives the result. It never sees or changes what the sim receives.
 */
export type CommandObserver = (cmd: Command) => ((result: CommandResult) => void) | null;

/** Commands dispatched before a journal sink is attached are kept (bounded) and handed to it on attach. */
const PRELOG_MAX = 512;

/** Process-wide session serial: signatures of two different worlds can never collide (see signature()). */
let sessionSerial = 0;

export class GameSession {
  /** Unique per session in this page (prefix of every signature). */
  readonly serial = ++sessionSerial;
  readonly autosaveSlot: string;
  readonly manualSlot: string;
  readonly playMinutesBase: number;
  readonly loadedFrom: string | null;
  readonly facts: PlayerFacts = { playerSelected: false, menuOpened: false, queuedAction: false, speedChanged: false, enteredBuy: false, enteredBuild: false };
  gameOver = false;
  gameOverReason: string | null = null;
  private mutations = 0;
  private playedMs = 0;
  private readonly onError: (where: string, err: unknown) => void;
  private sink: JournalSink | null = null;
  private prelog: { cmd: Command; tick: number; ok: boolean }[] | null = [];
  private observer: CommandObserver | null = null;

  constructor(
    readonly sim: SimulationAPI,
    origin: SessionOrigin,
    onError: (where: string, err: unknown) => void,
  ) {
    this.onError = onError;
    this.loadedFrom = origin.loadedFrom;
    this.playMinutesBase = Number.isFinite(origin.playMinutesBase) && origin.playMinutesBase > 0 ? origin.playMinutesBase : 0;
    const world = { seed: sim.state?.seed ?? 0 };
    this.autosaveSlot = autosaveSlotFor(world);
    this.manualSlot = manualSlotFor(world, origin.loadedFrom);
    this.gameOver = sim.state?.gameOver === true;
  }

  /**
   * Identity of the world state: changes on every tick and every successful world-changing command. Prefixed with
   * the session serial so a save of a previous world that settles late can never be mistaken for this one.
   */
  signature(): string {
    let tick = -1;
    try {
      tick = this.sim.state.tick;
    } catch {
      /* broken state: still unique per mutation */
    }
    return `${this.serial}:${tick}:${this.mutations}`;
  }

  get mutationCount(): number {
    return this.mutations;
  }

  noteMutation(): void {
    this.mutations++;
  }

  /**
   * Attach (or detach with null) the command journal. Commands dispatched before the first attach (e.g. the autonomy
   * setting applied while the session is entered) are handed over first, with their results, so a replay sees them.
   */
  setJournalSink(sink: JournalSink | null): void {
    this.sink = sink;
    const pre = this.prelog;
    this.prelog = null;
    if (!sink || !pre) return;
    for (const p of pre) {
      try {
        sink.record(p.cmd, p.tick)(p.ok);
      } catch (e) {
        this.onError('journal.prelog', e);
      }
    }
  }

  /** Attach (or detach with null) the read-only command observer (session log). */
  setCommandObserver(o: CommandObserver | null): void {
    this.observer = o;
  }

  private observeBefore(cmd: Command): ((result: CommandResult) => void) | null {
    if (!this.observer) return null;
    try {
      return this.observer(cmd);
    } catch (e) {
      this.onError('sessionLog.observe', e);
      return null;
    }
  }

  private journalBefore(cmd: Command): ((ok: boolean) => void) | null {
    let tick = -1;
    try {
      tick = this.sim.state.tick;
    } catch {
      tick = -1;
    }
    if (this.sink) {
      try {
        return this.sink.record(cmd, tick);
      } catch (e) {
        this.onError('journal.record', e);
        return null;
      }
    }
    const pre = this.prelog;
    if (!pre || pre.length >= PRELOG_MAX) return null;
    const entry = { cmd, tick, ok: false };
    pre.push(entry);
    return (ok) => {
      entry.ok = ok;
    };
  }

  dispatch(cmd: Command): CommandResult {
    const done = this.journalBefore(cmd);
    const seen = this.observeBefore(cmd);
    let result: CommandResult;
    try {
      const r = this.sim.dispatch(cmd);
      if (!r || typeof r !== 'object') result = { ok: false, reason: 'No response from the simulation' };
      else {
        if (r.ok && !NON_MUTATING.has(cmd.type)) this.mutations++;
        result = r;
      }
    } catch (e) {
      this.onError(`dispatch:${cmd.type}`, e);
      result = { ok: false, reason: describeError(e) };
    }
    if (done) {
      try {
        done(result.ok === true);
      } catch (e) {
        this.onError('journal.result', e);
      }
    }
    if (seen) {
      try {
        seen(result);
      } catch (e) {
        this.onError('sessionLog.observe', e);
      }
    }
    return result;
  }

  addPlayTime(ms: number): void {
    if (Number.isFinite(ms) && ms > 0 && ms < 5_000) this.playedMs += ms;
  }

  get sessionSeconds(): number {
    return this.playedMs / 1000;
  }

  playMinutes(): number {
    return Math.round(this.playMinutesBase + this.playedMs / 60_000);
  }
}
