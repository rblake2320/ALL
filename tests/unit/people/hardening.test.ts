/**
 * Hardening-pass regressions (fake SimContext): the doorbell schedule that survives a restarted door wait,
 * stale door waits after a welcome, the emergency autonomous pizza, socials that never buttonhole zombies on
 * their way out, the fun-aware social appetite, and the Loner / conversation advertise tuning.
 */
import { describe, expect, it } from 'vitest';
import { createFakeSim } from './fakeCtx';
import type { SimSystem } from '../../../src/sim/contracts';
import type { AgentState, ObjectState } from '../../../src/sim/types';
import { arriveNow, queueDoorWait } from '../../../src/sim/systems/people/townies/visitorOps';
import { BELL_FLAG, maybeRingDoorbell } from '../../../src/sim/systems/people/townies/visitors';
import { autoPizzaScore, foodOnLot, pizzaCandidate, PIZZA_ORDER_FLAG, PIZZA_REORDER_COOLDOWN_MIN } from '../../../src/sim/systems/people/townies/phone';
import { startParty } from '../../../src/sim/systems/people/townies/party';
import { appetiteNeed } from '../../../src/sim/systems/people/social';
import { SOCIAL_INTERACTIONS, SOCIAL_NEED_GAIN } from '../../../src/sim/content/people/socialInteractions';
import { TRAITS_BY_ID } from '../../../src/sim/content/people/traits';

function town(extraSystems: SimSystem[] = []) {
  const base = createFakeSim({ household: ['Mortimer', 'Ghoulia'], initSystems: false });
  const sim = extraSystems.length ? createFakeSim({ household: ['Mortimer', 'Ghoulia'], initSystems: false, systems: [...base.systems, ...extraSystems] }) : base;
  sim.ctx.content.lifeEvents.length = 0;
  for (const s of sim.systems) s.init?.(sim.ctx, false);
  const [m, g] = sim.state.household.memberIds.map((id) => sim.state.agents[id]);
  const towns = Object.values(sim.state.agents).filter((a) => a.role === 'townie');
  return { sim, m, g, towns };
}

const doorbells = (sim: ReturnType<typeof createFakeSim>, id: string, from = 0) =>
  sim.events.slice(from).filter((e) => e.type === 'sfx' && e.id === 'doorbell' && e.agentId === id).length;

