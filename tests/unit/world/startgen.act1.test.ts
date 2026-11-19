/** AC6: real player commands on generated lots. No fake quest events, grants or needs. */
import { expect, it } from 'vitest';
import { loadContent, allSystems } from '../../../src/sim';
import { createNewWorldWith, createSimulationWith, type EngineSimulation } from '../../../src/sim/engine';
import { createSpatial, edgeSides, LOT_TEMPLATE_INFO } from '../../../src/sim/spatial';
import { TICKS_PER_DAY } from '../../../src/sim/types';
import { canonicalStartPick, homeRegionIdOf, newTown } from '../../../src/shared/town';
import { ACT1_QUEST_IDS } from '../../../src/sim/content/quests';
import { generateStart } from '../../../src/sim/world/startGenerator';
import { admissionObject } from '../../../src/sim/world/startValidation';
import { deps, opts } from '../quests/helpers';
import { act1Commands, act1Step } from '../quests/act1Driver';

const registry = loadContent();

function buyReachable(sim: EngineSimulation, defId: string, roomId?: number): string | null {
  for (let z = 1; z < sim.state.lot.depth - 1; z++) for (let x = 1; x < sim.state.lot.width - 1; x++) for (const rot of [0, 1, 2, 3] as const) {
    if (!sim.spatial.isIndoor(x, z) || (roomId !== undefined && sim.spatial.roomAt(x, z) !== roomId)) continue;
    const cmd = { type: 'buy', defId, x, z, rot } as const;
    const check = sim.build.preview(cmd);
    if (!check.ok || (check.blockedSlots ?? []).length) continue;
    // checkPlace is local clearance, not whole-room connectivity. Plan purchases against a clone
    // so rejecting a choke-point placement emits no buy/quest event into the real run.
    const candidate = structuredClone(sim.state);
    candidate.objects['candidate'] = admissionObject({ defId, placement: { kind: 'floor', x, z, rot } }, 'candidate', registry);
    const S = createSpatial(() => candidate, registry);
    const from = [...candidate.lot.entryPoints, ...candidate.household.memberIds.map(id => candidate.agents[id].pos)];
    if (from.some(ep => {
      const df = S.distanceField(ep);
      return Object.values(candidate.objects).filter(o => (o.regionId ?? homeRegionIdOf(candidate)) === homeRegionIdOf(candidate)).some(o => registry.objects[o.defId].slots.some((_, i) => !S.resolveSlots(o).filter(r => r.index === i).flatMap(r => r.approach).some(p => Number.isFinite(df.dist[p.z * candidate.lot.width + p.x]))));
    })) continue;
    const r = sim.build.apply(cmd);
    if (r.ok) { sim.dispatch({ type: 'endBuildSession' }); return r.objectId ?? null; }
  }
  return null;
}

function buyWallLight(sim: EngineSimulation, roomId: number): string | null {
  for (const edge of Object.keys(sim.state.lot.walls).sort()) for (const side of [0, 1] as const) {
    const p = edgeSides(edge)[side];
    if (sim.spatial.roomAt(p.x, p.z) !== roomId) continue;
    const cmd = { type: 'buyWallItem', defId: 'sconce_candle', edge, side } as const;
    if (!sim.build.preview(cmd).ok) continue;
    const result = sim.build.apply(cmd);
    if (result.ok) { sim.dispatch({ type: 'endBuildSession' }); return result.objectId ?? null; }
  }
  return null;
}

