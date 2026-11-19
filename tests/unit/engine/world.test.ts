import { describe, expect, it } from 'vitest';
import type { NewGameOptions, SimSystem } from '../../../src/sim/contracts';
import { NEED_IDS, SKILL_IDS } from '../../../src/sim/types';
import { createNewWorldWith } from '../../../src/sim/engine/world';
import { createFixtureLot, FIXTURE_TEMPLATE_INFO } from '../../../src/sim/engine/fixtures/spatial';
import { fixtureDeps, fixtureRegistry, fixtureSim, member } from '../../../src/sim/engine/fixtures/world';
import { fixtureSystems } from '../../../src/sim/engine/fixtures/systems';
import { seedRngState } from '../../../src/sim/rng';

function world(opts: Partial<NewGameOptions>, systems: SimSystem[] = fixtureSystems()) {
  return createNewWorldWith(
    { seed: 42, householdName: 'The Graves', members: [member('Mort')], lotTemplate: 'starter', difficulty: 'normal', ...opts } as NewGameOptions,
    { ...fixtureDeps, registry: fixtureRegistry(), systems, lotTemplate: createFixtureLot, templateInfo: FIXTURE_TEMPLATE_INFO },
  );
}

describe('createNewWorld', () => {
  it('seeds the rng, builds the template lot + objects and the household per GDD', () => {
    const s = world({ members: [member('Mort', ['fx_grumpy', 'fx_cheery', 'fx_glutton', 'fx_deep', 'nope', 'fx_quick']), member('Ghoulia'), member('Rotney')] });
    expect(s.seed).toBe(42);
    expect(s.tick).toBe(0);
    expect(s.rng).not.toEqual(seedRngState(42)); // the rng was used (needs/vitality rolls)
    expect(Object.values(s.objects).map((o) => o.defId).sort()).toEqual(['chair_creaky', 'coffin_pine', 'door_splintered', 'fridge_humming', 'table_rickety']);
    expect(Object.values(s.objects).find((o) => o.defId === 'fridge_humming')?.value).toBe(450);
    expect(s.household.memberIds).toHaveLength(3);
    expect(s.household.funds).toBe(6500 + 500 * 2);
    for (const id of s.household.memberIds) {
      const a = s.agents[id];
      expect(a.role).toBe('household');
      expect(a.presence).toBe('onLot');
      expect(a.vitality).toBeGreaterThanOrEqual(90);
      expect(a.vitality).toBeLessThanOrEqual(100);
      expect(a.needs.preservation).toBe(a.vitality);
      for (const n of NEED_IDS) if (n !== 'preservation') {
        expect(a.needs[n]).toBeGreaterThanOrEqual(70);
        expect(a.needs[n]).toBeLessThanOrEqual(95);
      }
      for (const k of SKILL_IDS) {
        expect(a.skills[k].level).toBe(0);
        expect(a.skills[k].xp).toBeGreaterThanOrEqual(0);
        expect(a.skills[k].xp).toBeLessThanOrEqual(40);
      }
    }
    // conflicting (grumpy/cheery), reward (deep) and unknown traits are dropped; max 3
    expect(s.agents[s.household.memberIds[0]].traits).toEqual(['fx_grumpy', 'fx_glutton', 'fx_quick']);
    expect(s.notifications.at(-1)?.title).toBe('Welcome to Wormwood Heights');
    expect(s.settings).toEqual({ autonomy: 'full', difficulty: 'normal', visitorsEnabled: true });
    // members stand on distinct walkable tiles
    const tiles = s.household.memberIds.map((id) => `${Math.floor(s.agents[id].pos.x)},${Math.floor(s.agents[id].pos.z)}`);
    expect(new Set(tiles).size).toBe(3);
  });

  it('honours NewMemberSpec.voiceSeed (CAZ preview voice carries over)', () => {
    const s = world({ members: [{ ...member('Mort'), voiceSeed: 123456 }, { ...member('Ghoulia'), voiceSeed: Number.NaN }] });
    const [a, b] = s.household.memberIds.map((id) => s.agents[id]);
    expect(a.voiceSeed).toBe(123456);
    expect(Number.isInteger(b.voiceSeed)).toBe(true);
  });

  it('uses template starting funds, the difficulty option and empty lots', () => {
    const s = world({ lotTemplate: 'empty', difficulty: 'grim' });
    expect(s.household.funds).toBe(22000);
    expect(s.settings.difficulty).toBe('grim');
    expect(Object.keys(s.objects)).toHaveLength(0);
  });

  it('calls system init(loaded=false) once at creation and init(loaded=true) when the simulation is created', () => {
    const calls: boolean[] = [];
    const sys: SimSystem = {
      id: 'townies',
      init: (ctx, loaded) => {
        calls.push(loaded);
        if (!loaded) ctx.createAgent({ role: 'townie', presence: 'offLot', firstName: 'Tess', lastName: 'Tomb', appearance: {} as never, traits: [] });
      },
    };
    const s = world({}, [...fixtureSystems(), sys]);
    expect(calls).toEqual([false]);
    expect(Object.values(s.agents).filter((a) => a.role === 'townie')).toHaveLength(1);
    fixtureSim(s, { systems: [...fixtureSystems(), sys] });
    expect(calls).toEqual([false, true]);
  });

  it('is deterministic for a seed and tolerates hostile options', () => {
    expect(JSON.stringify(world({ seed: 7 }))).toBe(JSON.stringify(world({ seed: 7 })));
    expect(JSON.stringify(world({ seed: 7 }))).not.toBe(JSON.stringify(world({ seed: 8 })));
    const empty = world({ members: [], householdName: '\u0000', difficulty: 'impossible' as never, lotTemplate: 'castle' as never, seed: Number.NaN });
    expect(empty.household.memberIds).toHaveLength(1);
    expect(empty.household.name).toBe('The Undead');
    expect(empty.settings.difficulty).toBe('normal');
    const many = world({ members: Array.from({ length: 12 }, (_, i) => member(`Z${i}`)) });
    expect(many.household.memberIds).toHaveLength(8);
    expect(many.household.funds).toBe(6500 + 500 * 7);
    const weird = world({ members: [{ firstName: 42, lastName: null, appearance: { skinTone: 99, hairStyle: 'spikes', height: Number.NaN }, traits: 'all', aspiration: 5 } as never] });
    const a = weird.agents[weird.household.memberIds[0]];
    expect(a.firstName).toBe('Nameless');
    expect(a.appearance.skinTone).toBeLessThan(10);
    expect(a.appearance.hairStyle).toBe('messy');
    expect(a.appearance.height).toBe(0.5);
    expect(a.traits).toEqual([]);
    expect(a.aspiration).toBeNull();
  });

  it('a fresh world passes checkInvariants and runs without faults', () => {
    const { sim } = fixtureSim(world({ members: [member('A'), member('B'), member('C')] }));
    expect(sim.checkInvariants()).toEqual([]);
    for (let i = 0; i < 2000; i++) sim.step();
    expect(sim.checkInvariants()).toEqual([]);
    expect(sim.faults()).toEqual([]);
  });
});
