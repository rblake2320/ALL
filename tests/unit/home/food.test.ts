/**
 * food system: cooking (cost, quality, fire, placement), eating (hunger formula, seats, dishes, moodlets, family
 * dinner, poisoning), leftovers & spoilage, snacks, pizza delivery state machine, FoodApi.
 */
import { describe, expect, it } from 'vitest';
import { DATA, FLAG, IX, MOOD } from '../../../src/sim/content/home/ids';
import { fireChance, mealQuality } from '../../../src/sim/systems/home/food/cooking';
import { hungerFor } from '../../../src/sim/systems/home/food/eating';
import { addLeftovers, leftoverCount, LEFTOVER_SPOIL_MIN, readLeftovers, spoiledCount, writeLeftovers } from '../../../src/sim/systems/home/food/leftovers';
import { RECIPES_BY_ID } from '../../../src/sim/content/home/recipes';
import { tickAt } from '../../../src/sim/time';
import { FakeSim, kitchenLot } from './fakeCtx';

const fridge = (sim: FakeSim) => ({ kind: 'object' as const, id: sim.obj('fridge_humming').id });

function meal(sim: FakeSim, data: Record<string, string | number | boolean>, at = { x: 3, z: 3 }) {
  return sim.addObject({ defId: 'item_meal', x: at.x, z: at.z, data: { servings: 4, quality: 3, recipeId: 'brainLoaf', ageMin: 0, spoiled: false, createdTick: 0, ...data } });
}

