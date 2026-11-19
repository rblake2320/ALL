import { describe, expect, it } from 'vitest';
import { KEYMAP } from '../../../src/game/contracts';
import {
  CONTINUOUS,
  KeyResolver,
  SHIFT_AGNOSTIC,
  formatCombo,
  isActivationTarget,
  isEditableTarget,
  matchCombo,
  parseCombo,
  shouldPreventDefault,
  type KeyAction,
  type KeyEventLike,
} from '../../../src/game/input/keyboard';

const ev = (code: string, mods: Partial<Omit<KeyEventLike, 'code'>> = {}): KeyEventLike => ({
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('parseCombo', () => {
  it.each([
    ['KeyZ', { code: 'KeyZ', ctrl: false, shift: false, alt: false }],
    ['ctrl+KeyZ', { code: 'KeyZ', ctrl: true, shift: false, alt: false }],
    ['ctrl+shift+KeyZ', { code: 'KeyZ', ctrl: true, shift: true, alt: false }],
    ['shift+ctrl+KeyZ', { code: 'KeyZ', ctrl: true, shift: true, alt: false }],
    ['Shift+Slash', { code: 'Slash', ctrl: false, shift: true, alt: false }],
    ['cmd+KeyS', { code: 'KeyS', ctrl: true, shift: false, alt: false }],
    ['alt+F4', { code: 'F4', ctrl: false, shift: false, alt: true }],
    [' ctrl + KeyY ', { code: 'KeyY', ctrl: true, shift: false, alt: false }],
  ])('%s', (spec, combo) => expect(parseCombo(spec)).toEqual(combo));

  it.each(['', '+', 'ctrl+', '+KeyZ', 'ctrl+ctrl+KeyZ', 'shift+shift+KeyA', 'KeyA+KeyB', 'ctrl+shift', 'Key Z', 'ctrl++', '1Key', 'x'.repeat(65)])(
    'rejects %j',
    (spec) => expect(parseCombo(spec)).toBeNull(),
  );

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 3, {}, []]) expect(parseCombo(v)).toBeNull();
  });

  it('formatCombo round-trips', () => {
    for (const s of ['ctrl+shift+KeyZ', 'KeyA', 'shift+Slash']) expect(formatCombo(parseCombo(s)!)).toBe(s);
  });
});

