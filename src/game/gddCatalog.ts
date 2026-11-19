/**
 * Create-a-Zombie catalog: the subset of content CAZ needs (traits, aspirations, names, lot templates), built from
 * the live ContentRegistry when available. If content failed to load (or a module is missing) CAZ still works from
 * the GDD §8/§12 tables below, so the player is never stuck on a broken screen. Invalid content entries are
 * filtered out rather than trusted.
 */
import type { ContentRegistry, LotTemplate } from '../sim/contracts';
import { isUsableName, nameKey } from './names';

export interface CatalogTrait {
  id: string;
  name: string;
  description: string;
  conflicts: readonly string[];
  reward: boolean;
}

export interface CatalogAspiration {
  id: string;
  name: string;
  description: string;
}

export interface CazCatalog {
  traits: Readonly<Record<string, CatalogTrait>>;
  /** Non-reward trait ids in a stable order. */
  traitIds: readonly string[];
  aspirations: Readonly<Record<string, CatalogAspiration>>;
  aspirationIds: readonly string[];
  firstNames: readonly string[];
  lastNames: readonly string[];
  lotTemplateIds: readonly string[];
  difficulties: readonly string[];
  /** True when built from real content (false = GDD fallback tables). */
  fromContent: boolean;
}

export const DIFFICULTIES = ['relaxed', 'normal', 'grim'] as const;
/** New Game lots, in New Game order: the story start (derelict, the default) first. */
export const LOT_TEMPLATE_IDS = ['derelict', 'starter', 'empty'] as const;

const T = (id: string, name: string, description: string, conflicts: string[] = [], reward = false): CatalogTrait => ({
  id,
  name,
  description,
  conflicts,
  reward,
});

/** GDD §8 (fallback only). */
export const GDD_TRAITS: readonly CatalogTrait[] = [
  T('gourmand', 'Gourmand', 'Lives to eat. Cooks with gusto.'),
  T('neatFreak', 'Neat Freak', 'Cannot abide a dirty dish.', ['slob']),
  T('slob', 'Slob', 'Mess? What mess?', ['neatFreak']),
  T('nightOwl', 'Night Owl', 'Comes alive after dark. More than usual.'),
  T('socialButterfly', 'Social Butterfly', 'Needs company, loves parties.', ['loner']),
  T('loner', 'Loner', 'Happiest alone in the crypt.', ['socialButterfly']),
  T('hopelessRomantic', 'Hopeless Romantic', 'Falls in love with every pair of remaining eyes.'),
  T('grumpy', 'Grumpy', 'Death did not improve their mood.', ['cheerful']),
  T('cheerful', 'Cheerful', 'Undead and loving it.', ['grumpy', 'hothead']),
  T('clumsy', 'Clumsy', 'Limbs fall off twice as often. Finds it hilarious.'),
  T('vain', 'Vain', 'Obsessed with staying fresh.'),
  T('lazy', 'Lazy', 'Eternal rest sounds great, actually.', ['ambitious']),
  T('ambitious', 'Ambitious', 'Climbing the corporate crypt.', ['lazy']),
  T('bookworm', 'Bookworm', 'Reads everything, remembers some of it.'),
  T('partyAnimal', 'Party Animal', 'The afterparty never ends.'),
  T('artistic', 'Artistic', 'Paints macabre masterpieces.'),
  T('hothead', 'Hothead', 'Quick to anger, slow to forgive.', ['cheerful']),
  T('squeamish', 'Squeamish', 'Grossed out by limbs. Is a zombie.'),
];

/** GDD §12 (fallback only). */
export const GDD_ASPIRATIONS: readonly CatalogAspiration[] = [
  { id: 'tycoon', name: 'Undead Tycoon', description: 'Make a killing.' },
  { id: 'afterparty', name: 'Life of the Afterparty', description: 'Friends, parties, legend.' },
  { id: 'eternalRomance', name: 'Eternal Romance', description: 'Love that outlasts death.' },
  { id: 'masterPreserver', name: 'Master Preserver', description: 'Stay fresh forever.' },
  { id: 'renaissanceCorpse', name: 'Renaissance Corpse', description: 'Master many crafts.' },
];

