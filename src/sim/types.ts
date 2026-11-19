/**
 * WORLD STATE CONTRACT — the complete, JSON-serializable game state.
 * Everything a save file contains lives here. No class instances, no functions, no Maps/Sets,
 * no undefined-vs-missing semantics that differ (use null for "none").
 * Owner: integration lead. Changes require a contract request (docs/CONTRACTS.md).
 */
import type { ZombieAppearance, LimbState, AnimState, Expression, CarryItem, LimbId } from '../shared/appearance';
import type { Rot } from '../shared/dimensions';
import type { RegionId, TownStateV2 } from '../shared/world';

/** v3 combines the published jobs-v2 and internal world-v2 through one lossless migration step (Cloud R1). */
export const SAVE_SCHEMA_VERSION = 3;

/** Game minutes advanced per simulation tick. */
export const TICK_MINUTES = 0.25;
export const TICKS_PER_HOUR = 60 / TICK_MINUTES; // 240
export const TICKS_PER_DAY = TICKS_PER_HOUR * 24; // 5760
/** Real-time game-minutes-per-second for each speed setting (index = speed). */
export const SPEED_MINUTES_PER_SECOND = [0, 1, 3, 8, 30] as const;
export type Speed = 0 | 1 | 2 | 3 | 4;

export type AgentId = string; // 'a12'
export type ObjectId = string; // 'o57'
export type ObjectDefId = string;
export type InteractionId = string;
export type MoodletId = string;
export type TraitId = string;
export type CareerId = string;
export type AspirationId = string;
export type RewardId = string;
export type WallStyleId = string;
export type FloorStyleId = string;
/** 'h:x:z' = horizontal edge from (x,z) to (x+1,z) (lies on line z). 'v:x:z' = vertical edge from (x,z) to (x,z+1) (lies on line x). */
export type EdgeKey = string;

export const NEED_IDS = ['hunger', 'energy', 'preservation', 'social', 'fun', 'hygiene'] as const;
export type NeedId = (typeof NEED_IDS)[number];

export const SKILL_IDS = ['cooking', 'charisma', 'mortuary', 'logic', 'creativity', 'fitness'] as const;
export type SkillId = (typeof SKILL_IDS)[number];
export const SKILL_MAX_LEVEL = 10;

export interface Vec2 {
  x: number;
  z: number;
}

/** xoshiro128** state; four uint32 words. */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

// ───────────────────────────────────────────── Lot / spatial ─────────────────────────────────────────────

export interface WallSegment {
  /** Paint style per side. Side 0 = the -Z tile (for 'h') / -X tile (for 'v'); side 1 = the +Z / +X tile. */
  paint: [WallStyleId, WallStyleId];
  /** Door or window object occupying this segment, if any. */
  openingId: ObjectId | null;
}

export interface LotState {
  width: number; // tiles along X
  depth: number; // tiles along Z
  /** Build/buy allowed for tiles x in [x0,x1), z in [z0,z1). Outside is yard edge + sidewalk. */
  buildable: { x0: number; z0: number; x1: number; z1: number };
  /** Z row of the public sidewalk (walkable, never buildable). Street lies beyond z = depth. */
  sidewalkZ: number;
  /** Where off-lot zombies appear/disappear (tile centres on the sidewalk). */
  entryPoints: Vec2[];
  walls: Record<EdgeKey, WallSegment>;
  /** Row-major (index = z*width + x). null = outdoor ground (grass). */
  floors: (FloorStyleId | null)[];
  /** Bumped on ANY structural change (walls, openings, floor objects). Pathfinding & renderer caches key off it. */
  version: number;
  wallVersion: number;
  floorVersion: number;
}

// ───────────────────────────────────────────── Objects ─────────────────────────────────────────────

export type ObjectPlacement =
  /** Furniture on the tile grid; (x,z) = min corner of the ROTATED footprint. */
  | { kind: 'floor'; x: number; z: number; rot: Rot }
  /** Wall decor (paintings, sconces) hung on one side of a wall segment. */
  | { kind: 'wall'; edge: EdgeKey; side: 0 | 1 }
  /** Door or window filling a wall segment. */
  | { kind: 'opening'; edge: EdgeKey }
  /** Loose item at a continuous world position (plates, limbs, bone piles, fire). y = resting height. */
  | { kind: 'loose'; x: number; z: number; y: number; parentId: ObjectId | null; surfaceIndex: number | null; facing: number }
  /** Carried in a zombie's hand. */
  | { kind: 'held'; agentId: AgentId };

