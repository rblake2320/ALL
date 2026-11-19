/**
 * Electron backend: window.afterlifeNative.storage (electron/preload.ts -> main -> fileStore.ts:
 * atomic tmp+fsync+rename files under %APPDATA%\Afterlife Lease\saves). Errors cross the context
 * bridge as "[code] message" strings and are mapped back to StorageError codes here.
 */
import type { NativeBridge, StorageBackend } from '../contracts';
import { asBytes } from '../bytes';
import { StorageError, toStorageError } from '../errors';

export function nativeBridge(): NativeBridge | null {
  try {
    const w = (globalThis as { window?: { afterlifeNative?: NativeBridge } }).window;
    const b = w?.afterlifeNative;
    return b && typeof b === 'object' && b.storage && typeof b.storage.read === 'function' ? b : null;
  } catch {
    return null;
  }
}

const PROBE_ATTEMPTS = 3;
const PROBE_BACKOFF_MS = 150;

export function createElectronBackend(bridge?: NativeBridge | null): StorageBackend {
  const get = (): NativeBridge['storage'] => {
    const b = bridge ?? nativeBridge();
    if (!b) throw new StorageError('io', 'desktop storage bridge is not available');
    return b.storage;
  };
  return {
    id: 'electron',
    durable: true,
    async available() {
      // Inside the desktop app a transient failure (antivirus scanning the saves folder at startup) must
      // not silently divert this whole session's saves to the browser profile's IndexedDB — retry briefly.
      if (!(bridge ?? nativeBridge())) return false;
      for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt++) {
        try {
          const keys = await get().list('slot:');
          if (Array.isArray(keys)) return true;
        } catch {
          // fall through to the retry
        }
        if (attempt < PROBE_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, PROBE_BACKOFF_MS * (attempt + 1)));
      }
      return false;
    },
    async read(key) {
      let v: unknown;
      try {
        v = await get().read(key);
      } catch (e) {
        throw toStorageError(e, `read ${key}`);
      }
      if (v === null || v === undefined) return null;
      const b = asBytes(v);
      if (!b) throw new StorageError('io', `read ${key}: bridge returned ${typeof v}`);
      return b;
    },
    async write(key, data) {
      if (!(data instanceof Uint8Array)) throw new StorageError('invalid', 'data must be a Uint8Array');
      try {
        await get().write(key, data);
      } catch (e) {
        throw toStorageError(e, `write ${key}`);
      }
    },
    async remove(key) {
      try {
        await get().remove(key);
      } catch (e) {
        throw toStorageError(e, `remove ${key}`);
      }
    },
    async list(prefix) {
      let v: unknown;
      try {
        v = await get().list(prefix);
      } catch (e) {
        throw toStorageError(e, 'list');
      }
      if (!Array.isArray(v)) throw new StorageError('io', 'list: bridge returned a non-array');
      return v.filter((k): k is string => typeof k === 'string' && k.startsWith(prefix)).sort();
    },
    async quota() {
      try {
        const q = await get().quota();
        return typeof q === 'number' && Number.isFinite(q) && q >= 0 ? q : null;
      } catch {
        return null;
      }
    },
  };
}
