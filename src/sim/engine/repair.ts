/**
 * repairWorld — makes any parsed save structurally valid before the engine touches it (README §12).
 * Mutates in place and returns player/debug-readable warnings. Never throws for object-shaped input.
 */
import type { ContentRegistry, SpatialAPI } from '../contracts';
import type {
  ActiveInteraction,
  AgentState,
  Bill,
  CareerState,
  LotState,
  Notification,
  ObjectState,
  QueueItem,
  Relationship,
  WorldState,
} from '../types';
import { NEED_IDS, SAVE_SCHEMA_VERSION, SKILL_IDS, SKILL_MAX_LEVEL } from '../types';
import { seedRngState } from '../rng';
import { ANIM_STATES, CARRY_ITEMS, EXPRESSIONS } from '../../shared/appearance';
import { defaultStatus, isPresence, sanitizeAppearance, sanitizeLimbs } from './agents';
import { HARD_QUEUE_CAP, MAX_NOTIFICATIONS, MAX_TXLOG } from './constants';
import { sanitizeHouseholdName } from './commands';
import { clamp, cleanParams, idNumber, isNum, isTargetRef, tileCenter } from './util';
import { homeRegionIdOf } from '../../shared/town';

const PHASES = new Set(['route', 'wait', 'run', 'exit']);
const ROLES = new Set(['household', 'townie', 'service']);
const ANIMS = new Set<string>(ANIM_STATES);
const EXPR = new Set<string>(EXPRESSIONS);
const CARRY = new Set<string>(CARRY_ITEMS);
const SHIFT = new Set(['none', 'pending', 'atWork', 'done', 'missed', 'sick']);
const NOTIFY = new Set(['info', 'good', 'bad', 'warning', 'money', 'career', 'social', 'decay', 'romance', 'skill']);
/** GDD §17: a household has 1–8 members. */
const MAX_HOUSEHOLD = 8;

function obj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function jsonScalar(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}
function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const s of v) if (typeof s === 'string' && s && !out.includes(s)) out.push(s);
  return out;
}

export function defaultLot(): LotState {
  const width = 30;
  const depth = 30;
  return {
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
  };
}

function repairLot(raw: unknown, w: string[], factory?: () => LotState): LotState {
  if (!obj(raw) || !isNum(raw.width) || !isNum(raw.depth) || raw.width < 4 || raw.depth < 4 || raw.width > 256 || raw.depth > 256) {
    w.push('lot was missing or invalid; replaced with an empty lot');
    return factory ? factory() : defaultLot();
  }
  const lot = raw as LotState;
  lot.width = Math.floor(lot.width);
  lot.depth = Math.floor(lot.depth);
  const b = obj(lot.buildable) ? lot.buildable : null;
  if (!b || ![b.x0, b.z0, b.x1, b.z1].every(isNum)) {
    lot.buildable = { x0: 1, z0: 1, x1: lot.width - 1, z1: Math.max(1, lot.depth - 3) };
    w.push('lot.buildable repaired');
  }
  if (!isNum(lot.sidewalkZ)) lot.sidewalkZ = lot.depth - 2;
  if (!Array.isArray(lot.entryPoints)) lot.entryPoints = [];
  lot.entryPoints = lot.entryPoints.filter((p) => obj(p) && isNum(p.x) && isNum(p.z));
  if (lot.entryPoints.length === 0) {
    lot.entryPoints = [
      { x: 0.5, z: lot.sidewalkZ + 0.5 },
      { x: lot.width - 0.5, z: lot.sidewalkZ + 0.5 },
    ];
    w.push('lot.entryPoints repaired');
  }
  if (!obj(lot.walls)) {
    lot.walls = {};
    w.push('lot.walls repaired');
  }
  for (const [k, seg] of Object.entries(lot.walls)) {
    if (!obj(seg) || !Array.isArray(seg.paint) || seg.paint.length !== 2) {
      delete lot.walls[k];
      w.push(`wall ${k} removed (invalid)`);
      continue;
    }
    if (seg.openingId !== null && typeof seg.openingId !== 'string') seg.openingId = null;
  }
  const n = lot.width * lot.depth;
  if (!Array.isArray(lot.floors) || lot.floors.length !== n) {
    const old = Array.isArray(lot.floors) ? lot.floors : [];
    lot.floors = new Array(n).fill(null).map((_, i) => (typeof old[i] === 'string' ? old[i] : null));
    w.push('lot.floors resized');
  } else {
    for (let i = 0; i < n; i++) if (lot.floors[i] !== null && typeof lot.floors[i] !== 'string') lot.floors[i] = null;
  }
  for (const k of ['version', 'wallVersion', 'floorVersion'] as const) if (!isNum(lot[k]) || lot[k] < 0) lot[k] = 1;
  return lot;
}

