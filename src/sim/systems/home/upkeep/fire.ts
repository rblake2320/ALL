/**
 * Fire (GDD §5): `item_fire` sits on a burning object; spreads to an adjacent floor object 10% per 10 burning
 * minutes; after 60 burning minutes the object (and its fire) becomes `item_ash`. Zombies nearby panic and lose
 * 10 preservation per hour within 1.5 tiles. "Fight Fire" (20 min) succeeds 70% per attempt.
 *
 * Severity limits (backlog #15): one ignition is one fire EVENT (`data.fireEvent`, inherited by every fire it
 * spreads to) and an event spreads at most FIRE_MAX_SPREADS times (`flags['home.fire.spreads.<event>']`), so a kitchen
 * fire can no longer chain through the whole house. While a fire burns, every awake household zombie on the lot that
 * is not panicking about it right now (Panicking moodlet + the fire in sight; not feral / passed out) is summoned to
 * Fight Fire at CRITICAL priority (non-panicking volunteers already fighting are raised to critical first) — a
 * critical crew of at most MAX_FIREFIGHTERS_PER_FIRE per fire, nearest fire first, re-summoned no sooner than every
 * FIRE_RESUMMON_MIN (autonomy 'off' leaves the household to the player). An ashed fridge / stove / microwave posts a
 * clear "Your fridge burned — buy a new one" notification instead of the generic one.
 */
import type { SimContext } from '../../../contracts';
import type { AgentState, ObjectState, Vec2 } from '../../../types';
import { PRIORITY } from '../../../vocabulary';
import { minutesToTicks } from '../../../time';
import { DATA, FLAG, ITEM, IX, MOOD, STAT } from '../../../content/home/ids';
import {
  bubble,
  agentInScope,
  centerOf,
  dataNum,
  dataStr,
  defOf,
  dist,
  every,
  getObj,
  isAsleep,
  isZombie,
  livingMembers,
  nearAndSameRoom,
  num,
  objectsOfDef,
  objName,
  onLotAgents,
  sortedObjects,
  voice,
} from '../util';

export const FIRE_BURN_MINUTES = 60;
export const FIRE_SPREAD_EVERY_MIN = 10;
export const FIRE_SPREAD_CHANCE = 0.1;
export const FIRE_FIGHT_SUCCESS = 0.7;
export const FIRE_DRAIN_RADIUS = 1.5;
export const FIRE_DRAIN_PER_HOUR = 10;
export const FIRE_PANIC_RADIUS = 4;
/** Spreads allowed per fire event (the original ignition and everything it spread to). */
export const FIRE_MAX_SPREADS = 2;
/** Zombies summoned (or already fighting) per fire. */
export const MAX_FIREFIGHTERS_PER_FIRE = 2;
/** A summoned zombie that is not (or no longer) fighting is summoned again no sooner than this. */
export const FIRE_RESUMMON_MIN = 10;

const NONFLAMMABLE_TAGS = ['plumbing', 'sink', 'shower', 'tub', 'headstone', 'mailbox', 'fire', 'ash'];

export function fireItems(ctx: SimContext): ObjectState[] {
  return objectsOfDef(ctx, ITEM.fire);
}

export function isFlammable(ctx: SimContext, obj: ObjectState | null | undefined): boolean {
  if (!obj || obj.placement.kind !== 'floor') return false;
  const def = defOf(ctx, obj);
  if (!def || def.category === 'item') return false;
  return !def.tags.some((t) => NONFLAMMABLE_TAGS.includes(t));
}

function fireOf(ctx: SimContext, obj: ObjectState): ObjectState | null {
  return fireItems(ctx).find((f) => dataStr(f, DATA.burningId, '') === obj.id) ?? null;
}

function ensureCondition(obj: ObjectState): ObjectState['condition'] {
  if (!obj.condition || typeof obj.condition !== 'object') obj.condition = { broken: false, dirt: 0, burning: false, burnMinutes: 0 };
  return obj.condition;
}

/**
 * Set an object (or, with `at`, a bare floor spot) on fire. Returns the fire item, or null when nothing burns
 * (non-flammable, held, already burning returns the existing fire).
 */
/** The fire event a fire belongs to (legacy fires without one are their own event). */
export function fireEventOf(fire: ObjectState): string {
  return dataStr(fire, DATA.fireEvent, fire.id) || fire.id;
}