describe('doorbell schedule (per visit, survives restarted door waits)', () => {
  it('rings on arrival at the door, not again when the wait restarts after a social, every 20 min, max 3', () => {
    const { sim, towns } = town();
    const v = towns[2];
    expect(arriveNow(sim.ctx, v, 'dropIn')).toBe(true);
    const beh = sim.behavior('visit');
    const def = sim.ctx.content.interactions.visit_waitAtDoor;
    const run1 = sim.makeRun(v, 'visit_waitAtDoor', v.queue[0].target);
    run1.source = 'system';
    expect(beh.begin!(sim.ctx, v, run1, def)).toBeNull();
    expect(beh.startStage!(sim.ctx, v, run1, def, 0)).toBeNull();
    expect(doorbells(sim, v.id)).toBe(1);
    // a household zombie introduces themselves 5 minutes later: the engine suspends + re-queues the door wait
    sim.advanceMinutes(5);
    const run2 = sim.makeRun(v, 'visit_waitAtDoor', v.queue[0]?.target ?? { kind: 'tile', x: 15, z: 20 });
    expect(beh.startStage!(sim.ctx, v, run2, def, 0)).toBeNull();
    expect(doorbells(sim, v.id)).toBe(1); // no instant re-ring
    for (let i = 0; i < 4 * 70; i++) {
      sim.state.tick++;
      beh.tick!(sim.ctx, v, run2, def, 0.25);
    }
    expect(doorbells(sim, v.id)).toBe(3); // +20 and +40 minutes, then the cap
    const run3 = sim.makeRun(v, 'visit_waitAtDoor', { kind: 'tile', x: 15, z: 20 });
    beh.startStage!(sim.ctx, v, run3, def, 0);
    expect(doorbells(sim, v.id)).toBe(3); // a later restart can't reset the cap
    // leaving the lot forgets the schedule
    sim.ctx.despawnAgent(v.id, 'offLot');
    expect(sim.state.flags[`people:${BELL_FLAG(v.id)}`]).toBeUndefined();
  });

  it('a welcomed visitor’s stale door wait is refused before it starts; party guests still walk up once', () => {
    const { sim, m, towns } = town();
    const beh = sim.behavior('visit');
    const def = sim.ctx.content.interactions.visit_waitAtDoor;
    const v = towns[3];
    arriveNow(sim.ctx, v, 'dropIn');
    expect(v.queue[0].params.greet).toBeUndefined();
    v.visit!.welcomed = true;
    const stale = sim.makeRun(v, 'visit_waitAtDoor', v.queue[0].target);
    expect(beh.begin!(sim.ctx, v, stale, def)).toMatch(/Already inside/);
    expect(beh.startStage!(sim.ctx, v, stale, def, 0)).toMatch(/Already inside/);
    expect(doorbells(sim, v.id)).toBe(0);
    // party guests are pre-welcomed but walk up to the door once and ring
    m.needs.fun = 90;
    expect(startParty(sim.ctx, m.id)).toBe(true);
    const guest = towns.find((t) => t.presence === 'offLot' && sim.state.flags[`people:arrive:${t.id}`] !== undefined)!;
    expect(arriveNow(sim.ctx, guest, 'party')).toBe(true);
    expect(guest.visit).toMatchObject({ reason: 'party', welcomed: true });
    const q = guest.queue.find((x) => x.interactionId === 'visit_waitAtDoor')!;
    expect(q.params.greet).toBe(true);
    const greet = sim.makeRun(guest, 'visit_waitAtDoor', q.target, q.params);
    expect(beh.begin!(sim.ctx, guest, greet, def)).toBeNull();
    expect(beh.startStage!(sim.ctx, guest, greet, def, 0)).toBeNull();
    expect(doorbells(sim, guest.id)).toBe(1);
    expect(beh.tick!(sim.ctx, guest, greet, def, 0.25)).toBe('done');
    // re-queueing a door wait for a welcomed non-party visitor keeps refusing; junk never throws
    queueDoorWait(sim.ctx, v);
    expect(v.queue[0].params.greet).toBe(true); // welcomed → a greet walk, which is harmless and finishes at once
    expect(maybeRingDoorbell(sim.ctx, { ...v, visit: null } as AgentState, def)).toBe(false);
  });
});

