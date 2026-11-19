/**
 * Autonomy sanity for HOME behaviours (adjustScore / available — player orders are never affected):
 *  - pressing needs first: hobbies & chores are damped while hunger/energy/hygiene are low, dropped at the floor,
 *    never damped when they restore a need that is itself urgent (triage);
 *  - "nothing to gain": stopWhen interactions are skipped when the need is already ≈ satisfied (TV at fun 95);
 *  - cooking only when somebody is peckish, nothing is out / in the fridge, and nobody else is at the stove;
 *  - eating / snacking only when actually hungry; naps only when drowsy; sleep waits for dinner;
 *  - bills paid on their own when due within 24 h (or overdue) and affordable;
 *  - menus explain dead ends instead of failing at the fridge door (full fridge, power cut, broken stove);
 *  - a prosthetic isn't fitted while the zombie's own fresh limb lies around;
 *  - stereo loops are reconciled with the world (sold / broken / unpowered stereos fall silent).
 */
import { describe, expect, it } from 'vitest';
import type { InteractionDef } from '../../../src/sim/contracts';
import type { AgentState, TargetRef } from '../../../src/sim/types';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { DATA, FLAG, IX, MOOD } from '../../../src/sim/content/home/ids';
import { basicNeedDamp, leisureScore, NEVER, stopWhenSatisfied } from '../../../src/sim/systems/home/autonomy';
import { issueBill } from '../../../src/sim/systems/home/economy/bills';
import { tickFoodPoisoning } from '../../../src/sim/systems/home/food/eating';
import { syncStereoLoops } from '../../../src/sim/systems/home/upkeep/loops';
import { moneyLabel } from '../../../src/sim/systems/home/util';
import { FakeSim, kitchenLot } from './fakeCtx';

const obj = (sim: FakeSim, defId: string): TargetRef => ({ kind: 'object', id: sim.obj(defId).id });

function def(sim: FakeSim, id: string): InteractionDef {
  return sim.content.interactions[id];
}

/** The behaviour's autonomy adjustment of `base` (what the engine does after need scoring). */
function adjust(sim: FakeSim, agent: AgentState, interactionId: string, target: TargetRef, base = 20): number {
  const d = def(sim, interactionId);
  const beh = sim.behaviors[d.behavior ?? 'standard'];
  if (!beh?.adjustScore) return base;
  return beh.adjustScore(sim.ctx, agent, d, target, base);
}

function available(sim: FakeSim, agent: AgentState, interactionId: string, target: TargetRef): true | string {
  const d = def(sim, interactionId);
  const beh = sim.behaviors[d.behavior ?? 'standard'];
  return beh?.available ? beh.available(sim.ctx, agent, d, target) : true;
}

function lot() {
  return [
    ...kitchenLot(),
    { defId: 'tv_crt', x: 12, z: 8 },
    { defId: 'easel_morbid', x: 14, z: 2 },
    { defId: 'shower_drizzle', x: 17, z: 2 },
    { defId: 'sofa_moldy', x: 12, z: 11 },
    { defId: 'stereo_boombox', x: 8, z: 12 },
  ];
}

