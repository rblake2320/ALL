/**
 * `food` system — cooking, eating, leftovers & spoilage, snacks, pizza delivery (GDD §5).
 * api: FoodApi { orderPizza(agentId), objectDetail(objectId) } + pizzaPending(), leftovers(objectId).
 */
import type { FoodApi, SimSystem } from '../../../contracts';
import { BEH, HOME_SYS, REQ } from '../../../content/home/ids';
import { apiMethod, instrument } from '../ctxRegistry';
import { every, getObj, inActiveRegions, onLotAgents, safeDt } from '../util';
import { cookBehavior } from './cooking';
import { objectDetail } from './detail';
import {
  cleanFridgeBehavior,
  eatBehavior,
  putAwayLeftoversBehavior,
  sweepEmptyMeals,
  throwAwayBehavior,
  tickFoodPoisoning,
} from './eating';
import { withEffectProbe } from '../upkeep/stuck';
import { ageAllFridges, ageMealsOut, leftoverCount, spoiledCount } from './leftovers';
import { deliverPizzaBehavior, orderPizza, pizzaPending, tickPizza } from './pizza';

export function createFoodSystem(): SimSystem {
  const api: FoodApi & Record<string, (...args: any[]) => any> = {
    orderPizza: apiMethod<true | string>('Not ready', (ctx, agentId: unknown, autonomous?: unknown) => orderPizza(ctx, agentId, autonomous === true)),
    objectDetail: apiMethod<string | null>(null, (ctx, objectId: unknown) => objectDetail(ctx, objectId)),
    pizzaPending: apiMethod(false, (ctx) => pizzaPending(ctx)),
    leftovers: apiMethod(0, (ctx, objectId: unknown) => leftoverCount(getObj(ctx, objectId))),
  };
  const sys: SimSystem = {
    id: HOME_SYS.food,
    tick(ctx, dtMin) {
      const dt = safeDt(dtMin);
      tickPizza(ctx);
      if (dt > 0) for (const a of onLotAgents(ctx)) tickFoodPoisoning(ctx, a, dt);
      if (every(ctx, 5)) inActiveRegions(ctx, () => sweepEmptyMeals(ctx));
    },
    hour(ctx) {
      inActiveRegions(ctx, () => {
        ageAllFridges(ctx, 60);
        ageMealsOut(ctx, 60);
      });
    },
    behaviors: {
      [BEH.cook]: cookBehavior,
      [BEH.eat]: eatBehavior,
      [BEH.putAwayLeftovers]: putAwayLeftoversBehavior,
      [BEH.throwAway]: throwAwayBehavior,
      [BEH.cleanFridge]: withEffectProbe(cleanFridgeBehavior),
      [BEH.deliverPizza]: deliverPizzaBehavior,
    },
    requirements: {
      [REQ.hasLeftovers]: (ctx, rc, p) =>
        leftoverCount(rc.targetObject) > 0 ? true : typeof p?.reason === 'string' ? p.reason : 'No leftovers',
      [REQ.hasSpoiledLeftovers]: (ctx, rc, p) =>
        spoiledCount(rc.targetObject) > 0 ? true : typeof p?.reason === 'string' ? p.reason : 'Nothing has spoiled',
    },
    api,
  };
  return instrument(sys);
}
