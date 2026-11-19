/**
 * SIMULATION CONTRACTS — the seams between the engine, the spatial module, content and domain systems,
 * and the public API consumed by the game controller / renderer / UI.
 *
 *   engine/   implements SimContext, SimulationAPI, generic effects/requirements/behaviours
 *   spatial/  implements SpatialAPI + BuildService + lot templates
 *   content/  provides ContentModule data (objects, interactions, traits, moodlets, ...)
 *   systems/  provides SimSystem plugins (food, decay, economy, social, careers, townies, aspirations, events)
 *
 * Everything here is TYPE-ONLY except the vocabulary constant arrays.
 */
import type {
  WorldState,
  AgentState,
  ObjectState,
  ActiveInteraction,
  QueueItem,
  TargetRef,
  NeedId,
  SkillId,
  Vec2,
  TraitId,
  MoodletId,
  InteractionId,
  CareerId,
  AspirationId,
  RewardId,
  ObjectDefId,
  EdgeKey,
  Relationship,
  Presence,
  NotificationKind,
  ChoiceState,
  ObjectPlacement,
  QueueSource,
  SimSettings,
  AgentId,
  ObjectId,
  LotState,
  JobMode,
  JobPriority,
  JobScope,
  JobStatus,
} from './types';
import type { RegionId, StartPick, WorldRouteResult, WorldRouteTarget } from '../shared/world';
import type { PhysicalSpec } from '../shared/catalog';
import type { AnimState, Expression, CarryItem, ZombieAppearance } from '../shared/appearance';
import type { Rot } from '../shared/dimensions';
import type { SfxId, VoiceEmotion } from '../shared/audioIds';
import type { QuestRewardGrant } from '../shared/economy';

// ═════════════════════════════════════════ Utilities ═════════════════════════════════════════

export interface Rng {
  /** Uniform [0,1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  /** Weighted pick; weights >= 0. Returns index. */
  weighted(weights: readonly number[]): number;
  shuffle<T>(arr: T[]): T[];
}

export interface TimeInfo {
  tick: number;
  totalMinutes: number;
  /** 1-based day number. */
  day: number;
  /** 0 = Monday ... 6 = Sunday. */
  weekday: number;
  weekdayName: string;
  hour: number; // 0..23
  minute: number; // 0..59
  minuteOfDay: number; // 0..1439
  isNight: boolean; // 20:00 - 06:00
  /** 'Mon 7:45 PM' */
  label: string;
  /** Full moon every 7th day (day % 7 === 0) between 20:00 and 06:00. */
  fullMoon: boolean;
}

// ═════════════════════════════════════════ Shared vocab ═════════════════════════════════════════

export const BUBBLE_ICONS = [
  'brain', 'coffin', 'soap', 'chat', 'heart', 'heartBroken', 'joke', 'angry', 'zzz', 'money', 'book', 'tv',
  'paint', 'music', 'dance', 'limb', 'fridge', 'plate', 'dish', 'fire', 'question', 'exclamation', 'skull',
  'star', 'work', 'phone', 'mail', 'flies', 'stitch', 'embalm', 'chess', 'dumbbell', 'mirror', 'gift',
  'party', 'house', 'sad', 'happy', 'disgusted', 'gossip', 'bite', 'rose', 'ring', 'ice', 'shower', 'plant',
  'game', 'coffee', 'pizza', 'computer', 'lightning', 'urn', 'wave', 'sparkle', 'clock', 'trophy', 'wrench',
] as const;
export type BubbleIcon = (typeof BUBBLE_ICONS)[number];

export const FX_KINDS = [
  'puff', 'sparkle', 'hearts', 'flies', 'stench', 'zzz', 'skillUp', 'money', 'fire', 'smoke', 'limbDrop',
  'reanimate', 'crumble', 'splash', 'notes', 'anger', 'confetti', 'frost', 'zap', 'tears',
] as const;
export type FxKind = (typeof FX_KINDS)[number];

// ═════════════════════════════════════════ Content definitions ═════════════════════════════════════════

export interface ObjectDef extends PhysicalSpec {
  /** Interactions offered when this object is clicked (ids into ContentRegistry.interactions). */
  interactions: InteractionId[];
  /** Room environment contribution (-5..10). */
  env: number;
  /** Fraction of price lost on resale (default 0.15; doors/windows/walls refund fully within a build session via undo). */
  depreciation: number;
  /** Chance per completed use to break (appliances). */
  breakChance: number;
  sellable: boolean;
  /** Free-form gameplay parameters read by systems (e.g. { preservationPerHour: 4, energyPerHour: 12 }). */
  params: Record<string, number | string | boolean>;
}

/** Where a stage of an interaction takes place. */
export type StageTarget =
  /** The interaction's queued target (object/agent/tile/self). */
  | { kind: 'target'; slots?: string[] }
  /** Nearest usable object with `tag` (free reachable slot). */
  | { kind: 'nearestTag'; tag: string; slots?: string[] }
  /** A free sit slot. preferTable: chairs whose front tile is a table/desk surface first.
   *  facingTarget: seat must face the queued target (TV) within `radius` tiles. */
  | { kind: 'seat'; preferTable?: boolean; facingTarget?: boolean; radius: number; near: 'actor' | 'target' }
  /** A free walkable tile within radius of the target/actor (dancing, mourning, wave). */
  | { kind: 'tileNear'; radius: number; of: 'target' | 'actor' }
  /** Next to the target agent, facing them (socials). */
  | { kind: 'agentAdjacent' }
  /** Stay where you are. */
  | { kind: 'here' }
  /** The lot exit (go to work, leave). */
  | { kind: 'exit' };

export interface StageDef {
  target: StageTarget;
  /** If the target cannot be resolved, try this instead (e.g. no free seat -> eat standing 'here'). */
  fallback?: StageTarget;
  /** Run-phase length in game minutes. Use 1e9 with stopWhen for open-ended stages. */
  duration: number;
  anim: AnimState;
  expression?: Expression;
  /** Carried item visual during this stage (null clears). Omit to keep the current carry. */
  carry?: CarryItem | null;
  needsPerHour?: Partial<Record<NeedId, number>>;
  skillXpPerHour?: Partial<Record<SkillId, number>>;
  /** Fun/energy etc. multiplier keys from object params, e.g. 'tvFun' -> ObjectDef.params.tvFun scales fun. */
  scaleByObjectParam?: Partial<Record<NeedId, string>>;
  effectsOnStart?: EffectRef[];
  effectsOnComplete?: EffectRef[];
  stopWhen?: { need: NeedId; atLeast: number };
  sfxLoop?: SfxId;
  sfxStart?: SfxId;
  bubble?: BubbleIcon;
  voice?: VoiceEmotion;
  /** Requires utilities on (default: true if the stage target object needsPower). */
  power?: boolean;
}

export interface SocialDef {
  /** Base success probability 0..1 before modifiers. */
  baseChance: number;
  /** Friendship delta [onSuccess, onFail]. */
  friendship: [number, number];
  /** Romance delta [onSuccess, onFail]. */
  romance?: [number, number];
  /** Social need gained by both participants on success (half on fail). */
  social: number;
  fun?: number;
  minFriendship?: number;
  maxFriendship?: number;
  minRomance?: number;
  /** Relationship status gate. */
  status?: 'any' | 'notPartnered' | 'partners' | 'engaged' | 'married' | 'partnersOrMore' | 'notMarried';
  romantic?: boolean;
  mean?: boolean;
  charismaXp?: number;
  successMoodlets?: MoodletGrant[];
  failMoodlets?: MoodletGrant[];
  /** Special outcome handled by the social system: becomePartners, propose, marry, moveIn, breakUp,
   *  askToLeave, inviteToStay, introduce, bite, bestFriends, welcome, waveOver. */
  outcome?: string;
  targetAnim: AnimState;
  failAnim?: AnimState;
  voice: VoiceEmotion;
  targetVoice?: VoiceEmotion;
}

