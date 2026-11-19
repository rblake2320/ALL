import { describe, expect, it } from 'vitest';
import { KEYMAP, type DialogId, type GameController } from '../../../src/game/contracts';
import type { SaveSlotInfo } from '../../../src/persistence/contracts';
import { poseExpression, sanitizeTraits, toggleTrait, traitBlockReason, voiceSeed, wrapYaw } from '../../../src/ui/shell/cazLogic';
import {
  aspirationList,
  FALLBACK_ASPIRATIONS,
  FALLBACK_TRAITS,
  startingFunds,
  traitList,
  CLOTHES_COLORS,
  EYE_COLORS,
  HAIR_COLORS,
  SHOE_COLORS,
} from '../../../src/ui/shell/data';
import { _navState, _resetNav, closeAllShellDialogs, closeShellDialog, openChildDialog, openRootDialog, requestedSaveLoadMode, syncNav } from '../../../src/ui/shell/nav';
import { groupedActions } from '../../../src/ui/shell/KeyMapTable';
import { latestSave } from '../../../src/ui/shell/screens/MainMenu';
import { nextTipIndex } from '../../../src/ui/shell/screens/LoadingScreen';
import { defaultSaveName, sortSlots } from '../../../src/ui/shell/dialogs/SaveLoadDialog';
import { mergeVolumes } from '../../../src/ui/shell/dialogs/SettingsDialog';
import { readDiagnostics } from '../../../src/ui/shell/dialogs/DiagnosticsDialog';
import { gameOverSummary } from '../../../src/ui/shell/screens/GameOverScreen';
import { isShellDialog, SHELL_DIALOGS } from '../../../src/ui/shell/ShellDialogs';
import { applyThemeSettings } from '../../../src/ui/theme';
import { parseHex } from '../../../src/ui/common/color';

const traits = FALLBACK_TRAITS;

describe('trait rules', () => {
  it('adds, removes and caps at three', () => {
    let sel: string[] = [];
    sel = toggleTrait(sel, 'gourmand', traits);
    sel = toggleTrait(sel, 'bookworm', traits);
    sel = toggleTrait(sel, 'artistic', traits);
    expect(sel).toEqual(['gourmand', 'bookworm', 'artistic']);
    expect(toggleTrait(sel, 'vain', traits)).toEqual(sel);
    expect(traitBlockReason('vain', sel, traits)).toEqual({ kind: 'full' });
    expect(toggleTrait(sel, 'bookworm', traits)).toEqual(['gourmand', 'artistic']);
  });
  it('blocks conflicts in both directions', () => {
    expect(traitBlockReason('slob', ['neatFreak'], traits)).toEqual({ kind: 'conflict', withId: 'neatFreak' });
    expect(traitBlockReason('neatFreak', ['slob'], traits)).toEqual({ kind: 'conflict', withId: 'slob' });
    expect(traitBlockReason('cheerful', ['hothead'], traits)).toEqual({ kind: 'conflict', withId: 'hothead' });
    expect(traitBlockReason('hothead', ['cheerful'], traits)).toEqual({ kind: 'conflict', withId: 'cheerful' });
    expect(toggleTrait(['lazy'], 'ambitious', traits)).toEqual(['lazy']);
    expect(traitBlockReason('lazy', ['lazy'], traits)).toBeNull();
  });
  it('rejects reward and unknown traits', () => {
    expect(toggleTrait([], 'ironStitches', traits)).toEqual([]);
    expect(toggleTrait([], 'notATrait', traits)).toEqual([]);
    expect(toggleTrait(null as never, 'gourmand', traits)).toEqual(['gourmand']);
  });
  it('sanitizes saved selections', () => {
    expect(sanitizeTraits(['gourmand', 'gourmand', 'slob', 'neatFreak', 'ironStitches', 7, null, 'vain', 'lazy'], traits)).toEqual(['gourmand', 'slob', 'vain']);
    expect(sanitizeTraits('nope' as never, traits)).toEqual([]);
  });
});

