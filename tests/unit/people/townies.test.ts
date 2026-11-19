/**
 * Townies: deterministic generation, service NPCs, walk-bys, drop-ins, the visitor lifecycle (doorbell → welcome →
 * leave at leaveTick / 01:00 / miserable / unwelcomed), invitations, parties and the phone behaviour.
 */
import { describe, expect, it } from 'vitest';
import { at, createFakeSim, DOOR_EDGE } from './fakeCtx';
import type { AgentState, ObjectState } from '../../../src/sim/types';
import type { SimSystem } from '../../../src/sim/contracts';
import { TOWNIE_COUNT, createService, generateTownies } from '../../../src/sim/systems/people/townies/generate';
import { arriveNow, doorTile, pendingArrival, scheduleArrival } from '../../../src/sim/systems/people/townies/visitorOps';
import { inviteTownie, visitorsHour } from '../../../src/sim/systems/people/townies/visitors';
import { endParty, startParty } from '../../../src/sim/systems/people/townies/party';
import { townieList } from '../../../src/sim/systems/people/townies';

function townSim(seed = 77) {
  const sim = createFakeSim({ seed, household: ['Mortimer', 'Ghoulia'], initSystems: false });
  sim.ctx.content.lifeEvents.length = 0;
  for (const s of sim.systems) s.init?.(sim.ctx, false);
  const [m, g] = sim.state.household.memberIds.map((id) => sim.state.agents[id]);
  const towns = Object.values(sim.state.agents).filter((a) => a.role === 'townie');
  return { sim, m, g, towns };
}

const signature = (agents: AgentState[]) => agents.map((a) => `${a.firstName} ${a.lastName}|${a.traits.join(',')}|${a.occupation}|${a.appearance.hairStyle}|${a.appearance.skinTone}`);

describe('townie generation', () => {
  it('creates 24 off-lot townies with 3 non-conflicting traits, unique names and an occupation', () => {
    const { sim, towns } = townSim();
    expect(towns).toHaveLength(TOWNIE_COUNT);
    const names = new Set(towns.map((t) => `${t.firstName} ${t.lastName}`));
    expect(names.size).toBe(TOWNIE_COUNT);
    for (const t of towns) {
      expect(t.presence).toBe('offLot');
      expect(t.traits).toHaveLength(3);
      expect(sim.ctx.content.names.occupations).toContain(t.occupation);
      for (const tr of t.traits) {
        const def = sim.ctx.content.traits[tr];
        expect(def.reward).toBe(false);
        for (const other of t.traits) expect(def.conflicts).not.toContain(other);
      }
      expect(t.vitality).toBeGreaterThanOrEqual(80);
      expect(t.needs.preservation).toBeLessThanOrEqual(t.vitality);
    }
  });

  it('is deterministic per seed and independent of the world rng stream', () => {
    const a = townSim(5);
    const b = townSim(5);
    const c = townSim(6);
    expect(signature(a.towns)).toEqual(signature(b.towns));
    expect(signature(a.towns)).not.toEqual(signature(c.towns));
  });

  it('is idempotent (init twice, load) and repairs saves that have no townies', () => {
    const { sim } = townSim();
    expect(generateTownies(sim.ctx)).toBe(0);
    for (const s of sim.systems) s.init?.(sim.ctx, true);
    expect(Object.values(sim.state.agents).filter((a) => a.role === 'townie')).toHaveLength(TOWNIE_COUNT);
    const bare = createFakeSim({ initSystems: false });
    for (const s of bare.systems) s.init?.(bare.ctx, true);
    expect(Object.values(bare.state.agents).filter((a) => a.role === 'townie')).toHaveLength(TOWNIE_COUNT);
  });
});

