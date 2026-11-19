/**
 * Save/load orchestration for the controller: manual saves, autosaves (scheduler in autosave.ts), the emergency
 * save after a crash, list/delete/export/import, and the "Saved 3 min ago" label.
 *
 * Guarantees:
 *  - The world AND its SaveMeta are captured synchronously when the write job starts — immediately when no other
 *    save is running — before any await (only the thumbnail encode comes later), so a save is one consistent
 *    snapshot even though the sim keeps ticking during the async write.
 *  - Controller writes are serialized (SerialQueue) and every job has a watchdog: a hung storage call fails that
 *    one save after SAVE_JOB_TIMEOUT_MS instead of blocking every later save (and every quit) forever.
 *  - A write that settles after its session ended (slow disk, forced quit) never updates the next session's label
 *    or idempotency state.
 *  - Identical manual requests (same slot, name and world signature) in flight share one write.
 *  - Slot ids are validated here (charset, length, Windows device names) before storage is touched.
 *  - Nothing here rejects: failures become { ok: false } results plus a toast (an unhandled rejection would
 *    otherwise trip the global crash handler).
 */
import type { LoadResult, SaveManager, SaveResult, SaveSlotInfo } from '../persistence/contracts';
import type { LockProvider } from '../persistence/locks';
import type { Command, SimulationAPI } from '../sim/contracts';
import type { RendererAPI } from '../render/contracts';
import type { AgentId, NotificationKind } from '../sim/types';
import type { SfxId } from '../shared/audioIds';
import type { Screen, Settings } from './contracts';
import type { GameEnv } from './env';
import type { GameSession } from './session';
import { AutosaveScheduler, formatSaveLabel, type AutosaveOutcome, type AutosaveWriteResult } from './autosave';
import {
  EMERGENCY_SLOT,
  IMPORT_MAX_BYTES,
  SAVE_JOB_TIMEOUT_MS,
  SerialQueue,
  isReservedSlot,
  buildSaveMeta,
  captureThumbnail,
  defaultSaveName,
  exportMimeType,
  isValidSlotId,
  sameSlot,
  sanitizeFilename,
  withTimeout,
} from './saves';
import { describeError } from './diagnostics';
import { JournalFlow, type JournalMark, type RecoverySummary } from './journal';

export interface SaveFlowHost {
  /** False: the profile may not type text (child / unanswered, D-3); a typed save label is replaced by the default. */
  freeTextNames?(): boolean;
  readonly env: GameEnv;
  readonly renderer: RendererAPI;
  readonly saves: SaveManager;
  session(): GameSession | null;
  screen(): Screen;
  settings(): Settings;
  choicePending(): boolean;
  toast(kind: NotificationKind, title: string, text: string, opts?: { agentId?: AgentId | null; mergeKey?: string }): void;
  sfx(id: SfxId): void;
  report(where: string, err: unknown): void;
  changed(discrete: boolean): void;
  /** Cross-window lock provider for the command journal (default: Web Locks when available). Tests inject one. */
  journalLocks?: LockProvider;
}

/** Event-driven saves (day rollover, purchase, quest, build-mode exit, …) never run closer together than this. */
export const EVENT_SAVE_MIN_INTERVAL_MS = 10_000;
/** A burst of save-worthy events within this window becomes ONE save. */
export const EVENT_SAVE_DEBOUNCE_MS = 1500;

export type SaveKind = 'manual' | 'auto' | 'emergency';

const BAD_SLOT = 'That save slot name is not valid (use 1–40 letters, digits, - or _).';
const STUCK = 'Saving took too long — storage seems stuck. Try again, or export your save to keep it safe.';

interface WriteOutcome {
  res: SaveResult;
  /** Signature of the world that was serialized (null when serialization failed). */
  signature: string | null;
}

