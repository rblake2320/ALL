/**
 * Buy-catalog data derivation (pure): catalog items from the content registry (falling back to the physical
 * catalog), search, "what it's good for" from interaction labels/advertise, and door/window style lists.
 */
import { BUY_CATEGORIES, PHYSICAL_SPECS, type PhysicalSpec, type PlacementKind } from '../../../shared/catalog';
import type { ContentRegistry, InteractionDef, ObjectDef } from '../../../sim/contracts';
import { NEED_IDS, SKILL_IDS, type NeedId, type SkillId } from '../../../sim/types';
import { isNum, num } from './format';

export interface CatalogItem {
  defId: string;
  name: string;
  description: string;
  category: string;
  price: number;
  env: number;
  variants: string[];
  needsPower: boolean;
  footprint: { w: number; d: number };
  placement: PlacementKind;
  tags: string[];
  /** Normalised haystack for search. */
  haystack: string;
}

export interface GoodFor {
  actions: string[];
  needs: { need: NeedId; amount: number }[];
  skills: SkillId[];
}

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(BUY_CATEGORIES.map((c) => [c.id, c.label]));

/** Lowercase, strip diacritics ("Séance" → "seance"), collapse whitespace. */
export function normalizeSearch(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function toItem(spec: PhysicalSpec, env: number): CatalogItem {
  const name = typeof spec.name === 'string' && spec.name ? spec.name : spec.id;
  const description = typeof spec.description === 'string' ? spec.description : '';
  const tags = Array.isArray(spec.tags) ? spec.tags.filter((t) => typeof t === 'string') : [];
  return {
    defId: spec.id,
    name,
    description,
    category: spec.category,
    price: Math.max(0, Math.round(num(spec.price))),
    env: Math.round(num(env)),
    variants: Array.isArray(spec.variants) ? spec.variants.filter((v) => typeof v === 'string') : [],
    needsPower: !!spec.needsPower,
    footprint: { w: Math.max(1, num(spec.footprint?.w, 1)), d: Math.max(1, num(spec.footprint?.d, 1)) },
    placement: spec.placement,
    tags,
    haystack: normalizeSearch([name, description, tags.join(' '), CATEGORY_LABEL[spec.category] ?? spec.category].join(' ')),
  };
}

/**
 * All buyable items (any category). Uses the live content registry when it has objects (so env/price overrides
 * from gameplay content win), otherwise the physical catalog. Sorted by category order, then price, then name.
 */
export function buildCatalog(objects: Record<string, ObjectDef> | null | undefined): CatalogItem[] {
  const fromContent = objects && typeof objects === 'object' ? Object.values(objects).filter((o) => o && typeof o.id === 'string') : [];
  const source: { spec: PhysicalSpec; env: number }[] =
    fromContent.length > 0
      ? fromContent.map((o) => ({ spec: o, env: num(o.env) }))
      : PHYSICAL_SPECS.map((s) => ({ spec: s, env: 0 }));
  const order = new Map<string, number>(BUY_CATEGORIES.map((c, i) => [c.id, i]));
  const extra = new Map<string, number>([
    ['doors', 100],
    ['windows', 101],
  ]);
  const items = source
    .filter(({ spec }) => spec.buyable && spec.category !== 'item' && spec.placement !== 'item')
    .map(({ spec, env }) => toItem(spec, env));
  items.sort((a, b) => {
    const ca = order.get(a.category) ?? extra.get(a.category) ?? 50;
    const cb = order.get(b.category) ?? extra.get(b.category) ?? 50;
    if (ca !== cb) return ca - cb;
    if (a.price !== b.price) return a.price - b.price;
    return a.name.localeCompare(b.name);
  });
  return items;
}

/** Items of a buy category (doors/windows excluded from buy mode — they live in build mode). */
export function itemsInCategory(items: readonly CatalogItem[], category: string): CatalogItem[] {
  return items.filter((i) => i.category === category);
}

/** Every query token must appear in the haystack. Empty query → all items. */
export function searchCatalog(items: readonly CatalogItem[], query: unknown, opts: { includeBuild?: boolean } = {}): CatalogItem[] {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean);
  const pool = opts.includeBuild ? items : items.filter((i) => i.category !== 'doors' && i.category !== 'windows');
  if (tokens.length === 0) return pool.slice();
  return pool.filter((i) => tokens.every((t) => i.haystack.includes(t)));
}

