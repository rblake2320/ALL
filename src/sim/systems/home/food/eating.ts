/**
 * Eating (GDD §5). One `eat` behaviour drives Have a Serving (meal/pizza item), Eat Leftovers (fridge),
 * Microwave a Brain Burrito and Grab Brain Jerky (snack):
 *   hunger per serving = recipe.hunger × (0.8 + 0.1 × quality)  (spoiled: halved), applied gradually while eating;
 *   quality ≥ 5 → Delicious Meal; quality ≤ 1 → Ate Something Questionable (Brain Jerky is quality 1, so it counts);
 *   no seat → eat standing (anim standEat, Ate Standing Up); eating near other eaters → social +4/h each and
 *   Family Dinner when 2+ household members share the table; spoiled → 60% Food Poisoning × trait 'spoilSick';
 *   Gourmands get +10 fun/h while eating. A dirty dish is left on the table (or the floor).
 * Also: Put Away Leftovers, Throw Away (meals, limbs), Toss Spoiled Leftovers.
 */
import type { InteractionBehavior, InteractionDef, SimContext } from '../../../contracts';
import type { ActiveInteraction, AgentState, ObjectState } from '../../../types';
import { BEH, DATA, ITEM, MOOD, RECIPE, STAT } from '../../../content/home/ids';
import { limbData } from '../decay/limbs';
import { traitMultSafe } from '../decay/rates';
import { leisureScore, NEVER } from '../autonomy';
import { floorPointNear } from '../services';
import {
  bubble,
  clamp,
  dataNum,
  defOf,
  dist,
  getObj,
  hasTag,
  interactionDef,
  isMember,
  num,
  onLotAgents,
  queuedObject,
  runData,
  runSlotKind,
  safeDt,
  sortedObjects,
  setData,
  stageObject,
  str,
  targetObject,
} from '../util';
import { recipeOf } from './cooking';
import {
  addLeftovers,
  bestFridgeRoom,
  freshFoodAvailable,
  isSpoiledEntry,
  LEFTOVER_SPOIL_MIN,
  leftoverCount,
  mealSpoiled,
  readLeftovers,
  takeServing,
  tossSpoiled,
} from './leftovers';

export const COMPANY_RADIUS = 2.6;
export const COMPANY_SOCIAL_PER_HOUR = 4;
export const GOURMAND_FUN_PER_HOUR = 10;
export const POISON_CHANCE = 0.6;

type EatMode = 'item' | 'leftovers' | 'recipe' | 'snack';

function eatMode(def: InteractionDef): EatMode {
  const m = str(def.params?.mode, 'item');
  return m === 'leftovers' || m === 'recipe' || m === 'snack' ? m : 'item';
}

function lastStageIndex(ctx: SimContext, def: InteractionDef): number {
  return Math.max(0, ctx.content.stagesOf(def.id).length - 1);
}

export function hungerFor(recipeId: string, quality: number, spoiled: boolean): number {
  const r = recipeOf(recipeId);
  const base = r ? r.hunger : 40;
  const h = base * (0.8 + 0.1 * clamp(quality, 1, 6));
  return spoiled ? h / 2 : h;
}

function serve(d: Record<string, string | number | boolean | null>, recipeId: string, quality: number, spoiled: boolean): void {
  d.served = true;
  d.recipe = recipeId;
  d.quality = clamp(Math.round(quality), 1, 6);
  d.spoiled = spoiled;
  d.hungerTotal = hungerFor(recipeId, quality, spoiled);
  d.applied = 0;
}

/** Someone is in the eating stage of an eat run (the plate is in front of them). */
function isEatingNow(ctx: SimContext, a: AgentState): boolean {
  const run = a.active;
  if (!run || run.phase !== 'run') return false;
  const def = interactionDef(ctx, run.interactionId);
  if (!def || def.behavior !== BEH.eat) return false;
  const d = runData(run);
  return d.served === true && d.eating === true;
}