export class SaveFlow {
  readonly autosave: AutosaveScheduler;
  private readonly queue: SerialQueue;
  private lastOkWall: number | null = null;
  private lastFailed = false;
  /** Session whose crash save is being written right now (at most one per session at a time). */
  private emergencyFor: GameSession | null = null;
  /** Crash saves still writing, of any session (`saving` stays true until they settle or their watchdog fires). */
  private emergencyWrites = 0;
  private emergencyDone = false;
  private readonly manualInFlight = new Map<string, Promise<SaveResult>>();
  /** Write-ahead command journal of the live session (journal.ts). */
  readonly journal: JournalFlow;
  /** Pending event-driven save: fires at `soonAt` (monotonic ms). */
  private soonAt: number | null = null;
  private soonReason = '';
  /** When the last autosave write started (any reason) — spacing for event-driven saves. */
  private lastAutoWriteAt = Number.NEGATIVE_INFINITY;
  private lastDay: number | null = null;
  private daySession: GameSession | null = null;

  constructor(private readonly host: SaveFlowHost) {
    this.queue = new SerialQueue(host.env);
    this.journal = new JournalFlow({
      env: host.env,
      backend: () => host.saves.backend ?? null,
      locks: host.journalLocks,
      report: (w, e) => host.report(w, e),
      onCommand: (cmd, ok) => this.onCommand(cmd, ok),
      onReplayHazard: () => this.onReplayHazard(),
    });
    this.autosave = new AutosaveScheduler({
      now: () => host.env.now(),
      intervalMs: () => {
        const m = host.settings().autosaveMinutes;
        return Number.isFinite(m) && m > 0 ? m * 60_000 : 0;
      },
      canAutosave: () => {
        const s = host.session();
        return host.screen() === 'game' && !!s && !s.gameOver && !host.choicePending();
      },
      signature: () => {
        const s = host.session();
        return s && !s.gameOver ? s.signature() : null;
      },
      write: (reason) => this.writeAutosave(reason),
    });
  }

  get saving(): boolean {
    return this.queue.busy || this.emergencyWrites > 0;
  }

  label(): string | null {
    return formatSaveLabel(this.lastOkWall, this.host.env.wallNow(), this.lastFailed);
  }

  /** GameController.lastSavedAt: epoch ms of the current world's last successful save (or of the loaded save). */
  get lastSavedAt(): number | null {
    return this.lastOkWall;
  }

  /** GameController.lastSaveFailed: the latest save attempt for the current world failed. */
  get lastSaveFailed(): boolean {
    return this.lastFailed;
  }

  /**
   * New / loaded world: reset the label and the autosave scheduler. A world loaded from its own autosave slot is
   * already persisted there (quitting at once must not rewrite it); any other origin is "unsaved" relative to the
   * autosave slot, so the next autosave mirrors what is being played.
   */
  beginSession(info: SaveSlotInfo | null): void {
    this.lastFailed = false;
    const t = info ? Date.parse(info.savedAt) : NaN;
    this.lastOkWall = Number.isFinite(t) ? t : null;
    const s = this.host.session();
    const fromOwnAutosave = !!s && !!info && sameSlot(info.slotId, s.autosaveSlot);
    this.autosave.reset(fromOwnAutosave && s ? s.signature() : null);
    this.emergencyDone = false;
    this.manualInFlight.clear();
    this.soonAt = null;
    this.lastDay = null;
    this.daySession = null;
    if (s) {
      this.journal.begin(s);
      const rec = this.journal.takeRecovery();
      if (rec) this.announceRecovery(rec);
    } else this.journal.end();
  }

  /** "Recovered N seconds of play" (once) and save the recovered world right away (rebases the journal). */
  private announceRecovery(rec: RecoverySummary): void {
    const n = rec.seconds;
    const what = n >= 1 ? `${n} second${n === 1 ? '' : 's'} of play` : 'your last moments of play';
    this.host.toast('good', `Recovered ${what}`, 'The game closed unexpectedly; your latest actions were restored.', { mergeKey: 'journalRecovered' });
    this.autosave.forget();
    void this.autosave.trigger('recovered');
  }

