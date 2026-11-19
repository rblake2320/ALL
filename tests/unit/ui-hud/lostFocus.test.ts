/**
 * Keyboard focus rescue (src/ui/hud/parts/keynav.ts, lostFocusAction). Found on the Spark CI runner: F6 landed on a HUD
 * control that unmounted within 80 ms and focus sat on <body>, so the keyboard player was nowhere. Proves:
 *  1. keyboard focus whose element is gone, with focus on <body>, goes back to its region when the region still has a
 *     Tab stop, else to the world (the canvas);
 *  2. nothing happens for pointer focus, for an element that is still alive, when focus already moved somewhere else,
 *     or while a modal owns focus (its trap decides);
 *  3. adversarial: every one of the 32 input combinations returns a valid action, a rescue happens ONLY in the one
 *     state where it must, and non-boolean inputs never trigger a rescue.
 */
import { describe, expect, it } from 'vitest';
import { lostFocusAction } from '../../../src/ui/hud/parts/keynav';

describe('lost keyboard focus', () => {
  it('returns to the region when it still has a Tab stop, else to the world', () => {
    expect(lostFocusAction(true, false, true, false, true)).toBe('region');
    expect(lostFocusAction(true, false, true, false, false)).toBe('world');
  });

  it('leaves pointer focus, live focus, moved focus and modals alone', () => {
    expect(lostFocusAction(false, false, true, false, true)).toBe('none'); // pointer user: no focus ring to keep
    expect(lostFocusAction(true, true, true, false, true)).toBe('none'); // element still there
    expect(lostFocusAction(true, false, false, false, true)).toBe('none'); // focus already somewhere real
    expect(lostFocusAction(true, false, true, true, true)).toBe('none'); // a dialog's focus trap decides
  });

  it('exhaustive: a rescue happens only for dead keyboard focus on <body> with no modal', () => {
    const B = [true, false];
    let rescues = 0;
    for (const kb of B) for (const alive of B) for (const body of B) for (const modal of B) for (const stops of B) {
      const a = lostFocusAction(kb, alive, body, modal, stops);
      expect(['none', 'region', 'world']).toContain(a);
      const must = kb && !alive && body && !modal;
      expect(a !== 'none', JSON.stringify({ kb, alive, body, modal, stops })).toBe(must);
      if (must) {
        expect(a).toBe(stops ? 'region' : 'world');
        rescues++;
      }
    }
    expect(rescues).toBe(2);
  });

  it('adversarial: truthy non-booleans never count as "keyboard" or "on body"', () => {
    const junk = [1, 'true', {}, [], null, undefined, NaN] as unknown as boolean[];
    for (const j of junk) {
      expect(lostFocusAction(j, false, true, false, true)).toBe('none');
      expect(lostFocusAction(true, false, j, false, true)).toBe('none');
      // a junk "regionHasStops" can only choose the safer target (the world), never a region that may not exist
      expect(lostFocusAction(true, false, true, false, j)).toBe('world');
    }
  });
});