function repairQueueItem(q: unknown, reg: ContentRegistry): QueueItem | null {
  if (!obj(q) || typeof q.interactionId !== 'string' || !reg.interactions[q.interactionId] || !isTargetRef(q.target)) return null;
  const source = q.source === 'player' || q.source === 'system' || q.source === 'auto' ? q.source : 'auto';
  return {
    uid: isNum(q.uid) ? Math.floor(q.uid) : -1,
    interactionId: q.interactionId,
    target: { ...q.target },
    params: cleanParams(q.params),
    source,
    priority: isNum(q.priority) ? q.priority : 100,
    queuedTick: isNum(q.queuedTick) ? q.queuedTick : 0,
  };
}

function repairActive(r: unknown, reg: ContentRegistry, s: WorldState): ActiveInteraction | null {
  const base = repairQueueItem(r, reg);
  if (!base || !obj(r)) return null;
  if (!PHASES.has(r.phase) || !isTargetRef(r.stageTarget)) return null;
  const stages = reg.stagesOf(base.interactionId);
  if (!isNum(r.stage) || r.stage < 0 || r.stage >= stages.length) return null;
  if (r.stageTarget.kind === 'object' && !s.objects[r.stageTarget.id]) return null;
  const data: ActiveInteraction['data'] = {};
  if (obj(r.data)) for (const [k, v] of Object.entries(r.data)) if (jsonScalar(v)) data[k] = v;
  const pose = obj(r.pose) && [r.pose.x, r.pose.z, r.pose.y, r.pose.facing].every(isNum) ? { x: r.pose.x, z: r.pose.z, y: r.pose.y, facing: r.pose.facing } : null;
  const goal = obj(r.routeGoal) && isNum(r.routeGoal.x) && isNum(r.routeGoal.z) ? { x: Math.floor(r.routeGoal.x), z: Math.floor(r.routeGoal.z) } : null;
  return {
    ...base,
    phase: r.phase,
    stage: Math.floor(r.stage),
    stageTarget: { ...r.stageTarget },
    slot: isNum(r.slot) ? Math.floor(r.slot) : null,
    routeGoal: goal,
    pose,
    startedRunTick: isNum(r.startedRunTick) ? r.startedRunTick : null,
    elapsed: isNum(r.elapsed) && r.elapsed >= 0 ? r.elapsed : 0,
    duration: isNum(r.duration) && r.duration >= 0 ? r.duration : 0,
    partnerId: typeof r.partnerId === 'string' && s.agents[r.partnerId] ? r.partnerId : null,
    routeFails: isNum(r.routeFails) ? clamp(Math.floor(r.routeFails), 0, 10) : 0,
    waitMinutes: isNum(r.waitMinutes) && r.waitMinutes >= 0 ? r.waitMinutes : 0,
    data,
    canceled: r.canceled === true,
  };
}

function repairCareer(c: unknown, reg: ContentRegistry): CareerState | null {
  if (!obj(c) || typeof c.trackId !== 'string') return null;
  if (Object.keys(reg.careers).length > 0 && !reg.careers[c.trackId]) return null;
  const maxLevel = reg.careers[c.trackId]?.levels.length ?? 5;
  return {
    trackId: c.trackId,
    level: isNum(c.level) ? clamp(Math.floor(c.level), 1, Math.max(1, maxLevel)) : 1,
    performance: isNum(c.performance) ? clamp(c.performance, -100, 100) : 0,
    daysAtLevel: isNum(c.daysAtLevel) ? Math.max(0, c.daysAtLevel) : 0,
    missedStreak: isNum(c.missedStreak) ? Math.max(0, Math.floor(c.missedStreak)) : 0,
    lastShiftDay: isNum(c.lastShiftDay) ? c.lastShiftDay : -1,
    shiftStatus: SHIFT.has(c.shiftStatus) ? c.shiftStatus : 'none',
    shiftStartTick: isNum(c.shiftStartTick) ? c.shiftStartTick : null,
    moodSum: isNum(c.moodSum) ? c.moodSum : 0,
    moodSamples: isNum(c.moodSamples) ? Math.max(0, c.moodSamples) : 0,
    sickDaysUsed: isNum(c.sickDaysUsed) ? Math.max(0, c.sickDaysUsed) : 0,
  };
}