describe('fallback content mirrors the GDD', () => {
  it('has the 18 selectable + 5 reward traits with symmetric conflicts', () => {
    expect(traits.filter((x) => !x.reward)).toHaveLength(18);
    expect(traits.filter((x) => x.reward).map((x) => x.id).sort()).toEqual(['castIronStomach', 'deepSleeper', 'ironStitches', 'silverTongue', 'wellPreserved']);
    for (const tr of traits) for (const c of tr.conflicts) expect(traits.find((x) => x.id === c)?.conflicts, `${tr.id}↔${c}`).toContain(tr.id);
  });
  it('has the five aspirations with four milestones each', () => {
    expect(FALLBACK_ASPIRATIONS.map((a) => a.id)).toEqual(['tycoon', 'afterparty', 'eternalRomance', 'masterPreserver', 'renaissanceCorpse']);
    for (const a of FALLBACK_ASPIRATIONS) expect(a.milestones).toHaveLength(4);
  });
  it('prefers live content and hides reward traits', () => {
    const content = {
      traits: { odd: { id: 'odd', name: 'Odd', description: '', icon: 'star', conflicts: [5, 'x'], reward: false }, rich: { id: 'rich', name: 'Rich', description: '', icon: 'money', conflicts: [], reward: true } },
      aspirations: { a: { id: 'a', name: 'A', description: 'd', icon: 'star', milestones: [{ id: 'm', label: 'L', points: 5, condition: { kind: 'k', params: {} } }] } },
    } as never;
    expect(traitList(content)).toEqual([{ id: 'odd', name: 'Odd', description: '', icon: 'star', conflicts: ['x'], reward: false }]);
    expect(aspirationList(content)[0].milestones).toEqual([{ id: 'm', label: 'L', points: 5 }]);
    expect(traitList(null)).toHaveLength(18);
    expect(aspirationList({ aspirations: {} } as never)).toBe(FALLBACK_ASPIRATIONS);
  });
  it('computes starting funds per GDD §6', () => {
    expect(startingFunds('starter', 1)).toBe(6500);
    expect(startingFunds('empty', 1)).toBe(22000);
    expect(startingFunds('starter', 4)).toBe(8000);
    expect(startingFunds('starter', 99)).toBe(8000);
    expect(startingFunds('empty', NaN)).toBe(22000);
    expect(startingFunds('bogus' as never, 2)).toBe(7000);
  });
  it('palettes are valid hex colours with unique ids', () => {
    for (const list of [HAIR_COLORS, EYE_COLORS, CLOTHES_COLORS, SHOE_COLORS]) {
      expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
      for (const c of list) expect(parseHex(c.value)).not.toBeNull();
    }
  });
});

describe('caz helpers', () => {
  it('voice seeds are stable, bounded and identity-sensitive', () => {
    const a = voiceSeed('Mortimer', 'Grimsby', 0);
    expect(a).toBe(voiceSeed('Mortimer', 'Grimsby', 0));
    expect(a).not.toBe(voiceSeed('Mortimer', 'Grimsby', 1));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1_000_000);
    expect(Number.isInteger(voiceSeed(null as never, undefined as never, NaN))).toBe(true);
  });
  it('wraps yaw into (-π, π]', () => {
    expect(wrapYaw(0)).toBe(0);
    expect(wrapYaw(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapYaw(-Math.PI * 3.5)).toBeCloseTo(Math.PI / 2);
    expect(wrapYaw(NaN)).toBe(0);
    expect(wrapYaw(Infinity)).toBe(0);
  });
  it('maps poses to expressions', () => {
    expect(poseExpression('laugh')).toBe('happy');
    expect(poseExpression('groan')).toBe('sleepy');
    expect(poseExpression('whatever')).toBe('neutral');
  });
});

/** Controller double. `withOptions` = implements dialogOptions/openDialog(d, opts) (current contract). */
function fakeGame(initial: DialogId = null, withOptions = false) {
  const g = {
    dialog: initial,
    dialogOptions: withOptions ? (null as { returnTo?: DialogId; mode?: 'save' | 'load' } | null) : undefined,
    opened: [] as { d: DialogId; o?: unknown }[],
    openDialog(d: DialogId, o?: { returnTo?: DialogId; mode?: 'save' | 'load' }) {
      g.dialog = d;
      if (withOptions) g.dialogOptions = o ?? null;
      g.opened.push({ d, o });
    },
    closeDialog() {
      g.dialog = null;
      if (withOptions) g.dialogOptions = null;
    },
  };
  return g as typeof g & GameController;
}

