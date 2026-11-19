/**
 * Owner request: "if you have a fly zapper then the flies should get zapped and start to disappear if the zapper is
 * near them". Real content (starter lot), real hourly + 30-minute mess passes. Proves:
 *  1. without a zapper, old dishes grow flies (control);
 *  2. a powered zapper nearby clears them GRADUALLY: one swarm per zapper per 30-min pass, each with a zap fx;
 *  3. a dish OUTSIDE the radius keeps its flies; a BROKEN zapper (not powered) zaps nothing;
 *  4. no new swarm grows inside a working zapper's reach;
 *  5. the renderer draws flies from the sim flag (zapped → no swarm drawn), not from dish age.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, SimulationAPI } from '../../../src/sim/contracts';
import type { ObjectState } from '../../../src/sim/types';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { TICKS_PER_HOUR, TICK_MINUTES } from '../../../src/sim/types';

function world(seed: number) {
  const sim = createSimulation(createNewWorld({ seed, householdName: 'G', lotTemplate: 'starter', difficulty: 'normal', members: [{ firstName: 'Tibia', lastName: 'G', appearance: defaultAppearance(), traits: [], aspiration: null }] }));
  sim.state.settings.autonomy = 'off';
  return sim;
}
function put(sim: SimulationAPI, defId: string, x: number, z: number, data: Record<string, unknown> = {}): ObjectState {
  const id = `o${sim.state.nextId++}`;
  const placement = defId === 'zapper_fly' ? { kind: 'floor', x: Math.floor(x), z: Math.floor(z), rot: 0 } : { kind: 'loose', x, z, y: 0, parentId: null, surfaceIndex: null, facing: 0 };
  sim.state.objects[id] = { id, defId, placement, condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 }, data, purchasedTick: sim.state.tick, value: 0, tint: null } as unknown as ObjectState;
  return sim.state.objects[id];
}
/** Advance `minutes` GAME minutes (a tick is TICK_MINUTES long). */
const run = (sim: SimulationAPI, minutes: number, ev: SimEvent[] = []) => {
  for (let i = 0; i < Math.round(minutes / TICK_MINUTES); i++) {
    sim.step();
    ev.push(...sim.drainEvents());
  }
  return ev;
};
const flies = (o: ObjectState) => o.data?.flies === true;

describe('fly zapper zaps nearby flies, gradually', () => {
  it('control: old dishes grow flies without a zapper', () => {
    const sim = world(51);
    const a = put(sim, 'item_dish', 10.5, 10.5, { createdTick: sim.state.tick - 7 * TICKS_PER_HOUR });
    run(sim, 2 * 60);
    expect(flies(a)).toBe(true);
  });

  it('a powered zapper clears nearby swarms one per pass with a zap; out-of-range flies stay', () => {
    const sim = world(52);
    const old = sim.state.tick - 7 * TICKS_PER_HOUR;
    const near = [put(sim, 'item_dish', 10.5, 10.5, { createdTick: old }), put(sim, 'item_dish', 11.5, 10.5, { createdTick: old }), put(sim, 'item_dish', 10.5, 11.5, { createdTick: old })];
    const far = put(sim, 'item_dish', 22.5, 22.5, { createdTick: old });
    run(sim, 2 * 60); // swarms form first
    expect([...near, far].every(flies)).toBe(true);
    sim.state.household.utilitiesOn = true;
    put(sim, 'zapper_fly', 9, 9);
    const counts: number[] = [];
    const ev: SimEvent[] = [];
    for (let pass = 0; pass < 4; pass++) {
      run(sim, 30, ev);
      counts.push(near.filter(flies).length);
    }
    expect(counts[0]).toBe(2); // gradual: one swarm zapped per pass
    expect(counts[counts.length - 1]).toBe(0);
    expect(ev.filter((e) => e.type === 'fx' && (e as { kind?: string }).kind === 'zap').length).toBeGreaterThanOrEqual(3);
    expect(flies(far)).toBe(true); // outside the 5-tile radius
    run(sim, 3 * 60); // and no new swarm grows inside its reach
    expect(near.filter((d) => sim.state.objects[d.id]).every((d) => !flies(d))).toBe(true);
  });

  it('a broken (so unpowered) zapper zaps nothing', () => {
    const sim = world(53);
    const d = put(sim, 'item_dish', 10.5, 10.5, { createdTick: sim.state.tick - 7 * TICKS_PER_HOUR });
    run(sim, 2 * 60);
    const z = put(sim, 'zapper_fly', 9, 9);
    (z.condition as { broken: boolean }).broken = true;
    run(sim, 2 * 60);
    expect(flies(d)).toBe(true);
  });
});
