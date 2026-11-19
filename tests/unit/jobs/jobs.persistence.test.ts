/**
 * W-124 (D-071) WorldState.jobs through the save pipeline: schema v2 + the v1 → v2 migration (old saves get NO
 * assignments, whatever a hand-edited v1 file carries), the structural validator (garbage dropped per entry, unknown
 * keys stripped, never fatal), the jobs system's semantic heal on load (non-members, "coming later" / unknown
 * categories, untilDone on open-ended work, over-limit lists), SaveManager round trips, and hostile commands.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/sim/contracts';
import type { JobAssignment, WorldState } from '../../../src/sim/types';
import { SAVE_SCHEMA_VERSION } from '../../../src/sim/types';
import { allSystems, createSimulation } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine';
import { validateWorld } from '../../../src/persistence/validation';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { MIGRATIONS, migratePayload } from '../../../src/persistence/migrations';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { makeMeta, silentLogger } from '../persistence/fixtures';
import { jsonClone, newWorld, opts, simOf } from '../quests/helpers';

function world(seed = 31): EngineSimulation {
  const sys = allSystems();
  return simOf(newWorld(opts(seed, 2), sys), sys);
}

function withJobs(): { sim: EngineSimulation; w: WorldState } {
  const sim = world();
  const [a, b] = sim.state.household.memberIds;
  for (const c of [
    { agentId: a, category: 'clean', scope: { kind: 'lot' }, mode: { kind: 'untilDone' } },
    { agentId: b, category: 'play', scope: { kind: 'lot' }, mode: { kind: 'recurring', from: 18, to: 21 }, priority: 'high' },
  ])
    expect(sim.dispatch({ type: 'job', action: 'assign', ...c } as Command).ok).toBe(true);
  for (let i = 0; i < 40; i++) sim.step();
  return { sim, w: jsonClone(sim.serialize()) };
}

const valid = (w: WorldState): JobAssignment => jsonClone(w.jobs!.list[0]);

describe('schema v2 + migration', () => {
  it('this build writes schema v2 and the shipped registry reaches it', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(3);
    expect(world().state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(MIGRATIONS.map((m) => `${m.from}->${m.to}`)).toEqual(['1->2', '2->3']);
  });

  it('a v1 save gets an EMPTY job list — tampered v1 "jobs" are discarded, never trusted', () => {
    const { w } = withJobs();
    const v1 = jsonClone(w) as unknown as Record<string, unknown>;
    v1.schemaVersion = 1;
    const r = migratePayload(jsonClone(v1), 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(r.payload.jobs).toEqual({ version: 1, nextId: 1, list: [] });
    delete v1.jobs;
    const r2 = migratePayload(v1, 1);
    expect(r2.ok && r2.payload.jobs).toEqual({ version: 1, nextId: 1, list: [] });
  });

  it('SaveManager: a v1 save loads with no assignments and boots; a v2 save with jobs round-trips byte-identically', async () => {
    const { w } = withJobs();
    const backend = createMemoryBackend();
    const old = new SaveManagerImpl({ backend, schemaVersion: 1, migrations: [], logger: silentLogger });
    const v1 = jsonClone(w) as WorldState;
    v1.schemaVersion = 1;
    delete (v1 as { jobs?: unknown }).jobs;
    expect((await old.save('old', 'Old', v1, makeMeta())).ok).toBe(true);
    const cur = new SaveManagerImpl({ backend, logger: silentLogger, repair: null });
    const loaded = await cur.load('old');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.world.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(loaded.world.jobs).toEqual({ version: 1, nextId: 1, list: [] });
    expect(createSimulation(loaded.world).state.jobs!.list).toEqual([]);

    expect((await cur.save('new', 'New', w, makeMeta())).ok).toBe(true);
    const back = await cur.load('new');
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.warnings).toEqual([]);
    expect(canonicalJson(back.world)).toBe(canonicalJson(w));
  });
});

describe('untrusted saved assignments', () => {
  it('validateWorld drops broken entries one by one, strips unknown keys, and is never fatal', () => {
    const { w } = withJobs();
    const good = valid(w);
    const bad = jsonClone(w) as unknown as { jobs: { list: unknown[] } };
    bad.jobs.list.push(
      null,
      42,
      'j9',
      { ...good, id: 'j9', agentId: 'a1"; drop table' },
      { ...good, id: 'j10', scope: { kind: 'room', x: -4, z: 2 } },
      { ...good, id: 'j11', mode: { kind: 'recurring', from: 7, to: 7 } },
      { ...good, id: 'j12', priority: 'URGENT' },
      { ...good, id: 'j13', runUid: 'o1' },
      { ...good, id: 'j14', done: -5 },
      { ...good, id: 'j15', paused: 'yes' },
      { ...good, id: good.id }, // duplicate id
      { ...good, id: 'j16', __proto__: { polluted: true }, evil: '<script>' },
    );
    const r = validateWorld(bad);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.world.jobs!.list.map((j) => j.id);
    expect(ids).toEqual([...w.jobs!.list.map((j) => j.id), 'j16']);
    const j16 = r.world.jobs!.list.find((j) => j.id === 'j16') as unknown as Record<string, unknown>;
    expect('evil' in j16).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.world.jobs!.nextId).toBeGreaterThan(16);
  });

  it('a broken jobs block is dropped with a note and the sim recreates an empty one', () => {
    const { w } = withJobs();
    for (const junk of [{ version: 9, list: [] }, 'jobs', [], { version: 1, list: 'x' }]) {
      const b = jsonClone(w) as unknown as Record<string, unknown>;
      b.jobs = junk;
      const r = validateWorld(b);
      expect(r.ok, JSON.stringify(junk)).toBe(true);
      if (!r.ok) continue;
      const sim = createSimulation(r.world);
      expect(sim.state.jobs).toMatchObject({ version: 1, list: expect.any(Array) });
      for (const j of sim.state.jobs!.list) expect(sim.state.household.memberIds).toContain(j.agentId);
    }
  });

  it('on load the jobs system cleans semantic garbage: non-members, unknown / "coming later" categories, untilDone on open-ended work, over-limit lists', () => {
    const { w } = withJobs();
    const good = valid(w);
    const [a] = w.household.memberIds;
    const townie = Object.keys(w.agents).find((id) => !w.household.memberIds.includes(id))!;
    expect(townie).toBeDefined();
    const t = jsonClone(w);
    t.jobs!.list = [
      good,
      { ...good, id: 'j20', agentId: townie },
      { ...good, id: 'j21', category: 'yard' },
      { ...good, id: 'j22', category: 'cooking' },
      { ...good, id: 'j23', category: 'teleport' },
      { ...good, id: 'j24', category: 'hobbies', mode: { kind: 'untilDone' } },
      { ...good, id: 'j25', category: 'social', scope: { kind: 'object', id: 'o5' } },
      { ...good, id: 'j26', runUid: 999_999, status: 'working' }, // points at no queue item
      ...Array.from({ length: 8 }, (_, i) => ({ ...good, id: `j${30 + i}`, agentId: a, category: 'study', mode: { kind: 'once' } }) as JobAssignment),
    ];
    const r = validateWorld(t);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sim = createSimulation(r.world);
    const ids = sim.state.jobs!.list.map((j) => j.id);
    for (const gone of ['j20', 'j21', 'j22', 'j23', 'j24', 'j25']) expect(ids).not.toContain(gone);
    expect(ids).toContain(good.id);
    expect(sim.state.jobs!.list.filter((j) => j.agentId === a).length).toBeLessThanOrEqual(6);
    // the dangling run is forgotten on the first tick, without a fault
    sim.step();
    const j26 = sim.state.jobs!.list.find((j) => j.id === 'j26');
    if (j26) expect(j26.runUid === null || j26.runUid !== 999_999).toBe(true);
    expect(sim.faults()).toEqual([]);
  });
});

describe('hostile commands', () => {
  it('refuses garbage and "coming later" categories, and changes nothing', () => {
    const sim = world(32);
    const [a] = sim.state.household.memberIds;
    const townie = Object.keys(sim.state.agents).find((id) => !sim.state.household.memberIds.includes(id))!;
    const before = canonicalJson(sim.serialize() as never);
    const bad: unknown[] = [
      { action: 'assign', agentId: a, category: 'yard', scope: { kind: 'lot' }, mode: { kind: 'once' } },
      { action: 'assign', agentId: a, category: 'cooking', scope: { kind: 'lot' }, mode: { kind: 'once' } },
      { action: 'assign', agentId: a, category: 'juggling', scope: { kind: 'lot' }, mode: { kind: 'once' } },
      { action: 'assign', agentId: a, category: '__proto__', scope: { kind: 'lot' }, mode: { kind: 'once' } },
      { action: 'assign', agentId: townie, category: 'clean', scope: { kind: 'lot' }, mode: { kind: 'once' } },
      { action: 'assign', agentId: 'a999', category: 'clean', scope: { kind: 'lot' }, mode: { kind: 'once' } },
      { action: 'assign', agentId: a, category: 'clean', scope: { kind: 'room', x: 9999, z: 1 }, mode: { kind: 'once' } },
      { action: 'assign', agentId: a, category: 'clean', scope: { kind: 'object', id: 'o999999' }, mode: { kind: 'once' } },
      { action: 'assign', agentId: a, category: 'clean', scope: { kind: 'lot' }, mode: { kind: 'recurring', from: 3, to: 3 } },
      { action: 'assign', agentId: a, category: 'hobbies', scope: { kind: 'lot' }, mode: { kind: 'untilDone' } },
      { action: 'assign', agentId: a, category: 'social', scope: { kind: 'object', id: 'o1' }, mode: { kind: 'once' } },
      { action: 'assign', agentId: a, category: 'clean', scope: { kind: 'lot' }, mode: { kind: 'once' }, priority: 'now!' },
      { action: 'cancel', jobId: 'j1' },
      { action: 'move', jobId: 'j1', dir: 5 },
      { action: 'explode' },
      null,
    ];
    for (const c of bad) expect(sim.dispatch({ type: 'job', ...(c as object) } as Command).ok, JSON.stringify(c)).toBe(false);
    const later = sim.dispatch({ type: 'job', action: 'assign', agentId: a, category: 'yard', scope: { kind: 'lot' }, mode: { kind: 'once' } } as Command);
    expect(later.reason).toMatch(/coming later/i);
    expect(canonicalJson(sim.serialize() as never)).toBe(before);
  });

  it('limits: duplicates refused, at most 6 jobs per zombie', () => {
    const sim = world(33);
    const [a] = sim.state.household.memberIds;
    const assign = (category: string, mode: unknown) => sim.dispatch({ type: 'job', action: 'assign', agentId: a, category, scope: { kind: 'lot' }, mode } as Command);
    expect(assign('clean', { kind: 'untilDone' }).ok).toBe(true);
    expect(assign('clean', { kind: 'untilDone' }).reason).toBe('Already assigned');
    for (const [c, m] of [
      ['play', { kind: 'once' }],
      ['study', { kind: 'once' }],
      ['hobbies', { kind: 'once' }],
      ['exercise', { kind: 'once' }],
      ['repairs', { kind: 'untilDone' }],
    ] as const)
      expect(assign(c, m).ok).toBe(true);
    expect(assign('social', { kind: 'once' }).ok).toBe(false);
  });
});
