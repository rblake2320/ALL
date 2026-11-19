/**
 * Recipes — GDD §5. `hunger` is the per-serving base; eaten hunger = hunger × (0.8 + 0.1 × quality).
 * Final quality for stove-cooked recipes = clamp(baseQuality + floor(cooking / 3) − 1 + stove qualityBonus, 1, 6).
 * Non-stove recipes (jerky, burrito, pizza) keep their baseQuality.
 */
import type { RecipeDef } from '../../contracts';
import { RECIPE } from './ids';

export const RECIPES: RecipeDef[] = [
  { id: RECIPE.brainLoaf, name: 'Synthetic Brain Loaf', cost: 12, minCooking: 0, servings: 4, baseQuality: 2, hunger: 45, cookMinutes: 30 },
  { id: RECIPE.brainJerky, name: 'Brain Jerky Snack', cost: 5, minCooking: 0, servings: 1, baseQuality: 1, hunger: 20, cookMinutes: 0, requiresTag: 'fridge' },
  { id: RECIPE.cerebellumStew, name: 'Cerebellum Stew', cost: 20, minCooking: 2, servings: 4, baseQuality: 3, hunger: 55, cookMinutes: 45 },
  { id: RECIPE.frontalLasagna, name: 'Frontal Lobe Lasagna', cost: 30, minCooking: 4, servings: 6, baseQuality: 4, hunger: 60, cookMinutes: 60 },
  {
    id: RECIPE.medullaFlambe,
    name: 'Gourmet Medulla Flambé',
    cost: 45,
    minCooking: 7,
    servings: 4,
    baseQuality: 5,
    hunger: 70,
    cookMinutes: 75,
    requiresTag: 'cryoFridge',
  },
  { id: RECIPE.brainBurrito, name: 'Microwave Brain Burrito', cost: 8, minCooking: 0, servings: 1, baseQuality: 2, hunger: 40, cookMinutes: 6, requiresTag: 'microwave' },
  { id: RECIPE.brainPizza, name: 'Brain Pizza', cost: 35, minCooking: 0, servings: 6, baseQuality: 3, hunger: 50, cookMinutes: 0 },
];

export const RECIPES_BY_ID: Record<string, RecipeDef> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

/** Flavour blurbs for the Cook… menu tooltips / notifications. */
export const RECIPE_BLURBS: Record<string, string> = {
  [RECIPE.brainLoaf]: 'Lab-grown, shelf-stable and shaped like a loaf for reasons nobody can explain.',
  [RECIPE.brainJerky]: 'Chewy, salty, vaguely grey. The snack that snacks back.',
  [RECIPE.cerebellumStew]: 'A slow-simmered stew with real chunks of balance and coordination.',
  [RECIPE.frontalLasagna]: 'Layers of pasta and impulse control. Serves a crowd, or one very determined zombie.',
  [RECIPE.medullaFlambe]:'Set on fire on purpose, for once. Requires the deep chill of a Cryo-Fridge.',
  [RECIPE.brainBurrito]: 'Ninety seconds of radiation for a lifetime of regret. Tasty regret.',
  [RECIPE.brainPizza]: 'Thin crust, thick crust, brain crust. Delivered lukewarm by a ghoul with no tip etiquette.',
};
