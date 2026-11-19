/**
 * W-025 S4: a FRESH world (only the home is active, no step taken yet) can walk anywhere open: the route is planned
 * through dormant regions (planning-only services) and streaming activates them ahead of the walker. S3 answered
 * `noPath` here (a route needed every region live).
 */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim/index';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { agentRegion, activeRegions } from '../../../src/sim/engine/regions';
import { ENGINE_INTERACTIONS } from '../../../src/sim/vocabulary';
import { ac1Options } from './ac1Harness';
import { HOME, runUntilIdle, tileOfAgent } from './s3Harness';

describe('fresh world walk (S4)', () => {
  it('walkTo(street:mildew:2, 14,2) from a fresh home returns a route, and the walk arrives', () => {
    const sim = createSimulation(createNewWorld(ac1Options('starter', 7))) as unknown as EngineSimulation;
    const eng = sim.engine;
    expect(sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off', visitorsEnabled: false } }).ok).toBe(true);
    expect(activeRegions(eng)).toEqual([HOME]); // nothing streamed yet
    const [a] = sim.state.household.memberIds;
    const target = { regionId: 'street:mildew:2', x: 14, z: 2 };
    const r = sim.worldRoute!(a, target);
    expect(r).toMatchObject({ ok: true, target });
    if (r.ok) {
      expect(r.portals.length).toBeGreaterThan(0);
      expect(r.lengthTiles).toBeGreaterThan(0);
    }
    const c = sim.dispatch({ type: 'queue', actorId: a, interactionId: ENGINE_INTERACTIONS.goHere, target: { kind: 'tile', x: 14, z: 2 }, params: { regionId: 'street:mildew:2' } });
    expect(c.ok).toBe(true);
    expect(c.route).toMatchObject({ ok: true });
    const log = runUntilIdle(sim, a, 3000);
    expect(log.failed).toEqual([]);
    expect(tileOfAgent(eng, sim.state.agents[a])).toEqual(target);
    expect(agentRegion(eng, sim.state.agents[a])).toBe('street:mildew:2');
    expect(sim.faults()).toEqual([]);
  });
});
