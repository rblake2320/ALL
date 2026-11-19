import { expect, it } from 'vitest';
import { loadContent, allSystems } from '../../../src/sim';
import { createNewWorldWith, createSimulationWith } from '../../../src/sim/engine';
import { LOT_TEMPLATE_INFO } from '../../../src/sim/spatial';
import { validateWorld } from '../../../src/persistence/validation';
import { newTown } from '../../../src/shared/town';
import { generateStart } from '../../../src/sim/world/startGenerator';
import { extractStartGeometry } from '../../../src/sim/world/startGeometry';
import { deps, opts } from '../quests/helpers';

it('50 full worlds serialize, pass persistence admission and reload with identical actual geometry and neighbours', () => {
  const registry = loadContent(), systems = allSystems();
  for (let seed = 1; seed <= 50; seed++) {
    const generated = generateStart(seed, 'derelict', registry);
    const state = createNewWorldWith({ ...opts(seed, 1), lotTemplate: 'derelict', startPick: generated.start }, {
      ...deps, registry, systems, lotTemplate: () => structuredClone(generated.home), templateInfo: LOT_TEMPLATE_INFO,
    });
    state.town = newTown(seed, generated.start); // explicit adapter until Cloud's separately owned engine seam lands
    const sim = createSimulationWith(state, registry, systems, deps, { repair: true, init: true });
    expect(sim.state.household.funds).toBe(2500); // one member: exact base, independently from generator metadata
    const signature = () => extractStartGeometry({ ...generated.layout, home: { ...generated.layout.home, lot: sim.state.lot, objects: Object.values(sim.state.objects) } });
    expect(signature()).toEqual(extractStartGeometry(generated.layout));
    const saved = JSON.stringify(sim.serialize()), validation = validateWorld(JSON.parse(saved));
    expect(validation.ok, `seed ${seed} persistence admission`).toBe(true);
    if (!validation.ok) throw new Error(validation.errors.join('; '));
    expect(validation.issues, `seed ${seed} must not silently repair generated geometry`).toEqual([]);
    const loaded = createSimulationWith(validation.world, registry, systems, deps, { repair: true, init: true });
    expect(loaded.serialize()).toEqual(JSON.parse(saved));
    const regenerated = generateStart(seed, 'derelict', registry, loaded.state.town!.start!);
    const loadedSignature = extractStartGeometry({ ...regenerated.layout, home: { ...regenerated.layout.home, lot: loaded.state.lot, objects: Object.values(loaded.state.objects) } });
    expect(loadedSignature).toEqual(signature());
    expect(regenerated.layout.neighbours).toEqual(generated.layout.neighbours);
    expect(loaded.faults()).toEqual([]);
  }
}, 30000);
