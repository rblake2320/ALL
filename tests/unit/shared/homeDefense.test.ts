/** The attack-schedule rules for extra homes (docs/CORE_CONCEPT.md section 5): every rule, its edges, and hostile input. */
import { describe, expect, it } from 'vitest';
import {
  ATTACK_CYCLE_HOURS as C,
  ATTACK_WINDOW_HOURS as W,
  FREE_PASSES_PER_HOME,
  MAIN_HOME_CHANGE_COOLDOWN_HOURS,
  MAIN_HOME_CHANGE_LOCK_HOURS,
  MAX_ATTACKS_PER_WINDOW,
  VACATION_COOLDOWN_WINDOWS,
  VACATION_MAX_HOURS,
  afterMainHomeChange,
  canBeAttacked,
  canChangeMainHome,
  canStartVacation,
  canUsePass,
  firstAttackableWindow,
  openWindowAt,
  windowStartHour,
  type HomeDefenseState,
} from '../../../src/shared/homeDefense';

const home = (over: Partial<HomeDefenseState> = {}): HomeDefenseState => ({
  isMainHome: false,
  frontierOn: true,
  acquiredAtHour: 0,
  passedWindows: [],
  vacation: null,
  attacksThisWindow: 0,
  breachedThisWindow: false,
  ...over,
});
/** An hour inside window `i`. */
const inWindow = (i: number, offset = 1) => windowStartHour(i) + offset;

describe('attack windows', () => {
  it('a window opens at the start of every cycle and stays open for the window length only', () => {
    expect(W).toBeLessThan(C);
    for (const i of [0, 1, 2, 57]) {
      expect(openWindowAt(windowStartHour(i))).toBe(i);
      expect(openWindowAt(windowStartHour(i) + W - 1)).toBe(i);
      expect(openWindowAt(windowStartHour(i) + W)).toBeNull();
      expect(openWindowAt(windowStartHour(i + 1) - 1)).toBeNull();
    }
  });
  it('a broken clock opens no window', () => {
    for (const bad of [NaN, Infinity, -1, -Infinity, '5' as unknown as number, null as unknown as number, undefined as unknown as number]) expect(openWindowAt(bad)).toBeNull();
  });
});

describe('grace period: one full cycle to set up', () => {
  it('a new home always gets at least one full cycle, and less than two, before its first attackable window', () => {
    for (let acquired = 0; acquired < 3 * C; acquired += 7) {
      const first = windowStartHour(firstAttackableWindow(acquired));
      expect(first - acquired).toBeGreaterThanOrEqual(C);
      expect(first - acquired).toBeLessThan(2 * C);
    }
  });
  it('a home bought an hour before a window is safe in that window and attackable in the next (a full cycle later)', () => {
    const acquired = windowStartHour(3) - 1;
    expect(canBeAttacked(home({ acquiredAtHour: acquired }), inWindow(3))).toEqual({ ok: false, reason: 'grace' });
    expect(windowStartHour(4) - acquired).toBeGreaterThanOrEqual(C);
    expect(canBeAttacked(home({ acquiredAtHour: acquired }), inWindow(4))).toEqual({ ok: true, window: 4 });
  });
  it('a home bought an hour after a window opened sits out that window and the next one', () => {
    const acquired = windowStartHour(3) + 1;
    expect(canBeAttacked(home({ acquiredAtHour: acquired }), inWindow(3, 2))).toEqual({ ok: false, reason: 'grace' });
    // the next window opens less than a full cycle after the purchase
    expect(windowStartHour(4) - acquired).toBeLessThan(C);
    expect(canBeAttacked(home({ acquiredAtHour: acquired }), inWindow(4))).toEqual({ ok: false, reason: 'grace' });
    expect(canBeAttacked(home({ acquiredAtHour: acquired }), inWindow(5))).toEqual({ ok: true, window: 5 });
  });
  it('a home with a broken purchase time is never attackable', () => {
    expect(firstAttackableWindow(NaN)).toBe(Infinity);
    expect(canBeAttacked(home({ acquiredAtHour: NaN }), inWindow(9))).toEqual({ ok: false, reason: 'badInput' });
  });
});

