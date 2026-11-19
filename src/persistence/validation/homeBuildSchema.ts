/**
 * Structural schema for WorldState.homeBuild (src/shared/homeBuild.ts HomeBuildState). OPTIONAL: a save without it
 * (every world made before snap-point building, and any world made with it off) validates with no issue and stays
 * without the key. A present-but-broken block is dropped with a note, which turns the rules off for that world
 * rather than inventing a count.
 */
import { HOME_TIER_IDS, type HomeBuildState } from '../../shared/homeBuild';
import { type Check, INVALID, bool, lit, num, obj } from './core';

const stateSchema: Check<HomeBuildState> = obj<HomeBuildState>(
  {
    tier: lit(HOME_TIER_IDS, 'starter'),
    placedEver: num({ int: true, min: 0, max: 1e9, def: 0 }),
    freePlacement: bool(false),
  },
  { keepExtra: false },
);

export const homeBuildSchema: Check<HomeBuildState | undefined> = (v, ctx) => {
  if (v === undefined) return undefined;
  const r = stateSchema(v, ctx);
  if (r !== INVALID) return r;
  ctx.report('dropped', `${ctx.lastError.message}; snap-point building off for this world`);
  return undefined;
};
