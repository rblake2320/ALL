/**
 * Autonomy repetition penalty (backlog #13, README §10).
 *
 * Every COMPLETED run of an interaction that autonomy could pick is remembered per zombie for REPEAT_WINDOW_MIN
 * game minutes in `state.flags['engine:done:<agentId>']` = "interactionId@tick;…" (WorldState only — save/load and
 * lockstep determinism hold; pruned hourly). With n = completions of the same interaction id within the window:
 *   essentials (eat / cook / sleep / nap / hygiene / preservation / bills / firefighting / repairs / limbs /
 *   mess-gated cleaning, or anything promising ≥ 5 of a basic need):   score × REPEAT_FACTOR_ESSENTIAL ^ n
 *   everything else:   needPart × REPEAT_FACTOR_ESSENTIAL ^ n  +  positiveBonus × REPEAT_FACTOR ^ n
 * where needPart is the Σ need-gain term and positiveBonus the adBonus + capped trait/tag bonuses (negative bonuses
 * — vetoes, mean-social reluctance — are never softened by repetition). Spam is driven by flat desirability at
 * satisfied needs (a Hothead slamming a door ~250×/day at Amusement 99), and that part fades fast; a bored worker's
 * third TV session of the evening is a real need and stays available (with the plain 0.6^n on the whole score, 4-day
 * probes had a day-job worker below Amusement 15 in 29 % of their on-lot hours — 0–1 % with this split).
 * Critical overrides (feral, exhaustion) ignore it.
 */
import type { InteractionDef } from '../contracts';
import type { AgentState, NeedId } from '../types';
import { TICK_MINUTES } from '../types';
import { timeInfo } from '../time';
import { advertiseOf } from './autonomy';
import type { Engine } from './types';
import { isNum } from './util';

export const REPEAT_WINDOW_MIN = 6 * 60;
export const REPEAT_FACTOR = 0.6;
export const REPEAT_FACTOR_ESSENTIAL = 0.85;
/** Newest entries kept per zombie (a 6-hour window rarely holds more than ~30 completions). */
export const REPEAT_HISTORY_MAX = 48;
export const REPEAT_FLAG_PREFIX = 'engine:done:';
/**
 * Daily cap (GDD §14 "no action spam"): autonomy picks a NON-essential interaction id (socials pooled over all
 * partners) at most DAILY_PICK_CAP times per game day. The 6-hour penalty above fades, so a well-liked social could
 * still come back every ~3 h all day long (7 jokes in a day at Amusement 76–93, skeptic seed 2009). Picks, not
 * completions, are counted, so interrupted runs count too. `flags['engine:picks:<agentId>'] = "<day>|id=n;id=n"`.
 */
export const DAILY_PICK_CAP = 6;
export const PICKS_FLAG_PREFIX = 'engine:picks:';

/**
 * Interaction tags that mark needs-driven essentials or must-do chores. `clean` chores are mess-gated (every run
 * needs an actual dirty dish / ash pile / full bin / grimy surface), so they cannot loop on their own — penalising them
 * like hobbies would only let the mess pile up (GDD §5: "Neat Freak autonomy loves this").
 */
export const ESSENTIAL_TAGS: ReadonlySet<string> = new Set(['eat', 'cook', 'snack', 'sleep', 'nap', 'hygiene', 'preserve', 'embalm', 'money', 'fire', 'repair', 'limb', 'reanimate', 'clean']);
/** Basic needs: an interaction promising at least ESSENTIAL_MIN_AD of one of them is essential too. */
export const ESSENTIAL_NEEDS: readonly NeedId[] = ['hunger', 'energy', 'hygiene', 'preservation'];
export const ESSENTIAL_MIN_AD = 5;

const essentialCache = new WeakMap<InteractionDef, boolean>();

export function isEssentialInteraction(eng: Engine, def: InteractionDef): boolean {
  const hit = essentialCache.get(def);
  if (hit !== undefined) return hit;
  let yes = Array.isArray(def.tags) && def.tags.some((t) => ESSENTIAL_TAGS.has(t));
  if (!yes) {
    const ad = advertiseOf(eng, def, null);
    yes = ESSENTIAL_NEEDS.some((n) => isNum(ad[n]) && ad[n]! >= ESSENTIAL_MIN_AD);
  }
  essentialCache.set(def, yes);
  return yes;
}

/** Interactions autonomy could ever pick (the only ones worth remembering). */
function tracked(def: InteractionDef): boolean {
  if (def.autonomous === false) return false;
  return !(def.hidden && def.autonomous !== true);
}

const windowTicks = (): number => Math.round(REPEAT_WINDOW_MIN / TICK_MINUTES);

/** Parse a history flag (junk entries are skipped, never thrown on). */
function parse(raw: unknown): { id: string; tick: number }[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  const out: { id: string; tick: number }[] = [];
  for (const part of raw.split(';')) {
    const at = part.lastIndexOf('@');
    if (at <= 0) continue;
    const digits = part.slice(at + 1);
    if (!/^\d{1,15}$/.test(digits)) continue; // ticks are non-negative integers ('', 'NaN', '1e9', '-5' are junk)
    out.push({ id: part.slice(0, at), tick: Number(digits) });
  }
  return out;
}

function write(eng: Engine, key: string, list: { id: string; tick: number }[]): void {
  if (list.length === 0) delete eng.state.flags[key];
  else eng.state.flags[key] = list.map((e) => `${e.id}@${e.tick}`).join(';');
}

