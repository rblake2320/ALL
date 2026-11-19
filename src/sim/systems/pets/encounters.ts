/**
 * Pet rules from docs/contract-requests/living-things.md (owner direction 2026-11-12), pets part:
 *
 *  - BENEFIT BY CARE TIER: a looked-after pet gives the household company: care from 60 is full (+4 mood), from 25 half (+2),
 *    below 25 nothing. Care is the average of its four needs (`careOf`). Neglect never kills; it only withholds the benefit.
 *  - ENCOUNTERS, one data table (`PET_ENCOUNTERS`), seeded from the world seed, capped per game day:
 *      rival chase-off: a dog or cat that sees a stray dog or cat near the lot may chase it off for a few days
 *        (about 25 % per sighting, once a day per pet, never when its care is low);
 *      hunt chase: a cat after a songbird or pigeon, a dog after a squirrel: always a comic chase, the critter always
 *        escapes (its path is its own), never gore, at most twice a day;
 *      windfall: a well-cared pet occasionally brings a small find.
 *  - CAPS: new adoptions only (`PET_CAPS`: 3 in all, 2 of a species). An older save that holds more keeps them.
 *
 * Deterministic (D-003): every roll is a hash of (world seed, row, pet, other, day); no ctx.rng, no clock. Rolls happen once
 * per 15-minute slot. The table is validated by `validateEncounterTable` (tests refuse an uncapped or certain row).
 */
import { CARE_TIER_AT, LIVING_KINDS, TIER_WEIGHT, canFire, careOf, careTier, countersFor, recordFire, rollEncounter, seededUnit, type EncounterRow } from '../../../shared/livingThings';
import type { SimContext } from '../../contracts';
import { MOOD } from '../../content/home/ids';
import { syncMoodlet } from '../home/util';
import { timeInfo } from '../../time';
import type { PetState, StrayState, Vec2 } from '../../types';
import { ambientWildlife, type Critter } from '../wildlife';
import { SLOT_TICKS, holdFor, startFlee, ticksOf } from './motion';

export const PET_ENCOUNTERS: readonly EncounterRow[] = Object.freeze([
  { id: 'rivalChase', actorKind: 'pet', actorSpecies: ['dog', 'cat'], others: ['dog', 'cat'], chance: 0.25, maxPerDay: 1, group: 'rivalChase', minCare: CARE_TIER_AT.half },
  { id: 'huntChaseCat', actorKind: 'pet', actorSpecies: ['cat'], others: ['songbird', 'pigeon'], chance: 0.4, maxPerDay: 2, group: 'huntChase', minCare: CARE_TIER_AT.half },
  { id: 'huntChaseDog', actorKind: 'pet', actorSpecies: ['dog'], others: ['squirrel'], chance: 0.4, maxPerDay: 2, group: 'huntChase', minCare: CARE_TIER_AT.half },
  { id: 'windfall', actorKind: 'pet', actorSpecies: [], others: [], chance: 0.06, maxPerDay: 1, group: 'windfall', minCare: CARE_TIER_AT.full },
]);

/** How far (tiles) a pet sees a stray or a critter. */
export const SIGHT_RANGE = 7;
/** A chased-off stray stays away this many game days (2 to 4, by hash). */
export const CHASE_OFF_DAYS = Object.freeze({ min: 2, max: 4 });
/** A windfall is a few dollars: a find, never a wage. */
export const WINDFALL = Object.freeze({ min: 3, max: 12 });
/** Fun a hunt chase gives the pet (it enjoyed it). */
export const HUNT_FUN = 10;
const FRESH_LEAVE_MIN = 3;

/** Household mood from the pets' care tiers (the "benefit" of the living-things rule). */
export const PET_BENEFIT = Object.freeze({ halfFrom: 0.5, fullFrom: 1 });

export const petCare = (p: Pick<PetState, 'needs'>): number => careOf(p.needs as unknown as Record<string, number>, LIVING_KINDS.pet.needs);

/**
 * The household's pet company, 0 (none), 0.5 (half) or 1 (full): the sum of the pets' tier weights, capped at 1.
 * By design benefits ADD: two half-care pets give the full benefit, the same as one well-cared pet (the cap is the limit,
 * so a bigger household of lightly-cared pets cannot exceed one good one; reviewed and accepted, #109).
 */
export function petBenefitWeight(pets: readonly Pick<PetState, 'needs'>[]): number {
  return Math.min(1, pets.reduce((n, p) => n + TIER_WEIGHT[careTier(petCare(p))], 0));
}

/** Set the pet-company moodlet (none, half or full) on every household member who is home or at work. */
export function syncPetBenefit(ctx: SimContext): void {
  const ps = ctx.state.pets;
  const w = ps ? petBenefitWeight(ps.pets) : 0;
  const want = w >= PET_BENEFIT.fullFrom ? MOOD.petCompanyFull : w >= PET_BENEFIT.halfFrom ? MOOD.petCompanyHalf : null;
  for (const id of ctx.state.household?.memberIds ?? []) {
    const a = ctx.state.agents[id];
    if (!a || (a.presence !== 'onLot' && a.presence !== 'atWork')) continue;
    for (const m of [MOOD.petCompanyHalf, MOOD.petCompanyFull]) syncMoodlet(ctx, a, m, m === want);
  }
}

/** A stray the household has befriended (trust at or above this) is never chased off by their own pet. */
export const CHASE_OFF_MAX_TRUST = 40;

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const rowsFor = (kind: string, species: string): EncounterRow[] => PET_ENCOUNTERS.filter((r) => r.actorKind === kind && (r.actorSpecies.length === 0 || r.actorSpecies.includes(species)));