describe('service NPCs (createService for SIM-HOME)', () => {
  it('creates off-lot service agents and reuses idle ones', () => {
    const { sim } = townSim();
    const api = sim.api('townies');
    const p1 = api.createService('pizza');
    const pizza = sim.state.agents[p1];
    expect(pizza).toMatchObject({ role: 'service', presence: 'offLot', occupation: 'Pizza Delivery Ghoul' });
    expect(api.createService('pizza')).toBe(p1);
    sim.ctx.spawnAgent(p1);
    const p2 = api.createService('pizza');
    expect(p2).not.toBe(p1);
    const repo = sim.state.agents[api.createService('repo')];
    expect(repo.occupation).toBe('Repo Ghoul');
    expect(repo.appearance.topStyle).toBe('suit');
    pizza.presence = 'gone';
    pizza.queue = [{ uid: 1, interactionId: 'x', target: { kind: 'self' }, params: {}, source: 'system', priority: 300, queuedTick: 0 }];
    expect(createService(sim.ctx, 'pizza')).toBe(p1);
    expect(pizza.presence).toBe('offLot');
    expect(pizza.queue).toEqual([]);
    expect(sim.state.agents[createService(sim.ctx, 'nonsense')].occupation).toBe('Pizza Delivery Ghoul');
  });
});

describe('walk-bys', () => {
  it('a scheduled walk-by spawns on the sidewalk, strolls to the far end and despawns there', () => {
    const { sim, towns } = townSim();
    const w = towns[0];
    scheduleArrival(sim.ctx, w.id, 0, 'walkBy');
    sim.advanceTicks(4);
    expect(w.presence).toBe('onLot');
    expect(w.walkBy).not.toBeNull();
    expect(w.visit).toBeNull();
    const q = w.queue.find((x) => x.interactionId === 'visit_walkBy')!;
    expect(q.target).toEqual({ kind: 'tile', x: Math.floor(w.walkBy!.to.x), z: Math.floor(w.walkBy!.to.z) });
    expect(Math.abs(w.walkBy!.to.x - w.walkBy!.from.x)).toBeGreaterThan(20);
    // engine finishes the walk: behaviour end('complete') despawns
    const beh = sim.behavior('visit');
    const def = sim.ctx.content.interactions.visit_walkBy;
    const run = sim.makeRun(w, 'visit_walkBy', q.target);
    w.queue = [];
    w.active = run;
    expect(beh.begin!(sim.ctx, w, run, def)).toBeNull();
    beh.end!(sim.ctx, w, run, def, 'complete');
    expect(w.presence).toBe('offLot');
    expect(w.walkBy).toBeNull();
  });

  it('the supervisor re-queues an interrupted stroll, and gives up on stuck walkers after 90 min', () => {
    const { sim, towns } = townSim();
    const w = towns[1];
    arriveNow(sim.ctx, w, 'walkBy');
    w.queue = [];
    sim.advanceTicks(1);
    expect(w.queue[0].interactionId).toBe('visit_walkBy');
    w.queue = [];
    w.pos = { ...w.walkBy!.to };
    sim.advanceTicks(1);
    expect(w.presence).toBe('offLot');
    const v = towns[2];
    arriveNow(sim.ctx, v, 'walkBy');
    sim.advanceMinutes(91);
    expect(v.presence).toBe('offLot');
  });

  it('hourly: ~20 % between 07 and 22 when fewer than 2 visitors; never at night, when disabled, or with nobody home', () => {
    const { sim } = townSim(9);
    let scheduled = 0;
    const trials = 400;
    for (let i = 0; i < trials; i++) {
      for (const k of Object.keys(sim.state.flags)) if (k.startsWith('people:arrive')) delete sim.state.flags[k];
      for (const k of Object.keys(sim.state.flags)) if (k.startsWith('people:lastVisit')) delete sim.state.flags[k];
      visitorsHour(sim.ctx, 12);
      if (Object.keys(sim.state.flags).some((k) => k.startsWith('people:arriveWhy') && sim.state.flags[k] === 'walkBy')) scheduled++;
    }
    expect(scheduled / trials).toBeGreaterThan(0.13);
    expect(scheduled / trials).toBeLessThan(0.27);
    const clean = () => {
      for (const k of Object.keys(sim.state.flags)) if (k.startsWith('people:arrive')) delete sim.state.flags[k];
    };
    clean();
    for (let i = 0; i < 100; i++) visitorsHour(sim.ctx, 23);
    expect(Object.keys(sim.state.flags).some((k) => k.startsWith('people:arrive'))).toBe(false);
    sim.state.settings.visitorsEnabled = false;
    for (let i = 0; i < 100; i++) visitorsHour(sim.ctx, 12);
    expect(Object.keys(sim.state.flags).some((k) => k.startsWith('people:arrive'))).toBe(false);
    sim.state.settings.visitorsEnabled = true;
    for (const id of sim.state.household.memberIds) sim.state.agents[id].presence = 'atWork';
    for (let i = 0; i < 100; i++) visitorsHour(sim.ctx, 12);
    expect(Object.keys(sim.state.flags).some((k) => k.startsWith('people:arrive'))).toBe(false);
  });
});