export interface InteractionDef {
  id: InteractionId;
  /** Menu label. May use {target} (target's first name / object name) and {param:key}. */
  label: string;
  /** Submenu group in the interaction menu ('Friendly', 'Romantic', 'Mean', 'Cook…', 'Phone'). */
  group?: string;
  icon: BubbleIcon;
  targetKind: 'object' | 'agent' | 'self' | 'tile';
  /** Behaviour key ('standard' default) — engine or a system registers it. */
  behavior?: string;
  /** Single-stage shorthand; ignored if `stages` is set. */
  stage?: StageDef;
  stages?: StageDef[];
  /** Total promised need change for autonomy scoring (defaults to the sum over stages). */
  advertise?: Partial<Record<NeedId, number>>;
  /** Flat autonomy desirability bonus (before trait bonuses). */
  adBonus?: number;
  /** Desirability bonus/penalty by trait. */
  traitAd?: Record<TraitId, number>;
  /** Up-front cost in dollars (charged when the first stage starts). */
  cost?: number;
  requires?: RequirementRef[];
  /** Autonomy may pick it (default true). */
  autonomous?: boolean;
  /** Visitors may use it autonomously (default false). */
  visitorAllowed?: boolean;
  /** Player can order it (default true). */
  playerAllowed?: boolean;
  /** Can be cancelled once running (default true). */
  interruptible?: boolean;
  /** Others doing the same interaction on the same object get a group bonus (+social/fun per hour). */
  joinable?: boolean;
  /** For targetKind 'agent' social interactions. */
  social?: SocialDef;
  /** Paired interaction: the target agent is given `partnerInteraction` and both start the run together. */
  pair?: { partnerInteraction: InteractionId; partnerTarget: 'sameObject' | 'actor' };
  moodletsOnComplete?: MoodletGrant[];
  tags?: string[];
  menuOrder?: number;
  /** Hidden from menus (system-only, partner halves, auto behaviours). */
  hidden?: boolean;
  /** Free-form params read by the behaviour. */
  params?: Record<string, number | string | boolean>;
}

export interface MoodletGrant {
  id: MoodletId;
  chance?: number;
  to?: 'actor' | 'target' | 'both';
}

export interface EffectRef {
  id: string;
  params?: Record<string, unknown>;
}

export interface RequirementRef {
  id: string;
  params?: Record<string, unknown>;
}

export interface MoodletDef {
  id: MoodletId;
  label: string;
  description: string;
  /** Mood contribution per stack. */
  mood: number;
  /** Default duration in game minutes; null = until removed. */
  durationMin: number | null;
  maxStacks: number;
  icon: BubbleIcon;
  kind: 'good' | 'bad' | 'neutral';
  tags?: string[];
}

export interface TraitDef {
  id: TraitId;
  name: string;
  description: string;
  icon: BubbleIcon;
  conflicts: TraitId[];
  /** Reward traits are bought with aspiration points, not chosen in Create-a-Zombie. */
  reward: boolean;
  /** Multipliers on need decay (e.g. hunger 1.2 = 20% faster). */
  needDecay?: Partial<Record<NeedId, number>>;
  /** Multipliers on positive need gains. */
  needGain?: Partial<Record<NeedId, number>>;
  skillGain?: Partial<Record<SkillId, number>>;
  baseMood?: number;
  /** Added to social success chance (0..1 scale). */
  socialBonus?: number;
  /** Multiplier on romance gains. */
  romanceMult?: number;
  /** Autonomy desirability added to interactions carrying these tags. */
  tagAd?: Record<string, number>;
  /** Multipliers consumed by systems: limbLoss, decay, careerPerf, partyScore, fireChance, spoilSick. */
  mult?: Record<string, number>;
}

export interface SkillDef {
  id: SkillId;
  name: string;
  description: string;
  icon: BubbleIcon;
  /** XP needed to go from level i to i+1 (index 0 = 0->1). Length 10. */
  xpPerLevel: number[];
}

export interface CareerLevelDef {
  title: string;
  /** Dollars per hour worked. */
  wage: number;
  startHour: number;
  hours: number;
  /** Workdays 0 = Mon .. 6 = Sun. */
  days: number[];
  /** Requirements to be promoted FROM this level. */
  promoteReq: { skill: SkillId; level: number }[];
}

export interface WorkEventDef {
  id: string;
  title: string;
  text: string;
  options: { label: string; effect: string; params: Record<string, string | number | boolean>; tooltip?: string }[];
}

export interface CareerDef {
  id: CareerId;
  name: string;
  description: string;
  icon: BubbleIcon;
  skill: SkillId;
  levels: CareerLevelDef[];
  workEvents: WorkEventDef[];
}

export type ConditionRef = { kind: string; params: Record<string, unknown> };

export interface MilestoneDef {
  id: string;
  label: string;
  points: number;
  condition: ConditionRef;
}

export interface AspirationDef {
  id: AspirationId;
  name: string;
  description: string;
  icon: BubbleIcon;
  milestones: MilestoneDef[];
}

export interface RewardDef {
  id: RewardId;
  name: string;
  description: string;
  cost: number;
  kind: 'trait' | 'consumable';
  traitId?: TraitId;
  effect?: EffectRef;
  icon: BubbleIcon;
}

export interface RecipeDef {
  id: string;
  name: string;
  cost: number;
  minCooking: number;
  servings: number;
  /** 1..5 baseline quality before skill modifiers. */
  baseQuality: number;
  /** Hunger restored per serving at quality 3. */
  hunger: number;
  cookMinutes: number;
  requiresTag?: string;
}

export interface LifeEventDef {
  id: string;
  /** Chance per game hour when eligible. */
  hourlyChance: number;
  /** Eligibility condition evaluated by the events system. */
  condition: ConditionRef;
  /** Either a direct effect or a choice popup. */
  effect?: EffectRef;
  choice?: WorkEventDef;
}

/**
 * Quest objectives (docs/MONETIZATION.md §2). Predicates over sim events and state; evaluated by the pure evaluator in
 * src/sim/systems/quests/objectives.ts (the game layer reuses it for profile-level daily tasks on the drained event
 * stream). EVENT kinds count events; STATE kinds read the world (counting kinds against a baseline taken when the
 * objective starts; `own` / `roomEnv` must hold continuously for `holdMin` game minutes, so a build that is undone
 * inside a (paused) build session never satisfies them).
 */
export type ObjectiveDef =
  /** EVENT: household members complete matching interactions `count` times. All given filters must match. */
  | { kind: 'interaction'; count: number; ids?: InteractionId[]; tags?: string[]; match?: Record<string, string | number | boolean>; targetTags?: string[] }
  /** EVENT: count skillUp (optionally one skill / minimum level), promotion or milestone events of household members. */
  | { kind: 'event'; event: 'skillUp' | 'promotion' | 'milestone'; count: number; skill?: SkillId; minLevel?: number }
  /** STATE: global stats counter grows by `count` (mealsCooked, repairs, partiesThrown, billsPaid, ...). */
  | { kind: 'stat'; key: string; count: number }
  /** STATE: any household member reaches `level` in `skill` (any skill when omitted). */
  | { kind: 'skill'; level: number; skill?: SkillId }
  /** STATE: `count` more household↔outsider relationships at friendship ≥ atLeast (default 35 = "Friend"). */
  | { kind: 'friends'; count: number; atLeast?: number }
  /** STATE: any household member holds a job at career level ≥ level (1 = has a job). */
  | { kind: 'career'; level: number }
  /** STATE: at least `count` placed (non-held, non-loose) objects matching tags/defIds; fresh (default true) = created after the objective started (object id ≥ the world's nextId at start, so an undo/redo-restored older object never counts as new). */
  | { kind: 'own'; count: number; tags?: string[]; defIds?: ObjectDefId[]; fresh?: boolean; holdMin?: number }
  /** STATE: some indoor room's environment score ≥ atLeast. */
  | { kind: 'roomEnv'; atLeast: number; holdMin?: number }
  /** STATE: `count` new game days begin while the objective is active. */
  | { kind: 'days'; count: number }
  /** STATE: `count` bills paid on or before their due tick after the objective started. */
  | { kind: 'billsOnTime'; count: number }
  /** STATE: household funds ≥ atLeast (read only — quests never move money). */
  | { kind: 'funds'; atLeast: number }
  /** STATE: at least `count` more wall segments stand on the lot than when the objective started, held for `holdMin`
   *  game minutes (default 15) — so walls built and undone inside a (paused) build session never count (W-113). */
  | { kind: 'walls'; count: number; holdMin?: number };

