/** createSimulationWith — wires the engine together and runs the tick pipeline (README §5). */
import type { BuildService, ContentRegistry, SimSystem, SimulationAPI, SpatialAPI } from '../contracts';
import type { AgentState, WorldState } from '../types';
import { TICK_MINUTES } from '../types';
import { createRng } from '../rng';
import { timeInfo } from '../time';
import { MAX_NOTIFICATIONS, MAX_TXLOG } from './constants';
import { defaultStatus, entryPointFor, isHouseholdAgent, isVisitorAgent, isWalkBy, onLotSorted } from './agents';
import { criticalOverrides, runAutonomy } from './autonomy';
import { engineBehaviors } from './behaviors';
import { dispatchCommand, resolveChoice } from './commands';
import { createContext } from './context';
import { engineEffects } from './effects';
import { guardSystem, recordFault } from './faults';
import { checkInvariantsOf } from './invariants';
import { buildMenu } from './menu';
import { moveAlongPath, nudgeIfBlocked } from './movement';
import { decayNeeds, expireMoodlets } from './needs';
import { asEngineRegistry } from './registry';
import { repairPositions, repairWorld } from './repair';
import { pruneRepetition } from './repetition';
import { createRegionRegistry, scopeSpatial, withAgentRegion } from './regions';
import { engineConditions, engineRequirements } from './requirements';
import { abortRun, arrive, powerCheck, preempt, reResolve, tickInteraction } from './runner';
import { installStreaming, streamStep } from './streaming';
import { crossPortal, crossingDue, worldRouteQuery } from './worldMove';
import type { Engine, EngineDeps } from './types';
import { errorMessage, isNum, jsonCopy } from './util';
import { ENGINE_INTERACTIONS } from '../vocabulary';
import {
  aspirationFallback,
  billsFallback,
  careerFallback,
  careersAvailableFallback,
  lotValueFallback,
  moodView,
  moodletsView,
  needsView,
  objectViewOf,
  partyFallback,
  queueViewOf,
  relationshipsFallback,
  skillsView,
  summaryOf,
  sysCall,
  towniesFallback,
} from './views';

export interface EngineSimulation extends SimulationAPI {
  /** Internal engine (tests / debug tools only). */
  readonly engine: Engine;
  /** Problems found while wiring systems (id collisions etc.). */
  readonly wiringProblems: string[];
  /** Warnings produced by repairWorld when the simulation was created with `repair: true`. */
  readonly repairWarnings: string[];
}

function stubBuild(reason: string): BuildService {
  return {
    preview: () => ({ ok: false, reason, cost: 0 }),
    apply: () => ({ ok: false, reason, cost: 0 }),
    undo: () => false,
    redo: () => false,
    canUndo: () => false,
    canRedo: () => false,
    clearHistory: () => undefined,
  };
}

