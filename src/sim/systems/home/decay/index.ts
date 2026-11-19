/**
 * `decay` system — preservation, vitality, limbs, crumbling, reanimation, game over (GDD §4).
 * api: DecayApi { decayLevel(agentId) } + preservationPerHour(agentId) (engine trend), loseLimb, crumble, reanimate.
 */
import type { DecayApi, EffectContext, RequirementContext, SimContext, SimSystem } from '../../../contracts';
import type { AgentState } from '../../../types';
import { BEH, COND, EFF, FLAG, HOME_SYS, MOOD, REQ } from '../../../content/home/ids';
import { apiMethod, instrument } from '../ctxRegistry';
import {
  absHour,
  bubble,
  dataBool,
  firstName,
  flagNum,
  getAgent,
  getObj,
  hasTag,
  isMember,
  isZombie,
  inAgentRegion,
  livingMembers,
  members,
  num,
  objectsWithTag,
  onLotAgents,
  safeDt,
  setFlag,
  sortedAgents,
  str,
  syncMoodlet,
  voice,
} from '../util';
import {
  beEmbalmedBehavior,
  beStitchedBehavior,
  embalmBehavior,
  fitProstheticBehavior,
  kitReanimateBehavior,
  mirrorBehavior,
  mournBehavior,
  pickUpLimbBehavior,
  reanimateBehavior,
  sleepBehavior,
  stitchBehavior,
} from './behaviors';
import {
  becomeUrn,
  checkGameOver,
  crumble,
  CRUMBLE_AFTER_MIN,
  ensureStatus,
  reanimatableMembers,
  reanimate,
  reanimateHoursLeft,
} from './death';
import { canReattach, ensureLimbs, heldLimb, isLimbId, limbData, limbLossChance, loseLimb, missingLimbs, rotLimbs } from './limbs';
import {
  decayLevel,
  preservationDecayPerHour,
  preservationPerHour,
  sanitizeVitals,
  setVitality,
  sleepInfo,
  VITALITY_DAILY_LOSS,
  VITALITY_NEGLECT_BELOW,
  VITALITY_NEGLECT_PER_HOUR,
} from './rates';

const FRESH_ON = 90;
const FRESH_OFF = 85;
const REEK_ON = 0.5;
const REEK_OFF = 15;
const ZERO = 0.0001;

function tickAgent(ctx: SimContext, agent: AgentState, dt: number): void {
  sanitizeVitals(agent);
  ensureLimbs(agent);
  const status = ensureStatus(agent);
  const hours = dt / 60;
  const decay = preservationDecayPerHour(ctx, agent) * hours;
  if (decay > 0) ctx.changeNeed(agent, 'preservation', -decay, { raw: true });
  if (agent.presence === 'onLot') {
    const restore = sleepInfo(ctx, agent).restorePerHour * hours;
    if (restore > 0) ctx.changeNeed(agent, 'preservation', restore);
  }
  const pres = num(agent.needs.preservation, 0);

  // Neglect is permanent-ish: vitality erodes while freshness is critically low.
  if (pres < VITALITY_NEGLECT_BELOW) setVitality(agent, num(agent.vitality, 100) - VITALITY_NEGLECT_PER_HOUR * hours);

  const household = isMember(ctx, agent);
  if (pres <= ZERO) {
    const before = num(status.zeroPreservationMinutes, 0);
    const after = before + dt;
    status.zeroPreservationMinutes = after;
    if (!ctx.hasMoodlet(agent, MOOD.fallingApart)) {
      ctx.addMoodlet(agent, MOOD.fallingApart);
      if (household) {
        bubble(ctx, agent, 'skull', 'shout', false);
        voice(ctx, agent, 'groan');
        ctx.notify({
          kind: 'decay',
          title: `${firstName(agent)} is falling apart!`,
          text: `${firstName(agent)} has hit zero freshness. Limbs will fly. In 24 hours at zero they crumble — embalm, ice-bath or spray them NOW.`,
          agentId: agent.id,
        });
      }
    }
    if (household) {
      for (const warnAt of [12 * 60, 20 * 60]) {
        if (before < warnAt && after >= warnAt) {
          ctx.notify({
            kind: 'decay',
            title: `${firstName(agent)} is crumbling`,
            text: `${Math.round((CRUMBLE_AFTER_MIN - after) / 60)} hours left before ${firstName(agent)} becomes a pile of bones.`,
            agentId: agent.id,
          });
        }
      }
      if (after >= CRUMBLE_AFTER_MIN && agent.presence === 'onLot') {
        crumble(ctx, agent);
        return;
      }
    }
    // Visitors & townies never crumble on your lot; their counter is capped.
    if (!household) status.zeroPreservationMinutes = Math.min(after, CRUMBLE_AFTER_MIN - 1);
  } else {
    if (num(status.zeroPreservationMinutes, 0) !== 0) status.zeroPreservationMinutes = 0;
    if (ctx.hasMoodlet(agent, MOOD.fallingApart)) ctx.removeMoodlet(agent, MOOD.fallingApart);
  }

  // Fresh as a daisy (hysteresis so it doesn't flicker).
  if (pres >= FRESH_ON) syncMoodlet(ctx, agent, MOOD.freshAsADaisy, true);
  else if (pres < FRESH_OFF) syncMoodlet(ctx, agent, MOOD.freshAsADaisy, false);

  // Reeking (hygiene 0). Slobs don't mind their own smell; flies are emitted by upkeep.
  if (agent.presence === 'onLot') {
    const hyg = num(agent.needs.hygiene, 50);
    if (hyg <= REEK_ON && !ctx.hasTrait(agent, 'slob')) syncMoodlet(ctx, agent, MOOD.reeking, true);
    else if (hyg >= REEK_OFF || ctx.hasTrait(agent, 'slob')) syncMoodlet(ctx, agent, MOOD.reeking, false);
  }
}

