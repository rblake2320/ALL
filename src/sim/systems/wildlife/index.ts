/**
 * W-075 ambient wildlife (docs/systems/wildlife.md) — sim side only.
 *
 * Critters are NOT world state: `ambientWildlife(seed, lotId, tick, layout)` recomputes the lot's critters from the
 * seed and the clock every time it is called, so nothing is saved and saves cannot grow (D-003: a private seeded
 * stream per lot and 20-minute slot, no Math.random, no Date). The renderer reads the returned frozen list of
 * { id, species, pos, facing, anim } and draws it; `facing` is yaw in radians, 0 = nose toward +Z (glTF front).
 *
 * Caps (perf budget, wildlife.md "≤ 6 birds, ≤ 2 squirrels, ≤ 4 bats"): SPECIES_CAPS per species and at most
 * WILDLIFE_CAP_PER_LOT = 12 critters on a lot at any tick.
 *
 * `chaseCritter` is the comic zombie chase: the critter always out-runs (and flyers out-climb) the zombie, the zombie
 * lunges, misses and stops, and gets a short moodlet. It never catches (E10+, D-008).
 */
import type { MoodletDef } from '../../contracts';
import { createRng, seedRngState } from '../../rng';
import { timeInfo } from '../../time';
import type { Vec2 } from '../../types';

export const WILDLIFE_SPECIES = ['songbird', 'pigeon', 'squirrel', 'bat', 'frog', 'firefly'] as const;
export type WildlifeSpecies = (typeof WILDLIFE_SPECIES)[number];

export const SPECIES_CAPS: Readonly<Record<WildlifeSpecies, number>> = Object.freeze({
  songbird: 6,
  pigeon: 4,
  squirrel: 2,
  bat: 4,
  frog: 3,
  firefly: 2, // swarms (particle effect in the renderer, no model)
});
export const WILDLIFE_CAP_PER_LOT = 12;
/** Game minutes per spawn slot: the set of critters on a lot changes at most this often. */
export const WILDLIFE_SLOT_MIN = 20;
/** Horizontal distance (m) inside which a ground-level critter would count as caught. Never reached. */
export const CATCH_RADIUS = 0.6;

export interface WildlifeLotLayout {
  width: number;
  depth: number;
  /** Water points (ponds, bayou edge); frogs and fireflies appear only within 3 m of one. */
  water?: readonly Vec2[];
  /**
   * True where (x, z) is inside a building (a room tile). Wild animals never enter a home: a critter whose path in its
   * slot would cross indoor ground below INDOOR_CLEAR_Y is re-rolled, then dropped. Absent = no buildings known.
   */
  indoor?: (x: number, z: number) => boolean;
}

/** Height (m) below which a point over a room tile counts as inside the building (ceilings and roofs sit below it). */
export const INDOOR_CLEAR_Y = 4.5;
/** Points checked along a critter's path within its slot, and alternative paths tried before the critter is dropped. */
const PATH_SAMPLES = 96;
const PATH_RETRIES = 6;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Critter {
  readonly id: string;
  readonly species: WildlifeSpecies;
  readonly pos: Readonly<Vec3>;
  readonly facing: number;
  readonly anim: string;
}

const DAY_SPECIES: readonly WildlifeSpecies[] = ['songbird', 'pigeon', 'squirrel'];
const NIGHT_SPECIES: readonly WildlifeSpecies[] = ['bat', 'frog', 'firefly'];
const WATER_SPECIES: readonly WildlifeSpecies[] = ['frog', 'firefly'];

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

