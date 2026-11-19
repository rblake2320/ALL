/**
 * ADVERSARIAL: junk inputs to every people api, boundary times, repeated hooks/events, corrupted saves,
 * deleted agents/objects mid-lifecycle, the autonomy tuning guards, and a seeded fuzz run that hammers the
 * systems with random operations while checking people invariants after every step.
 */
import { describe, expect, it } from 'vitest';
import { at, createFakeSim } from './fakeCtx';
import type { AgentState } from '../../../src/sim/types';
import { createRng, seedRngState } from '../../../src/sim/rng';
import { introduceHousemates, isHostingSocial, MEAN_COOLDOWN_TICKS } from '../../../src/sim/systems/people/social';
import { createPeopleSystems } from '../../../src/sim/systems/people';
import { applySocialResult } from '../../../src/sim/systems/people/social/outcomes';
import { arriveNow, lingerWalker, scheduleArrival } from '../../../src/sim/systems/people/townies/visitorOps';
import { someoneWavingAt, superviseTownie } from '../../../src/sim/systems/people/townies/visitors';
import { createService } from '../../../src/sim/systems/people/townies/generate';
import { endParty, partyTick, startParty } from '../../../src/sim/systems/people/townies/party';
import { dailyDrift } from '../../../src/sim/systems/people/social/relations';

const JUNK: unknown[] = [undefined, null, NaN, Infinity, -1, 0, '', 'nope', 'a999999', {}, [], { id: 'a1' }, () => 1, Symbol.for('x').toString()];

function world() {
  const sim = createFakeSim({ household: ['Mortimer', 'Ghoulia'], initSystems: false });
  sim.ctx.content.lifeEvents.length = 0;
  for (const s of sim.systems) s.init?.(sim.ctx, false);
  const [m, g] = sim.state.household.memberIds.map((id) => sim.state.agents[id]);
  const towns = Object.values(sim.state.agents).filter((a) => a.role === 'townie');
  return { sim, m, g, towns };
}

/** People invariants that must hold after any sequence of operations. */
function peopleInvariants(sim: ReturnType<typeof createFakeSim>): string[] {
  const out: string[] = [];
  const s = sim.state;
  if (!Number.isInteger(s.household.funds) || s.household.funds < 0) out.push(`funds ${s.household.funds}`);
  for (const r of Object.values(s.relationships)) {
    if (!(r.friendship >= -100 && r.friendship <= 100)) out.push(`friendship ${r.a}|${r.b} ${r.friendship}`);
    if (!(r.romance >= 0 && r.romance <= 100)) out.push(`romance ${r.a}|${r.b} ${r.romance}`);
    if (r.married && !r.partners) out.push(`married but not partners ${r.a}|${r.b}`);
  }
  for (const a of Object.values(s.agents)) {
    if (a.career) {
      const def = sim.ctx.content.careers[a.career.trackId];
      if (!def) out.push(`${a.id} unknown career`);
      else if (!(a.career.level >= 1 && a.career.level <= def.levels.length)) out.push(`${a.id} career level ${a.career.level}`);
      if (!(a.career.performance >= -100 && a.career.performance <= 100)) out.push(`${a.id} performance ${a.career.performance}`);
      if (a.career.sickDaysUsed > 3) out.push(`${a.id} sick days ${a.career.sickDaysUsed}`);
    }
    if (a.walkBy && a.visit) out.push(`${a.id} both walker and visitor`);
    if (a.role === 'household' && (a.visit || a.walkBy)) out.push(`${a.id} household with visit state`);
    if (!(a.aspirationPoints >= 0)) out.push(`${a.id} points ${a.aspirationPoints}`);
    if (a.vitality > 100 || a.vitality < 20) out.push(`${a.id} vitality ${a.vitality}`);
  }
  if (s.household.memberIds.length > 8) out.push(`household ${s.household.memberIds.length}`);
  if (s.party && s.party.guestIds.length > 6) out.push(`party has ${s.party.guestIds.length} guests`);
  return out;
}

