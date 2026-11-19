/**
 * Adversarial: corrupted state, garbage inputs, repeated events, objects vanishing mid-run, missing/throwing
 * cross-module apis, money edge cases, determinism and simulation isolation of api calls.
 */
import { describe, expect, it } from 'vitest';
import type { AgentState, ObjectState } from '../../../src/sim/types';
import { FLAG, IX } from '../../../src/sim/content/home/ids';
import { payAll, sanitizeBills, unpaidBills } from '../../../src/sim/systems/home/economy/bills';
import { readLeftovers } from '../../../src/sim/systems/home/food/leftovers';
import { objectDetail } from '../../../src/sim/systems/home/food/detail';
import { startFire } from '../../../src/sim/systems/home/upkeep/fire';
import { checkGameOver } from '../../../src/sim/systems/home/decay/death';
import { currentCtx, noteCtx } from '../../../src/sim/systems/home/ctxRegistry';
import { homeSystems } from '../../../src/sim/systems/home';
import { preservationDecayPerHour } from '../../../src/sim/systems/home/decay/rates';
import { tickAt } from '../../../src/sim/time';
import { FakeSim, kitchenLot } from './fakeCtx';

function allFinite(a: AgentState): boolean {
  return Number.isFinite(a.needs.preservation) && Number.isFinite(a.vitality);
}

describe('garbage time & corrupted agents', () => {
  it('system hooks shrug off NaN / negative / absurd dt', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    for (const s of homeSystems) {
      for (const dt of [NaN, -5, Infinity, 1e9, 0]) expect(() => s.tick!(sim.ctx, dt)).not.toThrow();
      expect(() => s.hour?.(sim.ctx, NaN as unknown as number)).not.toThrow();
      expect(() => s.dayStart?.(sim.ctx, -1)).not.toThrow();
    }
    expect(allFinite(sim.member())).toBe(true);
  });

  it('repairs NaN needs, NaN/out-of-range vitality, missing status and garbage limbs without throwing', () => {
    const sim = new FakeSim({ objects: kitchenLot(), members: [{}, {}] });
    const [a, b] = [sim.member(0), sim.member(1)];
    a.needs.preservation = NaN;
    a.needs.hygiene = Infinity;
    a.vitality = NaN;
    (b as unknown as { status: unknown }).status = null;
    (b as unknown as { limbs: unknown }).limbs = { armL: 'banana' };
    b.vitality = 500;
    expect(() => sim.advance(120)).not.toThrow();
    // decay owns preservation & vitality (other needs are healed by the engine's changeNeed decay)
    expect(Number.isFinite(a.needs.preservation)).toBe(true);
    expect(Number.isFinite(a.vitality)).toBe(true);
    expect(preservationDecayPerHour(sim.ctx, a)).toBeCloseTo(1.3, 6); // Infinity hygiene read as "fine", not as NaN
    expect(b.vitality).toBeLessThanOrEqual(100);
    expect(b.status.zeroPreservationMinutes).toBe(0);
    expect(['ok', 'missing', 'prosthetic']).toContain(b.limbs.armL);
    expect(b.needs.preservation).toBeLessThanOrEqual(b.vitality);
  });

  it('repeated hour / day hooks are idempotent (no double vitality loss, bills, limb rolls)', () => {
    const sim = new FakeSim({ objects: kitchenLot(), members: [{ needs: { preservation: 0 } }], tick: tickAt(4, 9 * 60) });
    sim.forcedChance = true;
    const decay = sim.sys('decay');
    const economy = sim.sys('economy');
    const vit = sim.member().vitality;
    for (let i = 0; i < 5; i++) {
      decay.dayStart!(sim.ctx, 4);
      decay.hour!(sim.ctx, 9);
      economy.hour!(sim.ctx, 9);
    }
    expect(sim.member().vitality).toBeCloseTo(vit - 0.6, 6);
    expect(sim.state.household.bills).toHaveLength(1);
    expect(sim.objs('item_limb_arm').length + sim.objs('item_limb_leg').length).toBe(1);
  });

  it('game over needs a non-empty household and fires once', () => {
    const sim = new FakeSim({ members: [] });
    expect(checkGameOver(sim.ctx)).toBe(false);
    sim.addMember({ presence: 'gone' });
    expect(checkGameOver(sim.ctx)).toBe(true);
    expect(checkGameOver(sim.ctx)).toBe(true);
    expect(sim.eventsOf('gameOver')).toHaveLength(1);
  });
});