function repairAgent(key: string, a: Record<string, any>, reg: ContentRegistry, s: WorldState, w: string[]): AgentState {
  if (a.id !== key) {
    w.push(`agent ${String(a.id)} re-keyed as ${key}`);
    a.id = key;
  }
  if (!ROLES.has(a.role)) a.role = 'townie';
  if (!isPresence(a.presence)) a.presence = 'offLot';
  a.firstName = typeof a.firstName === 'string' && a.firstName.trim() ? a.firstName.slice(0, 40) : 'Nameless';
  a.lastName = typeof a.lastName === 'string' ? a.lastName.slice(0, 40) : '';
  a.appearance = sanitizeAppearance(a.appearance);
  const knownTraits = Object.keys(reg.traits).length > 0;
  a.traits = strArr(a.traits).filter((t) => !knownTraits || reg.traits[t]);
  a.rewardTraits = strArr(a.rewardTraits).filter((t) => !knownTraits || reg.traits[t]);
  if (typeof a.aspiration !== 'string' || (Object.keys(reg.aspirations).length > 0 && !reg.aspirations[a.aspiration])) a.aspiration = null;
  a.aspirationMilestones = strArr(a.aspirationMilestones);
  a.aspirationPoints = isNum(a.aspirationPoints) ? Math.max(0, Math.round(a.aspirationPoints)) : 0;
  if (!isNum(a.vitality)) {
    a.vitality = 100;
    w.push(`${key}.vitality reset`);
  }
  a.vitality = clamp(a.vitality, 20, 100);
  if (!obj(a.needs)) a.needs = {};
  for (const n of NEED_IDS) {
    const cap = n === 'preservation' ? a.vitality : 100;
    const v = a.needs[n];
    if (!isNum(v)) {
      a.needs[n] = Math.min(70, cap);
      w.push(`${key}.${n} was ${String(v)}; reset`);
    } else if (v < 0 || v > cap) a.needs[n] = clamp(v, 0, cap);
  }
  const tick = s.tick;
  a.moodlets = (Array.isArray(a.moodlets) ? a.moodlets : [])
    .filter((m: unknown) => obj(m) && typeof m.id === 'string' && !!reg.moodlets[m.id])
    .map((m: Record<string, any>) => {
      const def = reg.moodlets[m.id];
      return {
        id: m.id,
        startTick: isNum(m.startTick) ? m.startTick : tick,
        endTick: isNum(m.endTick) ? m.endTick : m.endTick === null ? null : tick + 1,
        stacks: clamp(isNum(m.stacks) ? Math.floor(m.stacks) : 1, 1, Math.max(1, def.maxStacks)),
        sourceId: typeof m.sourceId === 'string' ? m.sourceId : null,
      };
    });
  const seenM = new Set<string>();
  a.moodlets = a.moodlets.filter((m: { id: string }) => (seenM.has(m.id) ? false : (seenM.add(m.id), true)));
  if (!obj(a.skills)) a.skills = {};
  for (const sk of SKILL_IDS) {
    const st = a.skills[sk];
    a.skills[sk] = {
      level: obj(st) && isNum(st.level) ? clamp(Math.floor(st.level), 0, SKILL_MAX_LEVEL) : 0,
      xp: obj(st) && isNum(st.xp) && st.xp >= 0 ? st.xp : 0,
    };
  }
  a.career = repairCareer(a.career, reg);
  a.limbs = sanitizeLimbs(a.limbs);
  const fallbackPos = s.lot.entryPoints[0] ?? { x: 0.5, z: 0.5 };
  if (!obj(a.pos) || !isNum(a.pos.x) || !isNum(a.pos.z)) {
    a.pos = { x: fallbackPos.x, z: fallbackPos.z };
    if (a.presence === 'onLot') w.push(`${key} position reset`);
  }
  if (!obj(a.prevPos) || !isNum(a.prevPos.x) || !isNum(a.prevPos.z)) a.prevPos = { x: a.pos.x, z: a.pos.z };
  if (!isNum(a.posY) || a.posY < 0 || a.posY > 3) a.posY = 0;
  if (!isNum(a.facing)) a.facing = 0;
  if (!isNum(a.prevFacing)) a.prevFacing = a.facing;
  a.path = Array.isArray(a.path) && a.path.every((p: unknown) => obj(p) && isNum(p.x) && isNum(p.z)) ? a.path : null;
  a.pathIndex = isNum(a.pathIndex) && a.pathIndex >= 0 ? Math.floor(a.pathIndex) : 0;
  a.queue = (Array.isArray(a.queue) ? a.queue : []).map((q: unknown) => repairQueueItem(q, reg)).filter((q: QueueItem | null): q is QueueItem => !!q).slice(0, HARD_QUEUE_CAP);
  a.active = a.active ? repairActive(a.active, reg, s) : null;
  if (!ANIMS.has(a.anim)) a.anim = 'idle';
  if (!EXPR.has(a.expression)) a.expression = 'neutral';
  if (a.carrying !== null && !CARRY.has(a.carrying)) a.carrying = null;
  if (typeof a.carryObjectId !== 'string') a.carryObjectId = null;
  const st = obj(a.status) ? a.status : {};
  const d = defaultStatus();
  a.status = {
    zeroPreservationMinutes: isNum(st.zeroPreservationMinutes) && st.zeroPreservationMinutes >= 0 ? st.zeroPreservationMinutes : d.zeroPreservationMinutes,
    passedOut: st.passedOut === true,
    feral: st.feral === true,
    autonomyCooldownUntil: isNum(st.autonomyCooldownUntil) ? st.autonomyCooldownUntil : 0,
    lastSocialTick: isNum(st.lastSocialTick) ? st.lastSocialTick : 0,
    autonomyFails: isNum(st.autonomyFails) ? clamp(Math.floor(st.autonomyFails), 0, 20) : 0,
    bonePileId: typeof st.bonePileId === 'string' ? st.bonePileId : null,
    crumbledTick: isNum(st.crumbledTick) ? st.crumbledTick : null,
  };
  if (!obj(a.visit) || !isNum(a.visit.arrivedTick) || !isNum(a.visit.leaveTick)) a.visit = null;
  else {
    a.visit.welcomed = a.visit.welcomed === true;
    a.visit.leaving = a.visit.leaving === true;
    if (typeof a.visit.reason !== 'string') a.visit.reason = 'dropIn';
  }
  if (!obj(a.walkBy) || !obj(a.walkBy.from) || !obj(a.walkBy.to) || ![a.walkBy.from.x, a.walkBy.from.z, a.walkBy.to.x, a.walkBy.to.z].every(isNum)) a.walkBy = null;
  if (!isNum(a.voiceSeed)) a.voiceSeed = 1;
  if (!isNum(a.createdTick)) a.createdTick = 0;
  if (a.occupation !== null && typeof a.occupation !== 'string') a.occupation = null;
  if (a.presence !== 'onLot') {
    a.active = null;
    a.path = null;
    a.queue = [];
    a.posY = 0;
  }
  return a as AgentState;
}

