/**
 * Quests SimSystem on the real modules: lifecycle, grant ids, replay / save-load determinism, duplicate events,
 * build undo/redo, deleted objects, removed agents, commands, healing of corrupted state.
 */
import { describe, expect, it } from 'vitest';
import type { QuestDef, SimEvent } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { healQuestsState, QUESTS_SYSTEM_ID } from '../../../src/sim/systems/quests';
import { ALL_QUESTS } from '../../../src/sim/content/quests';
import type { EngineSimulation } from '../../../src/sim/engine';
import { jsonClone, newWorld, opts, run, simOf, spotFor, systemsWithQuests, type RunLog } from './helpers';

const DEFS = new Map(ALL_QUESTS.map((d) => [d.id, d]));

function questEvents(sim: EngineSimulation): SimEvent[] {
  return sim.drainEvents().filter((e) => e.type.startsWith('quest'));
}

function fresh(seed = 31, defs?: QuestDef[]) {
  const systems = systemsWithQuests(defs);
  const sim = simOf(newWorld(opts(seed), systems), systems);
  return { sim, systems };
}

const steps = (sim: EngineSimulation, n: number) => {
  for (let i = 0; i < n; i++) sim.step();
};

describe('quests system — lifecycle', () => {
  it('a new world starts the first story quest; reloading a healthy world is a strict no-op', () => {
    const { sim, systems } = fresh();
    const q = sim.state.quests!;
    expect(q.active.map((a) => a.questId)).toEqual(['story_firstMeal']);
    expect(q.worldId).toMatch(/^w[0-9a-z]+-[0-9a-z]+$/);
    const v = sim.quests!()!;
    expect(v.active[0]).toMatchObject({ questId: 'story_firstMeal', instance: 1, grantId: `${q.worldId}:story_firstMeal:1`, category: 'story', abandonable: "Story quests can't be abandoned" });
    expect(v.active[0].steps.map((s) => s.target)).toEqual([1, 1]);
    // a classic world (no story arc): the Act 1 arc quests are not part of its chain (W-113)
    expect(v.story).toEqual({ done: 0, total: ALL_QUESTS.filter((d) => d.category === 'story' && !d.arc).length });
    const saved = JSON.stringify(sim.serialize());
    const loaded = simOf(JSON.parse(saved) as WorldState, systems);
    expect(JSON.stringify(loaded.serialize())).toBe(saved);
    expect(questEvents(loaded)).toEqual([]);
    expect(healQuestsState(loaded.state, DEFS)).toEqual([]);
  });

  it('completes the first meal quest with a stable grant id, records the grant and unlocks the next story quests', () => {
    const { sim } = fresh();
    const log: RunLog = { quest: [] };
    run(sim, TICKS_PER_DAY, log);
    const done = log.quest.filter((e): e is Extract<SimEvent, { type: 'questCompleted' }> => e.type === 'questCompleted');
    const first = done.find((e) => e.questId === 'story_firstMeal');
    expect(first).toBeDefined();
    const wid = sim.state.quests!.worldId;
    expect(first!.grantId).toBe(`${wid}:story_firstMeal:1`);
    expect(first!.grant).toEqual({ grantId: first!.grantId, bones: 30, reason: 'Quest: Brains for Dinner' });
    expect(sim.state.quests!.completions.story_firstMeal).toBe(1);
    for (const next of ['story_freshen', 'story_getJob']) {
      expect(sim.state.quests!.active.some((a) => a.questId === next) || (sim.state.quests!.completions[next] ?? 0) > 0, next).toBe(true);
    }
    // grants() (ledger reconciliation) mirrors every questCompleted event, in order
    expect(sim.engine.ctx.sys(QUESTS_SYSTEM_ID).grants()).toEqual(done.map((e) => e.grant));
    // every grant id unique
    expect(new Set(done.map((e) => e.grantId)).size).toBe(done.length);
    expect(sim.faults()).toEqual([]);
  }, 120_000);

  it('replay: the same seed + script yields the identical quest event stream and quest state', () => {
    const a = fresh(77).sim;
    const b = fresh(77).sim;
    const la: RunLog = { quest: [] };
    const lb: RunLog = { quest: [] };
    run(a, TICKS_PER_DAY * 2, la);
    run(b, TICKS_PER_DAY * 2, lb);
    expect(JSON.stringify(la.quest)).toBe(JSON.stringify(lb.quest));
    expect(JSON.stringify(a.state.quests)).toBe(JSON.stringify(b.state.quests));
    expect(la.quest.filter((e) => e.type === 'questCompleted').length).toBeGreaterThan(0);
  }, 200_000);

  it('save/load every game hour (incl. mid-step, mid-hold) is identical to never saving — quests included', () => {
    const { sim: live, systems } = fresh(404);
    let other = simOf(jsonClone(live.serialize()), systems);
    const ll: RunLog = { quest: [] };
    const lo: RunLog = { quest: [] };
    for (let t = 97; t <= TICKS_PER_DAY * 2; t += TICKS_PER_HOUR) {
      run(live, t, ll);
      run(other, t, lo);
      other = simOf(jsonClone(other.serialize()), systems);
      expect(other.repairWarnings).toEqual([]);
    }
    expect(JSON.stringify(other.serialize())).toBe(JSON.stringify(live.serialize()));
    expect(JSON.stringify(lo.quest)).toBe(JSON.stringify(ll.quest));
  }, 300_000);
});