export interface ObjectCondition {
  broken: boolean;
  /** 0..1 grime (dirty dishes/flies on object); purely cosmetic + environment. */
  dirt: number;
  burning: boolean;
  /** Minutes this object has been on fire. */
  burnMinutes: number;
}

export interface ObjectState {
  id: ObjectId;
  defId: ObjectDefId;
  /**
   * W-025 (D-068): region whose lot-local grid `placement` is in. ABSENT = the home region (every pre-world object, and
   * every object of a home-only world: absent, never written, so old saves stay byte-identical). Objects never change
   * region; a held item is in its holder's region and takes it when dropped.
   */
  regionId?: RegionId;
  placement: ObjectPlacement;
  /** Price paid (resale basis). 0 for spawned items. */
  value: number;
  purchasedTick: number;
  /** Optional hex tint applied to the model's 'Paint' material. */
  tint: string | null;
  condition: ObjectCondition;
  /** Def-specific data (servings, quality, recipeId, ownerId, limbId, createdTick, uses, paintingValue, ...). JSON values only. */
  data: Record<string, string | number | boolean | null>;
  /** slotIndex -> agent holding the reservation. */
  reservedBy: Record<string, AgentId>;
  /** Agents actively using the object (for visuals: TV on, shower water). */
  inUseBy: AgentId[];
  /** Bumped on any visual change; renderer re-syncs when it changes. */
  rev: number;
}

// ───────────────────────────────────────────── Agents ─────────────────────────────────────────────

export type AgentRole = 'household' | 'townie' | 'service';
/**
 * onLot   — physically simulated on the lot (household at home, visitors, walk-bys, service NPCs)
 * offLot  — exists in town, not simulated per-tick
 * atWork  — household member away at their job
 * crumbled— household member reduced to a bone pile (may be reanimated)
 * gone    — permanently gone (urn) or a despawned service NPC; kept for history
 */
export type Presence = 'onLot' | 'offLot' | 'atWork' | 'crumbled' | 'gone';

export interface MoodletInstance {
  id: MoodletId;
  startTick: number;
  /** null = until removed by a system. */
  endTick: number | null;
  stacks: number;
  /** Who/what caused it (agent or object id) for UI tooltips. */
  sourceId: string | null;
}

export interface SkillState {
  level: number; // 0..10
  xp: number; // xp toward next level
}

export interface CareerState {
  trackId: CareerId;
  level: number; // 1..5
  performance: number; // -100..100
  daysAtLevel: number;
  missedStreak: number;
  /** Day number (1-based) the current/most recent shift belongs to; -1 if none yet. */
  lastShiftDay: number;
  /** Status of today's shift. */
  shiftStatus: 'none' | 'pending' | 'atWork' | 'done' | 'missed' | 'sick';
  shiftStartTick: number | null;
  /** Mood samples while at work (sum/count) for the performance calc. */
  moodSum: number;
  moodSamples: number;
  sickDaysUsed: number;
}

export type TargetRef =
  | { kind: 'object'; id: ObjectId }
  | { kind: 'agent'; id: AgentId }
  | { kind: 'tile'; x: number; z: number }
  | { kind: 'self' };

export type QueueSource = 'player' | 'auto' | 'system';

export interface QueueItem {
  /** Unique per world (from WorldState.nextId). */
  uid: number;
  interactionId: InteractionId;
  target: TargetRef;
  params: Record<string, string | number | boolean>;
  source: QueueSource;
  /** Higher runs first. system=300, player=200, auto=100 (+ bonus for critical needs). */
  priority: number;
  queuedTick: number;
}

export type InteractionPhase = 'route' | 'wait' | 'run' | 'exit';