/** Original names (no franchise references). */
export const FALLBACK_FIRST_NAMES: readonly string[] = [
  'Mortimer', 'Ghoulia', 'Barnaby', 'Edna', 'Rotney', 'Agatha', 'Clement', 'Mildred', 'Ezekiel', 'Prudence',
  'Lazarus', 'Hortense', 'Cornelius', 'Winifred', 'Ambrose', 'Opal', 'Silas', 'Bertha', 'Delphine', 'Horace',
  'Mabel', 'Ignatius', 'Euphemia', 'Thaddeus', 'Velma', 'Rufus', 'Doris', 'Fenwick', 'Ottilie', 'Basil',
  'Imelda', 'Percival', 'Gertrude', 'Lucius', 'Ivy', 'Wanda', 'Boris', 'Nell', 'Grimble', 'Morwenna',
];

export const FALLBACK_LAST_NAMES: readonly string[] = [
  'Rotwell', 'Graves', 'Moldsworth', 'Ashby', 'Cryptley', 'Mossgrave', 'Bonewright', 'Dirge', 'Coffinbury',
  'Wormley', 'Pallister', 'Mourne', 'Gloam', 'Thornbury', 'Stitchwell', 'Hollowell', 'Bleakmore', 'Fogg',
  'Grimsditch', 'Marrow', 'Embersley', 'Vexley', 'Tombsby', 'Ravenhill', 'Duskworth', 'Murkwood', 'Gristle',
  'Sallow', 'Cobwell', 'Lichfield',
];

/** A name usable as-is (trimmed, 1..24 code points, no control/bidi characters, something visible): names.ts. */
export { isUsableName } from './names';

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function fromTraitDefs(content: ContentRegistry | null): CatalogTrait[] {
  const out: CatalogTrait[] = [];
  const traits = content?.traits;
  if (!traits || typeof traits !== 'object') return out;
  for (const id of Object.keys(traits)) {
    const d = traits[id];
    if (!d || typeof d !== 'object' || typeof d.id !== 'string' || d.id !== id) continue;
    const conflicts = Array.isArray(d.conflicts) ? d.conflicts.filter((c): c is string => typeof c === 'string') : [];
    out.push({ id, name: str(d.name, id), description: str(d.description, ''), conflicts, reward: d.reward === true });
  }
  return out;
}

function fromAspirationDefs(content: ContentRegistry | null): CatalogAspiration[] {
  const out: CatalogAspiration[] = [];
  const asp = content?.aspirations;
  if (!asp || typeof asp !== 'object') return out;
  for (const id of Object.keys(asp)) {
    const d = asp[id];
    if (!d || typeof d !== 'object' || d.id !== id) continue;
    out.push({ id, name: str(d.name, id), description: str(d.description, '') });
  }
  return out;
}

function names(list: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(list)) return fallback;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of list) {
    if (!isUsableName(n)) continue;
    const k = nameKey(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  // Too few distinct names cannot fill a 4-zombie household with unique first names.
  return out.length >= 8 ? out : fallback;
}

export function buildCazCatalog(content: ContentRegistry | null, lotTemplates?: readonly LotTemplate[] | null): CazCatalog {
  let traits = fromTraitDefs(content);
  const usable = traits.filter((t) => !t.reward);
  const fromContent = usable.length >= 3;
  if (!fromContent) traits = GDD_TRAITS.slice();
  let aspirations = fromAspirationDefs(content);
  if (aspirations.length === 0) aspirations = GDD_ASPIRATIONS.slice();
  const traitMap: Record<string, CatalogTrait> = Object.create(null);
  for (const t of traits) traitMap[t.id] = t;
  const aspMap: Record<string, CatalogAspiration> = Object.create(null);
  for (const a of aspirations) aspMap[a.id] = a;
  const lots = Array.isArray(lotTemplates)
    ? LOT_TEMPLATE_IDS.filter((id) => lotTemplates.some((l) => l?.id === id))
    : [];
  return {
    traits: traitMap,
    traitIds: traits.filter((t) => !t.reward).map((t) => t.id),
    aspirations: aspMap,
    aspirationIds: aspirations.map((a) => a.id),
    firstNames: names(content?.names?.first, FALLBACK_FIRST_NAMES),
    lastNames: names(content?.names?.last, FALLBACK_LAST_NAMES),
    lotTemplateIds: lots.length > 0 ? lots : LOT_TEMPLATE_IDS,
    difficulties: DIFFICULTIES,
    fromContent,
  };
}

/** Symmetric conflict check (either side may declare it). */
export function traitsConflict(catalog: CazCatalog, a: string, b: string): boolean {
  if (a === b) return false;
  const ta = catalog.traits[a];
  const tb = catalog.traits[b];
  return (ta?.conflicts.includes(b) ?? false) || (tb?.conflicts.includes(a) ?? false);
}