describe('cooking', () => {
  it('charges the recipe at the fridge, cooks at the stove, places a meal on a surface and serves the cook', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 100, members: [{ skills: { cooking: 3 } }] });
    const a = sim.member();
    expect(sim.start(a, IX.cook, fridge(sim), { recipe: 'cerebellumStew' })).toBeNull();
    expect(sim.state.household.funds).toBe(80);
    expect(a.carrying).toBe('ingredients');
    sim.forcedChance = false; // no fire, no breakage
    sim.runToEnd(a);
    expect(sim.lastOutcome).toBe('complete');
    const m = sim.obj('item_meal');
    expect(m.data).toMatchObject({ servings: 4, quality: 3 + 1 - 1, recipeId: 'cerebellumStew', spoiled: false, cookId: a.id });
    expect(m.placement).toMatchObject({ kind: 'loose' });
    expect((m.placement as { parentId: string | null }).parentId).not.toBeNull(); // counter / table surface
    expect(sim.obj('stove_greasefire').condition.dirt).toBeCloseTo(0.15, 6);
    expect(a.queue[0]).toMatchObject({ interactionId: IX.haveServing, target: { kind: 'object', id: m.id } });
    expect(a.skills.cooking.xp + a.skills.cooking.level).toBeGreaterThan(3);
    expect(sim.ctx.statValue('mealsCooked', a.id)).toBe(1);
  });

  it('computes quality = clamp(base + floor(cooking/3) − 1 + stove bonus, 1, 6)', () => {
    const sim = new FakeSim({ objects: [...kitchenLot(), { defId: 'stove_necrochef', x: 7, z: 2 }] });
    const a = sim.member();
    const loaf = RECIPES_BY_ID.brainLoaf;
    const flambe = RECIPES_BY_ID.medullaFlambe;
    expect(mealQuality(sim.ctx, a, loaf, sim.obj('stove_greasefire'))).toBe(1);
    a.skills.cooking.level = 9;
    expect(mealQuality(sim.ctx, a, loaf, sim.obj('stove_greasefire'))).toBe(4);
    expect(mealQuality(sim.ctx, a, flambe, sim.obj('stove_necrochef'))).toBe(6); // 5+3-1+1 = 8 → clamp 6
  });

  it('fire chance: 3% at cooking 0 (balance pass, was 6% then 4%), −1%/level, ×1.25 grease-fire, ×0.5 necro-chef, ×1.5 clumsy, 0 at 3+', () => {
    const sim = new FakeSim({ objects: [...kitchenLot(), { defId: 'stove_necrochef', x: 7, z: 2 }] });
    const a = sim.member();
    const grease = sim.obj('stove_greasefire');
    const chef = sim.obj('stove_necrochef');
    expect(fireChance(sim.ctx, a, grease)).toBeCloseTo(0.0375, 6);
    expect(fireChance(sim.ctx, a, chef)).toBeCloseTo(0.015, 6);
    a.traits.push('clumsy');
    expect(fireChance(sim.ctx, a, grease)).toBeCloseTo(0.03 * 1.25 * 1.5, 6);
    a.skills.cooking.level = 2;
    expect(fireChance(sim.ctx, a, grease)).toBeCloseTo(0.01 * 1.25 * 1.5, 6);
    a.skills.cooking.level = 3;
    expect(fireChance(sim.ctx, a, grease)).toBe(0);
    a.skills.cooking.level = 4;
    expect(fireChance(sim.ctx, a, grease)).toBe(0);
    a.skills.cooking.level = 6;
    expect(fireChance(sim.ctx, a, grease)).toBe(0);
  });

  it('a fire mid-cook spawns item_fire on the stove and no meal', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 100 });
    const a = sim.member();
    sim.forcedChance = true; // the fire roll happens when the stove stage starts
    sim.start(a, IX.cookAtStove, { kind: 'object', id: sim.obj('stove_greasefire').id }, { recipe: 'brainLoaf' });
    sim.runToEnd(a);
    expect(sim.objs('item_meal')).toHaveLength(0);
    expect(sim.objs('item_fire')).toHaveLength(1);
    expect(sim.obj('item_fire').data[DATA.burningId]).toBe(sim.obj('stove_greasefire').id);
    expect(sim.notificationsText()).toMatch(/went up in flames/);
  });

  it('gates recipes by skill, funds and Cryo-Fridge; refuses with a reason and charges nothing', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 25 });
    const a = sim.member();
    const beh = sim.sys('food').behaviors!.cook;
    const def = sim.content.interactions[IX.cook];
    const choices = beh.choices!(sim.ctx, a, def, fridge(sim));
    const by = Object.fromEntries(choices.map((c) => [c.params.recipe, c.available]));
    expect(by.brainLoaf).toBe(true);
    expect(by.cerebellumStew).toBe('Needs Cooking 2');
    expect(by.medullaFlambe).toBe('Needs Cooking 7');
    a.skills.cooking.level = 7;
    const by2 = Object.fromEntries(beh.choices!(sim.ctx, a, def, fridge(sim)).map((c) => [c.params.recipe, c.available]));
    expect(by2.medullaFlambe).toBe('Needs a Cryo-Fridge');
    expect(by2.frontalLasagna).toMatch(/Can’t afford/);
    expect(sim.start(a, IX.cook, fridge(sim), { recipe: 'frontalLasagna' })).toMatch(/Can’t afford/);
    expect(sim.state.household.funds).toBe(25);
  });

  it('autonomy (no recipe param) picks the best affordable dish', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 2000, members: [{ skills: { cooking: 4 } }] });
    const a = sim.member();
    sim.forcedChance = false;
    sim.start(a, IX.cook, fridge(sim), {}, { source: 'auto' });
    sim.runToEnd(a);
    expect(sim.obj('item_meal').data.recipeId).toBe('frontalLasagna');
  });

  it('never double-charges a re-queued (suspended) cook and refunds only on failure before cooking', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 100 });
    const a = sim.member();
    sim.start(a, IX.cook, fridge(sim), { recipe: 'brainLoaf' });
    const uid = a.active!.uid;
    // A suspension (engine queue.ts suspendActive): the fresh copy is queued FIRST, then the run is canceled.
    a.queue.unshift({ uid: 9001, interactionId: IX.cook, target: fridge(sim), params: { recipe: 'brainLoaf', _origUid: uid }, source: 'player', priority: 200, queuedTick: 0 });
    sim.cancel(a);
    expect(sim.state.household.funds).toBe(88); // the copy will cook with these groceries: no refund
    a.queue = [];
    sim.start(a, IX.cook, fridge(sim), { recipe: 'brainLoaf', _origUid: uid });
    expect(sim.state.household.funds).toBe(88); // same key → no second charge
    // power dies before the stove stage → the cook fails → groceries returned (once)
    sim.state.household.utilitiesOn = false;
    sim.runToEnd(a);
    expect(sim.lastOutcome).toBe('failed');
    expect(sim.state.household.funds).toBe(100);
  });

  it('a real cancel after shopping (player cancel / preempted auto run) returns the groceries exactly once', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 100 });
    const a = sim.member();
    sim.forcedChance = false; // no fire, no breakage
    sim.start(a, IX.cook, fridge(sim), { recipe: 'brainLoaf' });
    expect(sim.state.household.funds).toBe(88);
    const key = `cookRefund:${a.active!.uid}`;
    sim.cancel(a); // nothing re-queued → a real cancel
    expect(sim.state.household.funds).toBe(100);
    expect(sim.state.household.txLog).toContain(key);
    sim.ctx.earn(12, 'replayed refund', key); // the same idempotency key never pays out twice
    expect(sim.state.household.funds).toBe(100);
    // Canceled while already cooking: the food is wasted, no refund.
    sim.start(a, IX.cook, fridge(sim), { recipe: 'brainLoaf' });
    sim.advance(3); // → stove stage, cooking
    expect(a.active?.stage).toBe(1);
    sim.cancel(a);
    expect(sim.state.household.funds).toBe(88);
  });
});

