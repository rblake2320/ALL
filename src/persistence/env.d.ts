/**
 * Build-time constant injected by Vite/Vitest `define` (see vite.config.ts / vitest.config.ts):
 * the `version` field of package.json. Declared as possibly-undefined so code that runs outside a
 * Vite pipeline (plain tsc/node) must guard with `typeof __AFTERLIFE_VERSION__ === 'string'`.
 */
declare const __AFTERLIFE_VERSION__: string | undefined;
