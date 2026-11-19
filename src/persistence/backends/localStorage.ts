/**
 * localStorage backend. Values are 'b64:' + base64(bytes) under 'afterlife-lease:<key>'. A single
 * setItem is atomic (the browser either stores the new string or throws), so the contract's
 * "never a torn write" holds. Quota is ~5 MB per origin in most browsers (UTF-16 code units of
 * keys+values); quota() estimates the remaining bytes and QuotaExceededError maps to 'quota'.
 * Access to window.localStorage itself can THROW (sandboxed iframes, disabled site data), so every
 * touch is guarded.
 */
import type { StorageBackend } from '../contracts';
import { base64ToBytes, bytesToBase64, utf8Encode } from '../bytes';
import { isQuotaError, StorageError, toStorageError } from '../errors';

export const LS_PREFIX = 'afterlife-lease:';
const VALUE_TAG = 'b64:';
/** Conservative per-origin budget in UTF-16 code units (Chrome/Firefox/Safari allow ~5M). */
export const DEFAULT_LS_QUOTA_CHARS = 5_000_000;

export interface LocalStorageBackendOptions {
  storage?: Storage | (() => Storage | null | undefined);
  quotaChars?: number;
}

function resolveStorage(opt: LocalStorageBackendOptions['storage']): Storage | null {
  try {
    if (typeof opt === 'function') return opt() ?? null;
    if (opt) return opt;
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

export function createLocalStorageBackend(opts: LocalStorageBackendOptions = {}): StorageBackend {
  const quotaChars = opts.quotaChars ?? DEFAULT_LS_QUOTA_CHARS;
  const get = (): Storage => {
    const s = resolveStorage(opts.storage);
    if (!s) throw new StorageError('io', 'localStorage is not accessible');
    return s;
  };
  const usedChars = (s: Storage): number => {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k === null) continue;
      n += k.length + (s.getItem(k)?.length ?? 0);
    }
    return n;
  };
  return {
    id: 'localstorage',
    durable: true,
    async available() {
      try {
        const s = resolveStorage(opts.storage);
        if (!s) return false;
        const probe = `${LS_PREFIX}__probe__`;
        s.setItem(probe, '1');
        const ok = s.getItem(probe) === '1';
        s.removeItem(probe);
        return ok;
      } catch {
        return false;
      }
    },
    async read(key) {
      let raw: string | null;
      try {
        raw = get().getItem(LS_PREFIX + key);
      } catch (e) {
        throw toStorageError(e, `localStorage read ${key}`);
      }
      if (raw === null) return null;
      if (raw.startsWith(VALUE_TAG)) {
        // Damaged base64 yields empty bytes, which the save pipeline reports as 'corrupt' (-> backup).
        return base64ToBytes(raw.slice(VALUE_TAG.length)) ?? new Uint8Array(0);
      }
      return utf8Encode(raw); // tolerate plain-text values (hand-restored or legacy)
    },
    async write(key, data) {
      if (!(data instanceof Uint8Array)) throw new StorageError('invalid', 'localStorage backend: data must be a Uint8Array');
      const value = VALUE_TAG + bytesToBase64(data);
      try {
        get().setItem(LS_PREFIX + key, value);
      } catch (e) {
        if (isQuotaError(e)) throw new StorageError('quota', `browser storage is full (needed ~${value.length * 2} bytes for ${key})`, e);
        throw toStorageError(e, `localStorage write ${key}`);
      }
    },
    async remove(key) {
      try {
        get().removeItem(LS_PREFIX + key);
      } catch (e) {
        throw toStorageError(e, `localStorage remove ${key}`);
      }
    },
    async list(prefix) {
      try {
        const s = get();
        const out: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k !== null && k.startsWith(LS_PREFIX)) {
            const key = k.slice(LS_PREFIX.length);
            if (key.startsWith(prefix) && key !== '__probe__') out.push(key);
          }
        }
        return out.sort();
      } catch (e) {
        throw toStorageError(e, 'localStorage list');
      }
    },
    async quota() {
      try {
        const freeChars = Math.max(0, quotaChars - usedChars(get()));
        return Math.floor(freeChars * 0.75); // base64: 4 chars carry 3 bytes
      } catch {
        return null;
      }
    },
  };
}
