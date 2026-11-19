/**
 * Daily tasks + weekly challenge (docs/MONETIZATION.md §2) — profile level (across all saves), owned by the game layer.
 *
 *  - Task DATA and the objective evaluator come from the sim quests module (src/sim/content/quests/daily.ts,
 *    src/sim/systems/quests/objectives.ts): the same predicates and semantics as story quests, run here on the drained
 *    event stream + a periodic state evaluation. Evaluation only writes our own ObjectiveProgress JSON — the sim is
 *    untouched (determinism; quests never move needs/funds/autonomy).
 *  - 3 tasks a day, rotating at LOCAL midnight: `pickDailyTasks(pool, '<seed>:<YYYY-MM-DD>')` with a per-install seed,
 *    so the pick is deterministic per (install, day) and reloading never re-rolls.
 *  - Rewards are ledger grants with idempotency keys `daily:<day>:<taskId>`, `daily-streak:<day>`,
 *    `weekly:<week>:<challengeId>`: a reload, a lost state record or a duplicate tick can never pay twice, and
 *    `dueGrants()` re-requests everything already earned (a grant lost to a crash is paid on the next start).
 *  - Clock rollback: the newest day ever seen (`maxDay`) is remembered; a clock earlier than that never rotates or
 *    re-opens tasks (they stay on `maxDay` until real time catches up), so setting the clock back pays nothing extra.
 *  - Streak: +1 per consecutive day with all three tasks done; bonus = STREAK_STEP × min(streak, STREAK_CAP).
 */
import type { ObjectiveDef, SimEvent } from '../sim/contracts';
import type { ObjectiveProgress } from '../sim/types';
import { DAILY_TASK_POOL, type DailyTaskDef } from '../sim/content/quests/daily';
import { pickDailyTasks, DAILY_TASKS_PER_DAY } from '../sim/systems/quests/daily';
import { evaluateObjectiveState, objectiveTarget, observeObjectiveEvent, startObjective, type ObjectiveWorld } from '../sim/systems/quests/objectives';

export type { DailyTaskDef };

/** Weekly challenges (game-layer data, same ObjectiveDef vocabulary; validated against the sim's daily rules in tests). */
export const WEEKLY_POOL: readonly DailyTaskDef[] = [
  { id: 'w_cook12', title: 'Cook 12 meals this week', objective: { kind: 'stat', key: 'mealsCooked', count: 12 }, bones: 120 },
  { id: 'w_fix5', title: 'Fix 5 broken things this week', objective: { kind: 'stat', key: 'repairs', count: 5 }, bones: 120 },
  { id: 'w_bills4', title: 'Pay 4 bills on time this week', objective: { kind: 'billsOnTime', count: 4 }, bones: 120 },
  { id: 'w_friends3', title: 'Make 3 new friends this week', objective: { kind: 'friends', count: 3 }, bones: 150 },
  { id: 'w_skills3', title: 'Level up skills 3 times this week', objective: { kind: 'event', event: 'skillUp', count: 3 }, bones: 120 },
  { id: 'w_chat20', title: 'Chat 20 times this week', objective: { kind: 'interaction', ids: ['social_chat'], count: 20 }, bones: 120 },
];

export const TASKS_PER_DAY = DAILY_TASKS_PER_DAY;
export const STREAK_STEP = 5;
export const STREAK_CAP = 7;

export interface DailyState {
  v: 1;
  seed: number;
  /** Day the current tasks belong to (YYYY-MM-DD, local). */
  day: string | null;
  /** Newest day ever observed (clock-rollback guard). */
  maxDay: string | null;
  /** Objective progress per active task id (sim ObjectiveProgress JSON). */
  progress: Record<string, ObjectiveProgress>;
  claimed: string[];
  streak: number;
  /** Last day all three tasks were completed. */
  lastFullDay: string | null;
  week: string | null;
  weekProgress: ObjectiveProgress | null;
  weekClaimed: boolean;
}

