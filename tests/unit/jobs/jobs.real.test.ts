/**
 * W-124 (D-071) household jobs on the REAL simulation (starter lot, real content, real engine, real systems).
 * Adversarial: two zombies on one category, urgent needs mid-run, nothing to do, unreachable / removed targets,
 * cancel / pause mid-interaction, a daily window across days, save → reload mid-assignment (byte-identical
 * continuation), determinism with free will on and off, jobs never spending money, completion only when the measured
 * state really changed.
 */
import { describe, expect, it } from 'vitest';
import type { Command, SimEvent } from '../../../src/sim/contracts';
import type { AgentState, JobAssignment, WorldState } from '../../../src/sim/types';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { tickAt, timeInfo } from '../../../src/sim/time';
import { allSystems, createSimulation } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine';
import { validateWorld } from '../../../src/persistence/validation';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { newWorld, opts, simOf } from '../quests/helpers';

const DAY = TICKS_PER_DAY;

function world(seed = 11, autonomy: 'full' | 'limited' | 'off' = 'full'): EngineSimulation {
  const sys = allSystems();
  const sim = simOf(newWorld(opts(seed, 2), sys), sys);
  if (autonomy !== 'full') expect(sim.dispatch({ type: 'setSettings', settings: { autonomy } }).ok).toBe(true);
  return sim;
}

const members = (sim: EngineSimulation): [string, string] => sim.state.household.memberIds.slice(0, 2) as [string, string];
const agent = (sim: EngineSimulation, id: string): AgentState => sim.state.agents[id];
const jobs = (sim: EngineSimulation): JobAssignment[] => sim.state.jobs?.list ?? [];
const jobOf = (sim: EngineSimulation, id: string): JobAssignment | undefined => jobs(sim).find((j) => j.id === id);

/** Objects a Wipe Down / Clean (stove) can work on. */
function wipeables(sim: EngineSimulation): string[] {
  return Object.keys(sim.state.objects)
    .filter((id) => {
      const o = sim.state.objects[id];
      const d = sim.content.objects[o.defId];
      return o.placement.kind === 'floor' && !!d && (d.interactions.includes('home_wipeDown') || d.interactions.includes('home_cleanStove'));
    })
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

/** Make the place filthy: every table / counter / stove at dirt 0.6. Returns the dirty ids. */
function messUp(sim: EngineSimulation): string[] {
  const ids = wipeables(sim);
  for (const id of ids) sim.state.objects[id].condition.dirt = 0.6;
  return ids;
}

/** Make it spotless: no dirt, no trash, no dishes / ash / meals lying about. */
function spotless(sim: EngineSimulation): void {
  for (const o of Object.values(sim.state.objects)) {
    o.condition.dirt = 0;
    if (typeof o.data.fill === 'number') o.data.fill = 0;
  }
  for (const id of Object.keys(sim.state.objects)) {
    const o = sim.state.objects[id];
    if (o.placement.kind === 'loose' && /^item_(dish|ash|meal|pizza)/.test(o.defId)) sim.engine.ctx.removeObject(id);
  }
}

function assign(sim: EngineSimulation, agentId: string, category: string, mode: unknown = { kind: 'untilDone' }, scope: unknown = { kind: 'lot' }): string {
  const r = sim.dispatch({ type: 'job', action: 'assign', agentId, category, scope, mode } as Command);
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  return r.id!;
}

/** Job-marked items (active or queued) of an agent. */
function jobItems(a: AgentState) {
  return [a.active, ...a.queue].filter((q): q is NonNullable<typeof q> => !!q && typeof q.params?.jobId === 'string');
}

function step(sim: EngineSimulation, n: number, each?: (events: SimEvent[]) => void): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    const ev = sim.drainEvents();
    all.push(...ev);
    each?.(ev);
  }
  return all;
}

function stepUntil(sim: EngineSimulation, pred: () => boolean, max: number): boolean {
  for (let i = 0; i < max; i++) {
    if (pred()) return true;
    sim.step();
    sim.drainEvents();
  }
  return pred();
}

const runPhase = (sim: EngineSimulation, id: string) => {
  const r = agent(sim, id).active;
  return !!r && typeof r.params.jobId === 'string' && r.phase === 'run';
};

const canon = (sim: EngineSimulation) => canonicalJson(sim.serialize() as unknown as Record<string, unknown>);

