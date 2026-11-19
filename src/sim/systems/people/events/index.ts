/**
 * `events` system: hourly random life events (every LifeEventDef in the registry, GDD §13), the full-moon
 * Moonstruck moodlet, Hopeless Romantic lovesickness, trait mood modifiers (Night Owl, Vain, Loner crowds,
 * Social Butterfly parties) and the life-event condition kinds + effects.
 */
import type { EffectContext, EffectHandler, LifeEventDef, SimContext, SimSystem } from '../../../contracts';
import type { AgentState, ObjectState } from '../../../types';
import { COND, EFFECT, MOODLET as M, STAT, SYS } from '../../../content/people/ids';
import { EVENT_COOLDOWN_KIND } from '../../../content/people/lifeEvents';
import {
  clamp,
  compareIds,
  delFlag,
  dropMoodlet,
  firstName,
  flagNum,
  fullName,
  grantMoodlet,
  hasTrait,
  householdMembers,
  householdOnLot,
  hourInWindow,
  isNum,
  makeApi,
  minutesToTicks,
  needOf,
  num,
  onLotAgents,
  partnerOf,
  pickOne,
  relsOf,
  setFlag,
  sfx,
  TICKS_PER_HOUR,
  townies,
} from '../util';
import { addFriendship, writableRel } from '../social/relations';
import { partyActive } from '../townies/party';

export const LOVESICK_DAYS = 7;

// ───────────────────────────── spatial helpers ─────────────────────────────

function tileOfPos(ctx: SimContext, p: { x: number; z: number }): { x: number; z: number } {
  try {
    return ctx.spatial.tileOf(p);
  } catch {
    return { x: Math.floor(num(p.x, 0)), z: Math.floor(num(p.z, 0)) };
  }
}

function indoorAt(ctx: SimContext, p: { x: number; z: number }): boolean {
  const t = tileOfPos(ctx, p);
  try {
    return ctx.spatial.isIndoor(t.x, t.z);
  } catch {
    return false;
  }
}

function objectPos(ctx: SimContext, o: ObjectState): { x: number; z: number } | null {
  try {
    const c = ctx.spatial.objectCenter(o);
    if (c && isNum(c.x) && isNum(c.z)) return c;
  } catch {
    /* fall through */
  }
  const p = o.placement;
  if (p.kind === 'floor' || p.kind === 'loose') return { x: num(p.x, 0) + 0.5, z: num(p.z, 0) + 0.5 };
  return null;
}

function tagsOf(ctx: SimContext, o: ObjectState): string[] {
  try {
    return ctx.objectDef(o).tags ?? [];
  } catch {
    return [];
  }
}

function roomOf(ctx: SimContext, a: AgentState): number {
  const t = tileOfPos(ctx, a.pos);
  try {
    return ctx.spatial.roomAt(t.x, t.z);
  } catch {
    return 0;
  }
}

function isReeking(a: AgentState): boolean {
  return needOf(a, 'hygiene') <= 0.5;
}

// ───────────────────────────── conditions ─────────────────────────────

export const eventConditions: Record<string, (ctx: SimContext, agent: AgentState | null, params: Record<string, any>) => boolean> = {
  [COND.clockBetween]: (ctx, _a, p) => hourInWindow(ctx.time.hour, num(p?.from, 0), num(p?.to, 0)),
  [COND.lotHasTag]: (ctx, _a, p) => {
    const tag = typeof p?.tag === 'string' ? p.tag : '';
    if (!tag) return false;
    const min = num(p?.min, 1);
    let n = 0;
    for (const id of Object.keys(ctx.state.objects)) {
      const o = ctx.state.objects[id];
      if (o && !o.condition?.broken && tagsOf(ctx, o).includes(tag)) n++;
      if (n >= min) return true;
    }
    return false;
  },
  [COND.noOutdoorLight]: (ctx) => {
    for (const id of Object.keys(ctx.state.objects)) {
      const o = ctx.state.objects[id];
      if (!o || o.placement.kind === 'held') continue;
      const tags = tagsOf(ctx, o);
      if (!tags.includes('light')) continue;
      if (o.condition?.broken || o.data?.on === false) continue;
      if (!ctx.powered(o)) continue;
      const pos = objectPos(ctx, o);
      if (pos && (tags.includes('outdoorLight') || !indoorAt(ctx, pos))) return false;
    }
    return true;
  },
  [COND.reekingOutdoors]: (ctx) => householdOnLot(ctx).some((a) => isReeking(a) && !indoorAt(ctx, a.pos)),
  [COND.householdHome]: (ctx, _a, p) => householdOnLot(ctx).length >= num(p?.min, 1),
  [EVENT_COOLDOWN_KIND]: (ctx, _a, p) => {
    const id = typeof p?.id === 'string' ? p.id : '';
    if (!id) return true;
    const last = flagNum(ctx, `ev:${id}`, NaN);
    return !isNum(last) || ctx.state.tick - last >= num(p?.hours, 24) * TICKS_PER_HOUR;
  },
};

