/**
 * Integration: the real engine + spatial + HOME + PEOPLE via createNewWorld/createSimulation, driven for several
 * game days. Proves people systems run fault-free inside the engine, careers pay through the real queue, visitors
 * get welcomed by real autonomy and go home, parties run end to end, and everything is deterministic and
 * save/load-stable.
 */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation, validateContent } from '../../../src/sim/index';
import type { SimContext, SimEvent, SimulationAPI } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../../src/sim/types';
import { tickAt } from '../../../src/sim/time';
import { defaultAppearance } from '../../../src/shared/appearance';

const PEOPLE_WHERE = /social|careers|townies|aspirations|events|behavior:(social|phone|career|visit)|effect:(careerChoice|addVitality|event_)|condition:(careerLevel|friends|relationshipFlag|romanceMax|skillsAtLevel|freshStreak|clockBetween|lotHasTag|noOutdoorLight|reekingOutdoors|householdHome|eventCooldown)|requirement:(hasCareer|noCareer|sickDayAvailable|noPartyActive)/;

function newGame(seed = 4242, members = 2): SimulationAPI {
  const roster = [
    { firstName: 'Mortimer', lastName: 'Gravesby', traits: ['cheerful', 'socialButterfly', 'gourmand'], aspiration: 'afterparty' },
    { firstName: 'Ghoulia', lastName: 'Gravesby', traits: ['ambitious', 'bookworm', 'vain'], aspiration: 'tycoon' },
    { firstName: 'Rotney', lastName: 'Gravesby', traits: ['loner', 'nightOwl', 'clumsy'], aspiration: 'masterPreserver' },
  ].slice(0, members);
  const state = createNewWorld({
    seed,
    householdName: 'Gravesby',
    members: roster.map((r) => ({ ...r, appearance: defaultAppearance() })),
    lotTemplate: 'starter',
    difficulty: 'normal',
  });
  return createSimulation(state);
}

function ctxOf(sim: SimulationAPI): SimContext {
  return (sim as unknown as { engine: { ctx: SimContext } }).engine.ctx;
}

function run(sim: SimulationAPI, ticks: number, onEvents?: (e: SimEvent[]) => void): void {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    const ev = sim.drainEvents();
    if (onEvents) onEvents(ev);
  }
}

function runUntil(sim: SimulationAPI, pred: () => boolean, maxTicks: number): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return true;
    sim.step();
    sim.drainEvents();
  }
  return pred();
}

function peopleFaults(sim: SimulationAPI): string[] {
  return sim.faults().filter((f) => PEOPLE_WHERE.test(f.where)).map((f) => `${f.where}: ${f.message}`);
}

function members(sim: SimulationAPI) {
  return sim.state.household.memberIds.map((id) => sim.state.agents[id]);
}

