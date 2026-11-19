/**
 * Quest content validation (tests + future content-pack loader): every id an objective names must exist in the
 * registry, the prerequisite graph must be acyclic, rewards must be Bones/cosmetics within sane bounds.
 */
import type { ContentRegistry, ObjectiveDef, QuestDef } from '../../contracts';
import { BUBBLE_ICONS } from '../../contracts';
import { SKILL_IDS } from '../../types';
import type { DailyTaskDef } from '../../content/quests/daily';

export const MAX_QUEST_BONES = 500;
/** Quest rewards may only grant cosmetics, spelled in the shared entitlement grammar (src/shared/economy.ts
 *  ENTITLEMENT_ID_RE — lowercase snake_case), so every validated reward can actually be stored by the Bones ledger. */
export const ENTITLEMENT_RE = /^cosmetic:[a-z0-9_]{1,64}$/;
/** Stats counters the shipped systems write (home + people). Objectives may only count these. */
export const KNOWN_STATS: ReadonlySet<string> = new Set([
  'mealsCooked', 'mealsEaten', 'limbsLost', 'limbsReattached', 'prosthetics', 'crumbled', 'reanimations', 'billsPaid',
  'billsIssued', 'powerCuts', 'repossessions', 'paintingsFinished', 'paintingsSold', 'embalmedOthers', 'selfEmbalms',
  'firesStarted', 'firesFought', 'objectsBroken', 'repairs', 'pizzasOrdered', 'dishesCleaned', 'partiesThrown',
  'legendaryParties', 'lameParties', 'kisses', 'marriages', 'breakUps', 'socials', 'townsfolkMet', 'promotions',
  'firings', 'shiftsWorked', 'shiftsMissed', 'wagesEarned', 'townieVisits', 'movedIn', 'milestones', 'lifeEvents',
  'feralNibbles', 'moneySpent', 'moneyEarned',
]);
/** Kinds a profile-level daily task may use (they measure NEW activity only). */
export const DAILY_KINDS: ReadonlySet<ObjectiveDef['kind']> = new Set(['interaction', 'event', 'stat', 'friends', 'billsOnTime', 'own']);

const posInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 1;

export function validateObjective(o: ObjectiveDef, reg: Pick<ContentRegistry, 'interactions' | 'objects' | 'recipes'>, where: string): string[] {
  const out: string[] = [];
  const intTags = new Set<string>();
  for (const d of Object.values(reg.interactions)) for (const t of d.tags ?? []) intTags.add(t);
  const objTags = new Set<string>();
  for (const d of Object.values(reg.objects)) for (const t of d.tags ?? []) objTags.add(t);
  const bad = (m: string) => out.push(`${where}: ${m}`);
  switch (o.kind) {
    case 'interaction':
      if (!posInt(o.count)) bad('count must be a positive integer');
      for (const id of o.ids ?? []) if (!reg.interactions[id]) bad(`unknown interaction '${id}'`);
      for (const t of o.tags ?? []) if (!intTags.has(t)) bad(`no interaction has tag '${t}'`);
      for (const t of o.targetTags ?? []) if (!objTags.has(t)) bad(`no object has tag '${t}'`);
      if (o.match && typeof o.match.recipe === 'string' && !reg.recipes[o.match.recipe]) bad(`unknown recipe '${o.match.recipe}'`);
      if (!o.ids?.length && !o.tags?.length) bad('interaction objective needs ids or tags');
      break;
    case 'event':
      if (!posInt(o.count)) bad('count must be a positive integer');
      if (o.skill && !(SKILL_IDS as readonly string[]).includes(o.skill)) bad(`unknown skill '${o.skill}'`);
      break;
    case 'stat':
      if (!posInt(o.count)) bad('count must be a positive integer');
      if (!KNOWN_STATS.has(o.key)) bad(`unknown stat '${o.key}'`);
      break;
    case 'skill':
      if (!posInt(o.level) || o.level > 10) bad('level must be 1..10');
      if (o.skill && !(SKILL_IDS as readonly string[]).includes(o.skill)) bad(`unknown skill '${o.skill}'`);
      break;
    case 'career':
      if (!posInt(o.level) || o.level > 5) bad('level must be 1..5');
      break;
    case 'own':
      if (!posInt(o.count)) bad('count must be a positive integer');
      for (const t of o.tags ?? []) if (!objTags.has(t)) bad(`no object has tag '${t}'`);
      for (const id of o.defIds ?? []) if (!reg.objects[id]) bad(`unknown object '${id}'`);
      if (!o.tags?.length && !o.defIds?.length) bad('own objective needs tags or defIds');
      break;
    case 'roomEnv':
      if (!posInt(o.atLeast) || o.atLeast > 10) bad('atLeast must be 1..10');
      break;
    case 'friends':
    case 'days':
    case 'billsOnTime':
      if (!posInt(o.count)) bad('count must be a positive integer');
      break;
    case 'funds':
      if (!posInt(o.atLeast)) bad('atLeast must be a positive integer');
      break;
    case 'walls':
      if (!posInt(o.count) || o.count > 200) bad('count must be 1..200');
      break;
    default:
      bad(`unknown objective kind '${(o as { kind?: unknown }).kind}'`);
  }
  return out;
}

