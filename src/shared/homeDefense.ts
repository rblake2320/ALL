/**
 * When an extra home may be attacked: DATA AND RULES ONLY (docs/CORE_CONCEPT.md section 5).
 *
 * Nothing in the game calls this yet: there are no extra homes, no attacks and no server. It is the agreed rule set,
 * written down as pure functions with tests, so whoever builds the feature starts from rules that already hold.
 *
 * Time is whole hours on the shared town clock (the server's clock, the same for every player). A player's own
 * household clock, which they may pause or speed up, never enters these rules.
 *
 * Every function fails closed: a missing or broken value means "may not be attacked".
 */

/** How often an attack window opens, in town hours (one week). */
export const ATTACK_CYCLE_HOURS = 7 * 24;
/** How long each attack window stays open, in town hours. */
export const ATTACK_WINDOW_HOURS = 24;
/** Attacks one home can receive in one window. */
export const MAX_ATTACKS_PER_WINDOW = 3;
/** "Skip this attack" passes every extra home is given once its grace period ends. More are earned in play. */
export const FREE_PASSES_PER_HOME = 1;
/** Longest single vacation, in town hours. */
export const VACATION_MAX_HOURS = 14 * 24;
/** Windows that must pass after a vacation ends before the next one may start ("not every single time"). */
export const VACATION_COOLDOWN_WINDOWS = 4;
/** Town hours between two changes of main home. */
export const MAIN_HOME_CHANGE_COOLDOWN_HOURS = 30 * 24;
/** No change of main home this close before a window opens (so nobody swaps homes to dodge an attack). */
export const MAIN_HOME_CHANGE_LOCK_HOURS = 24;

export interface HomeDefenseState {
  /** The household's main home is never attackable. */
  isMainHome: boolean;
  /** The household switched the fight-raid-defend mode on (adults and teens of 15+ only; never a child profile). */
  frontierOn: boolean;
  /** Town hour at which the home was bought or finished. */
  acquiredAtHour: number;
  /** Window indexes the owner spent a pass on. */
  passedWindows: readonly number[];
  /** Vacation shield, if one is set. `startHour` inclusive, `endHour` exclusive. */
  vacation: { startHour: number; endHour: number } | null;
  /** Attacks already received in the current window. */
  attacksThisWindow: number;
  /** The home was breached in the current window (it is then shielded until the window closes). */
  breachedThisWindow: boolean;
}

export type NotAttackableReason =
  | 'badInput'
  | 'mainHome'
  | 'frontierOff'
  | 'grace'
  | 'noWindowOpen'
  | 'passUsed'
  | 'vacation'
  | 'breachedThisWindow'
  | 'attackLimit';

export type AttackCheck = { ok: true; window: number } | { ok: false; reason: NotAttackableReason };

const isHour = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Index of the cycle that contains this hour (0-based). */
export function cycleIndexAt(hour: number): number {
  return Math.floor(hour / ATTACK_CYCLE_HOURS);
}

/** Town hour at which window `index` opens. Windows open at the start of each cycle. */
export function windowStartHour(index: number): number {
  return index * ATTACK_CYCLE_HOURS;
}

/** The window open at this hour, or null between windows. */
export function openWindowAt(hour: number): number | null {
  if (!isHour(hour)) return null;
  const i = cycleIndexAt(hour);
  return hour - windowStartHour(i) < ATTACK_WINDOW_HOURS ? i : null;
}

/**
 * The first window in which a home acquired at `acquiredAtHour` may be attacked: the first one that opens at least one
 * full cycle after the home was acquired. A new home therefore always gets between one and two cycles to set up.
 */
export function firstAttackableWindow(acquiredAtHour: number): number {
  if (!isHour(acquiredAtHour)) return Number.POSITIVE_INFINITY;
  return Math.ceil((acquiredAtHour + ATTACK_CYCLE_HOURS) / ATTACK_CYCLE_HOURS);
}

/** May this home be attacked right now? Checks are ordered so the reason shown to a player is the most basic one. */
export function canBeAttacked(home: HomeDefenseState | null | undefined, nowHour: number): AttackCheck {
  if (!home || !isHour(nowHour) || !isHour(home.acquiredAtHour) || !Array.isArray(home.passedWindows)) return { ok: false, reason: 'badInput' };
  if (home.isMainHome !== false) return { ok: false, reason: 'mainHome' };
  if (home.frontierOn !== true) return { ok: false, reason: 'frontierOff' };
  const window = openWindowAt(nowHour);
  if (window === null) return { ok: false, reason: 'noWindowOpen' };
  if (window < firstAttackableWindow(home.acquiredAtHour)) return { ok: false, reason: 'grace' };
  if (home.passedWindows.includes(window)) return { ok: false, reason: 'passUsed' };
  const v = home.vacation;
  if (v && isHour(v.startHour) && isHour(v.endHour) && nowHour >= v.startHour && nowHour < v.endHour) return { ok: false, reason: 'vacation' };
  if (home.breachedThisWindow !== false) return { ok: false, reason: 'breachedThisWindow' };
  if (!Number.isInteger(home.attacksThisWindow) || home.attacksThisWindow < 0 || home.attacksThisWindow >= MAX_ATTACKS_PER_WINDOW) return { ok: false, reason: 'attackLimit' };
  return { ok: true, window };
}

