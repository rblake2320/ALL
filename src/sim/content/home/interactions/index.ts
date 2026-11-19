import type { InteractionDef } from '../../../contracts';
import { CARE_INTERACTIONS } from './care';
import { HOUSEHOLD_INTERACTIONS } from './household';
import { KITCHEN_INTERACTIONS } from './kitchen';
import { LEISURE_INTERACTIONS } from './leisure';
import { REST_INTERACTIONS } from './rest';

export const HOME_INTERACTIONS: InteractionDef[] = [
  ...REST_INTERACTIONS,
  ...KITCHEN_INTERACTIONS,
  ...CARE_INTERACTIONS,
  ...LEISURE_INTERACTIONS,
  ...HOUSEHOLD_INTERACTIONS,
];

export const HOME_INTERACTIONS_BY_ID: Record<string, InteractionDef> = Object.fromEntries(HOME_INTERACTIONS.map((d) => [d.id, d]));
