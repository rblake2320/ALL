/** Pure objective evaluator: every kind, de-duplication, latching, holds, cross-world re-baselining, junk input. */
import { describe, expect, it } from 'vitest';
import type { ObjectiveDef, SimEvent } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { createNewWorld, loadContent } from '../../../src/sim/index';
import {
  evaluateObjectiveState,
  objectiveFraction,
  objectiveTarget,
  objectiveWorldOf,
  observeObjectiveEvent,
  startObjective,
  type ObjectiveWorld,
} from '../../../src/sim/systems/quests';
import { jsonClone, opts } from './helpers';

const base = createNewWorld(opts(9));
const content = loadContent();

function world(mut?: (s: WorldState) => void, worldId = 'W1'): ObjectiveWorld {
  const s = jsonClone(base);
  mut?.(s);
  return { state: s, content, spatial: null, worldId };
}

const done = (uid: number, interactionId: string, extra: Partial<Extract<SimEvent, { type: 'interactionCompleted' }>> = {}): SimEvent => ({
  type: 'interactionCompleted',
  uid,
  agentId: base.household.memberIds[0],
  interactionId,
  targetId: null,
  source: 'player',
  household: true,
  params: {},
  ...extra,
});

describe('objective evaluator', () => {
  it('interaction: ids / tags / match / targetTags, household only, duplicates ignored, done latches', () => {
    const w = world();
    const o: ObjectiveDef = { kind: 'interaction', tags: ['cook'], match: { recipe: 'brainLoaf' }, count: 2 };
    const p = startObjective(o, w);
    expect(observeObjectiveEvent(o, p, done(1, 'home_cook', { params: { recipe: 'brainLoaf' } }), w)).toBe(true);
    expect(observeObjectiveEvent(o, p, done(1, 'home_cook', { params: { recipe: 'brainLoaf' } }), w)).toBe(false); // duplicate delivery
    expect(observeObjectiveEvent(o, p, done(2, 'home_cook', { params: { recipe: 'cerebellumStew' } }), w)).toBe(false); // wrong recipe
    expect(observeObjectiveEvent(o, p, done(3, 'home_watchTv'), w)).toBe(false); // wrong tag
    expect(observeObjectiveEvent(o, p, done(4, 'home_cook', { params: { recipe: 'brainLoaf' }, household: false }), w)).toBe(false); // visitor
    expect(p.progress).toBe(1);
    expect(observeObjectiveEvent(o, p, done(5, 'home_cookAtStove', { params: { recipe: 'brainLoaf' } }), w)).toBe(true);
    expect(p.done).toBe(true);
    expect(observeObjectiveEvent(o, p, done(6, 'home_cook', { params: { recipe: 'brainLoaf' } }), w)).toBe(false);
    expect(p.progress).toBe(2);
    expect(objectiveFraction(o, p)).toBe(1);

    const coffin = Object.values(w.state.objects).find((x) => x.defId.startsWith('coffin'));
    const t: ObjectiveDef = { kind: 'interaction', ids: ['home_sleep'], targetTags: ['coffin'], count: 1 };
    const pt = startObjective(t, w);
    expect(observeObjectiveEvent(t, pt, done(7, 'home_sleep', { targetId: 'o-missing' }), w)).toBe(false);
    if (coffin) {
      expect(observeObjectiveEvent(t, pt, done(8, 'home_sleep', { targetId: coffin.id }), w)).toBe(true);
      expect(pt.done).toBe(true);
    }
  });

  it('event: skillUp with skill/minLevel filters, non-members and replays ignored', () => {
    const w = world();
    const me = base.household.memberIds[0];
    const o: ObjectiveDef = { kind: 'event', event: 'skillUp', skill: 'cooking', minLevel: 2, count: 2 };
    const p = startObjective(o, w);
    const su = (agentId: string, skill: 'cooking' | 'logic', level: number): SimEvent => ({ type: 'skillUp', agentId, skill, level });
    expect(observeObjectiveEvent(o, p, su(me, 'cooking', 1), w)).toBe(false);
    expect(observeObjectiveEvent(o, p, su(me, 'logic', 2), w)).toBe(false);
    expect(observeObjectiveEvent(o, p, su('a99999', 'cooking', 2), w)).toBe(false);
    expect(observeObjectiveEvent(o, p, su(me, 'cooking', 2), w)).toBe(true);
    expect(observeObjectiveEvent(o, p, su(me, 'cooking', 2), w)).toBe(false); // same level-up replayed
    expect(observeObjectiveEvent(o, p, su(me, 'cooking', 3), w)).toBe(true);
    expect(p.done).toBe(true);
  });

  it('stat: counts growth from the baseline only; a counter going down never reduces progress', () => {
    const w = world((s) => (s.stats.counters.repairs = 5));
    const o: ObjectiveDef = { kind: 'stat', key: 'repairs', count: 2 };
    const p = startObjective(o, w);
    expect(p.baseline).toBe(5);
    evaluateObjectiveState(o, p, w, 1);
    expect(p.progress).toBe(0);
    w.state.stats.counters.repairs = 6;
    expect(evaluateObjectiveState(o, p, w, 1)).toBe(true);
    expect(p.progress).toBe(1);
    w.state.stats.counters.repairs = 0; // corrupted / reset counter
    evaluateObjectiveState(o, p, w, 1);
    expect(p.progress).toBe(1);
    w.state.stats.counters.repairs = 7;
    evaluateObjectiveState(o, p, w, 1);
    expect(p.done).toBe(true);
  });

  it('skill / career / funds are absolute and latch', () => {
    const w = world();
    const me = w.state.household.memberIds[0];
    const sk: ObjectiveDef = { kind: 'skill', level: 2, skill: 'logic' };
    const ps = startObjective(sk, w);
    w.state.agents[me].skills.logic.level = 1;
    evaluateObjectiveState(sk, ps, w, 1);
    expect(ps.progress).toBe(1);
    w.state.agents[me].skills.logic.level = 2;
    evaluateObjectiveState(sk, ps, w, 1);
    expect(ps.done).toBe(true);
    const c: ObjectiveDef = { kind: 'career', level: 1 };
    const pc = startObjective(c, w);
    evaluateObjectiveState(c, pc, w, 1);
    expect(pc.done).toBe(false);
    w.state.agents[me].career = { trackId: 'retail', level: 1, performance: 0, daysAtLevel: 0, missedStreak: 0, lastShiftDay: -1, shiftStatus: 'none', shiftStartTick: null, moodSum: 0, moodSamples: 0, sickDaysUsed: 0 };
    evaluateObjectiveState(c, pc, w, 1);
    expect(pc.done).toBe(true);
    w.state.agents[me].career = null; // quit afterwards: still done
    evaluateObjectiveState(c, pc, w, 1);
    expect(pc.done).toBe(true);
    const f: ObjectiveDef = { kind: 'funds', atLeast: 10_000 };
    const pf = startObjective(f, w);
    w.state.household.funds = 12_000;
    evaluateObjectiveState(f, pf, w, 1);
    expect(pf.done).toBe(true);
  });

  it('friends: only NEW household↔outsider friendships count; removed agents shrink nothing already counted', () => {
    const w = world();
    const [m0, m1] = w.state.household.memberIds;
    const rel = (a: string, b: string, friendship: number) => {
      const [x, y] = a < b ? [a, b] : [b, a];
      w.state.relationships[`${x}|${y}`] = { a: x, b: y, friendship, romance: 0, met: true, partners: false, engaged: false, married: false, bestFriends: false, lastInteractionTick: 0, interactions: 1 };
    };
    rel(m0, 'a900', 50); // an existing friend before the objective starts
    const o: ObjectiveDef = { kind: 'friends', count: 1 };
    const p = startObjective(o, w);
    expect(p.baseline).toBe(1);
    rel(m0, m1, 90); // housemates do not count
    evaluateObjectiveState(o, p, w, 1);
    expect(p.progress).toBe(0);
    rel(m1, 'a901', 34); // below the Friend threshold
    evaluateObjectiveState(o, p, w, 1);
    expect(p.progress).toBe(0);
    rel(m1, 'a901', 35);
    evaluateObjectiveState(o, p, w, 1);
    expect(p.done).toBe(true);
  });

  it('own: fresh purchases only, must HOLD; a removed object resets the hold; never done inside zero elapsed time', () => {
    const w = world();
    const o: ObjectiveDef = { kind: 'own', tags: ['decor'], count: 1, fresh: true, holdMin: 15 };
    w.state.tick = 100;
    w.state.nextId = 99990;
    const p = startObjective(o, w);
    expect(p.baseline).toBe(99990);
    evaluateObjectiveState(o, p, w, 1);
    expect(p.progress).toBe(0); // the starter lot's decor was not bought after the start
    const id = 'o99999';
    w.state.objects[id] = { ...jsonClone(Object.values(w.state.objects)[0]), id, defId: 'plant_deadfern', purchasedTick: 120, placement: { kind: 'floor', x: 3, z: 3, rot: 0 } };
    for (let i = 0; i < 10; i++) evaluateObjectiveState(o, p, w, 0); // build mode: time paused
    expect(p.done).toBe(false);
    for (let i = 0; i < 14; i++) evaluateObjectiveState(o, p, w, 1);
    expect(p.done).toBe(false);
    delete w.state.objects[id]; // sold / undone / repossessed before the hold completed
    evaluateObjectiveState(o, p, w, 1);
    expect(p.heldMin).toBe(0);
    expect(p.progress).toBe(0);
    w.state.objects[id] = { ...jsonClone(Object.values(w.state.objects)[0]), id, defId: 'plant_deadfern', purchasedTick: 130, placement: { kind: 'held', agentId: 'a1' } };
    for (let i = 0; i < 20; i++) evaluateObjectiveState(o, p, w, 1);
    expect(p.done).toBe(false); // carried items are not "placed"
    w.state.objects[id].placement = { kind: 'floor', x: 3, z: 3, rot: 0 };
    for (let i = 0; i < 15; i++) evaluateObjectiveState(o, p, w, 1);
    expect(p.done).toBe(true);
    delete w.state.objects[id];
    evaluateObjectiveState(o, p, w, 1);
    expect(p.done).toBe(true); // latched
  });

  it('roomEnv reads the spatial view; without spatial it never completes', () => {
    const o: ObjectiveDef = { kind: 'roomEnv', atLeast: 6, holdMin: 2 };
    const none = world();
    const p0 = startObjective(o, none);
    for (let i = 0; i < 5; i++) evaluateObjectiveState(o, p0, none, 1);
    expect(p0.done).toBe(false);
    let env = 5;
    const w: ObjectiveWorld = { ...world(), spatial: { width: () => 10, rooms: () => [{ id: 1, indoor: true, tiles: [12] }, { id: 0, indoor: false, tiles: [0] }], roomEnvironment: () => env } };
    const p = startObjective(o, w);
    evaluateObjectiveState(o, p, w, 1);
    expect(p.progress).toBe(5);
    env = 7;
    evaluateObjectiveState(o, p, w, 1);
    expect(p.done).toBe(false);
    evaluateObjectiveState(o, p, w, 1);
    expect(p.done).toBe(true);
  });

  it('days and billsOnTime (late bills and bills paid before the start do not count; each bill once)', () => {
    const w = world();
    // the clock starts at 09:00 on day 1, so day 2 begins at tick 3600 (src/sim/time.ts)
    w.state.tick = 3590;
    const d: ObjectiveDef = { kind: 'days', count: 2 };
    const pd = startObjective(d, w);
    w.state.tick = 3600 + TICKS_PER_DAY - 1; // late on day 2: one new day so far
    evaluateObjectiveState(d, pd, w, 1);
    expect(pd.progress).toBe(1);
    w.state.tick = 3600 + TICKS_PER_DAY; // midnight of day 3
    evaluateObjectiveState(d, pd, w, 1);
    expect(pd.done).toBe(true);

    const b: ObjectiveDef = { kind: 'billsOnTime', count: 2 };
    w.state.tick = 1000;
    const pb = startObjective(b, w);
    const bill = (id: string, dueTick: number, paidTick: number | null) => ({ id, issuedTick: 0, dueTick, amount: 10, paidTick, stage: 0 });
    w.state.household.bills = [bill('b1', 5000, 900), bill('b2', 1500, 2000), bill('b3', 5000, null)];
    evaluateObjectiveState(b, pb, w, 1);
    expect(pb.progress).toBe(0);
    w.state.household.bills[2].paidTick = 3000;
    evaluateObjectiveState(b, pb, w, 1);
    evaluateObjectiveState(b, pb, w, 1);
    expect(pb.progress).toBe(1);
    w.state.household.bills = [bill('b4', 9000, 4000)]; // the paid bill was pruned from the list: still counted once
    evaluateObjectiveState(b, pb, w, 1);
    expect(pb.done).toBe(true);
  });

  it('re-baselines when the same progress is evaluated against another world (game-layer daily tasks)', () => {
    const w1 = world((s) => (s.stats.counters.mealsCooked = 3), 'W1');
    const o: ObjectiveDef = { kind: 'stat', key: 'mealsCooked', count: 3 };
    const p = startObjective(o, w1);
    w1.state.stats.counters.mealsCooked = 4;
    evaluateObjectiveState(o, p, w1, 1);
    expect(p.progress).toBe(1);
    const w2 = world((s) => (s.stats.counters.mealsCooked = 50), 'W2'); // a different save with a big counter
    evaluateObjectiveState(o, p, w2, 1);
    expect(p.progress).toBe(1); // not 3 — switching saves never completes a task
    expect(p.worldId).toBe('W2');
    w2.state.stats.counters.mealsCooked = 52;
    evaluateObjectiveState(o, p, w2, 1);
    expect(p.done).toBe(true);
  });

  it('junk: corrupted progress, junk events and degenerate targets never throw', () => {
    const w = world();
    const o: ObjectiveDef = { kind: 'interaction', ids: ['home_cook'], count: 0 };
    expect(objectiveTarget(o)).toBe(1);
    const p = startObjective(o, w);
    (p as unknown as Record<string, unknown>).progress = Number.NaN;
    (p as unknown as Record<string, unknown>).seen = 'garbage';
    for (const e of [null, undefined, 42, {}, { type: 'interactionCompleted' }, { type: 'skillUp', agentId: 5 }] as unknown as SimEvent[]) {
      expect(() => observeObjectiveEvent(o, p, e, w)).not.toThrow();
    }
    expect(() => evaluateObjectiveState({ kind: 'stat', key: 'nope', count: 1 }, p, w, Number.NaN)).not.toThrow();
    expect(observeObjectiveEvent(o, p, done(77, 'home_cook'), w)).toBe(true);
    expect(p.done).toBe(true);
  });

  it('objectiveWorldOf uses the stored world id, else a seed-derived one', () => {
    expect(objectiveWorldOf({ state: base }).worldId).toBe(base.quests!.worldId);
    const s = jsonClone(base);
    delete s.quests;
    expect(objectiveWorldOf({ state: s }).worldId).toBe(`seed:${s.seed >>> 0}`);
  });
});
