/**
 * Structural schema for WorldState (src/sim/types.ts). Every field is type/range checked; leaves
 * with an obvious neutral value are repaired, broken collection entries are dropped, and a broken
 * top-level structure is fatal. Semantic consistency (dangling references, reservations, ...) is the
 * engine's repairWorld — this layer only guarantees the engine receives well-typed data.
 *
 * Literal lists that the contract only declares as TYPE unions are mirrored here with compile-time
 * exhaustiveness checks (`Exact<...>`): if the contract adds a member, this file stops compiling.
 */
import { isCastBodyId, type BodyId } from '../../shared/cast';
import type {
  ActiveInteraction,
  AgentRole,
  AgentState,
  AgentStatus,
  Bill,
  CareerState,
  ChoiceOption,
  ChoiceState,
  HouseholdState,
  InteractionPhase,
  LotState,
  MoodletInstance,
  Notification,
  NotificationKind,
  ObjectCondition,
  ObjectPlacement,
  ObjectState,
  PartyState,
  Presence,
  QueueItem,
  QueueSource,
  Relationship,
  RngState,
  SimSettings,
  SkillState,
  StatsState,
  TargetRef,
  Vec2,
  VisitState,
  WalkByState,
  WallSegment,
  WorldState,
} from '../../sim/types';
import { NEED_IDS, SKILL_IDS, SKILL_MAX_LEVEL } from '../../sim/types';
import type { LimbCondition, ZombieAppearance } from '../../shared/appearance';
import {
  ACCESSORIES,
  ANIM_STATES,
  BOTTOM_STYLES,
  CARRY_ITEMS,
  EXPRESSIONS,
  EYE_STYLES,
  HAIR_STYLES,
  LIMB_IDS,
  SKIN_TONES,
  TOP_STYLES,
  defaultAppearance,
} from '../../shared/appearance';
import type { Rot } from '../../shared/dimensions';
import { DEFAULT_INTERIOR_WALL } from '../../shared/styles';
import {
  type Check,
  INVALID,
  arr,
  bool,
  fixedRec,
  lit,
  nullable,
  num,
  obj,
  rec,
  scalar,
  str,
  tagged,
  tuple2,
} from './core';
import { questsSchema } from './questsSchema';
import { makeTownSchema, optionalRegionId, optionalWelcome } from './townSchema';
import { jobsSchema } from './jobsSchema';
import { petsSchema } from './petsSchema';
import { homeServicesSchema } from './homeServicesSchema';
import { homeBuildSchema } from './homeBuildSchema';

// ───────────────────────────── literal mirrors with exhaustiveness checks ─────────────────────────────

/** Compile-time: `L` lists exactly the members of union `U`. */
type Exact<U, L extends readonly U[]> = [Exclude<U, L[number]>] extends [never] ? true : false;
const exact = <U>() => <L extends readonly U[]>(l: L & (Exact<U, L> extends true ? unknown : 'missing union member')) => l;

export const AGENT_ROLES = exact<AgentRole>()(['household', 'townie', 'service'] as const);
export const PRESENCES = exact<Presence>()(['onLot', 'offLot', 'atWork', 'crumbled', 'gone'] as const);
export const SHIFT_STATUSES = exact<CareerState['shiftStatus']>()(['none', 'pending', 'atWork', 'done', 'missed', 'sick'] as const);
export const QUEUE_SOURCES = exact<QueueSource>()(['player', 'auto', 'system'] as const);
export const PHASES = exact<InteractionPhase>()(['route', 'wait', 'run', 'exit'] as const);
export const VISIT_REASONS = exact<VisitState['reason']>()(['invited', 'walkBy', 'dropIn', 'party', 'delivery', 'repo', 'moveIn'] as const);
export const NOTIFICATION_KINDS = exact<NotificationKind>()(
  ['info', 'good', 'bad', 'warning', 'money', 'career', 'social', 'decay', 'romance', 'skill'] as const,
);
export const AUTONOMY = exact<SimSettings['autonomy']>()(['full', 'limited', 'off'] as const);
export const DIFFICULTY = exact<SimSettings['difficulty']>()(['relaxed', 'normal', 'grim'] as const);
export const LIMB_CONDITIONS = exact<LimbCondition>()(['ok', 'missing', 'prosthetic'] as const);
export const ROTS = exact<Rot>()([0, 1, 2, 3] as const);

