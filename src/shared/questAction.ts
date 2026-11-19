/**
 * W-123 (D-070): "Go do it" for every quest, daily-task and weekly-challenge row. The owner's request: "if I see a
 * quest or something I should be able to click that thing and then have my people just be able to go to the thing I
 * clicked".
 *
 * PURE and read-only: (step, world view, selected agent) → one QuestAction. It never touches the sim: the world view
 * is the read side of SimulationAPI (state, content, spatial, menu), and the only thing the caller may do with a
 * `queue` result is dispatch the ordinary player `queue` command the interaction menu would have dispatched (so the
 * click is journaled like any player action and adds no sim state).
 *
 * Shape: `resolveActivity(goal, worldView, agent, opts)` is the core — goal = a step objective, a household activity
 * category ({ category: 'clean' }, W-124) or explicit routes — returning RANKED candidates plus one answer;
 * `resolveQuestAction` is a thin wrapper over it. Targets another household member already queued are skipped, and
 * candidate places are lot-local tiles of the active lot (never neighbourhood-map coordinates, src/shared/world.ts).
 *
 * Contract (docs/DECISIONS.md D-070):
 *  - `queue`   the best interaction that advances the step: the nearest REACHABLE valid target (path cost from the
 *              engine's own distance field), validated by the engine's own `menu(actor, target)` — the same
 *              availability rules and reasons the interaction menu shows, so it never proposes something the menu
 *              would refuse. Ties: path cost, then the route's interaction order, then the target id (o2 < o10),
 *              then the menu child order. `already: true` when that exact action is already queued or running.
 *  - `mode`    steps the player does by hand: Build with the wall tool, Buy on a category (with a filter), or the
 *              careers dialog for "get a job".
 *  - `missing` an action step whose object is not on the lot ("Needs an easel") with the Buy-catalog filter of the
 *              buyable objects that would satisfy it.
 *  - `blocked` the step cannot be done right now, with the engine's own reason ("Needs an arm", "In use", "No bills
 *              to pay") or ours ("Nothing is broken right now", "Already done"). Never silent.
 *
 * Routes are DATA (STAT_ROUTES, SKILL_ROUTES, the objective's own ids/tags/match/targetTags), so a new quest, daily
 * task or weekly challenge that reuses an objective vocabulary works without code. `questPlan` covers every
 * ObjectiveDef kind (exhaustive switch), and tests/unit/shared/questAction.test.ts iterates every shipped step so an
 * unhandled one (a new stat key, a new kind) cannot ship.
 */
import type { ContentRegistry, InteractionDef, MenuEntry, ObjectDef, ObjectiveDef, SpatialAPI } from '../sim/contracts';
import type { AgentState, ObjectState, TargetRef, WorldState } from '../sim/types';
import { BUY_CATEGORIES } from './catalog';
import { homeRegionIdOf } from './town';

// ───────────────────────────── public types ─────────────────────────────

export type QuestActionKind = 'queue' | 'mode' | 'missing' | 'blocked';
export const QUEST_ACTION_KINDS: readonly QuestActionKind[] = ['queue', 'mode', 'missing', 'blocked'];

/** What the Buy catalog shows for a `missing` / `mode: 'buy'` result (object def ids, the tab to open, a label). */
export interface QuestBuyFilter {
  defIds: string[];
  category: string;
  /** "an easel", "a fridge or a stove". */
  label: string;
}

export type BlockedCode = 'done' | 'invalid' | 'unknown' | 'nobody' | 'away' | 'agent' | 'none' | 'wait';

export type QuestAction =
  | {
      kind: 'queue';
      agentId: string;
      interactionId: string;
      target: TargetRef;
      /** The object the action happens at (null for socials and phone calls). */
      objectId: string | null;
      /** Params of the chosen menu entry / child (recipe, genre, townieId, …) — the `params` of the queue command. */
      extra: Record<string, string | number | boolean>;
      /** Menu label of the chosen entry ("Paint", "Brain Loaf"). */
      label: string;
      /** "Morbid Easel", "Mort" — null for the phone. */
      targetName: string | null;
      /** Path cost from the agent (0 = here / phone). */
      cost: number;
      /** The same action is already queued or running: do not queue it again. */
      already: boolean;
      /** The agent is asleep or busy with a player order: the action waits its turn. */
      wait: 'asleep' | 'busy' | null;
    }
  | { kind: 'mode'; mode: 'build'; tool: 'wall'; count: number; hint: string }
  | { kind: 'mode'; mode: 'buy'; category: string; buyFilter: QuestBuyFilter | null; hint: string }
  | { kind: 'mode'; mode: 'dialog'; dialog: 'careers'; hint: string }
  | { kind: 'missing'; need: string; buyFilter: QuestBuyFilter }
  | { kind: 'blocked'; reason: string; code: BlockedCode };

/** The read side of SimulationAPI the resolver needs. */
export interface QuestWorldView {
  readonly state: WorldState;
  readonly content: Pick<ContentRegistry, 'objects' | 'interactions'>;
  readonly spatial?: Pick<SpatialAPI, 'distanceField' | 'tileIndex' | 'inBounds' | 'resolveSlots' | 'objectTiles'> | null;
  menu(actorId: string, target: TargetRef): MenuEntry[];
}

/** Where a candidate is: LOT-LOCAL tiles of the active lot (`lotId` from WorldState.town once travel lands, else
 *  null = the one simulated lot). Never world / neighbourhood-map coordinates (src/shared/world.ts LotDef.mapX/Z). */
