/** Agent lifecycle: create/spawn/despawn/sendOffLot + role predicates (README §12). */
import type { NewAgentSpec } from '../contracts';
import {
  ACCESSORIES,
  BOTTOM_STYLES,
  EYE_STYLES,
  HAIR_STYLES,
  SKIN_TONES,
  TOP_STYLES,
  defaultAppearance,
  intactLimbs,
} from '../../shared/appearance';
import type { ZombieAppearance, LimbState } from '../../shared/appearance';
import { isCastBodyId } from '../../shared/cast';
import { NEED_IDS, SKILL_IDS, SKILL_MAX_LEVEL } from '../types';
import type { AgentId, AgentState, Presence, Vec2 } from '../types';
import { ENGINE_INTERACTIONS, PRIORITY } from '../vocabulary';
import { guardSystem, recordFault } from './faults';
import { releaseAllFor, releaseHeld } from './objects';
import type { Engine } from './types';
import { clamp, compareIds, idNumber, isNum, tileCenter } from './util';
import { beginNext, finishRun } from './runner';
import { queueItem } from './queue';
import { isAgentInActiveRegion, scopeLot, withRegion } from './regions';
import { dropQueued } from './orders';

const PRESENCES: readonly Presence[] = ['onLot', 'offLot', 'atWork', 'crumbled', 'gone'];

export function isPresence(v: unknown): v is Presence {
  return typeof v === 'string' && (PRESENCES as readonly string[]).includes(v);
}

export function isHouseholdAgent(eng: Engine, agent: AgentState): boolean {
  return agent.role === 'household' && eng.state.household.memberIds.includes(agent.id);
}

export function isWalkBy(agent: AgentState): boolean {
  return agent.walkBy !== null && agent.walkBy !== undefined;
}

export function isService(agent: AgentState): boolean {
  return agent.role === 'service';
}

/** Townie on the lot who is not merely walking by. */
export function isVisitorAgent(agent: AgentState): boolean {
  return agent.role === 'townie' && agent.presence === 'onLot' && !isWalkBy(agent);
}

export function fullName(agent: AgentState): string {
  return `${agent.firstName} ${agent.lastName}`.trim();
}

export function limbCount(agent: AgentState, kind: 'arm' | 'leg'): number {
  const l = agent.limbs;
  if (!l) return kind === 'arm' ? 2 : 2;
  const ok = (c: unknown) => c === 'ok' || c === 'prosthetic';
  return kind === 'arm' ? (ok(l.armL) ? 1 : 0) + (ok(l.armR) ? 1 : 0) : (ok(l.legL) ? 1 : 0) + (ok(l.legR) ? 1 : 0);
}

/**
 * On-lot agents of ALL ACTIVE REGIONS in deterministic id order (W-025 S1: an agent in a dormant region is not
 * simulated; agents without `regionId` are in the home region, which is always active, so a home-only world gets
 * exactly the pre-world list).
 */
export function onLotSorted(eng: Engine): AgentState[] {
  const out: AgentState[] = [];
  for (const a of Object.values(eng.state.agents)) if (a.presence === 'onLot' && isAgentInActiveRegion(eng, a)) out.push(a);
  out.sort((a, b) => compareIds(a.id, b.id));
  return out;
}

export function allSorted(eng: Engine): AgentState[] {
  return Object.values(eng.state.agents).sort((a, b) => compareIds(a.id, b.id));
}

// ─────────────────────────────── appearance sanitising ───────────────────────────────

const HEX = /^#[0-9a-fA-F]{6}$/;

export function sanitizeAppearance(raw: unknown): ZombieAppearance {
  const base = defaultAppearance();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d);
  const col = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d);
  const unit = (v: unknown, d: number) => (isNum(v) ? clamp(v, 0, 1) : d);
  const out: ZombieAppearance = {
    height: unit(r.height, base.height),
    build: unit(r.build, base.build),
    skinTone: isNum(r.skinTone) ? clamp(Math.floor(r.skinTone), 0, SKIN_TONES.length - 1) : base.skinTone,
    hairStyle: pick(r.hairStyle, HAIR_STYLES, base.hairStyle),
    hairColor: col(r.hairColor, base.hairColor),
    topStyle: pick(r.topStyle, TOP_STYLES, base.topStyle),
    topColor: col(r.topColor, base.topColor),
    bottomStyle: pick(r.bottomStyle, BOTTOM_STYLES, base.bottomStyle),
    bottomColor: col(r.bottomColor, base.bottomColor),
    shoeColor: col(r.shoeColor, base.shoeColor),
    eyeStyle: pick(r.eyeStyle, EYE_STYLES, base.eyeStyle),
    eyeColor: col(r.eyeColor, base.eyeColor),
    accessory: pick(r.accessory, ACCESSORIES, base.accessory),
    stitches: typeof r.stitches === 'boolean' ? r.stitches : base.stitches,
    voicePitch: unit(r.voicePitch, base.voicePitch),
  };
  // optional cast body (shared/cast.ts): copied only when it is a known id; 'classic' / unknown / missing stay absent
  // so appearances without it keep byte-identical canonical JSON (old saves, determinism hashes)
  if (isCastBodyId(r.body)) out.body = r.body;
  return out;
}