describe('two zombies, one category', () => {
  it('two Cleaning jobs never take the same target, and together clean everything for real', () => {
    const sim = world(11);
    const [a, b] = members(sim);
    const dirty = messUp(sim);
    expect(dirty.length).toBeGreaterThanOrEqual(4);
    assign(sim, a, 'clean');
    assign(sim, b, 'clean');
    let clashes = 0;
    const touched = { [a]: new Set<string>(), [b]: new Set<string>() };
    const cleaned = new Set<string>();
    const events = step(sim, DAY / 2, () => {
      for (const d of dirty) if (sim.state.objects[d] && sim.state.objects[d].condition.dirt === 0) cleaned.add(d);
      const ta = jobItems(agent(sim, a)).map((q) => (q.target as { id?: string }).id);
      const tb = jobItems(agent(sim, b)).map((q) => (q.target as { id?: string }).id);
      for (const t of ta) if (t) touched[a].add(t);
      for (const t of tb) if (t) touched[b].add(t);
      if (ta.some((t) => t && tb.includes(t))) clashes++;
    });
    expect(clashes).toBe(0);
    // both really worked, on different things
    expect(touched[a].size).toBeGreaterThan(0);
    expect(touched[b].size).toBeGreaterThan(0);
    // every dirty surface got wiped (real state change; meals may dirty them again later), both jobs ended
    expect([...cleaned].sort()).toEqual([...dirty].sort());
    expect(jobs(sim)).toEqual([]);
    const done = events.filter((e) => e.type === 'job' && e.what === 'done');
    expect(done.map((e) => (e as { agentId: string }).agentId).sort()).toEqual([a, b].sort());
  });
});

describe('urgent needs', () => {
  it('an urgent need interrupts the job; free will looks after it; the job resumes afterwards', () => {
    const sim = world(12);
    const [a] = members(sim);
    agent(sim, a).needs.fun = 20;
    const id = assign(sim, a, 'play');
    expect(stepUntil(sim, () => runPhase(sim, a), 600)).toBe(true);
    const doneBefore = jobOf(sim, id)!.done;
    agent(sim, a).needs.hunger = 30; // below the engine's urgency threshold (40)
    step(sim, 3);
    const j = jobOf(sim, id)!;
    expect(j.status).toBe('break');
    expect(j.reason).toContain('hungry');
    const r = agent(sim, a).active;
    expect(!r || typeof r.params.jobId !== 'string' || r.canceled).toBe(true);
    // free will feeds the zombie, then the job comes back
    let ate = false;
    let resumed = false;
    for (let i = 0; i < DAY && !(ate && resumed); i++) {
      sim.step();
      sim.drainEvents();
      if (agent(sim, a).needs.hunger >= 60) ate = true;
      if (ate && jobItems(agent(sim, a)).length > 0) resumed = true;
    }
    expect(ate).toBe(true);
    expect(resumed).toBe(true);
    // and it keeps making real progress
    step(sim, DAY / 4);
    const after = jobOf(sim, id);
    expect(after === undefined || after.done > doneBefore).toBe(true);
  });

  it('with free will OFF the player is in charge: no break for a merely urgent need', () => {
    const sim = world(13, 'off');
    const [a] = members(sim);
    agent(sim, a).needs.fun = 20;
    const id = assign(sim, a, 'play');
    expect(stepUntil(sim, () => runPhase(sim, a), 600)).toBe(true);
    agent(sim, a).needs.hunger = 30;
    step(sim, 3);
    expect(jobOf(sim, id)!.status).toBe('working');
    expect(runPhase(sim, a)).toBe(true);
  });

  it('a resting Play job listed first does not hide a bored zombie from the Cleaning job below it: no restart loop, free will gets a turn', () => {
    const sim = world(31);
    const [a] = members(sim);
    messUp(sim);
    const h = timeInfo(sim.state.tick).hour;
    assign(sim, a, 'play', { kind: 'recurring', from: (h + 6) % 24, to: (h + 9) % 24 }); // window closed for the whole test
    const clean = assign(sim, a, 'clean');
    expect(stepUntil(sim, () => jobItems(agent(sim, a)).length > 0, 600)).toBe(true);
    agent(sim, a).needs.fun = 10; // below the engine's urgency threshold (15); Cleaning does not help fun
    const seen = new Set(jobItems(agent(sim, a)).map((q) => q.uid));
    let restartsWhileBored = 0;
    let boredBreak = false;
    let freeWillRan = false;
    step(sim, TICKS_PER_HOUR / 2, () => {
      const me = agent(sim, a);
      for (const q of jobItems(me)) {
        if (seen.has(q.uid)) continue;
        seen.add(q.uid);
        if (me.needs.fun < 15) restartsWhileBored++;
      }
      const j = jobOf(sim, clean);
      if (j && j.status === 'break' && (j.reason ?? '').includes('bored')) boredBreak = true;
      const r = me.active;
      if (r && r.source === 'auto' && typeof r.params.jobId !== 'string') freeWillRan = true;
    });
    expect(boredBreak).toBe(true);
    // the idle check must agree with the per-tick check: a run that would be interrupted at once is not started
    expect(restartsWhileBored).toBe(0);
    expect(freeWillRan).toBe(true);
  });

  it('a zombie whose vitality caps freshness under the urgency threshold can still work when as fresh as it can get', () => {
    const sim = world(32);
    const [a] = members(sim);
    agent(sim, a).vitality = 34; // freshness can never exceed 34; the engine's urgency threshold is 35
    agent(sim, a).needs.preservation = 34; // at its cap: nothing more embalming can do
    messUp(sim);
    const id = assign(sim, a, 'clean');
    const started = stepUntil(sim, () => jobItems(agent(sim, a)).length > 0, 600);
    expect(jobOf(sim, id)?.reason ?? '').not.toContain('freshening');
    expect(started).toBe(true);
    // control: a freshness that is low for THIS zombie still calls a break
    expect(stepUntil(sim, () => runPhase(sim, a), 800)).toBe(true);
    agent(sim, a).needs.preservation = 5;
    step(sim, 3);
    expect(jobOf(sim, id)).toMatchObject({ status: 'break', reason: 'Taking a break — needs freshening up' });
  });

  /** A cleaning zombie of this vitality mid-run, its freshness set to `fresh`: does the job call a freshening break? */
  function freshBreakAt(seed: number, vitality: number, fresh: number): boolean {
    const sim = world(seed);
    const [a] = members(sim);
    agent(sim, a).vitality = vitality;
    const top = Math.min(vitality, 90);
    messUp(sim);
    const id = assign(sim, a, 'clean');
    // held at its cap (as fresh as it can get) until the run starts, so decay alone never decides the start
    expect(stepUntil(sim, () => ((agent(sim, a).needs.preservation = top), runPhase(sim, a)), 800)).toBe(true);
    agent(sim, a).needs.preservation = fresh;
    step(sim, 3);
    const j = jobOf(sim, id)!;
    return j.status === 'break' && (j.reason ?? '').includes('freshening');
  }

  it('a healthy zombie (vitality 80) keeps the engine threshold: works at freshness 36, breaks at 34', () => {
    expect(freshBreakAt(33, 80, 36)).toBe(false);
    expect(freshBreakAt(33, 80, 34)).toBe(true);
  });

  it('a zombie whose cap still clears the threshold (vitality 36-42) breaks at 35, as on base', () => {
    expect(freshBreakAt(34, 36, 34)).toBe(true);
    expect(freshBreakAt(34, 42, 34)).toBe(true);
    // VITALITY_MIN (20) and 21: the lead's earlier clamp gave thresholds of -1 and 0 here (never a break)
    expect(freshBreakAt(39, 20, 1)).toBe(true);
    expect(freshBreakAt(43, 21, 1)).toBe(true);
  });

  it('a zombie capped under the threshold still breaks before freshness reaches the neglect line (15)', () => {
    expect(freshBreakAt(35, 34, 15.5)).toBe(true);
  });

  it('the clamp is pinned from above: a capped zombie (vitality 34, or 35 = a cap equal to the threshold) works on at freshness 20', () => {
    expect(freshBreakAt(36, 34, 20)).toBe(false);
    expect(freshBreakAt(37, 35, 20)).toBe(false);
  });

  it('a zombie at vitality 35 (cap equal to the threshold) takes the clamp too: breaks just above the neglect line, not at the threshold', () => {
    expect(freshBreakAt(38, 35, 15.5)).toBe(true);
  });
});