/** Build the engine object (no repair, no system init). */
export function createEngine(state: WorldState, registry: ContentRegistry, systems: readonly SimSystem[], deps: EngineDeps): { eng: Engine; problems: string[] } {
  const problems: string[] = [];
  const eng = {
    state,
    content: asEngineRegistry(registry),
    systems: [],
    rng: createRng(state.rng),
    time: timeInfo(isNum(state.tick) ? state.tick : 0),
    events: [],
    faults: [],
    effects: {},
    requirements: {},
    behaviors: {},
    conditions: {},
    finishing: new Set<number>(),
    pendingFail: new Map<number, string>(),
    effectKey: null,
    currentRunUid: null,
    actingAgentId: null,
    moodModCache: new Map(),
  } as unknown as Engine;
  const seen = new Set<string>();
  for (const sys of systems) {
    if (!sys || typeof sys.id !== 'string') {
      problems.push('a system without an id was skipped');
      continue;
    }
    if (seen.has(sys.id)) problems.push(`duplicate system id '${sys.id}'`);
    seen.add(sys.id);
    eng.systems.push({ sys, failures: 0, disabled: false });
  }
  eng.ctx = createContext(eng);
  // W-025 S1: the home region's spatial service is the engine's original one; `eng.spatial` resolves the region in
  // scope (always the home until streaming registers other regions, TODO(S4)).
  eng.regions = createRegionRegistry(deps.spatialFactory(() => eng.state, eng.content));
  eng.spatialFactory = deps.spatialFactory;
  Object.defineProperty(eng, 'spatial', {
    get: () => scopeSpatial(eng),
    set: (v: SpatialAPI) => {
      eng.regions.homeSpatial = v;
    },
    enumerable: true,
    configurable: true,
  });
  eng.effects = engineEffects(eng);
  eng.requirements = engineRequirements(eng);
  eng.behaviors = engineBehaviors(eng);
  eng.conditions = engineConditions(eng);
  const merge = <T>(kind: string, dst: Record<string, T>, src: Record<string, T> | undefined, sysId: string) => {
    if (!src || typeof src !== 'object') return;
    for (const [id, fn] of Object.entries(src)) {
      if (typeof fn !== 'function' && kind !== 'behavior') continue;
      if (dst[id] !== undefined) {
        problems.push(`${kind} id '${id}' from system '${sysId}' collides with an existing ${kind}; ignored`);
        continue;
      }
      dst[id] = fn;
    }
  };
  for (const { sys } of eng.systems) {
    merge('effect', eng.effects, sys.effects, sys.id);
    merge('requirement', eng.requirements, sys.requirements, sys.id);
    merge('behavior', eng.behaviors, sys.behaviors as Record<string, never> | undefined, sys.id);
    merge('condition', eng.conditions, sys.conditions, sys.id);
  }
  try {
    eng.build = deps.buildFactory(eng.ctx);
  } catch (e) {
    recordFault(eng, 'build.create', e);
    eng.build = stubBuild('Build mode is unavailable');
  }
  for (const p of problems) recordFault(eng, 'wiring', p);
  return { eng, problems };
}

export function initSystems(eng: Engine, loaded: boolean): void {
  for (const entry of eng.systems) {
    const fn = entry.sys.init;
    if (fn) guardSystem(eng, entry, 'init', () => fn.call(entry.sys, eng.ctx, loaded));
  }
}

/** Cheap per-tick self-healing of the fields every engine step relies on (corrupt saves / buggy systems). */
function healAgent(eng: Engine, a: AgentState): void {
  if (!a.status || typeof a.status !== 'object') a.status = defaultStatus();
  if (!a.needs || typeof a.needs !== 'object') a.needs = { hunger: 50, energy: 50, preservation: 50, social: 50, fun: 50, hygiene: 50 };
  if (!Array.isArray(a.queue)) a.queue = [];
  if (!Array.isArray(a.moodlets)) a.moodlets = [];
  if (!Array.isArray(a.traits)) a.traits = [];
  if (!Array.isArray(a.rewardTraits)) a.rewardTraits = [];
  if (!isNum(a.vitality)) a.vitality = 100;
  if (!isNum(a.facing)) a.facing = 0;
  if (!isNum(a.posY)) a.posY = 0;
  if (!a.pos || !isNum(a.pos.x) || !isNum(a.pos.z)) {
    a.pos = entryPointFor(eng, a);
    a.path = null;
    if (a.active && a.active.phase === 'route') a.active.data._v = -2;
  }
  // passedOut mirrors a running engine_passOut (its begin/end set it). A stale flag (a dropped run in a repaired
  // save, a system that cleared the run) would otherwise freeze the agent: no autonomy and no new pass-out.
  if (a.status.passedOut && !(a.active && a.active.interactionId === ENGINE_INTERACTIONS.passOut)) a.status.passedOut = false;
  const r = a.active;
  if (r) {
    if (!isNum(r.elapsed) || r.elapsed < 0) r.elapsed = 0;
    if (!isNum(r.duration) || r.duration < 0) r.duration = 0;
    if (!isNum(r.waitMinutes) || r.waitMinutes < 0) r.waitMinutes = 0;
  }
}

