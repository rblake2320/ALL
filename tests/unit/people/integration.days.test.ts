/**
 * Integration (hardening pass): the REAL engine + spatial + HOME + PEOPLE via createNewWorld/createSimulation.
 *
 *  - Four fully autonomous game days (Mon 09:00 → Fri 09:00) for a three-zombie household, one with a Necro-Tech
 *    day job: everybody eats, sleeps and socialises, the worker commutes and gets paid, the player pays the first
 *    bill at the mailbox (exactly once), needs stay mostly above the critical line, there are ZERO faults (any
 *    module) and checkInvariants() is empty at every game hour.
 *  - Targeted people flows that previously misbehaved: the doorbell after a welcome, households of Loners, a
 *    burnt-down kitchen (emergency pizza), save/load in the middle of a shift, and a seeded storm of junk player
 *    commands.
 */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation, loadContent } from '../../../src/sim/index';
import type { SimContext, SimEvent, SimulationAPI } from '../../../src/sim/contracts';
import type { AgentState, NeedId, WorldState } from '../../../src/sim/types';
import { NEED_IDS, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { tickAt } from '../../../src/sim/time';
import { createRng, seedRngState } from '../../../src/sim/rng';
import { defaultAppearance } from '../../../src/shared/appearance';

type Member = { firstName: string; traits: string[]; aspiration: string };

const FAMILY: Member[] = [
  { firstName: 'Mortimer', traits: ['cheerful', 'socialButterfly', 'gourmand'], aspiration: 'afterparty' },
  { firstName: 'Ghoulia', traits: ['ambitious', 'bookworm', 'neatFreak'], aspiration: 'tycoon' },
  { firstName: 'Rotney', traits: ['loner', 'nightOwl', 'clumsy'], aspiration: 'masterPreserver' },
];

function newGame(seed: number, members: Member[] = FAMILY): SimulationAPI {
  const state = createNewWorld({
    seed,
    householdName: 'Gravesby',
    members: members.map((m) => ({ ...m, lastName: 'Gravesby', appearance: defaultAppearance() })),
    lotTemplate: 'starter',
    difficulty: 'normal',
  });
  return createSimulation(state);
}

function ctxOf(sim: SimulationAPI): SimContext {
  return (sim as unknown as { engine: { ctx: SimContext } }).engine.ctx;
}

function membersOf(sim: SimulationAPI): AgentState[] {
  return sim.state.household.memberIds.map((id) => sim.state.agents[id]);
}

function step(sim: SimulationAPI, n: number, onEvents?: (ev: SimEvent[]) => void): void {
  for (let i = 0; i < n; i++) {
    sim.step();
    const ev = sim.drainEvents();
    if (onEvents) onEvents(ev);
  }
}

function runUntil(sim: SimulationAPI, pred: () => boolean, maxTicks: number, onEvents?: (ev: SimEvent[]) => void): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return true;
    sim.step();
    const ev = sim.drainEvents();
    if (onEvents) onEvents(ev);
  }
  return pred();
}

function objectsTagged(sim: SimulationAPI, tag: string) {
  const reg = loadContent();
  return Object.values(sim.state.objects).filter((o) => (reg.objects[o.defId]?.tags ?? []).includes(tag));
}

/** Fraction of on-lot hourly samples with each need at or above the critical line (15). */
class NeedTally {
  ok: Record<string, Record<NeedId, number>> = {};
  n: Record<string, number> = {};
  sample(a: AgentState): void {
    if (a.presence !== 'onLot') return;
    this.n[a.id] = (this.n[a.id] ?? 0) + 1;
    const row = (this.ok[a.id] ??= {} as Record<NeedId, number>);
    for (const need of NEED_IDS) if (a.needs[need] >= 15) row[need] = (row[need] ?? 0) + 1;
  }
  frac(id: string, need: NeedId): number {
    return (this.ok[id]?.[need] ?? 0) / Math.max(1, this.n[id] ?? 0);
  }
  aggregate(need: NeedId): number {
    let ok = 0;
    let n = 0;
    for (const id of Object.keys(this.n)) {
      ok += this.ok[id]?.[need] ?? 0;
      n += this.n[id];
    }
    return ok / Math.max(1, n);
  }
}

