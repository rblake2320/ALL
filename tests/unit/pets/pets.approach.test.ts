/**
 * W-013: the zombie WALKS to the animal before a menu action happens, like every other interaction. On a real
 * simulation: the command is accepted at once, an `engine_goHere` walk shows in the zombie's queue, the animal waits
 * for it, the action lands only when the zombie is close, a cancelled walk does nothing, and a save in the middle of
 * the walk resumes it identically.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/sim/contracts';
import type { PetsState, WorldState } from '../../../src/sim/types';
import { TICK_MINUTES } from '../../../src/sim/types';
import { allSystems } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine';
import { validateWorld } from '../../../src/persistence/validation';
import { REACH, TRUST_GAIN } from '../../../src/sim/systems/pets';
import { jsonClone, newWorld, opts, simOf } from '../quests/helpers';

function world(seed = 61): EngineSimulation {
  const sys = allSystems();
  return simOf(newWorld(opts(seed, 2), sys), sys);
}
const pets = (sim: EngineSimulation): PetsState => sim.state.pets!;
const stepTicks = (sim: EngineSimulation, n: number, each?: () => void) => {
  for (let i = 0; i < n; i++) {
    sim.step();
    each?.();
  }
};
const cmd = (sim: EngineSimulation, c: Record<string, unknown>) => sim.dispatch({ type: 'pet', ...c } as Command);
const distTo = (sim: EngineSimulation, agentId: string, p: { x: number; z: number }) => {
  const a = sim.state.agents[agentId];
  return Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
};

/** A zombie that is far from the first (street) stray, and that stray. */
function setup(seed = 61) {
  const sim = world(seed);
  const stray = pets(sim).strays.find((s) => s.place === 'street')!;
  const agentId = sim.state.household.memberIds[0];
  // put the stray at the far end of the sidewalk from this zombie
  stray.pos = { x: sim.state.agents[agentId].pos.x < sim.state.lot.width / 2 ? sim.state.lot.width - 1.5 : 1.5, z: stray.pos.z };
  stray.goal = null;
  expect(distTo(sim, agentId, stray.pos)).toBeGreaterThan(6);
  return { sim, stray, agentId };
}