describe('eating', () => {
  it('hunger per serving = recipe.hunger × (0.8 + 0.1 × quality), halved when spoiled', () => {
    expect(hungerFor('brainLoaf', 2, false)).toBeCloseTo(45, 6);
    expect(hungerFor('frontalLasagna', 5, false)).toBeCloseTo(78, 6);
    expect(hungerFor('frontalLasagna', 5, true)).toBeCloseTo(39, 6);
  });

  it('seated at a table: takes a serving, eats gradually, leaves a dish on the table', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    const a = sim.member();
    a.needs.hunger = 20;
    const m = meal(sim, { quality: 5, recipeId: 'cerebellumStew' }, { x: 4, z: 2 });
    sim.start(a, IX.haveServing, { kind: 'object', id: m.id });
    sim.runToEnd(a);
    expect(m.data.servings).toBe(3);
    // 55 × 1.3 = 71.5 minus ~20 min of (fake: no base) decay
    expect(a.needs.hunger).toBeCloseTo(20 + 71.5, 0);
    expect(sim.ctx.hasMoodlet(a, MOOD.deliciousMeal)).toBe(true);
    expect(sim.ctx.hasMoodlet(a, MOOD.ateStandingUp)).toBe(false);
    const dish = sim.obj('item_dish');
    expect((dish.placement as { parentId: string | null }).parentId).toBe(sim.obj('table_rickety').id);
  });

  it('no free seat → eats standing (standEat), Ate Standing Up, dish on the floor', () => {
    const sim = new FakeSim({ objects: [{ defId: 'fridge_humming', x: 2, z: 2 }] });
    const a = sim.member();
    a.needs.hunger = 30;
    const m = meal(sim, { quality: 1 }, { x: 5, z: 5 });
    sim.start(a, IX.haveServing, { kind: 'object', id: m.id });
    sim.advance(2);
    expect(a.anim).toBe('standEat');
    sim.runToEnd(a);
    expect(sim.ctx.hasMoodlet(a, MOOD.ateStandingUp)).toBe(true);
    expect(sim.ctx.hasMoodlet(a, MOOD.questionableMeal)).toBe(true);
    expect((sim.obj('item_dish').placement as { parentId: string | null }).parentId).toBeNull();
  });

  it('two household members eating together get social and Family Dinner', () => {
    const sim = new FakeSim({ objects: kitchenLot(), members: [{ firstName: 'A' }, { firstName: 'B' }] });
    const [a, b] = [sim.member(0), sim.member(1)];
    a.needs.social = 10;
    const m = meal(sim, {}, { x: 4, z: 2 });
    sim.start(a, IX.haveServing, { kind: 'object', id: m.id });
    sim.advance(1.5); // A has taken a serving and sat down; the platter's grab slot is free again
    sim.start(b, IX.haveServing, { kind: 'object', id: m.id });
    sim.runToEnd(a);
    sim.runToEnd(b);
    expect(a.needs.social).toBeGreaterThan(10);
    expect(sim.ctx.hasMoodlet(a, MOOD.familyDinner)).toBe(true);
    expect(sim.ctx.hasMoodlet(b, MOOD.familyDinner)).toBe(true);
  });

  it('spoiled food: 60% Food Poisoning, Cast-Iron Stomach immune; poisoning drains hunger faster', () => {
    for (const iron of [false, true]) {
      const sim = new FakeSim({ objects: kitchenLot() });
      const a = sim.member();
      if (iron) a.rewardTraits.push('castIronStomach');
      const m = meal(sim, { spoiled: true });
      sim.forcedChance = true;
      sim.start(a, IX.haveServing, { kind: 'object', id: m.id });
      sim.runToEnd(a);
      expect(sim.ctx.hasMoodlet(a, MOOD.foodPoisoning)).toBe(!iron);
      if (!iron) {
        const h = a.needs.hunger;
        sim.advance(60);
        expect(h - a.needs.hunger).toBeCloseTo(2.75, 3);
      }
    }
  });

  it('the last serving empties the platter; the sweep clears it once nobody uses it', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    const a = sim.member();
    a.needs.hunger = 10;
    const m = meal(sim, { servings: 1 });
    sim.start(a, IX.haveServing, { kind: 'object', id: m.id });
    sim.runToEnd(a);
    expect(sim.lastOutcome).toBe('complete');
    sim.advance(10);
    expect(sim.state.objects[m.id]).toBeUndefined();
    expect(sim.canStart(a, IX.haveServing, { kind: 'object', id: m.id })).not.toBe(true);
  });

  it('Grab Brain Jerky costs $5 (engine cost), restores 18, leaves no dish, and (quality 1, GDD §5) is "questionable"', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 10 });
    const a = sim.member();
    a.needs.hunger = 40;
    sim.start(a, IX.grabJerky, fridge(sim));
    sim.runToEnd(a);
    expect(sim.state.household.funds).toBe(5);
    expect(a.needs.hunger).toBeCloseTo(58, 3);
    expect(sim.objs('item_dish')).toHaveLength(0);
    expect(sim.ctx.hasMoodlet(a, MOOD.questionableMeal)).toBe(true);
  });

  it('Microwave a Brain Burrito: 6 min at the microwave, then eat (quality 2, hunger 40)', () => {
    const sim = new FakeSim({ objects: [...kitchenLot(), { defId: 'microwave_nuke', x: 8, z: 2 }], funds: 20 });
    const a = sim.member();
    a.needs.hunger = 30;
    sim.forcedChance = false;
    sim.start(a, IX.microwaveBurrito, { kind: 'object', id: sim.obj('microwave_nuke').id });
    sim.runToEnd(a);
    expect(sim.state.household.funds).toBe(12);
    expect(a.needs.hunger).toBeCloseTo(30 + 40, 3);
  });
});