function companions(ctx: SimContext, actor: AgentState): AgentState[] {
  return onLotAgents(ctx).filter((o) => o.id !== actor.id && isEatingNow(ctx, o) && dist(o.pos, actor.pos) <= COMPANY_RADIUS);
}

/** The table/desk/counter in front of a seat pose (0.8 tiles ahead), if any. */
function tableInFront(ctx: SimContext, actor: AgentState): ObjectState | null {
  const f = num(actor.facing, 0);
  const p = { x: actor.pos.x + Math.sin(f) * 0.8, z: actor.pos.z + Math.cos(f) * 0.8 };
  let ids: string[] = [];
  try {
    const t = ctx.spatial.tileOf(p);
    ids = ctx.spatial.objectsAt(t.x, t.z) ?? [];
  } catch {
    ids = [];
  }
  for (const id of ids) {
    const o = getObj(ctx, id);
    const def = defOf(ctx, o);
    if (o && def && (def.tags.includes('table') || def.tags.includes('desk') || def.tags.includes('surface'))) return o;
  }
  return null;
}

function leaveDish(ctx: SimContext, actor: AgentState, d: Record<string, string | number | boolean | null>): ObjectState | null {
  const data = { [DATA.createdTick]: ctx.state.tick };
  const table = getObj(ctx, d.tableId);
  if (!d.standing && table) {
    const dish = ctx.placeItemNear(ITEM.dish, actor.pos, { data, preferSurfaceOf: table.id, surfaceOnly: true });
    if (dish) return dish;
  }
  const p = floorPointNear(ctx, actor.pos);
  try {
    return ctx.spawnObject(ITEM.dish, { kind: 'loose', x: p.x, z: p.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 }, { data });
  } catch {
    return null;
  }
}

