/**
 * Social interactions — every row of GDD §9 with exactly those ids, groups, gates, base chances and deltas.
 * All use behaviour `social` (src/sim/systems/people/social). The engine choreographs (route next to the target,
 * suspend its current interaction, give it `engine_respond`); the social behaviour rolls the outcome at startStage,
 * applies deltas at completeStage and resolves special outcomes.
 *
 * Gate encoding:
 *   SocialDef.minFriendship / minRomance — enforced by the engine menu (greyed) and re-checked by the behaviour.
 *   SocialDef.status — relationship status gate (behaviour.available).
 *   params.gate — 'met' | 'notMet' | 'visitor' | 'visitorWaiting' | 'walkBy' (behaviour.available).
 *   params['actorTrait.<id>'] / params['targetTrait.<id>'] — additive success-chance modifiers (GDD §8/§9 notes).
 *   params.okBubble / failBubble / okSfx / failSfx / okVoice / failVoice — reaction presentation.
 */
import type { InteractionDef, MoodletGrant, SocialDef, StageTarget } from '../../contracts';
import type { BubbleIcon } from '../../contracts';
import type { AnimState } from '../../../shared/appearance';
import type { SfxId, VoiceEmotion } from '../../../shared/audioIds';
import { BEHAVIOR, CRITICAL_SOCIAL_IDS, MOODLET as M, OUTCOME, SOCIAL_IDS as S } from './ids';

type Group = 'Friendly' | 'Romantic' | 'Mean';
type Gate = 'met' | 'notMet' | 'visitor' | 'visitorWaiting' | 'walkBy' | 'feral';

interface SocialSpec {
  id: string;
  label: string;
  group: Group;
  icon: BubbleIcon;
  gate?: Gate;
  base: number;
  f: [number, number];
  r?: [number, number];
  duration?: number;
  anim: AnimState;
  targetAnim: AnimState;
  failAnim?: AnimState;
  voice: VoiceEmotion;
  targetVoice?: VoiceEmotion;
  outcome?: string;
  fun?: number;
  minFriendship?: number;
  minRomance?: number;
  status?: SocialDef['status'];
  ok?: MoodletGrant[];
  fail?: MoodletGrant[];
  adBonus?: number;
  traitAd?: Record<string, number>;
  autonomous?: boolean;
  visitorAllowed?: boolean;
  requires?: InteractionDef['requires'];
  params?: Record<string, string | number | boolean>;
  okBubble?: BubbleIcon;
  failBubble?: BubbleIcon;
  okSfx?: SfxId;
  failSfx?: SfxId;
  tags?: string[];
  /** Override the default agentAdjacent stage target (agentAdjacent stays the fallback). */
  stageTarget?: StageTarget;
  hidden?: boolean;
  menuOrder: number;
}

/** Social need gained by both participants on success (half on fail) — GDD §9. */
export const SOCIAL_NEED_GAIN = 8;
/** Charisma XP per social for the actor — GDD §7. */
export const SOCIAL_CHARISMA_XP = 6;
export const SOCIAL_DURATION = 10;
/** Autonomy advertise multiplier for non-hosting socials (see `advertise` in social()). */
export const SOCIAL_AD_CONVERSATION = 2;

const MEAN_TRAIT_MODS = { 'actorTrait.grumpy': 0.15, 'actorTrait.hothead': 0.2 } as const;
const MEAN_TRAIT_AD = { hothead: 28, grumpy: 16, cheerful: -20 };
const ROMANTIC_TRAIT_AD = { hopelessRomantic: 20 };