  endSession(): void {
    this.lastOkWall = null;
    this.lastFailed = false;
    this.autosave.reset(null);
    this.manualInFlight.clear();
    this.soonAt = null;
    this.journal.end();
  }

  /**
   * After a save was loaded into `sim0` (before the session is entered): replay the slot's command journal if one
   * extends exactly this snapshot. Returns the sim to enter (see JournalFlow.recover). Never rejects.
   */
  recoverJournal(
    res: Extract<LoadResult, { ok: true }>,
    sim0: SimulationAPI,
    makeSim: (world: ReturnType<SimulationAPI['serialize']>) => SimulationAPI,
    onProgress?: (fraction: number) => void,
  ): Promise<{ sim: SimulationAPI; recovered: RecoverySummary | null }> {
    return this.journal.recover(res, sim0, makeSim, onProgress).catch((e: unknown) => {
      this.host.report('journal.recover', e);
      return { sim: sim0, recovered: null };
    });
  }

  /** Release a staged journal when a recovered world cannot be entered. */
  cancelRecovery(): void {
    this.journal.cancelRecovery();
  }

  /** Flush the command journal now (tab hidden, pagehide, beforeunload, quit, crash). */
  flushJournal(): Promise<void> {
    return this.journal.flushNow().catch((e: unknown) => this.host.report('journal.flush', e));
  }

  /**
   * Ask for a save soon (event-driven: purchase/unlock, quest completion, CAZ finish, build-mode exit, day rollover,
   * or anything the economy code deems precious). Debounced into one autosave, never closer than 10 s to the previous
   * autosave write, and still idempotent (nothing changed → nothing written).
   */
  saveSoon(reason: string): void {
    const s = this.host.session();
    if (!s || s.gameOver) return;
    const now = this.host.env.now();
    const at = Math.max(now + EVENT_SAVE_DEBOUNCE_MS, this.lastAutoWriteAt + EVENT_SAVE_MIN_INTERVAL_MS);
    if (this.soonAt === null) {
      this.soonAt = at;
      this.soonReason = typeof reason === 'string' && reason.length > 0 ? reason.slice(0, 40) : 'event';
    }
  }

  /**
   * An undo/redo just reached back past the snapshot the journal is anchored on (taken mid build session): a replay
   * would stop right before it, so re-anchor now — an immediate autosave, not the debounced event save.
   */
  private onReplayHazard(): void {
    const s = this.host.session();
    if (!s || s.gameOver) return;
    if (this.autosave.canAutosaveNow()) void this.autosave.trigger('journal:undo');
    else this.saveSoon('undo');
  }

  private onCommand(cmd: Command, ok: boolean): void {
    if (cmd.type === 'endBuildSession') this.saveSoon('buildExit');
    else if (ok && cmd.type === 'buyReward') this.saveSoon('purchase');
  }

  /** Every frame: autosave interval, journal batching, day rollover, pending event-driven save. */
  tick(): void {
    this.autosave.tick();
    const s = this.host.session();
    const now = this.host.env.now();
    this.journal.pump(now);
    if (s && !s.gameOver) {
      let day: number | null = null;
      try {
        const d = s.sim.time().day;
        day = Number.isFinite(d) ? d : null;
      } catch {
        day = null;
      }
      if (this.daySession !== s) {
        this.daySession = s;
        this.lastDay = day;
      } else if (day !== null && this.lastDay !== null && day > this.lastDay) {
        this.lastDay = day;
        this.saveSoon('day');
      } else if (day !== null) this.lastDay = day;
    }
    if (this.soonAt !== null && now >= this.soonAt && !this.autosave.busy && this.autosave.canAutosaveNow()) {
      const reason = this.soonReason;
      this.soonAt = null;
      void this.autosave.trigger(`event:${reason}`);
    }
  }

  private current(session: GameSession): boolean {
    return this.host.session() === session;
  }

