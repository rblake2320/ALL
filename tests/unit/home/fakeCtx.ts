/**
 * FakeSim — a small, deterministic stand-in for the engine used by the SIM-HOME unit tests.
 * Implements every SimContext member the home systems use, a flat 30×30 lot (indoors = x<20 && z<20, room 1),
 * and a mini interaction runner (stage resolution, cost, power, needsPerHour, xp, effects, behaviour hooks, pairs)
 * that follows src/sim/engine/README.md closely enough to drive home behaviours end-to-end.
 */
import type {
  ContentModule,
  EffectContext,
  EffectHandler,
  InteractionBehavior,
  InteractionDef,
  NewAgentSpec,
  RequirementCheck,
  RequirementContext,
  Rng,
  SimContext,
  SimEvent,
  SimSystem,
  SpatialAPI,
  StageDef,
  StageTarget,
  TimeInfo,
} from '../../../src/sim/contracts';
import type {
  ActiveInteraction,
  AgentState,
  NeedId,
  ObjectPlacement,
  ObjectState,
  QueueItem,
  SkillId,
  TargetRef,
  Vec2,
  WorldState,
} from '../../../src/sim/types';
import { NEED_IDS, SKILL_IDS, TICK_MINUTES } from '../../../src/sim/types';
import { createRng, seedRngState } from '../../../src/sim/rng';
import { timeInfo } from '../../../src/sim/time';
import { defaultAppearance, intactLimbs } from '../../../src/shared/appearance';
import { engineContent, loadContentFrom } from '../../../src/sim/engine';
import type { EngineRegistry } from '../../../src/sim/engine';
import { homeContent } from '../../../src/sim/content/home';
import { TRAITS } from '../../../src/sim/content/people/traits';
import { homeSystems, resetCtxRegistry } from '../../../src/sim/systems/home';
import { buildFakeContext } from './fakeContext';
import { engineVocabulary } from './fakeVocabulary';

export const TEST_TRAITS: ContentModule = { id: 'testTraits', traits: TRAITS };

let registryCache: EngineRegistry | null = null;
export function testRegistry(): EngineRegistry {
  if (!registryCache) registryCache = loadContentFrom([engineContent, homeContent, TEST_TRAITS]);
  return registryCache;
}

export interface FakeObjectSpec {
  defId: string;
  x: number;
  z: number;
  rot?: 0 | 1 | 2 | 3;
  data?: ObjectState['data'];
  value?: number;
  placement?: ObjectPlacement;
}

export interface FakeMemberSpec {
  firstName?: string;
  traits?: string[];
  needs?: Partial<Record<NeedId, number>>;
  skills?: Partial<Record<SkillId, number>>;
  pos?: Vec2;
  vitality?: number;
  role?: AgentState['role'];
  presence?: AgentState['presence'];
}

export interface FakeOpts {
  seed?: number;
  funds?: number;
  members?: FakeMemberSpec[];
  objects?: FakeObjectSpec[];
  difficulty?: 'relaxed' | 'normal' | 'grim';
  /** Start tick (default 0 = Day 1 Monday 09:00). */
  tick?: number;
  systems?: SimSystem[];
  /** Extra apis for ctx.sys (e.g. a fake townies api). */
  extraApis?: Record<string, Record<string, (...args: any[]) => any>>;
  /** spatial.roomEnvironment return value. */
  env?: number;
}

const OPEN_SAFETY = 18 * 60;

