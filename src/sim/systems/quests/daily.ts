/** Deterministic daily-task picker for the game layer (profile-level; rotation key = local date + profile seed). */
import type { DailyTaskDef } from '../../content/quests/daily';
import { fnv1a } from './state';

export const DAILY_TASKS_PER_DAY = 3;

/**
 * `count` distinct tasks for `key` (e.g. `${profileSeed}:${'2026-11-05'}`): same key → same tasks on every device and
 * after every reload; no Math.random, no clock.
 */
export function pickDailyTasks(pool: readonly DailyTaskDef[], key: string, count = DAILY_TASKS_PER_DAY): DailyTaskDef[] {
  const left = pool.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: DailyTaskDef[] = [];
  for (let i = 0; i < count && left.length > 0; i++) out.push(left.splice(fnv1a(`${key}#${i}`) % left.length, 1)[0]);
  return out;
}
