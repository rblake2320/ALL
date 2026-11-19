/**
 * Adversarial tests for the helpers added / hardened in the UI-HUD hardening pass: roving keyboard navigation,
 * scroll-edge state, household-bar density, action-queue capacity, strongest feelings, guest lists, household-name
 * sanitising, hotkey labels and money formatting at the extremes.
 */
import { describe, expect, it } from 'vitest';
import type { MoodletView } from '../../../src/sim/contracts';
import { strongestMoodlets } from '../../../src/ui/hud/agent/tabsA';
import { HH_GEOMETRY, householdDensity } from '../../../src/ui/hud/household/HouseholdBar';
import { formatMoney, formatSigned, formatSignedMoney, groupThousands, UNKNOWN } from '../../../src/ui/hud/lib/format';
import { hotkeyHint, hotkeyLabels, type KeyAction } from '../../../src/ui/hud/lib/keys';
import { QUEUE_GEOMETRY, queueCapacity } from '../../../src/ui/hud/lib/layout';
import { clampGuestList, HOUSEHOLD_NAME_MAX, MAX_PARTY_GUESTS, toggleGuest, validateHouseholdName } from '../../../src/ui/hud/lib/validation';
import { nextRovingIndex, rovingTabIndex } from '../../../src/ui/hud/parts/roving';
import { overflowState } from '../../../src/ui/hud/parts/scroll';

// ───────────────────────────── roving focus ─────────────────────────────

describe('nextRovingIndex', () => {
  it('moves along a single line and wraps', () => {
    expect(nextRovingIndex(0, 5, 'ArrowRight')).toBe(1);
    expect(nextRovingIndex(4, 5, 'ArrowRight')).toBe(0);
    expect(nextRovingIndex(0, 5, 'ArrowLeft')).toBe(4);
    expect(nextRovingIndex(2, 5, 'ArrowDown')).toBe(3);
    expect(nextRovingIndex(2, 5, 'ArrowUp')).toBe(1);
  });
  it('does not wrap when told not to', () => {
    expect(nextRovingIndex(4, 5, 'ArrowRight', { wrap: false })).toBe(4);
    expect(nextRovingIndex(0, 5, 'ArrowLeft', { wrap: false })).toBe(0);
  });
  it('Home / End jump to the first / last ENABLED item', () => {
    const disabled = [true, false, false, true];
    expect(nextRovingIndex(2, 4, 'Home', { disabled })).toBe(1);
    expect(nextRovingIndex(1, 4, 'End', { disabled })).toBe(2);
    expect(nextRovingIndex(1, 4, 'Home', { disabled: [true, true, true, true] })).toBeNull();
  });
  it('skips disabled items and stays put when nothing else is enabled', () => {
    expect(nextRovingIndex(0, 4, 'ArrowRight', { disabled: [false, true, true, false] })).toBe(3);
    expect(nextRovingIndex(3, 4, 'ArrowRight', { disabled: [false, true, true, false] })).toBe(0);
    expect(nextRovingIndex(0, 3, 'ArrowRight', { disabled: [false, true, true] })).toBe(0);
  });
  it('moves by whole rows in a grid and never wraps rows', () => {
    // 7 items in rows of 3: [0 1 2] [3 4 5] [6]
    expect(nextRovingIndex(1, 7, 'ArrowDown', { cols: 3 })).toBe(4);
    expect(nextRovingIndex(4, 7, 'ArrowUp', { cols: 3 })).toBe(1);
    expect(nextRovingIndex(1, 7, 'ArrowUp', { cols: 3 })).toBe(1);
    expect(nextRovingIndex(5, 7, 'ArrowDown', { cols: 3 })).toBe(5); // no item below
    expect(nextRovingIndex(3, 7, 'ArrowDown', { cols: 3 })).toBe(6);
    expect(nextRovingIndex(4, 7, 'ArrowRight', { cols: 3 })).toBe(5);
  });
  it('honours orientation (lets the other axis through)', () => {
    expect(nextRovingIndex(1, 4, 'ArrowDown', { orientation: 'horizontal' })).toBeNull();
    expect(nextRovingIndex(1, 4, 'ArrowRight', { orientation: 'vertical' })).toBeNull();
    expect(nextRovingIndex(1, 4, 'ArrowUp', { orientation: 'vertical' })).toBe(0);
  });
  it('enters from outside the group at the right end', () => {
    expect(nextRovingIndex(-1, 4, 'ArrowRight')).toBe(0);
    expect(nextRovingIndex(-1, 4, 'ArrowLeft')).toBe(3);
    expect(nextRovingIndex(Number.NaN, 4, 'ArrowDown')).toBe(0);
    expect(nextRovingIndex(99, 4, 'ArrowUp')).toBe(3);
  });
  it('rejects junk', () => {
    expect(nextRovingIndex(0, 0, 'ArrowRight')).toBeNull();
    expect(nextRovingIndex(0, -3, 'ArrowRight')).toBeNull();
    expect(nextRovingIndex(0, Number.POSITIVE_INFINITY, 'ArrowRight')).toBeNull();
    expect(nextRovingIndex(0, Number.NaN, 'ArrowRight')).toBeNull();
    expect(nextRovingIndex(0, 4, 'Enter')).toBeNull();
    expect(nextRovingIndex(0, 4, 'a')).toBeNull();
    expect(nextRovingIndex(0, 4, '')).toBeNull();
    // junk column counts mean "single line"
    expect(nextRovingIndex(0, 4, 'ArrowDown', { cols: Number.NaN })).toBe(1);
    expect(nextRovingIndex(0, 4, 'ArrowDown', { cols: 1 })).toBe(1);
    expect(nextRovingIndex(0, 4, 'ArrowDown', { cols: -2 })).toBe(1);
  });
  it('a 1-item group is a fixed point', () => {
    for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']) expect(nextRovingIndex(0, 1, k)).toBe(0);
  });
});

