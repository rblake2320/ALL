/**
 * W-013 (D-008) strays to pets — the runtime. Strays turn up on the street and in the graveyard on a fixed daily
 * schedule (cat, dog, raccoon, crow); the household can Chase them (they ALWAYS get away), Offer Scraps (costs a
 * leftover serving from a fridge, else a $5 snack), Pet or Befriend them, each raising the stray's trust. At trust
 * PET_ADOPT_TRUST a stray can be adopted for free and becomes a household pet with needs Appetite, Fun, Hygiene and
 * Affection that decay deterministically (traits Lazy / Guard / Curious / Thief bend the rates). Feed, Play and Cuddle
 * look after them. A neglected pet RUNS AWAY and comes back later as a stray that still half-remembers you — pets
 * never die and are never food (D-008, E10+).
 *
 * Deterministic: no ctx.rng (other systems' random streams stay untouched), no wall clock. Names and traits come from a
 * hash of (world seed, stray id); the arrival schedule is a pure function of the game day.
 */
import type { PetCommand, SimContext, SimSystem } from '../../contracts';
import { ENGINE_INTERACTIONS, PRIORITY } from '../../vocabulary';
import type { AgentState, PendingPetAction, PetActionId, PetNeedId, PetSpecies, PetState, PetsState, PetTrait, StrayPlace, StrayState } from '../../types';
import { PET_NEEDS, PET_SPECIES, PET_TRAITS, PET_VARIANT_IDS, TICK_MINUTES } from '../../types';
import { timeInfo } from '../../time';
import { leftoverCount, spoiledCount, takeServing } from '../home/food/leftovers';
import { sortedObjects } from '../home/util';
import { holdFor, holdStill, newBody, startFlee, stepPet, stepStray, strayArrivalPoint, householdCentre } from './motion';
import { createPetsState, healPetsState } from './state';
import { homeRegionIdOf } from '../../../shared/town';
import { PET_CAPS, adoptionRefusal } from '../../../shared/livingThings';
import { syncPetBenefit, tickEncounters } from './encounters';

export const PETS_SYSTEM_ID = 'pets';
export const PET_ADOPT_TRUST = 70;
export const MAX_STRAYS = 4;
/** Household cap for NEW adoptions (living-things.md section 2, data in shared/livingThings PET_CAPS: 3 in all, 2 of a species). */
export const MAX_PETS = PET_CAPS.household;
/** Snack price when no leftovers are in a fridge (the Brain Jerky price). */
export const SNACK_COST = 5;
/** Game minutes a stray needs between two trust-raising interactions. */
export const CALM_MIN = 30;
/** A pet whose average need is below this is neglected; NEGLECT_RUN_MIN neglected minutes in a row and it runs away. */
export const NEGLECT_AVG = 20;
export const NEGLECT_RUN_MIN = 24 * 60;
/** A runaway comes back as a stray this long after it left, trusting you this much. */
export const RETURN_MIN = 48 * 60;
export const RETURN_TRUST = 40;

/** How close (tiles) a zombie must be to an animal for its action to happen: it walks there first. */
export const REACH = 1.8;
/** A zombie that has not reached the animal after this long gives up (the player can also cancel the walk). */
export const APPROACH_TIMEOUT_MIN = 90;
/** An animal that moved on is followed this many times before the zombie gives up. */
export const APPROACH_MAX_TRIES = 3;

export const TRUST_GAIN = { offerScraps: 15, pet: 5, befriend: 10 } as const;
export const CHASE_TRUST_LOSS = 10;
/** A stray that was just chased bolts; chasing it again before this many game minutes are over is refused (no free fun). */
export const CHASE_COOL_MIN = 120;
export const CHASE_FUN = 5;
/** Pet needs: points lost per game hour (before trait multipliers). */
export const NEED_DECAY_PER_HOUR: Readonly<Record<PetNeedId, number>> = { appetite: 4, fun: 3, hygiene: 2, affection: 3 };
const TRAIT_MULT: Readonly<Record<PetTrait, Partial<Record<PetNeedId, number>>>> = {
  lazy: { fun: 0.5 },
  guard: { affection: 0.75 },
  curious: { fun: 1.5 },
  thief: { appetite: 1.5 },
};
export const CARE_GAIN = { feed: { appetite: 40 }, play: { fun: 35, hygiene: -5 }, cuddle: { affection: 35 } } as const;

