/**
 * SaveManager — crash-safe, versioned, checksummed save slots over any StorageBackend.
 *
 * Save sequence (per slot, serialized; all slots serialized by a global lock):
 *   snapshot (sync canonicalJson at call time) -> envelope -> encode (gzip) -> VERIFY the exact bytes
 *   by decoding them through the load pipeline -> rotate primary->backup (only a loadable primary is
 *   ever rotated, so a damaged primary can never overwrite the last good backup) -> write primary
 *   (atomic per backend contract) -> read-back compare -> write meta (cache).
 * A crash or error at ANY step leaves either the old or the new save loadable (tests/unit/persistence
 * /crash.test.ts injects faults at every step).
 *
 * Load: primary -> (future_version: stop, never "downgrade") -> backup (recoveredFromBackup=true,
 * warning) -> not_found | corrupt | invalid | io.
 *
 * Ordering: every operation on a slot takes its place in that slot's queue at CALL time (imports with an
 * explicit slot included), so operations apply in call order. Coalescing folds queued saves of the same
 * slot into one, keeping the strongest lock policy (a manual save never becomes fail-fast). Fresh imports
 * reserve a unique id and are written create-only under the cross-window lock (two tabs importing in the
 * same second never overwrite each other). Listing-record (meta) writes are a cache: loads and listings
 * never wait for another window's lock to refresh them.
 */
import type { LoadResult, SaveManager, SaveMeta, SaveResult, SaveSlotInfo, StorageBackend } from './contracts';
import type { WorldState } from '../sim/types';
import { SAVE_SCHEMA_VERSION } from '../sim/types';
import { asBytes, bytesEqual, utf8Encode } from './bytes';
import { canonicalJson } from './canonicalJson';
import { buildEnvelope, prettyEnvelopeText, resealVerified } from './envelope';
import { classifyStorageError, errorMessage, StorageError, type StorageErrorCode } from './errors';
import { compressionAvailable, gzipBytes } from './gzip';
import { type ActivityTracker, persistenceActivity } from './activity';
import { decodeSave, prepareWorld } from './loadPipeline';
import { type LockOptions, type LockProvider, Mutex, noLocks, SlotQueue, webLocks } from './locks';
import { exportFilename, sanitizeMeta, sanitizeSlotName } from './meta';
import { MIGRATIONS, migratePayload, type Migration, type RawPayload } from './migrations';
import { MAX_SAVE_BYTES, RESERVED_KEYS } from './sanitize';
import type { RepairHook } from './semanticRepair';
import { sha256Hex, sha256HexSync } from './sha256';
import { decodeMetaRecord, encodeMetaRecord } from './slotMeta';
import { canonicalSlotId, isAutosaveId, parseSlotKey, SLOT_PREFIX, slotKeys, type SlotRole } from './slotKeys';
import { GAME_VERSION } from './version';

