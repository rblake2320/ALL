/**
 * W-123 (D-070) on the REAL modules: from a fresh derelict world, pressing "Go" on each Act 1 step — and on a daily
 * task — actually advances it once the sim runs.
 *
 * The scripted player only does what the click does: `queue` results are dispatched as the ordinary player queue
 * command (exactly what GameController.questGo dispatches); `mode` / `missing` results open Build / Buy, where the
 * player places things by hand — the script then places the item the Buy filter offers (or a wall) like a player
 * would. Nothing else is queued for the household: every action step is advanced by Go alone.
 */
import { describe, expect, it } from 'vitest';
import type { Command, ObjectiveDef } from '../../../src/sim/contracts';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { ACT1_QUEST_IDS, ACT1_QUESTS, DAILY_TASK_POOL } from '../../../src/sim/content/quests';
import { resolveQuestAction, type QuestAction } from '../../../src/shared/questAction';
import { objectiveWorldOf, observeObjectiveEvent, startObjective } from '../../../src/sim/systems/quests/objectives';
import type { EngineSimulation } from '../../../src/sim/engine';
import { newWorld, opts, simOf, systemsWithQuests } from './helpers';
import { BACK_ROOM, buyAt, buyIn, LAYOUT, MAIN_ROOM } from './act1Driver';

function derelict(seed = 41): EngineSimulation {
  const systems = systemsWithQuests();
  return simOf(newWorld({ ...opts(seed, 2), lotTemplate: 'derelict' }, systems), systems);
}

const DEF = new Map(ACT1_QUESTS.map((q) => [q.id, q]));

/** `<quest>#<step>` of the running Act 1 step and its objective. */
function current(sim: EngineSimulation): { key: string; objective: ObjectiveDef } | null {
  const a = sim.state.quests?.active.find((x) => ACT1_QUEST_IDS.includes(x.questId));
  if (!a) return null;
  const s = DEF.get(a.questId)!.steps[a.stepIndex];
  return { key: `${a.questId}#${s.id}`, objective: s.objective };
}

const LAYOUT_AT: Record<string, readonly [number, number, 0 | 1 | 2 | 3]> = {
  fridge_humming: LAYOUT.fridge,
  stove_greasefire: LAYOUT.stove,
  microwave_nuke: LAYOUT.microwave,
  shower_drizzle: LAYOUT.shower,
};

/** What the player does in Buy / Build mode after Go opened it (places the filter's first item, or 4 walls). */
function placeByHand(sim: EngineSimulation, a: QuestAction, key: string, mem: Record<string, unknown>): void {
  if (a.kind === 'mode' && a.mode === 'build') {
    if (mem.walls) return;
    mem.walls = sim.build.apply({ type: 'addWalls', edges: ['h:20:22', 'h:21:22', 'h:22:22', 'h:23:22'] }).ok;
    sim.dispatch({ type: 'endBuildSession' });
    return;
  }
  const filter = a.kind === 'missing' ? a.buyFilter : a.kind === 'mode' && a.mode === 'buy' ? a.buyFilter : null;
  if (!filter) return;
  if (key === 'act1_patch#furnish') {
    if (mem.furnished) return;
    // three different pieces from the filter (seat / surface / light …)
    mem.furnished = filter.defIds.slice(0, 3).map((d) => buyIn(sim, d, MAIN_ROOM));
    return;
  }
  if (key === 'act1_curb#room') {
    // dress up the small back room, one purchase per game hour while it scores < 4
    const i = typeof mem.decorIdx === 'number' ? mem.decorIdx : 0;
    if (sim.spatial.roomEnvironment(17.5, 17.5) < 4 && i < LAYOUT.decor.length && sim.state.tick % TICKS_PER_HOUR === 0) {
      mem.decorIdx = i + 1;
      const [d, x, z, r] = LAYOUT.decor[i];
      buyAt(sim, d, x, z, r, BACK_ROOM);
    }
    return;
  }
  if (mem[`bought:${key}`]) return;
  const defId = filter.defIds[0];
  const at = LAYOUT_AT[defId];
  mem[`bought:${key}`] = at ? buyAt(sim, defId, at[0], at[1], at[2], MAIN_ROOM) : key === 'act1_curb#decor' ? buyAt(sim, defId, 15, 17, 0) : buyIn(sim, defId, MAIN_ROOM);
}

function playerBusy(sim: EngineSimulation): boolean {
  return sim.state.household.memberIds.some((id) => {
    const a = sim.state.agents[id];
    return !!a && ((a.active && a.active.source === 'player') || a.queue.some((x) => x.source === 'player'));
  });
}

