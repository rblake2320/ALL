/**
 * Atomic key/value file store for the desktop build. PURE Node (no electron import) so it is unit
 * tested against real temp directories and a fault-injecting fs.
 *
 * write(key):  '<file>.tmp-<pid>-<n>' (exclusive create) -> write all bytes -> fsync(file) ->
 *              rename over '<file>' (atomic replace on NTFS/ext4/APFS; on Windows retried with
 *              exponential backoff for up to ~2 s on EPERM/EACCES/EBUSY, which antivirus scanners,
 *              the search indexer and sync clients cause by briefly holding the target open) ->
 *              fsync(directory) on POSIX (Windows cannot open directories for flushing).
 * After a crash at any point the key holds either the old or the new value; leftover temp files are
 * ignored by reads and deleted by init(). Operations on one key are serialized by an in-process
 * mutex; cross-process exclusion is app.requestSingleInstanceLock() in main.ts.
 *
 * Windows READ-ONLY attribute: MoveFileEx(REPLACE_EXISTING) and DeleteFile fail with ERROR_ACCESS_DENIED
 * (EPERM) for a target carrying FILE_ATTRIBUTE_READONLY (saves restored by backup tools, copied from
 * read-only media). That is not a transient lock — retrying could never succeed — so on the first
 * EPERM/EACCES the store checks the target's mode and, if it is read-only, clears the attribute
 * (chmod +w, the only mode bit Windows honours) and retries at once. win32 only; POSIX permission errors
 * are reported, never "fixed" by changing modes.
 * Reads return a tight copy when fs hands back a view into a shared (pooled) buffer.
 *
 * Disk-fill guard (renderer DoS): at most `maxKeys` data files AND at most `maxTotalBytes` (default 2 GiB) of data
 * in total (security review L-5: 512 keys × 64 MiB would otherwise allow 32 GiB). Sizes of existing files are indexed
 * by init(); a write is checked and its delta RESERVED synchronously before any await, so concurrent writes to
 * different keys cannot overshoot together. Overwrites are judged by the size change; shrinking always succeeds.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { DATA_EXT, fileNameToKey, keyToFileName, TMP_RE, validateKey, validatePrefix } from './storageKeys';

/**
 * Temp files currently being written by THIS process (absolute paths). init()'s stray-temp sweep must never
 * delete a live writer's temp file: a second FileStore initialising on the same folder while another
 * instance is mid-write used to unlink the in-flight temp -> ENOENT on rename (lost write).
 */
const inFlightTemps = new Set<string>();
/** Temps younger than this may belong to a live writer in ANOTHER process; leave them for a later sweep. */
export const STALE_TEMP_MIN_AGE_MS = 60_000;

/** Monotonic per-PROCESS temp sequence (shared by every FileStore instance). */
let tempSeq = 0;
function nextTempSeq(): number {
  tempSeq = (tempSeq + 1) % Number.MAX_SAFE_INTEGER;
  return tempSeq;
}

export type FileStoreErrorCode = 'invalid' | 'quota' | 'busy' | 'io';

export class FileStoreError extends Error {
  readonly code: FileStoreErrorCode;
  override readonly cause: unknown;
  constructor(code: FileStoreErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'FileStoreError';
    this.code = code;
    this.cause = cause;
  }
}