export interface ActivityPlace {
  space: 'lot';
  lotId: string | null;
  x: number | null;
  z: number | null;
}

/** One ranked (target, interaction) pair the engine's menu accepts for this agent right now. */
export interface ActivityCandidate {
  action: Extract<QuestAction, { kind: 'queue' }>;
  /** [route, path cost, interaction order, target order, menu child] — lower first. */
  rank: number[];
  place: ActivityPlace | null;
}

/**
 * What to resolve: a quest / task step (its objective), a household activity category (W-124: { category: 'clean' }),
 * or explicit routes.
 */
export type ActivityGoal = { objective: ObjectiveDef } | { category: string } | { routes: readonly QuestRoute[] };

export interface ActivityOptions {
  /** Keep only the best N candidates (default: all). */
  limit?: number;
  /** Collect candidates from every route, not just the first route that can act (W-124 lists; default false). */
  all?: boolean;
  /** Skip objects another household member already queued / uses (default true). */
  excludeClaimed?: boolean;
}

export interface ActivityResult {
  agentId: string | null;
  /** Ranked valid candidates (empty when none). */
  candidates: ActivityCandidate[];
  /** The single answer: the top candidate's queue action, or mode / missing / blocked. */
  best: QuestAction;
}

export interface QuestStepInput {
  objective: ObjectiveDef;
  /** The step (or the whole task) is already complete. */
  done?: boolean;
}

// ───────────────────────────── plans (pure data, no world) ─────────────────────────────

/** One way to advance a step: interactions (by id or tag) on targets of a kind, with optional filters. */
export interface QuestRoute {
  ids?: readonly string[];
  tags?: readonly string[];
  /** Interactions carrying any of these tags are skipped (snacks don't count as meals). */
  notTags?: readonly string[];
  /** Menu child params that must match (recipe: 'cerebellumStew'). */
  match?: Readonly<Record<string, string | number | boolean>>;
  /** Object targets must carry one of these tags (coffin, meal). */
  targetTags?: readonly string[];
  /** Object targets must be broken (repairs). */
  broken?: boolean;
  /** Agent targets: any on-lot agent but the actor | outsiders only | outsiders the actor never met. */
  agents?: 'any' | 'outsider' | 'unmet';
  /** Phone invite: prefer a townie the actor has not met. */
  inviteUnmet?: boolean;
  /** World precondition the engine only checks once the run starts (so the menu shows the entry as available). */
  needs?: 'unpaidBill';
  /** Reason when nothing on the lot can host this route and buying would not help. */
  none?: string;
}

export type QuestPlan =
  | { type: 'interact'; routes: QuestRoute[] }
  | { type: 'build'; count: number }
  | { type: 'buy'; tags: readonly string[]; defIds: readonly string[]; hint: string; category?: string }
  | { type: 'career'; then: 'work' | 'promotion' | 'level' }
  | { type: 'wait'; reason: string }
  | { type: 'unknown' };

const EAT_MEAL_IDS = ['home_haveServing', 'home_eatLeftovers', 'home_microwaveBurrito'];
const COOK: QuestRoute = { tags: ['cook'] };
const BILLS: QuestRoute = { ids: ['home_payBills', 'home_payBillsOnline'], needs: 'unpaidBill', none: 'No bills to pay right now' };
const CHAT_OUTSIDER: QuestRoute = { ids: ['social_chat', 'social_joke', 'social_complimentRot'], agents: 'outsider' };
const INVITE: QuestRoute = { ids: ['phone_inviteOver'] };

/** Global stats counters → how the household grows them (every key the shipped content uses). */
export const STAT_ROUTES: Readonly<Record<string, readonly QuestRoute[]>> = {
  mealsCooked: [COOK],
  mealsEaten: [{ ids: EAT_MEAL_IDS }, COOK],
  repairs: [{ ids: ['home_repair'], broken: true, none: 'Nothing is broken right now' }],
  dishesCleaned: [{ ids: ['home_cleanDish'], none: 'No dirty dishes right now' }],
  billsPaid: [BILLS],
  townsfolkMet: [{ ids: ['social_chat'], agents: 'unmet' }, { ...INVITE, inviteUnmet: true }],
  paintingsFinished: [{ ids: ['home_paint'] }],
  paintingsSold: [{ ids: ['home_sellPainting'], none: 'Finish a painting first' }, { ids: ['home_paint'] }],
  partiesThrown: [{ ids: ['phone_throwParty'] }],
  socials: [{ tags: ['friendly'], agents: 'any' }],
  kisses: [{ ids: ['social_kiss'], agents: 'any' }],
  pizzasOrdered: [{ ids: ['phone_orderPizza'] }],
  embalmedOthers: [{ ids: ['home_embalmOther'], agents: 'any' }],
  selfEmbalms: [{ ids: ['home_selfEmbalm'] }],
  firesFought: [{ ids: ['home_fightFire'], none: 'Nothing is on fire (good)' }],
  limbsReattached: [{ tags: ['stitch'], none: 'Nobody has a limb to stitch back on' }],
};
/**
 * Household activity categories (W-124 seam: "select a zombie, choose a category, run it once / until done /
 * recurring"). Data only — the same routes, menu rules and ranking as quest steps.
 */
