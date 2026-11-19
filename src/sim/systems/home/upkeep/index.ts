/**
 * `upkeep` system — breakage & repair, fire, lights, stereo loops, mess / flies / stench, room environment mood,
 * and the leisure behaviours (TV, dancing, reading, painting, sitting, cleaning).
 * api: startFire(objectId), fires(), breakObject(objectId), environment(agentId).
 */
import type { SimContext, SimSystem } from '../../../contracts';
import { BEH, COND, DATA, EFF, FLAG, HOME_SYS, ITEM, MOOD, REQ } from '../../../content/home/ids';
import { apiMethod, instrument } from '../ctxRegistry';
import { centerOf, dataBool, dataNum, every, getAgent, getObj, inActiveRegions, livingMembers, num, objectsOfDef, objParam, safeDt, setFlag, sortedObjects, syncMoodlet } from '../util';
import {
  activityBehavior,
  cleanUpBehavior,
  danceBehavior,
  emptyTrashBehavior,
  epitaphBehavior,
  feedPlantBehavior,
  fightFireBehavior,
  listenBehavior,
  paintBehavior,
  readBehavior,
  sitBehavior,
  toggleBehavior,
  watchTvBehavior,
  wipeDownBehavior,
} from './behaviors';
import { fireItems, startFire, tickFires } from './fire';
import { clearDishesBehavior, clearStuckBehavior, withEffectProbe } from './stuck';
import { syncStereoLoops } from './loops';
import { environmentMood, fliesFx, hourlyMess, tickMess, zapFlies } from './mess';
import { breakObject, breakRandomEffect, repairBehavior, wearEffect } from './wear';

/** Re-emit audio loops (audio state is not saved) — audible stereos, active fires. */
function reemitLoops(ctx: SimContext): void {
  syncStereoLoops(ctx, true);
  for (const f of fireItems(ctx)) {
    ctx.emit({ type: 'sfxLoop', id: 'fireLoop', key: `fire:${f.id}`, on: true, objectId: f.id, pos: centerOf(ctx, f) });
  }
}

/** Power watcher: Power's Out moodlet follows the household (stereo loops follow via syncStereoLoops). */
function watchPower(ctx: SimContext): void {
  const on = !!ctx.state.household?.utilitiesOn;
  const seen = ctx.state.flags?.[FLAG.powerSeen];
  if (seen === on) return;
  setFlag(ctx, FLAG.powerSeen, on);
  if (typeof seen !== 'boolean') return; // first observation: nothing changed
  for (const m of livingMembers(ctx)) syncMoodlet(ctx, m, MOOD.powerOut, !on);
}

export function createUpkeepSystem(): SimSystem {
  const api: Record<string, (...args: any[]) => any> = {
    startFire: apiMethod<string | null>(null, (ctx, objectId: unknown) => startFire(ctx, getObj(ctx, objectId))?.id ?? null),
    fires: apiMethod<string[]>([], (ctx) => fireItems(ctx).map((f) => f.id)),
    breakObject: apiMethod(false, (ctx, objectId: unknown) => {
      const o = getObj(ctx, objectId);
      return o ? breakObject(ctx, o, null) : false;
    }),
    environment: apiMethod(0, (ctx, agentId: unknown) => {
      const a = getAgent(ctx, agentId);
      return a ? environmentMood(ctx, a).reduce((n, p) => n + p.value, 0) : 0;
    }),
  };
  const sys: SimSystem = {
    id: HOME_SYS.upkeep,
    init(ctx, loaded) {
      setFlag(ctx, FLAG.powerSeen, !!ctx.state.household?.utilitiesOn);
      if (loaded) inActiveRegions(ctx, () => reemitLoops(ctx));
    },
    tick(ctx, dtMin) {
      const dt = safeDt(dtMin);
      watchPower(ctx);
      inActiveRegions(ctx, () => {
        syncStereoLoops(ctx);
        if (dt > 0) tickFires(ctx, dt);
        if (every(ctx, 5)) tickMess(ctx);
        if (every(ctx, 30)) {
          zapFlies(ctx); // a zapper thins the swarms near it first, then the remaining flies buzz
          fliesFx(ctx);
        }
      });
    },
    hour(ctx) {
      inActiveRegions(ctx, () => hourlyMess(ctx));
    },
    moodModifiers(ctx, agent) {
      return environmentMood(ctx, agent);
    },
    behaviors: {
      [BEH.activity]: activityBehavior,
      [BEH.sit]: sitBehavior,
      [BEH.toggle]: toggleBehavior,
      [BEH.watchTv]: watchTvBehavior,
      [BEH.dance]: danceBehavior,
      [BEH.listen]: listenBehavior,
      [BEH.read]: readBehavior,
      [BEH.paint]: paintBehavior,
      [BEH.cleanUp]: withEffectProbe(cleanUpBehavior),
      [BEH.wipeDown]: withEffectProbe(wipeDownBehavior),
      [BEH.clearStuckMess]: clearStuckBehavior,
      [BEH.clearDishes]: clearDishesBehavior,
      [BEH.fightFire]: fightFireBehavior,
      [BEH.repair]: repairBehavior,
      [BEH.emptyTrash]: withEffectProbe(emptyTrashBehavior),
      [BEH.feedPlant]: feedPlantBehavior,
      [BEH.epitaph]: epitaphBehavior,
    },
    effects: {
      [EFF.wear]: (ctx, ec) => wearEffect(ctx, ec),
      [EFF.breakRandom]: (ctx, ec, params) => breakRandomEffect(ctx, ec, params),
      [EFF.startFire]: (ctx, ec, params) => {
        const explicit = getObj(ctx, params?.objectId);
        if (explicit) {
          startFire(ctx, explicit);
          return;
        }
        if (typeof params?.tag === 'string') {
          const pool = sortedObjects(ctx).filter((o) => o.placement.kind === 'floor' && (ctx.content.objects[o.defId]?.tags ?? []).includes(params.tag));
          if (pool.length > 0) startFire(ctx, pool[ctx.rng.int(0, pool.length - 1)]);
          return;
        }
        startFire(ctx, ec.targetObject);
      },
    },
    requirements: {
      [REQ.dirty]: (_ctx, rc, p) => {
        const dirt = num(rc.targetObject?.condition?.dirt, 0);
        return dirt >= num(p?.min, 0.25) ? true : typeof p?.reason === 'string' ? p.reason : 'Already spotless';
      },
      [REQ.trashFill]: (ctx, rc, p) => {
        const fill = dataNum(rc.targetObject, DATA.fill, 0);
        return fill >= num(p?.min, 1) ? true : typeof p?.reason === 'string' ? p.reason : 'Not full yet';
      },
    },
    conditions: {
      [COND.dishCount]: (ctx, _agent, params) => objectsOfDef(ctx, ITEM.dish).length >= num(params?.min, 1),
      [COND.fireOnLot]: (ctx) => fireItems(ctx).length > 0,
    },
    api,
  };
  return instrument(sys);
}

/** Trash capacity helper (exported for detail/tests). */
export function trashCapacity(ctx: SimContext, id: string): number {
  return Math.max(1, Math.floor(objParam(ctx, getObj(ctx, id), 'capacity', 8)));
}