function repairObject(key: string, o: Record<string, any>, reg: ContentRegistry, s: WorldState, w: string[]): ObjectState | null {
  if (typeof o.defId !== 'string' || !reg.objects[o.defId]) {
    w.push(`object ${key} (${String(o.defId)}) removed: unknown object`);
    return null;
  }
  o.id = key;
  const p = o.placement;
  let okPlacement = false;
  if (obj(p)) {
    switch (p.kind) {
      case 'floor':
        okPlacement = isNum(p.x) && isNum(p.z) && [0, 1, 2, 3].includes(p.rot);
        if (okPlacement) {
          p.x = Math.floor(p.x);
          p.z = Math.floor(p.z);
        }
        break;
      case 'wall':
        okPlacement = typeof p.edge === 'string' && (p.side === 0 || p.side === 1);
        break;
      case 'opening':
        okPlacement = typeof p.edge === 'string';
        break;
      case 'loose':
        okPlacement = isNum(p.x) && isNum(p.z);
        if (okPlacement) {
          if (!isNum(p.y)) p.y = 0;
          if (!isNum(p.facing)) p.facing = 0;
          if (p.parentId !== null && typeof p.parentId !== 'string') p.parentId = null;
          if (!isNum(p.surfaceIndex)) p.surfaceIndex = null;
        }
        break;
      case 'held':
        okPlacement = typeof p.agentId === 'string';
        break;
    }
  }
  if (!okPlacement) {
    w.push(`object ${key} removed: invalid placement`);
    return null;
  }
  o.value = isNum(o.value) && o.value >= 0 ? Math.round(o.value) : 0;
  if (!isNum(o.purchasedTick)) o.purchasedTick = 0;
  if (o.tint !== null && typeof o.tint !== 'string') o.tint = null;
  const c = obj(o.condition) ? o.condition : {};
  o.condition = {
    broken: c.broken === true,
    dirt: isNum(c.dirt) ? clamp(c.dirt, 0, 1) : 0,
    burning: c.burning === true,
    burnMinutes: isNum(c.burnMinutes) && c.burnMinutes >= 0 ? c.burnMinutes : 0,
  };
  const data: ObjectState['data'] = {};
  if (obj(o.data)) for (const [k, v] of Object.entries(o.data)) if (jsonScalar(v)) data[k] = v;
  o.data = data;
  o.reservedBy = obj(o.reservedBy) ? o.reservedBy : {};
  o.inUseBy = strArr(o.inUseBy);
  if (!isNum(o.rev)) o.rev = 0;
  return o as ObjectState;
}