function hourlyLimbChecks(ctx: SimContext): void {
  const h = absHour(ctx);
  if (flagNum(ctx, FLAG.lastLimbHour, -1) === h) return; // idempotent per game hour
  setFlag(ctx, FLAG.lastLimbHour, h);
  for (const agent of onLotAgents(ctx)) {
    if (!isZombie(agent)) continue;
    inAgentRegion(ctx, agent, () => {
      const p = limbLossChance(ctx, agent);
      if (p > 0 && ctx.rng.chance(p)) loseLimb(ctx, agent, null);
    });
  }
  rotLimbs(ctx);
}

/** Repair invariants after load: crumbled members have piles, gone members don't, vitals sane. */
function repairState(ctx: SimContext): void {
  for (const a of sortedAgents(ctx)) {
    if (!isZombie(a)) continue;
    sanitizeVitals(a);
    ensureLimbs(a);
    const status = ensureStatus(a);
    if (a.presence !== 'crumbled' && status.bonePileId) {
      if (a.presence !== 'gone') status.bonePileId = null;
    }
    if (a.presence === 'crumbled' && !getObj(ctx, status.bonePileId)) {
      // Lost pile (sold in build mode, corrupted save): keep the window running, re-create nothing — the urn
      // conversion still happens on time; reanimation needs the pile so it is no longer possible.
      status.bonePileId = null;
      if (status.crumbledTick === null || !Number.isFinite(status.crumbledTick)) status.crumbledTick = ctx.state.tick;
    }
  }
}

// ─────────────────────────────── effects / requirements / conditions ───────────────────────────────

function effectAgent(ctx: SimContext, ec: EffectContext, params: Record<string, any>): AgentState | null {
  return getAgent(ctx, params?.agentId) ?? ec.targetAgent ?? ec.actor ?? null;
}

const effects: SimSystem['effects'] = {
  [EFF.reanimate]: (ctx, ec, params) => {
    const id = str(params?.agentId, '') || str(ec.targetObject?.data?.ownerId, '');
    const res = reanimate(ctx, id, ec.actor);
    if (res !== true && ec.actor) ctx.notify({ kind: 'bad', title: 'Reanimation fizzled', text: res, agentId: ec.actor.id });
  },
  [EFF.loseLimb]: (ctx, ec, params) => {
    const a = effectAgent(ctx, ec, params);
    loseLimb(ctx, a, isLimbId(params?.limb) ? params.limb : null);
  },
  [EFF.vitality]: (ctx, ec, params) => {
    const a = effectAgent(ctx, ec, params);
    const amt = num(params?.amount, 0);
    if (a && amt !== 0) setVitality(a, num(a.vitality, 100) + amt);
  },
};

