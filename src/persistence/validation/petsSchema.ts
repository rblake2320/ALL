/**
 * Structural schema for WorldState.pets (W-013, D-008; src/sim/types.ts PetsState). The field is OPTIONAL: a save
 * without it (written before pets existed) validates with NO issue and stays without the key; the pets system creates
 * it on init. A present-but-broken block is dropped (reported) and recreated empty; a broken stray / pet / runaway is
 * dropped on its own; unknown keys are removed; numbers are range-checked and strings bounded. Semantic healing
 * (duplicate ids, nextId) is the pets system's job (src/sim/systems/pets/state.ts).
 */
import type { PendingPetAction, PetBody, PetsState, PetState, RunawayState, StrayState, Vec2 } from '../../sim/types';
import { PET_ACTION_IDS, PET_ANIMS, PET_NEEDS, PET_VARIANT_IDS, PET_SPECIES, PET_TRAITS } from '../../sim/types';
import { type Check, INVALID, arr, fixedRec, lit, nullable, num, obj, rec, str, typeName } from './core';

export const PET_LIMITS = { maxList: 16, maxTick: 1e12 } as const;

const id = (re: RegExp): Check<string> => (v, ctx) => {
  const r = str({ nonEmpty: true, max: 16 })(v, ctx);
  if (r === INVALID) return r;
  return re.test(r) ? r : ctx.fail('bad id');
};
const tick = num({ int: true, min: 0, max: PET_LIMITS.maxTick, strict: true });
const pct = num({ min: 0, max: 100, strict: true });
const name = str({ nonEmpty: true, max: 40 });
const species = lit(PET_SPECIES);
const trait = lit(PET_TRAITS);
/** World tile coordinates; a missing / broken position is repaired to 0 and the pets system re-places the animal on load. */
const coord = num({ min: -1000, max: 1000, def: 0 });
const vec: Check<Vec2> = obj<Vec2>({ x: coord, z: coord }, { def: () => ({ x: 0, z: 0 }), keepExtra: false });
const body: { [K in keyof PetBody]-?: Check<PetBody[K]> } = {
  pos: vec,
  facing: num({ min: -100, max: 100, def: 0 }),
  anim: lit(PET_ANIMS, 'idle'),
  goal: nullable(vec),
  slot: num({ int: true, min: -2, max: PET_LIMITS.maxTick, def: -1 }),
  busyUntil: num({ int: true, min: 0, max: PET_LIMITS.maxTick, def: 0 }),
};

/** An optional field: absent stays absent (saves written before it existed are valid), present is checked. */
/**
 * A present-but-broken optional field is REPAIRED (dropped, with a note), never a reason to lose the pet, stray or runaway that
 * carries it: an owned pet must survive a malformed counter. The entity then behaves as an older save would.
 */
const optional = <T,>(check: Check<T>): Check<T | undefined> => (v, ctx) => {
  if (v === undefined) return undefined;
  const r = check(v, ctx);
  if (r === INVALID) {
    ctx.report('repaired', `optional field is malformed (${typeName(v)}); dropped, the entry is kept`);
    return undefined;
  }
  return r;
};
const optTick = optional(num({ int: true, min: 0, max: PET_LIMITS.maxTick, strict: true }));
const encSchema = optional(
  obj<{ day: number; n: Record<string, number> }>(
    { day: num({ int: true, min: 0, max: 1e9, def: 0 }), n: rec(num({ int: true, min: 0, max: 1000, def: 0 }), { def: () => ({}), maxKeys: 8, dropInvalid: true }) },
    { keepExtra: false },
  ),
);

const straySchema = obj<StrayState>(
  { id: id(/^s\d{1,9}$/), species, name, trait, place: lit(['street', 'graveyard'] as const), trust: pct, calmTick: tick, chaseCoolTick: num({ int: true, min: 0, max: PET_LIMITS.maxTick, def: 0 }), arrivedTick: tick, leaveTick: optTick, leaveDays: optional(num({ int: true, min: 1, max: 30, def: 3 })), ...body },
  { keepExtra: false },
);
const petSchema = obj<PetState>(
  {
    id: id(/^p\d{1,9}$/),
    species,
    name,
    trait,
    adoptedTick: tick,
    needs: fixedRec(PET_NEEDS, num({ min: 0, max: 100, def: 50 }), () => 50),
    neglectMin: num({ min: 0, max: 1e9, def: 0 }),
    guardUntil: num({ int: true, min: 0, max: PET_LIMITS.maxTick, def: 0 }),
    variant: lit(PET_VARIANT_IDS, 'normal'),
    enc: encSchema,
    ...body,
  },
  { keepExtra: false },
);
const pendingSchema = obj<PendingPetAction>(
  {
    agentId: str({ nonEmpty: true, max: 16 }),
    kind: lit(['stray', 'pet'] as const),
    targetId: str({ nonEmpty: true, max: 16 }),
    action: lit(PET_ACTION_IDS),
    uid: num({ int: true, min: 0, max: Number.MAX_SAFE_INTEGER, strict: true }),
    to: vec,
    tries: num({ int: true, min: 0, max: 9, def: 0 }),
    queuedTick: tick,
  },
  { keepExtra: false },
);
const awaySchema = obj<RunawayState>({ id: id(/^[ps]\d{1,9}$/), species, name, trait, returnTick: tick, trust: optional(pct), place: optional(lit(['street', 'graveyard'] as const)) }, { keepExtra: false });

const stateSchema: Check<PetsState> = obj<PetsState>(
  {
    version: lit([1] as const),
    nextId: num({ int: true, min: 1, max: 1e9, def: 1 }),
    strays: arr(straySchema, { def: () => [], max: PET_LIMITS.maxList }),
    pets: arr(petSchema, { def: () => [], max: PET_LIMITS.maxList }),
    away: arr(awaySchema, { def: () => [], max: PET_LIMITS.maxList }),
    pending: arr(pendingSchema, { def: () => [], max: 8 }),
  },
  { keepExtra: false },
);

/** OPTIONAL: absent stays absent silently; a broken block is dropped with a note (the pets system recreates it). */
export const petsSchema: Check<PetsState | undefined> = (v, ctx) => {
  if (v === undefined) return undefined;
  const r = stateSchema(v, ctx);
  if (r !== INVALID) return r;
  ctx.report('dropped', `${ctx.lastError.message}; strays and pets reset`);
  return undefined;
};
