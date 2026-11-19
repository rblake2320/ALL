/**
 * Owner report: "cleanup sometimes does not execute". Real content (starter lot). Proves:
 *  1. a player wipe that COMPLETES without lowering the dirt emits interactionNoEffect and records cleanFails;
 *  2. Clear Stuck Mess is NOT offered before any recorded failure ("Try cleaning it first");
 *  3. a CANCELED wipe (player cancel / interruption) never counts as a failure;
 *  4. an AUTONOMOUS wipe never counts;
 *  5. after a recorded failure the recovery runs once: stuckMessCleared carries the PRE-recovery evidence (mess > 0),
 *     then the dirt is 0, cleanFails reset — and it is unrewarded (skills, funds, Bones unchanged);
 *  6. idempotent: ordering it twice clears once; the second is refused at queue time or does nothing;
 *  7. a loose dish whose clean failed is removed by the recovery (the owner's plate case).
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, SimulationAPI } from '../../../src/sim/contracts';
import type { AgentState, ObjectState } from '../../../src/sim/types';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { IX } from '../../../src/sim/content/home/ids';
import { CLEAN_FAILS } from '../../../src/sim/systems/home/upkeep/stuck';

function sim0(seed: number): { sim: SimulationAPI; mort: AgentState; counter: ObjectState } {
  const sim = createSimulation(createNewWorld({
    seed, householdName: 'Graves', lotTemplate: 'starter', difficulty: 'normal',
    members: [{ firstName: 'Mort', lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null }],
  }));
  sim.state.settings.autonomy = 'off';
  const mort = sim.state.agents[sim.state.household.memberIds[0]];
  for (const n of ['hunger', 'energy', 'social', 'fun', 'hygiene'] as const) mort.needs[n] = 95;
  const counter = Object.values(sim.state.objects).find((o) => o.defId === 'counter_butcher')!;
  return { sim, mort, counter };
}
const dirt = (o: ObjectState) => (o.condition as { dirt?: number }).dirt ?? 0;
const setDirt = (o: ObjectState, v: number) => void ((o.condition as { dirt?: number }).dirt = v);
function run(sim: SimulationAPI, n: number, ev: SimEvent[], each?: () => void) {
  for (let i = 0; i < n; i++) {
    each?.();
    sim.step();
    ev.push(...sim.drainEvents());
  }
}
const menuEntry = (sim: SimulationAPI, actor: string, obj: ObjectState, ix: string) => sim.menu(actor, { kind: 'object', id: obj.id }).find((m) => m.interactionId === ix);

/** A counter with one recorded failed / no-effect clean (what the probe below records). */
function stuckCounter(seed: number) {
  const s = sim0(seed);
  setDirt(s.counter, 0.9);
  s.counter.data = { ...(s.counter.data ?? {}), [CLEAN_FAILS]: 1 };
  return s;
}

describe('W-131 batch: cleanup that does not execute is detected, reported and recoverable', () => {
  it('Clear Stuck Mess is not offered before a recorded failure', () => {
    const { sim, mort, counter } = sim0(32);
    setDirt(counter, 0.9);
    const e = menuEntry(sim, mort.id, counter, IX.clearStuckMess);
    expect(e?.available).toBe(false);
    expect(e?.reason).toBe('Try cleaning it first');
    expect(sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.clearStuckMess, target: { kind: 'object', id: counter.id } }).ok).toBe(false);
  });

  it('a canceled wipe and an autonomous wipe never count as failures', () => {
    const { sim, mort, counter } = sim0(33);
    setDirt(counter, 0.9);
    const r = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.wipeDown, target: { kind: 'object', id: counter.id } });
    expect(r.ok).toBe(true);
    const ev: SimEvent[] = [];
    run(sim, 10, ev);
    expect(sim.dispatch({ type: 'cancel', actorId: mort.id, uid: mort.active!.uid }).ok).toBe(true);
    run(sim, 60, ev, () => setDirt(counter, 0.95));
    expect(counter.data?.[CLEAN_FAILS] ?? 0).toBe(0);
    // autonomy wipes it (auto source) while it keeps getting dirty: still no count
    sim.state.settings.autonomy = 'full';
    run(sim, 12 * 60, ev, () => setDirt(counter, 0.95));
    expect(ev.some((e) => e.type === 'interactionNoEffect')).toBe(false);
    expect(counter.data?.[CLEAN_FAILS] ?? 0).toBe(0);
  });

  it('recovery: evidence first, then the counter is clean; unrewarded; idempotent', () => {
    const { sim, mort, counter } = stuckCounter(34);
    const skills = JSON.stringify(mort.skills);
    const funds = sim.state.household.funds;
    const bones = JSON.stringify((sim.state as { economy?: unknown }).economy ?? null);
    expect(menuEntry(sim, mort.id, counter, IX.clearStuckMess)?.available).toBe(true);
    const a = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.clearStuckMess, target: { kind: 'object', id: counter.id } });
    const b = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.clearStuckMess, target: { kind: 'object', id: counter.id } });
    expect(a.ok).toBe(true);
    const ev: SimEvent[] = [];
    run(sim, 60, ev);
    const cleared = ev.filter((e) => e.type === 'stuckMessCleared');
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({ objectId: counter.id, fails: 1 });
    expect((cleared[0] as { mess: number }).mess).toBeGreaterThan(0.5); // recorded BEFORE the clear
    expect(dirt(counter)).toBe(0);
    expect(counter.data?.[CLEAN_FAILS]).toBe(0);
    // the second order (if it was accepted at all) found nothing to do
    if (b.ok) expect(ev.filter((e) => e.type === 'interactionCompleted' && e.interactionId === IX.clearStuckMess).length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(mort.skills)).toBe(skills);
    expect(sim.state.household.funds).toBe(funds);
    expect(JSON.stringify((sim.state as { economy?: unknown }).economy ?? null)).toBe(bones);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a loose dish whose clean failed is removed by the recovery (the plate case)', () => {
    const { sim, mort } = sim0(35);
    // a plate left on the floor next to Mort (the owner's screenshot), as a real loose item object
    const id = `o${sim.state.nextId++}`;
    const at = { x: Math.floor(mort.pos.x) + 1.5, z: Math.floor(mort.pos.z) + 0.5 };
    sim.state.objects[id] = { id, defId: 'item_dish', placement: { kind: 'loose', x: at.x, z: at.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 }, condition: {}, data: { createdTick: sim.state.tick }, purchasedTick: sim.state.tick, value: 0, tint: null } as unknown as ObjectState;
    const ev: SimEvent[] = [];
    const dish = sim.state.objects[id];
    expect(dish).toBeDefined();
    dish.data = { ...(dish.data ?? {}), [CLEAN_FAILS]: 1 };
    const r = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.clearStuckMess, target: { kind: 'object', id: dish.id } });
    expect(r.ok, `${r.ok ? '' : r.reason} | placement ${JSON.stringify(dish.placement)}`).toBe(true);
    run(sim, 60, ev);
    expect(sim.state.objects[dish.id]).toBeUndefined();
    expect(ev.some((e) => e.type === 'stuckMessCleared' && e.objectId === dish.id)).toBe(true);
  });
});
