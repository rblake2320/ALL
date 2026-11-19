/**
 * economy system: bill issuing & amount, stage progression, power cut / restore, idempotent payAll, the Repo Ghoul,
 * mailbox sync, painting sales, BillsView / lotValue.
 */
import { describe, expect, it } from 'vitest';
import { FLAG, IX, MOOD } from '../../../src/sim/content/home/ids';
import { billAmount, lotValue, payAll, unpaidBills } from '../../../src/sim/systems/home/economy/bills';
import { chooseRepoTargets } from '../../../src/sim/systems/home/economy/repo';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { tickAt } from '../../../src/sim/time';
import { FakeSim, kitchenLot } from './fakeCtx';

/** Day 4 (Thursday) 08:59 — one minute before the first bill. */
const THU_0859 = tickAt(4, 9 * 60 - 1);

function billed(funds = 1000, members = 2) {
  const sim = new FakeSim({ objects: kitchenLot(), funds, members: Array.from({ length: members }, (_, i) => ({ firstName: `M${i}` })), tick: THU_0859 });
  sim.advance(1);
  return sim;
}

describe('bills', () => {
  it('lotValue sums placed objects, walls ($15) and floors; spawned items are worthless', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    const objects = kitchenLot().reduce((n, o) => n + sim.content.objects[o.defId].price, 0);
    expect(lotValue(sim.ctx)).toBe(objects);
    sim.state.lot.walls['h:1:1'] = { paint: ['a', 'b'], openingId: null };
    sim.state.lot.floors[0] = 'floor_marble_black';
    sim.addObject({ defId: 'item_dish', x: 1, z: 1 });
    expect(lotValue(sim.ctx)).toBe(objects + 15 + 14);
  });

  it('are issued Monday & Thursday 09:00 with 40 + round(0.005 × lotValue) + 10 × members (balance pass), due in 3 days', () => {
    const sim = billed();
    const bills = sim.state.household.bills;
    expect(bills).toHaveLength(1);
    const expected = 40 + Math.round(0.005 * lotValue(sim.ctx)) + 10 * 2;
    expect(bills[0]).toMatchObject({ amount: expected, paidTick: null, stage: 0 });
    expect(bills[0].dueTick - bills[0].issuedTick).toBe(3 * TICKS_PER_DAY);
    expect(billAmount(sim.ctx)).toBe(expected);
    // repeated hour hook → still one bill
    sim.sys('economy').hour!(sim.ctx, 9);
    expect(sim.state.household.bills).toHaveLength(1);
    // Friday → nothing; next Monday (day 8) → second bill
    sim.setTick(tickAt(5, 8 * 60 + 59));
    sim.advance(1);
    expect(sim.state.household.bills).toHaveLength(1);
    sim.setTick(tickAt(8, 8 * 60 + 59));
    sim.advance(1);
    expect(sim.state.household.bills).toHaveLength(2);
    // mailbox flag up
    const box = sim.obj('mailbox_crooked');
    expect(box.data).toMatchObject({ bills: 2, flag: true });
  });

  it('remind the day before, final-notice at +3 days, cut the power at +4 and dispatch the repo at +6', () => {
    const sim = billed(100000);
    const bill = sim.state.household.bills[0];
    sim.setTick(bill.dueTick - TICKS_PER_DAY - 1);
    sim.advance(1);
    expect(bill.stage).toBe(1);
    expect(sim.notificationsText()).toMatch(/due tomorrow/i);
    sim.setTick(bill.dueTick + 3 * TICKS_PER_DAY - 1);
    sim.advance(1);
    expect(bill.stage).toBe(2);
    expect(sim.ctx.hasMoodlet(sim.member(), MOOD.finalNotice)).toBe(true);
    expect(sim.state.household.utilitiesOn).toBe(true);
    sim.setTick(bill.dueTick + 4 * TICKS_PER_DAY - 1);
    sim.advance(1);
    expect(bill.stage).toBe(3);
    expect(sim.state.household.utilitiesOn).toBe(false);
    expect(sim.eventsOf('sfx').some((e) => e.id === 'powerOff')).toBe(true);
    expect(sim.ctx.hasMoodlet(sim.member(), MOOD.powerOut)).toBe(true);
    sim.setTick(bill.dueTick + 6 * TICKS_PER_DAY - 1);
    sim.advance(1);
    expect(sim.state.flags[FLAG.repoNpc]).toBeTruthy();
    expect(bill.stage).toBe(4);
  });

  it('payAll is idempotent per bill, restores power and plays powerOn', () => {
    const sim = billed(1000);
    const bill = sim.state.household.bills[0];
    sim.setTick(bill.dueTick + 4 * TICKS_PER_DAY - 1);
    sim.advance(1);
    expect(sim.state.household.utilitiesOn).toBe(false);
    const funds = sim.state.household.funds;
    const owed = unpaidBills(sim.ctx).reduce((n, b) => n + b.amount, 0); // the jump also crossed Thursday 09:00 → 2 bills
    expect(unpaidBills(sim.ctx).length).toBe(2);
    const api = sim.sys('economy').api!;
    expect(api.payAll(sim.member().id, sim.ctx)).toBe(true);
    expect(sim.state.household.funds).toBe(funds - owed);
    expect(sim.state.household.utilitiesOn).toBe(true);
    expect(sim.eventsOf('sfx').some((e) => e.id === 'powerOn')).toBe(true);
    expect(api.payAll(sim.member().id, sim.ctx)).toBe(true);
    expect(sim.state.household.funds).toBe(funds - owed);
    // a replayed payment (crash before paidTick was saved) is not charged twice
    bill.paidTick = null;
    expect(payAll(sim.ctx, sim.member().id)).toBe(true);
    expect(sim.state.household.funds).toBe(funds - owed);
    expect(sim.ctx.hasMoodlet(sim.member(), MOOD.billsPaid)).toBe(true);
  });

  it('payAll stops at the first unaffordable bill with a reason and keeps the earlier ones paid', () => {
    const sim = billed(0);
    const first = sim.state.household.bills[0];
    sim.state.household.bills.push({ id: 'bX', issuedTick: sim.state.tick, dueTick: first.dueTick + 100, amount: 50, paidTick: null, stage: 0 });
    sim.state.household.funds = first.amount + 10;
    expect(payAll(sim.ctx, null)).toMatch(/Not enough money \(\$50 needed\)/);
    expect(first.paidTick).not.toBeNull();
    expect(unpaidBills(sim.ctx).map((b) => b.id)).toEqual(['bX']);
    expect(sim.state.household.funds).toBe(10);
  });

  it('Pay Bills at the mailbox refuses before the walk when broke; pays when solvent', () => {
    const sim = billed(5);
    const a = sim.member();
    expect(sim.start(a, IX.payBills, { kind: 'object', id: sim.obj('mailbox_crooked').id })).toMatch(/Not enough money/);
    sim.state.household.funds = 1000;
    sim.start(a, IX.payBills, { kind: 'object', id: sim.obj('mailbox_crooked').id });
    sim.runToEnd(a);
    expect(unpaidBills(sim.ctx)).toHaveLength(0);
    expect(sim.obj('mailbox_crooked').data.flag).toBe(false);
    expect(sim.canStart(a, IX.payBills, { kind: 'object', id: sim.obj('mailbox_crooked').id })).toBe('No bills to pay');
  });

  it('BillsView reports outstanding / overdue / labels', () => {
    const sim = billed(1000);
    const bill = sim.state.household.bills[0];
    sim.setTick(bill.dueTick + 10);
    const view = sim.sys('economy').api!.bills(sim.ctx);
    expect(view.outstanding).toBe(bill.amount);
    expect(view.overdue).toBe(bill.amount);
    expect(view.bills[0]).toMatchObject({ id: bill.id, overdue: true, paid: false });
    expect(typeof view.nextDueLabel).toBe('string');
    expect(view.utilitiesOn).toBe(true);
  });
});