describe('dialog navigation', () => {
  it('returns from a child dialog to its parent', () => {
    _resetNav();
    const g = fakeGame('pause');
    syncNav('pause');
    openChildDialog(g, 'settings');
    syncNav(g.dialog);
    expect(g.dialog).toBe('settings');
    closeShellDialog(g);
    expect(g.dialog).toBe('pause');
    closeShellDialog(g);
    expect(g.dialog).toBeNull();
  });
  it('remembers the requested save/load mode only for that open', () => {
    _resetNav();
    const g = fakeGame('pause');
    openChildDialog(g, 'saveLoad', { saveLoadMode: 'load' });
    expect(requestedSaveLoadMode()).toBe('load');
    closeShellDialog(g);
    expect(requestedSaveLoadMode()).toBeNull();
  });
  it('forgets the parent when the controller switches dialogs itself', () => {
    _resetNav();
    const g = fakeGame('pause');
    openChildDialog(g, 'help');
    g.dialog = 'phone';
    syncNav('phone');
    expect(_navState().parent).toBeNull();
    closeShellDialog(g);
    expect(g.dialog).toBeNull();
  });
  it('root dialogs and close-all never bounce back', () => {
    _resetNav();
    const g = fakeGame(null);
    openRootDialog(g, 'credits');
    closeShellDialog(g);
    expect(g.dialog).toBeNull();
    openChildDialog(g, 'settings');
    closeAllShellDialogs(g);
    expect(g.dialog).toBeNull();
    expect(_navState()).toEqual({ parent: null, child: null, saveLoadMode: null });
  });
  it('passes returnTo/mode to the controller and honours its dialogOptions', () => {
    _resetNav();
    const g = fakeGame('pause', true);
    openChildDialog(g, 'saveLoad', { saveLoadMode: 'save' });
    expect(g.opened.at(-1)).toEqual({ d: 'saveLoad', o: { returnTo: 'pause', mode: 'save' } });
    expect(requestedSaveLoadMode(g)).toBe('save');
    _resetNav(); // local mirror lost (e.g. reload) — controller options still bring us back
    closeShellDialog(g);
    expect(g.dialog).toBe('pause');
    openRootDialog(g, 'credits');
    expect(g.opened.at(-1)).toEqual({ d: 'credits', o: undefined });
    closeShellDialog(g);
    expect(g.dialog).toBeNull();
  });
  it('ignores a self-referencing returnTo', () => {
    _resetNav();
    const g = fakeGame(null, true);
    g.openDialog('settings', { returnTo: 'settings' });
    closeShellDialog(g);
    expect(g.dialog).toBeNull();
  });
  it('knows which dialogs belong to the shell', () => {
    expect(SHELL_DIALOGS).toHaveLength(7);
    for (const d of ['settings', 'saveLoad', 'pause', 'help', 'confirmQuit', 'credits', 'diagnostics'] as const) expect(isShellDialog(d)).toBe(true);
    for (const d of ['phone', 'careers', 'invite', 'rewards', 'household', null] as const) expect(isShellDialog(d)).toBe(false);
  });
});

const slot = (id: string, savedAt: unknown, extra: Partial<SaveSlotInfo> = {}) =>
  ({ slotId: id, name: id, savedAt, createdAt: '', playMinutes: 0, isAutosave: false, recoveredFromBackup: false, bytes: 1, meta: { householdName: 'H', memberNames: [], day: 1, timeLabel: '', funds: 0, lotValue: 0, thumbnail: null }, ...extra }) as SaveSlotInfo;

describe('save helpers', () => {
  it('sorts newest first, sinks bad dates, drops garbage', () => {
    const list = [slot('a', '2026-01-01T00:00:00Z'), slot('b', 'garbage'), null, slot('c', '2026-03-01T00:00:00Z'), { nope: 1 }, slot('d', 12)];
    expect(sortSlots(list as never).map((s) => s.slotId)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortSlots(null)).toEqual([]);
  });
  it('picks the latest save for Continue', () => {
    expect(latestSave([slot('a', '2026-01-01T00:00:00Z'), slot('b', '2026-02-01T00:00:00Z')])?.slotId).toBe('b');
    expect(latestSave([slot('x', 'bad'), slot('y', 'worse')])?.slotId).toBe('x');
    expect(latestSave([])).toBeNull();
    expect(latestSave(undefined)).toBeNull();
    expect(latestSave([null, 5] as never)).toBeNull();
  });
  it('builds default save names within the limit', () => {
    expect(defaultSaveName('The Grimsbys', 12)).toBe('The Grimsbys — Day 12');
    expect(defaultSaveName('', NaN)).toBe('New save');
    expect(defaultSaveName(null, 3)).toBe('Day 3');
    expect(Array.from(defaultSaveName('x'.repeat(100), 1)).length).toBeLessThanOrEqual(40);
  });
});

