/** SIM-ENGINE internals used by src/sim/index.ts, tests and debug tooling. */
export { engineContent, ENGINE_MODULE_ID, ENGINE_MOODLETS, ENGINE_INTERNAL_BEHAVIORS, isIdleInteraction } from './content';
export { loadContentFrom, asEngineRegistry } from './registry';
export type { EngineRegistry } from './registry';
export { validateContent, unreachableInteractions } from './validate';
export { createSimulationWith, createEngine, initSystems, stepEngine } from './simulation';
export type { EngineSimulation } from './simulation';
export { createNewWorldWith, DEFAULT_STARTING_FUNDS, rebuildStart, startBaseOf } from './world';
export type { WorldDeps, LotTemplateResult } from './world';
export { repairWorld, repairPositions, defaultLot } from './repair';
export type { RepairOptions } from './repair';
export { advertiseOf } from './autonomy';
export { relationshipLabel } from './views';
export { needMoodContribution, moodBand, MOOD_BAND_LABELS } from './needs';
export type { Engine, EngineDeps, SpatialFactory, BuildFactory, FaultRecord } from './types';
export * as ENGINE_CONSTANTS from './constants';