function social(s: SocialSpec): InteractionDef {
  const romantic = s.group === 'Romantic';
  const mean = s.group === 'Mean';
  const def: SocialDef = {
    baseChance: s.base,
    friendship: s.f,
    social: SOCIAL_NEED_GAIN,
    charismaXp: SOCIAL_CHARISMA_XP,
    targetAnim: s.targetAnim,
    voice: s.voice,
    romantic,
    mean,
  };
  if (s.r) def.romance = s.r;
  if (s.fun !== undefined) def.fun = s.fun;
  if (s.minFriendship !== undefined) def.minFriendship = s.minFriendship;
  if (s.minRomance !== undefined) def.minRomance = s.minRomance;
  if (s.status) def.status = s.status;
  if (s.outcome) def.outcome = s.outcome;
  if (s.failAnim) def.failAnim = s.failAnim;
  if (s.targetVoice) def.targetVoice = s.targetVoice;
  if (s.ok && s.ok.length) def.successMoodlets = s.ok;
  if (s.fail && s.fail.length) def.failMoodlets = s.fail;

  const params: Record<string, string | number | boolean> = { gate: s.gate ?? 'met', ...(s.params ?? {}) };
  if (mean) Object.assign(params, MEAN_TRAIT_MODS);
  params.okBubble = s.okBubble ?? (romantic ? 'heart' : mean ? 'angry' : 'happy');
  params.failBubble = s.failBubble ?? (romantic ? 'heartBroken' : mean ? 'question' : 'sad');
  if (s.okSfx) params.okSfx = s.okSfx;
  if (s.failSfx) params.failSfx = s.failSfx;

  // Autonomy promise. One social is a 10-minute beat of a longer conversation (zombies chain them), so it promises
  // a conversation's worth of Company; otherwise a lonely zombie's chat (D(15) − D(23) ≈ 13) can never compete with
  // the flat GDD desirability bonuses (+40 cleaning, +30 mirrors) and Company sinks to 0. The social behaviour's
  // adjustScore still damps every non-hosting social to nothing as Company fills (no chatter at full Company).
  // Hosting duties keep the honest per-social gain (their adBonus already makes them attractive).
  const hosting = s.outcome === OUTCOME.welcome || s.outcome === OUTCOME.waveOver || s.outcome === OUTCOME.inviteToStay || s.outcome === OUTCOME.askToLeave;
  const advertise: Record<string, number> = { social: hosting ? SOCIAL_NEED_GAIN : SOCIAL_NEED_GAIN * SOCIAL_AD_CONVERSATION };
  if (s.fun) advertise.fun = s.fun;

  const traitAd = { ...(romantic ? ROMANTIC_TRAIT_AD : {}), ...(mean ? MEAN_TRAIT_AD : {}), ...(s.traitAd ?? {}) };
  const out: InteractionDef = {
    id: s.id,
    label: s.label,
    group: s.group,
    icon: s.icon,
    targetKind: 'agent',
    behavior: BEHAVIOR.social,
    stage: {
      target: s.stageTarget ?? { kind: 'agentAdjacent' },
      ...(s.stageTarget ? { fallback: { kind: 'agentAdjacent' } as StageTarget } : {}),
      duration: s.duration ?? SOCIAL_DURATION,
      anim: s.anim,
      expression: romantic ? 'flirty' : mean ? 'angry' : 'happy',
      voice: s.voice,
    },
    social: def,
    advertise,
    requires: [{ id: 'notSelf' }, { id: 'targetOnLot' }, { id: 'targetAwake' }, ...(s.requires ?? [])],
    autonomous: s.autonomous ?? true, // explicit: hidden socials stay autonomous (engine autonomyFor)
    visitorAllowed: s.visitorAllowed ?? false,
    tags: ['social', s.group.toLowerCase(), ...(s.tags ?? [])],
    menuOrder: s.menuOrder,
    params,
  };
  if (s.hidden) out.hidden = true;
  if (s.adBonus !== undefined) out.adBonus = s.adBonus;
  else if (romantic) out.adBonus = -4;
  else if (mean) out.adBonus = -18;
  if (Object.keys(traitAd).length) out.traitAd = traitAd;
  return out;
}