/** Count of items per buy category (for tab badges). */
export function categoryCounts(items: readonly CatalogItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.category] = (out[i.category] ?? 0) + 1;
  return out;
}

/** Replace {target} with the object name and drop other unresolved placeholders ({param:x}). */
export function resolveLabel(label: unknown, targetName: string): string {
  if (typeof label !== 'string') return '';
  return label
    .replace(/\{target\}/g, targetName)
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([…,.!?])/g, '$1')
    .trim();
}

/**
 * "What it's good for": visible interaction labels, positive advertised needs (max per need across interactions,
 * sorted desc) and skills trained by any stage.
 */
export function goodFor(defId: string, content: Pick<ContentRegistry, 'objects' | 'interactions'> & Partial<Pick<ContentRegistry, 'stagesOf'>> | null | undefined): GoodFor {
  const empty: GoodFor = { actions: [], needs: [], skills: [] };
  if (!content || !content.objects) return empty;
  const def = content.objects[defId];
  if (!def || !Array.isArray(def.interactions)) return empty;
  const actions: string[] = [];
  const needMax = new Map<NeedId, number>();
  const skills = new Set<SkillId>();
  for (const iid of def.interactions) {
    const idef: InteractionDef | undefined = content.interactions?.[iid];
    if (!idef || idef.hidden || idef.playerAllowed === false) continue;
    const label = resolveLabel(idef.label, def.name);
    if (label && !actions.includes(label)) actions.push(label);
    const ad = idef.advertise ?? {};
    for (const n of NEED_IDS) {
      const v = (ad as Partial<Record<NeedId, number>>)[n];
      if (isNum(v) && v > 0) needMax.set(n, Math.max(needMax.get(n) ?? 0, v));
    }
    let stages: { skillXpPerHour?: Partial<Record<SkillId, number>>; needsPerHour?: Partial<Record<NeedId, number>> }[] = [];
    try {
      stages = content.stagesOf ? content.stagesOf(iid) : idef.stages ?? (idef.stage ? [idef.stage] : []);
    } catch {
      stages = idef.stages ?? (idef.stage ? [idef.stage] : []);
    }
    for (const st of stages ?? []) {
      for (const s of SKILL_IDS) {
        const xp = st?.skillXpPerHour?.[s];
        if (isNum(xp) && xp > 0) skills.add(s);
      }
      if (!idef.advertise) {
        for (const n of NEED_IDS) {
          const v = st?.needsPerHour?.[n];
          if (isNum(v) && v > 0) needMax.set(n, Math.max(needMax.get(n) ?? 0, v));
        }
      }
    }
  }
  const needs = [...needMax.entries()].map(([need, amount]) => ({ need, amount })).sort((a, b) => b.amount - a.amount);
  return { actions, needs, skills: SKILL_IDS.filter((s) => skills.has(s)) };
}

/** Door or window specs for the build tool style grid (sorted by price). */
export function openingSpecs(kind: 'door' | 'window', objects?: Record<string, ObjectDef> | null): PhysicalSpec[] {
  const fromContent = objects ? Object.values(objects) : [];
  const pool: PhysicalSpec[] = fromContent.length ? fromContent : PHYSICAL_SPECS;
  const cat = kind === 'door' ? 'doors' : 'windows';
  return pool
    .filter((s) => s && s.buyable && (s.placement === kind || s.category === cat))
    .slice()
    .sort((a, b) => num(a.price) - num(b.price) || a.name.localeCompare(b.name));
}

/** "+3" / "−2" / "0" environment label. */
export function envLabel(env: unknown): string {
  const n = Math.round(num(env));
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}

/** Footprint label "2×1". */
export function footprintLabel(fp: { w: number; d: number } | null | undefined): string {
  const w = Math.max(1, Math.round(num(fp?.w, 1)));
  const d = Math.max(1, Math.round(num(fp?.d, 1)));
  return `${w}×${d}`;
}
