/**
 * AC-1 on the existing determinism fixtures (src/sim/engine/fixtures: fixture content, fixture spatial service, fixture
 * systems — the world tests/unit/engine/determinism.test.ts uses): the region-aware engine matches the pre-world
 * engine's recorded fingerprints for 3 seeds × 3 game days, and a schema-v2 fixture world's town changes only
 * by streaming (S4: pristine, empty surroundings).
 */
import { describe, expect, it } from 'vitest';
import { fixtureSim, member, newFixtureWorld } from '../../../src/sim/engine/fixtures/world';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { ac1Options, runAc1 } from './ac1Harness';
import { evidence, expectSameRun, expectTownStreamedOnly, goldenRun, legacyAc1Hash } from './homeOnly.shared';

describe('AC-1 on the engine determinism fixtures (3 seeds × 3 days)', () => {
  for (const seed of [2024, 99, 5]) {
    it(`fixture seed ${seed}`, async () => {
      const world = newFixtureWorld({ seed, lotTemplate: 'starter', members: [member('Mort'), member('Ghoulia'), member('Rotney')] });
      if (world.town) world.town.expandPending = true;
      expect(world.town?.homeLotId).toBe('wormwood:mildew_n2');
      const before = canonicalJson(world.town);
      const { sim } = fixtureSim(world);
      const run = await runAc1(`fixture:starter:${seed}`, sim, 3);
      expectSameRun(run, goldenRun(`fixture:starter:${seed}`));
      expectTownStreamedOnly(before, canonicalJson(sim.state.town));
      console.log(`[AC-1] ${evidence(run)}`);
    }, 300_000);
  }

  it('negative control: the comparison is not vacuous — one extra player action changes the day-1 save and event hashes', async () => {
    const state = createNewWorld(ac1Options('starter', 1));
    if (state.town) state.town.expandPending = true;
    const sim = createSimulation(state);
    const control = await runAc1('real:starter:1', createSimulation(JSON.parse(JSON.stringify(state))), 1, { hash: legacyAc1Hash });
    expect(control.days[0]).toEqual(goldenRun('real:starter:1').days[0]);
    let poked = false;
    const proxy = new Proxy(sim, {
      get(t, k, r) {
        if (k === 'step')
          return () => {
            if (!poked && t.state.tick === 100) {
              poked = true;
              t.dispatch({ type: 'cheat', code: 'freshstart' });
            }
            t.step();
          };
        return Reflect.get(t, k, r);
      },
    });
    const run = await runAc1('real:starter:1', proxy, 1, { hash: legacyAc1Hash });
    const g = goldenRun('real:starter:1').days[0];
    expect(poked).toBe(true);
    expect(run.days[0].save).not.toBe(g.save);
    expect(run.days[0].events).not.toBe(g.events);
  }, 120_000);
});
