/**
 * W-116 (D-063) household "Autonomous purchases" on the REAL modules (owner playtest #5: Irene ordered a $35 pizza on
 * her own in a cash-strapped start):
 *  - new derelict worlds start with a $50 daily cap; starter / empty worlds and old saves have no flag (Unlimited);
 *  - over N simulated days autonomy never spends more than the cap in one in-game day, and Off spends nothing on its
 *    own (every spend while no player command was given is a bill / event, never a purchase);
 *  - a player-queued purchase still goes through with Off; the cap resets at in-game midnight; replay is identical;
 *  - Unlimited never writes a flag (byte-identical classic behaviour).
 */
import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { tickAt, timeInfo } from '../../../src/sim/time';
import type { EngineSimulation } from '../../../src/sim/engine';
import { AUTO_BUY_DAY_FLAG, AUTO_BUY_FLAG, AUTO_BUY_SPENT_FLAG, autoAllowance, autoBuySetting, autoSpentToday, parseAutoBuy, recordAutoSpend, setAutoBuy } from '../../../src/shared/autoBuy';
import { newWorld, objectOf, opts, simOf, systemsWithQuests } from '../quests/helpers';
import { buyAt, LAYOUT, MAIN_ROOM } from '../quests/act1Driver';

interface SpendRec {
  day: number;
  amount: number;
  reason: string;
  autonomous: boolean;
  ok: boolean;
}

/** Wrap ctx.spend to record every successful spend (amount, reason, the autonomous flag, the in-game day). */
function recordSpends(sim: EngineSimulation): SpendRec[] {
  const out: SpendRec[] = [];
  const ctx = sim.engine.ctx;
  const orig = ctx.spend.bind(ctx);
  ctx.spend = (amount, reason, key, o) => {
    const before = sim.state.household.funds;
    const ok = orig(amount, reason, key, o);
    const paid = before - sim.state.household.funds;
    if (paid > 0) out.push({ day: timeInfo(sim.state.tick).day, amount: paid, reason: String(reason), autonomous: !!o?.autonomous, ok });
    return ok;
  };
  return out;
}

function world(lot: 'derelict' | 'starter' | 'empty', seed: number, members = 2) {
  const systems = systemsWithQuests();
  return { sim: simOf(newWorld({ ...opts(seed, members), lotTemplate: lot }, systems), systems), systems };
}

/** A derelict world with the day-1 essentials bought by the player (so autonomy has things to buy on its own). */
function equipped(seed: number) {
  const r = world('derelict', seed);
  expect(buyAt(r.sim, 'fridge_humming', LAYOUT.fridge[0], LAYOUT.fridge[1], LAYOUT.fridge[2], MAIN_ROOM)).not.toBeNull();
  expect(buyAt(r.sim, 'microwave_nuke', LAYOUT.microwave[0], LAYOUT.microwave[1], LAYOUT.microwave[2], MAIN_ROOM)).not.toBeNull();
  return r;
}

const days = (sim: EngineSimulation, n: number) => {
  for (let i = 0; i < n * TICKS_PER_DAY; i++) sim.step();
  sim.drainEvents();
};
/** Spends that are not purchases (bills and town events) — allowed with any setting. */
const NOT_A_PURCHASE = /^(Utility bill|Raven theft|Repossess|Rent|Fine)/;
const byDay = (recs: SpendRec[]) => {
  const m = new Map<number, number>();
  for (const r of recs) m.set(r.day, (m.get(r.day) ?? 0) + r.amount);
  return m;
};

describe('W-116 autonomous purchases: defaults (D-019)', () => {
  it('a NEW derelict world starts with a $50 daily cap; starter and empty worlds carry no flag (Unlimited)', () => {
    expect(world('derelict', 1).sim.state.flags[AUTO_BUY_FLAG]).toBe(50);
    expect(autoBuySetting(world('derelict', 1).sim.state)).toEqual({ mode: 'cap', cap: 50 });
    for (const lot of ['starter', 'empty'] as const) {
      const s = world(lot, 1).sim.state;
      expect(AUTO_BUY_FLAG in s.flags, lot).toBe(false);
      expect(autoBuySetting(s)).toEqual({ mode: 'unlimited' });
      expect(autoAllowance(s)).toBe(Infinity);
    }
  });

  it('OLD SAVE / classic world: Unlimited never writes a flag over a game day, and a reload is byte-identical', () => {
    const { sim, systems } = world('starter', 2);
    const spends = recordSpends(sim);
    days(sim, 1);
    expect(spends.some((s) => s.autonomous)).toBe(true); // autonomy did buy things (groceries, snacks)…
    for (const k of [AUTO_BUY_FLAG, AUTO_BUY_DAY_FLAG, AUTO_BUY_SPENT_FLAG]) expect(k in sim.state.flags, k).toBe(false); // …untracked
    const saved = JSON.stringify(sim.serialize());
    expect(saved).not.toContain('autoBuy');
    const loaded = simOf(JSON.parse(saved) as WorldState, systems);
    expect(JSON.stringify(loaded.serialize())).toBe(saved);
  }, 300_000);
});