describe('four autonomous game days (real engine, every module)', () => {
  it(
    'a household eats, sleeps, socialises, commutes, pays its bill once; needs mostly ≥ 15; zero faults; invariants every hour',
    () => {
      const sim = newGame(4242);
      const ctx = ctxOf(sim);
      const reg = loadContent();
      const [social, worker, loner] = membersOf(sim);
      expect(sim.dispatch({ type: 'queue', actorId: worker.id, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: 'necrotech' } }).ok).toBe(true);

      const tally = new NeedTally();
      const sleeps: Record<string, number> = {};
      const respondedTo: Record<string, number> = {};
      const lastRun: Record<string, string> = {};
      const invariantBreaks: string[] = [];
      let prevPresence = worker.presence;
      let commutes = 0;
      let paidBill: { id: string; amount: number } | null = null;
      let payDispatched = false;
      const payTxBefore = new Set<string>();

      // Four days, not five: the known (deferred) balance issue #13 lets an unattended worker's freshness run out
      // around day 5–7 (CONTRACTS.md decision #13); that belongs to the integration balance pass, not this test.
      for (let t = 1; t <= 4 * TICKS_PER_DAY; t++) {
        sim.step();
        sim.drainEvents();
        for (const a of membersOf(sim)) {
          const cur = a.active?.interactionId ?? '';
          if (cur && cur !== lastRun[a.id]) {
            if ((reg.interactions[cur]?.tags ?? []).includes('sleep')) sleeps[a.id] = (sleeps[a.id] ?? 0) + 1;
            if (cur === 'engine_respond') respondedTo[a.id] = (respondedTo[a.id] ?? 0) + 1;
          }
          lastRun[a.id] = cur;
        }
        if (worker.presence === 'atWork' && prevPresence !== 'atWork') commutes++;
        prevPresence = worker.presence;

        // The player pays the first bill at the mailbox as soon as one arrives (Pay Bills is player-only by design).
        const unpaid = sim.state.household.bills.filter((b) => b.paidTick === null);
        if (!payDispatched && unpaid.length > 0) {
          const payer = membersOf(sim).find((m) => m.presence === 'onLot');
          const mailbox = objectsTagged(sim, 'mailbox')[0];
          if (payer && mailbox) {
            for (const k of sim.state.household.txLog) payTxBefore.add(k);
            paidBill = { id: unpaid[0].id, amount: unpaid[0].amount };
            expect(sim.dispatch({ type: 'queue', actorId: payer.id, interactionId: 'home_payBills', target: { kind: 'object', id: mailbox.id } }).ok).toBe(true);
            payDispatched = true;
          }
        }

        if (t % TICKS_PER_HOUR === 0) {
          for (const a of membersOf(sim)) tally.sample(a);
          const inv = sim.checkInvariants();
          if (inv.length) invariantBreaks.push(`tick ${sim.state.tick}: ${inv.slice(0, 3).join('; ')}`);
        }
      }

      // Health of the whole simulation, not just people.
      expect(sim.faults()).toEqual([]);
      expect(invariantBreaks).toEqual([]);
      for (const m of membersOf(sim)) expect(['onLot', 'atWork'], `${m.firstName} ended ${m.presence}`).toContain(m.presence);

      // Everybody eats and sleeps every day.
      for (const m of membersOf(sim)) {
        expect(ctx.statValue('mealsEaten', m.id), `${m.firstName} meals`).toBeGreaterThanOrEqual(8);
        expect(sleeps[m.id] ?? 0, `${m.firstName} sleeps`).toBeGreaterThanOrEqual(3);
      }

      // Everybody socialises (the Loner mostly as the one being talked to, but he talks back too).
      expect(ctx.statValue('socials', social.id)).toBeGreaterThanOrEqual(15);
      for (const m of membersOf(sim)) expect((ctx.statValue('socials', m.id) ?? 0) + (respondedTo[m.id] ?? 0), `${m.firstName} socials`).toBeGreaterThan(0);
      expect(ctx.statValue('socials', loner.id) + (respondedTo[loner.id] ?? 0)).toBeGreaterThanOrEqual(5);

      // The worker commutes Tue–Thu and is paid per shift.
      expect(commutes).toBeGreaterThanOrEqual(3);
      expect(ctx.statValue('shiftsWorked', worker.id)).toBeGreaterThanOrEqual(3);
      const shifts = ctx.statValue('shiftsWorked', worker.id);
      expect(ctx.statValue('wagesEarned', worker.id)).toBeGreaterThanOrEqual(shifts * 20 * 4); // late arrivals are prorated
      expect(ctx.statValue('wagesEarned', worker.id)).toBeLessThanOrEqual(shifts * 20 * 8);
      expect(worker.career).toMatchObject({ trackId: 'necrotech' });

      // The first bill (Thursday 09:00) was paid exactly once at the mailbox.
      expect(paidBill).not.toBeNull();
      const bill = sim.state.household.bills.find((b) => b.id === paidBill!.id);
      expect(bill?.paidTick ?? null).not.toBeNull();
      expect(sim.state.household.txLog.filter((k) => k === `bill:${paidBill!.id}`)).toHaveLength(1);
      expect(payTxBefore.has(`bill:${paidBill!.id}`)).toBe(false);
      const funds = sim.state.household.funds;
      expect(ctx.sys('economy').payAll(social.id)).not.toBe(undefined);
      expect(sim.state.household.funds).toBe(funds); // nothing left to pay: no second charge

      // Needs: the stay-at-home zombies thrive; across the household every need is mostly above the critical line.
      for (const m of [social, loner]) for (const need of NEED_IDS) expect(tally.frac(m.id, need), `${m.firstName} ${need}`).toBeGreaterThanOrEqual(0.85);
      for (const need of NEED_IDS) expect(tally.aggregate(need), `household ${need}`).toBeGreaterThanOrEqual(0.75);
      expect(tally.aggregate('social')).toBeGreaterThanOrEqual(0.9);
    },
    300_000,
  );
});

