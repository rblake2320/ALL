/**
 * Backlog #15 — fire severity: spreads capped per fire event, critical-priority firefighting for the household,
 * and a clear "buy a new one" notification when a kitchen appliance burns.
 */
import { describe, expect, it } from 'vitest';
import type { SimContext, SimulationAPI } from '../../../src/sim/contracts';
import type { AgentState, ObjectState } from '../../../src/sim/types';
import { DATA, FLAG, IX, MOOD } from '../../../src/sim/content/home/ids';
import { FIRE_MAX_SPREADS, MAX_FIREFIGHTERS_PER_FIRE, fireEventOf, spreadsOf, startFire } from '../../../src/sim/systems/home/upkeep/fire';
import { PRIORITY } from '../../../src/sim/vocabulary';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { FakeSim, kitchenLot } from './fakeCtx';

/** Six flammable counters in a row: an uncapped fire would chain through all of them. */
function counterRow(): FakeSim {
  const objects = [0, 1, 2, 3, 4, 5].map((i) => ({ defId: 'counter_butcher', x: 2 + i, z: 8 }));
  const sim = new FakeSim({ objects, members: [{ pos: { x: 20.5, z: 20.5 } }] });
  sim.forcedChance = true; // every 10-minute spread roll succeeds
  return sim;
}

const burned = (sim: FakeSim) => sim.objs('item_ash').length;

describe('#15 fire spread is capped per fire event', () => {
  it(`one ignition burns at most ${FIRE_MAX_SPREADS + 1} objects even when every spread roll succeeds`, () => {
    const sim = counterRow();
    const first = sim.objs('counter_butcher')[0];
    const fire = startFire(sim.ctx, first)!;
    expect(fireEventOf(fire)).toBe(fire.id);
    sim.advance(130); // two full burn cycles: plenty of spread opportunities
    expect(spreadsOf(sim.ctx, fire.id)).toBeLessThanOrEqual(FIRE_MAX_SPREADS);
    expect(burned(sim)).toBe(FIRE_MAX_SPREADS + 1);
    expect(sim.objs('counter_butcher')).toHaveLength(6 - (FIRE_MAX_SPREADS + 1));
    expect(sim.objs('item_fire')).toHaveLength(0);
    sim.advance(5);
    expect(Object.keys(sim.state.flags).filter((k) => k.startsWith(FLAG.fireSpreadsPrefix))).toEqual([]); // cleaned up
  });

  it('spread fires inherit the event; a second, independent ignition gets its own budget', () => {
    const sim = counterRow();
    const [c0, , , , , c5] = sim.objs('counter_butcher');
    const a = startFire(sim.ctx, c0)!;
    sim.advance(11);
    const children = sim.objs('item_fire').filter((f) => f.id !== a.id);
    expect(children.length).toBeGreaterThanOrEqual(1);
    for (const f of children) expect(f.data[DATA.fireEvent]).toBe(a.id);
    const b = startFire(sim.ctx, c5)!;
    expect(fireEventOf(b)).toBe(b.id);
    expect(spreadsOf(sim.ctx, b.id)).toBe(0);
  });

  it('adversarial: a legacy fire (saved before events existed) and junk counters still respect the cap', () => {
    const sim = counterRow();
    const fire = startFire(sim.ctx, sim.objs('counter_butcher')[0])!;
    delete fire.data[DATA.fireEvent]; // a pre-#15 save
    sim.state.flags[FLAG.fireSpreadsPrefix + fire.id] = 'garbage';
    sim.advance(65);
    expect(burned(sim)).toBeLessThanOrEqual(FIRE_MAX_SPREADS + 1);
    expect(burned(sim)).toBeGreaterThanOrEqual(1);
  });
});

describe('#15 a burned kitchen appliance says what to do', () => {
  it('the fridge: "Your fridge burned — buy a new one" (and not the generic line)', () => {
    const sim = new FakeSim({ objects: kitchenLot(), members: [{ pos: { x: 20.5, z: 20.5 } }] });
    sim.forcedChance = false; // no spreading: only the fridge burns
    const fridge = sim.obj('fridge_humming');
    startFire(sim.ctx, fridge);
    sim.advance(61);
    expect(sim.state.objects[fridge.id]).toBeUndefined();
    const notes = sim.state.notifications.filter((n) => n.kind === 'bad');
    expect(notes.some((n) => n.title === 'Your fridge burned — buy a new one')).toBe(true);
    expect(notes.find((n) => n.title === 'Your fridge burned — buy a new one')!.text).toMatch(/Buy mode/);
    expect(notes.some((n) => n.title === 'Burned to a crisp')).toBe(false);
  });

  it('a stove gets its own line; ordinary furniture keeps the generic one', () => {
    const sim = new FakeSim({ objects: [...kitchenLot(), { defId: 'sofa_moldy', x: 12, z: 12 }], members: [{ pos: { x: 20.5, z: 20.5 } }] });
    sim.forcedChance = false;
    startFire(sim.ctx, sim.obj('stove_greasefire'));
    startFire(sim.ctx, sim.obj('sofa_moldy'));
    sim.advance(61);
    const titles = sim.state.notifications.map((n) => n.title);
    expect(titles).toContain('Your stove burned — buy a new one');
    expect(titles).toContain('Burned to a crisp');
  });
});

// ───────────────────────────── real engine: firefighters are summoned at critical priority ─────────────────────────────

