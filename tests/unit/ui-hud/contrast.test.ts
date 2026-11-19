import { describe, expect, it } from 'vitest';
import { contrastRatio, mixHex } from '../../../src/ui/hud/lib/format';

/**
 * Text colours the HUD uses beyond the shell's verified tokens, checked against their real backgrounds.
 * Glass panels are rgba(29,23,38,.86): we test against the panel composited over a *bright* world (worst case).
 */
const PANEL_OVER_BRIGHT = mixHex('#1d1726', '#c8c8c8', 0.14);
const PANEL_DARK = '#1d1726';
const TOOLTIP = '#100c16';
const PAPER = '#e2d6b8';
const PAPER_HI = '#f1e8cf';

const ON_PANEL: Record<string, string> = {
  rose: '#ff8f9c',
  reason: '#ffaa9a',
  dangerSoft: '#ffc2b6',
  lossFloater: '#ffb4a3',
  lilacPoints: '#d9c2ff',
  lilacLabel: '#c4aef0',
  romance: '#ffa6c4',
  teal: '#55d6be',
  toxicHi: '#c4f7a2',
  candleHi: '#ffd08f',
  prosthetic: '#e2b98a',
  cryoLight: '#b9efff',
  textMuted: '#bdb4a0',
};

describe('HUD text contrast (WCAG AA 4.5:1)', () => {
  for (const [name, fg] of Object.entries(ON_PANEL)) {
    it(`${name} on glass panels`, () => {
      expect(contrastRatio(fg, PANEL_OVER_BRIGHT)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fg, PANEL_DARK)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fg, TOOLTIP)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('choice letter ink on parchment', () => {
    for (const ink of ['#2a1d2c', '#3a2a38', '#4a3646', '#8a3a46']) {
      expect(contrastRatio(ink, PAPER), ink).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink, PAPER_HI), ink).toBeGreaterThanOrEqual(4.5);
    }
    // hovered option: paper text on ink
    expect(contrastRatio('#f6efdc', '#2a1d2c')).toBeGreaterThanOrEqual(4.5);
  });
  it('dark ink on accent fills (primary buttons, active speed, need alert badge)', () => {
    expect(contrastRatio('#15101c', '#9fe870')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#15101c', '#ffb35a')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#2a1406', '#ff9a4a')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#0f2730', '#7fe0ff')).toBeGreaterThanOrEqual(4.5);
  });
  it('bubble icons on parchment bubbles', () => {
    expect(contrastRatio('#2a1d2c', '#efe7d0')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#5a1f2a', '#efe7d0')).toBeGreaterThanOrEqual(4.5);
  });
});

/** Colours introduced in the hardening pass, on the tinted chips / modal surfaces they sit on. */
describe('HUD text contrast — hardening additions', () => {
  const MODAL = '#211a2b'; // .ui-modal gradient, darkest-to-lightest midpoint
  const tint = (fg: string, alpha: number, over: string) => mixHex(over, fg, alpha);
  it('feeling chips: label + value on their own 9% tint', () => {
    for (const tone of ['#55d6be', '#ff8f9c', '#d9cfb8']) {
      const bg = tint(tone, 0.09, PANEL_OVER_BRIGHT);
      expect(contrastRatio('#ece5cf', bg), `label on ${tone}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tone, bg), `value ${tone}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('"working here" job chip (cryo on its 8% tint)', () => {
    expect(contrastRatio('#7fe0ff', tint('#7fe0ff', 0.08, MODAL))).toBeGreaterThanOrEqual(4.5);
  });
  it('rename counter, normal and over the limit', () => {
    expect(contrastRatio('#bdb4a0', tint('#e8e0c8', 0.06, '#0e0a14'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffc2b6', tint('#e2566a', 0.18, '#0e0a14'))).toBeGreaterThanOrEqual(4.5);
  });
  it('relationship / log chip counts and the selected chip', () => {
    expect(contrastRatio('#bdb4a0', tint('#e8e0c8', 0.08, tint('#e8e0c8', 0.045, PANEL_OVER_BRIGHT)))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#c4f7a2', tint('#9fe870', 0.16, tint('#9fe870', 0.12, PANEL_OVER_BRIGHT)))).toBeGreaterThanOrEqual(4.5);
  });
  it('failed-save icon and rail arrows (non-text UI ≥ 3:1)', () => {
    expect(contrastRatio('#ffb4a3', PANEL_OVER_BRIGHT)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio('#f6f0dd', '#241c2f')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#15101c', '#c4f7a2')).toBeGreaterThanOrEqual(4.5); // hovered arrow
  });
});
