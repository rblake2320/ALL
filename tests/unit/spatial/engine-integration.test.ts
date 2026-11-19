/**
 * SIM-SPATIAL through the REAL engine (createNewWorld -> createSimulation -> dispatch). Scope: what the build service
 * and spatial module are responsible for — a build op on an object in use must not ADD engine invariant violations,
 * player-facing failure texts must be sentences, money must round-trip exactly through undo/redo, and the starter
 * template must come out of world creation intact. (Pre-existing violations from other modules are tolerated: every
 * check compares after vs before.)
 */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import type { NewGameOptions, SimulationAPI } from '../../../src/sim/contracts';
import type { ObjectState } from '../../../src/sim/types';
import { defaultAppearance } from '../../../src/shared/appearance';

function newSim(seed: number): SimulationAPI {
  const opts: NewGameOptions = {
    seed,
    householdName: 'The Rots',
    members: [{ firstName: 'Mort', lastName: 'Rot', appearance: defaultAppearance(), traits: [], aspiration: null }],
    lotTemplate: 'starter',
    difficulty: 'normal',
  };
  return createSimulation(createNewWorld(opts));
}

function newViolations(before: string[], after: string[]): string[] {
  const seen = new Set(before);
  return after.filter((v) => !seen.has(v));
}

/** Queue a player interaction on the first object with `defId` and step until it reaches the run phase (bounded). */
function startUsing(sim: SimulationAPI, defId: string): { obj: ObjectState; running: boolean } {
  const me = sim.state.household.memberIds[0];
  const obj = Object.values(sim.state.objects).find((o) => o.defId === defId)!;
  const ix = sim.content.objects[defId].interactions[0];
  sim.dispatch({ type: 'queue', actorId: me, interactionId: ix, target: { kind: 'object', id: obj.id } });
  for (let t = 0; t < 3000; t++) {
    sim.step();
    const a = sim.state.agents[me];
    if (a.active && a.active.interactionId === ix && a.active.phase === 'run') return { obj, running: true };
  }
  return { obj, running: false };
}

describe('build service through the real engine', () => {
  it('the starter template survives world creation: every object present, every opening linked, no faults', () => {
    const sim = newSim(3);
    const objs = Object.values(sim.state.objects);
    expect(objs.length).toBeGreaterThanOrEqual(40);
    for (const o of objs) {
      if (o.placement.kind !== 'opening') continue;
      expect(sim.state.lot.walls[o.placement.edge]?.openingId, `opening ${o.id}`).toBe(o.id);
    }
    expect(sim.faults().filter((f) => f.where.startsWith('spatial') || f.where.startsWith('newWorld'))).toEqual([]);
  });

  it('moving an object while a zombie uses it adds no invariant violations; selling it explains why in words', () => {
    const sim = newSim(7);
    const { obj, running } = startUsing(sim, 'shower_drizzle');
    expect(running).toBe(true);
    const before = sim.checkInvariants();
    const p = obj.placement;
    if (p.kind !== 'floor') throw new Error('shower is a floor object');
    let moved = false;
    for (let dz = 4; dz <= 9 && !moved; dz++) {
      for (let dx = -8; dx <= 0 && !moved; dx++) {
        moved = sim.dispatch({ type: 'build', cmd: { type: 'move', objectId: obj.id, x: p.x + dx, z: p.z + dz, rot: p.rot } }).ok;
      }
    }
    expect(moved).toBe(true);
    expect(newViolations(before, sim.checkInvariants())).toEqual([]);

    const n0 = sim.state.notifications.length;
    const sold = sim.dispatch({ type: 'build', cmd: { type: 'sell', objectId: obj.id } });
    expect(sold.ok).toBe(true);
    expect(newViolations(before, sim.checkInvariants())).toEqual([]);
    for (const n of sim.state.notifications.slice(n0)) {
      expect(n.text, n.title).not.toBe('build');
      expect(n.text, n.title).toMatch(/ /); // a sentence, not an internal code
    }
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.objects[obj.id]).toBeDefined();
    expect(newViolations(before, sim.checkInvariants())).toEqual([]);
    for (let i = 0; i < 40; i++) sim.step();
    expect(sim.faults().filter((f) => f.where.startsWith('spatial'))).toEqual([]);
  });

  it('buy -> undo -> redo through dispatch moves money exactly and restores the same object id', () => {
    const sim = newSim(11);
    const funds0 = sim.state.household.funds;
    const r = sim.dispatch({ type: 'build', cmd: { type: 'buy', defId: 'chair_creaky', x: 24, z: 20, rot: 0 } });
    expect(r.ok).toBe(true);
    const price = sim.content.objects.chair_creaky.price;
    expect(sim.state.household.funds).toBe(funds0 - price);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.household.funds).toBe(funds0);
    expect(sim.state.objects[r.id!]).toBeUndefined();
    expect(sim.dispatch({ type: 'redo' }).ok).toBe(true);
    expect(sim.state.household.funds).toBe(funds0 - price);
    expect(sim.state.objects[r.id!]?.defId).toBe('chair_creaky');
    expect(sim.build.preview({ type: 'sell', objectId: r.id! }).cost).toBe(-Math.floor(price * (1 - sim.content.objects.chair_creaky.depreciation)));
  });
});
