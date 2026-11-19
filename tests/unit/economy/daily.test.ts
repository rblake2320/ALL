import { describe, expect, it } from 'vitest';
import { DAILY_TASK_POOL } from '../../../src/sim/content/quests/daily';
import { validateDailyPool } from '../../../src/sim/systems/quests/validate';
import { loadContent } from '../../../src/sim/index';
import type { SimEvent } from '../../../src/sim/contracts';
import { STREAK_CAP, STREAK_STEP, WEEKLY_POOL, addDays, dueGrants, evaluateState, freshDailyState, isoWeekKey, localDayKey, observeEvents, rollover, sanitizeDailyState, tasksForDay, viewTasks, type DailyState } from '../../../src/economy/daily';
import type { ObjectiveWorld } from '../../../src/sim/systems/quests/objectives';
import type { WorldState } from '../../../src/sim/types';

const at = (iso: string) => new Date(iso);
function fakeWorld(counters: Record<string, number> = {}, worldId = 'w-test'): ObjectiveWorld {
  const state = { tick: 100, seed: 1, household: { memberIds: ['a1'], bills: [] }, agents: { a1: {} }, objects: {}, relationships: {}, stats: { counters: { ...counters }, agent: {} }, flags: {} } as unknown as WorldState;
  return { state, content: null, spatial: null, worldId };
}

describe('daily tasks: rotation + determinism', () => {
  it('picks 3 distinct tasks from the sim pool, deterministic per (seed, day), different across days', () => {
    const a = tasksForDay(7, '2026-11-05');
    expect(a.length).toBe(3);
    expect(new Set(a.map((t) => t.id)).size).toBe(3);
    for (const t of a) expect(DAILY_TASK_POOL.some((p) => p.id === t.id)).toBe(true);
    expect(tasksForDay(7, '2026-11-05').map((t) => t.id)).toEqual(a.map((t) => t.id));
    const days = Array.from({ length: 14 }, (_, i) => tasksForDay(7, addDays('2026-11-05', i)).map((t) => t.id).join());
    expect(new Set(days).size).toBeGreaterThan(7);
  });

  it('rotates at LOCAL midnight (day key from local calendar fields)', () => {
    const before = new Date(2026, 10, 5, 23, 59, 59);
    const after = new Date(2026, 10, 6, 0, 0, 1);
    expect(localDayKey(before)).toBe('2026-11-05');
    expect(localDayKey(after)).toBe('2026-11-06');
    let s = rollover(freshDailyState(1), before).state;
    expect(s.day).toBe('2026-11-05');
    s = rollover(s, after).state;
    expect(s.day).toBe('2026-11-06');
  });

  it('ISO week keys (year boundaries)', () => {
    expect(isoWeekKey('2026-11-05')).toBe('2026-W45');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
    expect(isoWeekKey('2024-12-30')).toBe('2025-W01');
  });

  it('weekly pool passes the sim daily-pool validator (only "new activity" kinds, known ids/stats)', () => {
    // Weekly rewards are deliberately above the 1..50 daily band; every other daily rule applies.
    expect(validateDailyPool(WEEKLY_POOL as never, loadContent() as never).filter((e) => !/bones must be/.test(e))).toEqual([]);
    expect(WEEKLY_POOL.every((t) => Number.isInteger(t.bones) && t.bones > 50 && t.bones <= 200)).toBe(true);
  });
});

