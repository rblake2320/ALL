/**
 * Events: life-event runner (conditions, chances, cooldowns, choices), each people life-event effect,
 * the full-moon Moonstruck moodlet, Hopeless Romantic lovesickness and the trait mood modifiers.
 */
import { describe, expect, it } from 'vitest';
import { at, createFakeSim } from './fakeCtx';
import { crowdSize, lovesickCheck, moonCheck, runLifeEvents, traitMoodModifiers } from '../../../src/sim/systems/people/events';
import type { LifeEventDef } from '../../../src/sim/contracts';

function home(names = ['Mortimer']) {
  const sim = createFakeSim({ household: names, initSystems: false });
  for (const s of sim.systems) s.init?.(sim.ctx, false);
  const members = sim.state.household.memberIds.map((id) => sim.state.agents[id]);
  return { sim, z: members[0], members };
}
const nullEc = { actor: null, run: null, def: null, stage: null, targetAgent: null, targetObject: null };

describe('life-event runner', () => {
  it('fires only when the condition holds and the chance hits; stamps a cooldown', () => {
    const { sim } = home();
    const ev: LifeEventDef = { id: 'test_ev', hourlyChance: 1, condition: { kind: 'and', params: { all: [{ kind: 'clockBetween', params: { from: 9, to: 10 } }, { kind: 'eventCooldown', params: { id: 'test_ev', hours: 24 } }] } }, effect: { id: 'event_lottery', params: { amount: 100 } } };
    sim.ctx.content.lifeEvents.splice(0, sim.ctx.content.lifeEvents.length, ev);
    sim.state.tick = at(1, 8);
    runLifeEvents(sim.ctx);
    expect(sim.state.household.funds).toBe(1000);
    sim.state.tick = at(1, 9);
    runLifeEvents(sim.ctx);
    expect(sim.state.household.funds).toBe(1100);
    runLifeEvents(sim.ctx); // cooldown
    expect(sim.state.household.funds).toBe(1100);
    sim.state.tick = at(2, 9);
    runLifeEvents(sim.ctx);
    expect(sim.state.household.funds).toBe(1200);
    expect(sim.ctx.statValue('lifeEvents')).toBe(2);
    sim.ctx.content.lifeEvents.splice(0, 1, { ...ev, id: 'never', hourlyChance: 0 }, { ...ev, id: 'nan', hourlyChance: NaN }, { id: 'nocond', hourlyChance: 1 } as unknown as LifeEventDef);
    sim.state.tick = at(3, 9);
    runLifeEvents(sim.ctx);
    expect(sim.state.household.funds).toBe(1200);
  });

  it('choice events offer a popup bound to a household member with a safe default', () => {
    const { sim, z } = home();
    const chain = sim.ctx.content.lifeEvents.find((e) => e.id === 'ev_chainLetter')!;
    sim.ctx.content.lifeEvents.splice(0, sim.ctx.content.lifeEvents.length, { ...chain, hourlyChance: 1 });
    sim.state.tick = at(1, 9, 5);
    runLifeEvents(sim.ctx);
    const c = sim.state.choices[0];
    expect(c.agentId).toBe(z.id);
    expect(c.options[c.defaultOption].params.forward).toBe(false);
    sim.ctx.runEffect({ id: c.options[0].effect, params: c.options[0].params }, { ...nullEc, actor: z, choice: c });
    expect(sim.ctx.hasMoodlet(z, 'chainLetterSpread')).toBe(true);
  });

  it('the shipped people events have sane conditions (mail at 9, raven by day, robber at 3 AM)', () => {
    const { sim } = home();
    const evs = sim.ctx.content.lifeEvents;
    const cond = (id: string) => evs.find((e) => e.id === id)!.condition;
    sim.state.tick = at(1, 9, 30);
    expect(sim.ctx.evalCondition(cond('ev_lotteryTicket'), null)).toBe(true);
    delete sim.state.objects.o2; // no mailbox, no mail
    expect(sim.ctx.evalCondition(cond('ev_lotteryTicket'), null)).toBe(false);
    sim.state.tick = at(2, 3, 10);
    expect(sim.ctx.evalCondition(cond('ev_graveRobber'), null)).toBe(true);
    sim.ctx.spawnObject('lantern_post', { kind: 'floor', x: 5, z: 24, rot: 0 }, { value: 180 });
    expect(sim.ctx.evalCondition(cond('ev_graveRobber'), null)).toBe(false);
    sim.state.household.utilitiesOn = false; // a dark lantern doesn't scare anyone
    expect(sim.ctx.evalCondition(cond('ev_graveRobber'), null)).toBe(true);
    sim.state.tick = at(2, 12);
    expect(sim.ctx.evalCondition(cond('ev_ravenThief'), null)).toBe(true);
    sim.state.household.funds = 5;
    expect(sim.ctx.evalCondition(cond('ev_ravenThief'), null)).toBe(false);
    expect(sim.ctx.evalCondition(cond('ev_neighbourComplains'), null)).toBe(false);
  });
});

