/**
 * Catalogue tiers (docs/MONETIZATION.md §3) for every buyable ObjectDef and every cast body ('body:<id>').
 *
 * Design rules encoded here (and asserted in tests/unit/economy/catalog.test.ts):
 *  - Every object a household NEEDS to survive (fridge, stove, sink, shower, coffin/bed, toilet-equivalents, doors,
 *    windows, the cheapest item of each category) stays FREE — locks are on cosmetic or "nicer variant" items only,
 *    so neither Bones nor real money ever decides whether a household survives (the sim balance never sees tiers).
 *  - ≈30 % of buyable objects are `bones` (earned currency), a handful `premium` (GG), sponsor items are free with a
 *    house-brand skin. Unlocks are entitlements; placing an unlocked item still costs household $ at its sim price.
 *  - Default for anything not listed (new content added later): `free` — never accidentally paywalled.
 *
 * Kit bodies remain free while unlocks are unavailable. Premium bodies require a profile entitlement;
 * the store still says "coming soon" until body purchases are enabled.
 */
import type { CatalogEntry, CatalogTier } from '../shared/economy';
import { CAST_BODY_IDS } from '../shared/cast';
import { isPremiumBodyId, PREMIUM_BODY_IDS } from '../shared/premiumBodies';
import { PHYSICAL_SPECS } from '../shared/catalog';

/** Flip when CAZ enforces body entitlements (contract request E3). */
export const BODY_UNLOCKS_LIVE = false;

export const BODY_PREFIX = 'body:';

/**
 * Undead pet looks (docs/DESIGN_SURVIVAL_PETS_SAVES.md §3: "undead-style variants (stitched cat, glowing-eyed dog) via
 * the store"): one premium (Grave Gold) unlock per species, cosmetic only. Like the premium cast bodies they are
 * declared and shown in the store as "coming soon" until `PET_VARIANTS_LIVE`; unlike the bodies they are NOT usable
 * for free meanwhile: a pet wears the undead look only with the entitlement (`isUsable`).
 */
export const PET_VARIANT_PREFIX = 'petvariant:';
export const PET_VARIANT_SPECIES = ['cat', 'dog', 'raccoon', 'crow'] as const;
export const PET_VARIANT_PRICE_GG = 400;
/** Flip when the undead pet looks are sold (needs the server wallet, like every Grave Gold unlock). */
export const PET_VARIANTS_LIVE = false;
/** The content id of the undead look of a pet species. */
export const petVariantId = (species: string): string => `${PET_VARIANT_PREFIX}undead_${species}`;

const BONES: Record<string, number> = {
  chair_ribcage: 120,
  sofa_velvet: 450,
  table_wake: 260,
  table_coffinlid: 140,
  counter_slab: 220,
  stove_necrochef: 600,
  tv_seance: 650,
  arcade_tombstone: 500,
  plant_carnivorous: 160,
  painting_greatgrand: 180,
  lamp_skull: 140,
  candelabra_drippy: 30, // the "first unlock": affordable with the first story quest's reward
  door_crypt: 300,
  window_gothic: 220,
  tree_gnarled: 200,
  rug_rag: 80,
  pew_salvaged: 260,
};

/** Premium (Grave Gold) items — cosmetic only. GG bands per §8 (small decor 150–300, furniture 300–600). */
const PREMIUM: Record<string, number> = {
  rug_funeral: 250,
  headstone_decor: 200,
  lantern_post: 300,
};

/** Sponsor items: free, carry a house-brand skin (ids in data/houseBrands.json). */
const SPONSOR: Record<string, string> = {
  fridge_humming: 'grave_cola_fridge',
  espresso_embalmer: 'coffin_coffee_espresso',
  desk_hauntedpc: 'necro_tech_pc',
};

const BODY_BONES: Record<string, number> = { boss: 600, strongman: 600, ringmaster: 700, fortune: 600, mascot: 700, clown: 400 };
/**
 * Premium bodies (src/shared/premiumBodies.ts) are Grave Gold only: the realistic tier above the cast kit. 1,200 GG,
 * above the 500-800 band of a premium cast body (MONETIZATION §8). Owner, 2026-11-11: the seat sets the number; it
 * can change later.
 */
const PREMIUM_BODY_GG = 1200;
const BODY_PREMIUM: Record<string, number> = {
  gold: 650,
  ...Object.fromEntries(PREMIUM_BODY_IDS.map((id) => [id, PREMIUM_BODY_GG])),
};

export const BUYABLE_OBJECT_IDS: readonly string[] = PHYSICAL_SPECS.filter((s) => s.buyable).map((s) => s.id);

function objectEntry(id: string): CatalogEntry {
  if (id in BONES) return { contentId: id, tier: 'bones', priceBones: BONES[id] };
  if (id in PREMIUM) return { contentId: id, tier: 'premium', priceGG: PREMIUM[id] };
  if (id in SPONSOR) return { contentId: id, tier: 'sponsor', brandSkin: SPONSOR[id] };
  return { contentId: id, tier: 'free' };
}

function bodyEntry(id: string): CatalogEntry {
  const contentId = `${BODY_PREFIX}${id}`;
  if (id in BODY_BONES) return { contentId, tier: 'bones', priceBones: BODY_BONES[id] };
  if (id in BODY_PREMIUM) return { contentId, tier: 'premium', priceGG: BODY_PREMIUM[id] };
  return { contentId, tier: 'free' };
}

const petVariantEntry = (species: string): CatalogEntry => ({ contentId: petVariantId(species), tier: 'premium', priceGG: PET_VARIANT_PRICE_GG });

export const CATALOG: readonly CatalogEntry[] = Object.freeze([
  ...BUYABLE_OBJECT_IDS.map(objectEntry),
  ...CAST_BODY_IDS.map(bodyEntry),
  ...PET_VARIANT_SPECIES.map(petVariantEntry),
  ...PREMIUM_BODY_IDS.map(bodyEntry),
].map((e) => Object.freeze(e)));

const BY_ID: ReadonlyMap<string, CatalogEntry> = new Map(CATALOG.map((e) => [e.contentId, e]));

/** Catalogue entry for a content id; unknown ids are free (new content is never paywalled by accident). */
export function catalogEntry(contentId: string): CatalogEntry {
  return BY_ID.get(contentId) ?? { contentId, tier: 'free' };
}

export function tierOf(contentId: string): CatalogTier {
  return catalogEntry(contentId).tier;
}

/** Whether the player may use this content now (kit bodies remain free; premium bodies require entitlement). */
export function isUsable(contentId: string, entitlements: ReadonlySet<string>): boolean {
  if (contentId.startsWith(BODY_PREFIX)) {
    const id = contentId.slice(BODY_PREFIX.length);
    if (isPremiumBodyId(id)) return entitlements.has(contentId);
    return true;
  }
  const t = tierOf(contentId);
  return t === 'free' || t === 'sponsor' || entitlements.has(contentId);
}

export type BuyLock = { state: 'open' } | { state: 'locked'; priceBones: number } | { state: 'hidden' };

/**
 * How Buy mode shows an object: `open` (buyable for household $), `locked` (Bones tier, not yet unlocked: shown with
 * a lock + Bones price, clicking opens the store), `hidden` (premium, not entitled: not listed at all).
 */
export function buyLockFor(defId: string, entitlements: ReadonlySet<string>): BuyLock {
  if (isUsable(defId, entitlements)) return { state: 'open' };
  const e = catalogEntry(defId);
  if (e.tier === 'bones') return { state: 'locked', priceBones: e.priceBones ?? 0 };
  return { state: 'hidden' };
}