function reqAgentHolding(ctx: SimContext, rc: RequirementContext, ownerShouldBe: 'actor' | 'target'): true | string {
  const limb = heldLimb(ctx, rc.actor);
  if (!limb) return 'Not carrying a limb';
  const recipient = ownerShouldBe === 'actor' ? rc.actor : rc.targetAgent;
  return canReattach(ctx, limb, recipient);
}

const requirements: SimSystem['requirements'] = {
  [REQ.carryingOwnLimb]: (ctx, rc, p) => withReason(reqAgentHolding(ctx, rc, 'actor'), p),
  [REQ.carryingLimbOfTarget]: (ctx, rc, p) => withReason(reqAgentHolding(ctx, rc, 'target'), p),
  [REQ.limbOwner]: (ctx, rc, p) => {
    const info = limbData(ctx, rc.targetObject);
    if (!info) return withReason('Not a limb', p);
    const own = info.ownerId === rc.actor.id;
    const want = p?.owner !== false;
    return own === want ? true : withReason(want ? 'Not their limb' : 'It’s their own limb', p);
  },
  [REQ.limbFresh]: (ctx, rc, p) => {
    const info = limbData(ctx, rc.targetObject);
    if (!info) return withReason('Not a limb', p);
    return info.rotten ? withReason('Too rotten to reattach', p) : true;
  },
  [REQ.limbOwnerHere]: (ctx, rc, p) => {
    const info = limbData(ctx, rc.targetObject);
    const owner = getAgent(ctx, info?.ownerId);
    if (!info || !owner) return withReason('Its owner is long gone', p);
    if (owner.presence !== 'onLot') return withReason(`${firstName(owner)} isn’t here`, p);
    if (owner.limbs?.[info.limbId] !== 'missing') return withReason(`${firstName(owner)} already has that limb`, p);
    return true;
  },
  [REQ.limbStillMissing]: (ctx, rc, p) => {
    const info = limbData(ctx, rc.targetObject);
    if (!info) return withReason('Not a limb', p);
    const owner = getAgent(ctx, info.ownerId);
    if (!owner || owner.limbs?.[info.limbId] !== 'missing') return withReason('That spot is already taken', p);
    return true;
  },
  [REQ.missingLimb]: (_ctx, rc, p) => (missingLimbs(rc.actor).length > 0 ? true : withReason('Has all their limbs', p)),
  [REQ.canBeEmbalmed]: (ctx, rc, p) => {
    const t = rc.targetAgent;
    if (!t || !isZombie(t)) return withReason('Can’t embalm that', p);
    if (t.presence !== 'onLot') return withReason(`${firstName(t)} isn’t here`, p);
    if (num(t.needs?.preservation, 0) >= num(t.vitality, 100) - 1) return withReason(`${firstName(t)} is already fresh`, p);
    return true;
  },
  [REQ.stitchTools]: (ctx, _rc, p) => {
    const tools = [...objectsWithTag(ctx, 'sewing'), ...objectsWithTag(ctx, 'embalm')].filter(
      (o) => o.placement.kind !== 'held' && !o.condition?.broken && !o.condition?.burning,
    );
    return tools.length > 0 ? true : withReason('Needs a Stitch-n-Mend Table or Embalming Station', p);
  },
  [REQ.reanimatable]: (ctx, rc, p) => {
    const pile = rc.targetObject;
    if (!pile || !hasTag(ctx, pile, 'bonePile')) return withReason('Not a bone pile', p);
    const owner = getAgent(ctx, pile.data?.ownerId);
    if (!owner) return withReason('These bones belong to nobody you know', p);
    return reanimateHoursLeft(ctx, owner) > 0 ? true : withReason('Too late — the bones have gone to dust', p);
  },
  [REQ.crumbledMember]: (ctx, _rc, p) => (reanimatableMembers(ctx).length > 0 ? true : withReason('Nobody to reanimate', p)),
};

function withReason(res: true | string, p: Record<string, any> | undefined): true | string {
  if (res === true) return true;
  return typeof p?.reason === 'string' && p.reason ? p.reason : res;
}