export function freshDailyState(seed: number): DailyState {
  return { v: 1, seed: seed >>> 0, day: null, maxDay: null, progress: {}, claimed: [], streak: 0, lastFullDay: null, week: null, weekProgress: null, weekClaimed: false };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function progressOk(v: unknown): v is ObjectiveProgress {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  return isNum(p.progress) && p.progress >= 0 && isNum(p.baseline) && isNum(p.heldMin) && isNum(p.startTick) && isNum(p.startDay) && Array.isArray(p.seen) && p.seen.length <= 256 && p.seen.every((s) => typeof s === 'string') && typeof p.worldId === 'string' && typeof p.done === 'boolean';
}

/** Sanitise stored state (anything malformed is reset field by field; never throws). */
export function sanitizeDailyState(raw: unknown, fallbackSeed: number): DailyState {
  const d = freshDailyState(fallbackSeed);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  if (Number.isSafeInteger(r.seed) && (r.seed as number) >= 0) d.seed = (r.seed as number) >>> 0;
  if (typeof r.day === 'string' && DAY_RE.test(r.day)) d.day = r.day;
  if (typeof r.maxDay === 'string' && DAY_RE.test(r.maxDay)) d.maxDay = r.maxDay;
  if (d.day && (!d.maxDay || d.day > d.maxDay)) d.maxDay = d.day;
  const active = d.day ? new Set(tasksForDay(d.seed, d.day).map((t) => t.id)) : new Set<string>();
  if (r.progress && typeof r.progress === 'object' && !Array.isArray(r.progress)) {
    for (const [k, v] of Object.entries(r.progress as Record<string, unknown>)) if (active.has(k) && progressOk(v)) d.progress[k] = v;
  }
  if (Array.isArray(r.claimed)) d.claimed = [...new Set(r.claimed.filter((x): x is string => typeof x === 'string' && active.has(x)))];
  if (Number.isSafeInteger(r.streak) && (r.streak as number) >= 0) d.streak = Math.min(r.streak as number, 10_000);
  if (typeof r.lastFullDay === 'string' && DAY_RE.test(r.lastFullDay)) d.lastFullDay = r.lastFullDay;
  if (typeof r.week === 'string' && WEEK_RE.test(r.week)) d.week = r.week;
  if (progressOk(r.weekProgress)) d.weekProgress = r.weekProgress;
  d.weekClaimed = r.weekClaimed === true;
  return d;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Local calendar day of a Date ('YYYY-MM-DD'). */
export function localDayKey(now: Date): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function dayToUtcMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const t = new Date(dayToUtcMs(day) + n * 86_400_000);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** ISO-8601 week of a calendar day ('YYYY-Www'). */
export function isoWeekKey(day: string): string {
  const t = new Date(dayToUtcMs(day));
  const dow = (t.getUTCDay() + 6) % 7; // Mon = 0
  t.setUTCDate(t.getUTCDate() - dow + 3); // Thursday decides the year
  const year = t.getUTCFullYear();
  const firstThu = new Date(Date.UTC(year, 0, 4));
  firstThu.setUTCDate(firstThu.getUTCDate() - ((firstThu.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86_400_000));
  return `${year}-W${pad(week)}`;
}

export function tasksForDay(seed: number, day: string): DailyTaskDef[] {
  return pickDailyTasks(DAILY_TASK_POOL, `${seed >>> 0}:${day}`, TASKS_PER_DAY);
}

export function challengeForWeek(seed: number, week: string): DailyTaskDef {
  return pickDailyTasks(WEEKLY_POOL, `${seed >>> 0}:${week}:weekly`, 1)[0];
}

export interface Rollover {
  state: DailyState;
  /** True when the wall clock is earlier than a day already seen (no rotation happened). */
  clockRollback: boolean;
  rotated: boolean;
}

/** Bring the state to `now` (rotates at local midnight; never moves backwards). Pure. */
export function rollover(prev: DailyState, now: Date): Rollover {
  const today = localDayKey(now);
  const s = clone(prev);
  if (s.maxDay && today < s.maxDay) return { state: s, clockRollback: true, rotated: false };
  s.maxDay = today;
  if (s.day === today) return { state: s, clockRollback: false, rotated: false };
  // New day: the streak survives only if yesterday was a full day.
  if (s.lastFullDay !== addDays(today, -1) && s.lastFullDay !== today) s.streak = 0;
  s.day = today;
  s.progress = {};
  s.claimed = [];
  const week = isoWeekKey(today);
  if (s.week !== week) {
    s.week = week;
    s.weekProgress = null;
    s.weekClaimed = false;
  }
  return { state: s, clockRollback: false, rotated: true };
}

export interface GrantDue {
  key: string;
  bones: number;
  reason: string;
  source: 'daily' | 'weekly' | 'streak';
}

function clone(s: DailyState): DailyState {
  return JSON.parse(JSON.stringify(s)) as DailyState;
}

/** Every grant the state says was earned (idempotent keys; the ledger refuses the ones already paid). */
export function dueGrants(s: DailyState): GrantDue[] {
  const out: GrantDue[] = [];
  if (s.day) {
    const tasks = tasksForDay(s.seed, s.day);
    for (const t of tasks) if (s.claimed.includes(t.id)) out.push({ key: `daily:${s.day}:${t.id}`, bones: t.bones, reason: `Daily task: ${t.title}`, source: 'daily' });
    if (s.lastFullDay === s.day && s.streak > 0) out.push({ key: `daily-streak:${s.day}`, bones: STREAK_STEP * Math.min(s.streak, STREAK_CAP), reason: `Daily streak ×${s.streak}`, source: 'streak' });
  }
  if (s.week && s.weekClaimed) {
    const c = challengeForWeek(s.seed, s.week);
    out.push({ key: `weekly:${s.week}:${c.id}`, bones: c.bones, reason: `Weekly challenge: ${c.title}`, source: 'weekly' });
  }
  return out;
}

/** Mark finished objectives claimed, update the streak; returns the grants that became due in this step. */
function settle(s: DailyState): GrantDue[] {
  const due: GrantDue[] = [];
  if (s.day) {
    for (const t of tasksForDay(s.seed, s.day)) {
      if (s.claimed.includes(t.id) || !s.progress[t.id]?.done) continue;
      s.claimed.push(t.id);
      due.push({ key: `daily:${s.day}:${t.id}`, bones: t.bones, reason: `Daily task: ${t.title}`, source: 'daily' });
    }
    if (s.claimed.length >= TASKS_PER_DAY && s.lastFullDay !== s.day) {
      s.streak = s.lastFullDay === addDays(s.day, -1) ? s.streak + 1 : 1;
      s.lastFullDay = s.day;
      due.push({ key: `daily-streak:${s.day}`, bones: STREAK_STEP * Math.min(s.streak, STREAK_CAP), reason: `Daily streak ×${s.streak}`, source: 'streak' });
    }
  }
  if (s.week && !s.weekClaimed && s.weekProgress?.done) {
    s.weekClaimed = true;
    const c = challengeForWeek(s.seed, s.week);
    due.push({ key: `weekly:${s.week}:${c.id}`, bones: c.bones, reason: `Weekly challenge: ${c.title}`, source: 'weekly' });
  }
  return due;
}

function activeObjectives(s: DailyState, w: ObjectiveWorld): { o: ObjectiveDef; p: ObjectiveProgress }[] {
  const out: { o: ObjectiveDef; p: ObjectiveProgress }[] = [];
  if (s.day) {
    for (const t of tasksForDay(s.seed, s.day)) {
      if (s.claimed.includes(t.id)) continue;
      const p = s.progress[t.id] ?? (s.progress[t.id] = startObjective(t.objective, w));
      out.push({ o: t.objective, p });
    }
  }
  if (s.week && !s.weekClaimed) {
    const c = challengeForWeek(s.seed, s.week);
    if (!s.weekProgress) s.weekProgress = startObjective(c.objective, w);
    out.push({ o: c.objective, p: s.weekProgress });
  }
  return out;
}

/** Feed drained sim events (EVENT kinds). Pure: returns a new state + grants that became due. */
export function observeEvents(prev: DailyState, events: readonly SimEvent[], w: ObjectiveWorld): { state: DailyState; due: GrantDue[]; changed: boolean } {
  const s = clone(prev);
  let changed = false;
  for (const { o, p } of activeObjectives(s, w)) {
    for (const e of events) {
      try {
        if (observeObjectiveEvent(o, p, e, w)) changed = true;
      } catch {
        /* malformed event: skipped */
      }
    }
  }
  const due = settle(s);
  return { state: s, due, changed: changed || due.length > 0 || JSON.stringify(s) !== JSON.stringify(prev) };
}

/** Periodic STATE evaluation (`elapsedMin` = game minutes since the last call). Pure. */
export function evaluateState(prev: DailyState, w: ObjectiveWorld, elapsedMin: number): { state: DailyState; due: GrantDue[]; changed: boolean } {
  const s = clone(prev);
  let changed = false;
  for (const { o, p } of activeObjectives(s, w)) {
    try {
      if (evaluateObjectiveState(o, p, w, elapsedMin)) changed = true;
    } catch {
      /* fault barrier */
    }
  }
  const due = settle(s);
  return { state: s, due, changed: changed || due.length > 0 || JSON.stringify(s) !== JSON.stringify(prev) };
}

export interface TaskProgressView {
  id: string;
  title: string;
  progress: number;
  target: number;
  bones: number;
  done: boolean;
}

export function viewTasks(s: DailyState): { tasks: TaskProgressView[]; weekly: TaskProgressView | null } {
  const tasks = s.day
    ? tasksForDay(s.seed, s.day).map((t) => {
        const p = s.progress[t.id];
        const target = objectiveTarget(t.objective);
        const done = s.claimed.includes(t.id);
        return { id: t.id, title: t.title, progress: done ? target : Math.min(target, Math.floor(p?.progress ?? 0)), target, bones: t.bones, done };
      })
    : [];
  let weekly: TaskProgressView | null = null;
  if (s.week) {
    const c = challengeForWeek(s.seed, s.week);
    const target = objectiveTarget(c.objective);
    weekly = { id: c.id, title: c.title, progress: s.weekClaimed ? target : Math.min(target, Math.floor(s.weekProgress?.progress ?? 0)), target, bones: c.bones, done: s.weekClaimed };
  }
  return { tasks, weekly };
}