describe('drop-ins', () => {
  it('only friends (≥ 35) drop in, 10:00–21:00', () => {
    const { sim, m, towns } = townSim(11);
    let dropped = 0;
    for (let i = 0; i < 300; i++) {
      visitorsHour(sim.ctx, 15);
      if (Object.keys(sim.state.flags).some((k) => k.startsWith('people:arriveWhy') && sim.state.flags[k] === 'dropIn')) dropped++;
      for (const k of Object.keys(sim.state.flags)) if (k.startsWith('people:arrive') || k.startsWith('people:lastVisit')) delete sim.state.flags[k];
    }
    expect(dropped).toBe(0);
    for (const t of towns.slice(0, 5)) Object.assign(sim.ctx.rel(m.id, t.id), { met: true, friendship: 40 });
    sim.state.settings.visitorsEnabled = true;
    for (let i = 0; i < 300; i++) {
      visitorsHour(sim.ctx, 15);
      const why = Object.keys(sim.state.flags).filter((k) => k.startsWith('people:arriveWhy') && sim.state.flags[k] === 'dropIn');
      if (why.length) {
        dropped++;
        const id = why[0].slice('people:arriveWhy:'.length);
        expect(towns.slice(0, 5).map((t) => t.id)).toContain(id);
      }
      for (const k of Object.keys(sim.state.flags)) if (k.startsWith('people:arrive') || k.startsWith('people:lastVisit')) delete sim.state.flags[k];
    }
    expect(dropped).toBeGreaterThan(5);
  });
});

