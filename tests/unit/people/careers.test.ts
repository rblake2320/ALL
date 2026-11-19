/**
 * Careers: join/quit, shift scheduling (carpool notice T−60, go-to-work T−30 at system priority, sleeper wake-up),
 * departure → atWork, away-needs drift, idempotent pay, GDD performance formula, promotion / blocked promotion,
 * firing (performance and 3 missed), missed shifts, sick days (max 3/week, Monday reset), work events + careerChoice,
 * night shifts across midnight, corrupted career repair.
 */
import { describe, expect, it } from 'vitest';
import { at, createFakeSim, HOUR } from './fakeCtx';
import type { AgentState } from '../../../src/sim/types';
import { endShift, freshCareer, sanitizeCareer } from '../../../src/sim/systems/people/careers/shift';

function hired(track = 'mortuary', opts: { mood?: number } = {}) {
  const sim = createFakeSim({ household: ['Mortimer'], initSystems: false });
  sim.ctx.content.lifeEvents.length = 0; // isolate careers from random mail / ravens
  for (const s of sim.systems) s.init?.(sim.ctx, false);
  const z = sim.state.agents[sim.state.household.memberIds[0]];
  sim.moodOverride[z.id] = opts.mood ?? 20;
  const r = sim.api('careers').join(z.id, track);
  expect(r).toBe(true);
  return { sim, z, careers: sim.api('careers') };
}

/** Drive the career behaviour as the engine would when the zombie reaches the lot exit. */
function depart(sim: ReturnType<typeof createFakeSim>, z: AgentState) {
  const q = z.queue.find((x) => x.interactionId === 'career_goToWork');
  expect(q, 'goToWork should be queued').toBeTruthy();
  z.queue = z.queue.filter((x) => x !== q);
  const beh = sim.behavior('career');
  const def = sim.ctx.content.interactions.career_goToWork;
  const run = sim.makeRun(z, 'career_goToWork', { kind: 'self' }, q!.params);
  z.active = run;
  expect(beh.begin!(sim.ctx, z, run, def)).toBeNull();
  beh.startStage!(sim.ctx, z, run, def, 0);
  beh.completeStage!(sim.ctx, z, run, def, 0);
  beh.end!(sim.ctx, z, run, def, 'complete');
  if (z.active === run) z.active = null;
}

describe('careers: joining and quitting', () => {
  it('join validates the zombie and the track; first shift skips today if the carpool already passed', () => {
    const { sim, z, careers } = hired('mortuary');
    expect(z.career).toMatchObject({ trackId: 'mortuary', level: 1, performance: 20, lastShiftDay: 1, shiftStatus: 'none' });
    expect(sim.ctx.hasMoodlet(z, 'newJob')).toBe(true);
    expect(careers.join(z.id, 'retail')).toMatch(/Already works as/);
    expect(careers.join('a999', 'retail')).toBe('Unknown zombie');
    const t = sim.addAgent({ firstName: 'Townie', role: 'townie' });
    expect(careers.join(t.id, 'retail')).toMatch(/household/);
    const y = sim.addAgent({ firstName: 'Second' });
    expect(careers.join(y.id, 'nope')).toBe('No such career');
    expect(careers.join(y.id, 'retail')).toBe(true);
    expect(y.career!.shiftStatus).toBe('pending'); // tonight's 22:00 shift is still ahead
  });

  it('quit clears the job and pending carpool; cannot quit while at work', () => {
    const { sim, z, careers } = hired('mortuary');
    sim.jumpTo(at(2, 8, 30));
    expect(z.queue.some((q) => q.interactionId === 'career_goToWork')).toBe(true);
    expect(careers.quit(z.id)).toBe(true);
    expect(z.career).toBeNull();
    expect(z.queue.some((q) => q.interactionId === 'career_goToWork')).toBe(false);
    expect(careers.quit(z.id)).toBe('Not employed');
    const h = hired('mortuary');
    h.sim.jumpTo(at(2, 8, 30));
    depart(h.sim, h.z);
    expect(h.z.presence).toBe('atWork');
    expect(h.careers.quit(h.z.id)).toMatch(/at work/);
  });

  it('available() lists all five tracks with starting titles, wages and schedules', () => {
    const { careers } = hired();
    const list = careers.available();
    expect(list).toHaveLength(5);
    expect(list.find((c: { id: string }) => c.id === 'retail')).toMatchObject({ startTitle: 'Night Stocker', wage: 17, schedule: 'Mon–Fri · 10 PM–4 AM' });
    expect(list.find((c: { id: string }) => c.id === 'culinary')).toMatchObject({ schedule: 'Wed–Sun · 4 PM–11 PM' });
  });
});

