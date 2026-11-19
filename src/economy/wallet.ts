/**
 * Grave Gold wallet seam (docs/MONETIZATION.md §1, §3). GG is SERVER-AUTHORITATIVE: the client only ever displays a
 * server-reported balance and starts a server checkout (Stripe on web, Steam MicroTransactions on Steam — Phase 4).
 * No client build can mint GG: the local ledger refuses `gg` entries and this interface has no "credit" method.
 *
 *  - ServerWallet: Phase 4 stub — signed out, balance null, every purchase answers `signInRequired`.
 *  - DevWallet (./devWallet.ts): in-memory play money for UI development, constructed ONLY behind
 *    `import.meta.env.DEV` via `createGGWallet()`; Vite removes the branch (and the module) from production bundles —
 *    tests/unit/economy/bundle.test.ts builds the game and asserts no DevWallet code or strings remain.
 */
import type { StoreSku } from '../shared/economy';

export type GGPurchaseResult =
  | { ok: true; entitlements: string[]; balance: number }
  | { ok: false; code: 'signInRequired' | 'unavailable' | 'insufficient' | 'blocked'; message: string };

export interface GGWallet {
  readonly kind: 'server' | 'dev';
  readonly signedIn: boolean;
  /** Server-reported GG balance; null when signed out/offline. */
  balance(): number | null;
  /** Start a purchase of a GG- or real-money-priced SKU. Never credits GG locally. */
  purchase(sku: StoreSku): Promise<GGPurchaseResult>;
  /** Entitlements the server reports for this account (empty when signed out). */
  entitlements(): ReadonlySet<string>;
}

export class ServerWallet implements GGWallet {
  readonly kind = 'server' as const;
  readonly signedIn = false;
  balance(): number | null {
    return null;
  }
  entitlements(): ReadonlySet<string> {
    return new Set();
  }
  async purchase(_sku: StoreSku): Promise<GGPurchaseResult> {
    return { ok: false, code: 'signInRequired', message: 'Sign in to buy (coming soon).' };
  }
}

/** The wallet for this build: ServerWallet everywhere; DevWallet only in `vite dev` (stripped from production). */
export async function createGGWallet(): Promise<GGWallet> {
  if (import.meta.env.DEV) {
    const m = await import('./devWallet');
    return m.createDevWallet();
  }
  return new ServerWallet();
}