describe('people inside the real engine', () => {
  it('validates cleanly with every shipped module', () => {
    expect(validateContent()).toEqual([]);
  });

  it('three game days: no people faults, invariants hold, townies live their lives', () => {
    const sim = newGame(4242, 3);
    const [a, b] = members(sim);
    expect(Object.values(sim.state.agents).filter((x) => x.role === 'townie')).toHaveLength(24);
    expect(sim.relationships(a.id).find((r) => r.otherId === b.id)?.label).toBe('Acquaintance');
    let townieSpawns = 0;
    run(sim, 3 * TICKS_PER_DAY, (ev) => {
      for (const e of ev) if (e.type === 'agentSpawned' && sim.state.agents[e.agentId]?.role === 'townie') townieSpawns++;
    });
    expect(peopleFaults(sim)).toEqual([]);
    expect(sim.checkInvariants()).toEqual([]);
    expect(townieSpawns).toBeGreaterThan(0);
    // nobody is stuck on the lot in a broken visitor state
    for (const t of Object.values(sim.state.agents)) {
      if (t.role !== 'townie' || t.presence !== 'onLot') continue;
      expect(!!t.visit || !!t.walkBy, `${t.id} on lot without visit/walkBy`).toBe(true);
    }
    const socials = members(sim).reduce((n, m) => n + (sim.state.stats.agent[m.id]?.socials ?? 0), 0);
    expect(socials).toBeGreaterThan(0);
    expect(sim.townies(a.id)).toHaveLength(24);
  }, 240_000);

  it('phone → Get a Job → carpool → a paid shift through the real interaction queue', () => {
    const sim = newGame(99, 1);
    const [z] = members(sim);
    const r = sim.dispatch({ type: 'queue', actorId: z.id, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: 'necrotech' } });
    expect(r.ok).toBe(true);
    expect(runUntil(sim, () => !!z.career, 60 * 4)).toBe(true);
    expect(sim.career(z.id)).toMatchObject({ trackName: 'Necro-Tech', title: 'Tech Support Ghoul', wage: 20 });
    // Tuesday: the carpool comes at 08:30, the zombie walks off-lot
    expect(runUntil(sim, () => z.presence === 'atWork', tickAt(2, 9 * 60 + 30) - sim.state.tick)).toBe(true);
    expect(sim.state.tick).toBeGreaterThanOrEqual(tickAt(2, 8 * 60 + 30));
    expect(sim.career(z.id)!.status).toMatch(/At work until 5:00 PM/);
    expect(runUntil(sim, () => z.presence === 'onLot', tickAt(2, 17 * 60 + 5) - sim.state.tick)).toBe(true);
    const ctx = ctxOf(sim);
    expect(ctx.statValue('shiftsWorked', z.id)).toBe(1);
    expect(ctx.statValue('wagesEarned', z.id)).toBe(20 * 8);
    expect(z.career!.shiftStatus).toBe('done');
    expect(peopleFaults(sim)).toEqual([]);
  }, 240_000);

  it('a drop-in rings the bell, gets welcomed by household autonomy, and later goes home', () => {
    const sim = newGame(7, 2);
    run(sim, 2 * TICKS_PER_HOUR); // 11:00
    const guest = Object.values(sim.state.agents).find((x) => x.role === 'townie' && x.presence === 'offLot')!;
    sim.state.flags[`people:arrive:${guest.id}`] = sim.state.tick + 4;
    sim.state.flags[`people:arriveWhy:${guest.id}`] = 'dropIn';
    expect(runUntil(sim, () => guest.presence === 'onLot', 30 * 4)).toBe(true);
    expect(guest.visit).toMatchObject({ reason: 'dropIn', welcomed: false });
    expect(runUntil(sim, () => !!guest.visit?.welcomed, 60 * 4)).toBe(true);
    expect(runUntil(sim, () => guest.presence === 'offLot', 6 * TICKS_PER_HOUR)).toBe(true);
    expect(guest.visit).toBeNull();
    expect(members(sim).some((m) => sim.state.relationships[[m.id, guest.id].sort().join('|')]?.met)).toBe(true);
    expect(peopleFaults(sim)).toEqual([]);
  }, 240_000);

  it('Throw a Party: guests arrive, the party ends after 4 h, the host gets credit', () => {
    const sim = newGame(11, 2);
    const [host] = members(sim);
    host.needs.fun = 90;
    const r = sim.dispatch({ type: 'queue', actorId: host.id, interactionId: 'phone_throwParty', target: { kind: 'self' } });
    expect(r.ok).toBe(true);
    expect(runUntil(sim, () => !!sim.state.party, 30 * 4)).toBe(true);
    const party = sim.state.party!;
    expect(party.guestIds.length).toBeGreaterThan(0);
    expect(sim.party()).toMatchObject({ active: true });
    run(sim, 70 * 4);
    expect(party.guestIds.some((id) => sim.state.agents[id].presence === 'onLot')).toBe(true);
    expect(runUntil(sim, () => party.ended, 5 * TICKS_PER_HOUR)).toBe(true);
    expect(ctxOf(sim).statValue('partiesThrown', host.id)).toBe(1);
    expect(sim.party()).toMatchObject({ active: false });
    expect(runUntil(sim, () => party.guestIds.every((id) => sim.state.agents[id].presence !== 'onLot'), 3 * TICKS_PER_HOUR)).toBe(true);
    expect(peopleFaults(sim)).toEqual([]);
  }, 240_000);
});

describe('determinism + save/load', () => {
  /** Engine-owned cache keys (lot.version is bumped by load-time repair; paths re-plan off it). */
  const snapshot = (s: WorldState) =>
    JSON.stringify(s, (k, v) => (k === 'version' || k === 'wallVersion' || k === 'floorVersion' || k === '_v' ? undefined : v));

  it('same seed + same commands → identical worlds after a day', () => {
    const a = newGame(1234, 2);
    const b = newGame(1234, 2);
    for (const sim of [a, b]) sim.dispatch({ type: 'queue', actorId: members(sim)[0].id, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: 'politics' } });
    run(a, TICKS_PER_DAY);
    run(b, TICKS_PER_DAY);
    expect(snapshot(a.serialize())).toBe(snapshot(b.serialize()));
    const c = newGame(4321, 2);
    run(c, TICKS_PER_HOUR);
    expect(Object.values(c.state.agents).filter((x) => x.role === 'townie').map((x) => x.firstName)).not.toEqual(
      Object.values(a.state.agents).filter((x) => x.role === 'townie').map((x) => x.firstName),
    );
  }, 240_000);

  it('a save taken mid-day loads and continues exactly like the original', () => {
    const a = newGame(555, 2);
    run(a, 14 * TICKS_PER_HOUR); // 23:00
    const b = createSimulation(JSON.parse(JSON.stringify(a.serialize())) as WorldState);
    expect(snapshot(b.serialize())).toBe(snapshot(a.serialize()));
    run(a, 4 * TICKS_PER_HOUR);
    run(b, 4 * TICKS_PER_HOUR);
    expect(snapshot(b.serialize())).toBe(snapshot(a.serialize()));
    expect(peopleFaults(b)).toEqual([]);
  }, 240_000);
});