export const LIMITS = {
  maxLotSide: 512,
  maxAgents: 2000,
  maxObjects: 50000,
  maxRelationships: 100000,
  maxWalls: 200000,
  maxQueue: 64,
  maxPath: 4096,
  maxMoodlets: 128,
  maxNotifications: 120,
  maxChoices: 64,
  maxBills: 512,
  maxTxLog: 256,
  maxName: 64,
  maxText: 2000,
  maxId: 96,
} as const;

export const EDGE_RE = /^[hv]:-?\d{1,4}:-?\d{1,4}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const UINT32_MAX = 0xffffffff;

// ───────────────────────────── small building blocks ─────────────────────────────

const id = str({ nonEmpty: true, max: LIMITS.maxId });
const idOrNull = nullable(id);
const finite = num();
const tickish = num({ def: 0 });
const nonNeg = (def = 0): Check<number> => num({ min: 0, def });
const count = (def = 0): Check<number> => num({ int: true, min: 0, def });
const text = (max: number, def = ''): Check<string> => str({ max, def });
const params = rec<string | number | boolean>(scalar(false), { def: () => ({}), maxKeys: 256 });
const dataMap = rec<string | number | boolean | null>(scalar(true), { def: () => ({}), maxKeys: 512 });

const vec2: Check<Vec2> = obj<Vec2>({ x: finite, z: finite });

const targetRef: Check<TargetRef> = tagged<TargetRef>('kind', {
  object: obj<{ kind: 'object'; id: string }>({ kind: lit(['object'] as const), id }),
  agent: obj<{ kind: 'agent'; id: string }>({ kind: lit(['agent'] as const), id }),
  tile: obj<{ kind: 'tile'; x: number; z: number }>({ kind: lit(['tile'] as const), x: num({ int: true }), z: num({ int: true }) }),
  self: obj<{ kind: 'self' }>({ kind: lit(['self'] as const) }),
});

// ───────────────────────────── lot ─────────────────────────────

const wallSegment: Check<WallSegment> = obj<WallSegment>({
  paint: (v, ctx) => {
    const pair = tuple2(str({ nonEmpty: true, max: LIMITS.maxId }), str({ nonEmpty: true, max: LIMITS.maxId }))(v, ctx);
    if (pair !== INVALID) return pair;
    ctx.report('repaired', `${ctx.lastError.message}; wall paint reset to ${DEFAULT_INTERIOR_WALL}`);
    return [DEFAULT_INTERIOR_WALL, DEFAULT_INTERIOR_WALL];
  },
  openingId: idOrNull,
});