export function sanitizeLimbs(raw: unknown): LimbState {
  const base = intactLimbs();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const ok = (v: unknown) => v === 'ok' || v === 'missing' || v === 'prosthetic';
  return {
    armL: ok(r.armL) ? (r.armL as LimbState['armL']) : 'ok',
    armR: ok(r.armR) ? (r.armR as LimbState['armR']) : 'ok',
    legL: ok(r.legL) ? (r.legL as LimbState['legL']) : 'ok',
    legR: ok(r.legR) ? (r.legR as LimbState['legR']) : 'ok',
  };
}

export function defaultStatus(): AgentState['status'] {
  return {
    zeroPreservationMinutes: 0,
    passedOut: false,
    feral: false,
    autonomyCooldownUntil: 0,
    lastSocialTick: 0,
    autonomyFails: 0,
    bonePileId: null,
    crumbledTick: null,
  };
}

function cleanName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return s.length > 0 ? s : fallback;
}

// ─────────────────────────────── create / spawn / despawn ───────────────────────────────

export function createAgent(eng: Engine, spec: NewAgentSpec): AgentState {
  const id = eng.ctx.newId('a');
  const vitality = 100;
  const needs = {} as AgentState['needs'];
  for (const n of NEED_IDS) {
    const v = spec.needs ? spec.needs[n] : undefined;
    needs[n] = isNum(v) ? clamp(v, 0, n === 'preservation' ? vitality : 100) : n === 'preservation' ? vitality : 80;
  }
  const skills = {} as AgentState['skills'];
  for (const s of SKILL_IDS) {
    const v = spec.skills ? spec.skills[s] : undefined;
    skills[s] = { level: isNum(v) ? clamp(Math.floor(v), 0, SKILL_MAX_LEVEL) : 0, xp: 0 };
  }
  const role: AgentState['role'] = spec.role === 'household' || spec.role === 'service' ? spec.role : 'townie';
  const traits: string[] = [];
  if (Array.isArray(spec.traits)) for (const t of spec.traits) if (typeof t === 'string' && t && !traits.includes(t)) traits.push(t);
  const entry = eng.state.lot.entryPoints[0] ?? { x: 0.5, z: 0.5 };
  const agent: AgentState = {
    id,
    role,
    presence: isPresence(spec.presence) ? spec.presence : 'offLot',
    firstName: cleanName(spec.firstName, 'Nameless'),
    lastName: cleanName(spec.lastName, ''),
    appearance: sanitizeAppearance(spec.appearance),
    traits,
    rewardTraits: [],
    aspiration: typeof spec.aspiration === 'string' ? spec.aspiration : null,
    aspirationMilestones: [],
    aspirationPoints: 0,
    needs,
    vitality,
    moodlets: [],
    skills,
    career: null,
    limbs: intactLimbs(),
    pos: { x: entry.x, z: entry.z },
    prevPos: { x: entry.x, z: entry.z },
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
    status: defaultStatus(),
    visit: null,
    walkBy: null,
    voiceSeed: eng.rng.int(1, 2147483646),
    createdTick: eng.state.tick,
    occupation: typeof spec.occupation === 'string' ? spec.occupation : null,
  };
  eng.state.agents[id] = agent;
  if (role === 'household' && !eng.state.household.memberIds.includes(id)) eng.state.household.memberIds.push(id);
  return agent;
}

function walkableNear(eng: Engine, p: Vec2): Vec2 {
  try {
    const t = eng.spatial.tileOf(p);
    if (eng.spatial.inBounds(t.x, t.z) && eng.spatial.isWalkable(t.x, t.z)) return { x: p.x, z: p.z };
    const w = eng.spatial.nearestWalkable(p, 30);
    if (w) return tileCenter(w);
  } catch (e) {
    recordFault(eng, 'spatial.nearestWalkable', e);
  }
  return { x: p.x, z: p.z };
}

/** Sidewalk entry point of the lot IN SCOPE for an agent (the home lot in a home-only world). */
export function entryPointFor(eng: Engine, agent: AgentState): Vec2 {
  const lot = scopeLot(eng);
  const eps = lot.entryPoints;
  if (Array.isArray(eps) && eps.length > 0) {
    const n = idNumber(agent.id);
    const ep = eps[(Number.isFinite(n) ? n : 0) % eps.length];
    if (ep && isNum(ep.x) && isNum(ep.z)) return { x: ep.x, z: ep.z };
  }
  return { x: lot.width / 2, z: lot.sidewalkZ + 0.5 };
}