function repairRelationships(s: WorldState, w: string[]): void {
  const src = obj(s.relationships) ? s.relationships : {};
  const out: Record<string, Relationship> = {};
  for (const [key, r0] of Object.entries(src)) {
    if (!obj(r0)) continue;
    const r = r0 as Record<string, any>;
    let a = typeof r.a === 'string' ? r.a : key.split('|')[0];
    let b = typeof r.b === 'string' ? r.b : key.split('|')[1];
    if (!a || !b || a === b || !s.agents[a] || !s.agents[b]) {
      w.push(`relationship ${key} removed`);
      continue;
    }
    if (a > b) [a, b] = [b, a];
    const k = `${a}|${b}`;
    const rel: Relationship = {
      a,
      b,
      friendship: isNum(r.friendship) ? clamp(r.friendship, -100, 100) : 0,
      romance: isNum(r.romance) ? clamp(r.romance, 0, 100) : 0,
      met: r.met === true,
      partners: r.partners === true,
      engaged: r.engaged === true,
      married: r.married === true,
      bestFriends: r.bestFriends === true,
      lastInteractionTick: isNum(r.lastInteractionTick) ? r.lastInteractionTick : 0,
      interactions: isNum(r.interactions) ? Math.max(0, Math.floor(r.interactions)) : 0,
    };
    if (k !== key) w.push(`relationship ${key} normalised to ${k}`);
    const prev = out[k];
    if (!prev || rel.interactions > prev.interactions) out[k] = rel;
  }
  s.relationships = out;
}

/**
 * W-025 (schema v2): structural hygiene of the walkable-world fields for worlds that did not come through the
 * persistence validator (which already enforces the full `town` schema). A `town` that is not an object or has no
 * usable `homeLotId` is removed (the world is then a home-only world); a `regionId` that is not a non-empty string is
 * removed (the record is in the home region). Well-formed worlds are never touched (zero warnings, AC-7).
 */
function repairRegions(s: WorldState & Record<string, any>, w: string[]): void {
  if (s.town !== undefined && (!obj(s.town) || typeof s.town.homeLotId !== 'string' || s.town.homeLotId.length === 0)) {
    delete s.town;
    w.push('neighbourhood data unreadable; reset (the home lot is kept)');
  }
  const fix = (kind: string, key: string, r: unknown) => {
    if (!obj(r) || r.regionId === undefined) return;
    if (typeof r.regionId !== 'string' || r.regionId.length === 0) {
      delete r.regionId;
      w.push(`${kind} ${key}: invalid region; set to the home region`);
    }
  };
  if (obj(s.agents)) for (const [k, a] of Object.entries(s.agents)) fix('agent', k, a);
  // W-025 S3: a malformed welcome (knock → accepted) is dropped; the agent then uses the public step mask
  if (obj(s.agents)) {
    for (const [k, a] of Object.entries(s.agents)) {
      if (!obj(a) || a.welcome === undefined) continue;
      const v = a.welcome;
      if (!obj(v) || typeof v.regionId !== 'string' || v.regionId.length === 0 || typeof v.untilTick !== 'number' || !Number.isInteger(v.untilTick) || v.untilTick < 0) {
        delete a.welcome;
        w.push(`agent ${k}: invalid welcome; dropped`);
      }
    }
  }
  if (obj(s.objects)) for (const [k, o] of Object.entries(s.objects)) fix('object', k, o);
}

export interface RepairOptions {
  spatial?: SpatialAPI | null;
  lotFactory?: () => LotState;
}

