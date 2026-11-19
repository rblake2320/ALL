/**
 * Simulation public entry point (docs/CONTRACTS.md factory table).
 *   createNewWorld(opts)   — fresh WorldState (lot template, household, townies via system init)
 *   createSimulation(state) — repairWorld + wire engine/spatial/systems + init(loaded = true)
 *   loadContent()           — engine + home + people content registry (cached)
 *   LOT_TEMPLATES           — lot templates for the New Game screen
 *   repairWorld(state)      — make any parsed save structurally valid; returns warnings
 */
import type { ContentRegistry, LotTemplate, NewGameOptions, SimSystem, SimulationAPI } from './contracts';
import type { WorldState } from './types';
import { createBuildService, createLotTemplate, createSpatial, LOT_TEMPLATE_INFO } from './spatial';
import { homeContent } from './content/home';
import { peopleContent } from './content/people';
import { homeSystems } from './systems/home';
import { peopleSystems } from './systems/people';
import { questSystems } from './systems/quests';
import { jobSystems } from './systems/jobs';
import { petSystems } from './systems/pets';
import { homeServicesSystems } from './systems/homeServices';
import {
  createNewWorldWith,
  createSimulationWith,
  rebuildStart as rebuildStartWith,
  engineContent,
  loadContentFrom,
  repairPositions,
  repairWorld as repairWorldWith,
  validateContent as validateContentWith,
} from './engine';
import type { EngineDeps, EngineRegistry, LotTemplateResult } from './engine';
import type { GeneratedStart } from './world/startGenerator';

export const LOT_TEMPLATES: LotTemplate[] = LOT_TEMPLATE_INFO;

let cachedRegistry: EngineRegistry | null = null;

/** Engine + home + people content (merged once, then cached). */
export function loadContent(): ContentRegistry {
  if (!cachedRegistry) cachedRegistry = loadContentFrom([engineContent, homeContent, peopleContent]);
  return cachedRegistry;
}

/**
 * Every domain system in tick order (home first, then people, then household jobs (W-124), then quests — which only
 * observes and never feeds back).
 */
export function allSystems(): SimSystem[] {
  return [...homeSystems, ...peopleSystems, ...jobSystems, ...petSystems, ...homeServicesSystems, ...questSystems];
}

const deps: EngineDeps = {
  spatialFactory: (getState, content) => createSpatial(getState, content),
  buildFactory: (ctx) => createBuildService(ctx),
};

export function createNewWorld(opts: NewGameOptions): WorldState {
  return createNewWorldWith(opts, {
    ...deps,
    registry: loadContent(),
    systems: allSystems(),
    lotTemplate: (id) => createLotTemplate(id) as LotTemplateResult,
    templateInfo: LOT_TEMPLATE_INFO,
  });
}

export function createSimulation(state: WorldState): SimulationAPI {
  return createSimulationWith(state, loadContent(), allSystems(), deps, { repair: true, init: true });
}

/** Repair a loaded world in place (structure, references, positions); returns human-readable warnings. */
export function repairWorld(state: WorldState): string[] {
  const registry = loadContent();
  const warnings = repairWorldWith(state, registry);
  try {
    repairPositions(state, createSpatial(() => state, registry), warnings);
  } catch {
    /* positions are re-checked by the engine every tick */
  }
  return warnings;
}

/** Validate the shipped content against the shipped systems (used by tests and the debug overlay). */
export function validateContent(): string[] {
  return validateContentWith(loadContent(), allSystems());
}

/**
 * W-025 S7: the generated start (home, seven built neighbours, map) of a world, rebuilt from its saved StartPick so a
 * reload brings back the same neighbours. Null for a world with no usable pick (migrated legacy worlds).
 */
export function rebuildStart(world: Pick<WorldState, 'town'>): GeneratedStart | null {
  return rebuildStartWith(world, loadContent());
}