export type ObjectiveKind = ObjectiveDef['kind'];

export interface QuestStepDef {
  /** Unique within the quest. */
  id: string;
  /** Player-facing step text ("Cook a meal"). */
  label: string;
  objective: ObjectiveDef;
}

export interface QuestRewardDef {
  /** Bones (profile currency) — never household funds or needs. */
  bones: number;
  /** Cosmetic entitlement ids (opaque content ids, e.g. 'cosmetic:frame_bronze'). */
  entitlements?: string[];
}

export interface QuestDef {
  id: string;
  title: string;
  description: string;
  category: 'story' | 'neighbourhood';
  icon: BubbleIcon;
  steps: QuestStepDef[];
  reward: QuestRewardDef;
  /** Quest ids that must have been completed at least once before this one is offered. */
  requires?: string[];
  /** Neighbourhood quests: may be offered again `cooldownDays` days after it last ended. Story quests never repeat. */
  repeat?: { cooldownDays: number };
  /** Story ordering (lower first). */
  order?: number;
  /**
   * Story arc (W-113, docs/systems/story-start.md): when set, the quest is offered ONLY in worlds whose
   * `WorldState.flags.storyArc` equals it (set once at world creation by the lot template, e.g. derelict → 'act1').
   * Quests without an arc are the classic chain and run everywhere unless an arc quest supersedes them.
   */
  arc?: string;
  /**
   * Arc quests only: classic story quest ids this quest replaces in its arc. In such a world a superseded quest is
   * never offered, and it counts as complete for `requires` once this quest is complete (so the rest of the classic
   * chain follows the arc). Worlds without the arc (old saves, other lots) are unaffected.
   */
  supersedes?: string[];
}

export interface QuestStepView {
  id: string;
  label: string;
  progress: number;
  target: number;
  done: boolean;
  current: boolean;
  /** W-116: the step was (partly) credited from an action done earlier in the story arc ("Already done — nice"). */
  credited?: boolean;
}

export interface QuestView {
  questId: string;
  instance: number;
  grantId: string;
  title: string;
  description: string;
  category: QuestDef['category'];
  icon: BubbleIcon;
  steps: QuestStepView[];
  stepIndex: number;
  /** 0..1 overall progress (completed steps + current step fraction). */
  progress: number;
  reward: { bones: number; entitlements: string[] };
  pinned: boolean;
  /** true, or the reason it cannot be abandoned ("Story quests can't be abandoned"). */
  abandonable: true | string;
  /** Story arc the quest belongs to (W-113), absent for classic/neighbourhood quests. */
  arc?: string;
}

export interface QuestsView {
  active: QuestView[];
  story: { done: number; total: number };
  /** Most recent completions, newest first (max 10). */
  recent: { questId: string; title: string; grantId: string; tick: number; bones: number; entitlements: string[] }[];
  pinned: string | null;
}

export interface ContentModule {
  id: string;
  objects?: ObjectDef[];
  interactions?: InteractionDef[];
  moodlets?: MoodletDef[];
  traits?: TraitDef[];
  skills?: SkillDef[];
  careers?: CareerDef[];
  aspirations?: AspirationDef[];
  rewards?: RewardDef[];
  recipes?: RecipeDef[];
  lifeEvents?: LifeEventDef[];
  names?: { first: string[]; last: string[]; occupations: string[] };
}

export interface ContentRegistry {
  objects: Record<ObjectDefId, ObjectDef>;
  interactions: Record<InteractionId, InteractionDef>;
  moodlets: Record<MoodletId, MoodletDef>;
  traits: Record<TraitId, TraitDef>;
  skills: Record<SkillId, SkillDef>;
  careers: Record<CareerId, CareerDef>;
  aspirations: Record<AspirationId, AspirationDef>;
  rewards: Record<RewardId, RewardDef>;
  recipes: Record<string, RecipeDef>;
  lifeEvents: LifeEventDef[];
  names: { first: string[]; last: string[]; occupations: string[] };
  /** Normalised stage list for an interaction (stage shorthand expanded). */
  stagesOf(id: InteractionId): StageDef[];
}

// ═════════════════════════════════════════ Engine <-> systems plugin seam ═════════════════════════════════════════

export interface EffectContext {
  actor: AgentState | null;
  run: ActiveInteraction | null;
  def: InteractionDef | null;
  stage: number | null;
  targetAgent: AgentState | null;
  targetObject: ObjectState | null;
  /** For choice-option effects. */
  choice?: ChoiceState;
}

export type EffectHandler = (ctx: SimContext, ec: EffectContext, params: Record<string, any>) => void;

export interface RequirementContext {
  actor: AgentState;
  def: InteractionDef;
  target: TargetRef;
  targetAgent: AgentState | null;
  targetObject: ObjectState | null;
  params: Record<string, string | number | boolean>;
}

/** Return true if satisfied, else a short player-facing reason ("Needs Cooking 3"). */
export type RequirementCheck = (ctx: SimContext, rc: RequirementContext, params: Record<string, any>) => true | string;

export interface InteractionBehavior {
  /** On dequeue. Return null to proceed or a failure reason. */
  begin?(ctx: SimContext, actor: AgentState, run: ActiveInteraction, def: InteractionDef): string | null;
  /** When a stage's run phase begins (after arriving in pose). Return a reason to abort. */
  startStage?(ctx: SimContext, actor: AgentState, run: ActiveInteraction, def: InteractionDef, stage: number): string | null;
  /** Every run-phase tick. Return 'done' to finish the stage early. */
  tick?(ctx: SimContext, actor: AgentState, run: ActiveInteraction, def: InteractionDef, dtMin: number): 'done' | void;
  completeStage?(ctx: SimContext, actor: AgentState, run: ActiveInteraction, def: InteractionDef, stage: number): void;
  /** Always called exactly once when the interaction ends. */
  end?(ctx: SimContext, actor: AgentState, run: ActiveInteraction, def: InteractionDef, outcome: 'complete' | 'canceled' | 'failed'): void;
  /** Extra availability check for menus/autonomy (beyond requirements). */
  available?(ctx: SimContext, actor: AgentState, def: InteractionDef, target: TargetRef): true | string;
  /** Menu label override (e.g. "Eat Leftovers (3)"). */
  label?(ctx: SimContext, actor: AgentState, def: InteractionDef, target: TargetRef): string;
  /**
   * Sub-choices shown as a child list in the interaction menu (recipes, careers, townies to invite).
   * The chosen entry's params are merged into the queued item's params.
   */
  choices?(
    ctx: SimContext,
    actor: AgentState,
    def: InteractionDef,
    target: TargetRef,
  ): { label: string; params: Record<string, string | number | boolean>; available: true | string; cost: number | null; icon?: BubbleIcon }[];
  /** Autonomy desirability adjustment (added after need scoring). */
  adjustScore?(ctx: SimContext, actor: AgentState, def: InteractionDef, target: TargetRef, score: number): number;
  /**
   * W-116 (D-063): $ this interaction would spend beyond `def.cost` if autonomy picked it (groceries, a pizza). Autonomy
   * skips candidates whose total exceeds the household's remaining autonomous-purchase allowance.
   */
  autoCost?(ctx: SimContext, actor: AgentState, def: InteractionDef, target: TargetRef, params: Record<string, string | number | boolean>): number;
}