export function spreadsOf(ctx: SimContext, event: string): number {
  return Math.max(0, num(ctx.state.flags?.[FLAG.fireSpreadsPrefix + event], 0));
}

export function startFire(ctx: SimContext, obj: ObjectState | null, opts?: { at?: Vec2; quiet?: boolean; event?: string }): ObjectState | null {
  if (obj) {
    if (!ctx.state.objects[obj.id]) return null;
    const cond = ensureCondition(obj);
    if (cond.burning) return fireOf(ctx, obj);
    if (!isFlammable(ctx, obj)) return null;
  }
  const pos = obj ? centerOf(ctx, obj) : opts?.at;
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return null;
  let fire: ObjectState | null = null;
  try {
    fire = ctx.spawnObject(
      ITEM.fire,
      { kind: 'loose', x: pos.x, z: pos.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 },
      { data: { [DATA.burningId]: obj ? obj.id : null, [DATA.burnMin]: 0, [DATA.spreadMin]: 0, [DATA.createdTick]: ctx.state.tick } },
    );
  } catch {
    return null;
  }
  fire.data[DATA.fireEvent] = opts?.event ?? fire.id; // a fresh ignition starts its own event
  if (obj) {
    const cond = ensureCondition(obj);
    cond.burning = true;
    cond.burnMinutes = 0;
    ctx.markChanged(obj);
  }
  ctx.emit({ type: 'sfx', id: 'fireStart', pos, objectId: fire.id });
  ctx.emit({ type: 'sfxLoop', id: 'fireLoop', key: `fire:${fire.id}`, on: true, pos, objectId: fire.id });
  ctx.emit({ type: 'fx', kind: 'fire', pos, objectId: fire.id });
  ctx.emit({ type: 'music', mood: 'tense' });
  if (!opts?.quiet) {
    ctx.notify({
      kind: 'bad',
      title: 'Fire!',
      text: obj
        ? `The ${objName(ctx, obj)} is on fire! Zombies are extremely flammable — someone Fight Fire, now.`
        : 'Something is on fire! Zombies are extremely flammable — someone Fight Fire, now.',
      objectId: fire.id,
    });
  }
  ctx.stat(STAT.firesStarted, 1);
  return fire;
}

function stopLoop(ctx: SimContext, fire: ObjectState): void {
  ctx.emit({ type: 'sfxLoop', id: 'fireLoop', key: `fire:${fire.id}`, on: false, objectId: fire.id });
}

/** Put a fire out (Fight Fire success). The object survives, scorched. */
export function extinguish(ctx: SimContext, fire: ObjectState, by?: AgentState | null): void {
  if (!ctx.state.objects[fire.id]) return;
  const obj = getObj(ctx, dataStr(fire, DATA.burningId, ''));
  const pos = centerOf(ctx, fire);
  stopLoop(ctx, fire);
  ctx.removeObject(fire.id, 'The fire is out');
  if (obj && ctx.state.objects[obj.id] && !fireOf(ctx, obj)) {
    const cond = ensureCondition(obj);
    cond.burning = false;
    cond.burnMinutes = 0;
    cond.dirt = Math.max(num(cond.dirt, 0), 0.6);
    ctx.markChanged(obj);
  }
  ctx.emit({ type: 'fx', kind: 'smoke', pos });
  ctx.emit({ type: 'sfx', id: 'extinguish', pos });
  if (fireItems(ctx).length === 0) ctx.emit({ type: 'music', mood: 'normal' });
  if (by) {
    ctx.stat(STAT.firesFought, 1);
    ctx.stat(STAT.firesFought, 1, by.id);
  }
  ctx.notify({
    kind: 'good',
    title: 'Fire’s out',
    text: by ? `${by.firstName} beat the flames into submission. Everything smells like barbecue.` : 'The fire is out.',
    agentId: by ? by.id : null,
  });
}

