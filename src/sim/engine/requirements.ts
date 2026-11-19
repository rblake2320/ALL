/** Engine requirement checks (README §3) and condition kinds (README §4). */
import type { ConditionRef, RequirementCheck, RequirementContext } from '../contracts';
import type { AgentState, NeedId, SkillId } from '../types';
import { CARRY_ITEMS } from '../../shared/appearance';
import { ENGINE_INTERACTIONS, ENGINE_REQUIREMENTS } from '../vocabulary';
import { isHouseholdAgent, isVisitorAgent, isWalkBy, limbCount } from './agents';
import { SKILL_NAMES } from './constants';
import { hasMoodlet, hasTrait, isNeedId, isSkillId, isSleepingRun, skillLevel } from './needs';
import { objectCenter, objectName, tryObjectDef } from './objects';
import type { ConditionFn, Engine } from './types';
import { hourInWindow, hourLabel, isNum, str, withArticle, humanize } from './util';
import { objectRegion, scopeRegion } from './regions';

const BELOW_REASON: Record<NeedId, string> = {
  hunger: 'Not hungry',
  energy: 'Not tired',
  preservation: 'Already fresh',
  social: 'Not lonely',
  fun: 'Not bored',
  hygiene: 'Already clean',
};
const ABOVE_REASON: Record<NeedId, string> = {
  hunger: 'Too hungry',
  energy: 'Too tired',
  preservation: 'Too rotten',
  social: 'Too lonely',
  fun: 'Too bored',
  hygiene: 'Too smelly',
};

function tileIndoor(eng: Engine, rc: RequirementContext): boolean {
  const p = rc.targetObject ? objectCenter(eng, rc.targetObject) : rc.actor.pos;
  const t = eng.spatial.tileOf(p);
  return eng.spatial.inBounds(t.x, t.z) && eng.spatial.isIndoor(t.x, t.z);
}

function traitName(eng: Engine, id: string): string {
  return eng.content.traits[id]?.name ?? humanize(id);
}

function awakeReason(eng: Engine, t: AgentState): string | null {
  if (t.presence === 'atWork') return `${t.firstName} is away`;
  if (t.presence !== 'onLot') return `${t.firstName} is away`;
  if (t.status && t.status.passedOut) return `${t.firstName} is asleep`;
  if (isSleepingRun(eng, t)) return `${t.firstName} is asleep`;
  if (t.active && t.active.interactionId === ENGINE_INTERACTIONS.passOut) return `${t.firstName} is asleep`;
  return null;
}

