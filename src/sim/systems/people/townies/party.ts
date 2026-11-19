/**
 * Parties (GDD §11): Throw a Party (phone) → up to 6 guests arrive over 60 min → 4 h of scoring every 15 min from
 * guests' mood + fun, music playing and food out (× host traitMult('partyScore')) → Legendary (≥ 70) / Lame (≤ 30).
 */
import type { PartyView, SimContext } from '../../../contracts';
import type { AgentId, AgentState } from '../../../types';
import { MOODLET as M, STAT } from '../../../content/people/ids';
import {
  clamp,
  compareIds,
  delFlag,
  firstName,
  flagNum,
  fullName,
  fx,
  grantMoodlet,
  householdOnLot,
  isGuest,
  isHousehold,
  minutesToTicks,
  needOf,
  num,
  peekRel,
  safeMood,
  setFlag,
  sfx,
  traitMult,
  townies,
} from '../util';
import { cancelArrival, pendingArrival, scheduleArrival, sendVisitorHome } from './visitorOps';
import { clockLabel } from '../careers/schedule';
import { addFriendship, writableRel } from '../social/relations';
import { checkMilestones } from '../aspirations';

export const PARTY_MINUTES = 240;
export const PARTY_MAX_GUESTS = 6;
export const PARTY_ARRIVAL_WINDOW_MIN = 60;
export const PARTY_SAMPLE_MIN = 15;
export const LEGENDARY_AT = 70;
export const LAME_AT = 30;

const SUM = 'party:sum';
const SAMPLES = 'party:samples';
const LAST = 'party:lastSample';

export function partyActive(ctx: SimContext): boolean {
  const p = ctx.state.party;
  return !!p && !p.ended;
}

/** Any working stereo that is playing (in use, or flagged playing/on by HOME). */
export function musicPlaying(ctx: SimContext): boolean {
  for (const id of Object.keys(ctx.state.objects)) {
    const o = ctx.state.objects[id];
    if (!o) continue;
    let tags: string[] = [];
    try {
      tags = ctx.objectDef(o).tags ?? [];
    } catch {
      continue;
    }
    if (!tags.includes('stereo') || o.condition?.broken) continue;
    if (!ctx.powered(o)) continue;
    if ((Array.isArray(o.inUseBy) && o.inUseBy.length > 0) || o.data?.playing === true || o.data?.on === true) return true;
  }
  return false;
}

/** Food out: a meal/pizza item somewhere on the lot with servings left. */
export function foodOut(ctx: SimContext): boolean {
  for (const id of Object.keys(ctx.state.objects)) {
    const o = ctx.state.objects[id];
    if (!o || o.placement.kind === 'held') continue;
    let tags: string[] = [];
    try {
      tags = ctx.objectDef(o).tags ?? [];
    } catch {
      continue;
    }
    if (!tags.includes('meal')) continue;
    const s = o.data?.servings;
    if (s === undefined || s === null || num(s, 0) > 0) return true;
  }
  return false;
}