function emptyWorld(seed: number, funds: number): WorldState {
  const width = 30;
  const depth = 30;
  return {
    schemaVersion: 1,
    seed,
    rng: seedRngState(seed),
    tick: 0,
    nextId: 1,
    household: { name: 'Test', funds, memberIds: [], bills: [], utilitiesOn: true, repoDispatchedDay: null, txLog: [] },
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
}

/** What the context / vocabulary builders need from the FakeSim. */
export type FakeHost = FakeSim;

export class FakeSim {
  readonly state: WorldState;
  readonly content: EngineRegistry;
  readonly ctx: SimContext;
  readonly systems: SimSystem[];
  events: SimEvent[] = [];
  /** Forced outcome for rng.chance (null = real rng). */
  forcedChance: boolean | null = null;
  env = 0;
  interrupts: { agentId: string; reason: string }[] = [];
  failures: { agentId: string; reason: string }[] = [];
  sentOffLot: { agentId: string; presence: string; reason: string }[] = [];
  effects: Record<string, EffectHandler> = {};
  requirements: Record<string, RequirementCheck> = {};
  behaviors: Record<string, InteractionBehavior> = {};
  conditions: Record<string, (ctx: SimContext, a: AgentState | null, p: Record<string, any>) => boolean> = {};
  extraApis: Record<string, Record<string, (...args: any[]) => any>>;
  time: TimeInfo;
  rng: Rng;

  constructor(opts: FakeOpts = {}) {
    resetCtxRegistry();
    this.state = emptyWorld(opts.seed ?? 1, opts.funds ?? 5000);
    if (opts.difficulty) this.state.settings.difficulty = opts.difficulty;
    this.state.tick = opts.tick ?? 0;
    this.content = testRegistry();
    this.systems = opts.systems ?? homeSystems;
    this.extraApis = opts.extraApis ?? {};
    this.env = opts.env ?? 0;
    this.time = timeInfo(this.state.tick);
    const realRng = createRng(this.state.rng);
    const self = this;
    this.rng = {
      next: () => realRng.next(),
      int: (a, b) => realRng.int(a, b),
      chance: (p) => (self.forcedChance === null ? realRng.chance(p) : self.forcedChance && p > 0),
      pick: (arr) => realRng.pick(arr),
      weighted: (w) => realRng.weighted(w),
      shuffle: (arr) => realRng.shuffle(arr),
    };
    const voc = engineVocabulary(this);
    this.effects = voc.effects;
    this.requirements = voc.requirements;
    this.behaviors = voc.behaviors;
    this.conditions = voc.conditions;
    for (const s of this.systems) {
      Object.assign(this.effects, s.effects ?? {});
      Object.assign(this.requirements, s.requirements ?? {});
      Object.assign(this.behaviors, s.behaviors ?? {});
      Object.assign(this.conditions, s.conditions ?? {});
    }
    this.ctx = buildFakeContext(this);
    for (const m of opts.members ?? [{ firstName: 'Mort' }]) this.addMember(m);
    for (const o of opts.objects ?? []) this.addObject(o);
    for (const s of this.systems) s.init?.(this.ctx, false);
  }

  // ─────────────────────────────── world building ───────────────────────────────

  addMember(m: FakeMemberSpec): AgentState {
    const a = this.ctx.createAgent({
      role: m.role ?? 'household',
      presence: m.presence ?? 'onLot',
      firstName: m.firstName ?? 'Zed',
      lastName: 'Test',
      appearance: defaultAppearance(),
      traits: m.traits ?? [],
      needs: { hunger: 80, energy: 80, preservation: 80, social: 80, fun: 80, hygiene: 80, ...(m.needs ?? {}) },
      skills: m.skills,
    });
    if (m.vitality !== undefined) a.vitality = m.vitality;
    if (m.needs?.preservation !== undefined) a.needs.preservation = Math.min(m.needs.preservation, a.vitality);
    a.pos = m.pos ?? { x: 5.5, z: 5.5 };
    a.prevPos = { ...a.pos };
    return a;
  }

  addObject(o: FakeObjectSpec): ObjectState {
    const def = this.content.objects[o.defId];
    const placement: ObjectPlacement =
      o.placement ??
      (def.placement === 'item'
        ? { kind: 'loose', x: o.x + 0.5, z: o.z + 0.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 }
        : def.placement === 'wall'
          ? { kind: 'wall', edge: `h:${o.x}:${o.z}`, side: 1 }
          : def.placement === 'door' || def.placement === 'window'
            ? { kind: 'opening', edge: `h:${o.x}:${o.z}` }
            : { kind: 'floor', x: o.x, z: o.z, rot: o.rot ?? 0 });
    return this.ctx.spawnObject(o.defId, placement, { data: o.data, value: o.value ?? def.price });
  }

  member(i = 0): AgentState {
    return this.state.agents[this.state.household.memberIds[i]];
  }

  obj(defId: string): ObjectState {
    const o = Object.values(this.state.objects).find((x) => x.defId === defId);
    if (!o) throw new Error(`no ${defId}`);
    return o;
  }

  objs(defId: string): ObjectState[] {
    return Object.values(this.state.objects).filter((x) => x.defId === defId);
  }

  sys(id: string): SimSystem {
    const s = this.systems.find((x) => x.id === id);
    if (!s) throw new Error(`no system ${id}`);
    return s;
  }

  setTick(tick: number): void {
    this.state.tick = tick;
    this.time = timeInfo(tick);
  }

  notificationsText(): string {
    return this.state.notifications.map((n) => `${n.title}: ${n.text}`).join('\n');
  }

  eventsOf<T extends SimEvent['type']>(type: T): Extract<SimEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[];
  }

  // ─────────────────────────────── time ───────────────────────────────

  /** Advance whole ticks: runs active interactions, then system ticks, then dayStart/hour hooks. */
  advance(minutes: number): void {
    const ticks = Math.round(minutes / TICK_MINUTES);
    for (let i = 0; i < ticks; i++) this.step();
  }

  step(): void {
    const before = this.time;
    this.state.tick++;
    this.time = timeInfo(this.state.tick);
    for (const a of Object.values(this.state.agents)) {
      if (a.presence === 'onLot' && a.active) this.tickRun(a, TICK_MINUTES);
    }
    for (const s of this.systems) s.tick?.(this.ctx, TICK_MINUTES);
    if (this.time.day !== before.day) for (const s of this.systems) s.dayStart?.(this.ctx, this.time.day);
    if (this.time.hour !== before.hour) for (const s of this.systems) s.hour?.(this.ctx, this.time.hour);
    // expire moodlets
    for (const a of Object.values(this.state.agents)) a.moodlets = a.moodlets.filter((m) => m.endTick === null || m.endTick > this.state.tick);
  }

  // ─────────────────────────────── interaction runner ───────────────────────────────

  /** Check requires + behaviour.available like the engine's menu/begin. */
  canStart(agent: AgentState, interactionId: string, target: TargetRef, params: Record<string, string | number | boolean> = {}): true | string {
    const def = this.content.interactions[interactionId];
    if (!def) return 'unknown interaction';
    const rc: RequirementContext = {
      actor: agent,
      def,
      target,
      targetAgent: target.kind === 'agent' ? this.state.agents[target.id] ?? null : null,
      targetObject: target.kind === 'object' ? this.state.objects[target.id] ?? null : null,
      params,
    };
    for (const r of def.requires ?? []) {
      const res = this.ctx.checkRequirement(r, rc);
      if (res !== true) return res;
    }
    const beh = def.behavior ? this.behaviors[def.behavior] : undefined;
    if (beh?.available) {
      const r = beh.available(this.ctx, agent, def, target);
      if (r !== true) return r;
    }
    return true;
  }

  /** Start an interaction immediately (skips routing). Returns the failure reason or null. */
  start(agent: AgentState, interactionId: string, target: TargetRef, params: Record<string, string | number | boolean> = {}, opts: { checkRequires?: boolean; source?: QueueItem['source'] } = {}): string | null {
    const def = this.content.interactions[interactionId];
    if (!def) return 'unknown interaction';
    if (opts.checkRequires !== false) {
      const ok = this.canStart(agent, interactionId, target, params);
      if (ok !== true) return ok;
    }
    const run: ActiveInteraction = {
      uid: this.ctx.newUid(),
      interactionId,
      target,
      params: { ...params },
      source: opts.source ?? 'player',
      priority: 200,
      queuedTick: this.state.tick,
      phase: 'route',
      stage: 0,
      stageTarget: target,
      slot: null,
      routeGoal: null,
      pose: null,
      startedRunTick: null,
      elapsed: 0,
      duration: 0,
      partnerId: target.kind === 'agent' ? target.id : null,
      routeFails: 0,
      waitMinutes: 0,
      data: {},
      canceled: false,
    };
    agent.active = run;
    const beh = this.behaviorOf(def);
    if (beh?.begin) {
      const r = beh.begin(this.ctx, agent, run, def);
      if (r) {
        this.finish(agent, 'failed', r);
        return r;
      }
    }
    return this.enterStage(agent, run, def, 0);
  }

  /** Run the agent's active interaction to completion (or until `maxMinutes`). Returns the outcome reason or null. */
  runToEnd(agent: AgentState, maxMinutes = 24 * 60): string | null {
    this.lastReason = null;
    const ticks = Math.round(maxMinutes / TICK_MINUTES);
    for (let i = 0; i < ticks && agent.active; i++) this.step();
    return this.lastReason;
  }

  lastReason: string | null = null;
  lastOutcome: 'complete' | 'canceled' | 'failed' | null = null;

  cancel(agent: AgentState, reason = 'Canceled'): void {
    if (agent.active) this.finish(agent, 'canceled', reason);
  }

  private behaviorOf(def: InteractionDef): InteractionBehavior | undefined {
    return def.behavior ? this.behaviors[def.behavior] : undefined;
  }

  private stagesOf(def: InteractionDef): StageDef[] {
    return this.content.stagesOf(def.id);
  }

  private resolve(agent: AgentState, run: ActiveInteraction, t: StageTarget): { ref: TargetRef; slot: number | null } | null {
    const objs = Object.values(this.state.objects);
    const pickSlot = (o: ObjectState, filter?: string[], kind?: string): number | null => {
      const def = this.content.objects[o.defId];
      const slots = def.slots ?? [];
      for (let i = 0; i < slots.length; i++) {
        if (filter && filter.length && !filter.includes(slots[i].id)) continue;
        if (kind && slots[i].kind !== kind) continue;
        if (o.reservedBy[String(i)] && o.reservedBy[String(i)] !== agent.id) continue;
        return i;
      }
      return slots.length === 0 && !kind ? null : -1;
    };
    switch (t.kind) {
      case 'target': {
        if (run.target.kind === 'object') {
          const o = this.state.objects[run.target.id];
          if (!o) return null;
          if (o.placement.kind === 'held' && o.placement.agentId === agent.id) return { ref: { kind: 'self' }, slot: null };
          const s = pickSlot(o, t.slots);
          if (s === -1) return null;
          return { ref: run.target, slot: s };
        }
        return { ref: run.target, slot: null };
      }
      case 'nearestTag': {
        let best: ObjectState | null = null;
        let bestD = Infinity;
        let bestSlot: number | null = null;
        for (const o of objs) {
          const def = this.content.objects[o.defId];
          if (!def.tags.includes(t.tag) || o.condition.broken || o.condition.burning || o.placement.kind === 'held') continue;
          const s = pickSlot(o, t.slots);
          if (s === -1) continue;
          const d = this.dist(agent.pos, this.ctx.spatial.objectCenter(o));
          if (d < bestD) {
            bestD = d;
            best = o;
            bestSlot = s;
          }
        }
        return best ? { ref: { kind: 'object', id: best.id }, slot: bestSlot } : null;
      }
      case 'seat': {
        const near = t.near === 'target' && run.target.kind === 'object' && this.state.objects[run.target.id] ? this.ctx.spatial.objectCenter(this.state.objects[run.target.id]) : agent.pos;
        let best: ObjectState | null = null;
        let bestD = Infinity;
        let bestSlot: number | null = null;
        for (const o of objs) {
          const def = this.content.objects[o.defId];
          if (!def.slots?.some((s) => s.kind === 'sit') || o.placement.kind !== 'floor') continue;
          const d = this.dist(near, this.ctx.spatial.objectCenter(o));
          if (d > t.radius) continue;
          const s = pickSlot(o, undefined, 'sit');
          if (s === -1 || s === null) continue;
          if (d < bestD) {
            bestD = d;
            best = o;
            bestSlot = s;
          }
        }
        return best ? { ref: { kind: 'object', id: best.id }, slot: bestSlot } : null;
      }
      case 'tileNear':
        return { ref: { kind: 'tile', x: Math.floor(agent.pos.x), z: Math.floor(agent.pos.z) }, slot: null };
      case 'agentAdjacent':
        return run.target.kind === 'agent' && this.state.agents[run.target.id] ? { ref: run.target, slot: null } : null;
      case 'here':
      case 'exit':
        return { ref: { kind: 'self' }, slot: null };
    }
  }

  private dist(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  private enterStage(agent: AgentState, run: ActiveInteraction, def: InteractionDef, index: number): string | null {
    const st = this.stagesOf(def)[index];
    if (!st) return this.finish(agent, 'failed', 'no stage');
    run.stage = index;
    let res = this.resolve(agent, run, st.target);
    if (!res && st.fallback) res = this.resolve(agent, run, st.fallback);
    if (!res) return this.finish(agent, 'failed', 'No free target');
    run.stageTarget = res.ref;
    run.slot = res.slot;
    if (res.ref.kind === 'object' && res.slot !== null) {
      const o = this.state.objects[res.ref.id];
      o.reservedBy[String(res.slot)] = agent.id;
      // pose: stand at the object (facing +Z toward a table in front for seats)
      const c = this.ctx.spatial.objectCenter(o);
      agent.pos = { x: c.x, z: c.z };
      agent.facing = 0;
    }
    // pairs: after stage 0 resolves, give the partner its half
    if (index === 0 && def.pair && run.target.kind === 'agent') {
      const partner = this.state.agents[run.target.id];
      if (partner) {
        const pdef = this.content.interactions[def.pair.partnerInteraction];
        const ptarget: TargetRef = def.pair.partnerTarget === 'sameObject' ? run.stageTarget : { kind: 'agent', id: agent.id };
        partner.active = {
          uid: this.ctx.newUid(),
          interactionId: pdef.id,
          target: ptarget,
          params: { partnerOf: agent.id },
          source: 'system',
          priority: 300,
          queuedTick: this.state.tick,
          phase: 'run',
          stage: 0,
          stageTarget: ptarget,
          slot: null,
          routeGoal: null,
          pose: null,
          startedRunTick: this.state.tick,
          elapsed: 0,
          duration: this.stagesOf(pdef)[0]?.duration ?? 1e9,
          partnerId: agent.id,
          routeFails: 0,
          waitMinutes: 0,
          data: {},
          canceled: false,
        };
        run.partnerId = partner.id;
      }
    }
    return this.startRunPhase(agent, run, def);
  }

  private stageObj(run: ActiveInteraction): ObjectState | null {
    if (run.stageTarget.kind === 'object') return this.state.objects[run.stageTarget.id] ?? null;
    return null;
  }

  private startRunPhase(agent: AgentState, run: ActiveInteraction, def: InteractionDef): string | null {
    const st = this.stagesOf(def)[run.stage];
    run.phase = 'run';
    run.elapsed = 0;
    run.startedRunTick = this.state.tick;
    run.duration = st.duration;
    if (run.stage === 0 && def.cost && def.cost > 0 && !run.params._costPaid) {
      if (!this.ctx.spend(def.cost, def.label, `cost:${typeof run.params._origUid === 'number' ? run.params._origUid : run.uid}`)) return this.finish(agent, 'failed', "Can't afford");
    }
    const obj = this.stageObj(run);
    const powerObj = obj ?? (run.target.kind === 'object' ? this.state.objects[run.target.id] ?? null : null);
    const needPower = st.power ?? (obj ? !!this.content.objects[obj.defId].needsPower : false);
    if (needPower) {
      if (!this.state.household.utilitiesOn) return this.finish(agent, 'failed', 'The power is out');
      if (powerObj?.condition.broken) return this.finish(agent, 'failed', 'is broken');
    }
    if (obj) {
      if (!obj.inUseBy.includes(agent.id)) obj.inUseBy.push(agent.id);
      run.data._uo = obj.id;
    }
    agent.anim = st.anim;
    if (st.carry !== undefined) agent.carrying = st.carry;
    for (const e of st.effectsOnStart ?? []) this.runEffectIn(agent, run, def, e);
    const beh = this.behaviorOf(def);
    if (beh?.startStage) {
      const r = beh.startStage(this.ctx, agent, run, def, run.stage);
      if (agent.active !== run) return this.lastReason;
      if (typeof r === 'string' && r) return this.finish(agent, 'failed', r);
    }
    if (run.duration <= 0) return this.completeStage(agent, run, def);
    return null;
  }

  private tickRun(agent: AgentState, dt: number): void {
    const run = agent.active!;
    if (run.phase !== 'run') return;
    const def = this.content.interactions[run.interactionId];
    if (!def) return;
    // partner halves are passive; their actor drives them
    if (run.params.partnerOf) return;
    const st = this.stagesOf(def)[run.stage];
    const obj = this.stageObj(run);
    for (const [need, rate] of Object.entries(st.needsPerHour ?? {}) as [NeedId, number][]) {
      let scale = 1;
      const key = st.scaleByObjectParam?.[need];
      if (key && obj) {
        const v = this.content.objects[obj.defId].params[key];
        if (typeof v === 'number') scale = v;
      }
      this.ctx.changeNeed(agent, need, (rate * scale * dt) / 60);
    }
    for (const [skill, rate] of Object.entries(st.skillXpPerHour ?? {}) as [SkillId, number][]) this.ctx.addXp(agent, skill, (rate * dt) / 60);
    const beh = this.behaviorOf(def);
    if (beh?.tick) {
      const r = beh.tick(this.ctx, agent, run, def, dt);
      if (agent.active !== run) return;
      if (r === 'done') {
        this.completeStage(agent, run, def);
        return;
      }
    }
    if (st.stopWhen) {
      const cap = this.ctx.needCap(agent, st.stopWhen.need);
      const thr = Math.min(st.stopWhen.atLeast, cap);
      if (agent.needs[st.stopWhen.need] >= thr - 1e-9) {
        this.completeStage(agent, run, def);
        return;
      }
    }
    run.elapsed += dt;
    if (run.elapsed >= run.duration - 1e-9 || (run.duration >= 1e8 && run.elapsed >= OPEN_SAFETY)) this.completeStage(agent, run, def);
  }

  private runEffectIn(agent: AgentState, run: ActiveInteraction, def: InteractionDef, e: { id: string; params?: Record<string, unknown> }): void {
    this.effectKey = `run:${run.uid}:${run.stage}`;
    this.ctx.runEffect(e, this.effectCtx(agent, run, def));
    this.effectKey = null;
  }

  effectKey: string | null = null;

  private effectCtx(agent: AgentState, run: ActiveInteraction, def: InteractionDef): EffectContext {
    let targetObject = this.stageObj(run);
    if (!targetObject && run.target.kind === 'object') targetObject = this.state.objects[run.target.id] ?? null;
    const targetAgent = run.target.kind === 'agent' ? this.state.agents[run.target.id] ?? null : run.partnerId ? this.state.agents[run.partnerId] ?? null : null;
    return { actor: agent, run, def, stage: run.stage, targetAgent, targetObject };
  }

  private completeStage(agent: AgentState, run: ActiveInteraction, def: InteractionDef): string | null {
    const st = this.stagesOf(def)[run.stage];
    for (const e of st.effectsOnComplete ?? []) {
      this.runEffectIn(agent, run, def, e);
      if (agent.active !== run) return this.lastReason;
    }
    const beh = this.behaviorOf(def);
    beh?.completeStage?.(this.ctx, agent, run, def, run.stage);
    if (agent.active !== run) return this.lastReason;
    const next = run.stage + 1;
    if (next < this.stagesOf(def).length) {
      this.release(agent, run);
      return this.enterStage(agent, run, def, next);
    }
    return this.finish(agent, 'complete');
  }

  private release(agent: AgentState, run: ActiveInteraction): void {
    for (const o of Object.values(this.state.objects)) {
      for (const [k, v] of Object.entries(o.reservedBy)) if (v === agent.id) delete o.reservedBy[k];
      if (o.inUseBy.includes(agent.id)) o.inUseBy = o.inUseBy.filter((x) => x !== agent.id);
    }
    void run;
  }

  finishing = new Set<number>();

  finish(agent: AgentState, outcome: 'complete' | 'canceled' | 'failed', reason?: string): string | null {
    const run = agent.active;
    if (!run || this.finishing.has(run.uid)) return reason ?? null;
    this.finishing.add(run.uid);
    try {
      const def = this.content.interactions[run.interactionId];
      this.release(agent, run);
      if (outcome === 'complete') {
        for (const g of def.moodletsOnComplete ?? []) {
          if (g.chance !== undefined && g.chance < 1 && !this.rng.chance(g.chance)) continue;
          this.ctx.addMoodlet(agent, g.id);
        }
      }
      this.behaviorOf(def)?.end?.(this.ctx, agent, run, def, outcome);
      if (agent.active === run) agent.active = null;
      if (!agent.carryObjectId) agent.carrying = null;
      agent.anim = 'idle';
      // partner ends with the actor
      if (run.partnerId) {
        const p = this.state.agents[run.partnerId];
        if (p?.active && p.active.partnerId === agent.id) this.finish(p, outcome === 'complete' ? 'complete' : 'canceled', reason);
      }
      this.lastOutcome = outcome;
      this.lastReason = outcome === 'complete' ? null : reason ?? outcome;
      return this.lastReason;
    } finally {
      this.finishing.delete(run.uid);
    }
  }

}

/** Common test lot: kitchen with table & chairs, fridge, stove, sink, trash, coffin, mailbox, TV & sofa. */
export function kitchenLot(): FakeObjectSpec[] {
  return [
    { defId: 'fridge_humming', x: 2, z: 2 },
    { defId: 'stove_greasefire', x: 3, z: 2 },
    { defId: 'counter_butcher', x: 4, z: 2 },
    { defId: 'sink_rusty', x: 5, z: 2 },
    { defId: 'trash_lidded', x: 6, z: 2 },
    { defId: 'table_rickety', x: 3, z: 5 },
    { defId: 'chair_creaky', x: 3, z: 4 },
    { defId: 'chair_creaky', x: 2, z: 5 },
    { defId: 'coffin_pine', x: 10, z: 2 },
    { defId: 'mailbox_crooked', x: 15, z: 25 },
  ];
}