export interface PersistenceLogger {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface SaveManagerOptions {
  backend: StorageBackend;
  /** gzip saves (default: when CompressionStream exists). Reads always auto-detect. */
  compress?: boolean;
  migrations?: readonly Migration[];
  /** Target/max world schema version (default SAVE_SCHEMA_VERSION). */
  schemaVersion?: number;
  /** Semantic repair after structural validation (default: none; createSaveManager wires the engine's). */
  repair?: RepairHook | null;
  /** Wall clock in ms (injectable for tests). */
  now?: () => number;
  /** Cross-process lock provider (default: Web Locks when available). */
  locks?: LockProvider;
  gameVersion?: string;
  /** Re-read the primary after writing and compare bytes (default true). */
  verifyAfterWrite?: boolean;
  maxBytes?: number;
  logger?: PersistenceLogger;
  /** Counts in-flight operations for the desktop quit flush (default: the shared persistenceActivity). */
  activity?: ActivityTracker;
}

interface SaveRequest {
  id: string;
  name: string;
  payloadText: string;
  meta: SaveMeta;
  autosave: boolean;
  /**
   * Wait (<= 30 s) for another window's save lock — manual saves, imports, and autosave-flagged saves whose caller
   * passed `waitForLock` (the crash/emergency save). Other autosaves fail fast ('busy') and the caller retries.
   */
  waitForLock: boolean;
  playMinutes: number | null;
  /** Forced createdAt (imports keep the original). */
  createdAt: string | null;
  /** Fresh imports: refuse ('exists') to overwrite a slot that appeared meanwhile (e.g. another tab). */
  createOnly: boolean;
}

type ExistsResult = { ok: false; code: 'exists'; error: string };
type InternalSaveResult = SaveResult | ExistsResult;
type ImportResult = LoadResult & { slotId?: string };

interface PreparedImport {
  ok: true;
  world: WorldState;
  warnings: string[];
  migrated: string[];
  payloadText: string;
  name: string;
  meta: SaveMeta;
  playMinutes: number;
  createdAt: string;
}

interface ListedSlot {
  info: SaveSlotInfo;
  /** Placeholder for a slot whose copies are all unreadable (listed so it can be deleted, never "Continue"). */
  damaged: boolean;
}

/**
 * Fold a newer queued save into a pending one (latest world wins) — but keep the strongest lock policy and
 * never merge imports (a different FILE must not silently replace another).
 */
export function coalesceSaveRequests(pending: SaveRequest, next: SaveRequest): SaveRequest | null {
  if (pending.createOnly || next.createOnly || pending.createdAt !== null || next.createdAt !== null) return null;
  return { ...next, waitForLock: pending.waitForLock || next.waitForLock, playMinutes: next.playMinutes ?? pending.playMinutes };
}

/**
 * The exact text a save's `payloadSha256` covers: the world as canonical JSON, reserved keys left out (the loader
 * drops them, so a checksum covering them would make the save unloadable). save() uses it, and so does the command
 * journal, which anchors a new epoch to a snapshot BEFORE that snapshot is written (W-119 two-phase rebase).
 */
export function savePayloadText(world: WorldState, onDroppedKey?: (path: string) => void): string {
  return canonicalJson(world, { dropKeys: RESERVED_KEYS, onDroppedKey });
}

/**
 * payloadSha256 that save() will report for `world` (same text, same hash). Synchronous (pure-JS SHA-256: a few ms
 * for a typical world) so callers can stage before any await — and so it never depends on WebCrypto's thread pool.
 */
export function savePayloadSha256(world: WorldState): string {
  return sha256HexSync(savePayloadText(world));
}

const MAX_IMPORT_ID_ATTEMPTS = 20;

type Existing =
  | { kind: 'good'; createdAt: string; savedAt: string; playMinutes: number }
  | { kind: 'future'; error: string }
  | { kind: 'bad'; error: string };

type LoadFailure = Extract<LoadResult, { ok: false }>;

const globalMutexes = new WeakMap<StorageBackend, Mutex>();
function globalMutexFor(backend: StorageBackend): Mutex {
  let m = globalMutexes.get(backend);
  if (!m) {
    m = new Mutex();
    globalMutexes.set(backend, m);
  }
  return m;
}

const QUOTA_HINT = 'Not enough storage space to save. Delete old saves or free up disk space, then try again.';

export class SaveManagerImpl implements SaveManager {
  readonly backend: StorageBackend;
  private readonly compress: boolean;
  private readonly migrations: readonly Migration[];
  private readonly schemaVersion: number;
  private readonly repair: RepairHook | null;
  private readonly now: () => number;
  private readonly locks: LockProvider;
  private readonly gameVersion: string;
  private readonly verifyAfterWrite: boolean;
  private readonly maxBytes: number;
  private readonly log: PersistenceLogger;
  private readonly global: Mutex;
  private readonly activity: ActivityTracker;
  private readonly queues = new Map<string, SlotQueue<SaveRequest, SaveResult>>();
  /** Import slot ids handed out by this instance (never reused, even before their first write lands). */
  private readonly reservedImportIds = new Set<string>();
  /** sha256 of primary bytes this instance wrote and verified -> header facts (skips re-verification). */
  private readonly knownGood = new Map<string, { bytesSha: string; createdAt: string; savedAt: string; playMinutes: number }>();
  private lastStampMs = 0;
  private persistRequested = false;

  constructor(opts: SaveManagerOptions) {
    this.backend = opts.backend;
    this.compress = opts.compress ?? compressionAvailable();
    this.migrations = opts.migrations ?? MIGRATIONS;
    this.schemaVersion = opts.schemaVersion ?? SAVE_SCHEMA_VERSION;
    this.repair = opts.repair ?? null;
    this.now = opts.now ?? (() => Date.now());
    this.locks = opts.locks ?? webLocks() ?? noLocks;
    this.gameVersion = opts.gameVersion ?? GAME_VERSION;
    this.verifyAfterWrite = opts.verifyAfterWrite ?? true;
    this.maxBytes = opts.maxBytes ?? MAX_SAVE_BYTES;
    this.log = opts.logger ?? console;
    this.global = globalMutexFor(this.backend);
    this.activity = opts.activity ?? persistenceActivity;
  }

  // ───────────────────────────── public API ─────────────────────────────

