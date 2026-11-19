/**
 * `aspirations` system (GDD §12 + reward store §8): hourly + event-driven milestone checks, aspiration points,
 * the Reward Store (trait rewards into agent.rewardTraits, consumables via their effect), the freshness-streak
 * tracker, people condition kinds and the AspirationsApi (+ `check(agentId?)`).
 */
import type { AspirationsApi, AspirationView, EffectHandler, SimContext, SimSystem } from '../../../contracts';
import type { AgentId, AgentState } from '../../../types';
import { SKILL_IDS } from '../../../types';
import { COND, EFFECT, MOODLET as M, STAT, SYS } from '../../../content/people/ids';
import {
  clamp,
  firstName,
  flagBool,
  flagNum,
  fx,
  grantMoodlet,
  householdMembers,
  isCouple,
  isHousehold,
  isNum,
  makeApi,
  num,
  relsOf,
  safeSkill,
  setFlag,
  sfx,
} from '../util';
import { friendCount, maxRomance } from '../social/relations';

export const FRESH_MIN = 70;

function ensureFields(a: AgentState): void {
  if (!Array.isArray(a.aspirationMilestones)) a.aspirationMilestones = [];
  if (!isNum(a.aspirationPoints) || a.aspirationPoints < 0) a.aspirationPoints = 0;
  if (!Array.isArray(a.rewardTraits)) a.rewardTraits = [];
}

/** Check one agent (or every household member); returns the milestone ids completed now. */
export function checkMilestones(ctx: SimContext, agentId?: AgentId | null): string[] {
  const done: string[] = [];
  const list = typeof agentId === 'string' ? householdMembers(ctx).filter((a) => a.id === agentId) : householdMembers(ctx);
  for (const a of list) {
    if (a.presence === 'gone') continue;
    const def = a.aspiration ? ctx.content.aspirations[a.aspiration] : undefined;
    if (!def || !Array.isArray(def.milestones)) continue;
    ensureFields(a);
    let changed = false;
    for (const m of def.milestones) {
      if (!m || typeof m.id !== 'string' || a.aspirationMilestones.includes(m.id)) continue;
      if (!m.condition || !ctx.evalCondition(m.condition, a)) continue;
      a.aspirationMilestones.push(m.id);
      const pts = Math.max(0, Math.round(num(m.points, 0)));
      a.aspirationPoints += pts;
      changed = true;
      done.push(m.id);
      ctx.stat(STAT.milestones, 1, a.id);
      ctx.emit({ type: 'milestone', agentId: a.id, aspirationId: def.id, milestoneId: m.id });
      sfx(ctx, 'milestone', { agentId: a.id });
      if (a.presence === 'onLot') fx(ctx, 'sparkle', { agentId: a.id });
      ctx.notify({ kind: 'good', title: `Milestone: ${m.label}`, text: `${firstName(a)} earned ${pts} aspiration points (${def.name}).`, agentId: a.id });
    }
    if (changed && def.milestones.every((m) => a.aspirationMilestones.includes(m.id))) {
      ctx.notify({ kind: 'good', title: 'Aspiration complete!', text: `${firstName(a)} has fulfilled “${def.name}”. Spend those points in the Reward Store.`, agentId: a.id });
    }
  }
  return done;
}

export function aspirationView(ctx: SimContext, agentId: AgentId): AspirationView | null {
  const a = typeof agentId === 'string' ? ctx.agent(agentId) : undefined;
  if (!a || !a.aspiration) return null;
  const def = ctx.content.aspirations[a.aspiration];
  if (!def) return null;
  const done = Array.isArray(a.aspirationMilestones) ? a.aspirationMilestones : [];
  const owned = Array.isArray(a.rewardTraits) ? a.rewardTraits : [];
  const points = isNum(a.aspirationPoints) ? Math.max(0, a.aspirationPoints) : 0;
  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    points,
    milestones: def.milestones.map((m) => ({ id: m.id, label: m.label, points: m.points, done: done.includes(m.id) })),
    rewards: Object.values(ctx.content.rewards).map((r) => {
      const isOwned = r.kind === 'trait' && !!r.traitId && owned.includes(r.traitId);
      return { id: r.id, name: r.name, description: r.description, cost: r.cost, owned: isOwned, affordable: !isOwned && points >= r.cost, icon: r.icon };
    }),
  };
}

export function buyReward(ctx: SimContext, agentId: AgentId, rewardId: string): true | string {
  const a = typeof agentId === 'string' ? ctx.agent(agentId) : undefined;
  if (!a) return 'Unknown zombie';
  if (!isHousehold(ctx, a)) return 'Only household members can shop here';
  if (a.presence === 'crumbled' || a.presence === 'gone') return 'Rewards are for the (un)living';
  const r = typeof rewardId === 'string' ? ctx.content.rewards[rewardId] : undefined;
  if (!r) return 'No such reward';
  ensureFields(a);
  const cost = Math.max(0, Math.round(num(r.cost, 0)));
  if (r.kind === 'trait') {
    if (!r.traitId || !ctx.content.traits[r.traitId]) return 'That reward is out of stock';
    if (a.rewardTraits.includes(r.traitId) || (Array.isArray(a.traits) && a.traits.includes(r.traitId))) return 'Already owned';
  } else {
    if (!r.effect || typeof r.effect.id !== 'string') return 'That reward is out of stock';
    if (r.effect.id === EFFECT.addVitality && num(a.vitality, 100) >= 100) return 'Vitality is already at its peak';
  }
  if (a.aspirationPoints < cost) return `Needs ${cost - a.aspirationPoints} more aspiration points`;
  a.aspirationPoints -= cost;
  if (r.kind === 'trait' && r.traitId) a.rewardTraits.push(r.traitId);
  else if (r.effect) ctx.runEffect(r.effect, { actor: a, run: null, def: null, stage: null, targetAgent: null, targetObject: null });
  sfx(ctx, 'milestone', { agentId: a.id });
  if (a.presence === 'onLot') fx(ctx, 'sparkle', { agentId: a.id });
  ctx.notify({ kind: 'good', title: `Reward: ${r.name}`, text: `${firstName(a)} spent ${cost} aspiration points. ${r.description}`, agentId: a.id });
  return true;
}