describe('leftovers', () => {
  it('Put Away Leftovers stores servings in the fridge; Eat Leftovers takes one', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    const a = sim.member();
    const m = meal(sim, { servings: 3, quality: 4, recipeId: 'frontalLasagna', ageMin: 30 });
    sim.start(a, IX.putAwayLeftovers, { kind: 'object', id: m.id });
    sim.runToEnd(a);
    const f = sim.obj('fridge_humming');
    expect(sim.state.objects[m.id]).toBeUndefined();
    expect(readLeftovers(f)).toEqual([{ s: 3, q: 4, r: 'frontalLasagna', a: 30 }]);
    expect(f.data.leftoverServings).toBe(3);
    const beh = sim.sys('food').behaviors!.eat;
    expect(beh.label!(sim.ctx, a, sim.content.interactions[IX.eatLeftovers], fridge(sim))).toBe('Eat Leftovers (3)');
    a.needs.hunger = 20;
    sim.start(a, IX.eatLeftovers, fridge(sim));
    sim.runToEnd(a);
    expect(leftoverCount(f)).toBe(2);
    expect(a.needs.hunger).toBeCloseTo(20 + 60 * 1.2, 0);
  });

  it('spoil after 48 h, twice as fast without power, half as fast in a Cryo-Fridge', () => {
    const sim = new FakeSim({ objects: [...kitchenLot(), { defId: 'fridge_cryo', x: 9, z: 2 }], systems: undefined });
    const humming = sim.obj('fridge_humming');
    const cryo = sim.obj('fridge_cryo');
    addLeftovers(sim.ctx, humming, { s: 2, q: 3, r: 'brainLoaf', a: 0 });
    addLeftovers(sim.ctx, cryo, { s: 2, q: 3, r: 'brainLoaf', a: 0 });
    sim.advance(24 * 60);
    expect(readLeftovers(humming)[0].a).toBeCloseTo(24 * 60, 0);
    expect(readLeftovers(cryo)[0].a).toBeCloseTo(12 * 60, 0);
    humming.condition.broken = true; // broken = no cooling = ×2
    sim.advance(12 * 60);
    expect(readLeftovers(humming)[0].a).toBeCloseTo(48 * 60, 0);
    expect(spoiledCount(humming)).toBe(2);
    expect(spoiledCount(cryo)).toBe(0);
  });

  it('respects fridge capacity and tosses spoiled servings on request', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    const f = sim.obj('fridge_humming');
    expect(addLeftovers(sim.ctx, f, { s: 31, q: 3, r: 'brainLoaf', a: 0 })).toBe('The fridge is full');
    writeLeftovers(sim.ctx, f, [
      { s: 2, q: 3, r: 'brainLoaf', a: LEFTOVER_SPOIL_MIN + 1 },
      { s: 1, q: 4, r: 'cerebellumStew', a: 10 },
    ]);
    const a = sim.member();
    expect(sim.canStart(a, IX.cleanFridge, fridge(sim))).toBe(true);
    sim.start(a, IX.cleanFridge, fridge(sim));
    sim.runToEnd(a);
    expect(readLeftovers(f)).toEqual([{ s: 1, q: 4, r: 'cerebellumStew', a: 10 }]);
    expect(sim.canStart(a, IX.cleanFridge, fridge(sim))).toBe('Nothing has spoiled');
  });

  it('meals left out spoil after 24 h', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    const m = meal(sim, {});
    sim.advance(25 * 60);
    expect(m.data.spoiled).toBe(true);
  });
});

