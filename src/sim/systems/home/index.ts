/**
 * SIM-HOME systems: decay (preservation, limbs, crumbling), food (cooking, eating, leftovers, pizza),
 * economy (bills, power, repo, mail, painting sales), upkeep (breakage, fire, mess, environment, leisure).
 * Registration order matters only for tick order within a step: decay → food → economy → upkeep.
 * See README.md in this folder for every registered id and the semantics.
 */
import type { SimSystem } from '../../contracts';
import { createDecaySystem } from './decay';
import { createEconomySystem } from './economy';
import { createFoodSystem } from './food';
import { createUpkeepSystem } from './upkeep';

export const homeSystems: SimSystem[] = [createDecaySystem(), createFoodSystem(), createEconomySystem(), createUpkeepSystem()];

export { createDecaySystem, createFoodSystem, createEconomySystem, createUpkeepSystem };
export { resetCtxRegistry } from './ctxRegistry';
