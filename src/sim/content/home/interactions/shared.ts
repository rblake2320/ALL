/**
 * Small builders for home interaction definitions — keep the data files readable and the ids type-checked.
 * Engine effect / requirement ids come from src/sim/vocabulary.ts; home ids from ../ids.ts.
 */
import type { EffectRef, RequirementRef, StageDef, StageTarget } from '../../../contracts';
import type { NeedId } from '../../../types';
import { ENGINE_EFFECTS as E, ENGINE_REQUIREMENTS as R } from '../../../vocabulary';
import { EFF, REQ } from '../ids';

/** Open-ended stage duration (stopWhen / behaviour decides when it ends). */
export const OPEN = 1e9;

export const req = {
  power: (): RequirementRef => ({ id: R.power }),
  notBroken: (): RequirementRef => ({ id: R.notBroken }),
  broken: (): RequirementRef => ({ id: R.broken }),
  arms: (min: number): RequirementRef => ({ id: R.arms, params: { min } }),
  legs: (min: number): RequirementRef => ({ id: R.legs, params: { min } }),
  skill: (skill: string, min: number): RequirementRef => ({ id: R.skill, params: { skill, min } }),
  tagOnLot: (tag: string, reason?: string): RequirementRef => ({ id: R.tagOnLot, params: reason ? { tag, reason } : { tag } }),
  household: (): RequirementRef => ({ id: R.household }),
  notCarrying: (): RequirementRef => ({ id: R.notCarrying }),
  notSelf: (): RequirementRef => ({ id: R.notSelf }),
  targetOnLot: (): RequirementRef => ({ id: R.targetOnLot }),
  targetAwake: (): RequirementRef => ({ id: R.targetAwake }),
  needBelow: (need: NeedId, max: number, reason?: string): RequirementRef => ({
    id: R.needBelow,
    params: reason ? { need, max, reason } : { need, max },
  }),
  needAbove: (need: NeedId, min: number, reason?: string): RequirementRef => ({
    id: R.needAbove,
    params: reason ? { need, min, reason } : { need, min },
  }),
  targetData: (params: { key: string; equals?: unknown; min?: number; max?: number; truthy?: boolean; reason?: string }): RequirementRef => ({
    id: R.targetData,
    params,
  }),
  outdoors: (): RequirementRef => ({ id: R.outdoors }),
  indoors: (): RequirementRef => ({ id: R.indoors }),
  home: (id: (typeof REQ)[keyof typeof REQ], params?: Record<string, unknown>): RequirementRef => (params ? { id, params } : { id }),
};

export const eff = {
  needs: (deltas: Partial<Record<NeedId, number>>, who?: 'actor' | 'target'): EffectRef => ({
    id: E.needs,
    params: who ? { deltas, who } : { deltas },
  }),
  moodlet: (id: string, opts?: { who?: 'actor' | 'target' | 'both'; chance?: number }): EffectRef => ({ id: E.moodlet, params: { id, ...(opts ?? {}) } }),
  removeMoodlet: (id: string): EffectRef => ({ id: E.removeMoodlet, params: { id } }),
  sfx: (id: string): EffectRef => ({ id: E.sfx, params: { id } }),
  bubble: (icon: string, style: 'thought' | 'speech' | 'shout' = 'thought'): EffectRef => ({ id: E.bubble, params: { icon, style } }),
  fx: (kind: string, who: 'actor' | 'target' | 'object' = 'actor'): EffectRef => ({ id: E.fx, params: { kind, who } }),
  voice: (emotion: string): EffectRef => ({ id: E.voice, params: { emotion } }),
  carry: (item: string | null): EffectRef => ({ id: E.carry, params: { item } }),
  clearDirt: (): EffectRef => ({ id: E.clearDirt }),
  stat: (key: string, perAgent = false): EffectRef => ({ id: E.stat, params: { key, perAgent } }),
  /** Home wear-and-tear roll on the used appliance. */
  wear: (): EffectRef => ({ id: EFF.wear }),
};

/** Common stage targets. */
export const at = {
  target: (slots?: string[]): StageTarget => (slots ? { kind: 'target', slots } : { kind: 'target' }),
  tag: (tag: string, slots?: string[]): StageTarget => (slots ? { kind: 'nearestTag', tag, slots } : { kind: 'nearestTag', tag }),
  here: (): StageTarget => ({ kind: 'here' }),
  nearTarget: (radius: number): StageTarget => ({ kind: 'tileNear', radius, of: 'target' }),
  nearActor: (radius: number): StageTarget => ({ kind: 'tileNear', radius, of: 'actor' }),
  seatNearActor: (radius: number, preferTable = false): StageTarget => ({ kind: 'seat', radius, near: 'actor', preferTable }),
  seatFacingTarget: (radius: number): StageTarget => ({ kind: 'seat', radius, near: 'target', facingTarget: true }),
  seatNearTarget: (radius: number): StageTarget => ({ kind: 'seat', radius, near: 'target' }),
  agent: (): StageTarget => ({ kind: 'agentAdjacent' }),
};

/** A short "grab it" stage on a loose item's grab slot. */
export function grabStage(extra?: Partial<StageDef>): StageDef {
  return {
    target: at.target(),
    duration: 1,
    anim: 'pickup',
    expression: 'focused',
    power: false,
    ...extra,
  };
}