const lotSchema: Check<LotState> = obj<LotState>(
  {
    width: num({ int: true, min: 1, max: LIMITS.maxLotSide, strict: true }),
    depth: num({ int: true, min: 1, max: LIMITS.maxLotSide, strict: true }),
    buildable: obj<LotState['buildable']>({
      x0: num({ int: true }),
      z0: num({ int: true }),
      x1: num({ int: true }),
      z1: num({ int: true }),
    }),
    sidewalkZ: num({ int: true }),
    entryPoints: arr(vec2, { max: 64, def: () => [] }),
    walls: rec(wallSegment, { keyRe: EDGE_RE, maxKeys: LIMITS.maxWalls, def: () => ({}) }),
    floors: arr(nullable(str({ nonEmpty: true, max: LIMITS.maxId })), { max: LIMITS.maxLotSide * LIMITS.maxLotSide, def: () => [] }),
    version: count(),
    wallVersion: count(),
    floorVersion: count(),
  },
  {
    post: (lot, ctx) => {
      const want = lot.width * lot.depth;
      if (lot.floors.length !== want) {
        ctx.report('repaired', `floors has ${lot.floors.length} tiles, expected ${want}; resized`, 'lot.floors');
        const f = lot.floors.slice(0, want);
        while (f.length < want) f.push(null);
        lot.floors = f;
      }
      const b = lot.buildable;
      const clampX = (n: number) => Math.max(0, Math.min(lot.width, n));
      const clampZ = (n: number) => Math.max(0, Math.min(lot.depth, n));
      const nb = {
        x0: clampX(Math.min(b.x0, b.x1)),
        x1: clampX(Math.max(b.x0, b.x1)),
        z0: clampZ(Math.min(b.z0, b.z1)),
        z1: clampZ(Math.max(b.z0, b.z1)),
      };
      if (nb.x0 !== b.x0 || nb.x1 !== b.x1 || nb.z0 !== b.z0 || nb.z1 !== b.z1) {
        ctx.report('repaired', 'buildable rectangle outside the lot or inverted; clamped', 'lot.buildable');
        lot.buildable = { ...b, ...nb };
      }
      return lot;
    },
  },
);

// ───────────────────────────── objects ─────────────────────────────

const placement: Check<ObjectPlacement> = tagged<ObjectPlacement>('kind', {
  floor: obj<Extract<ObjectPlacement, { kind: 'floor' }>>({
    kind: lit(['floor'] as const),
    x: num({ int: true }),
    z: num({ int: true }),
    rot: lit(ROTS, 0),
  }),
  wall: obj<Extract<ObjectPlacement, { kind: 'wall' }>>({
    kind: lit(['wall'] as const),
    edge: str({ re: EDGE_RE }),
    side: lit([0, 1] as const, 0),
  }),
  opening: obj<Extract<ObjectPlacement, { kind: 'opening' }>>({ kind: lit(['opening'] as const), edge: str({ re: EDGE_RE }) }),
  loose: obj<Extract<ObjectPlacement, { kind: 'loose' }>>({
    kind: lit(['loose'] as const),
    x: finite,
    z: finite,
    y: num({ def: 0 }),
    parentId: idOrNull,
    surfaceIndex: nullable(num({ int: true, min: 0 })),
    facing: num({ def: 0 }),
  }),
  held: obj<Extract<ObjectPlacement, { kind: 'held' }>>({ kind: lit(['held'] as const), agentId: id }),
});

const defaultCondition = (): ObjectCondition => ({ broken: false, dirt: 0, burning: false, burnMinutes: 0 });

const objectSchema: Check<ObjectState> = obj<ObjectState>({
  id,
  defId: id,
  regionId: optionalRegionId,
  placement,
  value: nonNeg(),
  purchasedTick: tickish,
  tint: nullable(str({ re: HEX_COLOR_RE })),
  condition: obj<ObjectCondition>(
    { broken: bool(false), dirt: num({ min: 0, max: 1, def: 0 }), burning: bool(false), burnMinutes: nonNeg() },
    { def: defaultCondition },
  ),
  data: dataMap,
  reservedBy: rec(id, { def: () => ({}), maxKeys: 64 }),
  inUseBy: arr(id, { def: () => [], max: 64, unique: true }),
  rev: count(),
}, {
  // W-025: an absent (or dropped) regionId stays ABSENT (home region; old saves round-trip byte-identically)
  post: (o) => {
    if (o.regionId === undefined) delete o.regionId;
    return o;
  },
});

// ───────────────────────────── agents ─────────────────────────────

const DEF_APPEARANCE = defaultAppearance();
const color = (def: string) => str({ re: HEX_COLOR_RE, def });