describe('Go on every Act 1 step advances it (real sim, fresh derelict world)', () => {
  it.each(['full', 'off'] as const)('free will %s — claim → lease: every step completes, action steps through the queued Go action', (autonomy) => {
    const sim = derelict();
    expect(sim.dispatch({ type: 'setSettings', settings: { autonomy } }).ok).toBe(true);
    const mem: Record<string, unknown> = {};
    const kinds = new Map<string, string>();
    const queued = new Map<string, number>();
    const end = sim.state.tick + TICKS_PER_DAY * 10;
    while (sim.state.tick < end && !ACT1_QUEST_IDS.every((id) => (sim.state.quests?.completions[id] ?? 0) > 0)) {
      const cur = current(sim);
      if (cur && sim.state.tick % 4 === 0) {
        // "click Go" whenever nobody is busy with a player order (a player clicks again after a run ends)
        const a = resolveQuestAction({ objective: cur.objective }, sim, null);
        if (!kinds.has(cur.key) || kinds.get(cur.key) === 'blocked') kinds.set(cur.key, a.kind === 'mode' ? `mode:${a.mode}` : a.kind);
        if (a.kind === 'queue' && !a.already && !playerBusy(sim)) {
          const cmd: Command = { type: 'queue', actorId: a.agentId, interactionId: a.interactionId, target: a.target, params: { ...a.extra } };
          expect(sim.dispatch(cmd).ok, `${cur.key}: ${a.interactionId}`).toBe(true);
          queued.set(cur.key, (queued.get(cur.key) ?? 0) + 1);
        } else if (a.kind === 'mode' || a.kind === 'missing') {
          placeByHand(sim, a, cur.key, mem);
        }
      }
      // free will off: nobody feeds or preserves themselves — the test keeps them alive with the needs cheat (a
      // player command) so the arc can run its 10 game days; Go itself never depends on autonomy
      if (autonomy === 'off' && sim.state.tick % (TICKS_PER_HOUR * 6) === 0) sim.dispatch({ type: 'cheat', code: 'freshstart' });
      sim.step();
      sim.drainEvents();
    }
    const done = ACT1_QUEST_IDS.filter((id) => (sim.state.quests?.completions[id] ?? 0) > 0);
    expect(done).toEqual([...ACT1_QUEST_IDS]);
    const EXPECTED: Record<string, string> = {
      'act1_claim#mail': 'queue',
      'act1_rest#sleep': 'queue',
      'act1_hunger#fridge': 'mode:buy',
      'act1_hunger#cooker': 'mode:buy',
      'act1_hunger#eat': 'queue',
      'act1_scrub#shower': 'mode:buy',
      'act1_scrub#wash': 'queue',
      'act1_scrub#preserve': 'queue',
      'act1_patch#walls': 'mode:build',
      'act1_patch#furnish': 'mode:buy',
      'act1_curb#decor': 'mode:buy',
      'act1_curb#room': 'mode:buy',
      'act1_neighbour#friendly': 'queue',
      'act1_lease#bill': 'queue',
    };
    // a step can be credited before Go is ever pressed (W-116 "Already done — nice": e.g. the housemates chatted on
    // their own) — every step Go was pressed on resolved to the expected kind, and that covers nearly all of them
    for (const [k, v] of kinds) expect(v, k).toBe(EXPECTED[k]);
    expect(kinds.size).toBeGreaterThanOrEqual(12);
    // free will off: nobody does anything on their own, so every action step was advanced by the Go action itself;
    // free will on: a housemate may get there first (the step then completes from their run), most still go via Go
    const viaGo = [...kinds].filter(([k, v]) => v === 'queue' && (queued.get(k) ?? 0) > 0).length;
    const queueSteps = [...kinds].filter(([, v]) => v === 'queue').length;
    if (autonomy === 'off') expect(viaGo).toBe(queueSteps);
    else expect(viaGo).toBeGreaterThanOrEqual(queueSteps - 2);
    expect(sim.checkInvariants()).toEqual([]);
  }, 240_000);
});

describe('Go on a daily task advances it (real sim)', () => {
  function runTask(id: string, sim: EngineSimulation, maxTicks: number, onMissing?: (a: Extract<QuestAction, { kind: 'missing' }>) => void) {
    const task = DAILY_TASK_POOL.find((d) => d.id === id)!;
    const w = () => objectiveWorldOf(sim);
    const p = startObjective(task.objective, w());
    const seen: string[] = [];
    const end = sim.state.tick + maxTicks;
    while (sim.state.tick < end && !p.done) {
      if (sim.state.tick % 4 === 0) {
        const a = resolveQuestAction({ objective: task.objective, done: p.done }, sim, null);
        if (!seen.includes(a.kind)) seen.push(a.kind);
        if (a.kind === 'queue' && !a.already && !playerBusy(sim)) expect(sim.dispatch({ type: 'queue', actorId: a.agentId, interactionId: a.interactionId, target: a.target, params: { ...a.extra } }).ok).toBe(true);
        if (a.kind === 'missing' && onMissing) onMissing(a);
      }
      sim.step();
      for (const e of sim.drainEvents()) observeObjectiveEvent(task.objective, p, e, w());
    }
    return { p, seen };
  }

  it('"Read twice": Needs a bookshelf → (Shop) → Go reads at it twice → done', () => {
    const sim = derelict(43);
    let bought: string | null = null;
    const { p, seen } = runTask('d_read2', sim, TICKS_PER_DAY, (a) => {
      expect(a.buyFilter.defIds).toEqual(['shelf_moldering']);
      if (!bought) bought = buyIn(sim, a.buyFilter.defIds[0], MAIN_ROOM);
    });
    expect(bought).not.toBeNull();
    expect(seen.slice(0, 2)).toEqual(['missing', 'queue']);
    expect(p.done).toBe(true);
    expect(p.progress).toBe(2);
    // Go never says "Already done" before it is, and does after
    expect(resolveQuestAction({ objective: DAILY_TASK_POOL.find((d) => d.id === 'd_read2')!.objective, done: p.done }, sim, null)).toMatchObject({ kind: 'blocked', code: 'done' });
  }, 120_000);

  it('"Check the mail": straight to the mailbox', () => {
    const sim = derelict(44);
    const { p, seen } = runTask('d_mail', sim, TICKS_PER_HOUR * 6);
    expect(seen[0]).toBe('queue');
    expect(p.done).toBe(true);
  }, 60_000);
});