/** A chased-off stray runs away first and leaves the lot when the run is over. */
function chaseOff(ctx: SimContext, pet: PetState, stray: StrayState, key: string): void {
  const tick = ctx.state.tick;
  const days = CHASE_OFF_DAYS.min + Math.floor(seededUnit(ctx.state.seed, 'chaseOffDays', key) * (CHASE_OFF_DAYS.max - CHASE_OFF_DAYS.min + 1));
  startFlee(ctx, stray, pet.pos);
  stray.leaveTick = tick + ticksOf(FRESH_LEAVE_MIN);
  stray.leaveDays = days;
  chaseToward(ctx, pet, stray.pos, 0.6);
  ctx.notify({ kind: 'info', title: `${pet.name} saw off ${stray.name}`, text: `${pet.name} chased the stray ${stray.species} away from the lot. It will wander back in a few days.` });
}

/** The pet runs part of the way toward a point (it never goes through walls: it follows the lot's real walkable tiles). */
function chaseToward(ctx: SimContext, pet: PetState, to: Vec2, frac: number): void {
  pet.goal = { x: Math.round((pet.pos.x + (to.x - pet.pos.x) * frac) * 1000) / 1000, z: Math.round((pet.pos.z + (to.z - pet.pos.z) * frac) * 1000) / 1000 };
  pet.anim = 'run';
  pet.busyUntil = ctx.state.tick + ticksOf(4);
}

function huntChase(ctx: SimContext, pet: PetState, critter: Critter): void {
  chaseToward(ctx, pet, { x: critter.pos.x, z: critter.pos.z }, 0.7);
  pet.needs.fun = Math.min(100, pet.needs.fun + HUNT_FUN);
  ctx.notify({ kind: 'info', title: `${pet.name} chased a ${critter.species}`, text: `${pet.name} was after it with great intent. The ${critter.species} was never in any danger and got away.` });
}

function windfall(ctx: SimContext, pet: PetState, day: number): void {
  const dollars = WINDFALL.min + Math.floor(seededUnit(ctx.state.seed, 'windfallAmount', pet.id, day) * (WINDFALL.max - WINDFALL.min + 1));
  ctx.earn(dollars, `A find from ${pet.name}`, `petFind:${pet.id}:d${day}`);
  holdFor(ctx, pet, 'play', 6);
  ctx.notify({ kind: 'good', title: `${pet.name} brought something home`, text: `${pet.name} dropped a small find by the door: $${dollars}.` });
}

/**
 * One tick of pet encounters. Chased-off strays leave when their run ends; once per 15-minute slot every pet is offered each
 * of its rows (rival chase-off against strays in sight, hunt chase against critters in sight, a windfall), in id order, each
 * roll seeded and capped per game day.
 */
export function tickEncounters(ctx: SimContext): void {
  const ps = ctx.state.pets;
  if (!ps) return;
  const tick = ctx.state.tick;
  for (let i = ps.strays.length - 1; i >= 0; i--) {
    const s = ps.strays[i];
    if (typeof s.leaveTick !== 'number' || tick < s.leaveTick) continue;
    ps.strays.splice(i, 1);
    ps.away.push({ id: s.id, species: s.species, name: s.name, trait: s.trait, returnTick: tick + ticksOf((s.leaveDays ?? 3) * 24 * 60), trust: s.trust, place: s.place });
  }
  if (tick % SLOT_TICKS !== 0 || ps.pets.length === 0) return;
  const day = timeInfo(tick).day;
  const seed = ctx.state.seed;
  const lot = ctx.state.lot;
  let critters: readonly Critter[] | null = null;
  for (const pet of [...ps.pets].sort(byId)) {
    const rows = rowsFor('pet', pet.species);
    if (rows.length === 0) continue;
    const care = petCare(pet);
    let counters = countersFor(pet.enc, day);
    for (const row of rows) {
      if (care < row.minCare || !canFire(counters, row)) continue;
      if (row.id === 'rivalChase') {
        for (const stray of [...ps.strays].sort(byId)) {
          if (stray.leaveTick !== undefined || stray.trust >= CHASE_OFF_MAX_TRUST || !row.others.includes(stray.species) || dist(pet.pos, stray.pos) > SIGHT_RANGE) continue;
          if (!canFire(counters, row)) break;
          if (!rollEncounter(seed, row, pet.id, stray.id, day)) continue;
          counters = recordFire(counters, row);
          chaseOff(ctx, pet, stray, `${pet.id}|${stray.id}|${day}`);
        }
      } else if (row.group === 'huntChase') {
        critters ??= ambientWildlife(seed, 'home', tick, { width: lot?.width ?? 30, depth: lot?.depth ?? 30 });
        for (const c of critters) {
          if (!row.others.includes(c.species) || dist(pet.pos, { x: c.pos.x, z: c.pos.z }) > SIGHT_RANGE) continue;
          if (!canFire(counters, row)) break;
          if (!rollEncounter(seed, row, pet.id, c.id, day)) continue;
          counters = recordFire(counters, row);
          huntChase(ctx, pet, c);
        }
      } else if (row.id === 'windfall') {
        if (rollEncounter(seed, row, pet.id, day)) {
          counters = recordFire(counters, row);
          windfall(ctx, pet, day);
        }
      }
    }
    pet.enc = { day: counters.day, n: { ...counters.n } };
  }
}