describe('rovingTabIndex', () => {
  it('exactly one tab stop: the selected item, else the first', () => {
    expect([0, 1, 2].map((i) => rovingTabIndex(i, 1, 3))).toEqual([-1, 0, -1]);
    expect([0, 1, 2].map((i) => rovingTabIndex(i, -1, 3))).toEqual([0, -1, -1]);
    expect([0, 1, 2].map((i) => rovingTabIndex(i, 7, 3))).toEqual([0, -1, -1]);
    expect([0, 1, 2].map((i) => rovingTabIndex(i, Number.NaN, 3))).toEqual([0, -1, -1]);
  });
});

// ───────────────────────────── scroll edges ─────────────────────────────

describe('overflowState', () => {
  it('reports which edges hide content', () => {
    expect(overflowState(0, 100, 100)).toBe('none');
    expect(overflowState(0, 100, 300)).toBe('end');
    expect(overflowState(100, 100, 300)).toBe('both');
    expect(overflowState(200, 100, 300)).toBe('start');
  });
  it('absorbs sub-pixel layouts', () => {
    expect(overflowState(0, 100, 100.6)).toBe('none');
    expect(overflowState(199.4, 100, 300)).toBe('start');
    expect(overflowState(0.6, 100, 300)).toBe('end');
  });
  it('tolerates elastic overscroll and junk', () => {
    expect(overflowState(-40, 100, 300)).toBe('end');
    expect(overflowState(260, 100, 300)).toBe('start');
    expect(overflowState(Number.NaN, 100, 300)).toBe('end');
    expect(overflowState(0, Number.NaN, Number.NaN)).toBe('none');
    expect(overflowState(0, 100, Number.POSITIVE_INFINITY)).toBe('none');
    expect(overflowState(0, -5, 10)).toBe('end');
    expect(overflowState(5, 100, 300, -1)).toBe('both'); // junk tolerance falls back to 1px
  });
});

// ───────────────────────────── household bar density ─────────────────────────────

