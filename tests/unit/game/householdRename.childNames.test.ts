/**
 * Legal check 2026-11-12 (D-3 follow-up): the household rename follows the same rule as Create-a-Zombie — a child
 * profile (under CHILD_AGE_LIMIT) or one whose age question is unanswered picks the household name from the preset
 * list; only an answered teen / adult profile may type one. Enforced by the game layer, not only by the HUD.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { ProfileStoreImpl } from '../../../src/persistence/profileStore';
import { EconomyService } from '../../../src/economy/service';
import { CHILD_AGE_LIMIT } from '../../../src/shared/economy';
import { LAST_NAMES } from '../../../src/sim/content/people/names';
import { startedHarness } from './controllerHarness';

const NOW = Date.parse('2026-11-12T12:00:00Z');

async function economy(): Promise<EconomyService> {
  const b = createMemoryBackend();
  const now = () => NOW;
  const profile = new ProfileStoreImpl(() => Promise.resolve(b), { logger: { warn: () => undefined }, now });
  const econ = new EconomyService({ backend: () => Promise.resolve(b), profile, now, logger: { warn: () => undefined }, broadcast: false });
  await econ.init();
  return econ;
}

describe('household rename: preset names for child and unanswered profiles (game layer)', () => {
  it('unanswered and child profiles: typed names are refused (nothing dispatched); a preset name is accepted', async () => {
    const econ = await economy();
    expect(econ.age.bracket).toBe('unknown');
    const h = await startedHarness({ economy: econ });
    const sim = h.gameSim();
    const check = () => {
      const n = sim.dispatched.length;
      for (const typed of ['Bobby Tables', 'Emma S 4th grade', 'The Graves']) expect(h.game.renameHousehold(typed).ok, typed).toBe(false);
      expect(sim.dispatched.length).toBe(n);
      expect(h.game.renameHousehold(LAST_NAMES[3]).ok).toBe(true);
      expect(sim.dispatched.at(-1)).toEqual({ type: 'renameHousehold', name: LAST_NAMES[3] });
    };
    check(); // unanswered → fails closed
    expect(econ.answerAgeGate(new Date(NOW).getUTCFullYear() - (CHILD_AGE_LIMIT - 1))).toBe('ok');
    expect(econ.age.bracket).toBe('under13');
    check(); // child
  });

  it('no economy at all (boot, before the profile loads) fails closed too: typed names refused, a preset accepted', async () => {
    const h = await startedHarness(); // no economy
    const sim = h.gameSim();
    const n = sim.dispatched.length;
    for (const typed of ['Bobby Tables', 'The Graves']) expect(h.game.renameHousehold(typed).ok, typed).toBe(false);
    expect(sim.dispatched.length).toBe(n);
    expect(h.game.renameHousehold(LAST_NAMES[0]).ok).toBe(true);
  });

  it('an answered teen / adult profile keeps free text', async () => {
    const econ = await economy();
    expect(econ.answerAgeGate(new Date(NOW).getUTCFullYear() - (CHILD_AGE_LIMIT + 2))).toBe('ok');
    expect(['teen', 'adult']).toContain(econ.age.bracket);
    const h = await startedHarness({ economy: econ });
    expect(h.game.renameHousehold('  The Graves  ').ok).toBe(true);
    expect(h.gameSim().dispatched.at(-1)).toEqual({ type: 'renameHousehold', name: 'The Graves' });
  });
});

describe('household rename: the HUD offers presets instead of a text field for those profiles', () => {
  it('HouseholdDialog reads useFreeTextNames() and its rename <input> is only the free-text branch', () => {
    const s = readFileSync(new URL('../../../src/ui/hud/dialogs/HouseholdDialog.tsx', import.meta.url), 'utf8');
    expect(s).toMatch(/useFreeTextNames\(\)/);
    expect((s.match(/<PresetNameField\b/g) ?? []).length).toBe(1);
    expect(s).toMatch(/kind="household"/);
    // The one text <input> of the rename editor sits in the "then" branch of a freeText ternary (its wrapper span allowed).
    const inputs = [...s.matchAll(/(freeText \? \(\s*(?:<span\b[^>]*>\s*)?)?<input\b[^>]*?id="hud-rename-input"/gs)];
    expect(inputs.length).toBe(1);
    expect(inputs[0][1], 'rename <input> must be gated by freeText').toBeTruthy();
  });
});