/** Fixed arrival schedule: one stray a day, alternating street / graveyard, species rotating. */
export function scheduledArrival(day: number): { species: PetSpecies; place: StrayPlace } {
  const d = Math.max(0, Math.floor(day));
  return { species: PET_SPECIES[d % PET_SPECIES.length], place: d % 2 === 0 ? 'street' : 'graveyard' };
}

const NAMES: Readonly<Record<PetSpecies, readonly string[]>> = {
  cat: ['Mittens', 'Ash', 'Velvet', 'Tombstone'],
  dog: ['Biscuit', 'Digger', 'Bones', 'Rufus'],
  raccoon: ['Bandit', 'Rummage', 'Trashley', 'Socks'],
  crow: ['Caw', 'Inkwell', 'Shiny', 'Edgar'],
};

function hash(a: number, b: number): number {
  let h = (a ^ Math.imul(b | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const ticksOf = (min: number) => Math.max(1, Math.round(min / TICK_MINUTES));
const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

export function petsOf(ctx: SimContext): PetsState {
  if (!ctx.state.pets) ctx.state.pets = createPetsState();
  return ctx.state.pets;
}

function spawnStray(ctx: SimContext, species: PetSpecies, place: StrayPlace): StrayState | null {
  const ps = petsOf(ctx);
  if (ps.strays.length >= MAX_STRAYS) return null;
  const n = ps.nextId++;
  const h = hash(ctx.state.seed >>> 0, n);
  const s: StrayState = {
    id: `s${n}`,
    species,
    name: NAMES[species][h % NAMES[species].length],
    trait: PET_TRAITS[(h >>> 8) % PET_TRAITS.length],
    place,
    trust: 0,
    calmTick: 0,
    arrivedTick: ctx.state.tick,
    chaseCoolTick: 0,
    ...newBody(ctx, `s${n}`, strayArrivalPoint(ctx, `s${n}`, place)),
  };
  ps.strays.push(s);
  return s;
}

function arriveFor(ctx: SimContext, day: number): void {
  const a = scheduledArrival(day);
  spawnStray(ctx, a.species, a.place);
}

/** Pay for food: a FRESH leftover serving from the first fridge (by id) that has one (animals never get spoiled food), else a snack. */
function payFood(ctx: SimContext): true | string {
  for (const o of sortedObjects(ctx)) {
    if (leftoverCount(o) - spoiledCount(o) > 0 && takeServing(ctx, o)) return true;
  }
  return ctx.spend(SNACK_COST, 'Snack for an animal') ? true : 'No leftovers and no money for a snack';
}

function member(ctx: SimContext, id: unknown): AgentState | string {
  const a = typeof id === 'string' ? ctx.agent(id) : undefined;
  if (!a || !ctx.isHousehold(a)) return 'Only someone from the household can do that';
  if (a.presence !== 'onLot' || (a.regionId ?? homeRegionIdOf(ctx.state)) !== homeRegionIdOf(ctx.state)) return `${a.firstName} is not at home`;
  return a;
}

function performStray(ctx: SimContext, cmd: Extract<PetCommand, { strayId: string }>, agent: AgentState): true | string {
  const ps = petsOf(ctx);
  const s = ps.strays.find((x) => x.id === cmd.strayId);
  if (!s) return 'That stray is not around';
  const tick = ctx.state.tick;
  switch (cmd.action) {
    case 'chase':
      // A comic chase that never catches anything: the stray always escapes and trusts you a bit less. Once per
      // cool-down, so chasing is not an endless source of free fun.
      if (tick < s.chaseCoolTick) return `${s.name} is still on edge — give it a while`;
      s.chaseCoolTick = tick + ticksOf(CHASE_COOL_MIN);
      s.trust = clamp100(s.trust - CHASE_TRUST_LOSS);
      startFlee(ctx, s, agent.pos);
      ctx.changeNeed(agent, 'fun', CHASE_FUN);
      ctx.notify({ kind: 'info', title: `${s.name} got away`, text: `${agent.firstName} chased the ${s.species}. It was never in any danger.`, agentId: agent.id });
      return true;
    case 'adopt': {
      if (s.trust < PET_ADOPT_TRUST) return `${s.name} does not trust you enough yet (${Math.floor(s.trust)}/${PET_ADOPT_TRUST})`;
      const refused = adoptionRefusal(PET_CAPS, ps.pets, s.species);
      if (refused) return refused;
      ps.strays.splice(ps.strays.indexOf(s), 1);
      const pet: PetState = {
        id: s.id.replace(/^s/, 'p'),
        species: s.species,
        name: s.name,
        trait: s.trait,
        adoptedTick: tick,
        needs: { appetite: 80, fun: 80, hygiene: 80, affection: 80 },
        neglectMin: 0,
        guardUntil: 0,
        variant: 'normal',
        // it keeps standing where the stray stood and walks home on its own
        pos: { ...s.pos },
        facing: s.facing,
        anim: 'idle',
        goal: null,
        slot: -1,
        busyUntil: 0,
      };
      ps.pets.push(pet);
      ctx.changeNeed(agent, 'social', 10);
      ctx.notify({ kind: 'good', title: `${pet.name} moved in`, text: `${agent.firstName} adopted ${pet.name} the ${pet.species}.`, agentId: agent.id });
      return true;
    }
    default: {
      if (tick < s.calmTick) return `${s.name} needs a little space first`;
      if (cmd.action === 'pet' && s.trust < 20) {
        s.calmTick = tick + ticksOf(CALM_MIN);
        return `${s.name} dodged the hand — try scraps first`;
      }
      if (cmd.action === 'offerScraps') {
        const paid = payFood(ctx);
        if (paid !== true) return paid;
      }
      s.trust = clamp100(s.trust + TRUST_GAIN[cmd.action]);
      s.calmTick = tick + ticksOf(CALM_MIN);
      if (cmd.action === 'offerScraps') holdFor(ctx, s, 'eat', 10);
      else holdFor(ctx, s, 'sit', 5);
      if (cmd.action !== 'offerScraps') ctx.changeNeed(agent, 'social', 3);
      return true;
    }
  }
}

function performPet(ctx: SimContext, cmd: Extract<PetCommand, { action: 'feed' | 'play' | 'cuddle' }>, agent: AgentState): true | string {
  const p = petsOf(ctx).pets.find((x) => x.id === cmd.petId);
  if (!p) return 'That pet is not here';
  if (cmd.action === 'feed') {
    const paid = payFood(ctx);
    if (paid !== true) return paid;
  }
  const gain = CARE_GAIN[cmd.action] as Partial<Record<PetNeedId, number>>;
  for (const k of PET_NEEDS) if (gain[k]) p.needs[k] = clamp100(p.needs[k] + gain[k]!);
  if (cmd.action === 'play') ctx.changeNeed(agent, 'fun', 10);
  if (cmd.action === 'cuddle') ctx.changeNeed(agent, 'social', 8);
  if (cmd.action === 'feed') holdFor(ctx, p, 'eat', 15);
  else if (cmd.action === 'play') holdFor(ctx, p, 'play', 20);
  else holdFor(ctx, p, 'sit', 10);
  return true;
}

const STRAY_ACTIONS: readonly string[] = ['chase', 'offerScraps', 'pet', 'befriend', 'adopt'];

function perform(ctx: SimContext, c: PetCommand, agent: AgentState): true | string {
  if (STRAY_ACTIONS.includes(c.action)) return performStray(ctx, c as Extract<PetCommand, { strayId: string }>, agent);
  return performPet(ctx, c as Extract<PetCommand, { action: 'feed' | 'play' | 'cuddle' }>, agent);
}

function animalAt(ctx: SimContext, kind: 'stray' | 'pet', id: string): { pos: { x: number; z: number }; name: string } | null {
  const ps = ctx.state.pets;
  const a = ps ? (kind === 'stray' ? ps.strays : ps.pets).find((x) => x.id === id) : undefined;
  return a ? { pos: a.pos, name: a.name } : null;
}

/** Send the zombie to the animal: an ordinary `engine_goHere` walk (so it shows in the queue and can be cancelled). */
function sendTo(ctx: SimContext, agent: AgentState, p: Omit<PendingPetAction, 'uid' | 'to'>): true | string {
  const a = animalAt(ctx, p.kind, p.targetId);
  if (!a) return p.kind === 'stray' ? 'That stray is not around' : 'That pet is not here';
  let to: { x: number; z: number } | null = null;
  try {
    to = ctx.spatial.nearestWalkable(a.pos, 3);
  } catch {
    to = null;
  }
  if (!to) return `Can't get to ${a.name}`;
  const qi = ctx.queue(agent, { interactionId: ENGINE_INTERACTIONS.goHere, target: { kind: 'tile', x: to.x, z: to.z }, source: 'player', priority: PRIORITY.player });
  if (!qi) return `${agent.firstName} can't go there right now`;
  petsOf(ctx).pending.push({ ...p, uid: qi.uid, to: { x: to.x + 0.5, z: to.z + 0.5 } });
  return true;
}

export function command(ctx: SimContext, cmd: unknown): true | string {
  if (!cmd || typeof cmd !== 'object') return "Can't do that";
  const c = cmd as PetCommand;
  if (c.action === 'look') {
    // A look is a cosmetic choice: no zombie walks anywhere. Which variants a player may pick is the game layer's call.
    const p = petsOf(ctx).pets.find((x) => x.id === c.petId);
    if (!p) return 'That pet is not here';
    if (!(PET_VARIANT_IDS as readonly string[]).includes(c.variant)) return 'Unknown look';
    p.variant = c.variant;
    return true;
  }
  const agent = member(ctx, c.agentId);
  if (typeof agent === 'string') return agent;
  const isStray = STRAY_ACTIONS.includes(c.action);
  const isCare = c.action === 'feed' || c.action === 'play' || c.action === 'cuddle';
  if (!isStray && !isCare) return 'Unknown pet action';
  const kind = isStray ? 'stray' : 'pet';
  const id = isStray ? (c as { strayId?: unknown }).strayId : (c as { petId?: unknown }).petId;
  if (typeof id !== 'string') return isStray ? 'That stray is not around' : 'That pet is not here';
  const a = animalAt(ctx, kind, id);
  if (!a) return isStray ? 'That stray is not around' : 'That pet is not here';
  // refuse what can never work before anybody walks anywhere
  const ps = petsOf(ctx);
  if (c.action === 'adopt') {
    const s = ps.strays.find((x) => x.id === id)!;
    if (s.trust < PET_ADOPT_TRUST) return `${s.name} does not trust you enough yet (${Math.floor(s.trust)}/${PET_ADOPT_TRUST})`;
    const refused = adoptionRefusal(PET_CAPS, ps.pets, s.species);
    if (refused) return refused;
  }
  if (agent.presence !== 'onLot') return `${agent.firstName} is not at home`;
  // one errand at a time per zombie
  for (let i = ps.pending.length - 1; i >= 0; i--) {
    if (ps.pending[i].agentId !== agent.id) continue;
    ctx.cancel(agent, ps.pending[i].uid, 'Changed their mind');
    ps.pending.splice(i, 1);
  }
  if (Math.hypot(agent.pos.x - a.pos.x, agent.pos.z - a.pos.z) <= REACH) return perform(ctx, c, agent);
  return sendTo(ctx, agent, { agentId: agent.id, kind, targetId: id, action: c.action as PetActionId, tries: 0, queuedTick: ctx.state.tick });
}

function stillWalking(agent: AgentState, uid: number): boolean {
  return agent.active?.uid === uid || agent.queue.some((q) => q.uid === uid);
}

/** The zombies' walks to animals: do the action on arrival, follow an animal that moved on, drop what was cancelled. */
function tickPending(ctx: SimContext, ps: PetsState): void {
  const tick = ctx.state.tick;
  for (let i = 0; i < ps.pending.length; ) {
    const p = ps.pending[i];
    const agent = ctx.agent(p.agentId);
    const a = animalAt(ctx, p.kind, p.targetId);
    const drop = () => void ps.pending.splice(i, 1);
    if (!agent || !a || agent.presence !== 'onLot' || (agent.regionId ?? homeRegionIdOf(ctx.state)) !== homeRegionIdOf(ctx.state)) {
      if (agent && stillWalking(agent, p.uid)) ctx.cancel(agent, p.uid, 'It is gone');
      drop();
      continue;
    }
    if (Math.hypot(agent.pos.x - a.pos.x, agent.pos.z - a.pos.z) <= REACH) {
      if (stillWalking(agent, p.uid)) ctx.cancel(agent, p.uid, 'Arrived');
      drop();
      const cmd = (p.kind === 'stray' ? { action: p.action, agentId: p.agentId, strayId: p.targetId } : { action: p.action, agentId: p.agentId, petId: p.targetId }) as PetCommand;
      const r = perform(ctx, cmd, agent);
      if (r !== true) ctx.notify({ kind: 'info', title: `${agent.firstName} and ${a.name}`, text: r, agentId: agent.id });
      continue;
    }
    if (stillWalking(agent, p.uid)) {
      if (tick - p.queuedTick > ticksOf(APPROACH_TIMEOUT_MIN)) {
        ctx.cancel(agent, p.uid, 'Took too long');
        drop();
        continue;
      }
      i++;
      continue;
    }
    // the walk is over: it reached the tile (the animal moved on: follow it) or was cancelled / interrupted (give up)
    const reached = Math.hypot(agent.pos.x - p.to.x, agent.pos.z - p.to.z) < 1.2;
    drop();
    if (reached && p.tries < APPROACH_MAX_TRIES) {
      const again = sendTo(ctx, agent, { agentId: p.agentId, kind: p.kind, targetId: p.targetId, action: p.action, tries: p.tries + 1, queuedTick: p.queuedTick });
      if (again === true) continue;
    } else if (reached) {
      ctx.notify({ kind: 'info', title: `${a.name} wandered off`, text: `${agent.firstName} could not catch up with ${a.name}.`, agentId: agent.id });
    }
  }
}

/** Decay pet needs, run away after long neglect, bring runaways back as strays. */
export function tickPets(ctx: SimContext, dtMin: number): void {
  const ps = ctx.state.pets;
  if (!ps || !(dtMin > 0)) return;
  const tick = ctx.state.tick;
  tickPending(ctx, ps);
  tickEncounters(ctx);
  // an animal a zombie is walking to stands still for it
  const waiting = new Set(ps.pending.map((p) => `${p.kind}:${p.targetId}`));
  for (const s of ps.strays) (waiting.has(`stray:${s.id}`) ? holdStill(ctx, s) : stepStray(ctx, s));
  for (const p of ps.pets) (waiting.has(`pet:${p.id}`) ? holdStill(ctx, p) : stepPet(ctx, p));
  for (let i = ps.pets.length - 1; i >= 0; i--) {
    const p = ps.pets[i];
    for (const k of PET_NEEDS) p.needs[k] = clamp100(p.needs[k] - (NEED_DECAY_PER_HOUR[k] * (TRAIT_MULT[p.trait][k] ?? 1) * dtMin) / 60);
    const avg = PET_NEEDS.reduce((sum, k) => sum + p.needs[k], 0) / PET_NEEDS.length;
    p.neglectMin = avg < NEGLECT_AVG ? p.neglectMin + dtMin : 0;
    if (p.neglectMin >= NEGLECT_RUN_MIN) {
      ps.pets.splice(i, 1);
      ps.away.push({ id: p.id, species: p.species, name: p.name, trait: p.trait, returnTick: tick + ticksOf(RETURN_MIN) });
      ctx.notify({ kind: 'bad', title: `${p.name} ran away`, text: `Nobody looked after ${p.name}. Maybe the ${p.species} will wander back one day.` });
    }
  }
  for (let i = 0; i < ps.away.length; ) {
    const r = ps.away[i];
    // A runaway always comes home (the MAX_STRAYS cap only limits scheduled arrivals).
    if (tick < r.returnTick) {
      i++;
      continue;
    }
    ps.away.splice(i, 1);
    const sid = `s${ps.nextId++}`;
    const place = r.place ?? 'street';
    ps.strays.push({ id: sid, species: r.species, name: r.name, trait: r.trait, place, trust: r.trust ?? RETURN_TRUST, calmTick: 0, chaseCoolTick: 0, arrivedTick: tick, ...newBody(ctx, sid, strayArrivalPoint(ctx, sid, place)) });
    ctx.notify({ kind: 'info', title: `${r.name} is back`, text: `${r.name} the ${r.species} is hanging around the ${place === 'street' ? 'street' : 'graveyard'} again.` });
  }
}

export function createPetsSystem(): SimSystem {
  return {
    id: PETS_SYSTEM_ID,
    init(ctx, loaded) {
      if (ctx.state.pets) {
        healPetsState(ctx.state);
        healBodies(ctx);
        return;
      }
      if (loaded) {
        // A save written before pets existed: start it with a stray on the street and one in the graveyard too.
        ctx.state.pets = createPetsState();
        const day = timeInfo(ctx.state.tick).day;
        arriveFor(ctx, day);
        arriveFor(ctx, day + 1);
        return;
      }
      ctx.state.pets = createPetsState();
      // Day 0 / day 1 arrivals so a new game has a stray on the street and one in the graveyard.
      arriveFor(ctx, 0);
      arriveFor(ctx, 1);
    },
    dayStart(ctx, day) {
      arriveFor(ctx, day + 1);
    },
    hour(ctx) {
      syncPetBenefit(ctx);
    },
    tick(ctx, dtMin) {
      tickPets(ctx, dtMin);
    },
    api: {
      command: (cmd: unknown, ctx: SimContext) => command(ctx, cmd),
      view: (ctx: SimContext) => (ctx.state.pets ? JSON.parse(JSON.stringify(ctx.state.pets)) : null),
    },
  };
}

/** Give every stray and pet a usable position (a save that has none, or a broken one): strays on their street, pets at home. */
function healBodies(ctx: SimContext): void {
  const ps = ctx.state.pets;
  if (!ps) return;
  const ok = (v: unknown): boolean => !!v && typeof (v as { x: unknown }).x === 'number' && Number.isFinite((v as { x: number }).x) && typeof (v as { z: unknown }).z === 'number' && Number.isFinite((v as { z: number }).z);
  for (const s of ps.strays) if (!ok(s.pos)) Object.assign(s, newBody(ctx, s.id, strayArrivalPoint(ctx, s.id, s.place)));
  for (const p of ps.pets) if (!ok(p.pos)) Object.assign(p, newBody(ctx, p.id, householdCentre(ctx)));
}

export const petsSystem = createPetsSystem();
