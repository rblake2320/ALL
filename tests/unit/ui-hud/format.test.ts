import { describe, expect, it } from 'vitest';
import {
  MINUS,
  clamp,
  contrastRatio,
  easeOutCubic,
  formatDuration,
  formatMoney,
  formatPercent,
  formatSigned,
  formatSignedMoney,
  groupThousands,
  initials,
  inkFor,
  interpolate,
  minutesUntil,
  mixHex,
  needColor,
  parseHex,
  partyBand,
  performanceFraction,
  signedFraction,
  trendLevel,
  tweenInt,
} from '../../../src/ui/hud/lib/format';

const junk: unknown[] = [NaN, Infinity, -Infinity, undefined, null, '12', {}, [], () => 1];

describe('clamp', () => {
  it('clamps normally and handles non-finite input', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(NaN, 0, 10)).toBe(0);
    expect(clamp(Infinity, 0, 10)).toBe(10);
    expect(clamp(-Infinity, 0, 10)).toBe(0);
  });
});

describe('formatMoney', () => {
  it('groups thousands and uses a typographic minus', () => {
    expect(formatMoney(6500)).toBe('$6,500');
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(999)).toBe('$999');
    expect(formatMoney(1000)).toBe('$1,000');
    expect(formatMoney(1234567)).toBe('$1,234,567');
    expect(formatMoney(-45)).toBe(`${MINUS}$45`);
  });
  it('rounds to whole dollars', () => {
    expect(formatMoney(12.4)).toBe('$12');
    expect(formatMoney(12.5)).toBe('$13');
    expect(formatMoney(-0.4)).toBe('$0');
  });
  it('compacts large values only when asked', () => {
    expect(formatMoney(12_500, { compact: true })).toBe('$12.5K');
    expect(formatMoney(9_999, { compact: true })).toBe('$9,999');
    expect(formatMoney(1_200_000, { compact: true })).toBe('$1.2M');
    expect(formatMoney(250_000, { compact: true })).toBe('$250K');
    expect(formatMoney(3e12, { compact: true })).toBe('$3T');
    expect(formatMoney(1_200_000)).toBe('$1,200,000');
  });
  it('never throws on junk', () => {
    for (const j of junk) expect(formatMoney(j)).toBe('$—');
  });
  it('handles very large numbers without exponent notation', () => {
    expect(formatMoney(1e15)).toBe('$1,000,000,000,000,000');
    expect(groupThousands(0)).toBe('0');
  });
});

describe('formatSignedMoney / formatSigned', () => {
  it('signs deltas', () => {
    expect(formatSignedMoney(240)).toBe('+$240');
    expect(formatSignedMoney(-45)).toBe(`${MINUS}$45`);
    expect(formatSignedMoney(0)).toBe('$0');
    expect(formatSignedMoney(0.2)).toBe('$0');
    expect(formatSignedMoney(NaN)).toBe('$—');
  });
  it('formats signed plain numbers', () => {
    expect(formatSigned(12)).toBe('+12');
    expect(formatSigned(-5)).toBe(`${MINUS}5`);
    expect(formatSigned(0)).toBe('0');
    expect(formatSigned(-0.04, 1)).toBe('0');
    expect(formatSigned(2.25, 1)).toBe('+2.3');
    expect(formatSigned(Infinity)).toBe('—');
    expect(formatSigned(1, 99)).toBe('+1.0000');
  });
});

describe('formatDuration', () => {
  it('formats minutes, hours and days', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(135)).toBe('2h 15m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(1500)).toBe('1d 1h');
    expect(formatDuration(2880)).toBe('2d');
    expect(formatDuration(0.4)).toBe('<1m');
    expect(formatDuration(59.6)).toBe('1h');
  });
  it('handles indefinite and junk', () => {
    expect(formatDuration(null)).toBe('∞');
    expect(formatDuration(undefined)).toBe('∞');
    expect(formatDuration(Infinity)).toBe('∞');
    expect(formatDuration(NaN)).toBe('0m');
    expect(formatDuration(-30)).toBe('0m');
    expect(formatDuration(0)).toBe('0m');
  });
});

describe('minutesUntil', () => {
  it('converts ticks to game minutes and never goes negative', () => {
    expect(minutesUntil(0, 240)).toBe(60);
    expect(minutesUntil(500, 100)).toBe(0);
    expect(minutesUntil(NaN, 100)).toBe(0);
    expect(minutesUntil(0, Infinity)).toBe(0);
  });
});

