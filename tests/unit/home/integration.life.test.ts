/**
 * A household living unattended on the REAL stack — createSimulation(createNewWorld(...)) with the engine, spatial,
 * home and people systems — for several game days. Proves the autonomy loop the home content feeds actually keeps
 * zombies alive and sane: they eat, sleep, go to work, socialise, pay their own bills (and get the power back
 * once they can afford it), keep their needs mostly above 15, while the world stays fault-free and invariant-clean.
 *
 * Known balance issue (docs/CONTRACTS.md decision #13): an employed zombie in the starter home (whose only freshness
 * restorer is the $15 spray) still drifts toward low freshness/fun by day 4–5; that is left to the integration
 * balance pass, so the employed member is held to the hunger/energy/hygiene bar only.
 */
import { describe, expect, it } from 'vitest';
import type { SimContext, SimulationAPI } from '../../../src/sim/contracts';
import type { NeedId } from '../../../src/sim/types';
import { NEED_IDS, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { defaultAppearance } from '../../../src/shared/appearance';
import { IX } from '../../../src/sim/content/home/ids';

/** Multi-day runs are CPU-bound and other agents share this machine: allow generous wall time. */
const HEAVY = 600_000;

const EAT = new Set<string>([IX.haveServing, IX.eatLeftovers, IX.grabJerky, IX.microwaveBurrito]);
const SLEEP = new Set<string>([IX.sleep, IX.nap, 'engine_passOut']);

interface Life {
  sim: SimulationAPI;
  ctx: SimContext;
  ids: string[];
  /** interaction id → runs started, per member */
  runs: Record<string, Record<string, number>>;
  /** hourly-ish need samples (on the lot or at work) */
  samples: Record<string, number>;
  below15: Record<string, Record<NeedId, number>>;
  lastUid: Record<string, number | null>;
}

const TRAITS = [
  ['gourmand', 'clumsy', 'vain'],
  ['neatFreak', 'bookworm', 'artistic'],
  ['lazy', 'partyAnimal', 'squeamish'],
  ['ambitious', 'cheerful', 'nightOwl'],
];
const NAMES = ['Mort', 'Ghoulia', 'Rotney', 'Grimelda'];

function household(seed: number, size: number): Life {
  const sim = createSimulation(
    createNewWorld({
      seed,
      householdName: 'Grimsby',
      members: NAMES.slice(0, size).map((firstName, i) => ({
        firstName,
        lastName: 'Grimsby',
        appearance: defaultAppearance(),
        traits: TRAITS[i],
        aspiration: null,
      })),
      lotTemplate: 'starter',
      difficulty: 'normal',
    }),
  );
  const ctx = (sim as unknown as { engine: { ctx: SimContext } }).engine.ctx;
  const ids = [...sim.state.household.memberIds];
  const life: Life = { sim, ctx, ids, runs: {}, samples: {}, below15: {}, lastUid: {} };
  for (const id of ids) {
    life.runs[id] = {};
    life.samples[id] = 0;
    life.below15[id] = Object.fromEntries(NEED_IDS.map((n) => [n, 0])) as Record<NeedId, number>;
    life.lastUid[id] = null;
  }
  return life;
}

function live(life: Life, ticks: number): void {
  const { sim, ids } = life;
  for (let i = 0; i < ticks; i++) {
    sim.step();
    if (i % 240 === 0) sim.drainEvents();
    for (const id of ids) {
      const a = sim.state.agents[id];
      const run = a.active;
      if (run && run.uid !== life.lastUid[id]) {
        life.lastUid[id] = run.uid;
        life.runs[id][run.interactionId] = (life.runs[id][run.interactionId] ?? 0) + 1;
      } else if (!run) life.lastUid[id] = null;
      if (sim.state.tick % 60 === 0 && (a.presence === 'onLot' || a.presence === 'atWork')) {
        life.samples[id]++;
        for (const n of NEED_IDS) if (a.needs[n] < 15) life.below15[id][n]++;
      }
    }
  }
  sim.drainEvents();
}

const count = (life: Life, id: string, pred: (interactionId: string) => boolean): number =>
  Object.entries(life.runs[id]).reduce((n, [k, v]) => (pred(k) ? n + v : n), 0);

const lowShare = (life: Life, id: string, need: NeedId): number => life.below15[id][need] / Math.max(1, life.samples[id]);

describe('home × engine × people: an unattended household lives its life', () => {
  it('three zombies (one employed) eat, sleep, work, socialise and keep their needs up for 4 days — no faults, clean invariants', () => {
    const life = household(1234, 3);
    const { sim, ctx, ids } = life;
    const [worker, ...homebodies] = ids;
    expect(ctx.sys('careers').join(worker, 'mortuary')).toBe(true);
    live(life, 4 * TICKS_PER_DAY); // Mon 09:00 → Fri 09:00

    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
    expect(sim.state.gameOver).toBe(false);
    for (const id of ids) {
      const a = sim.state.agents[id];
      const who = a.firstName;
      expect(['onLot', 'atWork'], who).toContain(a.presence);
      expect(count(life, id, (k) => EAT.has(k)), `${who} ate`).toBeGreaterThanOrEqual(4);
      expect(count(life, id, (k) => SLEEP.has(k)), `${who} slept`).toBeGreaterThanOrEqual(2);
      expect(count(life, id, (k) => k.startsWith('social_')), `${who} socialised`).toBeGreaterThanOrEqual(1);
      for (const n of ['hunger', 'energy', 'hygiene'] as const) expect(lowShare(life, id, n), `${who} ${n} < 15`).toBeLessThanOrEqual(0.15);
      expect(a.needs.preservation).toBeLessThanOrEqual(a.vitality);
    }
    // The employed zombie took the carpool on the weekdays after joining.
    expect(sim.state.stats.agent[worker]?.shiftsWorked ?? 0).toBeGreaterThanOrEqual(2);
    expect(count(life, worker, (k) => k === 'career_goToWork')).toBeGreaterThanOrEqual(2);
    // The ones at home keep EVERY need (freshness included) above 15 almost all the time.
    for (const id of homebodies) {
      for (const n of NEED_IDS) expect(lowShare(life, id, n), `${sim.state.agents[id].firstName} ${n} < 15`).toBeLessThanOrEqual(0.05);
    }
    // The kitchen ran: meals cooked and eaten, but nobody re-cooked all day (gourmand spam is gone).
    const c = sim.state.stats.counters;
    expect(c.mealsEaten ?? 0).toBeGreaterThanOrEqual(12);
    expect(c.mealsCooked ?? 0).toBeGreaterThanOrEqual(3);
    expect(c.mealsCooked ?? 0).toBeLessThanOrEqual(16);
    // The Thursday 09:00 bill arrived; the household is still solvent.
    expect(sim.state.household.bills.length).toBeGreaterThanOrEqual(1);
    expect(sim.state.household.funds).toBeGreaterThan(0);
  }, HEAVY);

  it('pays a bill that falls due on its own; a broke household loses power and pays as soon as money arrives', () => {
    const life = household(4242, 2);
    const { sim, ctx } = life;
    live(life, TICKS_PER_HOUR * 2);

    // A bill due in 18 h: autonomy settles it (mailbox or PC) without any player input.
    const id1 = ctx.sys('economy').issueBill() as string;
    const bill1 = sim.state.household.bills.find((b) => b.id === id1)!;
    bill1.dueTick = sim.state.tick + TICKS_PER_HOUR * 18;
    const funds0 = sim.state.household.funds;
    live(life, TICKS_PER_HOUR * 14);
    expect(bill1.paidTick, 'bill due tomorrow paid').not.toBeNull();
    expect(sim.state.household.funds).toBeLessThanOrEqual(funds0 - bill1.amount);
    expect(sim.state.stats.counters.billsPaid ?? 0).toBeGreaterThanOrEqual(1);
    expect(ctx.sys('economy').bills().outstanding).toBe(0);

    // Broke: a 4-days-overdue bill cuts the power at the next hour and nobody can pay it.
    const savings = sim.state.household.funds;
    sim.state.household.funds = 0;
    const id2 = ctx.sys('economy').issueBill() as string;
    const bill2 = sim.state.household.bills.find((b) => b.id === id2)!;
    bill2.dueTick = sim.state.tick - 4 * TICKS_PER_DAY - TICKS_PER_HOUR;
    live(life, TICKS_PER_HOUR * 2);
    expect(sim.state.household.utilitiesOn).toBe(false);
    expect(bill2.paidTick).toBeNull();

    // Payday: the household pays on its own and the lights come back.
    sim.state.household.funds = savings;
    live(life, TICKS_PER_HOUR * 12);
    expect(bill2.paidTick, 'overdue bill paid once affordable').not.toBeNull();
    expect(sim.state.household.utilitiesOn).toBe(true);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  }, HEAVY);

  it('the carpool wakes a sleeping zombie gracefully: the sleep ends, they go to work and come home', () => {
    const life = household(99, 1);
    const { sim, ctx, ids } = life;
    const [id] = ids;
    expect(ctx.sys('careers').join(id, 'mortuary')).toBe(true);
    // Mon 09:00 → Tue 07:30, then tuck them into the coffin at 07:30 (the carpool honks at 08:30).
    live(life, TICKS_PER_DAY - TICKS_PER_HOUR * 1.5);
    const a = sim.state.agents[id];
    expect(a.presence).toBe('onLot');
    if (a.active) sim.dispatch({ type: 'cancel', actorId: id, uid: a.active.uid });
    live(life, 8);
    a.needs.energy = 40;
    a.needs.hunger = 90; // fed, so the sleep isn't put off for dinner
    const coffin = Object.values(sim.state.objects).find((o) => o.defId === 'coffin_pine')!;
    expect(sim.dispatch({ type: 'queue', actorId: id, interactionId: IX.sleep, target: { kind: 'object', id: coffin.id } }).ok).toBe(true);
    let slept = false;
    let wentToWork = false;
    for (let i = 0; i < TICKS_PER_HOUR * 3 && !wentToWork; i++) {
      live(life, 1);
      if (a.active?.interactionId === IX.sleep && a.active.phase === 'run') slept = true;
      if (a.presence === 'atWork') wentToWork = true;
    }
    expect(slept).toBe(true);
    expect(wentToWork).toBe(true);
    expect(a.active).toBeNull();
    // A full shift later they are home again, with a shift on the books.
    live(life, TICKS_PER_HOUR * 10);
    expect(a.presence).toBe('onLot');
    expect(sim.state.stats.agent[id]?.shiftsWorked ?? 0).toBeGreaterThanOrEqual(1);
    expect(sim.faults()).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
  }, HEAVY);
});
