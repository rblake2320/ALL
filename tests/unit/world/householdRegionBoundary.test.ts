import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim';
import type { EngineSimulation } from '../../../src/sim/engine';
import { defaultAppearance } from '../../../src/shared/appearance';
import { resolveQuestAction } from '../../../src/shared/questAction';
import { thawRegion } from '../../../src/sim/engine/streaming';
import { foodOnLot } from '../../../src/sim/systems/people/townies/phone';
import { evaluateObjectiveState, objectiveWorldOf, startObjective } from '../../../src/sim/systems/quests/objectives';
import { objectsWithTag } from '../../../src/sim/systems/home/util';
import type { ObjectiveDef } from '../../../src/sim/contracts';

function fresh(): EngineSimulation {
  const sim = createSimulation(createNewWorld({ seed: 7, householdName: 'Boundary', lotTemplate: 'derelict', difficulty: 'normal', members: [{ firstName: 'Mort', lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null }] })) as unknown as EngineSimulation;
  expect(thawRegion(sim.engine, 'wormwood:mildew_n3')).toBe(true);
  return sim;
}

describe('household activity boundaries with real furnished neighbours', () => {
  it('a neighbour kitchen cannot suppress the household emergency meal or become a local appliance', () => {
    const sim = fresh();
    const ctx = sim.engine.ctx;
    for (const o of Object.values(sim.state.objects)) if (!o.regionId && sim.content.objects[o.defId].tags.some(t => ['fridge', 'microwave', 'meal'].includes(t))) ctx.removeObject(o.id, 'test kitchen loss');
    expect(Object.values(sim.state.objects).some(o => o.regionId && sim.content.objects[o.defId].tags.includes('fridge'))).toBe(true);
    expect(foodOnLot(ctx)).toBe(false);
    expect(objectsWithTag(ctx, 'fridge')).toEqual([]);
  });

  it('quest Go offers Buy when the shower exists only in the neighbour house', () => {
    const sim = fresh();
    const result = resolveQuestAction({ objective: { kind: 'interaction', ids: ['home_shower'], count: 1 } }, sim, null);
    expect(result.kind).toBe('missing');
  });

  it('furnishing a neighbour never satisfies the household own objective', () => {
    const sim = fresh();
    const objective: ObjectiveDef = { kind: 'own', tags: ['fridge'], count: 1, fresh: false, holdMin: 0 };
    const world = objectiveWorldOf(sim);
    const progress = startObjective(objective, world);
    evaluateObjectiveState(objective, progress, world, 1);
    expect(progress.done).toBe(false);
    expect(progress.progress).toBe(0);
  });
});
