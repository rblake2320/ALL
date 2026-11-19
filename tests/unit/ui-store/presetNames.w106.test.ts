/**
 * Security review 2026-11-05 D-3 / L-7: under-13 (and unanswered) profiles pick zombie / household / save names from
 * presets instead of typing them; 13+ keeps free text. And an exported `.alsave` carries no personal data beyond
 * those names.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIRST_NAMES, LAST_NAMES } from '../../../src/sim/content/people/names';
import { freeTextNamesAllowed, presetNames } from '../../../src/ui/shell/PresetNameField';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { utf8DecodeStrict } from '../../../src/persistence/bytes';
import { makeMeta, makeWorld } from '../persistence/fixtures';
import { hasString } from '../../../src/i18n';

const src = (rel: string) => readFileSync(new URL(`../../../src/ui/shell/${rel}`, import.meta.url), 'utf8');

describe('D-3 preset names for under-13', () => {
  it('free text only for answered 13+ profiles; under-13, unanswered and no economy yet all fail closed to presets', () => {
    expect(freeTextNamesAllowed({ age: { bracket: 'under13' } })).toBe(false);
    expect(freeTextNamesAllowed({ age: { bracket: 'unknown' } })).toBe(false);
    expect(freeTextNamesAllowed({ age: { bracket: 'teen' } })).toBe(true);
    expect(freeTextNamesAllowed({ age: { bracket: 'adult' } })).toBe(true);
    expect(freeTextNamesAllowed(null)).toBe(false); // no economy yet (boot): fails closed
  });

  it('the presets are the existing sim people name pools (plus generated defaults first, de-duplicated)', () => {
    expect(presetNames('first')).toEqual(FIRST_NAMES.filter((n, i, a) => a.indexOf(n) === i));
    expect(presetNames('last')).toEqual(LAST_NAMES.filter((n, i, a) => a.indexOf(n) === i));
    expect(presetNames('household', ['Gravesby'])).toEqual(presetNames('household'));
    const save = presetNames('save', ['The Gravesbys — Day 3']);
    expect(save[0]).toBe('The Gravesbys — Day 3');
    expect(save.length).toBeGreaterThan(3);
    for (const k of ['names.presetHint', 'saveLoad.preset.main', 'saveLoad.preset.backup']) expect(hasString(k)).toBe(true);
  });

  it('every name field (first, last, household, save) is a TextInput only behind the free-text check', () => {
    const files: Record<string, number> = { 'screens/caz/CazLookTabs.tsx': 2, 'screens/CreateZombieScreen.tsx': 1, 'dialogs/SaveLoadDialog.tsx': 1 };
    for (const [f, count] of Object.entries(files)) {
      const s = src(f);
      expect(s, f).toMatch(/useFreeTextNames\(\)/);
      expect((s.match(/<PresetNameField\b/g) ?? []).length, f).toBe(count);
      // Each name TextInput is the "then" branch of a free-text ternary.
      const nameInputs = [...s.matchAll(/(\{?freeText(?:Names)? \? \(?\s*)?<TextInput\b[^>]*?label=\{t\('(caz\.firstName|caz\.lastName|caz\.householdName|saveLoad\.newSave)'\)/gs)];
      expect(nameInputs.length, f).toBe(count);
      for (const m of nameInputs) expect(m[1], `${f}: ${m[2]} must be gated`).toBeTruthy();
    }
  });
});

describe('D-3 / L-7 an exported .alsave carries no PII beyond the (preset) names', () => {
  it('the envelope has only game data: no account, device, path, e-mail or birth year fields', async () => {
    const mgr = new SaveManagerImpl({ backend: createMemoryBackend(), logger: { warn: () => undefined, error: () => undefined }, compress: false, now: () => Date.parse('2026-11-05T12:00:00Z') });
    expect((await mgr.save('s1', 'Main save', makeWorld(), makeMeta())).ok).toBe(true);
    const ex = await mgr.exportSlot('s1');
    const env = JSON.parse(utf8DecodeStrict(ex!.data)) as Record<string, unknown>;
    const text = JSON.stringify(env);
    for (const bad of [/birth/i, /e-?mail/i, /user(name)?\b/i, /account/i, /device/i, /[A-Z]:\\\\/, /\/home\//, /\/Users\//]) expect(text, String(bad)).not.toMatch(bad);
    const meta = env.meta as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(['day', 'funds', 'householdName', 'lotValue', 'memberNames', 'thumbnail', 'timeLabel']);
    // The age bracket / profile never travels with a save.
    expect(text).not.toMatch(/under13|bracket|decidedAt|economy-age/);
  });
});