describe('householdDensity', () => {
  const normalH = (n: number, rem = 16) => HH_GEOMETRY.pad + n * (HH_GEOMETRY.normal.chrome + Math.max(0.6875, 9.5 / rem) * 1.25) + (n - 1) * HH_GEOMETRY.normal.gap;
  it('keeps names while the bar fits', () => {
    expect(householdDensity(4, 30)).toBe('normal');
    expect(householdDensity(1, normalH(1))).toBe('normal');
    expect(householdDensity(4, normalH(4))).toBe('normal');
  });
  it('goes dense, then scrolls, as members or UI scale grow', () => {
    expect(householdDensity(8, 30)).toBe('dense'); // 8 × ~4.9rem does not fit, 8 × 3rem does
    expect(householdDensity(8, 20)).toBe('scroll');
    expect(householdDensity(4, normalH(4) - 1)).toBe('dense');
  });
  it('accounts for the 9.5px floor on the name line at small UI scales', () => {
    // at 11px per rem the name line is 9.5/11 × 1.25 ≈ 1.08rem instead of 0.86rem
    const roomy = normalH(4, 16);
    expect(householdDensity(4, roomy, 16)).toBe('normal');
    expect(householdDensity(4, roomy, 11)).toBe('dense');
  });
  it('tolerates junk', () => {
    expect(householdDensity(0, 0)).toBe('normal');
    expect(householdDensity(-3, 10)).toBe('normal');
    expect(householdDensity(Number.NaN, 10)).toBe('normal');
    expect(householdDensity(4, Number.NaN)).toBe('normal'); // unknown room: never collapse
    expect(householdDensity(4, Number.POSITIVE_INFINITY)).toBe('normal');
    expect(householdDensity(4, -100)).toBe('scroll');
    expect(householdDensity(4, 30, 0)).toBe('normal');
    expect(householdDensity(4, 30, Number.NaN)).toBe('normal');
  });
});

// ───────────────────────────── action queue ─────────────────────────────

