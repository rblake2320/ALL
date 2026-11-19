/**
 * `social` system: the `social` behaviour (gates, outcome roll at startStage, deltas at completeStage, live
 * presentation), daily relationship drift, loneliness, and the SocialApi.
 */
import type { InteractionBehavior, InteractionDef, SimContext, SimSystem, SocialApi } from '../../../contracts';
import type { ActiveInteraction, AgentId, AgentState } from '../../../types';
import type { AnimState } from '../../../../shared/appearance';
import type { SfxId, VoiceEmotion } from '../../../../shared/audioIds';
import { ANIM_STATES } from '../../../../shared/appearance';
import { SFX_IDS, VOICE_EMOTIONS } from '../../../../shared/audioIds';
import { BUBBLE_ICONS, type BubbleIcon } from '../../../contracts';
import { BEHAVIOR, CAREER_IDS, MOODLET as M, OUTCOME, SYS } from '../../../content/people/ids';
import {
  bubble,
  clamp,
  flagNum,
  flagStr,
  fx,
  grantMoodlet,
  hasQueued,
  hasTrait,
  householdMembers,
  householdOnLot,
  isCouple,
  isGuest,
  isNum,
  isWalker,
  makeApi,
  needOf,
  num,
  partnerOf,
  peekRel,
  relKey,
  setFlag,
  sfx,
  TICKS_PER_HOUR,
  voice,
} from '../util';
import { NEED_IDS } from '../../../types';
import { checkGates } from './gates';
import { successChance } from './chance';
import { applySocialResult } from './outcomes';
import { dailyDrift, FRIEND_THRESHOLD, friendCount, labelBetween, maxRomance, relationshipViews, writableRel } from './relations';
import { lingerWalker } from '../townies/visitorOps';

const BABBLE_EVERY_MIN = 2;
const REACTION_AT = 0.6;
/** A pair that just had a mean social is much less likely to have another one for 12 game hours. */
export const MEAN_COOLDOWN_TICKS = 12 * TICKS_PER_HOUR;
/** Score factor for repeating the pair's previous social. */
export const REPEAT_FACTOR = 0.7;

/** The need that sets a social's appetite: Company, or Amusement when the social also promises fun and is lower. */
export function appetiteNeed(actor: AgentState, def: InteractionDef): number {
  const social = needOf(actor, 'social');
  return isNum(def.social?.fun) && def.social!.fun! > 0 ? Math.min(social, needOf(actor, 'fun')) : social;
}

/** Is another on-lot agent already doing (or queued to do) `interactionId` to `targetId`? */
export function someoneElseDoing(ctx: SimContext, actorId: AgentId, interactionId: string, targetId: AgentId): boolean {
  const same = (q: { interactionId: string; target: { kind: string; id?: string } } | null | undefined) =>
    !!q && q.interactionId === interactionId && q.target?.kind === 'agent' && q.target.id === targetId;
  for (const id of Object.keys(ctx.state.agents)) {
    if (id === actorId) continue;
    const o = ctx.state.agents[id];
    if (!o || o.presence !== 'onLot') continue;
    if (same(o.active) || (Array.isArray(o.queue) && o.queue.some(same))) return true;
  }
  return false;
}

/** Hosting duties (welcome, wave over, guests' introductions, visit length) ignore the actor's own social need. */
export function isHostingSocial(def: InteractionDef, target: AgentState): boolean {
  const o = def.social?.outcome;
  if (o === OUTCOME.welcome || o === OUTCOME.waveOver || o === OUTCOME.inviteToStay || o === OUTCOME.askToLeave) return true;
  return o === OUTCOME.introduce && isGuest(target);
}

function asBubble(v: unknown, fallback: BubbleIcon): BubbleIcon {
  return typeof v === 'string' && (BUBBLE_ICONS as readonly string[]).includes(v) ? (v as BubbleIcon) : fallback;
}
function asSfx(v: unknown): SfxId | null {
  return typeof v === 'string' && (SFX_IDS as readonly string[]).includes(v) ? (v as SfxId) : null;
}
function asVoice(v: unknown, fallback: VoiceEmotion): VoiceEmotion {
  return typeof v === 'string' && (VOICE_EMOTIONS as readonly string[]).includes(v) ? (v as VoiceEmotion) : fallback;
}
function asAnim(v: unknown): AnimState | null {
  return typeof v === 'string' && (ANIM_STATES as readonly string[]).includes(v) ? (v as AnimState) : null;
}

