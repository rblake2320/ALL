import { TICK_MINUTES } from './types';
import type { TimeInfo } from './contracts';

export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The world clock starts on Day 1 (Monday) at this minute of day. */
export const START_MINUTE_OF_DAY = 9 * 60;

export function ticksToMinutes(tick: number): number {
  return tick * TICK_MINUTES;
}

export function minutesToTicks(min: number): number {
  return Math.round(min / TICK_MINUTES);
}

export function formatClock(minuteOfDay: number): string {
  const m = ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm.toString().padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function timeInfo(tick: number): TimeInfo {
  const totalMinutes = START_MINUTE_OF_DAY + ticksToMinutes(tick);
  const dayIndex = Math.floor(totalMinutes / 1440);
  const minuteOfDay = Math.floor(totalMinutes - dayIndex * 1440);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const day = dayIndex + 1;
  const weekday = dayIndex % 7;
  const isNight = hour >= 20 || hour < 6;
  // Full moon night: evening of every 7th day through the following dawn.
  const fullMoon = (hour >= 20 && day % 7 === 0) || (hour < 6 && (day - 1) % 7 === 0 && day > 1);
  return {
    tick,
    totalMinutes,
    day,
    weekday,
    weekdayName: WEEKDAY_NAMES[weekday],
    hour,
    minute,
    minuteOfDay,
    isNight,
    label: `${WEEKDAY_SHORT[weekday]} ${formatClock(minuteOfDay)}`,
    fullMoon,
  };
}

/** Tick at which a given (day, minuteOfDay) occurs. */
export function tickAt(day: number, minuteOfDay: number): number {
  const total = (day - 1) * 1440 + minuteOfDay - START_MINUTE_OF_DAY;
  return minutesToTicks(total);
}

/** Human label for a future tick relative to now: 'Today 5:00 PM', 'Tomorrow 9:00 AM', 'Thu 9:00 AM'. */
export function relativeLabel(nowTick: number, tick: number): string {
  const now = timeInfo(nowTick);
  const t = timeInfo(tick);
  if (t.day === now.day) return `Today ${formatClock(t.minuteOfDay)}`;
  if (t.day === now.day + 1) return `Tomorrow ${formatClock(t.minuteOfDay)}`;
  if (t.day === now.day - 1) return `Yesterday ${formatClock(t.minuteOfDay)}`;
  return t.label;
}