  async save(
    slotId: string,
    name: string,
    world: WorldState,
    meta: SaveMeta,
    opts?: { autosave?: boolean; playMinutes?: number; waitForLock?: boolean },
  ): Promise<SaveResult> {
    const end = this.activity.begin();
    try {
      const idc = canonicalSlotId(slotId);
      if (!idc.ok) return { ok: false, code: 'invalid', error: idc.error };
      let payloadText: string;
      const dropped: string[] = [];
      try {
        // Synchronous snapshot: later mutation of `world` cannot leak in. Reserved keys are left out — the
        // loader drops them, so a checksum covering them would make the save unloadable.
        payloadText = savePayloadText(world, (p) => dropped.push(p));
      } catch (e) {
        return { ok: false, code: 'invalid', error: `the world cannot be saved: ${errorMessage(e)}` };
      }
      if (dropped.length > 0) {
        this.log.warn(
          `[persistence] slot "${idc.id}": ${dropped.length} reserved key(s) left out of the save (they can never be loaded safely): ${dropped.slice(0, 5).join(', ')}${dropped.length > 5 ? ', ...' : ''}`,
        );
      }
      // The envelope header carries THIS build's schema version, and a header that disagrees with its payload makes
      // the save unloadable ('corrupt'). An older-schema world (W-025: a pre-world in-memory world, schema v1) is
      // upgraded on a copy through the same pure migration chain a load would run; a newer one is refused.
      const sv = (world as { schemaVersion?: unknown }).schemaVersion;
      if (sv !== this.schemaVersion) {
        if (typeof sv !== 'number' || !Number.isInteger(sv) || sv < 1 || sv > this.schemaVersion) {
          return { ok: false, code: 'invalid', error: `the world uses schema v${String(sv)}; this build saves schema v${this.schemaVersion}` };
        }
        const up = migratePayload(JSON.parse(payloadText) as RawPayload, sv, this.migrations, this.schemaVersion);
        if (!up.ok) return { ok: false, code: 'invalid', error: `the world cannot be saved: ${up.error}` };
        payloadText = canonicalJson(up.payload, { dropKeys: RESERVED_KEYS });
      }
      if (payloadText.length > this.maxBytes) return { ok: false, code: 'invalid', error: `the world is too large to save (${payloadText.length} bytes)` };
      const m = sanitizeMeta(meta).meta;
      const pm = opts?.playMinutes;
      const autosave = opts?.autosave === true || isAutosaveId(idc.id);
      const req: SaveRequest = {
        id: idc.id,
        name: sanitizeSlotName(name, m.householdName),
        payloadText,
        meta: m,
        autosave,
        // Manual saves always wait (<= 30 s) for another window; autosaves fail fast unless the caller asks to wait
        // (contract: `waitForLock` — a crash save is listed as an autosave but may be the only copy of the session).
        waitForLock: !autosave || opts?.waitForLock === true,
        playMinutes: typeof pm === 'number' && Number.isFinite(pm) && pm >= 0 ? pm : null,
        createdAt: null,
        createOnly: false,
      };
      return await this.queue(idc.id).save(req);
    } catch (e) {
      return this.saveFailure(e, 'saving');
    } finally {
      end();
    }
  }

  async load(slotId: string): Promise<LoadResult> {
    const idc = canonicalSlotId(slotId);
    if (!idc.ok) return { ok: false, code: 'invalid', error: idc.error };
    const end = this.activity.begin();
    try {
      return await this.queue(idc.id).run(() => this.doLoad(idc.id));
    } catch (e) {
      return { ok: false, code: 'io', error: `could not read the save: ${errorMessage(e)}` };
    } finally {
      end();
    }
  }

  async listSlots(): Promise<SaveSlotInfo[]> {
    return (await this.listInternal()).map((s) => s.info);
  }

  private async listInternal(): Promise<ListedSlot[]> {
    const end = this.activity.begin();
    try {
      return await this.listUntracked();
    } finally {
      end();
    }
  }

  private async listUntracked(): Promise<ListedSlot[]> {
    let keys: string[];
    try {
      keys = await this.backend.list(SLOT_PREFIX);
    } catch (e) {
      throw new StorageError(classifyStorageError(e), `could not list saves: ${errorMessage(e)}`, e);
    }
    const slots = new Map<string, Set<SlotRole>>();
    for (const k of keys) {
      const p = parseSlotKey(k);
      if (!p) continue;
      let roles = slots.get(p.id);
      if (!roles) slots.set(p.id, (roles = new Set()));
      roles.add(p.role);
    }
    const infos = await Promise.all(
      [...slots].map(async ([id, roles]): Promise<ListedSlot | null> => {
        if (!roles.has('primary') && !roles.has('backup')) {
          // Best-effort cleanup of a cache record: never wait for another window's lock for it.
          await this.queue(id)
            .run(() => this.exclusive(() => this.removeOrphanMeta(id), { ifAvailable: true }))
            .catch((e) => this.log.warn(`[persistence] could not clean orphan meta for "${id}":`, e));
          return null;
        }
        if (roles.has('meta')) {
          const m = await this.readMeta(id);
          if (m) return { info: m.info, damaged: false };
        }
        return this.queue(id).run(() => this.rebuildMeta(id));
      }),
    );
    return infos
      .filter((i): i is ListedSlot => i !== null)
      .sort((x, y) => {
        const a = x.info;
        const b = y.info;
        return a.savedAt === b.savedAt ? a.slotId.localeCompare(b.slotId) : a.savedAt < b.savedAt ? 1 : -1;
      });
  }

