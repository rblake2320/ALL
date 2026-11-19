/**
 * Game identity. The version comes from PLATFORM's build-time define (package.json "version", injected by
 * vite.config.ts / vitest.config.ts) so saves, diagnostics and the UI always agree on one number.
 */
export { GAME_VERSION } from '../persistence/version';
export const GAME_TITLE = 'Afterlife Lease';