describe('canBeAttacked', () => {
  const now = inWindow(4);
  it('control: an established extra home with the fighting mode on is attackable inside a window', () => {
    expect(canBeAttacked(home(), now)).toEqual({ ok: true, window: 4 });
  });
  it('the main home is never attackable, whatever else is true', () => {
    expect(canBeAttacked(home({ isMainHome: true }), now)).toEqual({ ok: false, reason: 'mainHome' });
  });
  it('a household that did not switch the fighting mode on is never attackable', () => {
    expect(canBeAttacked(home({ frontierOn: false }), now)).toEqual({ ok: false, reason: 'frontierOff' });
  });
  it('nothing is attackable between windows', () => {
    expect(canBeAttacked(home(), windowStartHour(4) + W)).toEqual({ ok: false, reason: 'noWindowOpen' });
  });
  it('a pass covers exactly the window it was spent on', () => {
    const h = home({ passedWindows: [4] });
    expect(canBeAttacked(h, now)).toEqual({ ok: false, reason: 'passUsed' });
    expect(canBeAttacked(h, inWindow(5))).toEqual({ ok: true, window: 5 });
  });
  it('a vacation covers its hours and no others (end hour is exclusive)', () => {
    const h = home({ vacation: { startHour: now + 1, endHour: now + 3 } });
    expect(canBeAttacked(h, now)).toEqual({ ok: true, window: 4 });
    expect(canBeAttacked(h, now + 1)).toEqual({ ok: false, reason: 'vacation' });
    expect(canBeAttacked(h, now + 2)).toEqual({ ok: false, reason: 'vacation' });
    expect(canBeAttacked(h, now + 3)).toEqual({ ok: true, window: 4 });
  });
  it('a breached home is shielded for the rest of the window, and the attack count is capped', () => {
    expect(canBeAttacked(home({ breachedThisWindow: true }), now)).toEqual({ ok: false, reason: 'breachedThisWindow' });
    expect(canBeAttacked(home({ attacksThisWindow: MAX_ATTACKS_PER_WINDOW - 1 }), now)).toEqual({ ok: true, window: 4 });
    expect(canBeAttacked(home({ attacksThisWindow: MAX_ATTACKS_PER_WINDOW }), now)).toEqual({ ok: false, reason: 'attackLimit' });
  });
  it('hostile or damaged state fails closed: never attackable', () => {
    const bad: unknown[] = [
      null,
      undefined,
      home({ isMainHome: undefined as unknown as boolean }),
      home({ isMainHome: 0 as unknown as boolean }),
      home({ frontierOn: 'true' as unknown as boolean }),
      home({ frontierOn: 1 as unknown as boolean }),
      home({ passedWindows: null as unknown as number[] }),
      home({ attacksThisWindow: -1 }),
      home({ attacksThisWindow: NaN }),
      home({ attacksThisWindow: 0.5 }),
      home({ breachedThisWindow: undefined as unknown as boolean }),
      home({ acquiredAtHour: -5 }),
    ];
    for (const b of bad) expect(canBeAttacked(b as HomeDefenseState, now).ok, JSON.stringify(b)).toBe(false);
    for (const t of [NaN, -1, Infinity]) expect(canBeAttacked(home(), t).ok).toBe(false);
  });
  it('a damaged vacation record does not shield a home (it cannot be forged into protection)', () => {
    expect(canBeAttacked(home({ vacation: { startHour: NaN, endHour: Infinity } }), now)).toEqual({ ok: true, window: 4 });
  });
});

describe('passes', () => {
  const now = windowStartHour(4) - 10;
  it('every extra home starts with one free pass', () => {
    expect(FREE_PASSES_PER_HOME).toBe(1);
  });
  it('a held pass can be spent ahead of time or while the window is open', () => {
    expect(canUsePass(home(), 1, 4, now)).toEqual({ ok: true });
    expect(canUsePass(home(), 1, 4, inWindow(4))).toEqual({ ok: true });
  });
  it('refuses: no pass held, the main home, a window already covered, a window that has closed, a window still in grace', () => {
    expect(canUsePass(home(), 0, 4, now)).toEqual({ ok: false, reason: 'noPasses' });
    expect(canUsePass(home({ isMainHome: true }), 1, 4, now)).toEqual({ ok: false, reason: 'mainHome' });
    expect(canUsePass(home({ passedWindows: [4] }), 1, 4, now)).toEqual({ ok: false, reason: 'alreadyUsed' });
    expect(canUsePass(home(), 1, 4, windowStartHour(4) + W)).toEqual({ ok: false, reason: 'windowOver' });
    expect(canUsePass(home({ acquiredAtHour: now }), 1, 4, now)).toEqual({ ok: false, reason: 'grace' });
  });
  it('hostile input is refused', () => {
    for (const held of [NaN, -1, 1.5, Infinity]) expect(canUsePass(home(), held, 4, now).ok).toBe(false);
    for (const w of [-1, 1.5, NaN]) expect(canUsePass(home(), 1, w, now).ok).toBe(false);
    expect(canUsePass(null, 1, 4, now).ok).toBe(false);
  });
});

