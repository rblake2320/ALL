import { describe, expect, it } from 'vitest';
import { codeLabel, hotkeyHint, hotkeyLabels, keyLabel } from '../../../src/ui/hud/lib/keys';
import {
  clampBox,
  cursorLabelPos,
  markerX,
  placeFlyout,
  placeMenu,
  placeTooltip,
  ringDash,
  stackIndices,
} from '../../../src/ui/hud/lib/layout';
import { KEYMAP } from '../../../src/game/contracts';

describe('key labels', () => {
  it('maps physical codes', () => {
    expect(codeLabel('Digit1')).toBe('1');
    expect(codeLabel('KeyQ')).toBe('Q');
    expect(codeLabel('Space')).toBe('Space');
    expect(codeLabel('Backquote')).toBe('`');
    expect(codeLabel('Escape')).toBe('Esc');
    expect(codeLabel('F10')).toBe('F10');
    expect(codeLabel('Numpad7')).toBe('Num 7');
    expect(codeLabel('NumpadAdd')).toBe('Num +');
    expect(codeLabel('PageUp')).toBe('PgUp');
    expect(codeLabel('MysteryKey')).toBe('MysteryKey');
    expect(codeLabel('')).toBe('');
    expect(codeLabel(undefined)).toBe('');
  });
  it('maps chords', () => {
    expect(keyLabel('ctrl+KeyZ')).toBe('Ctrl+Z');
    expect(keyLabel('ctrl+shift+KeyZ')).toBe('Ctrl+Shift+Z');
    expect(keyLabel('shift+Slash')).toBe('?');
    expect(keyLabel('ctrl+KeyS', { mac: true })).toBe('⌘+S');
    expect(keyLabel('CTRL+KeyY')).toBe('Ctrl+Y');
    expect(keyLabel('ctrl++')).toBe('Ctrl++');
    expect(keyLabel('   ')).toBe('');
    expect(keyLabel(null)).toBe('');
  });
  it('every KEYMAP binding produces a non-empty label', () => {
    for (const [action, codes] of Object.entries(KEYMAP)) {
      for (const c of codes) expect(keyLabel(c), `${action}:${c}`).not.toBe('');
      expect(hotkeyLabels(action as keyof typeof KEYMAP).length).toBeGreaterThan(0);
    }
  });
  it('limits and de-duplicates', () => {
    expect(hotkeyLabels('pause', 2)).toEqual(['Space', '0']);
    expect(hotkeyLabels('pause', 0)).toEqual(['Space']);
    expect(hotkeyHint('modeBuy')).toBe('F2 / B');
    expect(hotkeyLabels('nope' as never)).toEqual([]);
  });
});

const VP = { w: 1280, h: 720 };

