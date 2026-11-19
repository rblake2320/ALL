/**
 * Pizza delivery (GDD §5/§11). FoodApi.orderPizza(agentId) charges $35 (idempotent per order) and schedules a
 * Pizza Delivery Ghoul 50–70 game minutes later. The ghoul (people's townies.createService('pizza'), else our own
 * service agent) walks to the mailbox / front door, leaves an item_pizza (surface if any), and leaves.
 * State lives in WorldState.flags (survives save/load); a watchdog delivers directly if the ghoul gets stuck.
 */
import type { InteractionBehavior, SimContext } from '../../../contracts';
import type { AgentState, Vec2 } from '../../../types';
import { DATA, FLAG, ITEM, IX, RECIPE, STAT } from '../../../content/home/ids';
import { RECIPES_BY_ID } from '../../../content/home/recipes';
import { createServiceAgent, floorPointNear, frontSpot, walkableTileNear } from '../services';
import { clearFlag, firstName, flagNum, flagStr, getAgent, isMember, isNum, minutesSince, moneyLabel, num, setFlag } from '../util';

export const PIZZA_COST = RECIPES_BY_ID[RECIPE.brainPizza]?.cost ?? 35;
export const PIZZA_MIN_DELAY = 50;
export const PIZZA_MAX_DELAY = 70;
export const PIZZA_WATCHDOG_MIN = 120;
const ORDER_COUNT_FLAG = 'home.pizza.count';

export function pizzaPending(ctx: SimContext): boolean {
  return isNum(ctx.state.flags?.[FLAG.pizzaDue]) || flagStr(ctx, FLAG.pizzaNpc, '') !== '';
}

export function orderPizza(ctx: SimContext, agentId: unknown, autonomous = false): true | string {
  const agent = getAgent(ctx, agentId);
  if (!agent) return 'Nobody to place the order';
  if (!isMember(ctx, agent)) return 'Only the household can order pizza';
  if (ctx.state.gameOver) return 'Nobody left to eat it';
  if (pizzaPending(ctx)) return 'A pizza is already on its way';
  const n = flagNum(ctx, ORDER_COUNT_FLAG, 0) + 1;
  if (!ctx.spend(PIZZA_COST, 'Brain Pizza delivery', `pizza:${n}`, { autonomous })) return `Not enough money (${moneyLabel(PIZZA_COST)})`;
  setFlag(ctx, ORDER_COUNT_FLAG, n);
  const delayMin = ctx.rng.int(PIZZA_MIN_DELAY, PIZZA_MAX_DELAY);
  setFlag(ctx, FLAG.pizzaDue, ctx.state.tick + Math.round(delayMin / 0.25));
  setFlag(ctx, FLAG.pizzaBy, agent.id);
  ctx.stat(STAT.pizzasOrdered, 1);
  ctx.notify({
    kind: 'money',
    title: 'Pizza ordered',
    text: `${firstName(agent)} ordered a Brain Pizza (${moneyLabel(PIZZA_COST)}). The Pizza Delivery Ghoul will shamble over in about an hour.`,
    agentId: agent.id,
  });
  return true;
}

function finish(ctx: SimContext): void {
  clearFlag(ctx, FLAG.pizzaDue);
  clearFlag(ctx, FLAG.pizzaNpc);
  clearFlag(ctx, FLAG.pizzaSpawned);
  clearFlag(ctx, FLAG.pizzaDelivered);
  clearFlag(ctx, FLAG.pizzaBy);
}

