/**
 * Social success chance — GDD §9:
 *   base + 0.03 × charisma + (actorMood + targetMood)/400 + friendship/400 + trait bonuses
 *   − 0.25 if actor hygiene < 15 (unless target Slob) − 0.2 if target mood band miserable; clamp 0.05..0.95.
 * Trait bonuses: actor TraitDef.socialBonus (Silver Tongue .15, Social Butterfly .10) plus per-interaction
 * params 'actorTrait.<id>' / 'targetTrait.<id>' (Grumpy/Hothead mean +.15/+.20, Cheerful jokes +.15,
 * Grumpy joke targets −.25, Vain compliment targets +.20).
 * A def with baseChance ≥ 1 (Welcome In) always succeeds.
 */
import type { InteractionDef, SimContext } from '../../../contracts';
import type { AgentState } from '../../../types';
import { clamp, hasTrait, isNum, needOf, num, peekRel, safeMood, safeSkill, traitDefsOf } from '../util';

export const CHANCE_MIN = 0.05;
export const CHANCE_MAX = 0.95;
export const LOW_HYGIENE = 15;
export const MISERABLE_MOOD = -50;

export interface ChanceBreakdown {
  chance: number;
  parts: { label: string; value: number }[];
}

export function successChance(ctx: SimContext, actor: AgentState, target: AgentState, def: InteractionDef): ChanceBreakdown {
  const s = def.social;
  const base = clamp(num(s?.baseChance, 0.5), 0, 1);
  if (base >= 1) return { chance: 1, parts: [{ label: 'Sure thing', value: 1 }] };

  const parts: { label: string; value: number }[] = [{ label: 'Base', value: base }];
  const charisma = safeSkill(ctx, actor, 'charisma');
  parts.push({ label: 'Charisma', value: 0.03 * charisma });
  parts.push({ label: 'Moods', value: (safeMood(ctx, actor) + safeMood(ctx, target)) / 400 });
  const rel = peekRel(ctx, actor.id, target.id);
  parts.push({ label: 'Relationship', value: clamp(num(rel.friendship, 0), -100, 100) / 400 });

  let traitBonus = 0;
  for (const t of traitDefsOf(ctx, actor)) if (isNum(t.socialBonus)) traitBonus += t.socialBonus;
  const params = def.params ?? {};
  for (const key of Object.keys(params)) {
    const v = params[key];
    if (!isNum(v)) continue;
    if (key.startsWith('actorTrait.') && hasTrait(ctx, actor, key.slice('actorTrait.'.length))) traitBonus += v;
    else if (key.startsWith('targetTrait.') && hasTrait(ctx, target, key.slice('targetTrait.'.length))) traitBonus += v;
  }
  if (traitBonus) parts.push({ label: 'Traits', value: traitBonus });

  if (needOf(actor, 'hygiene') < LOW_HYGIENE && !hasTrait(ctx, target, 'slob')) parts.push({ label: 'The smell', value: -0.25 });
  if (safeMood(ctx, target) <= MISERABLE_MOOD) parts.push({ label: 'Target is miserable', value: -0.2 });

  let total = 0;
  for (const p of parts) total += num(p.value, 0);
  return { chance: clamp(total, CHANCE_MIN, CHANCE_MAX), parts };
}
