/**
 * FAKE SimContext for SIM-PEOPLE unit tests — implements every SimContext member the people systems use, on top
 * of a tiny fixture world (30×30 lot, a 10×8 house with a front door, a mailbox, entry points on the sidewalk).
 * It mirrors the engine semantics documented in src/sim/engine/README.md closely enough for unit tests:
 * trait need multipliers, moodlet stacking/durations (incl. moodletDuration:<id>), idempotent money, effect /
 * requirement / condition dispatch to registered systems, a minimal queue, and hour/day hooks via `advance`.
 */
import type {
  ConditionRef,
  ContentRegistry,
  EffectContext,
  EffectRef,
  InteractionBehavior,
  InteractionDef,
  ObjectDef,
  RequirementContext,
  RequirementRef,
  SimContext,
  SimEvent,
  SimSystem,
  SpatialAPI,
  TimeInfo,
} from '../../../src/sim/contracts';
import type {
  ActiveInteraction,
  AgentState,
  ChoiceState,
  NeedId,
  ObjectPlacement,
  ObjectState,
  QueueItem,
  Relationship,
  SkillId,
  WorldState,
} from '../../../src/sim/types';
import { NEED_IDS, SKILL_IDS, TICKS_PER_HOUR } from '../../../src/sim/types';
import { createRng, seedRngState } from '../../../src/sim/rng';
import { timeInfo, tickAt } from '../../../src/sim/time';
import { PHYSICAL_SPECS } from '../../../src/shared/catalog';
import { defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import { peopleContent } from '../../../src/sim/content/people';
import { engineContent } from '../../../src/sim/engine';
import { createPeopleSystems } from '../../../src/sim/systems/people';

export const HOUSE = { x0: 10, z0: 12, x1: 20, z1: 20 }; // indoor rectangle; front wall on z = 20
export const DOOR_EDGE = 'h:15:20';

function buildRegistry(): ContentRegistry {
  const objects: Record<string, ObjectDef> = {};
  for (const s of PHYSICAL_SPECS) {
    objects[s.id] = { ...s, interactions: [], env: 0, depreciation: 0.15, breakChance: 0, sellable: s.buyable, params: {} };
  }
  const interactions: Record<string, InteractionDef> = {};
  for (const d of peopleContent.interactions ?? []) interactions[d.id] = d;
  interactions['test_sleep'] = {
    id: 'test_sleep',
    label: 'Sleep',
    icon: 'zzz',
    targetKind: 'self',
    stage: { target: { kind: 'here' }, duration: 480, anim: 'sleep' },
    tags: ['sleep'],
  };
  const reg: ContentRegistry = {
    objects,
    interactions,
    moodlets: Object.fromEntries((peopleContent.moodlets ?? []).map((m) => [m.id, m])),
    traits: Object.fromEntries((peopleContent.traits ?? []).map((t) => [t.id, t])),
    skills: Object.fromEntries((engineContent.skills ?? []).map((s) => [s.id, s])) as ContentRegistry['skills'],
    careers: Object.fromEntries((peopleContent.careers ?? []).map((c) => [c.id, c])),
    aspirations: Object.fromEntries((peopleContent.aspirations ?? []).map((a) => [a.id, a])),
    rewards: Object.fromEntries((peopleContent.rewards ?? []).map((r) => [r.id, r])),
    recipes: {},
    lifeEvents: [...(peopleContent.lifeEvents ?? [])],
    names: { first: [...(peopleContent.names?.first ?? [])], last: [...(peopleContent.names?.last ?? [])], occupations: [...(peopleContent.names?.occupations ?? [])] },
    stagesOf(id: string) {
      const d = interactions[id];
      if (!d) return [];
      return d.stages && d.stages.length ? d.stages : d.stage ? [d.stage] : [];
    },
  };
  return reg;
}

function blankAgent(id: string, role: AgentState['role'], firstName: string, presence: AgentState['presence']): AgentState {
  const skills = {} as AgentState['skills'];
  for (const s of SKILL_IDS) skills[s] = { level: 0, xp: 0 };
  return {
    id,
    role,
    presence,
    firstName,
    lastName: 'Testerson',
    appearance: defaultAppearance(),
    traits: [],
    rewardTraits: [],
    aspiration: null,
    aspirationMilestones: [],
    aspirationPoints: 0,
    needs: { hunger: 80, energy: 80, preservation: 80, social: 60, fun: 70, hygiene: 80 },
    vitality: 100,
    moodlets: [],
    skills,
    career: null,
    limbs: intactLimbs(),
    pos: { x: 15.5, z: 16.5 },
    prevPos: { x: 15.5, z: 16.5 },
    posY: 0,
    facing: 0,
    prevFacing: 0,
    path: null,
    pathIndex: 0,
    queue: [],
    active: null,
    anim: 'idle',
    expression: 'neutral',
    carrying: null,
    carryObjectId: null,
    status: { zeroPreservationMinutes: 0, passedOut: false, feral: false, autonomyCooldownUntil: 0, lastSocialTick: 0, autonomyFails: 0, bonePileId: null, crumbledTick: null },
    visit: null,
    walkBy: null,
    voiceSeed: 1,
    createdTick: 0,
    occupation: null,
  };
}

export function fixtureWorld(seed = 1234): WorldState {
  const width = 30;
  const depth = 30;
  const state: WorldState = {
    schemaVersion: 1,
    seed,
    rng: seedRngState(seed),
    tick: 0,
    nextId: 100,
    household: { name: 'Testersons', funds: 1000, memberIds: [], bills: [], utilitiesOn: true, repoDispatchedDay: null, txLog: [] },
    lot: {
      width,
      depth,
      buildable: { x0: 1, z0: 1, x1: 29, z1: 27 },
      sidewalkZ: 28,
      entryPoints: [
        { x: 0.5, z: 28.5 },
        { x: 29.5, z: 28.5 },
      ],
      walls: {},
      floors: new Array(width * depth).fill(null),
      version: 1,
      wallVersion: 1,
      floorVersion: 1,
    },
    agents: {},
    objects: {},
    relationships: {},
    notifications: [],
    choices: [],
    party: null,
    flags: {},
    stats: { counters: {}, agent: {} },
    settings: { autonomy: 'full', difficulty: 'normal', visitorsEnabled: true },
    gameOver: false,
  };
  const obj = (id: string, defId: string, placement: ObjectPlacement, value = 0): ObjectState => ({
    id,
    defId,
    placement,
    value,
    purchasedTick: 0,
    tint: null,
    condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 },
    data: {},
    reservedBy: {},
    inUseBy: [],
    rev: 0,
  });
  state.objects.o1 = obj('o1', 'door_splintered', { kind: 'opening', edge: DOOR_EDGE }, 120);
  state.objects.o2 = obj('o2', 'mailbox_crooked', { kind: 'floor', x: 14, z: 25, rot: 0 }, 50);
  return state;
}