// A test quest set over the real content.
const T_DEFS: QuestDef[] = [
  {
    id: 't_cook2',
    category: 'story',
    order: 1,
    title: 'Cook twice',
    description: 'test',
    icon: 'plate',
    steps: [{ id: 'c', label: 'cook', objective: { kind: 'interaction', ids: ['home_cook'], count: 2 } }],
    reward: { bones: 5 },
  },
  {
    id: 't_decor',
    category: 'story',
    order: 2,
    title: 'Decor',
    description: 'test',
    icon: 'house',
    steps: [{ id: 'd', label: 'decor', objective: { kind: 'own', defIds: ['plant_deadfern'], count: 2, fresh: true, holdMin: 15 } }],
    reward: { bones: 7, entitlements: ['cosmetic:test'] },
  },
  {
    id: 't_repeat',
    category: 'neighbourhood',
    title: 'Repeat',
    description: 'test',
    icon: 'star',
    steps: [{ id: 'r', label: 'chat', objective: { kind: 'interaction', ids: ['social_chat'], count: 50 } }],
    reward: { bones: 3 },
    repeat: { cooldownDays: 2 },
  },
];

const completed = (sim: EngineSimulation, id: string) => sim.state.quests!.completions[id] ?? 0;
const activeOf = (sim: EngineSimulation, id: string) => sim.state.quests!.active.find((a) => a.questId === id);

function fakeCook(sim: EngineSimulation, uid: number, household = true): Extract<SimEvent, { type: 'interactionCompleted' }> {
  return { type: 'interactionCompleted', uid, agentId: sim.state.household.memberIds[0], interactionId: 'home_cook', targetId: null, source: 'player', household, params: {} };
}

