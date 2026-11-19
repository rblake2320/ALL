/**
 * Career schedule math (GDD §10): shift windows per day, the next shift, schedule/status labels.
 * A shift belongs to the day it STARTS on (Graveyard Retail 22:00 → 04:00 belongs to the evening's day).
 */
import type { CareerDef, CareerLevelDef, SimContext } from '../../../contracts';
import type { AgentState, CareerState } from '../../../types';
import { formatClock, relativeLabel, tickAt, timeInfo, WEEKDAY_SHORT } from '../../../time';
import { clamp, isNum, num, TICKS_PER_HOUR } from '../util';

export const CARPOOL_NOTICE_MIN = 60;
export const CARPOOL_ARRIVES_MIN = 30;
/** How late a zombie may leave and still make the shift. */
export const LATE_GRACE_MIN = 60;
export const MAX_SICK_DAYS = 3;

export interface ShiftWindow {
  day: number;
  startTick: number;
  endTick: number;
}

export function careerDefOf(ctx: SimContext, c: CareerState | null | undefined): CareerDef | null {
  if (!c || typeof c.trackId !== 'string') return null;
  const d = ctx.content.careers[c.trackId];
  return d && Array.isArray(d.levels) && d.levels.length > 0 ? d : null;
}

export function levelIndex(def: CareerDef, level: unknown): number {
  return clamp(Math.floor(num(level, 1)), 1, def.levels.length) - 1;
}

export function levelDefOf(def: CareerDef, level: unknown): CareerLevelDef {
  return def.levels[levelIndex(def, level)];
}

export function weekdayOf(day: number): number {
  return (((Math.floor(day) - 1) % 7) + 7) % 7;
}

export function isWorkday(level: CareerLevelDef, day: number): boolean {
  return Array.isArray(level.days) && level.days.includes(weekdayOf(day));
}

export function shiftWindow(level: CareerLevelDef, day: number): ShiftWindow | null {
  if (!isNum(day) || day < 1 || !isWorkday(level, day)) return null;
  const startHour = clamp(num(level.startHour, 9), 0, 23.99);
  const hours = clamp(num(level.hours, 8), 0.25, 23);
  const startTick = tickAt(day, Math.round(startHour * 60));
  return { day, startTick, endTick: startTick + Math.round(hours * TICKS_PER_HOUR) };
}

/** Next shift that hasn't been resolved yet (today's if still ahead/pending, else the next workday). */
export function nextShift(ctx: SimContext, agent: AgentState): ShiftWindow | null {
  const def = careerDefOf(ctx, agent.career);
  if (!def || !agent.career) return null;
  const lvl = levelDefOf(def, agent.career.level);
  const today = ctx.time.day;
  for (let d = today; d <= today + 8; d++) {
    const w = shiftWindow(lvl, d);
    if (!w) continue;
    if (d === today && agent.career.lastShiftDay === today) continue;
    if (w.endTick <= ctx.state.tick) continue;
    return w;
  }
  return null;
}

function dayRange(days: number[]): string {
  const sorted = Array.from(new Set(days.filter((d) => isNum(d) && d >= 0 && d <= 6))).sort((a, b) => a - b);
  if (sorted.length === 0) return 'No days';
  if (sorted.length === 7) return 'Every day';
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length > 2) return `${WEEKDAY_SHORT[sorted[0]]}–${WEEKDAY_SHORT[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(', ');
}

function hourLabel(h: number): string {
  const hh = ((Math.floor(h) % 24) + 24) % 24;
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12} ${hh < 12 ? 'AM' : 'PM'}`;
}

export function scheduleLabel(level: CareerLevelDef): string {
  const start = num(level.startHour, 9);
  const end = start + num(level.hours, 8);
  return `${dayRange(level.days)} · ${hourLabel(start)}–${hourLabel(end)}`;
}

export function clockLabel(tick: number): string {
  return formatClock(timeInfo(num(tick, 0)).minuteOfDay);
}

export function whenLabel(ctx: SimContext, tick: number): string {
  return relativeLabel(ctx.state.tick, tick);
}
