/**
 * Test fixtures for SIM-SPATIAL: a content registry built from the shared physical catalog, tiny world builders and
 * a fake BuildContext that mimics the engine's object bookkeeping (opening links, child drop on remove).
 */
import { PHYSICAL_SPECS } from '../../../src/shared/catalog';
import type { ContentRegistry, ObjectDef, SimEvent } from '../../../src/sim/contracts';
import type { AgentState, EdgeKey, LotState, ObjectPlacement, ObjectState, Vec2, WorldState } from '../../../src/sim/types';
import { createSpatial, type BuildContext, type SpatialService } from '../../../src/sim/spatial';
import { newLot } from '../../../src/sim/spatial/templates/builder';
import { createLotTemplate } from '../../../src/sim/spatial/templates';
import { createRng } from '../../../src/sim/rng';

/** env values used by the tests (the real numbers live in SIM-HOME content). */
export const TEST_ENV: Record<string, number> = {
  painting_greatgrand: 4,
  plant_deadfern: 1,
  rug_rag: 2,
  rug_funeral: 4,
  sofa_velvet: 5,
  sofa_moldy: 1,
  candelabra_drippy: 2,
  lamp_skull: 1,
  tree_gnarled: 2,
  headstone_decor: 2,
  lantern_post: 1,
  table_wake: 2,
  // spawned items: the same numbers SIM-HOME ships (backlog #4 — the spatial module reads them from the defs)
  item_dish: -1,
  item_ash: -3,
  item_fire: -5,
};

export function makeContent(patch?: (objs: Record<string, ObjectDef>) => void): ContentRegistry {
  const objects: Record<string, ObjectDef> = {};
  for (const s of PHYSICAL_SPECS) {
    objects[s.id] = {
      ...s,
      interactions: [],
      env: TEST_ENV[s.id] ?? 0,
      depreciation: 0.15,
      breakChance: 0,
      sellable: s.buyable,
      params: {},
    };
  }
  if (patch) patch(objects);
  return {
    objects,
    interactions: {},
    moodlets: {},
    traits: {},
    skills: {} as ContentRegistry['skills'],
    careers: {},
    aspirations: {},
    rewards: {},
    recipes: {},
    lifeEvents: [],
    names: { first: [], last: [], occupations: [] },
    stagesOf: () => [],
  };
}

export function blankLot(w = 30, d = 30): LotState {
  if (w === 30 && d === 30) return newLot();
  return {
    width: w,
    depth: d,
    buildable: { x0: 1, z0: 1, x1: w - 1, z1: d - 1 },
    sidewalkZ: -1,
    entryPoints: [{ x: 0.5, z: 0.5 }],
    walls: {},
    floors: new Array<string | null>(w * d).fill(null),
    version: 1,
    wallVersion: 1,
    floorVersion: 1,
  };
}