describe('quests system — adversarial', () => {
  it('duplicate / replayed events are counted once; quest events never feed back', () => {
    const { sim } = fresh(5, T_DEFS);
    const ctx = sim.engine.ctx;
    ctx.emit(fakeCook(sim, 900001));
    ctx.emit(fakeCook(sim, 900001));
    ctx.emit(fakeCook(sim, 900002, false));
    expect(activeOf(sim, 't_cook2')!.step.progress).toBe(1);
    // a forged questCompleted is ignored by the system itself (it is an output, not an input)
    ctx.emit({ type: 'questCompleted', questId: 't_cook2', instance: 1, grantId: 'x', title: 'x', grant: { grantId: 'x', bones: 9999, reason: 'x' } });
    expect(completed(sim, 't_cook2')).toBe(0);
    ctx.emit(fakeCook(sim, 900003));
    expect(completed(sim, 't_cook2')).toBe(1);
    ctx.emit(fakeCook(sim, 900004));
    expect(completed(sim, 't_cook2')).toBe(1);
    expect(sim.state.quests!.grants.map((g) => g.grantId)).toEqual([`${sim.state.quests!.worldId}:t_cook2:1`]);
    expect(sim.faults()).toEqual([]);
  });

  it('build undo inside a paused build session never satisfies an `own` step; redo + hold does, exactly once', () => {
    const { sim } = fresh(6, T_DEFS);
    sim.engine.ctx.emit(fakeCook(sim, 1));
    sim.engine.ctx.emit(fakeCook(sim, 2));
    expect(activeOf(sim, 't_decor')).toBeDefined();
    const s1 = spotFor(sim, 'plant_deadfern')!;
    const r1 = sim.dispatch({ type: 'build', cmd: { type: 'buy', defId: 'plant_deadfern', x: s1.x, z: s1.z, rot: 0 } });
    expect(r1.ok).toBe(true);
    const s2 = spotFor(sim, 'plant_deadfern')!;
    expect(sim.dispatch({ type: 'build', cmd: { type: 'buy', defId: 'plant_deadfern', x: s2.x, z: s2.z, rot: 0 } }).ok).toBe(true);
    // build mode pauses time: no step happens before the undo
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    steps(sim, TICKS_PER_HOUR);
    expect(activeOf(sim, 't_decor')!.step.done).toBe(false);
    expect(activeOf(sim, 't_decor')!.step.progress).toBe(1);
    // a held state interrupted by undo resets: redo, a few minutes, undo again
    expect(sim.dispatch({ type: 'redo' }).ok).toBe(true);
    steps(sim, 40); // 10 game minutes < 15
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    steps(sim, 8);
    expect(activeOf(sim, 't_decor')!.step.heldMin).toBe(0);
    expect(sim.dispatch({ type: 'redo' }).ok).toBe(true);
    sim.dispatch({ type: 'endBuildSession' });
    steps(sim, 15 * 4 + 4);
    expect(completed(sim, 't_decor')).toBe(1);
    const grants = sim.state.quests!.grants.filter((g) => g.questId === 't_decor');
    expect(grants).toHaveLength(1);
    expect(grants[0].entitlements).toEqual(['cosmetic:test']);
    // selling and re-buying afterwards never re-completes a finished story quest
    const plant = Object.values(sim.state.objects).filter((o) => o.defId === 'plant_deadfern').pop()!;
    expect(sim.dispatch({ type: 'build', cmd: { type: 'sell', objectId: plant.id } }).ok).toBe(true);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    steps(sim, TICKS_PER_HOUR);
    expect(sim.state.quests!.grants.filter((g) => g.questId === 't_decor')).toHaveLength(1);
    expect(sim.faults()).toEqual([]);
  });

  it('an object deleted mid-hold resets the hold; quest survives', () => {
    const { sim } = fresh(7, T_DEFS);
    sim.engine.ctx.emit(fakeCook(sim, 1));
    sim.engine.ctx.emit(fakeCook(sim, 2));
    const bought: string[] = [];
    for (let i = 0; i < 2; i++) {
      const s = spotFor(sim, 'plant_deadfern')!;
      const r = sim.dispatch({ type: 'build', cmd: { type: 'buy', defId: 'plant_deadfern', x: s.x, z: s.z, rot: 0 } });
      expect(r.ok).toBe(true);
      bought.push(r.id!);
    }
    sim.dispatch({ type: 'endBuildSession' });
    steps(sim, 40);
    expect(activeOf(sim, 't_decor')!.step.heldMin).toBeGreaterThan(5);
    sim.engine.ctx.removeObject(bought[0], 'The fern withered away');
    steps(sim, 8);
    expect(activeOf(sim, 't_decor')!.step.heldMin).toBe(0);
    steps(sim, TICKS_PER_HOUR);
    expect(completed(sim, 't_decor')).toBe(0);
    expect(sim.faults()).toEqual([]);
  });

  it('a removed agent (deleted record, dropped from the household) mid-quest is harmless', () => {
    const { sim, systems } = fresh(8, T_DEFS);
    const victim = sim.state.household.memberIds[1];
    sim.engine.ctx.emit({ ...fakeCook(sim, 11), agentId: victim });
    sim.engine.ctx.despawnAgent(victim, 'gone');
    delete sim.state.agents[victim];
    sim.state.household.memberIds = sim.state.household.memberIds.filter((id) => id !== victim);
    steps(sim, TICKS_PER_HOUR);
    sim.engine.ctx.emit({ type: 'skillUp', agentId: victim, skill: 'cooking', level: 3 });
    sim.engine.ctx.emit(fakeCook(sim, 12));
    expect(completed(sim, 't_cook2')).toBe(1);
    const reloaded = simOf(jsonClone(sim.serialize()), systems);
    expect(healQuestsState(reloaded.state, new Map(T_DEFS.map((d) => [d.id, d])))).toEqual([]);
    expect(sim.faults()).toEqual([]);
  });

  it('commands: pin/unpin/abandon with validation; abandoning starts a cooldown', () => {
    const { sim } = fresh(9, T_DEFS);
    steps(sim, TICKS_PER_DAY); // dayStart offers the neighbourhood quest
    expect(activeOf(sim, 't_repeat')).toBeDefined();
    expect(sim.dispatch({ type: 'quest', action: 'abandon', questId: 't_cook2' })).toEqual({ ok: false, reason: "Story quests can't be abandoned" });
    expect(sim.dispatch({ type: 'quest', action: 'pin', questId: 'nope' }).ok).toBe(false);
    expect(sim.dispatch({ type: 'quest', action: 'pin', questId: 't_repeat' }).ok).toBe(true);
    expect(sim.quests!()!.active[0]).toMatchObject({ questId: 't_repeat', pinned: true });
    expect(sim.dispatch({ type: 'quest', action: 'explode' as never, questId: 't_repeat' }).ok).toBe(false);
    expect(sim.dispatch({ type: 'quest', action: 'abandon', questId: 't_repeat' }).ok).toBe(true);
    expect(activeOf(sim, 't_repeat')).toBeUndefined();
    expect(sim.state.quests!.pinned).toBeNull();
    steps(sim, TICKS_PER_DAY); // 1 day later: still cooling down
    expect(activeOf(sim, 't_repeat')).toBeUndefined();
    steps(sim, TICKS_PER_DAY);
    expect(activeOf(sim, 't_repeat')).toBeDefined();
    expect(activeOf(sim, 't_repeat')!.instance).toBe(1); // abandoned instances were never granted: number reused
    expect(sim.dispatch({ type: 'quest', action: 'unpin', questId: 'whatever' }).ok).toBe(true);
  });

  it('heals corrupted quest state on load (no faults, no double grants, no re-numbered paid instance)', () => {
    const { sim, systems } = fresh(10, T_DEFS);
    sim.engine.ctx.emit(fakeCook(sim, 1));
    sim.engine.ctx.emit(fakeCook(sim, 2));
    const saved = jsonClone(sim.serialize());
    const wid = saved.quests!.worldId;
    const bad = jsonClone(saved) as unknown as { quests: Record<string, unknown> };
    bad.quests.completions = { t_cook2: 'lots' }; // corrupted counter → must be raised from the grant log
    bad.quests.grants = [...(bad.quests.grants as unknown[]), (bad.quests.grants as unknown[])[0], 'junk', { grantId: 5 }];
    bad.quests.active = [
      { questId: 'ghost_quest', instance: 1, startedTick: 0, stepIndex: 0, step: {} },
      { questId: 't_cook2', instance: 1, startedTick: 0, stepIndex: 0, step: null }, // completed story quest re-activated
      { questId: 't_decor', instance: 'x', startedTick: 'y', stepIndex: 99, step: { progress: -5, seen: 'no' } },
      { questId: 't_decor', instance: 1, startedTick: 0, stepIndex: 0, step: {} },
    ];
    bad.quests.pinned = 'ghost_quest';
    const healed = simOf(bad as unknown as WorldState, systems);
    const q = healed.state.quests!;
    expect(q.completions.t_cook2).toBe(1);
    expect(q.grants.map((g) => g.grantId)).toEqual([`${wid}:t_cook2:1`]);
    expect(q.active.map((a) => a.questId)).toEqual(['t_decor']);
    expect(q.active[0]).toMatchObject({ instance: 1, stepIndex: 0 });
    expect(q.active[0].step.progress).toBe(0);
    expect(q.pinned).toBeNull();
    healed.engine.ctx.emit(fakeCook(healed, 3));
    steps(healed, TICKS_PER_HOUR);
    expect(healed.state.quests!.grants.filter((g) => g.questId === 't_cook2')).toHaveLength(1);
    expect(healed.faults()).toEqual([]);
    // a non-object quests block is replaced
    const junk = jsonClone(saved) as unknown as { quests: unknown };
    junk.quests = 'nope';
    expect(simOf(junk as unknown as WorldState, systems).state.quests!.version).toBe(1);
  });

  it('a story quest whose objective is already met on start completes immediately (no stuck chain)', () => {
    const defs: QuestDef[] = [
      { id: 'a', category: 'story', order: 1, title: 'A', description: 'd', icon: 'star', steps: [{ id: 's', label: 'l', objective: { kind: 'funds', atLeast: 1 } }], reward: { bones: 1 } },
      { id: 'b', category: 'story', order: 2, title: 'B', description: 'd', icon: 'star', requires: ['a'], steps: [{ id: 's', label: 'l', objective: { kind: 'funds', atLeast: 1 } }, { id: 't', label: 'l', objective: { kind: 'days', count: 1 } }], reward: { bones: 1 } },
    ];
    const { sim } = fresh(12, defs);
    expect(completed(sim, 'a')).toBe(1);
    expect(activeOf(sim, 'b')!.stepIndex).toBe(1);
    steps(sim, TICKS_PER_DAY);
    expect(completed(sim, 'b')).toBe(1);
  });
});
