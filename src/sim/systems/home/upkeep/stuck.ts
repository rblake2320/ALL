/**
 * Owner report (W-131 batch 1106): "cleanup sometimes does not execute". Two pieces:
 *
 * 1. EFFECT PROBE — `withEffectProbe(behavior)` wraps a cleaning behaviour. At the run's start it records the target's
 *    mess (`messOf`); when the run ends it compares. A player/system run that COMPLETES without reducing the mess
 *    emits `interactionNoEffect`, and both a no-effect completion and a FAILED run add one to the target's
 *    `cleanFails`. Canceled runs (the player's cancel, pause, a preempting need) never count: a legitimate
 *    interruption is not a stuck mess. Autonomous runs are not counted either (only orders the player gave).
 *
 * 2. CLEAR STUCK MESS — `home_clearStuckMess` appears on a cleanable target only after such a recorded failure
 *    (`cleanFails >= 1`) and only while it is still messy. It is a one-step recovery done where the zombie stands
 *    (no routing: the original failure may have been "Can't get there"), re-checks eligibility when it runs, emits
 *    `stuckMessCleared` BEFORE changing anything (so the report/session log keeps the evidence), then clears that
 *    one target: dirt 0, trash fill 0, spoiled leftovers out, a loose dish/ash removed. Idempotent (a second run finds
 *    nothing to clear and does nothing) and unrewarded: no skill, mood, Bones or quest credit.
 */
import type { InteractionBehavior, SimContext } from '../../../contracts';
import type { ActiveInteraction, AgentState, ObjectState } from '../../../types';
import { DATA } from '../../../content/home/ids';
import { spoiledCount, tossSpoiled } from '../food/leftovers';

export const CLEAN_FAILS = 'cleanFails';
/** Loose mess items: cleaning them removes them. */
const LOOSE_MESS = new Set(['item_dish', 'item_ash']);
const EPS = 1e-6;

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** How much mess the target holds (0 = clean or gone). */
export function messOf(obj: ObjectState | null | undefined): number {
  if (!obj) return 0;
  if (LOOSE_MESS.has(obj.defId)) return 1;
  const dirt = Math.max(0, num((obj as { condition?: { dirt?: unknown } }).condition?.dirt));
  const fill = Math.max(0, num(obj.data?.[DATA.fill]));
  let spoiled = 0;
  try {
    spoiled = spoiledCount(obj);
  } catch {
    spoiled = 0;
  }
  return dirt + fill + spoiled;
}

function targetOf(ctx: SimContext, run: ActiveInteraction): ObjectState | null {
  return run.target.kind === 'object' ? ctx.state.objects[run.target.id] ?? null : null;
}

function bumpFails(obj: ObjectState | null): void {
  if (!obj) return;
  if (!obj.data || typeof obj.data !== 'object') (obj as { data: Record<string, unknown> }).data = {};
  obj.data[CLEAN_FAILS] = Math.min(99, num(obj.data[CLEAN_FAILS]) + 1);
}

export function withEffectProbe(inner: InteractionBehavior): InteractionBehavior {
  return {
    ...inner,
    begin(ctx, actor, run, def) {
      run.data._mess0 = messOf(targetOf(ctx, run));
      return inner.begin ? inner.begin(ctx, actor, run, def) : null;
    },
    end(ctx, actor, run, def, outcome) {
      inner.end?.(ctx, actor, run, def, outcome);
      if (run.source === 'auto' || outcome === 'canceled') return;
      const target = targetOf(ctx, run);
      if (outcome === 'failed') {
        bumpFails(target);
        return;
      }
      const before = num(run.data._mess0, NaN);
      const after = messOf(target);
      if (Number.isFinite(before) && before > EPS && after >= before - EPS) {
        bumpFails(target);
        ctx.emit({ type: 'interactionNoEffect', agentId: actor.id, uid: run.uid, interactionId: run.interactionId, targetId: target ? target.id : null, source: run.source });
      }
    },
  };
}

/** Clear Stuck Mess may be offered: a recorded failure on this target and it is still messy. */
export function stuckEligible(obj: ObjectState | null | undefined): true | string {
  if (!obj) return 'It is gone';
  if (num(obj.data?.[CLEAN_FAILS]) < 1) return 'Try cleaning it first';
  if (messOf(obj) <= EPS) return 'Already clean';
  return true;
}

export const clearStuckBehavior: InteractionBehavior = {
  available(ctx, _actor, _def, target) {
    return stuckEligible(target.kind === 'object' ? ctx.state.objects[target.id] : null);
  },
  end(ctx, actor: AgentState, run, _def, outcome) {
    if (outcome !== 'complete') return;
    const obj = targetOf(ctx, run);
    if (stuckEligible(obj) !== true || !obj) return; // re-checked at the moment of recovery: idempotent
    // the report comes first: the evidence is recorded before the world changes
    ctx.emit({ type: 'stuckMessCleared', agentId: actor.id, uid: run.uid, objectId: obj.id, defId: obj.defId, fails: num(obj.data?.[CLEAN_FAILS]), mess: messOf(obj) });
    if (LOOSE_MESS.has(obj.defId)) {
      ctx.removeObject(obj.id);
      return;
    }
    const cond = (obj as { condition?: { dirt?: number } }).condition;
    if (cond && typeof cond === 'object') cond.dirt = 0;
    if (spoiledCount(obj) > 0) tossSpoiled(ctx, obj); // only the spoiled food: good leftovers stay
    if (obj.data) {
      if (DATA.fill in obj.data) obj.data[DATA.fill] = 0;
      obj.data[CLEAN_FAILS] = 0;
    }
    ctx.markChanged(obj);
  },
};

/** Dirty dishes resting on `surfaceId` (loose items parented to it), in id order. */
export function dishesOn(ctx: SimContext, surfaceId: string): ObjectState[] {
  const out: ObjectState[] = [];
  for (const o of Object.values(ctx.state.objects)) {
    const p = o.placement as { kind?: string; parentId?: string | null };
    if (o.defId === 'item_dish' && p.kind === 'loose' && p.parentId === surfaceId) out.push(o);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Clear the Dishes: offered on a table/counter while dishes sit on it. Running it queues one Clean Up per dish (same
 * source and priority as this order, so they run next, in order); dishes already queued for this zombie are skipped.
 */
export const clearDishesBehavior: InteractionBehavior = {
  available(ctx, _actor, _def, target) {
    if (target.kind !== 'object') return 'No dishes here';
    return dishesOn(ctx, target.id).length > 0 ? true : 'No dishes here';
  },
  label(ctx, _actor, _def, target) {
    const n = target.kind === 'object' ? dishesOn(ctx, target.id).length : 0;
    return n > 1 ? `Clear the Dishes (${n})` : 'Clear the Dish';
  },
  begin(ctx, actor, run) {
    if (run.target.kind !== 'object') return 'No dishes here';
    const dishes = dishesOn(ctx, run.target.id);
    if (dishes.length === 0) return 'No dishes here';
    const already = new Set(actor.queue.filter((q) => q.interactionId === CLEAN_DISH && q.target.kind === 'object').map((q) => (q.target as { id: string }).id));
    for (const d of dishes) {
      if (already.has(d.id)) continue;
      ctx.queue(actor, { interactionId: CLEAN_DISH, target: { kind: 'object', id: d.id }, source: run.source, priority: run.priority });
    }
    return null;
  },
};
const CLEAN_DISH = 'home_cleanDish';
