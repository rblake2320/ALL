/**
 * Build identity for feedback reports: the git commit (short SHA) and the feature-checklist version
 * ("v<registry version>/<feature count>", docs/verification/features.json), both injected by vite.config.ts `define`.
 * Outside a Vite build (tests, plain tsc) they read 'dev'.
 */
declare const __AFTERLIFE_BUILD__: string | undefined;
declare const __AFTERLIFE_CHECKLIST__: string | undefined;

const SAFE = /^[A-Za-z0-9._+-]{1,40}$/;

export const BUILD_SHA: string = typeof __AFTERLIFE_BUILD__ === 'string' && SAFE.test(__AFTERLIFE_BUILD__) ? __AFTERLIFE_BUILD__ : 'dev';
export const CHECKLIST_VERSION: string = typeof __AFTERLIFE_CHECKLIST__ === 'string' && SAFE.test(__AFTERLIFE_CHECKLIST__) ? __AFTERLIFE_CHECKLIST__ : 'dev';
