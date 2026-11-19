/** Cloud R2: home-only jobs keep assignments/progress across actual world travel and saves. */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import type { AgentState } from '../../../src/sim/types';
import { defaultAppearance } from '../../../src/shared/appearance';
import { homeRegionIdOf } from '../../../src/shared/town';
import { thawRegion } from '../../../src/sim/engine/streaming';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { noLocks } from '../../../src/persistence/locks';
import { makeMeta, silentLogger } from '../persistence/fixtures';
import { ENGINE_INTERACTIONS } from '../../../src/sim/vocabulary';

function setup() {
  const sim = createSimulation(createNewWorld({ seed: 7, householdName: 'World jobs', lotTemplate: 'starter', difficulty: 'normal', members: [{ firstName: 'Mort', lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null }] })) as unknown as EngineSimulation;
  sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off', visitorsEnabled: false } });
  const actorId = sim.state.household.memberIds[0];
  const home = homeRegionIdOf(sim.state), away = 'wormwood:mildew_n3';
  return { sim, actorId, home, away };
}
const marked = (a: AgentState) => [a.active, ...a.queue].filter(q => q && typeof q.params?.jobId === 'string');
function assign(sim: EngineSimulation, actorId: string) {
  const r = sim.dispatch({ type: 'job', action: 'assign', agentId: actorId, category: 'clean', scope: { kind: 'lot' }, mode: { kind: 'recurring', from: 0, to: 23 }, priority: 'high' });
  expect(r.ok).toBe(true);
  return sim.state.jobs!.list.find(j => j.id === r.id)!;
}
function walk(sim: EngineSimulation, actorId: string, regionId: string, home: string) {
  expect(sim.dispatch({ type: 'queue', actorId, interactionId: ENGINE_INTERACTIONS.goHere, target: { kind: 'tile', x: 14, z: 28 }, params: { regionId } }).ok).toBe(true);
  for (let n = 0; n < 3000; n++) {
    sim.step();
    const a = sim.state.agents[actorId];
    if (a.regionId && a.regionId !== home) expect(marked(a)).toEqual([]);
    if ((a.regionId ?? home) === regionId && Math.floor(a.pos.x) === 14 && Math.floor(a.pos.z) === 28 && a.active?.interactionId !== ENGINE_INTERACTIONS.goHere) return;
  }
  throw new Error(`Walk did not arrive at ${regionId}`);
}

describe('home-only jobs across world regions', () => {
  it('shows Away immediately for a walker and never dispatches a job there, including the null home alias', () => {
    const { sim, actorId, home, away } = setup();
    const j = assign(sim, actorId); j.lotId = null;
    expect(thawRegion(sim.engine, away)).toBe(true);
    const a = sim.state.agents[actorId];
    a.regionId = away; a.pos = a.prevPos = { x: 14.5, z: 28.5 };
    expect(sim.jobs!()!.list.find(v => v.id === j.id)?.status).toBe('away');
    for (let n = 0; n < 20; n++) { sim.step(); expect(marked(a)).toEqual([]); }
    expect(j.status).toBe('away');
    expect(j.done).toBe(0);
    expect(j.lotId).toBeNull();
    expect(home).not.toBe(away);
  });

  it('refuses a foreign object scope and excludes foreign objects from scope choices', () => {
    const { sim, actorId, away } = setup();
    expect(thawRegion(sim.engine, away)).toBe(true);
    const foreign = Object.values(sim.state.objects).find(o => o.regionId === away && sim.content.objects[o.defId]?.interactions.includes('home_wipeDown'))!;
    expect(foreign).toBeDefined();
    expect(sim.dispatch({ type: 'job', action: 'assign', agentId: actorId, category: 'clean', scope: { kind: 'object', id: foreign.id }, mode: { kind: 'once' } }).ok).toBe(false);
    expect(sim.jobs!()!.scopes.clean.some(s => s.scope.kind === 'object' && s.scope.id === foreign.id)).toBe(false);
  });

  it('actual leave/save/reload/return keeps order and completed progress, then resumes real home chores', async () => {
    const { sim, actorId, home, away } = setup();
    const j = assign(sim, actorId); j.lotId = null;
    const dirty = Object.values(sim.state.objects).filter(o => (sim.content.objects[o.defId]?.interactions ?? []).includes('home_wipeDown'));
    expect(dirty.length).toBeGreaterThan(0);
    for (const o of dirty) o.condition.dirt = 0.8;
    for (let n = 0; n < 1200 && j.done === 0; n++) sim.step();
    expect(j.done).toBeGreaterThan(0);
    for (const o of dirty) o.condition.dirt = 0.8;
    const done = j.done, order = sim.state.jobs!.list.map(v => v.id);
    walk(sim, actorId, away, home);
    sim.step();
    expect(j.status).toBe('away');
    expect(j.done).toBe(done);
    expect(sim.state.jobs!.list.map(v => v.id)).toEqual(order);
    const backend = createMemoryBackend();
    const m = new SaveManagerImpl({ backend, logger: silentLogger, locks: noLocks, repair: engineRepairHook() });
    expect((await m.save('away', 'world jobs', sim.serialize(), makeMeta())).ok).toBe(true);
    const loaded = await m.load('away');
    if (!loaded.ok) throw new Error(loaded.error);
    const resumed = createSimulation(loaded.world) as unknown as EngineSimulation;
    expect(resumed.jobs!()!.list.find(v => v.id === j.id)?.status).toBe('away');
    for (let n = 0; n < 30; n++) { sim.step(); resumed.step(); }
    expect(canonicalJson(resumed.serialize())).toBe(canonicalJson(sim.serialize()));
    walk(resumed, actorId, home, home);
    const back = resumed.state.jobs!.list.find(v => v.id === j.id)!;
    for (let n = 0; n < 1200 && back.done === done; n++) resumed.step();
    expect(back.done).toBeGreaterThan(done);
    expect(resumed.state.jobs!.list.map(v => v.id)).toEqual(order);
    expect(back.lotId).toBeNull();
    expect(resumed.faults()).toEqual([]);
  });
});
