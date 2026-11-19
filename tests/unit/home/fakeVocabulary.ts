/**
 * The subset of SIM-ENGINE's generic effect / requirement / condition vocabulary that home content uses,
 * re-implemented for the FakeSim (see src/sim/engine/README.md §2–§4 for the real semantics).
 */
import type { EffectContext, EffectHandler, InteractionBehavior, RequirementCheck, RequirementContext, SimContext } from '../../../src/sim/contracts';
import type { AgentState, NeedId } from '../../../src/sim/types';
import type { FakeHost } from './fakeCtx';

export interface FakeVocabulary {
  effects: Record<string, EffectHandler>;
  requirements: Record<string, RequirementCheck>;
  behaviors: Record<string, InteractionBehavior>;
  conditions: Record<string, (ctx: SimContext, a: AgentState | null, p: Record<string, any>) => boolean>;
}

export function engineVocabulary(host: FakeHost): FakeVocabulary {
  const who = (ec: EffectContext, w: unknown): AgentState[] => {
    const out: AgentState[] = [];
    if ((w === undefined || w === 'actor' || w === 'both') && ec.actor) out.push(ec.actor);
    if ((w === 'target' || w === 'both') && ec.targetAgent) out.push(ec.targetAgent);
    return out;
  };
  const effects: Record<string, EffectHandler> = {
    needs: (ctx, ec, p) => {
      for (const a of who(ec, p.who)) for (const [n, d] of Object.entries(p.deltas ?? {})) ctx.changeNeed(a, n as NeedId, d as number, { raw: !!p.raw });
    },
    moodlet: (ctx, ec, p) => {
      if (p.chance !== undefined && !ctx.rng.chance(p.chance)) return;
      for (const a of who(ec, p.who)) ctx.addMoodlet(a, p.id, { durationMin: p.durationMin });
    },
    removeMoodlet: (ctx, ec, p) => {
      for (const a of who(ec, p.who)) ctx.removeMoodlet(a, p.id);
    },
    xp: (ctx, ec, p) => {
      for (const a of who(ec, p.who)) ctx.addXp(a, p.skill, p.amount);
    },
    spend: (ctx, _ec, p) => {
      ctx.spend(p.amount, p.reason, host.effectKey ?? undefined);
    },
    earn: (ctx, _ec, p) => ctx.earn(p.amount, p.reason, host.effectKey ?? undefined),
    notify: (ctx, ec, p) => ctx.notify({ kind: p.kind, title: p.title, text: p.text, agentId: ec.actor?.id ?? null }),
    bubble: (ctx, ec, p) => ec.actor && ctx.emit({ type: 'bubble', agentId: ec.actor.id, icon: p.icon, style: p.style ?? 'thought' }),
    fx: (ctx, ec, p) => ctx.emit({ type: 'fx', kind: p.kind, agentId: ec.actor?.id }),
    sfx: (ctx, ec, p) => ctx.emit({ type: 'sfx', id: p.id, agentId: ec.actor?.id }),
    voice: (ctx, ec, p) => ec.actor && ctx.emit({ type: 'voice', agentId: ec.actor.id, emotion: p.emotion, durationMs: 1200 }),
    carry: (_ctx, ec, p) => {
      if (ec.actor) ec.actor.carrying = p.item ?? null;
    },
    clearDirt: (ctx, ec) => {
      if (ec.targetObject) {
        ec.targetObject.condition.dirt = 0;
        ctx.markChanged(ec.targetObject);
      }
    },
    stat: (ctx, ec, p) => ctx.stat(p.key, p.amount ?? 1, p.perAgent && ec.actor ? ec.actor.id : null),
    repair: (ctx, ec) => {
      if (ec.targetObject) ec.targetObject.condition.broken = false;
    },
  };
  const R = (fn: (rc: RequirementContext, p: Record<string, any>) => true | string): RequirementCheck => (_ctx, rc, p) => {
    const r = fn(rc, p ?? {});
    return r === true ? true : typeof p?.reason === 'string' ? p.reason : r;
  };
  const tagUsable = (tag: string) =>
    Object.values(host.state.objects).some((o) => host.content.objects[o.defId].tags.includes(tag) && !o.condition.broken && o.placement.kind !== 'held');
  const requirements: Record<string, RequirementCheck> = {
    power: R((rc) => (!host.state.household.utilitiesOn ? 'The power is out' : rc.targetObject?.condition.broken ? 'is broken' : true)),
    notBroken: R((rc) => (rc.targetObject?.condition.broken ? 'is broken' : true)),
    broken: R((rc) => (rc.targetObject?.condition.broken ? true : "It isn't broken")),
    skill: R((rc, p) => (host.ctx.skillLevel(rc.actor, p.skill) >= p.min ? true : `Needs ${p.skill} ${p.min}`)),
    funds: R((_rc, p) => (host.state.household.funds >= p.min ? true : `Needs $${p.min}`)),
    arms: R((rc, p) => (host.ctx.limbCount(rc.actor, 'arm') >= p.min ? true : 'Needs an arm')),
    legs: R((rc, p) => (host.ctx.limbCount(rc.actor, 'leg') >= p.min ? true : 'Needs a leg')),
    tagOnLot: R((_rc, p) => (tagUsable(p.tag) ? true : `Needs a ${p.tag}`)),
    trait: R((rc, p) => (rc.actor.traits.includes(p.id) ? true : 'Requires trait')),
    notTrait: R((rc, p) => (!rc.actor.traits.includes(p.id) ? true : 'Trait refuses')),
    household: R((rc) => (host.ctx.isHousehold(rc.actor) ? true : 'Household only')),
    needBelow: R((rc, p) => (rc.actor.needs[p.need as NeedId] < p.max ? true : 'Not needed')),
    needAbove: R((rc, p) => (rc.actor.needs[p.need as NeedId] > p.min ? true : 'Too low')),
    notCarrying: R((rc) => (rc.actor.carryObjectId ? 'Hands are full' : true)),
    carrying: R((rc) => (rc.actor.carryObjectId || rc.actor.carrying ? true : 'Not carrying anything')),
    targetData: R((rc, p) => {
      const v = rc.targetObject?.data?.[p.key];
      if (p.min !== undefined && !(typeof v === 'number' && v >= p.min)) return 'Not available';
      if (p.max !== undefined && !(typeof v === 'number' && v <= p.max)) return 'Not available';
      if (p.equals !== undefined && v !== p.equals) return 'Not available';
      if (p.truthy && !v) return 'Not available';
      return true;
    }),
    notSelf: R((rc) => (rc.targetAgent && rc.targetAgent.id === rc.actor.id ? "Can't do that to yourself" : true)),
    targetOnLot: R((rc) => (rc.targetAgent && rc.targetAgent.presence === 'onLot' ? true : "isn't here")),
    targetAwake: R(() => true),
    outdoors: R(() => true),
    indoors: R(() => true),
  };
  const behaviors: Record<string, InteractionBehavior> = { standard: {} };
  const conditions: FakeVocabulary['conditions'] = {
    always: () => true,
    never: () => false,
    stat: (ctx, a, p) => ctx.statValue(p.key, p.perAgent && a ? a.id : null) >= (p.min ?? 1),
  };
return { effects, requirements, behaviors, conditions };
}
