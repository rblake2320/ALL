/**
 * Breakage & repair. `home_wear` (effectsOnComplete on appliance stages) rolls ObjectDef.breakChance ×
 * trait 'breakChance' on the stage's object when it is breakable, else on the queued target (TV watched from a sofa).
 * Broken → condition.broken, sparks (fx zap), notification. Repair (30 min) fixes it; inexperienced tinkerers may get zapped.
 */
import type { EffectContext, InteractionBehavior, SimContext } from '../../../contracts';
import type { AgentState, ObjectState } from '../../../types';
import { MOOD, STAT } from '../../../content/home/ids';
import { safeSkill } from '../decay/limbs';
import { traitMultSafe } from '../decay/rates';
import { centerOf, defOf, firstName, hasTag, num, objName, queuedObject, runData, sortedObjects } from '../util';

export const ZAP_BASE = 0.15;
export const ZAP_PER_LOGIC = 0.03;

function breakable(ctx: SimContext, obj: ObjectState | null | undefined): obj is ObjectState {
  return !!obj && num(defOf(ctx, obj)?.breakChance, 0) > 0 && !!ctx.state.objects[obj.id];
}

export function breakObject(ctx: SimContext, obj: ObjectState, by?: AgentState | null): boolean {
  if (!ctx.state.objects[obj.id]) return false;
  if (!obj.condition || typeof obj.condition !== 'object') obj.condition = { broken: false, dirt: 0, burning: false, burnMinutes: 0 };
  if (obj.condition.broken) return false;
  obj.condition.broken = true;
  ctx.markChanged(obj);
  const pos = centerOf(ctx, obj);
  ctx.emit({ type: 'fx', kind: 'zap', pos, objectId: obj.id });
  ctx.emit({ type: 'sfx', id: 'zap', pos, objectId: obj.id });
  ctx.stat(STAT.objectsBroken, 1);
  const fridge = hasTag(ctx, obj, 'fridge');
  ctx.notify({
    kind: 'warning',
    title: `The ${objName(ctx, obj)} broke!`,
    text: `${by ? `${firstName(by)} gave it one shake too many. ` : ''}It sparks, it smokes, it sulks.${fridge ? ' Leftovers will spoil twice as fast until it’s fixed.' : ''} Choose Repair on it.`,
    objectId: obj.id,
    agentId: by ? by.id : null,
  });
  return true;
}

/** Effect handler: home_wear. */
export function wearEffect(ctx: SimContext, ec: EffectContext): void {
  const stageObj = ec.targetObject;
  const obj = breakable(ctx, stageObj) ? stageObj : breakable(ctx, queuedObject(ctx, ec.run)) ? queuedObject(ctx, ec.run) : null;
  if (!obj || obj.condition?.broken) return;
  const p = num(defOf(ctx, obj)?.breakChance, 0) * (ec.actor ? traitMultSafe(ctx, ec.actor, 'breakChance') : 1);
  if (p > 0 && ctx.rng.chance(Math.min(1, p))) breakObject(ctx, obj, ec.actor);
}

/** Effect handler: home_breakRandom { tag? } — "the fridge broke" life event. */
export function breakRandomEffect(ctx: SimContext, _ec: EffectContext, params: Record<string, any>): void {
  const tag = typeof params?.tag === 'string' ? params.tag : null;
  const pool = sortedObjects(ctx).filter((o) => breakable(ctx, o) && !o.condition?.broken && o.placement.kind !== 'held' && (!tag || hasTag(ctx, o, tag)));
  if (pool.length === 0) return;
  breakObject(ctx, pool[ctx.rng.int(0, pool.length - 1)], null);
}

export const repairBehavior: InteractionBehavior = {
  startStage(ctx, _actor, run) {
    const obj = queuedObject(ctx, run);
    if (!obj) return 'It’s gone';
    return obj.condition?.broken ? null : 'It isn’t broken';
  },
  completeStage(ctx, actor, run) {
    const obj = queuedObject(ctx, run);
    if (!obj || !obj.condition?.broken) return;
    obj.condition.broken = false;
    ctx.markChanged(obj);
    runData(run).fixed = true;
    ctx.stat(STAT.repairs, 1);
    ctx.stat(STAT.repairs, 1, actor.id);
    const zap = Math.max(0, ZAP_BASE - ZAP_PER_LOGIC * safeSkill(ctx, actor, 'logic'));
    const zapped = ctx.rng.chance(zap);
    if (zapped) {
      ctx.addMoodlet(actor, MOOD.zapped, { sourceId: obj.id });
      ctx.emit({ type: 'fx', kind: 'zap', agentId: actor.id });
      ctx.emit({ type: 'sfx', id: 'zap', agentId: actor.id });
      ctx.emit({ type: 'voice', agentId: actor.id, emotion: 'scream', durationMs: 900 });
    }
    ctx.notify({
      kind: 'good',
      title: 'Fixed!',
      text: zapped
        ? `${firstName(actor)} repaired the ${objName(ctx, obj)} — and got a jolt for their trouble. Hair: vertical.`
        : `${firstName(actor)} repaired the ${objName(ctx, obj)}. A few screws left over, but it works.`,
      agentId: actor.id,
      objectId: obj.id,
    });
  },
};