describe('matchCombo', () => {
  const undo = parseCombo('ctrl+KeyZ')!;
  const redo = parseCombo('ctrl+shift+KeyZ')!;
  const zoom = parseCombo('KeyZ')!;
  it('modifiers match exactly', () => {
    expect(matchCombo(undo, ev('KeyZ', { ctrlKey: true }))).toBe(true);
    expect(matchCombo(undo, ev('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchCombo(redo, ev('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchCombo(zoom, ev('KeyZ', { ctrlKey: true }))).toBe(false);
    expect(matchCombo(undo, ev('KeyZ', { ctrlKey: true, altKey: true }))).toBe(false);
  });
  it('Meta (Cmd) counts as ctrl', () => {
    expect(matchCombo(undo, ev('KeyZ', { metaKey: true }))).toBe(true);
  });
  it('shift-agnostic matching only relaxes shift', () => {
    expect(matchCombo(zoom, ev('KeyZ', { shiftKey: true }), true)).toBe(true);
    expect(matchCombo(zoom, ev('KeyZ', { shiftKey: true, ctrlKey: true }), true)).toBe(false);
  });
  it('different physical key never matches', () => {
    expect(matchCombo(zoom, ev('KeyX'))).toBe(false);
    expect(matchCombo(zoom, null as never)).toBe(false);
  });
});

describe('KeyResolver over the real KEYMAP', () => {
  const r = new KeyResolver();
  it('every KEYMAP entry parses', () => {
    expect(r.invalid).toEqual([]);
  });

  it.each([
    [ev('KeyZ', { ctrlKey: true }), 'undo'],
    [ev('KeyZ', { ctrlKey: true, shiftKey: true }), 'redo'],
    [ev('KeyY', { ctrlKey: true }), 'redo'],
    [ev('KeyZ'), 'zoomIn'],
    [ev('KeyZ', { shiftKey: true }), 'zoomIn'],
    [ev('KeyS'), 'panDown'],
    [ev('KeyS', { ctrlKey: true }), 'quickSave'],
    [ev('F5'), 'quickSave'],
    [ev('Slash', { shiftKey: true }), 'help'],
    [ev('Tab'), 'cycleZombie'],
    [ev('Tab', { shiftKey: true }), 'cycleZombie'],
    [ev('Space'), 'pause'],
    [ev('Backquote'), 'pause'],
    [ev('Digit4'), 'speedUltra'],
    [ev('KeyR', { shiftKey: true }), 'rotateObject'],
    [ev('Escape'), 'menu'],
    [ev('Delete'), 'sell'],
    [ev('PageUp'), 'wallMode'],
  ] as [KeyEventLike, KeyAction][])('%j → %s', (e, action) => expect(r.resolve(e)).toBe(action));

  it.each([ev('KeyZ', { altKey: true }), ev('Slash'), ev('Digit1', { ctrlKey: true }), ev('KeyQ', { ctrlKey: true }), ev('F12'), ev('KeyW', { ctrlKey: true })])(
    'unbound: %j',
    (e) => expect(r.resolve(e)).toBeNull(),
  );

  it('the map is unambiguous: no event matches two different actions', () => {
    for (const { action, combo } of r.combos()) {
      const variants = [false, true].map((shift) => ev(combo.code, { ctrlKey: combo.ctrl, altKey: combo.alt, shiftKey: shift || combo.shift }));
      for (const e of variants) {
        const m = r.matches(e);
        expect(m.length, `${JSON.stringify(e)} matched ${m.join(',')}`).toBeLessThanOrEqual(1);
        if (m.length === 1 && e.shiftKey === combo.shift) expect(m[0]).toBe(action);
      }
    }
  });

  it('continuous actions are all shift-agnostic (shift = faster)', () => {
    for (const a of CONTINUOUS) expect(SHIFT_AGNOSTIC.has(a)).toBe(true);
    for (const a of Object.keys(KEYMAP)) expect(typeof a).toBe('string');
  });

  it('custom maps with garbage entries are reported, not thrown', () => {
    const bad = new KeyResolver({ pause: ['Space', 'ctrl+', 'Key Z'], undo: ['ctrl+KeyZ'] });
    expect(bad.invalid).toEqual(['pause:ctrl+', 'pause:Key Z']);
    expect(bad.resolve(ev('KeyZ', { ctrlKey: true }))).toBe('undo');
  });
});

describe('UI-origin filtering', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, getAttribute: (n: string) => (extra[n] as string) ?? null, ...extra });
  it('text fields, selects, sliders and contenteditable keep their keys', () => {
    expect(isEditableTarget(el('INPUT'))).toBe(true);
    expect(isEditableTarget(el('textarea'))).toBe(true);
    expect(isEditableTarget(el('SELECT'))).toBe(true);
    expect(isEditableTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isEditableTarget(el('DIV', { role: 'slider' }))).toBe(true);
    expect(isEditableTarget(el('DIV', { closest: (s: string) => (s.includes('capture') ? {} : null) }))).toBe(true);
    expect(isEditableTarget(el('CANVAS'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({ tagName: 5 })).toBe(false);
    expect(isEditableTarget(el('DIV', { closest: () => { throw new Error('x'); } }))).toBe(false);
  });
  it('focused buttons own Space/Enter but not other keys', () => {
    expect(isActivationTarget(el('BUTTON'), 'Space')).toBe(true);
    expect(isActivationTarget(el('DIV', { role: 'button' }), 'Enter')).toBe(true);
    expect(isActivationTarget(el('BUTTON'), 'KeyW')).toBe(false);
    expect(isActivationTarget(el('CANVAS'), 'Space')).toBe(false);
  });
  it('browser defaults (F5 reload, F1, F3, F10) are always suppressed in game', () => {
    expect(shouldPreventDefault(null, 'F5')).toBe(true);
    expect(shouldPreventDefault(null, 'F3')).toBe(true);
    expect(shouldPreventDefault(null, 'KeyQ')).toBe(false);
    expect(shouldPreventDefault('panUp', 'KeyW')).toBe(true);
  });
});