  async remove(slotId: string): Promise<void> {
    const idc = canonicalSlotId(slotId);
    if (!idc.ok) return; // an invalid id cannot exist in storage: removal is a no-op
    const keys = slotKeys(idc.id);
    const end = this.activity.begin();
    try {
      await this.queue(idc.id).run(() =>
        this.exclusive(async () => {
          // Meta first: a crash mid-way leaves a slot that is still listed (rebuilt) and deletable again.
          for (const k of [keys.meta, keys.primary, keys.backup]) {
            try {
              await this.backend.remove(k);
            } catch (e) {
              throw new StorageError(classifyStorageError(e), `could not delete save "${idc.id}": ${errorMessage(e)}`, e);
            }
          }
          this.knownGood.delete(keys.primary);
        }),
      );
    } finally {
      end();
    }
  }

  async exportSlot(slotId: string): Promise<{ filename: string; data: Uint8Array } | null> {
    const idc = canonicalSlotId(slotId);
    if (!idc.ok) return null;
    return this.activity.track(() => this.exportUntracked(idc.id));
  }

  private exportUntracked(id: string): Promise<{ filename: string; data: Uint8Array } | null> {
    const keys = slotKeys(id);
    return this.queue(id).run(async () => {
      for (const key of [keys.primary, keys.backup]) {
        let bytes: Uint8Array | null;
        try {
          bytes = await this.backend.read(key);
        } catch (e) {
          this.log.warn(`[persistence] export: could not read ${key}:`, e);
          continue;
        }
        if (!bytes) continue;
        // Exports may carry newer schemas verbatim (moving a save between machines must not need a downgrade).
        const d = await decodeSave(bytes, { maxBytes: this.maxBytes, maxSchemaVersion: Number.MAX_SAFE_INTEGER });
        if (!d.ok) continue;
        // Re-hash what is actually exported (decoding may have dropped reserved keys a foreign writer kept).
        const payloadSha256 = await sha256Hex(canonicalJson(d.envelope.payload));
        const header = await resealVerified({ ...d.envelope, payloadSha256 });
        const data = utf8Encode(prettyEnvelopeText(header, d.envelope.payload));
        const self = await decodeSave(data, { maxBytes: this.maxBytes, maxSchemaVersion: Number.MAX_SAFE_INTEGER });
        if (!self.ok) {
          this.log.error(`[persistence] export self-check failed for "${id}": ${self.error}`);
          return null;
        }
        return { filename: exportFilename(d.envelope.meta), data };
      }
      return null;
    });
  }

  async importFile(data: Uint8Array, slotId?: string): Promise<ImportResult> {
    const end = this.activity.begin();
    try {
      const bytes = asBytes(data);
      if (!bytes) return { ok: false, code: 'invalid', error: 'import data is not a file' };
      if (slotId !== undefined) {
        const c = canonicalSlotId(slotId);
        if (!c.ok) return { ok: false, code: 'invalid', error: c.error };
        // Take this import's place in the slot queue NOW (call order), as a barrier: it is never coalesced
        // with, or reordered against, saves of that slot issued before or after it.
        const r = await this.queue(c.id).run(async (): Promise<ImportResult | ExistsResult> => {
          const prep = await this.prepareImport(bytes);
          return prep.ok ? this.storeImport(prep, c.id, false) : prep;
        });
        return r.ok || r.code !== 'exists' ? (r as ImportResult) : { ok: false, code: 'io', error: r.error };
      }
      const prep = await this.prepareImport(bytes);
      if (!prep.ok) return prep;
      for (let attempt = 0; attempt < MAX_IMPORT_ID_ATTEMPTS; attempt++) {
        const id = await this.freshImportId();
        const r = await this.queue(id).run(() => this.storeImport(prep, id, true));
        if (r.ok || r.code !== 'exists') return r as ImportResult;
        // Another window created that slot between our listing and our write: take the next free id.
      }
      return { ok: false, code: 'io', error: 'import failed: could not find a free slot id' };
    } catch (e) {
      return { ok: false, code: 'io', error: `import failed: ${errorMessage(e)}` };
    } finally {
      end();
    }
  }

