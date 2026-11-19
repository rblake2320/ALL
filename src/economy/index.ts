/**
 * ECONOMY entry point (docs/MONETIZATION.md). `createEconomy()` wires the EconomyService to the game's shared storage
 * backend + ProfileStore, Web Locks across windows, and the build's GG wallet (ServerWallet; DevWallet in `vite dev`).
 */
import type { ProfileStore, StorageBackend } from '../persistence/contracts';
import { sharedBackend } from '../persistence/backends/select';
import { webLocks } from '../persistence/locks';
import { EconomyService } from './service';
import { createGGWallet } from './wallet';

export type { EconomyFacade, DailyView, QuestView, EconomyToast, SkuState, UnlockResult, DailyTaskView } from './facade';
export { EconomyService } from './service';
export { brandSkinFor, adCreativesFor, setBrandsEnabled, HOUSE_BRANDS, HOUSE_BRAND_SKINS, HOUSE_AD_CREATIVES } from './brands';
export { CATALOG, catalogEntry, buyLockFor, isUsable, BODY_UNLOCKS_LIVE, PET_VARIANTS_LIVE, petVariantId } from './catalog';
export { STORE_SKUS, skuById, featuredSkus } from './skus';

export function createEconomy(opts: { profile: ProfileStore; backend?: () => Promise<StorageBackend> }): EconomyService {
  const svc = new EconomyService({
    backend: opts.backend ?? (() => sharedBackend()),
    profile: opts.profile,
    locks: webLocks() ?? undefined,
    wallet: createGGWallet(),
  });
  void svc.init();
  // Persist daily-task progress when the page goes away (ledger writes are already durable when they resolve).
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', () => void svc.flush());
  }
  return svc;
}