describe('urgency for a zombie whose cap leaves room', () => {
  it('vitality 60: freshness 30 is still under the engine threshold and calls a break (thresholds are not scaled for everyone)', () => {
    const sim = world(33);
    const [a] = members(sim);
    agent(sim, a).vitality = 60;
    agent(sim, a).needs.preservation = 60;
    messUp(sim);
    const id = assign(sim, a, 'clean');
    expect(stepUntil(sim, () => runPhase(sim, a), 800)).toBe(true);
    agent(sim, a).needs.preservation = 30;
    step(sim, 3);
    expect(jobOf(sim, id)).toMatchObject({ status: 'break', reason: 'Taking a break — needs freshening up' });
  });
});

describe('no remaining work', () => {
  it('Cleaning "until done" on a spotless house ends at once with a "nothing to do" done; Repairs with nothing broken too', () => {
    const sim = world(14);
    const [a, b] = members(sim);
    spotless(sim);
    for (const o of Object.values(sim.state.objects)) o.condition.broken = false;
    assign(sim, a, 'clean');
    assign(sim, b, 'repairs', { kind: 'once' });
    const ev = step(sim, 8);
    expect(jobs(sim)).toEqual([]);
    const done = ev.filter((e): e is Extract<SimEvent, { type: 'job' }> => e.type === 'job' && e.what === 'done');
    expect(done.map((e) => [e.category, e.reason]).sort()).toEqual([
      ['clean', 'nothing'],
      ['repairs', 'nothing'],
    ]);
    // nobody was sent anywhere for it
    expect(jobItems(agent(sim, a))).toEqual([]);
  });

  it('Play "until done" ends when fun is full (not when the TV would merely still be on the menu)', () => {
    const sim = world(15);
    const [a] = members(sim);
    agent(sim, a).needs.fun = 40;
    assign(sim, a, 'play');
    let funAtDone: number | null = null;
    step(sim, DAY / 2, (ev) => {
      if (ev.some((e) => e.type === 'job' && e.what === 'done' && e.reason === 'finished')) funAtDone = agent(sim, a).needs.fun;
    });
    expect(jobs(sim)).toEqual([]);
    expect(funAtDone).not.toBeNull();
    expect(funAtDone!).toBeGreaterThanOrEqual(92);
  });

  /** A spotless, unbroken house whose only mess is a greasy stove. */
  function greasyStove(seed: number) {
    const sim = world(seed, 'off');
    const [a, b] = members(sim);
    spotless(sim);
    for (const o of Object.values(sim.state.objects)) o.condition.broken = false;
    const stove = wipeables(sim).find((id) => sim.content.objects[sim.state.objects[id].defId].interactions.includes('home_cleanStove'))!;
    expect(stove).toBeDefined();
    sim.state.objects[stove].condition.dirt = 0.5;
    return { sim, a, b, stove };
  }

  it('a dirty stove someone is cooking on is still work: the until-done job is blocked, not finished', () => {
    const { sim, a, b, stove } = greasyStove(43);
    expect(sim.dispatch({ type: 'queue', actorId: b, interactionId: 'home_cookAtStove', target: { kind: 'object', id: stove }, params: { recipe: 'brainLoaf' } }).ok).toBe(true);
    const cooking = () => {
      const r = agent(sim, b).active;
      return !!r && r.interactionId === 'home_cookAtStove' && r.phase === 'run' && r.stageTarget.kind === 'object' && r.stageTarget.id === stove;
    };
    expect(stepUntil(sim, cooking, 800)).toBe(true);
    const id = assign(sim, a, 'clean', { kind: 'untilDone' }, { kind: 'object', id: stove });
    const ev = step(sim, 5);
    expect(cooking()).toBe(true);
    expect(sim.state.objects[stove].condition.dirt).toBeGreaterThanOrEqual(0.2);
    expect(ev.filter((e) => e.type === 'job' && e.what === 'done')).toEqual([]);
    expect(jobOf(sim, id)).toMatchObject({ status: 'blocked', reason: 'Someone else is already on it' });
  });

  it('a zombie with no arms cannot clean, but the mess is still work: the job is blocked with the reason, not finished', () => {
    const { sim, a, stove } = greasyStove(44);
    agent(sim, a).limbs.armL = 'missing';
    agent(sim, a).limbs.armR = 'missing';
    const id = assign(sim, a, 'clean');
    const ev = step(sim, 5);
    expect(sim.state.objects[stove].condition.dirt).toBe(0.5);
    expect(ev.filter((e) => e.type === 'job' && e.what === 'done')).toEqual([]);
    expect(jobOf(sim, id)).toMatchObject({ status: 'blocked', reason: 'Needs an arm' });
  });
});

