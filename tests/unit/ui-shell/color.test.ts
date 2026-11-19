import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  mixHex,
  moodBandColor,
  moodBandOf,
  needBand,
  needColor,
  over,
  parseHex,
  readableOn,
  safeHex,
  shadeHex,
  toHex,
} from '../../../src/ui/common/color';

describe('hex parsing', () => {
  it('accepts short, long, alpha and hashless forms', () => {
    expect(parseHex('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(parseHex('aabbcc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(parseHex('#abcd')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(parseHex('#AABBCCDD')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(parseHex('  #9fe870  ')).toEqual({ r: 0x9f, g: 0xe8, b: 0x70 });
  });
  it('rejects garbage', () => {
    for (const bad of ['', '#', '#12', '#12345', 'red', 'rgb(1,2,3)', '#ggg', null, undefined, 42, {}, '#1234567']) {
      expect(parseHex(bad)).toBeNull();
    }
    expect(safeHex('nope', '#123456')).toBe('#123456');
    expect(safeHex('#ABC', '#000000')).toBe('#aabbcc');
  });
  it('round-trips and clamps', () => {
    expect(toHex({ r: 300, g: -5, b: NaN })).toBe('#ff0000');
    expect(toHex(parseHex('#1d1726')!)).toBe('#1d1726');
  });
});

describe('mixing', () => {
  it('interpolates and clamps t', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#ffffff', -1)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', NaN)).toBe('#000000');
    expect(mixHex('zzz', '#ffffff', 0)).toBe('#808080');
    expect(mixHex('bad', '#bbaadd', 1)).toBe('#bbaadd'); // 'bad' is valid 3-digit hex!
    expect(shadeHex('#808080', 1)).toBe('#ffffff');
    expect(shadeHex('#808080', -1)).toBe('#000000');
  });
});

describe('contrast', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrastRatio('nope', '#fff')).toBe(1);
  });
  it('picks a readable check colour for any swatch', () => {
    expect(readableOn('#ffffff')).toBe('#15101c');
    expect(readableOn('#1f1a1a')).toBe('#f6f0dd');
    expect(readableOn('garbage')).toBe('#f6f0dd');
  });
});

describe('need ramp', () => {
  it('runs candle orange → straw → teal and clamps', () => {
    expect(needColor(0)).toBe('#ff9a4a');
    expect(needColor(50)).toBe('#e3cf6a');
    expect(needColor(100)).toBe('#55d6be');
    expect(needColor(-20)).toBe('#ff9a4a');
    expect(needColor(400)).toBe('#55d6be');
    expect(needColor(NaN)).toBe('#ff9a4a');
    expect(parseHex(needColor(25))).not.toBeNull();
  });
  it('bands for colour-blind patterns', () => {
    expect(needBand(0)).toBe('low');
    expect(needBand(30)).toBe('low');
    expect(needBand(30.01)).toBe('mid');
    expect(needBand(69.9)).toBe('mid');
    expect(needBand(70)).toBe('high');
    expect(needBand(NaN)).toBe('low');
  });
});

describe('mood bands', () => {
  it('follows GDD §3 thresholds', () => {
    expect(moodBandOf(-100)).toBe('miserable');
    expect(moodBandOf(-50)).toBe('miserable');
    expect(moodBandOf(-49)).toBe('uneasy');
    expect(moodBandOf(-15)).toBe('uneasy');
    expect(moodBandOf(-14)).toBe('fine');
    expect(moodBandOf(14.9)).toBe('fine');
    expect(moodBandOf(15)).toBe('good');
    expect(moodBandOf(49.9)).toBe('good');
    expect(moodBandOf(50)).toBe('great');
    expect(moodBandOf(NaN)).toBe('fine');
  });
  it('colours known bands and tolerates unknown/prototype keys', () => {
    expect(moodBandColor('great')).toBe('#9fe870');
    expect(moodBandColor('constructor')).toBe(moodBandColor('fine'));
    expect(moodBandColor('__proto__')).toBe(moodBandColor('fine'));
    expect(moodBandColor(undefined)).toBe(moodBandColor('fine'));
  });
});

describe('theme tokens meet 4.5:1 text contrast', () => {
  const css = readFileSync(resolve(__dirname, '../../../src/ui/theme/tokens.css'), 'utf8');
  const token = (name: string) => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    if (!m) throw new Error(`token --${name} not found as hex`);
    return m[1];
  };
  const panel = parseHex('#1d1726')!;
  // Worst realistic scene behind a 0.86-alpha glass panel: the light day fog (#9aa39a) — and pure white as a stress case.
  const overFog = over(panel, 0.86, parseHex('#9aa39a')!);
  const overWhite = over(panel, 0.86, { r: 255, g: 255, b: 255 });
  for (const name of ['text', 'text-strong', 'text-muted', 'text-faint', 'c-toxic', 'c-candle', 'c-rose', 'c-cryo', 'c-need-high']) {
    it(`--${name}`, () => {
      const fg = token(name);
      expect(contrastRatio(fg, panel)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fg, overFog)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fg, overWhite)).toBeGreaterThanOrEqual(4.0);
    });
  }
  it('primary button label on toxic', () => {
    expect(contrastRatio(token('text-on-accent'), token('c-toxic'))).toBeGreaterThanOrEqual(7);
  });
  it('certificate ink on parchment', () => {
    expect(contrastRatio('#2a1f30', '#e1d6ba')).toBeGreaterThanOrEqual(7);
    expect(contrastRatio('#5f4f56', '#e1d6ba')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#5a4a52', '#e1d6ba')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#4a1a22', '#e1d6ba')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#6e2a35', '#efe7d1')).toBeGreaterThanOrEqual(4.5);
  });
});