export const ACTIVITY_CATEGORIES: Readonly<Record<string, readonly QuestRoute[]>> = {
  // W-124 (D-071): explicit ids — chores that change real state (dirt, trash fill, dishes, spoiled food), never
  // "throw away" food or limbs someone may still want, never the repair route (that is its own category)
  clean: [
    { ids: ['home_cleanDish', 'home_cleanAsh', 'home_wipeDown', 'home_cleanStove', 'home_emptyTrash', 'home_cleanFridge', 'home_putAwayLeftovers'], none: 'Everything is already spotless' },
  ],
  // W-109's garden is not built: shown as "coming later" by the jobs table (src/shared/jobs.ts)
  yard: [{ tags: ['plant'] }, { tags: ['outdoor'] }, { ids: ['home_emptyTrash'] }],
  // fun that actually raises the need (not the stereo on/off toggle, not a romantic slow dance)
  play: [{ ids: ['home_playVideoGames', 'home_playArcade', 'home_playChess', 'home_watchTv', 'home_listenMusic', 'home_dance'] }],
  cooking: [COOK],
  repairs: [{ ids: ['home_repair'], broken: true, none: 'Nothing is broken right now' }],
  hobbies: [{ ids: ['home_paint', 'home_read', 'home_playChess', 'home_program', 'home_practiceStitch'] }],
  exercise: [{ ids: ['home_workout', 'home_dance'] }],
  study: [{ ids: ['home_read', 'home_program', 'home_practiceSpeech'] }],
  // chats with whoever is visiting (household members are left to their own jobs); no phone calls from a job
  social: [{ ids: ['social_chat', 'social_joke', 'social_complimentRot'], agents: 'outsider', none: 'Nobody is visiting right now' }],
};

/** Stats that only the work schedule grows. */
const CAREER_STATS: Readonly<Record<string, 'work' | 'promotion'>> = { shiftsWorked: 'work', wagesEarned: 'work', promotions: 'promotion' };

/** Skill → practice interactions (the behaviours that award XP; reading/painting/chess award it in code, not stages). */
export const SKILL_ROUTES: Readonly<Record<string, readonly string[]>> = {
  cooking: ['home_cook', 'home_cookAtStove'],
  charisma: ['home_practiceSpeech'],
  mortuary: ['home_practiceStitch'],
  logic: ['home_playChess', 'home_program'],
  creativity: ['home_paint'],
  fitness: ['home_workout'],
};
const ANY_SKILL = ['home_read', 'home_paint', 'home_playChess', 'home_workout', 'home_practiceSpeech', 'home_program', 'home_practiceStitch', 'home_cookAtStove', 'home_cook'];

function skillRoutes(skill: unknown): QuestRoute[] {
  const ids = typeof skill === 'string' && SKILL_ROUTES[skill] ? SKILL_ROUTES[skill] : ANY_SKILL;
  return [{ ids }];
}

const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : undefined);

/** How a step is advanced, from its objective alone (no world). Covers every ObjectiveDef kind. */
export function questPlan(o: ObjectiveDef | null | undefined): QuestPlan {
  if (!o || typeof o !== 'object' || typeof (o as { kind?: unknown }).kind !== 'string') return { type: 'unknown' };
  switch (o.kind) {
    case 'interaction': {
      const route: QuestRoute = {};
      const ids = strs(o.ids);
      const tags = strs(o.tags);
      if (ids && ids.length) route.ids = ids;
      if (tags && tags.length) route.tags = tags;
      if (o.match && typeof o.match === 'object') route.match = { ...o.match };
      const tt = strs(o.targetTags);
      if (tt && tt.length) route.targetTags = tt;
      if (!route.ids && !route.tags) return { type: 'unknown' };
      route.agents = 'any';
      const routes = [route];
      // a hot meal has to be cooked first when nothing is ready to eat
      if ((tags ?? []).includes('eat') || (ids ?? []).some((id) => EAT_MEAL_IDS.includes(id))) routes.push(COOK);
      // a social with nobody around to talk to: phone someone over first
      if ((tags ?? []).some((t) => t === 'friendly' || t === 'social' || t === 'romantic') || (ids ?? []).some((id) => id.startsWith('social_'))) routes.push(INVITE);
      return { type: 'interact', routes };
    }
    case 'stat': {
      const r = STAT_ROUTES[o.key];
      if (r) return { type: 'interact', routes: r.slice() };
      const c = CAREER_STATS[o.key];
      if (c) return { type: 'career', then: c };
      return { type: 'unknown' };
    }
    case 'friends':
      return { type: 'interact', routes: [CHAT_OUTSIDER, INVITE] };
    case 'event':
      if (o.event === 'skillUp') return { type: 'interact', routes: skillRoutes(o.skill) };
      if (o.event === 'promotion') return { type: 'career', then: 'promotion' };
      if (o.event === 'milestone') return { type: 'wait', reason: 'Milestones come from your zombie’s aspiration — keep living it up' };
      return { type: 'unknown' };
    case 'skill':
      return { type: 'interact', routes: skillRoutes(o.skill) };
    case 'career':
      return { type: 'career', then: 'level' };
    case 'own':
      return { type: 'buy', tags: strs(o.tags) ?? [], defIds: strs(o.defIds) ?? [], hint: 'Pick one and place it on the lot' };
    case 'roomEnv':
      return { type: 'buy', tags: ['decor'], defIds: [], hint: `Decorate one room until it scores ${Math.max(1, Math.floor(Number(o.atLeast) || 1))}`, category: 'decor' };
    case 'walls':
      return { type: 'build', count: Math.max(1, Math.floor(Number(o.count) || 1)) };
    case 'days':
      return { type: 'wait', reason: 'Time takes care of this one — just keep the household going' };
    case 'billsOnTime':
      return { type: 'interact', routes: [BILLS] };
    case 'funds':
      return { type: 'wait', reason: 'Earn it at work or by selling paintings' };
    default: {
      const never: never = o;
      void never;
      return { type: 'unknown' };
    }
  }
}

