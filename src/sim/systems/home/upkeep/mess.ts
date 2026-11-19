/**
 * Mess, flies, stench & surroundings.
 * - Dirty dishes draw flies after 6 h; spoiled meals, rotten limbs and overflowing trash draw flies too.
 *   A powered Fly Zapper within its radius zaps them (no flies there).
 * - Dishes / spoiled food resting on a surface make it grimy (condition.dirt) → "Wipe Down".
 * - Reeking zombies (hygiene 0) give others within 3 tiles in the room Stench Nearby (−10), or Faint Stench (−5)
 *   when a Formaldehyde Diffuser is in the room; trait mult 'stenchMood' (Slob 0) suppresses it.
 * - Neat Freaks near dirty dishes / flies / ash get Disgusted by Mess.
 * - Room environment (spatial.roomEnvironment −10..10) → mood −8..+8 (negative part × trait mult 'messMood').
 */
import type { SimContext } from '../../../contracts';
import type { AgentState, ObjectState } from '../../../types';
import { DATA, ITEM, MOOD } from '../../../content/home/ids';
import { traitMultSafe } from '../decay/rates';
import { mealSpoiled } from '../food/leftovers';
import {
  agentInScope,
  centerOf,
  clamp,
  dataBool,
  dataNum,
  dist,
  getObj,
  hasTag,
  isAsleep,
  isZombie,
  minutesSince,
  nearAndSameRoom,
  num,
  objParam,
  objectsWithTag,
  onLotAgents,
  roomOf,
  setData,
  sortedObjects,
  tileOf,
} from '../util';

export const DISH_FLIES_AFTER_MIN = 6 * 60;
export const STENCH_RADIUS = 3;
export const MESS_RADIUS = 4;
export const SURFACE_DIRT_PER_ITEM_HOUR = 0.05;
export const REEKING_HYGIENE = 0.5;

function poweredZappers(ctx: SimContext): ObjectState[] {
  return objectsWithTag(ctx, 'flyZapper').filter((z) => {
    try {
      return ctx.powered(z);
    } catch {
      return false;
    }
  });
}

function zappedBy(ctx: SimContext, obj: ObjectState, zappers: ObjectState[]): ObjectState | null {
  const c = centerOf(ctx, obj);
  for (const z of zappers) if (dist(centerOf(ctx, z), c) <= objParam(ctx, z, 'radius', 5)) return z;
  return null;
}

/** Should this item attract flies right now (ignoring zappers)? */
export function attractsFlies(ctx: SimContext, o: ObjectState): boolean {
  if (o.placement.kind === 'held') return false;
  if (o.defId === ITEM.dish) return minutesSince(ctx, o.data?.[DATA.createdTick]) >= DISH_FLIES_AFTER_MIN;
  if (o.defId === ITEM.meal || o.defId === ITEM.pizza) return mealSpoiled(o);
  if (o.defId === ITEM.limbArm || o.defId === ITEM.limbLeg) return dataBool(o, DATA.rotten, false);
  if (hasTag(ctx, o, 'trash')) return dataNum(o, DATA.fill, 0) >= objParam(ctx, o, 'capacity', 8);
  return false;
}

/** Is this object "mess" a Neat Freak would notice? */
export function isMess(ctx: SimContext, o: ObjectState): boolean {
  if (o.placement.kind === 'held') return false;
  if (o.defId === ITEM.dish || o.defId === ITEM.ash) return true;
  if (dataBool(o, DATA.flies, false)) return true;
  return (o.defId === ITEM.meal || o.defId === ITEM.pizza) && mealSpoiled(o);
}

/** Hourly: flies on/off, zapper zaps, grime on surfaces under dirty items. */
export function hourlyMess(ctx: SimContext): void {
  const zappers = poweredZappers(ctx);
  for (const o of sortedObjects(ctx)) {
    const want = attractsFlies(ctx, o);
    const has = dataBool(o, DATA.flies, false);
    const zapper = want || has ? zappedBy(ctx, o, zappers) : null;
    if (want && !zapper) {
      if (!has) setData(ctx, o, DATA.flies, true);
    } else if (has && !want) {
      setData(ctx, o, DATA.flies, false); // the mess is gone: its flies go with it
    }
    // want && zapper: no NEW swarm grows inside a zapper's reach; an existing one is zapped away gradually by zapFlies
    // Grime under dirty items.
    const p = o.placement;
    if (p.kind === 'loose' && p.parentId && (o.defId === ITEM.dish || ((o.defId === ITEM.meal || o.defId === ITEM.pizza) && mealSpoiled(o)))) {
      const surface = getObj(ctx, p.parentId);
      if (surface) {
        if (!surface.condition) surface.condition = { broken: false, dirt: 0, burning: false, burnMinutes: 0 };
        const before = num(surface.condition.dirt, 0);
        const after = clamp(before + SURFACE_DIRT_PER_ITEM_HOUR, 0, 1);
        if (after !== before) {
          surface.condition.dirt = after;
          // Only re-sync visuals on visible steps.
          if (Math.floor(after * 10) !== Math.floor(before * 10)) ctx.markChanged(surface);
        }
      }
    }
  }
}