const conditions: SimSystem['conditions'] = {
  [COND.avgFreshness]: (ctx, _agent, params) => {
    const ms = livingMembers(ctx);
    if (ms.length === 0) return false;
    const avg = ms.reduce((s, m) => s + num(m.needs?.preservation, 0), 0) / ms.length;
    return avg >= num(params?.min, 70);
  },
  [COND.anyReeking]: (ctx) => onLotAgents(ctx).some((a) => isZombie(a) && num(a.needs?.hygiene, 50) <= REEK_ON),
  [COND.missingLimb]: (ctx, agent) => {
    if (agent) return missingLimbs(agent).length > 0;
    return members(ctx).some((m) => missingLimbs(m).length > 0);
  },
};

// ─────────────────────────────── system ───────────────────────────────

export function createDecaySystem(): SimSystem {
  const api: DecayApi & Record<string, (...args: any[]) => any> = {
    decayLevel: apiMethod(0, (ctx, agentId: unknown) => decayLevel(getAgent(ctx, agentId))),
    preservationPerHour: apiMethod(0, (ctx, agentId: unknown) => preservationPerHour(ctx, getAgent(ctx, agentId))),
    loseLimb: apiMethod<string | null>(null, (ctx, agentId: unknown, limb?: unknown) => loseLimb(ctx, getAgent(ctx, agentId), isLimbId(limb) ? limb : null)?.id ?? null),
    crumble: apiMethod<string | null>(null, (ctx, agentId: unknown) => crumble(ctx, getAgent(ctx, agentId))?.id ?? null),
    reanimate: apiMethod<true | string>('Not ready', (ctx, agentId: unknown) => reanimate(ctx, agentId, null)),
    isRotten: apiMethod(false, (ctx, objectId: unknown) => dataBool(getObj(ctx, objectId), 'rotten', false)),
  };
  const sys: SimSystem = {
    id: HOME_SYS.decay,
    init(ctx) {
      repairState(ctx);
    },
    tick(ctx, dtMin) {
      const dt = safeDt(dtMin);
      if (dt <= 0) return;
      for (const agent of sortedAgents(ctx)) {
        if (!isZombie(agent)) continue;
        if (agent.presence === 'onLot' || agent.presence === 'atWork') inAgentRegion(ctx, agent, () => tickAgent(ctx, agent, dt));
      }
      for (const m of members(ctx)) {
        if (m.presence === 'crumbled' && reanimateHoursLeft(ctx, m) <= 0) becomeUrn(ctx, m);
      }
      checkGameOver(ctx);
    },
    hour(ctx) {
      hourlyLimbChecks(ctx);
    },
    dayStart(ctx, day) {
      if (flagNum(ctx, FLAG.lastVitalityDay, -1) === day) return; // idempotent per day
      setFlag(ctx, FLAG.lastVitalityDay, day);
      for (const m of livingMembers(ctx)) setVitality(m, num(m.vitality, 100) - VITALITY_DAILY_LOSS);
    },
    agentArrived(ctx, agent) {
      // Came home from work after a day at zero freshness: crumble on the doorstep.
      const status = ensureStatus(agent);
      if (isMember(ctx, agent) && num(agent.needs?.preservation, 1) <= ZERO && num(status.zeroPreservationMinutes, 0) >= CRUMBLE_AFTER_MIN) {
        crumble(ctx, agent);
      }
    },
    behaviors: {
      [BEH.sleep]: sleepBehavior,
      [BEH.embalm]: embalmBehavior,
      [BEH.beEmbalmed]: beEmbalmedBehavior,
      [BEH.stitch]: stitchBehavior,
      [BEH.beStitched]: beStitchedBehavior,
      [BEH.pickUpLimb]: pickUpLimbBehavior,
      [BEH.fitProsthetic]: fitProstheticBehavior,
      [BEH.reanimate]: reanimateBehavior,
      [BEH.kitReanimate]: kitReanimateBehavior,
      [BEH.mourn]: mournBehavior,
      [BEH.mirror]: mirrorBehavior,
    },
    effects,
    requirements,
    conditions,
    api,
  };
  return instrument(sys);
}