  async latest(): Promise<SaveSlotInfo | null> {
    const slots = await this.listInternal();
    return slots.find((s) => !s.damaged)?.info ?? null;
  }

  // ───────────────────────────── import internals ─────────────────────────────

  private async prepareImport(bytes: Uint8Array): Promise<PreparedImport | LoadFailure> {
    const d = await decodeSave(bytes, { maxBytes: this.maxBytes, maxSchemaVersion: this.schemaVersion });
    if (!d.ok) return { ok: false, code: d.code, error: d.error };
    const p = await prepareWorld(d.envelope, { migrations: this.migrations, targetSchemaVersion: this.schemaVersion, repair: this.repair });
    if (!p.ok) return { ok: false, code: p.code, error: p.error };
    let payloadText: string;
    try {
      payloadText = canonicalJson(p.world, { dropKeys: RESERVED_KEYS });
    } catch (e) {
      return { ok: false, code: 'invalid', error: `imported world cannot be stored: ${errorMessage(e)}` };
    }
    return {
      ok: true,
      world: p.world,
      warnings: [...d.warnings, ...p.warnings],
      migrated: [...p.migrated],
      payloadText,
      name: d.envelope.name,
      meta: d.envelope.meta,
      playMinutes: d.envelope.playMinutes,
      createdAt: d.envelope.createdAt,
    };
  }

  private async storeImport(prep: PreparedImport, id: string, createOnly: boolean): Promise<ImportResult | ExistsResult> {
    const saved = await this.doSave({
      id,
      name: prep.name,
      payloadText: prep.payloadText,
      meta: prep.meta,
      autosave: isAutosaveId(id),
      waitForLock: true,
      playMinutes: prep.playMinutes,
      createdAt: prep.createdAt,
      createOnly,
    });
    if (!saved.ok) {
      if (saved.code === 'exists') return saved;
      return { ok: false, code: saved.code === 'invalid' ? 'invalid' : 'io', error: saved.error };
    }
    return { ok: true, world: prep.world, info: saved.info, warnings: [...prep.warnings], migrated: [...prep.migrated], slotId: id };
  }

  // ───────────────────────────── save internals ─────────────────────────────

  private queue(id: string): SlotQueue<SaveRequest, SaveResult> {
    let q = this.queues.get(id);
    if (!q) {
      q = new SlotQueue<SaveRequest, SaveResult>(
        async (req) => {
          const r = await this.doSave(req);
          return r.ok || r.code !== 'exists' ? (r as SaveResult) : { ok: false, code: 'invalid', error: r.error };
        },
        (e) => this.saveFailure(e, 'saving'),
        coalesceSaveRequests,
      );
      this.queues.set(id, q);
    }
    return q;
  }

  private exclusive<T>(fn: () => Promise<T>, opts?: LockOptions): Promise<T> {
    return this.global.run(() => this.locks.run(`afterlife-lease:saves:${this.backend.id}`, fn, opts));
  }

  private stamp(notBeforeIso: string | null): string {
    let ms = Math.floor(this.now());
    if (!Number.isFinite(ms)) ms = 0;
    const floor = notBeforeIso ? Date.parse(notBeforeIso) : NaN;
    if (Number.isFinite(floor) && ms <= floor) ms = floor + 1; // same-slot saves stay ordered even if the clock jumps back
    if (ms <= this.lastStampMs) ms = this.lastStampMs + 1;
    this.lastStampMs = ms;
    return new Date(ms).toISOString();
  }

  private saveFailure(e: unknown, context: string): SaveResult {
    const code: StorageErrorCode = classifyStorageError(e);
    const detail = errorMessage(e);
    const error =
      code === 'quota'
        ? `${QUOTA_HINT} (${context}: ${detail})`
        : code === 'busy'
          ? `Saving is temporarily blocked — ${detail}. Try again in a moment.`
          : `Saving failed while ${context}: ${detail}`;
    this.log.warn(`[persistence] ${error}`);
    return { ok: false, code, error };
  }

  private async inspectExisting(key: string, bytes: Uint8Array): Promise<Existing> {
    const known = this.knownGood.get(key);
    if (known && (await sha256Hex(bytes)) === known.bytesSha) return { kind: 'good', createdAt: known.createdAt, savedAt: known.savedAt, playMinutes: known.playMinutes };
    const d = await decodeSave(bytes, { maxBytes: this.maxBytes, maxSchemaVersion: this.schemaVersion });
    if (!d.ok) {
      if (d.code === 'future_version') return { kind: 'future', error: d.error };
      return { kind: 'bad', error: d.error };
    }
    const facts = { createdAt: d.envelope.createdAt, savedAt: d.envelope.savedAt, playMinutes: d.envelope.playMinutes };
    // "Good" means LOADABLE: rotating an intact-but-unloadable primary would evict a loadable backup.
    const p = await prepareWorld(d.envelope, { migrations: this.migrations, targetSchemaVersion: this.schemaVersion, repair: null });
    if (!p.ok) return { kind: 'bad', error: p.error };
    return { kind: 'good', ...facts };
  }