// ───────────────────────────── helpers ─────────────────────────────

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const BUY_CATS = new Set<string>([...BUY_CATEGORIES.map((c) => c.id), 'doors', 'windows']);

/** 'o12' → 12 (deterministic id order: o2 < o10); other ids after, by string. */
function idOrder(a: string, b: string): number {
  const ma = /^o(\d{1,15})$/.exec(a);
  const mb = /^o(\d{1,15})$/.exec(b);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
  if (ma) return -1;
  if (mb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function hasAny(tags: readonly string[] | undefined, want: readonly string[] | undefined): boolean {
  if (!want || want.length === 0) return true;
  return Array.isArray(tags) && want.some((t) => tags.includes(t));
}

function relKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function members(state: WorldState): AgentState[] {
  const ids = state.household && Array.isArray(state.household.memberIds) ? state.household.memberIds : [];
  const out: AgentState[] = [];
  for (const id of ids) {
    const a = typeof id === 'string' && state.agents ? state.agents[id] : undefined;
    if (a && typeof a === 'object') out.push(a);
  }
  return out;
}

function placedTile(o: ObjectState): { x: number; z: number } | null {
  const p = o.placement as { kind?: string; x?: unknown; z?: unknown } | undefined;
  if (!p || (p.kind !== 'floor' && p.kind !== 'loose')) return null;
  return isNum(p.x) && isNum(p.z) ? { x: Math.floor(p.x), z: Math.floor(p.z) } : null;
}

/** Interaction tags that mean the agent is asleep. */
function isAsleep(a: AgentState, content: QuestWorldView['content']): boolean {
  if (a.status && a.status.passedOut) return true;
  const act = a.active;
  const def = act ? content.interactions[act.interactionId] : undefined;
  return !!def && Array.isArray(def.tags) && def.tags.includes('sleep');
}

function isBusy(a: AgentState): boolean {
  if (a.active && a.active.source === 'player') return true;
  return Array.isArray(a.queue) && a.queue.some((q) => q && q.source === 'player');
}

const TAG_NOUN: Readonly<Record<string, string>> = {
  easel: 'an easel', bookshelf: 'a bookshelf', chess: 'a chess table', gym: 'a workout rack', fridge: 'a fridge', stove: 'a stove',
  microwave: 'a microwave', shower: 'a shower', computer: 'a computer', tv: 'a TV', stereo: 'a stereo', mirror: 'a mirror',
  espresso: 'an espresso machine', embalm: 'an embalming station', sewing: 'a stitching table', mailbox: 'a mailbox', coffin: 'a coffin',
  plant: 'a plant', arcade: 'an arcade cabinet', trash: 'a trash can', sink: 'a sink', tub: 'a tub', decor: 'a decoration', seat: 'a seat',
  light: 'a light', bed: 'a bed', sofa: 'a sofa', table: 'a table', surface: 'a surface', meal: 'a meal', rug: 'a rug',
};

function humanNoun(tag: string): string {
  if (TAG_NOUN[tag]) return TAG_NOUN[tag];
  const words = tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return `${/^[aeiou]/.test(words) ? 'an' : 'a'} ${words}`;
}

/** "an easel", "a fridge or a stove" for a set of object defs (cheapest first). */
function needNoun(defs: readonly ObjectDef[], prefer: readonly string[] | undefined): string {
  if (defs.length === 0) return 'something to do it with';
  if (prefer) for (const t of prefer) if (defs.every((d) => d.tags.includes(t))) return humanNoun(t);
  const first = defs[0];
  // the most specific shared tag (tags run general → specific: seat, sofa / bed, coffin)
  for (const t of [...first.tags].reverse()) if (TAG_NOUN[t] && defs.every((d) => d.tags.includes(t))) return humanNoun(t);
  const nouns: string[] = [];
  for (const d of defs) {
    const t = [...d.tags].reverse().find((x) => TAG_NOUN[x]) ?? d.tags[0];
    const n = t ? humanNoun(t) : d.name;
    if (!nouns.includes(n)) nouns.push(n);
  }
  return nouns.length <= 2 ? nouns.join(' or ') : `${nouns.slice(0, 2).join(', ')} or similar`;
}

function buyable(d: ObjectDef | undefined): d is ObjectDef {
  return !!d && typeof d.id === 'string' && Array.isArray(d.tags) && BUY_CATS.has((d as { category?: string }).category ?? '') && isNum((d as { price?: number }).price) && (d as { price: number }).price > 0;
}

function buyFilterOf(defs: ObjectDef[], prefer?: readonly string[]): QuestBuyFilter | null {
  // the route's own order first (bookshelf before easel for "any skill"), the cheapest first within it
  const order = new Map<string, number>();
  defs.forEach((d, i) => {
    if (d && !order.has(d.id)) order.set(d.id, i);
  });
  const first = defs.filter(buyable).filter((d, i, a) => a.findIndex((x) => x.id === d.id) === i);
  const uniq = first.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || (a as { price: number }).price - (b as { price: number }).price || (a.id < b.id ? -1 : 1));
  if (uniq.length === 0) return null;
  return { defIds: uniq.map((d) => d.id), category: (uniq[0] as { category: string }).category, label: needNoun(uniq, prefer) };
}

// ───────────────────────────── reachability ─────────────────────────────

type DF = ReturnType<SpatialAPI['distanceField']>;

function costAt(world: QuestWorldView, df: DF | null, x: number, z: number): number {
  const sp = world.spatial;
  if (!sp || !df) return 0;
  try {
    if (!sp.inBounds(x, z)) return Infinity;
    const v = df.dist[sp.tileIndex(x, z)];
    return isNum(v) ? v : Infinity;
  } catch {
    return Infinity;
  }
}

function around(t: { x: number; z: number }): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [t];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) out.push({ x: t.x + dx, z: t.z + dz });
  return out;
}