/** Premium ids renamed before release (PR #92 review, item A); test saves made before the rename keep their body. */
const RENAMED_BODY_IDS: Readonly<Record<string, BodyId>> = { undertaker: 'sexton', roadhog: 'lowside' };

/** Optional cast body: missing stays missing (old saves untouched); unknown ids are dropped (read as 'classic'). */
const bodyCheck: Check<BodyId | undefined> = (v, ctx) => {
  if (v === undefined) return undefined;
  if (v === 'classic' || isCastBodyId(v)) return v as BodyId;
  if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(RENAMED_BODY_IDS, v)) {
    ctx.report('repaired', `cast body ${JSON.stringify(v)} was renamed to ${JSON.stringify(RENAMED_BODY_IDS[v])}`);
    return RENAMED_BODY_IDS[v];
  }
  ctx.report('repaired', `unknown cast body ${typeof v === 'string' ? JSON.stringify(v.slice(0, 40)) : typeof v}; using classic`);
  return undefined;
};

const appearanceSchema: Check<ZombieAppearance> = obj<ZombieAppearance>(
  {
    body: bodyCheck,
    height: num({ min: 0, max: 1, def: DEF_APPEARANCE.height }),
    build: num({ min: 0, max: 1, def: DEF_APPEARANCE.build }),
    skinTone: num({ int: true, min: 0, max: SKIN_TONES.length - 1, def: DEF_APPEARANCE.skinTone }),
    hairStyle: lit(HAIR_STYLES, DEF_APPEARANCE.hairStyle),
    hairColor: color(DEF_APPEARANCE.hairColor),
    topStyle: lit(TOP_STYLES, DEF_APPEARANCE.topStyle),
    topColor: color(DEF_APPEARANCE.topColor),
    bottomStyle: lit(BOTTOM_STYLES, DEF_APPEARANCE.bottomStyle),
    bottomColor: color(DEF_APPEARANCE.bottomColor),
    shoeColor: color(DEF_APPEARANCE.shoeColor),
    eyeStyle: lit(EYE_STYLES, DEF_APPEARANCE.eyeStyle),
    eyeColor: color(DEF_APPEARANCE.eyeColor),
    accessory: lit(ACCESSORIES, DEF_APPEARANCE.accessory),
    stitches: bool(DEF_APPEARANCE.stitches),
    voicePitch: num({ min: 0, max: 1, def: DEF_APPEARANCE.voicePitch }),
  },
  {
    def: defaultAppearance,
    // obj() writes every shape key: an absent (or dropped) body must stay ABSENT, not `body: undefined`
    // (canonical JSON rejects undefined, and old saves must round-trip byte-identically)
    post: (a) => {
      if (a.body === undefined) delete a.body;
      return a;
    },
  },
);

const moodletSchema: Check<MoodletInstance> = obj<MoodletInstance>({
  id,
  startTick: tickish,
  endTick: nullable(finite),
  stacks: num({ int: true, min: 1, def: 1 }),
  sourceId: nullable(str({ max: LIMITS.maxId })),
});

const skillSchema: Check<SkillState> = obj<SkillState>({
  level: num({ int: true, min: 0, max: SKILL_MAX_LEVEL, def: 0 }),
  xp: nonNeg(),
});

const careerSchema: Check<CareerState> = obj<CareerState>({
  trackId: id,
  level: num({ int: true, min: 1, max: 5, def: 1 }),
  performance: num({ min: -100, max: 100, def: 0 }),
  daysAtLevel: count(),
  missedStreak: count(),
  lastShiftDay: num({ int: true, min: -1, def: -1 }),
  shiftStatus: lit(SHIFT_STATUSES, 'none'),
  shiftStartTick: nullable(finite),
  moodSum: num({ def: 0 }),
  moodSamples: count(),
  sickDaysUsed: count(),
});

const queueItemShape = {
  uid: num({ int: true, min: 0 }),
  interactionId: id,
  target: targetRef,
  params,
  source: lit(QUEUE_SOURCES, 'auto'),
  priority: num({ def: 100 }),
  queuedTick: tickish,
};

