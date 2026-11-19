/**
 * W-013 strays and pets MOVE (src/sim/systems/pets/motion.ts), on a real simulation: strays wander the sidewalk / rear
 * strip and never leave their zone, an adopted pet walks around the household and sleeps at night, care holds the
 * matching animation, and all of it is deterministic and survives a save.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/sim/contracts';
import type { PetsState, WorldState } from '../../../src/sim/types';
import { PET_ANIMS, TICK_MINUTES } from '../../../src/sim/types';
import { allSystems } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine';
import { timeInfo } from '../../../src/sim/time';
import { validateWorld } from '../../../src/persistence/validation';
import { CALM_MIN, PET_ADOPT_TRUST } from '../../../src/sim/systems/pets';
import { jsonClone, newWorld, opts, simOf } from '../quests/helpers';

function world(seed = 91): EngineSimulation {
  const sys = allSystems();
  return simOf(newWorld(opts(seed, 2), sys), sys);
}
const pets = (sim: EngineSimulation): PetsState => sim.state.pets!;
const stepMin = (sim: EngineSimulation, min: number, each?: () => void) => {
  for (let i = 0, n = Math.round(min / TICK_MINUTES); i < n; i++) {
    sim.step();
    each?.();
  }
};
/** The zombie stands next to the animal first (an action only happens when the zombie is close); `far` skips that. */
const cmd = (sim: EngineSimulation, c: Record<string, unknown>, far = false) => {
  const ps = sim.state.pets!;
  const a = [...ps.strays, ...ps.pets].find((x) => x.id === (c.strayId ?? c.petId));
  const ag = sim.state.agents[c.agentId as string];
  if (a && ag && !far) ag.pos = { x: a.pos.x, z: a.pos.z };
  return sim.dispatch({ type: 'pet', ...c } as Command);
};

function adoptFirst(sim: EngineSimulation): string {
  const strayId = pets(sim).strays[0].id;
  const agentId = sim.state.household.memberIds[0];
  const actions = ['offerScraps', 'befriend', 'pet'];
  for (let i = 0; pets(sim).strays.find((s) => s.id === strayId)!.trust < PET_ADOPT_TRUST; i++) {
    expect(i).toBeLessThan(20);
    expect(cmd(sim, { action: actions[i % 3], agentId, strayId }).ok).toBe(true);
    stepMin(sim, CALM_MIN);
  }
  expect(cmd(sim, { action: 'adopt', agentId, strayId }).ok).toBe(true);
  return strayId.replace(/^s/, 'p');
}

describe('strays move', () => {
  it('stay inside their zone over two days, walk sometimes, rest mostly, and always have a real clip name', () => {
    const sim = world();
    const lot = sim.state.lot;
    const anims = new Set<string>();
    const moved = new Set<string>();
    const start = new Map(pets(sim).strays.map((s) => [s.id, { ...s.pos }]));
    stepMin(sim, 2 * 24 * 60, () => {
      for (const s of pets(sim).strays) {
        expect(PET_ANIMS).toContain(s.anim);
        expect(s.pos.x).toBeGreaterThanOrEqual(0);
        expect(s.pos.x).toBeLessThanOrEqual(lot.width);
        expect(s.pos.z).toBeGreaterThanOrEqual(0);
        expect(s.pos.z).toBeLessThanOrEqual(lot.depth);
        if (s.place === 'street') expect(Math.abs(s.pos.z - lot.sidewalkZ)).toBeLessThan(1.6);
        else expect(s.pos.z).toBeLessThan(2);
        anims.add(s.anim);
        const o = start.get(s.id);
        if (o && Math.hypot(o.x - s.pos.x, o.z - s.pos.z) > 1) moved.add(s.id);
      }
    });
    expect(moved.size).toBeGreaterThanOrEqual(1);
    expect(anims.has('walk')).toBe(true);
    expect(anims.has('idle') || anims.has('sit') || anims.has('beg')).toBe(true);
  }, 120_000);

  it('a chased stray runs away along the sidewalk, then settles', () => {
    const sim = world();
    const s = pets(sim).strays[0];
    const agentId = sim.state.household.memberIds[0];
    s.pos = { x: sim.state.lot.width / 2, z: s.pos.z }; // mid-sidewalk, so the whole run fits
    const x0 = s.pos.x;
    expect(cmd(sim, { action: 'chase', agentId, strayId: s.id }).ok).toBe(true);
    expect(s.anim).toBe('flee');
    stepMin(sim, 1);
    expect(Math.abs(s.pos.x - x0)).toBeGreaterThan(1.5);
    stepMin(sim, 5);
    expect(s.anim).not.toBe('flee');
  });
});

describe('pets move', () => {
  it('an adopted pet walks around the household by day, sleeps at night, and eats where it stands when fed', () => {
    const sim = world();
    const petId = adoptFirst(sim);
    const pet = () => pets(sim).pets.find((p) => p.id === petId)!;
    const lot = sim.state.lot;
    const day = new Set<string>();
    const night = new Set<string>();
    const places = new Set<string>();
    stepMin(sim, 24 * 60, () => {
      const p = pet();
      expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z)).toBe(true);
      expect(p.pos.x).toBeGreaterThanOrEqual(0);
      expect(p.pos.x).toBeLessThanOrEqual(lot.width);
      expect(p.pos.z).toBeGreaterThanOrEqual(0);
      expect(p.pos.z).toBeLessThanOrEqual(lot.depth);
      (timeInfo(sim.state.tick).isNight ? night : day).add(p.anim);
      places.add(`${Math.round(p.pos.x)},${Math.round(p.pos.z)}`);
    });
    expect(day.has('walk')).toBe(true);
    expect(night.has('sleep')).toBe(true);
    expect(day.has('sleep')).toBe(false);
    expect(places.size).toBeGreaterThan(3);
    const agentId = sim.state.household.memberIds[1];
    expect(cmd(sim, { action: 'feed', agentId, petId }).ok).toBe(true);
    expect(pet().anim).toBe('eat');
    const at = { ...pet().pos };
    stepMin(sim, 2);
    expect(pet().anim).toBe('eat');
    expect(pet().pos).toEqual(at);
    expect(cmd(sim, { action: 'play', agentId, petId }).ok).toBe(true);
    expect(pet().anim).toBe('play');
    stepMin(sim, 40);
    expect(pet().anim).not.toBe('play');
  }, 180_000);

  it('same seed, same script gives identical positions; the world with moving animals validates and reloads identically', () => {
    const run = () => {
      const sim = world(5);
      adoptFirst(sim);
      stepMin(sim, 6 * 60);
      return sim;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
    const w = jsonClone(a.serialize()) as WorldState;
    const v = validateWorld(jsonClone(w));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.world.pets).toEqual(w.pets);
    const again = simOf(v.world as WorldState, allSystems());
    stepMin(a, 3 * 60);
    stepMin(again, 3 * 60);
    expect(jsonClone(again.serialize())).toEqual(jsonClone(a.serialize()));
  }, 180_000);
});
