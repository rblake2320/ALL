/**
 * Relationship labels, views, daily drift and small mutators shared by the social outcomes and other systems.
 * GDD §9: friendship −100..100, romance 0..100, labels Stranger/Acquaintance/Friend/Good Friend/Best Friend/
 * Disliked/Nemesis, romance labels Crush/Partner/Fiancé(e)/Spouse. Drift: friendship → 0 by 1/day without
 * interaction (2/day if ≥ 60); romance −2/day without romantic interaction.
 */
import type { RelationshipView, SimContext } from '../../../contracts';
import type { AgentId, Relationship } from '../../../types';
import { clamp, compareIds, delFlag, flagKeys, flagNum, fullName, isHousehold, isNum, num, peekRel, relKey, relsOf, setFlag, TICKS_PER_DAY } from '../util';

export const FRIEND_THRESHOLD = 35;

export function friendshipLabel(r: Readonly<Relationship>): string {
  if (!r.met) return 'Stranger';
  if (r.bestFriends) return 'Best Friend';
  const f = num(r.friendship, 0);
  if (f <= -70) return 'Nemesis';
  if (f <= -35) return 'Disliked';
  if (f >= 60) return 'Good Friend';
  if (f >= FRIEND_THRESHOLD) return 'Friend';
  return 'Acquaintance';
}

export function relationshipLabel(r: Readonly<Relationship>): string {
  if (r.married) return 'Spouse';
  if (r.engaged) return 'Fiancé(e)';
  if (r.partners) return 'Partner';
  const base = friendshipLabel(r);
  if (r.met && num(r.romance, 0) >= 30) return base === 'Acquaintance' ? 'Crush' : `${base} · Crush`;
  return base;
}

export function labelBetween(ctx: SimContext, a: AgentId, b: AgentId): string {
  if (typeof a !== 'string' || typeof b !== 'string' || a === b) return 'Stranger';
  return relationshipLabel(peekRel(ctx, a, b));
}

/** Everyone `agentId` has met (plus anyone with non-zero feelings), best first. Service NPCs excluded. */
export function relationshipViews(ctx: SimContext, agentId: AgentId): RelationshipView[] {
  if (typeof agentId !== 'string' || !ctx.state.agents[agentId]) return [];
  const out: RelationshipView[] = [];
  for (const { other, rel } of relsOf(ctx, agentId)) {
    const o = ctx.state.agents[other];
    if (!o || o.role === 'service' || o.presence === 'gone') continue;
    if (!rel.met && !num(rel.friendship, 0) && !num(rel.romance, 0)) continue;
    out.push({
      otherId: other,
      name: fullName(o),
      friendship: Math.round(clamp(num(rel.friendship, 0), -100, 100)),
      romance: Math.round(clamp(num(rel.romance, 0), 0, 100)),
      label: relationshipLabel(rel),
      inHousehold: isHousehold(ctx, o),
      onLot: o.presence === 'onLot',
    });
  }
  out.sort((x, y) => {
    const cx = x.label === 'Spouse' || x.label === 'Fiancé(e)' || x.label === 'Partner' ? 1 : 0;
    const cy = y.label === 'Spouse' || y.label === 'Fiancé(e)' || y.label === 'Partner' ? 1 : 0;
    if (cx !== cy) return cy - cx;
    if (x.friendship !== y.friendship) return y.friendship - x.friendship;
    return compareIds(x.otherId, y.otherId);
  });
  return out;
}

/** Number of friends (met, friendship ≥ min or best friends), excluding service NPCs. */
export function friendCount(ctx: SimContext, agentId: AgentId, minFriendship = FRIEND_THRESHOLD): number {
  let n = 0;
  for (const { other, rel } of relsOf(ctx, agentId)) {
    const o = ctx.state.agents[other];
    if (!o || o.role === 'service') continue;
    if (rel.met && (rel.bestFriends || num(rel.friendship, 0) >= minFriendship)) n++;
  }
  return n;
}

export function maxRomance(ctx: SimContext, agentId: AgentId): number {
  let m = 0;
  for (const { rel } of relsOf(ctx, agentId)) m = Math.max(m, clamp(num(rel.romance, 0), 0, 100));
  return m;
}

/** Writable relationship (created on demand by the engine). Sanitises non-finite numbers. */
export function writableRel(ctx: SimContext, a: AgentId, b: AgentId): Relationship {
  const r = ctx.rel(a, b);
  if (!isNum(r.friendship)) r.friendship = 0;
  if (!isNum(r.romance)) r.romance = 0;
  if (!isNum(r.interactions)) r.interactions = 0;
  if (!isNum(r.lastInteractionTick)) r.lastInteractionTick = -1;
  return r;
}

export function addFriendship(r: Relationship, delta: number): number {
  const before = num(r.friendship, 0);
  r.friendship = clamp(before + num(delta, 0), -100, 100);
  return r.friendship - before;
}

export function addRomance(r: Relationship, delta: number): number {
  const before = num(r.romance, 0);
  r.romance = clamp(before + num(delta, 0), 0, 100);
  return r.romance - before;
}

export function markRomantic(ctx: SimContext, a: AgentId, b: AgentId): void {
  setFlag(ctx, `rom:${relKey(a, b)}`, ctx.state.tick);
}

/** Daily drift (dayStart). Idempotent per day via a stamp. */
export function dailyDrift(ctx: SimContext, day: number): void {
  if (flagNum(ctx, 'driftDay', -1) === day) return;
  setFlag(ctx, 'driftDay', day);
  const now = ctx.state.tick;
  const all = ctx.state.relationships ?? {};
  for (const key of Object.keys(all).sort()) {
    const r = all[key];
    if (!r || typeof r !== 'object') continue;
    if (!isNum(r.friendship)) r.friendship = 0;
    if (!isNum(r.romance)) r.romance = 0;
    const last = isNum(r.lastInteractionTick) ? r.lastInteractionTick : -1;
    if (now - last >= TICKS_PER_DAY) {
      const f = r.friendship;
      if (f > 0) r.friendship = Math.max(0, f - (f >= 60 ? 2 : 1));
      else if (f < 0) r.friendship = Math.min(0, f + 1);
    }
    const lastRom = flagNum(ctx, `rom:${key}`, -1);
    if (r.romance > 0 && now - Math.max(lastRom, -1) >= TICKS_PER_DAY) r.romance = Math.max(0, r.romance - 2);
    if (r.romance <= 0 && lastRom >= 0 && now - lastRom >= 30 * TICKS_PER_DAY) delFlag(ctx, `rom:${key}`);
    if (r.bestFriends && r.friendship < 0) r.bestFriends = false;
  }
  for (const k of flagKeys(ctx, 'mean:')) if (now - flagNum(ctx, k, now) > 2 * TICKS_PER_DAY) delFlag(ctx, k);
  for (const k of flagKeys(ctx, 'last:')) if (!all[k.slice('last:'.length)]) delFlag(ctx, k);
}