function burnToAsh(ctx: SimContext, obj: ObjectState | null, fire: ObjectState): void {
  const pos = obj && ctx.state.objects[obj.id] ? centerOf(ctx, obj) : centerOf(ctx, fire);
  const name = obj ? objName(ctx, obj) : 'fire';
  // Remove every fire on this object first (no lingering loops), then the object itself.
  const fires = obj ? fireItems(ctx).filter((f) => dataStr(f, DATA.burningId, '') === obj.id) : [fire];
  for (const f of fires) {
    stopLoop(ctx, f);
    ctx.removeObject(f.id, 'Burned out');
  }
  const appliance = obj ? kitchenAppliance(ctx, obj) : null;
  if (obj && ctx.state.objects[obj.id]) ctx.removeObject(obj.id, `The ${name.toLowerCase()} burned to a crisp`);
  try {
    ctx.spawnObject(ITEM.ash, { kind: 'loose', x: pos.x, z: pos.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 }, { data: { [DATA.createdTick]: ctx.state.tick } });
  } catch {
    /* no ash is fine */
  }
  ctx.emit({ type: 'fx', kind: 'smoke', pos });
  if (fireItems(ctx).length === 0) ctx.emit({ type: 'music', mood: 'normal' });
  if (appliance) {
    // Losing a kitchen appliance silently starves a household (sim-people H1): say exactly what to do.
    ctx.notify({ kind: 'bad', title: `Your ${appliance} burned — buy a new one`, text: APPLIANCE_TEXT[appliance](name) });
  } else if (obj) {
    ctx.notify({ kind: 'bad', title: 'Burned to a crisp', text: `The ${name} is now a pile of ash. It was nice while it lasted.` });
  }
}

type Appliance = 'fridge' | 'stove' | 'microwave';
const APPLIANCE_TEXT: Record<Appliance, (name: string) => string> = {
  fridge: (n) => `The ${n} is a pile of ash, and so is everything in it. Nobody can cook or grab a snack until you buy a new fridge in Buy mode.`,
  stove: (n) => `The ${n} is a pile of ash. Nobody can cook a real meal until you buy a new stove in Buy mode.`,
  microwave: (n) => `The ${n} is a pile of ash. Buy a new microwave in Buy mode to get burritos back on the menu.`,
};

function kitchenAppliance(ctx: SimContext, obj: ObjectState): Appliance | null {
  const tags = defOf(ctx, obj)?.tags ?? [];
  if (tags.includes('fridge')) return 'fridge';
  if (tags.includes('stove')) return 'stove';
  if (tags.includes('microwave')) return 'microwave';
  return null;
}

function objectTiles(ctx: SimContext, obj: ObjectState): { x: number; z: number }[] {
  try {
    const t = ctx.spatial.objectTiles(obj);
    if (Array.isArray(t) && t.length > 0) return t;
  } catch {
    /* fall through */
  }
  const c = centerOf(ctx, obj);
  return [{ x: Math.floor(c.x), z: Math.floor(c.z) }];
}

function adjacent(a: { x: number; z: number }[], b: { x: number; z: number }[]): boolean {
  for (const p of a) for (const q of b) if (Math.abs(p.x - q.x) <= 1 && Math.abs(p.z - q.z) <= 1) return true;
  return false;
}

/**
 * Try to spread from a burning object to one adjacent flammable floor object. The new fire joins the source's fire
 * event; an event that already spread FIRE_MAX_SPREADS times spreads no further (backlog #15).
 */
export function spreadFrom(ctx: SimContext, obj: ObjectState, event?: string): ObjectState | null {
  const source = fireOf(ctx, obj);
  const ev = event ?? (source ? fireEventOf(source) : null);
  if (ev !== null && spreadsOf(ctx, ev) >= FIRE_MAX_SPREADS) return null;
  const mine = objectTiles(ctx, obj);
  const candidates = sortedObjects(ctx).filter(
    (o) => o.id !== obj.id && isFlammable(ctx, o) && !ensureCondition(o).burning && adjacent(mine, objectTiles(ctx, o)),
  );
  if (candidates.length === 0) return null;
  const target = candidates[ctx.rng.int(0, candidates.length - 1)];
  const fire = startFire(ctx, target, ev !== null ? { quiet: true, event: ev } : { quiet: true });
  if (fire && ev !== null) ctx.state.flags[FLAG.fireSpreadsPrefix + ev] = spreadsOf(ctx, ev) + 1;
  return fire;
}

