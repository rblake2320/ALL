/**
 * Cooking (GDD §5): Cook… on a fridge or a stove. Stage 0 at a fridge ("get ingredients", 2 min) charges the recipe
 * cost (idempotent key `cook:<uid>`); stage 1 at a stove cooks for recipe.cookMinutes (×1.35 one-armed).
 * Quality = clamp(base + floor(cooking/3) − 1 + stove qualityBonus, 1, 6). Fire chance per cook =
 * max(0, 3% − 1%·cooking) × stove fireMult × trait 'fireChance' × (greasy stove ×1.5). The finished meal lands on
 * the nearest free surface near the stove (else the floor); the cook then serves themselves and calls the family.
 */
import { autoAllowance } from '../../../../shared/autoBuy';
import type { InteractionBehavior, RecipeDef, SimContext } from '../../../contracts';
import type { AgentState, ObjectState } from '../../../types';
import { BEH, COOKABLE_RECIPES, DATA, ITEM, IX, STAT } from '../../../content/home/ids';
import { RECIPES_BY_ID } from '../../../content/home/recipes';
import { armCount, ONE_ARM_SLOWDOWN, safeSkill } from '../decay/limbs';
import { safePowered, traitMultSafe } from '../decay/rates';
import { NEVER } from '../autonomy';
import { startFire } from '../upkeep/fire';
import {
  bubble,
  centerOf,
  clamp,
  dataNum,
  firstName,
  getObj,
  hasTag,
  isAsleep,
  isMember,
  isNum,
  members,
  moneyLabel,
  num,
  objParam,
  objectsWithTag,
  queuedObject,
  runData,
  runKeyUid,
  stageObject,
  str,
  targetObject,
} from '../util';
import { freshFoodAvailable } from './leftovers';

export const BASE_FIRE_CHANCE = 0.03; // balance pass: was 0.06, then 0.04 (≈ one fire per 5 household-days with 3 zombies; docs/BALANCE.md §5.4)
export const FIRE_CHANCE_PER_LEVEL = 0.01;
export const GREASY_STOVE_DIRT = 0.6;
export const STOVE_DIRT_PER_COOK = 0.15;

export function recipeOf(id: unknown): RecipeDef | null {
  return typeof id === 'string' ? RECIPES_BY_ID[id] ?? null : null;
}

export function mealQuality(ctx: SimContext, cook: AgentState, recipe: RecipeDef, stove: ObjectState | null): number {
  const cooking = safeSkill(ctx, cook, 'cooking');
  const bonus = stove ? objParam(ctx, stove, 'qualityBonus', 0) : 0;
  return clamp(Math.round(recipe.baseQuality + Math.floor(cooking / 3) - 1 + bonus), 1, 6);
}

export function fireChance(ctx: SimContext, cook: AgentState, stove: ObjectState | null): number {
  const cooking = safeSkill(ctx, cook, 'cooking');
  let p = Math.max(0, BASE_FIRE_CHANCE - FIRE_CHANCE_PER_LEVEL * cooking);
  if (stove) {
    p *= Math.max(0, objParam(ctx, stove, 'fireMult', 1));
    if (num(stove.condition?.dirt, 0) >= GREASY_STOVE_DIRT) p *= 1.5;
  }
  p *= traitMultSafe(ctx, cook, 'fireChance');
  return clamp(isNum(p) ? p : 0, 0, 1);
}

/** Is a usable (non-broken, non-burning) object with this tag on the lot? */
function tagUsable(ctx: SimContext, tag: string): boolean {
  return objectsWithTag(ctx, tag).some((o) => o.placement.kind !== 'held' && !o.condition?.broken && !o.condition?.burning);
}

