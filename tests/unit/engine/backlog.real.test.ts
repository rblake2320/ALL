/**
 * Integration-backlog regressions on the REAL content (engine + spatial + home + people). Each describe names its
 * backlog item (docs/INTEGRATION_BACKLOG.md). Kept short: the multi-day probes live in backlog.probe.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, SimulationAPI } from '../../../src/sim/contracts';
import type { AgentState, ObjectState } from '../../../src/sim/types';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { IX } from '../../../src/sim/content/home/ids';

export function realSim(seed: number, names = ['Mort', 'Ghoulia']): SimulationAPI {
  return createSimulation(
    createNewWorld({
      seed,
      householdName: 'Graves',
      members: names.map((firstName) => ({ firstName, lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null })),
      lotTemplate: 'starter',
      difficulty: 'normal',
    }),
  );
}

export function membersOf(sim: SimulationAPI): AgentState[] {
  return sim.state.household.memberIds.map((id) => sim.state.agents[id]);
}

export function firstOf(sim: SimulationAPI, defId: string): ObjectState {
  const o = Object.values(sim.state.objects).find((x) => x.defId === defId);
  if (!o) throw new Error(`no ${defId} on the lot`);
  return o;
}

/** Keep zombies content and put them somewhere sensible so autonomy stays out of the way of the scenario. */
export function calm(sim: SimulationAPI): void {
  sim.state.settings.autonomy = 'off';
  for (const a of membersOf(sim)) {
    for (const n of ['hunger', 'energy', 'social', 'fun', 'hygiene'] as const) a.needs[n] = 95;
    a.needs.preservation = Math.min(95, a.vitality);
  }
}

function stepCollect(sim: SimulationAPI, n: number, into: SimEvent[]): void {
  for (let i = 0; i < n; i++) {
    sim.step();
    into.push(...sim.drainEvents());
  }
}

// ───────────────────────────── #1 exit-phase runs never toast "couldn't…" ─────────────────────────────

describe('#1 no failure notification for runs already in the exit phase', () => {
  function watching(seed: number) {
    const sim = realSim(seed);
    calm(sim);
    const [mort] = membersOf(sim);
    const tv = firstOf(sim, 'tv_crt');
    const res = sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.watchTv, target: { kind: 'object', id: tv.id } });
    expect(res.ok, res.ok ? '' : res.reason).toBe(true);
    for (let i = 0; i < 4 * 60 && mort.active?.phase !== 'run'; i++) sim.step();
    expect(mort.active?.phase).toBe('run');
    sim.drainEvents();
    return { sim, mort, tv, uid: mort.active!.uid };
  }

  it('cancel, then SELL the TV through the real BuildService during the exit minute: no toast, no failure event', () => {
    const { sim, mort, tv, uid } = watching(11);
    expect(sim.dispatch({ type: 'cancel', actorId: mort.id, uid }).ok).toBe(true);
    expect(mort.active?.phase).toBe('exit');
    const notes = sim.state.notifications.length;
    const sold = sim.build.apply({ type: 'sell', objectId: tv.id });
    expect(sold.ok, sold.ok ? '' : sold.reason).toBe(true);
    expect(sim.state.objects[tv.id]).toBeUndefined();
    const events: SimEvent[] = [...sim.drainEvents()];
    stepCollect(sim, 8, events);
    expect(mort.active).toBeNull();
    expect(events.some((e) => e.type === 'interactionFailed')).toBe(false);
    expect(sim.state.notifications.slice(notes).filter((n) => n.kind === 'bad')).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('selling mid-use (no cancel): the build service walks the user out gracefully — still no failure toast', () => {
    const { sim, mort, tv } = watching(12);
    const notes = sim.state.notifications.length;
    expect(sim.build.apply({ type: 'sell', objectId: tv.id }).ok).toBe(true);
    const events: SimEvent[] = [...sim.drainEvents()];
    stepCollect(sim, 8, events);
    expect(mort.active).toBeNull();
    expect(events.some((e) => e.type === 'interactionFailed')).toBe(false);
    expect(sim.state.notifications.slice(notes).filter((n) => n.kind === 'bad')).toEqual([]);
  });

  it('control: a system removing the TV under a RUNNING player run does report the failure (policy keeps that toast)', () => {
    const { sim, mort, tv } = watching(13);
    const notes = sim.state.notifications.length;
    (sim as unknown as { engine: { ctx: { removeObject(id: string, why: string): void } } }).engine.ctx.removeObject(tv.id, 'The TV burned to a crisp');
    expect(mort.active).toBeNull();
    const bad = sim.state.notifications.slice(notes).filter((n) => n.kind === 'bad');
    expect(bad.map((n) => n.text)).toEqual(['The TV burned to a crisp']);
    expect(sim.drainEvents().some((e) => e.type === 'interactionFailed')).toBe(true);
  });

  it('cancel, then a SYSTEM removal during the exit minute: canceled quietly', () => {
    const { sim, mort, tv, uid } = watching(14);
    sim.dispatch({ type: 'cancel', actorId: mort.id, uid });
    const notes = sim.state.notifications.length;
    (sim as unknown as { engine: { ctx: { removeObject(id: string, why: string): void } } }).engine.ctx.removeObject(tv.id, 'The TV burned to a crisp');
    expect(mort.active).toBeNull();
    expect(sim.state.notifications.slice(notes).filter((n) => n.kind === 'bad')).toEqual([]);
    expect(sim.drainEvents().some((e) => e.type === 'interactionFailed')).toBe(false);
  });
});

