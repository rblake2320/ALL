import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetI18nForTests, hasString, interpolate, registerStrings, t } from '../../../src/i18n';
import { en } from '../../../src/i18n/en';
import { KEYMAP } from '../../../src/game/contracts';
import { ACCESSORIES, BOTTOM_STYLES, EYE_STYLES, HAIR_STYLES, SKIN_TONES, TOP_STYLES } from '../../../src/shared/appearance';
import { CLOTHES_COLORS, EYE_COLORS, HAIR_COLORS, LOADING_TIP_COUNT, SHOE_COLORS } from '../../../src/ui/shell/data';
import { KEY_GROUPS } from '../../../src/ui/shell/KeyMapTable';

afterEach(() => _resetI18nForTests({ warn: () => {} }));

describe('t()', () => {
  it('looks up and interpolates', () => {
    expect(t('menu.continue')).toBe('Continue');
    expect(t('menu.continueDetail', { household: 'The Grimsbys', day: 12 })).toBe('The Grimsbys · Day 12');
  });
  it('returns the key for missing strings and warns once', () => {
    const warn = vi.fn();
    _resetI18nForTests({ warn });
    expect(t('nope.missing')).toBe('nope.missing');
    expect(t('nope.missing')).toBe('nope.missing');
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('is not fooled by prototype keys', () => {
    _resetI18nForTests({ warn: () => {} });
    for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(t(k)).toBe(k);
    expect(hasString('constructor')).toBe(false);
  });
  it('chooses plural forms by count', () => {
    expect(t('saveLoad.count', { count: 1 })).toBe('1 save');
    expect(t('saveLoad.count', { count: 0 })).toBe('0 saves');
    expect(t('saveLoad.count', { count: 7 })).toBe('7 saves');
    expect(t('saveLoad.count', { count: NaN })).toBe('saveLoad.count');
  });
  it('leaves unknown or nullish params visible and never prints NaN', () => {
    expect(interpolate('Hi {name} {missing}', { name: 'Edna' })).toBe('Hi Edna {missing}');
    expect(interpolate('{a}{b}', { a: null, b: undefined })).toBe('{a}{b}');
    expect(interpolate('{n}', { n: NaN })).toBe('—');
    expect(interpolate('{n}', { n: 0 })).toBe('0');
    expect(interpolate('no params {x}')).toBe('no params {x}');
    expect(interpolate('{not a param} {1x}', { 'not a param': 'x' })).toBe('{not a param} {1x}');
    expect(interpolate('{constructor}', {})).toBe('{constructor}');
  });
  it('lets other modules register strings that win over the base dictionary', () => {
    registerStrings({ 'hud.funds': 'Funds', 'menu.continue': 'Keep going', bad: 42 as unknown as string });
    expect(t('hud.funds')).toBe('Funds');
    expect(t('menu.continue')).toBe('Keep going');
    expect(hasString('bad')).toBe(false);
    registerStrings(null as never);
  });
});

describe('dictionary coverage', () => {
  const root = resolve(__dirname, '../../../src/ui');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'hud' || name === 'dev') continue;
        walk(p);
      } else if (/\.(tsx?|ts)$/.test(name)) files.push(p);
    }
  };
  walk(root);
  it('every literal t("…") key used by the shell exists', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        const key = m[1];
        if (!hasString(key)) missing.push(`${key} (${f.split('/src/')[1]})`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('dynamic key families are complete', () => {
    const need: string[] = [];
    for (const g of KEY_GROUPS) need.push(`keys.group.${g.id}`);
    for (const a of Object.keys(KEYMAP)) need.push(`keys.${a}`);
    for (const s of HAIR_STYLES) need.push(`caz.hair.${s}`);
    for (const s of EYE_STYLES) need.push(`caz.eye.${s}`);
    for (const s of TOP_STYLES) need.push(`caz.topStyle.${s}`);
    for (const s of BOTTOM_STYLES) need.push(`caz.bottomStyle.${s}`);
    for (const s of ACCESSORIES) need.push(`caz.acc.${s}`);
    SKIN_TONES.forEach((_, i) => need.push(`caz.skin.${i}`));
    for (const c of [...HAIR_COLORS, ...EYE_COLORS, ...CLOTHES_COLORS, ...SHOE_COLORS]) need.push(`color.${c.id}`);
    for (let i = 1; i <= LOADING_TIP_COUNT; i++) need.push(`loading.tip.${i}`);
    for (const id of ['identity', 'body', 'hair', 'outfit', 'personality', 'voice']) need.push(`caz.tab.${id}`);
    for (const id of ['idle', 'walk', 'dance', 'wave', 'laugh', 'groan']) need.push(`caz.pose.${id}`);
    for (const id of ['look', 'traits', 'name', 'all']) need.push(`caz.random.${id}`, `caz.random.${id}Tip`);
    for (const id of ['happy', 'laugh', 'question', 'flirty', 'angry']) need.push(`caz.voiceSample.${id}`);
    for (const id of ['graphics', 'audio', 'gameplay', 'controls', 'accessibility']) need.push(`settings.tab.${id}`);
    for (const id of ['master', 'music', 'sfx', 'voice', 'ambient', 'ui']) need.push(`settings.vol.${id}`);
    for (const id of ['low', 'medium', 'high', 'ultra']) need.push(`settings.quality.${id}`);
    for (const id of ['full', 'limited', 'off']) need.push(`settings.autonomy.${id}`, `settings.autonomy.${id}.desc`);
    for (const id of ['relaxed', 'normal', 'grim']) need.push(`newGame.difficulty.${id}`, `newGame.difficulty.${id}.desc`);
    for (const lot of ['derelict', 'starter', 'empty']) for (const k of ['name', 'tag', 'desc', 'f1', 'f2', 'f3']) need.push(`newGame.lot.${lot}.${k}`);
    for (const id of ['needs', 'decay', 'limbs', 'bills', 'careers', 'building']) need.push(`help.${id}.title`, `help.${id}.text`);
    for (const id of ['three', 'preact', 'vite', 'blender', 'typescript']) need.push(`credits.${id}`, `credits.${id}Role`);
    for (const id of ['limbsLost', 'mealsCooked', 'partiesThrown', 'billsPaid']) need.push(`gameOver.${id}`);
    for (const id of ['hunger', 'energy', 'preservation', 'social', 'fun', 'hygiene']) need.push(`need.${id}`);
    for (const id of ['miserable', 'uneasy', 'fine', 'good', 'great']) need.push(`mood.${id}`);
    expect(need.filter((k) => !hasString(k))).toEqual([]);
  });
  it('has no empty strings and balanced placeholders', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(v.trim().length, k).toBeGreaterThan(0);
      expect((v.match(/\{/g) ?? []).length, k).toBe((v.match(/\}/g) ?? []).length);
    }
  });
});
