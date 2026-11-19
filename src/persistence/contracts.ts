/**
 * PERSISTENCE CONTRACT — crash-safe, versioned, checksummed saves.
 *
 * Envelope (JSON, optionally gzip-compressed by the backend):
 *   { format: 'afterlife-lease-save', formatVersion: 1, schemaVersion, gameVersion, slotId, name,
 *     createdAt, savedAt, playMinutes, meta: SaveMeta, payloadSha256, payload: WorldState }
 * payloadSha256 = SHA-256 hex of canonicalJson(payload) (stable key order). On load: verify -> migrate -> validate/repair.
 * headerSha256 (optional, written by PLATFORM) = SHA-256 of canonicalJson(every envelope field except payload and
 *   headerSha256) so header corruption (meta, timestamps, name, schemaVersion) is detected; readers accept envelopes
 *   without it (with a warning).
 * Slot ids are canonicalised to lowercase (desktop file systems are case-insensitive); Windows device names refused.
 * SaveMeta.thumbnail must be a data:image/(png|jpeg|webp);base64 URL ≤ 64 KB, otherwise stored as null.
 * Every slot keeps the previous good save as a backup; a load that fails verification falls back to it.
 * NOTE: checksums detect corruption; they are NOT tamper-proofing (a single-player client cannot keep a secret key).
 */
import type { WorldState } from '../sim/types';

export interface SaveMeta {
  householdName: string;
  memberNames: string[];
  day: number;
  timeLabel: string;
  funds: number;
  lotValue: number;
  /** Small JPEG/PNG data URL (<= 64 KB) or null. */
  thumbnail: string | null;
}

export interface SaveSlotInfo {
  slotId: string;
  name: string;
  savedAt: string; // ISO
  createdAt: string;
  playMinutes: number;
  meta: SaveMeta;
  isAutosave: boolean;
  /** Primary failed verification but backup is good. */
  recoveredFromBackup: boolean;
  bytes: number;
}

export type LoadResult =
  | {
      ok: true;
      world: WorldState;
      info: SaveSlotInfo;
      warnings: string[];
      /**
       * Schema migration steps applied on load (e.g. ['v1->v2 (household jobs)']); absent or empty when the save was
       * already current. A normal upgrade after a game update: informational, never listed in `warnings`.
       */
      migrated?: string[];
      /** SHA-256 of the loaded envelope's payload (the snapshot identity a command journal is anchored to). Optional for fakes. */
      payloadSha256?: string;
    }
  | { ok: false; error: string; code: 'not_found' | 'corrupt' | 'future_version' | 'invalid' | 'io' };

export type SaveResult =
  /** payloadSha256: SHA-256 of the written payload (journal anchor, see journal.ts). Optional for fakes. */
  | { ok: true; info: SaveSlotInfo; payloadSha256?: string }
  | { ok: false; error: string; code: 'quota' | 'io' | 'busy' | 'invalid' };

/** Raw key/value storage. Implementations: IndexedDB, localStorage, memory, Electron (atomic files). */
export interface StorageBackend {
  readonly id: 'indexeddb' | 'localstorage' | 'memory' | 'electron';
  /** True if data survives a reload. */
  readonly durable: boolean;
  available(): Promise<boolean>;
  read(key: string): Promise<Uint8Array | null>;
  /** MUST be atomic: after a crash, either the old or the new value is readable, never a torn write. */
  write(key: string, data: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** Approximate bytes free, or null if unknown. */
  quota(): Promise<number | null>;
}

export interface SaveManager {
  readonly backend: StorageBackend;
  listSlots(): Promise<SaveSlotInfo[]>;
  /** opts.autosave lists the slot as an autosave and (by default) uses the cross-window lock with ifAvailable;
   *  opts.waitForLock forces waiting for the lock (≤ 30 s) even for autosave-flagged slots (crash/emergency saves). */
  save(slotId: string, name: string, world: WorldState, meta: SaveMeta, opts?: { autosave?: boolean; playMinutes?: number; waitForLock?: boolean }): Promise<SaveResult>;
  load(slotId: string): Promise<LoadResult>;
  remove(slotId: string): Promise<void>;
  /** Export a slot as a downloadable, self-verifying JSON file. */
  exportSlot(slotId: string): Promise<{ filename: string; data: Uint8Array } | null>;
  /** Import an exported file into a new slot (verifies checksum, migrates). */
  importFile(data: Uint8Array, slotId?: string): Promise<LoadResult & { slotId?: string }>;
  /** Most recently saved slot (for "Continue"). */
  latest(): Promise<SaveSlotInfo | null>;
}

/** Per-install user profile (NOT part of a world save): settings, tutorial progress, achievements. */
export interface ProfileStore {
  load<T>(key: string, fallback: T): Promise<T>;
  save<T>(key: string, value: T): Promise<void>;
  /**
   * load(), plus whether any read of the key FAILED (I/O error or storage unavailable), as opposed to "nothing stored".
   * Optional: a store without it gives callers no way to tell the two apart in one read.
   */
  loadChecked?<T>(key: string, fallback: T): Promise<{ value: T; readFailed: boolean }>;
}

/** Bridge exposed by electron/preload.ts as window.afterlifeNative (undefined in browsers). */
export interface NativeBridge {
  platform: string;
  version: string;
  storage: {
    read(key: string): Promise<Uint8Array | null>;
    write(key: string, data: Uint8Array): Promise<void>;
    remove(key: string): Promise<void>;
    list(prefix: string): Promise<string[]>;
    quota(): Promise<number | null>;
  };
  setFullscreen(on: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  quit(): void;
  openSavesFolder(): Promise<void>;
}

declare global {
  interface Window {
    afterlifeNative?: NativeBridge;
  }
}