function objectCost(world: QuestWorldView, df: DF | null, actor: AgentState, o: ObjectState): number {
  const sp = world.spatial;
  if (!sp || !df) {
    const t = placedTile(o);
    return t && actor.pos ? Math.hypot(t.x + 0.5 - actor.pos.x, t.z + 0.5 - actor.pos.z) : 0;
  }
  let tiles: { x: number; z: number }[] = [];
  try {
    for (const s of sp.resolveSlots(o) ?? []) for (const a of s.approach ?? []) tiles.push(a);
  } catch {
    tiles = [];
  }
  if (tiles.length === 0) {
    try {
      if (o.placement.kind === 'floor') for (const t of sp.objectTiles(o) ?? []) tiles.push(...around(t));
    } catch {
      /* fall through */
    }
    const t = placedTile(o);
    if (tiles.length === 0 && t) tiles = around(t);
  }
  let best = Infinity;
  for (const t of tiles) best = Math.min(best, costAt(world, df, t.x, t.z));
  return best;
}

function agentCost(world: QuestWorldView, df: DF | null, actor: AgentState, other: AgentState): number {
  if (!other.pos || !isNum(other.pos.x) || !isNum(other.pos.z)) return Infinity;
  if (!world.spatial || !df) return actor.pos ? Math.hypot(other.pos.x - actor.pos.x, other.pos.z - actor.pos.z) : 0;
  let best = Infinity;
  for (const t of around({ x: Math.floor(other.pos.x), z: Math.floor(other.pos.z) })) best = Math.min(best, costAt(world, df, t.x, t.z));
  return best;
}

// ───────────────────────────── per-agent resolution ─────────────────────────────

interface Candidate {
  def: InteractionDef;
  defIndex: number;
  target: TargetRef;
  targetKey: string;
  targetName: string | null;
  objectId: string | null;
  /** Another household member already has this object queued / in use (W-124: don't send two zombies). */
  claimed?: boolean;
}

type RouteOutcome =
  | { type: 'ok'; candidates: ActivityCandidate[] }
  | { type: 'refused'; reason: string; strong: boolean; missing: ObjectDef[]; prefer?: readonly string[] }
  | { type: 'missing'; defs: ObjectDef[]; prefer?: readonly string[] }
  | { type: 'none'; reason: string | null };

function routeDefs(world: QuestWorldView, r: QuestRoute): InteractionDef[] {
  const all = world.content.interactions;
  const skip = r.notTags && r.notTags.length > 0 ? r.notTags : null;
  const visible = (d: InteractionDef | undefined): d is InteractionDef => !!d && !d.hidden && d.playerAllowed !== false && !(skip && hasAny(d.tags, skip));
  if (r.ids && r.ids.length) return r.ids.map((id) => all[id]).filter(visible);
  const tags = r.tags ?? [];
  return Object.keys(all)
    .sort()
    .map((id) => all[id])
    .filter((d) => visible(d) && hasAny(d.tags, tags));
}

function candidatesOf(world: QuestWorldView, actor: AgentState, r: QuestRoute, defs: InteractionDef[], missing: ObjectDef[], claimed: ReadonlySet<string>): Candidate[] {
  const s = world.state;
  const objs = s.objects && typeof s.objects === 'object' ? s.objects : {};
  const here = actor.regionId ?? homeRegionIdOf(s);
  const objIds = Object.keys(objs).sort(idOrder);
  const memberIds = new Set(members(s).map((a) => a.id));
  const out: Candidate[] = [];
  defs.forEach((def, defIndex) => {
    if (def.targetKind === 'self') {
      out.push({ def, defIndex, target: { kind: 'self' }, targetKey: 'self', targetName: null, objectId: null });
      return;
    }
    if (def.targetKind === 'agent') {
      const agents = s.agents && typeof s.agents === 'object' ? s.agents : {};
      for (const id of Object.keys(agents).sort()) {
        const a = agents[id];
        if (!a || id === actor.id || a.presence !== 'onLot' || (a.regionId ?? homeRegionIdOf(s)) !== here) continue;
        const outsider = !memberIds.has(id);
        const mode = r.agents ?? 'any';
        if (mode !== 'any' && !outsider) continue;
        if (mode === 'unmet') {
          const rel = s.relationships ? s.relationships[relKey(actor.id, id)] : undefined;
          if (rel && rel.met) continue;
        }
        out.push({ def, defIndex, target: { kind: 'agent', id }, targetKey: `a:${id}`, targetName: typeof a.firstName === 'string' ? a.firstName : null, objectId: null });
      }
      return;
    }
    if (def.targetKind !== 'object') return;
    let any = false;
    for (const id of objIds) {
      const o = objs[id];
      if (!o || !o.placement || o.placement.kind === 'held' || (o.regionId ?? homeRegionIdOf(s)) !== here) continue;
      const od = world.content.objects[o.defId];
      if (!od || !Array.isArray(od.interactions) || !od.interactions.includes(def.id) || !hasAny(od.tags, r.targetTags)) continue;
      any = true;
      if (r.broken && !(o.condition && o.condition.broken)) continue;
      out.push({ def, defIndex, target: { kind: 'object', id }, targetKey: id, targetName: typeof od.name === 'string' ? od.name : null, objectId: id, claimed: claimed.has(id) });
    }
    if (!any && !r.broken) {
      for (const od of Object.values(world.content.objects)) if (od && Array.isArray(od.interactions) && od.interactions.includes(def.id) && hasAny(od.tags, r.targetTags)) missing.push(od);
    }
  });
  return out;
}