export function canCook(ctx: SimContext, actor: AgentState, recipe: RecipeDef, fridge: ObjectState | null): true | string {
  if (safeSkill(ctx, actor, 'cooking') < recipe.minCooking) return `Needs Cooking ${recipe.minCooking}`;
  if (recipe.requiresTag) {
    const ok = fridge ? hasTag(ctx, fridge, recipe.requiresTag) : tagUsable(ctx, recipe.requiresTag);
    if (!ok) return recipe.requiresTag === 'cryoFridge' ? 'Needs a Cryo-Fridge' : `Needs a ${recipe.requiresTag}`;
  }
  if (num(ctx.state.household?.funds, 0) < recipe.cost) return `Can’t afford (${moneyLabel(recipe.cost)})`;
  return true;
}

/** Autonomy pick: the best dish the zombie can make without blowing more than ~3% of the household funds. */
export function autoRecipe(ctx: SimContext, actor: AgentState, fridge: ObjectState | null, maxCost = Infinity): string | null {
  const funds = num(ctx.state.household?.funds, 0);
  // maxCost: an autonomous cook stays within the household's autonomous-purchase allowance (W-116)
  const ok = COOKABLE_RECIPES.map((id) => RECIPES_BY_ID[id]).filter((r): r is RecipeDef => !!r && r.cost <= maxCost && canCook(ctx, actor, r, fridge) === true);
  if (ok.length === 0) return null;
  const budget = Math.max(12, funds * 0.03);
  const within = ok.filter((r) => r.cost <= budget).sort((a, b) => b.baseQuality - a.baseQuality || a.cost - b.cost);
  if (within.length > 0) return within[0].id;
  return ok.slice().sort((a, b) => a.cost - b.cost)[0].id;
}

function variantFridge(ctx: SimContext, def: { params?: Record<string, unknown> }, target: ObjectState | null): ObjectState | null {
  return def.params?.variant === 'fridge' ? target : null;
}

/** Ask idle hungry housemates to the table. */
function callFamily(ctx: SimContext, cook: AgentState, meal: ObjectState): void {
  let seats = Math.max(0, dataNum(meal, DATA.servings, 0) - 1);
  for (const m of members(ctx)) {
    if (seats <= 0) break;
    if (m.id === cook.id || m.presence !== 'onLot' || isAsleep(ctx, m)) continue;
    if (num(m.needs?.hunger, 100) >= 70) continue;
    let busy = true;
    try {
      busy = ctx.isBusy(m);
    } catch {
      busy = true;
    }
    if (busy) continue;
    if (ctx.queue(m, { interactionId: IX.haveServing, target: { kind: 'object', id: meal.id }, source: 'auto' })) seats--;
  }
}

/**
 * Cook… from the fridge needs a stove that works *now*: without this check a power cut (or a broken stove) made
 * zombies loop "walk to fridge → pay → walk to stove → fail → refund" every few minutes.
 */
export function stoveReason(ctx: SimContext): true | string {
  const stoves = objectsWithTag(ctx, 'stove').filter((o) => o.placement?.kind !== 'held' && !o.condition?.burning);
  if (stoves.length === 0) return 'Needs a stove';
  const working = stoves.filter((o) => !o.condition?.broken);
  if (working.length === 0) return 'The stove is broken';
  if (!working.some((o) => safePowered(ctx, o))) return 'The power is out';
  return true;
}

