/**
 * The LIFE bonuses a home gives right now (furniture sets 2/4/6 plus the Hearth wards, src/shared/homeBuild.ts), for the
 * engine's need gain and skill XP and the decay system's sleep freshness. Pure function of the world, never cached.
 * Never a fight stat (CB-2): the type has life keys only.
 */
import { homeLifeBonus, type LifeBonus } from '../../shared/homeBuild';
import { HEARTH_OBJECT } from '../../shared/homeServices';
import { placedItems } from '../spatial/homeBuildRules';
import type { WorldState } from '../types';
import { buildHomeObjects } from '../spatial/build/region';

const NONE: LifeBonus = Object.freeze({});

/**
 * Are the home bonuses in play in this world? They are part of the home build system, so they count in a world made with
 * it (`state.homeBuild`, the new-game setting) or once the household has put the Hearth in its home. Every other world,
 * including every older save, keeps the balance it had: a starter lot with two Mausoleum pieces does not quietly get faster.
 */
export function homeBonusesLive(state: WorldState | undefined | null): boolean {
  if (!state || typeof state !== 'object') return false;
  if (state.homeBuild) return true;
  for (const obj of Object.values(buildHomeObjects(state))) if (obj.defId === HEARTH_OBJECT) return true;
  return false;
}
/**
 * A PURE function of the world (D-003): the same serialized state always gives the same bonus, whatever was read before and
 * whenever a build command changed the furniture. There is deliberately NO cache: a cache keyed by tick returned a stale
 * bonus after a same-tick build, add or undo (PR #105 review, P1). Cost: one pass over the placed objects per call, and the
 * callers only ask for a gain that is Rest, Fun, skill XP or sleep Freshness.
 */
export function homeBonusOf(state: WorldState | undefined | null): LifeBonus {
  if (!state || typeof state !== 'object' || !homeBonusesLive(state)) return NONE;
  const hearth = state.homeServices?.hearth ?? { essence: 0, owned: [] };
  try {
    return homeLifeBonus(placedItems(state), hearth, state.household?.utilitiesOn === true);
  } catch {
    return NONE;
  }
}

const pct = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? 1 + v / 100 : 1);

/** Multiplier on a positive need gain: Rest while asleep, Fun anywhere. 1 for every other need. */
export function homeNeedGainMult(state: WorldState, need: string, sleeping: boolean): number {
  const b = homeBonusOf(state);
  if (need === 'energy' && sleeping) return pct(b.restRestorePct);
  if (need === 'fun') return pct(b.funGainPct);
  return 1;
}

export const homeSkillGainMult = (state: WorldState): number => pct(homeBonusOf(state).skillGainPct);

/** Extra Freshness (preservation) per game hour while asleep in a bed. */
export function homeFreshnessPerHourAsleep(state: WorldState): number {
  const v = homeBonusOf(state).freshnessPerHourAsleep;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}
