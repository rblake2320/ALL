/**
 * Store SKUs (docs/MONETIZATION.md §3, §8). Every SKU lists EXACTLY what the buyer gets — no randomness, ever.
 *
 * Currency rules: Bones SKUs (items, bodies, bundles) are unlocked locally from the profile ledger; anything priced in
 * Grave Gold or real money (priceGG / priceUsdCents) is server-only (Phase 4) and shows "Sign in to buy" in this
 * build. GG prices are always displayed with their real-money equivalent (src/economy/pricing.ts).
 */
import { CHILD_AGE_LIMIT } from '../shared/economy';
import type { StoreSku } from '../shared/economy';
import { CATALOG, BODY_PREFIX, PET_VARIANT_PREFIX } from './catalog';
import { PHYSICAL_BY_ID } from '../shared/catalog';
import { SCULPTED_BODIES } from '../shared/cast';

const ALL: StoreSku['platforms'] = ['web', 'steam', 'desktop'];
export const GG_CONTENT = 'currency:gg';

function objName(id: string): string {
  return PHYSICAL_BY_ID[id]?.name ?? id;
}
function bodyName(id: string): string {
  return SCULPTED_BODIES.find((b) => b.id === id)?.name ?? id;
}

/** One SKU per locked catalogue entry (bones → Bones price, premium → GG price). */
function catalogSkus(): StoreSku[] {
  const out: StoreSku[] = [];
  for (const e of CATALOG) {
    if (e.tier !== 'bones' && e.tier !== 'premium') continue;
    if (e.contentId.startsWith(PET_VARIANT_PREFIX)) {
      const species = e.contentId.slice(PET_VARIANT_PREFIX.length).replace(/^undead_/, '');
      out.push({
        id: e.contentId,
        kind: 'petVariant',
        title: `Undead ${species.charAt(0).toUpperCase()}${species.slice(1)}`,
        description: `A stitched, glowing-eyed ${species} for a pet of yours. Looks only; it needs the same care as any other.`,
        contents: [{ contentId: e.contentId, qty: 1 }],
        priceGG: e.priceGG,
        ageMin: CHILD_AGE_LIMIT,
        platforms: ALL,
      });
      continue;
    }
    const body = e.contentId.startsWith(BODY_PREFIX);
    const raw = body ? e.contentId.slice(BODY_PREFIX.length) : e.contentId;
    const desc = body ? (SCULPTED_BODIES.find((b) => b.id === raw)?.blurb ?? '') : (PHYSICAL_BY_ID[raw]?.description ?? '');
    out.push({
      id: `${body ? 'body' : 'item'}:${raw}`,
      kind: body ? 'body' : 'item',
      title: body ? bodyName(raw) : objName(raw),
      description: desc,
      contents: [{ contentId: e.contentId, qty: 1 }],
      ...(e.tier === 'bones' ? { priceBones: e.priceBones } : { priceGG: e.priceGG }),
      ageMin: e.tier === 'premium' ? CHILD_AGE_LIMIT : 0,
      platforms: ALL,
    });
  }
  return out;
}

const items = (...ids: string[]) => ids.map((contentId) => ({ contentId, qty: 1 }));

const BUNDLES: StoreSku[] = [
  {
    id: 'bundle:gothic_parlour',
    kind: 'bundle',
    title: 'Gothic Parlour',
    description: 'A velvet-and-candlelight sitting room for the discerning undead.',
    contents: items('sofa_velvet', 'table_wake', 'candelabra_drippy', 'window_gothic', 'painting_greatgrand'),
    priceBones: 980,
    ageMin: 0,
    platforms: ALL,
  },
  {
    id: 'bundle:arcade_den',
    kind: 'bundle',
    title: 'Arcade Den',
    description: 'Glowing screens, skull lamps and a high score nobody alive can beat.',
    contents: items('arcade_tombstone', 'tv_seance', 'lamp_skull', 'chair_ribcage'),
    priceBones: 1180,
    ageMin: 0,
    platforms: ALL,
  },
  {
    id: 'bundle:graveyard_garden',
    kind: 'bundle',
    title: 'Graveyard Garden',
    description: 'A themed yard set: funeral rug, headstone and a flickering lantern post.',
    contents: items('rug_funeral', 'headstone_decor', 'lantern_post'),
    priceGG: 600,
    ageMin: CHILD_AGE_LIMIT,
    platforms: ALL,
  },
  {
    id: 'bundle:starter_pack',
    kind: 'bundle',
    title: 'Starter Pack',
    description: 'Once per account: 1,000 Grave Gold, the Goldie cast body and a 6-item themed set.',
    contents: [
      { contentId: GG_CONTENT, qty: 1000 },
      { contentId: 'body:gold', qty: 1 },
      ...items('rug_funeral', 'headstone_decor', 'lantern_post', 'tv_seance', 'arcade_tombstone', 'lamp_skull'),
    ],
    priceUsdCents: 499,
    oncePerAccount: true,
    ageMin: CHILD_AGE_LIMIT,
    platforms: ALL,
  },
];

