import { describe, expect, it, vi } from 'vitest';
import { shallowEqual } from '../../../src/ui/common/equality';
import { comboLabels, isEditableTarget, keyLabel, matchAny, matchCombo, parseCombo } from '../../../src/ui/common/hotkeys';
import { computePosition } from '../../../src/ui/common/position';
import { keyboardStep, normRange, percentToValue, snapToStep, valueToPercent } from '../../../src/ui/common/sliderMath';
import { clampText } from '../../../src/ui/common/TextInput';
import { nextEnabledIndex } from '../../../src/ui/common/Tabs';
import { cx } from '../../../src/ui/common/cx';
import { KEYMAP } from '../../../src/game/contracts';

describe('shallowEqual', () => {
  it('handles primitives incl. NaN and signed zero', () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual(NaN, NaN)).toBe(true);
    expect(shallowEqual(0, -0)).toBe(true);
    expect(shallowEqual('a', 'b')).toBe(false);
    expect(shallowEqual(null, undefined)).toBe(false);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(1, '1')).toBe(false);
  });
  it('compares arrays element-wise, one level', () => {
    const o = {};
    expect(shallowEqual([1, 2, o], [1, 2, o])).toBe(true);
    expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(shallowEqual([{}], [{}])).toBe(false);
    expect(shallowEqual([], {})).toBe(false);
    expect(shallowEqual([NaN], [NaN])).toBe(true);
  });
  it('compares plain objects key-wise', () => {
    expect(shallowEqual({ a: 1, b: 'x' }, { b: 'x', a: 1 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(shallowEqual({ a: undefined }, { b: undefined })).toBe(false);
    expect(shallowEqual({ a: { x: 1 } }, { a: { x: 1 } })).toBe(false);
    expect(shallowEqual(new Date(5), new Date(5))).toBe(true);
    expect(shallowEqual(Object.create(null), {})).toBe(false);
  });
});

describe('hotkeys', () => {
  const ev = (code: string, mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({
    code,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
  });
  it('parses KEYMAP-style combos', () => {
    expect(parseCombo('Escape')).toEqual({ code: 'Escape', ctrl: false, shift: false, alt: false });
    expect(parseCombo('ctrl+shift+KeyZ')).toEqual({ code: 'KeyZ', ctrl: true, shift: true, alt: false });
    expect(parseCombo('Shift+Slash')).toEqual({ code: 'Slash', ctrl: false, shift: true, alt: false });
    expect(parseCombo('cmd+KeyS')?.ctrl).toBe(true);
    expect(parseCombo('alt+F4')?.alt).toBe(true);
  });
  it('rejects malformed combos', () => {
    for (const bad of ['', '+', 'ctrl+', '+KeyA', 'ctrl+shift', 'hyper+KeyA', 'ctrl++KeyA', 42 as unknown as string]) {
      expect(parseCombo(bad)).toBeNull();
    }
  });
  it('matches exactly (no extra modifiers), ⌘ counts as ctrl', () => {
    expect(matchCombo(ev('KeyZ', { ctrl: true }), 'ctrl+KeyZ')).toBe(true);
    expect(matchCombo(ev('KeyZ', { meta: true }), 'ctrl+KeyZ')).toBe(true);
    expect(matchCombo(ev('KeyZ', { ctrl: true, shift: true }), 'ctrl+KeyZ')).toBe(false);
    expect(matchCombo(ev('KeyZ'), 'ctrl+KeyZ')).toBe(false);
    expect(matchCombo(ev('Escape', { shift: true }), 'Escape')).toBe(false);
    expect(matchCombo(ev('Slash', { shift: true }), 'shift+Slash')).toBe(true);
    expect(matchCombo(ev('KeyZ'), 'nope+')).toBe(false);
    expect(matchCombo(null as never, 'KeyZ')).toBe(false);
  });
  it('matches any KEYMAP binding', () => {
    expect(matchAny(ev('F5'), KEYMAP.quickSave)).toBe(true);
    expect(matchAny(ev('KeyS', { ctrl: true }), KEYMAP.quickSave)).toBe(true);
    expect(matchAny(ev('KeyY', { ctrl: true }), KEYMAP.redo)).toBe(true);
    expect(matchAny(ev('KeyZ', { ctrl: true, shift: true }), KEYMAP.redo)).toBe(true);
    expect(matchAny(ev('KeyZ', { ctrl: true }), KEYMAP.redo)).toBe(false);
    expect(matchAny(ev('Space'), 'Space')).toBe(true);
  });
  it('labels every code used by KEYMAP without leaking raw codes', () => {
    for (const combos of Object.values(KEYMAP)) {
      for (const c of combos) {
        for (const part of comboLabels(c)) {
          expect(part).not.toMatch(/^(Key|Digit)[A-Z0-9]$/);
          expect(part.length).toBeGreaterThan(0);
        }
      }
    }
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(keyLabel('Digit0')).toBe('0');
    expect(keyLabel('Numpad7')).toBe('Num 7');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Backquote')).toBe('`');
    expect(keyLabel('MediaPlayPause')).toBe('MediaPlayPause');
    expect(keyLabel('')).toBe('?');
    expect(comboLabels('ctrl+shift+KeyZ')).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(comboLabels('???+')).toEqual(['???+']);
  });
  it('detects editable targets', () => {
    const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget;
    expect(isEditableTarget(el('INPUT', { type: 'text' }))).toBe(true);
    expect(isEditableTarget(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isEditableTarget(el('input', { type: 'range' }))).toBe(false);
    expect(isEditableTarget(el('TEXTAREA'))).toBe(true);
    expect(isEditableTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isEditableTarget(el('BUTTON'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});

describe('computePosition', () => {
  const vp = { width: 1280, height: 720 };
  const tip = { width: 120, height: 32 };
  it('prefers the requested side and centres on the anchor', () => {
    const p = computePosition({ left: 600, top: 300, width: 40, height: 40 }, tip, vp, 'top', 8, 8);
    expect(p.placement).toBe('top');
    expect(p.x).toBe(560);
    expect(p.y).toBe(300 - 8 - 32);
    expect(p.arrow).toBe(60);
  });
  it('flips to the opposite side at the screen edge', () => {
    const p = computePosition({ left: 600, top: 4, width: 40, height: 30 }, tip, vp, 'top');
    expect(p.placement).toBe('bottom');
    expect(p.y).toBe(4 + 30 + 8);
  });
  it('falls back to a perpendicular side, then clamps into the viewport', () => {
    const p = computePosition({ left: 0, top: 0, width: 40, height: 720 }, tip, vp, 'top');
    expect(p.placement).toBe('right');
    const q = computePosition({ left: 1270, top: 300, width: 10, height: 10 }, tip, vp, 'top');
    expect(q.x + tip.width).toBeLessThanOrEqual(vp.width - 8);
    expect(q.arrow).toBeGreaterThanOrEqual(10);
    expect(q.arrow).toBeLessThanOrEqual(tip.width - 10);
  });
  it('survives NaN, negative sizes and tiny viewports', () => {
    const p = computePosition({ left: NaN, top: NaN, width: -5, height: NaN }, { width: NaN, height: -1 }, { width: NaN, height: NaN }, 'bogus' as never);
    for (const v of [p.x, p.y, p.arrow]) expect(Number.isFinite(v)).toBe(true);
    const tiny = computePosition({ left: 5, top: 5, width: 10, height: 10 }, { width: 300, height: 200 }, { width: 50, height: 50 }, 'left');
    expect(Number.isFinite(tiny.x) && Number.isFinite(tiny.y)).toBe(true);
  });
});

describe('slider math', () => {
  it('snaps to the step grid without float noise', () => {
    expect(snapToStep(0.30000000000000004, 0, 1, 0.1)).toBe(0.3);
    expect(snapToStep(0.12, 0, 1, 0.05)).toBe(0.1);
    expect(snapToStep(0.13, 0, 1, 0.05)).toBe(0.15);
    expect(snapToStep(1.37, 0.8, 1.4, 0.05)).toBe(1.35);
    expect(snapToStep(2, 0.5, 2, 0.05)).toBe(2);
  });
  it('clamps, handles reversed ranges and bad steps', () => {
    expect(snapToStep(5, 0, 1, 0.1)).toBe(1);
    expect(snapToStep(-5, 0, 1, 0.1)).toBe(0);
    expect(snapToStep(NaN, 0, 1, 0.1)).toBe(0);
    expect(snapToStep(0.5, 1, 0, 0.1)).toBe(0.5);
    expect(snapToStep(0.37, 0, 1, 0)).toBe(0.37);
    expect(snapToStep(0.37, 0, 1, -1)).toBe(0.37);
    expect(snapToStep(0.37, 0, 1, NaN)).toBe(0.37);
    expect(snapToStep(0.95, 0, 1, 0.3)).toBe(0.9);
    expect(normRange(NaN, NaN)).toEqual([0, 1]);
  });
  it('maps percent <-> value', () => {
    expect(valueToPercent(0.5, 0, 1)).toBe(50);
    expect(valueToPercent(2, 0, 1)).toBe(100);
    expect(valueToPercent(1, 1, 1)).toBe(0);
    expect(valueToPercent(NaN, 0, 1)).toBe(0);
    expect(percentToValue(50, 0.5, 2, 0.05)).toBe(1.25);
    expect(percentToValue(NaN, 0, 1, 0.1)).toBe(0);
  });
  it('steps by keyboard', () => {
    expect(keyboardStep('ArrowRight', 0.5, 0, 1, 0.1)).toBe(0.6);
    expect(keyboardStep('ArrowDown', 0.5, 0, 1, 0.1)).toBe(0.4);
    expect(keyboardStep('PageUp', 0.5, 0, 1, 0.01)).toBe(0.6);
    expect(keyboardStep('PageDown', 0.05, 0, 1, 0.01)).toBe(0);
    expect(keyboardStep('Home', 0.5, 0.8, 1.4, 0.05)).toBe(0.8);
    expect(keyboardStep('End', 0.5, 0.8, 1.4, 0.05)).toBe(1.4);
    expect(keyboardStep('KeyA', 0.5, 0, 1, 0.1)).toBeNull();
    expect(keyboardStep('ArrowUp', NaN, 0, 1, 0.1)).toBe(0.1);
  });
});

describe('small utils', () => {
  it('clampText counts code points and tolerates garbage', () => {
    expect(clampText('Mortimer', 4)).toBe('Mort');
    expect(clampText('🧟🧟🧟', 2)).toBe('🧟🧟');
    expect(clampText(null)).toBe('');
    expect(clampText(42 as unknown as string, 1)).toBe('4');
    expect(clampText('abc', 0)).toBe('abc');
    expect(clampText('abc', NaN)).toBe('abc');
  });
  it('nextEnabledIndex wraps and skips disabled', () => {
    const items = [{}, { disabled: true }, {}, { disabled: true }];
    expect(nextEnabledIndex(items, 0, 1)).toBe(2);
    expect(nextEnabledIndex(items, 2, 1)).toBe(0);
    expect(nextEnabledIndex(items, 0, -1)).toBe(2);
    expect(nextEnabledIndex(items, -1, 1)).toBe(0);
    expect(nextEnabledIndex([], 0, 1)).toBe(-1);
    expect(nextEnabledIndex([{ disabled: true }], 0, 1)).toBe(0);
  });
  it('cx joins truthy names', () => {
    expect(cx('a', false, null, undefined, 0, 'b', '')).toBe('a b');
    expect(cx()).toBe('');
  });
});

describe('subscribeCoalesced (useGame plumbing)', () => {
  it('coalesces bursts into one callback per frame and stops after unsubscribe', async () => {
    vi.useFakeTimers();
    const { subscribeCoalesced } = await import('../../../src/ui/hooks');
    const listeners = new Set<() => void>();
    const game = { subscribe: (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn)) } as never;
    const spy = vi.fn();
    const off = subscribeCoalesced(game, spy);
    for (let i = 0; i < 20; i++) listeners.forEach((f) => f());
    vi.advanceTimersByTime(20);
    expect(spy).toHaveBeenCalledTimes(1);
    listeners.forEach((f) => f());
    off();
    vi.advanceTimersByTime(20);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    vi.useRealTimers();
  });
  it('survives a throwing subscribe', async () => {
    const { subscribeCoalesced } = await import('../../../src/ui/hooks');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const off = subscribeCoalesced({ subscribe: () => { throw new Error('boom'); } } as never, () => {});
    expect(() => off()).not.toThrow();
    err.mockRestore();
  });
});

describe('nextUid', () => {
  it('is unique across calls and prefixes (portal trees share one counter)', async () => {
    const { nextUid } = await import('../../../src/ui/common/uid');
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) ids.add(nextUid(i % 2 ? 'a' : 'b'));
    expect(ids.size).toBe(5000);
    expect(nextUid('modal')).toMatch(/^modal-[0-9a-z]+$/);
    expect(nextUid()).toMatch(/^ui-/);
  });
});