describe('misc shell helpers', () => {
  it('tips never repeat back-to-back', () => {
    for (let cur = 0; cur < 14; cur++) for (const r of [0, 0.3, 0.999, 1, -1, NaN]) {
      const n = nextTipIndex(cur, 14, r);
      expect(n).not.toBe(cur);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(14);
    }
    expect(nextTipIndex(5, 1, 0.5)).toBe(0);
    expect(nextTipIndex(NaN, 0, 0.5)).toBe(0);
  });
  it('merges volume changes without losing channels', () => {
    const v = mergeVolumes({ master: 0.2 }, 'music', 0.9);
    expect(v.master).toBe(0.2);
    expect(v.music).toBe(0.9);
    expect(v.sfx).toBe(0.8);
    expect(mergeVolumes(null, 'ui', 7).ui).toBe(1);
    expect(mergeVolumes({ ui: 0.3 }, 'ui', NaN).ui).toBe(0.3);
  });
  it('diagnostics never throw', () => {
    expect(readDiagnostics(() => 'ok')).toBe('ok');
    expect(readDiagnostics(() => { throw new Error('bad'); })).toContain('bad');
    expect(readDiagnostics(() => ({ a: 1 }) as never)).toContain('"a": 1');
  });
  it('game-over summary tolerates a broken simulation', () => {
    expect(gameOverSummary({ sim: null })).toEqual({ household: null, day: null, funds: null, members: [], stats: [] });
    const broken = { sim: { get state(): never { throw new Error('x'); }, time: () => { throw new Error('y'); }, household: () => { throw new Error('z'); } } } as never;
    expect(gameOverSummary(broken).household).toBeNull();
    const ok = gameOverSummary({ sim: { state: { household: { name: ' The Grimsbys ', funds: 312 }, stats: { counters: { limbsLost: 7, partiesThrown: NaN } } }, time: () => ({ day: 23 }), household: () => [{ id: 'a1', name: 'Mortimer', appearance: {} }] } } as never);
    expect(ok.household).toBe('The Grimsbys');
    expect(ok.day).toBe(23);
    expect(ok.funds).toBe(312);
    expect(ok.stats.find((s) => s.key === 'limbsLost')?.value).toBe(7);
    expect(ok.stats.find((s) => s.key === 'partiesThrown')?.value).toBe(0);
  });
  it('key map groups cover KEYMAP exactly once', () => {
    const g = groupedActions();
    expect(new Set(g).size).toBe(g.length);
    expect([...g].sort()).toEqual(Object.keys(KEYMAP).sort());
  });
  it('applies theme settings with clamping and no DOM', () => {
    const props: Record<string, string> = {};
    const classes = new Set<string>();
    const root = {
      style: { setProperty: (k: string, v: string) => (props[k] = v) },
      classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
    } as unknown as HTMLElement;
    applyThemeSettings({ uiScale: 9, reduceMotion: true, colorblindNeeds: false, quality: 'low' }, root);
    expect(props['--ui-scale']).toBe('1.4');
    expect(classes.has('reduce-motion')).toBe(true);
    expect(classes.has('ui-low-fx')).toBe(true);
    applyThemeSettings({ uiScale: NaN, reduceMotion: false, colorblindNeeds: true }, root);
    expect(props['--ui-scale']).toBe('1');
    expect(classes.has('reduce-motion')).toBe(false);
    expect(classes.has('cb-needs')).toBe(true);
    applyThemeSettings({ uiScale: 0.1, reduceMotion: false, colorblindNeeds: false }, root);
    expect(props['--ui-scale']).toBe('0.8');
    expect(() => applyThemeSettings({ uiScale: 1, reduceMotion: false, colorblindNeeds: false }, null)).not.toThrow();
  });
});

describe('lot info', () => {
  it('prefers controller templates and falls back safely', async () => {
    const { lotInfo, startingFunds } = await import('../../../src/ui/shell/data');
    const tpl = [{ id: 'starter', name: ' Fixer ', description: 'd', startingFunds: 7000 }, { id: 'empty', name: '', startingFunds: -5 }];
    expect(lotInfo('starter', tpl)).toEqual({ id: 'starter', name: 'Fixer', description: 'd', startingFunds: 7000 });
    expect(lotInfo('empty', tpl)).toEqual({ id: 'empty', name: null, description: null, startingFunds: 22000 });
    expect(lotInfo('starter', null).startingFunds).toBe(6500);
    expect(lotInfo('starter', [null, 3] as never).startingFunds).toBe(6500);
    expect(startingFunds('starter', 3, 7000)).toBe(8000);
    expect(startingFunds('starter', 1, NaN)).toBe(6500);
  });
});
