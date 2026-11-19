/**
 * Minimal in-memory IndexedDB (the subset the backend uses) with failure injection: quota aborts,
 * blocked/hung opens, lost connections, versionchange, missing object stores.
 * Transactions commit atomically at completion: puts are staged and applied all-or-nothing.
 */
type Listener = (() => void) | null;

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: Listener = null;
  onerror: Listener = null;
}

class FakeOpenRequest extends FakeRequest<FakeDB> {
  onupgradeneeded: Listener = null;
  onblocked: Listener = null;
}

interface DbData {
  version: number;
  stores: Map<string, Map<string, unknown>>;
}

export class FakeIDBFactory {
  readonly dbs = new Map<string, DbData>();
  /** Behaviour switches for adversarial tests. */
  openMode: 'ok' | 'error' | 'hang' | 'throw' = 'ok';
  quotaBytes = Infinity;
  failNextTransactionCreate = 0;
  opens = 0;
  readonly connections: FakeDB[] = [];

  open(name: string, version?: number): FakeOpenRequest {
    if (this.openMode === 'throw') throw new DOMException('A mutation operation was attempted on a database that did not allow mutations.', 'InvalidStateError');
    this.opens++;
    const req = new FakeOpenRequest();
    setTimeout(() => {
      if (this.openMode === 'hang') return;
      if (this.openMode === 'error') {
        req.error = new DOMException('denied', 'UnknownError');
        req.onerror?.();
        return;
      }
      let data = this.dbs.get(name);
      const target = version ?? data?.version ?? 1;
      if (data && target < data.version) {
        req.error = new DOMException('version', 'VersionError');
        req.onerror?.();
        return;
      }
      if (!data) {
        data = { version: 0, stores: new Map() };
        this.dbs.set(name, data);
      }
      const db = new FakeDB(this, data);
      req.result = db;
      if (target > data.version) {
        data.version = target;
        db.upgrading = true;
        req.onupgradeneeded?.();
        db.upgrading = false;
      }
      this.connections.push(db);
      req.onsuccess?.();
    }, 0);
    return req;
  }

  usedBytes(): number {
    let n = 0;
    for (const db of this.dbs.values()) for (const s of db.stores.values()) for (const v of s.values()) n += v instanceof ArrayBuffer ? v.byteLength : 16;
    return n;
  }
}

export class FakeDB {
  upgrading = false;
  closed = false;
  onversionchange: Listener = null;
  onclose: Listener = null;
  constructor(private readonly factory: FakeIDBFactory, readonly data: DbData) {}
  get version(): number {
    return this.data.version;
  }
  get objectStoreNames() {
    return { contains: (n: string) => this.data.stores.has(n) };
  }
  createObjectStore(name: string): void {
    if (!this.upgrading) throw new DOMException('not upgrading', 'InvalidStateError');
    this.data.stores.set(name, new Map());
  }
  close(): void {
    this.closed = true;
  }
  /** Simulate the browser dropping the connection (Safari background, storage cleared). */
  lose(): void {
    this.closed = true;
    this.onclose?.();
  }
  transaction(name: string, mode: 'readonly' | 'readwrite', _opts?: unknown): FakeTx {
    if (this.closed) throw new DOMException('The database connection is closing.', 'InvalidStateError');
    if (this.factory.failNextTransactionCreate > 0) {
      this.factory.failNextTransactionCreate--;
      throw new DOMException('The database connection is closing.', 'InvalidStateError');
    }
    const store = this.data.stores.get(name);
    if (!store) throw new DOMException('no store', 'NotFoundError');
    return new FakeTx(this.factory, store, mode);
  }
}

export class FakeTx {
  oncomplete: Listener = null;
  onabort: Listener = null;
  onerror: Listener = null;
  error: DOMException | null = null;
  private staged = new Map<string, unknown | typeof DELETE>();
  private aborted = false;
  private pending = 0;
  constructor(private readonly factory: FakeIDBFactory, private readonly store: Map<string, unknown>, private readonly mode: string) {
    setTimeout(() => this.maybeFinish(), 0);
  }
  objectStore(_name: string) {
    return {
      get: (key: string) => this.req(() => (this.staged.has(key) ? (this.staged.get(key) === DELETE ? undefined : this.staged.get(key)) : this.store.get(key))),
      put: (value: unknown, key: string) => {
        if (this.mode !== 'readwrite') throw new DOMException('read only', 'ReadOnlyError');
        return this.req(() => {
          const size = value instanceof ArrayBuffer ? value.byteLength : 16;
          if (this.factory.usedBytes() + size > this.factory.quotaBytes) {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          }
          this.staged.set(key, value instanceof ArrayBuffer ? value.slice(0) : value);
          return key;
        });
      },
      delete: (key: string) => {
        if (this.mode !== 'readwrite') throw new DOMException('read only', 'ReadOnlyError');
        return this.req(() => {
          this.staged.set(key, DELETE);
          return undefined;
        });
      },
      getAllKeys: () => this.req(() => [...this.store.keys()]),
    };
  }
  abort(): void {
    this.aborted = true;
    this.error = this.error ?? new DOMException('aborted', 'AbortError');
  }
  private req<T>(fn: () => T): FakeRequest<T> {
    const r = new FakeRequest<T>();
    this.pending++;
    setTimeout(() => {
      this.pending--;
      if (this.aborted) return this.maybeFinish();
      try {
        r.result = fn();
        r.onsuccess?.();
      } catch (e) {
        r.error = e as DOMException;
        this.error = e as DOMException;
        r.onerror?.();
        this.onerror?.();
        this.aborted = true;
      }
      this.maybeFinish();
    }, 0);
    return r;
  }
  private finished = false;
  private maybeFinish(): void {
    if (this.finished || this.pending > 0) return;
    this.finished = true;
    if (this.aborted) {
      this.onabort?.();
      return;
    }
    for (const [k, v] of this.staged) {
      if (v === DELETE) this.store.delete(k);
      else this.store.set(k, v);
    }
    this.oncomplete?.();
  }
}

const DELETE = Symbol('delete');