describe('emergency pizza (the only autonomous phone call)', () => {
  function withFood() {
    const orders: string[] = [];
    let reply: true | string = true;
    const food: SimSystem = { id: 'food', api: { orderPizza: (id: string) => (orders.push(id), reply) } };
    const t = town([food]);
    return { ...t, orders, setReply: (r: true | string) => (reply = r) };
  }
  function put(sim: ReturnType<typeof createFakeSim>, defId: string, data: ObjectState['data'] = {}): ObjectState {
    return sim.ctx.spawnObject(defId, { kind: 'floor', x: 12, z: 14, rot: 0 }, { data });
  }

  it('foodOnLot: working powered fridge/microwave or a meal with servings left counts; nothing else does', () => {
    const { sim } = withFood();
    expect(foodOnLot(sim.ctx)).toBe(false); // fixture lot: a door and a mailbox
    const fridge = put(sim, 'fridge_humming');
    expect(foodOnLot(sim.ctx)).toBe(true);
    fridge.condition.broken = true;
    expect(foodOnLot(sim.ctx)).toBe(false);
    fridge.condition.broken = false;
    sim.state.household.utilitiesOn = false;
    expect(foodOnLot(sim.ctx)).toBe(false);
    sim.ctx.removeObject(fridge.id);
    sim.state.household.utilitiesOn = true;
    const micro = put(sim, 'microwave_nuke');
    expect(foodOnLot(sim.ctx)).toBe(true);
    micro.condition.burning = true;
    expect(foodOnLot(sim.ctx)).toBe(false);
    sim.ctx.removeObject(micro.id);
    const meal = put(sim, 'item_meal', { servings: 2 });
    expect(foodOnLot(sim.ctx)).toBe(true);
    meal.data.spoiled = true;
    expect(foodOnLot(sim.ctx)).toBe(false);
    meal.data.spoiled = false;
    meal.data.servings = 0;
    expect(foodOnLot(sim.ctx)).toBe(false);
    meal.data.servings = Number.NaN;
    expect(foodOnLot(sim.ctx)).toBe(false);
    sim.state.objects.oBroken = { ...meal, id: 'oBroken', defId: 'no_such_def' };
    expect(() => foodOnLot(sim.ctx)).not.toThrow();
  });

  it('opens only for a hungry (or feral) household zombie who can pay, with nothing to eat and no recent order', () => {
    const { sim, m, towns } = withFood();
    m.needs.hunger = 50;
    expect(autoPizzaScore(sim.ctx, m, 40)).toBe(0); // not hungry enough
    m.needs.hunger = 30;
    expect(autoPizzaScore(sim.ctx, m, 40)).toBe(40);
    expect(pizzaCandidate(sim.ctx, m)).toEqual({ interactionId: 'phone_orderPizza', target: { kind: 'self' } });
    m.needs.hunger = 60;
    m.status.feral = true;
    expect(autoPizzaScore(sim.ctx, m, 40)).toBe(40); // feral overrides the threshold
    m.status.feral = false;
    m.needs.hunger = 30;
    for (const bad of [Number.NaN, -5, 0]) expect(autoPizzaScore(sim.ctx, m, bad)).toBe(0);
    sim.state.household.funds = 34;
    expect(autoPizzaScore(sim.ctx, m, 40)).toBe(0);
    sim.state.household.funds = 1000;
    const v = towns[0];
    arriveNow(sim.ctx, v, 'dropIn');
    v.needs.hunger = 5;
    expect(autoPizzaScore(sim.ctx, v, 40)).toBe(0); // visitors never order on the household's dime
    put(sim, 'fridge_humming');
    expect(autoPizzaScore(sim.ctx, m, 40)).toBe(0);
    expect(pizzaCandidate(sim.ctx, m)).toBeNull();
    // and with no food system at all there is nothing to call
    const bare = town();
    bare.m.needs.hunger = 10;
    expect(autoPizzaScore(bare.sim.ctx, bare.m, 40)).toBe(0);
  });

  it('an order closes the gate for 3 h; autonomy candidates carry it; other phone calls are vetoed', () => {
    const { sim, m, orders, setReply } = withFood();
    m.needs.hunger = 20;
    const towniesSys = sim.systems.find((s) => s.id === 'townies')!;
    expect(towniesSys.autonomyCandidates!(sim.ctx, m).map((c) => c.interactionId)).toContain('phone_orderPizza');
    const beh = sim.behavior('phone');
    const ix = sim.ctx.content.interactions;
    expect(beh.adjustScore!(sim.ctx, m, ix.phone_throwParty, { kind: 'self' }, 50)).toBe(0);
    expect(beh.adjustScore!(sim.ctx, m, ix.phone_orderPizza, { kind: 'self' }, 50)).toBe(50);
    const run = sim.makeRun(m, 'phone_orderPizza', { kind: 'self' });
    run.source = 'auto';
    beh.completeStage!(sim.ctx, m, run, ix.phone_orderPizza, 0);
    expect(orders).toEqual([m.id]);
    expect(sim.state.flags[`people:${PIZZA_ORDER_FLAG}`]).toBe(sim.state.tick);
    expect(beh.adjustScore!(sim.ctx, m, ix.phone_orderPizza, { kind: 'self' }, 50)).toBe(0);
    expect(towniesSys.autonomyCandidates!(sim.ctx, m).map((c) => c.interactionId)).not.toContain('phone_orderPizza');
    sim.state.tick += PIZZA_REORDER_COOLDOWN_MIN * 4;
    expect(beh.adjustScore!(sim.ctx, m, ix.phone_orderPizza, { kind: 'self' }, 50)).toBe(50);
    // a refused autonomous order fails quietly; the same refusal for the player is reported
    setReply('A pizza is already on its way');
    const notes = sim.state.notifications.length;
    const auto = sim.makeRun(m, 'phone_orderPizza', { kind: 'self' });
    auto.source = 'auto';
    beh.completeStage!(sim.ctx, m, auto, ix.phone_orderPizza, 0);
    expect(sim.state.notifications.length).toBe(notes);
    const player = sim.makeRun(m, 'phone_orderPizza', { kind: 'self' });
    beh.completeStage!(sim.ctx, m, player, ix.phone_orderPizza, 0);
    expect(sim.notifications().slice(-1)[0]).toMatch(/couldn’t order a pizza: A pizza is already on its way/);
  });
});

