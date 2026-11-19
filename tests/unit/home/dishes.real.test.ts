/**
 * Two owner playtest bugs, real content:
 *  A. "this says can't clean, spotless, but flies are all over": the flies were dirty dishes ON the table; the table
 *     only offered Wipe Down (correctly "Already spotless"). Now the table offers Clear the Dishes, which cleans every
 *     dish on it — and the flies' source (the dish objects) is gone afterwards.
 *  B. "the zombie moves the item and then it reappears": a zombie carrying a dish to the sink was interrupted by an
 *     ordinary need and dropped it where it stood. Now a non-critical need waits until the carried dish is washed;
 *     a CRITICAL item (pass out) still interrupts (safety), and the player's own Cancel still works.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, SimulationAPI } from '../../../src/sim/contracts';
import type { AgentState, ObjectState } from '../../../src/sim/types';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { IX } from '../../../src/sim/content/home/ids';

function setup(seed: number, tpl: 'starter' | 'derelict' = 'starter') {
  const sim = createSimulation(createNewWorld({
    seed, householdName: 'G', lotTemplate: tpl, difficulty: 'normal',
    members: [{ firstName: 'Tibia', lastName: 'G', appearance: defaultAppearance(), traits: [], aspiration: null }],
  }));
  sim.state.settings.autonomy = 'off';
  const m = sim.state.agents[sim.state.household.memberIds[0]];
  for (const n of ['hunger', 'energy', 'social', 'fun', 'hygiene'] as const) m.needs[n] = 95;
  const table = Object.values(sim.state.objects).find((o) => /^table_/.test(o.defId))!;
  return { sim, m, table };
}
function dishOn(sim: SimulationAPI, table: ObjectState, dx: number): string {
  const id = `o${sim.state.nextId++}`;
  const tp = table.placement as { x: number; z: number };
  sim.state.objects[id] = { id, defId: 'item_dish', placement: { kind: 'loose', x: tp.x + 0.3 + dx, z: tp.z + 0.5, y: 0.75, parentId: table.id, surfaceIndex: 0, facing: 0 }, condition: {}, data: { createdTick: sim.state.tick - 8 * 60 }, purchasedTick: 0, value: 0, tint: null } as unknown as ObjectState;
  return id;
}
const step = (sim: SimulationAPI, n: number, ev: SimEvent[] = [], each?: () => void) => {
  for (let i = 0; i < n; i++) {
    each?.();
    sim.step();
    ev.push(...sim.drainEvents());
  }
  return ev;
};
const dishes = (sim: SimulationAPI) => Object.values(sim.state.objects).filter((o) => o.defId === 'item_dish');

describe('owner bug A: flies over a "spotless" table', () => {
  it('the table offers Clear the Dishes while dishes sit on it, and it cleans them all', () => {
    for (const tpl of ['starter', 'derelict'] as const) {
      const { sim, m, table } = setup(41, tpl);
      dishOn(sim, table, 0);
      dishOn(sim, table, 0.3);
      const menu = sim.menu(m.id, { kind: 'object', id: table.id });
      const clear = menu.find((x) => x.interactionId === IX.clearDishes);
      expect(clear, `${tpl}: ${menu.map((x) => x.label).join(', ')}`).toBeDefined();
      expect(clear!.available).toBe(true);
      expect(clear!.label).toBe('Clear the Dishes (2)');
      const r = sim.dispatch({ type: 'queue', actorId: m.id, interactionId: IX.clearDishes, target: { kind: 'object', id: table.id } });
      expect(r.ok, r.ok ? '' : r.reason).toBe(true);
      step(sim, 8 * 60);
      expect(dishes(sim), `${tpl}: every dish on the table was cleaned`).toEqual([]);
      expect(sim.menu(m.id, { kind: 'object', id: table.id }).find((x) => x.interactionId === IX.clearDishes)?.available).toBe(false);
      expect(sim.checkInvariants()).toEqual([]);
    }
  });

  it('adversarial: no dishes → not available; ordering it twice never double-queues a dish', () => {
    const { sim, m, table } = setup(42);
    expect(sim.menu(m.id, { kind: 'object', id: table.id }).find((x) => x.interactionId === IX.clearDishes)?.available).toBe(false);
    const d = dishOn(sim, table, 0);
    sim.dispatch({ type: 'queue', actorId: m.id, interactionId: IX.clearDishes, target: { kind: 'object', id: table.id } });
    sim.dispatch({ type: 'queue', actorId: m.id, interactionId: IX.clearDishes, target: { kind: 'object', id: table.id } });
    step(sim, 3);
    const cleans = [m.active, ...m.queue].filter((q) => q && q.interactionId === IX.cleanDish && q.target.kind === 'object' && q.target.id === d);
    expect(cleans.length).toBeLessThanOrEqual(1);
  });
});

describe('owner bug B: a carried item no longer pops back', () => {
  function carrying(seed: number, source: 'player' | 'auto' = 'player') {
    const { sim, m, table } = setup(seed);
    const d = dishOn(sim, table, 0);
    if (source === 'auto') {
      // the zombie decided to clean it on its own (autonomy priority 100)
      m.queue.push({ uid: sim.state.nextId++, interactionId: IX.cleanDish, target: { kind: 'object', id: d }, params: {}, source: 'auto', priority: 100, queuedTick: sim.state.tick });
    } else expect(sim.dispatch({ type: 'queue', actorId: m.id, interactionId: IX.cleanDish, target: { kind: 'object', id: d } }).ok).toBe(true);
    for (let i = 0; i < 4 * 60 && sim.state.objects[d]?.placement.kind !== 'held'; i++) sim.step();
    expect(sim.state.objects[d].placement.kind).toBe('held');
    return { sim, m, d };
  }

  it('a new order while the zombie carries a dish it chose to clean: the dish is washed first, never dropped back', () => {
    const { sim, m, d } = carrying(43, 'auto');
    const chair = Object.values(sim.state.objects).find((o) => o.defId === 'armchair_tattered')!;
    const sit = sim.menu(m.id, { kind: 'object', id: chair.id }).find((x) => x.available && /sit/i.test(x.label))!;
    expect(sim.dispatch({ type: 'queue', actorId: m.id, interactionId: sit.interactionId, target: { kind: 'object', id: chair.id } }).ok).toBe(true);
    const kinds: string[] = [];
    const all = step(sim, 3 * 60, [], () => {
      const o = sim.state.objects[d];
      if (o) kinds.push(o.placement.kind);
    });
    expect(kinds.includes('loose'), `dish placements while carried: ${[...new Set(kinds)].join(',')}`).toBe(false);
    expect(sim.state.objects[d]).toBeUndefined(); // washed
    // and the player's order was kept, not lost: it ran after the wash
    const sat = all.findIndex((e) => e.type === 'interactionCompleted' && e.interactionId === sit.interactionId && e.source === 'player');
    const washed = all.findIndex((e) => e.type === 'interactionCompleted' && e.interactionId === IX.cleanDish);
    expect(washed).toBeGreaterThanOrEqual(0);
    expect(sat, 'the sit order completed').toBeGreaterThan(washed);
  });

  it('safety: a critical pass-out still interrupts (the dish is set down, not lost)', () => {
    const { sim, m, d } = carrying(44);
    sim.state.settings.autonomy = 'full';
    step(sim, 60, [], () => void (m.needs.energy = 0));
    expect(m.status.passedOut || m.active?.interactionId === 'engine_passOut' || !sim.state.objects[d] || sim.state.objects[d].placement.kind === 'loose').toBe(true);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it("the player's own Cancel still works mid-carry", () => {
    const { sim, m, d } = carrying(45);
    expect(sim.dispatch({ type: 'cancel', actorId: m.id, uid: m.active!.uid }).ok).toBe(true);
    step(sim, 30);
    expect(m.active?.interactionId === IX.cleanDish).toBe(false);
    expect(sim.state.objects[d]?.placement.kind).toBe('loose');
  });
});