export function makeWorld(lot: LotState = blankLot(), funds = 100000): WorldState {
  return {
    schemaVersion: 1,
    seed: 1,
    rng: { a: 1, b: 2, c: 3, d: 4 },
    tick: 0,
    nextId: 1,
    household: { name: 'Test', funds, memberIds: [], bills: [], utilitiesOn: true, repoDispatchedDay: null, txLog: [] },
    lot,
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

export function bump(state: WorldState): void {
  state.lot.version++;
  state.lot.wallVersion++;
}

export function addObj(state: WorldState, defId: string, placement: ObjectPlacement, extra: Partial<ObjectState> = {}): ObjectState {
  const id = extra.id ?? `o${state.nextId++}`;
  const obj: ObjectState = {
    id,
    defId,
    placement,
    value: 0,
    purchasedTick: 0,
    tint: null,
    condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 },
    data: {},
    reservedBy: {},
    inUseBy: [],
    rev: 0,
    ...extra,
  };
  state.objects[id] = obj;
  if (placement.kind === 'opening') {
    const seg = state.lot.walls[placement.edge];
    if (seg) seg.openingId = id;
  }
  state.lot.version++;
  return obj;
}

export function addFloor(state: WorldState, defId: string, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0, extra: Partial<ObjectState> = {}): ObjectState {
  return addObj(state, defId, { kind: 'floor', x, z, rot }, extra);
}

export function addLoose(state: WorldState, defId: string, x: number, z: number, opts: { parentId?: string | null; surfaceIndex?: number | null; y?: number } = {}): ObjectState {
  return addObj(state, defId, {
    kind: 'loose',
    x,
    z,
    y: opts.y ?? 0,
    parentId: opts.parentId ?? null,
    surfaceIndex: opts.surfaceIndex ?? null,
    facing: 0,
  });
}

export function addWall(state: WorldState, edge: EdgeKey, paint: [string, string] = ['wall_plaster_bone', 'wall_plaster_bone']): void {
  state.lot.walls[edge] = { paint: [paint[0], paint[1]], openingId: null };
  state.lot.version++;
  state.lot.wallVersion++;
}

export function addWalls(state: WorldState, edges: EdgeKey[]): void {
  for (const e of edges) addWall(state, e);
}

export function addAgent(state: WorldState, id: string, x: number, z: number, extra: Partial<AgentState> = {}): AgentState {
  const a = {
    id,
    role: 'household',
    presence: 'onLot',
    firstName: id,
    lastName: 'Test',
    pos: { x, z },
    prevPos: { x, z },
    posY: 0,
    facing: 0,
    prevFacing: 0,
    path: null,
    pathIndex: 0,
    queue: [],
    active: null,
    ...extra,
  } as unknown as AgentState;
  state.agents[id] = a;
  return a;
}

export interface FakeCtx extends BuildContext {
  spatial: SpatialService;
  events: SimEvent[];
  interrupts: { agentId: string; reason?: string }[];
  ledger: { kind: 'spend' | 'earn'; amount: number; reason: string }[];
  /** Make the next N spawnObject calls throw. */
  failSpawns: number;
}

export function makeCtx(state: WorldState, content: ContentRegistry = makeContent()): FakeCtx {
  const spatial = createSpatial(() => state, content);
  const events: SimEvent[] = [];
  const interrupts: { agentId: string; reason?: string }[] = [];
  const ledger: { kind: 'spend' | 'earn'; amount: number; reason: string }[] = [];
  const ctx: FakeCtx = {
    get state() {
      return state;
    },
    content,
    spatial,
    events,
    interrupts,
    ledger,
    failSpawns: 0,
    spend(amount: number, reason: string) {
      if (!Number.isFinite(amount) || amount < 0) return false;
      if (state.household.funds < amount) return false;
      state.household.funds -= amount;
      ledger.push({ kind: 'spend', amount, reason });
      return true;
    },
    earn(amount: number, reason: string) {
      if (!Number.isFinite(amount) || amount <= 0) return;
      state.household.funds += amount;
      ledger.push({ kind: 'earn', amount, reason });
    },
    emit(e: SimEvent) {
      events.push(e);
    },
    spawnObject(defId, placement, opts) {
      if (ctx.failSpawns > 0) {
        ctx.failSpawns--;
        throw new Error('spawn failed (test)');
      }
      if (!content.objects[defId]) throw new Error(`unknown def ${defId}`);
      const id = `o${state.nextId++}`;
      const obj: ObjectState = {
        id,
        defId,
        placement: JSON.parse(JSON.stringify(placement)),
        value: opts && typeof opts.value === 'number' ? opts.value : 0,
        purchasedTick: state.tick,
        tint: opts && typeof opts.tint === 'string' ? opts.tint : null,
        condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 },
        data: opts && opts.data ? { ...opts.data } : {},
        reservedBy: {},
        inUseBy: [],
        rev: 0,
      };
      if (placement.kind === 'opening') {
        const seg = state.lot.walls[placement.edge];
        if (seg) seg.openingId = id;
      }
      state.objects[id] = obj;
      events.push({ type: 'objectAdded', objectId: id });
      return obj;
    },
    removeObject(id: string) {
      const obj = state.objects[id];
      if (!obj) return;
      for (const other of Object.values(state.objects)) {
        const p = other.placement;
        if (p.kind === 'loose' && p.parentId === id) other.placement = { ...p, y: 0, parentId: null, surfaceIndex: null };
      }
      if (obj.placement.kind === 'opening') {
        const seg = state.lot.walls[obj.placement.edge];
        if (seg && seg.openingId === id) seg.openingId = null;
      }
      delete state.objects[id];
      events.push({ type: 'objectRemoved', objectId: id });
    },
    interrupt(agent: AgentState, reason?: string) {
      interrupts.push({ agentId: agent.id, reason });
      agent.active = null;
    },
    placeItemNear(defId: string, near: Vec2, opts?: { data?: ObjectState['data'] }) {
      const surf = spatial.freeSurfaceNear(near, 3, null);
      let placement: ObjectPlacement;
      if (surf) placement = { kind: 'loose', x: surf.x, z: surf.z, y: surf.y, parentId: surf.objectId, surfaceIndex: surf.index, facing: 0 };
      else {
        const t = spatial.nearestWalkable(near, 6);
        if (!t) return null;
        placement = { kind: 'loose', x: t.x + 0.5, z: t.z + 0.5, y: 0, parentId: null, surfaceIndex: null, facing: 0 };
      }
      return ctx.spawnObject(defId, placement, { data: opts && opts.data ? opts.data : {} });
    },
    markChanged(obj: ObjectState) {
      obj.rev = (obj.rev || 0) + 1;
    },
  };
  return ctx;
}