describe('initials', () => {
  it('builds initials robustly', () => {
    expect(initials('Mortimer Grimsby')).toBe('MG');
    expect(initials('  ophelia  ')).toBe('O');
    expect(initials('Lenore  van  Crypt')).toBe('LC');
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
    expect(initials(42)).toBe('?');
    expect(initials('\u{1F480} Bones')).toBe('\u{1F480}B');
  });
});

describe('colour helpers', () => {
  it('parses hex strictly', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('9fe870')).toEqual([159, 232, 112]);
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('red')).toBeNull();
    expect(parseHex(null)).toBeNull();
  });
  it('mixes and falls back', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', NaN)).toBe('#000000');
    expect(mixHex('nope', '#ffffff', 0.5)).toBe('#ffffff');
    expect(mixHex('nope', 'nah', 0.5)).toBe('#808080');
  });
  it('need ramp runs orange → mid → teal and clamps', () => {
    expect(needColor(0)).toBe('#ff9a4a');
    expect(needColor(50)).toBe('#e3cf6a');
    expect(needColor(100)).toBe('#55d6be');
    expect(needColor(-20)).toBe('#ff9a4a');
    expect(needColor(400)).toBe('#55d6be');
    expect(needColor(NaN)).toBe('#ff9a4a');
  });
  it('contrast ratio matches WCAG endpoints', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    // Bone text on the plum panel base must clear AA.
    expect(contrastRatio('#e8e0c8', '#1d1726')).toBeGreaterThan(4.5);
  });
  it('picks readable ink for swatches', () => {
    expect(inkFor('#e6e0d0')).toBe('#15101c');
    expect(inkFor('#1f1f24')).toBe('#f6f0dd');
    for (const c of ['#9fe870', '#ffb35a', '#6e2a35', '#5b3f6e', '#d9cfb8']) {
      expect(contrastRatio(inkFor(c), c)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('trendLevel', () => {
  it('buckets trends symmetrically', () => {
    expect(trendLevel(0)).toBe(0);
    expect(trendLevel(0.5)).toBe(0);
    expect(trendLevel(-0.74)).toBe(0);
    expect(trendLevel(1)).toBe(1);
    expect(trendLevel(-4.9)).toBe(-1);
    expect(trendLevel(6)).toBe(2);
    expect(trendLevel(-14)).toBe(-2);
    expect(trendLevel(40)).toBe(3);
    expect(trendLevel(-Infinity)).toBe(0);
    expect(trendLevel('5')).toBe(0);
  });
});

describe('fractions and bands', () => {
  it('maps performance and friendship', () => {
    expect(performanceFraction(-100)).toBe(0);
    expect(performanceFraction(0)).toBe(0.5);
    expect(performanceFraction(100)).toBe(1);
    expect(performanceFraction(500)).toBe(1);
    expect(performanceFraction(NaN)).toBe(0.5);
    expect(signedFraction(-50)).toEqual({ fraction: 0.5, negative: true });
    expect(signedFraction(250)).toEqual({ fraction: 1, negative: false });
    expect(signedFraction(10, 0)).toEqual({ fraction: 0.1, negative: false });
  });
  it('party bands follow the GDD thresholds', () => {
    expect(partyBand(30)).toBe('lame');
    expect(partyBand(31)).toBe('okay');
    expect(partyBand(69.9)).toBe('okay');
    expect(partyBand(70)).toBe('legendary');
    expect(partyBand(NaN)).toBe('lame');
  });
  it('percent', () => {
    expect(formatPercent(0.625)).toBe('63%');
    expect(formatPercent(NaN)).toBe('—');
  });
});

describe('interpolate', () => {
  it('fills known params and leaves unknown placeholders', () => {
    expect(interpolate('Hi {name}, {n} left', { name: 'Ophelia', n: 3 })).toBe('Hi Ophelia, 3 left');
    expect(interpolate('{missing} stays', { other: 1 })).toBe('{missing} stays');
    expect(interpolate('{a}{a}', { a: 'x' })).toBe('xx');
    expect(interpolate('null {v}', { v: null })).toBe('null ');
    expect(interpolate('no params')).toBe('no params');
    expect(interpolate(undefined as unknown as string, {})).toBe('');
  });
  it('does not resolve prototype keys', () => {
    expect(interpolate('{toString}', {})).toBe('{toString}');
    expect(interpolate('{constructor}', Object.create(null))).toBe('{constructor}');
  });
});

describe('tweening', () => {
  it('eases and tweens integers', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(NaN)).toBe(0);
    expect(tweenInt(0, 100, 0)).toBe(0);
    expect(tweenInt(0, 100, 1)).toBe(100);
    expect(tweenInt(100, 0, 0.5)).toBe(13);
    expect(tweenInt(5, NaN, 0.5)).toBe(5);
  });
});