export function targetAgentOf(ctx: SimContext, run: ActiveInteraction): AgentState | null {
  const id = run.target?.kind === 'agent' ? run.target.id : run.partnerId;
  if (typeof id !== 'string') return null;
  return ctx.agent(id) ?? null;
}

function rollOutcome(ctx: SimContext, actor: AgentState, target: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  if (typeof run.data.success === 'boolean') return; // already rolled (stage restarted)
  const { chance } = successChance(ctx, actor, target, def);
  const success = chance >= 1 ? true : ctx.rng.chance(chance);
  run.data.success = success;
  run.data.chance = Math.round(chance * 1000) / 1000;
  run.data.reacted = false;
  run.data.beats = 0;
  if (def.params?.autoIntroduce === true && !peekRel(ctx, actor.id, target.id).met) bubble(ctx, actor.id, 'wave', 'speech', true);
  bubble(ctx, actor.id, def.icon, 'speech');
}

function react(ctx: SimContext, actor: AgentState, target: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  run.data.reacted = true;
  const s = def.social;
  if (!s) return; // a non-social def wired to the social behaviour: nothing to react to
  const ok = run.data.success === true;
  const p = def.params ?? {};
  if (!target.active || target.active.partnerId !== actor.id) {
    // Not engaged through engine_respond (e.g. a wave from across the yard): turn and react in place.
    const dx = actor.pos.x - target.pos.x;
    const dz = actor.pos.z - target.pos.z;
    if (Math.abs(dx) + Math.abs(dz) > 1e-6) target.facing = Math.atan2(dx, dz);
    const anim = ok ? asAnim(s.targetAnim) : asAnim(s.failAnim);
    if (anim) target.anim = anim;
  }
  if (ok) {
    bubble(ctx, target.id, asBubble(p.okBubble, 'happy'), 'speech', true);
    voice(ctx, target.id, asVoice(s.targetVoice, 'happy'), 1500);
    const id = asSfx(p.okSfx);
    if (id) sfx(ctx, id, { agentId: target.id });
    if (s.romantic) fx(ctx, 'hearts', { agentId: target.id });
    if (s.outcome === OUTCOME.bestFriends || s.outcome === OUTCOME.marry || s.outcome === OUTCOME.propose) fx(ctx, 'confetti', { agentId: actor.id });
    if (s.mean) fx(ctx, 'anger', { agentId: target.id });
  } else {
    bubble(ctx, target.id, asBubble(p.failBubble, 'sad'), 'speech', false);
    voice(ctx, target.id, s.mean ? 'angry' : s.romantic ? 'disgusted' : 'groan', 1300);
    const id = asSfx(p.failSfx);
    if (id) sfx(ctx, id, { agentId: target.id });
    if (s.outcome === OUTCOME.breakUp || s.outcome === OUTCOME.propose) fx(ctx, 'tears', { agentId: actor.id });
  }
  if (s.outcome === OUTCOME.breakUp && ok) fx(ctx, 'tears', { agentId: target.id });
}

/** Apply the result once (completeStage, or a cancel after the reaction already played). */
function finish(ctx: SimContext, actor: AgentState, run: ActiveInteraction, def: InteractionDef): void {
  if (run.data.applied === true || !def.social) return;
  run.data.applied = true;
  const target = targetAgentOf(ctx, run);
  if (!target || target.id === actor.id || target.presence !== 'onLot' || actor.presence !== 'onLot') return;
  if (typeof run.data.success !== 'boolean') {
    const c = successChance(ctx, actor, target, def).chance;
    run.data.success = c >= 1 ? true : ctx.rng.chance(c);
  }
  applySocialResult(ctx, actor, target, def, run.data.success === true);
}

