import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../../src/sim/types';
import { repairWorld } from '../../../src/sim/engine/repair';
import { fixtureRegistry, fixtureSim, hours, newFixtureWorld, place } from '../../../src/sim/engine/fixtures/world';
import { putAt, queue, setup, until } from './helpers';

function corruptedSave(): WorldState {
  const { sim, agents, objects } = setup({
    members: ['A', 'B'],
    objects: [
      { defId: 'fridge_humming', x: 5, z: 5 },
      { defId: 'chair_creaky', x: 9, z: 9 },
      { defId: 'table_rickety', x: 12, z: 12 },
    ],
  });
  const [a, b] = agents;
  putAt(a, 9, 12);
  queue(sim, a, 'fx_sit', { kind: 'object', id: objects[1].id });
  until(sim, () => a.active?.phase === 'run');
  const s = sim.serialize();
  const A = s.agents[a.id];
  const B = s.agents[b.id];
  // NaN / out-of-range needs (JSON turns NaN into null; we inject both)
  (A.needs as Record<string, unknown>).hunger = Number.NaN;
  (A.needs as Record<string, unknown>).fun = null;
  A.needs.energy = 9999;
  A.vitality = 50;
  A.needs.preservation = 80;
  (B as unknown as Record<string, unknown>).vitality = 'lots';
  // unknown object + dangling references
  s.objects.o9001 = { ...s.objects[objects[0].id], id: 'o9001', defId: 'deleted_in_v2', reservedBy: {}, inUseBy: [] };
  s.objects[objects[2].id].reservedBy = { '0': 'a404' };
  s.objects[objects[2].id].inUseBy = ['a404', b.id];
  B.carryObjectId = 'o404';
  B.active = { ...A.active!, uid: A.active!.uid, stageTarget: { kind: 'object', id: 'o404' } };
  // off-grid + duplicate uids + bad counter
  B.pos = { x: -40, z: 999 };
  B.queue = [{ ...A.active!, interactionId: 'fx_snack' }];
  s.nextId = 3;
  // relationship stored under the wrong key / reversed
  s.relationships = { [`${b.id}|${a.id}`]: { a: b.id, b: a.id, friendship: 500, romance: -5, met: true, partners: false, engaged: false, married: false, bestFriends: false, lastInteractionTick: 0, interactions: 2 } };
  // garbage scalars
  (s.household as unknown as Record<string, unknown>).funds = -12.7;
  (s.settings as unknown as Record<string, unknown>).autonomy = 'sometimes';
  (s as unknown as Record<string, unknown>).rng = { a: 0, b: 0, c: 0, d: 0 };
  s.notifications.push({ ...s.notifications[0] }); // duplicate id
  return s;
}

describe('repairWorld', () => {
  it('repairs NaN needs, caps, unknown defs, dangling refs, off-grid agents, duplicate ids, nextId and relationship keys', () => {
    const s = corruptedSave();
    const reg = fixtureRegistry();
    const w = repairWorld(s, reg);
    expect(w.length).toBeGreaterThan(5);
    const [aId, bId] = s.household.memberIds;
    const A = s.agents[aId];
    const B = s.agents[bId];
    for (const v of Object.values(A.needs)) expect(Number.isFinite(v)).toBe(true);
    expect(A.needs.energy).toBe(100);
    expect(A.needs.preservation).toBe(50);
    expect(B.vitality).toBe(100);
    expect(s.objects.o9001).toBeUndefined();
    expect(Object.values(s.objects).every((o) => Object.values(o.reservedBy).every((who) => who === aId))).toBe(true);
    expect(B.carryObjectId).toBeNull();
    expect(B.active).toBeNull();
    const uids = [A.active?.uid, ...A.queue.map((q) => q.uid), ...B.queue.map((q) => q.uid)].filter((u) => u !== undefined);
    expect(new Set(uids).size).toBe(uids.length);
    expect(s.nextId).toBeGreaterThan(Math.max(...(uids as number[])));
    const keys = Object.keys(s.relationships);
    expect(keys).toEqual([aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`]);
    const r = s.relationships[keys[0]];
    expect(r.friendship).toBe(100);
    expect(r.romance).toBe(0);
    expect(s.household.funds).toBe(0);
    expect(s.settings.autonomy).toBe('full');
    expect(s.rng.a | s.rng.b | s.rng.c | s.rng.d).not.toBe(0);
    expect(new Set(s.notifications.map((n) => n.id)).size).toBe(s.notifications.length);
  });

  it('a repaired corrupted save runs a game hour with healthy invariants and no faults', () => {
    const s = corruptedSave();
    const { sim } = fixtureSim(s, { repair: true });
    expect(sim.repairWarnings.length).toBeGreaterThan(0);
    const B = sim.state.agents[sim.state.household.memberIds[1]];
    expect(sim.spatial.inBounds(Math.floor(B.pos.x), Math.floor(B.pos.z))).toBe(true);
    expect(sim.checkInvariants()).toEqual([]);
    hours(sim, 1);
    expect(sim.checkInvariants()).toEqual([]);
    expect(sim.faults().filter((f) => f.where !== 'repair')).toEqual([]);
  });

  it('survives structurally hostile input', () => {
    const reg = fixtureRegistry();
    const hostile = {
      agents: { a1: 'not an agent', a2: { id: 'a2', needs: 'x', skills: null, queue: 'q', moodlets: [{ id: 'fx_happy', stacks: 99 }, 'junk'], limbs: 5, pos: null, presence: 'onLot' } },
      objects: { o1: { defId: 'chair_creaky', placement: { kind: 'floor', x: 'a', z: 1, rot: 0 } }, o2: null },
      household: { memberIds: ['a2', 'a3', 7], funds: Number.POSITIVE_INFINITY, txLog: 'nope', bills: [{ id: 'b', amount: -5 }] },
      lot: { width: -1 },
      notifications: 'n',
      choices: [{ id: 'c1', options: 'nope' }],
      relationships: { 'x|y': 5 },
      flags: { ok: true, bad: { nested: 1 } },
      stats: 7,
      party: { hostId: 3 },
    } as unknown as WorldState;
    expect(() => repairWorld(hostile, reg)).not.toThrow();
    expect(hostile.agents.a1).toBeUndefined();
    expect(hostile.agents.a2.moodlets).toEqual([expect.objectContaining({ id: 'fx_happy', stacks: 3 })]);
    expect(hostile.household.memberIds).toEqual(['a2']);
    expect(hostile.household.funds).toBe(0);
    expect(hostile.lot.width).toBe(30);
    expect(hostile.objects).toEqual({});
    expect(hostile.flags).toEqual({ ok: true });
    expect(hostile.party).toBeNull();
    const { sim } = fixtureSim(hostile, { repair: true });
    for (let i = 0; i < 200; i++) sim.step();
    expect(sim.checkInvariants()).toEqual([]);
    expect(() => repairWorld(null as never, reg)).toThrow();
  });

  it('is idempotent: repairing a healthy world changes nothing meaningful', () => {
    const state = newFixtureWorld();
    const { sim } = fixtureSim(state, { repair: false });
    place(sim, 'fridge_humming', 5, 5);
    hours(sim, 2);
    const before = JSON.stringify(sim.serialize());
    const copy = JSON.parse(before) as WorldState;
    repairWorld(copy, fixtureRegistry());
    expect(JSON.stringify(copy)).toBe(before);
  });
});