export const eatBehavior: InteractionBehavior = {
  begin(ctx, _actor, run, def) {
    const mode = eatMode(def);
    if (mode === 'item') {
      const meal = queuedObject(ctx, run);
      if (!meal || dataNum(meal, DATA.servings, 0) < 1) return 'All gone';
    } else if (mode === 'leftovers') {
      if (leftoverCount(queuedObject(ctx, run)) < 1) return 'The fridge is empty';
    } else if (!recipeOf(def.params?.recipe)) {
      return 'Nothing to eat';
    }
    return null;
  },
  startStage(ctx, actor, run, def, stage) {
    const d = runData(run);
    const mode = eatMode(def);
    const last = stage >= lastStageIndex(ctx, def);
    if (!last) {
      if (mode === 'item' && dataNum(queuedObject(ctx, run), DATA.servings, 0) < 1) return 'All gone';
      if (mode === 'leftovers' && leftoverCount(queuedObject(ctx, run)) < 1) return 'The fridge is empty';
      return null;
    }
    if (mode === 'snack') {
      const id = str(def.params?.recipe, RECIPE.brainJerky);
      serve(d, id, recipeOf(id)?.baseQuality ?? 1, false);
      d.standing = false;
    } else {
      d.standing = runSlotKind(ctx, run) !== 'sit';
      const table = d.standing ? null : tableInFront(ctx, actor);
      d.tableId = table ? table.id : null;
    }
    if (!d.served) return 'Nothing on the plate';
    d.eating = true;
    d.eatMin = Math.max(1, num(run.duration, 20));
    return null;
  },
  completeStage(ctx, actor, run, def, stage) {
    const d = runData(run);
    const mode = eatMode(def);
    if (stage >= lastStageIndex(ctx, def) || d.served) return;
    if (mode === 'item') {
      const meal = queuedObject(ctx, run);
      const left = dataNum(meal, DATA.servings, 0);
      if (!meal || left < 1) return;
      setData(ctx, meal, DATA.servings, left - 1);
      serve(d, str(meal.data?.[DATA.recipeId], RECIPE.brainLoaf), dataNum(meal, DATA.quality, 2), mealSpoiled(meal));
      d.mealId = meal.id;
    } else if (mode === 'leftovers') {
      const fridge = queuedObject(ctx, run);
      const s = fridge ? takeServing(ctx, fridge) : null;
      if (s) serve(d, s.r, s.q, isSpoiledEntry(s));
    } else if (mode === 'recipe') {
      const id = str(def.params?.recipe, RECIPE.brainBurrito);
      serve(d, id, recipeOf(id)?.baseQuality ?? 2, false);
    }
    if (d.served && mode !== 'snack') actor.carrying = 'plate';
  },
  tick(ctx, actor, run, def, dt) {
    const d = runData(run);
    if (!d.eating || !d.served) return;
    const m = safeDt(dt);
    if (d.standing && eatMode(def) !== 'snack' && actor.anim !== 'standEat') actor.anim = 'standEat';
    const total = num(d.hungerTotal, 0);
    const applied = num(d.applied, 0);
    const give = Math.min(Math.max(0, total - applied), (total / Math.max(1, num(d.eatMin, 20))) * m);
    if (give > 0) {
      ctx.changeNeed(actor, 'hunger', give);
      d.applied = applied + give;
    }
    if (ctx.hasTrait(actor, 'gourmand')) ctx.changeNeed(actor, 'fun', (GOURMAND_FUN_PER_HOUR * m) / 60);
    const others = companions(ctx, actor);
    if (others.length > 0) {
      ctx.changeNeed(actor, 'social', (COMPANY_SOCIAL_PER_HOUR * m) / 60);
      d.company = true;
      if (!d.standing && isMember(ctx, actor) && others.some((o) => isMember(ctx, o) && runData(o.active!).standing !== true)) d.family = true;
    }
  },
  end(ctx, actor, run, def, outcome) {
    const d = runData(run);
    const mode = eatMode(def);
    if (!d.served) return;
    const total = num(d.hungerTotal, 0);
    if (outcome === 'complete') {
      const rest = total - num(d.applied, 0);
      if (rest > 0) ctx.changeNeed(actor, 'hunger', rest);
      d.applied = total;
    }
    const ateEnough = outcome === 'complete' || (total > 0 && num(d.applied, 0) / total >= 0.5);
    if (ateEnough) {
      const q = num(d.quality, 2);
      if (q >= 5) ctx.addMoodlet(actor, MOOD.deliciousMeal);
      else if (q <= 1) ctx.addMoodlet(actor, MOOD.questionableMeal); // GDD §5 — Brain Jerky (q1) included
      if (d.standing && mode !== 'snack') ctx.addMoodlet(actor, MOOD.ateStandingUp);
      if (d.family) ctx.addMoodlet(actor, MOOD.familyDinner);
      if (d.spoiled) {
        const p = POISON_CHANCE * traitMultSafe(ctx, actor, 'spoilSick');
        if (ctx.rng.chance(p)) {
          ctx.addMoodlet(actor, MOOD.foodPoisoning);
          bubble(ctx, actor, 'disgusted', 'shout', false);
          ctx.emit({ type: 'voice', agentId: actor.id, emotion: 'disgusted', durationMs: 1400 });
        }
      }
      ctx.stat(STAT.mealsEaten, 1);
      ctx.stat(STAT.mealsEaten, 1, actor.id);
    }
    if (mode !== 'snack') leaveDish(ctx, actor, d);
  },
  label(ctx, _actor, def, target) {
    if (eatMode(def) !== 'leftovers') return def.label;
    const n = leftoverCount(targetObject(ctx, target));
    return n > 0 ? `${def.label} (${n})` : def.label;
  },
  adjustScore(ctx, actor, def, target, score) {
    const mode = eatMode(def);
    const obj = targetObject(ctx, target);
    const hunger = num(actor.needs?.hunger, 100);
    // Not hungry: a Gourmand's +10 "eat" bonus used to empty the fridge (and $5 jerky) at hunger 94.
    if (hunger >= (mode === 'snack' ? SNACK_WHEN_HUNGER_BELOW : EAT_WHEN_HUNGER_BELOW)) return NEVER;
    if (mode === 'snack') {
      // A snack is a stopgap: worse when real food is out or the zombie is properly hungry.
      let s = score;
      if (freshFoodAvailable(ctx)) s *= 0.4;
      if (hunger < 30) s *= 0.7;
      return s;
    }
    if (mode === 'item' && obj) {
      if (mealSpoiled(obj)) return score * (ctx.hasTrait(actor, 'slob') ? 0.6 : 0.15);
      if (dataNum(obj, DATA.quality, 2) >= 5) return score + 4;
    }
    if (mode === 'leftovers' && obj) {
      const list = readLeftovers(obj);
      if (list.length > 0 && list.every(isSpoiledEntry)) return score * 0.2;
    }
    return score;
  },
};