describe('life-event effects', () => {
  it('neighbour complains about a reeking zombie outdoors: friendship −8 + Smell-Shamed', () => {
    const { sim, z } = home();
    sim.addAgent({ firstName: 'Nosy', role: 'townie', presence: 'offLot' });
    z.needs.hygiene = 0;
    z.pos = { x: 5.5, z: 24.5 }; // yard
    sim.state.tick = at(1, 12);
    const cond = sim.ctx.content.lifeEvents.find((e) => e.id === 'ev_neighbourComplains')!.condition;
    expect(sim.ctx.evalCondition(cond, null)).toBe(true);
    sim.ctx.runEffect({ id: 'event_neighbourComplains', params: { friendship: -8 } }, nullEc);
    const r = Object.values(sim.state.relationships)[0];
    expect(r.friendship).toBe(-8);
    expect(sim.ctx.hasMoodlet(z, 'smellShamed')).toBe(true);
    z.needs.hygiene = 50;
    expect(() => sim.ctx.runEffect({ id: 'event_neighbourComplains', params: {} }, nullEc)).not.toThrow();
  });

  it('lottery pays $500 once per tick key; fan letter pays $5–25 + Fan Mail', () => {
    const { sim, z } = home();
    sim.ctx.runEffect({ id: 'event_lottery', params: { amount: 500 } }, nullEc);
    sim.ctx.runEffect({ id: 'event_lottery', params: { amount: 500 } }, nullEc);
    expect(sim.state.household.funds).toBe(1500);
    expect(sim.ctx.hasMoodlet(z, 'lotteryWinner')).toBe(true);
    sim.ctx.runEffect({ id: 'event_lottery', params: { amount: NaN } }, nullEc);
    expect(sim.state.household.funds).toBe(1500);
    sim.state.tick += 1;
    sim.ctx.runEffect({ id: 'event_fanLetter', params: { min: 5, max: 25 } }, nullEc);
    expect(sim.state.household.funds - 1500).toBeGreaterThanOrEqual(5);
    expect(sim.state.household.funds - 1500).toBeLessThanOrEqual(25);
    expect(sim.ctx.hasMoodlet(z, 'fanMail')).toBe(true);
  });

  it('raven steals $10–40 but never more than the household has', () => {
    const { sim, z } = home();
    sim.ctx.runEffect({ id: 'event_ravenThief', params: { min: 10, max: 40 } }, nullEc);
    expect(1000 - sim.state.household.funds).toBeGreaterThanOrEqual(10);
    expect(1000 - sim.state.household.funds).toBeLessThanOrEqual(40);
    expect(sim.ctx.hasMoodlet(z, 'outwittedByBird')).toBe(true);
    sim.state.household.funds = 3;
    sim.state.tick += 1;
    sim.ctx.runEffect({ id: 'event_ravenThief', params: { min: 10, max: 40 } }, nullEc);
    expect(sim.state.household.funds).toBe(0);
    sim.state.tick += 1;
    sim.ctx.runEffect({ id: 'event_ravenThief', params: { min: 10, max: 40 } }, nullEc);
    expect(sim.state.household.funds).toBe(0);
    expect(sim.notifications().join('\n')).toMatch(/disappointed/);
  });

  it('grave-robber steals one cheap outdoor object (never the mailbox or indoor stuff)', () => {
    const { sim, z } = home();
    const indoor = sim.ctx.spawnObject('plant_deadfern', { kind: 'floor', x: 12, z: 13, rot: 0 }, { value: 40 });
    const pricey = sim.ctx.spawnObject('tree_gnarled', { kind: 'floor', x: 3, z: 22, rot: 0 }, { value: 900 });
    sim.ctx.runEffect({ id: 'event_graveRobber', params: { maxValue: 300 } }, nullEc);
    expect(sim.state.objects.o2).toBeTruthy(); // mailbox untouched
    expect(sim.state.objects[indoor.id]).toBeTruthy();
    expect(sim.state.objects[pricey.id]).toBeTruthy();
    expect(sim.ctx.hasMoodlet(z, 'robbed')).toBe(false);
    const gnome = sim.ctx.spawnObject('headstone_decor', { kind: 'floor', x: 4, z: 23, rot: 0 }, { value: 120 });
    sim.ctx.runEffect({ id: 'event_graveRobber', params: { maxValue: 300 } }, nullEc);
    expect(sim.state.objects[gnome.id]).toBeUndefined();
    expect(sim.ctx.hasMoodlet(z, 'robbed')).toBe(true);
  });

  it('chain letter: forwarding annoys up to 3 acquaintances; binning may curse', () => {
    const { sim, z } = home();
    const pals = [0, 1, 2, 3].map((i) => sim.addAgent({ firstName: `P${i}`, role: 'townie', presence: 'offLot' }));
    for (const p of pals) Object.assign(sim.ctx.rel(z.id, p.id), { met: true, friendship: 10 });
    sim.ctx.runEffect({ id: 'event_chainLetter', params: { forward: true, agentId: z.id } }, nullEc);
    expect(pals.map((p) => sim.ctx.rel(z.id, p.id).friendship).filter((f) => f === 9)).toHaveLength(3);
    let cursed = 0;
    for (let i = 0; i < 40; i++) {
      sim.ctx.removeMoodlet(z, 'cursedChainLetter');
      sim.ctx.runEffect({ id: 'event_chainLetter', params: { forward: false, agentId: z.id } }, nullEc);
      if (sim.ctx.hasMoodlet(z, 'cursedChainLetter')) cursed++;
    }
    expect(cursed).toBeGreaterThan(8);
    expect(cursed).toBeLessThan(32);
  });
});

