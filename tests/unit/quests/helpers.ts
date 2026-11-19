/** Shared helpers for the quests suites: real-module worlds with/without the quests system, scripted play. */
import type { Command, NewGameOptions, QuestDef, SimEvent, SimSystem } from '../../../src/sim/contracts';
import type { WorldState } from '../../../src/sim/types';
import { defaultAppearance } from '../../../src/shared/appearance';
import { allSystems, loadContent } from '../../../src/sim/index';
import { createBuildService, createLotTemplate, createSpatial, LOT_TEMPLATE_INFO } from '../../../src/sim/spatial';
import { createNewWorldWith, createSimulationWith, type EngineSimulation } from '../../../src/sim/engine';
import type { LotTemplateResult } from '../../../src/sim/engine';
import { createQuestsSystem, QUESTS_SYSTEM_ID } from '../../../src/sim/systems/quests';

export const deps = {
  spatialFactory: (getState: () => WorldState, content: ReturnType<typeof loadContent>) => createSpatial(getState, content),
  buildFactory: (ctx: Parameters<typeof createBuildService>[0]) => createBuildService(ctx),
};

export function opts(seed: number, members = 2): NewGameOptions {
  const names = ['Mort', 'Ghoulia', 'Rotney', 'Bonnie'];
  return {
    seed,
    householdName: 'The Graves',
    lotTemplate: 'starter',
    difficulty: 'normal',
    members: names.slice(0, members).map((n) => ({ firstName: n, lastName: 'Graves', appearance: defaultAppearance(), traits: [], aspiration: null })),
  };
}

export function systemsWithout(id: string): SimSystem[] {
  return allSystems().filter((s) => s.id !== id);
}

export function systemsWithQuests(defs?: readonly QuestDef[]): SimSystem[] {
  const base = systemsWithout(QUESTS_SYSTEM_ID);
  return defs ? [...base, createQuestsSystem(defs)] : allSystems();
}

export function newWorld(o: NewGameOptions, systems: SimSystem[]): WorldState {
  return createNewWorldWith(o, {
    ...deps,
    registry: loadContent(),
    systems,
    lotTemplate: (id: 'starter' | 'empty') => createLotTemplate(id) as LotTemplateResult,
    templateInfo: LOT_TEMPLATE_INFO,
  } as never);
}

export function simOf(state: WorldState, systems: SimSystem[]): EngineSimulation {
  return createSimulationWith(state, loadContent(), systems, deps as never, { repair: true, init: true });
}

export const jsonClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Serialized world without the quests block (what a quest-free build would have saved). */
export function withoutQuests(s: WorldState): string {
  const c = jsonClone(s) as WorldState & { quests?: unknown };
  delete c.quests;
  return JSON.stringify(c);
}

export function objectOf(sim: EngineSimulation, defId: string): string | null {
  const o = Object.values(sim.state.objects).find((x) => x.defId === defId && x.placement.kind !== 'held');
  return o ? o.id : null;
}

/** First buildable floor tile where `defId` can be bought (scan order: z then x). */
export function spotFor(sim: EngineSimulation, defId: string): { x: number; z: number } | null {
  const b = sim.state.lot.buildable;
  for (let z = b.z0; z < b.z1; z++) {
    for (let x = b.x0; x < b.x1; x++) {
      const p = sim.build.preview({ type: 'buy', defId, x, z, rot: 0 });
      if (p.ok) return { x, z };
    }
  }
  return null;
}

/** A small scripted player: cook, spray, shower, find a job, chat, buy decor. Resolved against the live state. */
export function playerScript(sim: EngineSimulation, tick: number): Command[] {
  const ids = sim.state.household.memberIds;
  const a = ids[0];
  const b = ids[1] ?? ids[0];
  const fridge = objectOf(sim, 'fridge_humming');
  const out: Command[] = [];
  switch (tick) {
    case 30:
      if (fridge) out.push({ type: 'queue', actorId: a, interactionId: 'home_cook', target: { kind: 'object', id: fridge }, params: { recipe: 'brainLoaf' } });
      break;
    case 600:
      if (fridge) out.push({ type: 'queue', actorId: b, interactionId: 'home_grabSpray', target: { kind: 'object', id: fridge } });
      break;
    case 900: {
      const sh = objectOf(sim, 'shower_drizzle');
      if (sh) out.push({ type: 'queue', actorId: b, interactionId: 'home_shower', target: { kind: 'object', id: sh } });
      break;
    }
    case 1200:
      out.push({ type: 'queue', actorId: a, interactionId: 'phone_findJob', target: { kind: 'self' }, params: { careerId: 'retail' } });
      break;
    case 2000:
      out.push({ type: 'queue', actorId: b, interactionId: 'social_chat', target: { kind: 'agent', id: a } });
      break;
    case 2500: {
      const s = spotFor(sim, 'plant_deadfern');
      if (s) out.push({ type: 'build', cmd: { type: 'buy', defId: 'plant_deadfern', x: s.x, z: s.z, rot: 0 } }, { type: 'endBuildSession' });
      break;
    }
    default:
      break;
  }
  return out;
}

export interface RunLog {
  quest: SimEvent[];
}

export function run(sim: EngineSimulation, toTick: number, log?: RunLog, script = playerScript): void {
  while (sim.state.tick < toTick) {
    for (const c of script(sim, sim.state.tick)) sim.dispatch(c);
    sim.step();
    const ev = sim.drainEvents();
    if (log) for (const e of ev) if (e.type === 'questStarted' || e.type === 'questProgress' || e.type === 'questCompleted') log.quest.push(e);
  }
}
