import { CHILD_AGE_LIMIT } from '../../../src/shared/economy';
import { describe, expect, it } from 'vitest';
import { PHYSICAL_SPECS, BUY_CATEGORIES } from '../../../src/shared/catalog';
import { CAST_BODY_IDS } from '../../../src/shared/cast';
import { loadContent } from '../../../src/sim/index';
import { CATALOG, BUYABLE_OBJECT_IDS, buyLockFor, catalogEntry, isUsable, BODY_UNLOCKS_LIVE } from '../../../src/economy/catalog';
import { STORE_SKUS, skuById, featuredSkus } from '../../../src/economy/skus';
import { baseRate, bonesPriceFor, exactTopUp, ggLabel, ggToCents, sumOfParts } from '../../../src/economy/pricing';
import { HOUSE_BRAND_SKINS } from '../../../src/economy/brands';
import { GG_PER_USD_REFERENCE } from '../../../src/shared/economy';

const buyable = PHYSICAL_SPECS.filter((s) => s.buyable);

describe('catalogue tiers', () => {
  it('covers every buyable object def (incl. every sim ObjectDef that is buyable) and every cast body exactly once', () => {
    const ids = CATALOG.map((e) => e.contentId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of buyable) expect(ids).toContain(s.id);
    for (const b of CAST_BODY_IDS) expect(ids).toContain(`body:${b}`);
    const content = loadContent();
    for (const [id, def] of Object.entries(content.objects)) if ((def as { buyable?: boolean }).buyable) expect(ids, id).toContain(id);
  });

  it('distribution: mostly free, ≈30 % bones, a handful premium, sponsors carry a house-brand skin', () => {
    const objs = CATALOG.filter((e) => !e.contentId.startsWith('body:') && !e.contentId.startsWith('petvariant:'));
    const n = (t: string) => objs.filter((e) => e.tier === t).length;
    expect(n('bones') / objs.length).toBeGreaterThan(0.25);
    expect(n('bones') / objs.length).toBeLessThan(0.35);
    expect(n('premium')).toBeGreaterThanOrEqual(3);
    expect(n('premium')).toBeLessThanOrEqual(8);
    expect(n('free') + n('sponsor')).toBeGreaterThan(objs.length / 2);
    for (const e of objs.filter((x) => x.tier === 'sponsor')) {
      const skin = HOUSE_BRAND_SKINS.find((s) => s.id === e.brandSkin);
      expect(skin, e.contentId).toBeDefined();
      expect(skin!.appliesTo).toContain(e.contentId);
    }
    for (const e of CATALOG) {
      if (e.tier === 'bones') expect(Number.isInteger(e.priceBones) && e.priceBones! > 0).toBe(true);
      if (e.tier === 'premium') expect(Number.isInteger(e.priceGG) && e.priceGG! > 0).toBe(true);
      if (e.tier === 'free' || e.tier === 'sponsor') expect(e.priceBones ?? e.priceGG).toBeUndefined();
    }
  });

  it('never paywalls survival: the cheapest item of every category, and every need-critical object, is free', () => {
    for (const c of BUY_CATEGORIES) {
      const inCat = buyable.filter((s) => s.category === c.id).sort((a, b) => a.price - b.price);
      if (inCat.length === 0) continue;
      const t = catalogEntry(inCat[0].id).tier;
      expect(t === 'free' || t === 'sponsor', `${c.id}: ${inCat[0].id}`).toBe(true);
    }
    for (const id of ['fridge_humming', 'stove_greasefire', 'sink_rusty', 'shower_drizzle', 'coffin_pine', 'bed_normal', 'plot_budget', 'door_splintered', 'window_grimy', 'mailbox_crooked', 'trash_lidded', 'chair_creaky', 'table_rickety']) {
      expect(isUsable(id, new Set()), id).toBe(true);
    }
    // premium items are cosmetic only: no slots a zombie needs (no sit/lie/bath, no interactions beyond admire)
    for (const e of CATALOG.filter((x) => x.tier === 'premium' && !x.contentId.startsWith('body:') && !x.contentId.startsWith('petvariant:'))) {
      const spec = PHYSICAL_SPECS.find((s) => s.id === e.contentId)!;
      expect(spec.slots.filter((s) => s.kind !== 'stand').length, e.contentId).toBe(0);
    }
  });

  it('buy-mode locks: bones items locked with price until entitled, premium hidden, free open; unknown ids are free', () => {
    const none = new Set<string>();
    expect(buyLockFor('sofa_velvet', none)).toEqual({ state: 'locked', priceBones: catalogEntry('sofa_velvet').priceBones });
    expect(buyLockFor('rug_funeral', none)).toEqual({ state: 'hidden' });
    expect(buyLockFor('chair_creaky', none)).toEqual({ state: 'open' });
    expect(buyLockFor('sofa_velvet', new Set(['sofa_velvet']))).toEqual({ state: 'open' });
    expect(buyLockFor('some_future_object', none)).toEqual({ state: 'open' });
    expect(BODY_UNLOCKS_LIVE ? true : isUsable('body:boss', none)).toBe(true);
  });
});

