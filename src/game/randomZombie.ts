/**
 * Seeded random zombies for Create-a-Zombie ("Randomize"), the default household and the menu demo world.
 * Deterministic for a given seed (xoshiro128** from src/sim/rng.ts) and always valid by validateCazState:
 * 3 non-conflicting non-reward traits, a known aspiration, usable names unique within the household.
 */
import type { Rng, NewMemberSpec } from '../sim/contracts';
import type { CazState } from './contracts';
import { createRng, seedRngState } from '../sim/rng';
import {
  ACCESSORIES,
  BOTTOM_STYLES,
  EYE_STYLES,
  HAIR_STYLES,
  SKIN_TONES,
  TOP_STYLES,
  type ZombieAppearance,
} from '../shared/appearance';
import { CAST_BODY_IDS, type CastBodyId } from '../shared/cast';
import { traitsConflict, type CazCatalog } from './gddCatalog';
import { TRAITS_PER_ZOMBIE, VOICE_SEED_MAX } from './cazState';
import { NAME_MAX, nameKey, nameLength } from './names';

/** Muted, art-direction-friendly palettes (ART_DIRECTION.md). */
export const HAIR_COLORS = ['#3b2f2f', '#1f1a1c', '#6b4a32', '#a67b4f', '#c9c2b0', '#e8e0c8', '#7a3b2e', '#4f5e45', '#5b3f6e', '#2b2f3a'] as const;
export const CLOTH_COLORS = [
  '#6b4f8a', '#3a3f55', '#6e2a35', '#a5532f', '#6f8f5e', '#5e4030', '#7a8a8a', '#2b2f3a', '#8e6a6a', '#c9b9a0', '#4a3259', '#3e4f3a',
] as const;
export const SHOE_COLORS = ['#2a2420', '#3b2f2f', '#1f1a1c', '#5e4030', '#4a3028'] as const;
export const EYE_COLORS = ['#f2e86d', '#9fe870', '#d9cfb8', '#7fe0ff', '#ff9a4a', '#e8e0c8', '#c94c4c'] as const;

export function rngFromSeed(seed: number): Rng {
  return createRng(seedRngState(Number.isFinite(seed) ? seed >>> 0 : 0));
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rng.next() * list.length))];
}

function round2(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}

export function randomAppearance(rng: Rng): ZombieAppearance {
  const top = pick(rng, TOP_STYLES);
  return {
    height: round2(0.15 + rng.next() * 0.7),
    build: round2(0.1 + rng.next() * 0.8),
    skinTone: rng.int(0, SKIN_TONES.length - 1),
    hairStyle: pick(rng, HAIR_STYLES),
    hairColor: pick(rng, HAIR_COLORS),
    topStyle: top,
    topColor: pick(rng, CLOTH_COLORS),
    // A dress already covers the legs: give it the shortest bottom so the silhouette reads.
    bottomStyle: top === 'dress' ? 'shorts' : pick(rng, BOTTOM_STYLES),
    bottomColor: pick(rng, CLOTH_COLORS),
    shoeColor: pick(rng, SHOE_COLORS),
    eyeStyle: pick(rng, EYE_STYLES),
    eyeColor: pick(rng, EYE_COLORS),
    accessory: rng.chance(0.4) ? 'none' : pick(rng, ACCESSORIES),
    stitches: rng.chance(0.7),
    voicePitch: round2(rng.next()),
  };
}

/** Share of randomized zombies that get a sculpted cast body (shared/cast.ts) instead of the procedural one. */
export const CAST_BODY_CHANCE = 0.5;

/** 32-bit integer mix (lowbias32): a pure hash, so choosing a body never shifts the generator's stream. */
export function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Cast body (or null = classic) for a 32-bit key: ~CAST_BODY_CHANCE cast, uniform over all 25 bodies. */
export function bodyForKey(key: number): CastBodyId | null {
  const h = mix32(key ^ 0xb0d1e5);
  if (h / 0x1_0000_0000 >= CAST_BODY_CHANCE) return null;
  return CAST_BODY_IDS[mix32(h ^ 0x9e3779b9) % CAST_BODY_IDS.length];
}

/** `app` with its body set to `body` (null = classic: the key is removed, never stored as 'classic'). */
export function withBody(app: ZombieAppearance, body: CastBodyId | null): ZombieAppearance {
  const rest: ZombieAppearance = { ...app };
  delete rest.body;
  return body ? { ...rest, body } : rest;
}

/** Up to `count` mutually compatible non-reward traits (fewer only if the catalog cannot supply them). */
export function randomTraits(rng: Rng, catalog: CazCatalog, count: number = TRAITS_PER_ZOMBIE): string[] {
  const pool = catalog.traitIds.filter((id) => catalog.traits[id] && !catalog.traits[id].reward);
  rng.shuffle(pool);
  const chosen: string[] = [];
  for (const id of pool) {
    if (chosen.length >= count) break;
    if (chosen.some((c) => c === id || traitsConflict(catalog, c, id))) continue;
    chosen.push(id);
  }
  return chosen;
}