export const SOCIAL_INTERACTIONS: InteractionDef[] = [
  // ─────────────── Friendly ───────────────
  social({
    id: S.introduce, label: 'Introduce Yourself', group: 'Friendly', icon: 'wave', gate: 'notMet', base: 0.95, f: [5, 1],
    anim: 'wave', targetAnim: 'wave', voice: 'happy', targetVoice: 'happy', outcome: OUTCOME.introduce,
    // "auto first interaction": autonomy introduces strangers; players just pick a friendly social (auto-introduce).
    hidden: true, adBonus: 4, visitorAllowed: true, okBubble: 'wave', failBubble: 'question', menuOrder: 1,
  }),
  social({
    id: S.chat, label: 'Groan Small Talk', group: 'Friendly', icon: 'chat', base: 0.85, f: [4, -2],
    anim: 'talk', targetAnim: 'talk', voice: 'neutral', targetVoice: 'neutral',
    fail: [{ id: M.awkward, to: 'actor', chance: 0.5 }], params: { autoIntroduce: true }, visitorAllowed: true, okBubble: 'chat', tags: ['chat'], menuOrder: 2,
  }),
  social({
    id: S.joke, label: 'Tell a Gross Joke', group: 'Friendly', icon: 'joke', base: 0.7, f: [6, -4], fun: 8,
    anim: 'talk', targetAnim: 'laugh', failAnim: 'groan', voice: 'laugh', targetVoice: 'laugh',
    ok: [{ id: M.laughedTooHard, to: 'target' }], fail: [{ id: M.embarrassed, to: 'actor', chance: 0.5 }],
    traitAd: { cheerful: 12, partyAnimal: 12, grumpy: -12 },
    params: { 'actorTrait.cheerful': 0.15, 'targetTrait.grumpy': -0.25, autoIntroduce: true },
    visitorAllowed: true, okBubble: 'joke', failBubble: 'disgusted', okSfx: 'laugh', tags: ['joke'], menuOrder: 3,
  }),
  social({
    id: S.complimentRot, label: 'Compliment Their Decay', group: 'Friendly', icon: 'sparkle', base: 0.75, f: [6, -3],
    anim: 'talk', targetAnim: 'admire', voice: 'happy', targetVoice: 'happy',
    ok: [{ id: M.flattered, to: 'target' }], fail: [{ id: M.offended, to: 'target', chance: 0.4 }],
    params: { 'targetTrait.vain': 0.2, autoIntroduce: true }, visitorAllowed: true, okBubble: 'sparkle', failBubble: 'angry', menuOrder: 4,
  }),
  social({
    id: S.gossip, label: 'Gossip About the Neighbours', group: 'Friendly', icon: 'gossip', base: 0.75, f: [6, -3], fun: 6,
    minFriendship: 20, anim: 'talk', targetAnim: 'laugh', voice: 'surprised', targetVoice: 'laugh',
    ok: [{ id: M.juicyGossip, to: 'both' }], fail: [{ id: M.awkward, to: 'actor' }],
    visitorAllowed: true, okBubble: 'gossip', menuOrder: 5,
  }),
  social({
    id: S.shareRecipe, label: 'Share a Brain Recipe', group: 'Friendly', icon: 'brain', base: 0.8, f: [5, -1],
    minFriendship: 10, anim: 'talk', targetAnim: 'listen', voice: 'neutral', targetVoice: 'question',
    requires: [{ id: 'skill', params: { skill: 'cooking', min: 2 } }],
    params: { targetCookingXp: 10 }, visitorAllowed: true, okBubble: 'plate', menuOrder: 6,
  }),
  social({
    id: S.hug, label: 'Cold Embrace', group: 'Friendly', icon: 'happy', base: 0.8, f: [7, -5], duration: 6,
    minFriendship: 30, anim: 'hug', targetAnim: 'hug', failAnim: 'disgusted', voice: 'happy', targetVoice: 'happy',
    ok: [{ id: M.warmHug, to: 'both' }], fail: [{ id: M.embarrassed, to: 'actor' }],
    visitorAllowed: true, okBubble: 'heart', failBubble: 'disgusted', okSfx: 'hug', menuOrder: 7,
  }),
  social({
    id: S.bestFriends, label: 'Swear Eternal Friendship', group: 'Friendly', icon: 'star', base: 0.7, f: [10, -10],
    minFriendship: 75, anim: 'cheer', targetAnim: 'cheer', voice: 'happy', targetVoice: 'happy', outcome: OUTCOME.bestFriends,
    fail: [{ id: M.embarrassed, to: 'actor' }], autonomous: false, okBubble: 'star', okSfx: 'cheer', menuOrder: 8,
  }),
  social({
    id: S.playfulBite, label: 'Playful Bite', group: 'Friendly', icon: 'bite', base: 0.6, f: [8, -10],
    minFriendship: 40, anim: 'kiss', targetAnim: 'laugh', failAnim: 'angry', voice: 'laugh', targetVoice: 'laugh', outcome: OUTCOME.bite,
    adBonus: -6, params: { biteFun: 10, bitePreservation: -2 }, visitorAllowed: true, okBubble: 'bite', failBubble: 'angry', menuOrder: 9,
  }),
  social({
    id: S.moveIn, label: 'Ask to Move In', group: 'Friendly', icon: 'house', base: 0.75, f: [5, -8],
    anim: 'talk', targetAnim: 'cheer', voice: 'question', targetVoice: 'happy', outcome: OUTCOME.moveIn,
    requires: [{ id: 'household' }, { id: 'targetNotHousehold' }],
    params: { moveInMinFriendship: 50, householdCap: 8 },
    fail: [{ id: M.awkward, to: 'actor' }], autonomous: false, okBubble: 'house', menuOrder: 20,
  }),
  social({
    id: S.inviteStay, label: 'Invite to Stay Longer', group: 'Friendly', icon: 'clock', gate: 'visitor', base: 0.8, f: [3, -1],
    anim: 'talk', targetAnim: 'cheer', voice: 'happy', targetVoice: 'happy', outcome: OUTCOME.inviteToStay,
    requires: [{ id: 'household' }, { id: 'targetVisitor' }], params: { extendMinutes: 180 },
    adBonus: -6, okBubble: 'clock', menuOrder: 21,
  }),
  social({
    id: S.welcome, label: 'Welcome In', group: 'Friendly', icon: 'house', gate: 'visitorWaiting', base: 1.0, f: [2, 0],
    anim: 'wave', targetAnim: 'wave', voice: 'happy', targetVoice: 'happy', outcome: OUTCOME.welcome,
    requires: [{ id: 'household' }, { id: 'targetVisitor' }], adBonus: 30, okBubble: 'house', okSfx: 'doorOpen', menuOrder: 0,
  }),
  social({
    id: S.waveOver, label: 'Wave Over', group: 'Friendly', icon: 'wave', gate: 'walkBy', base: 0.85, f: [2, 0],
    anim: 'wave', targetAnim: 'wave', voice: 'happy', targetVoice: 'happy', outcome: OUTCOME.waveOver,
    requires: [{ id: 'household' }, { id: 'targetWalkBy' }], adBonus: 6, traitAd: { socialButterfly: 15, loner: -15 },
    // Wave from the yard: walk to within 5 tiles of the walker instead of chasing them down the sidewalk.
    stageTarget: { kind: 'tileNear', radius: 5, of: 'target' }, okBubble: 'wave', failBubble: 'question', menuOrder: 0,
  }),

  // ─────────────── Romantic ───────────────
  social({
    id: S.flirt, label: 'Wink With Remaining Eye', group: 'Romantic', icon: 'heart', base: 0.65, f: [2, -3], r: [8, -4],
    minFriendship: 10, anim: 'flirt', targetAnim: 'flirt', failAnim: 'groan', voice: 'flirty', targetVoice: 'flirty',
    ok: [{ id: M.smitten, to: 'target' }], fail: [{ id: M.embarrassed, to: 'actor' }], menuOrder: 10,
  }),
  social({
    id: S.complimentSmell, label: 'Compliment Their Smell', group: 'Romantic', icon: 'rose', base: 0.7, f: [2, -2], r: [7, -4],
    minRomance: 10, anim: 'flirt', targetAnim: 'admire', voice: 'flirty', targetVoice: 'happy',
    ok: [{ id: M.flattered, to: 'target' }], fail: [{ id: M.awkward, to: 'actor' }], okBubble: 'rose', menuOrder: 11,
  }),
  social({
    id: S.slowDance, label: 'Slow Dance', group: 'Romantic', icon: 'music', base: 0.7, f: [3, -2], r: [9, -5],
    minRomance: 25, anim: 'dance', targetAnim: 'dance', voice: 'flirty', targetVoice: 'flirty',
    ok: [{ id: M.smitten, to: 'both' }], fail: [{ id: M.embarrassed, to: 'actor' }], okBubble: 'music', tags: ['dance'], menuOrder: 12,
  }),
  social({
    id: S.kiss, label: 'Kiss', group: 'Romantic', icon: 'heart', base: 0.7, f: [3, -6], r: [12, -8], duration: 6,
    minRomance: 40, anim: 'kiss', targetAnim: 'kiss', failAnim: 'disgusted', voice: 'flirty', targetVoice: 'flirty',
    ok: [{ id: M.smitten, to: 'both' }], fail: [{ id: M.embarrassed, to: 'actor' }],
    params: { kiss: true }, okSfx: 'kiss', failSfx: 'slap', menuOrder: 13,
  }),
  social({
    id: S.askPartner, label: 'Ask to Go Steady', group: 'Romantic', icon: 'rose', base: 0.7, f: [5, -10], r: [10, -15],
    minRomance: 60, minFriendship: 40, status: 'notPartnered', anim: 'flirt', targetAnim: 'listen', voice: 'question', targetVoice: 'happy',
    outcome: OUTCOME.becomePartners, fail: [{ id: M.rejected, to: 'actor' }], autonomous: false,
    okBubble: 'rose', okSfx: 'romanceSting', failSfx: 'sadSting', menuOrder: 14,
  }),
  social({
    id: S.propose, label: 'Propose (Finger Ring Included)', group: 'Romantic', icon: 'ring', base: 0.75, f: [5, -15], r: [10, -25], duration: 12,
    minRomance: 80, status: 'partners', anim: 'flirt', targetAnim: 'cheer', failAnim: 'cry', voice: 'question', targetVoice: 'surprised',
    outcome: OUTCOME.propose, fail: [{ id: M.rejected, to: 'actor' }, { id: M.awkward, to: 'target' }], autonomous: false,
    okBubble: 'ring', okSfx: 'romanceSting', failSfx: 'sadSting', menuOrder: 15,
  }),
  social({
    id: S.elope, label: 'Elope to the Crypt', group: 'Romantic', icon: 'ring', base: 0.95, f: [10, 0], r: [10, 0],
    status: 'engaged', anim: 'cheer', targetAnim: 'cheer', voice: 'happy', targetVoice: 'happy', outcome: OUTCOME.marry,
    autonomous: false, okBubble: 'ring', okSfx: 'romanceSting', menuOrder: 16,
  }),

  // ─────────────── Mean ───────────────
  social({
    id: S.breakUp, label: 'Break Up', group: 'Mean', icon: 'heartBroken', base: 0.95, f: [-40, -40], r: [-60, -60],
    status: 'partnersOrMore', anim: 'angry', targetAnim: 'cry', voice: 'sad', targetVoice: 'sad', outcome: OUTCOME.breakUp,
    fail: [{ id: M.offended, to: 'target' }, { id: M.awkward, to: 'actor' }], autonomous: false,
    okBubble: 'heartBroken', failBubble: 'angry', okSfx: 'sadSting', menuOrder: 30,
  }),
  social({
    id: S.argue, label: 'Argue About the Smell', group: 'Mean', icon: 'angry', base: 0.8, f: [-8, -4], r: [-4, -2],
    anim: 'angry', targetAnim: 'angry', voice: 'angry', targetVoice: 'angry',
    ok: [{ id: M.furious, to: 'target' }, { id: M.furious, to: 'actor', chance: 0.5 }], fail: [{ id: M.awkward, to: 'actor' }],
    okBubble: 'angry', menuOrder: 31,
  }),
  social({
    id: S.insultDecay, label: 'Insult Their Decay', group: 'Mean', icon: 'disgusted', base: 0.85, f: [-14, -6], r: [-8, -4],
    anim: 'angry', targetAnim: 'angry', failAnim: 'groan', voice: 'disgusted', targetVoice: 'angry',
    ok: [{ id: M.offended, to: 'target' }], fail: [{ id: M.embarrassed, to: 'actor' }],
    okBubble: 'angry', okSfx: 'slap', menuOrder: 32,
  }),
  social({
    id: S.askToLeave, label: 'Ask to Leave', group: 'Mean', icon: 'house', gate: 'visitor', base: 0.95, f: [-3, -3],
    anim: 'talk', targetAnim: 'listen', voice: 'neutral', targetVoice: 'sad', outcome: OUTCOME.askToLeave,
    requires: [{ id: 'household' }, { id: 'targetVisitor' }],
    ok: [{ id: M.offended, to: 'target', chance: 0.5 }], fail: [{ id: M.awkward, to: 'actor' }], autonomous: false,
    okBubble: 'house', failBubble: 'question', menuOrder: 33,
  }),
];