describe('pressing needs first (leisure damping)', () => {
  it('leaves hobbies alone while needs are fine, damps them as hunger drops and drops them at the floor', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    const paint = def(sim, IX.paint);
    a.needs.hunger = 80;
    expect(basicNeedDamp(sim.ctx, a, paint)).toBe(1);
    expect(leisureScore(sim.ctx, a, paint, 30)).toBe(30);
    a.needs.hunger = 30;
    const mid = leisureScore(sim.ctx, a, paint, 30);
    expect(mid).toBeGreaterThan(30 * 0.15);
    expect(mid).toBeLessThan(30);
    a.needs.hunger = 20;
    expect(leisureScore(sim.ctx, a, paint, 30)).toBeLessThan(mid);
    a.needs.hunger = 15;
    expect(leisureScore(sim.ctx, a, paint, 30)).toBe(NEVER);
    // Through the real behaviour hook (paint's adjustScore), e.g. an Artistic zombie at hunger 14.
    a.needs.hunger = 14;
    expect(adjust(sim, a, IX.paint, obj(sim, 'easel_morbid'), 32)).toBeLessThanOrEqual(0);
  });

  it('tiredness damps hobbies too; low hygiene only damps (a lot without plumbing must keep some fun)', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    const paint = def(sim, IX.paint);
    a.needs.energy = 8;
    expect(leisureScore(sim.ctx, a, paint, 30)).toBe(NEVER);
    a.needs.energy = 80;
    a.needs.hygiene = 0;
    const s = leisureScore(sim.ctx, a, paint, 30);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeCloseTo(30 * 0.15, 6);
  });

  it('never damps an activity that restores the low need itself, nor triage of another urgent need', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    // Showering at hygiene 3 is the point, not leisure.
    a.needs.hygiene = 3;
    expect(basicNeedDamp(sim.ctx, a, def(sim, IX.shower))).toBe(1);
    // Spray at freshness 10 is triage even when the zombie is also starving.
    a.needs.hunger = 12;
    a.needs.preservation = 10;
    expect(basicNeedDamp(sim.ctx, a, def(sim, IX.grabSpray))).toBe(1);
    // …but at freshness 80 the same spray waits for dinner (and its autoMax already rules it out).
    a.needs.preservation = 80;
    expect(basicNeedDamp(sim.ctx, a, def(sim, IX.grabSpray))).toBe(0);
    expect(adjust(sim, a, IX.grabSpray, obj(sim, 'fridge_humming'))).toBe(NEVER);
  });

  it('rejects garbage scores without throwing and passes non-positive scores through', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    const paint = def(sim, IX.paint);
    expect(leisureScore(sim.ctx, a, paint, Number.NaN)).toBe(NEVER);
    expect(leisureScore(sim.ctx, a, paint, Number.POSITIVE_INFINITY)).toBe(NEVER);
    expect(leisureScore(sim.ctx, a, paint, -7)).toBe(-7);
    a.needs = {} as AgentState['needs']; // corrupted agent: treated as fine, never throws
    expect(leisureScore(sim.ctx, a, paint, 10)).toBe(10);
  });
});

describe('nothing to gain (stopWhen gate)', () => {
  it('skips Watch TV when the zombie is already amused (stopWhen fun ≥ 98 would end it at once)', () => {
    const sim = new FakeSim({ objects: lot(), members: [{ traits: ['lazy'] }] });
    const a = sim.member();
    a.needs.fun = 95;
    expect(stopWhenSatisfied(sim.ctx, a, def(sim, IX.watchTv))).toBe(true);
    expect(adjust(sim, a, IX.watchTv, obj(sim, 'tv_crt'), 18)).toBe(NEVER);
    a.needs.fun = 60;
    expect(adjust(sim, a, IX.watchTv, obj(sim, 'tv_crt'), 18)).toBe(18);
  });

  it('skips a shower at hygiene 92 but not at 60; interactions without stopWhen are never gated', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    a.needs.hygiene = 92;
    expect(stopWhenSatisfied(sim.ctx, a, def(sim, IX.shower))).toBe(true);
    a.needs.hygiene = 60;
    expect(stopWhenSatisfied(sim.ctx, a, def(sim, IX.shower))).toBe(false);
    expect(stopWhenSatisfied(sim.ctx, a, def(sim, IX.paint))).toBe(false);
  });

  it('naps only when drowsy (Lazy used to nap at energy 89 instead of ever sleeping)', () => {
    const sim = new FakeSim({ objects: lot(), members: [{ traits: ['lazy'] }] });
    const a = sim.member();
    a.needs.energy = 80;
    expect(adjust(sim, a, IX.nap, obj(sim, 'sofa_moldy'), 21)).toBe(NEVER);
    a.needs.energy = 60;
    expect(adjust(sim, a, IX.nap, obj(sim, 'sofa_moldy'), 21)).toBe(21);
  });
});