  private write(session: GameSession, slotId: string, name: string, kind: SaveKind): Promise<WriteOutcome> {
    const timedOut = (): WriteOutcome => {
      this.host.report(`save.timeout:${kind}`, new Error(`save to "${slotId}" did not finish within the watchdog`));
      if (this.current(session)) this.lastFailed = true;
      this.host.changed(true);
      return { res: { ok: false, error: STUCK, code: 'io' }, signature: null };
    };
    return this.queue.run(async (): Promise<WriteOutcome> => {
      const sim = session.sim;
      let world;
      let sig: string;
      let meta;
      let mark: JournalMark | null = null;
      try {
        // Synchronous snapshot of world + meta — must precede any await.
        world = sim.serialize();
        sig = session.signature();
        meta = buildSaveMeta(sim, null);
        mark = this.journal.mark(session);
      } catch (e) {
        this.host.report('save.serialize', e);
        return { res: { ok: false as const, error: `Could not capture the world: ${describeError(e)}`, code: 'invalid' as const }, signature: null };
      }
      if (kind !== 'emergency') meta.thumbnail = await captureThumbnail(this.host.renderer, this.host.env);
      // Two-phase rebase: the journal epoch for this snapshot is durable BEFORE the snapshot write starts.
      const staged = this.journal.stage(mark, slotId, world);
      if (staged) await staged;
      let res: SaveResult;
      try {
        res = await this.host.saves.save(slotId, name, world, meta, { autosave: kind !== 'manual', playMinutes: session.playMinutes() });
        if (!res || typeof res !== 'object') res = { ok: false, error: 'Storage returned nothing', code: 'io' };
      } catch (e) {
        this.host.report('save.write', e);
        res = { ok: false, error: describeError(e), code: 'io' };
      }
      // A write that outlived its session (slow disk, forced quit) must not touch the next session's state.
      if (this.current(session)) {
        if (res.ok) {
          this.lastOkWall = this.host.env.wallNow();
          this.lastFailed = false;
          if (sameSlot(slotId, session.autosaveSlot)) this.autosave.markSaved(sig);
          this.journal.committed(mark, slotId, res.payloadSha256);
        } else {
          this.lastFailed = true;
          this.journal.abandoned(mark);
        }
      } else this.journal.abandoned(mark);
      this.host.changed(true);
      return { res, signature: sig };
    }, timedOut);
  }

  private async writeAutosave(reason: string): Promise<AutosaveWriteResult> {
    const session = this.host.session();
    if (!session || session.gameOver) return false;
    this.lastAutoWriteAt = this.host.env.now();
    const { res, signature } = await this.write(session, session.autosaveSlot, defaultSaveName(session.sim, 'auto'), 'auto');
    if (!res.ok) {
      if (this.current(session)) this.host.toast('warning', 'Autosave failed', `${res.error} — the game will try again shortly.`, { mergeKey: 'autosaveFail' });
      this.host.report(`autosave:${reason}`, new Error(res.error));
    }
    return { ok: res.ok, signature };
  }

  /** Autosave now (quit / tab hidden / unload / new game). Idempotent per world signature. */
  autosaveNow(reason: string): Promise<AutosaveOutcome> {
    return this.autosave.trigger(reason);
  }

  async saveGame(slotId?: string, name?: string): Promise<SaveResult> {
    const session = this.host.session();
    if (!session) return { ok: false, error: 'No game in progress', code: 'invalid' };
    if (slotId !== undefined && !isValidSlotId(slotId)) return { ok: false, error: BAD_SLOT, code: 'invalid' };
    // Contract (saveGame): autosave / emergency slots are controller-owned, never overwritten by a manual save.
    if (slotId !== undefined && isReservedSlot(slotId)) return { ok: false, error: "Autosaves can't be overwritten — save to a new slot instead.", code: 'invalid' };
    // PLATFORM canonicalises ids to lowercase (^[a-z0-9_-]{1,40}$); doing it here keeps coalescing/labels consistent.
    const slot = slotId !== undefined ? slotId.toLowerCase() : session.manualSlot;
    const typedOk = this.host.freeTextNames ? this.host.freeTextNames() === true : true;
    const label = typedOk && typeof name === 'string' && name.trim().length > 0 ? name.trim().slice(0, 60) : defaultSaveName(session.sim, 'manual');
    // Double-clicked Save (or F5 mashing): an identical request already in flight is the same save.
    const key = `${session.serial}|${slot.toLowerCase()}|${label}|${session.signature()}`;
    const pending = this.manualInFlight.get(key);
    if (pending) return pending;
    const p = this.runManual(session, slot, label);
    this.manualInFlight.set(key, p);
    void p.finally(() => {
      if (this.manualInFlight.get(key) === p) this.manualInFlight.delete(key);
    });
    return p;
  }

