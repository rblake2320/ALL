/** createNewWorldWith — builds a fresh WorldState per GDD §2/§6/§15 (README §12). */
import { AUTO_BUY_FLAG, DEFAULT_AUTO_BUY_CAP } from '../../shared/autoBuy';
import type { ContentRegistry, LotTemplate, LotTemplateId, NewGameOptions, NewMemberSpec, SimSystem } from '../contracts';
import type { LotState, ObjectPlacement, Vec2, WorldState } from '../types';
import { newHomeBuildState } from '../../shared/homeBuild';
import { NEED_IDS, SAVE_SCHEMA_VERSION, SKILL_IDS } from '../types';
import { seedRngState } from '../rng';
import { defaultAppearance } from '../../shared/appearance';
import { createAgent } from './agents';
import { sanitizeHouseholdName } from './commands';
import { recordFault } from './faults';
import { spawnObject } from './objects';
import { createEngine, initSystems } from './simulation';
import type { EngineDeps } from './types';
import { isNum, jsonCopy, tileCenter } from './util';
import { canonicalStartPick, isUsableStartPick, newTown } from '../../shared/town';
import type { StartPick } from '../../shared/world';
import { generateStart, START_GEN_V1, type GeneratedStart } from '../world/startGenerator';

export interface LotTemplateResult {
  lot: LotState;
  objects: { defId: string; placement: ObjectPlacement; tint?: string | null }[];
}

export interface WorldDeps extends EngineDeps {
  registry: ContentRegistry;
  systems: readonly SimSystem[];
  lotTemplate: (id: LotTemplateId) => LotTemplateResult;
  templateInfo: readonly LotTemplate[];
}

export const DEFAULT_STARTING_FUNDS: Record<LotTemplateId, number> = { derelict: 2500, starter: 6500, empty: 22000 };

/** WorldState.flags key naming the story arc a world runs (W-113). Absent = the classic story chain (old saves). */
export const STORY_ARC_FLAG = 'storyArc';
/** Lot templates that start a story arc (the arc runs only in worlds created on them — D-019: new games only). */
export const STORY_ARC_BY_TEMPLATE: Partial<Record<LotTemplateId, string>> = { derelict: 'act1' };

/** Lot templates whose new worlds start with an autonomous-purchase daily cap (W-116); absent = Unlimited. */
export const AUTO_BUY_CAP_BY_TEMPLATE: Partial<Record<LotTemplateId, number>> = { derelict: DEFAULT_AUTO_BUY_CAP };

function pickTraits(reg: ContentRegistry, raw: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(raw)) return out;
  const known = Object.keys(reg.traits).length > 0;
  for (const t of raw) {
    if (typeof t !== 'string' || out.includes(t)) continue;
    const def = reg.traits[t];
    if (known && (!def || def.reward)) continue;
    if (out.some((o) => (reg.traits[o]?.conflicts ?? []).includes(t) || (def?.conflicts ?? []).includes(o))) continue;
    out.push(t);
    if (out.length >= 3) break;
  }
  return out;
}

function defaultMember(householdName: string): NewMemberSpec {
  const last = householdName.replace(/^the\s+/i, '').split(' ')[0] || 'Graves';
  return { firstName: 'Mort', lastName: last, appearance: defaultAppearance(), traits: [], aspiration: null };
}

/** Distinct walkable tile near `origin` (ring search, deterministic order). */
function freeSpotNear(eng: ReturnType<typeof createEngine>['eng'], origin: Vec2, taken: Set<string>): Vec2 | null {
  const ox = Math.floor(origin.x);
  const oz = Math.floor(origin.z);
  try {
    for (let r = 0; r <= 12; r++) {
      const ring: { x: number; z: number; d: number }[] = [];
      for (let z = oz - r; z <= oz + r; z++) {
        for (let x = ox - r; x <= ox + r; x++) {
          if (Math.max(Math.abs(x - ox), Math.abs(z - oz)) !== r) continue;
          if (!eng.spatial.inBounds(x, z) || !eng.spatial.isWalkable(x, z) || taken.has(`${x},${z}`)) continue;
          ring.push({ x, z, d: (x + 0.5 - origin.x) ** 2 + (z + 0.5 - origin.z) ** 2 });
        }
      }
      ring.sort((a, b) => a.d - b.d || a.z - b.z || a.x - b.x);
      if (ring.length > 0) {
        taken.add(`${ring[0].x},${ring[0].z}`);
        return tileCenter(ring[0]);
      }
    }
  } catch (e) {
    recordFault(eng, 'newWorld.place', e);
  }
  return null;
}