/** World built from a lot template with objects spawned as o1..oN and openings linked. */
export function templateWorld(id: 'derelict' | 'starter' | 'empty', funds = 6500): WorldState {
  const t = createLotTemplate(id);
  const state = makeWorld(t.lot, funds);
  for (const o of t.objects) addObj(state, o.defId, o.placement, { tint: o.tint ?? null });
  return state;
}

/** Deterministic test RNG. */
export function testRng(seed = 7) {
  return createRng({ a: seed >>> 0 || 1, b: 0x9e3779b9, c: 0x85ebca6b, d: 0xc2b2ae35 });
}

/** Structural snapshot used to compare worlds (ignores rev counters and event-ish fields). */
export function structural(state: WorldState): unknown {
  const objects: Record<string, unknown> = {};
  for (const id of Object.keys(state.objects).sort()) {
    const o = state.objects[id];
    objects[id] = { defId: o.defId, placement: o.placement, value: o.value, tint: o.tint, data: o.data };
  }
  const walls: Record<string, unknown> = {};
  for (const k of Object.keys(state.lot.walls).sort()) walls[k] = state.lot.walls[k];
  return JSON.parse(JSON.stringify({ objects, walls, floors: state.lot.floors, funds: state.household.funds }));
}

// ───────────────────────────── engine-faithful fake context ─────────────────────────────

export interface EngineLikeCtx extends FakeCtx {
  /** Runs failed by ctx.removeObject (the engine shows `reason` to the player for player-sourced runs). */
  failures: { agentId: string; reason: string }[];
  /** Every ctx.removeObject call with the reason it was given. */
  removals: { id: string; reason: string | undefined }[];
}

/**
 * A BuildContext whose interrupt / removeObject follow the REAL engine's semantics (src/sim/engine/runner.ts):
 *  - interrupt() on a 'run'-phase agent defers: the run enters a short 'exit' phase and KEEPS its slot reservation;
 *  - interrupt() in any other phase finishes synchronously: the agent's reservations / in-use marks are swept, the
 *    run is cleared and `onEnd(agent)` (the behaviour's end() hook) runs — it may e.g. set a carried plate down;
 *  - removeObject() fails every run staged on the object (recording the player-facing reason), then deletes it.
 */