describe('clampBox', () => {
  it('keeps boxes inside the viewport', () => {
    expect(clampBox(1250, 700, { w: 200, h: 100 }, VP, 8)).toEqual({ x: 1072, y: 612 });
    expect(clampBox(-50, -50, { w: 10, h: 10 }, VP, 8)).toEqual({ x: 8, y: 8 });
    expect(clampBox(NaN, NaN, { w: 10, h: 10 }, VP, 8)).toEqual({ x: 8, y: 8 });
  });
  it('pins oversized boxes to the margin', () => {
    expect(clampBox(300, 300, { w: 5000, h: 5000 }, VP, 8)).toEqual({ x: 8, y: 8 });
  });
  it('survives a zero/negative viewport', () => {
    const p = clampBox(10, 10, { w: 100, h: 100 }, { w: 0, h: -5 }, 8);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('placeMenu', () => {
  it('opens to the right of the cursor when there is room', () => {
    const p = placeMenu({ x: 100, y: 200 }, { w: 240, h: 300 }, VP);
    expect(p.x).toBe(110);
    expect(p.originX).toBe('left');
    expect(p.originY).toBe('top');
  });
  it('flips left near the right edge and up near the bottom', () => {
    const p = placeMenu({ x: 1200, y: 680 }, { w: 240, h: 300 }, VP);
    expect(p.x + 240).toBeLessThanOrEqual(1200);
    expect(p.originX).toBe('right');
    expect(p.originY).toBe('bottom');
    expect(p.y + 300).toBeLessThanOrEqual(720 - 8);
  });
  it('clamps garbage anchors into the viewport', () => {
    const p = placeMenu({ x: Infinity, y: NaN }, { w: 240, h: 300 }, VP);
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.x + 240).toBeLessThanOrEqual(1280 - 8);
    expect(p.y).toBeGreaterThanOrEqual(8);
  });
});

describe('placeFlyout', () => {
  it('prefers the right side and flips left when it would overflow', () => {
    expect(placeFlyout({ x: 100, y: 100, w: 200, h: 30 }, { w: 200, h: 150 }, VP).side).toBe('right');
    const f = placeFlyout({ x: 1000, y: 100, w: 220, h: 30 }, { w: 200, h: 150 }, VP);
    expect(f.side).toBe('left');
    expect(f.x + 200).toBeLessThanOrEqual(1000);
  });
  it('clamps vertically', () => {
    const f = placeFlyout({ x: 100, y: 700, w: 200, h: 30 }, { w: 200, h: 300 }, VP);
    expect(f.y + 300).toBeLessThanOrEqual(712);
  });
});

describe('placeTooltip', () => {
  it('uses the preferred side when it fits', () => {
    const t = placeTooltip({ x: 600, y: 300, w: 40, h: 40 }, { w: 120, h: 40 }, VP, 'top');
    expect(t.placement).toBe('top');
    expect(t.y).toBe(300 - 8 - 40);
    expect(t.x).toBe(620 - 60);
  });
  it('flips when the preferred side has no room', () => {
    expect(placeTooltip({ x: 600, y: 4, w: 40, h: 30 }, { w: 120, h: 40 }, VP, 'top').placement).toBe('bottom');
    expect(placeTooltip({ x: 600, y: 690, w: 40, h: 26 }, { w: 120, h: 40 }, VP, 'bottom').placement).toBe('top');
  });
  it('keeps the arrow within the tooltip even when clamped at an edge', () => {
    const t = placeTooltip({ x: 0, y: 300, w: 20, h: 20 }, { w: 200, h: 40 }, VP, 'top');
    expect(t.x).toBe(6);
    expect(t.arrow).toBeGreaterThanOrEqual(10);
    expect(t.arrow).toBeLessThanOrEqual(190);
  });
  it('degrades gracefully when nothing fits', () => {
    const t = placeTooltip({ x: 10, y: 10, w: 10, h: 10 }, { w: 2000, h: 2000 }, { w: 100, h: 100 }, 'left');
    expect(['top', 'bottom', 'left', 'right']).toContain(t.placement);
    expect(Number.isFinite(t.x) && Number.isFinite(t.y)).toBe(true);
  });
});

describe('stackIndices', () => {
  it('stacks per agent in creation order', () => {
    const m = stackIndices([
      { key: 1, agentId: 'a1' },
      { key: 2, agentId: 'a2' },
      { key: 3, agentId: 'a1' },
      { key: 4, agentId: 'a1' },
    ]);
    expect([m.get(1), m.get(2), m.get(3), m.get(4)]).toEqual([0, 0, 1, 2]);
  });
  it('ignores junk entries', () => {
    const m = stackIndices([null as never, { key: 9, agentId: 5 as never }, { key: 10, agentId: 'a' }]);
    expect(m.size).toBe(1);
    expect(stackIndices(undefined as never).size).toBe(0);
  });
});

describe('ring/marker/cursor maths', () => {
  it('ringDash', () => {
    const r = ringDash(0.25, 10);
    expect(r.circumference).toBeCloseTo(62.83, 1);
    expect(r.offset).toBeCloseTo(47.12, 1);
    expect(ringDash(5, 10).offset).toBe(0);
    expect(ringDash(NaN, 10).offset).toBeCloseTo(62.83, 1);
    expect(ringDash(0.5, -3).circumference).toBe(0);
  });
  it('markerX', () => {
    expect(markerX(0.5, 100, 2)).toBe(49);
    expect(markerX(1, 100, 2)).toBe(98);
    expect(markerX(-1, 100, 2)).toBe(0);
    expect(markerX(NaN, 100, 2)).toBe(0);
  });
  it('cursorLabelPos flips at edges', () => {
    expect(cursorLabelPos({ x: 100, y: 100 }, { w: 80, h: 24 }, VP)).toEqual({ x: 118, y: 122 });
    const p = cursorLabelPos({ x: 1270, y: 715 }, { w: 80, h: 24 }, VP);
    expect(p.x + 80).toBeLessThanOrEqual(1274);
    expect(p.y + 24).toBeLessThanOrEqual(714);
  });
});

import { hudTier } from '../../../src/ui/hud/Hud';

describe('hudTier', () => {
  it('maps viewport width in rem to layout tiers', () => {
    expect(hudTier(1600, 14.8)).toBe('normal'); // 108rem
    expect(hudTier(1280, 13.6)).toBe('normal'); // 94rem
    expect(hudTier(1600, 14.8 * 1.4)).toBe('compact'); // 77rem
    expect(hudTier(1280, 13.6 * 1.4)).toBe('tight'); // 67rem
  });
  it('survives junk', () => {
    expect(hudTier(NaN, 16)).toBe('normal');
    expect(hudTier(1280, 0)).toBe('normal');
    expect(hudTier(-5, 16)).toBe('tight');
  });
});