describe('visitor lifecycle', () => {
  it('the front-door tile is the outdoor side of the door closest to the street', () => {
    const { sim } = townSim();
    expect(DOOR_EDGE).toBe('h:15:20');
    expect(doorTile(sim.ctx)).toEqual({ x: 15, z: 20 });
    delete sim.state.objects.o1;
    const t = doorTile(sim.ctx);
    expect(t.z).toBe(26); // front yard fallback
  });

  it('drop-in → doorbell wait → welcomed → leaves at leaveTick via visit_leave → despawned off-lot', () => {
    const { sim, m, towns } = townSim();
    const v = towns[3];
    expect(arriveNow(sim.ctx, v, 'dropIn')).toBe(true);
    expect(v.visit).toMatchObject({ reason: 'dropIn', welcomed: false, leaving: false });
    expect(v.visit!.leaveTick - v.visit!.arrivedTick).toBeGreaterThanOrEqual(120 * 4);
    expect(v.visit!.leaveTick - v.visit!.arrivedTick).toBeLessThanOrEqual(240 * 4);
    expect(v.queue[0]).toMatchObject({ interactionId: 'visit_waitAtDoor', target: { kind: 'tile', x: 15, z: 20 }, priority: 300 });
    expect(sim.notifications().join('\n')).toMatch(/doorbell/);
    // waiting: doorbell repeats every 20 minutes, max 3
    const beh = sim.behavior('visit');
    const def = sim.ctx.content.interactions.visit_waitAtDoor;
    const run = sim.makeRun(v, 'visit_waitAtDoor', v.queue[0].target);
    v.queue = [];
    v.active = run;
    beh.startStage!(sim.ctx, v, run, def, 0);
    let rings = 0;
    for (let i = 0; i < 4 * 70; i++) {
      sim.state.tick++;
      const before = sim.events.length;
      expect(beh.tick!(sim.ctx, v, run, def, 0.25)).toBeUndefined();
      rings += sim.events.slice(before).filter((e) => e.type === 'sfx' && e.id === 'doorbell').length;
    }
    expect(rings).toBe(2);
    // welcomed → the wait ends
    sim.api('social');
    v.visit!.welcomed = true;
    expect(beh.tick!(sim.ctx, v, run, def, 0.25)).toBe('done');
    v.active = null;
    // stays until leaveTick
    sim.state.tick = v.visit!.leaveTick - 1;
    sim.advanceTicks(1);
    expect(v.visit!.leaving).toBe(true);
    expect(v.queue[0].interactionId).toBe('visit_leave');
    const leaveDef = sim.ctx.content.interactions.visit_leave;
    const lrun = sim.makeRun(v, 'visit_leave', { kind: 'self' });
    v.queue = [];
    v.active = lrun;
    beh.end!(sim.ctx, v, lrun, leaveDef, 'complete');
    expect(v.presence).toBe('offLot');
    expect(v.visit).toBeNull();
    expect(m.presence).toBe('onLot');
  });

  it('leaves when unwelcomed for an hour (friendship −3), at the 01:00 curfew, or when miserable', () => {
    const { sim, m, towns } = townSim();
    const a = towns[4];
    Object.assign(sim.ctx.rel(m.id, a.id), { met: true, friendship: 20 });
    arriveNow(sim.ctx, a, 'dropIn');
    sim.advanceMinutes(61);
    expect(a.visit!.leaving).toBe(true);
    expect(sim.ctx.rel(m.id, a.id).friendship).toBe(17);
    expect(sim.notifications().join('\n')).toMatch(/tired of ringing/);

    const b = towns[5];
    sim.state.tick = at(1, 23, 50);
    arriveNow(sim.ctx, b, 'invited');
    b.visit!.welcomed = true;
    sim.jumpTo(at(2, 1, 0));
    expect(b.visit!.leaving).toBe(true);

    const c = towns[6];
    sim.state.tick = at(2, 14, 0);
    arriveNow(sim.ctx, c, 'invited');
    c.visit!.welcomed = true;
    sim.moodOverride[c.id] = -60;
    sim.advanceTicks(1);
    expect(c.visit!.leaving).toBe(true);
    expect(sim.notifications().join('\n')).toMatch(/huff/);
  });

  it('a leaving visitor that never reaches the exit is despawned after an hour; strays are sent home', () => {
    const { sim, towns } = townSim();
    const v = towns[7];
    arriveNow(sim.ctx, v, 'dropIn');
    v.visit!.leaving = true;
    sim.advanceTicks(1);
    v.queue = [];
    v.active = null;
    sim.advanceMinutes(61);
    expect(v.presence).toBe('offLot');
    const stray = towns[8];
    stray.presence = 'onLot';
    sim.advanceTicks(1);
    expect(stray.queue[0].interactionId).toBe('visit_leave');
    stray.queue = [];
    sim.advanceMinutes(62);
    expect(stray.presence).toBe('offLot');
  });

  it('household autonomy gets an extra welcome candidate after a 10-minute wait', () => {
    const { sim, m, towns } = townSim();
    const sys = sim.systems.find((s) => s.id === 'townies') as SimSystem;
    const v = towns[9];
    arriveNow(sim.ctx, v, 'dropIn');
    expect(sys.autonomyCandidates!(sim.ctx, m)).toEqual([]);
    sim.state.tick += 10 * 4;
    expect(sys.autonomyCandidates!(sim.ctx, m)).toEqual([{ interactionId: 'social_welcome', target: { kind: 'agent', id: v.id } }]);
    expect(sys.autonomyCandidates!(sim.ctx, v)).toEqual([]);
  });
});