function isReeking(a: AgentState): boolean {
  return a.presence === 'onLot' && isZombie(a) && num(a.needs?.hygiene, 50) <= REEKING_HYGIENE;
}

function diffuserInRoom(ctx: SimContext, room: number): boolean {
  if (room === 0) return false;
  return objectsWithTag(ctx, 'airFreshener').some((d) => d.placement.kind !== 'held' && roomOf(ctx, centerOf(ctx, d)) === room);
}

/** Every few minutes: stench & mess moodlets. */
export function tickMess(ctx: SimContext): void {
  const agents = onLotAgents(ctx).filter((a) => isZombie(a) && agentInScope(ctx, a));
  const reekers = agents.filter(isReeking);
  if (reekers.length > 0) {
    for (const a of agents) {
      if (isReeking(a) || isAsleep(ctx, a)) continue;
      if (traitMultSafe(ctx, a, 'stenchMood') <= 0 || ctx.hasTrait(a, 'slob')) continue;
      const source = reekers.find((r) => r.id !== a.id && nearAndSameRoom(ctx, r.pos, a.pos, STENCH_RADIUS));
      if (!source) continue;
      const faint = diffuserInRoom(ctx, roomOf(ctx, a.pos));
      ctx.addMoodlet(a, faint ? MOOD.faintStench : MOOD.stenchNearby, { sourceId: source.id });
    }
  }
  const neat = agents.filter((a) => ctx.hasTrait(a, 'neatFreak') && !isAsleep(ctx, a));
  if (neat.length === 0) return;
  const mess = sortedObjects(ctx).filter((o) => isMess(ctx, o));
  if (mess.length === 0) return;
  for (const a of neat) {
    const near = mess.find((o) => nearAndSameRoom(ctx, centerOf(ctx, o), a.pos, MESS_RADIUS));
    if (near) ctx.addMoodlet(a, MOOD.disgustedByMess, { sourceId: near.id });
  }
}

/** Every ~30 min: fly-swarm fx over flies items and reeking zombies. */
export function fliesFx(ctx: SimContext): void {
  let sound = false;
  for (const o of sortedObjects(ctx)) {
    if (!dataBool(o, DATA.flies, false) || o.placement.kind === 'held') continue;
    ctx.emit({ type: 'fx', kind: 'flies', pos: centerOf(ctx, o), objectId: o.id });
    sound = true;
  }
  for (const a of onLotAgents(ctx)) {
    if (!isReeking(a) || !agentInScope(ctx, a)) continue;
    ctx.emit({ type: 'fx', kind: 'flies', agentId: a.id });
    ctx.emit({ type: 'fx', kind: 'stench', agentId: a.id });
    sound = true;
  }
  if (sound) ctx.emit({ type: 'sfx', id: 'flies', volume: 0.4 });
}

/** Room environment → mood (−8..+8). Slobs ignore the bad part; Neat Freaks feel it 1.5×. */
export function environmentMood(ctx: SimContext, agent: AgentState): { label: string; value: number }[] {
  if (agent.presence !== 'onLot' || !isZombie(agent)) return [];
  const t = tileOf(ctx, agent.pos);
  let env = 0;
  try {
    env = num(ctx.spatial.roomEnvironment(t.x, t.z), 0);
  } catch {
    env = 0;
  }
  let v = clamp(env, -10, 10) * 0.8;
  if (v < 0) v *= traitMultSafe(ctx, agent, 'messMood');
  const value = clamp(Math.round(v), -8, 8);
  if (value === 0) return [];
  return [{ label: value > 0 ? 'Lovely Surroundings' : 'Grim Surroundings', value }];
}

/** Swarms a single zapper clears per pass (passes run every 30 game minutes, see upkeep/index.ts). */
export const ZAPS_PER_PASS = 1;

/**
 * Owner request: "if you have a fly zapper then the flies should get zapped and start to disappear if the zapper is
 * near them". Every pass each powered zapper zaps the NEAREST swarm in its radius (zap fx + sound), so the flies around
 * it thin out one by one instead of all blinking off on the hour. Deterministic: zappers and items in sorted order,
 * ties broken by id. Returns the ids zapped (tests).
 */
export function zapFlies(ctx: SimContext): string[] {
  const zappers = poweredZappers(ctx);
  if (zappers.length === 0) return [];
  const out: string[] = [];
  const swarms = sortedObjects(ctx).filter((o) => dataBool(o, DATA.flies, false) && o.placement.kind !== 'held');
  for (const z of zappers) {
    const zc = centerOf(ctx, z);
    const r = objParam(ctx, z, 'radius', 5);
    const near = swarms
      .filter((o) => !out.includes(o.id) && dist(zc, centerOf(ctx, o)) <= r)
      .sort((a, b) => dist(zc, centerOf(ctx, a)) - dist(zc, centerOf(ctx, b)) || (a.id < b.id ? -1 : 1))
      .slice(0, ZAPS_PER_PASS);
    for (const o of near) {
      setData(ctx, o, DATA.flies, false);
      out.push(o.id);
      ctx.emit({ type: 'fx', kind: 'zap', pos: zc, objectId: z.id });
      ctx.emit({ type: 'sfx', id: 'zap', pos: zc, objectId: z.id, volume: 0.6 });
    }
  }
  return out;
}