  private async backupFacts(key: string): Promise<{ createdAt: string; savedAt: string } | null> {
    try {
      const b = await this.backend.read(key);
      if (!b) return null;
      const d = await decodeSave(b, { maxBytes: this.maxBytes, maxSchemaVersion: Number.MAX_SAFE_INTEGER });
      return d.ok ? { createdAt: d.envelope.createdAt, savedAt: d.envelope.savedAt } : null;
    } catch {
      return null;
    }
  }

  private doSave(req: SaveRequest): Promise<InternalSaveResult> {
    const keys = slotKeys(req.id);
    return this.exclusive(async (): Promise<InternalSaveResult> => {
      let existing: Uint8Array | null;
      try {
        existing = await this.backend.read(keys.primary);
      } catch (e) {
        return this.saveFailure(e, 'reading the existing save');
      }
      if (req.createOnly) {
        // Checked under the cross-window lock, so check-and-write is atomic across tabs.
        let other = existing && existing.byteLength > 0 ? existing : null;
        if (!other) {
          try {
            const b = await this.backend.read(keys.backup);
            other = b && b.byteLength > 0 ? b : null;
          } catch (e) {
            return this.saveFailure(e, 'checking the import slot');
          }
        }
        if (other) return { ok: false, code: 'exists', error: `slot "${req.id}" already exists` };
      }
      let rotate = false;
      let createdAt = req.createdAt;
      let prevPlay = 0;
      let prevSavedAt: string | null = null;
      if (existing && existing.byteLength > 0) {
        const v = await this.inspectExisting(keys.primary, existing);
        if (v.kind === 'future') {
          return { ok: false, code: 'invalid', error: `Slot "${req.id}" holds a save from a newer version of the game; it was not overwritten. (${v.error})` };
        }
        if (v.kind === 'good') {
          rotate = true;
          createdAt ??= v.createdAt;
          prevPlay = v.playMinutes;
          prevSavedAt = v.savedAt;
        } else {
          this.log.warn(`[persistence] slot "${req.id}": current save is damaged (${v.error}); keeping the existing backup`);
          const b = await this.backupFacts(keys.backup);
          if (b) {
            createdAt ??= b.createdAt;
            prevSavedAt = b.savedAt;
          }
        }
      }
      const savedAt = this.stamp(prevSavedAt);
      const created = createdAt ?? savedAt;
      const playMinutes = req.playMinutes ?? prevPlay;

      const built = await buildEnvelope({
        payloadText: req.payloadText,
        schemaVersion: this.schemaVersion,
        gameVersion: this.gameVersion,
        slotId: req.id,
        name: req.name,
        createdAt: created,
        savedAt,
        playMinutes,
        meta: req.meta,
      });
      let bytes: Uint8Array = utf8Encode(built.text);
      if (this.compress) {
        try {
          bytes = await gzipBytes(bytes);
        } catch (e) {
          this.log.warn('[persistence] compression failed; saving uncompressed:', e);
        }
      }
      if (bytes.byteLength > this.maxBytes) return { ok: false, code: 'invalid', error: `save is too large (${bytes.byteLength} bytes)` };

      // Verify the exact bytes that will be written by running them through the load pipeline.
      const check = await decodeSave(bytes, { maxBytes: this.maxBytes, maxSchemaVersion: this.schemaVersion });
      if (!check.ok) return { ok: false, code: 'invalid', error: `the save failed its self-check (${check.error}); nothing was written` };
      const prepared = await prepareWorld(check.envelope, { migrations: this.migrations, targetSchemaVersion: this.schemaVersion, repair: null });
      if (!prepared.ok) return { ok: false, code: 'invalid', error: `the world failed validation (${prepared.error}); nothing was written` };

      if (rotate && existing) {
        try {
          await this.backend.write(keys.backup, existing);
        } catch (e) {
          return this.saveFailure(e, 'keeping the previous save as backup');
        }
      }
      try {
        await this.backend.write(keys.primary, bytes);
      } catch (e) {
        this.knownGood.delete(keys.primary);
        return this.saveFailure(e, 'writing the save');
      }
      if (this.verifyAfterWrite) {
        let back: Uint8Array | null = null;
        try {
          back = await this.backend.read(keys.primary);
        } catch (e) {
          this.log.warn('[persistence] read-back after write failed:', e);
        }
        if (!back || !bytesEqual(back, bytes)) {
          this.knownGood.delete(keys.primary);
          return { ok: false, code: 'io', error: 'Storage returned different data after saving; the previous save is still available as backup.' };
        }
      }
      this.knownGood.set(keys.primary, { bytesSha: await sha256Hex(bytes), createdAt: created, savedAt, playMinutes });
      const info: SaveSlotInfo = {
        slotId: req.id,
        name: req.name,
        savedAt,
        createdAt: created,
        playMinutes,
        meta: req.meta,
        isAutosave: req.autosave,
        recoveredFromBackup: false,
        bytes: bytes.byteLength,
      };
      try {
        await this.backend.write(keys.meta, await encodeMetaRecord({ info, payloadSha256: built.header.payloadSha256 }));
      } catch (e) {
        // The save itself is durable; the listing cache self-heals from the primary.
        this.log.warn(`[persistence] slot "${req.id}" saved, but its listing record could not be written:`, e);
      }
      this.requestPersistentStorage();
      return { ok: true, info, payloadSha256: built.header.payloadSha256 };
    }, { ifAvailable: !req.waitForLock }); // autosaves never wait for another window: the caller retries
  }

