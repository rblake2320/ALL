import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim';
import type { EngineSimulation } from '../../../src/sim/engine/simulation';
import { defaultAppearance } from '../../../src/shared/appearance';
import { thawRegion } from '../../../src/sim/engine/streaming';
import { lotValue } from '../../../src/sim/systems/home/economy/bills';
import { syncMailboxes } from '../../../src/sim/systems/home/economy/mail';
import { canonicalJson } from '../../../src/persistence/canonicalJson';

describe('household economy with furnished neighbours', () => {
  it('neighbours neither add household property value nor receive household mailbox state on tick/reload', () => {
    const sim = createSimulation(createNewWorld({ seed: 7, householdName: 'Economy boundary', lotTemplate: 'starter', difficulty: 'normal', members: [{ firstName: 'Mort', lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null }] })) as unknown as EngineSimulation;
    const value = lotValue(sim.engine.ctx);
    expect(thawRegion(sim.engine, 'wormwood:mildew_n3')).toBe(true);
    expect(lotValue(sim.engine.ctx)).toBe(value);
    const boxes = Object.values(sim.state.objects).filter(o => o.regionId === 'wormwood:mildew_n3' && sim.content.objects[o.defId]?.tags.includes('mailbox'));
    expect(boxes.length).toBeGreaterThan(0);
    const before = canonicalJson(boxes);
    syncMailboxes(sim.engine.ctx);
    expect(canonicalJson(boxes)).toBe(before);
    const reloaded = createSimulation(JSON.parse(JSON.stringify(sim.serialize()))) as unknown as EngineSimulation;
    expect(canonicalJson(reloaded.serialize())).toBe(canonicalJson(sim.serialize()));
  });
});