describe('vacation mode', () => {
  const now = windowStartHour(6) + W + 5; // between windows
  it('control: a planned vacation of allowed length is accepted', () => {
    expect(canStartVacation(now + 10, now + 10 + VACATION_MAX_HOURS, now, null)).toEqual({ ok: true });
  });
  it('refuses: too long, already started in the past, or while an attack window is open', () => {
    expect(canStartVacation(now, now + VACATION_MAX_HOURS + 1, now, null)).toEqual({ ok: false, reason: 'tooLong' });
    expect(canStartVacation(now - 1, now + 5, now, null)).toEqual({ ok: false, reason: 'inThePast' });
    const during = inWindow(7);
    expect(canStartVacation(during, during + 24, during, null)).toEqual({ ok: false, reason: 'windowOpen' });
  });
  it('cannot be used every time: a cooldown of whole windows after the last one', () => {
    const lastEnd = now - 1;
    const earliest = lastEnd + VACATION_COOLDOWN_WINDOWS * C;
    expect(canStartVacation(now + 1, now + 25, now, lastEnd)).toEqual({ ok: false, reason: 'cooldown' });
    // just outside a window, one hour too early and exactly on time
    const later = windowStartHour(Math.ceil(earliest / C)) + W + 1;
    expect(canStartVacation(Math.max(later, earliest), Math.max(later, earliest) + 24, later, lastEnd)).toEqual({ ok: true });
  });
  it('hostile input is refused', () => {
    expect(canStartVacation(now + 5, now + 5, now, null).ok).toBe(false);
    expect(canStartVacation(now + 5, now + 1, now, null).ok).toBe(false);
    expect(canStartVacation(NaN, now + 5, now, null).ok).toBe(false);
    expect(canStartVacation(now + 1, now + 5, now, NaN).ok).toBe(false);
  });
});

describe('changing the main home', () => {
  const now = windowStartHour(10) + W + 10; // between windows, well before the next one
  const req = (over = {}) => ({ currentMainId: 'a', targetId: 'b', ownedHomeIds: ['a', 'b'], targetAttackedThisWindow: false, lastChangeHour: null, ...over });
  it('control: allowed between windows, with no recent change', () => {
    expect(canChangeMainHome(req(), now)).toEqual({ ok: true });
  });
  it('refuses during a window and in the lock period before one, so a swap cannot dodge an attack', () => {
    expect(canChangeMainHome(req(), inWindow(11))).toEqual({ ok: false, reason: 'windowOpen' });
    expect(canChangeMainHome(req(), windowStartHour(11) - MAIN_HOME_CHANGE_LOCK_HOURS)).toEqual({ ok: false, reason: 'windowSoon' });
    expect(canChangeMainHome(req(), windowStartHour(11) - MAIN_HOME_CHANGE_LOCK_HOURS - 1)).toEqual({ ok: true });
  });
  it('refuses: same home, a home not owned, a target attacked this window, a change too soon after the last', () => {
    expect(canChangeMainHome(req({ targetId: 'a' }), now)).toEqual({ ok: false, reason: 'sameHome' });
    expect(canChangeMainHome(req({ targetId: 'z' }), now)).toEqual({ ok: false, reason: 'notOwned' });
    expect(canChangeMainHome(req({ targetAttackedThisWindow: true }), now)).toEqual({ ok: false, reason: 'targetUnderAttack' });
    expect(canChangeMainHome(req({ lastChangeHour: now - MAIN_HOME_CHANGE_COOLDOWN_HOURS + 1 }), now)).toEqual({ ok: false, reason: 'cooldown' });
    expect(canChangeMainHome(req({ lastChangeHour: now - MAIN_HOME_CHANGE_COOLDOWN_HOURS }), now)).toEqual({ ok: true });
  });
  it('the old main home becomes an extra home with a fresh grace period: it is not attackable in the next window', () => {
    const old = afterMainHomeChange(home({ isMainHome: true, acquiredAtHour: 0, passedWindows: [1], attacksThisWindow: 2, breachedThisWindow: true }), now);
    expect(old).toMatchObject({ isMainHome: false, acquiredAtHour: now, passedWindows: [], attacksThisWindow: 0, breachedThisWindow: false });
    expect(canBeAttacked(old, inWindow(11))).toEqual({ ok: false, reason: 'grace' });
    expect(canBeAttacked(old, inWindow(12))).toEqual({ ok: true, window: 12 });
  });
  it('hostile input is refused', () => {
    expect(canChangeMainHome(null as never, now).ok).toBe(false);
    expect(canChangeMainHome(req({ ownedHomeIds: null }), now).ok).toBe(false);
    expect(canChangeMainHome(req({ lastChangeHour: NaN }), now).ok).toBe(false);
    expect(canChangeMainHome(req(), NaN).ok).toBe(false);
    expect(canChangeMainHome(req({ targetAttackedThisWindow: undefined }), now).ok).toBe(false);
  });
});