export const socialBehavior: InteractionBehavior = {
  available(ctx, actor, def, target) {
    if (!target || target.kind !== 'agent') return 'Needs someone to talk to';
    return checkGates(ctx, actor, ctx.agent(target.id), def, { engineGates: false });
  },

  begin(ctx, actor, run, def) {
    const t = targetAgentOf(ctx, run);
    const g = checkGates(ctx, actor, t, def, { engineGates: true });
    if (g !== true) return g;
    if (def.social?.outcome === OUTCOME.waveOver && t) lingerWalker(ctx, t);
    return null;
  },

  startStage(ctx, actor, run, def, stage) {
    if (stage !== 0) return null;
    const t = targetAgentOf(ctx, run);
    const g = checkGates(ctx, actor, t, def, { engineGates: true });
    if (g !== true) return g;
    rollOutcome(ctx, actor, t!, run, def);
    // The bite has started: the biter's cooldown runs from here (a dodged bite counts too — "then backoff").
    if (def.social?.outcome === OUTCOME.feralNibble) setFlag(ctx, `nibble:${actor.id}`, ctx.state.tick);
    return null;
  },

  tick(ctx, actor, run, def) {
    const t = targetAgentOf(ctx, run);
    if (!def.social || !t || t.presence !== 'onLot') return 'done';
    if (typeof run.data.success !== 'boolean') rollOutcome(ctx, actor, t, run, def);
    const elapsed = num(run.elapsed, 0);
    const duration = Math.max(0.5, num(run.duration, 10));
    const beatsDue = Math.floor(elapsed / BABBLE_EVERY_MIN);
    let beats = num(run.data.beats, 0);
    while (beats < beatsDue && beats < 32) {
      const speakerIsActor = beats % 2 === 0;
      const emotion: VoiceEmotion = speakerIsActor ? asVoice(def.social?.voice, 'neutral') : asVoice(def.social?.targetVoice, 'neutral');
      voice(ctx, speakerIsActor ? actor.id : t.id, emotion, 1400);
      beats++;
    }
    run.data.beats = beats;
    if (run.data.reacted !== true && elapsed >= duration * REACTION_AT) react(ctx, actor, t, run, def);
    if (run.data.reacted === true && run.data.success === false) {
      const fail = asAnim(def.social?.failAnim);
      if (fail) t.anim = fail;
      const actorFail = asAnim(def.params?.actorFailAnim);
      if (actorFail) actor.anim = actorFail;
    }
    return undefined;
  },

  completeStage(ctx, actor, run, def, stage) {
    if (stage === 0) finish(ctx, actor, run, def);
  },

  end(ctx, actor, run, def, outcome) {
    if (outcome === 'canceled' && run.data.reacted === true) finish(ctx, actor, run, def);
  },

  adjustScore(ctx, actor, def, target, score) {
    if (!isNum(score)) return 0;
    if (!def.social || target.kind !== 'agent') return score;
    const t = ctx.agent(target.id);
    if (!t) return score;
    // Never buttonhole someone on their way out: a zombie heading for the carpool (a chat could make them miss the
    // shift) or a guest who is leaving.
    if (hasQueued(t, CAREER_IDS.goToWork) || t.visit?.leaving === true) return 0;
    const outcome = def.social.outcome;
    // The feral nibble is hunger, not conversation: none of the Company / relationship shaping applies (the engine's
    // feral override only offers it when no real food is reachable).
    if (outcome === OUTCOME.feralNibble) return score;
    // One host per duty: don't send the whole household to the door to welcome / wave at the same guest.
    if (isHostingSocial(def, t) && outcome !== OUTCOME.introduce && someoneElseDoing(ctx, actor.id, def.id, t.id)) return 0;
    const rel = peekRel(ctx, actor.id, t.id);
    // Relationship ladder: among equally attractive socials prefer the most intimate one the bond allows (kiss over
    // flirt, hug over chat) — and vary it: the same social with the same partner twice in a row is less appealing.
    let s = score + Math.max(num(def.social.minFriendship, 0), num(def.social.minRomance, 0)) / 10;
    if (flagStr(ctx, `last:${relKey(actor.id, t.id)}`) === def.id) s *= REPEAT_FACTOR;
    // Personality decides WHICH social a zombie picks, not WHETHER: outside of hosting duties a social is only
    // worth doing with some appetite for what it gives — Company, or Amusement for the fun ones (a bored zombie
    // fresh home from work still tells a joke) — full at ≤ 60, none at 100.
    if (!isHostingSocial(def, t)) s *= clamp((100 - appetiteNeed(actor, def)) / 40, 0, 1);
    if (def.social.romantic) {
      const pa = partnerOf(ctx, actor.id);
      const pt = partnerOf(ctx, t.id);
      if ((pa && pa !== t.id) || (pt && pt !== actor.id)) s -= 25; // no autonomous cheating
      else if (isCouple(rel)) s += 8;
      else if (num(rel.romance, 0) < 10) s -= 6;
    }
    if (def.social.mean) {
      if (num(rel.friendship, 0) >= FRIEND_THRESHOLD) s -= 15;
      if (ctx.state.tick - flagNum(ctx, `mean:${relKey(actor.id, t.id)}`, -1e12) < MEAN_COOLDOWN_TICKS) s *= 0.3;
    }
    if (NEED_IDS.some((n) => needOf(t, n) <= 15) || t.status?.feral) s *= 0.3; // leave zombies in crisis alone
    if (t.active?.phase === 'route' && outcome !== OUTCOME.waveOver) s *= 0.5; // don't chase zombies on the move
    if (outcome === OUTCOME.welcome && t.visit) {
      const waitedMin = Math.max(0, (ctx.state.tick - num(t.visit.arrivedTick, ctx.state.tick)) / 4);
      s += Math.min(20, waitedMin / 3);
    } else if (isGuest(t) && t.visit && !t.visit.welcomed && outcome !== OUTCOME.introduce) {
      s -= 10; // welcome them in before anything else
    }
    if (outcome === OUTCOME.introduce && isGuest(t)) s += 5;
    if (outcome === OUTCOME.waveOver && isWalker(t) && hasTrait(ctx, actor, 'loner')) s -= 10;
    return s;
  },
};

