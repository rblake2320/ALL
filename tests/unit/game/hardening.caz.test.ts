/**
 * Adversarial Create-a-Zombie tests: the voice seed survives from CAZ to the new world (contract #17), Unicode
 * spoofing in names (bidi overrides, separators, lone surrogates, invisible-only names, look-alike duplicates), and
 * the household / appearance fields of validateCazDetailed (contract #19).
 */
import { describe, expect, it } from 'vitest';
import { cazIssues, finalizeCaz, nameProblem, sanitizeMemberPatch, validateCazState } from '../../../src/game/cazState';
import { buildCazCatalog, isUsableName } from '../../../src/game/gddCatalog';
import { initialCaz, randomZombie, rngFromSeed } from '../../../src/game/randomZombie';
import type { CazState } from '../../../src/game/contracts';
import { createHarness } from './controllerHarness';

const catalog = buildCazCatalog(null, null);

function caz(seed = 7): CazState {
  return initialCaz(seed, catalog);
}

describe('voice seed: CAZ preview voice = in-game voice (contract #17)', () => {
  it('random zombies carry a stable voiceSeed (deterministic per seed, finite non-negative integer)', () => {
    const a = randomZombie(rngFromSeed(42), catalog);
    const b = randomZombie(rngFromSeed(42), catalog);
    expect(a.voiceSeed).toBe(b.voiceSeed);
    expect(Number.isInteger(a.voiceSeed)).toBe(true);
    expect(a.voiceSeed!).toBeGreaterThanOrEqual(0);
    expect(a.voiceSeed!).toBeLessThan(2 ** 31);
  });

  it('a UI patch with a valid voiceSeed is kept; junk values are ignored', () => {
    const m = caz().members[0];
    expect(sanitizeMemberPatch(m, { voiceSeed: 123456 }).voiceSeed).toBe(123456);
    for (const junk of [Number.NaN, -1, 1.5, 2 ** 40, '77', null, Infinity, {}]) {
      expect(sanitizeMemberPatch(m, { voiceSeed: junk }).voiceSeed).toBe(m.voiceSeed);
    }
  });

  it('finalizeCaz passes the voiceSeed to createNewWorld', () => {
    const s = caz();
    const withSeed = { ...s, members: s.members.map((m) => ({ ...m, voiceSeed: 9999 })) };
    expect(finalizeCaz(withSeed, 1).members[0].voiceSeed).toBe(9999);
  });

  it('end to end: the seed the UI previewed is the one the new world receives', async () => {
    const h = await createHarness();
    h.game.beginNewGame();
    h.game.updateCazMember(0, { voiceSeed: 31337 });
    expect(h.game.caz!.members[0].voiceSeed).toBe(31337);
    h.env.randoms.push(0xabcdef);
    const p = h.game.startGame();
    await h.until(() => h.game.screen === 'game');
    await p;
    expect(h.simModule.worlds.at(-1)!.members[0].voiceSeed).toBe(31337);
  });

  it('re-rolling only the look / traits / name keeps the voice; "all" rolls a new one', async () => {
    const h = await createHarness();
    h.game.beginNewGame();
    h.game.updateCazMember(0, { voiceSeed: 4242 });
    for (const what of ['look', 'traits', 'name'] as const) {
      h.game.randomizeCazMember(0, what);
      expect(h.game.caz!.members[0].voiceSeed).toBe(4242);
    }
    h.game.randomizeCazMember(0, 'all');
    expect(h.game.caz!.members[0].voiceSeed).not.toBe(4242);
  });
});

describe('names: Unicode spoofing is rejected', () => {
  it('bidi embedding / override / isolate controls are treated as control characters', () => {
    for (const s of ['Mort\u202Eimer', '\u202DBob', 'Ed\u2066na', 'Opal\u2069', 'Ivy\u202A', 'Nell\u061C']) {
      expect(nameProblem(s)).toBe('control');
    }
  });

  it('line / paragraph separators and lone surrogates are rejected', () => {
    for (const s of ['Mort\u2028imer', 'Ed\u2029na', 'Bad\uD800', '\uDC00Ivy']) expect(nameProblem(s)).toBe('control');
    expect(nameProblem('Ghoul 🧟')).toBeNull(); // a real astral character is fine
  });

  it('names made only of invisible / blank-looking characters count as empty', () => {
    for (const s of ['\u3164', '\u115F\u1160', '\u2800\u2800', '\u00AD', '\u200E\u200F', '\uFFA0', '\u034F', '\u200B\u2060']) {
      expect(nameProblem(s)).toBe('empty');
    }
  });

  it('look-alike duplicate first names are caught (NFC/NFD, full-width, zero-width padding)', () => {
    const s = caz();
    const base = s.members[0];
    const pairs: [string, string][] = [
      ['José', 'Jose\u0301'],
      ['Bob', 'B\u200Bob'],
      ['ＢＯＢ', 'bob'],
      ['Edna', 'EDNA'],
    ];
    for (const [a, b] of pairs) {
      const st: CazState = { ...s, members: [{ ...base, firstName: a }, { ...base, firstName: b }] };
      expect(validateCazState(st, catalog).some((e) => /share the first name/.test(e))).toBe(true);
    }
  });

  it('isUsableName (content names) follows the same rules', () => {
    expect(isUsableName('Mort\u202Eimer')).toBe(false);
    expect(isUsableName('\u3164')).toBe(false);
    expect(isUsableName('Mortimer')).toBe(true);
  });
});

describe('validateCazDetailed field union (contract #19: household | appearance)', () => {
  it('household-level problems without an input of their own use field "household"', () => {
    const s = { ...caz(), lotTemplate: 'moonbase' as never, difficulty: 'impossible' as never };
    const issues = cazIssues(s, catalog);
    expect(issues.filter((i) => i.memberIndex === null).map((i) => i.field)).toEqual(['household', 'household']);
  });

  it('an empty household name stays on "householdName"; too many members is "household"', () => {
    const s0 = caz();
    const s = { ...s0, householdName: '  ', members: [...s0.members, ...s0.members, ...s0.members, ...s0.members, ...s0.members].map((m, i) => ({ ...m, firstName: `Z${i}` })) };
    const fields = cazIssues(s, catalog)
      .filter((i) => i.memberIndex === null)
      .map((i) => i.field);
    expect(fields).toContain('householdName');
    expect(fields).toContain('household');
  });

  it('a corrupt appearance is reported against field "appearance" of that member', () => {
    const s = caz();
    const bad = { ...s, members: [{ ...s.members[0], appearance: { ...s.members[0].appearance, hairStyle: 'mohawk-of-doom' as never } }] };
    const issues = cazIssues(bad, catalog);
    expect(issues).toEqual([{ memberIndex: 0, field: 'appearance', message: expect.stringMatching(/appearance/) }]);
  });
});
