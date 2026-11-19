/**
 * `phone` behaviour — every phone_* interaction (5 game minutes, anim 'phone'). def.params.action selects the
 * call: invite | party | pizza | findJob | quitJob | callInSick. Validation happens up front (available/begin)
 * so a doomed call never starts; the action runs at completeStage and reports failures as notifications.
 */
import type { InteractionBehavior, InteractionDef, SimContext } from '../../../contracts';
import type { AgentState, TargetRef } from '../../../types';
import { HOME_SYS, PHONE_IDS } from '../../../content/people/ids';
import { compareIds, firstName, flagNum, fullName, isHousehold, isNum, minutesToTicks, needOf, num, peekRel, setFlag, townies } from '../util';
import { pendingArrival } from './visitorOps';
import { inviteTownie } from './visitors';
import { parseGuestList, partyActive, startParty } from './party';
import { relationshipLabel } from '../social/relations';
import { careersAvailable } from '../careers';
import { callInSick, canCallInSick, joinCareer, quitCareer } from '../careers/shift';
import { careerDefOf } from '../careers/schedule';
import { objectInScope } from '../../home/util';

const PIZZA_PRICE_HINT = 35;
/** Emergency autonomy: a household zombie this hungry orders pizza when the lot has nothing else to eat. */
export const AUTO_PIZZA_HUNGER = 35;
/** No second (autonomous) order while the last one is still on its way / being eaten. */
export const PIZZA_REORDER_COOLDOWN_MIN = 180;
export const PIZZA_ORDER_FLAG = 'pizza:lastOrder';

/**
 * Is there anything to eat on the lot? A working, powered fridge (jerky, leftovers, cooking) or microwave
 * (burritos), or a meal / pizza item with servings that hasn't spoiled. Burning or carried objects don't count.
 */
export function foodOnLot(ctx: SimContext): boolean {
  for (const id of Object.keys(ctx.state.objects)) {
    const o = ctx.state.objects[id];
    if (!o || !objectInScope(ctx, o) || o.condition?.burning || o.placement?.kind === 'held') continue;
    let tags: string[] = [];
    try {
      tags = ctx.objectDef(o).tags ?? [];
    } catch {
      continue;
    }
    if (tags.includes('meal')) {
      const servings = o.data?.servings;
      const left = servings === undefined || servings === null || num(servings, 0) > 0;
      if (left && o.data?.spoiled !== true) return true;
      continue;
    }
    if ((tags.includes('fridge') || tags.includes('microwave')) && !o.condition?.broken) {
      let on = true;
      try {
        on = ctx.powered(o);
      } catch {
        on = false;
      }
      if (on) return true;
    }
  }
  return false;
}

/**
 * Autonomy gate for Order Brain Pizza (advertised as a meal, so feral/hungry zombies consider it): only when the
 * zombie is hungry, the household can pay, no order went out recently and there is truly nothing else to eat (the
 * kitchen burned down, the power is cut, the fridge broke). Every other phone call stays player-driven.
 */
export function autoPizzaScore(ctx: SimContext, actor: AgentState, score: number): number {
  if (!isNum(score) || score <= 0) return 0;
  if (!isHousehold(ctx, actor) || actor.presence !== 'onLot') return 0;
  if (needOf(actor, 'hunger') > AUTO_PIZZA_HUNGER && !actor.status?.feral) return 0;
  if (num(ctx.state.household?.funds, 0) < PIZZA_PRICE_HINT) return 0;
  if (ctx.state.tick - flagNum(ctx, PIZZA_ORDER_FLAG, -1e12) < minutesToTicks(PIZZA_REORDER_COOLDOWN_MIN)) return 0;
  if (typeof ctx.sys(HOME_SYS.food).orderPizza !== 'function') return 0;
  if (foodOnLot(ctx)) return 0;
  return score;
}

/**
 * The engine's autonomy only gathers object/agent interactions, so the emergency pizza (a `self` phone call) is
 * offered through the townies system's autonomyCandidates whenever its gate is open.
 */
export function pizzaCandidate(ctx: SimContext, actor: AgentState): { interactionId: string; target: { kind: 'self' } } | null {
  if (!ctx.content.interactions[PHONE_IDS.orderPizza]) return null;
  return autoPizzaScore(ctx, actor, 1) > 0 ? { interactionId: PHONE_IDS.orderPizza, target: { kind: 'self' } } : null;
}

function actionOf(def: InteractionDef): string {
  return typeof def.params?.action === 'string' ? def.params.action : '';
}

/** Everyone in the phone book: acquaintances first (best friends on top), then strangers (a cold call). */
function invitable(ctx: SimContext, actor: AgentState): AgentState[] {
  const score = (t: AgentState) => {
    const r = peekRel(ctx, actor.id, t.id);
    return (r.met ? 1000 : 0) + num(r.friendship, 0);
  };
  return townies(ctx)
    .filter((t) => t.presence !== 'gone')
    .sort((a, b) => score(b) - score(a) || compareIds(a.id, b.id));
}

function townieReason(ctx: SimContext, t: AgentState): true | string {
  if (t.presence === 'onLot') return 'Already here';
  if (t.presence !== 'offLot') return 'Unavailable';
  if (pendingArrival(ctx, t.id)) return 'On the way';
  return true;
}