/** Per-tick fire simulation. */
export function tickFires(ctx: SimContext, dt: number): void {
  const fires = fireItems(ctx);
  if (fires.length === 0) {
    if (every(ctx, 5)) {
      clearStaleBurning(ctx);
      clearFireFlags(ctx);
    }
    return;
  }
  for (const fire of fires) {
    if (!ctx.state.objects[fire.id]) continue; // removed by an earlier burn this tick
    const burnMin = dataNum(fire, DATA.burnMin, 0) + dt;
    fire.data[DATA.burnMin] = burnMin;
    const obj = getObj(ctx, dataStr(fire, DATA.burningId, ''));
    if (obj) {
      const cond = ensureCondition(obj);
      cond.burning = true;
      cond.burnMinutes = num(cond.burnMinutes, 0) + dt;
    }
    const event = fireEventOf(fire);
    let spread = dataNum(fire, DATA.spreadMin, 0) + dt;
    while (spread >= FIRE_SPREAD_EVERY_MIN) {
      spread -= FIRE_SPREAD_EVERY_MIN;
      if (spreadsOf(ctx, event) >= FIRE_MAX_SPREADS) continue; // capped: no roll, no spread
      if (obj && ctx.state.objects[obj.id] && ctx.rng.chance(FIRE_SPREAD_CHANCE)) spreadFrom(ctx, obj, event);
    }
    if (ctx.state.objects[fire.id]) fire.data[DATA.spreadMin] = spread;
    if (burnMin >= FIRE_BURN_MINUTES) burnToAsh(ctx, obj, fire);
  }
  applyHazards(ctx, dt);
  if (every(ctx, 1)) summonFirefighters(ctx);
}

/** Spread counters and summon stamps only matter while something burns. */
function clearFireFlags(ctx: SimContext): void {
  if (Object.values(ctx.state.objects).some(o => o.defId === ITEM.fire)) return;
  const flags = ctx.state.flags;
  if (!flags || typeof flags !== 'object') return;
  for (const k of Object.keys(flags)) if (k.startsWith(FLAG.fireSpreadsPrefix) || k.startsWith(FLAG.fireCalledPrefix)) delete flags[k];
}

/**
 * A volunteer (autonomous Fight Fire at normal priority) is raised to CRITICAL too, so a chat, a phone call or the
 * carpool can no longer pull a firefighter off the flames. Queue order is kept (priority desc, FIFO).
 */
function escalate(agent: AgentState): void {
  const r = agent.active;
  if (r && r.interactionId === IX.fightFire && r.priority < PRIORITY.critical) r.priority = PRIORITY.critical;
  if (!Array.isArray(agent.queue)) return;
  let moved = false;
  for (const q of agent.queue) {
    if (q && q.interactionId === IX.fightFire && q.priority < PRIORITY.critical) {
      q.priority = PRIORITY.critical;
      moved = true;
    }
  }
  if (moved) agent.queue.sort((a, b) => b.priority - a.priority); // stable: FIFO within a priority
}

/** Priority of the agent's Fight Fire (active run first, else its first queued one); 0 when none. */
function fightPriority(agent: AgentState): number {
  const r = agent.active;
  if (r && r.interactionId === IX.fightFire) return num(r.priority, 0);
  const q = Array.isArray(agent.queue) ? agent.queue.find((x) => x && x.interactionId === IX.fightFire) : undefined;
  return q ? num(q.priority, 0) : 0;
}

/** The fire `agent` is fighting or queued to fight (null = none). */
function fightingFire(agent: AgentState): string | null {
  const r = agent.active;
  if (r && r.interactionId === IX.fightFire && r.target.kind === 'object') return r.target.id;
  const q = Array.isArray(agent.queue) ? agent.queue.find((x) => x && x.interactionId === IX.fightFire && x.target?.kind === 'object') : undefined;
  return q && q.target.kind === 'object' ? q.target.id : null;
}

/**
 * Household autonomy treats a fire as an emergency (backlog #15): every awake, non-panicking, non-feral household
 * zombie on the lot is queued to Fight Fire at CRITICAL priority (the engine preempts what they were doing; a
 * player order is re-queued after). Panicking zombies (the ones right next to it) still pick Fight Fire through its
 * +60 adBonus. Deterministic: members in id order, nearest fire with room in its crew.
 */