describe('Repo Ghoul', () => {
  it('targets the most valuable sellable objects until ≥ 1.2 × owed, never doors/mailbox/items', () => {
    const sim = new FakeSim({ objects: [...kitchenLot(), { defId: 'sarcophagus_cryo', x: 12, z: 12 }, { defId: 'door_crypt', x: 1, z: 1 }, { defId: 'item_painting', x: 8, z: 8 }] });
    const ids = (owed: number) => chooseRepoTargets(sim.ctx, owed).map((o) => o.defId);
    expect(ids(100)).toEqual(['sarcophagus_cryo']);
    // goal 1.2 × 4400 = 5280: 4800 + 450 = 5250 is not enough, + 400 = 5650 is
    expect(ids(4400)).toEqual(['sarcophagus_cryo', 'fridge_humming', 'stove_greasefire']);
    expect(ids(4100)).toEqual(['sarcophagus_cryo', 'fridge_humming']);
    const all = ids(1e9);
    expect(all).not.toContain('door_crypt');
    expect(all).not.toContain('mailbox_crooked');
    expect(all).not.toContain('item_painting');
  });

  it('walks in, repossesses with a puff, clears the bills, leaves; household is Repossessed', () => {
    const sim = billed(0);
    const bill = sim.state.household.bills[0];
    sim.setTick(bill.dueTick + 6 * TICKS_PER_DAY - 1);
    sim.advance(1);
    const npc = sim.state.agents[sim.state.flags[FLAG.repoNpc] as string];
    expect(npc.role).toBe('service');
    expect(npc.queue.length).toBeGreaterThan(0);
    // drive its queue like the engine
    while (npc.queue.length > 0) {
      const qi = npc.queue.shift()!;
      sim.start(npc, qi.interactionId, qi.target, {}, { source: 'system', checkRequires: false });
      sim.runToEnd(npc);
    }
    sim.advance(1);
    expect(unpaidBills(sim.ctx)).toHaveLength(0);
    expect(sim.objs('fridge_humming')).toHaveLength(0); // the most valuable object went first
    expect(sim.eventsOf('fx').some((e) => e.kind === 'puff')).toBe(true);
    expect(sim.ctx.hasMoodlet(sim.member(), MOOD.repossessed)).toBe(true);
    expect(sim.state.household.utilitiesOn).toBe(true);
    expect(sim.state.flags[FLAG.repoNpc]).toBeUndefined();
    expect(npc.presence).toBe('gone');
    expect(sim.state.household.funds).toBe(0);
  });

  it('paying while the ghoul is on the lot sends it home empty-handed', () => {
    const sim = billed(0);
    const bill = sim.state.household.bills[0];
    sim.setTick(bill.dueTick + 6 * TICKS_PER_DAY - 1);
    sim.advance(1);
    const objects = Object.keys(sim.state.objects).length;
    sim.state.household.funds = 10000;
    expect(sim.sys('economy').api!.payAll(sim.member().id, sim.ctx)).toBe(true);
    sim.advance(1);
    expect(Object.keys(sim.state.objects).length).toBe(objects);
    expect(sim.state.flags[FLAG.repoNpc]).toBeUndefined();
    expect(sim.notificationsText()).toMatch(/sent packing/);
  });

  it('dispatches only once per day and finishes remotely if the ghoul vanishes', () => {
    const sim = billed(0);
    const bill = sim.state.household.bills[0];
    sim.setTick(bill.dueTick + 6 * TICKS_PER_DAY - 1);
    sim.advance(1);
    const npcId = sim.state.flags[FLAG.repoNpc] as string;
    sim.sys('economy').hour!(sim.ctx, sim.ctx.time.hour);
    expect(Object.values(sim.state.agents).filter((a) => a.role === 'service')).toHaveLength(1);
    sim.ctx.despawnAgent(npcId, 'gone');
    sim.advance(1);
    expect(unpaidBills(sim.ctx)).toHaveLength(0);
    expect(sim.objs('fridge_humming')).toHaveLength(0);
  });
});

