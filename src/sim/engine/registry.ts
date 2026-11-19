/**
 * Content registry: merges ContentModules into one ContentRegistry with duplicate-id detection and
 * stage-shorthand normalisation. Source modules are never mutated (defs are shallow-copied when normalised).
 */
import type {
  ContentModule,
  ContentRegistry,
  InteractionDef,
  ObjectDef,
  StageDef,
  LifeEventDef,
} from '../contracts';
import type { InteractionId } from '../types';

/** ContentRegistry plus the problems found while merging (duplicates, overrides, malformed entries). */
export interface EngineRegistry extends ContentRegistry {
  problems: string[];
  /** Module ids in load order. */
  moduleIds: string[];
}

type Keyed = 'objects' | 'interactions' | 'moodlets' | 'traits' | 'skills' | 'careers' | 'aspirations' | 'rewards' | 'recipes';
const KEYED: Keyed[] = ['objects', 'interactions', 'moodlets', 'traits', 'skills', 'careers', 'aspirations', 'rewards', 'recipes'];

/** Kinds where a later module may override the engine module's default definition. */
const ENGINE_OVERRIDABLE: Partial<Record<Keyed, true>> = { skills: true };

function normaliseObjectDef(def: ObjectDef): ObjectDef {
  return {
    ...def,
    interactions: Array.isArray(def.interactions) ? def.interactions.slice() : [],
    env: typeof def.env === 'number' && Number.isFinite(def.env) ? def.env : 0,
    depreciation: typeof def.depreciation === 'number' && Number.isFinite(def.depreciation) ? def.depreciation : 0.15,
    breakChance: typeof def.breakChance === 'number' && Number.isFinite(def.breakChance) ? def.breakChance : 0,
    sellable: typeof def.sellable === 'boolean' ? def.sellable : true,
    params: def.params && typeof def.params === 'object' ? { ...def.params } : {},
    tags: Array.isArray(def.tags) ? def.tags.slice() : [],
    slots: Array.isArray(def.slots) ? def.slots : [],
  };
}

function normaliseInteraction(def: InteractionDef): InteractionDef {
  return { ...def, params: def.params && typeof def.params === 'object' ? { ...def.params } : {} };
}

export function loadContentFrom(modules: readonly ContentModule[]): EngineRegistry {
  const problems: string[] = [];
  const owner: Record<string, Record<string, string>> = {};
  const reg: EngineRegistry = {
    objects: {},
    interactions: {},
    moodlets: {},
    traits: {},
    skills: {} as ContentRegistry['skills'],
    careers: {},
    aspirations: {},
    rewards: {},
    recipes: {},
    lifeEvents: [],
    names: { first: [], last: [], occupations: [] },
    stagesOf: () => [],
    problems,
    moduleIds: [],
  };
  for (const k of KEYED) owner[k] = {};
  const lifeEventOwner: Record<string, string> = {};
  const seenModules = new Set<string>();

  for (const mod of modules) {
    if (!mod || typeof mod !== 'object') {
      problems.push('content: a content module is null or not an object');
      continue;
    }
    const modId = typeof mod.id === 'string' && mod.id ? mod.id : '(unnamed)';
    if (seenModules.has(modId)) problems.push(`content: module id '${modId}' loaded twice`);
    seenModules.add(modId);
    reg.moduleIds.push(modId);

    for (const k of KEYED) {
      const list = (mod as unknown as Record<string, unknown>)[k];
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        problems.push(`${modId}: '${k}' must be an array`);
        continue;
      }
      const target = reg[k] as unknown as Record<string, unknown>;
      for (const raw of list) {
        const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : undefined;
        if (typeof id !== 'string' || id.length === 0) {
          problems.push(`${modId}: ${k} entry without a string id`);
          continue;
        }
        const prev = owner[k][id];
        if (prev !== undefined) {
          if (ENGINE_OVERRIDABLE[k] && prev === 'engine') {
            problems.push(`${modId}: ${k.slice(0, -1)} '${id}' overrides the engine default (skills are engine-owned; remove it)`);
          } else {
            problems.push(`duplicate ${k.slice(0, -1)} id '${id}' (modules '${prev}' and '${modId}')`);
            continue; // first definition wins
          }
        }
        owner[k][id] = modId;
        let def: unknown = raw;
        if (k === 'objects') def = normaliseObjectDef(raw as ObjectDef);
        else if (k === 'interactions') def = normaliseInteraction(raw as InteractionDef);
        target[id] = def;
      }
    }

    if (mod.lifeEvents !== undefined) {
      if (!Array.isArray(mod.lifeEvents)) problems.push(`${modId}: 'lifeEvents' must be an array`);
      else
        for (const ev of mod.lifeEvents as LifeEventDef[]) {
          if (!ev || typeof ev.id !== 'string') {
            problems.push(`${modId}: lifeEvent without a string id`);
            continue;
          }
          if (lifeEventOwner[ev.id] !== undefined) {
            problems.push(`duplicate lifeEvent id '${ev.id}' (modules '${lifeEventOwner[ev.id]}' and '${modId}')`);
            continue;
          }
          lifeEventOwner[ev.id] = modId;
          reg.lifeEvents.push(ev);
        }
    }

    if (mod.names) {
      const add = (dst: string[], src: unknown) => {
        if (!Array.isArray(src)) return;
        for (const s of src) if (typeof s === 'string' && s.trim() && !dst.includes(s)) dst.push(s);
      };
      add(reg.names.first, mod.names.first);
      add(reg.names.last, mod.names.last);
      add(reg.names.occupations, mod.names.occupations);
    }
  }

  const stageCache = new Map<InteractionId, StageDef[]>();
  reg.stagesOf = (id: InteractionId): StageDef[] => {
    const hit = stageCache.get(id);
    if (hit) return hit;
    const def = reg.interactions[id];
    let stages: StageDef[] = [];
    if (def) {
      if (Array.isArray(def.stages) && def.stages.length > 0) stages = def.stages.filter((s) => s && typeof s === 'object');
      else if (def.stage && typeof def.stage === 'object') stages = [def.stage];
    }
    stageCache.set(id, stages);
    return stages;
  };
  return reg;
}

/** Narrow a ContentRegistry to the engine's registry (adds empty problems when built elsewhere). */
export function asEngineRegistry(reg: ContentRegistry): EngineRegistry {
  const r = reg as Partial<EngineRegistry> & ContentRegistry;
  if (!Array.isArray(r.problems)) (r as EngineRegistry).problems = [];
  if (!Array.isArray(r.moduleIds)) (r as EngineRegistry).moduleIds = [];
  return r as EngineRegistry;
}
