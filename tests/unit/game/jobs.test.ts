/**
 * W-124 (D-071) controller side of household jobs on the REAL simulation: GameController.job dispatches ONE ordinary
 * journaled `job` command, the HUD view comes from sim.jobs(), finished / blocked jobs toast, and the session log
 * records `job.assign` / `job.done` / `job.blocked` with the category id only (never a name, target or reason text).
 */
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/sim/contracts';
import type { SimModule } from '../../../src/game/simTypes';
import type { Core } from '../../../src/game/core';
import { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES } from '../../../src/sim/index';
import { startedHarness, type Harness } from './controllerHarness';

const real: SimModule = { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES };

async function game(): Promise<{ h: Harness; core: Core; journal: Command[] }> {
  const h = await startedHarness({ realSim: real });
  const core = (h.game as unknown as { c: Core }).c;
  const journal: Command[] = [];
  core.session!.setJournalSink({ record: (cmd: Command) => (journal.push(JSON.parse(JSON.stringify(cmd)) as Command), () => {}) } as never);
  journal.length = 0;
  return { h, core, journal };
}

const logOf = (core: Core) => (core.sessionLog as unknown as { rec: { toLog(): { events: { k: string; a?: string }[] } } }).rec.toLog();

describe('GameController.job', () => {
  it('assign / pause / resume / priority / move / cancel are single journaled job commands; the view follows', async () => {
    const { h, journal } = await game();
    const g = h.game;
    const sim = g.sim!;
    const a = sim.state.household.memberIds[0];
    const r = g.job({ action: 'assign', agentId: a, category: 'clean', scope: { kind: 'lot' }, mode: { kind: 'untilDone' } });
    expect(r.ok).toBe(true);
    const r2 = g.job({ action: 'assign', agentId: a, category: 'play', scope: { kind: 'lot' }, mode: { kind: 'once' }, priority: 'low' });
    expect(r2.ok).toBe(true);
    const v = sim.jobs!()!;
    expect(v.list.filter((j) => j.agentId === a).map((j) => j.category)).toEqual(['clean', 'play']);
    expect(v.categories.find((c) => c.id === 'yard')).toMatchObject({ available: false });
    expect(g.job({ action: 'pause', jobId: r.id! }).ok).toBe(true);
    expect(sim.jobs!()!.list.find((j) => j.id === r.id)).toMatchObject({ paused: true, status: 'paused', statusLabel: 'Paused' });
    expect(g.job({ action: 'resume', jobId: r.id! }).ok).toBe(true);
    expect(g.job({ action: 'priority', jobId: r2.id!, priority: 'high' }).ok).toBe(true);
    expect(sim.jobs!()!.list.filter((j) => j.agentId === a).map((j) => j.category)).toEqual(['play', 'clean']); // high first
    expect(g.job({ action: 'move', jobId: r.id!, dir: -1 }).ok).toBe(true); // passes the high one: takes its priority
    expect(sim.jobs!()!.list.filter((j) => j.agentId === a).map((j) => [j.category, j.priority, j.index])).toEqual([
      ['clean', 'high', 0],
      ['play', 'high', 1],
    ]);
    expect(g.job({ action: 'move', jobId: r.id!, dir: -1 }).ok).toBe(false);
    expect(g.job({ action: 'cancel', jobId: r.id! }).ok).toBe(true);
    expect(g.job({ action: 'assign', agentId: a, category: 'yard', scope: { kind: 'lot' }, mode: { kind: 'once' } })).toMatchObject({ ok: false });
    const jobCmds = journal.filter((c) => c.type === 'job');
    expect(jobCmds.map((c) => (c as { action: string }).action)).toEqual(['assign', 'assign', 'pause', 'resume', 'priority', 'move', 'move', 'cancel', 'assign']);
    expect(journal.filter((c) => c.type !== 'job')).toEqual([]);
  }, 60_000);

  it('garbage never throws and never dispatches', async () => {
    const { h, journal } = await game();
    for (const junk of [null, undefined, 3, 'assign', {}, { action: 7 }]) expect(h.game.job(junk as never).ok).toBe(false);
    expect(journal).toEqual([]);
  }, 60_000);
});

describe('jobs in the session log and toasts', () => {
  it('logs job.assign / job.done / job.blocked with category ids only, and toasts a finished job', async () => {
    const { h, core } = await game();
    const g = h.game;
    const sim = g.sim!;
    const [a, b] = sim.state.household.memberIds;
    // nothing to clean → the job ends at once ("nothing to do"); a play job with no way to reach any target is blocked
    for (const o of Object.values(sim.state.objects)) {
      o.condition.dirt = 0;
      if (typeof o.data.fill === 'number') o.data.fill = 0;
    }
    expect(g.job({ action: 'assign', agentId: a, category: 'clean', scope: { kind: 'lot' }, mode: { kind: 'untilDone' } }).ok).toBe(true);
    sim.state.agents[b!].needs.fun = 20;
    const fun = sim.jobs!()!.scopes.play.find((s) => s.scope.kind === 'object');
    if (fun) {
      // the only allowed target can't be used (broken): blocked with the engine's reason
      sim.state.objects[(fun.scope as { id: string }).id].condition.broken = true;
      expect(g.job({ action: 'assign', agentId: b!, category: 'play', scope: fun.scope, mode: { kind: 'untilDone' } }).ok).toBe(true);
    } else {
      // nothing on this lot to play with: blocked ("Needs …")
      expect(g.job({ action: 'assign', agentId: b!, category: 'play', scope: { kind: 'lot' }, mode: { kind: 'untilDone' } }).ok).toBe(true);
    }
    const before = g.toasts.length;
    g.setSpeed(3);
    await h.until(() => (sim.state.jobs?.list.length ?? 0) <= 1 && logOf(core).events.some((e) => e.k === 'job.blocked'), 1500);
    const ev = logOf(core).events.filter((e) => e.k.startsWith('job.'));
    expect(ev.filter((e) => e.k === 'job.assign').map((e) => e.a)).toEqual(['clean', 'play']);
    expect(ev.filter((e) => e.k === 'job.done').map((e) => e.a)).toEqual(['clean']);
    expect(ev.filter((e) => e.k === 'job.blocked').map((e) => e.a)).toContain('play');
    const names = sim.state.household.memberIds.map((id) => sim.state.agents[id].firstName);
    for (const n of names) expect(JSON.stringify(ev)).not.toContain(n);
    for (const e of ev) expect(['clean', 'play']).toContain(e.a);
    const t = g.toasts.slice(before).map((x) => x.title);
    expect(t.some((x) => x.startsWith('Nothing to do for'))).toBe(true);
  }, 120_000);
});
