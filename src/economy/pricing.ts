/**
 * Price transparency (docs/MONETIZATION.md §1, §8): every GG price is shown with its real-money equivalent computed
 * from the CHEAPEST GG pack's rate (the least favourable per-GG rate the player can actually buy — never a flattering
 * bulk rate), bundles show the sum of their parts, and a short balance is offered an exact top-up.
 * Pure functions; formatting via Intl (USD reference until Phase 4 localises store prices).
 */
import type { StoreSku } from '../shared/economy';
import { STORE_SKUS, skuById, GG_CONTENT } from './skus';
import { catalogEntry } from './catalog';
import { ENTITLEMENT_RE } from './ledger';

export interface Rate {
  /** US cents per 1 GG. */
  centsPerGG: number;
  packId: string;
}

/** Rate of the cheapest GG pack (lowest real-money price). */
export function baseRate(skus: readonly StoreSku[] = STORE_SKUS): Rate {
  let best: StoreSku | null = null;
  for (const s of skus) {
    if (s.kind !== 'ggPack' || !s.priceUsdCents || !s.ggAmount) continue;
    if (!best || s.priceUsdCents < (best.priceUsdCents ?? Infinity)) best = s;
  }
  if (!best) return { centsPerGG: 1, packId: '' };
  return { centsPerGG: (best.priceUsdCents ?? 0) / (best.ggAmount ?? 1), packId: best.id };
}

/** Real-money equivalent of a GG amount, in US cents (rounded half up to whole cents). */
export function ggToCents(gg: number, rate: Rate = baseRate()): number {
  if (!Number.isFinite(gg) || gg <= 0) return 0;
  return Math.round(gg * rate.centsPerGG);
}

export function formatUsd(cents: number, locale = 'en-US'): string {
  const v = Number.isFinite(cents) ? cents / 100 : 0;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

export function formatCount(n: number, locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale).format(Number.isFinite(n) ? n : 0);
  } catch {
    return String(n);
  }
}

/** "650 GG (≈ $6.44)" — the only way a GG price is ever rendered. */
export function ggLabel(gg: number, locale = 'en-US'): string {
  return `${formatCount(gg, locale)} GG (≈ ${formatUsd(ggToCents(gg), locale)})`;
}

export interface PartsSum {
  bones: number;
  gg: number;
  /** Real-money parts (e.g. the GG inside a Starter Pack, valued at the base rate), cents. */
  cents: number;
  /** Content ids whose individual price is unknown (not sold separately). */
  unpriced: string[];
}

/** Sum of the separately-sold prices of a bundle's contents. */
export function sumOfParts(sku: StoreSku): PartsSum {
  const out: PartsSum = { bones: 0, gg: 0, cents: 0, unpriced: [] };
  for (const c of sku.contents) {
    if (c.contentId === GG_CONTENT) {
      out.cents += ggToCents(c.qty);
      continue;
    }
    const e = catalogEntry(c.contentId);
    if (e.priceBones) out.bones += e.priceBones * c.qty;
    else if (e.priceGG) out.gg += e.priceGG * c.qty;
    else out.unpriced.push(c.contentId);
  }
  return out;
}

/** Entitlement ids a SKU grants (currency/perk contents excluded). */
export function skuEntitlements(sku: StoreSku): string[] {
  return sku.contents.map((c) => c.contentId).filter((id) => id !== GG_CONTENT && ENTITLEMENT_RE.test(id));
}

/**
 * Bones price for a Bones SKU given what the player already owns: a bundle never charges for parts you have —
 * price × (unowned parts' value / all parts' value), rounded up. Returns 0 when everything is owned.
 */
export function bonesPriceFor(sku: StoreSku, owned: ReadonlySet<string>): number {
  const price = sku.priceBones ?? 0;
  if (sku.kind !== 'bundle') return skuEntitlements(sku).every((e) => owned.has(e)) ? 0 : price;
  let all = 0;
  let unowned = 0;
  for (const c of sku.contents) {
    const v = (catalogEntry(c.contentId).priceBones ?? 0) * c.qty;
    all += v;
    if (!owned.has(c.contentId)) unowned += v;
  }
  if (all <= 0) return price;
  if (unowned <= 0) return 0;
  return Math.ceil((price * unowned) / all);
}

export interface TopUp {
  shortGG: number;
  /** Exact top-up of the shortfall at the base rate (no forced leftovers), cents. */
  exactCents: number;
  /** Smallest pack that covers the shortfall, if any. */
  pack: StoreSku | null;
}

/** Offered when a GG balance is short of a price (§8 "exact top-up"). */
export function exactTopUp(balanceGG: number, priceGG: number): TopUp | null {
  const bal = Number.isFinite(balanceGG) && balanceGG > 0 ? Math.floor(balanceGG) : 0;
  const short = Math.max(0, Math.ceil(priceGG) - bal);
  if (short <= 0) return null;
  const packs = STORE_SKUS.filter((s) => s.kind === 'ggPack' && (s.ggAmount ?? 0) >= short).sort((a, b) => (a.priceUsdCents ?? 0) - (b.priceUsdCents ?? 0));
  return { shortGG: short, exactCents: Math.ceil(short * baseRate().centsPerGG), pack: packs[0] ?? null };
}

export { skuById };
