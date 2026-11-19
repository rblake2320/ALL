/**
 * W-131 order trace on the REAL content (starter lot). Owner report: "I set the things for a zombie to do (clean and
 * others) and it did not do those tasks" — orders could leave the queue with no event and no notice. Each case below
 * forces one way an order can end without running and proves it is now visible:
 *  1. target removed while queued (sold through the real BuildService) → orderDropped targetGone + a "dropped" notice;
 *  2. a full queue bumped by an urgent system item (pass-out) → orderDropped queueFull + notice, the urgent item runs;
 *  3. an order valid when queued but not when it starts (counter cleaned meanwhile) → interactionFailed now carries
 *     uid / interactionId / source;
 *  4. refused at the click (nothing dirty) → dispatch says why, nothing is queued (the screenshot case);
 *  5. determinism: two identical runs with drops produce identical notifications and events.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, SimulationAPI } from '../../../src/sim/contracts';
import { IX } from '../../../src/sim/content/home/ids';
import { HARD_QUEUE_CAP } from '../../../src/sim/engine/constants';
import type { AgentState, ObjectState } from '../../../src/sim/types';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';

function realSim(seed: number): SimulationAPI {
  return createSimulation(createNewWorld({
    seed, householdName: 'Graves', lotTemplate: 'starter', difficulty: 'normal',
    members: ['Mort', 'Ghoulia'].map((firstName) => ({ firstName, lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null })),
  }));
}
const membersOf = (sim: SimulationAPI): AgentState[] => sim.state.household.memberIds.map((id) => sim.state.agents[id]);
function firstOf(sim: SimulationAPI, defId: string): ObjectState {
  const o = Object.values(sim.state.objects).find((x) => x.defId === defId);
  if (!o) throw new Error(`no ${defId} on the lot`);
  return o;
}
function calm(sim: SimulationAPI): void {
  sim.state.settings.autonomy = 'off';
  for (const a of membersOf(sim)) {
    for (const n of ['hunger', 'energy', 'social', 'fun', 'hygiene'] as const) a.needs[n] = 95;
    a.needs.preservation = Math.min(95, a.vitality);
  }
}

function drain(sim: SimulationAPI, n: number, into: SimEvent[]): void {
  for (let i = 0; i < n; i++) {
    sim.step();
    into.push(...sim.drainEvents());
  }
}

/** Mort watches TV (a long run), so later player orders stay QUEUED behind it. */
function busyWatching(seed: number) {
  const sim = realSim(seed);
  calm(sim);
  const [mort] = membersOf(sim);
  const tv = firstOf(sim, 'tv_crt');
  const r = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.watchTv, target: { kind: 'object', id: tv.id } });
  expect(r.ok, r.ok ? '' : r.reason).toBe(true);
  for (let i = 0; i < 4 * 60 && mort.active?.phase !== 'run'; i++) sim.step();
  expect(mort.active?.interactionId).toBe(IX.watchTv);
  sim.drainEvents();
  return { sim, mort };
}

function sitOrder(sim: SimulationAPI, actorId: string) {
  const chair = firstOf(sim, 'armchair_tattered');
  const menu = sim.menu(actorId, { kind: 'object', id: chair.id });
  const sit = menu.find((m) => m.available && /sit/i.test(m.label));
  expect(sit, `armchair menu: ${menu.map((m) => m.label).join(', ')}`).toBeDefined();
  const r = sim.dispatch({ type: 'queue', actorId, interactionId: sit!.interactionId, target: { kind: 'object', id: chair.id } });
  expect(r.ok, r.ok ? '' : r.reason).toBe(true);
  return { chair, interactionId: sit!.interactionId };
}