export interface FileHandleLike {
  writeFile(data: Uint8Array): Promise<void>;
  readFile(): Promise<Uint8Array>;
  stat(): Promise<{ size: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** The subset of node:fs/promises the store uses (injectable for fault tests). */
export interface FsLike {
  open(p: string, flags: string): Promise<FileHandleLike>;
  rename(from: string, to: string): Promise<void>;
  unlink(p: string): Promise<void>;
  readdir(p: string): Promise<string[]>;
  mkdir(p: string): Promise<void>;
  statfs?(p: string): Promise<{ bavail: number; bsize: number }>;
  /** Path stat (mode bits); used to recognise the Windows read-only attribute. */
  stat?(p: string): Promise<{ size: number; mode: number; mtimeMs?: number }>;
  chmod?(p: string, mode: number): Promise<void>;
}

export const nodeFs: FsLike = {
  open: (p, flags) => fsp.open(p, flags),
  rename: (a, b) => fsp.rename(a, b),
  unlink: (p) => fsp.unlink(p),
  readdir: (p) => fsp.readdir(p),
  mkdir: async (p) => {
    await fsp.mkdir(p, { recursive: true });
  },
  statfs: async (p) => {
    const s = await fsp.statfs(p);
    return { bavail: Number(s.bavail), bsize: Number(s.bsize) };
  },
  stat: async (p) => {
    const s = await fsp.stat(p);
    return { size: s.size, mode: s.mode, mtimeMs: s.mtimeMs };
  },
  chmod: (p, mode) => fsp.chmod(p, mode),
};

/** Copy a fs-returned buffer unless it already owns its whole ArrayBuffer (pooled Buffers do not). */
export function exclusiveBytes(buf: Uint8Array): Uint8Array<ArrayBuffer> {
  const ab = buf.buffer;
  if (buf.byteOffset === 0 && buf.byteLength === ab.byteLength && Object.prototype.toString.call(ab) === '[object ArrayBuffer]') {
    return new Uint8Array(ab as ArrayBuffer);
  }
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return copy;
}

export interface RetryPolicy {
  /** Total time budget for retries (default 2000 ms). */
  maxElapsedMs: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface FileStoreOptions {
  dir: string;
  fs?: FsLike;
  platform?: NodeJS.Platform;
  pid?: number;
  /** Largest value accepted/read (default 64 MiB, matches the renderer's save cap). */
  maxValueBytes?: number;
  /** Max number of data files (renderer DoS guard; default 512). */
  maxKeys?: number;
  /** Max total bytes of all data files (renderer DoS guard; default 2 GiB). */
  maxTotalBytes?: number;
  retry?: Partial<RetryPolicy>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** Liveness probe for the pid embedded in a temp file name (default: process.kill(pid, 0)). */
  isPidAlive?: (pid: number) => boolean;
}

/** process.kill(pid, 0): no signal is sent; ESRCH = no such process, EPERM = exists but not ours (alive). */
export function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return errno(e) === 'EPERM';
  }
}

export const DEFAULT_MAX_VALUE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);

function errno(e: unknown): string | undefined {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

export function mapFsError(e: unknown, context: string, lockLikely: boolean): FileStoreError {
  if (e instanceof FileStoreError) return e;
  const code = errno(e);
  const msg = e instanceof Error ? e.message : String(e);
  switch (code) {
    case 'ENOSPC':
    case 'EDQUOT':
      return new FileStoreError('quota', `Not enough disk space to save (${context})`, e);
    case 'EBUSY':
    case 'EMFILE':
    case 'ENFILE':
      return new FileStoreError('busy', `The file is busy (${context}: ${code}) — antivirus, backup or sync software may be holding it`, e);
    case 'EPERM':
    case 'EACCES':
      return lockLikely
        ? new FileStoreError('busy', `The save file is locked by another program (${context}: ${code}) — antivirus, backup or sync software may be holding it`, e)
        : new FileStoreError('io', `Permission denied (${context}: ${code}) — check that the saves folder is writable`, e);
    case 'EROFS':
      return new FileStoreError('io', `The saves folder is on a read-only drive (${context})`, e);
    default:
      return new FileStoreError('io', `${context}: ${msg}`, e);
  }
}

class KeyedMutex {
  private tails = new Map<string, Promise<void>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => mine);
    this.tails.set(key, tail);
    return prev.then(async () => {
      try {
        return await fn();
      } finally {
        release();
        if (this.tails.get(key) === tail) this.tails.delete(key);
      }
    });
  }
}

export class FileStore {
  readonly dir: string;
  private readonly fs: FsLike;
  private readonly platform: NodeJS.Platform;
  private readonly pid: number;
  private readonly maxValueBytes: number;
  private readonly maxKeys: number;
  private readonly maxTotalBytes: number;
  /** Size of every known data file (by file name) and their sum, incl. reservations of in-flight writes. */
  private readonly sizes = new Map<string, number>();
  private totalBytes = 0;
  private readonly retry: RetryPolicy;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void;
  private readonly isPidAlive: (pid: number) => boolean;
  private readonly locks = new KeyedMutex();
  private known: Set<string> | null = null;
  private initPromise: Promise<{ removedTemps: string[] }> | null = null;

  constructor(opts: FileStoreOptions) {
    this.dir = path.resolve(opts.dir);
    this.fs = opts.fs ?? nodeFs;
    this.platform = opts.platform ?? process.platform;
    this.pid = opts.pid ?? process.pid;
    this.maxValueBytes = opts.maxValueBytes ?? DEFAULT_MAX_VALUE_BYTES;
    this.maxKeys = opts.maxKeys ?? 512;
    this.maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.retry = { maxElapsedMs: 2000, initialDelayMs: 10, maxDelayMs: 500, ...opts.retry };
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.log ?? (() => undefined);
    this.isPidAlive = opts.isPidAlive ?? defaultIsPidAlive;
  }

