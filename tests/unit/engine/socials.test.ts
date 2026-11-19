import { describe, expect, it } from 'vitest';
import type { ContentModule } from '../../../src/sim/contracts';
import { putAt, queue, setup, steps, until } from './helpers';

describe('socials', () => {
  it('actor walks over, target gets a hidden engine_respond, both face each other; target resumes afterwards', () => {
    const { sim, agents, objects } = setup({ members: ['A', 'B'], objects: [{ defId: 'mirror_cracked', x: 20, z: 6 }] });
    const [a, b] = agents;
    putAt(a, 4, 15);
    putAt(b, 19, 12);
    // B is busy admiring (player order) when A starts talking
    queue(sim, b, 'fx_admire', { kind: 'object', id: objects[0].id });
    const bUid = b.active!.uid;
    until(sim, () => b.active?.phase === 'run');
    expect(queue(sim, a, 'fx_chat', { kind: 'agent', id: b.id }).ok).toBe(true);
    until(sim, () => b.active?.interactionId === 'engine_respond');
    expect(b.active?.partnerId).toBe(a.id);
    expect(b.active?.source).toBe('system');
    // the interrupted admire is back at the front as a fresh copy
    expect(b.queue[0].interactionId).toBe('fx_admire');
    expect(b.queue[0].uid).not.toBe(bUid);
    until(sim, () => a.active?.phase === 'run');
    expect(a.active?.partnerId).toBe(b.id);
    expect(b.anim).toBe('listen');
    expect(a.anim).toBe('talk');
    const ab = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    expect(Math.abs(Math.atan2(Math.sin(a.facing - ab), Math.cos(a.facing - ab)))).toBeLessThan(0.01);
    const tile = (p: { x: number; z: number }) => [Math.floor(p.x), Math.floor(p.z)];
    const [ax, az] = tile(a.pos);
    const [bx, bz] = tile(b.pos);
    expect(Math.max(Math.abs(ax - bx), Math.abs(az - bz))).toBe(1);
    until(sim, () => !a.active);
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    expect(sim.state.relationships[key].met).toBe(true);
    expect(sim.state.relationships[key].interactions).toBe(1);
    until(sim, () => b.active?.interactionId === 'fx_admire');
    expect(sim.checkInvariants()).toEqual([]);
    expect(sim.faults()).toEqual([]);
  });

  it('fails with "X is busy" when the target is running an uninterruptible interaction', () => {
    const { sim, agents, objects } = setup({ members: ['A', 'B'], objects: [{ defId: 'headstone_decor', x: 10, z: 6 }] });
    const [a, b] = agents;
    putAt(a, 4, 15);
    putAt(b, 10, 8);
    queue(sim, b, 'fx_ritual', { kind: 'object', id: objects[0].id });
    until(sim, () => b.active?.phase === 'run');
    expect(queue(sim, a, 'fx_chat', { kind: 'agent', id: b.id })).toEqual({ ok: false, reason: 'B is busy' });
    expect(sim.menu(a.id, { kind: 'agent', id: b.id }).find((e) => e.interactionId === 'fx_chat')?.reason).toBe('B is busy');
  });

  it('waits up to 30 game minutes for a target that became busy, then gives up', () => {
    const long: ContentModule = {
      id: 'long',
      interactions: [
        { id: 'x_vigil', label: 'Night-long Vigil', icon: 'skull', targetKind: 'object', interruptible: false, stage: { target: { kind: 'target' }, duration: 120, anim: 'mourn' } },
      ],
    };
    const { sim, agents, objects } = setup({ members: ['A', 'B'], objects: [{ defId: 'headstone_decor', x: 10, z: 6 }], extraContent: [long] });
    sim.content.objects.headstone_decor.interactions.push('x_vigil');
    const [a, b] = agents;
    putAt(a, 2, 25);
    putAt(b, 10, 8);
    expect(queue(sim, a, 'fx_chat', { kind: 'agent', id: b.id }).ok).toBe(true);
    queue(sim, b, 'x_vigil', { kind: 'object', id: objects[0].id }); // 2h, uninterruptible
    until(sim, () => b.active?.phase === 'run');
    until(sim, () => a.active?.phase === 'wait', 2000);
    expect(a.active?.phase).toBe('wait');
    const t = until(sim, () => !a.active, 4 * 40);
    expect(t).toBeGreaterThan(4 * 25);
    expect(sim.state.notifications.filter((n) => n.agentId === a.id).at(-1)?.text).toBe("B didn't respond");
    expect(b.active?.interactionId).toBe('x_vigil');
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('target despawning mid-social ends the actor run cleanly ("B left")', () => {
    const { sim, agents } = setup({ members: ['A', 'B'] });
    const [a, b] = agents;
    putAt(a, 10, 10);
    putAt(b, 11, 10);
    queue(sim, a, 'fx_chat', { kind: 'agent', id: b.id });
    until(sim, () => a.active?.phase === 'run');
    sim.drainEvents();
    sim.engine.ctx.despawnAgent(b.id, 'atWork');
    expect(a.active).toBeNull();
    expect(b.active).toBeNull();
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'interactionFailed' && e.agentId === a.id && e.reason === 'B left')).toBe(true);
    steps(sim, 4);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('follows a moving target (re-routes) and still connects, suspending the walk', () => {
    const { sim, agents } = setup({ members: ['A', 'B'] });
    const [a, b] = agents;
    putAt(a, 20, 14);
    putAt(b, 4, 20);
    queue(sim, b, 'engine_goHere', { kind: 'tile', x: 27, z: 20 });
    queue(sim, a, 'fx_chat', { kind: 'agent', id: b.id });
    until(sim, () => a.active?.phase === 'run', 3000);
    expect(a.active?.interactionId).toBe('fx_chat');
    expect(b.active?.interactionId).toBe('engine_respond');
    expect(Number(a.active?.data._rr ?? 0)).toBeLessThanOrEqual(4);
    // the walk B was doing is resumed afterwards
    expect(b.queue.some((q) => q.interactionId === 'engine_goHere')).toBe(true);
    until(sim, () => b.active?.interactionId === 'engine_goHere', 400);
    until(sim, () => !b.active, 2000);
    expect(Math.floor(b.pos.x)).toBe(27);
  });

  it('A and B starting chats with each other at once does not deadlock', () => {
    const { sim, agents } = setup({ members: ['A', 'B'] });
    const [a, b] = agents;
    putAt(a, 8, 10);
    putAt(b, 14, 10);
    queue(sim, a, 'fx_chat', { kind: 'agent', id: b.id });
    queue(sim, b, 'fx_chat', { kind: 'agent', id: a.id });
    let runs = 0;
    for (let i = 0; i < 1200; i++) {
      sim.step();
      if (a.active?.interactionId === 'fx_chat' && a.active.phase === 'run') runs |= 1;
      if (b.active?.interactionId === 'fx_chat' && b.active.phase === 'run') runs |= 2;
      expect(sim.checkInvariants()).toEqual([]);
    }
    expect(runs).toBe(3); // both chats eventually happened
    expect(a.active === null || a.active.interactionId !== 'engine_respond' || a.active.partnerId === b.id).toBe(true);
  });
});

describe('non-adjacent socials (decision #12)', () => {
  it('a tileNear social runs without engine_respond and ignores target busy-ness', () => {
    const wave: ContentModule = {
      id: 'wave',
      interactions: [
        {
          id: 'x_waveAt',
          label: 'Wave at {target}',
          group: 'Friendly',
          icon: 'wave',
          targetKind: 'agent',
          behavior: 'fx_social',
          social: { baseChance: 1, friendship: [2, 0], social: 4, targetAnim: 'wave', voice: 'happy' },
          stage: { target: { kind: 'tileNear', radius: 4, of: 'target' }, duration: 2, anim: 'wave' },
        },
      ],
    };
    const { sim, agents, objects } = setup({ members: ['A', 'B'], extraContent: [wave], objects: [{ defId: 'headstone_decor', x: 20, z: 6 }] });
    const [a, b] = agents;
    putAt(a, 10, 14);
    putAt(b, 20, 8);
    queue(sim, b, 'fx_ritual', { kind: 'object', id: objects[0].id });
    until(sim, () => b.active?.phase === 'run');
    expect(sim.menu(a.id, { kind: 'agent', id: b.id }).find((e) => e.interactionId === 'x_waveAt')?.available).toBe(true);
    expect(queue(sim, a, 'x_waveAt', { kind: 'agent', id: b.id }).ok).toBe(true);
    until(sim, () => a.active?.phase === 'run', 2000);
    expect(a.active?.interactionId).toBe('x_waveAt');
    expect(b.active?.interactionId).toBe('fx_ritual'); // never interrupted
    until(sim, () => !a.active);
    expect(sim.checkInvariants()).toEqual([]);
  });
});

describe('pairs', () => {
  it('embalm other: partner queued at system priority with partnerOf, both start together, either ending ends both', () => {
    const { sim, agents, objects } = setup({ members: ['A', 'B'], objects: [{ defId: 'station_embalming', x: 10, z: 8 }] });
    const [a, b] = agents;
    putAt(a, 6, 14);
    putAt(b, 16, 14);
    b.needs.preservation = 40;
    const r = queue(sim, a, 'fx_embalmOther', { kind: 'agent', id: b.id });
    expect(r.ok).toBe(true);
    expect(b.active?.interactionId).toBe('fx_beEmbalmed');
    expect(b.active?.params.partnerOf).toBe(a.id);
    expect(b.active?.priority).toBe(300);
    expect(a.active?.partnerId).toBe(b.id);
    expect(b.active?.partnerId).toBe(a.id);
    const slab = objects[0];
    expect(Object.values(slab.reservedBy).sort()).toEqual([a.id, b.id].sort());
    let startA = -1;
    let startB = -1;
    for (let i = 0; i < 2000 && (startA < 0 || startB < 0); i++) {
      sim.step();
      if (startA < 0 && a.active?.phase === 'run') startA = sim.state.tick;
      if (startB < 0 && b.active?.phase === 'run') startB = sim.state.tick;
    }
    expect(startA).toBeGreaterThan(0);
    expect(startA).toBe(startB);
    expect(b.anim).toBe('beEmbalmed');
    expect(b.posY).toBeGreaterThan(0.5);
    steps(sim, 20);
    expect(b.needs.preservation).toBeGreaterThan(40);
    // cancelling the actor ends the partner too
    sim.dispatch({ type: 'cancel', actorId: a.id, uid: a.active!.uid });
    until(sim, () => !a.active);
    expect(b.active).toBeNull();
    expect(b.posY).toBe(0);
    expect(slab.reservedBy).toEqual({});
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a busy partner fails the pair up front', () => {
    const { sim, agents, objects } = setup({
      members: ['A', 'B'],
      objects: [
        { defId: 'station_embalming', x: 10, z: 8 },
        { defId: 'headstone_decor', x: 20, z: 8 },
      ],
    });
    const [a, b] = agents;
    putAt(b, 20, 10);
    queue(sim, b, 'fx_ritual', { kind: 'object', id: objects[1].id });
    until(sim, () => b.active?.phase === 'run');
    expect(queue(sim, a, 'fx_embalmOther', { kind: 'agent', id: b.id })).toEqual({ ok: false, reason: 'B is busy' });
  });

  it('partner leaving mid-pair ends the actor run', () => {
    const { sim, agents } = setup({ members: ['A', 'B'], objects: [{ defId: 'station_embalming', x: 10, z: 8 }] });
    const [a, b] = agents;
    queue(sim, a, 'fx_embalmOther', { kind: 'agent', id: b.id });
    until(sim, () => a.active?.phase === 'run', 3000);
    sim.engine.ctx.despawnAgent(b.id, 'offLot');
    expect(a.active).toBeNull();
    steps(sim, 2);
    expect(sim.checkInvariants()).toEqual([]);
  });
});
