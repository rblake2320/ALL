/**
 * ECONOMY CONTRACT (see docs/MONETIZATION.md — source of truth).
 * Household funds ($) live in the sim and are untouched here. Bones = profile-level earned currency.
 * Grave Gold (GG) = paid currency, server-authoritative only (never minted by a client build).
 */

export type Currency = 'bones' | 'gg';

export type CatalogTier = 'free' | 'bones' | 'premium' | 'sponsor';

/** Store pricing/entitlement metadata for any buyable content id (object def, cast body, bundle...). */
export interface CatalogEntry {
  /** Content id (ObjectDef id, CastBodyId as 'body:<id>', etc.). */
  contentId: string;
  tier: CatalogTier;
  priceBones?: number;
  priceGG?: number;
  /** BrandSkin id when tier === 'sponsor'. */
  brandSkin?: string;
}

export type SkuKind = 'item' | 'bundle' | 'body' | 'petVariant' | 'boost' | 'season' | 'ggPack' | 'subscription';

export interface StoreSku {
  id: string;
  kind: SkuKind;
  title: string;
  description: string;
  /** Exactly what the buyer receives (no randomness, ever). */
  contents: { contentId: string; qty: number }[];
  priceBones?: number;
  priceGG?: number;
  /** Real-money price (minor units, USD reference; localised at display time): GG packs and the few directly
   *  priced offers (Starter Pack, Afterlife+ subscription; MONETIZATION.md §8). Never set together with priceGG. */
  priceUsdCents?: number;
  /** GG granted by a ggPack. */
  ggAmount?: number;
  /** ISO dates; undefined = always. */
  availableFrom?: string;
  availableUntil?: string;
  /** Minimum age bracket allowed to buy. */
  ageMin: 0 | typeof CHILD_AGE_LIMIT | 18;
  platforms: ('web' | 'steam' | 'desktop')[];
  /** ggPack: GG included in ggAmount beyond the base rate (shown as "+10 %"); informational. */
  bonusGG?: number;
  /** ggPack: the first purchase of this tier grants double GG once per account (§8). */
  firstPurchaseDouble?: boolean;
  /** Can be bought once per account (Starter Pack). */
  oncePerAccount?: boolean;
}

/** Hash-chained, append-only profile ledger entry (corruption detection locally; server is the authority for GG). */
export interface LedgerEntry {
  seq: number;
  ts: string;
  kind: 'grant' | 'spend' | 'refund' | 'revoke';
  currency: Currency;
  /** Positive integer. Direction comes from kind. */
  amount: number;
  /** Idempotency key: grants by grantId, spends by sku+nonce. Duplicate keys are rejected. */
  key: string;
  reason: string;
  /** Entitlements unlocked by this entry (spend) or removed (revoke). */
  entitlements?: string[];
  prevHash: string;
  hash: string;
}

/**
 * Provenance of a ledger/wallet view (security review 2026-11-05, M-1). The local Bones ledger is an UNKEYED hash
 * chain (a client cannot keep a secret), so everything derived from it is 'local-unverified' — fine for offline play,
 * never authoritative: the future server ledger (W-096/W-099) must not import a local balance or entitlement as
 * truth. 'server-verified' is reserved for data the server signed; no code path produces it offline.
 */
export type LedgerTrust = 'local-unverified' | 'server-verified';

export interface WalletView {
  /** Where the Bones balance / local entitlements come from (always 'local-unverified' offline). */
  trust: LedgerTrust;
  bones: number;
  /** Server-reported; null when signed out/offline. */
  gg: number | null;
  entitlements: ReadonlySet<string>;
  ledgerOk: boolean;
}

/**
 * First age (years) that is no longer a child profile. Owner decision 2026-11-11: 15 (it was 13). Stricter than the
 * legal floor of 13, never looser. The child bracket keeps its stored id 'under13' (sealed age records, feedback
 * reports and session logs carry it; '13plus' likewise): the id is a legacy name, the limit is this constant.
 */
export const CHILD_AGE_LIMIT = 15;

export type AgeBracket = 'under13' | 'teen' | 'adult' | 'unknown';

export interface QuestRewardGrant {
  /** World grant id `<worldId>:<questId>:<instance>` (worldId = QuestsState.worldId — SAVE data, so it is never the
   *  ledger key on its own: src/economy/grantPolicy.ts maps it to a profile-scoped key — MONETIZATION.md §2). */
  grantId: string;
  bones: number;
  entitlements?: string[];
  reason: string;
}

/** Brand skin applied to an object's brand slots. Only original house brands unless a license is on file. */
export interface BrandSkin {
  id: string;
  brand: string;
  /** True only for real third-party marks with a signed license (docs/SPONSORSHIP.md). */
  licensed: boolean;
  appliesTo: string[];
  displayName: string;
  flavorText: string;
  livery?: Record<string, string>;
  /** Decal texture paths relative to the pack root. */
  decals?: Record<string, string>;
  enabled: boolean;
}

/** Placeholder for in-world ad surfaces (TV, billboard...). Phase 2 serves house-brand creatives only. */
export interface AdSurfaceCreative {
  id: string;
  surface: 'tv' | 'billboard' | 'magazine' | 'busStop';
  brand: string;
  image: string;
  /** Never shown to the child bracket; never personalised. */
  ageMin: 0 | typeof CHILD_AGE_LIMIT;
}

export const GG_PER_USD_REFERENCE = 100; // 100 GG ≈ $1.00 at the base pack rate (display equivalence)

/**
 * The ONE grammar for entitlement ids (catalogue ids like `sofa_velvet`, `body:<id>`, `cosmetic:<id>`, `boost:<id>`):
 * lowercase snake_case, at most one `namespace:` prefix. Shared by the sim's quest-content validator and the economy
 * ledger, so content that validates can always be stored (an id outside it would be silently dropped by the ledger).
 */
export const ENTITLEMENT_ID_RE = /^[a-z0-9_]+(?::[a-z0-9_]+)?$/;