/** Autonomy eats (meals, leftovers, burritos) only below this hunger; snacks (jerky) below the lower one. */
export const EAT_WHEN_HUNGER_BELOW = 65;
export const SNACK_WHEN_HUNGER_BELOW = 55;

// ─────────────────────────────── leftovers & disposal ───────────────────────────────

function heldBy(actor: AgentState, obj: ObjectState | null): boolean {
  return !!obj && obj.placement.kind === 'held' && obj.placement.agentId === actor.id;
}

function releaseOrRemove(ctx: SimContext, actor: AgentState, obj: ObjectState | null, how: 'destroy' | 'floor' | 'surface'): void {
  if (!obj || !ctx.state.objects[obj.id]) return;
  if (heldBy(actor, obj)) ctx.releaseHeld(actor, how);
  else if (how === 'destroy') ctx.removeObject(obj.id);
}

function pickUpQueued(ctx: SimContext, actor: AgentState, run: ActiveInteraction): ObjectState | null {
  const obj = queuedObject(ctx, run);
  if (obj && obj.placement.kind === 'loose') ctx.holdItem(actor, obj);
  return obj;
}

export const putAwayLeftoversBehavior: InteractionBehavior = {
  startStage(ctx, actor, run, def, stage) {
    if (stage < lastStageIndex(ctx, def)) return null;
    const fridge = stageObject(ctx, run);
    if (!fridge || !hasTag(ctx, fridge, 'fridge')) return 'Needs a fridge';
    const meal = queuedObject(ctx, run);
    const s = dataNum(meal, DATA.servings, 0);
    if (s < 1) return 'Nothing left to save';
    const cap = num(defOf(ctx, fridge)?.params?.capacity, 30);
    if (leftoverCount(fridge) + s > cap) return 'The fridge is full';
    return null;
  },
  completeStage(ctx, actor, run, def, stage) {
    const d = runData(run);
    if (stage < lastStageIndex(ctx, def)) {
      pickUpQueued(ctx, actor, run);
      return;
    }
    const meal = queuedObject(ctx, run);
    const fridge = stageObject(ctx, run);
    if (!meal || !fridge) return;
    const res = addLeftovers(ctx, fridge, {
      s: Math.floor(dataNum(meal, DATA.servings, 0)),
      q: dataNum(meal, DATA.quality, 2),
      r: str(meal.data?.[DATA.recipeId], RECIPE.brainLoaf),
      a: mealSpoiled(meal) ? LEFTOVER_SPOIL_MIN : dataNum(meal, DATA.ageMin, 0),
    });
    if (res === true) d.stored = true;
    else d.storeFail = res;
  },
  end(ctx, actor, run) {
    const d = runData(run);
    const meal = queuedObject(ctx, run);
    if (d.stored) releaseOrRemove(ctx, actor, meal, 'destroy');
    else if (heldBy(actor, meal)) ctx.releaseHeld(actor, 'surface');
    if (typeof d.storeFail === 'string') ctx.notify({ kind: 'info', title: 'Couldn’t store leftovers', text: d.storeFail, agentId: actor.id });
  },
  available(ctx, _actor, _def, target) {
    // Every fridge is packed (or the meal won't fit): say so in the menu instead of failing at the fridge door.
    const meal = targetObject(ctx, target);
    const s = Math.max(1, Math.floor(dataNum(meal, DATA.servings, 0)));
    return bestFridgeRoom(ctx, (o) => hasTag(ctx, o, 'fridge')) >= s ? true : 'The fridge is full';
  },
  adjustScore(ctx, actor, def, target, score) {
    const meal = targetObject(ctx, target);
    if (!meal || mealSpoiled(meal)) return NEVER;
    return dataNum(meal, DATA.ageMin, 0) >= 45 ? leisureScore(ctx, actor, def, score + 6) : NEVER;
  },
};