/**
 * Engine tag (engine README §10): an interaction with this tag is considered ONLY by the feral override, and only
 * when no other food candidate is valid — the bite never competes with a fridge, a meal or the emergency pizza.
 */
export const FERAL_FALLBACK_TAG = 'feralFallback';
/** Hunger the biter gets back from a successful nibble (5 → 17: still feral, still hunting for real food). */
export const NIBBLE_HUNGER = 12;
/** Raw freshness the bitten zombie loses (GDD §3 / backlog #14). */
export const NIBBLE_PRESERVATION = -3;
/** One bite per biter per this many game minutes (the "then backoff" of backlog #14). */
export const NIBBLE_COOLDOWN_MIN = 180;

function feralNibble(): InteractionDef {
  const d = social({
    id: CRITICAL_SOCIAL_IDS.feralNibble, label: 'Feral Nibble', group: 'Mean', icon: 'bite', gate: 'feral', base: 0.75, f: [-20, -12],
    duration: 4, anim: 'feral', targetAnim: 'angry', failAnim: 'disgusted', voice: 'angry', targetVoice: 'angry', outcome: OUTCOME.feralNibble,
    ok: [{ id: M.chewedOn, to: 'target' }], hidden: true, autonomous: true, visitorAllowed: false, adBonus: 0,
    params: { nibbleHunger: NIBBLE_HUNGER, nibblePreservation: NIBBLE_PRESERVATION, cooldownMin: NIBBLE_COOLDOWN_MIN },
    okBubble: 'bite', failBubble: 'angry', okSfx: 'slap', tags: [FERAL_FALLBACK_TAG, 'feral'], menuOrder: 99,
  });
  // A bite is not a conversation: no Company or charisma for anyone; it promises food (the feral override scores
  // hunger only), and mean-social trait desirability does not apply.
  d.social = { ...d.social!, social: 0, charismaXp: 0 };
  d.advertise = { hunger: 30 };
  delete d.traitAd;
  return d;
}

/** Hidden socials outside the GDD §9 table (registered with the people content module). */
export const CRITICAL_SOCIALS: InteractionDef[] = [feralNibble()];
