/**
 * Townie generation (24 townies from the world seed, GDD §11) and service NPC creation for SIM-HOME.
 * Generation uses its own RNG seeded from `state.seed`, so the cast of Wormwood Heights only depends on the
 * seed — not on how many random numbers other systems drew during world creation.
 */
import type { Rng, SimContext, TraitDef } from '../../../contracts';
import type { AgentId, AgentState, SkillId } from '../../../types';
import { SKILL_IDS } from '../../../types';
import { createRng, seedRngState } from '../../../rng';
import { ACCESSORIES, BOTTOM_STYLES, EYE_STYLES, HAIR_STYLES, SKIN_TONES, TOP_STYLES, intactLimbs } from '../../../../shared/appearance';
import type { ZombieAppearance } from '../../../../shared/appearance';
import { FIRST_NAMES, LAST_NAMES, OCCUPATIONS, SERVICE_NAMES } from '../../../content/people/names';
import { compareIds, flagNum, num, setFlag } from '../util';
import { SERVICE_BODIES, townieBodies, withCastBody } from './castBodies';

export const TOWNIE_COUNT = 24;
const GEN_FLAG = 'townies:generated';

const HAIR_COLORS = ['#3b2f2f', '#5a4632', '#2a2a33', '#7a6a5a', '#a8a090', '#6e2a35', '#3f5a4a', '#c9c2b0', '#4a3326', '#8a5a3a', '#5b3f6e'];
const CLOTH_COLORS = ['#6b4f8a', '#3a3f55', '#4a4a5e', '#5b3f6e', '#3f5a4a', '#6e3b3b', '#7a6a3a', '#2b2f3a', '#6d7275', '#8a6a4a', '#a5532f', '#d9cfb8', '#6e2a35'];
const SHOE_COLORS = ['#2a2420', '#3b2a22', '#1d1726', '#4b5156', '#4a3326'];
const EYE_COLORS = ['#f2e86d', '#9fe870', '#e8e0c8', '#ff9a4a', '#7fe0ff', '#c46b6b', '#d9cfb8'];

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng.next() * arr.length))];
}

export function randomAppearance(rng: Rng): ZombieAppearance {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    height: r2(rng.next()),
    build: r2(rng.next()),
    skinTone: rng.int(0, SKIN_TONES.length - 1),
    hairStyle: pick(rng, HAIR_STYLES),
    hairColor: pick(rng, HAIR_COLORS),
    topStyle: pick(rng, TOP_STYLES),
    topColor: pick(rng, CLOTH_COLORS),
    bottomStyle: pick(rng, BOTTOM_STYLES),
    bottomColor: pick(rng, CLOTH_COLORS),
    shoeColor: pick(rng, SHOE_COLORS),
    eyeStyle: pick(rng, EYE_STYLES),
    eyeColor: pick(rng, EYE_COLORS),
    accessory: rng.chance(0.45) ? 'none' : pick(rng, ACCESSORIES),
    stitches: rng.chance(0.7),
    voicePitch: r2(rng.next()),
  };
}

/** `count` personality traits with no conflicts in either direction (reward traits excluded). */
export function pickTraits(rng: Rng, traits: Record<string, TraitDef>, count = 3): string[] {
  const pool = Object.keys(traits)
    .filter((id) => traits[id] && !traits[id].reward)
    .sort();
  rng.shuffle(pool);
  const out: string[] = [];
  const clashes = (a: string, b: string) => !!traits[a]?.conflicts?.includes(b) || !!traits[b]?.conflicts?.includes(a);
  for (const id of pool) {
    if (out.length >= count) break;
    if (out.some((o) => clashes(o, id))) continue;
    out.push(id);
  }
  return out;
}

function randomSkills(rng: Rng): Partial<Record<SkillId, number>> {
  const skills: Partial<Record<SkillId, number>> = {};
  for (const s of SKILL_IDS) skills[s] = rng.chance(0.35) ? rng.int(1, 2) : 0;
  const strong = rng.shuffle([...SKILL_IDS]).slice(0, 2);
  for (const s of strong) skills[s] = rng.int(2, 6);
  return skills;
}

export function townieCount(ctx: SimContext): number {
  return Object.values(ctx.state.agents).filter((a) => a && a.role === 'townie').length;
}

