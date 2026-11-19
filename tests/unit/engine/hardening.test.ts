/**
 * HARDENING regressions: each test pins a bug found in the independent review of SIM-ENGINE (it failed before the
 * fix). Adversarial by design: clobbered state written by "buggy systems", interleavings across a save, chaos.
 */
import { describe, expect, it } from 'vitest';
import type { ContentModule, SimSystem } from '../../../src/sim/contracts';
import type { ObjectState, WorldState } from '../../../src/sim/types';
import { createRng, seedRngState } from '../../../src/sim/rng';
import { fixtureSim, hashState } from '../../../src/sim/engine/fixtures/world';
import { repairWorld } from '../../../src/sim/engine/repair';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { putAt, queue, setup, steps, until } from './helpers';

const tvAndChair = [
  { defId: 'tv_crt', x: 10, z: 10, rot: 0 as const },
  { defId: 'chair_creaky', x: 10, z: 13, rot: 2 as const },
];

/** Continue a simulation from a JSON round trip of its state with the same registry + systems. */
function reload(sim: EngineSimulation): EngineSimulation {
  const saved = JSON.parse(JSON.stringify(sim.serialize())) as WorldState;
  return fixtureSim(saved, { registry: sim.engine.content, systems: sim.engine.systems.map((e) => e.sys) }).sim;
}