describe('W-116 autonomous purchases: the cap holds', () => {
  for (const seed of [11, 12]) {
    it(`seed ${seed}: over 3 game days autonomy never spends more than $50 in one in-game day (cap binds vs Unlimited)`, () => {
      const capped = equipped(seed);
      const capSpends = recordSpends(capped.sim);
      days(capped.sim, 3);
      const auto = capSpends.filter((s) => s.autonomous);
      for (const [day, total] of byDay(auto)) expect(total, `day ${day}`).toBeLessThanOrEqual(50);
      // the world's own running total agrees with the independent record
      expect(autoSpentToday(capped.sim.state)).toBe(byDay(auto).get(timeInfo(capped.sim.state.tick).day) ?? 0);
      expect(capped.sim.faults()).toEqual([]);
      expect(capped.sim.checkInvariants()).toEqual([]);
      // the same world with the cap lifted spends more on its own: the cap is doing something
      const free = equipped(seed);
      expect(free.sim.dispatch({ type: 'setAutoPurchases', value: 'unlimited' }).ok).toBe(true);
      const freeSpends = recordSpends(free.sim);
      days(free.sim, 3);
      const freeAuto = freeSpends.filter((s) => s.autonomous).reduce((a, s) => a + s.amount, 0);
      expect(freeAuto).toBeGreaterThan(auto.reduce((a, s) => a + s.amount, 0));
    }, 300_000);
  }

  it('Off: zero autonomous spending over 2 days — every spend without a player command is a bill or an event', () => {
    const { sim } = equipped(13);
    expect(sim.dispatch({ type: 'setAutoPurchases', value: 'off' }).ok).toBe(true);
    const spends = recordSpends(sim);
    days(sim, 2);
    expect(spends.filter((s) => s.autonomous)).toEqual([]);
    expect(spends.filter((s) => !NOT_A_PURCHASE.test(s.reason))).toEqual([]);
    expect(sim.faults()).toEqual([]);
  }, 300_000);

  it('Off: a player-queued purchase still works (microwave burrito, a pizza by phone)', () => {
    const { sim } = equipped(14);
    sim.dispatch({ type: 'setAutoPurchases', value: 'off' });
    sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off' } });
    const [a] = sim.state.household.memberIds;
    const f0 = sim.state.household.funds;
    expect(sim.dispatch({ type: 'queue', actorId: a, interactionId: 'home_microwaveBurrito', target: { kind: 'object', id: objectOf(sim, 'microwave_nuke')! } }).ok).toBe(true);
    for (let i = 0; i < 400 && sim.state.household.funds === f0; i++) sim.step();
    expect(sim.state.household.funds).toBe(f0 - 8);
    const f1 = sim.state.household.funds;
    expect(sim.dispatch({ type: 'queue', actorId: a, interactionId: 'phone_orderPizza', target: { kind: 'self' } }).ok).toBe(true);
    for (let i = 0; i < 400 && sim.state.household.funds === f1; i++) sim.step();
    expect(sim.state.household.funds).toBe(f1 - 35);
    // player purchases never count toward the autonomous allowance
    expect(autoSpentToday(sim.state)).toBe(0);
  }, 120_000);

  it('ADVERSARIAL: an autonomous spend over the allowance is refused at spend time (even if autonomy were to pick it)', () => {
    const { sim } = equipped(15);
    sim.dispatch({ type: 'setAutoPurchases', value: 20 });
    const ctx = sim.engine.ctx;
    const f0 = sim.state.household.funds;
    expect(ctx.spend(15, 'test', 'k1', { autonomous: true })).toBe(true);
    expect(ctx.spend(8, 'test', 'k2', { autonomous: true })).toBe(false); // 15 + 8 > 20
    expect(sim.state.household.funds).toBe(f0 - 15);
    expect(ctx.spend(5, 'test', 'k3', { autonomous: true })).toBe(true); // exactly 20
    expect(ctx.spend(1, 'test', 'k4', { autonomous: true })).toBe(false);
    expect(ctx.spend(100, 'player', 'k5')).toBe(true); // not autonomous: never blocked
    expect(ctx.spend(15, 'test', 'k1', { autonomous: true })).toBe(true); // idempotent replay of k1: no double charge
    expect(sim.state.household.funds).toBe(f0 - 120);
    expect(autoSpentToday(sim.state)).toBe(20);
  });

  it('the cap resets at local in-game midnight, deterministically', () => {
    const { sim } = equipped(16);
    const day = timeInfo(sim.state.tick).day;
    const midnight = tickAt(day + 1, 0);
    while (sim.state.tick < midnight - 1) sim.step();
    sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off' } });
    const ctx = sim.engine.ctx;
    sim.state.flags[AUTO_BUY_DAY_FLAG] = timeInfo(sim.state.tick).day;
    sim.state.flags[AUTO_BUY_SPENT_FLAG] = 50;
    expect(autoAllowance(sim.state)).toBe(0);
    expect(ctx.spend(5, 'test', 'm1', { autonomous: true })).toBe(false); // 23:59.x: still today
    sim.step();
    expect(sim.state.tick).toBe(midnight);
    expect(timeInfo(sim.state.tick).day).toBe(day + 1);
    expect(autoAllowance(sim.state)).toBe(50); // 00:00 next day: a fresh allowance
    expect(ctx.spend(5, 'test', 'm2', { autonomous: true })).toBe(true);
    expect(sim.state.flags[AUTO_BUY_DAY_FLAG]).toBe(day + 1);
    expect(sim.state.flags[AUTO_BUY_SPENT_FLAG]).toBe(5);
  }, 120_000);

  it('replay: the same seed with the cap gives the identical world after 2 days', () => {
    const a = equipped(17).sim;
    const b = equipped(17).sim;
    days(a, 2);
    days(b, 2);
    expect(JSON.stringify(b.serialize())).toBe(JSON.stringify(a.serialize()));
  }, 300_000);
});