describe('autonomy tuning guards', () => {
  it('non-hosting socials need an appetite for company; hosting duties do not', () => {
    const { sim, m, g, towns } = world();
    const beh = sim.behavior('social');
    const ix = sim.ctx.content.interactions;
    m.needs.fun = 100;
    m.needs.social = 100;
    expect(beh.adjustScore!(sim.ctx, m, ix.social_joke, { kind: 'agent', id: g.id }, 20)).toBe(0);
    // a fun social's appetite is the lower of Company and Amusement: a bored zombie at full Company still jokes …
    m.needs.fun = 30;
    expect(beh.adjustScore!(sim.ctx, m, ix.social_joke, { kind: 'agent', id: g.id }, 20)).toBeCloseTo(20, 6);
    // … but plain small talk (no fun) still needs an appetite for company
    expect(beh.adjustScore!(sim.ctx, m, ix.social_chat, { kind: 'agent', id: g.id }, 20)).toBe(0);
    m.needs.fun = 100;
    m.needs.social = 80;
    expect(beh.adjustScore!(sim.ctx, m, ix.social_joke, { kind: 'agent', id: g.id }, 20)).toBeCloseTo(10, 6);
    m.needs.social = 60;
    expect(beh.adjustScore!(sim.ctx, m, ix.social_joke, { kind: 'agent', id: g.id }, 20)).toBeCloseTo(20, 6);
    // ladder: hug (friendship ≥ 30) edges out chat; repeating the last social with the same partner is damped
    sim.ctx.rel(m.id, g.id).friendship = 40;
    expect(beh.adjustScore!(sim.ctx, m, ix.social_hug, { kind: 'agent', id: g.id }, 20)).toBeCloseTo(23, 6);
    applySocialResult(sim.ctx, m, g, ix.social_hug, true);
    m.needs.social = 60;
    expect(beh.adjustScore!(sim.ctx, m, ix.social_hug, { kind: 'agent', id: g.id }, 20)).toBeCloseTo(23 * 0.7, 6);
    expect(beh.adjustScore!(sim.ctx, m, ix.social_chat, { kind: 'agent', id: g.id }, 20)).toBeCloseTo(20, 6);
    m.needs.social = 100;
    const v = towns[0];
    arriveNow(sim.ctx, v, 'dropIn');
    expect(isHostingSocial(ix.social_welcome, v)).toBe(true);
    expect(isHostingSocial(ix.social_introduce, v)).toBe(true);
    expect(isHostingSocial(ix.social_introduce, g)).toBe(false);
    expect(beh.adjustScore!(sim.ctx, m, ix.social_welcome, { kind: 'agent', id: v.id }, 20)).toBeGreaterThanOrEqual(20);
  });

  it('a pair that just argued is much less likely to argue again for 12 h; zombies in crisis are left alone', () => {
    const { sim, m, g } = world();
    const beh = sim.behavior('social');
    const ix = sim.ctx.content.interactions;
    m.needs.social = 40;
    const before = beh.adjustScore!(sim.ctx, m, ix.social_argue, { kind: 'agent', id: g.id }, 20);
    applySocialResult(sim.ctx, m, g, ix.social_argue, true);
    applySocialResult(sim.ctx, m, g, ix.social_chat, true); // a different last social: isolates the mean cooldown
    m.needs.social = 40;
    const after = beh.adjustScore!(sim.ctx, m, ix.social_argue, { kind: 'agent', id: g.id }, 20);
    expect(after).toBeCloseTo(before * 0.3, 6);
    sim.state.tick += MEAN_COOLDOWN_TICKS;
    expect(beh.adjustScore!(sim.ctx, m, ix.social_argue, { kind: 'agent', id: g.id }, 20)).toBeCloseTo(before, 6);
    g.needs.hunger = 10;
    expect(beh.adjustScore!(sim.ctx, m, ix.social_joke, { kind: 'agent', id: g.id }, 20)).toBeCloseTo(6, 6);
  });

  it('housemates start acquainted (idempotent, never lowers a closer bond)', () => {
    const { sim, m, g } = world();
    const r = sim.ctx.rel(m.id, g.id);
    expect(r).toMatchObject({ met: true, friendship: 30 });
    r.friendship = 70;
    r.met = false;
    introduceHousemates(sim.ctx);
    expect(r.friendship).toBe(70);
    introduceHousemates(sim.ctx);
    expect(r.met).toBe(true);
  });

  it('a lingering walker resumes strolling a minute after nobody is waving any more', () => {
    const { sim, m, towns } = world();
    const w = towns[1];
    arriveNow(sim.ctx, w, 'walkBy');
    m.active = sim.makeRun(m, 'social_waveOver', { kind: 'agent', id: w.id });
    lingerWalker(sim.ctx, w);
    expect(w.queue[0].interactionId).toBe('visit_linger');
    expect(someoneWavingAt(sim.ctx, w.id)).toBe(true);
    const beh = sim.behavior('visit');
    const def = sim.ctx.content.interactions.visit_linger;
    const run = sim.makeRun(w, 'visit_linger', { kind: 'self' });
    w.queue = [];
    w.active = run;
    for (let i = 0; i < 20; i++) {
      sim.state.tick++;
      expect(beh.tick!(sim.ctx, w, run, def, 0.25)).toBeUndefined();
    }
    m.active = null;
    let done = false;
    for (let i = 0; i < 8 && !done; i++) {
      sim.state.tick++;
      done = beh.tick!(sim.ctx, w, run, def, 0.25) === 'done';
    }
    expect(done).toBe(true);
    expect(someoneWavingAt(sim.ctx, 'nobody')).toBe(false);
  });
});

