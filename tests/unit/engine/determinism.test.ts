import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { fixtureSim, hashState, member, newFixtureWorld, place } from '../../../src/sim/engine/fixtures/world';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';

function furnished(): EngineSimulation {
  const { sim } = fixtureSim(newFixtureWorld({ seed: 2024, lotTemplate: 'starter', members: [member('Mort'), member('Ghoulia'), member('Rotney')] }));
  place(sim, 'tv_crt', 16, 8);
  place(sim, 'chair_creaky', 16, 11, 2);
  place(sim, 'stereo_boombox', 22, 8);
  place(sim, 'shower_drizzle', 3, 14);
  place(sim, 'coffin_pine', 14, 14);
  place(sim, 'coffin_pine', 16, 14);
  place(sim, 'mirror_cracked', 22, 14);
  place(sim, 'station_embalming', 20, 18);
  return sim;
}

/** Scripted commands keyed by tick (resolved against the live state so ids stay valid). */
function script(sim: EngineSimulation, tick: number): Command | null {
  const ids = sim.state.household.memberIds;
  const obj = (defId: string) => Object.values(sim.state.objects).find((o) => o.defId === defId)?.id ?? 'none';
  switch (tick) {
    case 50:
      return { type: 'queue', actorId: ids[0], interactionId: 'fx_watchTv', target: { kind: 'object', id: obj('tv_crt') } };
    case 400:
      return { type: 'queue', actorId: ids[1], interactionId: 'fx_chat', target: { kind: 'agent', id: ids[2] } };
    case 900:
      return { type: 'build', cmd: { type: 'buy', defId: 'table_rickety', x: 20, z: 24, rot: 0 } };
    case 1500:
      return { type: 'queue', actorId: ids[2], interactionId: 'fx_embalmOther', target: { kind: 'agent', id: ids[0] } };
    case 3000:
      return { type: 'setSettings', settings: { autonomy: 'limited' } };
    case 6000:
      return { type: 'setSettings', settings: { autonomy: 'full' } };
    case 7000:
      return { type: 'cheat', code: 'graverobber' };
    case 9000:
      return { type: 'queue', actorId: ids[0], interactionId: 'engine_goHere', target: { kind: 'tile', x: 25, z: 25 } };
    default:
      return null;
  }
}

function run(sim: EngineSimulation, toTick: number): void {
  while (sim.state.tick < toTick) {
    const c = script(sim, sim.state.tick);
    if (c) sim.dispatch(c);
    sim.step();
    sim.drainEvents();
  }
}

describe('determinism', () => {
  it('same seed + same scripted commands -> identical serialize() hash after 3 game days', () => {
    const a = furnished();
    const b = furnished();
    run(a, TICKS_PER_DAY * 3);
    run(b, TICKS_PER_DAY * 3);
    expect(hashState(a.serialize())).toBe(hashState(b.serialize()));
    expect(a.faults()).toEqual([]);
    expect(a.checkInvariants()).toEqual([]);
  }, 240000);

  it('save/load mid-run resumes the exact same timeline', () => {
    const live = furnished();
    run(live, TICKS_PER_DAY);
    const saved = JSON.parse(JSON.stringify(live.serialize())) as WorldState;
    const { sim: loaded } = fixtureSim(saved, { repair: true });
    expect(loaded.repairWarnings).toEqual([]);
    run(live, TICKS_PER_DAY * 2);
    run(loaded, TICKS_PER_DAY * 2);
    expect(hashState(loaded.serialize())).toBe(hashState(live.serialize()));
  }, 240000);
});