describe('careers: a full shift', () => {
  it('notifies at T−60, honks + queues go-to-work (system priority) at T−30, pays once, scores performance', () => {
    const { sim, z, careers } = hired('mortuary');
    sim.jumpTo(at(2, 7, 59));
    expect(sim.notifications().some((n) => n.includes('Carpool soon'))).toBe(false);
    sim.advanceTicks(4); // 08:00
    expect(sim.notifications().some((n) => n.includes('Carpool soon'))).toBe(true);
    expect(z.queue).toHaveLength(0);
    sim.jumpTo(at(2, 8, 30));
    const q = z.queue.find((x) => x.interactionId === 'career_goToWork')!;
    expect(q).toBeTruthy();
    expect(q.priority).toBe(300);
    expect(q.source).toBe('system');
    expect(sim.events.some((e) => e.type === 'sfx' && e.id === 'carpoolHonk')).toBe(true);
    expect(careers.view(z.id).status).toBe('The carpool is waiting!');
    const funds0 = sim.state.household.funds;
    z.needs = { hunger: 80, energy: 80, preservation: 80, social: 60, fun: 70, hygiene: 80 };
    depart(sim, z);
    expect(z.presence).toBe('atWork');
    expect(z.career!.shiftStatus).toBe('atWork');
    expect(careers.view(z.id).status).toBe('At work until 5:00 PM');
    sim.advanceMinutes(8.5 * 60 - 0.25); // up to 16:59:45
    expect(z.presence).toBe('atWork');
    sim.advanceTicks(1); // 17:00
    expect(z.presence).toBe('onLot');
    expect(sim.state.household.funds - funds0).toBe(19 * 8);
    // away drift: 8.5 h at work (08:30 → 17:00)
    expect(z.needs.hunger).toBeCloseTo(80 - 4 * 8.5, 1);
    expect(z.needs.energy).toBeCloseTo(80 - 5 * 8.5, 1); // at-work Rest −5/h since the balance pass (was −6)
    expect(z.needs.social).toBeCloseTo(Math.min(100, 60 + 3 * 8.5), 1);
    expect(z.needs.preservation).toBeCloseTo(80 - 1.3 * 8.5, 1); // no HOME decay system in this fake → careers keeps it moving
    // +8 + mood 20/10 + 2×(0/2) = +10
    expect(z.career!.performance).toBeCloseTo(30, 6);
    expect(z.career!.shiftStatus).toBe('done');
    expect(sim.ctx.statValue('shiftsWorked', z.id)).toBe(1);
    // idempotent pay: a duplicate end-of-shift (e.g. replay) doesn't pay twice
    z.career!.lastShiftDay = 2;
    z.presence = 'atWork';
    z.career!.shiftStartTick = at(2, 9);
    endShift(sim.ctx, z);
    expect(sim.state.household.funds - funds0).toBe(19 * 8);
  });

  it('applies the smell / hygiene / late penalties and Ambitious ×1.25', () => {
    const { sim, z } = hired('mortuary', { mood: 0 });
    z.traits = ['ambitious'];
    sim.jumpTo(at(2, 9, 30)); // late!
    z.needs.preservation = 20;
    z.needs.hygiene = 10;
    depart(sim, z);
    sim.jumpTo(at(2, 17));
    // gain = 8 × 1.25 = 10; −10 smell, −6 hygiene, −3 late → −9; pay prorated (7.5 of 8 h)
    expect(z.career!.performance).toBeCloseTo(20 - 9, 6);
    expect(sim.notifications().join('\n')).toMatch(/smell/);
    expect(sim.state.household.funds).toBe(1000 + Math.round(19 * 8 * (7.5 / 8)));
  });

  it('wakes a sleeping zombie for the carpool', () => {
    const { sim, z } = hired('mortuary');
    sim.jumpTo(at(2, 8, 29));
    z.active = sim.makeRun(z, 'test_sleep', { kind: 'self' });
    z.anim = 'sleep';
    sim.advanceTicks(4);
    expect(z.active).toBeNull();
    expect(z.queue[0].interactionId).toBe('career_goToWork');
    expect(sim.events.some((e) => e.type === 'bubble' && e.icon === 'exclamation')).toBe(true);
  });

  it('re-queues a cancelled go-to-work (10 min cooldown) until the 60-min grace runs out → missed shift', () => {
    const { sim, z, careers } = hired('mortuary');
    sim.jumpTo(at(2, 8, 30));
    z.queue = [];
    sim.advanceMinutes(5);
    expect(z.queue).toHaveLength(0);
    sim.advanceMinutes(6);
    expect(z.queue.some((q) => q.interactionId === 'career_goToWork')).toBe(true);
    z.queue = [];
    sim.jumpTo(at(2, 10));
    expect(z.career!.shiftStatus).toBe('missed');
    expect(z.career!.performance).toBe(20 - 25);
    expect(z.career!.missedStreak).toBe(1);
    expect(z.queue).toHaveLength(0);
    expect(careers.view(z.id).status).toMatch(/Missed today/);
    sim.jumpTo(at(2, 12));
    expect(z.career!.missedStreak).toBe(1); // missed once per day only
  });

  it('three missed shifts in a row get you fired', () => {
    const { sim, z } = hired('mortuary');
    for (const day of [2, 3, 4]) {
      sim.jumpTo(at(day, 10, 1));
      z.queue = [];
    }
    expect(z.career).toBeNull();
    expect(sim.ctx.hasMoodlet(z, 'fired')).toBe(true);
    expect(sim.ctx.statValue('firings', z.id)).toBe(1);
  });

  it('promotes at ≥ 100 with skills, caps at 100 and explains without them, fires at ≤ −80', () => {
    const { sim, z, careers } = hired('mortuary');
    z.career!.performance = 95;
    z.skills.mortuary.level = 1;
    sim.jumpTo(at(2, 8, 30));
    depart(sim, z);
    sim.jumpTo(at(2, 17));
    expect(z.career!.performance).toBe(100);
    expect(z.career!.level).toBe(1);
    expect(sim.notifications().join('\n')).toMatch(/needs Mortuary Science 2/);
    z.skills.mortuary.level = 2;
    sim.jumpTo(at(3, 8, 30));
    depart(sim, z);
    sim.jumpTo(at(3, 17));
    expect(z.career!.level).toBe(2);
    expect(z.career!.performance).toBe(20);
    expect(sim.ctx.hasMoodlet(z, 'promoted')).toBe(true);
    expect(sim.events.some((e) => e.type === 'promotion' && e.title === 'Embalmer’s Assistant')).toBe(true);
    expect(careers.view(z.id)).toMatchObject({ level: 2, title: 'Embalmer’s Assistant', wage: 24, nextTitle: 'Embalmer' });
    z.career!.performance = -70;
    sim.jumpTo(at(4, 10, 1)); // missed → −95 → fired
    expect(z.career).toBeNull();
  });
});

