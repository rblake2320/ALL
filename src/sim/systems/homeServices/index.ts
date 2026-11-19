/** Home services plugin (home-build-system.md steps 3-4): `homeServicesSystem` runs WorldState.homeServices. */
import { homeServicesSystem } from './system';

export * from './system';
export * from './furniture';
export { createHomeServicesState, healHomeServicesState } from './state';

export const homeServicesSystems = [homeServicesSystem];