// ───────────────────────────── #5 nearestTag wait (real kitchen) ─────────────────────────────

describe('#5 two zombies, one fridge: both cook successfully in sequence', () => {
  it('Cook… at two stoves at once: the second cook waits for the single fridge instead of failing', () => {
    const sim = realSim(21);
    calm(sim);
    sim.state.household.funds = 20000;
    const [mort, ghoulia] = membersOf(sim);
    for (const a of [mort, ghoulia]) a.skills.cooking.level = 6; // fire chance 0: the test is about the fridge
    const fridge = firstOf(sim, 'fridge_humming');
    const stove1 = firstOf(sim, 'stove_greasefire');
    let stove2: ObjectState | undefined;
    for (let z = 10; z < 19 && !stove2; z++) {
      for (let x = 10; x < 20 && !stove2; x++) {
        if (sim.build.apply({ type: 'buy', defId: 'stove_greasefire', x, z, rot: 0 }).ok) {
          stove2 = Object.values(sim.state.objects).find((o) => o.defId === 'stove_greasefire' && o.id !== stove1.id);
        }
      }
    }
    expect(stove2).toBeDefined();
    sim.build.clearHistory();
    const orders = [
      sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: IX.cookAtStove, target: { kind: 'object', id: stove1.id }, params: { recipe: 'brainLoaf' } }),
      sim.dispatch({ type: 'queue', actorId: ghoulia.id, interactionId: IX.cookAtStove, target: { kind: 'object', id: stove2!.id }, params: { recipe: 'brainLoaf' } }),
    ];
    expect(orders.map((o) => o.ok)).toEqual([true, true]);
    const notes = sim.state.notifications.length;
    let waited = false;
    const fridgeUsers: string[] = [];
    for (let i = 0; i < 4 * 120; i++) {
      sim.step();
      sim.drainEvents();
      for (const a of [mort, ghoulia]) {
        const r = a.active;
        if (r && r.phase === 'wait' && r.data._tw === 1) waited = true;
        if (r && r.phase === 'run' && r.stage === 0 && r.stageTarget.kind === 'object' && r.stageTarget.id === fridge.id && fridgeUsers.at(-1) !== a.id) fridgeUsers.push(a.id);
      }
      const meals = Object.values(sim.state.objects).filter((o) => o.defId === 'item_meal');
      if (meals.some((m) => m.data.cookId === mort.id) && meals.some((m) => m.data.cookId === ghoulia.id)) break;
    }
    expect(waited).toBe(true);
    expect(new Set(fridgeUsers)).toEqual(new Set([mort.id, ghoulia.id])); // in sequence at the one fridge
    const cooks = Object.values(sim.state.objects).filter((o) => o.defId === 'item_meal').map((m) => m.data.cookId);
    expect(cooks).toContain(mort.id);
    expect(cooks).toContain(ghoulia.id);
    expect(sim.state.notifications.slice(notes).filter((n) => n.kind === 'bad')).toEqual([]);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });
});

