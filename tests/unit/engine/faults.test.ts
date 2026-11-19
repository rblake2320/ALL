import { describe, expect, it } from 'vitest';
import type { SimSystem } from '../../../src/sim/contracts';
import type { AgentState } from '../../../src/sim/types';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { putAt, queue, setup, steps, until } from './helpers';

describe('fault barriers', () => {
  it('a system whose hooks keep throwing is disabled after 50 failures, with a notification', () => {
    let calls = 0;
    const bad: SimSystem = {
      id: 'gremlin',
      tick: () => {
        calls++;
        throw new Error('gremlins in the ledger');
      },
      api: { ping: () => 'pong' },
    };
    const { sim } = setup({ extraSystems: [bad] });
    steps(sim, 120);
    expect(calls).toBe(50);
    expect(sim.engine.systems.find((s) => s.sys.id === 'gremlin')?.disabled).toBe(true);
    expect(sim.state.notifications.some((n) => n.title === 'Something in town stopped working' && n.text.includes('gremlin'))).toBe(true);
    // its api stays reachable
    expect(sim.engine.ctx.sys('gremlin').ping()).toBe('pong');
    expect(sim.faults().filter((f) => f.where === 'system:gremlin.tick')).toHaveLength(50);
  });

  it('dayStart then hour fire once per boundary crossing; throwing hooks are contained', () => {
    const log: string[] = [];
    const sys: SimSystem = {
      id: 'clock',
      hour: (ctx, h) => {
        log.push(`h${h}@${ctx.time.day}`);
        if (h === 13) throw new Error('lunch break');
      },
      dayStart: (_ctx, d) => void log.push(`d${d}`),
    };
    const { sim } = setup({ extraSystems: [sys] });
    steps(sim, TICKS_PER_DAY);
    expect(log.filter((x) => x.startsWith('h'))).toHaveLength(24);
    const mid = log.indexOf('d2');
    expect(mid).toBeGreaterThan(0);
    expect(log[mid + 1]).toBe('h0@2');
    expect(log[0]).toBe('h10@1');
    expect(sim.faults().some((f) => f.where === 'system:clock.hour')).toBe(true);
  });

  it('corrupted agents self-heal or fault alone; other agents keep living; step() never throws', () => {
    const { sim, agents, objects } = setup({ members: ['A', 'B', 'C'], objects: [{ defId: 'mirror_cracked', x: 8, z: 8 }, { defId: 'chair_creaky', x: 14, z: 8 }] });
    const [a, b, c] = agents;
    putAt(a, 14, 12);
    putAt(b, 8, 12);
    queue(sim, a, 'fx_sit', { kind: 'object', id: objects[1].id });
    queue(sim, b, 'fx_admire', { kind: 'object', id: objects[0].id });
    sim.step();
    // healable corruption
    (c as unknown as { status: unknown }).status = null;
    (c as unknown as { pos: unknown }).pos = { x: Number.NaN, z: 3 };
    (c as unknown as { queue: unknown }).queue = 'oops';
    // unhealable corruption of a live run -> that run is aborted (fault logged), the agent recovers
    (a.active as unknown as { target: unknown }).target = null;
    expect(() => steps(sim, 400)).not.toThrow();
    expect(sim.faults().some((f) => f.where === `agent:${a.id}` || f.where === `finish:${a.id}`)).toBe(true);
    expect(sim.faults().length).toBeLessThanOrEqual(200);
    expect(a.active === null || a.active.target !== null).toBe(true);
    expect(objects[1].reservedBy).toEqual({});
    expect(Number.isFinite(c.pos.x)).toBe(true);
    expect(c.status.autonomyFails).toBe(0);
    expect(b.skills.charisma.xp + b.skills.charisma.level).toBeGreaterThan(0);
    expect(sim.checkInvariants()).toEqual([]);
    // a fault storm never grows the ring past 200
    for (let i = 0; i < 500; i++) sim.engine.ctx.runEffect({ id: 'nope' }, { actor: null, run: null, def: null, stage: null, targetAgent: null, targetObject: null });
    expect(sim.faults()).toHaveLength(200);
  });

  it('a throwing spatial query degrades gracefully (agents idle, faults logged)', () => {
    const { sim, agents, objects } = setup({ autonomy: 'full', needs: { hunger: 20 }, objects: [{ defId: 'fridge_humming', x: 5, z: 5 }] });
    (sim.engine.spatial as { distanceField: unknown }).distanceField = () => {
      throw new Error('pathfinder melted');
    };
    putAt(agents[0], 5, 15);
    expect(() => steps(sim, 200)).not.toThrow();
    expect(sim.faults().some((f) => f.where === 'spatial.distanceField')).toBe(true);
    const r = queue(sim, agents[0], 'fx_snack', { kind: 'object', id: objects[0].id });
    expect(r.ok).toBe(true); // accepted, then fails cleanly at stage resolution
    steps(sim, 2);
    expect(agents[0].active?.interactionId ?? null).not.toBe('fx_snack');
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('throwing moodModifiers / autonomyCandidates / agentArrived hooks are contained', () => {
    const sys: SimSystem = {
      id: 'chaos',
      moodModifiers: () => {
        throw new Error('mood');
      },
      autonomyCandidates: () => {
        throw new Error('auto');
      },
      agentArrived: () => {
        throw new Error('hello');
      },
    };
    const { sim, agents } = setup({ autonomy: 'full', extraSystems: [sys], needs: { fun: 10 } });
    expect(() => steps(sim, 100)).not.toThrow();
    expect(sim.mood(agents[0].id).value).toBeTypeOf('number');
    const t = sim.engine.ctx.createAgent({ role: 'townie', presence: 'offLot', firstName: 'X', lastName: 'Y', appearance: {} as never, traits: [] });
    sim.engine.ctx.spawnAgent(t.id);
    expect(t.presence).toBe('onLot');
    const wheres = new Set(sim.faults().map((f) => f.where));
    expect(wheres.has('system:chaos.moodModifiers')).toBe(true);
    expect(wheres.has('system:chaos.autonomyCandidates')).toBe(true);
    expect(wheres.has('system:chaos.agentArrived')).toBe(true);
  });

  it('a throwing behaviour.end / begin still leaves the agent clean', () => {
    const sys: SimSystem = {
      id: 'endy',
      behaviors: {
        x_endy: {
          end: () => {
            throw new Error('end exploded');
          },
        },
        x_beginy: {
          begin: () => {
            throw new Error('begin exploded');
          },
        },
      },
    };
    const { sim, agents } = setup({
      extraSystems: [sys],
      extraContent: [
        {
          id: 'endy',
          interactions: [
            { id: 'x_endy', label: 'Endy', icon: 'star', targetKind: 'self', behavior: 'x_endy', stage: { target: { kind: 'here' }, duration: 1, anim: 'idle' } },
            { id: 'x_beginy', label: 'Beginy', icon: 'star', targetKind: 'self', behavior: 'x_beginy', stage: { target: { kind: 'here' }, duration: 1, anim: 'idle' } },
          ],
        },
      ],
    });
    const a: AgentState = agents[0];
    expect(queue(sim, a, 'x_endy', { kind: 'self' }).ok).toBe(true);
    until(sim, () => !a.active, 40);
    expect(a.active).toBeNull();
    queue(sim, a, 'x_beginy', { kind: 'self' });
    expect(a.active).toBeNull();
    expect(sim.faults().map((f) => f.where)).toEqual(expect.arrayContaining(['behavior:x_endy.end', 'behavior:x_beginy.begin']));
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('undrained events are bounded; drainEvents returns and clears', () => {
    const { sim } = setup({ autonomy: 'full', members: ['A', 'B', 'C'] });
    for (let i = 0; i < 2000; i++) sim.engine.ctx.emit({ type: 'sfx', id: 'uiClick' });
    for (let i = 0; i < 5000; i++) sim.engine.ctx.emit({ type: 'sfx', id: 'uiClick' });
    const ev = sim.drainEvents();
    expect(ev.length).toBeLessThanOrEqual(4000);
    expect(sim.drainEvents()).toEqual([]);
  });
});