  /** Create the folder, delete stray temp files from crashed writes, index existing keys. Idempotent. */
  init(): Promise<{ removedTemps: string[] }> {
    if (!this.initPromise) {
      this.initPromise = this.doInit().catch((e) => {
        this.initPromise = null;
        throw e;
      });
    }
    return this.initPromise;
  }

  private async doInit(): Promise<{ removedTemps: string[] }> {
    try {
      await this.fs.mkdir(this.dir);
    } catch (e) {
      throw mapFsError(e, `creating ${this.dir}`, false);
    }
    let names: string[];
    try {
      names = await this.fs.readdir(this.dir);
    } catch (e) {
      throw mapFsError(e, `listing ${this.dir}`, false);
    }
    const removedTemps: string[] = [];
    for (const n of names) {
      if (!TMP_RE.test(n)) continue;
      const full = path.join(this.dir, n);
      if (inFlightTemps.has(full)) continue; // a live writer in this process owns it
      // '<file>.tmp-<pid>-<n>': our own pid (not in flight) or a dead pid = crash leftover -> delete now.
      // A live FOREIGN pid may be mid-write in another process -> only delete once it is stale.
      const pidMatch = /\.tmp-(\d+)-\d+$/.exec(n);
      const ownerPid = pidMatch ? Number(pidMatch[1]) : NaN;
      const foreignLive = ownerPid !== this.pid && this.isPidAlive(ownerPid);
      if (foreignLive && !this.fs.stat) continue; // age unknown: never risk deleting a live writer's temp
      if (foreignLive && this.fs.stat) {
        try {
          const st = await this.fs.stat(full);
          if (typeof st.mtimeMs === 'number' && Number.isFinite(st.mtimeMs) && this.now() - st.mtimeMs < STALE_TEMP_MIN_AGE_MS) continue;
        } catch {
          continue; // vanished (its writer just renamed it) or unreadable: not ours to delete now
        }
      }
      try {
        await this.withRetry(`removing stale ${n}`, () => this.fs.unlink(full));
        removedTemps.push(n);
      } catch (e) {
        this.log('warn', `could not remove stale temp file ${n}: ${(e as Error).message}`);
      }
    }
    this.known = new Set(names.filter((n) => fileNameToKey(n) !== null));
    this.sizes.clear();
    this.totalBytes = 0;
    for (const n of this.known) {
      const size = await this.sizeOf(path.join(this.dir, n));
      this.sizes.set(n, size);
      this.totalBytes += size;
    }
    if (removedTemps.length > 0) this.log('info', `removed ${removedTemps.length} stale temp file(s) from an interrupted save`);
    return { removedTemps };
  }

  /** Size of an existing data file (0 when it cannot be determined — it then simply counts as small). */
  private async sizeOf(full: string): Promise<number> {
    try {
      if (this.fs.stat) {
        const st = await this.fs.stat(full);
        return Number.isFinite(st.size) && st.size > 0 ? st.size : 0;
      }
      const fh = await this.fs.open(full, 'r');
      try {
        const st = await fh.stat();
        return Number.isFinite(st.size) && st.size > 0 ? st.size : 0;
      } finally {
        await fh.close().catch(() => undefined);
      }
    } catch {
      return 0;
    }
  }

  /** Bytes of data currently stored (for diagnostics/tests). */
  get usedBytes(): number {
    return this.totalBytes;
  }

  private fileFor(key: unknown): { name: string; full: string } {
    const v = validateKey(key);
    if (!v.ok) throw new FileStoreError('invalid', `invalid storage key: ${v.reason}`);
    const name = keyToFileName(v.key);
    const full = path.join(this.dir, name);
    // Belt and braces: the key grammar already makes traversal impossible.
    const rel = path.relative(this.dir, full);
    if (rel !== name || rel.startsWith('..') || path.isAbsolute(rel)) throw new FileStoreError('invalid', 'storage key escapes the saves folder');
    return { name, full };
  }

