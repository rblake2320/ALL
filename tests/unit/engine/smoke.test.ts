import { describe, expect, it } from 'vitest';
import { validateContent } from '../../../src/sim/engine/validate';
import { fixtureRegistry, fixtureSim, hours, members, newFixtureWorld, place } from '../../../src/sim/engine/fixtures/world';
import { fixtureSystems } from '../../../src/sim/engine/fixtures/systems';

function furnish(sim: ReturnType<typeof fixtureSim>['sim']) {
  place(sim, 'fridge_humming', 5, 5);
  place(sim, 'coffin_pine', 12, 5);
  place(sim, 'coffin_pine', 14, 5);
  place(sim, 'table_rickety', 8, 10);
  place(sim, 'chair_creaky', 8, 9);
  place(sim, 'chair_creaky', 9, 10, 1);
  place(sim, 'tv_crt', 16, 12);
  place(sim, 'chair_creaky', 16, 15, 2);
  place(sim, 'stereo_boombox', 20, 8);
  place(sim, 'shower_drizzle', 3, 14);
  place(sim, 'mirror_cracked', 22, 14);
}

describe('engine smoke', () => {
  it('fixture content validates clean', () => {
    expect(validateContent(fixtureRegistry(), fixtureSystems())).toEqual([]);
  });

  it('runs a furnished household for a day without faults or invariant violations', () => {
    const { sim } = fixtureSim(newFixtureWorld());
    furnish(sim);
    for (let h = 0; h < 24; h++) {
      hours(sim, 1);
      expect(sim.checkInvariants()).toEqual([]);
    }
    expect(sim.faults()).toEqual([]);
    for (const m of members(sim)) {
      expect(m.needs.hunger).toBeGreaterThan(5);
    }
  });
});