describe('people flows on the real engine (regressions found while hardening)', () => {
  /** A drop-in arriving now, plus a doorbell / door-wait tracker. */
  function dropIn(sim: SimulationAPI) {
    const guest = Object.values(sim.state.agents).find((x) => x.role === 'townie' && x.presence === 'offLot')!;
    sim.state.flags[`people:arrive:${guest.id}`] = sim.state.tick + 4;
    sim.state.flags[`people:arriveWhy:${guest.id}`] = 'dropIn';
    const t = { guest, rings: 0, ringsAfterWelcome: 0, doorWaitsAfterWelcome: 0, welcomedTick: -1 };
    const count = (ev: SimEvent[]) => {
      for (const e of ev) {
        if (e.type !== 'sfx' || e.id !== 'doorbell' || e.agentId !== guest.id) continue;
        t.rings++;
        if (t.welcomedTick >= 0) t.ringsAfterWelcome++;
      }
      if (guest.visit?.welcomed && t.welcomedTick < 0) t.welcomedTick = sim.state.tick;
      if (t.welcomedTick >= 0 && guest.active?.interactionId === 'visit_waitAtDoor') t.doorWaitsAfterWelcome++;
    };
    return { t, count };
  }

  it('a visitor welcomed while ringing at the door does not walk back out to ring again (max 3 rings)', () => {
    const sim = newGame(7, FAMILY.slice(0, 2));
    sim.state.settings.autonomy = 'off'; // nobody welcomes on their own: the player does it mid-wait
    step(sim, 2 * TICKS_PER_HOUR); // 11:00
    const { t, count } = dropIn(sim);
    const host = membersOf(sim)[0];
    expect(runUntil(sim, () => t.guest.active?.interactionId === 'visit_waitAtDoor' && t.guest.active.phase === 'run', TICKS_PER_HOUR, count)).toBe(true);
    expect(t.rings).toBe(1); // rang on arrival at the door
    step(sim, 25 * 4, count); // still waiting: a second ring 20 minutes later
    expect(t.rings).toBe(2);
    expect(runUntil(sim, () => !host.active, TICKS_PER_HOUR, count)).toBe(true);
    expect(sim.dispatch({ type: 'queue', actorId: host.id, interactionId: 'social_welcome', target: { kind: 'agent', id: t.guest.id } }).ok).toBe(true);
    expect(runUntil(sim, () => !!t.guest.visit?.welcomed, TICKS_PER_HOUR, count)).toBe(true);
    step(sim, TICKS_PER_HOUR, count);
    expect(t.ringsAfterWelcome).toBe(0);
    expect(t.doorWaitsAfterWelcome).toBe(0);
    expect(t.rings).toBeLessThanOrEqual(3);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  }, 240_000);

  it('household autonomy welcomes a drop-in; the guest never rings after being let in', () => {
    const sim = newGame(7, FAMILY.slice(0, 2));
    step(sim, 2 * TICKS_PER_HOUR); // 11:00
    const { t, count } = dropIn(sim);
    expect(runUntil(sim, () => !!t.guest.visit?.welcomed, 2 * TICKS_PER_HOUR, count)).toBe(true);
    step(sim, TICKS_PER_HOUR, count);
    expect(t.rings).toBeLessThanOrEqual(3);
    expect(t.ringsAfterWelcome).toBe(0);
    expect(t.doorWaitsAfterWelcome).toBe(0);
    expect(sim.faults()).toEqual([]);
  }, 240_000);

  it('a household of Loners still keeps each other company', () => {
    const sim = newGame(606, [
      { firstName: 'Silas', traits: ['loner', 'squeamish', 'vain'], aspiration: 'masterPreserver' },
      { firstName: 'Edna', traits: ['loner', 'hothead', 'gourmand'], aspiration: 'tycoon' },
    ]);
    const ctx = ctxOf(sim);
    const tally = new NeedTally();
    for (let h = 0; h < 3 * 24; h++) {
      step(sim, TICKS_PER_HOUR);
      for (const m of membersOf(sim)) tally.sample(m);
    }
    const total = membersOf(sim).reduce((n, m) => n + ctx.statValue('socials', m.id), 0);
    expect(total).toBeGreaterThanOrEqual(6);
    for (const m of membersOf(sim)) expect(tally.frac(m.id, 'social'), `${m.firstName} Company`).toBeGreaterThanOrEqual(0.85);
    expect(sim.faults()).toEqual([]);
  }, 240_000);

  it('with the kitchen gone a hungry zombie orders pizza by itself — never while the fridge works', () => {
    // Control: a working kitchen → no autonomous order, however hungry.
    const control = newGame(5, FAMILY.slice(0, 2));
    for (const m of membersOf(control)) m.needs.hunger = 25;
    step(control, 4 * TICKS_PER_HOUR);
    expect(ctxOf(control).statValue('pizzasOrdered')).toBe(0);

    const sim = newGame(5, FAMILY.slice(0, 2));
    const ctx = ctxOf(sim);
    const reg = loadContent();
    for (const o of Object.values(sim.state.objects)) {
      const tags = reg.objects[o.defId]?.tags ?? [];
      if (tags.includes('fridge') || tags.includes('stove') || tags.includes('microwave')) ctx.removeObject(o.id, 'burnt down');
    }
    expect(objectsTagged(sim, 'fridge')).toHaveLength(0);
    for (const m of membersOf(sim)) m.needs.hunger = 30;
    const before = sim.state.household.funds;
    const eatenBefore = membersOf(sim).reduce((n, m) => n + ctx.statValue('mealsEaten', m.id), 0);
    expect(runUntil(sim, () => ctx.statValue('pizzasOrdered') >= 1, 2 * TICKS_PER_HOUR)).toBe(true);
    expect(sim.state.household.funds).toBeLessThanOrEqual(before - 35);
    expect(runUntil(sim, () => objectsTagged(sim, 'pizza').length > 0, 3 * TICKS_PER_HOUR)).toBe(true);
    expect(runUntil(sim, () => membersOf(sim).reduce((n, m) => n + ctx.statValue('mealsEaten', m.id), 0) > eatenBefore, 2 * TICKS_PER_HOUR)).toBe(true);
    // one order at a time: no second autonomous pizza while that one is still being eaten
    step(sim, 2 * TICKS_PER_HOUR);
    expect(ctx.statValue('pizzasOrdered')).toBe(1);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  }, 240_000);

  it('saving in the middle of a shift and loading pays that shift exactly once, exactly like never saving', () => {
    const a = newGame(99, FAMILY.slice(0, 1));
    const [z] = membersOf(a);
    a.dispatch({ type: 'queue', actorId: z.id, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: 'mortuary' } });
    expect(runUntil(a, () => z.presence === 'atWork', tickAt(2, 10 * 60) - a.state.tick)).toBe(true);
    step(a, 3 * TICKS_PER_HOUR);
    expect(z.presence).toBe('atWork');
    const b = createSimulation(JSON.parse(JSON.stringify(a.serialize())) as WorldState);
    expect(b.repairWarnings).toEqual([]);
    const end = tickAt(2, 18 * 60);
    step(a, end - a.state.tick);
    step(b, end - b.state.tick);
    for (const sim of [a, b]) {
      const me = sim.state.agents[z.id];
      expect(me.presence).toBe('onLot');
      expect(ctxOf(sim).statValue('shiftsWorked', z.id)).toBe(1);
      expect(ctxOf(sim).statValue('wagesEarned', z.id)).toBeGreaterThan(0);
      expect(ctxOf(sim).statValue('wagesEarned', z.id)).toBeLessThanOrEqual(19 * 8);
      expect(sim.state.household.txLog.filter((k) => k === `career:pay:${z.id}:2`)).toHaveLength(1);
      expect(sim.faults()).toEqual([]);
    }
    expect(b.state.household.funds).toBe(a.state.household.funds);
    expect(ctxOf(b).statValue('wagesEarned', z.id)).toBe(ctxOf(a).statValue('wagesEarned', z.id));
    expect(b.state.agents[z.id].career).toEqual(a.state.agents[z.id].career);
  }, 240_000);

  it('a seeded storm of junk player commands for two game days: zero faults, invariants hold', () => {
    const sim = newGame(2024, FAMILY);
    const reg = loadContent();
    const rng = createRng(seedRngState(77));
    const ids = Object.keys(reg.interactions).filter((id) => /^(social|phone|career|visit)_/.test(id));
    const junkParams: Record<string, string | number | boolean>[] = [
      {},
      { townieId: 'a99999' },
      { townieId: '' },
      { careerId: 'astronaut' },
      { careerId: 'retail' },
      { guests: 'a1,a2,nope,,a999' },
      { guests: 'x'.repeat(400) },
      { _origUid: 5, partnerOf: 'a1' },
    ];
    const breaks: string[] = [];
    for (let t = 1; t <= 2 * TICKS_PER_DAY; t++) {
      if (t % 10 === 0) {
        const members = membersOf(sim);
        const actor = members[rng.int(0, members.length - 1)];
        const agents = Object.keys(sim.state.agents);
        const roll = rng.next();
        if (roll < 0.75) {
          const interactionId = ids[rng.int(0, ids.length - 1)];
          const def = reg.interactions[interactionId];
          const target =
            def.targetKind === 'agent'
              ? { kind: 'agent' as const, id: rng.chance(0.9) ? agents[rng.int(0, agents.length - 1)] : 'a424242' }
              : def.targetKind === 'tile'
                ? { kind: 'tile' as const, x: rng.int(-3, 33), z: rng.int(-3, 33) }
                : { kind: 'self' as const };
          sim.dispatch({ type: 'queue', actorId: actor.id, interactionId, target, params: junkParams[rng.int(0, junkParams.length - 1)] });
        } else if (roll < 0.85 && sim.state.choices.length > 0) {
          sim.dispatch({ type: 'choice', choiceId: sim.state.choices[0].id, option: rng.int(-1, 4) });
        } else if (roll < 0.93) {
          const q = actor.queue[0] ?? actor.active;
          if (q) sim.dispatch({ type: 'cancel', actorId: actor.id, uid: q.uid });
        } else {
          const rewards = [...Object.keys(reg.rewards), 'reward_nope'];
          sim.dispatch({ type: 'buyReward', agentId: actor.id, rewardId: rewards[rng.int(0, rewards.length - 1)] });
        }
      }
      sim.step();
      sim.drainEvents();
      if (t % TICKS_PER_HOUR === 0) {
        const inv = sim.checkInvariants();
        if (inv.length) breaks.push(`tick ${sim.state.tick}: ${inv.slice(0, 3).join('; ')}`);
      }
    }
    expect(sim.faults()).toEqual([]);
    expect(breaks).toEqual([]);
    // the household is still a household
    expect(sim.state.household.memberIds.length).toBeGreaterThanOrEqual(3);
    for (const a of Object.values(sim.state.agents)) {
      if (a.role === 'household') expect(a.visit).toBeNull();
      if (a.role === 'townie' && a.presence === 'onLot') expect(!!a.visit || !!a.walkBy).toBe(true);
    }
  }, 300_000);
});
