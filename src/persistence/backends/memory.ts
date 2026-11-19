/** Non-durable in-memory backend (last-resort fallback and test double). Copies on every boundary. */
import type { StorageBackend } from '../contracts';
import { copyBytes } from '../bytes';
import { StorageError } from '../errors';

export interface MemoryBackend extends StorageBackend {
  /** Direct access for tests/diagnostics (values are the stored copies). */
  readonly store: Map<string, Uint8Array>;
}

export function createMemoryBackend(opts: { quotaBytes?: number } = {}): MemoryBackend {
  const store = new Map<string, Uint8Array>();
  const used = () => {
    let n = 0;
    for (const [k, v] of store) n += k.length * 2 + v.byteLength;
    return n;
  };
  return {
    id: 'memory',
    durable: false,
    store,
    async available() {
      return true;
    },
    async read(key) {
      const v = store.get(key);
      return v ? copyBytes(v) : null;
    },
    async write(key, data) {
      if (!(data instanceof Uint8Array)) throw new StorageError('invalid', 'memory backend: data must be a Uint8Array');
      if (opts.quotaBytes !== undefined) {
        const prev = store.get(key);
        const next = used() - (prev ? prev.byteLength + key.length * 2 : 0) + data.byteLength + key.length * 2;
        if (next > opts.quotaBytes) throw new StorageError('quota', 'memory backend: quota exceeded');
      }
      store.set(key, copyBytes(data));
    },
    async remove(key) {
      store.delete(key);
    },
    async list(prefix) {
      return [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    async quota() {
      return opts.quotaBytes === undefined ? null : Math.max(0, opts.quotaBytes - used());
    },
  };
}
