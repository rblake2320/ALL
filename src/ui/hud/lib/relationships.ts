/** Relationship list sorting/filtering (pure). */
import type { RelationshipView, TownieView } from '../../../sim/contracts';
import { num } from './format';
import { normalizeSearch } from './catalog';

export type RelSort = 'friendship' | 'romance' | 'name';
export type RelFilter = 'all' | 'household' | 'friends' | 'romance' | 'onLot' | 'rivals';

export const REL_FILTERS: RelFilter[] = ['all', 'household', 'friends', 'romance', 'onLot', 'rivals'];
export const REL_SORTS: RelSort[] = ['friendship', 'romance', 'name'];

/** GDD §9 thresholds. */
export const FRIEND_MIN = 35;
export const RIVAL_MAX = -35;
export const CRUSH_MIN = 30;

const ROMANTIC_LABELS = /partner|fianc|spouse|crush|married|engaged/i;

export function isRomantic(r: Pick<RelationshipView, 'romance' | 'label'>): boolean {
  return num(r.romance) >= CRUSH_MIN || ROMANTIC_LABELS.test(String(r.label ?? ''));
}

export function matchesFilter(r: RelationshipView, filter: RelFilter): boolean {
  switch (filter) {
    case 'household':
      return !!r.inHousehold;
    case 'friends':
      return num(r.friendship) >= FRIEND_MIN || /best friend/i.test(String(r.label ?? ''));
    case 'romance':
      return isRomantic(r);
    case 'onLot':
      return !!r.onLot && !r.inHousehold;
    case 'rivals':
      return num(r.friendship) <= RIVAL_MAX;
    case 'all':
    default:
      return true;
  }
}

/** Sort a copy. Ties break by the other metric, then name — so the order is always total and stable. */
export function sortRelationships<T extends Pick<RelationshipView, 'name' | 'friendship' | 'romance'>>(list: readonly T[], sort: RelSort): T[] {
  const name = (x: T) => String(x?.name ?? '');
  const out = (list ?? []).filter(Boolean).slice();
  out.sort((a, b) => {
    if (sort === 'name') return name(a).localeCompare(name(b)) || num(b.friendship) - num(a.friendship);
    if (sort === 'romance') return num(b.romance) - num(a.romance) || num(b.friendship) - num(a.friendship) || name(a).localeCompare(name(b));
    return num(b.friendship) - num(a.friendship) || num(b.romance) - num(a.romance) || name(a).localeCompare(name(b));
  });
  return out;
}

export function filterRelationships(list: readonly RelationshipView[], filter: RelFilter, query = ''): RelationshipView[] {
  const q = normalizeSearch(query);
  return (list ?? []).filter((r) => r && matchesFilter(r, filter) && (!q || normalizeSearch(`${r.name} ${r.label}`).includes(q)));
}

/** Townie picker ordering: available first, then met, then friendship desc, then name. */
export function sortTownies(list: readonly TownieView[], query = ''): TownieView[] {
  const q = normalizeSearch(query);
  return (list ?? [])
    .filter((t) => t && (!q || normalizeSearch(`${t.name} ${t.occupation ?? ''} ${t.label}`).includes(q)))
    .slice()
    .sort(
      (a, b) =>
        Number(!!b.available) - Number(!!a.available) ||
        Number(!!b.met) - Number(!!a.met) ||
        num(b.friendship) - num(a.friendship) ||
        String(a.name).localeCompare(String(b.name)),
    );
}

/** Tone for a relationship label chip. */
export function relationTone(r: Pick<RelationshipView, 'friendship' | 'romance' | 'label'>): 'romance' | 'good' | 'bad' | 'neutral' {
  if (isRomantic(r)) return 'romance';
  if (num(r.friendship) <= RIVAL_MAX) return 'bad';
  if (num(r.friendship) >= FRIEND_MIN) return 'good';
  return 'neutral';
}
