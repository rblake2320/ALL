/**
 * Engine tuning numbers (GDD §2, §3, §7, §14). Pure data — no imports with side effects.
 */
import type { NeedId, SkillId, SimSettings } from '../types';

/** Base decay per game hour while awake (GDD §3). Preservation is owned by the home 'decay' system. */
export const ENGINE_DECAY_PER_HOUR: Partial<Record<NeedId, number>> = {
  hunger: 5.5,
  energy: 5.0,
  social: 4.0,
  fun: 4.5,
  hygiene: 3.5,
};

/** The needs the engine itself decays. */
export const ENGINE_DECAYED_NEEDS: readonly NeedId[] = ['hunger', 'energy', 'social', 'fun', 'hygiene'];

/**
 * GDD §3 (backlog #12): while asleep — a running stage of a 'sleep'-tagged interaction or with anim 'sleep' (beds,
 * coffins, naps, passing out) — the other engine-decayed needs slow down. Energy restores instead of decaying;
 * preservation follows HOME's bed `sleepDecayMult`.
 */
export const SLEEP_DECAY_MULT: Partial<Record<NeedId, number>> = {
  hunger: 0.5,
  social: 0.3,
  fun: 0.3,
  hygiene: 0.5,
};

export const DIFFICULTY_DECAY: Record<SimSettings['difficulty'], number> = { relaxed: 0.7, normal: 1.0, grim: 1.3 };
/** Preservation uses its own preset (GDD §3) — only used for the trend estimate; the decay system owns the real rate. */
export const DIFFICULTY_PRESERVATION: Record<SimSettings['difficulty'], number> = { relaxed: 0.6, normal: 1.0, grim: 1.4 };
export const PRESERVATION_BASE_DECAY = 1.3;

/** GDD §10: needs per hour while away at work (trend estimate only — careers owns the real change). */
export const AWAY_AT_WORK_PER_HOUR: Partial<Record<NeedId, number>> = {
  hunger: -4,
  energy: -5, // balance pass (people careers AWAY_RATES): was −6
  fun: -2,
  social: 3,
  hygiene: -3,
};

export const NEED_LABELS: Record<NeedId, string> = {
  hunger: 'Appetite',
  energy: 'Rest',
  preservation: 'Freshness',
  social: 'Company',
  fun: 'Amusement',
  hygiene: 'Odor Control',
};

export const MOOD_WEIGHTS: Record<NeedId, number> = {
  hunger: 14,
  energy: 12,
  preservation: 14,
  social: 10,
  fun: 10,
  hygiene: 8,
};

export const CRITICAL_NEED = 15;
export const FERAL_HUNGER = 5;
export const FERAL_CLEAR_HUNGER = 20;
export const PASS_OUT_ENERGY = 0;
export const OFF_AUTONOMY_ENERGY = 3;
export const LIMITED_AUTONOMY_NEED = 35;

export const SKILL_XP_PER_LEVEL = [100, 150, 220, 300, 400, 520, 660, 820, 1000, 1200];

export const SKILL_NAMES: Record<SkillId, string> = {
  cooking: 'Cooking',
  charisma: 'Charisma',
  mortuary: 'Mortuary Science',
  logic: 'Logic',
  creativity: 'Creativity',
  fitness: 'Fitness',
};

/** Movement (GDD/task spec). */
export const WALK_TILES_PER_MINUTE = 1.3;
export const LEG_SPEED = [0.3, 0.6, 1.0] as const;
export const FERAL_SPEED = 1.15;

/** Interaction machine. */
export const MAX_PLAYER_QUEUE = 8;
export const HARD_QUEUE_CAP = 12;
export const ROUTE_MAX_FAILS = 3;
export const ROUTE_TIME_FACTOR = 3;
export const ROUTE_TIME_SLACK_MIN = 5;
export const WAIT_TIMEOUT_MIN = 30;
/**
 * A `nearestTag` stage whose only matching objects are merely reserved / in use waits (phase 'wait') up to this many
 * game minutes for a slot instead of failing at once (backlog #5), re-checking once per TAG_WAIT_RECHECK_MIN.
 */
export const TAG_WAIT_MAX_MIN = 20;
export const TAG_WAIT_RECHECK_MIN = 1;
export const SOCIAL_MAX_REROUTES = 4;
export const SOCIAL_TARGET_MOVE_TILES = 1.5;
export const EXIT_PHASE_MIN = 1;
export const OPEN_ENDED_DURATION = 1e8;
export const OPEN_ENDED_SAFETY_MIN = 18 * 60;
export const GROUP_SOCIAL_PER_HOUR = 3;
export const GROUP_FUN_PER_HOUR = 1.5;
export const GROUP_MAX_OTHERS = 3;

/** Autonomy (GDD §14). */
export const AUTONOMY_IDLE_THRESHOLD = 6;
export const AUTONOMY_DISTANCE_SCALE = 14;
export const AUTONOMY_IN_USE_FACTOR = 0.6;
export const AUTONOMY_TOP_N = 3;
export const AUTONOMY_BACKOFF_MIN = 4;
export const AUTONOMY_BACKOFF_MAX = 30;
export const FERAL_HUNGER_WEIGHT = 3;
/**
 * Interaction tag for last-resort food (backlog #14, e.g. SIM-PEOPLE's hidden `social_feralNibble`): considered only
 * by the feral override, and only when no other hunger candidate is valid. Never offered by normal autonomy.
 */
export const FERAL_FALLBACK_TAG = 'feralFallback';
/**
 * Soft cap for a candidate's summed positive trait bonuses (`traitAd` + trait `tagAd`, backlog #13):
 * effective = CAP × (1 − e^(−raw / CAP)). Personality still orders hobbies (Neat Freak +40 → 11.6, Gourmand +20 → 9.8,
 * Hothead + Grumpy door slam +8 +4 → 7.6) but can no longer outweigh a real need. Negative bonuses (vetoes) are uncapped.
 */
export const TRAIT_AD_CAP = 12;

/** Bookkeeping. */
export const MAX_NOTIFICATIONS = 120;
export const MAX_TXLOG = 256;
export const MAX_FAULTS = 200;
export const SYSTEM_DISABLE_AFTER = 50;
export const MAX_EVENTS_BUFFER = 4000;
export const MAX_RELATIONSHIP_FRIENDSHIP = 100;