export interface SimSystem {
  id: string;
  /** New world created (after household + lot exist) or a save loaded (`loaded` = true). */
  init?(ctx: SimContext, loaded: boolean): void;
  /** Every tick, after agents update. */
  tick?(ctx: SimContext, dtMin: number): void;
  /** On each new game hour (minuteOfDay % 60 === 0 crossing). */
  hour?(ctx: SimContext, hour: number): void;
  /** At 00:00 of each new day. */
  dayStart?(ctx: SimContext, day: number): void;
  /** Agent spawned on lot / despawned. */
  agentArrived?(ctx: SimContext, agent: AgentState): void;
  agentLeft?(ctx: SimContext, agent: AgentState): void;
  effects?: Record<string, EffectHandler>;
  requirements?: Record<string, RequirementCheck>;
  behaviors?: Record<string, InteractionBehavior>;
  /** Condition kinds for aspirations / life events. */
  conditions?: Record<string, (ctx: SimContext, agent: AgentState | null, params: Record<string, any>) => boolean>;
  /**
   * Public API other systems / the UI query layer can call via ctx.sys(id).
   * BINDING RULE (resolved decision): ctx.sys(id) returns a per-simulation wrapper that calls
   * `api[method](...callerArgs, ctx)` — i.e. the invoking simulation's SimContext is ALWAYS appended as the final
   * argument. Implementations must read world state only through that trailing ctx (systems are stateless and the
   * same SimSystem objects are shared by every simulation, e.g. the menu demo world and the game).
   */
  api?: Record<string, (...args: any[]) => any>;
  /** Extra mood contributions (e.g. room environment, stench nearby). */
  moodModifiers?(ctx: SimContext, agent: AgentState): { label: string; value: number }[];
  /** Autonomy: extra candidate actions not attached to objects (e.g. 'wave at walk-by'). */
  autonomyCandidates?(ctx: SimContext, agent: AgentState): { interactionId: InteractionId; target: TargetRef; params?: Record<string, any> }[];
  /**
   * Observer of every SimEvent emitted through ctx.emit (synchronously, in emit order, systems in tick order).
   * Events emitted while observers run are queued and delivered after the current one (never recursively).
   * Observers must be deterministic, must not use ctx.rng / ids / notifications unless the outcome is meant to
   * change, and must tolerate any event shape (quests system — docs/contract-requests/economy.md).
   */
  onEvent?(ctx: SimContext, e: SimEvent): void;
  /**
   * W-124 (D-071): called for an on-lot HOUSEHOLD agent with nothing active or queued, right before free will (any
   * autonomy setting, including off). A system that queues something here takes the agent's turn (the jobs system
   * starts the next job run); otherwise free will runs as usual. Must be deterministic (no ctx.rng).
   */
  beforeAutonomy?(ctx: SimContext, agent: AgentState): void;
}

export interface SimContext {
  readonly state: WorldState;
  readonly content: ContentRegistry;
  readonly rng: Rng;
  readonly spatial: SpatialAPI;
  /** Current time (updated each tick). */
  readonly time: TimeInfo;
  emit(e: SimEvent): void;
  notify(n: { kind: NotificationKind; title: string; text: string; agentId?: AgentId | null; objectId?: ObjectId | null }): void;
  /** New string id with prefix 'a' (agent) or 'o' (object), unique within the world. */
  newId(prefix: 'a' | 'o'): string;
  /** New numeric uid (queue items, notifications, bills, choices). */
  newUid(): number;

  agent(id: AgentId): AgentState | undefined;
  object(id: ObjectId): ObjectState | undefined;
  objectDef(obj: ObjectState | ObjectDefId): ObjectDef;
  /** Household members (any presence). */
  householdMembers(): AgentState[];
  /** Agents with presence 'onLot' in an ACTIVE region (W-025; a home-only world: every on-lot agent), id order. */
  agentsOnLot(): AgentState[];
  /**
   * W-025 S1 (docs/DESIGN_WORLD_LEVELS.md §1.5): region an agent stands in (`AgentState.regionId`, absent = the home
   * region), or null for an unknown agent.
   */
  regionOf(agentId: AgentId): RegionId | null;
  /** W-025 S1: lot-local grid of an ACTIVE region (`state.lot` for the home), or null when it is not active. */
  lotOf(regionId: RegionId): LotState | null;
  /** W-025 S1: the home region id (`town.homeLotId`, or the legacy slot 'wormwood:mildew_n2' for worlds without town). */
  homeRegionId(): RegionId;
  /** Region whose spatial service is in scope (home during system ticks, actor's region during hooks). */
  currentRegionId?(): RegionId;
  /** Active region IDs in stable order, home first. Scoped lifecycle callers never simulate dormant regions. */
  activeRegionIds?(): readonly RegionId[];
  /** Run a callback with an ACTIVE region's spatial service; restores scope on return or throw. */
  withRegion?<T>(regionId: RegionId, callback: () => T): T;
  isHousehold(agent: AgentState): boolean;
  isVisitor(agent: AgentState): boolean;

  /** Applies trait gain/decay multipliers unless raw; clamps to [0, cap]; returns applied delta. */
  changeNeed(agent: AgentState, need: NeedId, delta: number, opts?: { raw?: boolean }): number;
  needCap(agent: AgentState, need: NeedId): number;
  addMoodlet(agent: AgentState, id: MoodletId, opts?: { sourceId?: string | null; durationMin?: number; stacks?: number }): void;
  removeMoodlet(agent: AgentState, id: MoodletId): void;
  hasMoodlet(agent: AgentState, id: MoodletId): boolean;
  addXp(agent: AgentState, skill: SkillId, xp: number): void;
  skillLevel(agent: AgentState, skill: SkillId): number;
  mood(agent: AgentState): number;
  hasTrait(agent: AgentState, trait: TraitId): boolean;
  /** Product of all trait `mult[key]` values (1 if none). */
  traitMult(agent: AgentState, key: string): number;
  /** Functional arms/legs (ok or prosthetic). */
  limbCount(agent: AgentState, kind: 'arm' | 'leg'): number;

  /**
   * Deduct funds. Returns false (and changes nothing) if insufficient. `key` makes it idempotent.
   * `opts.autonomous` (W-116, D-063): the spend is made on behalf of an AUTONOMOUS run — refused (false, nothing
   * changes) when it exceeds the household's remaining autonomous-purchase allowance (src/shared/autoBuy.ts), and
   * counted toward it otherwise. Player-queued and system spends never pass it.
   */
  spend(amount: number, reason: string, key?: string, opts?: { autonomous?: boolean }): boolean;
  earn(amount: number, reason: string, key?: string): void;

  queue(
    agent: AgentState,
    item: { interactionId: InteractionId; target: TargetRef; params?: Record<string, string | number | boolean>; source: QueueSource; priority?: number; front?: boolean },
  ): QueueItem | null;
  cancel(agent: AgentState, uid: number, reason?: string): void;
  /** Cancel the active interaction (graceful exit). For a run-phase agent the cancel is DEFERRED through a short 'exit'
   *  phase and the agent KEEPS its slot reservation until the exit ends (invariant: a run slot is reserved by its runner). */
  interrupt(agent: AgentState, reason?: string): void;
  /** FAIL the active run at the next safe point; `reason` is shown to the player for player-sourced runs (+ 'interactionFailed' event). */
  failRun(agent: AgentState, reason: string): void;
  isBusy(agent: AgentState): boolean;

  spawnObject(defId: ObjectDefId, placement: ObjectPlacement, opts?: { value?: number; data?: ObjectState['data']; tint?: string | null }): ObjectState;
  /** `reason` is PLAYER-FACING (shown as the failure text of player-sourced runs using the object), e.g. "The drizzle shower was sold". */
  removeObject(id: ObjectId, reason?: string): void;
  markChanged(obj: ObjectState): void;
  /** Put a loose item on the nearest free surface within 3 tiles of `near`, else on the floor near it. Always creates a NEW object (new id). */
  placeItemNear(defId: ObjectDefId, near: Vec2, opts?: { data?: ObjectState['data']; preferSurfaceOf?: ObjectId | null; surfaceOnly?: boolean }): ObjectState | null;
  /** Move a carried item into the agent's hand / out of it. */
  holdItem(agent: AgentState, obj: ObjectState): void;
  releaseHeld(agent: AgentState, to: 'destroy' | 'floor' | 'surface'): ObjectState | null;