describe('invitations', () => {
  it('cold calls to strangers are long shots; friends usually come; too late after 23:00', () => {
    const { sim, m, towns } = townSim(21);
    const t = towns[0];
    sim.state.tick = at(1, 12);
    let cold = 0;
    for (let i = 0; i < 60; i++) {
      expect(inviteTownie(sim.ctx, m.id, towns[1].id)).toBe(true);
      if (pendingArrival(sim.ctx, towns[1].id)) {
        cold++;
        delete sim.state.flags[`people:arrive:${towns[1].id}`];
        delete sim.state.flags[`people:arriveWhy:${towns[1].id}`];
      }
    }
    expect(cold).toBeGreaterThan(5);
    expect(cold).toBeLessThan(40);
    expect(sim.notifications().join('\n')).toMatch(/Who is this|never heard of/);
    expect(inviteTownie(sim.ctx, m.id, 'nobody')).toMatch(/Wormwood/);
    expect(inviteTownie(sim.ctx, m.id, undefined)).toMatch(/Pick someone/);
    Object.assign(sim.ctx.rel(m.id, t.id), { met: true, friendship: 100 });
    sim.state.tick = at(1, 12);
    let accepted = 0;
    for (let i = 0; i < 20; i++) {
      expect(inviteTownie(sim.ctx, m.id, t.id)).toBe(true);
      const p = pendingArrival(sim.ctx, t.id);
      if (p) {
        accepted++;
        expect(p.reason).toBe('invited');
        expect(p.tick - sim.state.tick).toBeGreaterThanOrEqual(20 * 4);
        expect(p.tick - sim.state.tick).toBeLessThanOrEqual(60 * 4);
        expect(inviteTownie(sim.ctx, m.id, t.id)).toMatch(/on the way/);
        delete sim.state.flags[`people:arrive:${t.id}`];
        delete sim.state.flags[`people:arriveWhy:${t.id}`];
      }
    }
    expect(accepted).toBeGreaterThan(14); // 95 % at friendship 100
    sim.state.tick = at(1, 23, 30);
    expect(inviteTownie(sim.ctx, m.id, t.id)).toBe(true);
    expect(pendingArrival(sim.ctx, t.id)).toBeNull();
    t.presence = 'onLot';
    expect(inviteTownie(sim.ctx, m.id, t.id)).toMatch(/already here/);
  });

  it('the TowniesApi list puts acquaintances first and flags availability', () => {
    const { sim, m, towns } = townSim();
    Object.assign(sim.ctx.rel(m.id, towns[10].id), { met: true, friendship: 50 });
    Object.assign(sim.ctx.rel(m.id, towns[11].id), { met: true, friendship: 10 });
    scheduleArrival(sim.ctx, towns[11].id, 30, 'invited');
    const list = townieList(sim.ctx, m.id);
    expect(list).toHaveLength(TOWNIE_COUNT);
    expect(list[0]).toMatchObject({ id: towns[10].id, met: true, label: 'Friend', available: true });
    expect(list[1]).toMatchObject({ id: towns[11].id, available: false });
    expect(list[2].met).toBe(false);
    expect(townieList(sim.ctx, undefined as unknown as string)).toHaveLength(TOWNIE_COUNT);
  });
});