describe('food autonomy', () => {
  it('cooks only when someone is peckish and nothing is out or in the fridge', () => {
    const sim = new FakeSim({ objects: lot(), members: [{ traits: ['gourmand'] }, { firstName: 'Ghoulia' }] });
    const [a, b] = [sim.member(0), sim.member(1)];
    a.needs.hunger = 90;
    b.needs.hunger = 90;
    expect(adjust(sim, a, IX.cook, obj(sim, 'fridge_humming'), 30)).toBe(NEVER); // nobody hungry
    b.needs.hunger = 50; // the housemate is peckish: the Gourmand may cook for them
    expect(adjust(sim, a, IX.cook, obj(sim, 'fridge_humming'), 30)).toBe(30);
    const meal = sim.addObject({ defId: 'item_meal', x: 4, z: 3, data: { servings: 3, quality: 3, recipeId: 'brainLoaf', ageMin: 0, spoiled: false } });
    expect(adjust(sim, a, IX.cookAtStove, obj(sim, 'stove_greasefire'), 30)).toBe(NEVER); // eat what's out first
    meal.data[DATA.spoiled] = true; // a spoiled platter doesn't count
    expect(adjust(sim, a, IX.cookAtStove, obj(sim, 'stove_greasefire'), 30)).toBe(30);
    sim.ctx.removeObject(meal.id);
    sim.obj('fridge_humming').data[DATA.leftovers] = JSON.stringify([{ s: 2, q: 3, r: 'brainLoaf', a: 60 }]);
    expect(adjust(sim, a, IX.cook, obj(sim, 'fridge_humming'), 30)).toBe(NEVER); // fresh leftovers
    sim.obj('fridge_humming').data[DATA.leftovers] = JSON.stringify([{ s: 2, q: 3, r: 'brainLoaf', a: 48 * 60 + 1 }]);
    expect(adjust(sim, a, IX.cook, obj(sim, 'fridge_humming'), 30)).toBe(30); // only spoiled ones
  });

  it('one pot at a time: a housemate already cooking (or queued to) blocks a second cook', () => {
    const sim = new FakeSim({ objects: lot(), members: [{}, { firstName: 'Ghoulia' }] });
    const [a, b] = [sim.member(0), sim.member(1)];
    a.needs.hunger = 40;
    b.needs.hunger = 40;
    sim.forcedChance = false;
    expect(sim.start(b, IX.cook, obj(sim, 'fridge_humming'), { recipe: 'brainLoaf' })).toBeNull();
    expect(adjust(sim, a, IX.cookAtStove, obj(sim, 'stove_greasefire'), 30)).toBe(NEVER);
    sim.cancel(b);
    sim.advance(2);
    expect(b.active).toBeNull();
    b.queue.push({ uid: 999, interactionId: IX.cookAtStove, target: obj(sim, 'stove_greasefire'), params: {}, source: 'auto', priority: 100, queuedTick: 0 });
    expect(adjust(sim, a, IX.cook, obj(sim, 'fridge_humming'), 30)).toBe(NEVER);
    b.queue = [];
    expect(adjust(sim, a, IX.cook, obj(sim, 'fridge_humming'), 30)).toBe(30);
    sim.state.household.funds = 11;
    expect(adjust(sim, a, IX.cook, obj(sim, 'fridge_humming'), 30)).toBe(NEVER);
  });

  it('eats only when hungry (meals < 65, snacks < 55 — balance pass) — a Gourmand no longer empties the fridge at 94', () => {
    const sim = new FakeSim({ objects: lot(), members: [{ traits: ['gourmand'] }] });
    const a = sim.member();
    sim.obj('fridge_humming').data[DATA.leftovers] = JSON.stringify([{ s: 4, q: 3, r: 'brainLoaf', a: 0 }]);
    a.needs.hunger = 94;
    expect(adjust(sim, a, IX.eatLeftovers, obj(sim, 'fridge_humming'), 15)).toBe(NEVER);
    expect(adjust(sim, a, IX.grabJerky, obj(sim, 'fridge_humming'), 15)).toBe(NEVER);
    a.needs.hunger = 70; // balance pass: a serving (~50) at 70+ was mostly wasted (docs/BALANCE.md)
    expect(adjust(sim, a, IX.eatLeftovers, obj(sim, 'fridge_humming'), 15)).toBe(NEVER);
    a.needs.hunger = 60;
    expect(adjust(sim, a, IX.eatLeftovers, obj(sim, 'fridge_humming'), 15)).toBe(15);
    expect(adjust(sim, a, IX.grabJerky, obj(sim, 'fridge_humming'), 15)).toBe(NEVER);
    a.needs.hunger = 50;
    expect(adjust(sim, a, IX.grabJerky, obj(sim, 'fridge_humming'), 15)).toBeCloseTo(15 * 0.4, 6); // real food exists
    // Player orders are unaffected: the requirement still allows eating up to 95.
    a.needs.hunger = 94;
    expect(sim.canStart(a, IX.eatLeftovers, obj(sim, 'fridge_humming'))).toBe(true);
  });

  it('sleep waits for dinner unless the zombie is about to keel over', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    sim.setTick(TICKS_PER_HOUR * 13); // 22:00 — bedtime
    a.needs.energy = 40;
    a.needs.hunger = 80;
    const fed = adjust(sim, a, IX.sleep, obj(sim, 'coffin_pine'), 30);
    a.needs.hunger = 50;
    expect(adjust(sim, a, IX.sleep, obj(sim, 'coffin_pine'), 30)).toBeCloseTo(fed * 0.5, 6);
    a.needs.hunger = 20;
    expect(adjust(sim, a, IX.sleep, obj(sim, 'coffin_pine'), 30)).toBeCloseTo(fed * 0.2, 6);
    a.needs.energy = 10; // exhausted: sleep anyway
    const exhaustedFed = (() => {
      a.needs.hunger = 80;
      return adjust(sim, a, IX.sleep, obj(sim, 'coffin_pine'), 30);
    })();
    a.needs.hunger = 20;
    expect(adjust(sim, a, IX.sleep, obj(sim, 'coffin_pine'), 30)).toBeCloseTo(exhaustedFed, 6);
  });

  it('Put Away Leftovers explains a full fridge in the menu and autonomy skips it', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    const meal = sim.addObject({ defId: 'item_meal', x: 4, z: 3, data: { servings: 4, quality: 3, recipeId: 'brainLoaf', ageMin: 60, spoiled: false } });
    const target: TargetRef = { kind: 'object', id: meal.id };
    expect(available(sim, a, IX.putAwayLeftovers, target)).toBe(true);
    expect(adjust(sim, a, IX.putAwayLeftovers, target, 2)).toBeGreaterThan(0);
    sim.obj('fridge_humming').data[DATA.leftovers] = JSON.stringify([{ s: 28, q: 3, r: 'brainLoaf', a: 0 }]); // 2 free of 30
    expect(available(sim, a, IX.putAwayLeftovers, target)).toBe('The fridge is full');
    expect(sim.canStart(a, IX.putAwayLeftovers, target)).toBe('The fridge is full');
  });

  it('Cook… from the fridge is unavailable (with a reason) during a power cut or with a broken stove', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    const f = obj(sim, 'fridge_humming');
    expect(available(sim, a, IX.cook, f)).toBe(true);
    sim.state.household.utilitiesOn = false;
    expect(sim.canStart(a, IX.cook, f)).toBe('The power is out');
    sim.state.household.utilitiesOn = true;
    sim.obj('stove_greasefire').condition.broken = true;
    expect(sim.canStart(a, IX.cook, f)).toBe('Needs a stove'); // the content requirement (tagOnLot) speaks first
    expect(available(sim, a, IX.cook, f)).toBe('The stove is broken');
    sim.ctx.removeObject(sim.obj('stove_greasefire').id);
    expect(available(sim, a, IX.cook, f)).toBe('Needs a stove');
  });

  it('food poisoning drains hunger by +½ base rate scaled by difficulty (relaxed 0.7 / grim 1.3)', () => {
    for (const [difficulty, mult] of [['relaxed', 0.7], ['normal', 1], ['grim', 1.3]] as const) {
      const sim = new FakeSim({ objects: lot(), difficulty });
      const a = sim.member();
      a.needs.hunger = 80;
      sim.ctx.addMoodlet(a, MOOD.foodPoisoning);
      tickFoodPoisoning(sim.ctx, a, 60);
      expect(a.needs.hunger).toBeCloseTo(80 - 5.5 * 0.5 * mult, 6);
    }
  });
});

