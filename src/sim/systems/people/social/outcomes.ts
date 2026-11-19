/**
 * Applying a rolled social result: friendship/romance deltas (romance gains × the higher romanceMult of the two),
 * social/fun needs, charisma xp, declarative moodlets, relationship bookkeeping and the special outcomes of GDD §9.
 */
import type { InteractionDef, MoodletGrant, SimContext } from '../../../contracts';
import type { AgentState } from '../../../types';
import { MOODLET as M, OUTCOME, STAT } from '../../../content/people/ids';
import {
  dropMoodlet,
  fullName,
  firstName,
  grantMoodlet,
  isGuest,
  isHousehold,
  isNum,
  needOf,
  num,
  relKey,
  setFlag,
  traitDefsOf,
} from '../util';
import { addFriendship, addRomance, markRomantic, writableRel } from './relations';
import { convertWalker, extendVisit, joinHousehold, sendVisitorHome, welcomeVisitor } from '../townies/visitorOps';
import { SOCIAL_CHARISMA_XP, SOCIAL_NEED_GAIN } from '../../../content/people/socialInteractions';
import { checkMilestones } from '../aspirations';

/** Friendship from the quick introduction folded into a first friendly chat. */
export const AUTO_INTRO_FRIENDSHIP = 3;

export interface SocialResult {
  success: boolean;
  friendshipDelta: number;
  romanceDelta: number;
}

function romanceMultOf(ctx: SimContext, a: AgentState): number {
  let m = 1;
  for (const t of traitDefsOf(ctx, a)) if (isNum(t.romanceMult) && t.romanceMult > 0) m *= t.romanceMult;
  return m;
}

export function applyGrants(ctx: SimContext, grants: MoodletGrant[] | undefined, actor: AgentState, target: AgentState): void {
  if (!Array.isArray(grants)) return;
  for (const g of grants) {
    if (!g || typeof g.id !== 'string') continue;
    if (isNum(g.chance) && g.chance < 1 && !ctx.rng.chance(g.chance)) continue;
    const to = g.to ?? 'actor';
    if (to === 'actor' || to === 'both') grantMoodlet(ctx, actor, g.id, { sourceId: target.id });
    if (to === 'target' || to === 'both') grantMoodlet(ctx, target, g.id, { sourceId: actor.id });
  }
}

/** Apply everything for one completed social. Never throws on odd data. */
export function applySocialResult(ctx: SimContext, actor: AgentState, target: AgentState, def: InteractionDef, success: boolean): SocialResult {
  const s = def.social!;
  const now = ctx.state.tick;
  const rel = writableRel(ctx, actor.id, target.id);
  const wasMet = rel.met;

  // Introductions (and welcomes) always make the pair acquainted, whatever the roll; friendly small talk with a
  // stranger includes a quick introduction first.
  if (s.outcome === OUTCOME.introduce || s.outcome === OUTCOME.welcome) rel.met = true;
  if (!wasMet && def.params?.autoIntroduce === true) {
    rel.met = true;
    addFriendship(rel, AUTO_INTRO_FRIENDSHIP);
    if (isHousehold(ctx, actor) && !isHousehold(ctx, target)) ctx.stat(STAT.townsfolkMet, 1, actor.id);
  }

  const fd = num(success ? s.friendship?.[0] : s.friendship?.[1], 0);
  const friendshipDelta = addFriendship(rel, fd);
  let romanceDelta = 0;
  if (s.romance) {
    let rd = num(success ? s.romance[0] : s.romance[1], 0);
    if (rd > 0) rd *= Math.max(romanceMultOf(ctx, actor), romanceMultOf(ctx, target));
    romanceDelta = addRomance(rel, rd);
    if (rd > 0) markRomantic(ctx, actor.id, target.id);
  }
  rel.lastInteractionTick = now;
  rel.interactions = num(rel.interactions, 0) + 1;

  const socialGain = num(s.social, SOCIAL_NEED_GAIN) * (success ? 1 : 0.5);
  ctx.changeNeed(actor, 'social', socialGain);
  ctx.changeNeed(target, 'social', socialGain);
  if (success && isNum(s.fun) && s.fun > 0) {
    ctx.changeNeed(actor, 'fun', s.fun);
    ctx.changeNeed(target, 'fun', s.fun);
  }
  ctx.addXp(actor, 'charisma', num(s.charismaXp, SOCIAL_CHARISMA_XP));
  const recipeXp = num(def.params?.targetCookingXp, 0);
  if (success && recipeXp > 0) ctx.addXp(target, 'cooking', recipeXp);
  if (actor.status) actor.status.lastSocialTick = now;
  if (target.status) target.status.lastSocialTick = now;
  ctx.stat(STAT.socials, 1, actor.id);
  if (s.mean) setFlag(ctx, `mean:${relKey(actor.id, target.id)}`, now);
  setFlag(ctx, `last:${relKey(actor.id, target.id)}`, def.id);

  applyGrants(ctx, success ? s.successMoodlets : s.failMoodlets, actor, target);
  if (success && def.params?.kiss === true) recordKiss(ctx, actor, target);
  if (success && needOf(actor, 'social') >= 85 && s.outcome !== OUTCOME.feralNibble) grantMoodlet(ctx, actor, M.socialHigh);

  if (success || s.outcome === OUTCOME.bite || s.outcome === OUTCOME.feralNibble) applyOutcome(ctx, actor, target, def, success, wasMet);
  // Relationship milestones (friends, first kiss, partners, marriage, romance 100) shouldn't wait for the hour.
  for (const a of [actor, target]) if (isHousehold(ctx, a)) checkMilestones(ctx, a.id);
  return { success, friendshipDelta, romanceDelta };
}