export function spawnAgent(eng: Engine, agentId: AgentId, at?: Vec2): void {
  const a = eng.state.agents[agentId];
  if (!a) {
    recordFault(eng, 'spawnAgent', `unknown agent '${String(agentId)}'`);
    return;
  }
  if (a.presence === 'onLot') return;
  // W-025: spawning brings the agent onto the HOME lot (its sidewalk entry); a stale `regionId` is cleared so the
  // agent is in the home region (absent field). Home-only worlds never carry the field, so nothing changes there.
  if (a.regionId !== undefined) delete a.regionId;
  withRegion(eng, undefined, () => spawnHome(eng, a, at));
}

function spawnHome(eng: Engine, a: AgentState, at?: Vec2): void {
  // An off-lot agent should never hold a run (despawn ends it), but one left by a system that flipped presence
  // directly must still end properly (end() once, reservations released) rather than vanish.
  if (a.active) finishRun(eng, a, 'canceled', 'Left the lot', { silent: true });
  a.active = null;
  releaseAllFor(eng, a.id);
  if (!a.status || typeof a.status !== 'object') a.status = defaultStatus();
  const p = at && isNum(at.x) && isNum(at.z) ? walkableNear(eng, at) : walkableNear(eng, entryPointFor(eng, a));
  a.presence = 'onLot';
  a.pos = { x: p.x, z: p.z };
  a.prevPos = { x: p.x, z: p.z };
  a.posY = 0;
  a.path = null;
  a.pathIndex = 0;
  a.anim = 'idle';
  a.status.passedOut = false;
  eng.ctx.emit({ type: 'agentSpawned', agentId: a.id });
  for (const entry of eng.systems) {
    const fn = entry.sys.agentArrived;
    if (fn) guardSystem(eng, entry, 'agentArrived', () => fn.call(entry.sys, eng.ctx, a));
  }
}

export function despawnAgent(eng: Engine, agentId: AgentId, presence: Presence): void {
  const a = eng.state.agents[agentId];
  if (!a) return;
  let pres: Presence = isPresence(presence) ? presence : 'offLot';
  if (pres === 'onLot') pres = 'offLot';
  const wasOnLot = a.presence === 'onLot';
  if (a.active) {
    finishRun(eng, a, 'canceled', 'Left the lot', { silent: true, partnerOutcome: 'failed', partnerReason: `${a.firstName} left` });
  }
  if (a.active) a.active = null; // finishRun may be re-entrant-guarded; never leave a run behind
  dropQueued(eng, a, () => true, 'leftLot');
  a.queue = [];
  if (a.carryObjectId) releaseHeld(eng, a, 'floor');
  releaseAllFor(eng, a.id);
  a.path = null;
  a.pathIndex = 0;
  a.posY = 0;
  a.anim = 'idle';
  a.expression = 'neutral';
  a.carrying = null;
  if (!a.status || typeof a.status !== 'object') a.status = defaultStatus();
  a.status.passedOut = false;
  a.presence = pres;
  if (wasOnLot) {
    eng.ctx.emit({ type: 'agentDespawned', agentId: a.id });
    for (const entry of eng.systems) {
      const fn = entry.sys.agentLeft;
      if (fn) guardSystem(eng, entry, 'agentLeft', () => fn.call(entry.sys, eng.ctx, a));
    }
  }
}

export function sendOffLot(eng: Engine, agent: AgentState, presence: Presence, reason: string): void {
  let pres: Presence = isPresence(presence) ? presence : 'offLot';
  if (pres === 'onLot') pres = 'offLot';
  if (agent.presence !== 'onLot') {
    agent.presence = pres;
    return;
  }
  if (agent.active && agent.active.interactionId === ENGINE_INTERACTIONS.exitLot) {
    agent.active.params.presence = pres;
    return;
  }
  if (agent.active) finishRun(eng, agent, 'canceled', reason || 'Leaving', { silent: true });
  dropQueued(eng, agent, () => true, 'leftLot');
  agent.queue = [];
  const qi = queueItem(eng, agent, {
    interactionId: ENGINE_INTERACTIONS.exitLot,
    target: { kind: 'self' },
    params: { presence: pres, reason: String(reason ?? '') },
    source: 'system',
    priority: PRIORITY.critical,
    front: true,
  });
  if (!qi) {
    despawnAgent(eng, agent.id, pres);
    return;
  }
  beginNext(eng, agent);
}