/** Buy a Rickety Table at the first free buildable spot and seal it inside a wall box (no door). */
function sealedTable(sim: EngineSimulation): string {
  const b = sim.state.lot.buildable;
  for (let z = b.z0 + 1; z < b.z1 - 3; z++) {
    for (let x = b.x0 + 1; x < b.x1 - 3; x++) {
      const p = sim.build.preview({ type: 'buy', defId: 'table_rickety', x, z, rot: 0 });
      if (!p.ok) continue;
      const before = new Set(Object.keys(sim.state.objects));
      const r = sim.build.apply({ type: 'buy', defId: 'table_rickety', x, z, rot: 0 });
      if (!r.ok) continue;
      const id = Object.keys(sim.state.objects).find((k) => !before.has(k))!;
      const tiles = sim.spatial.objectTiles(sim.state.objects[id]);
      const x0 = Math.min(...tiles.map((t) => t.x)) - 1;
      const z0 = Math.min(...tiles.map((t) => t.z)) - 1;
      const x1 = Math.max(...tiles.map((t) => t.x)) + 2;
      const z1 = Math.max(...tiles.map((t) => t.z)) + 2;
      const edges: string[] = [];
      for (let i = x0; i < x1; i++) edges.push(`h:${i}:${z0}`, `h:${i}:${z1}`);
      for (let j = z0; j < z1; j++) edges.push(`v:${x0}:${j}`, `v:${x1}:${j}`);
      const w = sim.build.apply({ type: 'addWalls', edges });
      const inside = Object.values(sim.state.agents).some((ag) => ag.presence === 'onLot' && ag.pos.x >= x0 && ag.pos.x < x1 && ag.pos.z >= z0 && ag.pos.z < z1);
      if (!w.ok || inside) {
        sim.dispatch({ type: 'undo' });
        sim.dispatch({ type: 'undo' });
        continue;
      }
      sim.dispatch({ type: 'endBuildSession' });
      return id;
    }
  }
  throw new Error('no spot for a sealed table');
}