/** New world: zombies who move in together already know each other (met, friendship 30). */
export const HOUSEMATE_FRIENDSHIP = 30;
export function introduceHousemates(ctx: SimContext): void {
  const members = householdMembers(ctx);
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const r = writableRel(ctx, members[i].id, members[j].id);
      if (r.met) continue;
      r.met = true;
      r.friendship = Math.max(num(r.friendship, 0), HOUSEMATE_FRIENDSHIP);
      r.lastInteractionTick = ctx.state.tick;
    }
  }
}

/** Hourly: neglected household members get Lonely (Loners are fine, thanks). */
function lonelinessCheck(ctx: SimContext): void {
  const now = ctx.state.tick;
  for (const a of householdOnLot(ctx)) {
    if (hasTrait(ctx, a, 'loner')) continue;
    const last = num(a.status?.lastSocialTick, 0);
    if (needOf(a, 'social') < 20 && now - last >= 12 * TICKS_PER_HOUR) grantMoodlet(ctx, a, M.lonely);
  }
}

export function chanceFor(ctx: SimContext, actorId: AgentId, targetId: AgentId, interactionId: string): number | null {
  const a = ctx.agent(actorId);
  const t = ctx.agent(targetId);
  const def = ctx.content.interactions[interactionId];
  if (!a || !t || !def?.social) return null;
  return successChance(ctx, a, t, def).chance;
}

export function createSocialApi(current: () => SimContext | null): Record<string, (...args: any[]) => any> {
  const api = makeApi(current, {
    relationships: { fn: (c, agentId: AgentId) => relationshipViews(c, agentId), fallback: () => [] },
    label: { fn: (c, a: AgentId, b: AgentId) => labelBetween(c, a, b), fallback: () => 'Stranger' },
    friendCount: { fn: (c, agentId: AgentId, min?: unknown) => friendCount(c, agentId, isNum(min) ? min : undefined), fallback: () => 0 },
    maxRomance: { fn: (c, agentId: AgentId) => maxRomance(c, agentId), fallback: () => 0 },
    partnerOf: { fn: (c, agentId: AgentId) => partnerOf(c, agentId), fallback: () => null },
    chance: { fn: (c, actorId: AgentId, targetId: AgentId, interactionId: string) => chanceFor(c, actorId, targetId, interactionId), fallback: () => null },
  });
  return api satisfies Record<keyof SocialApi, unknown>;
}

export function createSocialSystem(): SimSystem {
  let current: SimContext | null = null;
  const bind = (ctx: SimContext) => {
    current = ctx;
  };
  return {
    id: SYS.social,
    init(ctx, loaded) {
      bind(ctx);
      if (!loaded) introduceHousemates(ctx);
    },
    tick(ctx) {
      bind(ctx);
    },
    dayStart(ctx, day) {
      bind(ctx);
      dailyDrift(ctx, day);
    },
    hour(ctx) {
      bind(ctx);
      lonelinessCheck(ctx);
    },
    behaviors: { [BEHAVIOR.social]: socialBehavior },
    api: createSocialApi(() => current),
  };
}
