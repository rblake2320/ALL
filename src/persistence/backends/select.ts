/**
 * Backend selection: electron > indexeddb > localstorage > memory. Each candidate is probed with a
 * real write/read round trip under a timeout; anything thrown (private mode, sandboxed iframes,
 * disabled site data, SecurityError on property access) just disqualifies that candidate.
 * The choice is memoized per page so saves and the profile store always share one backend family.
 */
import type { StorageBackend } from '../contracts';
import { createElectronBackend } from './electron';
import { createIndexedDbBackend } from './indexedDb';
import { createLocalStorageBackend } from './localStorage';
import { createMemoryBackend } from './memory';

export interface BackendCandidate {
  id: StorageBackend['id'];
  create(): StorageBackend;
}

export function defaultCandidates(): BackendCandidate[] {
  return [
    { id: 'electron', create: () => createElectronBackend() },
    { id: 'indexeddb', create: () => createIndexedDbBackend() },
    { id: 'localstorage', create: () => createLocalStorageBackend() },
  ];
}

async function probe(backend: StorageBackend, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    return await Promise.race([Promise.resolve().then(() => backend.available()), timeout]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface SelectOptions {
  candidates?: BackendCandidate[];
  timeoutMs?: number;
  logger?: { warn(...a: unknown[]): void };
}

export async function selectBackend(opts: SelectOptions = {}): Promise<StorageBackend> {
  const log = opts.logger ?? console;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  for (const c of opts.candidates ?? defaultCandidates()) {
    let backend: StorageBackend;
    try {
      backend = c.create();
    } catch (e) {
      log.warn(`[persistence] ${c.id} backend could not be created:`, e);
      continue;
    }
    if (await probe(backend, timeoutMs)) return backend;
  }
  log.warn('[persistence] no durable storage available; saves will last only until the page is closed');
  return createMemoryBackend();
}

let shared: Promise<StorageBackend> | null = null;

/** The page-wide backend (probed once). */
export function sharedBackend(): Promise<StorageBackend> {
  if (!shared) shared = selectBackend();
  return shared;
}

/** Test hook: forget the memoized backend. */
export function resetSharedBackend(): void {
  shared = null;
}
