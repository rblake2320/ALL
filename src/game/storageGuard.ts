/**
 * Storage-eviction guard (web, design §4.5). Browsers may evict IndexedDB / localStorage under storage pressure unless
 * the origin holds persistent storage. When `navigator.storage.persist()` is denied we show ONE non-blocking notice per
 * install offering Export Save (remembered in the profile, so it never nags). Never in the desktop app, never with a
 * non-durable backend (that case has its own "Saves are temporary here" warning), never throws.
 */
import type { Core } from './core';
import { safeProfileLoad } from './profile';

export const STORAGE_NOTICE_PROFILE_KEY = 'storageNotice';
export const STORAGE_NOTICE_TITLE = 'Your browser may clear saves';
export const STORAGE_NOTICE_TEXT =
  "This browser didn't grant persistent storage, so it may delete saves when space runs low. Use Export in the Load menu to keep a copy of your save.";

interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

/** The page's StorageManager (null outside browsers). Overridable for tests. */
export let storageManager = (): StorageManagerLike | null => {
  try {
    const s = (globalThis as { navigator?: { storage?: StorageManagerLike } }).navigator?.storage;
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
};

export function setStorageManagerForTests(fn: () => StorageManagerLike | null): void {
  storageManager = fn;
}

const checked = new WeakSet<Core>();

/** Resolves to true when the notice was shown. */
export async function checkPersistentStorage(c: Core): Promise<boolean> {
  if (checked.has(c)) return false;
  checked.add(c);
  try {
    if (c.env.native()) return false;
    const id = c.saves.backend?.id;
    if (id !== 'indexeddb' && id !== 'localstorage') return false;
    const sm = storageManager();
    if (!sm || typeof sm.persist !== 'function') return false;
    if (typeof sm.persisted === 'function' && (await sm.persisted()) === true) return false;
    if ((await sm.persist()) === true) return false;
    const seen = await safeProfileLoad<unknown>(c.profile, STORAGE_NOTICE_PROFILE_KEY, null, (e) => c.report('profile.storageNotice', e));
    if (seen && typeof seen === 'object' && (seen as { shown?: unknown }).shown === true) return false;
    if (c.disposed) return false;
    c.toast('warning', STORAGE_NOTICE_TITLE, STORAGE_NOTICE_TEXT, { mergeKey: 'storageNotice' });
    void c.profileWriter.write(STORAGE_NOTICE_PROFILE_KEY, { v: 1, shown: true, at: c.env.wallNow() });
    return true;
  } catch (e) {
    c.report('storage.persist', e);
    return false;
  }
}