  async read(key: string): Promise<Uint8Array | null> {
    const { name, full } = this.fileFor(key);
    await this.init();
    return this.locks.run(name, async () => {
      let fh: FileHandleLike;
      try {
        fh = await this.withRetry(`opening ${name}`, () => this.fs.open(full, 'r'));
      } catch (e) {
        if (errno(e) === 'ENOENT') return null;
        throw mapFsError(e, `reading ${name}`, true);
      }
      try {
        const st = await fh.stat();
        if (st.size > this.maxValueBytes) throw new FileStoreError('io', `${name} is too large (${st.size} bytes)`);
        return exclusiveBytes(await fh.readFile());
      } catch (e) {
        throw mapFsError(e, `reading ${name}`, false);
      } finally {
        await fh.close().catch(() => undefined);
      }
    });
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    const { name, full } = this.fileFor(key);
    if (!(data instanceof Uint8Array)) throw new FileStoreError('invalid', 'value must be bytes');
    if (data.byteLength > this.maxValueBytes) throw new FileStoreError('invalid', `value is too large (${data.byteLength} bytes, limit ${this.maxValueBytes})`);
    await this.init();
    return this.locks.run(name, async () => {
      if (this.known && !this.known.has(name) && this.known.size >= this.maxKeys) {
        throw new FileStoreError('quota', `too many save files (limit ${this.maxKeys}); delete old saves`);
      }
      // Total-bytes quota: check AND reserve the delta synchronously (no await in between).
      const before = this.sizes.get(name) ?? 0;
      const delta = data.byteLength - before;
      if (delta > 0 && this.totalBytes + delta > this.maxTotalBytes) {
        throw new FileStoreError('quota', `the saves folder is full (limit ${Math.floor(this.maxTotalBytes / (1024 * 1024))} MiB); delete old saves`);
      }
      this.totalBytes += Math.max(0, delta);
      let ok = false;
      try {
        await atomicWriteFile({
        fs: this.fs,
        dir: this.dir,
        target: full,
        // Process-wide counter: two FileStore instances on one folder in the same process must never
        // pick the same temp name (a per-instance counter collided and one writer's cleanup unlinked the
        // other's in-flight temp file -> ENOENT on rename).
        tmp: `${full}.tmp-${this.pid}-${nextTempSeq()}`,
        data,
        fsyncDir: this.platform !== 'win32',
        withRetry: (label, fn, onDenied) => this.withRetry(label, fn, onDenied),
        onMissingDir: () => this.fs.mkdir(this.dir),
        onReplaceDenied: () => this.clearReadOnly(full),
        });
        ok = true;
      } finally {
        // Settle the reservation: success → the new size; failure → the old file is still there (atomic write).
        this.totalBytes -= Math.max(0, delta);
        if (ok) {
          this.totalBytes += delta;
          this.sizes.set(name, data.byteLength);
        }
      }
      this.known?.add(name);
    });
  }

  async remove(key: string): Promise<void> {
    const { name, full } = this.fileFor(key);
    await this.init();
    return this.locks.run(name, async () => {
      try {
        await this.withRetry(`deleting ${name}`, () => this.fs.unlink(full), () => this.clearReadOnly(full));
      } catch (e) {
        if (errno(e) !== 'ENOENT') throw mapFsError(e, `deleting ${name}`, true);
      }
      this.known?.delete(name);
      this.totalBytes -= this.sizes.get(name) ?? 0;
      this.sizes.delete(name);
    });
  }

  async list(prefix: string): Promise<string[]> {
    const v = validatePrefix(prefix);
    if (!v.ok) throw new FileStoreError('invalid', `invalid prefix: ${v.reason}`);
    await this.init();
    let names: string[];
    try {
      names = await this.fs.readdir(this.dir);
    } catch (e) {
      throw mapFsError(e, 'listing saves', false);
    }
    const keys: string[] = [];
    for (const n of names) {
      if (!n.endsWith(DATA_EXT)) continue;
      const k = fileNameToKey(n);
      if (k !== null && k.startsWith(v.key)) keys.push(k);
    }
    return keys.sort();
  }

  async quota(): Promise<number | null> {
    if (!this.fs.statfs) return null;
    try {
      await this.init();
      const s = await this.fs.statfs(this.dir);
      const free = s.bavail * s.bsize;
      return Number.isFinite(free) && free >= 0 ? Math.min(free, Number.MAX_SAFE_INTEGER) : null;
    } catch {
      return null;
    }
  }