export function engineRequirements(eng: Engine): Record<string, RequirementCheck> {
  const R = ENGINE_REQUIREMENTS;
  const r: Record<string, RequirementCheck> = {
    [R.power](_ctx, rc) {
      const o = rc.targetObject;
      const def = tryObjectDef(eng, o);
      if (o && def && def.needsPower && o.condition.broken) return `${def.name} is broken`;
      return eng.state.household.utilitiesOn ? true : 'The power is out';
    },
    [R.notBroken](_ctx, rc) {
      const o = rc.targetObject;
      return o && o.condition.broken ? `${objectName(eng, o)} is broken` : true;
    },
    [R.broken](_ctx, rc) {
      const o = rc.targetObject;
      return o && o.condition.broken ? true : "It isn't broken";
    },
    [R.skill](_ctx, rc, p) {
      const skill = p?.skill as SkillId;
      const min = isNum(p?.min) ? p.min : 0;
      if (!isSkillId(skill)) return 'Something went wrong';
      return skillLevel(rc.actor, skill) >= min ? true : `Needs ${eng.content.skills[skill]?.name ?? SKILL_NAMES[skill]} ${min}`;
    },
    [R.funds](_ctx, _rc, p) {
      const min = isNum(p?.min) ? p.min : 0;
      return eng.state.household.funds >= min ? true : `Needs $${Math.round(min)}`;
    },
    [R.arms](_ctx, rc, p) {
      const min = isNum(p?.min) ? p.min : 1;
      return limbCount(rc.actor, 'arm') >= min ? true : min <= 1 ? 'Needs an arm' : `Needs ${min} arms`;
    },
    [R.legs](_ctx, rc, p) {
      const min = isNum(p?.min) ? p.min : 1;
      return limbCount(rc.actor, 'leg') >= min ? true : min <= 1 ? 'Needs a leg' : `Needs ${min} legs`;
    },
    [R.tagOnLot](_ctx, _rc, p) {
      const tag = str(p?.tag, '');
      const here = scopeRegion(eng);
      for (const o of Object.values(eng.state.objects)) {
        if (o.condition.broken || o.placement.kind === 'held' || objectRegion(eng, o) !== here) continue;
        const d = tryObjectDef(eng, o);
        if (d && d.tags.includes(tag)) return true;
      }
      return `Needs ${withArticle(humanize(tag))}`;
    },
    [R.trait](_ctx, rc, p) {
      const id = str(p?.id, '');
      return hasTrait(rc.actor, id) ? true : `Requires ${traitName(eng, id)}`;
    },
    [R.notTrait](_ctx, rc, p) {
      const id = str(p?.id, '');
      return hasTrait(rc.actor, id) ? `${traitName(eng, id)} zombies won't` : true;
    },
    [R.household](_ctx, rc) {
      return isHouseholdAgent(eng, rc.actor) ? true : 'Household only';
    },
    [R.targetHousehold](_ctx, rc) {
      const t = rc.targetAgent;
      return t && isHouseholdAgent(eng, t) ? true : `${t ? t.firstName : 'They'} isn't family`;
    },
    [R.targetNotHousehold](_ctx, rc) {
      const t = rc.targetAgent;
      if (!t) return 'Nobody there';
      return isHouseholdAgent(eng, t) ? `${t.firstName} already lives here` : true;
    },
    [R.targetVisitor](_ctx, rc) {
      const t = rc.targetAgent;
      return t && isVisitorAgent(t) && !isHouseholdAgent(eng, t) ? true : `${t ? t.firstName : 'They'} isn't visiting`;
    },
    [R.targetWalkBy](_ctx, rc) {
      const t = rc.targetAgent;
      return t && t.presence === 'onLot' && isWalkBy(t) ? true : `${t ? t.firstName : 'They'} isn't walking by`;
    },
    [R.needBelow](_ctx, rc, p) {
      const need = p?.need;
      if (!isNeedId(need) || !isNum(p.max)) return 'Something went wrong';
      return isNum(rc.actor.needs[need]) && rc.actor.needs[need] < p.max ? true : BELOW_REASON[need];
    },
    [R.needAbove](_ctx, rc, p) {
      const need = p?.need;
      if (!isNeedId(need) || !isNum(p.min)) return 'Something went wrong';
      return isNum(rc.actor.needs[need]) && rc.actor.needs[need] > p.min ? true : ABOVE_REASON[need];
    },
    [R.outdoors](_ctx, rc) {
      return tileIndoor(eng, rc) ? 'Must be outdoors' : true;
    },
    [R.indoors](_ctx, rc) {
      return tileIndoor(eng, rc) ? true : 'Must be indoors';
    },
    [R.notCarrying](_ctx, rc) {
      return rc.actor.carryObjectId ? 'Hands are full' : true;
    },
    [R.carrying](_ctx, rc, p) {
      const item = p?.item;
      if (typeof item === 'string' && (CARRY_ITEMS as readonly string[]).includes(item)) {
        return rc.actor.carrying === item ? true : `Not carrying ${withArticle(item)}`;
      }
      return rc.actor.carryObjectId || rc.actor.carrying ? true : 'Not carrying anything';
    },
    [R.targetData](_ctx, rc, p) {
      const o = rc.targetObject;
      const key = str(p?.key, '');
      const fail = str(p?.reason, 'Not available');
      if (!o || !key) return fail;
      const v = o.data[key];
      if (p.equals !== undefined && v !== p.equals) return fail;
      if (isNum(p.min) && !(isNum(v) && v >= p.min)) return fail;
      if (isNum(p.max) && !(isNum(v) && v <= p.max)) return fail;
      if (p.truthy === true && !v) return fail;
      if (p.truthy === false && v) return fail;
      return true;
    },
    [R.hourBetween](_ctx, _rc, p) {
      const from = isNum(p?.from) ? p.from : 0;
      const to = isNum(p?.to) ? p.to : 24;
      return hourInWindow(eng.time.hour, from % 24, to % 24) ? true : `Only between ${hourLabel(from)} and ${hourLabel(to)}`;
    },
    [R.notSelf](_ctx, rc) {
      return rc.targetAgent && rc.targetAgent.id === rc.actor.id ? "Can't do that to yourself" : true;
    },
    [R.targetOnLot](_ctx, rc) {
      const t = rc.targetAgent;
      return t && t.presence === 'onLot' ? true : `${t ? t.firstName : 'They'} isn't here`;
    },
    [R.targetAwake](_ctx, rc) {
      const t = rc.targetAgent;
      if (!t) return 'Nobody there';
      return awakeReason(eng, t) ?? true;
    },
  };
  // Wrap: every requirement accepts params.reason to override its message.
  const wrapped: Record<string, RequirementCheck> = {};
  for (const [id, fn] of Object.entries(r)) {
    wrapped[id] = (ctx, rc, p) => {
      const res = fn(ctx, rc, p ?? {});
      if (res === true) return true;
      return p && typeof p.reason === 'string' && p.reason ? p.reason : res;
    };
  }
  return wrapped;
}

export function engineConditions(eng: Engine): Record<string, ConditionFn> {
  const evalSub = (c: unknown, agent: AgentState | null): boolean =>
    !!c && typeof c === 'object' && typeof (c as ConditionRef).kind === 'string' ? eng.ctx.evalCondition(c as ConditionRef, agent) : false;
  return {
    always: () => true,
    never: () => false,
    funds: (_ctx, _a, p) => eng.state.household.funds >= (isNum(p?.min) ? p.min : 0),
    skill: (_ctx, a, p) => !!a && isSkillId(p?.skill) && skillLevel(a, p.skill) >= (isNum(p.min) ? p.min : 0),
    stat: (ctx, a, p) => ctx.statValue(str(p?.key, ''), p?.perAgent && a ? a.id : null) >= (isNum(p?.min) ? p.min : 1),
    moodlet: (_ctx, a, p) => !!a && hasMoodlet(a, str(p?.id, '')),
    trait: (_ctx, a, p) => !!a && hasTrait(a, str(p?.id, '')),
    flag: (_ctx, _a, p) => {
      const v = eng.state.flags[str(p?.key, '')];
      return p && p.equals !== undefined ? v === p.equals : !!v;
    },
    and: (_ctx, a, p) => Array.isArray(p?.all) && p.all.every((c: unknown) => evalSub(c, a)),
    or: (_ctx, a, p) => Array.isArray(p?.any) && p.any.some((c: unknown) => evalSub(c, a)),
    not: (_ctx, a, p) => !evalSub(p?.cond, a),
  };
}
