/** Game version stamped into every save envelope (package.json `version`, injected at build time). */
export const GAME_VERSION: string =
  typeof __AFTERLIFE_VERSION__ === 'string' && __AFTERLIFE_VERSION__.length > 0 ? __AFTERLIFE_VERSION__ : '0.0.0-dev';