describe('junk inputs to every people api', () => {
  it('never throws and returns safe fallbacks', () => {
    const { sim } = world();
    for (const id of ['social', 'careers', 'townies', 'aspirations', 'events']) {
      const api = sim.api(id);
      expect(Object.keys(api).length, id).toBeGreaterThan(0);
      for (const [name, fn] of Object.entries(api)) {
        for (const a of JUNK) for (const b of JUNK.slice(0, 6)) expect(() => fn(a, b), `${id}.${name}(${String(a)}, ${String(b)})`).not.toThrow();
      }
    }
    const social = sim.api('social');
    expect(social.relationships(null)).toEqual([]);
    expect(social.label(NaN, {})).toBe('Stranger');
    expect(social.chance('x', 'y', 'social_chat')).toBeNull();
    const careers = sim.api('careers');
    expect(careers.view({})).toBeNull();
    expect(typeof careers.join(undefined, 'retail')).toBe('string');
    const towns = sim.api('townies');
    expect(Array.isArray(towns.list(undefined))).toBe(true);
    expect(typeof towns.createService(undefined)).toBe('string');
    const asp = sim.api('aspirations');
    expect(asp.view(undefined)).toBeNull();
    expect(typeof asp.buyReward(undefined, undefined)).toBe('string');
    expect(sim.api('events').fire('no-such-event')).toBe(false);
  });

  it('apis act on the SimContext appended as the last argument (two simulations side by side)', () => {
    const shared = createPeopleSystems();
    const a = createFakeSim({ household: ['Alpha'], initSystems: false, systems: shared });
    const b = createFakeSim({ household: ['Beta'], initSystems: false, systems: shared });
    for (const s of shared) s.init?.(a.ctx, false);
    for (const s of shared) s.init?.(b.ctx, false); // b is now the "current" fallback context
    const alpha = a.state.agents[a.state.household.memberIds[0]];
    const careers = shared.find((s) => s.id === 'careers')!.api!;
    expect(careers.join(alpha.id, 'retail', a.ctx)).toBe(true);
    expect(alpha.career?.trackId).toBe('retail');
    expect(careers.view(alpha.id, a.ctx)?.trackId).toBe('retail');
    expect(careers.view(alpha.id)).toBeNull(); // fallback context is b, where alpha doesn't exist
    const towns = shared.find((s) => s.id === 'townies')!.api!;
    expect(towns.list(alpha.id, a.ctx)).toHaveLength(24);
    const asp = shared.find((s) => s.id === 'aspirations')!.api!;
    expect(asp.check(a.ctx)).toEqual([]); // ctx-only call: optional agentId omitted
  });

  it('apis are safe before any hook bound a context', () => {
    for (const sys of createPeopleSystems()) {
      for (const [name, fn] of Object.entries(sys.api ?? {})) expect(() => fn('a1', 'retail'), `${sys.id}.${name}`).not.toThrow();
    }
  });

  it('effects, requirements and conditions tolerate missing actors and junk params', () => {
    const { sim, m } = world();
    const ec = { actor: null, run: null, def: null, stage: null, targetAgent: null, targetObject: null };
    for (const sys of sim.systems) {
      for (const [id, fn] of Object.entries(sys.effects ?? {})) {
        for (const p of [{}, { amount: NaN, agentId: 'ghost' }, { forward: 'yes', min: 'x', max: -5 }]) {
          expect(() => fn(sim.ctx, ec, p), `effect ${id}`).not.toThrow();
          expect(() => fn(sim.ctx, { ...ec, actor: m }, p), `effect ${id}`).not.toThrow();
        }
      }
      for (const [id, fn] of Object.entries(sys.conditions ?? {})) {
        for (const p of [{}, { min: NaN, flag: 7, tag: null, id: {}, from: 'x' }]) {
          expect(() => fn(sim.ctx, null, p), `condition ${id}`).not.toThrow();
          expect(typeof fn(sim.ctx, m, p), `condition ${id}`).toBe('boolean');
        }
      }
      for (const [id, fn] of Object.entries(sys.requirements ?? {})) {
        const rc = { actor: m, def: sim.ctx.content.interactions.phone_callInSick, target: { kind: 'self' as const }, targetAgent: null, targetObject: null, params: {} };
        expect(() => fn(sim.ctx, rc, {}), `requirement ${id}`).not.toThrow();
      }
    }
    expect(sim.state.household.funds).toBeGreaterThanOrEqual(0);
  });

  it('behaviour hooks survive runs pointing at nothing', () => {
    const { sim, m } = world();
    for (const [key, beh] of Object.entries({ social: sim.behavior('social'), phone: sim.behavior('phone'), career: sim.behavior('career'), visit: sim.behavior('visit') })) {
      for (const def of Object.values(sim.ctx.content.interactions).filter((d) => d.behavior === key)) {
        const run = sim.makeRun(m, def.id, { kind: 'agent', id: 'ghost' }, { townieId: 'ghost', careerId: 'ghost' });
        expect(() => {
          beh.available?.(sim.ctx, m, def, run.target);
          beh.begin?.(sim.ctx, m, run, def);
          beh.startStage?.(sim.ctx, m, run, def, 0);
          beh.tick?.(sim.ctx, m, run, def, 0.25);
          beh.completeStage?.(sim.ctx, m, run, def, 0);
          beh.end?.(sim.ctx, m, run, def, 'failed');
          beh.choices?.(sim.ctx, m, def, run.target);
          beh.label?.(sim.ctx, m, def, run.target);
          beh.adjustScore?.(sim.ctx, m, def, run.target, NaN);
        }, `${key}/${def.id}`).not.toThrow();
      }
    }
    expect(peopleInvariants(sim)).toEqual([]);
  });
});