export function repairWorld(state: WorldState, reg: ContentRegistry, opts: RepairOptions = {}): string[] {
  const w: string[] = [];
  if (!obj(state)) throw new Error('repairWorld: world is not an object');
  const s = state as WorldState & Record<string, any>;
  if (!isNum(s.schemaVersion)) s.schemaVersion = SAVE_SCHEMA_VERSION;
  if (!isNum(s.seed)) s.seed = 1;
  if (!isNum(s.tick) || s.tick < 0) {
    w.push('tick reset');
    s.tick = 0;
  }
  s.tick = Math.floor(s.tick);
  const rng = s.rng as unknown;
  if (!obj(rng) || ![rng.a, rng.b, rng.c, rng.d].every((x) => isNum(x) && x >= 0 && x <= 0xffffffff && Number.isInteger(x)) || (rng.a | rng.b | rng.c | rng.d) === 0) {
    s.rng = seedRngState((s.seed ^ s.tick) >>> 0);
    w.push('rng state reseeded');
  }
  s.lot = repairLot(s.lot, w, opts.lotFactory);
  if (!obj(s.household)) {
    s.household = { name: 'The Undead', funds: 0, memberIds: [], bills: [], utilitiesOn: true, repoDispatchedDay: null, txLog: [] };
    w.push('household rebuilt');
  }
  const h = s.household as Record<string, any>;
  h.name = sanitizeHouseholdName(h.name) ?? 'The Undead';
  if (!isNum(h.funds) || h.funds < 0 || !Number.isInteger(h.funds)) {
    w.push(`funds ${String(h.funds)} repaired`);
    h.funds = isNum(h.funds) ? Math.max(0, Math.floor(h.funds)) : 0;
  }
  h.utilitiesOn = h.utilitiesOn !== false;
  if (!isNum(h.repoDispatchedDay)) h.repoDispatchedDay = null;
  h.txLog = strArr(h.txLog).slice(-MAX_TXLOG);
  h.bills = (Array.isArray(h.bills) ? h.bills : []).filter(
    (b: unknown): b is Bill => obj(b) && typeof b.id === 'string' && isNum(b.issuedTick) && isNum(b.dueTick) && isNum(b.amount) && b.amount >= 0 && (b.paidTick === null || isNum(b.paidTick)),
  );
  for (const b of h.bills as Bill[]) {
    b.amount = Math.round(b.amount);
    if (!isNum(b.stage)) b.stage = 0;
  }
  repairRegions(s, w);
  // objects first (agents reference them)
  if (!obj(s.objects)) s.objects = {};
  for (const [key, o] of Object.entries(s.objects)) {
    const fixed = obj(o) ? repairObject(key, o, reg, s, w) : null;
    if (!fixed) delete s.objects[key];
  }
  if (!obj(s.agents)) s.agents = {};
  for (const [key, a] of Object.entries(s.agents)) {
    if (!obj(a)) {
      delete s.agents[key];
      w.push(`agent ${key} removed (invalid)`);
      continue;
    }
    repairAgent(key, a, reg, s, w);
  }
  h.memberIds = strArr(h.memberIds).filter((id: string) => {
    const ok = !!s.agents[id];
    if (!ok) w.push(`household member ${id} missing; removed`);
    return ok;
  });
  for (const id of h.memberIds as string[]) s.agents[id].role = 'household';
  // createAgent / joinHousehold always set role and membership together. An agent with role 'household' that the
  // member list lost would be neither family nor visitor (no needs, no autonomy, no menus): bring it back (or, with
  // a full household, demote it to a townie).
  for (const a of Object.values(s.agents)) {
    if (a.role !== 'household' || (h.memberIds as string[]).includes(a.id)) continue;
    if ((h.memberIds as string[]).length < MAX_HOUSEHOLD) {
      (h.memberIds as string[]).push(a.id);
      w.push(`${a.id} was missing from the household list; re-added`);
    } else {
      a.role = 'townie';
      w.push(`${a.id} could not rejoin a full household; now a townie`);
    }
  }
  // cross references: held items / carry
  for (const o of Object.values(s.objects)) {
    if (o.placement.kind === 'held') {
      const holder = s.agents[o.placement.agentId];
      if (!holder || (holder.carryObjectId !== null && holder.carryObjectId !== o.id)) {
        const p = holder ? holder.pos : tileCenter(s.lot.entryPoints[0] ?? { x: 0, z: 0 });
        o.placement = { kind: 'loose', x: p.x, z: p.z, y: 0, parentId: null, surfaceIndex: null, facing: 0 };
        w.push(`object ${o.id} dropped (holder missing)`);
      } else holder.carryObjectId = o.id;
    } else if (o.placement.kind === 'loose' && o.placement.parentId && !s.objects[o.placement.parentId]) {
      o.placement.parentId = null;
      o.placement.surfaceIndex = null;
      o.placement.y = 0;
    }
  }
  for (const a of Object.values(s.agents)) {
    if (a.carryObjectId) {
      const o = s.objects[a.carryObjectId];
      if (!o || o.placement.kind !== 'held' || o.placement.agentId !== a.id) {
        a.carryObjectId = null;
        a.carrying = null;
      }
    }
  }
  for (const seg of Object.values(s.lot.walls)) if (seg.openingId && !s.objects[seg.openingId]) seg.openingId = null;
  // partner links must be mutual
  for (const a of Object.values(s.agents)) {
    const r = a.active;
    if (!r || !r.partnerId) continue;
    const p = s.agents[r.partnerId];
    if (!p || p.presence !== 'onLot' || !p.active || p.active.partnerId !== a.id) {
      if (r.phase === 'run' || r.phase === 'wait') {
        a.active = null;
        w.push(`${a.id} paired interaction dropped (partner gone)`);
      } else r.partnerId = null;
    }
  }
  // reservations / in-use must match an active run
  for (const o of Object.values(s.objects)) {
    for (const [slot, who] of Object.entries(o.reservedBy)) {
      const a = typeof who === 'string' ? s.agents[who] : undefined;
      const r = a && a.presence === 'onLot' ? a.active : null;
      if (!r || r.stageTarget.kind !== 'object' || r.stageTarget.id !== o.id || String(r.slot) !== slot) {
        delete o.reservedBy[slot];
        w.push(`stale reservation on ${o.id} slot ${slot} cleared`);
      }
    }
    o.inUseBy = o.inUseBy.filter((who) => {
      const a = s.agents[who];
      return !!(a && a.active && (a.active.data._uo === o.id || a.active.data._ut === o.id));
    });
  }
  for (const a of Object.values(s.agents)) {
    const r = a.active;
    if (r && r.slot !== null && r.stageTarget.kind === 'object') {
      const o = s.objects[r.stageTarget.id];
      if (o) o.reservedBy[String(r.slot)] = a.id;
    }
  }
  repairRelationships(s, w);
  // notifications / choices / party / flags / stats / settings
  const notes = (Array.isArray(s.notifications) ? s.notifications : []).filter((n: unknown): n is Notification => obj(n) && typeof n.title === 'string');
  for (const n of notes) {
    if (!NOTIFY.has(n.kind)) n.kind = 'info';
    if (typeof n.text !== 'string') n.text = '';
    if (!isNum(n.tick)) n.tick = 0;
    n.read = n.read === true;
    if (typeof n.agentId !== 'string') n.agentId = null;
    if (typeof n.objectId !== 'string') n.objectId = null;
  }
  s.notifications = notes.slice(-MAX_NOTIFICATIONS);
  s.choices = (Array.isArray(s.choices) ? s.choices : []).filter(
    (c: unknown) => obj(c) && typeof c.id === 'string' && Array.isArray(c.options) && c.options.every((o: unknown) => obj(o) && typeof o.effect === 'string'),
  );
  for (const c of s.choices) {
    if (!isNum(c.expiresTick)) c.expiresTick = s.tick + 1;
    if (!isNum(c.defaultOption) || c.defaultOption < 0 || c.defaultOption >= Math.max(1, c.options.length)) c.defaultOption = 0;
    if (typeof c.title !== 'string') c.title = 'A choice';
    if (typeof c.text !== 'string') c.text = '';
    if (!isNum(c.tick)) c.tick = s.tick;
    for (const o of c.options) {
      if (typeof o.label !== 'string') o.label = 'OK';
      o.params = cleanParams(o.params);
      if (o.tooltip !== null && typeof o.tooltip !== 'string') o.tooltip = null;
    }
  }
  const seenC = new Set<string>();
  s.choices = s.choices.filter((c) => (seenC.has(c.id) ? false : (seenC.add(c.id), true)));
  if (s.party !== null && !(obj(s.party) && typeof s.party.hostId === 'string' && isNum(s.party.startTick) && isNum(s.party.endTick))) s.party = null;
  if (s.party) {
    s.party.guestIds = strArr(s.party.guestIds).filter((id) => !!s.agents[id]);
    s.party.score = isNum(s.party.score) ? clamp(s.party.score, 0, 100) : 0;
    s.party.ended = s.party.ended === true;
  }
  const flags: WorldState['flags'] = {};
  if (obj(s.flags)) for (const [k, v] of Object.entries(s.flags)) if (typeof v === 'string' || typeof v === 'boolean' || isNum(v)) flags[k] = v;
  s.flags = flags;
  const stats = obj(s.stats) ? s.stats : { counters: {}, agent: {} };
  const counters: Record<string, number> = {};
  if (obj(stats.counters)) for (const [k, v] of Object.entries(stats.counters)) if (isNum(v)) counters[k] = v;
  const perAgent: Record<string, Record<string, number>> = {};
  if (obj(stats.agent)) {
    for (const [id, m] of Object.entries(stats.agent)) {
      if (!obj(m)) continue;
      const mm: Record<string, number> = {};
      for (const [k, v] of Object.entries(m)) if (isNum(v)) mm[k] = v;
      perAgent[id] = mm;
    }
  }
  s.stats = { counters, agent: perAgent };
  const st: Record<string, any> = obj(s.settings) ? s.settings : {};
  s.settings = {
    autonomy: st.autonomy === 'limited' || st.autonomy === 'off' ? st.autonomy : 'full',
    difficulty: st.difficulty === 'relaxed' || st.difficulty === 'grim' ? st.difficulty : 'normal',
    visitorsEnabled: st.visitorsEnabled !== false,
  };
  s.gameOver = s.gameOver === true;
  // unique uids & notification ids, then nextId
  let maxId = 0;
  for (const id of [...Object.keys(s.agents), ...Object.keys(s.objects)]) {
    const n = idNumber(id);
    if (Number.isFinite(n)) maxId = Math.max(maxId, n);
  }
  for (const c of s.choices) {
    const n = idNumber(c.id);
    if (Number.isFinite(n)) maxId = Math.max(maxId, n);
  }
  for (const b of s.household.bills) {
    const n = Number(String(b.id).replace(/\D+/g, ''));
    if (Number.isFinite(n) && n < 1e12) maxId = Math.max(maxId, n);
  }
  const used = new Set<number>();
  const items: { uid: number }[] = [];
  for (const a of Object.values(s.agents)) {
    if (a.active) items.push(a.active);
    for (const q of a.queue) items.push(q);
  }
  for (const it of items) if (isNum(it.uid) && it.uid > 0) maxId = Math.max(maxId, it.uid);
  for (const n of s.notifications) if (isNum(n.id)) maxId = Math.max(maxId, n.id);
  let next = Math.max(isNum(s.nextId) ? Math.floor(s.nextId) : 1, maxId + 1);
  for (const it of items) {
    if (!isNum(it.uid) || it.uid <= 0 || used.has(it.uid)) {
      it.uid = next++;
      w.push('duplicate queue uid reassigned');
    }
    used.add(it.uid);
  }
  const nids = new Set<number>();
  for (const n of s.notifications) {
    if (!isNum(n.id) || nids.has(n.id)) n.id = next++;
    nids.add(n.id);
  }
  if (!isNum(s.nextId) || s.nextId < next) {
    if (isNum(s.nextId) && s.nextId < next) w.push(`nextId ${s.nextId} raised to ${next}`);
    s.nextId = next;
  }
  if (opts.spatial) repairPositions(s, opts.spatial, w);
  return w;
}