const queueItemSchema: Check<QueueItem> = obj<QueueItem>(queueItemShape);

const activeSchema: Check<ActiveInteraction> = obj<ActiveInteraction>({
  ...queueItemShape,
  phase: lit(PHASES),
  stage: count(),
  stageTarget: targetRef,
  slot: nullable(num({ int: true, min: 0 })),
  routeGoal: nullable(vec2),
  pose: nullable(obj<{ x: number; z: number; y: number; facing: number }>({ x: finite, z: finite, y: num({ def: 0 }), facing: num({ def: 0 }) })),
  startedRunTick: nullable(finite),
  elapsed: nonNeg(),
  duration: nonNeg(),
  partnerId: idOrNull,
  routeFails: count(),
  waitMinutes: nonNeg(),
  data: dataMap,
  canceled: bool(false),
});

const visitSchema: Check<VisitState> = obj<VisitState>({
  arrivedTick: tickish,
  leaveTick: tickish,
  reason: lit(VISIT_REASONS, 'dropIn'),
  welcomed: bool(false),
  leaving: bool(false),
});

const walkBySchema: Check<WalkByState> = obj<WalkByState>({ from: vec2, to: vec2, startedTick: tickish });

const defaultStatus = (): AgentStatus => ({
  zeroPreservationMinutes: 0,
  passedOut: false,
  feral: false,
  autonomyCooldownUntil: 0,
  lastSocialTick: 0,
  autonomyFails: 0,
  bonePileId: null,
  crumbledTick: null,
});

const statusSchema: Check<AgentStatus> = obj<AgentStatus>(
  {
    zeroPreservationMinutes: nonNeg(),
    passedOut: bool(false),
    feral: bool(false),
    autonomyCooldownUntil: tickish,
    lastSocialTick: tickish,
    autonomyFails: count(),
    bonePileId: idOrNull,
    crumbledTick: nullable(finite),
  },
  { def: defaultStatus },
);