export function summonFirefighters(ctx: SimContext): void {
  if (ctx.state.settings?.autonomy === 'off') return;
  const fires = fireItems(ctx);
  if (fires.length === 0) return;
  const centres = fires.map((f) => centerOf(ctx, f));
  // Panicking = in a panic about a fire RIGHT NOW (the moodlet AND the fire in sight). The moodlet lingers for an
  // hour after a fire is out — a second kitchen fire must not find the whole household "too panicked" to help.
  const panicking = (m: AgentState) => ctx.hasMoodlet(m, MOOD.panicking) && perceivesFire(ctx, m, centres);
  const members = livingMembers(ctx).filter((m) => m.presence === 'onLot' && agentInScope(ctx, m));
  const crew = new Map<string, number>(); // everyone fighting a fire (caps the summons)
  const critical = new Map<string, number>(); // critical-priority fighters (caps the escalation)
  const bump = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1);
  for (const m of members) {
    const f = fightingFire(m);
    if (!f) continue;
    bump(crew, f);
    if (fightPriority(m) >= PRIORITY.critical) bump(critical, f);
  }
  // Volunteers (autonomous Fight Fire) who are not panicking join the critical crew while it has room.
  for (const m of members) {
    const f = fightingFire(m);
    if (!f || fightPriority(m) >= PRIORITY.critical || panicking(m) || (critical.get(f) ?? 0) >= MAX_FIREFIGHTERS_PER_FIRE) continue;
    escalate(m);
    bump(critical, f);
  }
  const resummon = minutesToTicks(FIRE_RESUMMON_MIN);
  for (const m of members) {
    if (fightingFire(m)) continue;
    if (m.status?.feral || m.status?.passedOut || isAsleep(ctx, m) || panicking(m)) continue;
    const key = FLAG.fireCalledPrefix + m.id;
    if (ctx.state.tick - num(ctx.state.flags?.[key], -1e12) < resummon) continue;
    let best: ObjectState | null = null;
    let bestD = Infinity;
    for (const f of fires) {
      if ((crew.get(f.id) ?? 0) >= MAX_FIREFIGHTERS_PER_FIRE) continue;
      const d = dist(centerOf(ctx, f), m.pos);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best) continue;
    const q = ctx.queue(m, { interactionId: IX.fightFire, target: { kind: 'object', id: best.id }, params: { attempt: 1 }, source: 'system', priority: PRIORITY.critical, front: true });
    if (!q) continue;
    ctx.state.flags[key] = ctx.state.tick;
    bump(crew, best.id);
    bump(critical, best.id);
    bubble(ctx, m, 'fire', 'shout', false);
  }
}

/** Objects flagged burning without a fire item (fire removed by build mode etc.) stop burning. */
function clearStaleBurning(ctx: SimContext): void {
  for (const o of sortedObjects(ctx)) {
    if (o && o.condition && o.condition.burning && !fireOf(ctx, o)) {
      o.condition.burning = false;
      o.condition.burnMinutes = 0;
      ctx.markChanged(o);
    }
  }
}

export function fireDrainPerHour(ctx: SimContext, agent: AgentState): number {
  if (agent.presence !== 'onLot' || !isZombie(agent)) return 0;
  for (const f of fireItems(ctx)) if (dist(centerOf(ctx, f), agent.pos) <= FIRE_DRAIN_RADIUS) return FIRE_DRAIN_PER_HOUR;
  return 0;
}

/** Does `a` see / feel a burning fire right now (same rule that hands out Panicking)? */
function perceivesFire(ctx: SimContext, a: AgentState, centres: Vec2[]): boolean {
  for (const c of centres) if (nearAndSameRoom(ctx, c, a.pos, FIRE_PANIC_RADIUS) || dist(c, a.pos) <= 2.5) return true;
  return false;
}

function applyHazards(ctx: SimContext, dt: number): void {
  const fires = fireItems(ctx);
  if (fires.length === 0) return;
  const centres = fires.map((f) => centerOf(ctx, f));
  const panicCheck = every(ctx, 5);
  for (const a of onLotAgents(ctx)) {
    if (!isZombie(a) || !agentInScope(ctx, a)) continue;
    let nearest = Infinity;
    for (const c of centres) {
      const d = dist(c, a.pos);
      if (d < nearest) nearest = d;
    }
    const perceived = perceivesFire(ctx, a, centres);
    if (nearest <= FIRE_DRAIN_RADIUS) ctx.changeNeed(a, 'preservation', -(FIRE_DRAIN_PER_HOUR * dt) / 60, { raw: true });
    if (panicCheck && perceived && !isAsleep(ctx, a)) {
      const fresh = !ctx.hasMoodlet(a, MOOD.panicking);
      ctx.addMoodlet(a, MOOD.panicking, { sourceId: fires[0].id });
      if (fresh) {
        bubble(ctx, a, 'fire', 'shout', false);
        voice(ctx, a, 'scream', 1500);
      }
    }
  }
}
