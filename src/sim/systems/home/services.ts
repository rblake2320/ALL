/**
 * Service NPCs (Pizza Delivery Ghoul, Repo Ghoul) and "front of the house" geometry.
 * Cross-module agreement: ask people's `townies.createService(kind)` for the agent; if that api is missing or
 * misbehaves, create a fitting service agent ourselves with ctx.createAgent. The caller spawns it.
 */
import type { SimContext } from '../../contracts';
import type { AgentState, Vec2 } from '../../types';
import { defaultAppearance, type ZombieAppearance } from '../../../shared/appearance';
import { PEOPLE_SYS } from '../../content/home/ids';
import { centerOf, compareIds, getAgent, isNum, objectsWithTag, sysApi } from './util';

export type ServiceKind = 'pizza' | 'repo';

function serviceLook(kind: ServiceKind): ZombieAppearance {
  const base = defaultAppearance();
  if (kind === 'pizza') {
    return {
      ...base,
      skinTone: 3,
      hairStyle: 'buzz',
      hairColor: '#4a3326',
      topStyle: 'tee',
      topColor: '#a5532f',
      bottomColor: '#3a3f55',
      accessory: 'beanie',
      eyeStyle: 'wide',
      voicePitch: 0.7,
    };
  }
  return {
    ...base,
    skinTone: 1,
    build: 0.85,
    height: 0.9,
    hairStyle: 'combover',
    hairColor: '#2b2f3a',
    topStyle: 'suit',
    topColor: '#2b2f3a',
    bottomColor: '#1d1726',
    accessory: 'glasses',
    eyeStyle: 'beady',
    voicePitch: 0.15,
  };
}

const FALLBACK_NAMES: Record<ServiceKind, { firstName: string; lastName: string; occupation: string }> = {
  pizza: { firstName: 'Pepperoni', lastName: 'Pete', occupation: 'Pizza Delivery Ghoul' },
  repo: { firstName: 'Mortimer', lastName: 'Grimsby', occupation: 'Repo Ghoul' },
};

/** An agent that is off the lot and free to be (re)spawned. */
function spawnable(a: AgentState | null): a is AgentState {
  return !!a && (a.presence === 'offLot' || a.presence === 'gone');
}

/** Freshen a reused service ghoul (it may have left mid-job last time). */
function resetForDuty(a: AgentState): void {
  a.queue = [];
  a.active = null;
  a.carrying = null;
  a.carryObjectId = null;
  a.limbs = { armL: 'ok', armR: 'ok', legL: 'ok', legR: 'ok' };
  if (a.needs) for (const n of Object.keys(a.needs) as (keyof AgentState['needs'])[]) a.needs[n] = Math.max(a.needs[n] ?? 0, 80);
  if (a.status) {
    a.status.zeroPreservationMinutes = 0;
    a.status.passedOut = false;
    a.status.feral = false;
  }
}

/**
 * Create (not spawn) a service agent. Prefers people's townies.createService (which reuses idle ghouls); otherwise
 * reuses one of our own idle fallback ghouls, else creates one. Returns null only if every path failed.
 */
export function createServiceAgent(ctx: SimContext, kind: ServiceKind): AgentState | null {
  const api = sysApi(ctx, PEOPLE_SYS.townies);
  if (typeof api.createService === 'function') {
    try {
      const a = getAgent(ctx, api.createService(kind));
      if (spawnable(a)) {
        if (a.role !== 'service') a.role = 'service';
        return a;
      }
    } catch {
      /* fall back to our own agent */
    }
  }
  const n = FALLBACK_NAMES[kind];
  const idle = Object.values(ctx.state.agents)
    .filter((a): a is AgentState => !!a && a.role === 'service' && a.occupation === n.occupation && spawnable(a))
    .sort((a, b) => compareIds(a.id, b.id))[0];
  if (idle) {
    resetForDuty(idle);
    return idle;
  }
  try {
    return ctx.createAgent({
      role: 'service',
      presence: 'offLot',
      firstName: n.firstName,
      lastName: n.lastName,
      appearance: serviceLook(kind),
      traits: [],
      occupation: n.occupation,
    });
  } catch {
    return null;
  }
}

/** Where deliveries land: the mailbox, else outside the front door, else just inside the lot from the sidewalk. */
export function frontSpot(ctx: SimContext): Vec2 {
  const mailbox = objectsWithTag(ctx, 'mailbox').find((o) => o.placement.kind !== 'held');
  if (mailbox) return centerOf(ctx, mailbox);
  const doors = objectsWithTag(ctx, 'door').filter((o) => o.placement.kind === 'opening');
  if (doors.length > 0) {
    let best = centerOf(ctx, doors[0]);
    for (const d of doors) {
      const c = centerOf(ctx, d);
      if (c.z > best.z) best = c;
    }
    return { x: best.x, z: best.z + 0.6 };
  }
  // No mailbox or door: the middle of the lot's front edge, one row in from the sidewalk.
  const lot = ctx.state.lot;
  const w = isNum(lot?.width) ? lot.width : 30;
  const sz = isNum(lot?.sidewalkZ) ? lot.sidewalkZ : 28;
  return { x: w / 2, z: sz - 0.5 };
}

/** Nearest walkable tile to a point (null if spatial can't find one). */
export function walkableTileNear(ctx: SimContext, p: Vec2, radius = 4): { x: number; z: number } | null {
  try {
    const t = ctx.spatial.nearestWalkable(p, radius);
    return t && isNum(t.x) && isNum(t.z) ? t : null;
  } catch {
    return null;
  }
}

/** A floor point (tile centre) near p for dropping loose items; falls back to p itself. */
export function floorPointNear(ctx: SimContext, p: Vec2): Vec2 {
  const t = walkableTileNear(ctx, p, 4);
  return t ? { x: t.x + 0.5, z: t.z + 0.5 } : { x: p.x, z: p.z };
}