  /** Bring an existing agent onto the lot at a sidewalk entry point (or `at`). */
  spawnAgent(agentId: AgentId, at?: Vec2): void;
  /** Remove from lot (cancels interactions, releases reservations, drops held items). */
  despawnAgent(agentId: AgentId, presence: Presence): void;
  createAgent(spec: NewAgentSpec): AgentState;
  /** Send an on-lot agent walking to the exit, then despawn with `presence`. */
  sendOffLot(agent: AgentState, presence: Presence, reason: string): void;

  /** Relationship record (created on first access). */
  rel(a: AgentId, b: AgentId): Relationship;

  stat(key: string, amount?: number, agentId?: AgentId | null): void;
  statValue(key: string, agentId?: AgentId | null): number;

  runEffect(ref: EffectRef, ec: EffectContext): void;
  checkRequirement(ref: RequirementRef, rc: RequirementContext): true | string;
  evalCondition(cond: ConditionRef, agent: AgentState | null): boolean;

  offerChoice(choice: Omit<ChoiceState, 'id' | 'tick'>): string;
  /** Utilities on AND (if obj given) the object doesn't need power or is not broken. */
  powered(obj?: ObjectState | null): boolean;
  /** Access another system's api. */
  sys(id: string): Record<string, (...args: any[]) => any>;
  /**
   * W-124: the interaction menu a household actor would see for a target (SimulationAPI.menu; same availability and
   * reasons). Optional so test fakes need not provide it; the engine always does.
   */
  menu?(actorId: AgentId, target: TargetRef): MenuEntry[];
}

export interface NewAgentSpec {
  role: 'household' | 'townie' | 'service';
  presence: Presence;
  firstName: string;
  lastName: string;
  appearance: ZombieAppearance;
  traits: TraitId[];
  aspiration?: AspirationId | null;
  occupation?: string | null;
  needs?: Partial<Record<NeedId, number>>;
  skills?: Partial<Record<SkillId, number>>;
}

// ═════════════════════════════════════════ Cross-system APIs (ctx.sys(id)) ═════════════════════════════════════════
// System ids are fixed: home → 'decay' | 'food' | 'economy' | 'upkeep'; people → 'social' | 'careers' | 'townies' | 'aspirations' | 'events'.
// The engine's SimulationAPI views delegate to these. Callers MUST tolerate a missing system (ctx.sys returns {}).

export interface EconomyApi {
  bills(): BillsView;
  lotValue(): number;
  /** Pay every outstanding bill (idempotent per bill). Returns true or a reason ("Not enough money"). */
  payAll(agentId: AgentId | null): true | string;
}
export interface FoodApi {
  /** Phone: order a pizza delivery for the household. */
  orderPizza(agentId: AgentId, autonomous?: boolean): true | string;
  /** Extra line for ObjectView.detail (servings, leftovers, spoilage). */
  objectDetail(objectId: ObjectId): string | null;
}
export interface DecayApi {
  /** 0..1 decay level for the renderer (1 - preservation/100 with blotch weighting). */
  decayLevel(agentId: AgentId): number;
  /**
   * Home-owned preservation change per game hour (decay + powered refrigerated bed restore + fire drain + home
   * behaviour embalming gains). The engine's NeedView trend adds the active stage's needsPerHour ON TOP — do not
   * double count.
   */
  preservationPerHour?(agentId: AgentId): number;
}
export interface SocialApi {
  relationships(agentId: AgentId): RelationshipView[];
  label(a: AgentId, b: AgentId): string;
}
export interface CareersApi {
  view(agentId: AgentId): CareerView | null;
  available(): { id: CareerId; name: string; description: string; startTitle: string; wage: number; schedule: string; icon: BubbleIcon }[];
  join(agentId: AgentId, trackId: CareerId): true | string;
  quit(agentId: AgentId): true | string;
}
export interface TowniesApi {
  list(forAgentId: AgentId): TownieView[];
  party(): PartyView | null;
  /** Create (not spawn) a service NPC agent: 'pizza' | 'repo'. */
  createService(kind: 'pizza' | 'repo'): AgentId;
}
export interface AspirationsApi {
  view(agentId: AgentId): AspirationView | null;
  buyReward(agentId: AgentId, rewardId: RewardId): true | string;
}
export interface QuestsApi {
  view(): QuestsView;
  /** Every completed grant still recorded in the world (oldest first) — the game layer reconciles its ledger with it. */
  grants(): QuestRewardGrant[];
  /** 'abandon' (repeatable quests only) | 'pin' | 'unpin'. */
  command(action: 'abandon' | 'pin' | 'unpin', questId: string): true | string;
}

// ═════════════════════════════════════════ Spatial seam ═════════════════════════════════════════

export interface PlacementResult {
  ok: boolean;
  reason?: string;
  /** Tiles the object would occupy (world). */
  tiles: { x: number; z: number }[];
  /** Non-fatal: slots whose every approach tile is blocked. */
  blockedSlots: number[];
  cost: number;
}

/**
 * Resolved slot semantics (spatial implementation contract):
 * - A `faceObject` slot appears ONCE PER surviving approach tile: every copy shares `index`/`id`, has exactly one
 *   `approach` tile, and its own pose (tile centre moved 0.28 toward the object, facing it). Reserve by `index`,
 *   route to that entry's tile, use that entry's pose. Fixed-pose slots always appear (even with `approach: []`).
 * - `approach` excludes out-of-bounds tiles, tiles inside the object's own footprint, and tiles separated from the
 *   object by a wall segment (doors/windows count) along their shared row/column. Non-walkable tiles are kept
 *   (routing decides).
 */
export interface ResolvedSlot {
  index: number;
  id: string;
  kind: 'stand' | 'sit' | 'lie' | 'bath';
  /** World tile coords of candidate approach tiles (filtered to in-bounds). */
  approach: { x: number; z: number }[];
  /** World pose for the rig root. */
  pose: { x: number; z: number; y: number; facing: number };
}

export interface DistanceField {
  /** Cost to reach tile index from the origin (Infinity = unreachable). */
  dist: Float32Array;
  /** Parent tile index for path reconstruction (-1 = none). */
  parent: Int32Array;
  originIndex: number;
  version: number;
}

export interface RoomInfo {
  id: number;
  indoor: boolean;
  tiles: number[];
}

export interface SpatialAPI {
  width(): number;
  depth(): number;
  inBounds(x: number, z: number): boolean;
  isBuildable(x: number, z: number): boolean;
  tileIndex(x: number, z: number): number;
  tileOf(p: Vec2): { x: number; z: number };
  /** Tile not blocked by a non-passable floor object (walls are edges, not tiles). */
  isWalkable(x: number, z: number): boolean;
  /** Can a zombie step between two adjacent (8-neighbour) tiles? Respects walls, doors, blocked tiles, no corner cutting. */
  canStep(fx: number, fz: number, tx: number, tz: number): boolean;
  /** 0 = outdoors. */
  roomAt(x: number, z: number): number;
  rooms(): RoomInfo[];
  isIndoor(x: number, z: number): boolean;
  /** Dijkstra from the tile containing `from`. Cached per (tile, lot.version). */
  distanceField(from: Vec2): DistanceField;
  /** Smoothed world-space waypoints from `from` to the centre of tile `to`; null if unreachable. */
  findPath(from: Vec2, to: { x: number; z: number }): Vec2[] | null;
  /** Tie-breaks: the tile itself if walkable; else the closest tile one legal step away (never across a wall);
   *  else a scan preferring the same room, then distance, then tile index. Spatial caches rebuild on lot.version /
   *  wallVersion / invalidate() / a new state object, plus a cheap per-tick blocked-tile check. DistanceFields are
   *  shared cache entries — treat as read-only. */
  nearestWalkable(p: Vec2, maxRadius?: number): { x: number; z: number } | null;
  /** World tiles covered by a floor object. */
  objectTiles(obj: ObjectState): { x: number; z: number }[];
  /** Floor objects (non-rug) covering a tile. */
  objectsAt(x: number, z: number): ObjectId[];
  resolveSlots(obj: ObjectState): ResolvedSlot[];
  surfacePoints(obj: ObjectState): { index: number; x: number; y: number; z: number }[];
  /** Nearest surface point not occupied by a loose item, within maxDist tiles of p (path distance not required). */
  freeSurfaceNear(p: Vec2, maxDist: number, preferObjectId?: ObjectId | null): { objectId: ObjectId; index: number; x: number; y: number; z: number } | null;
  /** World-space centre of an object (any placement) for distance checks. */
  objectCenter(obj: ObjectState): Vec2;
  /** Environment score (-10..10) of the room containing tile. */
  roomEnvironment(x: number, z: number): number;
  checkPlace(defId: ObjectDefId, x: number, z: number, rot: Rot, ignoreObjectId?: ObjectId | null): PlacementResult;
  checkWallItem(defId: ObjectDefId, edge: EdgeKey, side: 0 | 1, ignoreObjectId?: ObjectId | null): PlacementResult;
  checkOpening(defId: ObjectDefId, edge: EdgeKey, ignoreObjectId?: ObjectId | null): PlacementResult;
  /**
   * Home build rules: where the object `defId` may stand on a snap point right now (placement check passed), for the
   * markers in Build mode. Empty when the world has no snap-point building or the object has no snap point left.
   * `x`, `z` is the marker position (tile centre, or the middle of the wall edge).
   */
  snapPoints?(defId: ObjectDefId): { kind: 'wall' | 'floor' | 'ceiling' | 'garden' | 'service'; x: number; z: number; edge?: EdgeKey; side?: 0 | 1 }[];
  /** Call after any change to walls/objects/floors (bumps caches; engine calls it after build ops). */
  invalidate(): void;
}