function updateAgent(eng: Engine, a: AgentState, dt: number, powerOff: boolean): void {
  if (isHouseholdAgent(eng, a) || (isVisitorAgent(a) && !isWalkBy(a))) decayNeeds(eng, a, dt);
  expireMoodlets(eng, a);
  // While the utilities are off every running stage is re-checked each tick. This reads only saved state (no
  // "previous tick" memory), so a power cut made by a system or command just before a save ends the same runs in
  // the live game and in the reloaded one (decision #9).
  if (powerOff) powerCheck(eng, a);
  criticalOverrides(eng, a);
  if (a.presence !== 'onLot') return;
  preempt(eng, a);
  tickInteraction(eng, a, dt);
  if (a.presence !== 'onLot') return;
  const run = a.active;
  if (a.path) {
    if (run && run.phase === 'route') {
      const res = moveAlongPath(eng, a, dt);
      // W-025 S3: the agent stepped over a portal's outer edge this tick → switch region and re-plan there
      if (a.active === run && crossingDue(eng, a)) {
        const def = eng.content.interactions[run.interactionId];
        if (def && crossPortal(eng, a, run, def, reResolve)) {
          if (a.presence === 'onLot') withAgentRegion(eng, a, () => nudgeIfBlocked(eng, a));
          return;
        }
        // refused (the gate locked, the region closed): back onto this grid, re-plan now (it fails with the reason)
        a.path = null;
        a.pathIndex = 0;
        nudgeIfBlocked(eng, a);
        if (def && a.active === run) reResolve(eng, a, run, def);
        return;
      }
      if (res === 'arrived' && a.active === run) {
        const def = eng.content.interactions[run.interactionId];
        if (def) arrive(eng, a, run, def);
      } else if (res === 'blocked' && a.active === run) run.data._blk = 1;
    } else {
      a.path = null;
      a.pathIndex = 0;
    }
  }
  if (a.presence !== 'onLot') return;
  nudgeIfBlocked(eng, a);
  if (!a.active) a.anim = a.status.feral ? 'feral' : 'idle';
  if (!a.active && a.queue.length === 0) beforeAutonomy(eng, a);
  if (!a.active && a.queue.length === 0) runAutonomy(eng, a);
}

/** W-124: SimSystem.beforeAutonomy hooks (household only, systems in tick order; the first that queues wins). */
function beforeAutonomy(eng: Engine, a: AgentState): void {
  if (!isHouseholdAgent(eng, a)) return;
  for (const entry of eng.systems) {
    const fn = entry.sys.beforeAutonomy;
    if (!fn || entry.disabled) continue;
    guardSystem(eng, entry, 'beforeAutonomy', () => fn.call(entry.sys, eng.ctx, a));
    if (a.active || a.queue.length > 0 || a.presence !== 'onLot') return;
  }
}

function expireChoices(eng: Engine): void {
  const s = eng.state;
  for (let i = s.choices.length - 1; i >= 0; i--) {
    const c = s.choices[i];
    if (!c) continue;
    if (isNum(c.expiresTick) && c.expiresTick > s.tick) continue;
    try {
      resolveChoice(eng, i, isNum(c.defaultOption) ? c.defaultOption : 0);
    } catch (e) {
      recordFault(eng, `choice:${c.id}`, e);
      const j = s.choices.indexOf(c);
      if (j >= 0) s.choices.splice(j, 1);
    }
  }
}

function housekeeping(eng: Engine): void {
  const s = eng.state;
  if (s.notifications.length > MAX_NOTIFICATIONS) s.notifications.splice(0, s.notifications.length - MAX_NOTIFICATIONS);
  if (s.household.txLog.length > MAX_TXLOG) s.household.txLog.splice(0, s.household.txLog.length - MAX_TXLOG);
  pruneRepetition(eng);
  if (!s.gameOver) {
    const members = s.household.memberIds.map((id) => s.agents[id]).filter((a): a is AgentState => !!a);
    if (members.length === 0 || members.every((m) => m.presence === 'gone')) {
      s.gameOver = true;
      eng.ctx.emit({ type: 'gameOver', reason: 'Rest in Pieces' });
    }
  }
}