describe('careers: sick days', () => {
  it('max 3 per week, −5 performance, no carpool; reset on Monday', () => {
    const { sim, z, careers } = hired('mortuary');
    for (const day of [2, 3, 4]) {
      sim.jumpTo(at(day, 7));
      expect(careers.callInSick(z.id)).toBe(true);
      expect(z.career!.shiftStatus).toBe('sick');
      sim.jumpTo(at(day, 8, 45));
      expect(z.queue.some((q) => q.interactionId === 'career_goToWork')).toBe(false);
    }
    expect(z.career!.performance).toBe(20 - 15);
    sim.jumpTo(at(5, 7));
    expect(careers.callInSick(z.id)).toMatch(/No sick days left/);
    expect(careers.callInSick(z.id)).toMatch(/No sick days left/);
    sim.jumpTo(at(8, 7)); // next Monday
    expect(z.career!.sickDaysUsed).toBe(0);
    expect(careers.callInSick(z.id)).toBe(true);
    expect(careers.callInSick(z.id)).toMatch(/No shift to skip/);
  });

  it('cannot call in sick on a day off, after the shift started, or while away', () => {
    const { sim, z, careers } = hired('mortuary');
    sim.jumpTo(at(6, 9)); // Saturday
    expect(careers.callInSick(z.id)).toMatch(/No shift/);
    sim.jumpTo(at(8, 10, 30)); // Monday after the grace window
    expect(careers.callInSick(z.id)).toMatch(/No shift|Too late/);
    expect(careers.callInSick('ghost')).toBe('Unknown zombie');
  });
});