export const cookBehavior: InteractionBehavior = {
  // W-116: groceries are a purchase — the cheapest recipe this cook could make (or the one asked for)
  autoCost(ctx, actor, def, target, params) {
    const asked = recipeOf(str(params?.recipe, ''));
    if (asked) return asked.cost;
    const fridge = variantFridge(ctx, def, targetObject(ctx, target));
    let best = Infinity;
    for (const id of COOKABLE_RECIPES) {
      const r = RECIPES_BY_ID[id];
      if (r && r.cost < best && canCook(ctx, actor, r, fridge) === true) best = r.cost;
    }
    return Number.isFinite(best) ? best : 0;
  },
  available(ctx, _actor, def) {
    return def.params?.variant === 'fridge' ? stoveReason(ctx) : true;
  },
  choices(ctx, actor, def, target) {
    const fridge = variantFridge(ctx, def, targetObject(ctx, target));
    return COOKABLE_RECIPES.map((id) => RECIPES_BY_ID[id])
      .filter((r): r is RecipeDef => !!r)
      .map((r) => ({ label: r.name, params: { recipe: r.id }, available: canCook(ctx, actor, r, fridge), cost: r.cost, icon: 'plate' as const }));
  },
  begin(ctx, actor, run, def) {
    const fridge = variantFridge(ctx, def, queuedObject(ctx, run));
    let id = str(run.params?.recipe, '');
    if (!recipeOf(id)) id = autoRecipe(ctx, actor, fridge, run.source === 'auto' ? autoAllowance(ctx.state) : Infinity) ?? '';
    const recipe = recipeOf(id);
    if (!recipe) return 'Can’t afford any groceries';
    const ok = canCook(ctx, actor, recipe, fridge);
    if (ok !== true) return ok;
    runData(run).recipe = recipe.id;
    return null;
  },
  startStage(ctx, actor, run, _def, stage) {
    const d = runData(run);
    const recipe = recipeOf(d.recipe);
    if (!recipe) return 'Forgot what they were making';
    if (stage === 0) {
      const fridge = stageObject(ctx, run);
      if (recipe.requiresTag && !hasTag(ctx, fridge, recipe.requiresTag)) {
        return recipe.requiresTag === 'cryoFridge' ? `${recipe.name} needs a Cryo-Fridge` : `Needs a ${recipe.requiresTag}`;
      }
      if (!ctx.spend(recipe.cost, `Groceries: ${recipe.name}`, `cook:${runKeyUid(run)}`, { autonomous: run.source === 'auto' })) return `Can’t afford ${recipe.name} (${moneyLabel(recipe.cost)})`;
      d.paid = true;
      return null;
    }
    if (!d.paid) return 'No ingredients';
    let dur = Math.max(1, recipe.cookMinutes);
    if (armCount(ctx, actor) === 1) dur *= ONE_ARM_SLOWDOWN;
    run.duration = dur;
    const stove = stageObject(ctx, run);
    d.stoveId = stove ? stove.id : null;
    d.cooking = true;
    if (ctx.rng.chance(fireChance(ctx, actor, stove))) {
      d.fireAt = Math.max(1, Math.round(dur * (0.3 + 0.6 * ctx.rng.next())));
    }
    return null;
  },
  tick(ctx, actor, run) {
    const d = runData(run);
    if (run.stage !== 1 || !isNum(d.fireAt) || d.fired) return;
    if (num(run.elapsed, 0) < d.fireAt) return;
    d.fired = true;
    const stove = getObj(ctx, d.stoveId);
    startFire(ctx, stove, stove ? undefined : { at: { x: actor.pos.x, z: actor.pos.z } });
    bubble(ctx, actor, 'fire', 'shout', false);
    return 'done';
  },
  completeStage(ctx, actor, run, _def, stage) {
    if (stage !== 1) return;
    const d = runData(run);
    const recipe = recipeOf(d.recipe);
    const stove = getObj(ctx, d.stoveId) ?? stageObject(ctx, run);
    if (!recipe) return;
    if (d.fired) {
      ctx.notify({
        kind: 'bad',
        title: 'Kitchen fire!',
        text: `${firstName(actor)}’s ${recipe.name} went up in flames. The smoke alarm would be screaming, if anyone had installed one.`,
        agentId: actor.id,
      });
      return;
    }
    const quality = mealQuality(ctx, actor, recipe, stove);
    const near = stove ? centerOf(ctx, stove) : { x: actor.pos.x, z: actor.pos.z };
    const meal = ctx.placeItemNear(ITEM.meal, near, {
      data: {
        [DATA.servings]: recipe.servings,
        [DATA.quality]: quality,
        [DATA.recipeId]: recipe.id,
        [DATA.mealName]: recipe.name,
        [DATA.createdTick]: ctx.state.tick,
        [DATA.ageMin]: 0,
        [DATA.spoiled]: false,
        [DATA.cookId]: actor.id,
      },
    });
    if (stove) {
      if (!stove.condition) stove.condition = { broken: false, dirt: 0, burning: false, burnMinutes: 0 };
      stove.condition.dirt = clamp(num(stove.condition.dirt, 0) + STOVE_DIRT_PER_COOK, 0, 1);
      ctx.markChanged(stove);
    }
    ctx.stat(STAT.mealsCooked, 1);
    ctx.stat(STAT.mealsCooked, 1, actor.id);
    if (!meal) return;
    d.mealId = meal.id;
    bubble(ctx, actor, 'plate', 'thought', true);
    if (isMember(ctx, actor)) {
      ctx.queue(actor, { interactionId: IX.haveServing, target: { kind: 'object', id: meal.id }, source: run.source, front: true });
      callFamily(ctx, actor, meal);
    }
  },
  end(ctx, actor, run, _def, outcome) {
    const d = runData(run);
    // Paid but never reached the hob — failed (stove broke / power cut / no path) or really canceled (player cancel,
    // preempted auto run): the groceries go back. A *suspension* (social respond, critical override) re-queues a copy
    // that reuses the paid key before ending this run; that copy will cook, so it is not refunded.
    if (!d.paid || d.cooking || outcome === 'complete') return;
    if (outcome === 'canceled' && resumesLater(actor, runKeyUid(run))) return;
    const recipe = recipeOf(d.recipe);
    if (recipe && recipe.cost > 0) ctx.earn(recipe.cost, `Groceries returned: ${recipe.name}`, `cookRefund:${runKeyUid(run)}`);
  },
  adjustScore(ctx, actor, _def, _target, score) {
    if (num(ctx.state.household?.funds, 0) < 12) return NEVER;
    // One pot at a time: a housemate is already cooking — wait for the call to dinner.
    if (someoneElseCooking(ctx, actor)) return NEVER;
    // Food already out or fresh leftovers in a fridge? Eat that first (a Gourmand's +20 used to re-cook all day).
    if (freshFoodAvailable(ctx)) return NEVER;
    // Nobody on the lot is peckish yet.
    if (hungriestAtHome(ctx, actor) >= COOK_WHEN_HUNGER_BELOW) return NEVER;
    return score;
  },
};