export interface ActiveInteraction extends QueueItem {
  phase: InteractionPhase;
  /** Multi-stage interactions (fridge->stove, meal->chair). 0-based. */
  stage: number;
  /** Target of the current stage (may differ from QueueItem.target). */
  stageTarget: TargetRef;
  /** Reserved slot index on stageTarget's object, if any. */
  slot: number | null;
  /** Tile the zombie is routing to for this stage. */
  routeGoal: Vec2 | null;
  /** Final pose (world) once in position; null = stand where you are. */
  pose: { x: number; z: number; y: number; facing: number } | null;
  startedRunTick: number | null;
  /** Game minutes elapsed in the current run stage. */
  elapsed: number;
  /** Game minutes the current run stage lasts. Use a large number (1e9) for stopWhen-only interactions. */
  duration: number;
  partnerId: AgentId | null;
  routeFails: number;
  waitMinutes: number;
  /** Behaviour scratch space (JSON values only). Keys starting with `_` are ENGINE-RESERVED (routing/run bookkeeping) — behaviours must not use them. */
  data: Record<string, string | number | boolean | null>;
  canceled: boolean;
}

export interface VisitState {
  arrivedTick: number;
  leaveTick: number;
  reason: 'invited' | 'walkBy' | 'dropIn' | 'party' | 'delivery' | 'repo' | 'moveIn';
  /** Has been welcomed in (may use the house) vs. waiting at the door/yard. */
  welcomed: boolean;
  leaving: boolean;
}

export interface WalkByState {
  from: Vec2;
  to: Vec2;
  startedTick: number;
}

export interface AgentStatus {
  /** Minutes spent with preservation at 0 (crumble at 24h). */
  zeroPreservationMinutes: number;
  passedOut: boolean;
  feral: boolean;
  /** Tick until which autonomy will not re-plan (backoff after failures/idle). */
  autonomyCooldownUntil: number;
  lastSocialTick: number;
  /** Consecutive failed autonomy picks (for backoff). */
  autonomyFails: number;
  /** Bone pile object while crumbled. */
  bonePileId: ObjectId | null;
  crumbledTick: number | null;
}

export interface AgentState {
  id: AgentId;
  role: AgentRole;
  /**
   * W-025 (D-068): region the agent stands in (`pos` / `path` are lot-local to it). ABSENT = the home region (written
   * only once an agent stands somewhere else; home-only worlds never carry it). Switches at a portal crossing (S3).
   */
  regionId?: RegionId;
  /**
   * W-025 S3: welcomed into a neighbour's house (knock → the resident answered, DESIGN_WORLD_LEVELS §1.5): the agent
   * walks that region with the resident step mask until `untilTick`. ABSENT for everyone else (home-only worlds never
   * write it).
   */
  welcome?: { regionId: RegionId; untilTick: number };
  presence: Presence;
  firstName: string;
  lastName: string;
  appearance: ZombieAppearance;
  traits: TraitId[];
  rewardTraits: TraitId[];
  aspiration: AspirationId | null;
  aspirationMilestones: string[];
  aspirationPoints: number;
  needs: Record<NeedId, number>; // 0..100, preservation <= vitality
  /** Preservation cap (20..100). Erodes slowly; the long-term decay economy. */
  vitality: number;
  moodlets: MoodletInstance[];
  skills: Record<SkillId, SkillState>;
  career: CareerState | null;
  limbs: LimbState;
  /** Rotation-free continuous position (tile units). */
  pos: Vec2;
  /** Position at the start of the current tick (renderer interpolates prevPos -> pos). */
  prevPos: Vec2;
  /** Vertical root offset for the current pose (sit=0, lie=BED_HEIGHT, ...). */
  posY: number;
  facing: number;
  prevFacing: number;
  path: Vec2[] | null;
  pathIndex: number;
  queue: QueueItem[];
  active: ActiveInteraction | null;
  anim: AnimState;
  expression: Expression;
  carrying: CarryItem | null;
  /** Object currently carried (e.g. the plate), mirrors ObjectPlacement 'held'. */
  carryObjectId: ObjectId | null;
  status: AgentStatus;
  visit: VisitState | null;
  walkBy: WalkByState | null;
  /** Stable seed for voice timbre & idle variation. */
  voiceSeed: number;
  createdTick: number;
  /** Townie flavour: their own (off-screen) job title, for UI. */
  occupation: string | null;
}