/** The base lot type a start pick's template is built for (Astra's v1 derelict pool counts as derelict), or null. */
export function startBaseOf(templateId: unknown): LotTemplateId | null {
  if (templateId === 'starter' || templateId === 'empty') return templateId;
  return typeof templateId === 'string' && START_GEN_V1.pool.some((p) => p.templateId === templateId) ? 'derelict' : null;
}

/** Variation off: sub-seeds 0 on a shipped template id. Builds the exact legacy lot at the pick's slot. */
function isCanonicalPick(p: StartPick): boolean {
  return p.variantSeed === 0 && p.neighbourSeed === 0 && (p.templateId === 'derelict' || p.templateId === 'starter' || p.templateId === 'empty');
}

interface ResolvedStart {
  base: LotTemplateId;
  start: StartPick;
  home: LotTemplateResult;
  /** Why a requested varied start fell back to the canonical one (recorded as an engine fault, never thrown). */
  fault: string | null;
}

/**
 * W-025 S7 seam. Variation stays OFF (the S2 path: `deps.lotTemplate`, byte-identical lots and RNG) without
 * `startVariation`, and for an explicit canonical pick. It is ON for `startVariation: true` with no pick (New Game's
 * story start) and for an explicit non-canonical pick (a saved generated start, replayed without re-rolling). A seed
 * or pick the generator refuses never throws out of world creation: the canonical start of the requested base is
 * used and the reason returned.
 */
function resolveStart(o: Partial<NewGameOptions>, seed: number, deps: WorldDeps): ResolvedStart {
  const pick = isUsableStartPick(o.startPick) ? o.startPick : null;
  const pickBase = pick ? startBaseOf(pick.templateId) : null;
  const usePick = pick !== null && pickBase !== null;
  const base: LotTemplateId = pickBase ?? (o.lotTemplate === 'empty' || o.lotTemplate === 'derelict' ? o.lotTemplate : 'starter');
  const legacy = (fault: string | null, at: StartPick | null): ResolvedStart => ({
    base,
    start: at ? { ...at, templateId: base } : canonicalStartPick(base),
    home: deps.lotTemplate(base),
    fault,
  });
  if (usePick && isCanonicalPick(pick)) return legacy(null, pick);
  // An unusable pick is ignored (S2 behaviour), and an explicit pick of any kind never turns variation on by itself.
  if (!usePick && (o.startVariation !== true || o.startPick !== undefined)) return legacy(null, null);
  try {
    const g = generateStart(seed, base, deps.registry, usePick ? pick : undefined);
    return { base, start: { ...g.start }, home: jsonCopy(g.home), fault: null };
  } catch (e) {
    return legacy(`generated start refused, canonical start used: ${e instanceof Error ? e.message : String(e)}`, null);
  }
}

/**
 * Rebuild a world's generated start (home, the seven built neighbours, the map) from its SAVED StartPick, never
 * re-rolling, so the same neighbours come back after save → reload. Null for a world without a usable start pick
 * (a migrated legacy world) or one the generator refuses.
 */
export function rebuildStart(world: Pick<WorldState, 'town'> | null | undefined, registry: ContentRegistry): GeneratedStart | null {
  const town = world && typeof world === 'object' ? world.town : undefined;
  const pick = town && isUsableStartPick(town.start) ? town.start : null;
  const base = pick ? startBaseOf(pick.templateId) : null;
  if (!town || !pick || !base) return null;
  try {
    return generateStart(town.map.seed, base, registry, pick);
  } catch {
    return null;
  }
}

