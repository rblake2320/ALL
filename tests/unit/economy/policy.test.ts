import { describe, expect, it, vi } from 'vitest';
import { CHILD_AGE_LIMIT } from '../../../src/shared/economy';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { sha256Hex } from '../../../src/persistence/sha256';
import { st } from '../../../src/ui/store/strings';
import { AGE_POLICY, resolveStoredAge, sealAgeProfile } from '../../../src/economy/age';
import { DEFAULT_AGE_PROFILE, bracketForAge, ageFromBirthYear, answerAgeGate, bonesBlock, realMoneyBlock, rewardedAdAllowed, sanitizeAgeProfile, setSpendCap, REWARDED_ADS_PER_DAY, MAX_TEEN_CAP_CENTS } from '../../../src/economy/age';
import { Analytics, scrub, type AnalyticsEvent } from '../../../src/economy/analytics';
import { HOUSE_BRANDS, HOUSE_BRAND_SKINS, HOUSE_AD_CREATIVES, adCreativesFor, brandSkinFor, setBrandSkinDisabled, setBrandsEnabled, setPackBrandSkins } from '../../../src/economy/brands';
import { skuById } from '../../../src/economy/skus';

const NOW = new Date('2026-11-05T12:00:00Z');

describe('child age limit (owner 2026-11-11: 15, was 13)', () => {
  const NOW_ = new Date('2026-06-15T12:00:00Z');
  it('is 15, and the bracket turns exactly there', () => {
    expect(CHILD_AGE_LIMIT).toBe(15);
    expect(bracketForAge(0)).toBe('under13');
    expect(bracketForAge(12)).toBe('under13');
    expect(bracketForAge(13)).toBe('under13'); // was teen before the change
    expect(bracketForAge(14)).toBe('under13');
    expect(bracketForAge(15)).toBe('teen');
    expect(bracketForAge(17)).toBe('teen');
    expect(bracketForAge(18)).toBe('adult');
  });
  it('a 13- or 14-year-old gets the child protections; a 15-year-old does not', () => {
    const at = (year: number) => {
      const r = answerAgeGate(DEFAULT_AGE_PROFILE, year, NOW_);
      if (!r.ok) throw new Error('age gate refused a valid year');
      return r.profile;
    };
    const sku = skuById('bundle:starter_pack');
    if (!sku) throw new Error('bundle:starter_pack is gone: pick another real-money SKU for this test');
    for (const year of [2013, 2012, 2011]) { // conservative ages 12, 13, 14
      const p = at(year);
      expect(p.bracket, String(year)).toBe('under13');
      expect(p.spendCapCents).toBe(0);
      expect(rewardedAdAllowed(p, 0)).toBe(false);
      expect(realMoneyBlock(sku, p, true)).toBe('under13');
    }
    const teen = at(2010); // conservative age 15
    expect(teen.bracket).toBe('teen');
    expect(rewardedAdAllowed(teen, 0)).toBe(true);
    expect(realMoneyBlock(sku, teen, true)).not.toBe('under13');
  });
  it('no SKU or ad creative still names 13', () => {
    for (const c of HOUSE_AD_CREATIVES) expect([0, CHILD_AGE_LIMIT]).toContain(c.ageMin);
    for (const surface of ['tv', 'billboard', 'magazine', 'busStop'] as const) {
      expect(adCreativesFor(surface, 'under13').every((c) => c.ageMin === 0)).toBe(true);
    }
  });
});