describe('unreachable and removed targets', () => {
  it('an unreachable dirty table is never targeted; the reachable ones get cleaned; the job ends up blocked with a reason', () => {
    const sim = world(16);
    const [a] = members(sim);
    sim.state.household.funds = 100_000;
    const sealed = sealedTable(sim);
    const dirty = messUp(sim).filter((id) => id !== sealed);
    expect(sim.state.objects[sealed].condition.dirt).toBe(0.6);
    const id = assign(sim, a, 'clean');
    const only = assign(sim, members(sim)[1], 'clean', { kind: 'untilDone' }, { kind: 'object', id: sealed });
    let targetedSealed = false;
    step(sim, DAY / 2, () => {
      for (const m of members(sim)) if (jobItems(agent(sim, m)).some((q) => (q.target as { id?: string }).id === sealed)) targetedSealed = true;
    });
    expect(targetedSealed).toBe(false);
    for (const d of dirty) expect(sim.state.objects[d].condition.dirt, d).toBeLessThan(0.2);
    expect(sim.state.objects[sealed].condition.dirt).toBe(0.6);
    for (const jid of [id, only]) {
      const j = jobOf(sim, jid)!;
      expect(j, jid).toBeDefined();
      expect(j.status).toBe('blocked');
      expect(j.reason).toMatch(/can.t get (to|there)/i);
    }
  });

  it('a target removed mid-run: the lot job moves on; an object job reports it gone — no crash, no spend', () => {
    const sim = world(17);
    const [a, b] = members(sim);
    const dirty = messUp(sim);
    const lotJob = assign(sim, a, 'clean');
    expect(stepUntil(sim, () => runPhase(sim, a), 800)).toBe(true);
    const first = jobOf(sim, lotJob)!.targetKey!;
    sim.engine.ctx.removeObject(first, 'Hauled away');
    step(sim, 4);
    expect(sim.faults()).toEqual([]);
    // it goes on with another surface
    expect(stepUntil(sim, () => jobItems(agent(sim, a)).some((q) => (q.target as { id?: string }).id !== first), 600)).toBe(true);
    const objJob = assign(sim, b, 'clean', { kind: 'untilDone' }, { kind: 'object', id: dirty.find((d) => d !== first)! });
    const target = jobOf(sim, objJob)!.scope as { id: string };
    sim.engine.ctx.removeObject(target.id, 'Hauled away');
    step(sim, 8);
    expect(jobOf(sim, objJob)!.status).toBe('blocked');
    expect(jobOf(sim, objJob)!.reason).toMatch(/gone/i);
    expect(sim.faults()).toEqual([]);
  });
});

describe('cancel and pause take effect immediately', () => {
  // free will off: nobody else cleans up behind the job's back while it is canceled / paused
  it('cancel mid-interaction stops the run and nothing job-related is queued again', () => {
    const sim = world(18, 'off');
    const [a] = members(sim);
    messUp(sim);
    const id = assign(sim, a, 'clean');
    expect(stepUntil(sim, () => runPhase(sim, a), 800)).toBe(true);
    expect(sim.dispatch({ type: 'job', action: 'cancel', jobId: id }).ok).toBe(true);
    expect(jobs(sim)).toEqual([]);
    const r = agent(sim, a).active;
    expect(!r || r.canceled || r.phase === 'exit').toBe(true);
    let jobRunsAfter = 0;
    step(sim, TICKS_PER_HOUR * 3, () => {
      const items = jobItems(agent(sim, a)).filter((q) => !(q === agent(sim, a).active && (q as { canceled?: boolean }).canceled));
      jobRunsAfter += items.length;
    });
    expect(jobRunsAfter).toBe(0);
    expect(sim.dispatch({ type: 'job', action: 'cancel', jobId: id }).ok).toBe(false);
  });

  it('pause stops the run at once and nothing runs while paused; resume picks the work back up', () => {
    const sim = world(19, 'off');
    const [a] = members(sim);
    messUp(sim);
    const id = assign(sim, a, 'clean');
    expect(stepUntil(sim, () => runPhase(sim, a), 800)).toBe(true);
    expect(sim.dispatch({ type: 'job', action: 'pause', jobId: id }).ok).toBe(true);
    expect(jobOf(sim, id)).toMatchObject({ paused: true, status: 'paused', runUid: null });
    const r = agent(sim, a).active;
    expect(!r || r.canceled || r.phase === 'exit').toBe(true);
    let during = 0;
    step(sim, TICKS_PER_HOUR * 4, () => {
      during += jobItems(agent(sim, a)).filter((q) => !(q as { canceled?: boolean }).canceled).length;
    });
    expect(during).toBe(0);
    expect(jobOf(sim, id)!.status).toBe('paused');
    expect(sim.dispatch({ type: 'job', action: 'resume', jobId: id }).ok).toBe(true);
    expect(stepUntil(sim, () => jobItems(agent(sim, a)).length > 0, 600)).toBe(true);
  });
});