describe('careers: night shift + work events', () => {
  it('Graveyard Retail 22:00 → 04:00 crosses midnight and pays $102', () => {
    const { sim, z } = hired('retail');
    expect(z.career!.shiftStatus).toBe('pending');
    sim.jumpTo(at(1, 21, 30));
    depart(sim, z);
    expect(z.presence).toBe('atWork');
    sim.jumpTo(at(2, 3, 59));
    expect(z.presence).toBe('atWork');
    sim.advanceTicks(4);
    expect(z.presence).toBe('onLot');
    expect(sim.state.household.funds).toBe(1000 + 102);
    expect(z.career!.lastShiftDay).toBe(1);
    expect(z.career!.shiftStatus).toBe('done');
    sim.advanceTicks(1);
    expect(z.career!.shiftStatus).toBe('pending'); // tonight's shift
    sim.jumpTo(at(2, 21, 30));
    expect(z.queue.some((q) => q.interactionId === 'career_goToWork')).toBe(true);
  });

  it('a scheduled work event offers a choice whose careerChoice options apply perf, funds, needs and moodlets', () => {
    const { sim, z } = hired('necrotech');
    sim.jumpTo(at(2, 8, 30));
    depart(sim, z);
    sim.state.flags[`people:car:event:${z.id}`] = sim.state.tick + 4;
    sim.advanceTicks(5);
    const choice = sim.state.choices[0];
    expect(choice).toBeTruthy();
    expect(choice.agentId).toBe(z.id);
    expect(choice.options.length).toBeGreaterThanOrEqual(3);
    expect(choice.options[choice.defaultOption].params.safe).toBe(true);
    expect(choice.expiresTick - choice.tick).toBe(120 * 4);
    const perf0 = z.career!.performance;
    const safe = choice.options[choice.defaultOption];
    sim.ctx.runEffect({ id: safe.effect, params: safe.params }, { actor: z, run: null, def: null, stage: null, targetAgent: null, targetObject: null, choice });
    expect(z.career!.performance).not.toBe(perf0);
  });

  it('careerChoice: gamble branches, costs, insufficient funds, idempotent payouts, missing agents', () => {
    const { sim, z } = hired('mortuary');
    const ec = (choiceId: string) => ({ actor: z, run: null, def: null, stage: null, targetAgent: null, targetObject: null, choice: { id: choiceId, tick: 0, title: 'Mortimer at work: Test', text: '', agentId: z.id, options: [], expiresTick: 0, defaultOption: 0 } });
    sim.ctx.runEffect({ id: 'careerChoice', params: { perf: 5, funds: 50, fun: -10, moodlet: 'officeHero', text: 'yay' } }, ec('c1'));
    expect(z.career!.performance).toBe(25);
    expect(sim.state.household.funds).toBe(1050);
    expect(z.needs.fun).toBe(60);
    expect(sim.ctx.hasMoodlet(z, 'officeHero')).toBe(true);
    sim.ctx.runEffect({ id: 'careerChoice', params: { funds: 50 } }, ec('c1'));
    expect(sim.state.household.funds).toBe(1050); // same choice id → idempotent
    sim.state.household.funds = 10;
    sim.ctx.runEffect({ id: 'careerChoice', params: { funds: -30, perf: 8, text: 'paid' } }, ec('c2'));
    expect(sim.state.household.funds).toBe(10);
    expect(z.career!.performance).toBe(33);
    expect(sim.notifications().join('\n')).toMatch(/Couldn’t afford/);
    sim.ctx.runEffect({ id: 'careerChoice', params: { chance: 0, perf: 50, failPerf: -4, failMoodlet: 'officeShame', failText: 'boo' } }, ec('c3'));
    expect(z.career!.performance).toBe(29);
    expect(sim.ctx.hasMoodlet(z, 'officeShame')).toBe(true);
    sim.ctx.runEffect({ id: 'careerChoice', params: { chance: 1, perf: 1, xp: 30 } }, ec('c4'));
    expect(z.career!.performance).toBe(30);
    expect(z.skills.mortuary.xp).toBe(30);
    sim.ctx.runEffect({ id: 'careerChoice', params: { agentId: 'ghost', perf: 99 } }, { actor: null, run: null, def: null, stage: null, targetAgent: null, targetObject: null });
    sim.ctx.runEffect({ id: 'careerChoice', params: { perf: NaN, funds: Infinity, moodlet: 'notAMoodlet' } }, ec('c5'));
    expect(z.career!.performance).toBe(30);
    expect(sim.faults).toEqual([]);
  });
});