describe('parties', () => {
  function stereo(sim: ReturnType<typeof createFakeSim>, playing: boolean): ObjectState {
    const o = sim.ctx.spawnObject('stereo_boombox', { kind: 'floor', x: 12, z: 13, rot: 0 }, { value: 100 });
    o.data.playing = playing;
    return o;
  }

  it('Throw a Party invites up to 6 (friends first), guests arrive within an hour, score ≥ 70 is Legendary', () => {
    const { sim, m, g, towns } = townSim();
    for (const t of towns.slice(0, 3)) Object.assign(sim.ctx.rel(m.id, t.id), { met: true, friendship: 50 });
    m.needs.fun = 50;
    expect(startParty(sim.ctx, m.id)).toBe(true);
    const p = sim.state.party!;
    expect(p.guestIds).toHaveLength(6);
    expect(p.guestIds.slice(0, 3).sort()).toEqual(towns.slice(0, 3).map((t) => t.id).sort());
    expect(p.endTick - p.startTick).toBe(240 * 4);
    expect(sim.events.some((e) => e.type === 'music' && e.mood === 'party')).toBe(true);
    expect(startParty(sim.ctx, m.id)).toMatch(/already/);
    expect(sim.ctx.statValue('partiesThrown', m.id)).toBe(1);
    stereo(sim, true);
    sim.ctx.spawnObject('item_pizza', { kind: 'loose', x: 13, z: 14, y: 0.76, parentId: null, surfaceIndex: null, facing: 0 }, { data: { servings: 4 } });
    sim.advanceMinutes(61);
    const guests = p.guestIds.map((id) => sim.state.agents[id]);
    expect(guests.every((x) => x.presence === 'onLot' && x.visit?.reason === 'party' && x.visit.welcomed)).toBe(true);
    for (const x of guests) {
      sim.moodOverride[x.id] = 100;
      x.needs.fun = 100;
    }
    sim.advanceMinutes(240 - 61 + 1);
    expect(p.ended).toBe(true);
    expect(p.score).toBeGreaterThanOrEqual(70);
    expect(sim.ctx.hasMoodlet(m, 'legendaryParty')).toBe(true);
    expect(sim.ctx.hasMoodlet(g, 'legendaryParty')).toBe(true);
    expect(sim.ctx.statValue('legendaryParties', m.id)).toBe(1);
    expect(sim.ctx.rel(m.id, guests[5].id).met).toBe(true);
    expect(sim.api('townies').party()).toMatchObject({ active: false });
    sim.advanceMinutes(30);
    expect(guests.every((x) => x.visit === null || x.visit.leaving)).toBe(true);
    endParty(sim.ctx); // idempotent
    expect(sim.ctx.statValue('legendaryParties', m.id)).toBe(1);
  });

  it('a silent, foodless party of miserable guests is Lame; Party Animal hosts score ×1.15', () => {
    const { sim, m } = townSim();
    m.needs.fun = 40;
    expect(startParty(sim.ctx, m.id)).toBe(true);
    stereo(sim, false);
    sim.advanceMinutes(61);
    for (const id of sim.state.party!.guestIds) {
      sim.moodOverride[id] = -100;
      sim.state.agents[id].needs.fun = 0;
    }
    sim.advanceMinutes(180);
    expect(sim.state.party!.ended).toBe(true);
    expect(sim.state.party!.score).toBeLessThanOrEqual(30);
    expect(sim.ctx.hasMoodlet(m, 'lameParty')).toBe(true);
    expect(sim.ctx.statValue('lameParties', m.id)).toBe(1);
  });

  it('honours a player-picked guest list (HUD params.guests), capped at 6 and ignoring junk ids', () => {
    const { sim, m, towns } = townSim();
    m.needs.fun = 80;
    const picked = [towns[3].id, towns[7].id, 'ghost', towns[3].id, towns[9].id].join(',');
    const beh = sim.behavior('phone');
    const run = sim.makeRun(m, 'phone_throwParty', { kind: 'self' }, { guests: picked, guestCount: 3 });
    beh.completeStage!(sim.ctx, m, run, sim.ctx.content.interactions.phone_throwParty, 0);
    expect(sim.state.party!.guestIds).toEqual([towns[3].id, towns[7].id, towns[9].id]);
    sim.state.party = null;
    for (const k of Object.keys(sim.state.flags)) if (k.startsWith('people:arrive')) delete sim.state.flags[k];
    expect(startParty(sim.ctx, m.id, towns.slice(0, 10).map((t) => t.id))).toBe(true);
    expect(sim.state.party!.guestIds).toHaveLength(6);
  });

  it('refuses gloomy hosts, absent hosts and non-members', () => {
    const { sim, m, towns } = townSim();
    m.needs.fun = 10;
    expect(startParty(sim.ctx, m.id)).toMatch(/gloomy/);
    expect(startParty(sim.ctx, towns[0].id)).toMatch(/household/);
    m.needs.fun = 80;
    m.presence = 'atWork';
    expect(startParty(sim.ctx, m.id)).toMatch(/isn’t home/);
    expect(startParty(sim.ctx, 'ghost')).toMatch(/household/);
  });
});