// ═════════════════════════════════════════ Build / buy ═════════════════════════════════════════

export type BuildCommand =
  | { type: 'buy'; defId: ObjectDefId; x: number; z: number; rot: Rot; tint?: string | null }
  | { type: 'buyWallItem'; defId: ObjectDefId; edge: EdgeKey; side: 0 | 1; tint?: string | null }
  | { type: 'buyOpening'; defId: ObjectDefId; edge: EdgeKey; tint?: string | null }
  | { type: 'move'; objectId: ObjectId; x: number; z: number; rot: Rot }
  | { type: 'moveWallItem'; objectId: ObjectId; edge: EdgeKey; side: 0 | 1 }
  | { type: 'moveOpening'; objectId: ObjectId; edge: EdgeKey }
  | { type: 'sell'; objectId: ObjectId }
  | { type: 'addWalls'; edges: EdgeKey[]; style?: string }
  | { type: 'removeWalls'; edges: EdgeKey[] }
  /** Walls around a rectangle of tiles [x0,x1)x[z0,z1) + floor fill. */
  | { type: 'room'; x0: number; z0: number; x1: number; z1: number; floor?: string | null; wallStyle?: string }
  | { type: 'floor'; x0: number; z0: number; x1: number; z1: number; styleId: string | null }
  | { type: 'paintWall'; edge: EdgeKey; side: 0 | 1; styleId: string }
  /** Paint every wall side facing the room that contains tile (x,z). */
  | { type: 'paintRoom'; x: number; z: number; styleId: string };

/**
 * Build semantics: `cost` is SIGNED (> 0 charge, < 0 refund for sell/removeWalls); a no-op returns {ok:true, cost:0}
 * and records no history. Undo refunds/re-charges exactly; redo re-charges the same amount; both restore objects
 * under their original ids. If the world diverged since the step, undo/redo reverts itself, clears history and
 * returns false. History: 200 entries, dropped if ctx.state is replaced. Version bumps: lot.version on object or
 * wall-structure changes; lot.wallVersion on any wall change incl. paint; lot.floorVersion on floor changes; then
 * spatial.invalidate() + {type:'lot', what} per category. Template doors/windows are listed as
 * { kind: 'opening', edge } with WallSegment.openingId null — engine spawnObject links them (spatial exports an
 * idempotent linkOpenings(state)).
 */
export interface BuildPreview {
  ok: boolean;
  reason?: string;
  cost: number;
  /** Non-fatal: slot indices whose approach tiles are all blocked (buy-mode warning). */
  blockedSlots?: number[];
  /** Edges / tiles affected (for renderer highlight). */
  edges?: EdgeKey[];
  tiles?: { x: number; z: number }[];
}

export interface BuildService {
  preview(cmd: BuildCommand): BuildPreview;
  /** Validates, charges funds (refunds on sell), mutates state, records undo. */
  apply(cmd: BuildCommand): { ok: boolean; reason?: string; cost: number; objectId?: ObjectId };
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Called when leaving build/buy mode. */
  clearHistory(): void;
}

/** New Game lot templates. 'derelict' = the story start (W-113, docs/systems/story-start.md); 'starter' = the furnished
 *  "move-in ready" sandbox cottage; 'empty' = a bare plot. */
export type LotTemplateId = 'derelict' | 'starter' | 'empty';
export const LOT_TEMPLATE_ID_LIST: readonly LotTemplateId[] = ['derelict', 'starter', 'empty'];
export function isLotTemplateId(v: unknown): v is LotTemplateId {
  return v === 'derelict' || v === 'starter' || v === 'empty';
}

export interface LotTemplate {
  id: LotTemplateId;
  name: string;
  description: string;
  startingFunds: number;
}

// ═════════════════════════════════════════ Events (sim -> renderer/audio/UI) ═════════════════════════════════════════

export type SimEvent =
  | { type: 'notify'; id: number }
  | { type: 'bubble'; agentId: AgentId; icon: BubbleIcon; style: 'thought' | 'speech' | 'shout'; positive?: boolean; durationMin?: number }
  | { type: 'sfx'; id: SfxId; pos?: Vec2; agentId?: AgentId; objectId?: ObjectId; volume?: number }
  | { type: 'sfxLoop'; id: SfxId; key: string; on: boolean; pos?: Vec2; agentId?: AgentId; objectId?: ObjectId }
  | { type: 'voice'; agentId: AgentId; emotion: VoiceEmotion; durationMs: number }
  | { type: 'fx'; kind: FxKind; pos?: Vec2; y?: number; agentId?: AgentId; objectId?: ObjectId }
  | { type: 'lot'; what: 'walls' | 'floors' | 'objects' | 'all' }
  | { type: 'agentSpawned'; agentId: AgentId }
  | { type: 'agentDespawned'; agentId: AgentId }
  | { type: 'objectAdded'; objectId: ObjectId }
  | { type: 'objectRemoved'; objectId: ObjectId }
  | { type: 'choice'; choiceId: string }
  | { type: 'skillUp'; agentId: AgentId; skill: SkillId; level: number }
  | { type: 'promotion'; agentId: AgentId; level: number; title: string }
  | { type: 'funds'; delta: number; reason: string }
  | { type: 'milestone'; agentId: AgentId; aspirationId: AspirationId; milestoneId: string }
  | { type: 'gameOver'; reason: string }
  | { type: 'focus'; agentId?: AgentId; pos?: Vec2 }
  | { type: 'music'; mood: 'normal' | 'tense' | 'party' | 'sad' | 'romance' }
  /** W-025 S3: an agent stepped over a portal into another region this tick (`regionId`, pos, facing already switched). */
  | { type: 'regionCrossed'; agentId: AgentId; from: RegionId; to: RegionId; portalId: string }
  /** A home service did something another system acts on (the build data applies a swapped payload / resets points on a respec). */
  | { type: 'homeService'; service: 'hearth' | 'wardrobe' | 'embalming'; action: 'upgrade' | 'swap' | 'respec'; agentId?: AgentId; recordId?: string }
  /**
   * A player/system run or queue item FAILED (the player sees a "couldn't" notice). `reason` is player-facing text;
   * the optional ids (W-131) let tools trace which order failed without parsing that text.
   */
  | { type: 'interactionFailed'; agentId: AgentId; reason: string; uid?: number; interactionId?: InteractionId; source?: QueueSource }
  /**
   * W-131: a QUEUED item left the queue without starting and without a failure notice — its target object was
   * removed (`targetGone`), the agent left the lot (`leftLot`), or a higher-priority item took its place in a full
   * queue (`queueFull`). Closed `cause` vocabulary; emitted for every source so tools see the whole picture.
   */
  | { type: 'orderDropped'; agentId: AgentId; uid: number; interactionId: InteractionId; source: QueueSource; cause: OrderDropCause }
  /** A player/system CLEANING run completed but the target's mess did not go down (owner report: "cleanup did not execute"). */
  | { type: 'interactionNoEffect'; agentId: AgentId; uid: number; interactionId: InteractionId; targetId: string | null; source: QueueSource }
  /** Clear Stuck Mess ran: emitted BEFORE the target is cleared, carrying the evidence (fail count, mess level). */
  | { type: 'stuckMessCleared'; agentId: AgentId; uid: number; objectId: string; defId: string; fails: number; mess: number }
  /** A run ended with outcome 'complete' (engine). `uid` = the run's queue uid (unique per world: de-dup key). */
  | {
      type: 'interactionCompleted';
      uid: number;
      agentId: AgentId;
      interactionId: InteractionId;
      /** Object/agent id of the queued target (null for self/tile). */
      targetId: string | null;
      source: QueueSource;
      /** The actor was a household member when the run completed. */
      household: boolean;
      /** Queued params merged with the run's public scratch data (keys starting with `_` excluded), scalars only. */
      params: Record<string, string | number | boolean>;
    }
  /** Quests (src/sim/systems/quests). grantId = `<worldId>:<questId>:<instance>` — stable across replay/save/load. */
  | { type: 'questStarted'; questId: string; instance: number; grantId: string; title: string }
  | { type: 'questProgress'; questId: string; instance: number; grantId: string; stepIndex: number; stepId: string; progress: number; target: number; stepDone: boolean; credited?: number }
  | { type: 'questCompleted'; questId: string; instance: number; grantId: string; title: string; grant: QuestRewardGrant }
  /**
   * W-124 household jobs (src/sim/systems/jobs): assigned / done (nothing remains, or a once-job's real completion) /
   * blocked (reason changed to a blocking one). `category` is a job category id; `reason` is player-facing text.
   */
  | { type: 'job'; what: 'assign' | 'done' | 'blocked'; jobId: string; agentId: AgentId; category: string; reason: string | null };