// ───────────────────────────────────────────── Social ─────────────────────────────────────────────

export interface Relationship {
  /** Lexicographically smaller id first. Key in WorldState.relationships = `${a}|${b}`. */
  a: AgentId;
  b: AgentId;
  friendship: number; // -100..100
  romance: number; // 0..100
  met: boolean;
  partners: boolean;
  engaged: boolean;
  married: boolean;
  bestFriends: boolean;
  lastInteractionTick: number;
  interactions: number;
}

// ───────────────────────────────────────────── Household / economy ─────────────────────────────────────────────

export interface Bill {
  id: string;
  issuedTick: number;
  dueTick: number;
  amount: number;
  paidTick: number | null;
  /** 0 = none, 1 = reminder sent, 2 = final notice sent, 3 = power cut, 4 = repo dispatched. */
  stage: number;
}

export interface HouseholdState {
  name: string;
  /** Integer dollars. Never negative. */
  funds: number;
  memberIds: AgentId[];
  bills: Bill[];
  utilitiesOn: boolean;
  /** Day the repo ghoul was last dispatched (avoid double-dispatch). */
  repoDispatchedDay: number | null;
  /** Idempotency keys of completed monetary transactions (bounded ring, last 256). */
  txLog: string[];
}

// ───────────────────────────────────────────── Notifications / choices / party ─────────────────────────────────────────────

export type NotificationKind = 'info' | 'good' | 'bad' | 'warning' | 'money' | 'career' | 'social' | 'decay' | 'romance' | 'skill';

export interface Notification {
  id: number;
  tick: number;
  kind: NotificationKind;
  title: string;
  text: string;
  agentId: AgentId | null;
  objectId: ObjectId | null;
  read: boolean;
}

export interface ChoiceOption {
  label: string;
  /** Effect handler id executed when chosen (see contracts.ts EFFECT_IDS). */
  effect: string;
  params: Record<string, string | number | boolean>;
  tooltip: string | null;
}

export interface ChoiceState {
  id: string;
  tick: number;
  title: string;
  text: string;
  agentId: AgentId | null;
  options: ChoiceOption[];
  /** Auto-resolves to defaultOption at this tick. */
  expiresTick: number;
  defaultOption: number;
}

export interface PartyState {
  hostId: AgentId;
  startTick: number;
  endTick: number;
  guestIds: AgentId[];
  /** 0..100 running score. */
  score: number;
  ended: boolean;
}

export interface SimSettings {
  /** Free will for household zombies. */
  autonomy: 'full' | 'limited' | 'off';
  /** Decay/needs difficulty multiplier preset. */
  difficulty: 'relaxed' | 'normal' | 'grim';
  visitorsEnabled: boolean;
  /** Auto-pause on important events is a UI concern; not here. */
}

export interface StatsState {
  /** Global counters: mealsCooked, paintingsSold, partiesThrown, limbsLost, billsPaid, ... */
  counters: Record<string, number>;
  /** Per-agent counters keyed by agent id. */
  agent: Record<AgentId, Record<string, number>>;
}

