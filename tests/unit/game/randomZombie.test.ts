import { describe, expect, it } from 'vitest';
import {
  initialCaz,
  randomAppearance,
  randomHousehold,
  randomTraits,
  randomZombie,
  randomizeMember,
  rngFromSeed,
  uniqueFirstName,
} from '../../../src/game/randomZombie';
import { appearanceProblems, validateCazState } from '../../../src/game/cazState';
import { buildCazCatalog, traitsConflict } from '../../../src/game/gddCatalog';
import type { ContentRegistry } from '../../../src/sim/contracts';
import { makeContent, LOTS } from './fakes';

const catalog = buildCazCatalog(makeContent(), LOTS);
const fallbackCatalog = buildCazCatalog(null, null);

describe('randomZombie — determinism', () => {
  it('same seed → identical zombie; different seeds differ', () => {
    const a = randomZombie(rngFromSeed(123), catalog);
    const b = randomZombie(rngFromSeed(123), catalog);
    const c = randomZombie(rngFromSeed(124), catalog);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('randomHousehold is deterministic and shares the family name', () => {
    const h1 = randomHousehold(99, catalog, 4);
    const h2 = randomHousehold(99, catalog, 4);
    expect(h1).toEqual(h2);
    expect(new Set(h1.members.map((m) => m.lastName)).size).toBe(1);
    expect(h1.householdName).toBe(h1.members[0].lastName);
  });

  it('clamps the member count to 1..4', () => {
    expect(randomHousehold(1, catalog, 0).members.length).toBe(1);
    expect(randomHousehold(1, catalog, 9).members.length).toBe(4);
    expect(randomHousehold(1, catalog, NaN).members.length).toBe(1);
  });
});

describe('randomZombie — always valid over 1,000 seeds', () => {
  for (const [label, cat] of [
    ['live content', catalog],
    ['GDD fallback catalog', fallbackCatalog],
  ] as const) {
    it(label, () => {
      for (let seed = 0; seed < 1000; seed++) {
        const count = 1 + (seed % 4);
        const h = randomHousehold(seed * 2654435761, cat, count);
        const state = { members: h.members, activeIndex: 0, householdName: h.householdName, lotTemplate: 'starter' as const, difficulty: 'normal' as const };
        const errors = validateCazState(state, cat);
        if (errors.length) throw new Error(`seed ${seed}: ${errors.join('; ')}`);
        for (const m of h.members) {
          expect(m.traits.length).toBe(3);
          expect(appearanceProblems(m.appearance)).toEqual([]);
          for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(traitsConflict(cat, m.traits[i], m.traits[j])).toBe(false);
        }
      }
    });
  }
});

describe('randomZombie — edge cases', () => {
  it('first names stay unique even when the name pool is exhausted', () => {
    const tiny = { ...catalog, firstNames: ['Mort'] };
    const taken = new Set<string>();
    const names: string[] = [];
    for (let i = 0; i < 6; i++) {
      const n = uniqueFirstName(rngFromSeed(i), tiny, taken);
      expect(taken.has(n.toLocaleLowerCase())).toBe(false);
      taken.add(n.toLocaleLowerCase());
      names.push(n);
    }
    expect(names[0]).toBe('Mort');
    expect(names[1]).toBe('Mort II');
    for (const n of names) expect(Array.from(n).length).toBeLessThanOrEqual(24);
  });

  it('suffixing keeps very long base names within 24 characters', () => {
    const longCat = { ...catalog, firstNames: ['Bartholomewzzzzzzzzzzzz'] }; // 23 chars
    const n = uniqueFirstName(rngFromSeed(1), longCat, new Set(['bartholomewzzzzzzzzzzzz']));
    expect(Array.from(n).length).toBeLessThanOrEqual(24);
    expect(n.endsWith(' II')).toBe(true);
  });

  it('randomTraits never returns conflicting or reward traits, and degrades if the pool is tiny', () => {
    for (let seed = 0; seed < 200; seed++) {
      const t = randomTraits(rngFromSeed(seed), catalog);
      expect(t).not.toContain('wellPreserved');
      expect(new Set(t).size).toBe(t.length);
    }
    const tiny = { ...catalog, traitIds: ['cheerful', 'grumpy'] };
    expect(randomTraits(rngFromSeed(5), tiny).length).toBe(1); // only one of the conflicting pair
  });

  it('bad content names are filtered (fallback when too few survive)', () => {
    const content = makeContent();
    const names = { first: ['', ' padded ', 'x'.repeat(30), 'Ok\u0000', 42 as unknown as string], last: ['Good'], occupations: [] };
    const cat = buildCazCatalog({ ...content, names } as ContentRegistry, LOTS);
    expect(cat.firstNames.length).toBeGreaterThanOrEqual(8);
    expect(cat.firstNames).not.toContain('');
    for (const n of cat.firstNames) expect(n.trim()).toBe(n);
  });

  it('randomizeMember changes only the requested part', () => {
    const base = randomZombie(rngFromSeed(1), catalog);
    const look = randomizeMember(base, 'look', rngFromSeed(2), catalog, []);
    expect(look.firstName).toBe(base.firstName);
    expect(look.traits).toEqual(base.traits);
    const traits = randomizeMember(base, 'traits', rngFromSeed(3), catalog, []);
    expect(traits.appearance).toEqual(base.appearance);
    expect(traits.firstName).toBe(base.firstName);
    const name = randomizeMember(base, 'name', rngFromSeed(4), catalog, [base.firstName]);
    expect(name.firstName.toLowerCase()).not.toBe(base.firstName.toLowerCase());
    expect(name.traits).toEqual(base.traits);
    const all = randomizeMember(base, 'all', rngFromSeed(5), catalog, []);
    expect(all.lastName).toBe(base.lastName); // family name kept
  });

  it('appearance stays in range across seeds', () => {
    for (let s = 0; s < 300; s++) expect(appearanceProblems(randomAppearance(rngFromSeed(s)))).toEqual([]);
  });

  it('initialCaz is a valid one-member household on the starter lot', () => {
    const s = initialCaz(42, catalog);
    expect(s.members.length).toBe(1);
    expect(s.lotTemplate).toBe('starter');
    expect(s.difficulty).toBe('normal');
    expect(validateCazState(s, catalog)).toEqual([]);
  });
});
