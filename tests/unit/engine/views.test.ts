import { describe, expect, it } from 'vitest';
import type { SimSystem } from '../../../src/sim/contracts';
import { putAt, queue, setup, until } from './helpers';

describe('views', () => {
  it('household / summary / onLotSummaries describe agents', () => {
    const { sim, agents } = setup({ members: ['Mort', 'Ghoulia'] });
    const h = sim.household();
    expect(h.map((s) => s.firstName)).toEqual(['Mort', 'Ghoulia']);
    expect(h[0]).toMatchObject({ name: 'Mort Graves', role: 'household', presence: 'onLot', isVisitor: false, activity: null });
    expect(sim.summary('a404')).toBeNull();
    expect(sim.onLotSummaries()).toHaveLength(2);
    agents[1].needs.hunger = 3;
    expect(sim.summary(agents[1].id)?.criticalNeed).toBe('hunger');
    sim.engine.ctx.despawnAgent(agents[1].id, 'atWork');
    expect(sim.summary(agents[1].id)).toMatchObject({ presence: 'atWork', activity: 'At work', activityIcon: 'work' });
    expect(sim.onLotSummaries()).toHaveLength(1);
  });

  it('needs(): labels, caps and trend (negative while idle, positive while restoring)', () => {
    const { sim, agents, objects } = setup({ objects: [{ defId: 'shower_drizzle', x: 8, z: 8 }], needs: { hygiene: 20 } });
    const a = agents[0];
    a.vitality = 80;
    const n0 = Object.fromEntries(sim.needs(a.id).map((n) => [n.id, n]));
    expect(n0.hunger).toMatchObject({ label: 'Appetite', cap: 100, critical: false });
    expect(n0.preservation.cap).toBe(80);
    expect(n0.hunger.trend).toBeCloseTo(-5.5);
    expect(n0.preservation.trend).toBeLessThan(0);
    putAt(a, 8, 10);
    queue(sim, a, 'fx_shower', { kind: 'object', id: objects[0].id });
    until(sim, () => a.active?.phase === 'run');
    sim.step();
    const n1 = Object.fromEntries(sim.needs(a.id).map((n) => [n.id, n]));
    expect(n1.hygiene.trend).toBeCloseTo(300 - 3.5);
    expect(sim.needs('ghost')).toEqual([]);
  });

  it('needs() trend uses the decay system preservation rate when exposed', () => {
    const decay: SimSystem = { id: 'decay', api: { preservationPerHour: () => -2.25 } };
    const { sim, agents } = setup({ extraSystems: [decay] });
    expect(sim.needs(agents[0].id).find((n) => n.id === 'preservation')?.trend).toBe(-2.25);
  });

  it('mood(): value, band and contributors from needs, moodlets, traits and system modifiers', () => {
    const env: SimSystem = { id: 'room', moodModifiers: () => [{ label: 'Lovely Room', value: 8 }] };
    const { sim, agents } = setup({ extraSystems: [env], needs: { hunger: 100, energy: 100, social: 100, fun: 100, hygiene: 100, preservation: 100 } });
    const a = agents[0];
    a.traits = ['fx_cheery'];
    a.vitality = 100;
    a.needs.preservation = 100;
    const m = sim.mood(a.id);
    expect(m.value).toBeCloseTo(68 + 6 + 8);
    expect(m.band).toBe('great');
    expect(m.label).toBe('Undead and Loving It');
    expect(m.contributors.map((c) => c.label)).toEqual(expect.arrayContaining(['Lovely Room', 'Cheery', 'Appetite']));
    for (const n of ['hunger', 'energy', 'social', 'fun', 'hygiene', 'preservation'] as const) a.needs[n] = 0;
    sim.engine.moodModCache.clear();
    const low = sim.mood(a.id);
    expect(low.value).toBeCloseTo(-108.8 + 6 + 8); // needs at 0 contribute -1.6 x W each
    expect(low.band).toBe('miserable');
    expect(sim.mood('nobody')).toMatchObject({ value: 0, band: 'fine' });
  });

  it('moodlets()/skills() expose remaining time and progress', () => {
    const { sim, agents } = setup();
    const a = agents[0];
    sim.engine.ctx.addMoodlet(a, 'fx_happy');
    sim.engine.ctx.addMoodlet(a, 'fx_sad');
    const ms = sim.moodlets(a.id);
    expect(ms.find((m) => m.id === 'fx_happy')).toMatchObject({ remaining: 60, mood: 10, kind: 'good' });
    expect(ms.find((m) => m.id === 'fx_sad')?.remaining).toBeNull();
    a.skills.cooking = { level: 2, xp: 110 };
    a.skills.logic = { level: 10, xp: 0 };
    const sk = Object.fromEntries(sim.skills(a.id).map((s) => [s.id, s]));
    expect(sk.cooking).toMatchObject({ level: 2, name: 'Cooking' });
    expect(sk.cooking.progress).toBeCloseTo(0.5);
    expect(sk.logic.progress).toBe(1);
  });

  it('delegates career/relationships/aspiration/bills/townies/careers/party/lotValue/objectDetail to systems', () => {
    const systems: SimSystem[] = [
      { id: 'careers', api: { view: () => ({ trackId: 't', trackName: 'Night Shift', level: 1, title: 'Stocker', wage: 14, schedule: 'x', performance: 0, nextTitle: null, promoteReq: [], status: 'none', icon: 'work' }), available: () => [{ id: 't', name: 'Night Shift', description: '', startTitle: 'Stocker', wage: 14, schedule: '', icon: 'work' }] } },
      { id: 'social', api: { relationships: () => [{ otherId: 'a9', name: 'X', friendship: 1, romance: 0, label: 'Acquaintance', inHousehold: false, onLot: false }] } },
      { id: 'aspirations', api: { view: () => ({ id: 'tycoon', name: 'Tycoon', icon: 'money', points: 5, milestones: [], rewards: [] }) } },
      { id: 'economy', api: { bills: () => ({ outstanding: 99, overdue: 0, nextDueLabel: null, utilitiesOn: true, bills: [] }), lotValue: () => 4321 } },
      { id: 'townies', api: { list: () => [], party: () => ({ active: true, score: 50, endsLabel: 'Today 9:00 PM', guests: 3 }) } },
      { id: 'food', api: { objectDetail: () => 'Servings: 3' } },
    ];
    const { sim, agents, objects } = setup({ extraSystems: systems, objects: [{ defId: 'fridge_humming', x: 5, z: 5 }] });
    const id = agents[0].id;
    expect(sim.career(id)?.title).toBe('Stocker');
    expect(sim.relationships(id)[0].name).toBe('X');
    expect(sim.aspiration(id)?.name).toBe('Tycoon');
    expect(sim.bills().outstanding).toBe(99);
    expect(sim.townies(id)).toEqual([]);
    expect(sim.careersAvailable()[0].name).toBe('Night Shift');
    expect(sim.party()?.guests).toBe(3);
    expect(sim.lotValue()).toBe(4321);
    expect(sim.objectView(objects[0].id)?.detail).toBe('Servings: 3');
  });

  it('falls back to engine-built views when systems are missing or throw', () => {
    const broken: SimSystem = { id: 'economy', api: { bills: () => { throw new Error('ledger on fire'); }, lotValue: () => Number.NaN } };
    const { sim, agents, objects } = setup({ extraSystems: [broken], objects: [{ defId: 'fridge_humming', x: 5, z: 5 }] });
    const [a] = agents;
    const b = sim.bills();
    expect(b).toMatchObject({ outstanding: 0, overdue: 0, utilitiesOn: true });
    expect(sim.faults().some((f) => f.where === 'api:economy.bills')).toBe(true);
    expect(sim.lotValue()).toBeGreaterThan(0);
    expect(sim.career(a.id)).toBeNull();
    expect(sim.aspiration(a.id)).toBeNull();
    expect(sim.party()).toBeNull();
    const t = sim.engine.ctx.createAgent({ role: 'townie', presence: 'offLot', firstName: 'Tara', lastName: 'Tula', appearance: {} as never, traits: [], occupation: 'Gravedigger' });
    sim.engine.ctx.rel(a.id, t.id).met = true;
    sim.engine.ctx.rel(a.id, t.id).friendship = 40;
    expect(sim.townies(a.id)).toEqual([expect.objectContaining({ id: t.id, label: 'Friend', available: true, occupation: 'Gravedigger' })]);
    expect(sim.relationships(a.id)).toEqual([expect.objectContaining({ otherId: t.id, label: 'Friend', inHousehold: false })]);
    const ov = sim.objectView(objects[0].id)!;
    expect(ov).toMatchObject({ name: 'Humming Fridge', value: 100, sellValue: 85, broken: false, powered: true, inUse: false, detail: null });
    expect(sim.objectView('o404')).toBeNull();
  });

  it('serialize() is a deep JSON copy', () => {
    const { sim, agents } = setup();
    const s = sim.serialize();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    s.agents[agents[0].id].needs.hunger = -999;
    s.household.funds = -1;
    expect(sim.state.agents[agents[0].id].needs.hunger).not.toBe(-999);
    expect(sim.state.household.funds).toBeGreaterThanOrEqual(0);
  });
});