describe('social autonomy guards added while hardening', () => {
  it('never buttonholes a zombie heading for the carpool or a guest on their way out', () => {
    const { sim, m, g, towns } = town();
    const beh = sim.behavior('social');
    const ix = sim.ctx.content.interactions;
    m.needs.social = 30;
    expect(beh.adjustScore!(sim.ctx, m, ix.social_chat, { kind: 'agent', id: g.id }, 20)).toBeGreaterThan(0);
    sim.ctx.queue(g, { interactionId: 'career_goToWork', target: { kind: 'self' }, source: 'system', priority: 300 });
    expect(beh.adjustScore!(sim.ctx, m, ix.social_chat, { kind: 'agent', id: g.id }, 20)).toBe(0);
    g.queue = [];
    g.active = sim.makeRun(g, 'career_goToWork', { kind: 'self' });
    expect(beh.adjustScore!(sim.ctx, m, ix.social_joke, { kind: 'agent', id: g.id }, 20)).toBe(0);
    g.active = null;
    const v = towns[1];
    arriveNow(sim.ctx, v, 'dropIn');
    v.visit!.welcomed = true;
    expect(beh.adjustScore!(sim.ctx, m, ix.social_chat, { kind: 'agent', id: v.id }, 20)).toBeGreaterThan(0);
    v.visit!.leaving = true;
    expect(beh.adjustScore!(sim.ctx, m, ix.social_chat, { kind: 'agent', id: v.id }, 20)).toBe(0);
  });

  it('one host per duty: nobody else rushes to welcome / wave at a guest someone is already handling', () => {
    const { sim, m, g, towns } = town();
    const beh = sim.behavior('social');
    const ix = sim.ctx.content.interactions;
    const v = towns[4];
    arriveNow(sim.ctx, v, 'dropIn');
    expect(beh.adjustScore!(sim.ctx, g, ix.social_welcome, { kind: 'agent', id: v.id }, 30)).toBeGreaterThan(0);
    m.active = sim.makeRun(m, 'social_welcome', { kind: 'agent', id: v.id });
    expect(beh.adjustScore!(sim.ctx, g, ix.social_welcome, { kind: 'agent', id: v.id }, 30)).toBe(0);
    expect(beh.adjustScore!(sim.ctx, m, ix.social_welcome, { kind: 'agent', id: v.id }, 30)).toBeGreaterThan(0); // the host itself
    m.active = null;
    sim.ctx.queue(m, { interactionId: 'social_welcome', target: { kind: 'agent', id: v.id }, source: 'auto' });
    expect(beh.adjustScore!(sim.ctx, g, ix.social_welcome, { kind: 'agent', id: v.id }, 30)).toBe(0);
    // ordinary socials are not exclusive: two zombies may both chat with the same guest
    v.visit!.welcomed = true;
    m.queue = [];
    m.active = sim.makeRun(m, 'social_chat', { kind: 'agent', id: v.id });
    g.needs.social = 30;
    expect(beh.adjustScore!(sim.ctx, g, ix.social_chat, { kind: 'agent', id: v.id }, 20)).toBeGreaterThan(0);
  });

  it('the social behaviour wired to a def without a SocialDef refuses politely and never throws', () => {
    const { sim, m, g } = town();
    const beh = sim.behavior('social');
    const bogus = { ...sim.ctx.content.interactions.social_chat, id: 'mod_bogus', social: undefined };
    const run = sim.makeRun(m, 'social_chat', { kind: 'agent', id: g.id });
    expect(beh.begin!(sim.ctx, m, run, bogus)).toMatch(/Not a social/);
    expect(beh.startStage!(sim.ctx, m, run, bogus, 0)).toMatch(/Not a social/);
    run.elapsed = 9;
    expect(() => beh.tick!(sim.ctx, m, run, bogus, 0.25)).not.toThrow();
    expect(beh.tick!(sim.ctx, m, run, bogus, 0.25)).toBe('done');
    expect(() => beh.completeStage!(sim.ctx, m, run, bogus, 0)).not.toThrow();
    expect(() => beh.end!(sim.ctx, m, { ...run, data: { reacted: true } }, bogus, 'canceled')).not.toThrow();
    expect(beh.adjustScore!(sim.ctx, m, bogus, { kind: 'agent', id: g.id }, 12)).toBe(12);
  });

  it('a fun social’s appetite is the lower of Company and Amusement', () => {
    const { sim, m } = town();
    const ix = sim.ctx.content.interactions;
    m.needs.social = 90;
    m.needs.fun = 20;
    expect(appetiteNeed(m, ix.social_joke)).toBe(20);
    expect(appetiteNeed(m, ix.social_gossip)).toBe(20);
    expect(appetiteNeed(m, ix.social_chat)).toBe(90);
    m.needs.fun = Number.NaN;
    expect(Number.isFinite(appetiteNeed(m, ix.social_joke))).toBe(true);
  });
});