describe('boundary times', () => {
  it('carpool exactly at T−30 and missed exactly at start + 60', () => {
    const { sim, m } = world();
    sim.api('careers').join(m.id, 'mortuary');
    sim.jumpTo(at(2, 8, 29, ) + 3);
    expect(m.queue.some((q) => q.interactionId === 'career_goToWork')).toBe(false);
    sim.advanceTicks(1); // 08:30:00
    expect(m.queue.some((q) => q.interactionId === 'career_goToWork')).toBe(true);
    m.queue = [];
    sim.jumpTo(at(2, 9, 59) + 3);
    expect(m.career!.shiftStatus).toBe('pending');
    sim.advanceTicks(1); // 10:00:00
    expect(m.career!.shiftStatus).toBe('missed');
  });

  it('visitors leave exactly at 01:00 and walk-bys stop at 22:00', () => {
    const { sim, towns } = world();
    const v = towns[0];
    sim.state.tick = at(1, 23);
    arriveNow(sim.ctx, v, 'invited');
    v.visit!.welcomed = true;
    v.visit!.leaveTick = at(3, 0);
    sim.jumpTo(at(2, 0, 59) + 3);
    expect(v.visit!.leaving).toBe(false);
    sim.advanceTicks(1);
    expect(v.visit!.leaving).toBe(true);
  });

  it('dayStart / hour hooks fired twice, or time running backwards, change nothing twice', () => {
    const { sim, m, g } = world();
    const r = sim.ctx.rel(m.id, g.id);
    r.friendship = 50;
    r.lastInteractionTick = -1e9;
    sim.state.tick = at(3, 0);
    for (let i = 0; i < 3; i++) for (const s of sim.systems) s.dayStart?.(sim.ctx, 3);
    expect(r.friendship).toBe(49);
    sim.state.tick = at(2, 12);
    for (const s of sim.systems) {
      s.hour?.(sim.ctx, 12);
      s.tick?.(sim.ctx, 0.25);
    }
    expect(peopleInvariants(sim)).toEqual([]);
  });
});