// ───────────────────────────── effects ─────────────────────────────

function pickMember(ctx: SimContext, ec: EffectContext | null, params: Record<string, any>): AgentState | null {
  if (ec?.actor) return ec.actor;
  const id = typeof params?.agentId === 'string' ? params.agentId : null;
  const byId = id ? ctx.agent(id) : undefined;
  if (byId) return byId;
  const home = householdOnLot(ctx);
  if (home.length) return pickOne(ctx, home);
  return pickOne(ctx, householdMembers(ctx).filter((a) => a.presence !== 'gone' && a.presence !== 'crumbled'));
}

const FAN_LINES = [
  '“Your shamble is an inspiration to us all.”',
  '“I saw you through the window and your posture was IMMACULATE.”',
  '“Please sign the enclosed photo of your left ear.”',
  '“You are the reason I got out of my coffin this morning.”',
  '“My grandmother says you remind her of her late husband. She means it as a compliment.”',
];

export const eventEffects: Record<string, EffectHandler> = {
  [EFFECT.neighbourComplains]: (ctx, _ec, params) => {
    const reekers = householdOnLot(ctx).filter((a) => isReeking(a));
    const outside = reekers.filter((a) => !indoorAt(ctx, a.pos));
    const who = pickOne(ctx, outside.length ? outside : reekers);
    const neighbour = pickOne(ctx, townies(ctx).filter((t) => t.presence !== 'gone'));
    if (!who || !neighbour) return;
    const r = writableRel(ctx, who.id, neighbour.id);
    addFriendship(r, num(params?.friendship, -8));
    grantMoodlet(ctx, who, M.smellShamed, { sourceId: neighbour.id });
    ctx.notify({ kind: 'social', title: 'The neighbours noticed', text: `${fullName(neighbour)} from down the street complained about the smell coming off ${firstName(who)}. Rude, but… fair.`, agentId: who.id });
  },
  [EFFECT.lottery]: (ctx, ec, params) => {
    const amount = Math.round(clamp(num(params?.amount, 500), 0, 100000));
    if (amount <= 0) return;
    ctx.earn(amount, 'Lottery ticket', `lottery:${ctx.state.tick}`);
    const who = pickMember(ctx, ec, params);
    grantMoodlet(ctx, who, M.lotteryWinner);
    sfx(ctx, 'cash');
    ctx.notify({ kind: 'money', title: 'Lottery winner!', text: `A scratch card in the mail paid out $${amount}! ${who ? firstName(who) + ' has already spent it, mentally, on embalming fluid.' : ''}`, agentId: who?.id ?? null });
  },
  [EFFECT.fanLetter]: (ctx, ec, params) => {
    const who = pickMember(ctx, ec, params);
    if (!who) return;
    const lo = Math.max(0, Math.round(num(params?.min, 5)));
    const hi = Math.max(lo, Math.round(num(params?.max, 25)));
    const amount = ctx.rng.int(lo, hi);
    if (amount > 0) ctx.earn(amount, 'Fan letter', `fanLetter:${ctx.state.tick}`);
    grantMoodlet(ctx, who, M.fanMail);
    const line = FAN_LINES[Math.floor(ctx.rng.next() * FAN_LINES.length)] ?? FAN_LINES[0];
    ctx.notify({ kind: 'good', title: `Fan mail for ${firstName(who)}`, text: `${line}${amount > 0 ? ` Enclosed: $${amount} “for formaldehyde”.` : ''}`, agentId: who.id });
  },
  [EFFECT.chainLetter]: (ctx, ec, params) => {
    const who = pickMember(ctx, ec, params);
    if (!who) return;
    if (params?.forward === true) {
      grantMoodlet(ctx, who, M.chainLetterSpread);
      const known = relsOf(ctx, who.id)
        .filter(({ other, rel }) => rel.met && ctx.state.agents[other]?.role === 'townie')
        .slice(0, 3);
      for (const { rel } of known) addFriendship(rel, -1);
      ctx.notify({ kind: 'info', title: 'Curse delegated', text: `${firstName(who)} forwarded the chain letter.${known.length ? ` ${known.length} acquaintance${known.length === 1 ? ' is' : 's are'} mildly annoyed.` : ''}`, agentId: who.id });
    } else if (ctx.rng.chance(0.5)) {
      grantMoodlet(ctx, who, M.cursedChainLetter);
      ctx.notify({ kind: 'bad', title: 'Cursed (probably)', text: `${firstName(who)} binned the chain letter. A crow has been staring at them ever since.`, agentId: who.id });
    } else {
      ctx.notify({ kind: 'info', title: 'Chain letter binned', text: `${firstName(who)} tossed the chain letter. Nothing happened. Yet.`, agentId: who.id });
    }
  },
  [EFFECT.ravenThief]: (ctx, ec, params) => {
    const lo = Math.max(0, Math.round(num(params?.min, 10)));
    const hi = Math.max(lo, Math.round(num(params?.max, 40)));
    const want = ctx.rng.int(lo, hi);
    const take = Math.min(want, Math.max(0, Math.floor(num(ctx.state.household?.funds, 0))));
    const outside = householdOnLot(ctx).filter((a) => !indoorAt(ctx, a.pos));
    const who = outside.length ? pickOne(ctx, outside) : pickMember(ctx, ec, params);
    if (take <= 0) {
      ctx.notify({ kind: 'info', title: 'A raven visited', text: 'A raven searched the yard for anything shiny, found nothing, and left looking disappointed in you.', agentId: who?.id ?? null });
      return;
    }
    if (!ctx.spend(take, 'Raven theft', `raven:${ctx.state.tick}`)) return;
    grantMoodlet(ctx, who, M.outwittedByBird);
    sfx(ctx, 'cashLoss');
    ctx.notify({ kind: 'money', title: 'Raven thief!', text: `A raven swooped down and made off with $${take} worth of shiny things.${who ? ` ${firstName(who)} shook a fist at the sky.` : ''}`, agentId: who?.id ?? null });
  },
  [EFFECT.graveRobber]: (ctx, _ec, params) => {
    const maxValue = num(params?.maxValue, 300);
    const loot: ObjectState[] = [];
    for (const id of Object.keys(ctx.state.objects).sort(compareIds)) {
      const o = ctx.state.objects[id];
      if (!o || o.placement.kind !== 'floor') continue;
      const val = num(o.value, 0);
      if (!(val > 0 && val < maxValue)) continue;
      if ((Array.isArray(o.inUseBy) && o.inUseBy.length) || Object.keys(o.reservedBy ?? {}).length) continue;
      let sellable = true;
      try {
        sellable = ctx.objectDef(o).sellable !== false;
      } catch {
        continue;
      }
      const tags = tagsOf(ctx, o);
      if (!sellable || tags.includes('mailbox') || tags.includes('door') || tags.includes('window')) continue;
      const pos = objectPos(ctx, o);
      if (!pos || indoorAt(ctx, pos)) continue;
      loot.push(o);
    }
    const prize = pickOne(ctx, loot);
    if (!prize) {
      ctx.notify({ kind: 'info', title: 'A grave-robber prowled', text: 'A grave-robber crept through the yard overnight, found nothing worth stealing, and left a disappointed note.', agentId: null });
      return;
    }
    let name = 'something';
    try {
      name = ctx.objectDef(prize).name;
    } catch {
      /* keep */
    }
    ctx.removeObject(prize.id, 'stolen');
    for (const a of householdMembers(ctx)) if (a.presence === 'onLot' || a.presence === 'atWork') grantMoodlet(ctx, a, M.robbed);
    ctx.notify({ kind: 'bad', title: 'Robbed!', text: `A grave-robber stole the ${name} from the yard overnight. Next time, leave a light on.`, agentId: null });
  },
};