const agentSchema: Check<AgentState> = obj<AgentState>(
  {
    id,
    regionId: optionalRegionId,
    welcome: optionalWelcome,
    role: lit(AGENT_ROLES, 'townie'),
    presence: lit(PRESENCES, 'offLot'),
    firstName: str({ max: LIMITS.maxName, def: 'Unnamed' }),
    lastName: str({ max: LIMITS.maxName, def: '' }),
    appearance: appearanceSchema,
    traits: arr(id, { def: () => [], max: 16, unique: true }),
    rewardTraits: arr(id, { def: () => [], max: 32, unique: true }),
    aspiration: idOrNull,
    aspirationMilestones: arr(id, { def: () => [], max: 256, unique: true }),
    aspirationPoints: nonNeg(),
    needs: fixedRec(NEED_IDS, num({ min: 0, max: 100, def: 50 }), () => 50),
    vitality: num({ min: 20, max: 100, def: 100 }),
    moodlets: arr(moodletSchema, { def: () => [], max: LIMITS.maxMoodlets }),
    skills: fixedRec(SKILL_IDS, skillSchema, () => ({ level: 0, xp: 0 })),
    career: nullable(careerSchema),
    limbs: fixedRec(LIMB_IDS, lit(LIMB_CONDITIONS, 'ok'), () => 'ok'),
    pos: vec2,
    prevPos: vec2,
    posY: num({ def: 0 }),
    facing: num({ def: 0 }),
    prevFacing: num({ def: 0 }),
    path: nullable(arr(vec2, { max: LIMITS.maxPath, dropInvalid: false })),
    pathIndex: count(),
    queue: arr(queueItemSchema, { def: () => [], max: LIMITS.maxQueue }),
    active: nullable(activeSchema),
    anim: lit(ANIM_STATES, 'idle'),
    expression: lit(EXPRESSIONS, 'neutral'),
    carrying: nullable(lit(CARRY_ITEMS)),
    carryObjectId: idOrNull,
    status: statusSchema,
    visit: nullable(visitSchema),
    walkBy: nullable(walkBySchema),
    voiceSeed: num({ def: 0 }),
    createdTick: tickish,
    occupation: nullable(str({ max: LIMITS.maxName })),
  },
  {
    pre: (raw, ctx) => {
      const isVec = (p: unknown): boolean =>
        p !== null && typeof p === 'object' && Number.isFinite((p as Vec2).x) && Number.isFinite((p as Vec2).z);
      if (!isVec(raw.prevPos) && isVec(raw.pos)) {
        ctx.report('repaired', 'prevPos missing or malformed; set to pos', `${ctx.path()}.prevPos`);
        const p = raw.pos as Vec2;
        raw.prevPos = { x: p.x, z: p.z };
      }
      if (!Number.isFinite(raw.prevFacing) && Number.isFinite(raw.facing)) {
        ctx.report('repaired', 'prevFacing missing or malformed; set to facing', `${ctx.path()}.prevFacing`);
        raw.prevFacing = raw.facing;
      }
    },
    post: (a, ctx) => {
      if (a.regionId === undefined) delete a.regionId; // W-025: absent = home region (old saves byte-identical)
      if (a.welcome === undefined) delete a.welcome; // W-025 S3: absent unless welcomed somewhere
      if (a.needs.preservation > a.vitality) {
        ctx.report('repaired', `preservation ${a.needs.preservation} above vitality ${a.vitality}; clamped`, `${ctx.path()}.needs.preservation`);
        a.needs = { ...a.needs, preservation: a.vitality };
      }
      if (a.path !== null && a.pathIndex > a.path.length) {
        ctx.report('repaired', 'pathIndex beyond path end; clamped', `${ctx.path()}.pathIndex`);
        a.pathIndex = a.path.length;
      }
      return a;
    },
  },
);

// ───────────────────────────── social / household / misc ─────────────────────────────

const relationshipSchema: Check<Relationship> = obj<Relationship>({
  a: id,
  b: id,
  friendship: num({ min: -100, max: 100, def: 0 }),
  romance: num({ min: 0, max: 100, def: 0 }),
  met: bool(false),
  partners: bool(false),
  engaged: bool(false),
  married: bool(false),
  bestFriends: bool(false),
  lastInteractionTick: tickish,
  interactions: count(),
});

const billSchema: Check<Bill> = obj<Bill>({
  id,
  issuedTick: tickish,
  dueTick: tickish,
  amount: num({ int: true, min: 0, def: 0 }),
  paidTick: nullable(finite),
  stage: num({ int: true, min: 0, max: 4, def: 0 }),
});

const householdSchema: Check<HouseholdState> = obj<HouseholdState>({
  name: str({ max: LIMITS.maxName, def: 'Household' }),
  funds: num({ int: true, min: 0, def: 0 }),
  memberIds: arr(id, { max: 16, unique: true, def: () => [] }),
  bills: arr(billSchema, { def: () => [], max: LIMITS.maxBills }),
  utilitiesOn: bool(true),
  repoDispatchedDay: nullable(num({ int: true })),
  txLog: arr(str({ max: 256 }), { def: () => [], max: LIMITS.maxTxLog, keep: 'last' }),
});

const notificationSchema: Check<Notification> = obj<Notification>({
  id: num({ int: true, min: 0 }),
  tick: tickish,
  kind: lit(NOTIFICATION_KINDS, 'info'),
  title: text(200),
  text: text(LIMITS.maxText),
  agentId: idOrNull,
  objectId: idOrNull,
  read: bool(false),
});

const choiceOptionSchema: Check<ChoiceOption> = obj<ChoiceOption>({
  label: text(200),
  effect: id,
  params,
  tooltip: nullable(str({ max: LIMITS.maxText })),
});

