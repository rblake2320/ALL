/**
 * SIM-PEOPLE systems: social, careers, townies, aspirations, events (see README.md in this folder).
 *
 * System apis read the SimContext bound by the most recent hook call (init/tick/hour/...). One simulation at a
 * time is the normal case; a host that runs several simulations side by side should give each its own
 * instances via createPeopleSystems().
 */
import type { SimSystem } from '../../contracts';
import { createAspirationsSystem } from './aspirations';
import { createCareersSystem } from './careers';
import { createEventsSystem } from './events';
import { createSocialSystem } from './social';
import { createTowniesSystem } from './townies';

export function createPeopleSystems(): SimSystem[] {
  return [createSocialSystem(), createCareersSystem(), createTowniesSystem(), createAspirationsSystem(), createEventsSystem()];
}

export const peopleSystems: SimSystem[] = createPeopleSystems();
