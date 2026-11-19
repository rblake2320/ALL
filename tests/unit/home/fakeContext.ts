/**
 * The FakeSim's SimContext: every member the home systems use, over a flat 30×30 lot (indoors = x<20 && z<20,
 * room 1), with engine-like money / moodlet / object / agent semantics (src/sim/engine/README.md).
 */
import type { NewAgentSpec, SimContext, SpatialAPI } from '../../../src/sim/contracts';
import type { AgentState, ObjectPlacement, ObjectState, QueueItem, Vec2 } from '../../../src/sim/types';
import { NEED_IDS, SKILL_IDS, TICK_MINUTES } from '../../../src/sim/types';
import { intactLimbs } from '../../../src/shared/appearance';
import type { FakeHost } from './fakeCtx';

export function buildFakeContext(sim: FakeHost): SimContext {
  const s = sim.state;
  const def = (o: ObjectState | string) => {
    const id = typeof o === 'string' ? o : o.defId;
    const d = sim.content.objects[id];
    if (!d) throw new Error(`unknown object def ${id}`);
    return d;
  };
  const center = (o: ObjectState): Vec2 => {
    const p = o.placement;
    if (p.kind === 'loose') return { x: p.x, z: p.z };
    if (p.kind === 'held') {
      const a = s.agents[p.agentId];
      return a ? { ...a.pos } : { x: 0, z: 0 };
    }
    if (p.kind === 'floor') {
      const d = def(o);
      const w = p.rot % 2 === 0 ? d.footprint.w : d.footprint.d;
      const dd = p.rot % 2 === 0 ? d.footprint.d : d.footprint.w;
      return { x: p.x + w / 2, z: p.z + dd / 2 };
    }
    const m = /^[hv]:(-?\d+):(-?\d+)$/.exec(p.edge);
    return m ? { x: Number(m[1]) + 0.5, z: Number(m[2]) + 0.5 } : { x: 0, z: 0 };
  };
  const tilesOf = (o: ObjectState) => {
    const p = o.placement;
    if (p.kind !== 'floor') {
      const c = center(o);
      return [{ x: Math.floor(c.x), z: Math.floor(c.z) }];
    }
    const d = def(o);
    const w = p.rot % 2 === 0 ? d.footprint.w : d.footprint.d;
    const dd = p.rot % 2 === 0 ? d.footprint.d : d.footprint.w;
    const out: { x: number; z: number }[] = [];
    for (let x = 0; x < w; x++) for (let z = 0; z < dd; z++) out.push({ x: p.x + x, z: p.z + z });
    return out;
  };
  const indoor = (x: number, z: number) => x < 20 && z < 20;
  const spatial = {
    width: () => s.lot.width,
    depth: () => s.lot.depth,
    inBounds: (x: number, z: number) => x >= 0 && z >= 0 && x < s.lot.width && z < s.lot.depth,
    isBuildable: () => true,
    tileIndex: (x: number, z: number) => z * s.lot.width + x,
    tileOf: (p: Vec2) => ({ x: Math.floor(p.x), z: Math.floor(p.z) }),
    isWalkable: () => true,
    canStep: () => true,
    roomAt: (x: number, z: number) => (indoor(x, z) ? 1 : 0),
    rooms: () => [{ id: 1, indoor: true, tiles: [] }],
    isIndoor: (x: number, z: number) => indoor(x, z),
    distanceField: () => {
      throw new Error('not in fake');
    },
    findPath: () => null,
    nearestWalkable: (p: Vec2) => ({ x: Math.max(0, Math.min(s.lot.width - 1, Math.floor(p.x))), z: Math.max(0, Math.min(s.lot.depth - 1, Math.floor(p.z))) }),
    objectTiles: (o: ObjectState) => tilesOf(o),
    objectsAt: (x: number, z: number) =>
      Object.values(s.objects)
        .filter((o) => o.placement.kind === 'floor' && tilesOf(o).some((t) => t.x === x && t.z === z))
        .map((o) => o.id),
    resolveSlots: () => [],
    surfacePoints: (o: ObjectState) => {
      const d = def(o);
      const p = o.placement;
      if (p.kind !== 'floor') return [];
      return (d.surfaces ?? []).map((sf, index) => ({ index, x: p.x + sf.x, y: sf.y, z: p.z + sf.z }));
    },
    freeSurfaceNear: (p: Vec2, maxDist: number, prefer?: string | null) => {
      let best: { objectId: string; index: number; x: number; y: number; z: number } | null = null;
      let bestD = Infinity;
      for (const o of Object.values(s.objects)) {
        for (const sp of spatial.surfacePoints(o)) {
          const taken = Object.values(s.objects).some((it) => it.placement.kind === 'loose' && it.placement.parentId === o.id && it.placement.surfaceIndex === sp.index);
          if (taken) continue;
          const dd = Math.hypot(sp.x - p.x, sp.z - p.z) - (prefer && o.id === prefer ? 100 : 0);
          if (dd > maxDist && !(prefer && o.id === prefer)) continue;
          if (dd < bestD) {
            bestD = dd;
            best = { objectId: o.id, index: sp.index, x: sp.x, y: sp.y, z: sp.z };
          }
        }
      }
      return best;
    },
    objectCenter: (o: ObjectState) => center(o),
    roomEnvironment: () => sim.env,
    checkPlace: () => ({ ok: false, tiles: [], blockedSlots: [], cost: 0 }),
    checkWallItem: () => ({ ok: false, tiles: [], blockedSlots: [], cost: 0 }),
    checkOpening: () => ({ ok: false, tiles: [], blockedSlots: [], cost: 0 }),
    invalidate: () => undefined,
  } as unknown as SpatialAPI;

  const traitDefs = (a: AgentState) => [...(a.traits ?? []), ...(a.rewardTraits ?? [])].map((t) => sim.content.traits[t]).filter(Boolean);

  const ctx: SimContext = {
    get state() {
      return s;
    },
    get content() {
      return sim.content;
    },
    get rng() {
      return sim.rng;
    },
    spatial,
    get time() {
      return sim.time;
    },
    emit(e) {
      sim.events.push(e);
    },
    notify(n) {
      const id = ctx.newUid();
      s.notifications.push({ id, tick: s.tick, kind: n.kind, title: n.title, text: n.text, agentId: n.agentId ?? null, objectId: n.objectId ?? null, read: false });
      sim.events.push({ type: 'notify', id });
    },
    newId(prefix) {
      return `${prefix}${s.nextId++}`;
    },
    newUid() {
      return s.nextId++;
    },
    agent: (id) => s.agents[id],
    object: (id) => s.objects[id],
    objectDef: (o) => def(o),
    householdMembers: () => s.household.memberIds.map((id) => s.agents[id]).filter(Boolean),
    agentsOnLot: () => Object.values(s.agents).filter((a) => a.presence === 'onLot'),
    // W-025 S1: home-only fake (every agent / the only lot is the home region)
    regionOf: (id: string) => (s.agents[id] ? s.agents[id].regionId ?? 'wormwood:mildew_n2' : null),
    lotOf: (regionId: string) => (regionId === 'wormwood:mildew_n2' ? s.lot : null),
    homeRegionId: () => 'wormwood:mildew_n2',
    isHousehold: (a) => s.household.memberIds.includes(a.id),
    isVisitor: (a) => a.role === 'townie' && a.presence === 'onLot',
    changeNeed(a, need, delta, opts) {
      if (!Number.isFinite(delta) || !a.needs) return 0;
      const cap = ctx.needCap(a, need);
      const cur = Number.isFinite(a.needs[need]) ? Math.max(0, Math.min(cap, a.needs[need])) : Math.min(50, cap);
      let d = delta;
      if (!opts?.raw && d !== 0) {
        for (const t of traitDefs(a)) {
          const m = (d > 0 ? t.needGain : t.needDecay)?.[need];
          if (typeof m === 'number' && m >= 0) d *= m;
        }
      }
      const next = Math.max(0, Math.min(cap, cur + d));
      a.needs[need] = next;
      return next - cur;
    },
    needCap: (a, need) => (need === 'preservation' ? Math.max(0, Math.min(100, a.vitality)) : 100),
    addMoodlet(a, id, opts) {
      const md = sim.content.moodlets[id];
      if (!md) throw new Error(`unknown moodlet ${id}`);
      const dur = opts?.durationMin ?? md.durationMin;
      const endTick = dur === null ? null : s.tick + Math.max(1, Math.round(dur / TICK_MINUTES));
      const ex = a.moodlets.find((m) => m.id === id);
      if (ex) {
        ex.stacks = Math.min(md.maxStacks, ex.stacks + 1);
        ex.endTick = ex.endTick === null || endTick === null ? null : Math.max(ex.endTick, endTick);
        return;
      }
      a.moodlets.push({ id, startTick: s.tick, endTick, stacks: 1, sourceId: opts?.sourceId ?? null });
    },
    removeMoodlet(a, id) {
      a.moodlets = a.moodlets.filter((m) => m.id !== id);
    },
    hasMoodlet: (a, id) => a.moodlets.some((m) => m.id === id),
    addXp(a, skill, xp) {
      if (!Number.isFinite(xp) || xp <= 0) return;
      let mult = 1;
      for (const t of traitDefs(a)) mult *= t.skillGain?.[skill] ?? 1;
      const sk = a.skills[skill];
      sk.xp += xp * mult;
      const table = sim.content.skills[skill]?.xpPerLevel ?? [100, 150, 220, 300, 400, 520, 660, 820, 1000, 1200];
      while (sk.level < 10 && sk.xp >= table[sk.level]) {
        sk.xp -= table[sk.level];
        sk.level++;
        sim.events.push({ type: 'skillUp', agentId: a.id, skill, level: sk.level });
      }
    },
    skillLevel: (a, skill) => a.skills?.[skill]?.level ?? 0,
    mood: (a) => a.moodlets.reduce((n, m) => n + (sim.content.moodlets[m.id]?.mood ?? 0) * m.stacks, 0),
    hasTrait: (a, t) => (a.traits ?? []).includes(t) || (a.rewardTraits ?? []).includes(t),
    traitMult(a, key) {
      let m = 1;
      for (const t of traitDefs(a)) {
        const v = t.mult?.[key];
        if (typeof v === 'number' && v >= 0) m *= v;
      }
      return m;
    },
    limbCount: (a, kind) => {
      const l = a.limbs ?? intactLimbs();
      return kind === 'arm' ? (l.armL !== 'missing' ? 1 : 0) + (l.armR !== 'missing' ? 1 : 0) : (l.legL !== 'missing' ? 1 : 0) + (l.legR !== 'missing' ? 1 : 0);
    },
    spend(amount, reason, key) {
      if (!Number.isFinite(amount) || amount < 0) return false;
      const amt = Math.round(amount);
      if (key && s.household.txLog.includes(key)) return true;
      if (s.household.funds < amt) return false;
      s.household.funds -= amt;
      if (key) s.household.txLog.push(key);
      sim.events.push({ type: 'funds', delta: -amt, reason });
      return true;
    },
    earn(amount, reason, key) {
      if (!Number.isFinite(amount) || amount < 0) return;
      if (key && s.household.txLog.includes(key)) return;
      s.household.funds += Math.round(amount);
      if (key) s.household.txLog.push(key);
      sim.events.push({ type: 'funds', delta: Math.round(amount), reason });
    },
    queue(a, item) {
      if (!sim.content.interactions[item.interactionId] || a.presence !== 'onLot') return null;
      const qi: QueueItem = {
        uid: ctx.newUid(),
        interactionId: item.interactionId,
        target: item.target,
        params: item.params ?? {},
        source: item.source,
        priority: item.priority ?? (item.source === 'system' ? 300 : item.source === 'player' ? 200 : 100),
        queuedTick: s.tick,
      };
      if (item.front) a.queue.unshift(qi);
      else a.queue.push(qi);
      return qi;
    },
    cancel(a, uid) {
      a.queue = a.queue.filter((q) => q.uid !== uid);
      if (a.active && a.active.uid === uid) sim.finish(a, 'canceled', 'Canceled');
    },
    failRun(a, reason) {
    sim.failures.push({ agentId: a.id, reason });
    if (a.active) sim.finish(a, 'failed', reason);
  },
  interrupt(a, reason) {
      sim.interrupts.push({ agentId: a.id, reason: reason ?? '' });
      if (a.active) sim.finish(a, 'canceled', reason ?? 'Interrupted');
    },
    isBusy: (a) => !!a.active || a.queue.length > 0,
    spawnObject(defId, placement, opts) {
      const d = def(defId);
      const id = ctx.newId('o');
      const data: ObjectState['data'] = {};
      for (const [k, v] of Object.entries(opts?.data ?? {})) if (v === null || ['string', 'boolean'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v))) data[k] = v;
      const o: ObjectState = {
        id,
        defId: d.id,
        placement: { ...placement } as ObjectPlacement,
        value: opts?.value ?? 0,
        purchasedTick: s.tick,
        tint: null,
        condition: { broken: false, dirt: 0, burning: false, burnMinutes: 0 },
        data,
        reservedBy: {},
        inUseBy: [],
        rev: 0,
      };
      s.objects[id] = o;
      if (placement.kind === 'held') {
        const h = s.agents[placement.agentId];
        if (h) h.carryObjectId = id;
      }
      sim.events.push({ type: 'objectAdded', objectId: id });
      return o;
    },
    removeObject(id) {
      const o = s.objects[id];
      if (!o) return;
      for (const a of Object.values(s.agents)) {
        a.queue = a.queue.filter((q) => !(q.target.kind === 'object' && q.target.id === id));
        if (a.carryObjectId === id) {
          a.carryObjectId = null;
          a.carrying = null;
        }
        const run = a.active;
        if (run && !sim.finishing.has(run.uid) && ((run.stageTarget.kind === 'object' && run.stageTarget.id === id) || run.data._uo === id)) sim.finish(a, 'failed', 'gone');
      }
      for (const other of Object.values(s.objects)) {
        const p = other.placement;
        if (p.kind === 'loose' && p.parentId === id) other.placement = { ...p, y: 0, parentId: null, surfaceIndex: null };
      }
      delete s.objects[id];
      sim.events.push({ type: 'objectRemoved', objectId: id });
    },
    markChanged(o) {
      o.rev = (o.rev ?? 0) + 1;
    },
    placeItemNear(defId, near, opts) {
      if (!sim.content.objects[defId]) return null;
      const surf = spatial.freeSurfaceNear(near, 3, opts?.preferSurfaceOf ?? null);
      if (surf) return ctx.spawnObject(defId, { kind: 'loose', x: surf.x, z: surf.z, y: surf.y, parentId: surf.objectId, surfaceIndex: surf.index, facing: 0 }, { data: opts?.data });
      if (opts?.surfaceOnly) return null;
      return ctx.spawnObject(defId, { kind: 'loose', x: near.x, z: near.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 }, { data: opts?.data });
    },
    holdItem(a, o) {
      if (a.carryObjectId && a.carryObjectId !== o.id) ctx.releaseHeld(a, 'floor');
      o.placement = { kind: 'held', agentId: a.id };
      a.carryObjectId = o.id;
      const tags = def(o).tags;
      a.carrying = tags.includes('pizza') ? 'pizza' : tags.includes('meal') ? 'plate' : tags.includes('dish') ? 'dish' : tags.includes('limb') ? 'limb' : a.carrying;
    },
    releaseHeld(a, to) {
      const o = a.carryObjectId ? s.objects[a.carryObjectId] : undefined;
      a.carryObjectId = null;
      a.carrying = null;
      if (!o) return null;
      if (to === 'destroy') {
        ctx.removeObject(o.id);
        return null;
      }
      o.placement = { kind: 'loose', x: a.pos.x, z: a.pos.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 };
      return o;
    },
    spawnAgent(id, at) {
      const a = s.agents[id];
      if (!a || a.presence === 'onLot') return;
      a.presence = 'onLot';
      a.pos = at ? { ...at } : { ...s.lot.entryPoints[0] };
      a.active = null;
      sim.events.push({ type: 'agentSpawned', agentId: id });
      for (const sys of sim.systems) sys.agentArrived?.(ctx, a);
    },
    despawnAgent(id, presence) {
      const a = s.agents[id];
      if (!a) return;
      if (a.active) sim.finish(a, 'canceled', 'Left the lot');
      a.queue = [];
      if (a.carryObjectId) ctx.releaseHeld(a, 'floor');
      const was = a.presence === 'onLot';
      a.presence = presence === 'onLot' ? 'offLot' : presence;
      if (was) {
        sim.events.push({ type: 'agentDespawned', agentId: id });
        for (const sys of sim.systems) sys.agentLeft?.(ctx, a);
      }
    },
    createAgent(spec: NewAgentSpec) {
      const id = ctx.newId('a');
      const needs = {} as AgentState['needs'];
      for (const n of NEED_IDS) needs[n] = spec.needs?.[n] ?? (n === 'preservation' ? 100 : 80);
      const skills = {} as AgentState['skills'];
      for (const k of SKILL_IDS) skills[k] = { level: spec.skills?.[k] ?? 0, xp: 0 };
      const a: AgentState = {
        id,
        role: spec.role,
        presence: spec.presence,
        firstName: spec.firstName,
        lastName: spec.lastName,
        appearance: spec.appearance,
        traits: [...spec.traits],
        rewardTraits: [],
        aspiration: spec.aspiration ?? null,
        aspirationMilestones: [],
        aspirationPoints: 0,
        needs,
        vitality: 100,
        moodlets: [],
        skills,
        career: null,
        limbs: intactLimbs(),
        pos: { ...s.lot.entryPoints[0] },
        prevPos: { ...s.lot.entryPoints[0] },
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
        createdTick: s.tick,
        occupation: spec.occupation ?? null,
      };
      s.agents[id] = a;
      if (spec.role === 'household') s.household.memberIds.push(id);
      return a;
    },
    sendOffLot(a, presence, reason) {
      sim.sentOffLot.push({ agentId: a.id, presence, reason });
      ctx.despawnAgent(a.id, presence);
    },
    rel(a, b) {
      const [x, y] = a < b ? [a, b] : [b, a];
      const key = `${x}|${y}`;
      s.relationships[key] ??= { a: x, b: y, friendship: 0, romance: 0, met: false, partners: false, engaged: false, married: false, bestFriends: false, lastInteractionTick: 0, interactions: 0 };
      return s.relationships[key];
    },
    stat(key, amount = 1, agentId = null) {
      if (agentId) {
        s.stats.agent[agentId] ??= {};
        s.stats.agent[agentId][key] = (s.stats.agent[agentId][key] ?? 0) + amount;
      } else s.stats.counters[key] = (s.stats.counters[key] ?? 0) + amount;
    },
    statValue: (key, agentId = null) => (agentId ? s.stats.agent[agentId]?.[key] ?? 0 : s.stats.counters[key] ?? 0),
    runEffect(ref, ec) {
      const fn = sim.effects[ref.id];
      if (!fn) throw new Error(`unknown effect ${ref.id}`);
      fn(ctx, ec, (ref.params ?? {}) as Record<string, any>);
    },
    checkRequirement(ref, rc) {
      const fn = sim.requirements[ref.id];
      if (!fn) return 'Something went wrong';
      return fn(ctx, rc, (ref.params ?? {}) as Record<string, any>);
    },
    evalCondition(cond, a) {
      const fn = sim.conditions[cond.kind];
      return fn ? !!fn(ctx, a, cond.params ?? {}) : false;
    },
    offerChoice(choice) {
      const id = `c${ctx.newUid()}`;
      s.choices.push({ ...choice, id, tick: s.tick });
      return id;
    },
    powered(o) {
      if (o) {
        const d = sim.content.objects[o.defId];
        if (d && !d.needsPower) return true;
        if (o.condition?.broken) return false;
      }
      return !!s.household.utilitiesOn;
    },
    sys(id) {
      const extra = sim.extraApis[id];
      if (extra) return extra;
      const sys = sim.systems.find((x) => x.id === id);
      return sys?.api ?? {};
    },
  };
  return ctx;
}