describe('bills on autopilot', () => {
  function billSim(funds = 5000) {
    const sim = new FakeSim({ objects: lot(), funds });
    const bill = issueBill(sim.ctx)!;
    return { sim, bill, a: sim.member(), box: obj(sim, 'mailbox_crooked') };
  }

  it('pays when a bill is due within 24 h (or overdue) and affordable — not before', () => {
    const { sim, bill, a, box } = billSim();
    expect(def(sim, IX.payBills).autonomous).not.toBe(false);
    expect(def(sim, IX.payBillsOnline).autonomous).not.toBe(false);
    expect(adjust(sim, a, IX.payBills, box, 0)).toBe(NEVER); // due in 3 days
    sim.setTick(bill.dueTick - TICKS_PER_HOUR * 20);
    const dueSoon = adjust(sim, a, IX.payBills, box, 0);
    expect(dueSoon).toBeGreaterThan(6); // beats the engine's idle threshold
    sim.setTick(bill.dueTick + TICKS_PER_DAY * 3);
    expect(adjust(sim, a, IX.payBills, box, 0)).toBeGreaterThan(dueSoon); // more urgent once overdue
  });

  it('boundary: exactly 24 h before due is in the window, one tick earlier is not; exact funds suffice', () => {
    const { sim, bill, a, box } = billSim();
    sim.setTick(bill.dueTick - TICKS_PER_HOUR * 24 - 1);
    expect(adjust(sim, a, IX.payBills, box, 0)).toBe(NEVER);
    sim.setTick(bill.dueTick - TICKS_PER_HOUR * 24);
    expect(adjust(sim, a, IX.payBills, box, 0)).toBeGreaterThan(0);
    sim.state.household.funds = bill.amount;
    expect(adjust(sim, a, IX.payBills, box, 0)).toBeGreaterThan(0);
    sim.state.household.funds = bill.amount - 1;
    expect(adjust(sim, a, IX.payBills, box, 0)).toBe(NEVER);
  });

  it('a broke household cannot pay (no autonomous attempt), visitors never pay, no bills → nothing to do', () => {
    const { sim, bill, a, box } = billSim(10);
    sim.setTick(bill.dueTick);
    expect(adjust(sim, a, IX.payBills, box, 0)).toBe(NEVER);
    sim.state.household.funds = 5000;
    const visitor = sim.addMember({ firstName: 'Townie', role: 'townie' });
    sim.state.household.memberIds = sim.state.household.memberIds.filter((id) => id !== visitor.id);
    expect(adjust(sim, visitor, IX.payBills, box, 0)).toBe(NEVER);
    sim.sys('economy').api!.payAll(a.id, sim.ctx);
    expect(adjust(sim, a, IX.payBills, box, 0)).toBe(NEVER);
  });
});