for (let seed = 1; seed <= 10; seed++) it(`AC6 seed ${seed}: complete all eight Act1 beats by real commands in generated rooms`, () => {
  const canonicalControl = process.env.ASTRA_START_CANONICAL_CONTROL === '1';
  const generated = generateStart(seed, 'derelict', registry, canonicalControl ? canonicalStartPick('derelict') : undefined), systems = allSystems();
  // Engine's dependency seam installs the actual generated lot. Cloud owns the new-game UI binding.
  const state = createNewWorldWith({ ...opts(seed, 2), lotTemplate: 'derelict', startPick: generated.start }, {
    ...deps, registry, systems, lotTemplate: () => structuredClone(generated.home), templateInfo: LOT_TEMPLATE_INFO,
  });
  state.town = newTown(seed, generated.start);
  const sim = createSimulationWith(state, registry, systems, deps, { repair: true, init: true });
  const startingFunds = sim.state.household.funds; // independently asserted below; never replace actual funds with the proposal
  const mem: Record<string, unknown> = { cooker: 'microwave_nuke' };
  const completed: string[] = [], steps: string[] = [];
  const smallest = sim.spatial.rooms().filter(r => r.indoor).sort((a, b) => a.tiles.length - b.tiles.length)[0];
  for (let tick = 0; tick < TICKS_PER_DAY * 10; tick++) {
    if (sim.state.tick % 4 === 0) {
      const step = act1Step(sim);
      if (step && steps[steps.length - 1] !== step) steps.push(step);
      const essential = step === 'act1_hunger#0' ? 0 : step === 'act1_hunger#1' ? 1 : step === 'act1_scrub#0' ? 2 : -1;
      if (essential >= 0) {
        const obj = generated.validation.dayOne[essential];
        if (!Object.values(sim.state.objects).some(o => o.defId === obj.defId && (o.regionId ?? homeRegionIdOf(sim.state)) === homeRegionIdOf(sim.state)) && obj.placement.kind === 'floor') {
          const r = sim.build.apply({ type: 'buy', defId: obj.defId, ...obj.placement });
          expect(r.ok, `${seed}/${step}: ${r.reason}`).toBe(true);
          sim.dispatch({ type: 'endBuildSession' });
        }
      } else if (step === 'act1_patch#0') {
        if (!mem.walls) {
          const r = sim.build.apply({ type: 'addWalls', edges: generated.validation.wallPatch });
          expect(r.ok, `seed ${seed} real wall patch: ${r.reason}`).toBe(true);
          mem.walls = true; sim.dispatch({ type: 'endBuildSession' });
        }
      } else if (step === 'act1_patch#1') {
        if (!mem.furnished) {
          for (const id of ['chair_creaky', 'lamp_skull', 'table_urnstand']) expect(buyReachable(sim, id), `${seed}: ${id}`).toBeTruthy();
          mem.furnished = true;
        }
      } else if (step === 'act1_curb#0') {
        if (!mem.decor) mem.decor = buyReachable(sim, 'plant_deadfern', smallest.id);
      } else if (step === 'act1_curb#1') {
        const i = smallest.tiles[0], env = sim.spatial.roomEnvironment(i % state.lot.width + .5, Math.floor(i / state.lot.width) + .5);
        if (env < 4 && sim.state.tick % 240 === 0) expect(buyWallLight(sim, smallest.id) ?? buyReachable(sim, 'candelabra_drippy', smallest.id), `${seed}: room decoration; env=${env}`).toBeTruthy();
      } else for (const command of act1Commands(sim, mem)) sim.dispatch(command);
    }
    sim.step();
    for (const event of sim.drainEvents()) if (event.type === 'questCompleted' && ACT1_QUEST_IDS.includes(event.questId)) completed.push(event.questId);
    if (ACT1_QUEST_IDS.every(id => (sim.state.quests?.completions[id] ?? 0) === 1)) break;
  }
  console.log('AC6 Act1 journey', JSON.stringify({ seed, canonicalControl, pick: generated.start, startingFunds, tick: sim.state.tick, completed, steps, funds: sim.state.household.funds, faults: sim.faults() }));
  if (completed.length < ACT1_QUEST_IDS.length) console.log('AC6 stalled state', JSON.stringify({ seed, bills: sim.state.household.bills, agents: sim.state.household.memberIds.map(id => sim.state.agents[id]), objects: Object.values(sim.state.objects).map(o => ({ id: o.id, defId: o.defId, placement: o.placement })) }));
  expect(completed, `seed ${seed}, stuck ${act1Step(sim)}`).toEqual([...ACT1_QUEST_IDS]);
  expect(sim.faults()).toEqual([]);
  const baseFunds = LOT_TEMPLATE_INFO.find(t => t.id === 'derelict')!.startingFunds;
  expect(startingFunds, 'GDD6 / story-start: base plus 500 per extra member; Cloud correction6697171531').toBe(baseFunds + 500 * (state.household.memberIds.length - 1));
}, 120000);
