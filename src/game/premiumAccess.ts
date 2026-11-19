/** Profile entitlement boundary for premium character bodies. */
import { isPremiumBodyId } from '../shared/premiumBodies';
import type { EconomyFacade } from '../economy/facade';

export function canUseBody(body: unknown, economy: EconomyFacade | null | undefined): boolean {
  if (!isPremiumBodyId(body)) return true;
  try {
    // A missing, loading or broken profile must not grant access. The economy
    // facade filters locally forged premium grants before exposing this set.
    return economy?.ready === true && economy.wallet.entitlements.has(`body:${body}`);
  } catch {
    return false;
  }
}

/** Returns the first body this profile cannot use; never mutates the save. */
export function unownedPremiumBody(world: { agents?: Record<string, { appearance?: { body?: unknown } }> }, economy: EconomyFacade | null | undefined): string | null {
  for (const agent of Object.values(world.agents ?? {})) {
    const body = agent?.appearance?.body;
    if (isPremiumBodyId(body) && !canUseBody(body, economy)) return body;
  }
  return null;
}