describe('mail & paintings', () => {
  it('addMail raises the flag; Check Mail reads it out and empties the box', () => {
    const sim = new FakeSim({ objects: kitchenLot() });
    const api = sim.sys('economy').api!;
    expect(api.addMail(2, sim.ctx)).toBe(2);
    const box = sim.obj('mailbox_crooked');
    expect(box.data).toMatchObject({ mail: 2, flag: true });
    const a = sim.member();
    sim.start(a, IX.checkMail, { kind: 'object', id: box.id });
    sim.runToEnd(a);
    expect(box.data).toMatchObject({ mail: 0, flag: false });
    expect(sim.state.notifications.at(-1)!.title).toMatch(/checked the mail/);
  });

  it('Sell Painting earns its value exactly once and removes it', () => {
    const sim = new FakeSim({ objects: [{ defId: 'item_painting', x: 4, z: 4, data: { value: 123, title: 'Brains at Dusk' } }], funds: 0 });
    const a = sim.member();
    const p = sim.obj('item_painting');
    const label = sim.sys('economy').behaviors!.sellPainting.label!(sim.ctx, a, sim.content.interactions[IX.sellPainting], { kind: 'object', id: p.id });
    expect(label).toBe('Sell Painting ($123)');
    sim.start(a, IX.sellPainting, { kind: 'object', id: p.id });
    sim.runToEnd(a);
    expect(sim.state.household.funds).toBe(123);
    expect(sim.state.objects[p.id]).toBeUndefined();
    expect(sim.ctx.statValue('paintingsSold', a.id)).toBe(1);
    expect(sim.ctx.hasMoodlet(a, MOOD.paintingSold)).toBe(true);
    // replaying the earn key does nothing
    sim.ctx.earn(123, 'again', `painting:${p.id}`);
    expect(sim.state.household.funds).toBe(123);
  });
});