describe('content tuning (autonomy promises)', () => {
  it('non-hosting socials promise a conversation (2 × the per-social gain); hosting duties stay honest', () => {
    const hosting = new Set(['welcome', 'waveOver', 'inviteToStay', 'askToLeave']);
    for (const d of SOCIAL_INTERACTIONS) {
      const want = hosting.has(String(d.social!.outcome)) ? SOCIAL_NEED_GAIN : SOCIAL_NEED_GAIN * 2;
      expect(d.advertise!.social, d.id).toBe(want);
      expect(d.social!.social, d.id).toBe(SOCIAL_NEED_GAIN); // the real gain is still the GDD +8
      if (d.social!.fun) expect(d.advertise!.fun).toBe(d.social!.fun);
    }
  });

  it('Loners keep a small social penalty (not one that silences them) and still dislike parties', () => {
    expect(TRAITS_BY_ID.loner.tagAd).toEqual({ party: -30, social: -3 });
    expect(TRAITS_BY_ID.loner.needDecay).toEqual({ social: 0.6 });
    expect(TRAITS_BY_ID.socialButterfly.tagAd).toEqual({ party: 25, social: 10 });
  });

  it('a lonely Loner now beats the idle threshold for a chat next door (the old numbers never could)', () => {
    // Engine need scoring (GDD §14): D(v) = (100 − v)² / 100, distance attenuation 1 / (1 + cost / 14), idle < 6;
    // the social behaviour damps non-hosting socials by clamp((100 − Company) / 40, 0, 1).
    const D = (v: number) => ((100 - v) * (100 - v)) / 100;
    const score = (social: number, ad: number, tagAd: number) =>
      ((D(social) - D(Math.min(100, social + ad)) + tagAd) * Math.min(1, Math.max(0, (100 - social) / 40))) / (1 + 5 / 14);
    const chat = SOCIAL_INTERACTIONS.find((d) => d.id === 'social_chat')!;
    const ad = chat.advertise!.social!;
    const loner = TRAITS_BY_ID.loner.tagAd!.social;
    for (const social of [0, 10]) expect(score(social, 8, -10), `old @${social}`).toBeLessThan(6); // silent forever
    for (const social of [0, 10, 15]) expect(score(social, ad, loner), `new @${social}`).toBeGreaterThan(6);
    expect(score(70, ad, loner)).toBeLessThan(6); // and no chatter once content
    expect(score(90, ad, TRAITS_BY_ID.socialButterfly.tagAd!.social)).toBeLessThan(6); // nor for butterflies at 90
  });
});