describe('corrupted / interleaved state', () => {
  it('deleted agents with pending arrivals, NaN needs, broken party data, removed objects', () => {
    const { sim, m, towns } = world();
    scheduleArrival(sim.ctx, towns[0].id, 0, 'dropIn');
    delete sim.state.agents[towns[0].id];
    scheduleArrival(sim.ctx, 'a424242', 0, 'party');
    m.needs.social = NaN;
    m.needs.fun = NaN as unknown as number;
    sim.state.party = { hostId: 'ghost', startTick: 0, endTick: NaN, guestIds: ['ghost', towns[1].id], score: NaN, ended: false };
    delete sim.state.objects.o1; // the front door
    expect(() => sim.advanceMinutes(5)).not.toThrow();
    expect(sim.state.flags[`people:arrive:${towns[0].id}`]).toBeUndefined();
    expect(sim.state.party!.ended).toBe(true);
    expect(Number.isFinite(sim.state.party!.score)).toBe(true);
    expect(peopleInvariants(sim)).toEqual([]);
  });

  it('a visitor who moves in mid-visit, then gets asked to leave, stays home', () => {
    const { sim, m, towns } = world();
    const v = towns[2];
    arriveNow(sim.ctx, v, 'invited');
    v.visit!.welcomed = true;
    Object.assign(sim.ctx.rel(m.id, v.id), { met: true, friendship: 60 });
    applySocialResult(sim.ctx, m, v, sim.ctx.content.interactions.social_moveIn, true);
    expect(v.role).toBe('household');
    applySocialResult(sim.ctx, m, v, sim.ctx.content.interactions.social_askToLeave, true);
    superviseTownie(sim.ctx, v);
    sim.advanceMinutes(90);
    expect(v.presence).toBe('onLot');
    expect(v.visit).toBeNull();
    expect(peopleInvariants(sim)).toEqual([]);
  });

  it('party edge cases: ending twice, ticking with no party, guests vanishing', () => {
    const { sim, m } = world();
    m.needs.fun = 90;
    expect(startParty(sim.ctx, m.id)).toBe(true);
    for (const id of sim.state.party!.guestIds) delete sim.state.agents[id];
    expect(() => {
      partyTick(sim.ctx);
      endParty(sim.ctx);
      endParty(sim.ctx);
      sim.state.party = null;
      partyTick(sim.ctx);
      endParty(sim.ctx);
    }).not.toThrow();
  });

  it('createService pools idle ghouls instead of growing the save forever', () => {
    const { sim } = world();
    const before = Object.keys(sim.state.agents).length;
    for (let i = 0; i < 100; i++) createService(sim.ctx, i % 2 ? 'repo' : 'pizza');
    expect(Object.keys(sim.state.agents).length - before).toBe(2);
  });

  it('drift with orphaned relationship records and absurd numbers', () => {
    const { sim, m } = world();
    sim.state.relationships['a1|zzz'] = { a: 'a1', b: 'zzz', friendship: 1e308, romance: -5, met: true, partners: false, engaged: false, married: false, bestFriends: true, lastInteractionTick: -Infinity, interactions: NaN };
    sim.state.tick = at(5, 0);
    expect(() => dailyDrift(sim.ctx, 5)).not.toThrow();
    expect(sim.api('social').relationships(m.id).every((r: { otherId: string }) => !!sim.state.agents[r.otherId])).toBe(true);
  });
});