/** finishRun(complete) hook: remember the completion (bounded, window-pruned). Never throws. */
export function recordCompletion(eng: Engine, agent: AgentState, def: InteractionDef | undefined): void {
  if (!def || !tracked(def) || typeof agent.id !== 'string') return;
  const flags = eng.state.flags;
  if (!flags || typeof flags !== 'object') return;
  const key = REPEAT_FLAG_PREFIX + agent.id;
  const since = eng.state.tick - windowTicks();
  const list = parse(flags[key]).filter((e) => e.tick > since && e.tick <= eng.state.tick);
  list.push({ id: def.id, tick: eng.state.tick });
  write(eng, key, list.slice(-REPEAT_HISTORY_MAX));
}

/** Completions per interaction id within the window (once per autonomy pick). */
export function recentCompletions(eng: Engine, agent: AgentState): Map<string, number> {
  const out = new Map<string, number>();
  const flags = eng.state.flags;
  if (!flags || typeof flags !== 'object') return out;
  const since = eng.state.tick - windowTicks();
  for (const e of parse(flags[REPEAT_FLAG_PREFIX + agent.id])) {
    if (e.tick > since && e.tick <= eng.state.tick) out.set(e.id, (out.get(e.id) ?? 0) + 1);
  }
  return out;
}

/** Factors for a candidate's need part and positive-bonus part (1 / 1 when it was not done recently). */
export function repetitionFactors(eng: Engine, def: InteractionDef, recent: ReadonlyMap<string, number>): { need: number; bonus: number } {
  const n = recent.get(def.id) ?? 0;
  if (n <= 0) return { need: 1, bonus: 1 };
  const mild = Math.pow(REPEAT_FACTOR_ESSENTIAL, n);
  return { need: mild, bonus: isEssentialInteraction(eng, def) ? mild : Math.pow(REPEAT_FACTOR, n) };
}

/** Repetition-adjusted score from its parts (see the module doc); negative bonuses pass through unchanged. */
export function applyRepetition(needPart: number, bonus: number, f: { need: number; bonus: number }): number {
  return needPart * f.need + (bonus > 0 ? bonus * f.bonus : bonus);
}

/** Factor on the bonus part (the strong one for non-essentials) — kept for callers that score a single number. */
export function repetitionFactor(eng: Engine, def: InteractionDef, recent: ReadonlyMap<string, number>): number {
  return repetitionFactors(eng, def, recent).bonus;
}

function parsePicks(raw: unknown, day: number): Map<string, number> {
  const out = new Map<string, number>();
  if (typeof raw !== 'string') return out;
  const bar = raw.indexOf('|');
  if (bar <= 0 || raw.slice(0, bar) !== String(day)) return out; // another day (or junk): nothing picked today
  for (const part of raw.slice(bar + 1).split(';')) {
    const eq = part.lastIndexOf('=');
    if (eq <= 0) continue;
    const n = Number(part.slice(eq + 1));
    if (Number.isInteger(n) && n > 0 && n < 1e6) out.set(part.slice(0, eq), n);
  }
  return out;
}

/** Today's autonomous picks per non-essential interaction id (once per autonomy pick). */
export function picksToday(eng: Engine, agent: AgentState): Map<string, number> {
  const flags = eng.state.flags;
  if (!flags || typeof flags !== 'object') return new Map();
  return parsePicks(flags[PICKS_FLAG_PREFIX + agent.id], timeInfo(eng.state.tick).day);
}

/** True when autonomy may not pick this interaction again today (essentials are never capped). */
export function overDailyCap(eng: Engine, def: InteractionDef, today: ReadonlyMap<string, number>): boolean {
  return (today.get(def.id) ?? 0) >= DAILY_PICK_CAP && !isEssentialInteraction(eng, def);
}

/** Autonomy queued a pick: count it (non-essential, trackable interactions only). Never throws. */
export function recordPick(eng: Engine, agent: AgentState, def: InteractionDef | undefined): void {
  if (!def || !tracked(def) || typeof agent.id !== 'string' || isEssentialInteraction(eng, def)) return;
  const flags = eng.state.flags;
  if (!flags || typeof flags !== 'object') return;
  const day = timeInfo(eng.state.tick).day;
  const m = parsePicks(flags[PICKS_FLAG_PREFIX + agent.id], day);
  m.set(def.id, (m.get(def.id) ?? 0) + 1);
  flags[PICKS_FLAG_PREFIX + agent.id] = `${day}|${[...m].map(([k, v]) => `${k}=${v}`).join(';')}`;
}

/** Hourly housekeeping: drop expired entries / histories of agents that no longer exist. */
export function pruneRepetition(eng: Engine): void {
  const flags = eng.state.flags;
  if (!flags || typeof flags !== 'object') return;
  const since = eng.state.tick - windowTicks();
  const day = timeInfo(eng.state.tick).day;
  for (const key of Object.keys(flags)) {
    if (key.startsWith(PICKS_FLAG_PREFIX)) {
      // a previous day's (or junk) tally is dead weight in the save
      if (!eng.state.agents[key.slice(PICKS_FLAG_PREFIX.length)] || parsePicks(flags[key], day).size === 0) delete flags[key];
      continue;
    }
    if (!key.startsWith(REPEAT_FLAG_PREFIX)) continue;
    const id = key.slice(REPEAT_FLAG_PREFIX.length);
    if (!eng.state.agents[id]) {
      delete flags[key];
      continue;
    }
    const list = parse(flags[key]);
    const kept = list.filter((e) => e.tick > since && e.tick <= eng.state.tick);
    if (kept.length !== list.length || typeof flags[key] !== 'string') write(eng, key, kept);
  }
}