export interface WorldState {
  schemaVersion: number;
  /** Seed the world was created with (informational; live RNG state is `rng`). */
  seed: number;
  rng: RngState;
  tick: number;
  /** Monotonic id counter for agents ('a'+n), objects ('o'+n), queue uids, notifications. */
  nextId: number;
  household: HouseholdState;
  lot: LotState;
  agents: Record<AgentId, AgentState>;
  objects: Record<ObjectId, ObjectState>;
  relationships: Record<string, Relationship>;
  /** Newest last; trimmed to the last 120. */
  notifications: Notification[];
  choices: ChoiceState[];
  party: PartyState | null;
  /** Misc persistent flags (e.g. 'fullMoonDay', 'tutorialStage' is NOT here — that's profile). */
  flags: Record<string, string | number | boolean>;
  stats: StatsState;
  settings: SimSettings;
  /** Game over reached (all household members gone). */
  gameOver: boolean;
  /**
   * Quest progress (src/sim/systems/quests, docs/MONETIZATION.md §2). OPTIONAL and additive: saves written before
   * the quest system existed have no key and load without warnings (the quests system creates it on init). Only the
   * quests system writes it; nothing else in the sim reads it (quests never change needs, funds or autonomy).
   */
  quests?: QuestsState;
  /**
   * W-025 walkable world (schema v2, `TownStateV2` in src/shared/world.ts). OPTIONAL: the v1 → v2 migration and every
   * new world add it; a world without it is a home-only world at the legacy placement (`wormwood:mildew_n2`, origin
   * (70, 0), rot 0) and behaves exactly like one with `expandPending: true`.
   */
  town?: TownStateV2;
  /**
   * W-124 (D-071): household job assignments (src/sim/systems/jobs). Present in every schema-v2 world (the v1→v2
   * migration adds an empty list; the jobs system creates it on init when absent). Only the jobs system writes it.
   */
  jobs?: JobsState;
  /**
   * W-013 (D-008) strays and household pets (src/sim/systems/pets). OPTIONAL and additive: saves written before pets
   * existed have no key and load without warnings (the pets system creates it on init). Only the pets system writes it.
   */
  pets?: PetsState;
  /**
   * Home build rules (src/shared/homeBuild.ts): snap points for the first 20 placed items, tier caps. OPTIONAL: only worlds
   * created with snap-point building on carry it; old saves and test worlds build freely as before.
   */
  homeBuild?: import('../shared/homeBuild').HomeBuildState;
  /**
   * Home services (src/shared/homeServices.ts): the Hearth and its Rot Essence, the Wardrobe's saved builds, the Embalming
   * respec day, the Crypt vault. OPTIONAL and additive: saves written before it have no key and load without warnings
   * (the homeServices system creates it on init). Only the homeServices system writes it.
   */
  homeServices?: import('../shared/homeServices').HomeServicesState;
}

// ───────────────────────────────────────────── Strays and pets (save format, W-013) ─────────────────────────────────────────────

export const PET_SPECIES = ['cat', 'dog', 'raccoon', 'crow'] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];
export const PET_TRAITS = ['lazy', 'guard', 'curious', 'thief'] as const;
export type PetTrait = (typeof PET_TRAITS)[number];
export const PET_NEEDS = ['appetite', 'fun', 'hygiene', 'affection'] as const;
export type PetNeedId = (typeof PET_NEEDS)[number];
export type StrayPlace = 'street' | 'graveyard';
/** How a pet looks: the plain animal, or its undead variant (stitched, glowing-eyed; a store unlock, cosmetic only). */
export const PET_VARIANT_IDS = ['normal', 'undead'] as const;
export type PetVariantId = (typeof PET_VARIANT_IDS)[number];
/** Clips the pet rigs play for a sim anim state (src/render/pets/rig.ts PET_ANIM_STATES + the art's extra clips). */
export const PET_ANIMS = ['idle', 'walk', 'run', 'sit', 'sleep', 'eat', 'play', 'beg', 'flee'] as const;
export type PetAnim = (typeof PET_ANIMS)[number];

/**
 * Where a stray or pet is and what it is doing (W-013 motion, src/sim/systems/pets/motion.ts). All of it is
 * deterministic sim state: positions are world tile coordinates (same space as AgentState.pos), `facing` is yaw in
 * radians with 0 = nose toward +Z. `goal` is the point it is walking to (null = resting); `slot` is the 15-minute
 * slot the goal was picked in; `busyUntil` holds an `anim` (eat, play, flee, ...) in place until that tick.
 */
export interface PetBody {
  pos: Vec2;
  facing: number;
  anim: PetAnim;
  goal: Vec2 | null;
  slot: number;
  busyUntil: number;
}

/** A stray hanging around the street or the graveyard. Trust 0..100; adoptable at PET_ADOPT_TRUST. */
export interface StrayState extends PetBody {
  id: string;
  species: PetSpecies;
  name: string;
  trait: PetTrait;
  place: StrayPlace;
  trust: number;
  /** No trust-raising interaction lands before this tick (anti-spam; chase ignores it). */
  calmTick: number;
  /** A chase gives its fun and trust loss only once per cool-down: no endless free fun from chasing (review). */
  chaseCoolTick: number;
  arrivedTick: number;
  /** A household pet chased it off (living-things.md section 3): at this tick it leaves the lot for `leaveDays` game days. Absent = staying. */
  leaveTick?: number;
  leaveDays?: number;
}

