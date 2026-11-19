/**
 * AC-4 — W-025 S3, docs/DESIGN_WORLD_LEVELS.md §1.15: saving on the tick before, on and after a portal crossing,
 * then loading (the REAL SaveManager: canonical JSON, schema v2 validation, engine repair) and continuing, gives the
 * same final state as the uninterrupted run, byte for byte; so does a journal-style replay (the snapshot + the
 * commands recorded after it, re-dispatched at their ticks) after a "kill" in the middle of the walk.
 *
 * Every crossing of the scripted session is covered (12 crossings × 3 save ticks). A save can never catch an agent
 * standing off its region's grid: the crossing happens inside the movement phase of the very tick the position leaves
 * the grid (asserted below for every tick of the session).
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import type { WorldState } from '../../../src/sim/types';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { noLocks } from '../../../src/persistence/locks';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { N3, laneWorld, stateHash, tileOfAgent } from './s3Harness';
import { SCRIPT_TICKS, emptyRun, runScript, type Driver } from './s3Script';
import { activeRegions, agentRegion, spatialOfRegion } from '../../../src/sim/engine/regions';

const silent = { warn: () => undefined, error: () => undefined };
const META = { householdName: 'x', memberNames: [], day: 1, timeLabel: '', funds: 0, lotValue: 0, thumbnail: null };

async function saveAndLoad(world: WorldState): Promise<{ sim: EngineSimulation; warnings: string[]; repair: string[] }> {
  const backend = createMemoryBackend();
  const mgr = new SaveManagerImpl({ backend, compress: false, logger: silent, locks: noLocks, repair: engineRepairHook() });
  const w = await mgr.save('slot-s3', 'S3', world, META);
  if (!w.ok) throw new Error(w.error);
  const l = await mgr.load('slot-s3');
  if (!l.ok) throw new Error(l.error);
  const sim = createSimulation(l.world) as unknown as EngineSimulation;
  return { sim, warnings: l.warnings, repair: sim.repairWarnings };
}

describe('AC-4 save / load mid-walk across a region boundary (S3)', () => {
  const ref = (() => {
    const { sim, members } = laneWorld({ seed: 7 });
    const run = runScript(sim, members, SCRIPT_TICKS, { a: 0, b: 0 }, emptyRun());
    return { members, run, final: stateHash(sim.state) };
  })();

  it('the reference session crosses 12 times; no agent ever stands off its region grid at the end of a tick', () => {
    expect(ref.run.crossings.length).toBe(12);
    const { sim, eng, members } = laneWorld({ seed: 7 });
    const d: Driver = { a: 0, b: 0 };
    const run = emptyRun();
    for (let t = 0; t < 700; t++) {
      runScript(sim, members, sim.state.tick + 1, d, run, { every: 1e9 });
      for (const id of members) {
        const a = sim.state.agents[id];
        const sp = spatialOfRegion(eng, agentRegion(eng, a))!;
        const tt = sp.tileOf(a.pos);
        expect(sp.inBounds(tt.x, tt.z)).toBe(true);
      }
    }
  });

  const ticks = [...new Set(ref.run.crossings.flatMap((c) => [c.tick - 1, c.tick, c.tick + 1]))].sort((a, b) => a - b);

  // Each save point keeps the standard timeout; one aggregate test approached 60s on the shared runner.
  it.each(ticks)('saving at boundary tick %i and continuing matches the uninterrupted run', async (at) => {
    const { sim, members } = laneWorld({ seed: 7 });
    const d: Driver = { a: 0, b: 0 };
    runScript(sim, members, at, d, emptyRun());
    const before = stateHash(sim.state);
    const loaded = await saveAndLoad(sim.serialize());
    expect(loaded.warnings).toEqual([]);
    expect(loaded.repair).toEqual([]);
    expect(stateHash(loaded.sim.state)).toBe(before); // the load itself changed nothing
    expect(activeRegions(loaded.sim.engine)).toEqual(activeRegions(sim.engine)); // live regions came back
    runScript(loaded.sim, members, SCRIPT_TICKS, { ...d }, emptyRun());
    expect({ at, hash: stateHash(loaded.sim.state) }).toEqual({ at, hash: ref.final });
    expect(loaded.sim.faults()).toEqual([]);
  });

  it('a kill in the middle of the walk: the last snapshot + the journal of later commands replays to the same state', async () => {
    // member A crossing out of the neighbour's yard into the street
    const crossing = ref.run.crossings.find((c) => c.agentId === ref.members[0] && c.from === N3)!;
    expect(crossing.to).toBe('street:mildew:3');
    const snapAt = crossing.tick - 30;
    const killAt = crossing.tick + 40;
    const { sim, members, eng } = laneWorld({ seed: 7 });
    const d: Driver = { a: 0, b: 0 };
    runScript(sim, members, snapAt, d, emptyRun());
    const snapshot = sim.serialize();
    const after = runScript(sim, members, killAt, d, emptyRun());
    const live = stateHash(sim.state);
    expect(after.crossings.some((c) => c.tick === crossing.tick)).toBe(true);
    expect(tileOfAgent(eng, sim.state.agents[members[0]]).regionId).toBe(crossing.to);
    // the page is killed here; recovery = snapshot + replay of every command recorded after it
    const rec = await saveAndLoad(snapshot);
    runScript(rec.sim, members, killAt, { a: 0, b: 0 }, emptyRun(), { replay: after.journal });
    expect(stateHash(rec.sim.state)).toBe(live);
  });
});