  private requestPersistentStorage(): void {
    if (this.persistRequested || (this.backend.id !== 'indexeddb' && this.backend.id !== 'localstorage')) return;
    this.persistRequested = true;
    try {
      const storage = (globalThis as { navigator?: { storage?: { persist?: () => Promise<boolean> } } }).navigator?.storage;
      if (storage && typeof storage.persist === 'function') storage.persist().catch(() => undefined);
    } catch {
      // best effort: browsers may refuse, that's fine
    }
  }

  // ───────────────────────────── load internals ─────────────────────────────

  private async readKey(key: string): Promise<{ bytes: Uint8Array | null; error: string | null }> {
    try {
      const b = await this.backend.read(key);
      return { bytes: b ?? null, error: null };
    } catch (e) {
      return { bytes: null, error: errorMessage(e) };
    }
  }

  private async loadFrom(bytes: Uint8Array, id: string, isAutosave: boolean): Promise<Extract<LoadResult, { ok: true }> | LoadFailure> {
    const d = await decodeSave(bytes, { maxBytes: this.maxBytes, maxSchemaVersion: this.schemaVersion });
    if (!d.ok) return { ok: false, code: d.code, error: d.error };
    const p = await prepareWorld(d.envelope, { migrations: this.migrations, targetSchemaVersion: this.schemaVersion, repair: this.repair });
    if (!p.ok) return { ok: false, code: p.code, error: p.error };
    const env = d.envelope;
    const info: SaveSlotInfo = {
      slotId: id,
      name: env.name,
      savedAt: env.savedAt,
      createdAt: env.createdAt,
      playMinutes: env.playMinutes,
      meta: env.meta,
      isAutosave,
      recoveredFromBackup: false,
      bytes: d.bytes,
    };
    return { ok: true, world: p.world, info, warnings: [...d.warnings, ...p.warnings], migrated: [...p.migrated], payloadSha256: env.payloadSha256 };
  }

  private async doLoad(id: string): Promise<LoadResult> {
    const keys = slotKeys(id);
    const meta = await this.readMeta(id);
    const isAutosave = meta?.info.isAutosave ?? isAutosaveId(id);
    let failure: LoadFailure | null = null;

    const primary = await this.readKey(keys.primary);
    if (primary.bytes) {
      const r = await this.loadFrom(primary.bytes, id, isAutosave);
      if (r.ok) {
        await this.syncMeta(id, r.info, meta);
        return r;
      }
      if (r.code === 'future_version') return r;
      failure = r;
    } else if (primary.error) {
      failure = { ok: false, code: 'io', error: `could not read the save: ${primary.error}` };
    }

    const backup = await this.readKey(keys.backup);
    if (backup.bytes) {
      const r = await this.loadFrom(backup.bytes, id, isAutosave);
      if (r.ok) {
        const why = failure ? failure.error : 'the latest save file is missing';
        r.info.recoveredFromBackup = true;
        r.warnings.unshift(`The latest save in this slot could not be loaded (${why}). The previous save was restored instead.`);
        this.log.warn(`[persistence] slot "${id}" recovered from backup: ${why}`);
        await this.syncMeta(id, r.info, meta);
        return r;
      }
      if (!failure) failure = r;
    } else if (backup.error && !failure) {
      failure = { ok: false, code: 'io', error: `could not read the save: ${backup.error}` };
    }
    return failure ?? { ok: false, code: 'not_found', error: `There is no save in slot "${id}".` };
  }