describe('full moon, lovesickness', () => {
  it('Moonstruck once per full-moon night, until dawn', () => {
    const { sim, z } = home();
    sim.state.tick = at(7, 20);
    moonCheck(sim.ctx);
    moonCheck(sim.ctx);
    const m = z.moodlets.find((x) => x.id === 'moonstruck')!;
    expect(m.endTick).toBe(at(8, 6));
    sim.state.tick = at(6, 20);
    sim.ctx.removeMoodlet(z, 'moonstruck');
    moonCheck(sim.ctx);
    expect(sim.ctx.hasMoodlet(z, 'moonstruck')).toBe(false);
    // loaded mid-night (02:00 after day 14's full moon): granted for the rest of the night
    sim.state.tick = at(15, 2);
    moonCheck(sim.ctx);
    expect(z.moodlets.find((x) => x.id === 'moonstruck')!.endTick).toBe(at(15, 6));
  });

  it('Hopeless Romantics get Lovesick after 7 partnerless days; partnering cures it', () => {
    const { sim, z } = home();
    z.traits = ['hopelessRomantic'];
    for (let day = 2; day <= 7; day++) {
      lovesickCheck(sim.ctx, day);
      lovesickCheck(sim.ctx, day); // idempotent per day
    }
    expect(sim.ctx.hasMoodlet(z, 'lovesick')).toBe(false);
    lovesickCheck(sim.ctx, 8);
    expect(sim.ctx.hasMoodlet(z, 'lovesick')).toBe(true);
    const t = sim.addAgent({ firstName: 'Bae', role: 'townie', presence: 'offLot' });
    sim.ctx.rel(z.id, t.id).partners = true;
    lovesickCheck(sim.ctx, 9);
    expect(sim.ctx.hasMoodlet(z, 'lovesick')).toBe(false);
    expect(sim.state.flags[`people:single:${z.id}`]).toBeUndefined();
  });
});

describe('trait mood modifiers', () => {
  it('Night Owl +8 at night / −5 by day; Vain ≥80 +10 / <40 −12', () => {
    const { sim, z } = home();
    z.traits = ['nightOwl', 'vain'];
    sim.state.tick = at(1, 12);
    z.needs.preservation = 80;
    expect(traitMoodModifiers(sim.ctx, z).map((p) => p.value).sort()).toEqual([-5, 10]);
    sim.state.tick = at(1, 22);
    z.needs.preservation = 39.9;
    expect(traitMoodModifiers(sim.ctx, z).map((p) => p.value).sort()).toEqual([-12, 8]);
    z.needs.preservation = 50;
    expect(traitMoodModifiers(sim.ctx, z).map((p) => p.value)).toEqual([8]);
    z.presence = 'offLot';
    expect(traitMoodModifiers(sim.ctx, z)).toEqual([]);
  });

  it('Loners hate 4+ zombies in one room; Social Butterflies love parties', () => {
    const { sim, members } = home(['Lonely', 'B', 'C']);
    const [l] = members;
    l.traits = ['loner'];
    for (const m of members) m.pos = { x: 12.5, z: 13.5 };
    expect(crowdSize(sim.ctx, l)).toBe(3);
    expect(traitMoodModifiers(sim.ctx, l)).toEqual([]);
    const v = sim.addAgent({ firstName: 'Guest', role: 'townie' });
    v.pos = { x: 18.5, z: 18.5 };
    expect(crowdSize(sim.ctx, l)).toBe(4);
    expect(traitMoodModifiers(sim.ctx, l)).toEqual([{ label: 'Too Many Zombies', value: -5 }]);
    for (const m of members) m.pos = { x: 5.5, z: 24.5 }; // outdoors is not a room
    expect(crowdSize(sim.ctx, l)).toBe(0);
    l.traits = ['socialButterfly'];
    expect(traitMoodModifiers(sim.ctx, l)).toEqual([]);
    sim.state.party = { hostId: l.id, startTick: 0, endTick: 99999, guestIds: [], score: 50, ended: false };
    expect(traitMoodModifiers(sim.ctx, l)).toEqual([{ label: 'In Their Element', value: 8 }]);
    sim.state.party.ended = true;
    expect(traitMoodModifiers(sim.ctx, l)).toEqual([]);
  });
});
