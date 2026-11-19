/**
 * The simulation entry points the controller needs (docs/CONTRACTS.md "Factory entry points", src/sim/index.ts).
 * Kept as an interface so tests inject a fake and the controller never hard-depends on the engine at type level.
 */
import type { ContentRegistry, LotTemplate, NewGameOptions, SimulationAPI } from '../sim/contracts';
import type { WorldState } from '../sim/types';

export interface SimModule {
  createNewWorld(opts: NewGameOptions): WorldState;
  createSimulation(state: WorldState): SimulationAPI;
  loadContent(): ContentRegistry;
  readonly LOT_TEMPLATES: readonly LotTemplate[];
}
