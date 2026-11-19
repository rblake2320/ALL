/** Engine seam used by quests: SimSystem.onEvent delivery order, no recursion, fault containment, interactionCompleted. */
import { describe, expect, it } from 'vitest';
import type { SimEvent, SimSystem } from '../../../src/sim/contracts';
import { fixtureSim, newFixtureWorld, place } from '../../../src/sim/engine/fixtures/world';
import { createCounters, fixtureSystems } from '../../../src/sim/engine/fixtures/systems';

describe('SimSystem.onEvent', () => {
  it('delivers every emit in order; emits made by observers are queued behind (FIFO), never recursive', () => {
    const seen: string[] = [];
    let depth = 0;
    let maxDepth = 0;
    const a: SimSystem = {
      id: 'x_a',
      onEvent(ctx, e) {
        depth++;
        maxDepth = Math.max(maxDepth, depth);
        seen.push(`a:${e.type}`);
        if (e.type === 'fx') ctx.emit({ type: 'music', mood: 'party' });
        depth--;
      },
    };
    const b: SimSystem = { id: 'x_b', onEvent: (_ctx, e) => void seen.push(`b:${e.type}`) };
    const systems = [...fixtureSystems(createCounters()), a, b];
    const { sim } = fixtureSim(newFixtureWorld({ systems }), { systems });
    sim.drainEvents();
    seen.length = 0;
    sim.engine.ctx.emit({ type: 'fx', kind: 'puff' });
    expect(seen).toEqual(['a:fx', 'b:fx', 'a:music', 'b:music']);
    expect(maxDepth).toBe(1);
    expect(sim.drainEvents().map((e) => e.type)).toEqual(['fx', 'music']);
  });

  it('a throwing observer is contained (fault recorded, others still served) and a feedback loop is bounded', () => {
    const got: SimEvent[] = [];
    const bad: SimSystem = {
      id: 'x_bad',
      onEvent() {
        throw new Error('boom');
      },
    };
    const loop: SimSystem = { id: 'x_loop', onEvent: (ctx) => ctx.emit({ type: 'music', mood: 'sad' }) };
    const good: SimSystem = { id: 'x_good', onEvent: (_c, e) => void got.push(e) };
    const systems = [...fixtureSystems(createCounters()), bad, loop, good];
    const { sim } = fixtureSim(newFixtureWorld({ systems }), { systems });
    got.length = 0; // world creation already ran one (bounded) cascade through the same system objects
    expect(() => sim.engine.ctx.emit({ type: 'fx', kind: 'puff' })).not.toThrow();
    expect(got.length).toBeGreaterThan(1);
    expect(got.length).toBeLessThanOrEqual(1024);
    expect(sim.faults().some((f) => f.where === 'system:x_bad.onEvent')).toBe(true);
    sim.step(); // still ticks
  });

  it("finishRun(complete) emits 'interactionCompleted' with the run uid, household flag and public params only", () => {
    const { sim } = fixtureSim();
    const tv = place(sim, 'tv_crt', 4, 4);
    const actor = sim.state.household.memberIds[0];
    const r = sim.dispatch({ type: 'queue', actorId: actor, interactionId: 'fx_watchTv', target: { kind: 'object', id: tv.id } });
    expect(r.ok).toBe(true);
    const events: SimEvent[] = [];
    for (let i = 0; i < 4000 && !events.some((e) => e.type === 'interactionCompleted' && e.interactionId === 'fx_watchTv'); i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    const done = events.find((e): e is Extract<SimEvent, { type: 'interactionCompleted' }> => e.type === 'interactionCompleted' && e.interactionId === 'fx_watchTv');
    expect(done).toBeDefined();
    expect(done).toMatchObject({ agentId: actor, targetId: tv.id, source: 'player', household: true });
    expect(typeof done!.uid).toBe('number');
    expect(Object.keys(done!.params).some((k) => k.startsWith('_'))).toBe(false);
  });
});