function paramsMatch(have: Record<string, unknown> | undefined, want: Readonly<Record<string, unknown>> | undefined): boolean {
  if (!want) return true;
  const h = have && typeof have === 'object' ? have : {};
  return Object.keys(want).every((k) => h[k] === want[k]);
}

function sameTarget(a: TargetRef | undefined, b: TargetRef): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'object' || a.kind === 'agent') return (a as { id: string }).id === (b as { id: string }).id;
  return true;
}

function alreadyQueued(actor: AgentState, interactionId: string, target: TargetRef, extra: Record<string, unknown>): boolean {
  const items = [actor.active, ...(Array.isArray(actor.queue) ? actor.queue : [])];
  return items.some((q) => !!q && q.interactionId === interactionId && sameTarget(q.target, target) && paramsMatch(q.params, extra));
}

/** Objects another household member has queued or is using (their active run's target or stage target). */
function claimedBy(world: QuestWorldView, actor: AgentState): Set<string> {
  const out = new Set<string>();
  for (const m of members(world.state)) {
    if (m.id === actor.id) continue;
    const items = [m.active, ...(Array.isArray(m.queue) ? m.queue : [])];
    for (const q of items) {
      if (!q) continue;
      if (q.target && q.target.kind === 'object') out.add((q.target as { id: string }).id);
      const st = (q as { stageTarget?: TargetRef }).stageTarget;
      if (st && st.kind === 'object') out.add((st as { id: string }).id);
    }
  }
  return out;
}

function lotIdOf(state: WorldState): string | null {
  const town = (state as { town?: { activeLotId?: unknown } }).town;
  return town && typeof town.activeLotId === 'string' ? town.activeLotId : null;
}

/** Where a candidate is, in LOT-LOCAL tile coordinates of the active lot (never mixed with world/map coordinates). */
function placeOf(world: QuestWorldView, c: Candidate): ActivityPlace | null {
  const s = world.state;
  const lotId = lotIdOf(s);
  if (c.target.kind === 'object') {
    const o = s.objects[c.objectId as string];
    const p = o && (o.placement as { kind?: string; x?: unknown; z?: unknown });
    if (p && isNum(p.x) && isNum(p.z)) return { space: 'lot', lotId, x: p.x, z: p.z };
    return { space: 'lot', lotId, x: null, z: null };
  }
  if (c.target.kind === 'agent') {
    const a = s.agents[(c.target as { id: string }).id];
    if (a && a.pos && isNum(a.pos.x) && isNum(a.pos.z)) return { space: 'lot', lotId, x: a.pos.x, z: a.pos.z };
  }
  return null;
}