/** Generate the town's townies once. Idempotent: returns how many were created this call. */
export function generateTownies(ctx: SimContext): number {
  const existing = townieCount(ctx);
  if (flagNum(ctx, GEN_FLAG, 0) > 0 || existing >= TOWNIE_COUNT) {
    if (flagNum(ctx, GEN_FLAG, 0) <= 0) setFlag(ctx, GEN_FLAG, existing);
    return 0;
  }
  const rng = createRng(seedRngState((Math.floor(num(ctx.state.seed, 1)) ^ 0x70776e1e) >>> 0));
  const first = ctx.content.names?.first?.length ? ctx.content.names.first : FIRST_NAMES;
  const last = ctx.content.names?.last?.length ? ctx.content.names.last : LAST_NAMES;
  const jobs = ctx.content.names?.occupations?.length ? ctx.content.names.occupations : OCCUPATIONS;
  const used = new Set(Object.values(ctx.state.agents).map((a) => `${a.firstName} ${a.lastName}`));
  const usedFirst = new Set(Object.values(ctx.state.agents).map((a) => a.firstName));
  // Cast bodies come from a hash of the seed + slot (castBodies.ts): no draw from `rng` or ctx.rng.
  const bodies = townieBodies(ctx.state.seed, TOWNIE_COUNT);
  let made = 0;
  for (let i = existing; i < TOWNIE_COUNT; i++) {
    let fn = pick(rng, first);
    let ln = pick(rng, last);
    for (let tries = 0; tries < 30 && (used.has(`${fn} ${ln}`) || usedFirst.has(fn)); tries++) {
      fn = pick(rng, first);
      ln = pick(rng, last);
    }
    used.add(`${fn} ${ln}`);
    usedFirst.add(fn);
    const needs = {
      hunger: rng.int(55, 90),
      energy: rng.int(55, 90),
      social: rng.int(45, 85),
      fun: rng.int(50, 90),
      hygiene: rng.int(55, 95),
      preservation: rng.int(60, 95),
    };
    const a = ctx.createAgent({
      role: 'townie',
      presence: 'offLot',
      firstName: fn,
      lastName: ln,
      appearance: withCastBody(randomAppearance(rng), bodies[i] ?? null),
      traits: pickTraits(rng, ctx.content.traits, 3),
      aspiration: null,
      occupation: pick(rng, jobs),
      needs,
      skills: randomSkills(rng),
    });
    a.vitality = rng.int(80, 100);
    if (a.needs.preservation > a.vitality) a.needs.preservation = a.vitality;
    made++;
  }
  setFlag(ctx, GEN_FLAG, townieCount(ctx));
  return made;
}

function serviceAppearance(kind: 'pizza' | 'repo', rng: Rng): ZombieAppearance {
  const base = randomAppearance(rng);
  // Same draws as before; the cast body is a constant per service (SERVICE_BODIES), so no rng is consumed for it.
  if (kind === 'pizza') return withCastBody({ ...base, topStyle: 'tee', topColor: '#a5532f', bottomStyle: 'pants', bottomColor: '#3a3f55', accessory: 'beanie', hairStyle: 'messy' }, SERVICE_BODIES.pizza);
  return withCastBody({ ...base, topStyle: 'suit', topColor: '#2b2f3a', bottomStyle: 'pants', bottomColor: '#2b2f3a', accessory: 'glasses', hairStyle: 'combover', eyeStyle: 'beady' }, SERVICE_BODIES.repo);
}

function resetService(a: AgentState): void {
  a.presence = 'offLot';
  a.queue = [];
  a.active = null;
  a.visit = null;
  a.walkBy = null;
  a.moodlets = [];
  a.limbs = intactLimbs();
  a.carrying = null;
  a.carryObjectId = null;
  a.needs = { hunger: 90, energy: 90, preservation: Math.min(90, num(a.vitality, 100)), social: 90, fun: 90, hygiene: 90 };
  if (a.status) {
    a.status.feral = false;
    a.status.passedOut = false;
    a.status.zeroPreservationMinutes = 0;
    a.status.autonomyCooldownUntil = 0;
  }
}

/** Create (not spawn) a service NPC: reuses an idle one of the same kind so saves don't fill up with ghouls. */
export function createService(ctx: SimContext, kind: unknown): AgentId {
  const k: 'pizza' | 'repo' = kind === 'repo' ? 'repo' : 'pizza';
  const spec = SERVICE_NAMES[k];
  const idle = Object.keys(ctx.state.agents)
    .sort(compareIds)
    .map((id) => ctx.state.agents[id])
    .find((a) => a && a.role === 'service' && a.occupation === spec.occupation && (a.presence === 'offLot' || a.presence === 'gone'));
  if (idle) {
    resetService(idle);
    return idle.id;
  }
  const a = ctx.createAgent({
    role: 'service',
    presence: 'offLot',
    firstName: spec.first[ctx.rng.int(0, spec.first.length - 1)],
    lastName: spec.last[ctx.rng.int(0, spec.last.length - 1)],
    appearance: serviceAppearance(k, ctx.rng),
    traits: [],
    aspiration: null,
    occupation: spec.occupation,
    needs: { hunger: 90, energy: 90, preservation: 90, social: 90, fun: 90, hygiene: 90 },
  });
  return a.id;
}
