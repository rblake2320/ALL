import { describe, expect, it } from 'vitest';
import type { CazState } from '../../../src/game/contracts';
import type { NewMemberSpec } from '../../../src/sim/contracts';
import { defaultAppearance } from '../../../src/shared/appearance';
import {
  CAZ_MAX_MEMBERS,
  NAME_INPUT_CAP,
  addMember,
  appearanceProblems,
  finalizeCaz,
  cazIssues,
  nameProblem,
  patchCaz,
  removeMember,
  sanitizeAppearance,
  sanitizeMemberPatch,
  updateMember,
  validateCazState,
} from '../../../src/game/cazState';
import { buildCazCatalog, traitsConflict } from '../../../src/game/gddCatalog';
import { makeContent, LOTS } from './fakes';

const catalog = buildCazCatalog(makeContent(), LOTS);

function member(over: Partial<NewMemberSpec> = {}): NewMemberSpec {
  return { firstName: 'Mortimer', lastName: 'Rotwell', appearance: defaultAppearance(), traits: ['cheerful', 'clumsy', 'vain'], aspiration: 'tycoon', ...over };
}

function caz(members: NewMemberSpec[] = [member()], over: Partial<CazState> = {}): CazState {
  return { members, activeIndex: 0, householdName: 'Rotwell', lotTemplate: 'starter', difficulty: 'normal', ...over };
}