  /**
   * Windows: clear the read-only attribute of one of OUR data files (see module doc). True when it was
   * read-only and is now writable, i.e. the denied operation is worth retrying immediately.
   */
  async clearReadOnly(target: string): Promise<boolean> {
    if (this.platform !== 'win32' || !this.fs.stat || !this.fs.chmod) return false;
    if (path.dirname(target) !== this.dir || fileNameToKey(path.basename(target)) === null) return false;
    try {
      const st = await this.fs.stat(target);
      if ((st.mode & 0o200) !== 0) return false; // writable: a real lock (antivirus/indexer), keep retrying
      await this.fs.chmod(target, 0o666);
      this.log('warn', `cleared the read-only attribute of ${path.basename(target)} so it can be replaced`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retry transient Windows lock errors with exponential backoff inside a fixed time budget.
   * `onDenied` runs once on the first EPERM/EACCES; when it reports a fix, the retry happens at once.
   */
  async withRetry<T>(label: string, fn: () => Promise<T>, onDenied?: () => Promise<boolean>): Promise<T> {
    const start = this.now();
    let delay = this.retry.initialDelayMs;
    let triedFix = false;
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const code = errno(e);
        if ((code === 'EPERM' || code === 'EACCES') && onDenied && !triedFix) {
          triedFix = true;
          if (await onDenied()) continue;
        }
        const elapsed = this.now() - start;
        if (!code || !RETRYABLE.has(code) || elapsed >= this.retry.maxElapsedMs) {
          if (code && RETRYABLE.has(code) && attempt > 1) this.log('warn', `${label}: still ${code} after ${attempt} attempts / ${elapsed} ms`);
          throw e;
        }
        await this.sleep(Math.min(delay, this.retry.maxDelayMs, Math.max(1, this.retry.maxElapsedMs - elapsed)));
        delay *= 2;
      }
    }
  }
}

export interface AtomicWriteArgs {
  fs: FsLike;
  dir: string;
  target: string;
  tmp: string;
  data: Uint8Array;
  fsyncDir: boolean;
  withRetry: <T>(label: string, fn: () => Promise<T>, onDenied?: () => Promise<boolean>) => Promise<T>;
  onMissingDir?: () => Promise<void>;
  /** Replacing the target was denied (EPERM/EACCES): try to fix (e.g. read-only attribute); true = retry now. */
  onReplaceDenied?: () => Promise<boolean>;
}

/** tmp -> fsync -> rename -> (dir fsync). Throws FileStoreError; never leaves its temp file behind. */
export async function atomicWriteFile(a: AtomicWriteArgs): Promise<void> {
  const base = path.basename(a.target);
  let fh: FileHandleLike;
  // NOTE: if creating the temp file fails (e.g. EEXIST) we throw BEFORE the cleanup `finally` below,
  // so we never unlink a temp file that belongs to another in-flight writer.
  try {
    fh = await a.fs.open(a.tmp, 'wx');
  } catch (e) {
    if (errno(e) === 'ENOENT' && a.onMissingDir) {
      // The saves folder was deleted while the game was running: recreate it once.
      try {
        await a.onMissingDir();
        fh = await a.fs.open(a.tmp, 'wx');
      } catch (e2) {
        throw mapFsError(e2, `creating a temporary file for ${base}`, false);
      }
    } else throw mapFsError(e, `creating a temporary file for ${base}`, false);
  }
  inFlightTemps.add(a.tmp);
  let committed = false;
  try {
    try {
      await fh.writeFile(a.data);
      await fh.sync();
    } finally {
      await fh.close().catch(() => undefined);
    }
    try {
      await a.withRetry(`replacing ${base}`, () => a.fs.rename(a.tmp, a.target), a.onReplaceDenied);
    } catch (e) {
      throw mapFsError(e, `replacing ${base}`, true);
    }
    committed = true;
    if (a.fsyncDir) {
      // Make the rename itself durable (POSIX). Failure here does not undo the committed write.
      try {
        const dh = await a.fs.open(a.dir, 'r');
        try {
          await dh.sync();
        } finally {
          await dh.close().catch(() => undefined);
        }
      } catch {
        // Some file systems (or platforms) refuse directory fsync; the data file itself is synced.
      }
    }
  } catch (e) {
    throw mapFsError(e, `writing ${base}`, false);
  } finally {
    if (!committed) {
      await a.withRetry(`cleaning up ${path.basename(a.tmp)}`, () => a.fs.unlink(a.tmp)).catch(() => undefined);
    }
    inFlightTemps.delete(a.tmp);
  }
}