export function validateQuests(defs: readonly QuestDef[], reg: Pick<ContentRegistry, 'interactions' | 'objects' | 'recipes'>): string[] {
  const out: string[] = [];
  const ids = new Map<string, QuestDef>();
  for (const d of defs) {
    if (!d || typeof d.id !== 'string' || !/^[a-zA-Z0-9_]{1,48}$/.test(d.id)) {
      out.push(`bad quest id ${JSON.stringify(d?.id)}`);
      continue;
    }
    if (ids.has(d.id)) {
      out.push(`duplicate quest id '${d.id}'`); // the first definition wins (as in createQuestsSystem)
      continue;
    }
    ids.set(d.id, d);
  }
  for (const d of ids.values()) {
    const w = `quest ${d.id}`;
    if (!d.title || !d.description) out.push(`${w}: missing title/description`);
    if (!(BUBBLE_ICONS as readonly string[]).includes(d.icon)) out.push(`${w}: unknown icon '${d.icon}'`);
    if (!Array.isArray(d.steps) || d.steps.length === 0) out.push(`${w}: no steps`);
    const stepIds = new Set<string>();
    for (const s of d.steps ?? []) {
      if (stepIds.has(s.id)) out.push(`${w}: duplicate step '${s.id}'`);
      stepIds.add(s.id);
      if (!s.label) out.push(`${w}.${s.id}: missing label`);
      out.push(...validateObjective(s.objective, reg, `${w}.${s.id}`));
    }
    const r = d.reward as unknown as Record<string, unknown>;
    if (!r || !Number.isInteger(d.reward.bones) || d.reward.bones < 1 || d.reward.bones > MAX_QUEST_BONES) out.push(`${w}: bones must be 1..${MAX_QUEST_BONES}`);
    for (const k of Object.keys(r ?? {})) if (k !== 'bones' && k !== 'entitlements') out.push(`${w}: reward '${k}' is not allowed (Bones and cosmetics only)`);
    for (const e of d.reward.entitlements ?? []) if (!ENTITLEMENT_RE.test(e)) out.push(`${w}: entitlement '${e}' must be 'cosmetic:<id>' (lowercase snake_case)`);
    if (d.category === 'story' && d.repeat) out.push(`${w}: story quests never repeat`);
    if (d.category === 'neighbourhood' && d.reward.entitlements?.length && d.repeat) out.push(`${w}: repeatable quests must not grant entitlements`);
    for (const p of d.requires ?? []) if (!ids.has(p)) out.push(`${w}: requires unknown quest '${p}'`);
    // Story arcs (W-113): only arc quests may supersede, only classic story quests, each by at most one quest per arc;
    // an arc quest may only require quests of its own arc (a classic prerequisite could be superseded away).
    if (d.arc !== undefined && (typeof d.arc !== 'string' || !/^[a-z0-9_]{1,24}$/.test(d.arc))) out.push(`${w}: bad arc ${JSON.stringify(d.arc)}`);
    if (d.arc !== undefined && d.category !== 'story') out.push(`${w}: only story quests belong to an arc`);
    if (d.supersedes?.length && !d.arc) out.push(`${w}: supersedes needs an arc`);
    for (const sId of d.supersedes ?? []) {
      const t = ids.get(sId);
      if (!t) out.push(`${w}: supersedes unknown quest '${sId}'`);
      else if (t.arc || t.category !== 'story') out.push(`${w}: may only supersede classic story quests ('${sId}')`);
    }
    if (d.arc) for (const p of d.requires ?? []) if (ids.get(p) && ids.get(p)!.arc !== d.arc) out.push(`${w}: requires '${p}' from outside arc '${d.arc}'`);
  }
  const superseders = new Map<string, string>();
  for (const d of ids.values()) {
    for (const sId of d.supersedes ?? []) {
      const k = `${d.arc}|${sId}`;
      if (superseders.has(k)) out.push(`quest ${d.id}: '${sId}' is already superseded by '${superseders.get(k)}' in arc '${d.arc}'`);
      else superseders.set(k, d.id);
    }
  }
  // prerequisite cycles
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      out.push(`prerequisite cycle: ${[...path, id].join(' -> ')}`);
      return;
    }
    state.set(id, 1);
    for (const p of ids.get(id)?.requires ?? []) if (ids.has(p)) visit(p, [...path, id]);
    state.set(id, 2);
  };
  for (const id of ids.keys()) visit(id, []);
  return out;
}

export function validateDailyPool(pool: readonly DailyTaskDef[], reg: Pick<ContentRegistry, 'interactions' | 'objects' | 'recipes'>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of pool) {
    if (seen.has(t.id)) out.push(`duplicate daily task '${t.id}'`);
    seen.add(t.id);
    if (!t.title) out.push(`daily ${t.id}: missing title`);
    if (!Number.isInteger(t.bones) || t.bones < 1 || t.bones > 50) out.push(`daily ${t.id}: bones must be 1..50`);
    if (!DAILY_KINDS.has(t.objective.kind)) out.push(`daily ${t.id}: kind '${t.objective.kind}' is not allowed for daily tasks`);
    if (t.objective.kind === 'own' && t.objective.fresh === false) out.push(`daily ${t.id}: own objectives must be fresh`);
    out.push(...validateObjective(t.objective, reg, `daily ${t.id}`));
  }
  return out;
}