function household(seed: number, n = 3): SimulationAPI {
  return createSimulation(
    createNewWorld({
      seed,
      householdName: 'Ash',
      members: ['Mort', 'Ghoulia', 'Bram'].slice(0, n).map((firstName) => ({ firstName, lastName: 'Ash', appearance: defaultAppearance(), traits: [], aspiration: null })),
      lotTemplate: 'starter',
      difficulty: 'normal',
    }),
  );
}

const ctxOf = (sim: SimulationAPI) => (sim as unknown as { engine: { ctx: SimContext } }).engine.ctx;
const members = (sim: SimulationAPI): AgentState[] => sim.state.household.memberIds.map((id) => sim.state.agents[id]);
const firstOf = (sim: SimulationAPI, defId: string): ObjectState => Object.values(sim.state.objects).find((o) => o.defId === defId)!;

function fightPriority(a: AgentState): number | null {
  if (a.active?.interactionId === IX.fightFire) return a.active.priority;
  const q = a.queue.find((x) => x.interactionId === IX.fightFire);
  return q ? q.priority : null;
}

describe('#15 household autonomy treats a fire as an emergency', () => {
  it('non-panicking zombies are summoned at CRITICAL priority (≤ 2 per fire), preempting a player order', () => {
    const sim = household(51);
    for (const a of members(sim)) for (const n of ['hunger', 'energy', 'social', 'fun', 'hygiene'] as const) a.needs[n] = 90;
    const [mort, ghoulia, bram] = members(sim);
    const tv = firstOf(sim, 'tv_crt');
    expect(sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.watchTv, target: { kind: 'object', id: tv.id } }).ok).toBe(true);
    for (let i = 0; i < 4 * 30 && mort.active?.phase !== 'run'; i++) sim.step();
    expect(mort.active?.interactionId).toBe(IX.watchTv);
    const stove = firstOf(sim, 'stove_greasefire');
    const fireId = ctxOf(sim).sys('upkeep').startFire(stove.id) as string;
    expect(typeof fireId).toBe('string');
    for (let i = 0; i < 8; i++) sim.step(); // ≥ one game minute
    const summoned = [mort, ghoulia, bram].filter((a) => fightPriority(a) === PRIORITY.critical);
    expect(summoned.length).toBeGreaterThanOrEqual(1);
    expect(summoned.length).toBeLessThanOrEqual(MAX_FIREFIGHTERS_PER_FIRE); // the critical crew is capped per fire
    if (summoned.includes(mort)) expect(mort.queue.some((q) => q.interactionId === IX.watchTv) || mort.active?.interactionId === IX.watchTv).toBe(true); // re-queued, not lost
    // the crew actually fights: the fire is out well before it would burn the stove to ash (60 min)
    let out = -1;
    for (let i = 0; i < 4 * 75 && out < 0; i++) {
      sim.step();
      sim.drainEvents();
      if (!sim.state.objects[fireId]) out = i;
    }
    expect(out).toBeGreaterThanOrEqual(0);
    expect(sim.state.stats.counters.firesFought ?? 0).toBeGreaterThanOrEqual(1);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it("adversarial: autonomy 'off' summons nobody; sleeping and panicking zombies are never summoned", () => {
    const sim = household(52, 2);
    const [mort, ghoulia] = members(sim);
    // Ghoulia goes to bed for real (a sleep run), before anything burns
    ghoulia.needs.energy = 10;
    const coffin = firstOf(sim, 'coffin_pine');
    expect(sim.dispatch({ type: 'queue', actorId: ghoulia.id, interactionId: IX.sleep, target: { kind: 'object', id: coffin.id } }).ok).toBe(true);
    for (let i = 0; i < 4 * 30 && ghoulia.active?.phase !== 'run'; i++) sim.step();
    expect(ghoulia.active?.interactionId).toBe(IX.sleep);
    sim.state.settings.autonomy = 'off';
    const stove = firstOf(sim, 'stove_greasefire');
    ctxOf(sim).sys('upkeep').startFire(stove.id);
    for (let i = 0; i < 12; i++) sim.step();
    expect([mort, ghoulia].map(fightPriority)).toEqual([null, null]);
    sim.state.settings.autonomy = 'full';
    // Mort stands right by the burning stove: Panicking AND the fire in sight → in a panic, never summoned
    const c = sim.spatial.objectCenter(stove);
    mort.pos = { x: c.x - 1.5, z: c.z };
    mort.queue = [];
    ctxOf(sim).addMoodlet(mort, MOOD.panicking);
    for (let i = 0; i < 4; i++) {
      mort.pos = { x: c.x - 1.5, z: c.z }; // pinned next to the fire for the check
      sim.step();
    }
    expect(fightPriority(mort)).not.toBe(PRIORITY.critical); // he may still volunteer through autonomy (+60), never summoned
    expect(ghoulia.active?.interactionId).toBe(IX.sleep); // the sleeper is left alone
    expect(fightPriority(ghoulia)).toBeNull();
    expect(sim.faults()).toEqual([]);
  });

  it('a stale Panicking moodlet from an earlier fire does not exempt a zombie who is nowhere near the new one', () => {
    const sim = household(53, 1);
    for (const n of ['hunger', 'energy', 'social', 'fun', 'hygiene'] as const) members(sim)[0].needs[n] = 90;
    const [mort] = members(sim);
    mort.pos = { x: 4.5, z: 22.5 }; // the far corner of the yard
    ctxOf(sim).addMoodlet(mort, MOOD.panicking); // left over from a fire that is already out
    const stove = firstOf(sim, 'stove_greasefire');
    ctxOf(sim).sys('upkeep').startFire(stove.id);
    for (let i = 0; i < 8; i++) sim.step();
    expect(fightPriority(mort)).toBe(PRIORITY.critical);
  });
});