describe('a social interrupts a job run', () => {
  // free will off: the housemate only does what it is told, and nobody repairs / cleans behind the job's back
  /** One broken thing, a Repairs job running on it, and the housemate told to chat with the worker. */
  function chatMidRepair(seed: number, mode: unknown) {
    const sim = world(seed, 'off');
    const [a, b] = members(sim);
    for (const o of Object.values(sim.state.objects)) o.condition.broken = false;
    const broken = Object.keys(sim.state.objects)
      .filter((k) => sim.state.objects[k].placement.kind === 'floor' && !!sim.content.objects[sim.state.objects[k].defId]?.interactions.includes('home_repair'))
      .sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)))[0];
    expect(broken).toBeDefined();
    sim.state.objects[broken].condition.broken = true;
    const id = assign(sim, a, 'repairs', mode);
    expect(stepUntil(sim, () => runPhase(sim, a), 800)).toBe(true);
    const firstUid = agent(sim, a).active!.uid;
    expect(sim.dispatch({ type: 'queue', actorId: b, interactionId: 'social_chat', target: { kind: 'agent', id: a } }).ok).toBe(true);
    // the engine suspends the repair for the chat and re-queues it under a NEW uid (same job marker)
    expect(stepUntil(sim, () => jobItems(agent(sim, a)).some((q) => q.uid !== firstUid), 600)).toBe(true);
    const copy = jobItems(agent(sim, a));
    expect(copy.map((q) => q.params.jobId)).toEqual([id]);
    expect(sim.state.objects[broken].condition.broken).toBe(true);
    return { sim, a, id, broken, copyUid: copy[0].uid };
  }

  it('the run the engine re-queued after the chat is still the job’s run: its completion is credited', () => {
    const { sim, a, id, broken, copyUid } = chatMidRepair(41, { kind: 'once' });
    const done: (string | null)[] = [];
    let completed = false;
    for (let i = 0; i < TICKS_PER_HOUR * 3 && done.length === 0; i++) {
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.type === 'interactionCompleted' && e.agentId === a && e.uid === copyUid) completed = true;
        if (e.type === 'job' && e.what === 'done' && e.jobId === id) done.push(e.reason);
      }
    }
    expect(completed).toBe(true);
    expect(sim.state.objects[broken].condition.broken).toBe(false);
    expect(done).toEqual(['finished']); // not "nothing needed doing": the zombie just fixed it
  });

  it('pausing the job stops the re-queued run too: nothing job-related runs while paused', () => {
    const { sim, a, id, broken } = chatMidRepair(42, { kind: 'untilDone' });
    expect(sim.dispatch({ type: 'job', action: 'pause', jobId: id }).ok).toBe(true);
    let during = 0;
    step(sim, TICKS_PER_HOUR * 3, () => {
      during += jobItems(agent(sim, a)).filter((q) => !(q as { canceled?: boolean }).canceled).length;
    });
    expect(during).toBe(0);
    expect(jobOf(sim, id)).toMatchObject({ paused: true, status: 'paused', runUid: null });
    expect(sim.state.objects[broken].condition.broken).toBe(true);
  });
});

describe('recurring daily window', () => {
  it.each([{ from: 18, to: 21, end: 21 }, { from: 22, to: 6, end: 6 }])('stops active or queued play when the daily window closes: $from-$to', ({ from, to, end }) => {
    const sim = world(20, 'off');
    const [, b] = members(sim);
    for (const key of Object.keys(agent(sim, b).needs) as (keyof AgentState['needs'])[]) agent(sim, b).needs[key] = 90;
    agent(sim, b).needs.fun = 10;
    sim.state.tick = tickAt(2, end * 60 - 1);
    const id = assign(sim, b, 'play', { kind: 'recurring', from, to });
    step(sim, 1);
    expect(jobItems(agent(sim, b)).length).toBeGreaterThan(0);
    step(sim, 140); // 35 game minutes across the closing boundary
    expect(jobItems(agent(sim, b))).toHaveLength(0);
    expect(jobOf(sim, id)).toMatchObject({ status: 'resting', runUid: null });
    const nextStart = tickAt(2, from * 60);
    sim.state.tick = nextStart > sim.state.tick ? nextStart : nextStart + DAY;
    agent(sim, b).needs.fun = 10;
    step(sim, 4);
    expect(jobItems(agent(sim, b)).some((q) => q.params.jobId === id)).toBe(true);
  });

  it('Play daily 6 PM–9 PM runs only inside the window, every day, and is never removed', () => {
    const sim = world(20);
    const [, b] = members(sim);
    const id = assign(sim, b, 'play', { kind: 'recurring', from: 18, to: 21 });
    const starts: number[] = [];
    const seenUid = new Set<number>();
    const doneEvents: number[] = [];
    const endTick = sim.state.tick + 3 * DAY;
    while (sim.state.tick < endTick) {
      const t = timeInfo(sim.state.tick);
      if (t.hour === 17 && t.minute === 0) agent(sim, b).needs.fun = 30; // there is play to do each evening
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'job' && e.what === 'done' && e.jobId === id) doneEvents.push(timeInfo(sim.state.tick).day);
      for (const q of jobItems(agent(sim, b))) {
        if (seenUid.has(q.uid)) continue;
        seenUid.add(q.uid);
        starts.push(sim.state.tick);
      }
    }
    expect(starts.length).toBeGreaterThanOrEqual(3);
    for (const s of starts) {
      const h = timeInfo(s).hour;
      expect(h >= 18 && h < 21, `job run queued at hour ${h}`).toBe(true);
    }
    const days = new Set(starts.map((s) => timeInfo(s).day));
    expect(days.size).toBeGreaterThanOrEqual(3);
    // at most one "done for now" per window
    expect(new Set(doneEvents).size).toBe(doneEvents.length);
    const j = jobOf(sim, id)!;
    expect(j).toBeDefined();
    expect(j.done).toBeGreaterThanOrEqual(3);
    // outside the window it rests politely
    const hour = timeInfo(sim.state.tick).hour;
    if (hour < 18 || hour >= 21) expect(['resting', 'waiting', 'break']).toContain(j.status);
  });
});