describe('hardening: save/load determinism', () => {
  it('a power cut made by a system hook right before a save ends the same runs after loading', () => {
    let cutAt = -1;
    const cutter: SimSystem = {
      id: 'x_cutter',
      tick(ctx) {
        if (ctx.state.tick === cutAt) ctx.state.household.utilitiesOn = false;
      },
    };
    const { sim, agents, objects } = setup({ objects: tvAndChair, extraSystems: [cutter] });
    const a = agents[0];
    putAt(a, 15, 15);
    queue(sim, a, 'fx_watchTv', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    steps(sim, 3);
    cutAt = sim.state.tick + 1;
    sim.step(); // systems tick after agents: the run has not noticed the cut yet
    expect(sim.state.household.utilitiesOn).toBe(false);
    expect(a.active?.interactionId).toBe('fx_watchTv');
    const loaded = reload(sim);
    expect(loaded.repairWarnings).toEqual([]);
    sim.step();
    loaded.step();
    // both timelines end the powered stage on the very next tick (no in-memory "last utilities" state)
    expect(sim.state.agents[a.id].active).toBeNull();
    expect(loaded.state.agents[a.id].active).toBeNull();
    expect(loaded.state.notifications.at(-1)?.text).toBe('The power is out');
    for (let i = 0; i < 40; i++) {
      sim.step();
      loaded.step();
    }
    expect(hashState(loaded.serialize())).toBe(hashState(sim.serialize()));
  });

  it('utilities off: a powered run that starts later is still refused, and runs are re-checked every tick', () => {
    const { sim, agents, objects } = setup({ objects: tvAndChair });
    const a = agents[0];
    putAt(a, 15, 15);
    sim.state.household.utilitiesOn = false;
    sim.engine.ctx.queue(a, { interactionId: 'fx_watchTv', target: { kind: 'object', id: objects[0].id }, source: 'system' });
    until(sim, () => !a.active, 400);
    expect(sim.state.agents[a.id].active).toBeNull();
    sim.state.household.utilitiesOn = true;
    queue(sim, a, 'fx_watchTv', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    sim.state.household.utilitiesOn = false;
    sim.step();
    expect(a.active).toBeNull();
    expect(sim.faults()).toEqual([]);
  });
});

describe('hardening: lifecycle under clobbered state', () => {
  it('a clobbered reservedBy/inUseBy never skips behaviour.end() nor stops the rest of the tick', () => {
    let systemTicks = 0;
    const { sim, agents, objects, counters } = setup({
      members: ['A', 'B'],
      objects: [{ defId: 'mirror_cracked', x: 6, z: 6 }],
      extraSystems: [{ id: 'x_count', tick: () => void systemTicks++ }],
    });
    const [a, b] = agents;
    const mirror = objects[0];
    putAt(a, 6, 12);
    const r = queue(sim, a, 'fx_admire', { kind: 'object', id: mirror.id });
    until(sim, () => a.active?.phase === 'run');
    // a buggy system clobbers the object's bookkeeping
    (mirror as unknown as Record<string, unknown>).inUseBy = null;
    (mirror as unknown as Record<string, unknown>).reservedBy = 'garbage';
    expect(sim.checkInvariants().some((m) => /not a (list|map)/.test(m))).toBe(true); // reported, not crashed
    sim.engine.ctx.failRun(a, 'The mirror cracked further');
    const before = systemTicks;
    steps(sim, 3);
    expect(systemTicks).toBe(before + 3);
    expect(a.active).toBeNull();
    expect(counters.end.get(Number(r.id))).toBe(1);
    expect(counters.outcomes).toEqual(['failed']);
    expect(Array.isArray(mirror.inUseBy)).toBe(true);
    expect(mirror.reservedBy).toEqual({});
    // the healed object is usable again
    putAt(b, 7, 12);
    queue(sim, b, 'fx_admire', { kind: 'object', id: mirror.id });
    until(sim, () => b.active?.phase === 'run');
    expect(mirror.inUseBy).toEqual([b.id]);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a run in its graceful exit minute ends canceled — no failure toast — whatever stops it meanwhile', () => {
    const { sim, agents, objects, counters } = setup({ objects: [{ defId: 'mirror_cracked', x: 6, z: 6 }, { defId: 'mirror_cracked', x: 12, z: 6 }] });
    const a = agents[0];
    putAt(a, 6, 12);
    // 1) player cancel, then the object is removed during the exit minute
    const r1 = queue(sim, a, 'fx_admire', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    expect(sim.dispatch({ type: 'cancel', actorId: a.id, uid: Number(r1.id) }).ok).toBe(true);
    expect(a.active?.phase).toBe('exit');
    sim.drainEvents();
    const notes = sim.state.notifications.length;
    sim.engine.ctx.removeObject(objects[0].id);
    expect(a.active).toBeNull();
    // 2) build-mode style: users interrupted first, then failRun lands during the exit minute
    const r2 = queue(sim, a, 'fx_admire', { kind: 'object', id: objects[1].id });
    until(sim, () => a.active?.phase === 'run');
    sim.engine.ctx.interrupt(a, 'The mirror was sold');
    sim.engine.ctx.failRun(a, 'The mirror was sold');
    steps(sim, 2);
    expect(a.active).toBeNull();
    expect(counters.outcomes).toEqual(['canceled', 'canceled']);
    expect(counters.end.get(Number(r1.id))).toBe(1);
    expect(counters.end.get(Number(r2.id))).toBe(1);
    expect(sim.drainEvents().some((e) => e.type === 'interactionFailed')).toBe(false);
    expect(sim.state.notifications.slice(notes).some((n) => n.kind === 'bad')).toBe(false);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('holdItem by a system immediately fails other runs bound to the item (no stale reservation)', () => {
    const { sim, agents } = setup({ members: ['A', 'B'] });
    const [a, b] = agents;
    putAt(a, 6, 15);
    putAt(b, 20, 20);
    const meal = sim.engine.ctx.spawnObject('item_meal', { kind: 'loose', x: 6.5, z: 6.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 });
    expect(queue(sim, a, 'fx_eatItem', { kind: 'object', id: meal.id }).ok).toBe(true);
    expect(meal.reservedBy['0']).toBe(a.id);
    sim.drainEvents();
    sim.engine.ctx.holdItem(b, meal);
    expect(a.active).toBeNull();
    expect(sim.checkInvariants()).toEqual([]);
    expect(sim.drainEvents().some((e) => e.type === 'interactionFailed' && e.agentId === a.id && e.reason === 'Someone else took it')).toBe(true);
    expect(meal.placement).toEqual({ kind: 'held', agentId: b.id });
    expect(b.carryObjectId).toBe(meal.id);
  });

  it('a diner eating at a seat near itself keeps eating when someone else takes or clears the platter', () => {
    // mirrors the real "Have a Serving": stage 0 grabs from the meal, stage 1 eats at a seat near the ACTOR
    const serving: ContentModule = {
      id: 'x',
      interactions: [
        {
          id: 'x_serving',
          label: 'Have a Serving',
          icon: 'plate',
          targetKind: 'object',
          behavior: 'fx_counter',
          stages: [
            { target: { kind: 'target' }, duration: 1, anim: 'pickup' },
            { target: { kind: 'seat', preferTable: true, radius: 10, near: 'actor' }, fallback: { kind: 'here' }, duration: 20, anim: 'sitEat', needsPerHour: { hunger: 60 } },
          ],
        },
      ],
    };
    const { sim, agents, counters } = setup({ members: ['A', 'B'], extraContent: [serving], objects: [{ defId: 'chair_creaky', x: 12, z: 10 }], needs: { hunger: 30 } });
    sim.content.objects.item_meal.interactions.push('x_serving');
    const [a, b] = agents;
    putAt(a, 8, 9);
    putAt(b, 20, 20);
    const meal = sim.engine.ctx.spawnObject('item_meal', { kind: 'loose', x: 8.5, z: 6.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 });
    const r = queue(sim, a, 'x_serving', { kind: 'object', id: meal.id });
    until(sim, () => a.active?.stage === 1 && a.active?.phase === 'run');
    expect(meal.inUseBy).toEqual([]); // the platter is not "in use" by someone eating at a chair across the room
    sim.engine.ctx.holdItem(b, meal); // "Put Away Leftovers"
    expect(a.active?.interactionId).toBe('x_serving');
    sim.engine.ctx.releaseHeld(b, 'destroy'); // "Throw Away"
    steps(sim, 4);
    expect(a.active?.interactionId).toBe('x_serving');
    until(sim, () => !a.active);
    expect(counters.outcomes).toEqual(['complete']);
    expect(counters.end.get(Number(r.id))).toBe(1);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a watcher (seat facing the TV) still stops when the TV itself goes away', () => {
    const { sim, agents, objects } = setup({ objects: tvAndChair });
    const a = agents[0];
    putAt(a, 15, 15);
    queue(sim, a, 'fx_watchTv', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    expect(objects[0].inUseBy).toContain(a.id);
    sim.engine.ctx.removeObject(objects[0].id, 'The TV was sold');
    expect(a.active).toBeNull();
    expect(sim.state.notifications.at(-1)?.text).toBe('The TV was sold');
  });

  it('spawnAgent ends a stale run left on an off-lot agent (end once, reservations freed)', () => {
    const { sim, agents, objects, counters } = setup({ objects: [{ defId: 'mirror_cracked', x: 6, z: 6 }] });
    const a = agents[0];
    putAt(a, 6, 12);
    const r = queue(sim, a, 'fx_admire', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    a.presence = 'atWork'; // a system flipped presence without despawnAgent
    sim.engine.ctx.spawnAgent(a.id, { x: 10.5, z: 10.5 });
    expect(a.active).toBeNull();
    expect(counters.end.get(Number(r.id))).toBe(1);
    expect(objects[0].reservedBy).toEqual({});
    expect(objects[0].inUseBy).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('NaN run timers written by a buggy behaviour self-heal instead of freezing the run forever', () => {
    const { sim, agents, objects, counters } = setup({ objects: [{ defId: 'mirror_cracked', x: 6, z: 6 }] });
    const a = agents[0];
    putAt(a, 6, 12);
    const r = queue(sim, a, 'fx_admire', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    a.active!.elapsed = Number.NaN;
    a.active!.duration = Number.NaN;
    expect(until(sim, () => !a.active, 40)).toBeGreaterThanOrEqual(0);
    expect(counters.end.get(Number(r.id))).toBe(1);
    expect(sim.faults()).toEqual([]);
  });
});

describe('hardening: leaving the lot', () => {
  it('sendOffLot always gets the agent off the lot, even when its exit walk is interrupted', () => {
    const { sim, agents } = setup({ members: ['A', 'B'] });
    const [a, b] = agents;
    putAt(a, 10, 10);
    putAt(b, 12, 10);
    sim.engine.ctx.sendOffLot(a, 'offLot', 'Errand');
    steps(sim, 4);
    expect(a.active?.interactionId).toBe('engine_exitLot');
    sim.engine.ctx.interrupt(a, 'Build mode');
    // the household member can't cancel it from the queue either
    const qv = sim.queueView(a.id);
    expect(qv.every((q) => !q.cancellable)).toBe(true);
    for (const q of qv) expect(sim.dispatch({ type: 'cancel', actorId: a.id, uid: q.uid }).ok).toBe(false);
    expect(until(sim, () => a.presence !== 'onLot', 3000)).toBeGreaterThanOrEqual(0);
    expect(a.presence).toBe('offLot');
    // a full queue of other work does not trap the exit either
    sim.engine.ctx.sendOffLot(b, 'atWork', 'Shift');
    for (let i = 0; i < 12; i++) sim.engine.ctx.queue(b, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'auto' });
    sim.engine.ctx.interrupt(b, 'Chaos');
    expect(until(sim, () => b.presence !== 'onLot', 3000)).toBeGreaterThanOrEqual(0);
    expect(b.presence).toBe('atWork');
    expect(sim.checkInvariants()).toEqual([]);
    expect(sim.faults()).toEqual([]);
  });
});

describe('hardening: status self-healing', () => {
  it('a stale passedOut flag (no pass-out running) no longer freezes autonomy', () => {
    const { sim, agents } = setup({ autonomy: 'full', objects: [{ defId: 'fridge_humming', x: 5, z: 5 }], needs: { hunger: 20 } });
    const a = agents[0];
    a.status.passedOut = true;
    expect(until(sim, () => a.active?.interactionId === 'fx_snack' || a.active?.interactionId === 'fx_dinner', 800)).toBeGreaterThanOrEqual(0);
    expect(a.status.passedOut).toBe(false);
  });

  it('the feralHunger moodlet goes away when a system clears status.feral (e.g. reanimation)', () => {
    const { sim, agents } = setup({ needs: { hunger: 3 } });
    const a = agents[0];
    sim.step();
    expect(a.status.feral).toBe(true);
    expect(sim.engine.ctx.hasMoodlet(a, 'feralHunger')).toBe(true);
    a.status.feral = false;
    a.needs.hunger = 80;
    sim.step();
    expect(sim.engine.ctx.hasMoodlet(a, 'feralHunger')).toBe(false);
  });
});

describe('hardening: queue', () => {
  it('a full queue still admits a higher-priority item (pass-out) by dropping its lowest entry; equal priority is refused', () => {
    const { sim, agents } = setup();
    const a = agents[0];
    const ctx = sim.engine.ctx;
    ctx.queue(a, { interactionId: 'engine_passOut', target: { kind: 'self' }, source: 'system', priority: 999 });
    sim.step(); // keep the agent busy so the queue stays put
    for (let i = 0; i < 12; i++) expect(ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'auto', params: { n: i } })).not.toBeNull();
    expect(a.queue).toHaveLength(12);
    expect(ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'auto' })).toBeNull();
    const crit = ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'system', priority: 400, params: { n: 'crit' } });
    expect(crit).not.toBeNull();
    expect(a.queue).toHaveLength(12);
    expect(a.queue[0].uid).toBe(crit!.uid);
    expect(a.queue.some((q) => q.params.n === 11)).toBe(false); // the newest lowest-priority item made room
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('player cancel follows interruptible, not hidden: a hidden system "Go to Work" is cancellable', () => {
    const work: ContentModule = {
      id: 'x',
      interactions: [
        { id: 'x_work', label: 'Go to Work', icon: 'work', targetKind: 'self', hidden: true, playerAllowed: false, autonomous: false, interruptible: true, stage: { target: { kind: 'exit' }, duration: 0.25, anim: 'wave' } },
      ],
    };
    const { sim, agents, objects } = setup({ extraContent: [work], objects: [{ defId: 'headstone_decor', x: 10, z: 6 }] });
    const a = agents[0];
    putAt(a, 10, 10);
    const qi = sim.engine.ctx.queue(a, { interactionId: 'x_work', target: { kind: 'self' }, source: 'system' })!;
    sim.step();
    expect(sim.queueView(a.id)[0]).toMatchObject({ label: 'Go to Work', cancellable: true });
    expect(sim.dispatch({ type: 'cancel', actorId: a.id, uid: qi.uid }).ok).toBe(true);
    expect(a.active).toBeNull();
    // an uninterruptible run still refuses once running
    const r = queue(sim, a, 'fx_ritual', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    expect(sim.queueView(a.id)[0].cancellable).toBe(false);
    expect(sim.dispatch({ type: 'cancel', actorId: a.id, uid: Number(r.id) })).toEqual({ ok: false, reason: "Can't stop now" });
  });
});

describe('hardening: socials vs. critical overrides', () => {
  it('chatting up a feral zombie never suspends its meal run nor floods its queue with stale copies', () => {
    const { sim, agents } = setup({
      members: ['A', 'B'],
      objects: [{ defId: 'fridge_humming', x: 5, z: 5 }, { defId: 'chair_creaky', x: 9, z: 9 }],
      needs: { hunger: 60 },
      funds: 500,
    });
    const [a, b] = agents;
    putAt(a, 14, 12);
    putAt(b, 10, 14);
    const ctx = sim.engine.ctx;
    // A sets off to chat BEFORE B turns feral (so the in-progress engage path is exercised too)
    ctx.queue(a, { interactionId: 'fx_chat', target: { kind: 'agent', id: b.id }, source: 'player' });
    sim.step();
    b.needs.hunger = 3;
    let maxQueue = 0;
    let firstFoodUid: number | null = null;
    let foodRunsStarted = 0;
    for (let i = 0; i < 400 && b.needs.hunger < 25; i++) {
      // a relentless social partner: keep ordering chats (system source bypasses the menu)
      if (i % 3 === 0 && !a.active) ctx.queue(a, { interactionId: 'fx_chat', target: { kind: 'agent', id: b.id }, source: 'system' });
      sim.step();
      maxQueue = Math.max(maxQueue, b.queue.length);
      const r = b.active;
      if (r && (r.interactionId === 'fx_snack' || r.interactionId === 'fx_dinner') && r.uid !== firstFoodUid) {
        firstFoodUid = r.uid;
        foodRunsStarted++;
      }
      expect(b.active?.interactionId).not.toBe('engine_respond');
    }
    expect(b.needs.hunger).toBeGreaterThanOrEqual(20); // B got to eat
    expect(foodRunsStarted).toBe(1); // one uninterrupted meal, never suspended by the chats
    expect(maxQueue).toBeLessThanOrEqual(1);
    // fed and done eating: chattable again
    until(sim, () => !b.status.feral && (!b.active || b.active.priority <= 300) && !a.active, 400);
    if (b.active) sim.engine.ctx.interrupt(b, 'test');
    until(sim, () => !b.active, 40);
    expect(sim.menu(a.id, { kind: 'agent', id: b.id }).find((e) => e.interactionId === 'fx_chat')?.reason ?? null).toBeNull();
    expect(sim.checkInvariants()).toEqual([]);
    expect(sim.faults()).toEqual([]);
  });

  it('a system-priority social never suspends a critical run of its target', () => {
    const { sim, agents } = setup({ members: ['A', 'B'], objects: [{ defId: 'mirror_cracked', x: 20, z: 6 }] });
    const [a, b] = agents;
    putAt(a, 10, 10);
    putAt(b, 19, 8);
    sim.engine.ctx.queue(b, { interactionId: 'fx_admire', target: { kind: 'object', id: Object.values(sim.state.objects)[0].id }, source: 'system', priority: 400 });
    until(sim, () => b.active?.phase === 'run');
    const uid = b.active!.uid;
    expect(queue(sim, a, 'fx_chat', { kind: 'agent', id: b.id })).toEqual({ ok: false, reason: 'B is busy' });
    sim.engine.ctx.queue(a, { interactionId: 'fx_chat', target: { kind: 'agent', id: b.id }, source: 'system' });
    steps(sim, 20);
    expect(b.active?.uid).toBe(uid);
    expect(b.queue).toEqual([]);
  });
});

describe('hardening: cancelling the hidden respond half', () => {
  it('the player cancelling "Listening to X" ends both sides cleanly and the target resumes its own order', () => {
    const { sim, agents, objects } = setup({ members: ['A', 'B'], objects: [{ defId: 'mirror_cracked', x: 20, z: 6 }] });
    const [a, b] = agents;
    putAt(a, 10, 10);
    putAt(b, 19, 8);
    queue(sim, b, 'fx_admire', { kind: 'object', id: objects[0].id });
    until(sim, () => b.active?.phase === 'run');
    queue(sim, a, 'fx_chat', { kind: 'agent', id: b.id });
    until(sim, () => a.active?.phase === 'run' && b.active?.interactionId === 'engine_respond', 2000);
    const view = sim.queueView(b.id)[0];
    expect(view).toMatchObject({ active: true, cancellable: true });
    expect(sim.dispatch({ type: 'cancel', actorId: b.id, uid: view.uid }).ok).toBe(true);
    sim.drainEvents();
    expect(until(sim, () => a.active?.interactionId !== 'fx_chat', 40)).toBeGreaterThanOrEqual(0);
    expect(sim.drainEvents().some((e) => e.type === 'interactionFailed')).toBe(false); // the actor just stops
    expect(until(sim, () => b.active?.interactionId === 'fx_admire', 400)).toBeGreaterThanOrEqual(0);
    expect(sim.checkInvariants()).toEqual([]);
    expect(sim.faults()).toEqual([]);
  });
});

describe('hardening: player-facing reasons', () => {
  it('spawnItem on a packed lot fails the run with a clear reason and records no fault', () => {
    const drop: ContentModule = {
      id: 'x',
      interactions: [
        {
          id: 'x_drop',
          label: 'Drop the Dish',
          icon: 'dish',
          targetKind: 'self',
          stage: { target: { kind: 'here' }, duration: 1, anim: 'idle', effectsOnComplete: [{ id: 'spawnItem', params: { defId: 'item_dish', at: 'actorFloor' } }] },
        },
      ],
    };
    const { sim, agents } = setup({ extraContent: [drop] });
    const a = agents[0];
    putAt(a, 10, 10);
    const sp = sim.engine.spatial as unknown as Record<string, unknown>;
    const keep = { nearestWalkable: sp.nearestWalkable, freeSurfaceNear: sp.freeSurfaceNear };
    sp.nearestWalkable = () => null;
    sp.freeSurfaceNear = () => null;
    try {
      expect(queue(sim, a, 'x_drop', { kind: 'self' }).ok).toBe(true);
      steps(sim, 8);
    } finally {
      Object.assign(sp, keep);
    }
    expect(a.active).toBeNull();
    expect(sim.state.notifications.at(-1)).toMatchObject({ kind: 'bad', title: "Mort couldn't drop the Dish", text: "There's no room to put the dirty dish down" });
    expect(sim.faults()).toEqual([]);
  });

  it('removeTarget tells everyone else using the item that it was used up', () => {
    const extra: ContentModule = {
      id: 'x',
      interactions: [
        { id: 'x_gobble', label: 'Gobble', icon: 'plate', targetKind: 'object', stage: { target: { kind: 'target' }, duration: 2, anim: 'standEat', effectsOnComplete: [{ id: 'removeTarget' }] } },
        { id: 'x_ogle', label: 'Ogle the Meal', icon: 'plate', targetKind: 'object', stage: { target: { kind: 'tileNear', radius: 2, of: 'target' }, duration: 60, anim: 'idle' } },
      ],
    };
    const { sim, agents } = setup({ members: ['A', 'B'], extraContent: [extra] });
    sim.content.objects.item_meal.interactions.push('x_gobble', 'x_ogle');
    const [a, b] = agents;
    putAt(a, 6, 9);
    putAt(b, 9, 6);
    const meal = sim.engine.ctx.spawnObject('item_meal', { kind: 'loose', x: 6.5, z: 6.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 });
    queue(sim, b, 'x_ogle', { kind: 'object', id: meal.id });
    until(sim, () => b.active?.phase === 'run');
    queue(sim, a, 'x_gobble', { kind: 'object', id: meal.id });
    until(sim, () => !a.active);
    expect(sim.state.objects[meal.id]).toBeUndefined();
    expect(b.active).toBeNull();
    expect(sim.state.notifications.some((n) => n.agentId === b.id && n.text === 'The meal was used up')).toBe(true);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('menus report a power cut for nearestTag actions whose every candidate needs power (no explicit stage.power)', () => {
    const raid: ContentModule = {
      id: 'x',
      interactions: [
        { id: 'x_raid', label: 'Raid the Fridge', icon: 'fridge', targetKind: 'self', stage: { target: { kind: 'nearestTag', tag: 'fridge', slots: ['front'] }, duration: 2, anim: 'pickup' } },
      ],
    };
    const { sim, agents } = setup({ extraContent: [raid], objects: [{ defId: 'fridge_humming', x: 5, z: 5 }] });
    const a = agents[0];
    const entry = () => sim.menu(a.id, { kind: 'self' }).find((e) => e.interactionId === 'x_raid');
    expect(entry()).toMatchObject({ available: true, reason: null });
    sim.state.household.utilitiesOn = false;
    expect(entry()).toMatchObject({ available: false, reason: 'The power is out' });
    expect(queue(sim, a, 'x_raid', { kind: 'self' })).toEqual({ ok: false, reason: 'The power is out' });
  });

  it('menus say an object is on fire instead of failing after the click', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'mirror_cracked', x: 6, z: 6 }] });
    objects[0].condition.burning = true;
    const e = sim.menu(agents[0].id, { kind: 'object', id: objects[0].id }).find((m) => m.interactionId === 'fx_admire');
    expect(e).toMatchObject({ available: false, reason: 'The cracked floor mirror is on fire!' });
    expect(queue(sim, agents[0], 'fx_admire', { kind: 'object', id: objects[0].id })).toEqual({ ok: false, reason: 'The cracked floor mirror is on fire!' });
  });
});

describe('hardening: repair', () => {
  it('re-adds a household-role agent missing from memberIds (idempotent), or demotes it when the household is full', () => {
    const { sim } = setup({ members: ['A', 'B'] });
    const reg = sim.engine.content;
    const s = JSON.parse(JSON.stringify(sim.serialize())) as WorldState;
    const lost = s.household.memberIds.pop()!;
    const w1 = repairWorld(s, reg);
    expect(s.household.memberIds).toContain(lost);
    expect(w1.some((w) => w.includes(lost))).toBe(true);
    expect(repairWorld(s, reg)).toEqual([]);
    const { sim: s2 } = fixtureSim(s, { registry: reg });
    s2.state.settings.autonomy = 'full';
    s2.state.agents[lost].needs.hunger = 10;
    steps(s2, 40);
    expect(s2.household().map((h) => h.id)).toContain(lost);
    expect(s2.menu(lost, { kind: 'self' }).length).toBeGreaterThan(0);
    // full household: the orphan becomes a townie instead of a 9th member
    const t = JSON.parse(JSON.stringify(sim.serialize())) as WorldState;
    const orphan = t.household.memberIds.pop()!;
    while (t.household.memberIds.length < 8) {
      const i = t.household.memberIds.length;
      const id = `a${900 + i}`;
      t.agents[id] = { ...JSON.parse(JSON.stringify(t.agents[orphan])), id, presence: 'offLot' };
      t.household.memberIds.push(id);
    }
    repairWorld(t, reg);
    expect(t.household.memberIds).toHaveLength(8);
    expect(t.agents[orphan].role).toBe('townie');
    expect(repairWorld(t, reg)).toEqual([]);
  });
});

describe('hardening: end() exactly once under chaos', () => {
  it('random interrupts, failRuns, removals, despawns and power flips never call end twice or skip it', () => {
    const { sim, agents, objects, counters } = setup({
      members: ['A', 'B', 'C'],
      objects: [
        { defId: 'mirror_cracked', x: 6, z: 6 },
        { defId: 'mirror_cracked', x: 12, z: 6 },
        { defId: 'mirror_cracked', x: 18, z: 6 },
      ],
    });
    const ctx = sim.engine.ctx;
    const r = createRng(seedRngState(777));
    let mirrors: ObjectState[] = objects.slice();
    for (let t = 0; t < 4000; t++) {
      const onLot = agents.filter((a) => a.presence === 'onLot');
      if (t % 7 === 0 && onLot.length) {
        const a = r.pick(onLot);
        const m = r.pick(mirrors);
        if (sim.state.objects[m.id]) ctx.queue(a, { interactionId: 'fx_admire', target: { kind: 'object', id: m.id }, source: r.pick(['player', 'auto', 'system'] as const) });
      }
      if (t % 13 === 0) {
        const roll = r.next();
        const busy = onLot.filter((a) => a.active);
        if (roll < 0.25 && busy.length) ctx.interrupt(r.pick(busy), 'chaos');
        else if (roll < 0.45 && busy.length) ctx.failRun(r.pick(busy), 'Chaos');
        else if (roll < 0.55) {
          const m = r.pick(mirrors);
          ctx.removeObject(m.id, 'The mirror was smashed');
          mirrors = mirrors.filter((x) => x.id !== m.id);
          mirrors.push(ctx.spawnObject('mirror_cracked', { kind: 'floor', x: r.int(3, 25), z: r.int(3, 22), rot: 0 }));
        } else if (roll < 0.65 && onLot.length) ctx.despawnAgent(r.pick(onLot).id, 'offLot');
        else if (roll < 0.75) for (const a of agents) if (a.presence !== 'onLot') ctx.spawnAgent(a.id);
        else if (roll < 0.85) sim.state.household.utilitiesOn = !sim.state.household.utilitiesOn;
        else if (busy.length) {
          const a = r.pick(busy);
          sim.dispatch({ type: 'cancel', actorId: a.id, uid: a.active!.uid });
        }
      }
      sim.step();
      if (t % 200 === 0) expect(sim.checkInvariants()).toEqual([]);
    }
    for (const a of agents) if (a.presence !== 'onLot') ctx.spawnAgent(a.id);
    until(sim, () => agents.every((a) => !a.active && a.queue.length === 0), 6000);
    expect(counters.begin.size).toBeGreaterThan(50);
    for (const [uid, n] of counters.begin) {
      expect(n).toBe(1);
      expect(counters.end.get(uid)).toBe(1);
    }
    for (const uid of counters.end.keys()) expect(counters.begin.has(uid)).toBe(true);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  }, 120000);
});