/** A suspended run's re-queued copy (same idempotency uid) is waiting in the actor's queue. */
function resumesLater(actor: AgentState, keyUid: number): boolean {
  return Array.isArray(actor.queue) && actor.queue.some((q) => !!q && num(q.params?._origUid, q.uid) === keyUid);
}

/** Autonomy only cooks when someone at home (the cook included) has hunger below this. */
export const COOK_WHEN_HUNGER_BELOW = 60;

function isCookRun(ctx: SimContext, a: AgentState): boolean {
  const run = a.active;
  if (!run) return false;
  const def = ctx.content.interactions[run.interactionId];
  return !!def && def.behavior === BEH.cook;
}

/** Another on-lot zombie is running (or has queued) a cook interaction. */
export function someoneElseCooking(ctx: SimContext, actor: AgentState): boolean {
  for (const a of Object.values(ctx.state.agents)) {
    if (!a || a.id === actor.id || a.presence !== 'onLot') continue;
    if (isCookRun(ctx, a)) return true;
    if (Array.isArray(a.queue) && a.queue.some((q) => !!q && ctx.content.interactions[q.interactionId]?.behavior === BEH.cook)) return true;
  }
  return false;
}

/** Lowest hunger among on-lot household members (and the actor). */
export function hungriestAtHome(ctx: SimContext, actor: AgentState): number {
  let low = num(actor.needs?.hunger, 100);
  for (const m of members(ctx)) if (m.presence === 'onLot') low = Math.min(low, num(m.needs?.hunger, 100));
  return low;
}