function resolveRoute(world: QuestWorldView, actor: AgentState, r: QuestRoute, df: DF | null, routeIndex: number, opts: ActivityOptions): RouteOutcome {
  const s = world.state;
  if (r.needs === 'unpaidBill') {
    const bills = s.household && Array.isArray(s.household.bills) ? s.household.bills : [];
    if (!bills.some((b) => b && (b.paidTick === null || b.paidTick === undefined))) return { type: 'none', reason: r.none ?? null };
  }
  const defs = routeDefs(world, r);
  const missing: ObjectDef[] = [];
  const cands = candidatesOf(world, actor, r, defs, missing, opts.excludeClaimed === false ? new Set() : claimedBy(world, actor));
  let refused: { reason: string; cost: number } | null = null;
  // a refusal at an object / the phone is the real answer; a social gate ("Not enough romance yet") is weaker than
  // "buy the object that does it"
  let strong = false;
  const ok: ActivityCandidate[] = [];
  let current: Candidate | null = null;
  const consider = (cost: number, reason: string) => {
    const isStrong = !!current && current.target.kind !== 'agent';
    if (isStrong && !strong) refused = null;
    if (!isStrong && strong) return;
    strong = strong || isStrong;
    if (!refused || cost < refused.cost) refused = { reason, cost };
  };
  cands.forEach((c, ci) => {
    current = c;
    let entries: MenuEntry[] = [];
    try {
      const raw = world.menu(actor.id, c.target);
      entries = Array.isArray(raw) ? raw : [];
    } catch {
      entries = [];
    }
    const entry = entries.find((e) => e && e.interactionId === c.def.id);
    if (!entry) return; // the menu does not offer it here (social gate, wrong target): not a candidate
    const cost = c.target.kind === 'self' ? 0 : c.target.kind === 'agent' ? agentCost(world, df, actor, s.agents[(c.target as { id: string }).id]) : objectCost(world, df, actor, s.objects[c.objectId as string]);
    const kids = Array.isArray(entry.children) ? entry.children : [];
    let chosen: MenuEntry = entry;
    let childIndex = 0;
    if (kids.length > 0) {
      let pool = r.match ? kids.filter((k) => paramsMatch(k.params, r.match)) : kids;
      if (r.inviteUnmet) {
        const unmet = pool.filter((k) => {
          const t = k.params && typeof k.params.townieId === 'string' ? k.params.townieId : null;
          const rel = t && s.relationships ? s.relationships[relKey(actor.id, t)] : undefined;
          return !!t && !(rel && rel.met);
        });
        if (unmet.some((k) => k.available)) pool = unmet;
      }
      if (pool.length === 0) return consider(cost, r.match ? 'Not on the menu yet' : entry.reason ?? 'Not available');
      const ok = pool.find((k) => k.available);
      if (!ok) return consider(cost, pool[0].reason ?? entry.reason ?? 'Not available');
      chosen = ok;
      childIndex = kids.indexOf(ok);
    } else if (r.match) {
      if (!paramsMatch(entry.params, r.match)) return;
    }
    if (!chosen.available || !entry.available) return consider(cost, chosen.reason ?? entry.reason ?? 'Not available');
    if (!Number.isFinite(cost)) return consider(Number.MAX_VALUE, 'Can’t get there');
    if (c.claimed) return consider(cost, 'Someone else is already on it');
    const extra: Record<string, string | number | boolean> = { ...(entry.params ?? {}), ...(chosen !== entry ? chosen.params ?? {} : {}) };
    ok.push({
      rank: [routeIndex, Math.round(cost * 1e6) / 1e6, c.defIndex, ci, childIndex],
      place: placeOf(world, c),
      action: {
        kind: 'queue',
        agentId: actor.id,
        interactionId: c.def.id,
        target: c.target,
        objectId: c.objectId,
        extra,
        label: typeof chosen.label === 'string' ? chosen.label : c.def.label,
        targetName: c.targetName,
        cost,
        already: alreadyQueued(actor, c.def.id, c.target, extra),
        wait: isAsleep(actor, world.content) ? 'asleep' : isBusy(actor) ? 'busy' : null,
      },
    });
  });
  if (ok.length > 0) return { type: 'ok', candidates: ok.sort((a, b) => compareRank(a.rank, b.rank)) };
  // id routes keep their own order (bookshelf before easel for "any skill"); tag routes list the cheapest first
  const shop = missing.filter(buyable);
  if (!(r.ids && r.ids.length)) shop.sort((a, b) => (a as { price: number }).price - (b as { price: number }).price || (a.id < b.id ? -1 : 1));
  const prefer = r.targetTags ?? r.tags;
  if (refused) return { type: 'refused', reason: (refused as { reason: string }).reason, strong, missing: shop, prefer };
  if (shop.length > 0) return { type: 'missing', defs: shop, prefer };
  return { type: 'none', reason: r.none ?? null };
}

function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function distanceFrom(world: QuestWorldView, actor: AgentState): DF | null {
  const sp = world.spatial;
  if (!sp || !actor.pos || !isNum(actor.pos.x) || !isNum(actor.pos.z)) return null;
  try {
    return sp.distanceField(actor.pos);
  } catch {
    return null;
  }
}

/**
 * All routes for one agent. Candidates: every valid (target, interaction) of every route, ranked by route order, then
 * path cost, interaction order, target id, menu child. `best`: the top candidate, or — when there is none — the answer
 * by precedence: a refusal at a real target > "buy the thing" > a social gate > "nothing to do it with".
 */