describe('garbage object data', () => {
  it('leftovers JSON that is broken, wrong-shaped or hostile reads as empty / sanitised', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    const f = sim.obj('fridge_humming');
    for (const bad of ['not json', '{"s":1}', '[1,2,3]', '[{"s":"x"}]', 'null', '']) {
      f.data.leftovers = bad;
      expect(readLeftovers(f)).toEqual([]);
    }
    f.data.leftovers = JSON.stringify([{ s: 1e9, q: 99, r: 'notARecipe', a: -50 }, { s: 0 }]);
    expect(readLeftovers(f)).toEqual([{ s: 99, q: 6, r: 'brainLoaf', a: 0 }]);
    expect(() => sim.advance(120)).not.toThrow();
  });

  it('meals / limbs / piles / fires / paintings with nonsense data never throw', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    const junk: ObjectState['data'] = { servings: 'abc', quality: null, createdTick: 'yesterday', limbId: 'tail', ownerId: 42 as unknown as string, value: NaN as unknown as number, burningId: 'o404', rotten: 'maybe' };
    for (const defId of ['item_meal', 'item_pizza', 'item_dish', 'item_limb_arm', 'item_bonepile', 'item_urn', 'item_painting', 'item_fire', 'item_ash']) {
      const o = sim.addObject({ defId, x: 4, z: 4, data: junk });
      expect(() => objectDetail(sim.ctx, o.id)).not.toThrow();
    }
    expect(() => sim.advance(90)).not.toThrow(); // includes a fire with a missing burning object (burns out → ash)
    expect(sim.objs('item_fire')).toHaveLength(0);
  });

  it('starting a fire on a removed or held object is a no-op', () => {
    const sim = new FakeSim({ objects: [...kitchenLot(), { defId: 'item_meal', x: 3, z: 3 }] });
    const stove = sim.obj('stove_greasefire');
    sim.ctx.removeObject(stove.id);
    expect(startFire(sim.ctx, stove)).toBeNull();
    const m = sim.obj('item_meal');
    sim.ctx.holdItem(sim.member(), m);
    expect(startFire(sim.ctx, m)).toBeNull();
  });
});

describe('money edge cases', () => {
  it('corrupted bills are sanitised: nulls dropped, duplicates removed, NaN/negative amounts zeroed', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 100 });
    sim.state.household.bills = [
      null as never,
      { id: 'b1', issuedTick: 0, dueTick: 10, amount: NaN, paidTick: null, stage: 9 },
      { id: 'b1', issuedTick: 0, dueTick: 10, amount: 5, paidTick: null, stage: 0 },
      { id: 'b2', issuedTick: 0, dueTick: 20, amount: -40, paidTick: null, stage: -3 },
      { id: '', issuedTick: 0, dueTick: 20, amount: 40, paidTick: null, stage: 0 },
      { id: 'b3', issuedTick: 0, dueTick: 30, amount: 30.6, paidTick: 'never' as unknown as number, stage: 0 },
    ];
    const bills = sanitizeBills(sim.ctx);
    expect(bills.map((b) => [b.id, b.amount, b.stage])).toEqual([
      ['b1', 0, 4],
      ['b2', 0, 0],
      ['b3', 31, 0],
    ]);
    expect(payAll(sim.ctx, null)).toBe(true);
    expect(sim.state.household.funds).toBe(69);
    expect(Number.isFinite(sim.state.household.funds)).toBe(true);
  });

  it('exact funds pay; zero funds give a reason and leave state untouched', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 0 });
    sim.state.household.bills = [{ id: 'b1', issuedTick: 0, dueTick: 10, amount: 50, paidTick: null, stage: 0 }];
    expect(payAll(sim.ctx, null)).toMatch(/Not enough money/);
    expect(unpaidBills(sim.ctx)).toHaveLength(1);
    sim.state.household.funds = 50;
    expect(payAll(sim.ctx, null)).toBe(true);
    expect(sim.state.household.funds).toBe(0);
  });

  it('spamming orderPizza charges once', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 1000 });
    const api = sim.sys('food').api!;
    const results = Array.from({ length: 20 }, () => api.orderPizza(sim.member().id, sim.ctx));
    expect(results.filter((r) => r === true)).toHaveLength(1);
    expect(sim.state.household.funds).toBe(965);
  });
});

describe('vanishing targets mid-run', () => {
  it('meal removed while eating, TV removed while watching, fridge removed mid-cook: graceful, no throw', () => {
    const sim = new FakeSim({ objects: [...kitchenLot(), { defId: 'tv_crt', x: 12, z: 12 }, { defId: 'sofa_moldy', x: 12, z: 15 }], members: [{}, {}, {}], funds: 500 });
    const [a, b, c] = [sim.member(0), sim.member(1), sim.member(2)];
    const m = sim.addObject({ defId: 'item_meal', x: 4, z: 2, data: { servings: 4, quality: 3, recipeId: 'brainLoaf' } });
    sim.start(a, IX.haveServing, { kind: 'object', id: m.id });
    sim.start(b, IX.watchTv, { kind: 'object', id: sim.obj('tv_crt').id });
    sim.start(c, IX.cook, { kind: 'object', id: sim.obj('fridge_humming').id }, { recipe: 'brainLoaf' });
    sim.advance(1);
    expect(() => {
      sim.ctx.removeObject(m.id);
      sim.ctx.removeObject(sim.obj('tv_crt').id);
      sim.ctx.removeObject(sim.obj('fridge_humming').id);
      sim.advance(120);
    }).not.toThrow();
    for (const x of [a, b, c]) expect(x.active).toBeNull();
    expect(sim.state.household.funds).toBeGreaterThanOrEqual(488);
  });

  it('effects and requirements tolerate a null actor / missing targets', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    const ec = { actor: null, run: null, def: null, stage: null, targetAgent: null, targetObject: null };
    for (const s of homeSystems) {
      for (const [id, fn] of Object.entries(s.effects ?? {})) expect(() => fn(sim.ctx, ec, {}), id).not.toThrow();
      for (const [id, fn] of Object.entries(s.requirements ?? {})) {
        const def = sim.content.interactions[IX.sit];
        const r = fn(sim.ctx, { actor: sim.member(), def, target: { kind: 'self' }, targetAgent: null, targetObject: null, params: {} }, {});
        expect(r === true || typeof r === 'string', id).toBe(true);
      }
      for (const [id, fn] of Object.entries(s.conditions ?? {})) expect(() => fn(sim.ctx, null, {}), id).not.toThrow();
    }
  });
});

