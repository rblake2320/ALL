/**
 * IndexedDB backend: one object store, out-of-line string keys, ArrayBuffer values.
 *
 *  - Atomicity: every write is ONE readwrite transaction with durability 'strict' (flushed before
 *    'complete'); IndexedDB guarantees all-or-nothing per transaction.
 *  - Quota: a failed put aborts the transaction with QuotaExceededError -> StorageError('quota').
 *  - Upgrades: onupgradeneeded creates the store; onversionchange closes our connection so another
 *    tab can upgrade; a blocked/hung open times out as 'busy' instead of hanging the game.
 *  - Lost connections (Safari drops IDB connections in the background, storage cleared by the
 *    user): the next operation reopens once before failing.
 */
import type { StorageBackend } from '../contracts';
import { asBytes, copyBytes } from '../bytes';
import { StorageError, toStorageError } from '../errors';

export interface IndexedDbBackendOptions {
  factory?: IDBFactory | (() => IDBFactory | null | undefined);
  dbName?: string;
  storeName?: string;
  openTimeoutMs?: number;
  durability?: IDBTransactionDurability;
}

const DB_VERSION = 1;
const PROBE_KEY = '__probe__';

export function createIndexedDbBackend(opts: IndexedDbBackendOptions = {}): StorageBackend {
  const dbName = opts.dbName ?? 'afterlife-lease';
  const storeName = opts.storeName ?? 'kv';
  const timeoutMs = opts.openTimeoutMs ?? 10_000;
  const durability = opts.durability ?? 'strict';
  let dbPromise: Promise<IDBDatabase> | null = null;

  const factory = (): IDBFactory => {
    let f: IDBFactory | null | undefined;
    try {
      f = typeof opts.factory === 'function' ? opts.factory() : (opts.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB);
    } catch (e) {
      throw toStorageError(e, 'IndexedDB unavailable');
    }
    if (!f) throw new StorageError('io', 'IndexedDB is not available');
    return f;
  };

  const openVersion = (version: number, allowRepair: boolean): Promise<IDBDatabase> =>
    new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn();
      };
      let req: IDBOpenDBRequest;
      try {
        req = factory().open(dbName, version);
      } catch (e) {
        reject(toStorageError(e, 'IndexedDB open'));
        return;
      }
      timer = setTimeout(
        () => finish(() => reject(new StorageError('busy', 'IndexedDB did not open in time (another tab may be upgrading or holding the database)'))),
        timeoutMs,
      );
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        } catch (e) {
          finish(() => reject(toStorageError(e, 'IndexedDB upgrade')));
        }
      };
      req.onblocked = () => {
        // Other connections were asked to close (versionchange); keep waiting — the timer bounds it.
      };
      req.onerror = () => finish(() => reject(toStorageError(req.error, 'IndexedDB open')));
      req.onsuccess = () => {
        const db = req.result;
        if (settled) {
          db.close(); // the open timed out; do not leak the late connection
          return;
        }
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        db.onclose = () => {
          dbPromise = null;
        };
        if (!db.objectStoreNames.contains(storeName)) {
          const next = db.version + 1;
          db.close();
          if (!allowRepair) {
            finish(() => reject(new StorageError('io', 'IndexedDB store is missing')));
            return;
          }
          // A database with our name but without our store (e.g. created by a different build):
          // bump the version so onupgradeneeded can create it.
          finish(() => openVersion(next, false).then(resolve, reject));
          return;
        }
        finish(() => resolve(db));
      };
    });

  const open = (): Promise<IDBDatabase> => {
    if (!dbPromise) {
      const p = openVersion(DB_VERSION, true);
      dbPromise = p;
      p.catch(() => {
        if (dbPromise === p) dbPromise = null; // allow a retry on the next call
      });
    }
    return dbPromise;
  };

  async function run<T>(mode: IDBTransactionMode, context: string, op: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | undefined> {
    for (let attempt = 0; ; attempt++) {
      const db = await open();
      let tx: IDBTransaction;
      try {
        tx = db.transaction(storeName, mode, { durability });
      } catch (e) {
        // InvalidStateError: the connection is closing (versionchange / connection lost). Reopen once.
        dbPromise = null;
        try {
          db.close();
        } catch {
          // already closed
        }
        if (attempt === 0) continue;
        throw toStorageError(e, context);
      }
      return new Promise<T | undefined>((resolve, reject) => {
        let result: T | undefined;
        let req: IDBRequest<T> | null = null;
        try {
          req = op(tx.objectStore(storeName));
        } catch (e) {
          try {
            tx.abort();
          } catch {
            // ignore
          }
          reject(toStorageError(e, context));
          return;
        }
        if (req) {
          const r = req;
          r.onsuccess = () => {
            result = r.result;
          };
        }
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(toStorageError(tx.error ?? req?.error ?? new Error('transaction aborted'), context));
        tx.onerror = () => {
          // The abort event follows and carries the error.
        };
      });
    }
  }

  return {
    id: 'indexeddb',
    durable: true,
    async available() {
      try {
        await run('readwrite', 'IndexedDB probe', (s) => s.put(new Uint8Array([1]).buffer, PROBE_KEY));
        const v = await run('readonly', 'IndexedDB probe', (s) => s.get(PROBE_KEY));
        await run('readwrite', 'IndexedDB probe', (s) => s.delete(PROBE_KEY));
        const b = asBytes(v);
        return b !== null && b.byteLength === 1 && b[0] === 1;
      } catch {
        return false;
      }
    },
    async read(key) {
      const v = await run<unknown>('readonly', `IndexedDB read ${key}`, (s) => s.get(key));
      if (v === undefined || v === null) return null;
      const b = asBytes(v);
      return b ? copyBytes(b) : new Uint8Array(0); // unknown value type -> treated as damaged upstream
    },
    async write(key, data) {
      if (!(data instanceof Uint8Array)) throw new StorageError('invalid', 'IndexedDB backend: data must be a Uint8Array');
      const buf = copyBytes(data).buffer; // tight ArrayBuffer: the most portable stored representation
      await run('readwrite', `IndexedDB write ${key}`, (s) => s.put(buf, key));
    },
    async remove(key) {
      await run('readwrite', `IndexedDB remove ${key}`, (s) => s.delete(key));
    },
    async list(prefix) {
      const keys = await run<IDBValidKey[]>('readonly', 'IndexedDB list', (s) => s.getAllKeys());
      return (keys ?? []).filter((k): k is string => typeof k === 'string' && k.startsWith(prefix) && k !== PROBE_KEY).sort();
    },
    async quota() {
      try {
        const est = await (globalThis as { navigator?: { storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }> } } }).navigator?.storage?.estimate?.();
        if (!est || typeof est.quota !== 'number') return null;
        return Math.max(0, est.quota - (est.usage ?? 0));
      } catch {
        return null;
      }
    },
  };
}