export function stepEngine(eng: Engine): void {
  const s = eng.state;
  const prev = eng.time;
  // W-025 S4: sim streaming tiers (every STREAM_EVAL_TICKS, before the tick advances; no-op without a live town)
  streamStep(eng);
  s.tick = (isNum(s.tick) ? Math.floor(s.tick) : 0) + 1;
  eng.time = timeInfo(s.tick);
  const dt = TICK_MINUTES;
  const agents = onLotSorted(eng);
  for (const a of agents) {
    try {
      withAgentRegion(eng, a, () => healAgent(eng, a));
      if (!a.prevPos || a.prevPos === a.pos) a.prevPos = { x: a.pos.x, z: a.pos.z };
      else {
        a.prevPos.x = a.pos.x;
        a.prevPos.z = a.pos.z;
      }
      a.prevFacing = a.facing;
    } catch (e) {
      recordFault(eng, `agent:${a.id}`, e);
    }
  }
  const powerOff = !s.household.utilitiesOn;
  for (const a of agents) {
    if (a.presence !== 'onLot') continue;
    eng.actingAgentId = a.id;
    try {
      withAgentRegion(eng, a, () => updateAgent(eng, a, dt, powerOff));
    } catch (e) {
      recordFault(eng, `agent:${a.id}`, e);
      abortRun(eng, a);
    } finally {
      eng.actingAgentId = null;
    }
  }
  for (const a of Object.values(s.agents)) {
    if (a.presence === 'onLot') continue;
    try {
      expireMoodlets(eng, a);
    } catch (e) {
      recordFault(eng, `agent:${a.id}`, e);
    }
  }
  for (const entry of eng.systems) {
    const fn = entry.sys.tick;
    if (fn) guardSystem(eng, entry, 'tick', () => fn.call(entry.sys, eng.ctx, dt));
  }
  const newDay = eng.time.day !== prev.day;
  const newHour = newDay || eng.time.hour !== prev.hour;
  if (newDay) {
    for (const entry of eng.systems) {
      const fn = entry.sys.dayStart;
      if (fn) guardSystem(eng, entry, 'dayStart', () => fn.call(entry.sys, eng.ctx, eng.time.day));
    }
  }
  if (newHour) {
    for (const entry of eng.systems) {
      const fn = entry.sys.hour;
      if (fn) guardSystem(eng, entry, 'hour', () => fn.call(entry.sys, eng.ctx, eng.time.hour));
    }
    for (const a of onLotSorted(eng)) {
      try {
        withAgentRegion(eng, a, () => powerCheck(eng, a));
      } catch (e) {
        recordFault(eng, `agent:${a.id}`, e);
        abortRun(eng, a);
      }
    }
  }
  expireChoices(eng);
  if (newHour) housekeeping(eng);
}

/**
 * Internal factory used by src/sim/index.ts and the tests.
 * `repair` runs repairWorld (structure before wiring, positions after spatial exists); `init` calls system init hooks
 * (true → init(ctx, true) as for a loaded save, 'new' → init(ctx, false)).
 */