describe('W-131 no player order vanishes silently', () => {
  it('target sold while the order waits: orderDropped(targetGone) + a "dropped" notice naming why', () => {
    const { sim, mort } = busyWatching(21);
    const { chair, interactionId } = sitOrder(sim, mort.id);
    const queued = mort.queue.find((q) => q.interactionId === interactionId)!;
    const notes = sim.state.notifications.length;
    const sold = sim.build.apply({ type: 'sell', objectId: chair.id });
    expect(sold.ok, sold.ok ? '' : sold.reason).toBe(true);
    const ev: SimEvent[] = [...sim.drainEvents()];
    expect(mort.queue.some((q) => q.uid === queued.uid)).toBe(false);
    const drop = ev.find((e) => e.type === 'orderDropped');
    expect(drop).toMatchObject({ type: 'orderDropped', agentId: mort.id, uid: queued.uid, interactionId, source: 'player', cause: 'targetGone' });
    const fresh = sim.state.notifications.slice(notes);
    expect(fresh.some((n) => n.kind === 'bad' && /dropped/.test(n.title) && n.agentId === mort.id)).toBe(true);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a full queue bumped by an urgent pass-out: orderDropped(queueFull) + notice; never silent', () => {
    const { sim, mort } = busyWatching(22);
    const chair = firstOf(sim, 'armchair_tattered');
    const sit = sim.menu(mort.id, { kind: 'object', id: chair.id }).find((m) => m.available && /sit/i.test(m.label))!;
    // the player may queue only a few orders; the HARD cap is reached when system items join them. Fill it with
    // player copies (fresh uids) to model that state exactly.
    const r = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: sit.interactionId, target: { kind: 'object', id: chair.id } });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    const proto = mort.queue[mort.queue.length - 1];
    while (mort.queue.length < HARD_QUEUE_CAP) mort.queue.push({ ...proto, uid: sim.state.nextId++, params: { ...proto.params } });
    expect(mort.queue.length).toBe(HARD_QUEUE_CAP);
    const notes = sim.state.notifications.length;
    sim.state.settings.autonomy = 'full';
    mort.needs.energy = 0; // forces the critical pass-out
    const ev: SimEvent[] = [];
    drain(sim, 30, ev);
    const drops = ev.filter((e) => e.type === 'orderDropped');
    expect(drops.length, 'something urgent must have bumped a queued order').toBeGreaterThan(0);
    for (const d of drops) expect(d).toMatchObject({ source: 'player', cause: 'queueFull' });
    // the interrupted TV run could not be re-queued into the full queue: before W-131 it vanished silently
    expect(drops.some((d) => d.type === 'orderDropped' && d.interactionId === IX.watchTv)).toBe(true);
    expect(drops.some((d) => d.type === 'orderDropped' && d.interactionId === sit.interactionId)).toBe(true);
    expect(sim.state.notifications.slice(notes).some((n) => /dropped/.test(n.title))).toBe(true);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('valid when queued, invalid at start: interactionFailed carries uid, interactionId and source', () => {
    const { sim, mort } = busyWatching(23);
    const counter = firstOf(sim, 'counter_butcher');
    counter.condition = { ...(counter.condition ?? {}), dirt: 0.9 } as typeof counter.condition;
    const r = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.wipeDown, target: { kind: 'object', id: counter.id } });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    counter.condition = { ...(counter.condition ?? {}), dirt: 0 } as typeof counter.condition; // someone cleaned it
    const uid = Number((r as { id?: string }).id);
    expect(sim.dispatch({ type: 'cancel', actorId: mort.id, uid: mort.active!.uid }).ok).toBe(true);
    const ev: SimEvent[] = [];
    drain(sim, 6 * 60, ev);
    const fail = ev.find((e) => e.type === 'interactionFailed');
    expect(fail).toMatchObject({ type: 'interactionFailed', agentId: mort.id, interactionId: IX.wipeDown, source: 'player', reason: 'Already spotless' });
    if (Number.isFinite(uid)) expect((fail as { uid?: number }).uid).toBe(uid);
  });

  it('refused at the click when nothing is dirty: dispatch says why and queues nothing (owner screenshot case)', () => {
    const sim = realSim(24);
    calm(sim);
    const [mort] = membersOf(sim);
    const counter = firstOf(sim, 'counter_butcher');
    counter.condition = { ...(counter.condition ?? {}), dirt: 0 } as typeof counter.condition;
    const r = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.wipeDown, target: { kind: 'object', id: counter.id } });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toBe('Already spotless');
    expect(mort.queue.length).toBe(0);
  });

  it('determinism: identical runs with drops give identical notifications and event streams', () => {
    const run = () => {
      const { sim, mort } = busyWatching(25);
      const { chair } = sitOrder(sim, mort.id);
      sim.build.apply({ type: 'sell', objectId: chair.id });
      const ev: SimEvent[] = [...sim.drainEvents()];
      drain(sim, 120, ev);
      return JSON.stringify({ n: sim.state.notifications.map((x) => [x.kind, x.title, x.text]), e: ev.map((x) => x.type) });
    };
    expect(run()).toBe(run());
  });
});