/** Off-grid / stuck on-lot agents -> nearest walkable tile (requires spatial). */
export function repairPositions(s: WorldState, spatial: SpatialAPI, w: string[]): void {
  const home = homeRegionIdOf(s);
  for (const a of Object.values(s.agents)) {
    if (a.presence !== 'onLot') continue;
    // W-025: `spatial` is the HOME grid; an agent standing in another region is checked against that region's grid
    // when it activates (TODO(S4)), never against the home's.
    if (a.regionId !== undefined && a.regionId !== home) continue;
    try {
      const t = spatial.tileOf(a.pos);
      const posed = !!(a.active && a.active.pose && (a.active.phase === 'run' || a.active.phase === 'wait' || a.active.phase === 'exit'));
      if (spatial.inBounds(t.x, t.z) && (posed || spatial.isWalkable(t.x, t.z))) continue;
      const near = spatial.nearestWalkable({ x: clamp(a.pos.x, 0, s.lot.width - 0.01), z: clamp(a.pos.z, 0, s.lot.depth - 0.01) }, 60);
      if (near) {
        a.pos = tileCenter(near);
        a.prevPos = { x: a.pos.x, z: a.pos.z };
        a.path = null;
        a.posY = 0;
        if (a.active && a.active.phase !== 'run') a.active.data._v = -2;
        w.push(`${a.id} moved off a blocked/off-grid tile`);
      }
    } catch {
      /* spatial not usable on this state; the per-tick nudge will retry */
    }
  }
}