describe('queueCapacity', () => {
  const room = (tiles: number, more = false) => QUEUE_GEOMETRY.active + QUEUE_GEOMETRY.chrome + tiles * QUEUE_GEOMETRY.tile + (more ? QUEUE_GEOMETRY.more : 0);
  it('shows everything when it fits', () => {
    expect(queueCapacity(room(4), 4)).toBe(4);
    expect(queueCapacity(200, 5)).toBe(5);
    expect(queueCapacity(200, 0)).toBe(0);
  });
  it('reserves room for the "+N" chip when not everything fits', () => {
    expect(queueCapacity(room(4), 5)).toBe(3);
    expect(queueCapacity(room(4, true), 9)).toBe(4);
  });
  it('never exceeds the hard cap, even with room to spare', () => {
    expect(queueCapacity(500, 12, 8)).toBe(8);
    expect(queueCapacity(500, 12)).toBe(8);
  });
  it('degrades to the active item alone on tiny screens', () => {
    expect(queueCapacity(room(0), 3)).toBe(0);
    expect(queueCapacity(5, 3)).toBe(0);
    expect(queueCapacity(-50, 3)).toBe(0);
  });
  it('tolerates junk', () => {
    expect(queueCapacity(Number.NaN, 3)).toBe(3);
    expect(queueCapacity(Number.POSITIVE_INFINITY, 30, 8)).toBe(8);
    expect(queueCapacity(100, Number.NaN)).toBe(0);
    expect(queueCapacity(100, -4)).toBe(0);
    expect(queueCapacity(100, 4.9)).toBe(4);
    expect(queueCapacity(100, 4, Number.NaN)).toBe(4);
    expect(queueCapacity(100, 4, -1)).toBe(0);
  });
  it('is monotonic in the available width', () => {
    let prev = 0;
    for (let w = 0; w <= 80; w += 0.25) {
      const c = queueCapacity(w, 12);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});

// ───────────────────────────── strongest feelings ─────────────────────────────

const ml = (id: string, mood: number, stacks = 1): MoodletView => ({ id, label: id, description: '', mood, stacks, icon: 'happy', kind: mood >= 0 ? 'good' : 'bad', remaining: null });

describe('strongestMoodlets', () => {
  it('orders by total effect, sign-blind — `mood` already includes stacks (engine views.ts)', () => {
    // c: four stacks of −5 arrive as mood −20 (NOT −5 × 4 again)
    const out = strongestMoodlets([ml('a', 5), ml('b', -15), ml('c', -20, 4), ml('d', 10)], 3);
    expect(out.map((m) => m.id)).toEqual(['c', 'b', 'd']);
    // a stacked moodlet is never re-multiplied: −5 with 4 stacks stays weaker than −15
    expect(strongestMoodlets([ml('s', -5, 4), ml('b', -15)], 1).map((m) => m.id)).toEqual(['b']);
  });
  it('keeps input order on ties and drops zero-effect moodlets', () => {
    expect(strongestMoodlets([ml('x', 5), ml('y', -5), ml('z', 0)], 5).map((m) => m.id)).toEqual(['x', 'y']);
  });
  it('treats junk stacks as one and junk moods as zero', () => {
    const odd = [ml('s0', 6, 0), ml('sn', 6, Number.NaN), ml('neg', 6, -3), ml('nan', Number.NaN)];
    expect(strongestMoodlets(odd, 5).map((m) => m.id)).toEqual(['s0', 'sn', 'neg']);
  });
  it('survives junk lists and limits', () => {
    expect(strongestMoodlets(null, 3)).toEqual([]);
    expect(strongestMoodlets(undefined)).toEqual([]);
    expect(strongestMoodlets([null as unknown as MoodletView, { mood: 9 } as unknown as MoodletView, ml('ok', 2)], 3).map((m) => m.id)).toEqual(['ok']);
    expect(strongestMoodlets([ml('a', 1)], 0)).toEqual([]);
    expect(strongestMoodlets([ml('a', 1)], -2)).toEqual([]);
    expect(strongestMoodlets([ml('a', 1), ml('b', 2)], 1.9).map((m) => m.id)).toEqual(['b']);
  });
  it('does not mutate its input', () => {
    const list = [ml('a', 1), ml('b', 9)];
    strongestMoodlets(list, 2);
    expect(list.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

// ───────────────────────────── guest lists ─────────────────────────────

describe('party guest lists', () => {
  it('caps, de-duplicates and keeps pick order', () => {
    expect(clampGuestList(['a', 'b', 'a', '', 7, null, 'c'], 2)).toEqual(['a', 'b']);
    expect(clampGuestList(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toHaveLength(MAX_PARTY_GUESTS);
  });
  it('tolerates junk lists and caps', () => {
    expect(clampGuestList(null)).toEqual([]);
    expect(clampGuestList(undefined)).toEqual([]);
    expect(clampGuestList('abc' as unknown as string[])).toEqual([]);
    expect(clampGuestList(['a', 'b'], 0)).toEqual([]);
    expect(clampGuestList(['a', 'b'], -1)).toEqual([]);
    expect(clampGuestList(['a', 'b'], Number.NaN)).toEqual(['a', 'b']);
    expect(clampGuestList(['a', 'b', 'c'], 1.7)).toEqual(['a']);
  });
  it('toggles within the cap and never returns its input', () => {
    const sel = ['a'];
    const next = toggleGuest(sel, 'b', 2);
    expect(next).toEqual(['a', 'b']);
    expect(next).not.toBe(sel);
    expect(toggleGuest(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    expect(toggleGuest(['a', 'b'], 'a', 2)).toEqual(['b']);
    // removing still works when the list is already over a (lowered) cap
    expect(toggleGuest(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c']);
  });
  it('cleans corrupt selections and junk ids', () => {
    expect(toggleGuest(['a', 'a', 5 as unknown as string], 'b', 6)).toEqual(['a', 'b']);
    expect(toggleGuest(null, 'x')).toEqual(['x']);
    expect(toggleGuest(['a'], '')).toEqual(['a']);
    expect(toggleGuest(['a'], null as unknown as string)).toEqual(['a']);
    expect(toggleGuest(['a'], 'b', Number.NaN)).toEqual(['a', 'b']);
  });
});

// ───────────────────────────── household names ─────────────────────────────

describe('validateHouseholdName (adversarial)', () => {
  it('strips invisible padding characters that would fake a non-empty name', () => {
    expect(validateHouseholdName('ㅤㅤ')).toEqual({ ok: false, error: 'empty' }); // Hangul fillers
    expect(validateHouseholdName('­͏᠎')).toEqual({ ok: false, error: 'empty' });
    expect(validateHouseholdName('️︎')).toEqual({ ok: false, error: 'empty' });
    expect(validateHouseholdName('Grim­sby')).toEqual({ ok: true, value: 'Grimsby' });
    expect(validateHouseholdName('؜The Grimsbys')).toEqual({ ok: true, value: 'The Grimsbys' });
  });
  it('keeps real combining marks and non-Latin scripts', () => {
    expect(validateHouseholdName('Zoë')).toEqual({ ok: true, value: 'Zoë' });
    expect(validateHouseholdName('ゾンビ家')).toEqual({ ok: true, value: 'ゾンビ家' });
    expect(validateHouseholdName('Семья')).toEqual({ ok: true, value: 'Семья' });
  });
  it('rejects names with no letters or digits', () => {
    expect(validateHouseholdName('❤️ 💀')).toEqual({ ok: false, error: 'noLetters' });
    expect(validateHouseholdName('---')).toEqual({ ok: false, error: 'noLetters' });
  });
  it('measures length after cleaning, in code points', () => {
    const atMax = 'x'.repeat(HOUSEHOLD_NAME_MAX);
    expect(validateHouseholdName(`  ${atMax}​​  `)).toEqual({ ok: true, value: atMax });
    expect(validateHouseholdName('😀'.repeat(HOUSEHOLD_NAME_MAX - 1) + 'a').ok).toBe(true);
    expect(validateHouseholdName('a'.repeat(HOUSEHOLD_NAME_MAX + 1))).toEqual({ ok: false, error: 'tooLong' });
  });
  it('never throws on hostile input', () => {
    for (const v of [null, undefined, 42, {}, [], Symbol.iterator, '\u0000'.repeat(1e5), 'a'.repeat(1e6)]) {
      expect(() => validateHouseholdName(v)).not.toThrow();
    }
  });
});

// ───────────────────────────── hotkey labels ─────────────────────────────

describe('hotkeyLabels (adversarial)', () => {
  it('ignores prototype keys and unknown actions', () => {
    for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'nope', '']) {
      expect(hotkeyLabels(k as KeyAction)).toEqual([]);
      expect(hotkeyHint(k as KeyAction)).toBe('');
    }
  });
  it('treats junk limits as the default and never returns duplicates', () => {
    expect(hotkeyLabels('pause', Number.NaN)).toEqual(['Space', '0']);
    expect(hotkeyLabels('pause', 0)).toEqual(['Space']);
    expect(hotkeyLabels('pause', -5)).toEqual(['Space']);
    expect(hotkeyLabels('pause', 2.9)).toEqual(['Space', '0']);
    expect(hotkeyLabels('pause', Number.POSITIVE_INFINITY)).toEqual(['Space', '0', '`']);
    const all = hotkeyLabels('redo', 99);
    expect(new Set(all).size).toBe(all.length);
  });
});

// ───────────────────────────── money at the extremes ─────────────────────────────

describe('money formatting at the extremes', () => {
  it('formats the stress-test balance', () => {
    expect(formatMoney(9_999_999)).toBe('$9,999,999');
    expect(formatMoney(9_999_999, { compact: true })).toBe('$10M');
    expect(formatSignedMoney(-1_234_567)).toBe('−$1,234,567');
  });
  it('keeps every digit past 1e21 (no exponent notation)', () => {
    expect(groupThousands(1e21)).toBe('1,000,000,000,000,000,000,000');
    expect(formatMoney(1e21)).toBe('$1,000,000,000,000,000,000,000');
    expect(formatMoney(Number.MAX_SAFE_INTEGER)).toBe('$9,007,199,254,740,991');
    expect(() => formatMoney(Number.MAX_VALUE)).not.toThrow();
    expect(formatMoney(Number.MAX_VALUE)).not.toMatch(/e\+/);
  });
  it('never prints a negative zero', () => {
    expect(formatMoney(-0)).toBe('$0');
    expect(formatMoney(-0.4)).toBe('$0');
    expect(formatSignedMoney(-0.4)).toBe('$0');
    expect(formatSigned(-0.4)).toBe('0');
    expect(formatSigned(-0.04, 1)).toBe('0');
  });
  it('marks unformattable values instead of printing NaN', () => {
    expect(groupThousands(Number.NaN)).toBe(UNKNOWN);
    expect(groupThousands(Number.POSITIVE_INFINITY)).toBe(UNKNOWN);
    expect(formatMoney(Number.NaN)).toBe(`$${UNKNOWN}`);
    expect(formatMoney('12' as unknown as number)).toBe(`$${UNKNOWN}`);
  });
});