describe('prosthetics', () => {
  it('a fresh own limb on the floor beats spending a $250 crate; a rotten one does not', () => {
    const sim = new FakeSim({ objects: [...lot(), { defId: 'crate_prosthetic', x: 9, z: 9 }] });
    const a = sim.member();
    a.limbs.armL = 'missing';
    const crate = obj(sim, 'crate_prosthetic');
    expect(adjust(sim, a, IX.fitProsthetic, crate, 15)).toBe(15);
    const limb = sim.addObject({ defId: 'item_limb_arm', x: 6, z: 6, data: { limbId: 'armL', ownerId: a.id, createdTick: 0, rotten: false } });
    expect(adjust(sim, a, IX.fitProsthetic, crate, 15)).toBe(NEVER);
    limb.data[DATA.rotten] = true;
    expect(adjust(sim, a, IX.fitProsthetic, crate, 15)).toBe(15);
  });
});

describe('stereo loops follow the world', () => {
  function loops(sim: FakeSim, key: string): boolean[] {
    return sim.eventsOf('sfxLoop').filter((e) => e.key === key).map((e) => e.on);
  }

  it('switching on starts the loop; selling, breaking or a power cut silences it; power back resumes it', () => {
    const sim = new FakeSim({ objects: lot() });
    const a = sim.member();
    const stereo = sim.obj('stereo_boombox');
    const key = `stereo:${stereo.id}`;
    expect(sim.start(a, IX.stereoToggle, { kind: 'object', id: stereo.id })).toBeNull();
    sim.runToEnd(a);
    expect(stereo.data[DATA.playing]).toBe(true);
    expect(loops(sim, key)).toEqual([true]);
    sim.state.household.utilitiesOn = false;
    sim.advance(1);
    expect(loops(sim, key)).toEqual([true, false]);
    sim.state.household.utilitiesOn = true;
    sim.advance(1);
    expect(loops(sim, key)).toEqual([true, false, true]);
    stereo.condition.broken = true;
    sim.advance(1);
    expect(loops(sim, key)).toEqual([true, false, true, false]);
    stereo.condition.broken = false;
    sim.advance(1);
    sim.ctx.removeObject(stereo.id); // sold in build mode / repossessed / burned
    sim.advance(1);
    expect(loops(sim, key).slice(-2)).toEqual([true, false]);
    expect(sim.state.flags[FLAG.stereoLoops]).toBe('');
  });

  it('a household without a playing stereo never writes the loop flag (healthy worlds stay untouched)', () => {
    const sim = new FakeSim({ objects: lot() });
    sim.advance(30);
    expect(FLAG.stereoLoops in sim.state.flags).toBe(false);
    expect(sim.eventsOf('sfxLoop').filter((e) => e.key.startsWith('stereo:'))).toEqual([]);
  });

  it('reconciling is idempotent: repeated ticks with nothing changed emit nothing new', () => {
    const sim = new FakeSim({ objects: lot() });
    const stereo = sim.obj('stereo_boombox');
    stereo.data[DATA.playing] = true;
    sim.advance(1);
    const n = sim.eventsOf('sfxLoop').length;
    for (let i = 0; i < 3; i++) syncStereoLoops(sim.ctx);
    sim.advance(5);
    expect(sim.eventsOf('sfxLoop').length).toBe(n);
  });

  it('replays audible loops on load (init loaded=true) exactly once each', () => {
    const sim = new FakeSim({ objects: lot() });
    const stereo = sim.obj('stereo_boombox');
    stereo.data[DATA.playing] = true;
    sim.advance(1);
    sim.events = [];
    sim.sys('upkeep').init!(sim.ctx, true);
    expect(loops(sim, `stereo:${stereo.id}`)).toEqual([true]);
  });
});

