import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STORE_SKUS } from '../../../src/economy/skus';
import { STORE_TABS, bundleView, priceView, skusForTab, tabForSku } from '../../../src/ui/store/model';
import { STORE_EN, st } from '../../../src/ui/store/strings';
import { BonesLock } from '../../../src/ui/store/BonesLock';
import { hasString } from '../../../src/i18n';
import { PHYSICAL_BY_ID } from '../../../src/shared/catalog';
import type { GameController } from '../../../src/game/contracts';

const DIR = join(__dirname, '../../../src/ui/store');

describe('store view-model', () => {
  it('every SKU appears in exactly one non-featured tab and tabForSku agrees', () => {
    const tabs = STORE_TABS.filter((t) => t !== 'featured');
    for (const s of STORE_SKUS) {
      const hits = tabs.filter((t) => skusForTab(t).some((x) => x.id === s.id));
      expect(hits, s.id).toEqual([tabForSku(s.id)]);
    }
    expect(skusForTab('featured').length).toBeGreaterThan(0);
  });

  it('GG prices ALWAYS carry the real-money equivalent; Bones prices never pretend to be money', () => {
    for (const s of STORE_SKUS) {
      const p = priceView(s, null);
      if (s.priceGG !== undefined) {
        expect(p.main, s.id).toMatch(/^[\d,]+ GG \(≈ \$\d+\.\d\d\)$/);
        expect(p.cents).toBeGreaterThan(0);
      } else if (s.priceBones !== undefined) {
        expect(p.main).toMatch(/^[\d,]+ Bones$/);
        expect(p.cents).toBeNull();
      } else if (s.priceUsdCents !== undefined) {
        expect(p.main).toMatch(/^\$\d+\.\d\d( \/ month)?$/);
        expect(p.cents).toBe(s.priceUsdCents);
      }
    }
  });

  it('no hidden cost: the displayed price equals the SKU price (owned-part discounts only ever lower it)', () => {
    for (const s of STORE_SKUS.filter((x) => x.priceBones !== undefined)) {
      expect(priceView(s, null).main).toBe(`${s.priceBones!.toLocaleString('en-US')} Bones`);
      expect(priceView(s, { sku: s, owned: false, priceBones: Math.floor(s.priceBones! / 2), block: null }).main).toBe(`${Math.floor(s.priceBones! / 2).toLocaleString('en-US')} Bones`);
    }
  });

  it('bundles list contents and sum of parts (+ saving)', () => {
    for (const s of STORE_SKUS.filter((x) => x.kind === 'bundle')) {
      const v = bundleView(s)!;
      expect(v.lines.length).toBe(s.contents.length);
      expect(v.parts).not.toBeNull();
    }
    const gp = bundleView(STORE_SKUS.find((s) => s.id === 'bundle:gothic_parlour')!)!;
    expect(gp.lines).toContain(PHYSICAL_BY_ID.sofa_velvet.name);
    expect(gp.saving).toMatch(/Bones$/);
    const starter = bundleView(STORE_SKUS.find((s) => s.id === 'bundle:starter_pack')!)!;
    expect(starter.lines[0]).toBe('1,000 Grave Gold');
  });
});

describe('store strings + copy rules', () => {
  it('every st() key used by the store UI exists', () => {
    for (const f of readdirSync(DIR).filter((n) => n.endsWith('.tsx'))) {
      const src = readFileSync(join(DIR, f), 'utf8');
      for (const m of src.matchAll(/\bst\('([^']+)'/g)) expect(hasString(`store.${m[1]}`), `${f}: ${m[1]}`).toBe(true);
    }
    for (const id of STORE_TABS) expect(hasString(`store.tab.${id}`)).toBe(true);
  });

  it('GG purchase button copy is exactly "Sign in to buy (coming soon)"', () => {
    expect(st('signIn')).toBe('Sign in to buy (coming soon)');
  });

  it('the age gate is neutral: no threshold, no hint which answer unlocks what', () => {
    for (const [k, v] of Object.entries(STORE_EN).filter(([k]) => k.startsWith('age.'))) {
      expect(/\b1[38]\b|older|over|adult|child|kid|parent/i.test(v), `${k}: ${v}`).toBe(false);
    }
  });

  it('the Store shows the age question until it is answered, so no other Store text may name an age limit', () => {
    // The one exception is the spending-limit row: StoreDialog renders it for an answered 'teen' profile only.
    const dialog = readFileSync(join(DIR, 'StoreDialog.tsx'), 'utf8');
    const from = dialog.indexOf("age.bracket === 'teen' ? (");
    expect(from).toBeGreaterThan(-1);
    expect(dialog.slice(from, dialog.indexOf(') : null}', from))).toContain("st('parents.cap')");
    expect(dialog.split("st('parents.cap')").length).toBe(2); // used in that one place
    for (const [k, v] of Object.entries(STORE_EN).filter(([k]) => k !== 'parents.cap')) {
      expect(/\b1[3-8]\b|under \d/i.test(v), `${k}: ${v}`).toBe(false);
    }
  });

  it('no dark patterns in the copy: no countdowns, scarcity or pressure words', () => {
    for (const [k, v] of Object.entries(STORE_EN)) expect(/hurry|last chance|only \d+ left|limited time|expires|don.t miss/i.test(v), `${k}: ${v}`).toBe(false);
  });
});

describe('Buy-mode lock chip', () => {
  const game = (state: 'open' | 'locked' | 'hidden') => ({ economy: { buyLock: () => (state === 'locked' ? { state, priceBones: 450 } : { state }) } }) as unknown as GameController;
  it('renders only for locked items, with the Bones price in the accessible name', () => {
    expect(BonesLock({ game: game('open'), defId: 'x' })).toBeNull();
    expect(BonesLock({ game: game('hidden'), defId: 'x' })).toBeNull();
    expect(BonesLock({ game: { economy: null } as unknown as GameController, defId: 'x' })).toBeNull();
    const v = BonesLock({ game: game('locked'), defId: 'sofa_velvet' }) as unknown as { props: Record<string, unknown> };
    // Accessible name via screen-reader-only TEXT (aria-label on a generic <span> is ignored by most screen readers —
    // review R5); the visual chip is aria-hidden.
    expect(v.props['aria-label']).toBeUndefined();
    const kids = (Array.isArray(v.props.children) ? v.props.children : [v.props.children]) as { props: Record<string, unknown> }[];
    expect(kids.find((k) => k?.props?.class === 'u-sr-only')?.props.children).toBe('Unlock in the store for 450 Bones');
    expect(kids.find((k) => k?.props?.['aria-hidden'] === 'true')).toBeDefined();
  });
});