export const addVitalityEffect: EffectHandler = (ctx, ec, params) => {
  const id = typeof params?.agentId === 'string' ? params.agentId : null;
  const a = ec?.actor ?? (id ? ctx.agent(id) : undefined);
  if (!a) return;
  const amount = clamp(num(params?.amount, 20), 0, 80);
  a.vitality = clamp(num(a.vitality, 100) + amount, 20, 100);
  if (num(a.needs?.preservation, 0) > a.vitality) a.needs.preservation = a.vitality;
  grantMoodlet(ctx, a, M.secondWind);
  sfx(ctx, 'zap', { agentId: a.id });
  if (a.presence === 'onLot') fx(ctx, 'zap', { agentId: a.id });
};

// ───────────────────────────── freshness streak ─────────────────────────────

function livingMembers(ctx: SimContext): AgentState[] {
  return householdMembers(ctx).filter((a) => a.presence === 'onLot' || a.presence === 'atWork' || a.presence === 'offLot');
}

export function sampleFreshness(ctx: SimContext): void {
  const m = livingMembers(ctx);
  if (m.length === 0) return;
  let sum = 0;
  for (const a of m) sum += clamp(num(a.needs?.preservation, 0), 0, 100);
  if (sum / m.length < FRESH_MIN) setFlag(ctx, 'fresh:dayOk', false);
  setFlag(ctx, 'fresh:samples', flagNum(ctx, 'fresh:samples', 0) + 1);
}

export function closeFreshDay(ctx: SimContext, day: number): void {
  if (flagNum(ctx, 'fresh:day', -1) === day) return;
  setFlag(ctx, 'fresh:day', day);
  const samples = flagNum(ctx, 'fresh:samples', 0);
  const ok = samples > 0 && !(ctx.state.flags?.['people:fresh:dayOk'] === false);
  setFlag(ctx, 'fresh:streak', ok ? flagNum(ctx, 'fresh:streak', 0) + 1 : 0);
  setFlag(ctx, 'fresh:dayOk', true);
  setFlag(ctx, 'fresh:samples', 0);
}

export function freshStreak(ctx: SimContext): number {
  return flagNum(ctx, 'fresh:streak', 0);
}

// ───────────────────────────── conditions ─────────────────────────────

export const aspirationConditions: Record<string, (ctx: SimContext, agent: AgentState | null, params: Record<string, any>) => boolean> = {
  [COND.friends]: (ctx, agent, p) => !!agent && friendCount(ctx, agent.id, isNum(p?.minFriendship) ? p.minFriendship : undefined) >= num(p?.min, 1),
  [COND.relationshipFlag]: (ctx, agent, p) => {
    if (!agent) return false;
    const flag = typeof p?.flag === 'string' ? p.flag : '';
    if (flag === 'kissed') return num(ctx.statValue(STAT.kisses, agent.id), 0) > 0;
    for (const { other, rel } of relsOf(ctx, agent.id)) {
      if (!ctx.state.agents[other]) continue;
      if (flag === 'partners' && isCouple(rel)) return true;
      if (flag === 'engaged' && (rel.engaged || rel.married)) return true;
      if (flag === 'married' && rel.married) return true;
      if (flag === 'bestFriends' && rel.bestFriends) return true;
    }
    return false;
  },
  [COND.romanceMax]: (ctx, agent, p) => !!agent && maxRomance(ctx, agent.id) >= num(p?.min, 100),
  [COND.skillsAtLevel]: (ctx, agent, p) => {
    if (!agent) return false;
    const level = num(p?.level, 5);
    return SKILL_IDS.filter((s) => safeSkill(ctx, agent, s) >= level).length >= num(p?.count, 3);
  },
  [COND.freshStreak]: (ctx, _agent, p) => freshStreak(ctx) >= num(p?.days, 7),
};

export function createAspirationsSystem(): SimSystem {
  let current: SimContext | null = null;
  const api = makeApi(() => current, {
    view: { fn: (c, agentId: AgentId) => aspirationView(c, agentId), fallback: () => null },
    buyReward: { fn: (c, agentId: AgentId, rewardId: string) => buyReward(c, agentId, rewardId), fallback: () => 'The Reward Store is closed' },
    check: { fn: (c, agentId?: unknown) => checkMilestones(c, typeof agentId === 'string' ? agentId : null), fallback: () => [] },
    freshStreak: { fn: (c) => freshStreak(c), fallback: () => 0 },
  }) satisfies Record<keyof AspirationsApi, unknown>;
  return {
    id: SYS.aspirations,
    init(ctx) {
      current = ctx;
      for (const a of householdMembers(ctx)) ensureFields(a);
      if (!flagBool(ctx, 'fresh:init')) {
        setFlag(ctx, 'fresh:init', true);
        setFlag(ctx, 'fresh:dayOk', true);
      }
    },
    tick(ctx) {
      current = ctx;
    },
    hour(ctx) {
      current = ctx;
      sampleFreshness(ctx);
      checkMilestones(ctx);
    },
    dayStart(ctx, day) {
      current = ctx;
      closeFreshDay(ctx, day);
    },
    effects: { [EFFECT.addVitality]: addVitalityEffect },
    conditions: aspirationConditions,
    api,
  };
}