describe('seeded fuzz', () => {
  it('2,000 random operations keep the people invariants', () => {
    const { sim, m, g, towns } = world();
    const rng = createRng(seedRngState(2024));
    const agents = (): AgentState[] => Object.values(sim.state.agents);
    const ix = Object.values(sim.ctx.content.interactions).filter((d) => d.social);
    const ops: (() => void)[] = [
      () => sim.advanceMinutes(rng.int(1, 90)),
      () => sim.api('careers').join(rng.pick([m, g]).id, rng.pick(['retail', 'mortuary', 'politics', 'culinary', 'necrotech', 'bogus'])),
      () => sim.api('careers').quit(rng.pick([m, g]).id),
      () => sim.api('careers').callInSick(rng.pick([m, g]).id),
      () => sim.api('townies').invite(rng.pick([m, g]).id, rng.pick(towns).id),
      () => sim.api('townies').throwParty(rng.pick([m, g]).id),
      () => sim.api('townies').createService(rng.pick(['pizza', 'repo'])),
      () => arriveNow(sim.ctx, rng.pick(towns), rng.pick(['dropIn', 'invited', 'walkBy', 'party'] as const)),
      () => {
        const a = rng.pick(agents());
        const b = rng.pick(agents());
        if (a.id !== b.id && a.presence === 'onLot' && b.presence === 'onLot') applySocialResult(sim.ctx, a, b, rng.pick(ix), rng.chance(0.5));
      },
      () => sim.api('aspirations').buyReward(rng.pick([m, g]).id, rng.pick(Object.keys(sim.ctx.content.rewards))),
      () => {
        const a = rng.pick(agents());
        a.needs[rng.pick(['hunger', 'social', 'fun', 'hygiene', 'preservation', 'energy'] as const)] = rng.pick([0, 15, 50, 100, NaN as unknown as number]);
      },
      () => {
        const c = sim.state.choices.shift();
        if (c) {
          const o = c.options[rng.int(0, c.options.length - 1)];
          sim.ctx.runEffect({ id: o.effect, params: o.params }, { actor: sim.ctx.agent(c.agentId ?? '') ?? null, run: null, def: null, stage: null, targetAgent: null, targetObject: null, choice: c });
        }
      },
      () => {
        const w = rng.pick(towns);
        if (w.walkBy) lingerWalker(sim.ctx, w);
        w.queue = [];
        w.active = null;
      },
    ];
    for (let i = 0; i < 2000; i++) {
      const op = ops[rng.int(0, ops.length - 1)];
      expect(op).not.toThrow();
      for (const a of agents()) for (const k of Object.keys(a.needs) as (keyof AgentState['needs'])[]) if (!Number.isFinite(a.needs[k])) a.needs[k] = 50;
      const bad = peopleInvariants(sim);
      if (bad.length) throw new Error(`step ${i}: ${bad.join('; ')}`);
    }
    expect(sim.faults).toEqual([]);
  });
});
