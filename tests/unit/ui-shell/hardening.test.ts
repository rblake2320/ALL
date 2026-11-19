/**
 * Adversarial tests for helpers added while hardening UI-SHELL: save text/ids, turntable angle, aria-keyshortcuts,
 * focus-loss detection, game-over roster, default save names and the root type-scale math (kept in sync with CSS).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KEYMAP } from '../../../src/game/contracts';
import { dayLabel, isValidSlotId, newSaveSlotId, saveStatus, slotDisplayName } from '../../../src/ui/shell/saveText';
import { yawDegrees } from '../../../src/ui/shell/cazLogic';
import { ariaKeyShortcuts } from '../../../src/ui/common/hotkeys';
import { focusIsLost } from '../../../src/ui/hooks';
import { GAME_OVER_MAX_MEMBERS, gameOverSummary } from '../../../src/ui/shell/screens/GameOverScreen';
import { defaultSaveName } from '../../../src/ui/shell/dialogs/SaveLoadDialog';
import { SAVE_NAME_MAX } from '../../../src/ui/shell/data';
import {
  AUTO_BASE_PX,
  AUTO_VH,
  AUTO_VW,
  CAP_VH,
  CAP_VW,
  autoRootPx,
  clampUiScale,
  effectiveUiScale,
  rootFontPx,
} from '../../../src/ui/theme/scale';

/** Tiny deterministic PRNG for fuzzing. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
const GARBAGE: unknown[] = [undefined, null, NaN, Infinity, -Infinity, 0, -1, '', '   ', 'x', {}, [], () => 1, Symbol('s'), 1e308, -0];

describe('saveStatus (controller lastSaveLabel → sentence + tone)', () => {
  it('passes complete controller phrases through and prefixes bare times', () => {
    expect(saveStatus('Saved 12 min ago')).toEqual({ text: 'Saved 12 min ago', tone: 'ok' });
    expect(saveStatus('Saved just now')).toEqual({ text: 'Saved just now', tone: 'ok' });
    expect(saveStatus('12 minutes ago')).toEqual({ text: 'Last saved 12 minutes ago', tone: 'ok' });
    expect(saveStatus('  Saved   3 h   ago ').text).toBe('Saved 3 h ago');
  });
  it('flags failures and treats blanks as never saved', () => {
    expect(saveStatus('Save failed').tone).toBe('failed');
    expect(saveStatus('Autosave FAILED (disk full)').tone).toBe('failed');
    for (const g of [null, undefined, '', '   ', '\n\t']) expect(saveStatus(g as never)).toEqual({ text: 'Not saved yet', tone: 'never' });
    for (const g of GARBAGE) {
      const r = saveStatus(g as never);
      expect(typeof r.text).toBe('string');
      expect(r.text.length).toBeGreaterThan(0);
      expect(['ok', 'never', 'failed']).toContain(r.tone);
    }
  });
  it('never doubles the "Saved" prefix', () => {
    expect(saveStatus('saved 1 day ago').text.toLowerCase().match(/saved/g)?.length).toBe(1);
  });
  it('prefers the localisable lastSavedAt and the explicit failure flag', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    expect(saveStatus({ label: 'Saved 12 min ago', savedAt: now - 12 * 60_000 }, now)).toEqual({ text: 'Last saved 12 min ago', tone: 'ok' });
    expect(saveStatus({ savedAt: now - 5_000 }, now).text).toBe('Last saved just now');
    expect(saveStatus({ label: 'Saved 2 h ago', savedAt: now, failed: true }, now)).toEqual({ text: 'Saved 2 h ago', tone: 'failed' });
    expect(saveStatus({ failed: true }, now)).toEqual({ text: 'The last save failed', tone: 'failed' });
    // Garbage timestamps fall back to the label, then to "never".
    for (const bad of [NaN, Infinity, -5, 0, null, undefined, '123' as never]) {
      expect(saveStatus({ label: 'Saved 1 min ago', savedAt: bad as never }, now).text).toBe('Saved 1 min ago');
      expect(saveStatus({ savedAt: bad as never }, now).tone).toBe('never');
    }
    expect(saveStatus({ savedAt: now }, NaN).tone).toBe('never');
    expect(saveStatus(42 as never).tone).toBe('never');
  });
});

describe('slot ids', () => {
  it('validates like PLATFORM (lowercase, 1–40, no device names)', () => {
    for (const ok of ['save-abc', 'a', 'x'.repeat(40), 'auto-0000053a', 'emergency', 'save_1-2']) expect(isValidSlotId(ok)).toBe(true);
    const nonStrings = GARBAGE.filter((g) => typeof g !== 'string');
    for (const bad of ['', '   ', 'x'.repeat(41), 'Save-ABC', 'con', 'NUL', 'com1', 'lpt9', 'a b', 'a/b', '../x', 'é', ...nonStrings]) expect(isValidSlotId(bad)).toBe(false);
  });
  it('mints valid, unique, non-autosave ids even under collisions and garbage', () => {
    const r = rng(7);
    const taken: unknown[] = [...GARBAGE, 'SAVE-LH9', 42];
    for (let i = 0; i < 400; i++) {
      const now = i % 50 === 0 ? (GARBAGE[i % GARBAGE.length] as number) : Math.floor(r() * 4) * 1000; // many repeats
      const id = newSaveSlotId(taken, now);
      expect(isValidSlotId(id)).toBe(true);
      expect(id.startsWith('save-')).toBe(true);
      expect(id.startsWith('auto-') || id === 'emergency').toBe(false);
      expect(taken.map((x) => (typeof x === 'string' ? x.toLowerCase() : x))).not.toContain(id);
      taken.push(id);
    }
  });
  it('is case-insensitive about existing ids and tolerates non-arrays', () => {
    const base = newSaveSlotId([], 1_700_000_000_000);
    expect(newSaveSlotId([base.toUpperCase()], 1_700_000_000_000)).not.toBe(base);
    expect(isValidSlotId(newSaveSlotId(null, NaN))).toBe(true);
    expect(isValidSlotId(newSaveSlotId({ length: 3 } as never, Number.MAX_VALUE))).toBe(true);
  });
});

describe('slotDisplayName / dayLabel', () => {
  const slot = (o: Record<string, unknown>) => ({ slotId: 'save-1', name: '', isAutosave: false, meta: { householdName: '' }, ...o }) as never;
  it('drops the redundant autosave suffix only for autosaves', () => {
    expect(slotDisplayName(slot({ name: 'The Grimsbys (Autosave)', isAutosave: true }))).toBe('The Grimsbys');
    expect(slotDisplayName(slot({ name: 'The Grimsbys [auto-save]', isAutosave: true }))).toBe('The Grimsbys');
    expect(slotDisplayName(slot({ name: 'The Grimsbys (Autosave)', isAutosave: false }))).toBe('The Grimsbys (Autosave)');
  });
  it('falls back to household, then slot id, then a generic name', () => {
    expect(slotDisplayName(slot({ name: '   ', meta: { householdName: ' The Mossgraves ' } }))).toBe('The Mossgraves');
    expect(slotDisplayName(slot({ name: '(Autosave)', isAutosave: true }))).toBe('save-1');
    expect(slotDisplayName(slot({ name: null, slotId: '', meta: null }))).toBe('New save');
    expect(slotDisplayName(slot({ name: 'a\n\tb' }))).toBe('a b');
  });
  it('groups days and rejects garbage', () => {
    expect(dayLabel(9999)).toBe('Day 9,999');
    expect(dayLabel(12.9)).toBe('Day 12');
    expect(dayLabel(1)).toBe('Day 1');
    for (const g of [NaN, Infinity, '12', null, undefined, {}]) expect(dayLabel(g)).toBeNull();
  });
});

describe('defaultSaveName', () => {
  it('formats the day, collapses whitespace and respects the limit', () => {
    expect(defaultSaveName('The Grimsbys', 12)).toBe('The Grimsbys — Day 12');
    expect(defaultSaveName('  The   Grimsbys ', 9999)).toBe('The Grimsbys — Day 9,999');
    expect(defaultSaveName('', NaN)).toBe('New save');
    expect(defaultSaveName(null, 3)).toBe('Day 3');
    expect(Array.from(defaultSaveName('🧟'.repeat(80), 5)).length).toBeLessThanOrEqual(SAVE_NAME_MAX);
    for (const g of GARBAGE) expect(typeof defaultSaveName(g as never, g as never)).toBe('string');
  });
});

describe('yawDegrees (turntable aria-valuenow)', () => {
  it('maps radians to whole degrees in [0, 360)', () => {
    expect(yawDegrees(0)).toBe(0);
    expect(yawDegrees(Math.PI / 12)).toBe(15);
    expect(yawDegrees(-Math.PI / 12)).toBe(345);
    expect(yawDegrees(Math.PI)).toBe(180);
    expect(yawDegrees(2 * Math.PI)).toBe(0);
    expect(yawDegrees(-0)).toBe(0);
    expect(Object.is(yawDegrees(-1e-9), -0)).toBe(false);
  });
  it('stays in range for any input', () => {
    const r = rng(11);
    for (let i = 0; i < 2000; i++) {
      const v = (r() - 0.5) * 1e6;
      const d = yawDegrees(v);
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(360);
    }
    for (const g of [NaN, Infinity, -Infinity]) expect(yawDegrees(g)).toBe(0);
  });
});

describe('ariaKeyShortcuts', () => {
  it('maps KEYMAP combos to UI Events key names', () => {
    expect(ariaKeyShortcuts('Escape')).toBe('Escape');
    expect(ariaKeyShortcuts('ctrl+KeyZ')).toBe('Control+Z');
    expect(ariaKeyShortcuts(['ctrl+KeyY', 'ctrl+shift+KeyZ'])).toBe('Control+Y Control+Shift+Z');
    expect(ariaKeyShortcuts(['F5', 'ctrl+KeyS'])).toBe('F5 Control+S');
    expect(ariaKeyShortcuts('Digit4')).toBe('4');
    expect(ariaKeyShortcuts('shift+Slash')).toBe('Shift+/');
    expect(ariaKeyShortcuts(['Minus', 'NumpadSubtract'])).toBe('-');
  });
  it('covers every KEYMAP binding with a non-empty, space-free value per shortcut', () => {
    for (const combos of Object.values(KEYMAP)) {
      const v = ariaKeyShortcuts(combos);
      expect(v).toBeTruthy();
      for (const part of v!.split(' ')) expect(part.length).toBeGreaterThan(0);
    }
  });
  it('skips garbage and returns undefined when nothing is usable', () => {
    for (const g of [...GARBAGE, 'ctrl+', '+', 'hyper+KeyA', ['', 'ctrl++']]) expect(ariaKeyShortcuts(g as never)).toBeUndefined();
    expect(ariaKeyShortcuts(['nope', 'KeyQ'])).toBe('Q');
    expect(ariaKeyShortcuts('MediaPlayPause')).toBeUndefined();
  });
});

describe('focusIsLost', () => {
  const body = { id: 'body' };
  const html = { id: 'html' };
  it('detects body/html/null/detached focus and leaves real focus alone', () => {
    expect(focusIsLost({ activeElement: null, body, documentElement: html } as never)).toBe(true);
    expect(focusIsLost({ activeElement: body, body, documentElement: html } as never)).toBe(true);
    expect(focusIsLost({ activeElement: html, body, documentElement: html } as never)).toBe(true);
    expect(focusIsLost({ activeElement: { isConnected: false }, body, documentElement: html } as never)).toBe(true);
    expect(focusIsLost({ activeElement: { isConnected: true }, body, documentElement: html } as never)).toBe(false);
    expect(focusIsLost(null)).toBe(false);
  });
});

describe('gameOverSummary roster', () => {
  const sim = (members: unknown) =>
    ({ sim: { state: { household: { name: 'The Grimsbys', funds: 1 }, stats: { counters: {} } }, time: () => ({ day: 1 }), household: () => members } }) as never;
  it('dedupes, drops garbage and derives first names', () => {
    const r = gameOverSummary(
      sim([
        { id: 'a1', name: 'Mortimer Grimsby', firstName: 'Mortimer', appearance: {} },
        { id: 'a1', name: 'Duplicate', firstName: 'Dup' },
        null,
        7,
        { name: 'No id' },
        { id: 'a2', name: '  Ophelia   Grimsby ' },
        { id: 'a3', name: '', firstName: '' },
        { id: 'a4', name: 42, firstName: null },
      ]),
    );
    expect(r.members.map((m) => [m.id, m.firstName])).toEqual([
      ['a1', 'Mortimer'],
      ['a2', 'Ophelia'],
      ['a3', 'Unnamed'],
      ['a4', 'Unnamed'],
    ]);
    expect(r.members[2].name).toBe('Unnamed zombie');
  });
  it('keeps every member (the screen shows the first eight and a "+N" chip)', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, name: `Zombie ${i}`, firstName: `Z${i}` }));
    const r = gameOverSummary(sim(many));
    expect(r.members).toHaveLength(20);
    expect(GAME_OVER_MAX_MEMBERS).toBe(8);
  });
  it('survives non-array household()', () => {
    for (const g of [null, undefined, 'x', { length: 2 }, 5]) expect(gameOverSummary(sim(g)).members).toEqual([]);
  });
});

describe('root type scale (mirrors tokens.css + base.css)', () => {
  it('keeps the CSS constants in sync with scale.ts', () => {
    const tokens = readFileSync(new URL('../../../src/ui/theme/tokens.css', import.meta.url), 'utf8');
    const base = readFileSync(new URL('../../../src/ui/theme/base.css', import.meta.url), 'utf8');
    expect(tokens).toContain(`--ui-auto-size: calc(${AUTO_BASE_PX}px + var(--ui-zoom) * min(${AUTO_VH}vh, ${AUTO_VW}vw))`);
    expect(base).toContain(`font-size: max(min(calc(var(--ui-auto-size) * var(--ui-scale)), calc(${CAP_VW}vw * var(--ui-zoom)), calc(${CAP_VH}vh * var(--ui-zoom))), `);
  });
  it('leaves 100% untouched on every supported window and caps 140% on small ones', () => {
    for (const [w, h] of [[1024, 640], [1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440], [3440, 1440]]) {
      expect(rootFontPx(w, h, 1)).toBeCloseTo(autoRootPx(w, h), 6);
    }
    expect(rootFontPx(1280, 720, 1)).toBeCloseTo(13.6, 2);
    expect(rootFontPx(1920, 1080, 1)).toBeCloseTo(16, 2);
    expect(rootFontPx(1920, 1080, 1.4)).toBeCloseTo(22.4, 2); // big window: the full 140%
    expect(rootFontPx(1280, 720, 1.4)).toBeLessThanOrEqual(16.0001); // ≈ 118% instead of a broken 140%
    expect(effectiveUiScale(1280, 720, 1.4)).toBeLessThan(1.2);
    expect(effectiveUiScale(1280, 720, 1.4)).toBeGreaterThan(1.1);
  });
  it('is monotonic in the requested scale and never exceeds it', () => {
    const r = rng(3);
    for (let i = 0; i < 500; i++) {
      const w = 600 + r() * 3000;
      const h = 400 + r() * 1800;
      const a = 0.8 + r() * 0.6;
      const b = Math.min(1.4, a + r() * 0.3);
      expect(rootFontPx(w, h, b)).toBeGreaterThanOrEqual(rootFontPx(w, h, a) - 1e-9);
      expect(effectiveUiScale(w, h, a)).toBeLessThanOrEqual(clampUiScale(a) + 1e-9);
    }
  });
  it('clamps garbage like applyThemeSettings', () => {
    expect(clampUiScale(NaN)).toBe(1);
    expect(clampUiScale(9)).toBe(1.4);
    expect(clampUiScale(-3)).toBe(0.8);
    for (const g of [NaN, Infinity, -Infinity]) {
      expect(Number.isFinite(rootFontPx(g, g, g))).toBe(true);
      expect(Number.isFinite(effectiveUiScale(1280, 720, g))).toBe(true);
    }
  });
  it('keeps the smallest text legible: px floors on the caption sizes', () => {
    const tokens = readFileSync(new URL('../../../src/ui/theme/tokens.css', import.meta.url), 'utf8');
    const floor = (name: string) => Number(new RegExp(`--${name}: max\\([0-9.]+rem, ([0-9.]+)px\\)`).exec(tokens)?.[1]);
    expect(floor('fs-2xs')).toBeGreaterThanOrEqual(9.5);
    expect(floor('fs-xs')).toBeGreaterThanOrEqual(10);
    expect(floor('fs-sm')).toBeGreaterThanOrEqual(10.5);
    expect(floor('fs-md')).toBeGreaterThanOrEqual(11.5);
    // At 80% on 720p the rem-based caption would be ~7.5px without the floor.
    expect(0.6875 * rootFontPx(1280, 720, 0.8)).toBeLessThan(9.5);
  });
});

describe('content adapters tolerate a hostile registry', () => {
  it('traitList / aspirationList never throw and never leak reward traits', async () => {
    const { traitList, aspirationList } = await import('../../../src/ui/shell/data');
    const content = {
      traits: {
        a: null,
        b: { id: 7 },
        c: { id: 'grumpy', name: '', description: undefined, icon: undefined, conflicts: 'cheerful', reward: false },
        d: { id: 'ironStitches', name: 'Iron Stitches', reward: true, conflicts: [] },
        e: { id: 'cheerful', name: 'Cheerful', conflicts: ['grumpy', 5, null], reward: false },
      },
      aspirations: {
        x: null,
        y: { id: 'tycoon', name: 'Tycoon', milestones: [null, 3, { id: 'm1', label: 'Have $5k', points: 250 }, { id: 'm2', points: NaN }, { label: 'no id' }] },
        z: { id: 'empty', name: 'Empty', milestones: 'nope' },
      },
    } as never;
    const traits = traitList(content);
    expect(traits.map((t) => t.id)).toEqual(['grumpy', 'cheerful']);
    expect(traits[0].name).toBe('grumpy');
    expect(traits[0].conflicts).toEqual([]);
    expect(traits[1].conflicts).toEqual(['grumpy']);
    const asps = aspirationList(content);
    expect(asps.map((a) => a.id)).toEqual(['tycoon', 'empty']);
    expect(asps[0].milestones).toEqual([
      { id: 'm1', label: 'Have $5k', points: 250 },
      { id: 'm2', label: 'm2', points: 0 },
    ]);
    expect(asps[1].milestones).toEqual([]);
  });
});