describe('store SKUs + price transparency', () => {
  it('no paid randomness: every SKU lists exact, positive contents', () => {
    for (const s of STORE_SKUS) {
      expect(s.contents.length, s.id).toBeGreaterThan(0);
      for (const c of s.contents) expect(Number.isInteger(c.qty) && c.qty > 0, s.id).toBe(true);
      expect(/random|mystery|loot|gacha|chance/i.test(`${s.title} ${s.description}`), s.id).toBe(false);
    }
  });

  it('every SKU has exactly one price kind; GG/real money is age-gated at the child age limit or above', () => {
    for (const s of STORE_SKUS) {
      const kinds = [s.priceBones, s.priceGG, s.priceUsdCents].filter((x) => x !== undefined);
      expect(kinds.length, s.id).toBe(1);
      if (s.priceGG !== undefined || s.priceUsdCents !== undefined) expect(s.ageMin, s.id).toBeGreaterThanOrEqual(CHILD_AGE_LIMIT);
      expect(s.platforms).toEqual(expect.arrayContaining(['web', 'steam']));
    }
  });

  it('GG ladder matches docs/MONETIZATION.md §8 exactly', () => {
    const packs = STORE_SKUS.filter((s) => s.kind === 'ggPack').map((s) => [s.title, s.priceUsdCents, s.ggAmount]);
    expect(packs).toEqual([
      ['Pocket Change', 99, 100],
      ['Handful', 499, 510],
      ['Coffin Stash', 999, 1100],
      ['Crypt Hoard', 1999, 2400],
      ['Mausoleum', 4999, 6250],
      ['Necropolis Vault', 9999, 13000],
    ]);
    expect(skuById('season:lease_s1')!.priceGG).toBe(950);
    expect(skuById('bundle:starter_pack')!.priceUsdCents).toBe(499);
    expect(skuById('sub:afterlife_plus')!.priceUsdCents).toBe(499);
    for (const s of STORE_SKUS.filter((x) => x.kind === 'boost')) expect(s.priceGG! >= 300 && s.priceGG! <= 700).toBe(true);
  });

  it('real-money equivalent uses the CHEAPEST pack rate (least flattering) and no hidden costs', () => {
    const r = baseRate();
    expect(r.packId).toBe('gg:pocket_change');
    expect(r.centsPerGG).toBeCloseTo(0.99);
    // §1 rule = the cheapest pack's rate. Every bonus tier (incl. Handful 510 GG, D-026) is at least as good per GG;
    // the ladder never gets worse per GG with a bigger pack.
    for (const p of STORE_SKUS.filter((x) => x.kind === 'ggPack' && (x.bonusGG ?? 0) > 0)) expect(r.centsPerGG).toBeGreaterThan(p.priceUsdCents! / p.ggAmount!);
    expect(ggToCents(950)).toBe(941);
    expect(ggLabel(650)).toBe('650 GG (≈ $6.44)');
    expect(GG_PER_USD_REFERENCE).toBe(100);
    for (const bad of [NaN, -5, 0]) expect(ggToCents(bad)).toBe(0);
  });

  it('bundles show sum-of-parts, are cheaper than the parts, and never charge for owned parts', () => {
    for (const b of STORE_SKUS.filter((s) => s.kind === 'bundle' && s.priceBones !== undefined)) {
      const parts = sumOfParts(b);
      expect(parts.unpriced).toEqual([]);
      expect(b.priceBones!).toBeLessThan(parts.bones);
      expect(bonesPriceFor(b, new Set())).toBe(b.priceBones);
      const first = b.contents[0].contentId;
      const partial = bonesPriceFor(b, new Set([first]));
      expect(partial).toBeLessThan(b.priceBones!);
      expect(partial).toBeGreaterThan(0);
      expect(bonesPriceFor(b, new Set(b.contents.map((c) => c.contentId)))).toBe(0);
    }
    const gg = skuById('bundle:graveyard_garden')!;
    expect(gg.priceGG!).toBeLessThan(sumOfParts(gg).gg);
  });

  it('exact top-up covers precisely the shortfall', () => {
    const t = exactTopUp(800, 950)!;
    expect(t.shortGG).toBe(150);
    expect(t.exactCents).toBe(149);
    expect(t.pack?.id).toBe('gg:handful');
    expect(exactTopUp(1000, 950)).toBeNull();
    expect(exactTopUp(NaN, 100)!.shortGG).toBe(100);
  });

  it('featured list is stable and only real SKUs', () => {
    const f = featuredSkus().map((s) => s.id);
    expect(f).toEqual(featuredSkus().map((s) => s.id));
    for (const id of f) expect(skuById(id)).not.toBeNull();
  });
});
