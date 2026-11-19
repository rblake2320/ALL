/** S7/S4 integration: real generated homes must survive the planner → thaw → freeze → reload boundary. */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation, rebuildStart } from '../../../src/sim';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { freezeRegion, thawRegion } from '../../../src/sim/engine/streaming';
import { planningServiceOf } from '../../../src/sim/engine/regions';
import { worldOf } from '../../../src/sim/engine/worldMove';
import { createStartTemplate } from '../../../src/sim/world/startTemplates';
import { defaultAppearance } from '../../../src/shared/appearance';
import { ENGINE_INTERACTIONS } from '../../../src/sim/vocabulary';

const newSim = (seed: number) => createSimulation(createNewWorld({ seed, householdName: 'World integration', lotTemplate: 'derelict', startVariation: true, difficulty: 'normal', members: [{ firstName: 'Mort', lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null }] })) as unknown as EngineSimulation;
const objectsOf = (sim: EngineSimulation, id: string) => Object.values(sim.state.objects).filter(o => o.regionId === id);
const contents = (objects: readonly { defId: string; placement: unknown }[]) => objects.map(o => JSON.stringify([o.defId, o.placement])).sort();
const walls = (lot: { walls: Record<string, { openingId: unknown }> }) => Object.fromEntries(Object.entries(lot.walls).map(([k, v]) => [k, { ...v, openingId: null }]));

describe('generated neighbours in the real streaming engine', () => {
  it('all seven actual generated lots agree with planning and survive edits, freeze and JSON-state reload', () => {
    let sim = newSim(12);
    const generated = rebuildStart(sim.state)!;
    expect(generated.fallback).toBe(false);
    const map = worldOf(sim.engine)!.map;
    expect(generated.layout.neighbours).toHaveLength(7);
    for (const built of generated.layout.neighbours) {
      const id = built.region.id;
      expect(map.regions.find(r => r.id === id)?.templateId).toBe(built.region.templateId);
      const expected = createStartTemplate(built.region.templateId!);
      const planned = planningServiceOf(sim.engine, id)!;
      expect(planned).not.toBeNull();
      expect(walls(planned.lot())).toEqual(walls(expected.lot));
      expect(planned.lot().floors).toEqual(expected.lot.floors);
      let inside: { x: number; z: number } | null = null;
      for (let z = 0; z < 30 && !inside; z++) for (let x = 0; x < 30 && !inside; x++) {
        if (planned.spatial.isIndoor(x, z) && planned.spatial.isWalkable(x, z)) inside = { x, z };
      }
      if (built.region.templateId !== 'empty') expect(inside).not.toBeNull();
      const privateCheck = () => {
        if (inside) expect(sim.worldRoute!(sim.state.household.memberIds[0], { regionId: id, ...inside })).toMatchObject({ ok: false, reason: 'private' });
      };
      privateCheck();
      expect(thawRegion(sim.engine, id)).toBe(true);
      privateCheck();
      expect(contents(objectsOf(sim, id))).toEqual(contents(expected.objects));
      const live = planningServiceOf(sim.engine, id)!;
      expect(walls(live.lot())).toEqual(walls(expected.lot));
      const changed = objectsOf(sim, id).find(o => o.placement.kind === 'floor');
      if (changed) changed.tint = '#135724';
      const changedId = changed?.id;
      const before = contents(objectsOf(sim, id));
      expect(freezeRegion(sim.engine, id)).toBe(true);
      expect(objectsOf(sim, id)).toHaveLength(0);
      privateCheck();
      sim = createSimulation(JSON.parse(JSON.stringify(sim.state))) as unknown as EngineSimulation;
      privateCheck();
      expect(thawRegion(sim.engine, id)).toBe(true);
      expect(contents(objectsOf(sim, id))).toEqual(before);
      if (changedId) expect(sim.state.objects[changedId]?.tint).toBe('#135724');
      expect(walls(planningServiceOf(sim.engine, id)!.lot())).toEqual(walls(expected.lot));
      expect(freezeRegion(sim.engine, id)).toBe(true);
      expect(sim.faults()).toEqual([]);
    }
  });

  it('a normal generated household can actually walk to a furnished neighbour sidewalk', () => {
    const sim = newSim(23);
    expect(sim.dispatch({ type: 'setSettings', settings: { autonomy: 'off', visitorsEnabled: false } }).ok).toBe(true);
    const actorId = sim.state.household.memberIds[0];
    const neighbour = rebuildStart(sim.state)!.layout.neighbours.find(n => n.region.templateId !== 'empty')!;
    const regionId = neighbour.region.id;
    const result = sim.dispatch({ type: 'queue', actorId, interactionId: ENGINE_INTERACTIONS.goHere, target: { kind: 'tile', x: 14, z: 28 }, params: { regionId } });
    expect(result.ok).toBe(true);
    const failures: unknown[] = [];
    let arrived = false;
    for (let i = 0; i < 3000; i++) {
      sim.step();
      failures.push(...sim.drainEvents().filter(e => e.type === 'interactionFailed' && e.agentId === actorId));
      const a = sim.state.agents[actorId];
      if (a.regionId === regionId && Math.floor(a.pos.x) === 14 && Math.floor(a.pos.z) === 28 && !a.active) { arrived = true; break; }
    }
    expect(arrived).toBe(true);
    expect(failures).toEqual([]);
    expect(sim.faults()).toEqual([]);
    expect(objectsOf(sim, regionId).length).toBeGreaterThan(0);
  });
});