describe('validateCaz — table', () => {
  const rows: { name: string; state: CazState; expect: RegExp | null }[] = [
    { name: 'valid single zombie', state: caz(), expect: null },
    { name: 'valid full household of 4', state: caz(['Ann', 'Bo', 'Cy', 'Di'].map((n) => member({ firstName: n }))), expect: null },
    { name: 'empty first name', state: caz([member({ firstName: '' })]), expect: /first name must be 1–24/ },
    { name: 'whitespace-only first name', state: caz([member({ firstName: '   ' })]), expect: /first name must be 1–24/ },
    { name: 'invisible-only first name', state: caz([member({ firstName: '\u200B\u200B' })]), expect: /first name must be 1–24/ },
    { name: '25-character first name', state: caz([member({ firstName: 'A'.repeat(25) })]), expect: /first name must be 1–24/ },
    { name: '24-character name is fine', state: caz([member({ firstName: 'A'.repeat(24), lastName: 'B'.repeat(24) })]), expect: null },
    { name: '24 emoji (code points, not UTF-16 units) is fine', state: caz([member({ firstName: '💀'.repeat(24) })]), expect: null },
    { name: 'surrounding spaces do not count toward the limit', state: caz([member({ firstName: `  ${'A'.repeat(24)}  ` })]), expect: null },
    { name: '25-character last name', state: caz([member({ lastName: 'L'.repeat(25) })]), expect: /last name must be 1–24/ },
    { name: 'control characters', state: caz([member({ firstName: 'Mort\u0007' })]), expect: /control characters/ },
    { name: 'newline in a name', state: caz([member({ lastName: 'Rot\nwell' })]), expect: /control characters/ },
    { name: 'duplicate first names', state: caz([member({ firstName: 'Mort' }), member({ firstName: 'Mort' })]), expect: /share the first name "Mort"/ },
    { name: 'duplicate first names ignoring case and spaces', state: caz([member({ firstName: 'Mort' }), member({ firstName: ' mORT ' })]), expect: /share the first name/ },
    { name: 'two traits', state: caz([member({ traits: ['cheerful', 'vain'] })]), expect: /exactly 3 traits \(2 chosen\)/ },
    { name: 'four traits', state: caz([member({ traits: ['cheerful', 'vain', 'clumsy', 'lazy'] })]), expect: /exactly 3 traits \(4 chosen\)/ },
    { name: 'no traits', state: caz([member({ traits: [] })]), expect: /exactly 3 traits \(0 chosen\)/ },
    { name: 'conflicting traits (cheerful + grumpy)', state: caz([member({ traits: ['cheerful', 'grumpy', 'vain'] })]), expect: /Cheerful and Grumpy can't be combined/ },
    { name: 'hothead + cheerful', state: caz([member({ traits: ['hothead', 'cheerful', 'vain'] })]), expect: /can't be combined/ },
    { name: 'neatFreak + slob', state: caz([member({ traits: ['neatFreak', 'slob', 'vain'] })]), expect: /can't be combined/ },
    { name: 'duplicate trait', state: caz([member({ traits: ['vain', 'vain', 'clumsy'] })]), expect: /same trait is chosen twice/ },
    { name: 'unknown trait', state: caz([member({ traits: ['vain', 'clumsy', 'telekinetic'] })]), expect: /"telekinetic" isn't a known trait/ },
    { name: 'reward trait not allowed in CAZ', state: caz([member({ traits: ['vain', 'clumsy', 'wellPreserved'] })]), expect: /reward trait/ },
    { name: 'no aspiration', state: caz([member({ aspiration: null })]), expect: /choose an aspiration/ },
    { name: 'unknown aspiration', state: caz([member({ aspiration: 'worldDomination' })]), expect: /isn't a known aspiration/ },
    { name: 'empty household name', state: caz([member()], { householdName: ' ' }), expect: /household a name/ },
    { name: '25-character household name', state: caz([member()], { householdName: 'H'.repeat(25) }), expect: /household a name/ },
    { name: 'no members', state: caz([]), expect: /at least one zombie/ },
    { name: 'five members', state: caz(['A', 'B', 'C', 'D', 'E'].map((n) => member({ firstName: n }))), expect: /at most 4/ },
    { name: 'unknown lot', state: caz([member()], { lotTemplate: 'castle' as never }), expect: /Choose a lot/ },
    { name: 'unknown difficulty', state: caz([member()], { difficulty: 'nightmare' as never }), expect: /difficulty/ },
    { name: 'broken appearance', state: caz([member({ appearance: { ...defaultAppearance(), skinTone: 99 } })]), expect: /invalid appearance \(skinTone\)/ },
  ];
  for (const row of rows) {
    it(row.name, () => {
      const errors = validateCazState(row.state, catalog);
      if (row.expect === null) expect(errors).toEqual([]);
      else expect(errors.some((e) => row.expect!.test(e))).toBe(true);
    });
  }

  it('null state and garbage member arrays do not throw', () => {
    expect(validateCazState(null, catalog)).toEqual(['Create a household first.']);
    expect(() => validateCazState({ ...caz(), members: null as never }, catalog)).not.toThrow();
  });

  it('reports every problem, naming the zombie', () => {
    const errors = validateCazState(caz([member({ firstName: 'Edna', traits: ['grumpy', 'cheerful'], aspiration: null })]), catalog);
    expect(errors).toEqual([
      'Edna: pick exactly 3 traits (2 chosen).',
      "Edna: Grumpy and Cheerful can't be combined.",
      'Edna: choose an aspiration.',
    ]);
  });

  it('a conflict declared on only ONE side is still a conflict (symmetric check)', () => {
    const lopsided = {
      ...catalog,
      traits: { ...catalog.traits, cheerful: { ...catalog.traits.cheerful, conflicts: [] }, grumpy: { ...catalog.traits.grumpy, conflicts: ['cheerful'] } },
    };
    expect(traitsConflict(lopsided, 'cheerful', 'grumpy')).toBe(true);
    expect(traitsConflict(lopsided, 'grumpy', 'cheerful')).toBe(true);
    expect(validateCazState(caz([member({ traits: ['cheerful', 'grumpy', 'vain'] })]), lopsided).some((e) => /can't be combined/.test(e))).toBe(true);
  });

  it('works from the GDD fallback catalog when content is unavailable', () => {
    const fallback = buildCazCatalog(null, null);
    expect(fallback.fromContent).toBe(false);
    expect(validateCazState(caz(), fallback)).toEqual([]);
    expect(traitsConflict(fallback, 'loner', 'socialButterfly')).toBe(true);
  });

  it('cazIssues maps every problem to a member + field for inline errors', () => {
    const s = caz([member(), member({ firstName: 'Mortimer', traits: ['vain'], aspiration: null, lastName: '' })], { householdName: '', lotTemplate: 'castle' as never });
    const issues = cazIssues(s, catalog);
    expect(issues).toContainEqual({ memberIndex: null, field: 'householdName', message: 'Give your household a name (1–24 characters).' });
    expect(issues).toContainEqual({ memberIndex: null, field: 'household', message: 'Choose a lot to move into.' }); // contract #19
    expect(issues).toContainEqual({ memberIndex: 1, field: 'firstName', message: 'Two zombies can\'t share the first name "Mortimer".' });
    expect(issues).toContainEqual({ memberIndex: 1, field: 'lastName', message: 'Mortimer: last name must be 1–24 characters.' });
    expect(issues).toContainEqual({ memberIndex: 1, field: 'traits', message: 'Mortimer: pick exactly 3 traits (1 chosen).' });
    expect(issues).toContainEqual({ memberIndex: 1, field: 'aspiration', message: 'Mortimer: choose an aspiration.' });
    expect(validateCazState(s, catalog)).toEqual(issues.map((i) => i.message));
    for (const i of issues) expect(['household', 'householdName', 'firstName', 'lastName', 'traits', 'aspiration', 'appearance']).toContain(i.field);
  });

  it('a null member entry is reported, not thrown', () => {
    const s = caz([member(), null as never]);
    expect(cazIssues(s, catalog)).toContainEqual({ memberIndex: 1, field: 'firstName', message: 'Zombie 2: missing data.' });
  });

  it('nameProblem', () => {
    expect(nameProblem('Mort')).toBeNull();
    expect(nameProblem(42)).toBe('empty');
    expect(nameProblem('x'.repeat(25))).toBe('tooLong');
    expect(nameProblem('a\u0000b')).toBe('control');
  });
});

describe('CAZ state ops', () => {
  it('addMember stops at 4 and focuses the new member', () => {
    let s = caz();
    for (let i = 0; i < 6; i++) s = addMember(s, member({ firstName: `Z${i}` }));
    expect(s.members.length).toBe(CAZ_MAX_MEMBERS);
    expect(s.activeIndex).toBe(CAZ_MAX_MEMBERS - 1);
  });

  it('removeMember keeps at least one and fixes activeIndex', () => {
    let s = caz(['A', 'B', 'C'].map((n) => member({ firstName: n })), { activeIndex: 2 });
    s = removeMember(s, 0);
    expect(s.members.map((m) => m.firstName)).toEqual(['B', 'C']);
    expect(s.activeIndex).toBe(1);
    s = removeMember(s, 1);
    expect(s.activeIndex).toBe(0);
    const same = removeMember(s, 0);
    expect(same).toBe(s);
    expect(removeMember(s, 99)).toBe(s);
    expect(removeMember(s, -1)).toBe(s);
  });

  it('updateMember ignores out-of-range indices and returns new objects (immutability)', () => {
    const s = caz();
    expect(updateMember(s, 5, { firstName: 'X' })).toBe(s);
    const t = updateMember(s, 0, { firstName: 'Edna' });
    expect(t).not.toBe(s);
    expect(s.members[0].firstName).toBe('Mortimer');
    expect(t.members[0].firstName).toBe('Edna');
  });

  it('member patches do not trim while typing, but cap absurd lengths', () => {
    const m = sanitizeMemberPatch(member(), { firstName: 'Mary ' });
    expect(m.firstName).toBe('Mary ');
    const long = sanitizeMemberPatch(member(), { firstName: 'x'.repeat(10_000) });
    expect(long.firstName.length).toBe(NAME_INPUT_CAP);
  });

  it('member patches validate field by field', () => {
    const m = sanitizeMemberPatch(member(), {
      firstName: 7,
      traits: ['vain', 'vain', 3, null, 'lazy'],
      aspiration: { evil: true },
      appearance: { height: 2, skinTone: 3.5, hairStyle: 'spikes', topColor: 'red', eyeColor: '#ABCDEF', stitches: 'yes' },
      ['__proto__' as string]: { polluted: true },
    });
    expect(m.firstName).toBe('Mortimer');
    expect(m.traits).toEqual(['vain', 'lazy']);
    expect(m.aspiration).toBe('tycoon');
    expect(m.appearance.height).toBe(1); // clamped
    expect(m.appearance.skinTone).toBe(defaultAppearance().skinTone);
    expect(m.appearance.hairStyle).toBe(defaultAppearance().hairStyle);
    expect(m.appearance.topColor).toBe(defaultAppearance().topColor);
    expect(m.appearance.eyeColor).toBe('#abcdef');
    expect(m.appearance.stitches).toBe(defaultAppearance().stitches);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(appearanceProblems(m.appearance)).toEqual([]);
  });

  it('sanitizeAppearance on junk returns the base unchanged', () => {
    const base = defaultAppearance();
    expect(sanitizeAppearance(null, base)).toEqual(base);
    expect(sanitizeAppearance('x', base)).toEqual(base);
  });

  it('patchCaz validates lot / difficulty / activeIndex', () => {
    let s = caz(['A', 'B'].map((n) => member({ firstName: n })));
    s = patchCaz(s, { lotTemplate: 'empty', difficulty: 'grim', activeIndex: 1, householdName: 'Graves' }, catalog);
    expect(s).toMatchObject({ lotTemplate: 'empty', difficulty: 'grim', activeIndex: 1, householdName: 'Graves' });
    s = patchCaz(s, { lotTemplate: 'mansion' as never, difficulty: 'easy' as never, activeIndex: 9 }, catalog);
    expect(s).toMatchObject({ lotTemplate: 'empty', difficulty: 'grim', activeIndex: 1 });
    s = patchCaz(s, { activeIndex: -3 }, catalog);
    expect(s.activeIndex).toBe(0);
    s = patchCaz(s, { members: [] }, catalog);
    expect(s.members.length).toBe(2); // refusing to empty the household
  });

  it('finalizeCaz trims names and copies everything', () => {
    const s = caz([member({ firstName: '  Edna ', lastName: ' Graves  ' })], { householdName: ' Graves ' });
    const opts = finalizeCaz(s, -1);
    expect(opts.seed).toBe(4294967295);
    expect(opts.householdName).toBe('Graves');
    expect(opts.members[0].firstName).toBe('Edna');
    expect(opts.members[0].lastName).toBe('Graves');
    opts.members[0].traits.push('lazy');
    expect(s.members[0].traits.length).toBe(3);
  });
});