/** Put the pizza down near `near` (surface if one is within 3 tiles). Idempotent per order. */
export function deliverPizzaItem(ctx: SimContext, near: Vec2): boolean {
  if (ctx.state.flags?.[FLAG.pizzaDelivered] === true) return true;
  const data = {
    [DATA.servings]: RECIPES_BY_ID[RECIPE.brainPizza]?.servings ?? 6,
    [DATA.quality]: RECIPES_BY_ID[RECIPE.brainPizza]?.baseQuality ?? 3,
    [DATA.recipeId]: RECIPE.brainPizza,
    [DATA.mealName]: 'Brain Pizza',
    [DATA.createdTick]: ctx.state.tick,
    [DATA.ageMin]: 0,
    [DATA.spoiled]: false,
  };
  let item = ctx.placeItemNear(ITEM.pizza, near, { data });
  if (!item) {
    const p = floorPointNear(ctx, near);
    try {
      item = ctx.spawnObject(ITEM.pizza, { kind: 'loose', x: p.x, z: p.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 }, { data });
    } catch {
      item = null;
    }
  }
  if (!item) return false;
  setFlag(ctx, FLAG.pizzaDelivered, true);
  const by = getAgent(ctx, flagStr(ctx, FLAG.pizzaBy, ''));
  ctx.emit({ type: 'sfx', id: 'doorbell', pos: near });
  ctx.notify({
    kind: 'good',
    title: 'Pizza’s here!',
    text: 'A Brain Pizza (6 slices) is waiting by the front door. Still lukewarm, as tradition demands.',
    agentId: by ? by.id : null,
    objectId: item.id,
  });
  return true;
}

function dispatchGhoul(ctx: SimContext): void {
  const npc = createServiceAgent(ctx, 'pizza');
  const spot = frontSpot(ctx);
  if (!npc) {
    deliverPizzaItem(ctx, spot);
    finish(ctx);
    return;
  }
  try {
    ctx.spawnAgent(npc.id);
  } catch {
    /* handled below */
  }
  if (npc.presence !== 'onLot') {
    deliverPizzaItem(ctx, spot);
    finish(ctx);
    return;
  }
  npc.carrying = 'pizza';
  const tile = walkableTileNear(ctx, spot, 4);
  const q = ctx.queue(npc, {
    interactionId: IX.deliverPizza,
    target: tile ? { kind: 'tile', x: tile.x, z: tile.z } : { kind: 'self' },
    source: 'system',
  });
  if (!q) {
    deliverPizzaItem(ctx, spot);
    try {
      ctx.despawnAgent(npc.id, 'gone');
    } catch {
      /* ignore */
    }
    finish(ctx);
    return;
  }
  clearFlag(ctx, FLAG.pizzaDue);
  setFlag(ctx, FLAG.pizzaNpc, npc.id);
  setFlag(ctx, FLAG.pizzaSpawned, ctx.state.tick);
  ctx.emit({ type: 'sfx', id: 'pizzaArrive', agentId: npc.id });
}

function isBusyWith(npc: AgentState, interactionId: string): boolean {
  return (!!npc.active && npc.active.interactionId === interactionId) || (Array.isArray(npc.queue) && npc.queue.some((q) => q.interactionId === interactionId));
}

/** Per-tick delivery state machine. */
export function tickPizza(ctx: SimContext): void {
  const npcId = flagStr(ctx, FLAG.pizzaNpc, '');
  if (!npcId) {
    const due = ctx.state.flags?.[FLAG.pizzaDue];
    if (isNum(due) && ctx.state.tick >= due) dispatchGhoul(ctx);
    return;
  }
  const npc = getAgent(ctx, npcId);
  const delivered = ctx.state.flags?.[FLAG.pizzaDelivered] === true;
  if (!npc || npc.presence !== 'onLot') {
    if (!delivered) deliverPizzaItem(ctx, frontSpot(ctx));
    finish(ctx);
    return;
  }
  if (minutesSince(ctx, num(ctx.state.flags?.[FLAG.pizzaSpawned], ctx.state.tick)) > PIZZA_WATCHDOG_MIN) {
    if (!delivered) deliverPizzaItem(ctx, frontSpot(ctx));
    try {
      ctx.despawnAgent(npc.id, 'gone');
    } catch {
      npc.presence = 'gone';
    }
    finish(ctx);
    return;
  }
  if (delivered && !isBusyWith(npc, IX.deliverPizza) && !(npc.active && npc.active.interactionId === 'engine_exitLot')) {
    ctx.sendOffLot(npc, 'gone', 'Delivery done');
  }
}

export const deliverPizzaBehavior: InteractionBehavior = {
  completeStage(ctx, actor) {
    deliverPizzaItem(ctx, { x: actor.pos.x, z: actor.pos.z });
  },
  end(ctx, actor) {
    // Couldn't reach the door? Drop it at the front anyway — the tip was not included.
    if (ctx.state.flags?.[FLAG.pizzaDelivered] !== true) deliverPizzaItem(ctx, frontSpot(ctx));
    actor.carrying = null;
  },
};