export function createSimulationWith(
  state: WorldState,
  registry: ContentRegistry,
  systems: readonly SimSystem[],
  deps: EngineDeps,
  opts: { init?: boolean | 'new'; repair?: boolean } = {},
): EngineSimulation {
  const repairWarnings: string[] = opts.repair ? repairWorld(state, registry) : [];
  const { eng, problems } = createEngine(state, registry, systems, deps);
  // W-025 S4: streaming (planner over dormant regions, crossing hook) + the saved active regions get their services back
  installStreaming(eng, repairWarnings);
  if (opts.repair) {
    repairPositions(state, eng.spatial, repairWarnings);
  }
  if (opts.init === true) initSystems(eng, true);
  else if (opts.init === 'new') initSystems(eng, false);
  const safe = <T>(where: string, fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (e) {
      recordFault(eng, `view:${where}`, e);
      return fallback;
    }
  };
  const agentOf = (id: string) => (typeof id === 'string' ? eng.state.agents[id] : undefined);
  const api: EngineSimulation = {
    get state() {
      return eng.state;
    },
    get content() {
      return eng.content;
    },
    get spatial() {
      return eng.spatial;
    },
    get build() {
      return eng.build;
    },
    get engine() {
      return eng;
    },
    wiringProblems: problems,
    repairWarnings,
    step() {
      try {
        stepEngine(eng);
      } catch (e) {
        recordFault(eng, 'step', `${errorMessage(e)}`);
      }
    },
    dispatch: (cmd) => dispatchCommand(eng, cmd),
    drainEvents() {
      const e = eng.events;
      eng.events = [];
      return e;
    },
    faults: () => eng.faults.slice(),
    time: () => eng.time,
    agent: (id) => agentOf(id),
    object: (id) => (typeof id === 'string' ? eng.state.objects[id] : undefined),
    household: () =>
      safe(
        'household',
        () =>
          eng.state.household.memberIds
            .map((id) => eng.state.agents[id])
            .filter((a): a is AgentState => !!a)
            .map((a) => summaryOf(eng, a)),
        [],
      ),
    summary: (id) => safe('summary', () => (agentOf(id) ? summaryOf(eng, agentOf(id)!) : null), null),
    onLotSummaries: () => safe('onLot', () => onLotSorted(eng).map((a) => summaryOf(eng, a)), []),
    menu: (actorId, target) => safe('menu', () => buildMenu(eng, actorId, target), []),
    queueView: (id) => safe('queue', () => (agentOf(id) ? queueViewOf(eng, agentOf(id)!) : []), []),
    needs: (id) => safe('needs', () => (agentOf(id) ? needsView(eng, agentOf(id)!) : []), []),
    mood: (id) => safe('mood', () => moodView(eng, agentOf(id)), moodView(eng, undefined)),
    moodlets: (id) => safe('moodlets', () => (agentOf(id) ? moodletsView(eng, agentOf(id)!) : []), []),
    skills: (id) => safe('skills', () => (agentOf(id) ? skillsView(eng, agentOf(id)!) : []), []),
    career: (id) =>
      safe(
        'career',
        () => {
          const a = agentOf(id);
          if (!a) return null;
          const v = sysCall<ReturnType<SimulationAPI['career']>>(eng, 'careers', 'view', a.id);
          return v !== undefined ? v : careerFallback(eng, a);
        },
        null,
      ),
    relationships: (id) =>
      safe(
        'relationships',
        () => {
          if (!agentOf(id)) return [];
          const v = sysCall<ReturnType<SimulationAPI['relationships']>>(eng, 'social', 'relationships', id);
          return Array.isArray(v) ? v : relationshipsFallback(eng, id);
        },
        [],
      ),
    aspiration: (id) =>
      safe(
        'aspiration',
        () => {
          const a = agentOf(id);
          if (!a) return null;
          const v = sysCall<ReturnType<SimulationAPI['aspiration']>>(eng, 'aspirations', 'view', id);
          return v !== undefined ? v : aspirationFallback(eng, a);
        },
        null,
      ),
    bills: () =>
      safe(
        'bills',
        () => {
          const v = sysCall<ReturnType<SimulationAPI['bills']>>(eng, 'economy', 'bills');
          return v && typeof v === 'object' ? v : billsFallback(eng);
        },
        billsFallback(eng),
      ),
    objectView: (id) => safe('object', () => objectViewOf(eng, id), null),
    townies: (forId) =>
      safe(
        'townies',
        () => {
          const v = sysCall<ReturnType<SimulationAPI['townies']>>(eng, 'townies', 'list', forId);
          return Array.isArray(v) ? v : towniesFallback(eng, forId);
        },
        [],
      ),
    careersAvailable: () =>
      safe(
        'careersAvailable',
        () => {
          const v = sysCall<ReturnType<SimulationAPI['careersAvailable']>>(eng, 'careers', 'available');
          return Array.isArray(v) ? v : careersAvailableFallback(eng);
        },
        [],
      ),
    party: () =>
      safe(
        'party',
        () => {
          const v = sysCall<ReturnType<SimulationAPI['party']>>(eng, 'townies', 'party');
          return v !== undefined ? v : partyFallback(eng);
        },
        null,
      ),
    lotValue: () =>
      safe(
        'lotValue',
        () => {
          const v = sysCall<number>(eng, 'economy', 'lotValue');
          return isNum(v) ? v : lotValueFallback(eng);
        },
        0,
      ),
    quests: () =>
      safe(
        'quests',
        () => {
          const v = sysCall<ReturnType<NonNullable<SimulationAPI['quests']>>>(eng, 'quests', 'view');
          return v && typeof v === 'object' ? v : null;
        },
        null,
      ),
    worldRoute: (actorId, target) =>
      safe('worldRoute', () => worldRouteQuery(eng, actorId, target), { ok: false, target: { regionId: '', x: 0, z: 0 }, reason: 'noPath' } as const),
    jobs: () =>
      safe(
        'jobs',
        () => {
          const v = sysCall<ReturnType<NonNullable<SimulationAPI['jobs']>>>(eng, 'jobs', 'view');
          return v && typeof v === 'object' ? v : null;
        },
        null,
      ),
    serialize: () => jsonCopy(eng.state),
    checkInvariants: () => safe('invariants', () => checkInvariantsOf(eng), ['invariant check crashed']),
  };
  return api;
}
