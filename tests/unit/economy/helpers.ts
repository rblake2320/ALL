import { createMemoryBackend, type MemoryBackend } from '../../../src/persistence/backends/memory';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { Mutex, type LockProvider } from '../../../src/persistence/locks';
import type { StorageBackend } from '../../../src/persistence/contracts';
import { EconomyService } from '../../../src/economy/service';
import type { GGWallet } from '../../../src/economy/wallet';
import { LedgerStore } from '../../../src/economy/ledgerStore';

export const quiet = { warn: () => undefined };

/** A cross-"window" lock shared by several stores (stands in for Web Locks across tabs). */
export function sharedLocks(): LockProvider {
  const m = new Map<string, Mutex>();
  return {
    kind: 'custom',
    run(name, fn) {
      let mx = m.get(name);
      if (!mx) m.set(name, (mx = new Mutex()));
      return mx.run(fn);
    },
  };
}

export interface Window {
  backend: StorageBackend;
  profile: ProfileStoreImpl;
  ledger: LedgerStore;
}

/** One "window": its own ProfileStore + LedgerStore over a (possibly shared) backend. */
export function windowOn(backend: StorageBackend, locks?: LockProvider, now = () => Date.parse('2026-11-05T12:00:00Z')): Window {
  const profile = new ProfileStoreImpl(() => Promise.resolve(backend), { logger: quiet, now });
  return { backend, profile, ledger: new LedgerStore({ backend: () => Promise.resolve(backend), profile, locks, now, logger: quiet }) };
}

export function memory(): MemoryBackend {
  return createMemoryBackend();
}

export function service(backend: StorageBackend, opts: { now?: () => number; locks?: LockProvider; seed?: number; wallet?: GGWallet } = {}): EconomyService {
  const now = opts.now ?? (() => Date.parse('2026-11-05T12:00:00Z'));
  const profile = new ProfileStoreImpl(() => Promise.resolve(backend), { logger: quiet, now });
  let r = opts.seed ?? 12345;
  return new EconomyService({ backend: () => Promise.resolve(backend), profile, locks: opts.locks, now, randomU32: () => (r = (r * 1103515245 + 12345) >>> 0), logger: quiet, broadcast: false, ...(opts.wallet ? { wallet: opts.wallet } : {}) });
}