  private async runManual(session: GameSession, slot: string, label: string): Promise<SaveResult> {
    const { res } = await this.write(session, slot, label, 'manual');
    if (res.ok) {
      this.host.toast('good', 'Game saved', label, { mergeKey: 'saved' });
      this.host.sfx('save');
    } else {
      this.host.toast('bad', 'Save failed', res.error, { mergeKey: 'saveFail' });
      this.host.sfx('uiError');
    }
    return res;
  }

  /**
   * Best-effort crash save into the 'emergency' slot (no thumbnail, bypasses the queue). It is listed as an autosave
   * but passes `waitForLock`: if another window holds the save lock it WAITS (≤ 30 s, PLATFORM) instead of failing
   * 'busy' — after a crash it may be the only copy of the session (backlog #11). A watchdog bounds the whole write
   * like every other save job. At most one per session; a write that settles after its session ended never marks the
   * next session's crash save as done (nor blocks it while still in flight).
   */
  async emergencySave(): Promise<boolean> {
    const session = this.host.session();
    if (!session || this.emergencyFor === session || this.emergencyDone) return false;
    this.emergencyFor = session;
    this.emergencyWrites++;
    this.host.changed(true);
    try {
      // The journal goes first: if the crash save itself fails, the replayable tail is already durable.
      void this.flushJournal();
      const world = session.sim.serialize();
      const meta = buildSaveMeta(session.sim, null);
      const mark = this.journal.mark(session);
      const staged = this.journal.stage(mark, EMERGENCY_SLOT, world);
      if (staged) await staged;
      const opts = { autosave: true, waitForLock: true, playMinutes: session.playMinutes() };
      const write = Promise.resolve(this.host.saves.save(EMERGENCY_SLOT, defaultSaveName(session.sim, 'emergency'), world, meta, opts));
      const res = await withTimeout<SaveResult | null>(write, SAVE_JOB_TIMEOUT_MS, this.host.env, () => null, true);
      if (res === null) this.host.report('save.timeout:emergency', new Error('the crash save did not finish within the watchdog'));
      const ok = !!res && res.ok === true;
      if (ok && this.current(session)) this.emergencyDone = true;
      if (ok && res && res.ok && this.current(session)) this.journal.committed(mark, EMERGENCY_SLOT, res.payloadSha256);
      else this.journal.abandoned(mark);
      return ok;
    } catch (e) {
      this.host.report('save.emergency', e);
      return false;
    } finally {
      this.emergencyWrites--;
      if (this.emergencyFor === session) this.emergencyFor = null;
      this.host.changed(true);
    }
  }

  async load(slotId: string): Promise<LoadResult> {
    const raw: unknown = slotId;
    if (!isValidSlotId(raw)) return { ok: false, error: typeof raw === 'string' && raw.length > 0 ? BAD_SLOT : 'No save selected', code: 'not_found' };
    try {
      const r = await this.host.saves.load(slotId);
      if (!r || typeof r !== 'object') return { ok: false, error: 'Storage returned nothing', code: 'io' };
      if (r.ok && (!r.world || typeof r.world !== 'object')) return { ok: false, error: 'The save is empty', code: 'invalid' };
      return r;
    } catch (e) {
      this.host.report('save.load', e);
      return { ok: false, error: describeError(e), code: 'io' };
    }
  }

