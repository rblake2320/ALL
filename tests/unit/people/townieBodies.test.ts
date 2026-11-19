/**
 * Townie / service cast bodies: deterministic from (seed, slot), ~60 % cast, each body at most twice, and
 * generated WITHOUT consuming any RNG — every other townie field and the sim RNG are what they were before.
 */
import { describe, expect, it } from 'vitest';
import { CAST_BODY_IDS, isCastBodyId } from '../../../src/shared/cast';
import { SERVICE_BODIES, TOWNIE_CAST_MAX_REPEAT, TOWNIE_CAST_SHARE, townieBodies, withCastBody } from '../../../src/sim/systems/people/townies/castBodies';
import { TOWNIE_COUNT, randomAppearance } from '../../../src/sim/systems/people/townies/generate';
import { createRng, seedRngState } from '../../../src/sim/rng';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import { compareIds } from '../../../src/sim/systems/people/util';
import { defaultAppearance } from '../../../src/shared/appearance';
import type { WorldState } from '../../../src/sim/types';
import { createService } from '../../../src/sim/systems/people/townies/generate';
import { createFakeSim } from './fakeCtx';

const member = { firstName: 'Mort', lastName: 'Ician', appearance: defaultAppearance(), traits: [], aspiration: null };

function world(seed: number): WorldState {
  return createNewWorld({ seed, householdName: 'Ician', members: [member], lotTemplate: 'starter', difficulty: 'normal' });
}
function townies(w: WorldState) {
  return Object.values(w.agents)
    .filter((a) => a.role === 'townie')
    .sort((a, b) => compareIds(a.id, b.id));
}

describe('townieBodies', () => {
  it('is pure and seed-dependent', () => {
    expect(townieBodies(5, 24)).toEqual(townieBodies(5, 24));
    expect(townieBodies(5, 24)).not.toEqual(townieBodies(6, 24));
  });
  it('~60 % cast across seeds, every body at most twice per town, all ids valid', () => {
    let cast = 0;
    const N = 400;
    const everSeen = new Set<string>();
    for (let seed = 0; seed < N; seed++) {
      const list = townieBodies(seed * 2654435761, TOWNIE_COUNT);
      expect(list).toHaveLength(TOWNIE_COUNT);
      const counts = new Map<string, number>();
      for (const b of list) {
        if (b === null) continue;
        expect(isCastBodyId(b)).toBe(true);
        everSeen.add(b);
        counts.set(b, (counts.get(b) ?? 0) + 1);
        cast++;
      }
      for (const c of counts.values()) expect(c).toBeLessThanOrEqual(TOWNIE_CAST_MAX_REPEAT);
    }
    expect(Math.abs(cast / (N * TOWNIE_COUNT) - TOWNIE_CAST_SHARE)).toBeLessThan(0.03);
    expect(everSeen.size).toBe(CAST_BODY_IDS.length);
  });
  it('never exceeds the pool even for huge counts; garbage input is safe', () => {
    const big = townieBodies(1, 500);
    const counts = new Map<string, number>();
    for (const b of big) if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    for (const c of counts.values()) expect(c).toBeLessThanOrEqual(TOWNIE_CAST_MAX_REPEAT);
    for (const [seed, n] of [[NaN, 24], [Infinity, 24], [-5, 24], ['x', 24], [1, -3], [1, NaN], [1, 1e9]] as const) {
      expect(() => townieBodies(seed, n)).not.toThrow();
    }
    expect(townieBodies(1, -3)).toEqual([]);
  });
  it('withCastBody appends last / removes the key for classic', () => {
    const a = withCastBody(defaultAppearance(), 'clown');
    expect(Object.keys(a).at(-1)).toBe('body');
    expect('body' in withCastBody({ ...defaultAppearance(), body: 'clown' }, null)).toBe(false);
  });
});

describe('generateTownies on the real engine', () => {
  it('assigns the hash bodies by slot and draws exactly the same looks as before (no RNG consumed)', () => {
    for (const seed of [1, 42, 0x0a11fe55, 987654321]) {
      const w = world(seed);
      const list = townies(w);
      expect(list).toHaveLength(TOWNIE_COUNT);
      const expected = townieBodies(w.seed, TOWNIE_COUNT);
      expect(list.map((a) => a.appearance.body ?? null)).toEqual(expected);
      // Replay the townie generator's own stream: the looks (minus body) must be draw-for-draw identical to what a
      // generator that knew nothing about bodies would produce for the first townie.
      const rng = createRng(seedRngState((Math.floor(w.seed) ^ 0x70776e1e) >>> 0));
      rng.next();
      rng.next(); // first + last name picks (no retries for the first townie when the household name differs)
      for (let k = 0; k < 6; k++) rng.int(0, 1); // needs
      const app = randomAppearance(rng);
      const first = { ...list[0].appearance };
      delete first.body;
      expect(first).toEqual(app);
    }
  });
  it('two worlds from one seed are identical; townie bodies vary between seeds', () => {
    expect(JSON.stringify(world(9))).toBe(JSON.stringify(world(9)));
    expect(townies(world(9)).map((a) => a.appearance.body ?? null)).not.toEqual(townies(world(10)).map((a) => a.appearance.body ?? null));
  });
  it('loading a world whose townies predate bodies keeps them classic (no regeneration)', () => {
    const w = JSON.parse(JSON.stringify(world(3))) as WorldState;
    for (const a of Object.values(w.agents)) delete a.appearance.body;
    const sim = createSimulation(w);
    for (let i = 0; i < 200; i++) sim.step();
    expect(townies(sim.serialize()).some((a) => a.appearance.body)).toBe(false);
  });
  it('service NPCs get their fixed bodies and consume exactly the RNG they did before', () => {
    expect(SERVICE_BODIES).toEqual({ pizza: 'pizza', repo: 'boss' });
    const sim = createFakeSim({ household: ['Mortimer'], initSystems: false });
    const pizza = sim.state.agents[createService(sim.ctx, 'pizza')];
    const repo = sim.state.agents[createService(sim.ctx, 'repo')];
    expect(pizza.appearance.body).toBe('pizza');
    expect(repo.appearance.body).toBe('boss');
    // Draw count: 2 name ints + randomAppearance per service, nothing for the body.
    const a = createFakeSim({ household: ['Mortimer'], initSystems: false });
    const b = createFakeSim({ household: ['Mortimer'], initSystems: false });
    createService(a.ctx, 'pizza');
    b.ctx.rng.int(0, 1);
    b.ctx.rng.int(0, 1);
    randomAppearance(b.ctx.rng);
    expect(a.ctx.rng.next()).toBe(b.ctx.rng.next());
  });
});
