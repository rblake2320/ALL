/**
 * Default binding of the controller to the real simulation (SIM-ENGINE's src/sim/index.ts). This is the ONLY
 * file in src/game that imports the engine, so tests can swap it out (vi.mock) and inject a fake SimModule.
 */
import { createNewWorld, createSimulation, loadContent, LOT_TEMPLATES } from '../sim/index';
import type { SimModule } from './simTypes';

export const defaultSimModule: SimModule = {
  createNewWorld,
  createSimulation,
  loadContent,
  get LOT_TEMPLATES() {
    return LOT_TEMPLATES;
  },
};