export const throwAwayBehavior: InteractionBehavior = {
  completeStage(ctx, actor, run, def, stage) {
    const d = runData(run);
    if (stage < lastStageIndex(ctx, def)) {
      pickUpQueued(ctx, actor, run);
      return;
    }
    d.tossed = true;
    const trash = stageObject(ctx, run);
    if (trash && hasTag(ctx, trash, 'trash')) setData(ctx, trash, DATA.fill, dataNum(trash, DATA.fill, 0) + 1);
  },
  end(ctx, actor, run) {
    const d = runData(run);
    const obj = queuedObject(ctx, run);
    if (d.tossed) releaseOrRemove(ctx, actor, obj, 'destroy');
    else if (heldBy(actor, obj)) ctx.releaseHeld(actor, 'floor');
  },
  adjustScore(ctx, actor, def, target, score) {
    const obj = targetObject(ctx, target);
    if (!obj) return score;
    if (obj.defId === ITEM.meal || obj.defId === ITEM.pizza) return mealSpoiled(obj) ? leisureScore(ctx, actor, def, score + 8) : NEVER;
    const limb = limbData(ctx, obj);
    if (limb) return limb.rotten ? leisureScore(ctx, actor, def, score + 5) : NEVER;
    return leisureScore(ctx, actor, def, score);
  },
};

export const cleanFridgeBehavior: InteractionBehavior = {
  adjustScore(ctx, actor, def, _target, score) {
    return leisureScore(ctx, actor, def, score);
  },
  completeStage(ctx, actor, run) {
    const fridge = queuedObject(ctx, run);
    if (!fridge) return;
    const n = tossSpoiled(ctx, fridge);
    if (n > 0) {
      bubble(ctx, actor, 'disgusted', 'thought', false);
      if (ctx.hasTrait(actor, 'neatFreak')) ctx.addMoodlet(actor, MOOD.spotless);
    }
  },
};

/** GDD §3 need-decay difficulty multipliers (the engine applies the same preset to its base decay). */
export const NEED_DIFFICULTY: Record<string, number> = { relaxed: 0.7, normal: 1, grim: 1.3 };
export const BASE_HUNGER_DECAY_PER_HOUR = 5.5;

/** Food poisoning: hunger drains 50% faster (GDD §5 "hunger decay ×1.5") — +½ of the engine's base 5.5/h × difficulty. */
export function tickFoodPoisoning(ctx: SimContext, agent: AgentState, dt: number): void {
  if (agent.presence !== 'onLot' || !ctx.hasMoodlet(agent, MOOD.foodPoisoning)) return;
  const diff = NEED_DIFFICULTY[String(ctx.state.settings?.difficulty)] ?? 1;
  ctx.changeNeed(agent, 'hunger', -(BASE_HUNGER_DECAY_PER_HOUR * 0.5 * diff * dt) / 60);
}

/** Empty platters nobody is still eating from get cleared away. */
export function sweepEmptyMeals(ctx: SimContext): void {
  for (const o of sortedObjects(ctx)) {
    if (!o || (o.defId !== ITEM.meal && o.defId !== ITEM.pizza)) continue;
    if (o.placement.kind === 'held' || dataNum(o, DATA.servings, 0) >= 1) continue;
    const used = Object.values(ctx.state.agents).some(
      (a) => a?.active && ((a.active.target.kind === 'object' && a.active.target.id === o.id) || (a.active.stageTarget?.kind === 'object' && a.active.stageTarget.id === o.id)),
    );
    if (!used) ctx.removeObject(o.id, 'All eaten');
  }
}