describe('careers: robustness', () => {
  it('sanitizes corrupted career state and drops unknown tracks', () => {
    const { sim, z } = hired('mortuary');
    Object.assign(z.career!, { level: 99, performance: NaN, missedStreak: -3, shiftStatus: 'weird', sickDaysUsed: 12, shiftStartTick: 'x' });
    sanitizeCareer(sim.ctx, z);
    expect(z.career).toMatchObject({ level: 5, performance: 20, missedStreak: 0, shiftStatus: 'none', sickDaysUsed: 3, shiftStartTick: null });
    z.career = { ...freshCareer('notATrack') };
    sim.advanceTicks(1);
    expect(z.career).toBeNull();
    expect(sim.api('careers').view(z.id)).toBeNull();
  });

  it('an away zombie whose job vanished comes home; crumbled zombies are excused', () => {
    const { sim, z } = hired('mortuary');
    sim.jumpTo(at(2, 8, 30));
    depart(sim, z);
    z.career = null;
    sim.advanceTicks(1);
    expect(z.presence).toBe('onLot');
    const h = hired('mortuary');
    h.z.presence = 'crumbled';
    h.sim.jumpTo(at(2, 8, 31));
    expect(h.z.career!.shiftStatus).toBe('sick');
    expect(h.z.career!.performance).toBe(20);
  });

  it('views and requirements never throw on junk input', () => {
    const { sim, z } = hired('mortuary');
    const c = sim.api('careers');
    expect(c.view(undefined)).toBeNull();
    expect(c.view('nobody')).toBeNull();
    expect(c.join(null, null)).toBe('Unknown zombie');
    expect(c.quit(42)).toBe('Unknown zombie');
    const rc = { actor: z, def: sim.ctx.content.interactions.phone_quitJob, target: { kind: 'self' as const }, targetAgent: null, targetObject: null, params: {} };
    expect(sim.ctx.checkRequirement({ id: 'hasCareer' }, rc)).toBe(true);
    expect(sim.ctx.checkRequirement({ id: 'noCareer' }, rc)).toMatch(/Already works/);
    expect(sim.ctx.evalCondition({ kind: 'careerLevel', params: { min: 1 } }, z)).toBe(true);
    expect(sim.ctx.evalCondition({ kind: 'careerLevel', params: { min: 2 } }, z)).toBe(false);
    expect(sim.ctx.evalCondition({ kind: 'careerLevel', params: { min: 1 } }, null)).toBe(false);
    expect(HOUR).toBe(240);
  });
});