describe('save / reload', () => {
  it('a world saved mid-assignment reloads (validated + repaired + re-initialised) and continues byte-identically', () => {
    const live = world(21);
    const [a, b] = members(live);
    messUp(live);
    agent(live, b).needs.fun = 25;
    assign(live, a, 'clean');
    assign(live, b, 'play');
    assign(live, b, 'study', { kind: 'recurring', from: 22, to: 2 });
    expect(stepUntil(live, () => runPhase(live, a) && runPhase(live, b), 900)).toBe(true);
    const saved = JSON.parse(JSON.stringify(live.serialize())) as WorldState;
    expect(saved.jobs!.list.some((j) => j.runUid !== null)).toBe(true);
    const v = validateWorld(saved);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.issues).toEqual([]);
    const reloaded = createSimulation(v.world) as EngineSimulation;
    expect(canon(reloaded)).toBe(canon(live));
    const script = (sim: EngineSimulation, i: number) => {
      if (i === 700) sim.dispatch({ type: 'job', action: 'pause', jobId: 'j1' });
      if (i === 1100) sim.dispatch({ type: 'job', action: 'resume', jobId: 'j1' });
      if (i === 1500) sim.dispatch({ type: 'job', action: 'move', jobId: 'j3', dir: -1 });
    };
    for (let i = 0; i < DAY; i++) {
      script(live, i);
      script(reloaded, i);
      live.step();
      reloaded.step();
      live.drainEvents();
      reloaded.drainEvents();
    }
    expect(canon(reloaded)).toBe(canon(live));
  });
});

describe('determinism', () => {
  for (const autonomy of ['full', 'off'] as const) {
    it(`free will ${autonomy}: two runs with the same jobs and commands end byte-identical`, () => {
      const play = () => {
        const sim = world(22, autonomy);
        const [a, b] = members(sim);
        messUp(sim);
        agent(sim, b).needs.fun = 30;
        assign(sim, a, 'clean');
        assign(sim, b, 'play', { kind: 'recurring', from: 9, to: 23 });
        assign(sim, a, 'hobbies', { kind: 'once' });
        for (let i = 0; i < 1.5 * DAY; i++) {
          if (i === 900) sim.dispatch({ type: 'job', action: 'priority', jobId: 'j3', priority: 'high' });
          sim.step();
          sim.drainEvents();
        }
        return canon(sim);
      };
      expect(play()).toBe(play());
    });
  }
});