export function createNewWorldWith(opts: NewGameOptions, deps: WorldDeps): WorldState {
  const o = (opts && typeof opts === 'object' ? opts : {}) as Partial<NewGameOptions>;
  const seed = isNum(o.seed) ? Math.floor(Math.abs(o.seed)) >>> 0 : 1;
  // W-025 S2/S7 (§1.9 item 6): the base type (derelict / starter / empty) always drives the story arc, the auto-buy
  // cap and the money policy (GDD §6). WHICH lot is built for it is `resolveStart`'s job: the shipped template at the
  // pick's slot (variation off: legacy bytes), or the generated start when the options ask for variation.
  const resolved = resolveStart(o, seed, deps);
  const templateId = resolved.base;
  const start = resolved.start;
  const tpl = resolved.home;
  const name = sanitizeHouseholdName(o.householdName) ?? 'The Undead';
  const difficulty = o.difficulty === 'relaxed' || o.difficulty === 'grim' ? o.difficulty : 'normal';
  const state: WorldState = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed,
    rng: seedRngState(seed),
    tick: 0,
    nextId: 1,
    household: { name, funds: 0, memberIds: [], bills: [], utilitiesOn: true, repoDispatchedDay: null, txLog: [] },
    lot: jsonCopy(tpl.lot),
    agents: {},
    objects: {},
    relationships: {},
    notifications: [],
    choices: [],
    party: null,
    flags: {},
    stats: { counters: {}, agent: {} },
    settings: { autonomy: 'full', difficulty, visitorsEnabled: true },
    gameOver: false,
    // W-025 S2: the walkable world's saved part (pure; consumes no RNG, so the household rolls below are unchanged)
    town: newTown(seed, start),
  };
  // Home build rules (snap points for the first 20 items, tier caps): only when the new game asks for them.
  if (o.homeBuild === true) state.homeBuild = newHomeBuildState('starter');
  // Story start (W-113): the arc is chosen once, at creation, before any system initialises (the quests system reads it).
  const arc = STORY_ARC_BY_TEMPLATE[templateId];
  if (arc) state.flags[STORY_ARC_FLAG] = arc;
  // W-116 (D-063): a cash-strapped story start caps what zombies buy on their own (starter / empty: Unlimited, no flag)
  const autoCap = AUTO_BUY_CAP_BY_TEMPLATE[templateId];
  if (autoCap !== undefined) state.flags[AUTO_BUY_FLAG] = autoCap;
  const { eng } = createEngine(state, deps.registry, deps.systems, deps);
  if (resolved.fault) recordFault(eng, 'newWorld.start', resolved.fault);
  for (const t of Array.isArray(tpl.objects) ? tpl.objects : []) {
    const def = deps.registry.objects[t.defId];
    if (!def) {
      recordFault(eng, 'newWorld', `template object '${t.defId}' has no definition`);
      continue;
    }
    try {
      spawnObject(eng, t.defId, jsonCopy(t.placement), { value: def.price, tint: t.tint ?? null });
    } catch (e) {
      recordFault(eng, 'newWorld', e);
    }
  }
  const specs = Array.isArray(o.members) && o.members.length > 0 ? o.members.slice(0, 8) : [defaultMember(name)];
  const lot = state.lot;
  const front: Vec2 = { x: lot.width / 2, z: Math.max(1, lot.sidewalkZ - 2) + 0.5 };
  const taken = new Set<string>();
  for (const spec of specs) {
    const needs: Partial<Record<(typeof NEED_IDS)[number], number>> = {};
    for (const n of NEED_IDS) if (n !== 'preservation') needs[n] = eng.rng.int(70, 95);
    const vitality = eng.rng.int(90, 100);
    const aspiration = typeof spec?.aspiration === 'string' && (Object.keys(deps.registry.aspirations).length === 0 || deps.registry.aspirations[spec.aspiration]) ? spec.aspiration : null;
    const a = createAgent(eng, {
      role: 'household',
      presence: 'onLot',
      firstName: spec?.firstName,
      lastName: spec?.lastName,
      appearance: spec?.appearance,
      traits: pickTraits(deps.registry, spec?.traits),
      aspiration,
      needs,
    } as never);
    a.vitality = vitality;
    a.needs.preservation = vitality;
    // Contract decision #17: the CAZ voice preview seed carries over into the game.
    const vs = spec ? (spec as { voiceSeed?: unknown }).voiceSeed : undefined;
    if (isNum(vs)) a.voiceSeed = Math.abs(Math.floor(vs)) % 2147483647;
    for (const s of SKILL_IDS) a.skills[s] = { level: 0, xp: eng.rng.int(0, 40) };
    const p: Vec2 = freeSpotNear(eng, front, taken) ?? front;
    a.pos = { x: p.x, z: p.z };
    a.prevPos = { x: p.x, z: p.z };
    a.facing = Math.PI;
    a.prevFacing = Math.PI;
  }
  const info = deps.templateInfo.find((t) => t.id === templateId);
  const base = info && isNum(info.startingFunds) ? info.startingFunds : DEFAULT_STARTING_FUNDS[templateId];
  state.household.funds = Math.max(0, Math.round(base + 500 * (state.household.memberIds.length - 1)));
  initSystems(eng, false);
  eng.ctx.notify({
    kind: 'good',
    title: 'Welcome to Wormwood Heights',
    text:
      templateId === 'derelict'
        ? `The ${name.replace(/^the\s+/i, '')} household has claimed a condemned shack on Mildew Lane. It's not much, but it's yours (legally: almost).`
        : `The ${name.replace(/^the\s+/i, '')} household has moved in. Death didn't get you out of paying rent.`,
  });
  return state;
}