  async latest(): Promise<SaveSlotInfo | null> {
    try {
      return (await this.host.saves.latest()) ?? null;
    } catch (e) {
      this.host.report('save.latest', e);
      return null;
    }
  }

  async list(): Promise<SaveSlotInfo[]> {
    try {
      const l = await this.host.saves.listSlots();
      return Array.isArray(l) ? l : [];
    } catch (e) {
      this.host.report('save.list', e);
      this.host.toast('bad', "Couldn't read saves", describeError(e), { mergeKey: 'listFail' });
      return [];
    }
  }

  /** The live world's autosave copy no longer exists / no longer matches: make the next autosave write. */
  private invalidateIfLive(slotId: string | null | undefined): void {
    const s = this.host.session();
    if (s && sameSlot(slotId, s.autosaveSlot)) this.autosave.forget();
  }

  async remove(slotId: string): Promise<void> {
    const raw: unknown = slotId;
    if (!isValidSlotId(raw)) {
      if (typeof raw === 'string' && raw.length > 0) this.host.toast('bad', "Couldn't delete the save", BAD_SLOT, { mergeKey: 'deleteFail' });
      return;
    }
    // Deleting the running game's autosave means quitting must write it again (idempotency must not skip it).
    this.invalidateIfLive(slotId);
    try {
      await this.host.saves.remove(slotId);
      void this.journal.discard(slotId);
      this.host.sfx('uiConfirm');
    } catch (e) {
      this.host.report('save.remove', e);
      this.host.toast('bad', "Couldn't delete the save", describeError(e), { mergeKey: 'deleteFail' });
    }
    this.host.changed(true);
  }

  async exportSlot(slotId: string): Promise<void> {
    if (!isValidSlotId(slotId)) {
      this.host.toast('bad', 'Export failed', BAD_SLOT, { mergeKey: 'exportFail' });
      return;
    }
    try {
      const out = await this.host.saves.exportSlot(slotId);
      if (!out) {
        this.host.toast('bad', 'Export failed', 'That save could not be found.', { mergeKey: 'exportFail' });
        return;
      }
      const filename = sanitizeFilename(out.filename);
      const ok = this.host.env.download(filename, out.data, exportMimeType(filename));
      if (ok) this.host.toast('good', 'Save exported', 'Check your downloads folder.', { mergeKey: 'exported' });
      else this.host.toast('bad', 'Export failed', 'Downloads are not supported here.', { mergeKey: 'exportFail' });
    } catch (e) {
      this.host.report('save.export', e);
      this.host.toast('bad', 'Export failed', describeError(e), { mergeKey: 'exportFail' });
    }
  }

  async importFile(file: File): Promise<LoadResult> {
    try {
      if (!file || typeof (file as Blob).arrayBuffer !== 'function') return { ok: false, error: 'No file selected', code: 'invalid' };
      const size = (file as Blob).size;
      if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'That file is empty', code: 'invalid' };
      if (size > IMPORT_MAX_BYTES) return { ok: false, error: 'That file is too large to be a save', code: 'invalid' };
      const bytes = new Uint8Array(await (file as Blob).arrayBuffer());
      if (bytes.byteLength > IMPORT_MAX_BYTES) return { ok: false, error: 'That file is too large to be a save', code: 'invalid' };
      const r = await this.host.saves.importFile(bytes);
      if (!r || typeof r !== 'object') return { ok: false, error: 'Storage returned nothing', code: 'io' };
      if (r.ok) {
        // An import that landed on the running game's autosave slot replaced it.
        this.invalidateIfLive(r.slotId ?? r.info?.slotId);
        this.host.toast('good', 'Save imported', r.info?.name ?? 'Imported save', { mergeKey: 'imported' });
      } else this.host.toast('bad', 'Import failed', r.error, { mergeKey: 'importFail' });
      this.host.changed(true);
      return r;
    } catch (e) {
      this.host.report('save.import', e);
      this.host.toast('bad', 'Import failed', describeError(e), { mergeKey: 'importFail' });
      return { ok: false, error: describeError(e), code: 'io' };
    }
  }
}
