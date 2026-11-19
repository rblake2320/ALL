/**
 * House-brand sponsor skins + in-world ad creatives (docs/MONETIZATION.md §4). DATA + a pure resolver.
 *
 * Launch set = ORIGINAL house brands only (no real trademark without a signed license — docs/IP_NOTES.md). The data
 * lives in data/houseBrands.json so scripts/build-pack.mjs can package the same list as the signed first-party
 * `house-brands` content pack. Rendering of brand decals/livery is owned by RENDER (deferred): the hook it needs is
 * documented in docs/contract-requests/economy.md — it calls `brandSkinFor(objectDefId)` and fills the object's
 * brand slots from the returned skin (or renders the unbranded model when it returns null).
 *
 * Kill switch: `setBrandsEnabled(false)` (remote config later) disables every skin and creative at once; each skin also
 * has its own `enabled` flag. Licensed (`licensed: true`) skins are refused until a license registry exists — so a
 * pack can never smuggle a real mark in by flipping a flag.
 */
import { CHILD_AGE_LIMIT } from '../shared/economy';
import type { AdSurfaceCreative, AgeBracket, BrandSkin } from '../shared/economy';
import data from './data/houseBrands.json';

/** Display names of the approved house brands (anything else is rejected from packs and the resolver). */
export const HOUSE_BRANDS: readonly string[] = ['Mulch Master', 'Grave-Cola', 'Volt-Hearse', 'Brain Bran', 'Rot-Pop', 'Coffin Coffee', 'Crypt-Kicks', 'Necro-Tech'];

export const HOUSE_BRAND_SKINS: readonly BrandSkin[] = Object.freeze((data.brandSkins as BrandSkin[]).map((s) => Object.freeze({ ...s })));
export const HOUSE_AD_CREATIVES: readonly AdSurfaceCreative[] = Object.freeze((data.adCreatives as AdSurfaceCreative[]).map((c) => Object.freeze({ ...c })));
export const BRAND_COLORS: Readonly<Record<string, readonly [string, string]>> = data.colors as unknown as Record<string, [string, string]>;

let brandsEnabled = true;
/** Extra skins registered by verified content packs (see src/packs/registry.ts). Later registrations win. */
let extraSkins: readonly BrandSkin[] = [];
const disabledSkins = new Set<string>();

/** Global kill switch (remote config / support tooling). */
export function setBrandsEnabled(on: boolean): void {
  brandsEnabled = on === true;
}
export function brandsAreEnabled(): boolean {
  return brandsEnabled;
}
/** Per-skin kill switch (overrides the skin's own `enabled`). */
export function setBrandSkinDisabled(id: string, disabled: boolean): void {
  if (disabled) disabledSkins.add(id);
  else disabledSkins.delete(id);
}
/** Replace the pack-provided skins (all-or-nothing, called by the pack registry). */
export function setPackBrandSkins(skins: readonly BrandSkin[]): void {
  extraSkins = Object.freeze(skins.map((s) => Object.freeze({ ...s })));
}

/** True when a skin may be shown at all: enabled, not killed, original house brand, not a (unlicensed-on-file) real mark. */
export function skinUsable(s: BrandSkin): boolean {
  return brandsEnabled && s.enabled === true && !disabledSkins.has(s.id) && s.licensed === false && HOUSE_BRANDS.includes(s.brand);
}

export function allBrandSkins(): readonly BrandSkin[] {
  return [...HOUSE_BRAND_SKINS, ...extraSkins];
}

/**
 * The brand skin to apply to an object def (or env model) — the RENDER hook. Pure given the registry state; returns
 * null when brands are off, the skin is disabled, or nothing applies. With several candidates, pack skins win over the
 * built-in list (last registered first), so a content pack can re-skin without code changes.
 */
export function brandSkinFor(objectDefId: string, skins: readonly BrandSkin[] = allBrandSkins()): BrandSkin | null {
  if (typeof objectDefId !== 'string' || !objectDefId) return null;
  for (let i = skins.length - 1; i >= 0; i--) {
    const s = skins[i];
    if (s.appliesTo.includes(objectDefId) && skinUsable(s)) return s;
  }
  return null;
}

/** House-brand creatives for an in-world ad surface. Never for under-13 beyond ageMin 0; never personalised. */
export function adCreativesFor(surface: AdSurfaceCreative['surface'], bracket: AgeBracket): AdSurfaceCreative[] {
  if (!brandsEnabled) return [];
  const minAge = bracket === 'adult' ? 18 : bracket === 'teen' ? CHILD_AGE_LIMIT : 0;
  return HOUSE_AD_CREATIVES.filter((c) => c.surface === surface && c.ageMin <= minAge && HOUSE_BRANDS.includes(c.brand));
}
