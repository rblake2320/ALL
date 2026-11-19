/**
 * Autonomy sanity for HOME behaviours (used from `adjustScore`, which only runs for autonomous picks — player
 * orders are never affected).
 *
 * The engine scores `Σ need gains + adBonus + traitAd + trait tagAd`. Flat trait bonuses (Artistic +25 paint,
 * Lazy +15 TV/nap, Gourmand +20 cook / +10 eat, Neat Freak +40 clean …) are large next to need gains at moderate
 * need levels, which made zombies paint for 90 minutes at hunger 14, re-cook while the fridge was full, or restart
 * Watch TV every minute at fun 97 (its `stopWhen` ends it at once). Two rules fix that without touching tuning:
 *
 *  1. **Pressing needs first** (`basicNeedDamp`): while hunger / energy / hygiene is low, activities that do not
 *     restore that need are scaled down (×1 above the start threshold → ×0.15 at the floor). A zombie with nothing
 *     better to do idles (and is then free to be called to dinner) instead of committing to a long hobby.
 *  2. **Nothing to gain** (`stopWhenSatisfied`): an interaction whose open-ended stage stops at `need ≥ X` is not
 *     worth starting when the need is already within a few points of X.
 */
import type { InteractionDef, SimContext } from '../../contracts';
import type { AgentState, NeedId } from '../../types';
import { NEED_IDS } from '../../types';
import { num } from './util';

export interface PressingNeed {
  need: NeedId;
  /** Damping starts below this value. */
  start: number;
  /** Full damping (DAMP_MIN) at or below this value. */
  full: number;
  /**
   * At or below `full` the activity is dropped altogether (score 0) instead of damped. Needed because the engine
   * validates only the first few candidates by pre-adjust score: damped-but-positive hobbies (a Neat Freak's +40 per
   * dirty dish) would otherwise fill that window and hide the fridge from a starving zombie. Hygiene stays soft so a
   * lot without plumbing doesn't freeze all fun.
   */
  hard: boolean;
}

/** Needs that should be taken care of before hobbies and chores (GDD §3: critical ≤ 15; feral at hunger ≤ 5). */
export const PRESSING_NEEDS: readonly PressingNeed[] = [
  { need: 'hunger', start: 40, full: 15, hard: true },
  { need: 'energy', start: 35, full: 10, hard: true },
  { need: 'hygiene', start: 25, full: 5, hard: false },
];
export const DAMP_MIN = 0.15;
/**
 * An activity that restores a need which is itself below this level is triage, not leisure, and is never damped
 * (a 3-minute Preservative Spray at freshness 10 must not lose to a nap just because the zombie is also tired).
 */
export const URGENT_HELP: Readonly<Partial<Record<NeedId, number>>> = {
  hunger: 40,
  energy: 35,
  hygiene: 25,
  preservation: 35,
  fun: 15,
  social: 15,
};
/** Don't start a stopWhen interaction when the need is within this many points of its threshold. */
export const STOP_WHEN_MARGIN = 8;
/** Score that removes a candidate from autonomy (engine drops anything below the idle threshold). */
export const NEVER = -100;

const helpedCache = new WeakMap<InteractionDef, ReadonlySet<NeedId>>();

/** Needs an interaction restores (positive advertise, positive stage needsPerHour, stopWhen needs). */
export function needsHelped(ctx: SimContext, def: InteractionDef): ReadonlySet<NeedId> {
  const cached = helpedCache.get(def);
  if (cached) return cached;
  const out = new Set<NeedId>();
  const isNeed = (k: string): k is NeedId => (NEED_IDS as readonly string[]).includes(k);
  if (def.advertise) for (const [k, v] of Object.entries(def.advertise)) if (isNeed(k) && num(v, 0) > 0) out.add(k);
  let stages: ReturnType<SimContext['content']['stagesOf']> = [];
  try {
    stages = ctx.content.stagesOf(def.id) ?? [];
  } catch {
    stages = def.stages ?? (def.stage ? [def.stage] : []);
  }
  for (const st of stages) {
    if (!st) continue;
    if (st.needsPerHour) for (const [k, v] of Object.entries(st.needsPerHour)) if (isNeed(k) && num(v, 0) > 0) out.add(k);
    if (st.stopWhen && isNeed(st.stopWhen.need)) out.add(st.stopWhen.need);
  }
  helpedCache.set(def, out);
  return out;
}

/**
 * 1 when no pressing need is low; down to DAMP_MIN as the lowest pressing need (that `def` doesn't help) drops;
 * 0 (drop the candidate) once a hard pressing need is at/below its floor.
 */
export function basicNeedDamp(ctx: SimContext, actor: AgentState, def: InteractionDef): number {
  const helps = needsHelped(ctx, def);
  for (const n of helps) {
    const urgent = URGENT_HELP[n];
    if (urgent !== undefined && num(actor.needs?.[n], 100) < urgent) return 1;
  }
  let factor = 1;
  for (const p of PRESSING_NEEDS) {
    if (helps.has(p.need)) continue;
    const v = num(actor.needs?.[p.need], 100);
    if (v >= p.start) continue;
    if (v <= p.full && p.hard) return 0;
    const f = v <= p.full ? DAMP_MIN : DAMP_MIN + ((1 - DAMP_MIN) * (v - p.full)) / (p.start - p.full);
    if (f < factor) factor = f;
  }
  return factor;
}

/** True when every open-ended stage of `def` would stop immediately (its stopWhen need is already ≈ satisfied). */
export function stopWhenSatisfied(ctx: SimContext, actor: AgentState, def: InteractionDef): boolean {
  let stages: ReturnType<SimContext['content']['stagesOf']> = [];
  try {
    stages = ctx.content.stagesOf(def.id) ?? [];
  } catch {
    return false;
  }
  const gated = stages.filter((s) => s && s.stopWhen);
  if (gated.length === 0) return false;
  return gated.every((s) => {
    const sw = s.stopWhen!;
    const cap = sw.need === 'preservation' ? num(actor.vitality, 100) : 100;
    return num(actor.needs?.[sw.need], 0) >= Math.min(cap, num(sw.atLeast, 100)) - STOP_WHEN_MARGIN;
  });
}

/** Standard autonomy filter for hobbies, leisure and chores: skip pointless runs, put pressing needs first. */
export function leisureScore(ctx: SimContext, actor: AgentState, def: InteractionDef, score: number): number {
  if (!Number.isFinite(score)) return NEVER;
  if (stopWhenSatisfied(ctx, actor, def)) return NEVER;
  if (!(score > 0)) return score;
  const f = basicNeedDamp(ctx, actor, def);
  return f > 0 ? score * f : NEVER;
}