// ═════════════════════════════════════════ Commands (UI -> sim) ═════════════════════════════════════════

export type Command =
  | { type: 'queue'; actorId: AgentId; interactionId: InteractionId; target: TargetRef; params?: Record<string, string | number | boolean> }
  | { type: 'cancel'; actorId: AgentId; uid: number }
  | { type: 'build'; cmd: BuildCommand }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'endBuildSession' }
  | { type: 'choice'; choiceId: string; option: number }
  | { type: 'setSettings'; settings: Partial<SimSettings> }
  | { type: 'buyReward'; agentId: AgentId; rewardId: RewardId }
  | { type: 'renameHousehold'; name: string }
  /** W-116 (D-063): household "Autonomous purchases" — 'off', 'unlimited' or a daily cap in $ (0..100000). */
  | { type: 'setAutoPurchases'; value: 'off' | 'unlimited' | number }
  | { type: 'markNotificationsRead' }
  | { type: 'cheat'; code: string }
  /** Quests: abandon a repeatable quest, or pin/unpin one in the HUD tracker. */
  | { type: 'quest'; action: 'abandon' | 'pin' | 'unpin'; questId: string }
  /**
   * W-025 S2 (docs/DESIGN_WORLD_LEVELS.md §1.11): unfreeze the walkable world of a MIGRATED save (`town.expandPending`
   * → false). The game dispatches it, journaled, right after journal recovery, so a schema-v1 journal replays onto the
   * frozen world first and every later replay sees the expansion at the same tick. Refused when there is nothing to
   * expand (no town, or already expanded).
   */
  | { type: 'townExpand' }
  /** W-124 (D-071) household jobs: assign / cancel / pause / resume / set priority / move up or down. */
  | ({ type: 'job' } & JobCommand)
  /** W-013 (D-008) strays and pets: stray interactions and pet care (validated by the pets system). */
  | ({ type: 'pet' } & PetCommand)
  /** Home build step 3-4: the Hearth, Wardrobe, Embalming respec and Crypt vault (validated by the homeServices system). */
  | ({ type: 'home' } & HomeCommand);

/** Home services command payloads. Each needs the matching working furniture placed; `agentId` is the household member. */
export type HomeCommand =
  | { action: 'hearthBuy'; upgradeId: string }
  | { action: 'wardrobeSave'; agentId: AgentId; name: string; payload: unknown }
  | { action: 'wardrobeSwap' | 'wardrobeDelete'; agentId: AgentId; recordId: string }
  | { action: 'respec'; agentId: AgentId }
  | { action: 'stashPut' | 'stashTake'; material: string; units: number };

/** W-013 pet command payloads. Stray actions take `strayId`, pet care takes `petId`; `agentId` is the household member. */
export type PetCommand =
  | { action: 'chase' | 'offerScraps' | 'pet' | 'befriend' | 'adopt'; agentId: AgentId; strayId: string }
  | { action: 'feed' | 'play' | 'cuddle'; agentId: AgentId; petId: string }
  /** Cosmetic: choose the pet's look (the game layer checks the store entitlement for `undead`). */
  | { action: 'look'; petId: string; variant: 'normal' | 'undead'; agentId?: AgentId };

/** W-124 job command payloads (validated by the jobs system; anything else is refused). */
export type JobCommand =
  | { action: 'assign'; agentId: AgentId; category: string; scope: JobScope; mode: JobMode; priority?: JobPriority }
  | { action: 'cancel' | 'pause' | 'resume'; jobId: string }
  | { action: 'priority'; jobId: string; priority: JobPriority }
  | { action: 'move'; jobId: string; dir: -1 | 1 };

/** W-124: one assignment as the HUD shows it (read-only view). */
export interface JobView {
  id: string;
  agentId: AgentId;
  category: string;
  label: string;
  icon: string;
  scope: JobScope;
  scopeLabel: string;
  mode: JobMode;
  modeLabel: string;
  priority: JobPriority;
  paused: boolean;
  status: JobStatus;
  /** "Working", "Taking a break", "Blocked", … */
  statusLabel: string;
  reason: string | null;
  /** Current target ("Rickety Table") while working, else null. */
  targetName: string | null;
  /** Real completions credited so far. */
  done: number;
  /** "3 done", "Fun 64 / 92", "3 done · 2 left". */
  progressLabel: string;
  /** 0..1 when a natural end exists (fun / social toward full), else null. */
  progress: number | null;
  /** Position among this agent's jobs (0 = first) and how many there are. */
  index: number;
  count: number;
}

export interface JobScopeOption {
  scope: JobScope;
  label: string;
}

export interface JobsView {
  list: JobView[];
  /** Categories in display order with the honesty rule applied (available | coming later + reason). */
  categories: { id: string; label: string; icon: string; available: boolean; reason: string | null; openEnded: boolean; agentTargets: boolean }[];
  /** Per available category: the scopes it can use right now (whole lot, rooms, objects hosting its interactions). */
  scopes: Record<string, JobScopeOption[]>;
}

export interface CommandResult {
  ok: boolean;
  reason?: string;
  cost?: number;
  id?: string;
  /** W-025 S3: a `queue` command whose target is in another region (or `params.regionId`) explains its walk. */
  route?: WorldRouteResult;
}

// ═════════════════════════════════════════ Public API + views (for controller / UI / renderer) ═════════════════════════════════════════

export interface MenuEntry {
  interactionId: InteractionId;
  label: string;
  group: string | null;
  icon: BubbleIcon;
  available: boolean;
  reason: string | null;
  cost: number | null;
  params: Record<string, string | number | boolean>;
  /** Shown as a sub-list chooser (recipes, careers, townies). */
  children?: MenuEntry[];
}

export interface NeedView {
  id: NeedId;
  label: string;
  value: number;
  cap: number;
  /** Net change per game hour right now (for arrows). */
  trend: number;
  critical: boolean;
}

