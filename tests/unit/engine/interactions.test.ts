import { describe, expect, it } from 'vitest';
import type { ContentModule } from '../../../src/sim/contracts';
import { putAt, queue, setup, steps, until } from './helpers';

const fridgeAt = { defId: 'fridge_humming', x: 5, z: 5 };

describe('interaction lifecycle', () => {
  it('routes to the slot, snaps to the pose, runs and completes (player snack)', () => {
    const { sim, agents, objects } = setup({ objects: [fridgeAt], needs: { hunger: 40 } });
    const a = agents[0];
    putAt(a, 5, 12);
    const r = queue(sim, a, 'fx_snack', { kind: 'object', id: objects[0].id });
    expect(r.ok).toBe(true);
    expect(a.active?.phase).toBe('route');
    expect(objects[0].reservedBy['0']).toBe(a.id);
    expect(until(sim, () => a.active?.phase === 'run')).toBeGreaterThan(0);
    expect(a.pos.x).toBeCloseTo(5.5);
    expect(a.pos.z).toBeCloseTo(6.3);
    expect(a.facing).toBeCloseTo(Math.PI);
    expect(a.anim).toBe('standEat');
    expect(objects[0].inUseBy).toContain(a.id);
    until(sim, () => !a.active);
    expect(a.needs.hunger).toBeGreaterThan(65);
    expect(objects[0].reservedBy).toEqual({});
    expect(objects[0].inUseBy).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
    expect(sim.faults()).toEqual([]);
  });

  it('object removed mid-route: fails with a clear reason, notifies the player, releases everything', () => {
    const { sim, agents, objects } = setup({ objects: [fridgeAt] });
    const a = agents[0];
    putAt(a, 5, 20);
    queue(sim, a, 'fx_snack', { kind: 'object', id: objects[0].id });
    steps(sim, 4);
    expect(a.active?.phase).toBe('route');
    sim.drainEvents();
    sim.engine.ctx.removeObject(objects[0].id);
    expect(a.active).toBeNull();
    expect(a.path).toBeNull();
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'interactionFailed' && e.agentId === a.id && /gone/.test(e.reason))).toBe(true);
    expect(sim.state.notifications.some((n) => n.kind === 'bad' && n.title === "Mort couldn't grab a Snack" && /humming fridge is gone/.test(n.text))).toBe(true);
    steps(sim, 10);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('object removed mid-run: the seat and the watched TV are both released', () => {
    const { sim, agents, objects } = setup({
      objects: [
        { defId: 'tv_crt', x: 10, z: 10, rot: 0 },
        { defId: 'chair_creaky', x: 10, z: 13, rot: 2 },
      ],
    });
    const a = agents[0];
    putAt(a, 15, 15);
    const [tv, chair] = objects;
    queue(sim, a, 'fx_watchTv', { kind: 'object', id: tv.id });
    until(sim, () => a.active?.phase === 'run');
    expect(a.active?.stageTarget).toEqual({ kind: 'object', id: chair.id });
    expect(chair.reservedBy['0']).toBe(a.id);
    expect(tv.inUseBy).toContain(a.id);
    expect(chair.inUseBy).toContain(a.id);
    expect(a.anim).toBe('sitTV');
    sim.engine.ctx.removeObject(tv.id);
    expect(a.active).toBeNull();
    expect(chair.reservedBy).toEqual({});
    expect(chair.inUseBy).toEqual([]);
    expect(a.posY).toBe(0);
    steps(sim, 4);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('two agents contend for a single-slot object: exactly one gets it', () => {
    const { sim, agents, objects } = setup({ members: ['A', 'B'], objects: [{ defId: 'shower_drizzle', x: 8, z: 8 }] });
    const [a, b] = agents;
    putAt(a, 8, 14);
    putAt(b, 9, 14);
    const shower = objects[0];
    expect(queue(sim, a, 'fx_shower', { kind: 'object', id: shower.id }).ok).toBe(true);
    const rb = queue(sim, b, 'fx_shower', { kind: 'object', id: shower.id });
    expect(rb).toEqual({ ok: false, reason: 'In use' });
    // a system-queued attempt fails at stage resolution instead
    sim.engine.ctx.queue(b, { interactionId: 'fx_shower', target: { kind: 'object', id: shower.id }, source: 'system' });
    sim.step();
    expect(b.active).toBeNull();
    expect(Object.values(shower.reservedBy)).toEqual([a.id]);
    a.needs.hygiene = 20;
    until(sim, () => !a.active);
    expect(a.needs.hygiene).toBeGreaterThanOrEqual(98);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('cancel semantics per phase: queued removed, route immediate, run graceful exit; uninterruptible refuses', () => {
    const { sim, agents, objects, counters } = setup({
      objects: [
        { defId: 'mirror_cracked', x: 6, z: 6 },
        { defId: 'headstone_decor', x: 20, z: 6 },
      ],
    });
    const a = agents[0];
    putAt(a, 6, 15);
    const [mirror, stone] = objects;
    const r1 = queue(sim, a, 'fx_admire', { kind: 'object', id: mirror.id });
    const r2 = queue(sim, a, 'fx_admire', { kind: 'object', id: mirror.id });
    expect(a.queue).toHaveLength(1);
    expect(sim.dispatch({ type: 'cancel', actorId: a.id, uid: Number(r2.id) }).ok).toBe(true);
    expect(a.queue).toHaveLength(0);
    // route-phase cancel ends immediately
    expect(a.active?.phase).toBe('route');
    expect(sim.dispatch({ type: 'cancel', actorId: a.id, uid: Number(r1.id) }).ok).toBe(true);
    expect(a.active).toBeNull();
    expect(counters.end.get(Number(r1.id))).toBe(1);
    // run-phase cancel -> exit phase then end
    const r3 = queue(sim, a, 'fx_admire', { kind: 'object', id: mirror.id });
    until(sim, () => a.active?.phase === 'run');
    expect(sim.dispatch({ type: 'cancel', actorId: a.id, uid: Number(r3.id) }).ok).toBe(true);
    expect(a.active?.phase).toBe('exit');
    expect(counters.end.get(Number(r3.id))).toBeUndefined();
    steps(sim, 6);
    expect(a.active).toBeNull();
    expect(counters.end.get(Number(r3.id))).toBe(1);
    expect(counters.outcomes).toEqual(['canceled', 'canceled']);
    // uninterruptible ritual: cancellable while walking, not while running
    const r4 = queue(sim, a, 'fx_ritual', { kind: 'object', id: stone.id });
    until(sim, () => a.active?.phase === 'run');
    expect(sim.dispatch({ type: 'cancel', actorId: a.id, uid: Number(r4.id) })).toEqual({ ok: false, reason: "Can't stop now" });
    expect(a.active?.phase).toBe('run');
    expect(sim.queueView(a.id)[0].cancellable).toBe(false);
    expect(sim.dispatch({ type: 'cancel', actorId: a.id, uid: 123456 }).ok).toBe(false);
  });

  it('behaviour.end is called exactly once on every exit path', () => {
    const boom: ContentModule = {
      id: 'boom',
      interactions: [
        {
          id: 'x_admireBoom',
          label: 'Admire (cursed)',
          icon: 'mirror',
          targetKind: 'object',
          behavior: 'fx_counter',
          stage: { target: { kind: 'target' }, duration: 20, anim: 'admire', effectsOnStart: [{ id: 'x_boom' }] },
        },
      ],
      objects: [],
    };
    const { sim, agents, objects, counters } = setup({
      members: ['A', 'B'],
      objects: [{ defId: 'mirror_cracked', x: 6, z: 6 }],
      extraContent: [boom],
      extraSystems: [{ id: 'xb', effects: { x_boom: () => { throw new Error('mirror cracked further'); } } }],
    });
    // make the cursed interaction available on the mirror
    sim.content.objects.mirror_cracked.interactions.push('x_admireBoom');
    const [a, b] = agents;
    const mirror = objects[0];
    const uids: number[] = [];
    const go = (id = 'fx_admire', who = a) => {
      const r = queue(sim, who, id, { kind: 'object', id: mirror.id });
      expect(r.ok).toBe(true);
      uids.push(Number(r.id));
      return Number(r.id);
    };
    putAt(a, 6, 10);
    go(); // 1) complete
    until(sim, () => !a.active);
    const u2 = go(); // 2) cancel in route
    sim.dispatch({ type: 'cancel', actorId: a.id, uid: u2 });
    const u3 = go(); // 3) cancel in run
    until(sim, () => a.active?.phase === 'run');
    sim.dispatch({ type: 'cancel', actorId: a.id, uid: u3 });
    until(sim, () => !a.active);
    go(); // 4) despawn mid-run
    until(sim, () => a.active?.phase === 'run');
    sim.engine.ctx.despawnAgent(a.id, 'offLot');
    sim.engine.ctx.spawnAgent(a.id, { x: 6.5, z: 10.5 });
    putAt(b, 7, 10);
    go('fx_admire', b); // 5) object removed mid-run
    until(sim, () => b.active?.phase === 'run');
    sim.engine.ctx.removeObject(mirror.id);
    const mirror2 = sim.engine.ctx.spawnObject('mirror_cracked', { kind: 'floor', x: 6, z: 6, rot: 0 });
    const r6 = queue(sim, b, 'x_admireBoom', { kind: 'object', id: mirror2.id }); // 6) effect throws at stage start
    uids.push(Number(r6.id));
    until(sim, () => !b.active, 400);
    for (const u of uids) expect(counters.end.get(u)).toBe(1);
    for (const u of uids) expect(counters.begin.get(u)).toBe(1);
    expect(counters.outcomes).toEqual(['complete', 'canceled', 'canceled', 'canceled', 'failed', 'failed']);
    expect(sim.faults().some((f) => f.where === 'effect:x_boom')).toBe(true);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a power cut mid-run ends powered stages with "The power is out"', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'tv_crt', x: 10, z: 10 }] });
    const a = agents[0];
    putAt(a, 12, 16);
    queue(sim, a, 'fx_watchTv', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    expect(a.active?.slot).toBe(0); // no chair -> fallback watch slot
    sim.state.household.utilitiesOn = false;
    sim.step();
    expect(a.active).toBeNull();
    expect(sim.state.notifications.at(-1)?.text).toBe('The power is out');
    // and it can't be ordered while the power is out
    expect(queue(sim, a, 'fx_watchTv', { kind: 'object', id: objects[0].id })).toEqual({ ok: false, reason: 'The power is out' });
  });

  it('orders the queue by priority then FIFO; front:true jumps its own priority class only', () => {
    const { sim, agents } = setup();
    const a = agents[0];
    const ctx = sim.engine.ctx;
    sim.engine.ctx.despawnAgent(a.id, 'offLot');
    expect(ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'player' })).toBeNull(); // off-lot
    ctx.spawnAgent(a.id, { x: 10.5, z: 10.5 });
    // keep the agent busy so nothing is dequeued while we build the queue
    ctx.queue(a, { interactionId: 'engine_passOut', target: { kind: 'self' }, source: 'system', priority: 999 });
    sim.step();
    expect(a.active?.interactionId).toBe('engine_passOut');
    const p1 = ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'player', params: { n: 1 } })!;
    const auto = ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'auto', params: { n: 2 } })!;
    const sys = ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'system', params: { n: 3 } })!;
    const p2 = ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'player', params: { n: 4 } })!;
    const pFront = ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'player', params: { n: 5 }, front: true })!;
    const custom = ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'auto', priority: 250, params: { n: 6 } })!;
    expect(a.queue.map((q) => q.uid)).toEqual([sys.uid, custom.uid, pFront.uid, p1.uid, p2.uid, auto.uid]);
    expect([p1, auto, sys].map((q) => q.priority)).toEqual([200, 100, 300]);
    // uids are unique and monotonic
    const uids = a.queue.map((q) => q.uid);
    expect(new Set(uids).size).toBe(uids.length);
    // bad targets are rejected without throwing
    expect(ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'tile', x: Number.NaN, z: 1 }, source: 'player' })).toBeNull();
    expect(ctx.queue(a, { interactionId: 'fx_phone', target: null as never, source: 'player' })).toBeNull();
  });

  it('enforces the 8-item player queue and rejects unknown interactions', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'mirror_cracked', x: 6, z: 6 }] });
    const a = agents[0];
    for (let i = 0; i < 8; i++) expect(queue(sim, a, 'fx_admire', { kind: 'object', id: objects[0].id }).ok).toBe(true);
    expect(queue(sim, a, 'fx_admire', { kind: 'object', id: objects[0].id })).toEqual({ ok: false, reason: 'Queue is full' });
    expect(queue(sim, a, 'no_such_thing', { kind: 'self' })).toEqual({ ok: false, reason: 'Unknown action' });
    expect(sim.engine.ctx.queue(a, { interactionId: 'no_such_thing', target: { kind: 'self' }, source: 'system' })).toBeNull();
    expect(sim.faults().some((f) => f.message.includes('no_such_thing'))).toBe(true);
  });

  it('charges def.cost once at the first stage start and fails with "Can\'t afford" otherwise', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'desk_hauntedpc', x: 6, z: 6 }], funds: 100 });
    const a = agents[0];
    putAt(a, 6, 12);
    const desk = objects[0];
    expect(queue(sim, a, 'fx_luxury', { kind: 'object', id: desk.id })).toEqual({ ok: false, reason: "Can't afford ($5000)" });
    sim.state.household.funds = 6000;
    expect(queue(sim, a, 'fx_luxury', { kind: 'object', id: desk.id }).ok).toBe(true);
    expect(sim.state.household.funds).toBe(6000); // not yet: charged when the run starts
    until(sim, () => a.active?.phase === 'run');
    expect(sim.state.household.funds).toBe(1000);
    until(sim, () => !a.active);
    expect(sim.state.household.funds).toBe(1000);
    // money vanished between queueing and the run -> Can't afford
    expect(queue(sim, a, 'fx_luxury', { kind: 'object', id: desk.id })).toEqual({ ok: false, reason: "Can't afford ($5000)" });
    sim.state.household.funds = 5000;
    putAt(a, 6, 20); // far enough that the run starts later
    queue(sim, a, 'fx_luxury', { kind: 'object', id: desk.id });
    expect(a.active?.phase).toBe('route');
    sim.state.household.funds = 10;
    until(sim, () => !a.active);
    expect(sim.state.household.funds).toBe(10);
    expect(sim.state.notifications.at(-1)?.text).toBe("Can't afford");
  });

  it('multi-stage dinner: fridge then the seat at a table; moodlet on completion', () => {
    const { sim, agents, objects } = setup({
      needs: { hunger: 30 },
      objects: [
        fridgeAt,
        { defId: 'chair_creaky', x: 7, z: 10, rot: 0 }, // faces +Z, nothing in front
        { defId: 'chair_creaky', x: 12, z: 10, rot: 0 }, // faces +Z towards the table
        { defId: 'table_rickety', x: 12, z: 11 },
      ],
      funds: 100,
    });
    const a = agents[0];
    putAt(a, 5, 9);
    const [fridge, , tableChair] = objects;
    queue(sim, a, 'fx_dinner', { kind: 'object', id: fridge.id });
    until(sim, () => a.active?.stage === 1);
    expect(sim.state.household.funds).toBe(88);
    expect(a.active?.stageTarget).toEqual({ kind: 'object', id: tableChair.id });
    until(sim, () => a.active?.phase === 'run');
    expect(a.anim).toBe('sitEat');
    expect(a.carrying).toBe('plate');
    until(sim, () => !a.active);
    expect(sim.engine.ctx.hasMoodlet(a, 'fx_happy')).toBe(true);
    expect(a.carrying).toBeNull();
    expect(a.posY).toBe(0);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('seat with facingTarget only picks chairs facing the TV; tileNear dancers spread out and get a group bonus', () => {
    const { sim, agents, objects } = setup({
      members: ['A', 'B', 'C'],
      objects: [
        { defId: 'tv_crt', x: 10, z: 10, rot: 0 },
        { defId: 'chair_creaky', x: 12, z: 13, rot: 0 }, // faces away
        { defId: 'chair_creaky', x: 10, z: 13, rot: 2 }, // faces the TV
        { defId: 'stereo_boombox', x: 20, z: 8 },
      ],
      needs: { fun: 10 },
    });
    const [a, b, c] = agents;
    const [tv, , facing, stereo] = objects;
    putAt(a, 14, 16);
    queue(sim, a, 'fx_watchTv', { kind: 'object', id: tv.id });
    expect(a.active?.stageTarget).toEqual({ kind: 'object', id: facing.id });
    putAt(b, 20, 14);
    putAt(c, 21, 14);
    queue(sim, b, 'fx_dance', { kind: 'object', id: stereo.id });
    queue(sim, c, 'fx_dance', { kind: 'object', id: stereo.id });
    expect(b.active?.routeGoal).not.toEqual(c.active?.routeGoal);
    until(sim, () => b.active?.phase === 'run' && c.active?.phase === 'run');
    const before = b.needs.fun;
    steps(sim, 40); // 10 minutes together
    const together = b.needs.fun - before;
    sim.engine.ctx.interrupt(c, 'stop');
    steps(sim, 8);
    const b2 = b.needs.fun;
    steps(sim, 40);
    const solo = b.needs.fun - b2;
    expect(together).toBeGreaterThan(solo + 0.1);
    expect(stereo.inUseBy).toContain(b.id);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('stopWhen thresholds are capped by the need cap (preservation <= vitality)', () => {
    const soak: ContentModule = {
      id: 'soak',
      interactions: [
        {
          id: 'x_soak',
          label: 'Soak',
          icon: 'ice',
          targetKind: 'self',
          stage: { target: { kind: 'here' }, duration: 1e9, anim: 'bath', needsPerHour: { preservation: 120 }, stopWhen: { need: 'preservation', atLeast: 100 } },
        },
      ],
    };
    const { sim, agents } = setup({ extraContent: [soak] });
    const a = agents[0];
    a.vitality = 60;
    a.needs.preservation = 30;
    expect(queue(sim, a, 'x_soak', { kind: 'self' }).ok).toBe(true);
    const t = until(sim, () => !a.active, 2000);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(240);
    expect(a.needs.preservation).toBe(60);
  });

  it('a throwing behaviour is contained: fault logged, run aborted, the world keeps ticking', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'arcade_tombstone', x: 6, z: 6 }] });
    const a = agents[0];
    putAt(a, 6, 9);
    queue(sim, a, 'fx_throwy', { kind: 'object', id: objects[0].id });
    until(sim, () => !a.active, 400);
    expect(sim.faults().some((f) => f.where === 'behavior:fx_throws.tick')).toBe(true);
    expect(objects[0].reservedBy).toEqual({});
    expect(objects[0].inUseBy).toEqual([]);
    expect(sim.state.notifications.at(-1)?.text).toBe('Something went wrong');
    steps(sim, 100);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('player orders preempt autonomous runs; system items suspend player runs and re-queue them', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'chair_creaky', x: 8, z: 8 }, { defId: 'mirror_cracked', x: 12, z: 8 }] });
    const a = agents[0];
    putAt(a, 8, 12);
    const [chair, mirror] = objects;
    sim.engine.ctx.queue(a, { interactionId: 'fx_sit', target: { kind: 'object', id: chair.id }, source: 'auto' });
    until(sim, () => a.active?.phase === 'run');
    queue(sim, a, 'fx_admire', { kind: 'object', id: mirror.id });
    expect(a.active?.phase).toBe('exit');
    until(sim, () => a.active?.interactionId === 'fx_admire');
    expect(a.queue.some((q) => q.interactionId === 'fx_sit')).toBe(false); // auto runs are not re-queued
    until(sim, () => a.active?.phase === 'run');
    const playerUid = a.active!.uid;
    sim.engine.ctx.queue(a, { interactionId: 'fx_phone', target: { kind: 'self' }, source: 'system' });
    sim.step();
    expect(a.active?.phase).toBe('exit');
    const requeued = a.queue.find((q) => q.interactionId === 'fx_admire');
    expect(requeued).toBeDefined();
    expect(requeued!.uid).not.toBe(playerUid);
    expect(requeued!.params._origUid).toBe(playerUid);
    until(sim, () => a.active?.interactionId === 'fx_phone');
    until(sim, () => a.active?.interactionId === 'fx_admire');
  });

  it('Go Here walks to the tile (or the nearest walkable one) and repaths around new obstacles', () => {
    const { sim, agents } = setup();
    const a = agents[0];
    putAt(a, 3, 20);
    expect(queue(sim, a, 'engine_goHere', { kind: 'tile', x: 25, z: 20 }).ok).toBe(true);
    steps(sim, 8);
    // drop a sofa across the path
    sim.engine.ctx.spawnObject('sofa_velvet' in sim.content.objects ? 'sofa_velvet' : 'table_rickety', { kind: 'floor', x: 10, z: 20, rot: 0 });
    sim.engine.ctx.spawnObject('table_rickety', { kind: 'floor', x: 11, z: 20, rot: 0 });
    sim.engine.ctx.spawnObject('table_rickety', { kind: 'floor', x: 12, z: 20, rot: 0 });
    until(sim, () => !a.active, 2000);
    expect(Math.floor(a.pos.x)).toBe(25);
    expect(Math.floor(a.pos.z)).toBe(20);
    // blocked destination -> nearest walkable
    sim.engine.ctx.spawnObject('table_rickety', { kind: 'floor', x: 5, z: 5, rot: 0 });
    queue(sim, a, 'engine_goHere', { kind: 'tile', x: 5, z: 5 });
    until(sim, () => !a.active, 2000);
    expect(Math.hypot(a.pos.x - 5.5, a.pos.z - 5.5)).toBeLessThan(1.6);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('unreachable targets fail with a reason instead of hanging', () => {
    const { sim, agents, objects } = setup({ objects: [fridgeAt] });
    const a = agents[0];
    putAt(a, 15, 20);
    const w = sim.state.lot.walls;
    for (let x = 3; x <= 7; x++) {
      w[`h:${x}:3`] = { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: null };
      w[`h:${x}:8`] = { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: null };
    }
    for (let z = 3; z <= 7; z++) {
      w[`v:3:${z}`] = { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: null };
      w[`v:8:${z}`] = { paint: ['wall_plaster_bone', 'wall_plaster_bone'], openingId: null };
    }
    sim.state.lot.version++;
    sim.engine.spatial.invalidate();
    const r = queue(sim, a, 'fx_snack', { kind: 'object', id: objects[0].id });
    expect(r.ok).toBe(true);
    expect(a.active).toBeNull();
    expect(sim.state.notifications.at(-1)?.text).toBe("Can't reach the humming fridge");
  });
});