export function makeEngineLikeCtx(state: WorldState, content: ContentRegistry = makeContent(), onEnd?: (agent: AgentState, ctx: EngineLikeCtx) => void): EngineLikeCtx {
  const base = makeCtx(state, content);
  const ctx = base as EngineLikeCtx;
  ctx.failures = [];
  ctx.removals = [];
  const finish = (agent: AgentState, failedReason: string | null) => {
    if (!agent.active) return;
    for (const o of Object.values(state.objects)) {
      for (const [k, v] of Object.entries(o.reservedBy || {})) if (v === agent.id) delete o.reservedBy[k];
      if (Array.isArray(o.inUseBy)) o.inUseBy = o.inUseBy.filter((a) => a !== agent.id);
    }
    agent.active = null;
    if (failedReason !== null) ctx.failures.push({ agentId: agent.id, reason: failedReason });
    if (onEnd) onEnd(agent, ctx);
  };
  ctx.interrupt = (agent: AgentState, reason?: string) => {
    ctx.interrupts.push({ agentId: agent.id, reason });
    const run = agent.active;
    if (!run || run.phase === 'exit') return;
    if (run.phase === 'run') {
      run.phase = 'exit';
      return;
    }
    finish(agent, null);
  };
  const baseRemove = base.removeObject.bind(base);
  ctx.removeObject = (id: string, reason?: string) => {
    ctx.removals.push({ id, reason });
    for (const a of Object.values(state.agents)) {
      const r = a.active;
      if (r && r.stageTarget && r.stageTarget.kind === 'object' && r.stageTarget.id === id) finish(a, reason ?? 'The object is gone');
    }
    baseRemove(id, reason);
  };
  return ctx;
}

/** Minimal active run for fake agents (only the fields the build service / invariants read). */
export function fakeRun(phase: 'route' | 'wait' | 'run' | 'exit', objectId: string, slot: number | null): AgentState['active'] {
  return {
    uid: 1,
    interactionId: 'test_use',
    target: { kind: 'object', id: objectId },
    params: {},
    source: 'player',
    priority: 200,
    queuedTick: 0,
    phase,
    stage: 0,
    stageTarget: { kind: 'object', id: objectId },
    slot,
    routeGoal: null,
    pose: null,
    startedRunTick: null,
    elapsed: 0,
    duration: 10,
    partnerId: null,
    routeFails: 0,
    waitMinutes: 0,
    data: {},
    canceled: false,
  };
}

/**
 * Violations of the invariants the build service must preserve against a real engine:
 *  - every loose item resting on a live parent with a valid surfaceIndex sits exactly on that surface point;
 *  - no loose item rests on a missing parent;
 *  - every active run's slot is reserved by its runner (engine invariant), and no reservation is stale.
 */
export function buildInvariantViolations(state: WorldState, S: SpatialService): string[] {
  const out: string[] = [];
  for (const o of Object.values(state.objects)) {
    const p = o.placement;
    if (p.kind !== 'loose' || p.parentId === null) continue;
    const parent = state.objects[p.parentId];
    if (!parent) {
      out.push(`${o.id} rests on missing ${p.parentId}`);
      continue;
    }
    if (typeof p.surfaceIndex !== 'number') continue;
    const pt = S.surfacePoints(parent).find((q) => q.index === p.surfaceIndex);
    if (!pt) continue;
    if (Math.abs(pt.x - p.x) > 1e-6 || Math.abs(pt.z - p.z) > 1e-6) out.push(`${o.id} floats at ${p.x},${p.z}; surface ${p.surfaceIndex} of ${parent.id} is at ${pt.x},${pt.z}`);
  }
  for (const a of Object.values(state.agents)) {
    const r = a.active;
    if (!r || r.slot === null || !r.stageTarget || r.stageTarget.kind !== 'object') continue;
    const o = state.objects[r.stageTarget.id];
    if (o && o.reservedBy[String(r.slot)] !== a.id) out.push(`${a.id} run slot ${r.slot} on ${o.id} not reserved by it`);
  }
  for (const o of Object.values(state.objects)) {
    for (const [slot, who] of Object.entries(o.reservedBy || {})) {
      const a = state.agents[who];
      const r = a && a.active;
      if (!r || !r.stageTarget || r.stageTarget.kind !== 'object' || r.stageTarget.id !== o.id || String(r.slot) !== slot) out.push(`${o.id} slot ${slot} reservation by ${who} is stale`);
    }
  }
  return out;
}
