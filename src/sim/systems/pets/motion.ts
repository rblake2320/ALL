/**
 * W-013 strays and pets: WHERE they are and WHAT they are doing (deterministic, saved with the pets block).
 *
 * - Strays wander the sidewalk (street) or the rear strip of the lot (graveyard side), mostly resting, never going
 *   indoors; at night they mostly sit. A chase sends one running along the sidewalk.
 * - Household pets live around the household: each 15-minute slot a pet either rests where it is or walks (through the
 *   real path finder, doors and walls included) to a spot near the household's members; at night it walks to its own
 *   sleeping spot near them and sleeps. Feeding, playing and cuddling hold it in place with the matching animation.
 *
 * No ctx.rng, no wall clock: every choice is a hash of (world seed, animal id, slot). The clip names are the rig clips
 * (src/render/pets/rig.ts); `facing` is yaw in radians, 0 = nose toward +Z (the agents' convention).
 */
import type { SimContext } from '../../contracts';
import { timeInfo } from '../../time';
import type { PetAnim, PetBody, PetState, StrayPlace, StrayState, Vec2 } from '../../types';
import { TICK_MINUTES } from '../../types';
import { homeRegionIdOf } from '../../../shared/town';

export const SLOT_MIN = 15;
export const SLOT_TICKS = Math.round(SLOT_MIN / TICK_MINUTES);
/** Tiles per tick (1.2 / 2.4 tiles per game minute; a zombie with full legs walks 1.3). */
export const WALK_PER_TICK = 0.3;
export const RUN_PER_TICK = 0.6;
export const FLEE_MIN = 3;
/** A pet picks its spot within this many tiles of the household's middle. */
export const HOME_RADIUS = 5;

export const ticksOf = (min: number) => Math.max(1, Math.round(min / TICK_MINUTES));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/** Deterministic number in [0, 1) for (seed, key, n, salt). */
export function frac(ctx: SimContext, key: string, n: number, salt: number): number {
  return mix(mix(ctx.state.seed >>> 0, fnv(key)), Math.imul(n | 0, 31) + salt) / 4294967296;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

interface Zone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Where strays of a place wander (world tile coordinates, inside the lot grid). */
export function zoneOf(ctx: SimContext, place: StrayPlace): Zone {
  const lot = ctx.state.lot;
  const w = Math.max(2, num(lot?.width, 30));
  const d = Math.max(2, num(lot?.depth, 30));
  const sz = Math.min(d - 0.5, Math.max(0.5, num(lot?.sidewalkZ, d - 1) + 0.5));
  if (place === 'street') return { x0: 0.5, x1: w - 0.5, z0: Math.max(0.5, sz - 0.2), z1: Math.min(d - 0.3, sz + 0.2) };
  return { x0: 0.5, x1: w - 0.5, z0: 0.5, z1: Math.min(d - 0.5, 1.7) };
}

/** A stray never goes indoors (only adopted pets live inside): true where (x, z) is a room tile of a building. */
export function indoorAt(ctx: SimContext, p: Vec2): boolean {
  try {
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    return ctx.spatial.inBounds(x, z) && ctx.spatial.isIndoor(x, z) === true;
  } catch {
    return false;
  }
}

/** A point of zone `z` that is outdoors (tries a few hashed points; null when the zone is all indoors). */
function outdoorPointIn(ctx: SimContext, key: string, n: number, z: Zone): Vec2 | null {
  for (let k = 0; k < 6; k++) {
    const p = pointIn(ctx, key, n * 7 + k, z);
    if (!indoorAt(ctx, p)) return p;
  }
  return null;
}

function pointIn(ctx: SimContext, key: string, n: number, z: Zone): Vec2 {
  return { x: round3(z.x0 + frac(ctx, key, n, 1) * (z.x1 - z.x0)), z: round3(z.z0 + frac(ctx, key, n, 2) * (z.z1 - z.z0)) };
}

/** A fresh body resting at `at`, facing a hash-chosen way. */
export function newBody(ctx: SimContext, key: string, at: Vec2): PetBody {
  return { pos: { x: round3(at.x), z: round3(at.z) }, facing: round3((frac(ctx, key, 0, 3) - 0.5) * 2 * Math.PI), anim: 'idle', goal: null, slot: -1, busyUntil: 0 };
}

export function strayArrivalPoint(ctx: SimContext, key: string, place: StrayPlace): Vec2 {
  // the street strip (sidewalk) is the fallback: it is never inside a building
  return outdoorPointIn(ctx, key, 0, zoneOf(ctx, place)) ?? outdoorPointIn(ctx, key, 0, zoneOf(ctx, 'street')) ?? pointIn(ctx, key, 0, zoneOf(ctx, place));
}

/** Like stepToward, but a stray stops at the edge rather than step onto an indoor tile (it never walks into a home). */
function strayStep(ctx: SimContext, s: StrayState, to: Vec2, speed: number): 'arrived' | 'walking' | 'blocked' {
  const before = { x: s.pos.x, z: s.pos.z };
  const facing = s.facing;
  const done = stepToward(s, to, speed);
  if (indoorAt(ctx, s.pos) && !indoorAt(ctx, before)) {
    s.pos = before;
    s.facing = facing;
    return 'blocked';
  }
  return done ? 'arrived' : 'walking';
}

/** The middle of the household's zombies (the lot's middle if there are none). */
export function householdCentre(ctx: SimContext): Vec2 {
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const id of ctx.state.household?.memberIds ?? []) {
    const a = ctx.state.agents[id];
    if (a && (a.regionId ?? homeRegionIdOf(ctx.state)) === homeRegionIdOf(ctx.state) && a.pos && Number.isFinite(a.pos.x) && Number.isFinite(a.pos.z)) {
      sx += a.pos.x;
      sz += a.pos.z;
      n++;
    }
  }
  if (n > 0) return { x: sx / n, z: sz / n };
  return { x: num(ctx.state.lot?.width, 30) / 2, z: num(ctx.state.lot?.depth, 30) / 2 };
}