const choiceSchema: Check<ChoiceState> = obj<ChoiceState>(
  {
    id,
    tick: tickish,
    title: text(200),
    text: text(LIMITS.maxText),
    agentId: idOrNull,
    options: arr(choiceOptionSchema, { max: 8 }),
    expiresTick: tickish,
    defaultOption: num({ int: true, min: 0, def: 0 }),
  },
  {
    post: (c, ctx) => {
      if (c.options.length === 0) return ctx.fail('choice has no options');
      if (c.defaultOption >= c.options.length) {
        ctx.report('repaired', 'defaultOption out of range; set to 0', `${ctx.path()}.defaultOption`);
        c.defaultOption = 0;
      }
      return c;
    },
  },
);

const partySchema: Check<PartyState> = obj<PartyState>({
  hostId: id,
  startTick: tickish,
  endTick: tickish,
  guestIds: arr(id, { def: () => [], max: 64, unique: true }),
  score: num({ min: 0, max: 100, def: 0 }),
  ended: bool(false),
});

const statsSchema: Check<StatsState> = obj<StatsState>(
  {
    counters: rec(finite, { def: () => ({}), maxKeys: 4096 }),
    agent: rec(rec(finite, { def: () => ({}), maxKeys: 4096 }), { def: () => ({}), maxKeys: LIMITS.maxAgents }),
  },
  { def: () => ({ counters: {}, agent: {} }) },
);

const settingsSchema: Check<SimSettings> = obj<SimSettings>(
  {
    autonomy: lit(AUTONOMY, 'full'),
    difficulty: lit(DIFFICULTY, 'normal'),
    visitorsEnabled: bool(true),
  },
  { def: () => ({ autonomy: 'full', difficulty: 'normal', visitorsEnabled: true }) },
);

const uint32 = num({ int: true, min: 0, max: UINT32_MAX, strict: true });
const rngSchema: Check<RngState> = obj<RngState>(
  { a: uint32, b: uint32, c: uint32, d: uint32 },
  {
    post: (r, ctx) => ((r.a | r.b | r.c | r.d) === 0 ? ctx.fail('all-zero RNG state (degenerate)') : r),
  },
);

export const worldShape = {
  schemaVersion: num({ int: true, min: 1, strict: true }),
  seed: num({ int: true, def: 0 }),
  rng: rngSchema,
  tick: num({ int: true, min: 0, strict: true }),
  nextId: num({ int: true, min: 1, def: 1 }),
  household: householdSchema,
  lot: lotSchema,
  agents: rec(agentSchema, { maxKeys: LIMITS.maxAgents }),
  objects: rec(objectSchema, { maxKeys: LIMITS.maxObjects }),
  relationships: rec(relationshipSchema, { def: () => ({}), maxKeys: LIMITS.maxRelationships }),
  notifications: arr(notificationSchema, { def: () => [], max: LIMITS.maxNotifications, keep: 'last' }),
  choices: arr(choiceSchema, { def: () => [], max: LIMITS.maxChoices }),
  party: nullable(partySchema),
  flags: rec<string | number | boolean>(scalar(false), { def: () => ({}), maxKeys: 4096 }),
  stats: statsSchema,
  settings: settingsSchema,
  gameOver: bool(false),
  quests: questsSchema,
  town: makeTownSchema(lotSchema, objectSchema),
  jobs: jobsSchema,
  pets: petsSchema,
  homeBuild: homeBuildSchema,
  homeServices: homeServicesSchema,
};

/** Fields whose failure makes the whole world unusable (no safe default exists). */
export const FATAL_FIELDS = ['schemaVersion', 'tick', 'household', 'lot', 'agents', 'objects'] as const;

export type WorldShape = typeof worldShape;
// Compile-time completeness: worldShape covers every WorldState field with the right type.
export const worldSchemaShape: { [K in keyof WorldState]-?: Check<WorldState[K]> } = worldShape;