export function randomAspiration(rng: Rng, catalog: CazCatalog): string | null {
  return catalog.aspirationIds.length > 0 ? pick(rng, catalog.aspirationIds) : null;
}

const NUMERALS = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function fitName(base: string, suffix: string): string {
  const room = NAME_MAX - nameLength(suffix) - 1;
  const cps = Array.from(base).slice(0, Math.max(1, room));
  return `${cps.join('').trim()} ${suffix}`;
}

/** A first name not in `taken` (case-insensitive). Falls back to "Name II", "Name III", ... */
export function uniqueFirstName(rng: Rng, catalog: CazCatalog, taken: ReadonlySet<string>): string {
  const isFree = (n: string): boolean => !taken.has(nameKey(n));
  for (let attempt = 0; attempt < 24; attempt++) {
    const n = pick(rng, catalog.firstNames);
    if (isFree(n)) return n;
  }
  for (const n of catalog.firstNames) if (isFree(n)) return n;
  const base = pick(rng, catalog.firstNames);
  for (const s of NUMERALS) {
    const n = fitName(base, s);
    if (isFree(n)) return n;
  }
  // Practically unreachable (needs > 10 identical households members); still valid and unique.
  return fitName(base, String(taken.size + 2));
}

export function randomLastName(rng: Rng, catalog: CazCatalog): string {
  return pick(rng, catalog.lastNames);
}

export interface RandomZombieOptions {
  lastName?: string;
  takenFirstNames?: Iterable<string>;
}

export function randomZombie(rng: Rng, catalog: CazCatalog, opts: RandomZombieOptions = {}): NewMemberSpec {
  const taken = new Set<string>();
  for (const n of opts.takenFirstNames ?? []) if (typeof n === 'string') taken.add(nameKey(n));
  const firstName = uniqueFirstName(rng, catalog, taken);
  const lastName = opts.lastName && opts.lastName.trim().length > 0 ? opts.lastName.trim() : randomLastName(rng, catalog);
  const appearance = randomAppearance(rng);
  const traits = randomTraits(rng, catalog);
  const aspiration = randomAspiration(rng, catalog);
  // Drawn last so every other field stays what the same seed produced before voice seeds existed. The CAZ voice
  // preview and the in-game zombie both use it (contract #17).
  const voiceSeed = rng.int(1, VOICE_SEED_MAX);
  // The body is a pure function of the voice seed (no extra draw), so every seeded household — including the balance
  // harness's — keeps exactly the names/traits/looks it had before cast bodies existed.
  return { firstName, lastName, appearance: withBody(appearance, bodyForKey(voiceSeed)), traits, aspiration, voiceSeed };
}

export type RandomizeWhat = 'all' | 'look' | 'traits' | 'name';

/** Re-roll part of a member; `others` are the household's other first names (kept unique). */
export function randomizeMember(
  member: NewMemberSpec,
  what: RandomizeWhat,
  rng: Rng,
  catalog: CazCatalog,
  others: Iterable<string>,
): NewMemberSpec {
  const taken = new Set<string>();
  for (const n of others) if (typeof n === 'string') taken.add(nameKey(n));
  switch (what) {
    case 'look':
      // Drawn after the appearance (nothing else follows in this branch), so the stream for the look is unchanged.
      return { ...member, appearance: withBody(randomAppearance(rng), bodyForKey(rng.int(0, 0x7fffffff))), traits: member.traits.slice() };
    case 'traits':
      return { ...member, appearance: { ...member.appearance }, traits: randomTraits(rng, catalog) };
    case 'name':
      return { ...member, appearance: { ...member.appearance }, traits: member.traits.slice(), firstName: uniqueFirstName(rng, catalog, taken) };
    case 'all':
    default: {
      const z = randomZombie(rng, catalog, { lastName: member.lastName, takenFirstNames: taken });
      return z;
    }
  }
}

/** A seeded household of `count` members sharing a family name. */
export function randomHousehold(seed: number, catalog: CazCatalog, count: number): { householdName: string; members: NewMemberSpec[] } {
  const rng = rngFromSeed(seed);
  const lastName = randomLastName(rng, catalog);
  const members: NewMemberSpec[] = [];
  const n = Math.max(1, Math.min(4, Math.floor(Number.isFinite(count) ? count : 1)));
  for (let i = 0; i < n; i++) {
    members.push(randomZombie(rng, catalog, { lastName, takenFirstNames: members.map((m) => m.firstName) }));
  }
  return { householdName: lastName, members };
}

/** Fresh CAZ state with one random member. */
export function initialCaz(seed: number, catalog: CazCatalog): CazState {
  const { householdName, members } = randomHousehold(seed, catalog, 1);
  return {
    members,
    activeIndex: 0,
    householdName,
    // W-113: the derelict claim (story start) is the default New Game lot; 'starter' when a catalog lacks it.
    lotTemplate: catalog.lotTemplateIds.includes('derelict') ? 'derelict' : catalog.lotTemplateIds.includes('starter') ? 'starter' : (catalog.lotTemplateIds[0] as CazState['lotTemplate']),
    difficulty: 'normal',
  };
}