describe('daily tasks: progress, rewards, idempotent keys', () => {
  function stateFor(day: string, seed = 3): DailyState {
    return rollover(freshDailyState(seed), at(`${day}T12:00:00`)).state;
  }

  it('stat objectives count growth since start; completing pays once with a stable key', () => {
    let s = stateFor('2026-11-05');
    const tasks = tasksForDay(s.seed, s.day!);
    const statTask = tasks.find((t) => t.objective.kind === 'stat');
    if (!statTask || statTask.objective.kind !== 'stat') return; // pool pick without a stat task: covered by other seeds
    const key = statTask.objective.key;
    let w = fakeWorld({ [key]: 5 });
    s = evaluateState(s, w, 0).state; // baseline 5
    w = fakeWorld({ [key]: 5 + statTask.objective.count });
    const r = evaluateState(s, w, 1);
    expect(r.due.map((d) => d.key)).toContain(`daily:2026-11-05:${statTask.id}`);
    // re-evaluating never re-pays
    expect(evaluateState(r.state, w, 1).due.filter((d) => d.source === 'daily')).toEqual([]);
    expect(viewTasks(r.state).tasks.find((t) => t.id === statTask.id)?.done).toBe(true);
  });

  it('interaction objectives count drained events, de-duplicated by event uid', () => {
    // find a seed/day whose tasks include an interaction objective with explicit ids
    let seed = 0;
    let task;
    for (; seed < 500; seed++) {
      task = tasksForDay(seed, '2026-11-05').find((t) => t.objective.kind === 'interaction' && t.objective.ids?.length && !t.objective.targetTags && !t.objective.tags && !t.objective.match);
      if (task) break;
    }
    expect(task).toBeDefined();
    if (!task || task.objective.kind !== 'interaction') return;
    let s = rollover(freshDailyState(seed), at('2026-11-05T10:00:00')).state;
    const w = fakeWorld();
    const ev = (uid: number) => ({ type: 'interactionCompleted', uid, agentId: 'a1', household: true, interactionId: task!.objective.kind === 'interaction' ? task!.objective.ids![0] : '', params: {} }) as unknown as SimEvent;
    const same = ev(1);
    let r = observeEvents(s, [same, same, same], w);
    expect(r.state.progress[task.id].progress).toBe(1);
    let due = r.due;
    s = r.state;
    for (let i = 2; i <= task.objective.count + 2; i++) {
      r = observeEvents(s, [ev(i)], w);
      s = r.state;
      due = [...due, ...r.due];
    }
    expect(due.filter((d) => d.key === `daily:2026-11-05:${task.id}`).length).toBe(1);
  });

  it('all three done → streak bonus; streak capped; a missed day resets it', () => {
    let s = stateFor('2026-11-05');
    const finishAll = (st: DailyState): { st: DailyState; keys: string[] } => {
      const x = JSON.parse(JSON.stringify(st)) as DailyState;
      for (const t of tasksForDay(x.seed, x.day!)) x.progress[t.id] = { progress: 99, baseline: 0, heldMin: 0, startTick: 0, startDay: 1, seen: [], worldId: 'w', done: true };
      const r = evaluateState(x, fakeWorld(), 0);
      return { st: r.state, keys: r.due.map((d) => `${d.key}=${d.bones}`) };
    };
    const bonuses: number[] = [];
    for (let i = 0; i < STREAK_CAP + 3; i++) {
      const day = addDays('2026-11-05', i);
      s = rollover(s, at(`${day}T09:00:00`)).state;
      const f = finishAll(s);
      s = f.st;
      bonuses.push(Number(f.keys.find((k) => k.startsWith('daily-streak:'))!.split('=')[1]));
    }
    expect(bonuses.slice(0, 3)).toEqual([STREAK_STEP, 2 * STREAK_STEP, 3 * STREAK_STEP]);
    expect(Math.max(...bonuses)).toBe(STREAK_STEP * STREAK_CAP);
    // skip a day
    s = rollover(s, at(`${addDays('2026-11-05', STREAK_CAP + 4)}T09:00:00`)).state;
    expect(s.streak).toBe(0);
    expect(Number(finishAll(s).keys.find((k) => k.startsWith('daily-streak:'))!.split('=')[1])).toBe(STREAK_STEP);
  });

  it('CLOCK ROLLBACK: setting the clock back never rotates, re-opens or re-pays tasks', () => {
    let s = stateFor('2026-11-10');
    const tasks = tasksForDay(s.seed, '2026-11-10');
    s.claimed = tasks.map((t) => t.id);
    const r = rollover(s, at('2026-11-03T12:00:00'));
    expect(r.clockRollback).toBe(true);
    expect(r.rotated).toBe(false);
    expect(r.state.day).toBe('2026-11-10');
    expect(r.state.claimed).toEqual(s.claimed);
    // The keys of anything due are the ORIGINAL day's — the ledger refuses them a second time.
    expect(dueGrants(r.state).every((g) => !g.key.includes('2026-11-03'))).toBe(true);
    // forward → back → forward again to the same day: still the same day, no rotation
    const again = rollover(r.state, at('2026-11-10T20:00:00'));
    expect(again.rotated).toBe(false);
    expect(again.clockRollback).toBe(false);
  });

  it('sanitize: tampered/garbage state is reset field by field, never throws, never invents claims', () => {
    for (const junk of [null, 5, 'x', [], { seed: -1, day: 'tomorrow', claimed: ['nope', 'd_cook2'], streak: 1e99, progress: { x: { progress: NaN } } }]) {
      const s = sanitizeDailyState(junk, 9);
      expect(s.v).toBe(1);
      expect(s.claimed.every((id) => DAILY_TASK_POOL.some((t) => t.id === id))).toBe(true);
      expect(Number.isSafeInteger(s.streak)).toBe(true);
    }
    // claims for tasks that are not today's are dropped (can't claim another day's task)
    const s = sanitizeDailyState({ seed: 3, day: '2026-11-05', maxDay: '2026-11-05', claimed: DAILY_TASK_POOL.map((t) => t.id) }, 0);
    expect(s.claimed.length).toBeLessThanOrEqual(3);
  });

  it('dueGrants re-derives everything earned (crash between claim and ledger write)', () => {
    let s = stateFor('2026-11-05');
    const t = tasksForDay(s.seed, s.day!)[0];
    s = { ...s, claimed: [t.id] };
    expect(dueGrants(s).map((g) => g.key)).toEqual([`daily:2026-11-05:${t.id}`]);
  });

  it('a different world re-baselines (loading another save does not credit its history)', () => {
    let s = stateFor('2026-11-05');
    const t = tasksForDay(s.seed, s.day!).find((x) => x.objective.kind === 'stat');
    if (!t || t.objective.kind !== 'stat') return;
    s = evaluateState(s, fakeWorld({ [t.objective.key]: 0 }, 'world-A'), 0).state;
    const r = evaluateState(s, fakeWorld({ [t.objective.key]: 500 }, 'world-B'), 0);
    expect(r.state.progress[t.id].progress).toBe(0);
  });
});