/** A household pet. Needs 0..100; `neglectMin` = game minutes spent neglected in a row. */
export interface PetState extends PetBody {
  id: string;
  species: PetSpecies;
  name: string;
  trait: PetTrait;
  adoptedTick: number;
  needs: Record<PetNeedId, number>;
  neglectMin: number;
  /** Guard trait: until this tick the pet is at the gate barking (the Repo Ghoul was held off). 0 = off duty. */
  guardUntil: number;
  /** Cosmetic look. The sim does not know about entitlements: the game layer only lets an entitled player pick `undead`. */
  variant: PetVariantId;
  /** Per-game-day encounter counters (living-things.md section 3): the day they are for and how often each group fired. Absent = none yet. */
  enc?: { day: number; n: Record<string, number> };
}

/** A pet that ran away (neglect). It comes back as a stray at `returnTick` — pets never die. */
export interface RunawayState {
  id: string;
  species: PetSpecies;
  name: string;
  trait: PetTrait;
  returnTick: number;
  /** A stray a pet chased off comes back where it was, keeping this much trust. Absent = a runaway pet (the old rule). */
  trust?: number;
  place?: StrayPlace;
}

/** What a click on an animal asks a zombie to do (src/sim/contracts.ts PetCommand). */
export const PET_ACTION_IDS = ['chase', 'offerScraps', 'pet', 'befriend', 'adopt', 'feed', 'play', 'cuddle'] as const;
export type PetActionId = (typeof PET_ACTION_IDS)[number];

/**
 * A pet command whose zombie is still walking to the animal: the action runs when it is close enough (the zombie's
 * `engine_goHere` queue item `uid` is the walk). `to` is the tile it was sent to; `tries` counts re-sends when the
 * animal moved on before the zombie arrived.
 */
export interface PendingPetAction {
  agentId: AgentId;
  kind: 'stray' | 'pet';
  targetId: string;
  action: PetActionId;
  uid: number;
  to: Vec2;
  tries: number;
  queuedTick: number;
}

export interface PetsState {
  version: 1;
  nextId: number;
  strays: StrayState[];
  pets: PetState[];
  away: RunawayState[];
  pending: PendingPetAction[];
}

// ───────────────────────────────────────────── Household jobs (save format, W-124) ─────────────────────────────────────────────

/** Where a job may look for work. Room = the room containing a LOT-LOCAL anchor tile (room ids are recomputed when walls
 *  change, so the anchor is what persists). Never neighbourhood-map coordinates. */
export type JobScope = { kind: 'lot' } | { kind: 'room'; x: number; z: number } | { kind: 'object'; id: ObjectId };
/** once = one real completion; untilDone = until nothing remains; recurring = every day inside [from, to) game hours. */
export type JobMode = { kind: 'once' } | { kind: 'untilDone' } | { kind: 'recurring'; from: number; to: number };
export type JobPriority = 'high' | 'normal' | 'low';
/**
 * waiting = will pick a target when the zombie is free; working = a job run is queued / running; break = yielding to an
 * urgent need; blocked = nothing it may do right now (reason); resting = a recurring job outside its window or done
 * for now; paused = paused by the player; away = the zombie is not home.
 */
export type JobStatus = 'waiting' | 'working' | 'break' | 'blocked' | 'resting' | 'paused' | 'away';

