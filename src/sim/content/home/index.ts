/**
 * SIM-HOME content module: gameplay ObjectDefs for the whole catalog, every home_* interaction, recipes and
 * home moodlets. Behaviours / effects / requirements referenced here are registered by src/sim/systems/home.
 */
import type { ContentModule } from '../../contracts';
import { HOME_MODULE_ID } from './ids';
import { HOME_INTERACTIONS } from './interactions';
import { MOODLETS } from './moodlets';
import { HOME_OBJECTS } from './objects';
import { RECIPES } from './recipes';

export const homeContent: ContentModule = {
  id: HOME_MODULE_ID,
  objects: HOME_OBJECTS,
  interactions: HOME_INTERACTIONS,
  moodlets: MOODLETS,
  recipes: RECIPES,
};

export { HOME_OBJECTS, HOME_INTERACTIONS, MOODLETS as HOME_MOODLETS, RECIPES as HOME_RECIPES };
export * from './ids';