describe('money', () => {
  it('jobs never spend: no spend made during a job run succeeds, and funds only move for bills / free will', () => {
    const sim = world(23, 'off');
    const [a, b] = members(sim);
    messUp(sim);
    agent(sim, b).needs.fun = 20;
    assign(sim, a, 'clean');
    assign(sim, b, 'play');
    assign(sim, a, 'study', { kind: 'once' });
    assign(sim, b, 'hobbies', { kind: 'once' });
    const ctx = sim.engine.ctx;
    const orig = ctx.spend.bind(ctx);
    const duringJob: { reason: string; ok: boolean }[] = [];
    ctx.spend = (amount, reason, key, o) => {
      const acting = sim.engine.actingAgentId ? sim.state.agents[sim.engine.actingAgentId] : undefined;
      const ok = orig(amount, reason, key, o);
      if (acting && acting.active && typeof acting.active.params.jobId === 'string' && amount > 0) duringJob.push({ reason, ok });
      return ok;
    };
    step(sim, DAY);
    expect(duringJob.filter((s) => s.ok)).toEqual([]);
  });

  it('the engine refuses a job run that tries to buy groceries (the guard, not just the picker)', () => {
    const sim = world(24, 'off');
    const [a] = members(sim);
    const fridge = Object.keys(sim.state.objects).find((k) => sim.state.objects[k].defId.startsWith('fridge'))!;
    const funds = sim.state.household.funds;
    const qi = sim.engine.ctx.queue(agent(sim, a), { interactionId: 'home_cook', target: { kind: 'object', id: fridge }, params: { recipe: 'brainLoaf', jobId: 'j99' }, source: 'auto' });
    expect(qi).not.toBeNull();
    const ev = step(sim, TICKS_PER_HOUR * 2);
    expect(sim.state.household.funds).toBe(funds);
    expect(ev.filter((e) => e.type === 'funds' && e.delta < 0)).toEqual([]);
    // the same order without the job marker does pay (the guard is specific to job runs)
    sim.engine.ctx.queue(agent(sim, a), { interactionId: 'home_cook', target: { kind: 'object', id: fridge }, params: { recipe: 'brainLoaf' }, source: 'auto' });
    step(sim, TICKS_PER_HOUR * 2);
    expect(sim.state.household.funds).toBeLessThan(funds);
  });
});

describe('completion needs a real state change', () => {
  it('a Play run that completes without raising fun is NOT credited (the target is skipped instead)', () => {
    const sim = world(25);
    const [a] = members(sim);
    agent(sim, a).needs.fun = 40;
    const id = assign(sim, a, 'play', { kind: 'once' });
    expect(stepUntil(sim, () => runPhase(sim, a), 800)).toBe(true);
    const pinned = agent(sim, a).needs.fun;
    const firstUid = agent(sim, a).active!.uid;
    // the show plays but does nothing (fun pinned) until that run ends
    for (let i = 0; i < TICKS_PER_HOUR * 3 && jobItems(agent(sim, a)).some((q) => q.uid === firstUid); i++) {
      agent(sim, a).needs.fun = pinned;
      sim.step();
      sim.drainEvents();
    }
    const j = jobOf(sim, id)!;
    expect(j).toBeDefined(); // a once-job ends only on a REAL completion
    expect(j.done).toBe(0);
    expect(j.skips.map((s) => s.reason)).toContain('Made no difference');
  });

  it('every credited Cleaning completion matches a surface that really got cleaner', () => {
    const sim = world(26);
    const [a] = members(sim);
    const dirty = messUp(sim);
    const id = assign(sim, a, 'clean');
    let credited = 0;
    let last = 0;
    const cleaned = new Set<string>();
    step(sim, DAY / 2, () => {
      const j = jobOf(sim, id);
      if (j && j.done > last) credited += j.done - last;
      if (j) last = j.done;
      for (const d of dirty) if (sim.state.objects[d]?.condition.dirt === 0) cleaned.add(d);
    });
    expect(cleaned.size).toBe(dirty.length);
    expect(credited).toBeGreaterThanOrEqual(dirty.length - 1); // the last completion ends the job in the same tick
    expect(credited).toBeLessThanOrEqual(cleaned.size);
  });

  it('scope: a room job only works in that room; an object job only on that object', () => {
    const sim = world(27);
    const [a, b] = members(sim);
    const dirty = messUp(sim);
    const view = sim.jobs!()!;
    const room = view.scopes.clean.find((s) => s.scope.kind === 'room')!;
    expect(room).toBeDefined();
    const rs = room.scope as { kind: 'room'; x: number; z: number };
    const roomId = sim.spatial.roomAt(rs.x, rs.z);
    assign(sim, a, 'clean', { kind: 'untilDone' }, rs);
    const target = dirty[dirty.length - 1];
    assign(sim, b, 'clean', { kind: 'once' }, { kind: 'object', id: target });
    const outside: string[] = [];
    const bTargets = new Set<string>();
    step(sim, DAY / 3, () => {
      for (const q of jobItems(agent(sim, a))) {
        const o = sim.state.objects[(q.target as { id: string }).id];
        const p = o?.placement as { x?: number; z?: number } | undefined;
        if (o && p && typeof p.x === 'number' && sim.spatial.roomAt(Math.floor(p.x), Math.floor(p.z!)) !== roomId) outside.push(o.id);
      }
      for (const q of jobItems(agent(sim, b))) bTargets.add((q.target as { id: string }).id);
    });
    expect(outside).toEqual([]);
    expect([...bTargets]).toEqual([target]);
  });
});

describe('time helpers stay in sync with the clock', () => {
  it('tickAt / timeInfo agree on the window hour the tests rely on', () => {
    expect(timeInfo(tickAt(2, 18 * 60)).hour).toBe(18);
  });
});