describe('W-116 autonomous purchases: setting + pure helpers', () => {
  it('setAutoPurchases validates; Unlimited removes the flag; a cap / Off is stored', () => {
    const { sim } = world('derelict', 21);
    for (const bad of [-1, 'lots', null, 1e9, Number.NaN, {}]) expect(sim.dispatch({ type: 'setAutoPurchases', value: bad as never }).ok, String(bad)).toBe(false);
    expect(sim.state.flags[AUTO_BUY_FLAG]).toBe(50);
    expect(sim.dispatch({ type: 'setAutoPurchases', value: 'off' }).ok).toBe(true);
    expect(sim.state.flags[AUTO_BUY_FLAG]).toBe('off');
    expect(sim.dispatch({ type: 'setAutoPurchases', value: 120 }).ok).toBe(true);
    expect(autoBuySetting(sim.state)).toEqual({ mode: 'cap', cap: 120 });
    expect(sim.dispatch({ type: 'setAutoPurchases', value: 'unlimited' }).ok).toBe(true);
    expect(AUTO_BUY_FLAG in sim.state.flags).toBe(false);
  });

  it('pure: junk reads as Unlimited; Off allows 0; spending is tracked only when limited; day rolls at midnight', () => {
    const s = world('starter', 22).sim.serialize();
    s.flags[AUTO_BUY_FLAG] = 'garbage';
    expect(autoAllowance(s)).toBe(Infinity);
    recordAutoSpend(s, 10);
    expect(AUTO_BUY_SPENT_FLAG in s.flags).toBe(false);
    setAutoBuy(s, parseAutoBuy('off')!);
    expect(autoAllowance(s)).toBe(0);
    setAutoBuy(s, parseAutoBuy(30)!);
    recordAutoSpend(s, 12);
    expect(autoAllowance(s)).toBe(18);
    s.tick = tickAt(timeInfo(s.tick).day + 1, 0);
    expect(autoAllowance(s)).toBe(30);
    expect(parseAutoBuy(30.7)).toEqual({ mode: 'cap', cap: 30 });
  });
});