function streamFor(seed: number, key: string) {
  return createRng(seedRngState((fnv1a(key) ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0));
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const yaw = (dx: number, dz: number, fallback = 0) => (dx === 0 && dz === 0 ? fallback : Math.atan2(dx, dz));
const round = (v: number) => Math.round(v * 1000) / 1000;

function critter(id: string, species: WildlifeSpecies, x: number, y: number, z: number, facing: number, anim: string): Critter {
  return Object.freeze({ id, species, pos: Object.freeze({ x: round(x), y: round(y), z: round(z) }), facing: round(facing), anim });
}

type Rng = ReturnType<typeof createRng>;

/** One critter's deterministic path inside its slot; f in [0,1) is the progress through the slot. */
function place(species: WildlifeSpecies, id: string, rng: Rng, f: number, lot: WildlifeLotLayout, water: Vec2 | null): Critter {
  const W = Math.max(1, lot.width);
  const D = Math.max(1, lot.depth);
  const phase = rng.next();
  switch (species) {
    case 'songbird': {
      // Fly in from off-lot, perch (fence/roof/tree point), fly off.
      const perch = { x: rng.next() * W, z: rng.next() * D };
      const perchY = 0.8 + rng.next() * 2.2;
      const a = rng.next() * Math.PI * 2;
      const from = { x: perch.x + Math.sin(a) * 15, z: perch.z + Math.cos(a) * 15 };
      const to = { x: perch.x - Math.sin(a) * 15, z: perch.z - Math.cos(a) * 15 };
      if (f < 0.15) {
        const k = f / 0.15;
        return critter(id, species, lerp(from.x, perch.x, k), lerp(6, perchY, k), lerp(from.z, perch.z, k), yaw(perch.x - from.x, perch.z - from.z), k > 0.85 ? 'land' : 'fly');
      }
      if (f >= 0.85) {
        const k = (f - 0.85) / 0.15;
        return critter(id, species, lerp(perch.x, to.x, k), lerp(perchY, 6, k), lerp(perch.z, to.z, k), yaw(to.x - perch.x, to.z - perch.z), k < 0.15 ? 'takeoff' : 'fly');
      }
      const beat = Math.floor((f + phase) * 12) % 3;
      return critter(id, species, perch.x, perchY, perch.z, a + Math.PI, beat === 2 ? 'peck' : 'perch-idle');
    }
    case 'pigeon': {
      // Pace the sidewalk strip at the front of the lot, back and forth, stopping to peck.
      const z = D - 0.5 - rng.next() * 1.5;
      const x0 = rng.next() * W;
      const span = 2 + rng.next() * 3;
      const s = (f * 4 + phase) % 2;
      const dir = s < 1 ? 1 : -1;
      const k = s < 1 ? s : 2 - s;
      const pecking = Math.floor((f + phase) * 20) % 4 === 0;
      return critter(id, species, Math.min(W, x0 + span * k), 0, z, yaw(dir, 0), pecking ? 'peck' : 'walk');
    }
    case 'squirrel': {
      // Dart across the lawn from tree to tree, freezing mid-way, then climb.
      const a = { x: rng.next() * W, z: rng.next() * D };
      const b = { x: rng.next() * W, z: rng.next() * D };
      const s = (f * 3 + phase) % 1;
      const face = yaw(b.x - a.x, b.z - a.z);
      if (s < 0.4) return critter(id, species, lerp(a.x, b.x, s / 0.8), 0, lerp(a.z, b.z, s / 0.8), face, 'run');
      if (s < 0.5) return critter(id, species, lerp(a.x, b.x, 0.5), 0, lerp(a.z, b.z, 0.5), face, 'freeze');
      if (s < 0.9) return critter(id, species, lerp(a.x, b.x, (s - 0.1) / 0.8), 0, lerp(a.z, b.z, (s - 0.1) / 0.8), face, 'run');
      return critter(id, species, b.x, ((s - 0.9) / 0.1) * 2.5, b.z, face, 'climb');
    }
    case 'bat': {
      // Swoop circles around a lamp/moon point.
      const c = { x: rng.next() * W, z: rng.next() * D };
      const r = 2 + rng.next() * 2;
      const turns = 6 + rng.int(0, 4);
      const ang = (f * turns + phase) * Math.PI * 2;
      const hover = Math.floor((f + phase) * 30) % 5 === 0;
      return critter(id, species, c.x + Math.sin(ang) * r, 3 + rng.next() * 2 + Math.sin(ang * 2) * 0.4, c.z + Math.cos(ang) * r, ang + Math.PI / 2, hover ? 'flap-hover' : 'fly');
    }
    case 'frog': {
      const w = water as Vec2;
      const base = rng.next() * Math.PI * 2;
      const hopIdx = Math.floor((f + phase) * 10);
      const ang = base + hopIdx * 0.7;
      const r = 1 + rng.next() * 1.5;
      const hopping = (f * 10 + phase) % 1 < 0.2;
      return critter(id, species, w.x + Math.sin(ang) * r, 0, w.z + Math.cos(ang) * r, ang + Math.PI / 2, hopping ? 'hop' : 'idle');
    }
    case 'firefly': {
      const w = water as Vec2;
      const ang = (f * 3 + phase) * Math.PI * 2;
      const r = 0.5 + rng.next() * 1.5;
      return critter(id, species, w.x + Math.sin(ang) * r, 0.6 + Math.sin(ang * 3) * 0.3 + rng.next() * 0.5, w.z + Math.cos(ang) * r, ang + Math.PI / 2, 'glow');
    }
  }
}

/**
 * The critters on `lotId` at `tick`. Pure: same inputs → identical list; never reads or writes world state.
 * At most WILDLIFE_CAP_PER_LOT entries and SPECIES_CAPS[species] of each species.
 */
export function ambientWildlife(seed: number, lotId: string, tick: number, layout: WildlifeLotLayout): readonly Critter[] {
  const ti = timeInfo(tick);
  const slotTicks = WILDLIFE_SLOT_MIN * 4;
  const slot = Math.floor(tick / slotTicks);
  const f = (tick - slot * slotTicks) / slotTicks;
  const species = ti.isNight ? NIGHT_SPECIES : DAY_SPECIES;
  const water = layout.water ?? [];
  const out: Critter[] = [];
  for (const sp of species) {
    if (WATER_SPECIES.includes(sp) && water.length === 0) continue;
    const rng = streamFor(seed, `${lotId}|${slot}|${sp}`);
    const n = rng.int(0, SPECIES_CAPS[sp]);
    for (let i = 0; i < n && out.length < WILDLIFE_CAP_PER_LOT; i++) {
      const id = `wl:${lotId}:${slot}:${sp}:${i}`;
      const at = (key: string, ff: number): Critter => {
        const crng = streamFor(seed, key);
        const w = WATER_SPECIES.includes(sp) ? crng.pick(water) : null;
        return place(sp, id, crng, ff, layout, w);
      };
      const base = `${lotId}|${slot}|${sp}|${i}`;
      const indoor = layout.indoor;
      let key: string | null = base;
      if (indoor) {
        // Wild animals stay outside: the whole path this slot (not just this moment) must stay out of buildings.
        key = null;
        for (let r = 0; r <= PATH_RETRIES && key === null; r++) {
          const k = r === 0 ? base : `${base}|r${r}`;
          let ok = true;
          for (let s = 0; s <= PATH_SAMPLES && ok; s++) {
            const c = at(k, s / PATH_SAMPLES);
            if (c.pos.y < INDOOR_CLEAR_Y && safeIndoor(indoor, c.pos.x, c.pos.z)) ok = false;
          }
          if (ok) key = k;
        }
        if (key === null) continue;
      }
      const now = at(key, f);
      // belt and braces: whatever the sampling missed, a critter is never drawn inside a building at this moment
      if (indoor && now.pos.y < INDOOR_CLEAR_Y && safeIndoor(indoor, now.pos.x, now.pos.z)) continue;
      out.push(now);
    }
  }
  return Object.freeze(out);
}

function safeIndoor(indoor: (x: number, z: number) => boolean, x: number, z: number): boolean {
  try {
    return indoor(x, z) === true;
  } catch {
    return true; // unknown counts as inside: never draw a critter where it might be in a home
  }
}

// ───────────────────────────────────────── comic chase ─────────────────────────────────────────

export const CHASE_MOODLETS: readonly MoodletDef[] = Object.freeze([
  {
    id: 'wildlife_got_away_again',
    label: 'Got Away Again!',
    description: 'So close. So very, very close. Tomorrow that squirrel is going down. (It is not.)',
    mood: 5,
    durationMin: 120,
    maxStacks: 1,
    icon: 'happy',
    kind: 'good',
    tags: ['wildlife', 'chase'],
  },
  {
    id: 'wildlife_squirrel_rage',
    label: 'Squirrel Rage',
    description: 'It chittered. From the branch. Mockingly.',
    mood: -3,
    durationMin: 60,
    maxStacks: 1,
    icon: 'angry',
    kind: 'bad',
    tags: ['wildlife', 'chase'],
  },
]);

export interface ChaseFrame {
  /** Seconds since the chase began. */
  t: number;
  zombie: Vec2;
  critter: Vec3;
  zombieAnim: 'chase' | 'lunge' | 'idle';
  critterAnim: string;
}

export interface ChaseResult {
  caught: false;
  durationSec: number;
  frames: ChaseFrame[];
  moodlet: 'wildlife_got_away_again' | 'wildlife_squirrel_rage';
}

const ZOMBIE_JOG = 2.5; // m/s
const CRITTER_FLEE = 4; // m/s, always faster than the zombie
const FRAME_SEC = 0.25;

const FLEE_ANIM: Record<WildlifeSpecies, [string, string]> = {
  songbird: ['takeoff', 'fly'],
  pigeon: ['takeoff', 'fly'],
  squirrel: ['run', 'climb'],
  bat: ['fly', 'fly'],
  frog: ['hop', 'hop'],
  firefly: ['glow', 'glow'],
};
const FLYERS: readonly WildlifeSpecies[] = ['songbird', 'pigeon', 'bat', 'firefly'];

/**
 * Play out a zombie chasing `target` from `zombieStart` at `tick`. Deterministic in (seed, target.id, tick).
 * The critter starts with a startle jump to at least CATCH_RADIUS + 0.2 m, then moves directly away faster than the
 * zombie closes, so the gap only grows; flyers also climb. After 4–8 s the zombie lunges, misses and stops.
 */
export function chaseCritter(seed: number, target: Critter, zombieStart: Vec2, tick: number, opts: { hotHeaded?: boolean } = {}): ChaseResult {
  const rng = streamFor(seed, `chase|${target.id}|${tick}`);
  const durationSec = 4 + Math.round(rng.next() * 16) / 4; // 4..8 s in 0.25 s steps
  let dx = target.pos.x - zombieStart.x;
  let dz = target.pos.z - zombieStart.z;
  let d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    const a = rng.next() * Math.PI * 2;
    dx = Math.sin(a);
    dz = Math.cos(a);
    d = 1;
  }
  const ux = dx / d;
  const uz = dz / d;
  const gap0 = Math.max(Math.hypot(target.pos.x - zombieStart.x, target.pos.z - zombieStart.z), CATCH_RADIUS + 0.2);
  const flyer = FLYERS.includes(target.species);
  const [startAnim, fleeAnim] = FLEE_ANIM[target.species];
  const frames: ChaseFrame[] = [];
  const steps = Math.round(durationSec / FRAME_SEC);
  for (let i = 0; i <= steps; i++) {
    const t = i * FRAME_SEC;
    const lungeFrom = durationSec - 0.75;
    const zt = Math.min(t, durationSec - 0.25); // zombie stands still on the final frame
    const zx = zombieStart.x + ux * ZOMBIE_JOG * zt;
    const zz = zombieStart.z + uz * ZOMBIE_JOG * zt;
    const gap = gap0 + (CRITTER_FLEE - ZOMBIE_JOG) * zt + (t - zt) * ZOMBIE_JOG;
    const y = flyer ? Math.max(target.pos.y, Math.min(6, target.pos.y + 1.5 * t)) : target.species === 'squirrel' && t > durationSec - 1 ? Math.min(2.5, (t - (durationSec - 1)) * 2.5) : 0;
    frames.push({
      t,
      zombie: { x: round(zx), z: round(zz) },
      critter: { x: round(zx + ux * gap), y: round(y), z: round(zz + uz * gap) },
      zombieAnim: i === steps ? 'idle' : t >= lungeFrom ? 'lunge' : 'chase',
      critterAnim: t < 0.5 ? startAnim : target.species === 'squirrel' && t > durationSec - 1 ? 'climb' : fleeAnim,
    });
  }
  return { caught: false, durationSec, frames, moodlet: opts.hotHeaded ? 'wildlife_squirrel_rage' : 'wildlife_got_away_again' };
}