// ───────────────────────────── runner ─────────────────────────────

function fireLifeEvent(ctx: SimContext, ev: LifeEventDef): void {
  setFlag(ctx, `ev:${ev.id}`, ctx.state.tick);
  ctx.stat(STAT.lifeEvents, 1, null);
  const nullEc: EffectContext = { actor: null, run: null, def: null, stage: null, targetAgent: null, targetObject: null };
  if (ev.effect && typeof ev.effect.id === 'string') {
    ctx.runEffect(ev.effect, nullEc);
    return;
  }
  const ch = ev.choice;
  if (!ch || !Array.isArray(ch.options) || ch.options.length === 0) return;
  const who = pickMember(ctx, null, {});
  const safe = ch.options.findIndex((o) => o?.params?.safe === true);
  ctx.offerChoice({
    title: ch.title,
    text: ch.text,
    agentId: who?.id ?? null,
    options: ch.options.map((o) => ({ label: o.label, effect: o.effect, params: { ...(o.params ?? {}), ...(who ? { agentId: who.id } : {}) }, tooltip: o.tooltip ?? null })),
    expiresTick: ctx.state.tick + minutesToTicks(120),
    defaultOption: safe >= 0 ? safe : 0,
  });
  sfx(ctx, 'mailbox');
}

export function runLifeEvents(ctx: SimContext): void {
  const list = Array.isArray(ctx.content.lifeEvents) ? ctx.content.lifeEvents : [];
  for (const ev of list) {
    if (!ev || typeof ev.id !== 'string') continue;
    const chance = num(ev.hourlyChance, 0);
    if (!(chance > 0)) continue;
    if (!ev.condition || !ctx.evalCondition(ev.condition, null)) continue;
    if (!ctx.rng.chance(chance)) continue;
    fireLifeEvent(ctx, ev);
  }
}