function walkableNear(ctx: SimContext, p: Vec2): Vec2 | null {
  try {
    const t = ctx.spatial.nearestWalkable(p, 6);
    return t ? { x: t.x + 0.5, z: t.z + 0.5 } : null;
  } catch {
    return null;
  }
}

/** One straight step toward `to`; true when it arrived. Turns to face the way it moves. */
function stepToward(b: PetBody, to: Vec2, speed: number): boolean {
  const dx = to.x - b.pos.x;
  const dz = to.z - b.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.02) b.facing = round3(Math.atan2(dx, dz));
  if (d <= speed) {
    b.pos = { x: round3(to.x), z: round3(to.z) };
    return true;
  }
  b.pos = { x: round3(b.pos.x + (dx / d) * speed), z: round3(b.pos.z + (dz / d) * speed) };
  return false;
}

/** Hold `anim` in place for `min` game minutes (eat, play, cuddle, ...). */
export function holdFor(ctx: SimContext, b: PetBody, anim: PetAnim, min: number): void {
  b.anim = anim;
  b.goal = null;
  b.busyUntil = ctx.state.tick + ticksOf(min);
}

/** A chased stray bolts along the sidewalk away from `from`. */
export function startFlee(ctx: SimContext, s: StrayState, from: Vec2): void {
  const z = zoneOf(ctx, s.place);
  const dir = from.x <= s.pos.x ? 1 : -1;
  const far = Math.min(z.x1, Math.max(z.x0, s.pos.x + dir * 9));
  s.goal = { x: round3(far), z: round3(Math.min(z.z1, Math.max(z.z0, s.pos.z))) };
  s.anim = 'flee';
  s.busyUntil = ctx.state.tick + ticksOf(FLEE_MIN);
}

/** An animal a zombie is walking up to waits where it is (no new goal, resting animation). */
export function holdStill(ctx: SimContext, b: PetBody & { trust?: number }): void {
  if (b.busyUntil > ctx.state.tick) return;
  b.goal = null;
  b.anim = typeof b.trust === 'number' && b.trust >= 30 ? 'beg' : 'idle';
}

/** One tick of a stray's life. */
export function stepStray(ctx: SimContext, s: StrayState): void {
  const tick = ctx.state.tick;
  if (s.busyUntil > tick) {
    if (s.anim === 'flee' && s.goal) {
      if (strayStep(ctx, s, s.goal, RUN_PER_TICK) !== 'walking') {
        s.goal = null;
        s.anim = 'sit';
      }
    }
    return;
  }
  const slot = Math.floor((tick + (fnv(s.id) % SLOT_TICKS)) / SLOT_TICKS);
  if (slot !== s.slot) {
    s.slot = slot;
    const night = timeInfo(tick).isNight;
    s.goal = frac(ctx, s.id, slot, 4) < (night ? 0.15 : 0.55) ? outdoorPointIn(ctx, s.id, slot, zoneOf(ctx, s.place)) : null;
  }
  if (s.goal) {
    if (strayStep(ctx, s, s.goal, WALK_PER_TICK) !== 'walking') s.goal = null;
    else {
      s.anim = 'walk';
      return;
    }
  }
  s.anim = s.trust >= 30 ? 'beg' : frac(ctx, s.id, slot, 5) < 0.5 ? 'idle' : 'sit';
}

