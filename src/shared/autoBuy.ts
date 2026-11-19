/**
 * Autonomous purchases (W-116, D-063): a household setting that limits what zombies may spend ON THEIR OWN.
 *
 *   flags['household.autoBuy']        'off' | <daily cap in $>   (absent, 'unlimited' or junk = Unlimited)
 *   flags['household.autoBuy.day']    1-based game day the running total belongs to
 *   flags['household.autoBuy.spent']  $ spent autonomously that day
 *
 * Sim-owned and deterministic: the allowance is pure world data, the day rolls over at local in-game midnight
 * (src/sim/time.ts), and nothing is ever written while the setting is Unlimited — so old saves and the starter / empty
 * lots (no flag) run byte-identically. New derelict worlds start with a $50 daily cap (world.ts).
 *
 * Enforcement (engine): autonomy never picks a candidate whose known cost exceeds the remaining allowance
 * (autonomy.ts preScore, via `autoCostOf`), and every spend made on behalf of an AUTONOMOUS run passes
 * `{ autonomous: true }` to ctx.spend, which refuses it over the allowance (the hard guarantee). Player-queued and
 * system actions never pass it, so they are never blocked; events (raven theft, bills) are not purchases.
 */
import type { WorldState } from '../sim/types';
import { timeInfo } from '../sim/time';

export const AUTO_BUY_FLAG = 'household.autoBuy';
export const AUTO_BUY_DAY_FLAG = 'household.autoBuy.day';
export const AUTO_BUY_SPENT_FLAG = 'household.autoBuy.spent';
/** Default daily cap on NEW derelict (story-start) worlds. */
export const DEFAULT_AUTO_BUY_CAP = 50;
/** Largest cap accepted (anything above is just "a lot"). */
export const MAX_AUTO_BUY_CAP = 100_000;

export type AutoBuySetting = { mode: 'unlimited' } | { mode: 'off' } | { mode: 'cap'; cap: number };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The household's setting (never throws; junk reads as Unlimited — the old behaviour). */
export function autoBuySetting(state: WorldState | null | undefined): AutoBuySetting {
  const v = state && state.flags ? state.flags[AUTO_BUY_FLAG] : undefined;
  if (v === 'off') return { mode: 'off' };
  if (isNum(v) && v >= 0) return { mode: 'cap', cap: Math.min(MAX_AUTO_BUY_CAP, Math.floor(v)) };
  return { mode: 'unlimited' };
}

function today(state: WorldState): number {
  return timeInfo(isNum(state.tick) && state.tick > 0 ? Math.floor(state.tick) : 0).day;
}

/** $ spent autonomously today (0 after midnight, before any spend). */
export function autoSpentToday(state: WorldState): number {
  const f = state.flags ?? {};
  if (f[AUTO_BUY_DAY_FLAG] !== today(state)) return 0;
  const s = f[AUTO_BUY_SPENT_FLAG];
  return isNum(s) && s > 0 ? Math.floor(s) : 0;
}

/** What autonomy may still spend today: Infinity (Unlimited), 0 (Off) or the cap minus today's spending. */
export function autoAllowance(state: WorldState): number {
  const s = autoBuySetting(state);
  if (s.mode === 'unlimited') return Infinity;
  if (s.mode === 'off') return 0;
  return Math.max(0, s.cap - autoSpentToday(state));
}

/** Count an autonomous spend toward today's total (no write while Unlimited). */
export function recordAutoSpend(state: WorldState, amount: number): void {
  if (!(amount > 0) || autoBuySetting(state).mode === 'unlimited') return;
  if (!state.flags) state.flags = {};
  const d = today(state);
  const spent = autoSpentToday(state) + Math.round(amount);
  state.flags[AUTO_BUY_DAY_FLAG] = d;
  state.flags[AUTO_BUY_SPENT_FLAG] = spent;
}

/** Parse a UI / command value: 'off' | 'unlimited' | a cap in $. Null when invalid. */
export function parseAutoBuy(v: unknown): AutoBuySetting | null {
  if (v === 'off') return { mode: 'off' };
  if (v === 'unlimited') return { mode: 'unlimited' };
  if (isNum(v) && v >= 0 && v <= MAX_AUTO_BUY_CAP) return { mode: 'cap', cap: Math.floor(v) };
  return null;
}

/** Write the setting (Unlimited removes the flag — the classic state). Today's running total is kept. */
export function setAutoBuy(state: WorldState, s: AutoBuySetting): void {
  if (!state.flags) state.flags = {};
  if (s.mode === 'unlimited') delete state.flags[AUTO_BUY_FLAG];
  else state.flags[AUTO_BUY_FLAG] = s.mode === 'off' ? 'off' : s.cap;
}