/** Full-moon nights (time.fullMoon): Moonstruck for the household until dawn, once per night. */
export function moonCheck(ctx: SimContext): void {
  const t = ctx.time;
  if (!t.fullMoon) return;
  const night = t.hour >= 20 ? t.day : t.day - 1;
  if (flagNum(ctx, 'moon', -1) === night) return;
  setFlag(ctx, 'moon', night);
  const minutesToDawn = t.hour >= 20 ? (24 - t.hour + 6) * 60 - t.minute : (6 - t.hour) * 60 - t.minute;
  const members = householdMembers(ctx).filter((a) => a.presence === 'onLot' || a.presence === 'atWork');
  for (const a of members) grantMoodlet(ctx, a, M.moonstruck, { durationMin: Math.max(30, minutesToDawn) });
  if (members.length) ctx.notify({ kind: 'info', title: 'Full moon tonight', text: 'The moon is full and enormous. Everyone feels a little howl-y.', agentId: null });
}

/** Daily: Hopeless Romantics without a partner for 7 days get Lovesick (removed once partnered). Once per day. */
export function lovesickCheck(ctx: SimContext, day: number = ctx.time.day): void {
  if (flagNum(ctx, 'lovesickDay', -1) === day) return;
  setFlag(ctx, 'lovesickDay', day);
  for (const a of householdMembers(ctx)) {
    const key = `single:${a.id}`;
    if (!hasTrait(ctx, a, 'hopelessRomantic') || a.presence === 'gone') {
      delFlag(ctx, key);
      continue;
    }
    if (partnerOf(ctx, a.id)) {
      delFlag(ctx, key);
      dropMoodlet(ctx, a, M.lovesick);
      continue;
    }
    const days = flagNum(ctx, key, 0) + 1;
    setFlag(ctx, key, days);
    if (days >= LOVESICK_DAYS) grantMoodlet(ctx, a, M.lovesick);
  }
}

// ───────────────────────────── trait mood modifiers ─────────────────────────────

export function crowdSize(ctx: SimContext, a: AgentState): number {
  if (a.presence !== 'onLot') return 0;
  const room = roomOf(ctx, a);
  if (!room) return 0;
  let n = 0;
  for (const o of onLotAgents(ctx)) if (roomOf(ctx, o) === room) n++;
  return n;
}

export function traitMoodModifiers(ctx: SimContext, a: AgentState): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  if (a.presence !== 'onLot' && a.presence !== 'atWork') return out;
  const add = (id: string) => {
    const d = ctx.content.moodlets[id];
    if (d && isNum(d.mood) && d.mood !== 0) out.push({ label: d.label, value: d.mood });
  };
  if (hasTrait(ctx, a, 'nightOwl')) add(ctx.time.isNight ? M.nightOwlNight : M.nightOwlDay);
  if (hasTrait(ctx, a, 'vain')) {
    const p = needOf(a, 'preservation');
    if (p >= 80) add(M.vainFresh);
    else if (p < 40) add(M.vainRotten);
  }
  if (a.presence === 'onLot') {
    if (hasTrait(ctx, a, 'loner') && crowdSize(ctx, a) >= 4) add(M.crowded);
    if (hasTrait(ctx, a, 'socialButterfly') && partyActive(ctx)) add(M.inTheirElement);
  }
  return out;
}

export function createEventsSystem(): SimSystem {
  let current: SimContext | null = null;
  return {
    id: SYS.events,
    init(ctx) {
      current = ctx;
    },
    tick(ctx) {
      current = ctx;
    },
    hour(ctx) {
      current = ctx;
      moonCheck(ctx);
      runLifeEvents(ctx);
    },
    dayStart(ctx, day) {
      current = ctx;
      lovesickCheck(ctx, day);
    },
    moodModifiers(ctx, agent) {
      return traitMoodModifiers(ctx, agent);
    },
    effects: eventEffects,
    conditions: eventConditions,
    api: makeApi(() => current, {
      fire: {
        fn: (c, id: unknown) => {
          const ev = Array.isArray(c.content.lifeEvents) ? c.content.lifeEvents.find((e) => e && e.id === id) : undefined;
          if (!ev) return false;
          fireLifeEvent(c, ev);
          return true;
        },
        fallback: () => false,
      },
      crowdSize: {
        fn: (c, agentId: unknown) => {
          const a = typeof agentId === 'string' ? c.agent(agentId) : undefined;
          return a ? crowdSize(c, a) : 0;
        },
        fallback: () => 0,
      },
    }),
  };
}
