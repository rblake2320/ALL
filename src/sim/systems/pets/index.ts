/** W-013 (D-008) strays-to-pets plugin: `petsSystem` runs WorldState.pets. */
import { petsSystem } from './system';

export * from './system';
export * from './guard';
export { createPetsState, healPetsState } from './state';

export const petSystems = [petsSystem];
