/**
 * PLATFORM / persistence entry point (factory names are contractual — docs/CONTRACTS.md):
 *   createSaveManager(): Promise<SaveManager>   createProfileStore(): ProfileStore
 * Both share one storage backend chosen by probing: electron > indexeddb > localstorage > memory.
 * See docs/PLATFORM.md for the save format and recovery behaviour.
 */
import type { ProfileStore, SaveManager, StorageBackend } from './contracts';
import { installQuitHook } from './activity';
import { sharedBackend } from './backends/select';
import { ProfileStoreImpl, type ProfileStoreOptions } from './profileStore';
import { SaveManagerImpl, type SaveManagerOptions } from './saveManager';
import { engineRepairHook } from './semanticRepair';

export type { LoadResult, NativeBridge, ProfileStore, SaveManager, SaveMeta, SaveResult, SaveSlotInfo, StorageBackend } from './contracts';
export { SaveManagerImpl } from './saveManager';
export type { SaveManagerOptions, PersistenceLogger } from './saveManager';
export { ProfileStoreImpl } from './profileStore';
export { GAME_VERSION } from './version';
export { canonicalJson, CanonicalJsonError } from './canonicalJson';
export { sha256Hex } from './sha256';
export { sanitizeParse, MAX_SAVE_BYTES } from './sanitize';
export { MIGRATIONS, migratePayload, type Migration } from './migrations';
export { validateWorld } from './validation';
export { exportFilename } from './meta';
export { selectBackend, sharedBackend } from './backends/select';
export { createMemoryBackend } from './backends/memory';
export { createLocalStorageBackend } from './backends/localStorage';
export { createIndexedDbBackend } from './backends/indexedDb';
export { createElectronBackend } from './backends/electron';
export { StorageError } from './errors';
export { ActivityTracker, installQuitHook, persistenceActivity, QUIT_HOOK_GLOBAL } from './activity';

/**
 * Create the game's SaveManager. With no arguments: probed shared backend, gzip when supported,
 * the engine's repairWorld as the semantic repair hook (if it exists), Web Locks across tabs. Also
 * installs the quit hook the desktop shell awaits before closing (see activity.ts).
 */
export async function createSaveManager(opts: Partial<SaveManagerOptions> = {}): Promise<SaveManager> {
  installQuitHook();
  const backend = opts.backend ?? (await sharedBackend());
  return new SaveManagerImpl({ repair: engineRepairHook(), ...opts, backend });
}

/** Create the per-install ProfileStore (synchronous; the backend is resolved lazily on first use). */
export function createProfileStore(opts: ProfileStoreOptions & { backend?: StorageBackend | Promise<StorageBackend> } = {}): ProfileStore {
  installQuitHook();
  const { backend, ...rest } = opts;
  const resolve = backend ? () => Promise.resolve(backend) : () => sharedBackend();
  return new ProfileStoreImpl(resolve, rest);
}