export type PassRefusal = 'badInput' | 'mainHome' | 'noPasses' | 'alreadyUsed' | 'windowOver' | 'grace';

/**
 * Spend one pass on window `window` for this home. A pass may be spent ahead of time or while the window is open, never
 * on a window that has closed, and never on a window the home is already protected in by its grace period.
 */
export function canUsePass(home: HomeDefenseState | null | undefined, passesHeld: number, window: number, nowHour: number): { ok: true } | { ok: false; reason: PassRefusal } {
  if (!home || !isHour(nowHour) || !Number.isInteger(window) || window < 0 || !Array.isArray(home.passedWindows) || !isHour(home.acquiredAtHour)) return { ok: false, reason: 'badInput' };
  if (home.isMainHome !== false) return { ok: false, reason: 'mainHome' };
  if (!Number.isInteger(passesHeld) || passesHeld < 1) return { ok: false, reason: 'noPasses' };
  if (home.passedWindows.includes(window)) return { ok: false, reason: 'alreadyUsed' };
  if (nowHour >= windowStartHour(window) + ATTACK_WINDOW_HOURS) return { ok: false, reason: 'windowOver' };
  if (window < firstAttackableWindow(home.acquiredAtHour)) return { ok: false, reason: 'grace' };
  return { ok: true };
}

export type VacationRefusal = 'badInput' | 'tooLong' | 'inThePast' | 'cooldown' | 'windowOpen';

/**
 * May the household start a vacation shield from `startHour` to `endHour`? `lastVacationEndHour` is when the previous one
 * ended (null if there never was one). A vacation cannot be started while a window is open: it is for planned absence,
 * not for escaping an attack that has begun.
 */
export function canStartVacation(startHour: number, endHour: number, nowHour: number, lastVacationEndHour: number | null): { ok: true } | { ok: false; reason: VacationRefusal } {
  if (!isHour(startHour) || !isHour(endHour) || !isHour(nowHour) || endHour <= startHour) return { ok: false, reason: 'badInput' };
  if (lastVacationEndHour !== null && !isHour(lastVacationEndHour)) return { ok: false, reason: 'badInput' };
  if (startHour < nowHour) return { ok: false, reason: 'inThePast' };
  if (endHour - startHour > VACATION_MAX_HOURS) return { ok: false, reason: 'tooLong' };
  if (openWindowAt(nowHour) !== null) return { ok: false, reason: 'windowOpen' };
  if (lastVacationEndHour !== null && startHour < lastVacationEndHour + VACATION_COOLDOWN_WINDOWS * ATTACK_CYCLE_HOURS) return { ok: false, reason: 'cooldown' };
  return { ok: true };
}

export type MainHomeChangeRefusal = 'badInput' | 'sameHome' | 'notOwned' | 'cooldown' | 'windowOpen' | 'windowSoon' | 'targetUnderAttack';

/**
 * May the household make another of its homes the main home now? The old main home then becomes an ordinary extra home
 * with a fresh grace period (see `afterMainHomeChange`), so moving is never a way to expose or shield a home at once.
 */
export function canChangeMainHome(
  req: { currentMainId: string; targetId: string; ownedHomeIds: readonly string[]; targetAttackedThisWindow: boolean; lastChangeHour: number | null },
  nowHour: number,
): { ok: true } | { ok: false; reason: MainHomeChangeRefusal } {
  if (!req || !isHour(nowHour) || typeof req.currentMainId !== 'string' || typeof req.targetId !== 'string' || !Array.isArray(req.ownedHomeIds)) return { ok: false, reason: 'badInput' };
  if (req.lastChangeHour !== null && !isHour(req.lastChangeHour)) return { ok: false, reason: 'badInput' };
  if (req.targetId === req.currentMainId) return { ok: false, reason: 'sameHome' };
  if (!req.ownedHomeIds.includes(req.targetId) || !req.ownedHomeIds.includes(req.currentMainId)) return { ok: false, reason: 'notOwned' };
  if (openWindowAt(nowHour) !== null) return { ok: false, reason: 'windowOpen' };
  const nextStart = windowStartHour(cycleIndexAt(nowHour) + 1);
  if (nextStart - nowHour <= MAIN_HOME_CHANGE_LOCK_HOURS) return { ok: false, reason: 'windowSoon' };
  if (req.targetAttackedThisWindow !== false) return { ok: false, reason: 'targetUnderAttack' };
  if (req.lastChangeHour !== null && nowHour - req.lastChangeHour < MAIN_HOME_CHANGE_COOLDOWN_HOURS) return { ok: false, reason: 'cooldown' };
  return { ok: true };
}

/** The old main home's state after a change: an extra home whose grace period starts at the moment of the change. */
export function afterMainHomeChange(oldMain: HomeDefenseState, nowHour: number): HomeDefenseState {
  return { ...oldMain, isMainHome: false, acquiredAtHour: nowHour, passedWindows: [], attacksThisWindow: 0, breachedThisWindow: false };
}
