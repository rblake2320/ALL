/**
 * The shared living-things rule (src/shared/livingThings.ts, docs/contract-requests/living-things.md): care and its tiers,
 * caps for new adoptions, seeded rolls, and the encounter-table validator, including NEGATIVE CONTROLS (an uncapped or
 * certain row is refused).
 */
import { describe, expect, it } from 'vitest';
import {
  CARE_TIER_AT,
  LIVING_KINDS,
  PET_CAPS,
  TIER_WEIGHT,
  adoptionRefusal,
  canFire,
  careOf,
  careTier,
  countersFor,
  freshCounters,
  recordFire,
  rollEncounter,
  seededUnit,
  validateEncounterTable,
  type EncounterRow,
} from '../../../src/shared/livingThings';
import { PET_ENCOUNTERS } from '../../../src/sim/systems/pets/encounters';

describe('care and its tiers', () => {
  it('care is the average of the needs, clamped, and a broken need counts as 0', () => {
    const pet = LIVING_KINDS.pet.needs;
    expect(careOf({ appetite: 80, fun: 60, hygiene: 40, affection: 20 }, pet)).toBe(50);
    expect(careOf({ appetite: 500, fun: -9, hygiene: 100, affection: 100 }, pet)).toBe(75);
    expect(careOf({ appetite: NaN, fun: '90', hygiene: undefined, affection: 100 }, pet)).toBe(25);
    expect(careOf(null, pet)).toBe(0);
    expect(careOf({ water: 100, tending: 50 }, LIVING_KINDS.plant.needs)).toBe(75);
  });

  it('none below 25, half from 25, full from 60 (boundaries)', () => {
    expect([0, 24.9, 25, 59.9, 60, 100].map(careTier)).toEqual(['none', 'none', 'half', 'half', 'full', 'full']);
    expect(CARE_TIER_AT).toEqual({ half: 25, full: 60 });
    for (const junk of [NaN, Infinity, -1, undefined as never, '60' as never]) expect(careTier(junk), String(junk)).toBe(junk === Infinity ? 'none' : 'none');
    expect(TIER_WEIGHT).toEqual({ none: 0, half: 0.5, full: 1 });
  });
});

describe('caps apply to NEW adoptions', () => {
  it('3 in all, 2 of one species; an older save holding more is only blocked from adopting another', () => {
    expect(PET_CAPS).toEqual({ household: 3, perSpecies: 2 });
    expect(adoptionRefusal(PET_CAPS, [], 'dog')).toBeNull();
    expect(adoptionRefusal(PET_CAPS, [{ species: 'dog' }], 'dog')).toBeNull();
    expect(adoptionRefusal(PET_CAPS, [{ species: 'dog' }, { species: 'dog' }], 'dog')).toMatch(/2 dogs/);
    expect(adoptionRefusal(PET_CAPS, [{ species: 'dog' }, { species: 'dog' }], 'cat')).toBeNull();
    expect(adoptionRefusal(PET_CAPS, [{ species: 'dog' }, { species: 'cat' }, { species: 'crow' }], 'raccoon')).toMatch(/as many pets/);
    const old = [{ species: 'dog' }, { species: 'dog' }, { species: 'dog' }, { species: 'cat' }, { species: 'cat' }];
    expect(adoptionRefusal(PET_CAPS, old, 'crow')).toMatch(/as many pets/);
  });
});

describe('seeded rolls', () => {
  it('are in [0, 1), depend only on the seed and keys, and are well spread', () => {
    expect(seededUnit(7, 'a', 1)).toBe(seededUnit(7, 'a', 1));
    expect(seededUnit(7, 'a', 1)).not.toBe(seededUnit(8, 'a', 1));
    expect(seededUnit(7, 'a', 1)).not.toBe(seededUnit(7, 'a', 2));
    let below = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const u = seededUnit(i * 2654435761, 'rivalChase', 'p1', 's2', i % 7);
      expect(u >= 0 && u < 1).toBe(true);
      if (u < 0.25) below++;
    }
    expect(below / n).toBeGreaterThan(0.22);
    expect(below / n).toBeLessThan(0.28);
  });

  it('rollEncounter succeeds at about the row chance', () => {
    const row = { id: 'x', chance: 0.25 };
    let hits = 0;
    for (let d = 0; d < 20000; d++) if (rollEncounter(12345, row, 'p1', d)) hits++;
    expect(hits / 20000).toBeGreaterThan(0.23);
    expect(hits / 20000).toBeLessThan(0.27);
  });
});

describe('the encounter table', () => {
  it('the pets table is sound', () => {
    expect(validateEncounterTable(PET_ENCOUNTERS)).toEqual([]);
    const rival = PET_ENCOUNTERS.find((r) => r.id === 'rivalChase')!;
    expect(rival).toMatchObject({ chance: 0.25, maxPerDay: 1, actorSpecies: ['dog', 'cat'], others: ['dog', 'cat'] });
    expect(PET_ENCOUNTERS.filter((r) => r.group === 'huntChase').every((r) => r.maxPerDay === 2)).toBe(true);
    expect(PET_ENCOUNTERS.find((r) => r.id === 'windfall')!.minCare).toBe(CARE_TIER_AT.full);
  });

  const ok = PET_ENCOUNTERS[0];
  it.each<[string, Partial<EncounterRow>, RegExp]>([
    ['NEGATIVE CONTROL: an uncapped row', { maxPerDay: 99 }, /uncapped/],
    ['an infinite cap', { maxPerDay: Infinity }, /uncapped/],
    ['a fractional cap', { maxPerDay: 1.5 }, /whole number/],
    ['a certain row', { chance: 1 }, /not certain/],
    ['an impossible row', { chance: 0 }, /not certain|between/],
    ['a NaN chance', { chance: NaN }, /between/],
    ['a bad minCare', { minCare: 120 }, /minCare/],
    ['no cap group', { group: '' }, /group/],
  ])('%s is refused', (_name, patch, msg) => {
    const problems = validateEncounterTable([{ ...ok, ...patch }]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toMatch(msg);
  });

  it('refuses duplicate ids and rows of one group with different caps', () => {
    expect(validateEncounterTable([ok, ok]).join(' ')).toMatch(/duplicate/);
    expect(validateEncounterTable([{ ...ok, id: 'a', group: 'g', maxPerDay: 1 }, { ...ok, id: 'b', group: 'g', maxPerDay: 2 }]).join(' ')).toMatch(/share one maxPerDay/);
  });
});

describe('per-day counters', () => {
  it('count per group, stop at the cap, and start fresh on a new day', () => {
    const row = { group: 'g', maxPerDay: 2 };
    let c = countersFor(undefined, 5);
    expect(c).toEqual(freshCounters(5));
    expect(canFire(c, row)).toBe(true);
    c = recordFire(c, row);
    c = recordFire(c, row);
    expect(canFire(c, row)).toBe(false);
    expect(countersFor(c, 5)).toBe(c);
    expect(canFire(countersFor(c, 6), row)).toBe(true);
  });
});
