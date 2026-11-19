/** TEST FIXTURE helpers: registry, deps, new worlds and simulations on the fixture lot. */
import type { ContentModule, NewGameOptions, NewMemberSpec, SimSystem } from '../../contracts';
import type { ObjectState, WorldState } from '../../types';
import { TICKS_PER_HOUR } from '../../types';
import type { Rot } from '../../../shared/dimensions';
import { defaultAppearance } from '../../../shared/appearance';
import { engineContent } from '../content';
import { loadContentFrom, type EngineRegistry } from '../registry';
import { createSimulationWith, type EngineSimulation } from '../simulation';
import type { EngineDeps } from '../types';
import { createNewWorldWith } from '../world';
import { fixtureContent } from './content';
import { setRegionBuilder } from '../streaming';
import { newLot } from '../../spatial/templates/builder';
import { createFixtureBuildService, createFixtureLot, createFixtureSpatial, FIXTURE_TEMPLATE_INFO } from './spatial';
import { createCounters, fixtureSystems, type FixtureCounters } from './systems';

export function fixtureRegistry(extra: ContentModule[] = []): EngineRegistry {
  return loadContentFrom([engineContent, fixtureContent, ...extra]);
}

export const fixtureDeps: EngineDeps = {
  spatialFactory: (getState, content) => createFixtureSpatial(getState, content),
  buildFactory: (ctx) => createFixtureBuildService(ctx),
};

export function member(firstName: string, traits: string[] = []): NewMemberSpec {
  return { firstName, lastName: 'Graves', appearance: defaultAppearance(), traits, aspiration: null };
}

export interface FixtureWorldOptions extends Partial<NewGameOptions> {
  registry?: EngineRegistry;
  systems?: SimSystem[];
}

export function newFixtureWorld(o: FixtureWorldOptions = {}): WorldState {
  const registry = o.registry ?? fixtureRegistry();
  return createNewWorldWith(
    {
      seed: o.seed ?? 1234,
      householdName: o.householdName ?? 'The Graves',
      members: o.members ?? [member('Mort'), member('Ghoulia')],
      lotTemplate: o.lotTemplate ?? 'empty',
      difficulty: o.difficulty ?? 'normal',
      ...(o.startPick ? { startPick: o.startPick } : {}),
    },
    {
      ...fixtureDeps,
      registry,
      systems: o.systems ?? fixtureSystems(),
      lotTemplate: createFixtureLot,
      templateInfo: FIXTURE_TEMPLATE_INFO,
    },
  );
}

export interface FixtureSim {
  sim: EngineSimulation;
  counters: FixtureCounters;
  registry: EngineRegistry;
}

export function fixtureSim(state: WorldState = newFixtureWorld(), opts: { systems?: SimSystem[]; registry?: EngineRegistry; counters?: FixtureCounters; repair?: boolean } = {}): FixtureSim {
  const counters = opts.counters ?? createCounters();
  const registry = opts.registry ?? fixtureRegistry();
  const systems = opts.systems ?? fixtureSystems(counters);
  const sim = createSimulationWith(state, registry, systems, fixtureDeps, { init: true, repair: opts.repair ?? true });
  // This engine-only registry deliberately lacks the game's home catalogue. Keep its original empty region
  // stand-ins explicit; production simulations exercise the actual furnished S7 builder in world runtime tests.
  setRegionBuilder(sim.engine, (_eng, region) => region.kind === 'lot' ? { lot: newLot(), objects: [] } : null);
  return { sim, counters, registry };
}

export function place(sim: EngineSimulation, defId: string, x: number, z: number, rot: Rot = 0, value = 100): ObjectState {
  return sim.engine.ctx.spawnObject(defId, { kind: 'floor', x, z, rot }, { value });
}

export function steps(sim: EngineSimulation, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}

export function minutes(sim: EngineSimulation, m: number): void {
  steps(sim, Math.round(m * 4));
}

export function hours(sim: EngineSimulation, h: number): void {
  steps(sim, Math.round(h * TICKS_PER_HOUR));
}

/** Members in id order. */
export function members(sim: EngineSimulation) {
  return sim.state.household.memberIds.map((id) => sim.state.agents[id]);
}

/** A tiny deterministic string hash (FNV-1a 32) for state comparisons. */
export function hashState(s: unknown): string {
  const str = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}:${str.length}`;
}