export interface MoodView {
  value: number; // -100..100
  band: 'miserable' | 'uneasy' | 'fine' | 'good' | 'great';
  label: string;
  contributors: { label: string; value: number }[];
}

export interface MoodletView {
  id: MoodletId;
  label: string;
  description: string;
  /** TOTAL mood effect, already multiplied by stacks (do not multiply again). */
  mood: number;
  /** Informational only. */
  stacks: number;
  icon: BubbleIcon;
  kind: 'good' | 'bad' | 'neutral';
  /** Remaining game minutes (null = indefinite). */
  remaining: number | null;
}

export interface SkillView {
  id: SkillId;
  name: string;
  icon: BubbleIcon;
  level: number;
  progress: number; // 0..1 toward next level
}

export interface CareerView {
  trackId: CareerId;
  trackName: string;
  level: number;
  title: string;
  wage: number;
  schedule: string;
  performance: number;
  nextTitle: string | null;
  promoteReq: { skill: SkillId; level: number; met: boolean }[];
  status: string;
  icon: BubbleIcon;
}

export interface RelationshipView {
  otherId: AgentId;
  name: string;
  friendship: number;
  romance: number;
  label: string; // 'Best Friend', 'Spouse', 'Acquaintance', 'Nemesis', ...
  inHousehold: boolean;
  onLot: boolean;
}

export interface AspirationView {
  id: AspirationId;
  name: string;
  icon: BubbleIcon;
  points: number;
  milestones: { id: string; label: string; points: number; done: boolean }[];
  rewards: { id: RewardId; name: string; description: string; cost: number; owned: boolean; affordable: boolean; icon: BubbleIcon }[];
}

export interface BillsView {
  /** Dollar amount of all unpaid bills (counts come from bills[]). */
  outstanding: number;
  /** Dollar amount of unpaid bills past their due tick. */
  overdue: number;
  nextDueLabel: string | null;
  utilitiesOn: boolean;
  bills: { id: string; amount: number; dueLabel: string; overdue: boolean; paid: boolean }[];
}

export interface ObjectView {
  id: ObjectId;
  defId: ObjectDefId;
  name: string;
  description: string;
  value: number;
  sellValue: number;
  broken: boolean;
  powered: boolean;
  inUse: boolean;
  detail: string | null; // e.g. 'Servings: 3', 'Leftovers: 2'
}

export interface AgentSummary {
  id: AgentId;
  name: string;
  firstName: string;
  role: AgentState['role'];
  presence: Presence;
  moodBand: MoodView['band'];
  mood: number;
  criticalNeed: NeedId | null;
  activity: string | null; // 'Watching TV'
  activityIcon: BubbleIcon | null;
  isVisitor: boolean;
  appearance: ZombieAppearance;
}

export interface QueueView {
  uid: number;
  label: string;
  icon: BubbleIcon;
  active: boolean;
  progress: number; // 0..1 for active
  cancellable: boolean;
  source: QueueSource;
}

export interface TownieView {
  id: AgentId;
  name: string;
  occupation: string | null;
  friendship: number;
  romance: number;
  met: boolean;
  label: string;
  available: boolean;
}

export interface PartyView {
  active: boolean;
  score: number;
  /** COMPLETE player-facing phrase ("Ends 1:16 AM", "Party's over") — show verbatim. */
  endsLabel: string;
  guests: number;
}

export interface NewMemberSpec {
  firstName: string;
  lastName: string;
  appearance: ZombieAppearance;
  traits: TraitId[];
  aspiration: AspirationId | null;
  /** If set, createNewWorld uses it as AgentState.voiceSeed (so the CAZ voice preview matches in-game). */
  voiceSeed?: number;
}

export interface NewGameOptions {
  seed: number;
  householdName: string;
  members: NewMemberSpec[];
  lotTemplate: LotTemplate['id'];
  difficulty: SimSettings['difficulty'];
  /**
   * W-025 S2/S7 (§1.9 item 6): a fixed start instead of the seeded one. Its `slotId` places the home region; its
   * `templateId` must be one of `LOT_TEMPLATES` or a generated variant of one (the v1 derelict pool), else the pick
   * is ignored and `lotTemplate` wins. A canonical pick (sub-seeds 0) builds the shipped template bytes (variation
   * off); a non-canonical one replays that generated start exactly. Absent: see `startVariation`.
   */
  startPick?: StartPick;
  /**
   * W-025 S7: with no `startPick`, draw a validated generated start from `seed` (`generateStart`) for `lotTemplate`.
   * Absent / false: the canonical start (`lotTemplate` at 'mildew_n2', variation off; tests, balance, e2e, AC-1).
   * The base type still drives the story arc and the starting funds; a refused seed falls back to the canonical start.
   */
  startVariation?: boolean;
  /** Snap-point building (home build rules): the new world carries `WorldState.homeBuild`. Off = free placement, as ever. */
  homeBuild?: boolean;
}

export interface SimulationAPI {
  readonly state: WorldState;
  readonly content: ContentRegistry;
  readonly spatial: SpatialAPI;
  readonly build: BuildService;
  /** Warnings produced by repairWorld when this simulation was created from a (loaded) state. Empty for healthy worlds. */
  readonly repairWarnings: string[];
  /** Advance exactly one tick (TICK_MINUTES). Never throws: faults are contained per agent/system and logged. */
  step(): void;
  dispatch(cmd: Command): CommandResult;
  /** Events emitted since the last drain (renderer/audio/UI consume). */
  drainEvents(): SimEvent[];
  /** Fault log (agent/system errors contained by fault barriers). */
  faults(): { tick: number; where: string; message: string }[];
  time(): TimeInfo;
  agent(id: AgentId): AgentState | undefined;
  object(id: ObjectId): ObjectState | undefined;
  household(): AgentSummary[];
  summary(agentId: AgentId): AgentSummary | null;
  onLotSummaries(): AgentSummary[];
  menu(actorId: AgentId, target: TargetRef): MenuEntry[];
  queueView(agentId: AgentId): QueueView[];
  needs(agentId: AgentId): NeedView[];
  mood(agentId: AgentId): MoodView;
  moodlets(agentId: AgentId): MoodletView[];
  skills(agentId: AgentId): SkillView[];
  career(agentId: AgentId): CareerView | null;
  relationships(agentId: AgentId): RelationshipView[];
  aspiration(agentId: AgentId): AspirationView | null;
  bills(): BillsView;
  objectView(id: ObjectId): ObjectView | null;
  townies(forAgentId: AgentId): TownieView[];
  careersAvailable(): { id: CareerId; name: string; description: string; startTitle: string; wage: number; schedule: string; icon: BubbleIcon }[];
  party(): PartyView | null;
  lotValue(): number;
  /** 0..1 visual decay for the renderer (delegates to sys('decay').decayLevel; falls back to 1 - preservation/100). */
  decayLevel?(agentId: AgentId): number;
  /** Quest log for the HUD (delegates to sys('quests').view; null when the quests system is absent). */
  quests?(): QuestsView | null;
  /**
   * W-025 S3 (DESIGN_WORLD_LEVELS §1.16): plan a walk of `actorId` to a region-local tile anywhere in the world WITHOUT
   * changing anything. Returns the route (portal ids, length, ETA) or exactly one reason code (`noPath` / `private` /
   * `locked` / `unfinished`); garbage input gives `noPath`. "Walk there" is then the journaled `queue` command
   * (`engine_goHere` with `params.regionId`), whose result carries the same `route`.
   */
  worldRoute?(actorId: AgentId, target: WorldRouteTarget): WorldRouteResult;
  /** W-124 household jobs for the HUD (delegates to sys('jobs').view; null when the jobs system is absent). */
  jobs?(): JobsView | null;
  /** Deep JSON-safe copy of the world for saving. */
  serialize(): WorldState;
  /** Validate invariants; returns human-readable violations (empty = healthy). Used by tests & debug overlay. */
  checkInvariants(): string[];
}

/** W-131 closed vocabulary: why a queued order left the queue without running. */
export type OrderDropCause = 'targetGone' | 'leftLot' | 'queueFull';