describe('cross-module apis', () => {
  it('a missing or throwing townies.createService falls back to our own service agent', () => {
    const variants: Record<string, (...args: any[]) => any>[] = [
      {},
      {
        createService: () => {
          throw new Error('boom');
        },
      },
      { createService: () => 'a-does-not-exist' },
    ];
    for (const townies of variants) {
      const sim = new FakeSim({ objects: kitchenLot(), funds: 100, extraApis: { townies } });
      expect(sim.sys('food').api!.orderPizza(sim.member().id, sim.ctx)).toBe(true);
      sim.advance(71);
      const npc = sim.state.agents[sim.state.flags[FLAG.pizzaNpc] as string];
      expect(npc).toBeTruthy();
      expect(npc.role).toBe('service');
    }
  });

  it('api methods accept garbage arguments and work without the trailing ctx (registry fallback)', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    const apis = Object.fromEntries(homeSystems.map((s) => [s.id, s.api!]));
    for (const [id, api] of Object.entries(apis)) {
      for (const [name, fn] of Object.entries(api)) {
        for (const args of [[], [undefined], [null], [42], [{}], ['nope'], [NaN, 'x']]) {
          expect(() => fn(...args), `${id}.${name}(${JSON.stringify(args)})`).not.toThrow();
        }
      }
    }
    expect(apis.economy.lotValue()).toBeGreaterThan(0); // resolved through the registry
    expect(apis.decay.decayLevel(sim.member().id)).toBeGreaterThanOrEqual(0);
  });

  it('a trailing ctx always wins over the registry: two simulations stay isolated', () => {
    const a = new FakeSim({ objects: kitchenLot(), funds: 100 });
    const b = new FakeSim({ objects: kitchenLot(), funds: 100 });
    noteCtx(a.ctx);
    noteCtx(b.ctx);
    expect(currentCtx()).toBe(b.ctx);
    const food = homeSystems.find((s) => s.id === 'food')!.api!;
    expect(food.orderPizza(a.member().id, a.ctx)).toBe(true);
    expect(a.state.household.funds).toBe(65);
    expect(b.state.household.funds).toBe(100);
  });

  it('a stale second context sharing a live world (engine world-creation ctx) never captures api calls', () => {
    const a = new FakeSim({ objects: kitchenLot(), funds: 100 });
    const shadow = { ...a.ctx } as typeof a.ctx; // same WorldState object, different ctx (like createNewWorld's engine)
    noteCtx(shadow, true);
    a.advance(10); // a's own hooks keep the shared-state entry current
    const b = new FakeSim({ objects: kitchenLot(), funds: 100 });
    const food = homeSystems.find((s) => s.id === 'food')!.api!;
    expect(food.orderPizza(b.member().id)).toBe(true);
    expect(b.state.household.funds).toBe(65);
    expect(a.state.household.funds).toBe(100);
  });

  it('without a trailing ctx, the simulation that is mid-step is preferred over the idle one', () => {
    const a = new FakeSim({ objects: kitchenLot(), funds: 100 });
    const b = new FakeSim({ objects: kitchenLot(), funds: 100 });
    a.advance(1);
    b.advance(1); // b is the most recently used
    a.state.tick++; // a "starts a new step" (engine increments the tick before agents/behaviours run)
    const food = homeSystems.find((s) => s.id === 'food')!.api!;
    expect(food.orderPizza(a.member().id)).toBe(true);
    expect(a.state.household.funds).toBe(65);
    expect(b.state.household.funds).toBe(100);
  });
});

describe('determinism', () => {
  it('identical setups produce identical worlds after a day of decay, limbs, fires and spoilage', () => {
    const run = () => {
      const sim = new FakeSim({ seed: 77, objects: [...kitchenLot(), { defId: 'sofa_moldy', x: 12, z: 12 }], members: [{ needs: { preservation: 20 } }, { needs: { preservation: 5 }, traits: ['clumsy'] }] });
      startFire(sim.ctx, sim.obj('sofa_moldy'));
      sim.sys('food').api!.orderPizza(sim.member().id, sim.ctx);
      sim.advance(24 * 60);
      return JSON.stringify(sim.state);
    };
    expect(run()).toBe(run());
  });
});