const BOOSTS: StoreSku[] = [
  { id: 'boost:career_xp', kind: 'boost', title: 'Overtime Spirit', description: 'Career XP ×1.25 for 7 game days. Convenience only — promotions still need the work.', contents: [{ contentId: 'boost:career_xp_125_7d', qty: 1 }], priceGG: 400, ageMin: CHILD_AGE_LIMIT, platforms: ALL },
  { id: 'boost:household_slot', kind: 'boost', title: 'Extra Household Slot', description: 'Room for one more saved household.', contents: [{ contentId: 'boost:household_slot', qty: 1 }], priceGG: 500, ageMin: CHILD_AGE_LIMIT, platforms: ALL },
  { id: 'boost:lot_slot', kind: 'boost', title: 'Extra Build Lot', description: 'One more lot slot for your builds.', contents: [{ contentId: 'boost:lot_slot', qty: 1 }], priceGG: 500, ageMin: CHILD_AGE_LIMIT, platforms: ALL },
  { id: 'boost:skip_night', kind: 'boost', title: 'Skip the Night', description: 'Jump straight to morning, once. Needs still change as if the night passed.', contents: [{ contentId: 'boost:skip_night', qty: 1 }], priceGG: 300, ageMin: CHILD_AGE_LIMIT, platforms: ALL },
];

const SEASON: StoreSku[] = [
  {
    id: 'season:lease_s1',
    kind: 'season',
    title: 'Season Lease: Season 1',
    description: '8-week premium track with themed quests and cosmetics. Every season item returns to the store later.',
    contents: [{ contentId: 'season:s1_premium_track', qty: 1 }],
    priceGG: 950,
    ageMin: CHILD_AGE_LIMIT,
    platforms: ALL,
  },
];

/** GG ladder, MONETIZATION.md §8 (bonus = GG beyond the 100-per-$1 base rate). */
const PACKS: StoreSku[] = [
  ['pocket_change', 'Pocket Change', 99, 100, 0],
  ['handful', 'Handful', 499, 510, 10],
  ['coffin_stash', 'Coffin Stash', 999, 1100, 100],
  ['crypt_hoard', 'Crypt Hoard', 1999, 2400, 400],
  ['mausoleum', 'Mausoleum', 4999, 6250, 1250],
  ['necropolis_vault', 'Necropolis Vault', 9999, 13000, 3000],
].map(([id, title, cents, gg, bonus]) => ({
  id: `gg:${id as string}`,
  kind: 'ggPack' as const,
  title: title as string,
  description: `${(gg as number).toLocaleString('en-US')} Grave Gold${(bonus as number) > 0 ? ` (includes ${(bonus as number).toLocaleString('en-US')} bonus)` : ''}.`,
  contents: [{ contentId: GG_CONTENT, qty: gg as number }],
  priceUsdCents: cents as number,
  ggAmount: gg as number,
  bonusGG: bonus as number,
  firstPurchaseDouble: true,
  ageMin: CHILD_AGE_LIMIT,
  platforms: ALL,
}));

const SUBS: StoreSku[] = [
  {
    id: 'sub:afterlife_plus',
    kind: 'subscription',
    title: 'Afterlife+',
    description: '$4.99 a month: 300 GG on purchase, then 30 GG each day you log in (up to 900 a month), +10 % GG on packs, one exclusive cosmetic a month and cloud saves. Cancel anytime.',
    contents: [{ contentId: GG_CONTENT, qty: 300 }, { contentId: 'sub:afterlife_plus_month', qty: 1 }],
    priceUsdCents: 499,
    ageMin: CHILD_AGE_LIMIT,
    platforms: ALL,
  },
];

export const STORE_SKUS: readonly StoreSku[] = Object.freeze([...catalogSkus(), ...BUNDLES, ...BOOSTS, ...SEASON, ...PACKS, ...SUBS]);

const SKU_BY_ID: ReadonlyMap<string, StoreSku> = new Map(STORE_SKUS.map((s) => [s.id, s]));
export function skuById(id: string): StoreSku | null {
  return SKU_BY_ID.get(id) ?? null;
}

/** Featured: the bundles plus the three priciest Bones items (a stable, non-personalised pick). */
export function featuredSkus(): StoreSku[] {
  const bones = STORE_SKUS.filter((s) => s.kind === 'item' && s.priceBones !== undefined).sort((a, b) => (b.priceBones ?? 0) - (a.priceBones ?? 0) || a.id.localeCompare(b.id));
  return [...STORE_SKUS.filter((s) => s.kind === 'bundle'), ...bones.slice(0, 3)];
}

/** Whether a SKU is inside its availability window at `nowMs` (undefined bounds = always). */
export function skuAvailable(s: StoreSku, nowMs: number): boolean {
  const from = s.availableFrom ? Date.parse(s.availableFrom) : -Infinity;
  const until = s.availableUntil ? Date.parse(s.availableUntil) : Infinity;
  return nowMs >= from && nowMs < until;
}
