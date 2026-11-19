import { describe, expect, it } from 'vitest';
import {
  clamp,
  displayName,
  formatBytes,
  formatDate,
  formatDurationMinutes,
  formatMoney,
  formatNumber,
  formatPercent,
  formatSavedAgo,
  initials,
  parseTime,
  trendLabel,
  trendMagnitude,
} from '../../../src/ui/common/format';

const MINUS = '−';

describe('formatMoney', () => {
  it('groups thousands and prefixes $', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(6500)).toBe('$6,500');
    expect(formatMoney(22000)).toBe('$22,000');
    expect(formatMoney(1234567)).toBe('$1,234,567');
    expect(formatMoney(999)).toBe('$999');
  });
  it('rounds to whole dollars (including .5 and tiny negatives)', () => {
    expect(formatMoney(12.4)).toBe('$12');
    expect(formatMoney(12.5)).toBe('$13');
    expect(formatMoney(-0.2)).toBe('$0');
    expect(formatMoney(-0)).toBe('$0');
  });
  it('uses a typographic minus for negatives and + only when asked', () => {
    expect(formatMoney(-45)).toBe(`${MINUS}$45`);
    expect(formatMoney(45, { sign: true })).toBe('+$45');
    expect(formatMoney(0, { sign: true })).toBe('$0');
    expect(formatMoney(-1500, { sign: true })).toBe(`${MINUS}$1,500`);
  });
  it('compacts large values only from 10k', () => {
    expect(formatMoney(9999, { compact: true })).toBe('$9,999');
    expect(formatMoney(12500, { compact: true })).toBe('$12.5k');
    expect(formatMoney(10000, { compact: true })).toBe('$10k');
    expect(formatMoney(250000, { compact: true })).toBe('$250k');
    expect(formatMoney(2_400_000, { compact: true })).toBe('$2.4M');
    expect(formatMoney(-12500, { compact: true })).toBe(`${MINUS}$12.5k`);
  });
  it('never renders NaN/Infinity', () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined as unknown as number, null as unknown as number, '12' as unknown as number]) {
      expect(formatMoney(bad)).toBe('$—');
    }
  });
});

describe('formatNumber / formatPercent / formatBytes', () => {
  it('formats numbers', () => {
    expect(formatNumber(1234.5)).toBe('1,235');
    expect(formatNumber(1234.5, 1)).toBe('1,234.5');
    expect(formatNumber(-3)).toBe(`${MINUS}3`);
    expect(formatNumber(-0.001)).toBe('0');
    expect(formatNumber(NaN)).toBe('—');
    expect(formatNumber(5, 99)).toBe('5.000000');
  });
  it('formats percents with clamping', () => {
    expect(formatPercent(0.623)).toBe('62%');
    expect(formatPercent(2)).toBe('100%');
    expect(formatPercent(-1)).toBe('0%');
    expect(formatPercent(NaN)).toBe('0%');
  });
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(48211)).toBe('47 KB');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });
});

describe('durations', () => {
  it('formats minutes', () => {
    expect(formatDurationMinutes(45)).toBe('45 min');
    expect(formatDurationMinutes(192)).toBe('3 h 12 min');
    expect(formatDurationMinutes(120)).toBe('2 h');
    expect(formatDurationMinutes(0)).toBe('0 min');
    expect(formatDurationMinutes(-5)).toBe('0 min');
    expect(formatDurationMinutes(NaN)).toBe('0 min');
    expect(formatDurationMinutes(59.6)).toBe('1 h');
  });
});

describe('formatSavedAgo', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('buckets relative times', () => {
    expect(formatSavedAgo(ago(10_000), now)).toBe('just now');
    expect(formatSavedAgo(ago(3 * 60_000), now)).toBe('3 min ago');
    expect(formatSavedAgo(ago(50_000), now)).toBe('1 min ago');
    expect(formatSavedAgo(ago(5 * 3_600_000), now)).toBe('5 h ago');
    expect(formatSavedAgo(ago(30 * 3_600_000), now)).toBe('yesterday');
    expect(formatSavedAgo(ago(4 * 86_400_000), now)).toBe('4 days ago');
    expect(formatSavedAgo(ago(40 * 86_400_000), now)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2026$/);
  });
  it('treats clock skew (future) as just now', () => {
    expect(formatSavedAgo(new Date(now + 3_600_000).toISOString(), now)).toBe('just now');
  });
  it('survives garbage', () => {
    expect(formatSavedAgo('not a date', now)).toBe('a while ago');
    expect(formatSavedAgo(null, now)).toBe('a while ago');
    expect(formatSavedAgo(undefined, now)).toBe('a while ago');
    expect(formatSavedAgo('', now)).toBe('a while ago');
    expect(formatSavedAgo(ago(1000), NaN)).toBe('a while ago');
    expect(parseTime(NaN)).toBeNaN();
    expect(formatDate(NaN)).toBe('a while ago');
  });
});

describe('trends', () => {
  it('maps per-hour change to 0..3 arrows with sign', () => {
    expect(trendMagnitude(0)).toBe(0);
    expect(trendMagnitude(0.49)).toBe(0);
    expect(trendMagnitude(0.5)).toBe(1);
    expect(trendMagnitude(-1.3)).toBe(-1);
    expect(trendMagnitude(4)).toBe(2);
    expect(trendMagnitude(-11.9)).toBe(-2);
    expect(trendMagnitude(12)).toBe(3);
    expect(trendMagnitude(-500)).toBe(-3);
    expect(trendMagnitude(NaN)).toBe(0);
    expect(trendMagnitude(Infinity)).toBe(0);
  });
  it('labels every magnitude', () => {
    const labels = [-3, -2, -1, 0, 1, 2, 3].map(trendLabel);
    expect(new Set(labels).size).toBe(7);
    expect(trendLabel(99)).toBe('Steady');
  });
});

describe('names', () => {
  it('builds display names and falls back', () => {
    expect(displayName('Mortimer', 'Grimsby')).toBe('Mortimer Grimsby');
    expect(displayName('  Edna ', '')).toBe('Edna');
    expect(displayName('', '')).toBe('Unnamed zombie');
    expect(displayName(null, undefined)).toBe('Unnamed zombie');
  });
  it('makes initials, unicode-safe', () => {
    expect(initials('Mortimer Grimsby')).toBe('MG');
    expect(initials('ophelia')).toBe('O');
    expect(initials('  ')).toBe('?');
    expect(initials('Émile Zola de la Tombe')).toBe('ÉT');
    expect(initials('🧟 Zed')).toBe('🧟Z');
  });
  it('clamps safely', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(NaN, 0, 10)).toBe(0);
    expect(clamp(Infinity, 0, 10)).toBe(10);
    expect(clamp(-Infinity, 0, 10)).toBe(0);
  });
});