export interface FakeOptions {
  seed?: number;
  /** Household members to create (first names). */
  household?: string[];
  /** Initial tick (default 0 = Day 1 Mon 09:00). */
  tick?: number;
  /** Create the 24 townies via the townies system init (default true). */
  initSystems?: boolean;
  /** Extra / replacement systems (default: fresh people systems). */
  systems?: SimSystem[];
}

export interface FakeSim {
  ctx: SimContext;
  state: WorldState;
  systems: SimSystem[];
  events: SimEvent[];
  faults: string[];
  /** Mood overrides by agent id (else moodlets + baseMood + modifiers). */
  moodOverride: Record<string, number>;
  addAgent(spec: Partial<AgentState> & { firstName: string; role?: AgentState['role'] }): AgentState;
  /** Advance n ticks running system.tick each tick and dayStart/hour on boundaries (engine order). */
  advanceTicks(n: number): void;
  advanceMinutes(min: number): void;
  /** Jump straight to a tick (runs hooks for every crossed hour/day, but system.tick only once at the end). */
  jumpTo(tick: number): void;
  behavior(key: string): InteractionBehavior;
  api(id: string): Record<string, (...args: any[]) => any>;
  /** Build an ActiveInteraction for an agent (for behaviour hook tests). */
  makeRun(actor: AgentState, interactionId: string, target: ActiveInteraction['target'], params?: Record<string, string | number | boolean>): ActiveInteraction;
  notifications(): string[];
  tickAt: typeof tickAt;
}