describe('age gate (neutral, bracket only, conservative, no bypass)', () => {
  it('computes age conservatively from the year alone', () => {
    expect(ageFromBirthYear(2013, NOW)).toBe(12); // might already be 13 — treated as 12
    expect(ageFromBirthYear(2012, NOW)).toBe(13);
    expect(ageFromBirthYear('2008', NOW)).toBe(17);
    expect(ageFromBirthYear(2007, NOW)).toBe(18);
  });

  it('rejects junk years', () => {
    for (const y of [NaN, 2027, 1899, 2010.5, '20x0', '', null, undefined, {}, '1e3', ' 2000 1']) expect(ageFromBirthYear(y, NOW)).toBeNull();
    expect(answerAgeGate(DEFAULT_AGE_PROFILE, 'abc', NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('stores only the bracket (no year of birth anywhere in the profile)', () => {
    const r = answerAgeGate(DEFAULT_AGE_PROFILE, 1990, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.bracket).toBe('adult');
    expect(JSON.stringify(r.profile)).not.toContain('1990');
  });

  it('bypass: once answered, a later answer may only move YOUNGER, never older', () => {
    const kid = answerAgeGate(DEFAULT_AGE_PROFILE, 2016, NOW);
    expect(kid.ok && kid.profile.bracket).toBe('under13');
    if (!kid.ok) return;
    expect(answerAgeGate(kid.profile, 1980, NOW)).toEqual({ ok: false, reason: 'locked' });
    const teen = answerAgeGate(DEFAULT_AGE_PROFILE, 2010, NOW);
    if (!teen.ok) throw new Error();
    expect(answerAgeGate(teen.profile, 1990, NOW)).toEqual({ ok: false, reason: 'locked' });
    const down = answerAgeGate(teen.profile, 2016, NOW);
    expect(down.ok && down.profile.bracket).toBe('under13');
  });

  it('bypass: tampered stored profiles never gain privileges', () => {
    // Damaged data fails CLOSED to the youngest bracket (security review D-2); asking again would allow any bracket.
    expect(sanitizeAgeProfile({ bracket: 'adult' }).bracket).toBe('under13'); // no decision time
    expect(sanitizeAgeProfile({ bracket: 'god', decidedAt: NOW.toISOString() }).bracket).toBe('under13');
    expect(sanitizeAgeProfile({ bracket: 'under13', decidedAt: NOW.toISOString(), spendCapCents: 99999 }).spendCapCents).toBe(0);
    expect(sanitizeAgeProfile({ bracket: 'teen', decidedAt: NOW.toISOString(), spendCapCents: 1e12 }).spendCapCents).toBe(MAX_TEEN_CAP_CENTS);
    expect(sanitizeAgeProfile(null).bracket).toBe('unknown'); // nothing stored = fresh
    for (const junk of [1, 'x', []]) expect(sanitizeAgeProfile(junk).bracket).toBe('under13');
  });

  it('under-13: no real-money / GG purchases, no rewarded ads; Bones unlocks still allowed', () => {
    const kid = answerAgeGate(DEFAULT_AGE_PROFILE, 2018, NOW);
    if (!kid.ok) throw new Error();
    expect(realMoneyBlock(skuById('gg:pocket_change')!, kid.profile, true)).toBe('under13');
    expect(realMoneyBlock(skuById('item:rug_funeral')!, kid.profile, true)).toBe('under13');
    expect(rewardedAdAllowed(kid.profile, 0)).toBe(false);
    expect(bonesBlock(skuById('item:sofa_velvet')!, kid.profile)).toBeNull();
    expect(setSpendCap(kid.profile, 5000).spendCapCents).toBe(0);
  });

  it('teen spending cap blocks a checkout that would exceed it; signed-out always ends at signIn', () => {
    const t = answerAgeGate(DEFAULT_AGE_PROFILE, 2010, NOW);
    if (!t.ok) throw new Error();
    const teen = { ...t.profile, spentThisMonthCents: 2450 };
    expect(realMoneyBlock(skuById('gg:handful')!, teen, true)).toBe('cap');
    expect(realMoneyBlock(skuById('gg:pocket_change')!, teen, true)).toBe('cap'); // 2450 + 99 > 2500
    expect(realMoneyBlock(skuById('gg:pocket_change')!, { ...teen, spentThisMonthCents: 0 }, false)).toBe('signIn');
    expect(realMoneyBlock(skuById('gg:pocket_change')!, DEFAULT_AGE_PROFILE, true)).toBe('ageGate');
  });

  it('rewarded ads: teen/adult only, max 5 a day', () => {
    const a = answerAgeGate(DEFAULT_AGE_PROFILE, 1990, NOW);
    if (!a.ok) throw new Error();
    expect(rewardedAdAllowed(a.profile, REWARDED_ADS_PER_DAY - 1)).toBe(true);
    expect(rewardedAdAllowed(a.profile, REWARDED_ADS_PER_DAY)).toBe(false);
    expect(rewardedAdAllowed(a.profile, -1)).toBe(false);
    expect(rewardedAdAllowed(DEFAULT_AGE_PROFILE, 0)).toBe(false);
  });
});

describe('analytics (consent-gated, no PII, under-13 none)', () => {
  const sink = () => {
    const got: AnalyticsEvent[] = [];
    return { got, sink: { record: (e: AnalyticsEvent) => got.push(e) } };
  };
  it('records nothing without consent, nothing for under-13/unknown even with consent', () => {
    const s = sink();
    const a = new Analytics(s.sink);
    a.track({ name: 'store_opened', source: 'menu' });
    a.setPolicy({ consent: true, bracket: 'under13' });
    a.track({ name: 'store_opened', source: 'menu' });
    a.setPolicy({ consent: true, bracket: 'unknown' });
    a.track({ name: 'store_opened', source: 'menu' });
    expect(s.got).toEqual([]);
    a.setPolicy({ consent: true, bracket: 'teen' });
    a.track({ name: 'store_opened', source: 'menu' });
    expect(s.got).toEqual([{ name: 'store_opened', source: 'menu' }]);
  });
  it('scrubs unknown fields and refuses free text (PII can never ride along)', () => {
    expect(scrub({ name: 'sku_viewed', skuId: 'item:sofa_velvet', email: 'a@b.c' } as never)).toEqual({ name: 'sku_viewed', skuId: 'item:sofa_velvet' });
    expect(scrub({ name: 'sku_viewed', skuId: 'Mort Graves lives at 12 Elm St' })).toBeNull();
    expect(scrub({ name: 'bones_granted', source: 'quest', amount: NaN })).toBeNull();
  });
  it('every enumerated value of the event schema survives scrub and reaches the sink (camelCase members included)', () => {
    const events: AnalyticsEvent[] = [
      ...(['menu', 'hud', 'buyLock', 'hotkey'] as const).map((source) => ({ name: 'store_opened' as const, source })),
      ...(['featured', 'bundles', 'items', 'bodies', 'boosts', 'season', 'gold'] as const).map((tab) => ({ name: 'store_tab' as const, tab })),
      ...(['signIn', 'under13', 'cap', 'ageMin', 'ageGate', 'none'] as const).map((blocked) => ({ name: 'gg_purchase_attempt' as const, skuId: 'gg:pocket_change', blocked })),
      ...(['quest', 'daily', 'weekly', 'streak', 'achievement'] as const).map((source) => ({ name: 'bones_granted' as const, source, amount: 5 })),
      ...(['under13', 'teen', 'adult'] as const).map((bracket) => ({ name: 'age_gate_answered' as const, bracket })),
      ...(['recovered', 'corrupt', 'unavailable'] as const).map((status) => ({ name: 'ledger_issue' as const, status })),
      { name: 'sku_viewed', skuId: 'item:sofa_velvet' },
      { name: 'bones_unlock', skuId: 'item:sofa_velvet', priceBones: 120 },
    ];
    expect(events.filter((e) => scrub(e) === null)).toEqual([]);
    const s = sink();
    const a = new Analytics(s.sink, { consent: true, bracket: 'adult' });
    for (const e of events) a.track(e);
    expect(s.got).toEqual(events);
  });
  it('an enumerated field still refuses free text and mixed-case look-alikes', () => {
    for (const v of ['Mort Graves', 'mortGraves', 'BuyLock', 'BUYLOCK', 'buyLock ', 'buyLock@b.c', 'toString', 'hasOwnProperty']) {
      expect(scrub({ name: 'store_opened', source: v } as never)).toBeNull();
      expect(scrub({ name: 'gg_purchase_attempt', skuId: 'gg:pocket_change', blocked: v } as never)).toBeNull();
      expect(scrub({ name: v, skuId: 'gg:pocket_change' } as never)).toBeNull();
    }
    expect(scrub({ name: 'sku_viewed', skuId: 'signIn' })).toBeNull(); // the id pattern for free ids is not loosened
  });
  it('an enumerated field accepts only its own enumerated values, not any id-shaped string', () => {
    expect(scrub({ name: 'store_opened', source: 'mort_graves' } as never)).toBeNull();
    expect(scrub({ name: 'store_tab', tab: 'menu' } as never)).toBeNull(); // a real value, but of another field
    expect(scrub({ name: 'gg_purchase_attempt', skuId: 'gg:pocket_change', blocked: 'signin' } as never)).toBeNull();
    expect(scrub({ name: 'age_gate_answered', bracket: 'unknown' } as never)).toBeNull();
    expect(scrub({ name: 'ledger_issue', status: 'constructor' } as never)).toBeNull();
    expect(scrub({ name: '__proto__', skuId: 'gg:pocket_change' } as never)).toBeNull();
  });
  it('a throwing sink never breaks the game', () => {
    const a = new Analytics({ record: () => { throw new Error('x'); } }, { consent: true, bracket: 'adult' });
    expect(() => a.track({ name: 'store_tab', tab: 'items' })).not.toThrow();
  });
});

describe('house brands + kill switch', () => {
  it('launch set = the original house brands only; nothing licensed', () => {
    expect(HOUSE_BRANDS).toEqual(['Mulch Master', 'Grave-Cola', 'Volt-Hearse', 'Brain Bran', 'Rot-Pop', 'Coffin Coffee', 'Crypt-Kicks', 'Necro-Tech']);
    for (const s of HOUSE_BRAND_SKINS) {
      expect(HOUSE_BRANDS).toContain(s.brand);
      expect(s.licensed).toBe(false);
    }
    for (const b of HOUSE_BRANDS) expect(HOUSE_BRAND_SKINS.some((s) => s.brand === b)).toBe(true);
    for (const c of HOUSE_AD_CREATIVES) expect(HOUSE_BRANDS).toContain(c.brand);
  });
  it('brandSkinFor resolves, honours per-skin + global kill switches, and ignores junk', () => {
    expect(brandSkinFor('fridge_humming')?.brand).toBe('Grave-Cola');
    expect(brandSkinFor('chair_creaky')).toBeNull();
    for (const junk of ['', null, undefined, 5]) expect(brandSkinFor(junk as never)).toBeNull();
    setBrandSkinDisabled('grave_cola_fridge', true);
    expect(brandSkinFor('fridge_humming')).toBeNull();
    setBrandSkinDisabled('grave_cola_fridge', false);
    setBrandsEnabled(false);
    expect(brandSkinFor('fridge_humming')).toBeNull();
    expect(adCreativesFor('tv', 'adult')).toEqual([]);
    setBrandsEnabled(true);
    expect(adCreativesFor('tv', 'under13').length).toBeGreaterThan(0);
  });
  it('a pack-provided skin overrides the built-in one; a skin claiming a real/licensed mark is never resolved', () => {
    setPackBrandSkins([{ ...HOUSE_BRAND_SKINS[0], displayName: 'Grave-Cola Retro' }]);
    expect(brandSkinFor('fridge_humming')?.displayName).toBe('Grave-Cola Retro');
    setPackBrandSkins([{ ...HOUSE_BRAND_SKINS[0], id: 'evil', brand: 'Coca-Cola', licensed: true }]);
    expect(brandSkinFor('fridge_humming')?.brand).toBe('Grave-Cola');
    setPackBrandSkins([]);
  });
});

describe('stored brackets and the age-policy revision (Astra PR94 audit: P1, P2)', () => {
  const salt = 'a'.repeat(32);
  const sentinel = { v: 1, decided: true, salt };
  const decidedAt = '2026-11-06T10:00:00.000Z';
  /** A record exactly as the code before AGE_POLICY wrote it: version 2, no agePolicy, seal over the old body. */
  const oldRecord = async (bracket: 'under13' | 'teen' | 'adult') => {
    const p = { ...DEFAULT_AGE_PROFILE, bracket, decidedAt, spendCapCents: bracket === 'under13' ? 0 : DEFAULT_AGE_PROFILE.spendCapCents };
    const seal = await sha256Hex(canonicalJson({ bracket: p.bracket, decidedAt: p.decidedAt, salt, spendCapCents: p.spendCapCents, spendMonth: p.spendMonth, spentThisMonthCents: p.spentThisMonthCents, v: 2 }));
    return { ...p, v: 2, seal };
  };

  it('a teen sealed under the earlier limit (may be 13 or 14) loads as a child profile, with every child protection', async () => {
    const r = await resolveStoredAge({ record: await oldRecord('teen'), sentinel, prefsDecided: true });
    expect(r.profile.bracket).toBe('under13');
    expect(r.source).toBe('failClosed');
    expect(r.reason).toMatch(/earlier age limit/);
    expect(r.profile.spendCapCents).toBe(0);
    expect(rewardedAdAllowed(r.profile, 0)).toBe(false);
    const sku = skuById('bundle:starter_pack')!;
    expect(realMoneyBlock(sku, r.profile, true)).toBe('under13');
    // and it cannot answer its way back up from the client
    expect(answerAgeGate(r.profile, 1990, new Date('2026-11-12T00:00:00Z'))).toEqual({ ok: false, reason: 'locked' });
  });

  it('old child and adult records keep their bracket; a tampered old record still fails closed', async () => {
    expect((await resolveStoredAge({ record: await oldRecord('under13'), sentinel, prefsDecided: true })).profile.bracket).toBe('under13');
    const adult = await resolveStoredAge({ record: await oldRecord('adult'), sentinel, prefsDecided: true });
    expect(adult.profile.bracket).toBe('adult');
    expect(adult.source).toBe('stored');
    const forged = { ...(await oldRecord('under13')), bracket: 'adult' };
    expect((await resolveStoredAge({ record: forged, sentinel, prefsDecided: true })).profile.bracket).toBe('under13');
  });

  it('a pre-seal legacy teen record is a child profile too', async () => {
    const r = await resolveStoredAge({ record: { ...DEFAULT_AGE_PROFILE, bracket: 'teen', decidedAt }, sentinel: null, prefsDecided: false });
    expect(r.profile.bracket).toBe('under13');
    expect(r.source).toBe('failClosed');
  });

  it('a teen decided under the current rules round-trips; the policy is inside the seal', async () => {
    const answered = answerAgeGate(DEFAULT_AGE_PROFILE, 2010, new Date('2026-11-12T00:00:00Z')); // conservative age 15
    if (!answered.ok) throw new Error('age gate refused 2010');
    const sealed = await sealAgeProfile(answered.profile, salt);
    expect(sealed.agePolicy).toBe(AGE_POLICY);
    const back = await resolveStoredAge({ record: sealed, sentinel, prefsDecided: true });
    expect(back.profile.bracket).toBe('teen');
    expect(back.source).toBe('stored');
    // stripping the policy from a new record (to pass it off as... anything) breaks the seal
    const { agePolicy: _dropped, ...stripped } = sealed;
    expect((await resolveStoredAge({ record: stripped, sentinel, prefsDecided: true })).profile.bracket).toBe('under13');
    // stamping an old teen record with the current policy breaks the seal as well
    const stamped = { ...(await oldRecord('teen')), agePolicy: AGE_POLICY };
    expect((await resolveStoredAge({ record: stamped, sentinel, prefsDecided: true })).profile.bracket).toBe('under13');
    // an unknown policy number fails closed
    expect((await resolveStoredAge({ record: { ...sealed, agePolicy: 99 }, sentinel, prefsDecided: true })).profile.bracket).toBe('under13');
  });

  it('a non-number age is a child, never an adult', () => {
    expect(bracketForAge(NaN)).toBe('under13');
    expect(bracketForAge(undefined as unknown as number)).toBe('under13');
  });

  it('labels: the spending-limit label names the current range; report labels assert no age', () => {
    expect(st('parents.cap')).toContain(`${CHILD_AGE_LIMIT}–17`);
    expect(st('parents.cap')).not.toContain('13');
  });

  it('labels: every Store string that states the child age limit takes it from CHILD_AGE_LIMIT', async () => {
    // Load the strings with the limit moved to 16: a typed-in 15 (or a left-over 13) stays behind and is listed here.
    vi.resetModules();
    vi.doMock('../../../src/shared/economy', async (original) => ({ ...(await original<typeof import('../../../src/shared/economy')>()), CHILD_AGE_LIMIT: 16 }));
    try {
      const { STORE_EN } = await import('../../../src/ui/store/strings');
      const stating = Object.entries(STORE_EN).filter(([, v]) => /\b1[3-8]\b/.test(v));
      expect(stating.map(([k]) => k)).toContain('parents.cap');
      expect(stating.filter(([, v]) => /\b1[35]\b/.test(v)).map(([k, v]) => `${k}: ${v}`)).toEqual([]);
      expect(STORE_EN['parents.cap']).toContain('16–17');
    } finally {
      vi.doUnmock('../../../src/shared/economy');
      vi.resetModules();
    }
  });
});
