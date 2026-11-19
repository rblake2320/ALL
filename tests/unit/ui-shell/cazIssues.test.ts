import { describe, expect, it } from 'vitest';
import { collectCazIssues, firstIssue, generalHouseholdIssues, tabForField } from '../../../src/ui/shell/cazIssues';

describe('collectCazIssues', () => {
  it('groups structured issues by member and household', () => {
    const r = collectCazIssues({
      validateCazDetailed: () => [
        { memberIndex: null, field: 'householdName', message: 'Name the household.' },
        { memberIndex: 1, field: 'traits', message: 'Ophelia needs 3 traits.' },
        { memberIndex: 1, field: 'aspiration', message: 'Ophelia needs an aspiration.' },
        { memberIndex: 0, field: 'firstName', message: 'Zombie 1 needs a name.' },
      ],
      validateCaz: () => ['should not be used'],
    });
    expect(r.detailed).toBe(true);
    expect(r.all).toHaveLength(4);
    expect(r.household.map((i) => i.field)).toEqual(['householdName']);
    expect(r.byMember[1].map((i) => i.field)).toEqual(['traits', 'aspiration']);
    expect(firstIssue(r)?.field).toBe('householdName');
  });
  it('sanitises garbage entries', () => {
    const r = collectCazIssues({
      validateCazDetailed: () =>
        [null, 7, { message: '' }, { memberIndex: -2, field: 'weird', message: 'odd' }, { memberIndex: 1.5, field: 'traits', message: 'half' }, { memberIndex: 2, field: 'traits', message: 'ok' }] as never,
    });
    expect(r.all).toEqual(['odd', 'half', 'ok']);
    expect(r.household.map((i) => i.message)).toEqual(['odd', 'half']);
    // Unknown household-level fields are general issues, never pinned under the household-name input.
    expect(r.household.map((i) => i.field)).toEqual(['household', 'household']);
    expect(r.byMember[2][0].message).toBe('ok');
  });
  it('falls back to the flat list (old controllers, or detailed throws)', () => {
    const flat = collectCazIssues({ validateCaz: () => ['a', '', 5 as never, 'b'] });
    expect(flat).toEqual({ all: ['a', 'b'], household: [], byMember: {}, detailed: false });
    const thrown = collectCazIssues({ validateCazDetailed: () => { throw new Error('x'); }, validateCaz: () => ['c'] });
    expect(thrown.all).toEqual(['c']);
    const both = collectCazIssues({ validateCaz: () => { throw new Error('boom'); } });
    expect(both.all).toEqual(['boom']);
    expect(collectCazIssues({}).all).toEqual([]);
  });
  it('jumps to the lowest member index and the right tab', () => {
    const r = collectCazIssues({ validateCazDetailed: () => [{ memberIndex: 3, field: 'traits', message: 'x' }, { memberIndex: 1, field: 'lastName', message: 'y' }] });
    expect(firstIssue(r)).toEqual({ memberIndex: 1, field: 'lastName', message: 'y' });
    expect(firstIssue(collectCazIssues({}))).toBeNull();
    expect(tabForField('traits')).toBe('personality');
    expect(tabForField('aspiration')).toBe('personality');
    expect(tabForField('firstName')).toBe('identity');
    expect(tabForField('lastName')).toBe('identity');
    expect(tabForField('appearance')).toBe('body');
    expect(tabForField('householdName')).toBeNull();
    expect(tabForField('household')).toBeNull();
    expect(tabForField('nonsense' as never)).toBeNull();
  });
  it('maps the full contract field union, re-homing mismatched member/household fields', () => {
    const r = collectCazIssues({
      validateCazDetailed: () => [
        { memberIndex: null, field: 'household', message: 'Add at least one zombie.' },
        { memberIndex: null, field: 'householdName', message: 'Name the household.' },
        { memberIndex: 0, field: 'appearance', message: 'Corrupt appearance.' },
        { memberIndex: null, field: 'traits', message: 'Traits without a member.' },
        { memberIndex: 2, field: 'householdName', message: 'Household field on a member.' },
        { memberIndex: 1, field: 'mystery', message: 'Unknown member field.' },
        { memberIndex: null, field: '__proto__', message: 'Proto field.' },
      ] as never,
    });
    expect(r.household.map((i) => [i.field, i.message])).toEqual([
      ['household', 'Add at least one zombie.'],
      ['householdName', 'Name the household.'],
      ['household', 'Traits without a member.'],
      ['household', 'Proto field.'],
    ]);
    expect(r.byMember[0][0].field).toBe('appearance');
    expect(r.byMember[2][0].field).toBe('appearance');
    expect(r.byMember[1][0].field).toBe('appearance');
    expect(generalHouseholdIssues(r)).toEqual(['Add at least one zombie.', 'Traits without a member.', 'Proto field.']);
    expect(firstIssue(r)?.message).toBe('Add at least one zombie.');
  });
  it('survives hostile validator return values', () => {
    for (const bad of [undefined, null, 42, 'oops', { length: 2 }, [undefined, [], () => 1]]) {
      const r = collectCazIssues({ validateCazDetailed: () => bad as never, validateCaz: () => ['flat'] });
      expect(Array.isArray(r.all)).toBe(true);
      expect(r.all.every((m) => typeof m === 'string' && m.length > 0)).toBe(true);
    }
    const huge = Array.from({ length: 5000 }, (_, i) => ({ memberIndex: i % 4, field: 'traits', message: `m${i}` }));
    const r = collectCazIssues({ validateCazDetailed: () => huge as never });
    expect(r.all).toHaveLength(5000);
    expect(Object.keys(r.byMember).sort()).toEqual(['0', '1', '2', '3']);
  });
});