/** Kiss bookkeeping; only a first kiss is newsworthy (no notification spam for established couples). */
function recordKiss(ctx: SimContext, actor: AgentState, target: AgentState): void {
  let firsts = 0;
  for (const [a, b] of [
    [actor, target],
    [target, actor],
  ] as const) {
    const first = num(ctx.statValue(STAT.kisses, a.id), 0) <= 0;
    ctx.stat(STAT.kisses, 1, a.id);
    if (first) {
      firsts++;
      grantMoodlet(ctx, a, M.firstKiss, { sourceId: b.id });
    }
  }
  if (firsts > 0 && (isHousehold(ctx, actor) || isHousehold(ctx, target))) {
    ctx.notify({ kind: 'romance', title: 'First kiss!', text: `${firstName(actor)} kissed ${firstName(target)}. Most of their lips were involved.`, agentId: actor.id });
  }
}

function applyOutcome(ctx: SimContext, actor: AgentState, target: AgentState, def: InteractionDef, success: boolean, wasMet: boolean): void {
  const s = def.social!;
  const rel = writableRel(ctx, actor.id, target.id);
  const an = firstName(actor);
  const tn = firstName(target);
  switch (s.outcome) {
    case OUTCOME.introduce:
      if (!wasMet && isHousehold(ctx, actor) && !isHousehold(ctx, target)) ctx.stat(STAT.townsfolkMet, 1, actor.id);
      break;
    case OUTCOME.bestFriends:
      rel.bestFriends = true;
      grantMoodlet(ctx, actor, M.bestFriendsForever, { sourceId: target.id });
      grantMoodlet(ctx, target, M.bestFriendsForever, { sourceId: actor.id });
      ctx.notify({ kind: 'social', title: 'Best Fiends Forever', text: `${an} and ${tn} swore eternal friendship. Given the circumstances, they mean it literally.`, agentId: actor.id });
      break;
    case OUTCOME.bite: {
      const presDelta = num(def.params?.bitePreservation, -2);
      ctx.changeNeed(target, 'preservation', presDelta, { raw: true });
      if (success) {
        ctx.changeNeed(target, 'fun', num(def.params?.biteFun, 10));
        grantMoodlet(ctx, target, M.nibbled, { sourceId: actor.id });
      } else {
        grantMoodlet(ctx, target, M.bitten, { sourceId: actor.id });
      }
      break;
    }
    case OUTCOME.feralNibble: {
      // GDD §3 / backlog #14. The pair's friendship already took the big hit (SocialDef.friendship); the bite itself:
      if (success) {
        ctx.changeNeed(target, 'preservation', num(def.params?.nibblePreservation, -3), { raw: true });
        ctx.changeNeed(actor, 'hunger', num(def.params?.nibbleHunger, 12));
      }
      grantMoodlet(ctx, actor, M.feralRemorse, { sourceId: target.id });
      ctx.stat(STAT.feralNibbles, 1, null);
      ctx.stat(STAT.feralNibbles, 1, actor.id);
      ctx.notify({
        kind: 'social',
        title: success ? `${an} bit ${tn}!` : `${an} lunged at ${tn}`,
        text: success
          ? `Feral with hunger and nothing to eat, ${an} took a bite out of ${tn}. Their friendship lost a bigger chunk. Get some food on this lot!`
          : `Feral with hunger, ${an} lunged at ${tn}, who dodged. Nobody is speaking to anybody. Get some food on this lot!`,
        agentId: actor.id,
      });
      break;
    }
    case OUTCOME.becomePartners:
      rel.partners = true;
      grantMoodlet(ctx, actor, M.itsOfficial, { sourceId: target.id });
      grantMoodlet(ctx, target, M.itsOfficial, { sourceId: actor.id });
      dropMoodlet(ctx, actor, M.lovesick);
      dropMoodlet(ctx, target, M.lovesick);
      ctx.notify({ kind: 'romance', title: 'Going steady!', text: `${an} and ${tn} are officially partners. They’ve already picked out matching shrouds.`, agentId: actor.id });
      break;
    case OUTCOME.propose:
      rel.partners = true;
      rel.engaged = true;
      grantMoodlet(ctx, actor, M.engaged, { sourceId: target.id });
      grantMoodlet(ctx, target, M.engaged, { sourceId: actor.id });
      ctx.notify({ kind: 'romance', title: 'Engaged!', text: `${tn} said yes! ${an} slipped a ring onto one of ${tn}’s remaining fingers.`, agentId: actor.id });
      break;
    case OUTCOME.marry: {
      rel.partners = true;
      rel.engaged = false;
      rel.married = true;
      grantMoodlet(ctx, actor, M.newlyweds, { sourceId: target.id });
      grantMoodlet(ctx, target, M.newlyweds, { sourceId: actor.id });
      dropMoodlet(ctx, actor, M.engaged);
      dropMoodlet(ctx, target, M.engaged);
      ctx.stat(STAT.marriages, 1, null);
      ctx.stat(STAT.marriages, 1, actor.id);
      ctx.stat(STAT.marriages, 1, target.id);
      ctx.emit({ type: 'music', mood: 'romance' });
      let extra = '';
      if (isHousehold(ctx, actor) && target.role === 'townie' && !isHousehold(ctx, target)) {
        const joined = joinHousehold(ctx, target, actor);
        extra = joined === true ? ` ${tn} is moving in.` : ' They’ll keep separate crypts for now — the house is full.';
      }
      ctx.notify({ kind: 'romance', title: 'Just married!', text: `${an} and ${tn} eloped to the crypt. Till death do us part — already handled.${extra}`, agentId: actor.id });
      break;
    }
    case OUTCOME.moveIn: {
      const r = joinHousehold(ctx, target, actor);
      if (r !== true) ctx.notify({ kind: 'bad', title: 'Can’t move in', text: `${tn} wanted to move in, but: ${r}.`, agentId: actor.id });
      break;
    }
    case OUTCOME.breakUp:
      rel.partners = false;
      rel.engaged = false;
      rel.married = false;
      dropMoodlet(ctx, actor, M.newlyweds);
      dropMoodlet(ctx, target, M.newlyweds);
      dropMoodlet(ctx, actor, M.engaged);
      dropMoodlet(ctx, target, M.engaged);
      grantMoodlet(ctx, target, M.heartbroken, { sourceId: actor.id });
      grantMoodlet(ctx, actor, M.awkward, { sourceId: target.id });
      ctx.stat(STAT.breakUps, 1, null);
      ctx.emit({ type: 'music', mood: 'sad' });
      ctx.notify({ kind: 'romance', title: 'Broken up', text: `${an} broke up with ${tn}. ${tn}’s heart — already not beating — has somehow managed to break.`, agentId: actor.id });
      break;
    case OUTCOME.askToLeave:
      if (isGuest(target)) sendVisitorHome(ctx, target, 'asked');
      break;
    case OUTCOME.inviteToStay:
      if (isGuest(target)) extendVisit(ctx, target, num(def.params?.extendMinutes, 180));
      break;
    case OUTCOME.welcome:
      welcomeVisitor(ctx, target, actor);
      break;
    case OUTCOME.waveOver:
      if (convertWalker(ctx, target)) {
        ctx.notify({ kind: 'social', title: 'Come on over!', text: `${an} waved ${fullName(target)} over. They’re heading for the front door.`, agentId: actor.id });
      }
      break;
    default:
      break;
  }
}
