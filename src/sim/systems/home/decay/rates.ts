/**
 * Preservation model (GDD §4). The engine never decays preservation — this module owns it.
 *
 * decay/h = (1.3 + 0.6·[hygiene<20] + 1.0·[hunger<10])
 *           × sleep multiplier (bed param sleepDecayMult: coffins 0 = halted, beds/plots/floor/naps 0.5)
 *           × 1.5 while running a 'strenuous' interaction (dance, work out)
 *           × 1.2 outdoors in daytime sun
 *           × difficulty (relaxed 0.6 / normal 1 / grim 1.4) × trait mult 'decay' (Well Preserved 0.7)
 * Restores applied here (power-aware): powered refrigerated coffins/cryo add params.preservationPerHour while asleep.
 */
import type { SimContext } from '../../../contracts';
import type { AgentState, ObjectState } from '../../../types';
import { homeFreshnessPerHourAsleep } from '../../../engine/homeBonus';
import { fireDrainPerHour } from '../upkeep/fire';
import { clamp, defOf, isAsleep, isIndoorAt, isNum, isStrenuous, isZombie, num, runData, stageObject } from '../util';

export const PRES_BASE_PER_HOUR = 1.3;
export const PRES_LOW_HYGIENE = 20;
export const PRES_LOW_HYGIENE_EXTRA = 0.6;
export const PRES_LOW_HUNGER = 10;
export const PRES_LOW_HUNGER_EXTRA = 1.0;
export const PRES_STRENUOUS_MULT = 1.5;
export const PRES_SUN_MULT = 1.2;
export const PRES_DEFAULT_SLEEP_MULT = 0.5;
export const PRES_DIFFICULTY: Record<string, number> = { relaxed: 0.6, normal: 1, grim: 1.4 };

export const VITALITY_MIN = 20;
export const VITALITY_MAX = 100;
export const VITALITY_DAILY_LOSS = 0.6;
export const VITALITY_NEGLECT_PER_HOUR = 0.25;
export const VITALITY_NEGLECT_BELOW = 15;

export interface SleepInfo {
  asleep: boolean;
  bed: ObjectState | null;
  decayMult: number;
  restorePerHour: number;
}

const AWAKE: SleepInfo = { asleep: false, bed: null, decayMult: 1, restorePerHour: 0 };

/** Sleep state: which bed (if any), its decay multiplier, and its powered preservation restore. */
export function sleepInfo(ctx: SimContext, agent: AgentState): SleepInfo {
  if (agent.presence !== 'onLot' || !isAsleep(ctx, agent)) return AWAKE;
  const bed = agent.status?.passedOut ? null : stageObject(ctx, agent.active);
  const def = defOf(ctx, bed);
  if (!bed || !def || !def.tags.includes('bed')) return { asleep: true, bed: null, decayMult: PRES_DEFAULT_SLEEP_MULT, restorePerHour: 0 };
  const decayMult = clamp(num(def.params?.sleepDecayMult, PRES_DEFAULT_SLEEP_MULT), 0, 1);
  let restore = Math.max(0, num(def.params?.preservationPerHour, 0));
  if (restore > 0 && def.needsPower && !safePowered(ctx, bed)) restore = 0;
  // the home's LIFE bonus: extra Freshness per hour asleep in a bed (furniture sets), never a fight stat
  restore += homeFreshnessPerHourAsleep(ctx.state);
  return { asleep: true, bed, decayMult, restorePerHour: restore };
}

export function safePowered(ctx: SimContext, obj: ObjectState | null): boolean {
  try {
    return !!ctx.powered(obj);
  } catch {
    return !!ctx.state.household?.utilitiesOn;
  }
}

export function difficultyMult(ctx: SimContext): number {
  return PRES_DIFFICULTY[String(ctx.state.settings?.difficulty)] ?? 1;
}