describe('phone behaviour', () => {
  it('validates each action, lists invitees and careers, and orders pizza through the food api', () => {
    const calls: string[] = [];
    const food: SimSystem = { id: 'food', api: { orderPizza: (id: string) => (calls.push(id), true) } };
    const sim = createFakeSim({ household: ['Mortimer'], initSystems: false });
    const withFood = createFakeSim({ household: ['Mortimer'], initSystems: false, systems: [...sim.systems.map((s) => s), food] });
    for (const s of withFood.systems) s.init?.(withFood.ctx, false);
    const m = withFood.state.agents[withFood.state.household.memberIds[0]];
    const beh = withFood.behavior('phone');
    const ix = withFood.ctx.content.interactions;
    expect(beh.available!(withFood.ctx, m, ix.phone_inviteOver, { kind: 'self' })).toBe(true); // cold calls allowed
    const t = Object.values(withFood.state.agents).filter((a) => a.role === 'townie')[5];
    Object.assign(withFood.ctx.rel(m.id, t.id), { met: true, friendship: 30 });
    const kids = beh.choices!(withFood.ctx, m, ix.phone_inviteOver, { kind: 'self' });
    expect(kids).toHaveLength(24);
    expect(kids[0].params).toEqual({ townieId: t.id }); // acquaintances first
    expect(kids[0].label).toMatch(/Acquaintance/);
    expect(kids[1].label).toMatch(/stranger/);
    for (const x of Object.values(withFood.state.agents)) if (x.role === 'townie') x.presence = 'gone';
    expect(beh.available!(withFood.ctx, m, ix.phone_inviteOver, { kind: 'self' })).toMatch(/phone book is empty/);
    for (const x of Object.values(withFood.state.agents)) if (x.role === 'townie') x.presence = 'offLot';
    const jobs = beh.choices!(withFood.ctx, m, ix.phone_findJob, { kind: 'self' });
    expect(jobs).toHaveLength(5);
    expect(beh.choices!(withFood.ctx, m, ix.phone_orderPizza, { kind: 'self' })).toEqual([]);
    expect(beh.label!(withFood.ctx, m, ix.phone_orderPizza, { kind: 'self' })).toBe('Order Brain Pizza ($35)');

    const run = withFood.makeRun(m, 'phone_orderPizza', { kind: 'self' });
    expect(beh.begin!(withFood.ctx, m, run, ix.phone_orderPizza)).toBeNull();
    beh.completeStage!(withFood.ctx, m, run, ix.phone_orderPizza, 0);
    beh.completeStage!(withFood.ctx, m, run, ix.phone_orderPizza, 0);
    expect(calls).toEqual([m.id]);

    const jobRun = withFood.makeRun(m, 'phone_findJob', { kind: 'self' });
    expect(beh.begin!(withFood.ctx, m, jobRun, ix.phone_findJob)).toMatch(/Pick a job/);
    const jobRun2 = withFood.makeRun(m, 'phone_findJob', { kind: 'self' }, { careerId: 'culinary' });
    expect(beh.begin!(withFood.ctx, m, jobRun2, ix.phone_findJob)).toBeNull();
    beh.completeStage!(withFood.ctx, m, jobRun2, ix.phone_findJob, 0);
    expect(m.career?.trackId).toBe('culinary');
    expect(beh.available!(withFood.ctx, m, ix.phone_findJob, { kind: 'self' })).toMatch(/Already employed/);

    // no food system at all → polite refusal, never a throw
    for (const s of sim.systems) s.init?.(sim.ctx, false);
    const m2 = sim.state.agents[sim.state.household.memberIds[0]];
    expect(sim.behavior('phone').available!(sim.ctx, m2, sim.ctx.content.interactions.phone_orderPizza, { kind: 'self' })).toMatch(/Nobody delivers/);
  });

  it('throw-a-party and invite calls run at completion and report failures as notifications', () => {
    const { sim, m, towns } = townSim();
    const beh = sim.behavior('phone');
    const ix = sim.ctx.content.interactions;
    m.needs.fun = 80;
    const run = sim.makeRun(m, 'phone_throwParty', { kind: 'self' });
    beh.completeStage!(sim.ctx, m, run, ix.phone_throwParty, 0);
    expect(sim.state.party).not.toBeNull();
    expect(beh.available!(sim.ctx, m, ix.phone_throwParty, { kind: 'self' })).toMatch(/full swing/);
    Object.assign(sim.ctx.rel(m.id, towns[0].id), { met: true });
    towns[0].presence = 'gone';
    const inv = sim.makeRun(m, 'phone_inviteOver', { kind: 'self' }, { townieId: towns[0].id });
    expect(beh.begin!(sim.ctx, m, inv, ix.phone_inviteOver)).toMatch(/Unavailable/);
    Object.assign(sim.ctx.rel(m.id, towns[1].id), { met: true });
    towns[1].presence = 'onLot';
    const inv2 = sim.makeRun(m, 'phone_inviteOver', { kind: 'self' }, { townieId: towns[1].id });
    expect(beh.begin!(sim.ctx, m, inv2, ix.phone_inviteOver)).toMatch(/Already here/);
    const inv3 = sim.makeRun(m, 'phone_inviteOver', { kind: 'self' }, { townieId: towns[0].id });
    expect(beh.begin!(sim.ctx, m, inv3, ix.phone_inviteOver)).toMatch(/Unavailable/);
  });
});