export function createFakeSim(opts: FakeOptions = {}): FakeSim {
  const state = fixtureWorld(opts.seed ?? 1234);
  state.tick = opts.tick ?? 0;
  const content = buildRegistry();
  const rng = createRng(state.rng);
  const systems = opts.systems ?? createPeopleSystems();
  const events: SimEvent[] = [];
  const faults: string[] = [];
  const moodOverride: Record<string, number> = {};

  const effects: Record<string, NonNullable<SimSystem['effects']>[string]> = {};
  const requirements: Record<string, NonNullable<SimSystem['requirements']>[string]> = {};
  const conditions: Record<string, NonNullable<SimSystem['conditions']>[string]> = {};
  const behaviors: Record<string, InteractionBehavior> = { standard: {} };
  for (const s of systems) {
    Object.assign(effects, s.effects ?? {});
    Object.assign(requirements, s.requirements ?? {});
    Object.assign(conditions, s.conditions ?? {});
    Object.assign(behaviors, s.behaviors ?? {});
  }

  const inHouse = (x: number, z: number) => x >= HOUSE.x0 && x < HOUSE.x1 && z >= HOUSE.z0 && z < HOUSE.z1;
  const spatial = {
    width: () => state.lot.width,
    depth: () => state.lot.depth,
    inBounds: (x: number, z: number) => x >= 0 && z >= 0 && x < state.lot.width && z < state.lot.depth,
    isBuildable: () => true,
    tileIndex: (x: number, z: number) => z * state.lot.width + x,
    tileOf: (p: { x: number; z: number }) => ({ x: Math.floor(p.x), z: Math.floor(p.z) }),
    isWalkable: () => true,
    canStep: () => true,
    roomAt: (x: number, z: number) => (inHouse(x, z) ? 1 : 0),
    rooms: () => [{ id: 1, indoor: true, tiles: [] }],
    isIndoor: (x: number, z: number) => inHouse(x, z),
    nearestWalkable: (p: { x: number; z: number }) => ({ x: Math.floor(p.x), z: Math.floor(p.z) }),
    objectCenter: (o: ObjectState) => {
      const p = o.placement;
      if (p.kind === 'floor' || p.kind === 'loose') return { x: p.x + 0.5, z: p.z + 0.5 };
      if (p.kind === 'held') return state.agents[p.agentId]?.pos ?? { x: 0, z: 0 };
      return { x: 15, z: 20 };
    },
  } as unknown as SpatialAPI;

  const traitDefs = (a: AgentState) => [...(a.traits ?? []), ...(a.rewardTraits ?? [])].map((t) => content.traits[t]).filter(Boolean);
  const traitMult = (a: AgentState, key: string) => traitDefs(a).reduce((m, t) => m * (typeof t.mult?.[key] === 'number' ? t.mult[key] : 1), 1);
  const needCap = (a: AgentState, n: NeedId) => (n === 'preservation' ? a.vitality : 100);

  let uid = 1000;
  const ctx: SimContext = {
    get state() {
      return state;
    },
    content,
    rng,
    spatial,
    get time(): TimeInfo {
      return timeInfo(state.tick);
    },
    emit: (e) => void events.push(e),
    notify: (n) => {
      state.notifications.push({ id: uid++, tick: state.tick, kind: n.kind, title: n.title, text: n.text, agentId: n.agentId ?? null, objectId: n.objectId ?? null, read: false });
    },
    newId: (p) => `${p}${state.nextId++}`,
    newUid: () => uid++,
    agent: (id) => (typeof id === 'string' ? state.agents[id] : undefined),
    object: (id) => state.objects[id],
    objectDef: (o) => {
      const id = typeof o === 'string' ? o : o.defId;
      const d = content.objects[id];
      if (!d) throw new Error(`unknown object def ${id}`);
      return d;
    },
    householdMembers: () => state.household.memberIds.map((id) => state.agents[id]).filter(Boolean),
    agentsOnLot: () => Object.values(state.agents).filter((a) => a.presence === 'onLot'),
    // W-025 S1: home-only fake (every agent / the only lot is the home region)
    regionOf: (id: string) => (state.agents[id] ? state.agents[id].regionId ?? 'wormwood:mildew_n2' : null),
    lotOf: (regionId: string) => (regionId === 'wormwood:mildew_n2' ? state.lot : null),
    homeRegionId: () => 'wormwood:mildew_n2',
    isHousehold: (a) => a.role === 'household' && state.household.memberIds.includes(a.id),
    isVisitor: (a) => a.role === 'townie' && a.presence === 'onLot' && !a.walkBy,
    changeNeed: (a, n, delta, o) => {
      if (!Number.isFinite(delta)) return 0;
      let d = delta;
      if (!o?.raw) {
        for (const t of traitDefs(a)) {
          if (d > 0 && typeof t.needGain?.[n] === 'number') d *= t.needGain[n]!;
          if (d < 0 && typeof t.needDecay?.[n] === 'number') d *= t.needDecay[n]!;
        }
      }
      const before = a.needs[n];
      a.needs[n] = Math.max(0, Math.min(needCap(a, n), before + d));
      return a.needs[n] - before;
    },
    needCap,
    addMoodlet: (a, id, o) => {
      const def = content.moodlets[id];
      if (!def) {
        faults.push(`unknown moodlet ${id}`);
        return;
      }
      const dur0 = o?.durationMin ?? def.durationMin;
      const dur = dur0 === null ? null : dur0 * traitMult(a, `moodletDuration:${id}`);
      const end = dur === null ? null : state.tick + Math.round(dur * 4);
      const ex = a.moodlets.find((m) => m.id === id);
      if (ex) {
        ex.stacks = Math.min(def.maxStacks, ex.stacks + (o?.stacks ?? 1));
        ex.endTick = end;
      } else a.moodlets.push({ id, startTick: state.tick, endTick: end, stacks: Math.min(def.maxStacks, o?.stacks ?? 1), sourceId: o?.sourceId ?? null });
    },
    removeMoodlet: (a, id) => {
      a.moodlets = a.moodlets.filter((m) => m.id !== id);
    },
    hasMoodlet: (a, id) => a.moodlets.some((m) => m.id === id && (m.endTick === null || m.endTick > state.tick)),
    addXp: (a, skill: SkillId, xp) => {
      if (!(xp > 0)) return;
      let x = xp;
      for (const t of traitDefs(a)) if (typeof t.skillGain?.[skill] === 'number') x *= t.skillGain[skill]!;
      const s = a.skills[skill];
      s.xp += x;
      const table = content.skills[skill]?.xpPerLevel ?? [100];
      while (s.level < 10 && s.xp >= (table[s.level] ?? 1e9)) {
        s.xp -= table[s.level];
        s.level++;
      }
    },
    skillLevel: (a, s) => a.skills[s]?.level ?? 0,
    mood: (a) => {
      if (typeof moodOverride[a.id] === 'number') return moodOverride[a.id];
      let m = 0;
      for (const md of a.moodlets) if (md.endTick === null || md.endTick > state.tick) m += (content.moodlets[md.id]?.mood ?? 0) * md.stacks;
      for (const t of traitDefs(a)) m += t.baseMood ?? 0;
      for (const s of systems) for (const p of s.moodModifiers?.(ctx, a) ?? []) m += p.value;
      return Math.max(-100, Math.min(100, m));
    },
    hasTrait: (a, t) => (a.traits ?? []).includes(t) || (a.rewardTraits ?? []).includes(t),
    traitMult,
    limbCount: (a, k) => (k === 'arm' ? [a.limbs.armL, a.limbs.armR] : [a.limbs.legL, a.limbs.legR]).filter((c) => c !== 'missing').length,
    spend: (amount, _reason, key) => {
      if (!Number.isFinite(amount) || amount < 0) return false;
      const amt = Math.round(amount);
      if (key && state.household.txLog.includes(key)) return true;
      if (state.household.funds < amt) return false;
      state.household.funds -= amt;
      if (key) state.household.txLog.push(key);
      return true;
    },
    earn: (amount, _reason, key) => {
      if (!Number.isFinite(amount) || amount <= 0) return;
      if (key && state.household.txLog.includes(key)) return;
      state.household.funds += Math.round(amount);
      if (key) state.household.txLog.push(key);
    },
    queue: (a, item) => {
      if (!a || a.presence !== 'onLot' || !content.interactions[item.interactionId]) return null;
      const qi: QueueItem = {
        uid: uid++,
        interactionId: item.interactionId,
        target: item.target,
        params: { ...(item.params ?? {}) },
        source: item.source,
        priority: item.priority ?? (item.source === 'system' ? 300 : item.source === 'player' ? 200 : 100),
        queuedTick: state.tick,
      };
      if (item.front) a.queue.unshift(qi);
      else a.queue.push(qi);
      return qi;
    },
    cancel: (a, id) => {
      a.queue = a.queue.filter((q) => q.uid !== id);
      if (a.active && a.active.uid === id) a.active = null;
    },
    interrupt: (a) => {
      a.active = null;
    },
    failRun: (a, reason) => {
      if (a.active) faults.push(`failRun ${a.id}: ${reason}`);
      a.active = null;
    },
    isBusy: (a) => !!a.active || a.queue.length > 0,
    spawnObject: (defId, placement, o) => {
      const id = `o${state.nextId++}`;
      const ob: ObjectState = { id, defId, placement, value: o?.value ?? 0, purchasedTick: state.tick, tint: null, condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 }, data: { ...(o?.data ?? {}) }, reservedBy: {}, inUseBy: [], rev: 0 };
      state.objects[id] = ob;
      return ob;
    },
    removeObject: (id) => {
      delete state.objects[id];
    },
    markChanged: (o) => void o.rev++,
    placeItemNear: () => null,
    holdItem: () => undefined,
    releaseHeld: () => null,
    spawnAgent: (id, at) => {
      const a = state.agents[id];
      if (!a || a.presence === 'onLot') return;
      a.presence = 'onLot';
      a.pos = at ? { ...at } : { ...state.lot.entryPoints[0] };
      a.active = null;
      for (const s of systems) s.agentArrived?.(ctx, a);
    },
    despawnAgent: (id, presence) => {
      const a = state.agents[id];
      if (!a) return;
      const was = a.presence === 'onLot';
      a.active = null;
      a.queue = [];
      a.presence = presence === 'onLot' ? 'offLot' : presence;
      if (was) for (const s of systems) s.agentLeft?.(ctx, a);
    },
    createAgent: (spec) => {
      const id = `a${state.nextId++}`;
      const a = blankAgent(id, spec.role, spec.firstName, spec.presence);
      a.lastName = spec.lastName;
      a.appearance = spec.appearance;
      a.traits = [...spec.traits];
      a.aspiration = spec.aspiration ?? null;
      a.occupation = spec.occupation ?? null;
      for (const n of NEED_IDS) if (typeof spec.needs?.[n] === 'number') a.needs[n] = spec.needs[n]!;
      for (const s of SKILL_IDS) if (typeof spec.skills?.[s] === 'number') a.skills[s].level = spec.skills[s]!;
      state.agents[id] = a;
      if (spec.role === 'household') state.household.memberIds.push(id);
      return a;
    },
    sendOffLot: (a, presence) => ctx.despawnAgent(a.id, presence),
    rel: (a, b) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!state.agents[a] || !state.agents[b] || a === b) {
        return { a, b, friendship: 0, romance: 0, met: false, partners: false, engaged: false, married: false, bestFriends: false, lastInteractionTick: state.tick, interactions: 0 } as Relationship;
      }
      if (!state.relationships[key]) {
        const [x, y] = a < b ? [a, b] : [b, a];
        state.relationships[key] = { a: x, b: y, friendship: 0, romance: 0, met: false, partners: false, engaged: false, married: false, bestFriends: false, lastInteractionTick: state.tick, interactions: 0 };
      }
      return state.relationships[key];
    },
    stat: (key, amount = 1, agentId = null) => {
      if (agentId) {
        const m = (state.stats.agent[agentId] ??= {});
        m[key] = (m[key] ?? 0) + amount;
      } else state.stats.counters[key] = (state.stats.counters[key] ?? 0) + amount;
    },
    statValue: (key, agentId = null) => (agentId ? state.stats.agent[agentId]?.[key] ?? 0 : state.stats.counters[key] ?? 0),
    runEffect: (ref: EffectRef, ec: EffectContext) => {
      const fn = effects[ref.id];
      if (!fn) {
        faults.push(`unknown effect ${ref.id}`);
        return;
      }
      try {
        fn(ctx, ec, (ref.params ?? {}) as Record<string, unknown>);
      } catch (e) {
        faults.push(`effect ${ref.id} threw: ${(e as Error).message}`);
      }
    },
    checkRequirement: (ref: RequirementRef, rc: RequirementContext) => {
      const p = (ref.params ?? {}) as Record<string, unknown>;
      switch (ref.id) {
        case 'household':
          return ctx.isHousehold(rc.actor) ? true : 'Household only';
        case 'notSelf':
          return rc.targetAgent?.id === rc.actor.id ? "Can't do that to yourself" : true;
        case 'targetOnLot':
          return rc.targetAgent?.presence === 'onLot' ? true : 'Not here';
        case 'targetAwake':
          return true;
        case 'arms':
          return ctx.limbCount(rc.actor, 'arm') >= Number(p.min ?? 1) ? true : 'Needs an arm';
        case 'needAbove':
          return rc.actor.needs[p.need as NeedId] >= Number(p.min) ? true : String(p.reason ?? 'Too low');
        case 'skill':
          return ctx.skillLevel(rc.actor, p.skill as SkillId) >= Number(p.min) ? true : `Needs ${String(p.skill)} ${String(p.min)}`;
        case 'targetVisitor':
          return rc.targetAgent && rc.targetAgent.role === 'townie' && rc.targetAgent.visit ? true : 'Not visiting';
        case 'targetWalkBy':
          return rc.targetAgent?.walkBy ? true : 'Not walking by';
        case 'targetNotHousehold':
          return rc.targetAgent && !ctx.isHousehold(rc.targetAgent) ? true : 'Already lives here';
        default: {
          const fn = requirements[ref.id];
          if (!fn) {
            faults.push(`unknown requirement ${ref.id}`);
            return 'Something went wrong';
          }
          return fn(ctx, rc, p);
        }
      }
    },
    evalCondition: (cond: ConditionRef, agent) => {
      const p = (cond.params ?? {}) as Record<string, any>;
      switch (cond.kind) {
        case 'always':
          return true;
        case 'never':
          return false;
        case 'funds':
          return state.household.funds >= Number(p.min ?? 0);
        case 'skill':
          return !!agent && ctx.skillLevel(agent, p.skill) >= Number(p.min ?? 0);
        case 'stat':
          return ctx.statValue(p.key, p.perAgent && agent ? agent.id : null) >= Number(p.min ?? 1);
        case 'and':
          return (p.all as ConditionRef[]).every((c) => ctx.evalCondition(c, agent));
        case 'or':
          return (p.any as ConditionRef[]).some((c) => ctx.evalCondition(c, agent));
        case 'not':
          return !ctx.evalCondition(p.cond, agent);
        default: {
          const fn = conditions[cond.kind];
          if (!fn) {
            faults.push(`unknown condition ${cond.kind}`);
            return false;
          }
          return !!fn(ctx, agent ?? null, p);
        }
      }
    },
    offerChoice: (c) => {
      const id = `c${uid++}`;
      state.choices.push({ ...c, id, tick: state.tick } as ChoiceState);
      events.push({ type: 'choice', choiceId: id });
      return id;
    },
    powered: (o) => {
      if (o) {
        const d = content.objects[o.defId];
        if (d && !d.needsPower) return true;
        if (o.condition.broken) return false;
      }
      return state.household.utilitiesOn;
    },
    sys: (id) => systems.find((s) => s.id === id)?.api ?? {},
  };

  const runHooks = (fromTick: number, toTick: number) => {
    // dayStart then hour for each boundary crossed in (fromTick, toTick]
    for (let t = fromTick + 1; t <= toTick; t++) {
      const prev = timeInfo(t - 1);
      const now = timeInfo(t);
      if (now.day !== prev.day) for (const s of systems) s.dayStart?.(ctx, now.day);
      if (now.hour !== prev.hour) for (const s of systems) s.hour?.(ctx, now.hour);
    }
  };

  const sim: FakeSim = {
    ctx,
    state,
    systems,
    events,
    faults,
    moodOverride,
    addAgent(spec) {
      const role = spec.role ?? 'household';
      const id = spec.id ?? `a${state.nextId++}`;
      const a = { ...blankAgent(id, role, spec.firstName, spec.presence ?? 'onLot'), ...spec, id, role } as AgentState;
      state.agents[id] = a;
      if (role === 'household' && !state.household.memberIds.includes(id)) state.household.memberIds.push(id);
      return a;
    },
    advanceTicks(n) {
      for (let i = 0; i < n; i++) {
        const before = state.tick;
        state.tick++;
        for (const s of systems) s.tick?.(ctx, 0.25);
        runHooks(before, state.tick);
      }
    },
    advanceMinutes(min) {
      sim.advanceTicks(Math.round(min * 4));
    },
    jumpTo(tick) {
      const from = state.tick;
      state.tick = tick;
      runHooks(from, tick);
      for (const s of systems) s.tick?.(ctx, 0.25);
    },
    behavior(key) {
      const b = behaviors[key];
      if (!b) throw new Error(`no behavior ${key}`);
      return b;
    },
    api(id) {
      return ctx.sys(id);
    },
    makeRun(actor, interactionId, target, params = {}) {
      const def = content.interactions[interactionId];
      const st = content.stagesOf(interactionId)[0];
      return {
        uid: uid++,
        interactionId,
        target,
        params,
        source: 'player',
        priority: 200,
        queuedTick: state.tick,
        phase: 'run',
        stage: 0,
        stageTarget: target,
        slot: null,
        routeGoal: null,
        pose: null,
        startedRunTick: state.tick,
        elapsed: 0,
        duration: st?.duration ?? 10,
        partnerId: target.kind === 'agent' ? target.id : null,
        routeFails: 0,
        waitMinutes: 0,
        data: {},
        canceled: false,
        ...(def ? {} : {}),
      };
    },
    notifications() {
      return state.notifications.map((n) => `${n.title}: ${n.text}`);
    },
    tickAt,
  };

  for (const name of opts.household ?? []) sim.addAgent({ firstName: name });
  if (opts.initSystems !== false) for (const s of systems) s.init?.(ctx, false);
  return sim;
}

/** Ticks for (day, HH:MM). */
export function at(day: number, hh: number, mm = 0): number {
  return tickAt(day, hh * 60 + mm);
}

export const HOUR = TICKS_PER_HOUR;
