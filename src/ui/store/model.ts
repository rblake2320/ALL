/**
 * Pure view-model for the store (tested in tests/unit/ui-store): which SKUs each tab shows and how every price is
 * labelled. The ONLY way a Grave Gold price reaches the screen is `ggLabel()` (amount + real-money equivalent).
 */
import type { StoreSku } from '../../shared/economy';
import type { StoreTabId } from '../../economy/analytics';
import type { SkuState } from '../../economy/facade';
import { STORE_SKUS, featuredSkus, GG_CONTENT } from '../../economy/skus';
import { baseRate, formatCount, formatUsd, ggLabel, ggToCents, sumOfParts } from '../../economy/pricing';
import { PHYSICAL_BY_ID } from '../../shared/catalog';
import { SCULPTED_BODIES } from '../../shared/cast';

export const STORE_TABS: readonly StoreTabId[] = ['featured', 'bundles', 'items', 'bodies', 'boosts', 'season', 'gold'];

export function skusForTab(tab: StoreTabId): StoreSku[] {
  switch (tab) {
    case 'featured':
      return featuredSkus();
    case 'bundles':
      return STORE_SKUS.filter((s) => s.kind === 'bundle');
    case 'items':
      return STORE_SKUS.filter((s) => s.kind === 'item').sort((a, b) => (a.priceBones !== undefined ? 0 : 1) - (b.priceBones !== undefined ? 0 : 1) || (a.priceBones ?? a.priceGG ?? 0) - (b.priceBones ?? b.priceGG ?? 0) || a.id.localeCompare(b.id));
    case 'bodies':
      return STORE_SKUS.filter((s) => s.kind === 'body' || s.kind === 'petVariant');
    case 'boosts':
      return STORE_SKUS.filter((s) => s.kind === 'boost');
    case 'season':
      return STORE_SKUS.filter((s) => s.kind === 'season');
    case 'gold':
      return STORE_SKUS.filter((s) => s.kind === 'ggPack' || s.kind === 'subscription');
    default:
      return [];
  }
}

export function tabForSku(skuId: string): StoreTabId {
  const s = STORE_SKUS.find((x) => x.id === skuId);
  if (!s) return 'featured';
  switch (s.kind) {
    case 'bundle':
      return 'bundles';
    case 'body':
    case 'petVariant':
      return 'bodies';
    case 'boost':
      return 'boosts';
    case 'season':
      return 'season';
    case 'ggPack':
    case 'subscription':
      return 'gold';
    default:
      return 'items';
  }
}

export interface PriceView {
  /** Main price text ("450 Bones", "650 GG (≈ $6.44)", "$4.99"). */
  main: string;
  currency: 'bones' | 'gg' | 'usd' | 'none';
  /** Real-money equivalent in cents (GG and USD prices; null for Bones). */
  cents: number | null;
}

export function priceView(sku: StoreSku, state: SkuState | null): PriceView {
  if (sku.priceBones !== undefined) {
    const amount = state?.priceBones ?? sku.priceBones;
    return { main: `${formatCount(amount)} Bones`, currency: 'bones', cents: null };
  }
  if (sku.priceGG !== undefined) return { main: ggLabel(sku.priceGG), currency: 'gg', cents: ggToCents(sku.priceGG) };
  if (sku.priceUsdCents !== undefined) return { main: sku.kind === 'subscription' ? `${formatUsd(sku.priceUsdCents)} / month` : formatUsd(sku.priceUsdCents), currency: 'usd', cents: sku.priceUsdCents };
  return { main: 'Included', currency: 'none', cents: null };
}

export function contentName(contentId: string): string {
  if (contentId === GG_CONTENT) return 'Grave Gold';
  if (contentId.startsWith('body:')) return `${SCULPTED_BODIES.find((b) => `body:${b.id}` === contentId)?.name ?? contentId} (cast body)`;
  return PHYSICAL_BY_ID[contentId]?.name ?? contentId.replace(/^[a-z]+:/, '').replace(/_/g, ' ');
}

export interface BundleView {
  lines: string[];
  parts: string | null;
  saving: string | null;
}

/** Contents + sum-of-parts for bundles (and any multi-item SKU). */
export function bundleView(sku: StoreSku): BundleView | null {
  if (sku.kind !== 'bundle' && sku.contents.length < 2) return null;
  const lines = sku.contents.map((c) => (c.contentId === GG_CONTENT ? `${formatCount(c.qty)} Grave Gold` : c.qty > 1 ? `${c.qty} × ${contentName(c.contentId)}` : contentName(c.contentId)));
  if (sku.kind !== 'bundle') return { lines, parts: null, saving: null };
  const p = sumOfParts(sku);
  const bits: string[] = [];
  if (p.bones > 0) bits.push(`${formatCount(p.bones)} Bones`);
  if (p.gg > 0) bits.push(ggLabel(p.gg));
  if (p.cents > 0) bits.push(`${formatUsd(p.cents)} of Grave Gold`);
  let saving: string | null = null;
  if (sku.priceBones !== undefined && p.bones > sku.priceBones) saving = `${formatCount(p.bones - sku.priceBones)} Bones`;
  else if (sku.priceGG !== undefined && p.gg > sku.priceGG) saving = ggLabel(p.gg - sku.priceGG);
  return { lines, parts: bits.length ? bits.join(' + ') : null, saving };
}

export function rateNote(): { pack: string; per100: string } {
  const r = baseRate();
  const pack = STORE_SKUS.find((s) => s.id === r.packId)?.title ?? 'base';
  return { pack, per100: formatUsd(Math.round(r.centsPerGG * 100)) };
}