/** Preservation lost per hour right now (>= 0). Agents that are neither on the lot nor at work don't decay. */
export function preservationDecayPerHour(ctx: SimContext, agent: AgentState | null | undefined): number {
  if (!agent || !isZombie(agent)) return 0;
  if (agent.presence !== 'onLot' && agent.presence !== 'atWork') return 0;
  const needs = agent.needs ?? ({} as AgentState['needs']);
  let rate = PRES_BASE_PER_HOUR;
  if (num(needs.hygiene, 50) < PRES_LOW_HYGIENE) rate += PRES_LOW_HYGIENE_EXTRA;
  if (num(needs.hunger, 50) < PRES_LOW_HUNGER) rate += PRES_LOW_HUNGER_EXTRA;
  if (agent.presence === 'onLot') {
    const s = sleepInfo(ctx, agent);
    if (s.asleep) rate *= s.decayMult;
    if (isStrenuous(ctx, agent)) rate *= PRES_STRENUOUS_MULT;
    if (!ctx.time.isNight && !isIndoorAt(ctx, agent.pos)) rate *= PRES_SUN_MULT;
  }
  rate *= difficultyMult(ctx);
  rate *= traitMultSafe(ctx, agent, 'decay');
  return isNum(rate) && rate > 0 ? rate : 0;
}

export function traitMultSafe(ctx: SimContext, agent: AgentState, key: string): number {
  try {
    const m = ctx.traitMult(agent, key);
    return isNum(m) && m >= 0 ? m : 1;
  } catch {
    return 1;
  }
}

/** Gains applied by home behaviours each tick (embalming), stored on the run for the trend view. */
function behaviourGainPerHour(agent: AgentState, ctx: SimContext): number {
  let gain = 0;
  const run = agent.active;
  if (run && run.phase === 'run') gain += Math.max(0, num(runData(run).presGainPerHour, 0));
  // Being embalmed by a partner: the embalmer's run carries the rate.
  if (run && run.phase === 'run' && typeof run.params?.partnerOf === 'string') {
    const partner = ctx.state.agents[run.params.partnerOf];
    if (partner?.active && partner.active.phase === 'run') gain += Math.max(0, num(runData(partner.active).partnerGainPerHour, 0));
  }
  return gain;
}

/**
 * Net preservation change per hour from the decay system's point of view (decay, powered bed restore, fire
 * drain, embalming applied by home behaviours). The engine adds the active stage's needsPerHour on top.
 */
export function preservationPerHour(ctx: SimContext, agent: AgentState | null | undefined): number {
  if (!agent || !isZombie(agent)) return 0;
  let net = -preservationDecayPerHour(ctx, agent);
  if (agent.presence === 'onLot') {
    net += sleepInfo(ctx, agent).restorePerHour;
    net -= fireDrainPerHour(ctx, agent);
    net += behaviourGainPerHour(agent, ctx);
  }
  const r = Math.round(net * 100) / 100;
  return r === 0 ? 0 : r; // never -0 in views
}

/** Clamp vitality to [20, 100] and preservation to [0, vitality]; repairs NaN. */
export function sanitizeVitals(agent: AgentState): void {
  if (!agent.needs || typeof agent.needs !== 'object') return;
  const vit = clamp(num(agent.vitality, VITALITY_MAX), VITALITY_MIN, VITALITY_MAX);
  agent.vitality = vit;
  const p = agent.needs.preservation;
  agent.needs.preservation = isNum(p) ? clamp(p, 0, vit) : Math.min(50, vit);
}

export function setVitality(agent: AgentState, value: number): void {
  agent.vitality = clamp(num(value, num(agent.vitality, VITALITY_MAX)), VITALITY_MIN, VITALITY_MAX);
  if (agent.needs && isNum(agent.needs.preservation) && agent.needs.preservation > agent.vitality) agent.needs.preservation = agent.vitality;
}

/** Renderer decay level 0..1: freshness loss with a blotch curve, plus a little for eroded vitality. */
export function decayLevel(agent: AgentState | null | undefined): number {
  if (!agent) return 0;
  if (agent.presence === 'crumbled' || agent.presence === 'gone') return 1;
  const pres = clamp(num(agent.needs?.preservation, 100), 0, 100);
  const vit = clamp(num(agent.vitality, 100), 0, 100);
  const loss = 1 - pres / 100;
  // Blotches appear late: ease-in on freshness loss, a 15% floor from eroded vitality.
  const level = Math.pow(loss, 1.25) * 0.88 + (1 - vit / 100) * 0.15;
  return clamp(Math.round(level * 1000) / 1000, 0, 1);
}