// ───────────────────────────── #14 feral nibble ─────────────────────────────

import { CRITICAL_SOCIAL_IDS, STAT as PEOPLE_STAT } from '../../../src/sim/content/people/ids';
import { FERAL_FALLBACK_TAG as PEOPLE_FALLBACK_TAG } from '../../../src/sim/content/people/socialInteractions';
import { FERAL_FALLBACK_TAG } from '../../../src/sim/engine/constants';
import { TICKS_PER_HOUR } from '../../../src/sim/types';

describe('#14 feral nibble: a feral zombie with no reachable food bites a housemate once, then backs off', () => {
  const NIBBLE = CRITICAL_SOCIAL_IDS.feralNibble;

  /** Starter lot with every food source gone and no money for the emergency pizza. */
  function famine(seed: number, names = ['Mort', 'Ghoulia']) {
    const sim = realSim(seed, names);
    calm(sim);
    sim.state.settings.autonomy = 'full';
    const engine = (sim as unknown as { engine: { ctx: { removeObject(id: string): void } } }).engine;
    for (const o of Object.values(sim.state.objects)) {
      const tags = sim.content.objects[o.defId]?.tags ?? [];
      if (tags.some((t) => ['fridge', 'stove', 'microwave', 'meal', 'pizza', 'trash'].includes(t))) engine.ctx.removeObject(o.id);
    }
    sim.state.household.funds = 0;
    const [mort, ghoulia] = membersOf(sim);
    mort.needs.hunger = 4; // feral on the next tick
    return { sim, mort, ghoulia };
  }

  function nibbleStarts(sim: SimulationAPI, a: AgentState, ticks: number): number {
    let n = 0;
    let last = -1;
    for (let i = 0; i < ticks; i++) {
      sim.step();
      sim.drainEvents();
      if (a.active?.interactionId === NIBBLE && a.active.uid !== last) {
        last = a.active.uid;
        n++;
      }
    }
    return n;
  }

  it('the engine and SIM-PEOPLE agree on the last-resort tag, and the nibble is hidden from players', () => {
    expect(PEOPLE_FALLBACK_TAG).toBe(FERAL_FALLBACK_TAG);
    const sim = realSim(30);
    const def = sim.content.interactions[NIBBLE];
    expect(def.tags).toContain(FERAL_FALLBACK_TAG);
    expect(def.hidden).toBe(true);
    const [mort, ghoulia] = membersOf(sim);
    expect(sim.menu(mort.id, { kind: 'agent', id: ghoulia.id }).some((e) => e.interactionId === NIBBLE)).toBe(false);
    expect(sim.dispatch({ type: 'queue', actorId: mort.id, interactionId: NIBBLE, target: { kind: 'agent', id: ghoulia.id } }).ok).toBe(false);
  });

  it('no food on the lot: exactly one nibble within the cooldown — friendship hit both ways, target freshness -3', () => {
    const { sim, mort, ghoulia } = famine(31);
    const rel0 = sim.relationships(mort.id).find((r) => r.otherId === ghoulia.id)?.friendship ?? 0;
    const notes = sim.state.notifications.length;
    const n = nibbleStarts(sim, mort, 3 * TICKS_PER_HOUR - 10); // < the 3 h cooldown
    expect(mort.status.feral).toBe(true);
    expect(n).toBe(1);
    expect(sim.state.stats.agent[mort.id]?.[PEOPLE_STAT.feralNibbles]).toBe(1);
    const rel = sim.relationships(mort.id).find((r) => r.otherId === ghoulia.id)!;
    expect(rel.friendship).toBeLessThanOrEqual(rel0 - 12); // the pair's (shared, symmetric) friendship
    expect(sim.relationships(ghoulia.id).find((r) => r.otherId === mort.id)!.friendship).toBe(rel.friendship);
    expect(mort.moodlets.some((m) => m.id === 'feralRemorse')).toBe(true);
    const bit = ghoulia.moodlets.some((m) => m.id === 'chewedOn');
    const note = sim.state.notifications.slice(notes).find((x) => x.kind === 'social' && /bit|lunged/.test(x.title));
    expect(note?.title).toMatch(bit ? /bit/ : /lunged/);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('a successful bite costs the target exactly 3 freshness (raw) and feeds the biter a little', () => {
    // Search a few seeds for a successful roll; the outcome is seeded, so this is deterministic.
    for (const seed of [41, 42, 43, 44, 45, 46]) {
      const { sim, mort, ghoulia } = famine(seed);
      ghoulia.needs.preservation = Math.min(60, ghoulia.vitality);
      let p0 = -1;
      let h0 = -1;
      for (let i = 0; i < 2 * TICKS_PER_HOUR && !ghoulia.moodlets.some((m) => m.id === 'chewedOn'); i++) {
        sim.step();
        sim.drainEvents();
        if (mort.active?.interactionId === NIBBLE && mort.active.phase === 'run' && p0 < 0) {
          p0 = ghoulia.needs.preservation;
          h0 = mort.needs.hunger;
        }
      }
      if (!ghoulia.moodlets.some((m) => m.id === 'chewedOn')) continue;
      // decay keeps running for the few minutes of the bite: allow a hair of drift on top of the -3
      expect(p0 - ghoulia.needs.preservation).toBeGreaterThan(2.9);
      expect(p0 - ghoulia.needs.preservation).toBeLessThan(3.3);
      expect(mort.needs.hunger).toBeGreaterThan(h0 + 10);
      return;
    }
    throw new Error('no successful bite in six seeds');
  });

  it('control: with a working fridge the feral zombie goes for food and never bites', () => {
    const sim = realSim(32);
    calm(sim);
    sim.state.settings.autonomy = 'full';
    const [mort] = membersOf(sim);
    mort.needs.hunger = 4;
    expect(nibbleStarts(sim, mort, 2 * TICKS_PER_HOUR)).toBe(0);
    expect(mort.needs.hunger).toBeGreaterThan(20);
    expect(sim.state.stats.agent[mort.id]?.[PEOPLE_STAT.feralNibbles] ?? 0).toBe(0);
  });

  it('adversarial: alone on the lot, or with only a sleeping housemate, nobody gets bitten and nothing faults', () => {
    const solo = famine(33, ['Mort']);
    expect(nibbleStarts(solo.sim, solo.mort, TICKS_PER_HOUR)).toBe(0);
    expect(solo.sim.faults()).toEqual([]);
    const pair = famine(34);
    const coffin = firstOf(pair.sim, 'coffin_pine');
    pair.mort.needs.hunger = 60; // not feral yet: let Ghoulia get into the coffin first
    pair.ghoulia.needs.energy = 5;
    (pair.sim as unknown as { engine: { ctx: { queue(a: AgentState, q: object): unknown } } }).engine.ctx.queue(pair.ghoulia, {
      interactionId: IX.sleep,
      target: { kind: 'object', id: coffin.id },
      source: 'player',
    });
    for (let i = 0; i < 4 * 30 && pair.ghoulia.active?.phase !== 'run'; i++) pair.sim.step();
    expect(pair.ghoulia.active?.interactionId).toBe(IX.sleep);
    expect(pair.ghoulia.active?.phase).toBe('run');
    pair.mort.needs.hunger = 4;
    expect(nibbleStarts(pair.sim, pair.mort, TICKS_PER_HOUR)).toBe(0); // targetAwake: sleepers are safe
    expect(pair.mort.status.feral).toBe(true);
    expect(pair.ghoulia.active?.interactionId).toBe(IX.sleep);
    expect(pair.sim.faults()).toEqual([]);
  });
});