describe('pizza delivery', () => {
  it('charges $35 once, rejects a second order, delivers 50–70 min later via a service NPC and sends it home', () => {
    const created: string[] = [];
    let sim!: FakeSim;
    sim = new FakeSim({
      objects: kitchenLot(),
      funds: 100,
      extraApis: {
        townies: {
          createService: (kind: string) => {
            const a = sim.ctx.createAgent({ role: 'service', presence: 'offLot', firstName: 'Pizza', lastName: 'Ghoul', appearance: sim.member().appearance, traits: [] });
            created.push(`${kind}:${a.id}`);
            return a.id;
          },
        },
      },
    });
    const a = sim.member();
    const api = sim.sys('food').api!;
    expect(api.orderPizza(a.id, sim.ctx)).toBe(true);
    expect(sim.state.household.funds).toBe(65);
    expect(api.orderPizza(a.id, sim.ctx)).toMatch(/already on its way/);
    expect(sim.state.household.funds).toBe(65);
    sim.advance(49);
    expect(created).toEqual([]);
    sim.advance(22);
    expect(created).toHaveLength(1);
    const npc = sim.state.agents[created[0].split(':')[1]];
    expect(npc.presence).toBe('onLot');
    expect(npc.queue[0].interactionId).toBe(IX.deliverPizza);
    // run the delivery like the engine would
    const qi = npc.queue.shift()!;
    sim.start(npc, qi.interactionId, qi.target, {}, { source: 'system' });
    sim.runToEnd(npc);
    const pizza = sim.obj('item_pizza');
    expect(pizza.data).toMatchObject({ servings: 6, quality: 3, recipeId: 'brainPizza' });
    sim.advance(1);
    expect(sim.sentOffLot.map((s) => s.agentId)).toContain(npc.id);
    expect(npc.presence).toBe('gone');
    sim.advance(1);
    expect(sim.state.flags[FLAG.pizzaNpc]).toBeUndefined();
    expect(api.pizzaPending(sim.ctx)).toBe(false);
  });

  it('falls back to its own service agent when townies has no createService, and a watchdog delivers if stuck', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 100 });
    const api = sim.sys('food').api!;
    expect(api.orderPizza(sim.member().id, sim.ctx)).toBe(true);
    sim.advance(71);
    const npcId = sim.state.flags[FLAG.pizzaNpc] as string;
    expect(sim.state.agents[npcId]).toMatchObject({ role: 'service', firstName: 'Pepperoni' });
    // never run its queue (stuck) → watchdog after 120 min
    sim.advance(125);
    expect(sim.objs('item_pizza')).toHaveLength(1);
    expect(sim.state.agents[npcId].presence).toBe('gone');
  });

  it('reuses its idle fallback ghoul for the next order instead of piling up agents', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 1000 });
    const api = sim.sys('food').api!;
    const ghouls = () => Object.values(sim.state.agents).filter((x) => x.role === 'service');
    for (let i = 0; i < 3; i++) {
      expect(api.orderPizza(sim.member().id, sim.ctx)).toBe(true);
      sim.advance(71);
      sim.advance(125); // watchdog delivers & dismisses
    }
    expect(sim.objs('item_pizza')).toHaveLength(3);
    expect(ghouls()).toHaveLength(1);
  });

  it('refuses without money, for non-members, or unknown agents', () => {
    const sim = new FakeSim({ objects: kitchenLot(), funds: 30, members: [{}, { role: 'townie' }] });
    const api = sim.sys('food').api!;
    expect(api.orderPizza(sim.member().id, sim.ctx)).toMatch(/Not enough money/);
    const townie = Object.values(sim.state.agents).find((x) => x.role === 'townie')!;
    expect(api.orderPizza(townie.id, sim.ctx)).toMatch(/household/);
    expect(api.orderPizza('ghost', sim.ctx)).toMatch(/Nobody/);
    expect(sim.state.household.funds).toBe(30);
  });
});

describe('objectDetail', () => {
  it('describes meals, fridges, limbs, bone piles, easels, mailboxes; null for unknown', () => {
    const sim = new FakeSim({ objects: [...kitchenLot(), { defId: 'easel_morbid', x: 9, z: 9 }], tick: tickAt(1, 10 * 60) });
    const api = sim.sys('food').api!;
    const m = meal(sim, { servings: 2, quality: 4, mealName: 'Cerebellum Stew' });
    expect(api.objectDetail(m.id, sim.ctx)).toBe('Servings: 2 · Quality 4/6 · Cerebellum Stew');
    expect(api.objectDetail(sim.obj('fridge_humming').id, sim.ctx)).toBe('No leftovers');
    sim.obj('easel_morbid').data.progress = 0.45;
    expect(api.objectDetail(sim.obj('easel_morbid').id, sim.ctx)).toBe('Painting in progress: 45%');
    expect(api.objectDetail(sim.obj('mailbox_crooked').id, sim.ctx)).toBe('Nothing waiting');
    expect(api.objectDetail('o999999', sim.ctx)).toBeNull();
    expect(api.objectDetail(undefined, sim.ctx)).toBeNull();
  });
});
