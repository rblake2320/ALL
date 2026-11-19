/**
 * DEV ONLY — in-memory Grave Gold for exercising the store UI under `vite dev`. Imported exclusively through the
 * `import.meta.env.DEV` branch of createGGWallet() (src/economy/wallet.ts), so production bundles never contain it
 * (asserted by tests/unit/economy/bundle.test.ts). Nothing here is persisted and nothing reaches the ledger.
 */
import type { StoreSku } from '../shared/economy';
import type { GGPurchaseResult, GGWallet } from './wallet';

export const DEV_WALLET_MARKER = '__afterlife_dev_wallet__';

export function createDevWallet(startGG = 5000): GGWallet {
  let gg = startGG;
  const owned = new Set<string>();
  return {
    kind: 'dev',
    signedIn: true,
    balance: () => gg,
    entitlements: () => owned,
    async purchase(sku: StoreSku): Promise<GGPurchaseResult> {
      const price = sku.priceGG ?? 0;
      if (sku.priceUsdCents !== undefined) return { ok: false, code: 'unavailable', message: `${DEV_WALLET_MARKER}: real-money checkout is not simulated` };
      if (price > gg) return { ok: false, code: 'insufficient', message: 'Not enough (dev) Grave Gold' };
      gg -= price;
      const ents = sku.contents.map((c) => c.contentId).filter((id) => id !== 'currency:gg');
      for (const e of ents) owned.add(e);
      return { ok: true, entitlements: ents, balance: gg };
    },
  };
}