describe('the zombie walks to the animal first', () => {
  it('Befriend from far away: accepted, the zombie is sent walking, the animal waits, and the trust arrives only on arrival', () => {
    const { sim, stray, agentId } = setup();
    const trust = stray.trust;
    const r = cmd(sim, { action: 'befriend', agentId, strayId: stray.id });
    expect(r.ok).toBe(true);
    expect(stray.trust).toBe(trust); // nothing happened yet
    expect(pets(sim).pending).toHaveLength(1);
    const agent = sim.state.agents[agentId];
    const walk = [agent.active, ...agent.queue].find((q) => q?.interactionId === 'engine_goHere');
    expect(walk).toBeDefined();
    const at = { ...stray.pos };
    let gainedAt: number | null = null;
    for (let i = 0; i < 900 && gainedAt === null; i++) {
      sim.step();
      if (stray.trust > trust) gainedAt = distTo(sim, agentId, stray.pos);
      else {
        expect(stray.pos).toEqual(at); // the animal stands still while somebody is coming
        expect(stray.trust).toBe(trust);
      }
    }
    expect(gainedAt).not.toBeNull();
    expect(gainedAt!).toBeLessThanOrEqual(REACH);
    expect(stray.trust).toBe(trust + TRUST_GAIN.befriend);
    expect(pets(sim).pending).toHaveLength(0);
  }, 120_000);

  it('a walk the player cancels does nothing: no trust, no pending, the animal goes back to its day', () => {
    const { sim, stray, agentId } = setup(62);
    expect(cmd(sim, { action: 'befriend', agentId, strayId: stray.id }).ok).toBe(true);
    const agent = sim.state.agents[agentId];
    const walk = [agent.active, ...agent.queue].find((q) => q?.interactionId === 'engine_goHere')!;
    expect(sim.dispatch({ type: 'cancel', actorId: agentId, uid: walk.uid } as Command).ok).toBe(true);
    stepTicks(sim, 400);
    expect(stray.trust).toBe(0);
    expect(pets(sim).pending).toHaveLength(0);
  }, 120_000);

  it('a new order replaces the zombie\'s old errand', () => {
    const { sim, stray, agentId } = setup(63);
    expect(cmd(sim, { action: 'befriend', agentId, strayId: stray.id }).ok).toBe(true);
    expect(cmd(sim, { action: 'pet', agentId, strayId: stray.id }).ok).toBe(true);
    expect(pets(sim).pending.map((p) => p.action)).toEqual(['pet']);
  });

  it('Chase happens on arrival, and only then does the stray bolt', () => {
    const { sim, stray, agentId } = setup(64);
    stray.trust = 50;
    expect(cmd(sim, { action: 'chase', agentId, strayId: stray.id }).ok).toBe(true);
    expect(stray.trust).toBe(50);
    expect(stray.anim).not.toBe('flee');
    let fled = false;
    for (let i = 0; i < 900 && !fled; i++) {
      sim.step();
      fled = stray.anim === 'flee';
    }
    expect(fled).toBe(true);
    expect(stray.trust).toBe(40);
  }, 120_000);

  it('what can never work is refused at once without anybody walking: adopt below trust 70, a stray that is gone', () => {
    const { sim, stray, agentId } = setup(65);
    const r = cmd(sim, { action: 'adopt', agentId, strayId: stray.id });
    expect(r.ok).toBe(false);
    expect(pets(sim).pending).toHaveLength(0);
    const agent = sim.state.agents[agentId];
    expect([agent.active, ...agent.queue].some((q) => q?.interactionId === 'engine_goHere')).toBe(false);
    expect(cmd(sim, { action: 'pet', agentId, strayId: 's999' }).ok).toBe(false);
  });

  it('a zombie standing next to the animal acts at once (no walk)', () => {
    const { sim, stray, agentId } = setup(66);
    sim.state.agents[agentId].pos = { x: stray.pos.x, z: stray.pos.z };
    expect(cmd(sim, { action: 'befriend', agentId, strayId: stray.id }).ok).toBe(true);
    expect(stray.trust).toBe(TRUST_GAIN.befriend);
    expect(pets(sim).pending).toHaveLength(0);
  });

  it('care for a pet also walks first, and the pet waits where it is', () => {
    const { sim, stray, agentId } = setup(67);
    sim.state.agents[agentId].pos = { x: stray.pos.x, z: stray.pos.z };
    stray.trust = 80;
    expect(cmd(sim, { action: 'adopt', agentId, strayId: stray.id }).ok).toBe(true);
    const pet = pets(sim).pets[0];
    const other = sim.state.household.memberIds.find((id) => distTo(sim, id, pet.pos) > 6)!;
    expect(other).toBeDefined();
    const appetite = pet.needs.appetite;
    expect(cmd(sim, { action: 'feed', agentId: other, petId: pet.id }).ok).toBe(true);
    expect(pet.anim).not.toBe('eat');
    let ate = false;
    for (let i = 0; i < 900 && !ate; i++) {
      sim.step();
      ate = pet.anim === 'eat';
    }
    expect(ate).toBe(true);
    expect(pet.needs.appetite).toBeGreaterThan(appetite - 1);
    expect(distTo(sim, other, pet.pos)).toBeLessThanOrEqual(REACH + 0.5);
  }, 120_000);

  it('a save in the middle of the walk resumes it: same world after reload, same trust at the end', () => {
    const { sim, stray, agentId } = setup(68);
    expect(cmd(sim, { action: 'befriend', agentId, strayId: stray.id }).ok).toBe(true);
    stepTicks(sim, 6);
    expect(pets(sim).pending).toHaveLength(1);
    const w = jsonClone(sim.serialize()) as WorldState;
    const v = validateWorld(jsonClone(w));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.world.pets!.pending).toEqual(w.pets!.pending);
    const again = simOf(v.world as WorldState, allSystems());
    stepTicks(sim, 600);
    stepTicks(again, 600);
    expect(jsonClone(again.serialize())).toEqual(jsonClone(sim.serialize()));
    expect(pets(again).strays.find((s) => s.id === stray.id)!.trust).toBe(TRUST_GAIN.befriend);
    expect(TICK_MINUTES).toBeGreaterThan(0);
  }, 180_000);
});