  // ───────────────────────────── meta cache ─────────────────────────────

  private async readMeta(id: string): Promise<{ info: SaveSlotInfo; payloadSha256: string } | null> {
    try {
      const b = await this.backend.read(slotKeys(id).meta);
      return b ? await decodeMetaRecord(b, id) : null;
    } catch {
      return null;
    }
  }

  /** Rewrite the meta record when a load observed different facts (stale after a crash, recovery flag). */
  private async syncMeta(id: string, info: SaveSlotInfo, current: { info: SaveSlotInfo; payloadSha256: string } | null): Promise<void> {
    const c = current?.info;
    if (c && c.savedAt === info.savedAt && c.recoveredFromBackup === info.recoveredFromBackup && c.bytes === info.bytes) return;
    try {
      // A cache refresh: skip it (next load/save fixes it) rather than wait for another window's lock.
      await this.exclusive(async () => {
        const bytes = await this.backend.read(slotKeys(id)[info.recoveredFromBackup ? 'backup' : 'primary']);
        if (!bytes) return;
        const d = await decodeSave(bytes, { maxBytes: this.maxBytes, maxSchemaVersion: this.schemaVersion });
        if (!d.ok) return;
        await this.backend.write(slotKeys(id).meta, await encodeMetaRecord({ info, payloadSha256: d.envelope.payloadSha256 }));
      }, { ifAvailable: true });
    } catch (e) {
      this.log.warn(`[persistence] could not refresh listing record for "${id}":`, e);
    }
  }

  private async rebuildMeta(id: string): Promise<ListedSlot> {
    const keys = slotKeys(id);
    let damagedBytes = 0;
    for (const role of ['primary', 'backup'] as const) {
      const { bytes } = await this.readKey(keys[role]);
      if (!bytes) continue;
      const d = await decodeSave(bytes, { maxBytes: this.maxBytes, maxSchemaVersion: Number.MAX_SAFE_INTEGER });
      if (!d.ok) {
        damagedBytes = Math.max(damagedBytes, bytes.byteLength);
        continue;
      }
      const env = d.envelope;
      const info: SaveSlotInfo = {
        slotId: id,
        name: env.name,
        savedAt: env.savedAt,
        createdAt: env.createdAt,
        playMinutes: env.playMinutes,
        meta: env.meta,
        isAutosave: isAutosaveId(id),
        recoveredFromBackup: role === 'backup',
        bytes: d.bytes,
      };
      try {
        // Cache write: best effort, never waits for another window.
        await this.exclusive(async () => this.backend.write(keys.meta, await encodeMetaRecord({ info, payloadSha256: env.payloadSha256 })), {
          ifAvailable: true,
        });
      } catch (e) {
        this.log.warn(`[persistence] could not rebuild listing record for "${id}":`, e);
      }
      return { info, damaged: false };
    }
    // Both copies unreadable: still list the slot (so the player can see and delete it).
    const epoch = new Date(0).toISOString();
    return {
      damaged: true,
      info: {
        slotId: id,
        name: `Damaged save (${id})`,
        savedAt: epoch,
        createdAt: epoch,
        playMinutes: 0,
        meta: { ...sanitizeMeta({ householdName: 'Damaged save' }).meta },
        isAutosave: isAutosaveId(id),
        recoveredFromBackup: false,
        bytes: damagedBytes,
      },
    };
  }

  private async removeOrphanMeta(id: string): Promise<void> {
    const keys = slotKeys(id);
    // Re-check under the lock: a concurrent first save may have just created the primary.
    const [p, b] = await Promise.all([this.backend.read(keys.primary), this.backend.read(keys.backup)]);
    if (!p && !b) await this.backend.remove(keys.meta);
  }

  /** A slot id unused in storage AND never handed out by this instance (reserved synchronously). */
  private async freshImportId(): Promise<string> {
    let existing = new Set<string>();
    try {
      existing = new Set(
        (await this.backend.list(SLOT_PREFIX)).map((k) => parseSlotKey(k)?.id).filter((x): x is string => typeof x === 'string'),
      );
    } catch {
      // listing failed: the create-only write below still refuses to overwrite an existing slot
    }
    const taken = (id: string) => existing.has(id) || this.reservedImportIds.has(id);
    let ms = Math.floor(this.now());
    if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) ms = 0;
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    const base = `import-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
    let id = base;
    for (let i = 2; taken(id) && i < 1000; i++) id = `${base}-${i}`;
    while (taken(id)) id = `${base}-${Math.floor(Math.random() * 2 ** 40).toString(36)}`;
    this.reservedImportIds.add(id);
    return id;
  }
}
