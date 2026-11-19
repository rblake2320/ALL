/**
 * Wild animals and strays never come into a home; only an adopted pet lives inside (owner direction 2026-11-12).
 *  1. Wildlife (pure, render-side): with a building's room tiles known, no critter of any species is ever below roof
 *     height over a room tile, across seeds, day and night, every minute of a slot. Without the test the old paths
 *     do cross the house (control), so the check is not vacuous.
 *  2. Strays (real simulation, every lot template): over three game days, sampled every game hour, no stray stands
 *     on an indoor tile; a forced goal inside the house is refused at the wall.
 */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { ambientWildlife, INDOOR_CLEAR_Y } from '../../../src/sim/systems/wildlife';
import { TICK_MINUTES } from '../../../src/sim/types';
import { opts } from '../quests/helpers';

const HOUR = Math.round(60 / TICK_MINUTES);

describe('wildlife stays out of buildings', () => {
  const W = 30;
  const D = 30;
  // a house over the middle of the lot (tiles 8..21 x 6..19)
  const indoor = (x: number, z: number) => x >= 8 && x < 22 && z >= 6 && z < 20;
  const inside = (c: { pos: { x: number; y: number; z: number } }) => c.pos.y < INDOOR_CLEAR_Y && indoor(c.pos.x, c.pos.z);

  it('no critter is ever inside the house, across seeds, day and night', () => {
    let seen = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (let tick = 0; tick < 2 * 24 * HOUR; tick += 7) {
        for (const c of ambientWildlife(seed, 'home', tick, { width: W, depth: D, indoor })) {
          seen++;
          expect(inside(c), `${c.id} at ${JSON.stringify(c.pos)} tick ${tick}`).toBe(false);
        }
      }
    }
    expect(seen).toBeGreaterThan(1000); // critters still appear: the rule re-routes them, it does not empty the lot
  });

  it('control: without the indoor test the same critters do cross the house', () => {
    let crossings = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (let tick = 0; tick < 2 * 24 * HOUR; tick += 7) {
        for (const c of ambientWildlife(seed, 'home', tick, { width: W, depth: D })) if (inside(c)) crossings++;
      }
    }
    expect(crossings).toBeGreaterThan(0);
  });

  it('a throwing indoor test counts as inside (never draw a critter where it might be in a home)', () => {
    const boom = () => {
      throw new Error('no spatial');
    };
    expect(ambientWildlife(3, 'home', 600, { width: W, depth: D, indoor: boom })).toEqual([]);
  });
});

describe('strays stay out of buildings (real simulation)', () => {
  function sim(template: 'starter' | 'derelict' | 'empty', seed: number): EngineSimulation {
    const o = { ...opts(seed, 2), lotTemplate: template };
    return createSimulation(createNewWorld(o as never)) as EngineSimulation;
  }
  const strayIndoors = (s: EngineSimulation) =>
    (s.state.pets?.strays ?? []).filter((a) => {
      const x = Math.floor(a.pos.x);
      const z = Math.floor(a.pos.z);
      return s.spatial.inBounds(x, z) && s.spatial.isIndoor(x, z);
    });

  for (const template of ['starter', 'derelict', 'empty'] as const) {
    it(`${template}: three game days, no stray ever indoors`, () => {
      for (const seed of [11, 47]) {
        const s = sim(template, seed);
        for (let h = 0; h < 72; h++) {
          for (let t = 0; t < HOUR; t++) s.step();
          expect(strayIndoors(s).map((a) => `${a.id}@${a.pos.x},${a.pos.z}`), `${template} seed ${seed} hour ${h}`).toEqual([]);
        }
      }
    }, 240_000);
  }

  it('a stray fleeing straight at the house stops at the wall', () => {
    const s = sim('starter', 5);
    const stray = s.state.pets?.strays?.[0];
    expect(stray).toBeDefined();
    // the first indoor tile of the lot
    let target: { x: number; z: number } | null = null;
    for (let z = 0; z < s.state.lot.depth && !target; z++) for (let x = 0; x < s.state.lot.width && !target; x++) if (s.spatial.isIndoor(x, z)) target = { x: x + 0.5, z: z + 0.5 };
    expect(target).not.toBeNull();
    // a chased stray keeps its flee goal (the wander does not replace it): aim the flight straight at the house
    stray!.goal = target;
    stray!.anim = 'flee';
    stray!.busyUntil = s.state.tick + 4 * HOUR;
    for (let t = 0; t < 4 * HOUR; t++) {
      s.step();
      expect(strayIndoors(s), `tick ${t}`).toEqual([]);
    }
  });
});