function activityForAgent(world: QuestWorldView, actor: AgentState, routes: readonly QuestRoute[], opts: ActivityOptions): ActivityResult {
  const df = distanceFrom(world, actor);
  let refused: string | null = null;
  let weak: string | null = null;
  const missing: ObjectDef[] = [];
  let prefer: readonly string[] | undefined;
  let none: string | null = null;
  const candidates: ActivityCandidate[] = [];
  routes.forEach((r, i) => {
    // quest Go only needs the first route that can act; activities (opts.all) want every candidate
    if (candidates.length > 0 && !opts.all) return;
    const out = resolveRoute(world, actor, r, df, i, opts);
    if (out.type === 'ok') return void candidates.push(...out.candidates);
    if (out.type === 'refused') {
      if (out.strong && refused === null) refused = out.reason;
      if (!out.strong && weak === null) weak = out.reason;
    }
    if (out.type === 'missing' || out.type === 'refused') {
      missing.push(...(out.type === 'missing' ? out.defs : out.missing));
      prefer = prefer ?? out.prefer;
    }
    if (out.type === 'none' && none === null && out.reason) none = out.reason;
  });
  candidates.sort((a, b) => compareRank(a.rank, b.rank));
  const limit = isNum(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : candidates.length;
  const ranked = candidates.slice(0, limit);
  let best: QuestAction;
  if (ranked.length > 0) best = ranked[0].action;
  else if (refused !== null) best = { kind: 'blocked', reason: refused, code: 'agent' };
  else {
    const f = buyFilterOf(missing, prefer);
    if (f) best = { kind: 'missing', need: f.label, buyFilter: f };
    else if (weak !== null) best = { kind: 'blocked', reason: weak, code: 'agent' };
    else best = { kind: 'blocked', reason: none ?? 'Nothing here can do that right now', code: 'none' };
  }
  return { agentId: actor.id, candidates: ranked, best };
}

function blocked(reason: string, code: BlockedCode): QuestAction {
  return { kind: 'blocked', reason, code };
}

function careerAction(world: QuestWorldView, then: 'work' | 'promotion' | 'level'): QuestAction {
  const employed = members(world.state).some((a) => a.career && typeof a.career === 'object' && isNum(a.career.level) && a.career.level >= 1);
  if (!employed) return { kind: 'mode', mode: 'dialog', dialog: 'careers', hint: 'Pick a job on the phone' };
  if (then === 'work') return blocked('Shifts start on schedule — your zombie heads to work by themselves', 'wait');
  return blocked('Promotions come from working good shifts — keep showing up', 'wait');
}

function buyAction(world: QuestWorldView, p: Extract<QuestPlan, { type: 'buy' }>): QuestAction {
  const defs = Object.values(world.content.objects).filter((d) => !!d && (p.defIds.length ? p.defIds.includes(d.id) : true) && hasAny(d.tags, p.tags));
  const f = buyFilterOf(defs, p.tags.length === 1 ? p.tags : undefined);
  return { kind: 'mode', mode: 'buy', category: p.category ?? f?.category ?? BUY_CATEGORIES[0].id, buyFilter: f, hint: p.hint };
}

function result(best: QuestAction, agentId: string | null = null): ActivityResult {
  return { agentId, candidates: [], best };
}

function planOfGoal(goal: ActivityGoal): QuestPlan | null {
  if ('objective' in goal) return goal.objective && typeof goal.objective === 'object' ? questPlan(goal.objective) : null;
  if ('category' in goal) {
    const r = typeof goal.category === 'string' && Object.prototype.hasOwnProperty.call(ACTIVITY_CATEGORIES, goal.category) ? ACTIVITY_CATEGORIES[goal.category] : null;
    return r ? { type: 'interact', routes: r.slice() } : { type: 'unknown' };
  }
  if ('routes' in goal) return Array.isArray(goal.routes) && goal.routes.length > 0 ? { type: 'interact', routes: goal.routes.slice() } : { type: 'unknown' };
  return null;
}

/**
 * The core (shared by quest Go and the W-124 household activities): ranked (target, interaction) candidates for a goal,
 * drawn from the interaction registry and validated by the engine's own menu, plus the single best answer.
 * `agent`: the household member to plan for — used when at home; otherwise the best available member (awake and
 * free first, then the cheapest path, then household order). Objects another member already claimed are skipped
 * (opts.excludeClaimed, default on). Never throws.
 */
export function resolveActivity(goal: ActivityGoal | null | undefined, worldView: QuestWorldView | null | undefined, agent: string | null | undefined, opts: ActivityOptions = {}): ActivityResult {
  try {
    if (!goal || typeof goal !== 'object') return result(blocked('Nothing to do for this one', 'invalid'));
    const plan = planOfGoal(goal);
    if (!plan) return result(blocked('Nothing to do for this one', 'invalid'));
    if (!worldView || typeof worldView !== 'object' || !worldView.state || !worldView.content || typeof worldView.menu !== 'function') return result(blocked('No game in progress', 'invalid'));
    const o: ActivityOptions = opts && typeof opts === 'object' ? opts : {};
    switch (plan.type) {
      case 'unknown':
        return result(blocked('Nothing to do for this one yet', 'unknown'));
      case 'wait':
        return result(blocked(plan.reason, 'wait'));
      case 'build':
        return result({ kind: 'mode', mode: 'build', tool: 'wall', count: plan.count, hint: `Drag along the ground to build ${plan.count} wall segment${plan.count === 1 ? '' : 's'}` });
      case 'buy':
        return result(buyAction(worldView, plan));
      case 'career':
        return result(careerAction(worldView, plan.then));
      case 'interact':
        break;
    }
    const all = members(worldView.state);
    const sel = typeof agent === 'string' ? all.find((a) => a.id === agent) : undefined;
    const home = all.filter((a) => a.presence === 'onLot');
    if (sel && sel.presence === 'onLot') return activityForAgent(worldView, sel, plan.routes, o);
    if (home.length === 0) return result(blocked(all.length ? 'Nobody is home right now' : 'Nobody lives here', 'nobody'));
    let first: ActivityResult | null = null;
    let best: { r: ActivityResult; rank: number[] } | null = null;
    home.forEach((m, i) => {
      const r = activityForAgent(worldView, m, plan.routes, o);
      if (!first) first = r;
      const a = r.best;
      if (a.kind !== 'queue') return;
      const rank = [a.wait === 'asleep' ? 2 : a.wait === 'busy' ? 1 : 0, Math.round(a.cost * 1e6) / 1e6, i];
      if (!best || compareRank(rank, best.rank) < 0) best = { r, rank };
    });
    if (best) return (best as { r: ActivityResult }).r;
    return first ?? result(blocked('Nothing here can do that right now', 'none'));
  } catch {
    return result(blocked('Nothing to do for this one', 'invalid'));
  }
}

/**
 * Resolve a quest / task step to one action — a thin wrapper over resolveActivity (D-070). `selectedAgent`: the
 * selected household member, used when they are home; otherwise the best available member.
 */
export function resolveQuestAction(step: QuestStepInput | null | undefined, worldView: QuestWorldView | null | undefined, selectedAgent: string | null | undefined): QuestAction {
  try {
    if (!step || typeof step !== 'object' || !step.objective || typeof step.objective !== 'object') return blocked('Nothing to do for this one', 'invalid');
    if (step.done === true) return blocked('Already done', 'done');
    return resolveActivity({ objective: step.objective }, worldView, selectedAgent).best;
  } catch {
    return blocked('Nothing to do for this one', 'invalid');
  }
}