function check(ctx: SimContext, actor: AgentState, def: InteractionDef, params: Record<string, unknown>): true | string {
  switch (actionOf(def)) {
    case 'invite': {
      if (typeof params.townieId === 'string') {
        const t = ctx.agent(params.townieId);
        if (!t || t.role !== 'townie') return 'They don’t live in Wormwood Heights';
        return townieReason(ctx, t);
      }
      const list = invitable(ctx, actor);
      if (list.length === 0) return 'The phone book is empty';
      return list.some((t) => townieReason(ctx, t) === true) ? true : 'Everyone in town is busy';
    }
    case 'party':
      if (partyActive(ctx)) return 'A party is already in full swing';
      return true;
    case 'pizza': {
      const api = ctx.sys(HOME_SYS.food);
      return typeof api.orderPizza === 'function' ? true : 'Nobody delivers out here';
    }
    case 'findJob':
      if (careerDefOf(ctx, actor.career)) return 'Already employed';
      if (typeof params.careerId === 'string' && !ctx.content.careers[params.careerId]) return 'No such job';
      return true;
    case 'quitJob':
      return careerDefOf(ctx, actor.career) ? true : 'Not employed';
    case 'callInSick':
      return canCallInSick(ctx, actor);
    default:
      return 'Wrong number';
  }
}

function report(ctx: SimContext, actor: AgentState, what: string, r: unknown, quiet = false): void {
  if (r === true || r === undefined || r === null || quiet) return;
  ctx.notify({ kind: 'bad', title: `${firstName(actor)} couldn’t ${what}`, text: typeof r === 'string' && r ? r : 'The line went dead.', agentId: actor.id });
}

export const phoneBehavior: InteractionBehavior = {
  // W-116: the emergency pizza is a purchase (the household's autonomous-purchase allowance applies)
  autoCost(_ctx, _actor, def) {
    return actionOf(def) === 'pizza' ? PIZZA_PRICE_HINT : 0;
  },
  available(ctx, actor, def) {
    return check(ctx, actor, def, {});
  },
  begin(ctx, actor, run, def) {
    const r = check(ctx, actor, def, run.params ?? {});
    if (r !== true) return r;
    if (actionOf(def) === 'invite' && typeof run.params.townieId !== 'string') return 'Pick someone to invite';
    if (actionOf(def) === 'findJob' && typeof run.params.careerId !== 'string') return 'Pick a job';
    return null;
  },
  completeStage(ctx, actor, run, def) {
    if (run.data.done === true) return;
    run.data.done = true;
    const params = run.params ?? {};
    switch (actionOf(def)) {
      case 'invite':
        report(ctx, actor, 'invite anyone over', inviteTownie(ctx, actor.id, params.townieId));
        break;
      case 'party':
        report(ctx, actor, 'throw a party', startParty(ctx, actor.id, parseGuestList(params.guests)));
        break;
      case 'pizza': {
        const api = ctx.sys(HOME_SYS.food);
        let r: unknown = 'Nobody delivers out here';
        try {
          if (typeof api.orderPizza === 'function') r = api.orderPizza(actor.id, run.source === 'auto');
        } catch {
          r = 'The pizza place hung up';
        }
        if (r === true) setFlag(ctx, PIZZA_ORDER_FLAG, ctx.state.tick);
        // An autonomous emergency order that HOME refuses (one already on its way, broke) fails quietly.
        report(ctx, actor, 'order a pizza', r, run.source === 'auto');
        break;
      }
      case 'findJob':
        report(ctx, actor, 'get that job', joinCareer(ctx, actor.id, String(params.careerId ?? '')));
        break;
      case 'quitJob':
        report(ctx, actor, 'quit', quitCareer(ctx, actor.id));
        break;
      case 'callInSick':
        report(ctx, actor, 'call in sick', callInSick(ctx, actor.id));
        break;
      default:
        break;
    }
  },
  label(_ctx, _actor, def) {
    return actionOf(def) === 'pizza' ? `${def.label} ($${PIZZA_PRICE_HINT})` : def.label;
  },
  adjustScore(ctx, actor, def, _target, score) {
    // Only the emergency pizza is ever autonomous; any other phone call that reaches autonomy is vetoed.
    return actionOf(def) === 'pizza' ? autoPizzaScore(ctx, actor, score) : 0;
  },
  choices(ctx, actor, def, _target: TargetRef) {
    const a = actionOf(def);
    if (a === 'invite') {
      return invitable(ctx, actor).map((t) => ({
        label: `${fullName(t)} (${peekRel(ctx, actor.id, t.id).met ? relationshipLabel(peekRel(ctx, actor.id, t.id)) : 'stranger — cold call'})`,
        params: { townieId: t.id },
        available: townieReason(ctx, t),
        cost: null,
        icon: 'phone' as const,
      }));
    }
    if (a === 'findJob') {
      return careersAvailable(ctx).map((c) => ({
        label: `${c.name}: ${c.startTitle} ($${c.wage}/h · ${c.schedule})`,
        params: { careerId: c.id },
        available: true as const,
        cost: null,
        icon: c.icon,
      }));
    }
    return [];
  },
};

/** Exposed for the TowniesApi / tests. */
export function phoneCheck(ctx: SimContext, actor: AgentState, def: InteractionDef, params: Record<string, unknown> = {}): true | string {
  return check(ctx, actor, def, params);
}