describe('money labels', () => {
  it('formats by hand (saved notification text must not depend on host ICU data)', () => {
    expect(moneyLabel(0)).toBe('$0');
    expect(moneyLabel(999)).toBe('$999');
    expect(moneyLabel(1234)).toBe('$1,234');
    expect(moneyLabel(1234567.4)).toBe('$1,234,567');
    expect(moneyLabel(-50)).toBe('$0');
    expect(moneyLabel(Number.NaN)).toBe('$0');
  });
});

describe('limb rules (GDD §4: one arm = slower, no arms = cannot stitch)', () => {
  it('every stitching interaction needs only one functional arm; Work Out still needs two', () => {
    const sim = new FakeSim();
    const armsMin = (id: string) => (def(sim, id).requires ?? []).find((r) => r.id === 'arms')?.params?.min;
    for (const id of [IX.stitchSelf, IX.stitchSelfStation, IX.stitchOther, IX.limbStitch, IX.limbReattachOther, IX.practiceStitch]) {
      expect(armsMin(id), id).toBe(1);
    }
    expect(armsMin(IX.workout)).toBe(2);
  });
});

describe('adversarial: autonomy hooks on a corrupted world', () => {
  it('every home adjustScore / available / label / choices hook survives garbage actors, targets and scores', () => {
    const sim = new FakeSim({ objects: [...lot(), { defId: 'crate_prosthetic', x: 9, z: 9 }], members: [{}, { firstName: 'Ghoulia' }] });
    const a = sim.member();
    const b = sim.member(1);
    // Corruptions the engine may self-heal later but hooks can see first.
    b.queue = [null as never, { uid: 1, interactionId: 'nope', target: { kind: 'self' }, params: {}, source: 'auto', priority: 1, queuedTick: 0 }];
    sim.obj('fridge_humming').data[DATA.leftovers] = '{not json';
    const ghost = sim.addObject({ defId: 'item_meal', x: 7, z: 7, data: { servings: Number.NaN as never } });
    (ghost as { placement: unknown }).placement = undefined;
    const broken = { ...a, needs: {} as AgentState['needs'], limbs: undefined as never, traits: [] as string[], skills: {} as AgentState['skills'] } as AgentState;
    const targets: TargetRef[] = [
      { kind: 'object', id: 'o-missing' },
      { kind: 'self' },
      { kind: 'tile', x: Number.NaN, z: 3 },
      { kind: 'agent', id: 'a-missing' },
      obj(sim, 'fridge_humming'),
      obj(sim, 'stereo_boombox'),
    ];
    let hooks = 0;
    for (const d of Object.values(sim.content.interactions)) {
      if (!d.id.startsWith('home_')) continue;
      const beh = sim.behaviors[d.behavior ?? 'standard'];
      if (!beh) continue;
      for (const actor of [a, broken]) {
        for (const t of targets) {
          for (const base of [20, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
            if (beh.adjustScore) {
              hooks++;
              const r = beh.adjustScore(sim.ctx, actor, d, t, base);
              expect(typeof r, `${d.id}.adjustScore`).toBe('number');
            }
          }
          if (beh.available) expect(() => beh.available!(sim.ctx, actor, d, t), `${d.id}.available`).not.toThrow();
          if (beh.label) expect(typeof beh.label(sim.ctx, actor, d, t), `${d.id}.label`).toBe('string');
          if (beh.choices) expect(Array.isArray(beh.choices(sim.ctx, actor, d, t)), `${d.id}.choices`).toBe(true);
        }
      }
    }
    expect(hooks).toBeGreaterThan(100);
  });

  it('loop reconciliation tolerates a corrupted flag and stereo objects without placement/condition', () => {
    const sim = new FakeSim({ objects: lot() });
    const stereo = sim.obj('stereo_boombox');
    sim.state.flags[FLAG.stereoLoops] = ',,o-ghost,,';
    stereo.data[DATA.playing] = true;
    (stereo as { condition: unknown }).condition = undefined;
    expect(() => sim.advance(1)).not.toThrow();
    const keys = sim.eventsOf('sfxLoop').map((e) => `${e.key}:${e.on}`);
    expect(keys).toContain('stereo:o-ghost:false');
    expect(keys).toContain(`stereo:${stereo.id}:true`);
    expect(sim.state.flags[FLAG.stereoLoops]).toBe(stereo.id);
  });
});