/** Parse a player-picked guest list ('a12,a14' or an array) into unique ids. */
export function parseGuestList(raw: unknown): AgentId[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const out: AgentId[] = [];
  for (const p of parts) {
    const id = typeof p === 'string' ? p.trim() : '';
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function startParty(ctx: SimContext, hostId: AgentId, pickedGuests?: readonly AgentId[]): true | string {
  const host = typeof hostId === 'string' ? ctx.agent(hostId) : undefined;
  if (!host || !isHousehold(ctx, host)) return 'Only household members can host';
  if (host.presence !== 'onLot') return `${firstName(host)} isn’t home`;
  if (partyActive(ctx)) return 'A party is already in full swing';
  if (needOf(host, 'fun') < 30) return 'Too gloomy to host a party';
  const now = ctx.state.tick;

  // Guests: best friends of the host first, then other acquaintances, then curious strangers.
  const candidates = townies(ctx).filter((t) => t.presence === 'offLot' && !pendingArrival(ctx, t.id));
  const score = (t: AgentState) => {
    const r = peekRel(ctx, host.id, t.id);
    return (r.met ? 1000 : 0) + num(r.friendship, 0);
  };
  candidates.sort((a, b) => score(b) - score(a) || compareIds(a.id, b.id));
  const met = candidates.filter((t) => peekRel(ctx, host.id, t.id).met && num(peekRel(ctx, host.id, t.id).friendship, 0) > -35);
  const strangers = candidates.filter((t) => !peekRel(ctx, host.id, t.id).met);
  ctx.rng.shuffle(strangers);
  // Visitors already here join the party (they count toward the 6-guest cap; extras just keep visiting).
  const already = Object.values(ctx.state.agents)
    .filter((a) => a && isGuest(a) && a.visit && !a.visit.leaving)
    .sort((a, b) => compareIds(a.id, b.id))
    .slice(0, PARTY_MAX_GUESTS);
  const room = Math.max(0, PARTY_MAX_GUESTS - already.length);
  const picked = (pickedGuests ?? []).map((id) => candidates.find((t) => t.id === id)).filter((t): t is AgentState => !!t);
  const invited = picked.length > 0 ? picked.slice(0, room) : [...met, ...strangers].slice(0, room);
  const endTick = now + minutesToTicks(PARTY_MINUTES);
  for (const g of already) {
    g.visit!.reason = 'party';
    g.visit!.welcomed = true;
    g.visit!.leaveTick = endTick;
  }
  if (invited.length === 0 && already.length === 0) return 'Nobody in town is free to come';

  for (const g of invited) scheduleArrival(ctx, g.id, 5 + Math.floor(ctx.rng.next() * (PARTY_ARRIVAL_WINDOW_MIN - 5)), 'party');
  ctx.state.party = { hostId: host.id, startTick: now, endTick, guestIds: [...already.map((a) => a.id), ...invited.map((a) => a.id)], score: 50, ended: false };
  setFlag(ctx, SUM, 0);
  setFlag(ctx, SAMPLES, 0);
  setFlag(ctx, LAST, now);
  ctx.stat(STAT.partiesThrown, 1, null);
  ctx.stat(STAT.partiesThrown, 1, host.id);
  ctx.emit({ type: 'music', mood: 'party' });
  sfx(ctx, 'partyHorn', { agentId: host.id });
  fx(ctx, 'confetti', { agentId: host.id });
  ctx.notify({
    kind: 'social',
    title: 'Party time!',
    text: `${firstName(host)} is throwing a party until ${clockLabel(endTick)}. ${ctx.state.party.guestIds.length} guest${ctx.state.party.guestIds.length === 1 ? '' : 's'} on the way. Put on some music and set out some food!`,
    agentId: host.id,
  });
  checkMilestones(ctx, host.id);
  return true;
}

function sample(ctx: SimContext): void {
  const p = ctx.state.party!;
  const guests = p.guestIds.map((id) => ctx.state.agents[id]).filter((a): a is AgentState => !!a && a.presence === 'onLot');
  if (guests.length === 0) return;
  let moodSum = 0;
  let funSum = 0;
  for (const g of guests) {
    moodSum += (safeMood(ctx, g) + 100) / 2;
    funSum += needOf(g, 'fun');
  }
  let s = 0.45 * (moodSum / guests.length) + 0.25 * (funSum / guests.length) + (musicPlaying(ctx) ? 15 : 0) + (foodOut(ctx) ? 10 : 0);
  const host = ctx.state.agents[p.hostId];
  if (host) s *= traitMult(ctx, host, 'partyScore');
  s = clamp(s, 0, 100);
  const sum = flagNum(ctx, SUM, 0) + s;
  const n = flagNum(ctx, SAMPLES, 0) + 1;
  setFlag(ctx, SUM, sum);
  setFlag(ctx, SAMPLES, n);
  p.score = Math.round(clamp(sum / n, 0, 100));
}

export function partyTick(ctx: SimContext): void {
  const p = ctx.state.party;
  if (!p || p.ended) return;
  if (!Array.isArray(p.guestIds)) p.guestIds = [];
  const now = ctx.state.tick;
  if (!Number.isFinite(p.endTick) || now >= p.endTick) return endParty(ctx);
  if (now - flagNum(ctx, LAST, p.startTick) >= minutesToTicks(PARTY_SAMPLE_MIN)) {
    setFlag(ctx, LAST, now);
    sample(ctx);
  }
}

export function endParty(ctx: SimContext): void {
  const p = ctx.state.party;
  if (!p || p.ended) return;
  p.ended = true;
  if (flagNum(ctx, SAMPLES, 0) <= 0) sample(ctx);
  const score = Math.round(clamp(num(p.score, 50), 0, 100));
  p.score = score;
  const host = ctx.state.agents[p.hostId] ?? null;
  const present = householdOnLot(ctx);
  const guests = p.guestIds.map((id) => ctx.state.agents[id]).filter((a): a is AgentState => !!a && a.presence === 'onLot' && isGuest(a));
  const legendary = score >= LEGENDARY_AT;
  const lame = score <= LAME_AT;

  for (const id of p.guestIds) if (pendingArrival(ctx, id)?.reason === 'party') cancelArrival(ctx, id);
  if (legendary) {
    for (const a of present) grantMoodlet(ctx, a, M.legendaryParty);
    for (const g of guests) grantMoodlet(ctx, g, M.legendaryParty);
    ctx.stat(STAT.legendaryParties, 1, null);
    if (host) ctx.stat(STAT.legendaryParties, 1, host.id);
    sfx(ctx, 'cheer');
  } else if (lame) {
    for (const a of present) grantMoodlet(ctx, a, M.lameParty);
    ctx.stat(STAT.lameParties, 1, null);
    if (host) ctx.stat(STAT.lameParties, 1, host.id);
    sfx(ctx, 'sadSting');
  } else if (host) grantMoodlet(ctx, host, M.goodHost);

  if (host) {
    const delta = legendary ? 10 : lame ? -3 : 4;
    for (const g of guests) {
      const r = writableRel(ctx, host.id, g.id);
      r.met = true;
      addFriendship(r, delta);
      r.lastInteractionTick = ctx.state.tick;
    }
  }
  guests.forEach((g, i) => {
    if (!g.visit) return;
    g.visit.leaveTick = ctx.state.tick + minutesToTicks(i * 3);
    if (i === 0) sendVisitorHome(ctx, g, 'party over');
  });
  delFlag(ctx, SUM);
  delFlag(ctx, SAMPLES);
  delFlag(ctx, LAST);
  ctx.emit({ type: 'music', mood: lame ? 'sad' : 'normal' });
  const verdict = legendary
    ? 'LEGENDARY! People will talk about this one for decades. Several guests are still in the bathtub.'
    : lame
      ? 'Lame. Three guests, no music, one sad bowl of brain dip.'
      : 'A perfectly respectable party. Nobody fell apart. Well, nobody important.';
  ctx.notify({ kind: legendary ? 'good' : lame ? 'bad' : 'social', title: `Party over (score ${score})`, text: `${host ? fullName(host) + '’s party: ' : ''}${verdict}`, agentId: host?.id ?? null });
  if (host) {
    checkMilestones(ctx, host.id);
  }
}

export function partyView(ctx: SimContext): PartyView | null {
  const p = ctx.state.party;
  if (!p) return null;
  const guests = Array.isArray(p.guestIds) ? p.guestIds.filter((id) => ctx.state.agents[id]?.presence === 'onLot').length : 0;
  return { active: !p.ended, score: Math.round(clamp(num(p.score, 0), 0, 100)), endsLabel: p.ended ? 'Party’s over' : `Ends ${clockLabel(p.endTick)}`, guests };
}