/** The pet's own sleeping spot near the household (stable for the pet). */
function sleepSpot(ctx: SimContext, p: PetState): Vec2 {
  const c = householdCentre(ctx);
  const a = frac(ctx, p.id, 0, 6) * Math.PI * 2;
  const r = 1 + frac(ctx, p.id, 0, 7) * 2;
  return walkableNear(ctx, { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r }) ?? c;
}

/**
 * Walk one step toward `goal` along the lot's real walkable tiles (doors, walls and furniture respected): follow the
 * distance field from the goal tile downhill, tile centre to tile centre. A pure function of (position, goal, lot), so
 * a reloaded world walks exactly like the original. 'stuck' = the goal cannot be reached from here.
 */
function stepTowardGoal(ctx: SimContext, p: PetState, goal: Vec2, speed = WALK_PER_TICK): 'walking' | 'arrived' | 'stuck' {
  try {
    const sp = ctx.spatial;
    const df = sp.distanceField(goal);
    const t = sp.tileOf(p.pos);
    const here = sp.tileIndex(t.x, t.z);
    const dHere = df.dist[here];
    if (!(dHere < Infinity)) return 'stuck';
    if (here === df.originIndex) return stepToward(p, goal, speed) ? 'arrived' : 'walking';
    let best: { x: number; z: number } | null = null;
    let bestD = dHere;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = t.x + dx;
        const nz = t.z + dz;
        if (!sp.inBounds(nx, nz) || !sp.canStep(t.x, t.z, nx, nz)) continue;
        const d = df.dist[sp.tileIndex(nx, nz)];
        if (d < bestD) {
          bestD = d;
          best = { x: nx, z: nz };
        }
      }
    }
    if (!best) return 'stuck';
    stepToward(p, { x: best.x + 0.5, z: best.z + 0.5 }, speed);
    return 'walking';
  } catch {
    return 'stuck';
  }
}

/** One tick of a household pet's life. */
/** The gate: where a Guard pet runs to bark (the middle of the lot's front edge, one row in from the sidewalk). */
export function gatePoint(ctx: SimContext): Vec2 | null {
  const lot = ctx.state.lot;
  return walkableNear(ctx, { x: num(lot?.width, 30) / 2, z: Math.max(0.5, num(lot?.sidewalkZ, num(lot?.depth, 30) - 1) - 0.5) });
}

export function stepPet(ctx: SimContext, p: PetState): void {
  const tick = ctx.state.tick;
  if (p.guardUntil > tick) {
    // gate duty (a Guard pet holding off the Repo Ghoul): run to the gate, then bark in place
    if (p.slot !== -3) {
      p.slot = -3;
      p.goal = gatePoint(ctx);
    }
    if (p.goal && stepTowardGoal(ctx, p, p.goal, RUN_PER_TICK) === 'walking') {
      p.anim = 'run';
      return;
    }
    p.goal = null;
    p.anim = 'play';
    return;
  }
  if (p.slot === -3) p.slot = -1; // back off duty: pick a new place
  if (p.busyUntil > tick) {
    // a chase (rival or hunt, encounters.ts): run toward the goal along the lot's real walkable tiles, then stop and play
    if (p.anim === 'run' && p.goal && stepTowardGoal(ctx, p, p.goal, RUN_PER_TICK) !== 'walking') {
      p.goal = null;
      p.anim = 'play';
    }
    return;
  }
  const night = timeInfo(tick).isNight;
  const slot = Math.floor((tick + (fnv(p.id) % SLOT_TICKS)) / SLOT_TICKS);
  if (night) {
    if (p.slot !== -2) {
      p.slot = -2; // "bedtime" marker: choose the sleeping spot once per night
      p.goal = sleepSpot(ctx, p);
    }
  } else if (slot !== p.slot) {
    p.slot = slot;
    if (frac(ctx, p.id, slot, 4) < 0.35) p.goal = null;
    else {
      const c = householdCentre(ctx);
      const a = frac(ctx, p.id, slot, 8) * Math.PI * 2;
      const r = 0.5 + frac(ctx, p.id, slot, 9) * (HOME_RADIUS - 0.5);
      p.goal = walkableNear(ctx, { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r });
    }
  }
  if (p.goal) {
    const next = stepTowardGoal(ctx, p, p.goal);
    if (next === 'arrived' || next === 'stuck') p.goal = null;
    else {
      p.anim = 'walk';
      return;
    }
  }
  p.anim = night ? 'sleep' : frac(ctx, p.id, slot, 5) < 0.5 ? 'sit' : 'idle';
}