export interface JobAssignment {
  /** 'j1', 'j2', … (JobsState.nextId). */
  id: string;
  agentId: AgentId;
  /** Job category id (src/shared/jobs.ts JOB_CATEGORIES). */
  category: string;
  scope: JobScope;
  mode: JobMode;
  priority: JobPriority;
  paused: boolean;
  /** W-025 seam: the lot the job belongs to. null = the one simulated home lot (until town state exists). */
  lotId: string | null;
  createdTick: number;
  status: JobStatus;
  /** Player-facing reason for blocked / break / resting / away (null otherwise). */
  reason: string | null;
  /** Queue uid of the job run in flight (null = none). */
  runUid: number | null;
  /** Interaction + target of that run ('o12', 'a:a3'), and the measured state before it (completion check). */
  interactionId: string | null;
  targetKey: string | null;
  targetName: string | null;
  before: number | null;
  /** The run reached its 'run' phase (a run that never arrives is an unreachable target). */
  reached: boolean;
  /** Real completions credited (state actually changed). */
  done: number;
  /** Need the job is yielding to (break), or null. */
  breakNeed: NeedId | null;
  /** Earliest tick to look for work again (backoff while blocked / nothing to do). */
  nextCheckTick: number;
  /** Targets skipped until a tick (unreachable / removed / made no difference), bounded. */
  skips: { key: string; until: number; reason: string }[];
  /** Recurring: window key (day the window opened) already reported "done for today"; -1 = none. */
  restKey: number;
}

export interface JobsState {
  version: 1;
  nextId: number;
  /** Assignment order = the player's order (reorder moves entries); priority sorts first. */
  list: JobAssignment[];
}

// ───────────────────────────────────────────── Quests (save format) ─────────────────────────────────────────────

/** Progress of ONE objective (JSON-only; shared by world quests and the game layer's profile-level daily tasks). */
export interface ObjectiveProgress {
  /** Counted progress toward the objective's target (monotonic for counting kinds). */
  progress: number;
  /** Stat/relationship baseline captured when the objective started (counting state kinds). */
  baseline: number;
  /** Game minutes the state predicate has held continuously (hold kinds: own, roomEnv). */
  heldMin: number;
  /** Tick / 1-based day the objective started (days, own.fresh, billsOnTime). */
  startTick: number;
  startDay: number;
  /** Bounded de-duplication keys (event keys / bill ids already counted), newest last. */
  seen: string[];
  /** World the baselines belong to (QuestsState.worldId); a different world re-baselines (game-layer reuse). */
  worldId: string;
  done: boolean;
  /**
   * W-116 (D-061): units of this objective credited at step start from actions done earlier in the story arc
   * ("Already done — nice"). OPTIONAL: absent on every objective that was never credited (old saves unchanged).
   */
  credited?: number;
}

/**
 * W-116 (D-061): qualifying actions done since this world's story arc began, for arc steps that are not running yet.
 * When such a step starts it is credited from here (order-independent beats). OPTIONAL: only arc worlds have it.
 */
export interface QuestArcLog {
  arc: string;
  /** Tick the arc began (its first quest started); nothing before it is ever credited. */
  startTick: number;
  /** Wall segments standing / the world's nextId when the arc began (baselines for `walls` / `own.fresh` steps). */
  walls: number;
  nextId: number;
  /** `<questId>#<stepId>` → matching events since the arc began (capped at the step's target). */
  counts: Record<string, number>;
  /** De-duplication keys of events already logged (bounded, newest last). */
  seen: string[];
}

export interface QuestInstanceState {
  questId: string;
  /** 1-based completion instance (story quests: always 1). Part of the grant id. */
  instance: number;
  startedTick: number;
  /** Index of the current step (steps run in order). */
  stepIndex: number;
  step: ObjectiveProgress;
}

/** A completed quest's grant, recorded in the world so the game layer can reconcile a grant it never saw. */
export interface QuestGrantRecord {
  grantId: string;
  questId: string;
  instance: number;
  tick: number;
  bones: number;
  entitlements: string[];
}

export interface QuestsState {
  version: 1;
  /** Stable id of this world (derived once from the world itself; save-slot copies share it on purpose). */
  worldId: string;
  /** Active quest instances, in start order. */
  active: QuestInstanceState[];
  /** Completed instances per quest id. */
  completions: Record<string, number>;
  /** Day (1-based) each quest last ended (completed or abandoned) — repeat cooldowns. */
  lastEndedDay: Record<string, number>;
  /** Completed grants, oldest first (bounded: last 256). */
  grants: QuestGrantRecord[];
  /** Quest id the HUD tracker pins (null = none). */
  pinned: string | null;
  /** W-116: story-arc action log (arc worlds only; absent elsewhere). */
  arcLog?: QuestArcLog;
}

export type LimbItemData = { limbId: LimbId; ownerId: AgentId; createdTick: number; rotten: boolean };
